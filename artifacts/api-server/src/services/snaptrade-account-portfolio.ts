import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import {
  buildSnapTradeSignature,
  SNAPTRADE_API_BASE_URL,
} from "./snaptrade-readiness";
import { loadSnapTradeUserCredential } from "./snaptrade-user-custody";
import { readEnvString } from "../lib/env";

export type SnapTradeAccountPortfolioBalance = {
  currency: string;
  cash: number | null;
  buyingPower: number | null;
};

export type SnapTradeAccountPortfolioPosition = {
  snapTradePositionId: string;
  symbol: string;
  rawSymbol: string | null;
  description: string | null;
  instrumentKind: string;
  assetClass: "equity" | "option" | "crypto" | "future" | "other";
  optionContract: SnapTradePositionOptionContract | null;
  quantity: number | null;
  side: "long" | "short" | "flat";
  price: number | null;
  averagePurchasePrice: number | null;
  marketValue: number | null;
  costBasis: number | null;
  unrealizedPnl: number | null;
  currency: string;
  cashEquivalent: boolean;
};

export type SnapTradePositionOptionContract = {
  ticker: string;
  underlying: string;
  expirationDate: string;
  strike: number;
  right: "call" | "put";
  multiplier: number;
  sharesPerContract: number;
  providerContractId: string | null;
  brokerContractId: string | null;
};

export type SnapTradeAccountPortfolioResponse = {
  provider: "snaptrade";
  syncedAt: string;
  account: {
    id: string;
    connectionId: string;
    snapTradeAccountId: string;
    displayName: string;
    baseCurrency: string;
    mode: "live";
    lastSyncedAt: string | null;
  };
  balances: SnapTradeAccountPortfolioBalance[];
  positions: SnapTradeAccountPortfolioPosition[];
  totals: {
    cash: number | null;
    buyingPower: number | null;
    positionMarketValue: number | null;
    unrealizedPnl: number | null;
    netLiquidation: number | null;
    positionCount: number;
  };
  dataFreshness: {
    asOf: string | null;
  };
};

export type GetSnapTradeAccountPortfolioOptions = {
  appUserId: string;
  accountId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

type SnapTradeCredentials = {
  clientId: string;
  consumerKey: string;
};

type LocalSnapTradeAccount = {
  id: string;
  connectionId: string;
  snapTradeAccountId: string;
  displayName: string;
  baseCurrency: string;
  mode: "live";
  lastSyncedAt: string | null;
};

const LOCAL_ID_PREFIX = "snaptrade:";
const DEFAULT_SNAPTRADE_PORTFOLIO_REQUEST_TIMEOUT_MS = 8_000;

function snapTradePortfolioRequestTimeoutMs(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): number {
  const parsed = Number.parseInt(
    readEnvString(env, "SNAPTRADE_PORTFOLIO_REQUEST_TIMEOUT_MS") ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SNAPTRADE_PORTFOLIO_REQUEST_TIMEOUT_MS;
}

function configuredSnapTradeCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): SnapTradeCredentials {
  const clientId = readEnvString(env, "SNAPTRADE_CLIENTID");
  const consumerKey = readEnvString(env, "SNAPTRADE_API_KEY");
  if (!clientId || !consumerKey) {
    throw new HttpError(503, "SnapTrade credentials are not configured", {
      code: "snaptrade_credentials_not_configured",
    });
  }
  return { clientId, consumerKey };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = nonEmptyString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readNestedString(
  record: Record<string, unknown>,
  path: string[],
): string | null {
  let value: unknown = record;
  for (const key of path) {
    value = asRecord(value)[key];
  }
  return nonEmptyString(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sumNullable(values: Array<number | null>): number | null {
  const finiteValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (!finiteValues.length) {
    return null;
  }
  return roundFinancialNumber(
    finiteValues.reduce((sum, value) => sum + value, 0),
  );
}

function roundFinancialNumber(value: number): number {
  return Number(value.toFixed(6));
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function buildUserScopedQuery(input: {
  clientId: string;
  timestamp: string;
  snapTradeUserId: string;
  userSecret: string;
}): string {
  const query = new URLSearchParams();
  query.set("clientId", input.clientId);
  query.set("timestamp", input.timestamp);
  query.set("userId", input.snapTradeUserId);
  query.set("userSecret", input.userSecret);
  return query.toString();
}

async function fetchSnapTradeJson(input: {
  path: string;
  query: string;
  consumerKey: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<unknown> {
  const { signature } = buildSnapTradeSignature({
    path: input.path,
    query: input.query,
    content: null,
    consumerKey: input.consumerKey,
  });

  let response: Response;
  let payload: unknown;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  timeout.unref?.();
  try {
    response = await input.fetchImpl(
      `${SNAPTRADE_API_BASE_URL}${input.path}?${input.query}`,
      {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Signature: signature,
        },
      },
    );
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, "SnapTrade portfolio read failed", {
      code: controller.signal.aborted
        ? "snaptrade_portfolio_timeout"
        : "snaptrade_portfolio_network_error",
      expose: false,
      data: controller.signal.aborted
        ? { path: input.path, timeoutMs: input.timeoutMs }
        : undefined,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new HttpError(502, "SnapTrade portfolio read failed", {
      code: "snaptrade_portfolio_read_failed",
      expose: false,
      data: { path: input.path, status: response.status },
    });
  }

  return payload;
}

function snapTradeAccountIdFromProviderAccountId(value: string): string | null {
  return value.startsWith(LOCAL_ID_PREFIX)
    ? value.slice(LOCAL_ID_PREFIX.length).trim() || null
    : null;
}

async function loadLocalSnapTradeAccount(
  appUserId: string,
  accountId: string,
): Promise<LocalSnapTradeAccount> {
  const [row] = await db
    .select({
      id: brokerAccountsTable.id,
      connectionId: brokerAccountsTable.connectionId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      displayName: brokerAccountsTable.displayName,
      baseCurrency: brokerAccountsTable.baseCurrency,
      mode: brokerAccountsTable.mode,
      lastSyncedAt: brokerAccountsTable.lastSyncedAt,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(
      and(
        eq(brokerAccountsTable.appUserId, appUserId),
        eq(brokerConnectionsTable.appUserId, appUserId),
        eq(brokerAccountsTable.id, accountId),
        eq(brokerConnectionsTable.brokerProvider, "snaptrade"),
        eq(brokerAccountsTable.mode, "live"),
      ),
    )
    .limit(1);

  const snapTradeAccountId = row
    ? snapTradeAccountIdFromProviderAccountId(row.providerAccountId)
    : null;
  if (!row || !snapTradeAccountId) {
    throw new HttpError(404, "SnapTrade account was not found", {
      code: "snaptrade_account_not_found",
    });
  }

  return {
    id: row.id,
    connectionId: row.connectionId,
    snapTradeAccountId,
    displayName: row.displayName,
    baseCurrency: row.baseCurrency,
    mode: "live",
    lastSyncedAt: row.lastSyncedAt,
  };
}

function normalizeCurrency(value: unknown, fallback = "USD"): string {
  const direct = nonEmptyString(value);
  if (direct && /^[A-Za-z]{2,16}$/u.test(direct)) {
    return direct.toUpperCase();
  }
  const record = asRecord(value);
  const code = readString(record, ["code", "currency"]);
  if (code && /^[A-Za-z]{2,16}$/u.test(code)) {
    return code.toUpperCase();
  }
  return fallback;
}

function normalizeBalance(value: unknown): SnapTradeAccountPortfolioBalance {
  const record = asRecord(value);
  return {
    currency: normalizeCurrency(record["currency"]),
    cash: numberOrNull(record["cash"]),
    buyingPower: numberOrNull(
      record["buying_power"] ?? record["buyingPower"],
    ),
  };
}

function parseBalancesPayload(payload: unknown): SnapTradeAccountPortfolioBalance[] {
  if (!Array.isArray(payload)) {
    throw new HttpError(502, "SnapTrade balances returned invalid data", {
      code: "snaptrade_balances_invalid_response",
      expose: false,
    });
  }
  return payload.map(normalizeBalance);
}

function normalizeAssetClass(
  instrumentKind: string,
): SnapTradeAccountPortfolioPosition["assetClass"] {
  switch (instrumentKind.toLowerCase()) {
    case "option":
      return "option";
    case "crypto":
      return "crypto";
    case "future":
    case "futures":
      return "future";
    case "stock":
    case "etf":
    case "adr":
    case "cef":
    case "mutualfund":
      return "equity";
    default:
      return "other";
  }
}

function normalizeSide(quantity: number | null): "long" | "short" | "flat" {
  if (quantity == null || quantity === 0) {
    return "flat";
  }
  return quantity > 0 ? "long" : "short";
}

function normalizeTickerSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function parseOccOptionSymbol(
  value: string | null,
): SnapTradePositionOptionContract | null {
  const compact = value?.trim().replace(/^O:/i, "").replace(/\s+/g, "") ?? "";
  const match = /^([A-Z0-9.]+)(\d{6})([CP])(\d{8})$/i.exec(compact);
  if (!match) {
    return null;
  }

  const [, rawUnderlying, yymmdd, rightCode, rawStrike] = match;
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const expirationDate = new Date(Date.UTC(year, month - 1, day));
  const strike = Number(rawStrike) / 1000;
  if (
    !rawUnderlying ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    Number.isNaN(expirationDate.getTime()) ||
    expirationDate.getUTCFullYear() !== year ||
    expirationDate.getUTCMonth() !== month - 1 ||
    expirationDate.getUTCDate() !== day ||
    !Number.isFinite(strike)
  ) {
    return null;
  }

  const underlying = normalizeTickerSymbol(rawUnderlying);
  const right = rightCode.toUpperCase() === "P" ? "put" : "call";
  const multiplier = 100;
  return {
    ticker: `${underlying}${yymmdd}${rightCode.toUpperCase()}${rawStrike}`,
    underlying,
    expirationDate: expirationDate.toISOString().slice(0, 10),
    strike,
    right,
    multiplier,
    sharesPerContract: multiplier,
    providerContractId: null,
    brokerContractId: null,
  };
}

function normalizeOptionContract(input: {
  assetClass: SnapTradeAccountPortfolioPosition["assetClass"];
  symbol: string;
  rawSymbol: string | null;
}): SnapTradePositionOptionContract | null {
  if (input.assetClass !== "option") {
    return null;
  }
  return (
    parseOccOptionSymbol(input.symbol) ??
    parseOccOptionSymbol(input.rawSymbol)
  );
}

function calculatedDifference(
  left: number | null,
  right: number | null,
): number | null {
  return left == null || right == null ? null : roundFinancialNumber(left - right);
}

function optionContractMultiplier(
  optionContract: SnapTradePositionOptionContract | null,
): number {
  if (!optionContract) {
    return 1;
  }
  const multiplier = optionContract.multiplier || optionContract.sharesPerContract;
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 100;
}

function normalizeAveragePurchasePrice(input: {
  value: number | null;
  optionContract: SnapTradePositionOptionContract | null;
  contractScaled: boolean;
  quantity?: number | null;
  costBasis?: number | null;
}): number | null {
  if (input.value == null) {
    return null;
  }
  const multiplier = optionContractMultiplier(input.optionContract);
  if (input.optionContract && multiplier > 1) {
    if (input.contractScaled) {
      return roundFinancialNumber(input.value / multiplier);
    }

    const quantity = input.quantity == null ? null : Math.abs(input.quantity);
    const perContractCost =
      input.costBasis != null && quantity != null && quantity > 1e-9
        ? Math.abs(input.costBasis) / quantity
        : null;
    // SnapTrade E*TRADE option averages can be per-contract while prices are per-share.
    if (
      perContractCost != null &&
      Math.abs(perContractCost - input.value) <=
        Math.max(0.01, Math.abs(input.value) * 0.0001)
    ) {
      return roundFinancialNumber(input.value / multiplier);
    }
  }
  return input.value;
}

function averagePurchasePriceFromCostBasis(input: {
  value: number | null;
  quantity: number | null;
  optionContract: SnapTradePositionOptionContract | null;
}): number | null {
  if (input.value == null || input.quantity == null) {
    return null;
  }
  const quantity = Math.abs(input.quantity);
  if (quantity <= 1e-9) {
    return null;
  }
  return normalizeAveragePurchasePrice({
    value: roundFinancialNumber(Math.abs(input.value) / quantity),
    optionContract: input.optionContract,
    contractScaled: true,
  });
}

function calculatedPositionMarketValue(input: {
  quantity: number | null;
  price: number | null;
  optionContract: SnapTradePositionOptionContract | null;
}): number | null {
  if (input.quantity == null || input.price == null) {
    return null;
  }
  return roundFinancialNumber(
    input.quantity * input.price * optionContractMultiplier(input.optionContract),
  );
}

function calculatedPositionCostBasis(input: {
  quantity: number | null;
  averagePurchasePrice: number | null;
  optionContract: SnapTradePositionOptionContract | null;
}): number | null {
  if (input.quantity == null || input.averagePurchasePrice == null) {
    return null;
  }
  return roundFinancialNumber(
    input.quantity *
      input.averagePurchasePrice *
      optionContractMultiplier(input.optionContract),
  );
}

function calculatedPositionUnrealizedPnl(input: {
  marketValue: number | null;
  costBasis: number | null;
}): number | null {
  return calculatedDifference(input.marketValue, input.costBasis);
}

function normalizePosition(
  value: unknown,
  index: number,
  fallbackCurrency: string,
): SnapTradeAccountPortfolioPosition {
  const record = asRecord(value);
  const instrument = asRecord(record["instrument"]);
  const instrumentKind =
    readString(instrument, ["kind", "type"]) ??
    readString(record, ["instrument_kind", "instrumentKind"]) ??
    "other";
  const symbol =
    readString(instrument, ["symbol", "ticker"]) ??
    readString(record, ["symbol", "ticker"]) ??
    `POSITION-${index + 1}`;
  const rawSymbol =
    readString(instrument, ["raw_symbol", "rawSymbol"]) ??
    readString(record, ["raw_symbol", "rawSymbol"]);
  const description =
    readString(instrument, ["description", "name"]) ??
    readString(record, ["description", "name"]);
  const assetClass = normalizeAssetClass(instrumentKind);
  const optionContract = normalizeOptionContract({
    assetClass,
    symbol,
    rawSymbol,
  });
  const quantity = numberOrNull(record["units"] ?? record["quantity"]);
  const price = numberOrNull(record["price"] ?? record["market_price"]);
  const rawAveragePurchasePrice = numberOrNull(
    record["average_purchase_price"] ?? record["averagePurchasePrice"],
  );
  const rawCostBasis = numberOrNull(record["cost_basis"] ?? record["costBasis"]);
  const rawUnrealizedPnl = numberOrNull(
    record["open_pnl"] ??
      record["openPnl"] ??
      record["unrealized_pnl"] ??
      record["unrealizedPnl"] ??
      record["unrealized_profit_loss"] ??
      record["unrealizedProfitLoss"],
  );
  const averagePurchasePrice =
    rawAveragePurchasePrice != null
      ? normalizeAveragePurchasePrice({
          value: rawAveragePurchasePrice,
          optionContract,
          contractScaled: false,
          quantity,
          costBasis: rawCostBasis,
        })
      : averagePurchasePriceFromCostBasis({
          value: rawCostBasis,
          quantity,
          optionContract,
        });
  const marketValue =
    calculatedPositionMarketValue({ quantity, price, optionContract }) ??
    numberOrNull(record["market_value"] ?? record["marketValue"]);
  const costBasis = calculatedPositionCostBasis({
    quantity,
    averagePurchasePrice,
    optionContract,
  });
  const unrealizedPnl =
    optionContract
      ? calculatedPositionUnrealizedPnl({ marketValue, costBasis }) ??
        rawUnrealizedPnl
      : rawUnrealizedPnl ??
        calculatedPositionUnrealizedPnl({ marketValue, costBasis });
  const currency = normalizeCurrency(
    record["currency"] ??
      readNestedString(instrument, ["currency"]) ??
      instrument["currency"],
    fallbackCurrency,
  );

  return {
    snapTradePositionId: `${instrumentKind}:${symbol}`,
    symbol: optionContract?.underlying ?? symbol,
    rawSymbol,
    description,
    instrumentKind,
    assetClass,
    optionContract,
    quantity,
    side: normalizeSide(quantity),
    price,
    averagePurchasePrice,
    marketValue,
    costBasis,
    unrealizedPnl,
    currency,
    cashEquivalent: record["cash_equivalent"] === true,
  };
}

function parsePositionsPayload(
  payload: unknown,
  fallbackCurrency: string,
): {
  positions: SnapTradeAccountPortfolioPosition[];
  asOf: string | null;
} {
  const record = asRecord(payload);
  let results: unknown[];
  if (Array.isArray(record["results"])) {
    results = record["results"] as unknown[];
  } else if (Array.isArray(payload)) {
    results = payload;
  } else {
    throw new HttpError(502, "SnapTrade positions returned invalid data", {
      code: "snaptrade_positions_invalid_response",
      expose: false,
    });
  }
  const freshness = asRecord(record["data_freshness"] ?? record["dataFreshness"]);
  return {
    positions: results.map((position, index) =>
      normalizePosition(position, index, fallbackCurrency),
    ),
    asOf:
      readString(freshness, ["as_of", "asOf"]) ??
      readString(record, ["as_of", "asOf"]) ??
      null,
  };
}

function marketValueForTotals(
  position: SnapTradeAccountPortfolioPosition,
): number | null {
  return (
    calculatedPositionMarketValue({
      quantity: position.quantity,
      price: position.price,
      optionContract: position.optionContract,
    }) ?? position.marketValue
  );
}

export function buildSnapTradeAccountPortfolioTotals(input: {
  balances: SnapTradeAccountPortfolioBalance[];
  positions: SnapTradeAccountPortfolioPosition[];
}): SnapTradeAccountPortfolioResponse["totals"] {
  const cash = sumNullable(input.balances.map((balance) => balance.cash));
  const buyingPower = sumNullable(
    input.balances.map((balance) => balance.buyingPower),
  );
  const positionMarketValue = sumNullable(
    input.positions.map(marketValueForTotals),
  );
  const unrealizedPnl = sumNullable(
    input.positions.map((position) => position.unrealizedPnl),
  );
  return {
    cash,
    buyingPower,
    positionMarketValue,
    unrealizedPnl,
    netLiquidation:
      cash == null && positionMarketValue == null
        ? null
        : roundFinancialNumber((cash ?? 0) + (positionMarketValue ?? 0)),
    positionCount: input.positions.length,
  };
}

export async function getSnapTradeAccountPortfolio(
  options: GetSnapTradeAccountPortfolioOptions,
): Promise<SnapTradeAccountPortfolioResponse> {
  const credential = await loadSnapTradeUserCredential({
    appUserId: options.appUserId,
    encryptionKey: options.encryptionKey,
  });
  if (!credential) {
    throw new HttpError(409, "SnapTrade user is not registered", {
      code: "snaptrade_user_not_registered",
    });
  }

  const account = await loadLocalSnapTradeAccount(
    options.appUserId,
    options.accountId,
  );
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const syncedAt = options.now ?? new Date();
  const { clientId, consumerKey } = configuredSnapTradeCredentials(env);
  const timeoutMs = snapTradePortfolioRequestTimeoutMs(env);
  const query = buildUserScopedQuery({
    clientId,
    timestamp: Math.floor(syncedAt.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });
  const encodedAccountId = encodeURIComponent(account.snapTradeAccountId);

  const [balancesPayload, positionsPayload] = await Promise.all([
    fetchSnapTradeJson({
      path: `/accounts/${encodedAccountId}/balances`,
      query,
      consumerKey,
      fetchImpl,
      timeoutMs,
    }),
    fetchSnapTradeJson({
      path: `/accounts/${encodedAccountId}/positions/all`,
      query,
      consumerKey,
      fetchImpl,
      timeoutMs,
    }),
  ]);

  const balances = parseBalancesPayload(balancesPayload);
  const positionsPayloadResult = parsePositionsPayload(
    positionsPayload,
    account.baseCurrency,
  );
  const positions = positionsPayloadResult.positions;

  return {
    provider: "snaptrade",
    syncedAt: syncedAt.toISOString(),
    account,
    balances,
    positions,
    totals: buildSnapTradeAccountPortfolioTotals({ balances, positions }),
    dataFreshness: {
      asOf: positionsPayloadResult.asOf,
    },
  };
}

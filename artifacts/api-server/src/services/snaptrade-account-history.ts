import { and, eq, gte, lte, sql } from "drizzle-orm";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  snapTradeAccountActivitiesTable,
  type SnapTradeAccountActivity,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import {
  buildSnapTradeSignature,
  SNAPTRADE_API_BASE_URL,
} from "./snaptrade-readiness";
import { loadSnapTradeUserCredential } from "./snaptrade-user-custody";
import {
  calculateTransferAdjustedReturnPoints,
  type AccountEquityHistorySeedPoint,
} from "./account-equity-history-model";

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

export type SnapTradeHistoryAccount = {
  id: string;
  connectionId: string;
  snapTradeAccountId: string;
  displayName: string;
  baseCurrency: string;
  mode: "live";
  lastSyncedAt: string | null;
};

export type SnapTradeHistoryActivity = {
  id: string;
  accountId: string;
  symbol: string | null;
  rawSymbol: string | null;
  description: string | null;
  type: string;
  optionType: string | null;
  optionTicker: string | null;
  tradeDate: string;
  settlementDate: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  currency: string;
  externalReferenceId: string | null;
  optionContract: SnapTradeHistoryOptionContract | null;
};

export type SnapTradeHistoryOptionContract = {
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

export type SnapTradeHistoryTrade = {
  id: string;
  source: "SNAPTRADE_ACTIVITY";
  accountId: string;
  symbol: string;
  side: string;
  assetClass: string;
  positionType: "stock" | "option";
  quantity: number;
  openDate: Date | null;
  closeDate: Date | null;
  avgOpen: number | null;
  avgClose: number | null;
  realizedPnl: number | null;
  realizedPnlPercent: number | null;
  holdDurationMinutes: number | null;
  commissions: number | null;
  currency: string;
  sourceType: "manual";
  strategyLabel: string;
  sourceEventId: string | null;
  optionContract: SnapTradeHistoryOptionContract | null;
  optionRight: "call" | "put" | null;
  expirationDate: string | null;
  strike: number | null;
  metadata: Record<string, unknown>;
};

export type SnapTradeAccountHistoryResponse = {
  provider: "snaptrade";
  syncedAt: string;
  account: SnapTradeHistoryAccount;
  activities: SnapTradeHistoryActivity[];
  closedTrades: {
    accountId: string;
    currency: string;
    trades: SnapTradeHistoryTrade[];
    summary: {
      count: number;
      winners: number;
      losers: number;
      realizedPnl: number;
      commissions: number;
      activityCount: number;
      source: "SNAPTRADE_ACTIVITIES";
    };
    updatedAt: string;
  };
  equityHistory: {
    accountId: string;
    range: string;
    currency: string;
    flexConfigured: boolean;
    lastFlexRefreshAt: string | null;
    benchmark: string | null;
    asOf: string | null;
    latestSnapshotAt: string | null;
    isStale: boolean;
    staleReason: string | null;
    terminalPointSource: string | null;
    liveTerminalIncluded: boolean;
    sourceScope: string | null;
    selectedSnapshotSource: string | null;
    points: Array<{
      timestamp: string;
      netLiquidation: number;
      currency: string;
      source: "SNAPTRADE_BALANCE_HISTORY";
      deposits: number;
      withdrawals: number;
      dividends: number;
      fees: number;
      returnPercent: number;
      benchmarkPercent: number | null;
    }>;
    events: Array<{
      timestamp: string;
      type: string;
      amount: number;
      currency: string;
      source: string;
    }>;
    updatedAt: string;
  };
  balanceHistory: {
    available: boolean;
    reason: string | null;
    pointCount: number;
  };
  backfill: {
    activitiesFetched: number;
    activitiesStored: number;
    balanceSnapshotsFetched: number;
    balanceSnapshotsStored: number;
  };
};

export type GetSnapTradeAccountHistoryOptions = {
  appUserId: string;
  accountId: string;
  from?: Date | string | null;
  to?: Date | string | null;
  range?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

type ActivityLot = {
  activity: SnapTradeHistoryActivity;
  quantityRemaining: number;
  valueRemaining: number;
  feeRemaining: number;
  openedAt: Date;
};

const LOCAL_ID_PREFIX = "snaptrade:";
const SNAPTRADE_ACTIVITY_PAGE_LIMIT = 1000;
const SNAPTRADE_ACTIVITY_MAX_PAGES = 25;

function readEnvString(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string {
  return env[key]?.trim() ?? "";
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

function roundFinancialNumber(value: number): number {
  return Number(value.toFixed(6));
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

function buildUserScopedQuery(input: {
  clientId: string;
  timestamp: string;
  snapTradeUserId: string;
  userSecret: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
}): string {
  const query = new URLSearchParams();
  query.set("clientId", input.clientId);
  query.set("timestamp", input.timestamp);
  query.set("userId", input.snapTradeUserId);
  query.set("userSecret", input.userSecret);
  Object.entries(input.extra ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  });
  return query.toString();
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

async function fetchSnapTradeJson(input: {
  path: string;
  query: string;
  consumerKey: string;
  fetchImpl: typeof fetch;
  message: string;
  networkCode: string;
  failedCode: string;
  optionalStatuses?: number[];
}): Promise<{ ok: true; payload: unknown } | { ok: false; status: number; payload: unknown }> {
  const { signature } = buildSnapTradeSignature({
    path: input.path,
    query: input.query,
    content: null,
    consumerKey: input.consumerKey,
  });

  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(
      `${SNAPTRADE_API_BASE_URL}${input.path}?${input.query}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Signature: signature,
        },
      },
    );
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, input.message, {
      code: input.networkCode,
      expose: false,
    });
  }

  if (!response.ok) {
    if (input.optionalStatuses?.includes(response.status)) {
      return { ok: false, status: response.status, payload };
    }
    throw new HttpError(502, input.message, {
      code: input.failedCode,
      expose: false,
      data: { path: input.path, status: response.status },
    });
  }

  return { ok: true, payload };
}

function parseDate(value: unknown): Date | null {
  const text = nonEmptyString(value);
  if (!text) {
    return null;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = dateOnly ? new Date(`${text}T21:00:00.000Z`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value: Date | string | null | undefined): string | null {
  const parsed = value instanceof Date ? value : parseDate(value);
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : null;
}

function parseOccOptionSymbol(value: string | null): SnapTradeHistoryOptionContract | null {
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
    Number.isNaN(expirationDate.getTime()) ||
    expirationDate.getUTCFullYear() !== year ||
    expirationDate.getUTCMonth() !== month - 1 ||
    expirationDate.getUTCDate() !== day ||
    !Number.isFinite(strike)
  ) {
    return null;
  }

  const underlying = rawUnderlying.trim().toUpperCase();
  const multiplier = 100;
  return {
    ticker: `${underlying}${yymmdd}${rightCode.toUpperCase()}${rawStrike}`,
    underlying,
    expirationDate: expirationDate.toISOString().slice(0, 10),
    strike,
    right: rightCode.toUpperCase() === "P" ? "put" : "call",
    multiplier,
    sharesPerContract: multiplier,
    providerContractId: null,
    brokerContractId: null,
  };
}

function activityOptionContract(input: {
  symbol: string | null;
  rawSymbol: string | null;
  optionTicker: string | null;
}): SnapTradeHistoryOptionContract | null {
  return (
    parseOccOptionSymbol(input.optionTicker) ??
    parseOccOptionSymbol(input.rawSymbol) ??
    parseOccOptionSymbol(input.symbol)
  );
}

function normalizeSymbol(value: string | null): string | null {
  const text = value?.trim().toUpperCase() ?? "";
  return text || null;
}

function normalizeActivity(
  value: unknown,
  accountId: string,
  fallbackCurrency: string,
): SnapTradeHistoryActivity | null {
  const record = asRecord(value);
  const id = readString(record, ["id", "activity_id", "activityId"]);
  const tradeDate = parseDate(record["trade_date"] ?? record["tradeDate"]);
  const type = readString(record, ["type"]);
  if (!id || !tradeDate || !type) {
    return null;
  }

  const symbolRecord = asRecord(record["symbol"]);
  const optionTicker =
    readString(record, ["option_symbol", "optionSymbol", "option_ticker", "optionTicker"]) ??
    readNestedString(record, ["option_symbol", "ticker"]) ??
    readNestedString(record, ["optionSymbol", "ticker"]);
  const rawSymbol =
    readString(symbolRecord, ["raw_symbol", "rawSymbol"]) ??
    readString(record, ["raw_symbol", "rawSymbol"]);
  const symbol =
    readString(symbolRecord, ["symbol"]) ??
    readString(record, ["symbol"]);
  const optionContract = activityOptionContract({
    symbol,
    rawSymbol,
    optionTicker,
  });
  const currency = normalizeCurrency(
    record["currency"] ??
      readNestedString(symbolRecord, ["currency", "code"]) ??
      symbolRecord["currency"],
    fallbackCurrency,
  );

  return {
    id,
    accountId,
    symbol: optionContract?.underlying ?? normalizeSymbol(symbol),
    rawSymbol: rawSymbol ?? symbol ?? null,
    description:
      readString(record, ["description"]) ??
      readString(symbolRecord, ["description"]),
    type: type.trim().toUpperCase(),
    optionType: readString(record, ["option_type", "optionType"])?.toUpperCase() ?? null,
    optionTicker: optionContract?.ticker ?? optionTicker,
    tradeDate: tradeDate.toISOString(),
    settlementDate:
      parseDate(record["settlement_date"] ?? record["settlementDate"])?.toISOString() ??
      null,
    quantity: numberOrNull(record["units"] ?? record["quantity"]),
    price: numberOrNull(record["price"]),
    amount: numberOrNull(record["amount"]),
    fee: numberOrNull(record["fee"]) ?? 0,
    currency,
    externalReferenceId:
      readString(record, ["external_reference_id", "externalReferenceId"]) ?? null,
    optionContract,
  };
}

function parseActivitiesPayload(payload: unknown, accountId: string, currency: string) {
  const record = asRecord(payload);
  const rows = Array.isArray(record["data"])
    ? record["data"]
    : Array.isArray(payload)
      ? payload
      : null;
  if (!rows) {
    throw new HttpError(502, "SnapTrade activities returned invalid data", {
      code: "snaptrade_activities_invalid_response",
      expose: false,
    });
  }

  const pagination = asRecord(record["pagination"]);
  return {
    activities: rows
      .map((row) => normalizeActivity(row, accountId, currency))
      .filter((row): row is SnapTradeHistoryActivity => Boolean(row)),
    total: numberOrNull(pagination["total"]),
  };
}

async function fetchAllActivities(input: {
  account: LocalSnapTradeAccount;
  clientId: string;
  consumerKey: string;
  snapTradeUserId: string;
  userSecret: string;
  timestamp: string;
  fetchImpl: typeof fetch;
  to?: Date | string | null;
}): Promise<SnapTradeHistoryActivity[]> {
  const activities: SnapTradeHistoryActivity[] = [];
  const encodedAccountId = encodeURIComponent(input.account.snapTradeAccountId);
  const endDate = dateOnly(input.to);

  for (let page = 0; page < SNAPTRADE_ACTIVITY_MAX_PAGES; page += 1) {
    const offset = page * SNAPTRADE_ACTIVITY_PAGE_LIMIT;
    const query = buildUserScopedQuery({
      clientId: input.clientId,
      timestamp: input.timestamp,
      snapTradeUserId: input.snapTradeUserId,
      userSecret: input.userSecret,
      extra: {
        limit: SNAPTRADE_ACTIVITY_PAGE_LIMIT,
        offset,
        endDate,
      },
    });
    const result = await fetchSnapTradeJson({
      path: `/accounts/${encodedAccountId}/activities`,
      query,
      consumerKey: input.consumerKey,
      fetchImpl: input.fetchImpl,
      message: "SnapTrade activities read failed",
      networkCode: "snaptrade_activities_network_error",
      failedCode: "snaptrade_activities_failed",
    });
    if (!result.ok) {
      return activities;
    }
    const parsed = parseActivitiesPayload(
      result.payload,
      input.account.id,
      input.account.baseCurrency,
    );
    activities.push(...parsed.activities);
    const total = parsed.total;
    if (
      parsed.activities.length < SNAPTRADE_ACTIVITY_PAGE_LIMIT ||
      (total != null && activities.length >= total)
    ) {
      break;
    }
  }

  return activities;
}

function dbNumber(value: number | null): string | null {
  return value == null ? null : value.toFixed(6);
}

async function storeActivities(
  activities: SnapTradeHistoryActivity[],
): Promise<number> {
  if (!activities.length) {
    return 0;
  }
  const now = new Date();
  await db
    .insert(snapTradeAccountActivitiesTable)
    .values(
      activities.map((activity) => ({
        accountId: activity.accountId,
        snapTradeActivityId: activity.id,
        tradeDate: new Date(activity.tradeDate),
        settlementDate: activity.settlementDate
          ? new Date(activity.settlementDate)
          : null,
        type: activity.type,
        optionType: activity.optionType,
        symbol: activity.symbol,
        rawSymbol: activity.rawSymbol,
        description: activity.description,
        optionTicker: activity.optionTicker,
        quantity: dbNumber(activity.quantity),
        price: dbNumber(activity.price),
        amount: dbNumber(activity.amount),
        fee: dbNumber(activity.fee),
        currency: activity.currency,
        externalReferenceId: activity.externalReferenceId,
        rawPayload: activity as unknown as Record<string, unknown>,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [
        snapTradeAccountActivitiesTable.accountId,
        snapTradeAccountActivitiesTable.snapTradeActivityId,
      ],
      set: {
        tradeDate: sql`excluded.trade_date`,
        settlementDate: sql`excluded.settlement_date`,
        type: sql`excluded.type`,
        optionType: sql`excluded.option_type`,
        symbol: sql`excluded.symbol`,
        rawSymbol: sql`excluded.raw_symbol`,
        description: sql`excluded.description`,
        optionTicker: sql`excluded.option_ticker`,
        quantity: sql`excluded.quantity`,
        price: sql`excluded.price`,
        amount: sql`excluded.amount`,
        fee: sql`excluded.fee`,
        currency: sql`excluded.currency`,
        externalReferenceId: sql`excluded.external_reference_id`,
        rawPayload: sql`excluded.raw_payload`,
        updatedAt: now,
      },
    });
  return activities.length;
}

function storedActivityToHistory(
  row: SnapTradeAccountActivity,
): SnapTradeHistoryActivity {
  const raw = asRecord(row.rawPayload);
  const optionContract = activityOptionContract({
    symbol: row.symbol,
    rawSymbol: row.rawSymbol,
    optionTicker: row.optionTicker,
  });
  return {
    id: row.snapTradeActivityId,
    accountId: row.accountId,
    symbol: optionContract?.underlying ?? normalizeSymbol(row.symbol),
    rawSymbol: row.rawSymbol,
    description: row.description,
    type: row.type,
    optionType: row.optionType,
    optionTicker: optionContract?.ticker ?? row.optionTicker,
    tradeDate: row.tradeDate.toISOString(),
    settlementDate: row.settlementDate?.toISOString() ?? null,
    quantity: numberOrNull(row.quantity),
    price: numberOrNull(row.price),
    amount: numberOrNull(row.amount),
    fee: numberOrNull(row.fee),
    currency: row.currency,
    externalReferenceId: row.externalReferenceId,
    optionContract:
      optionContract ??
      (asRecord(raw["optionContract"]) as SnapTradeHistoryOptionContract | null),
  };
}

async function readStoredActivities(input: {
  accountId: string;
  from?: Date | string | null;
  to?: Date | string | null;
}): Promise<SnapTradeHistoryActivity[]> {
  const conditions = [eq(snapTradeAccountActivitiesTable.accountId, input.accountId)];
  const from = parseDate(input.from);
  const to = parseDate(input.to);
  if (from) {
    conditions.push(gte(snapTradeAccountActivitiesTable.tradeDate, from));
  }
  if (to) {
    conditions.push(lte(snapTradeAccountActivitiesTable.tradeDate, to));
  }
  const rows = await db
    .select()
    .from(snapTradeAccountActivitiesTable)
    .where(and(...conditions))
    .orderBy(snapTradeAccountActivitiesTable.tradeDate);
  return rows.map(storedActivityToHistory);
}

function activitySortAsc(
  left: SnapTradeHistoryActivity,
  right: SnapTradeHistoryActivity,
) {
  return new Date(left.tradeDate).getTime() - new Date(right.tradeDate).getTime();
}

function activityKey(activity: SnapTradeHistoryActivity): string {
  return [
    activity.accountId,
    activity.optionContract ? "option" : "stock",
    activity.optionContract?.ticker ?? activity.symbol ?? activity.rawSymbol ?? "UNKNOWN",
  ].join("|");
}

function activityMultiplier(activity: SnapTradeHistoryActivity): number {
  return activity.optionContract?.multiplier ?? 1;
}

function activityNotional(activity: SnapTradeHistoryActivity): number | null {
  const quantity = Math.abs(activity.quantity ?? 0);
  if (activity.amount != null && activity.amount !== 0) {
    return Math.abs(activity.amount);
  }
  if (activity.price != null && quantity > 0) {
    return roundFinancialNumber(
      activity.price * quantity * activityMultiplier(activity),
    );
  }
  return null;
}

function consumeLots(input: {
  lots: ActivityLot[];
  closingActivity: SnapTradeHistoryActivity;
  closingValue: number;
  closingFee: number;
  closeSide: "sell" | "buy";
}): SnapTradeHistoryTrade[] {
  const quantityToClose = Math.abs(input.closingActivity.quantity ?? 0);
  if (quantityToClose <= 0) {
    return [];
  }
  const trades: SnapTradeHistoryTrade[] = [];
  let remaining = quantityToClose;
  const multiplier = activityMultiplier(input.closingActivity);
  while (remaining > 1e-9 && input.lots.length) {
    const lot = input.lots[0];
    const closedQuantity = Math.min(remaining, lot.quantityRemaining);
    const openRatio = closedQuantity / lot.quantityRemaining;
    const closeRatio = closedQuantity / quantityToClose;
    const openValue = lot.valueRemaining * openRatio;
    const openFee = lot.feeRemaining * openRatio;
    const closeValue = input.closingValue * closeRatio;
    const closeFee = input.closingFee * closeRatio;
    const realizedPnl =
      input.closeSide === "sell"
        ? closeValue - openValue - openFee - closeFee
        : openValue - closeValue - openFee - closeFee;
    const openDate = lot.openedAt;
    const closeDate = new Date(input.closingActivity.tradeDate);
    const feeAdjustedOpenValue =
      input.closeSide === "sell" ? openValue + openFee : openValue - openFee;
    const feeAdjustedCloseValue =
      input.closeSide === "sell" ? closeValue - closeFee : closeValue + closeFee;
    const avgOpen = feeAdjustedOpenValue / closedQuantity / multiplier;
    const avgClose = feeAdjustedCloseValue / closedQuantity / multiplier;

    trades.push({
      id: `snaptrade-activity:${lot.activity.id}:${input.closingActivity.id}:${closedQuantity}`,
      source: "SNAPTRADE_ACTIVITY",
      accountId: input.closingActivity.accountId,
      symbol:
        input.closingActivity.optionContract?.underlying ??
        input.closingActivity.symbol ??
        input.closingActivity.rawSymbol ??
        "UNKNOWN",
      side: input.closeSide,
      assetClass: input.closingActivity.optionContract ? "Options" : "Stocks",
      positionType: input.closingActivity.optionContract ? "option" : "stock",
      quantity: closedQuantity,
      openDate,
      closeDate,
      avgOpen: roundFinancialNumber(avgOpen),
      avgClose: roundFinancialNumber(avgClose),
      realizedPnl: roundFinancialNumber(realizedPnl),
      realizedPnlPercent: feeAdjustedOpenValue
        ? roundFinancialNumber((realizedPnl / Math.abs(feeAdjustedOpenValue)) * 100)
        : null,
      holdDurationMinutes: Math.round(
        (closeDate.getTime() - openDate.getTime()) / 60_000,
      ),
      commissions: roundFinancialNumber(openFee + closeFee),
      currency: input.closingActivity.currency,
      sourceType: "manual",
      strategyLabel: "Manual",
      sourceEventId: input.closingActivity.id,
      optionContract: input.closingActivity.optionContract,
      optionRight: input.closingActivity.optionContract?.right ?? null,
      expirationDate: input.closingActivity.optionContract?.expirationDate ?? null,
      strike: input.closingActivity.optionContract?.strike ?? null,
      metadata: {
        openingActivityId: lot.activity.id,
        closingActivityId: input.closingActivity.id,
        closingActivityType: input.closingActivity.type,
        closingOptionType: input.closingActivity.optionType,
      },
    });

    remaining -= closedQuantity;
    lot.quantityRemaining -= closedQuantity;
    lot.valueRemaining -= openValue;
    lot.feeRemaining -= openFee;
    if (lot.quantityRemaining <= 1e-9) {
      input.lots.shift();
    }
  }
  return trades;
}

function buildClosedTradesFromActivities(
  activities: SnapTradeHistoryActivity[],
): SnapTradeHistoryTrade[] {
  const longLots = new Map<string, ActivityLot[]>();
  const shortLots = new Map<string, ActivityLot[]>();
  const trades: SnapTradeHistoryTrade[] = [];

  activities
    .filter((activity) => activity.type === "BUY" || activity.type === "SELL")
    .sort(activitySortAsc)
    .forEach((activity) => {
      const quantity = Math.abs(activity.quantity ?? 0);
      const value = activityNotional(activity);
      if (!quantity || value == null) {
        return;
      }
      const fee = Math.abs(activity.fee ?? 0);
      const key = activityKey(activity);
      const isBuy = activity.type === "BUY";
      const optionType = activity.optionType ?? "";
      const longQueue = longLots.get(key) ?? [];
      const shortQueue = shortLots.get(key) ?? [];

      if (isBuy) {
        if (optionType.includes("TO_CLOSE") || shortQueue.length) {
          trades.push(
            ...consumeLots({
              lots: shortQueue,
              closingActivity: activity,
              closingValue: value,
              closingFee: fee,
              closeSide: "buy",
            }),
          );
          shortLots.set(key, shortQueue);
          return;
        }
        longQueue.push({
          activity,
          quantityRemaining: quantity,
          valueRemaining: value,
          feeRemaining: fee,
          openedAt: new Date(activity.tradeDate),
        });
        longLots.set(key, longQueue);
        return;
      }

      if (optionType.includes("TO_OPEN") && !longQueue.length) {
        shortQueue.push({
          activity,
          quantityRemaining: quantity,
          valueRemaining: value,
          feeRemaining: fee,
          openedAt: new Date(activity.tradeDate),
        });
        shortLots.set(key, shortQueue);
        return;
      }

      trades.push(
        ...consumeLots({
          lots: longQueue,
          closingActivity: activity,
          closingValue: value,
          closingFee: fee,
          closeSide: "sell",
        }),
      );
      longLots.set(key, longQueue);
    });

  return trades.sort((left, right) => {
    const leftTime = left.closeDate?.getTime() ?? 0;
    const rightTime = right.closeDate?.getTime() ?? 0;
    return rightTime - leftTime;
  });
}

function activityCashEvents(activities: SnapTradeHistoryActivity[]) {
  const eventTypes = new Map([
    ["CONTRIBUTION", "deposit"],
    ["WITHDRAWAL", "withdrawal"],
    ["DIVIDEND", "dividend"],
    ["INTEREST", "interest"],
    ["FEE", "fee"],
    ["TAX", "fee"],
  ]);
  return activities
    .map((activity) => {
      const type = eventTypes.get(activity.type);
      const amount = activity.amount;
      if (!type || amount == null || amount === 0) {
        return null;
      }
      return {
        timestamp: activity.tradeDate,
        type,
        amount,
        currency: activity.currency,
        source: "SNAPTRADE_ACTIVITY",
      };
    })
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
}

type BalanceHistoryPoint = {
  timestamp: Date;
  netLiquidation: number;
  currency: string;
};

function parseBalanceHistoryPayload(payload: unknown, fallbackCurrency: string) {
  const record = asRecord(payload);
  const rows = Array.isArray(record["history"]) ? record["history"] : null;
  if (!rows) {
    throw new HttpError(502, "SnapTrade balance history returned invalid data", {
      code: "snaptrade_balance_history_invalid_response",
      expose: false,
    });
  }
  const currency = normalizeCurrency(record["currency"], fallbackCurrency);
  return rows
    .map((row) => {
      const rowRecord = asRecord(row);
      const date = parseDate(rowRecord["date"]);
      const netLiquidation = numberOrNull(
        rowRecord["total_value"] ?? rowRecord["totalValue"],
      );
      if (!date || netLiquidation == null) {
        return null;
      }
      return {
        timestamp: date,
        netLiquidation,
        currency: normalizeCurrency(rowRecord["currency"], currency),
      };
    })
    .filter((point): point is BalanceHistoryPoint => Boolean(point))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
}

async function fetchBalanceHistory(input: {
  account: LocalSnapTradeAccount;
  clientId: string;
  consumerKey: string;
  snapTradeUserId: string;
  userSecret: string;
  timestamp: string;
  fetchImpl: typeof fetch;
}): Promise<
  | { available: true; points: BalanceHistoryPoint[] }
  | { available: false; reason: string; points: BalanceHistoryPoint[] }
> {
  const encodedAccountId = encodeURIComponent(input.account.snapTradeAccountId);
  const query = buildUserScopedQuery({
    clientId: input.clientId,
    timestamp: input.timestamp,
    snapTradeUserId: input.snapTradeUserId,
    userSecret: input.userSecret,
  });
  const result = await fetchSnapTradeJson({
    path: `/accounts/${encodedAccountId}/balanceHistory`,
    query,
    consumerKey: input.consumerKey,
    fetchImpl: input.fetchImpl,
    message: "SnapTrade balance history read failed",
    networkCode: "snaptrade_balance_history_network_error",
    failedCode: "snaptrade_balance_history_failed",
    optionalStatuses: [403, 404],
  });
  if (!result.ok) {
    return {
      available: false,
      reason: "snaptrade_balance_history_unavailable",
      points: [],
    };
  }
  return {
    available: true,
    points: parseBalanceHistoryPayload(result.payload, input.account.baseCurrency),
  };
}

async function storeBalanceSnapshots(input: {
  accountId: string;
  points: BalanceHistoryPoint[];
}): Promise<number> {
  if (!input.points.length) {
    return 0;
  }
  const existing = await db
    .select({ asOf: balanceSnapshotsTable.asOf })
    .from(balanceSnapshotsTable)
    .where(eq(balanceSnapshotsTable.accountId, input.accountId));
  const existingKeys = new Set(existing.map((row) => row.asOf.toISOString()));
  const missing = input.points.filter(
    (point) => !existingKeys.has(point.timestamp.toISOString()),
  );
  if (!missing.length) {
    return 0;
  }
  await db.insert(balanceSnapshotsTable).values(
    missing.map((point) => ({
      accountId: input.accountId,
      currency: point.currency,
      cash: "0.000000",
      buyingPower: "0.000000",
      netLiquidation: point.netLiquidation.toFixed(6),
      maintenanceMargin: null,
      asOf: point.timestamp,
    })),
  );
  return missing.length;
}

function equityHistoryFromBalancePoints(input: {
  accountId: string;
  range: string;
  currency: string;
  points: BalanceHistoryPoint[];
  events: ReturnType<typeof activityCashEvents>;
  updatedAt: string;
}) {
  const seedPoints: AccountEquityHistorySeedPoint[] = input.points.map((point) => ({
    timestamp: point.timestamp,
    netLiquidation: point.netLiquidation,
    currency: point.currency,
    source: "SNAPTRADE_BALANCE_HISTORY",
    deposits: 0,
    withdrawals: 0,
    dividends: 0,
    fees: 0,
  }));
  const adjusted = calculateTransferAdjustedReturnPoints(seedPoints);
  const lastPoint = adjusted[adjusted.length - 1] ?? null;
  return {
    accountId: input.accountId,
    range: input.range,
    currency: input.currency,
    flexConfigured: false,
    lastFlexRefreshAt: null,
    benchmark: null,
    asOf: lastPoint?.timestamp.toISOString() ?? null,
    latestSnapshotAt: lastPoint?.timestamp.toISOString() ?? null,
    isStale: false,
    staleReason: null,
    terminalPointSource: lastPoint ? "snaptrade_balance_history" : null,
    liveTerminalIncluded: false,
    sourceScope: "manual",
    selectedSnapshotSource: "SNAPTRADE_BALANCE_HISTORY",
    points: adjusted.map((point) => ({
      timestamp: point.timestamp.toISOString(),
      netLiquidation: point.netLiquidation,
      currency: point.currency,
      source: "SNAPTRADE_BALANCE_HISTORY" as const,
      deposits: point.deposits,
      withdrawals: point.withdrawals,
      dividends: point.dividends,
      fees: point.fees,
      returnPercent: point.returnPercent,
      benchmarkPercent: null,
    })),
    events: input.events,
    updatedAt: input.updatedAt,
  };
}

function filterClosedTrades(input: {
  trades: SnapTradeHistoryTrade[];
  from?: Date | string | null;
  to?: Date | string | null;
}) {
  const from = parseDate(input.from);
  const to = parseDate(input.to);
  return input.trades.filter((trade) => {
    const closeTime = trade.closeDate?.getTime();
    if (closeTime == null) {
      return false;
    }
    if (from && closeTime < from.getTime()) {
      return false;
    }
    if (to && closeTime > to.getTime()) {
      return false;
    }
    return true;
  });
}

function publicAccount(account: LocalSnapTradeAccount): SnapTradeHistoryAccount {
  return {
    id: account.id,
    connectionId: account.connectionId,
    snapTradeAccountId: account.snapTradeAccountId,
    displayName: account.displayName,
    baseCurrency: account.baseCurrency,
    mode: "live",
    lastSyncedAt: account.lastSyncedAt,
  };
}

export async function getSnapTradeAccountHistory(
  options: GetSnapTradeAccountHistoryOptions,
): Promise<SnapTradeAccountHistoryResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const credentials = configuredSnapTradeCredentials(env);
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

  const [fetchedActivities, balanceHistory] = await Promise.all([
    fetchAllActivities({
      account,
      clientId: credentials.clientId,
      consumerKey: credentials.consumerKey,
      snapTradeUserId: credential.snapTradeUserId,
      userSecret: credential.userSecret,
      timestamp,
      fetchImpl,
      to: options.to,
    }),
    fetchBalanceHistory({
      account,
      clientId: credentials.clientId,
      consumerKey: credentials.consumerKey,
      snapTradeUserId: credential.snapTradeUserId,
      userSecret: credential.userSecret,
      timestamp,
      fetchImpl,
    }),
  ]);

  const [activitiesStored, balanceSnapshotsStored] = await Promise.all([
    storeActivities(fetchedActivities),
    storeBalanceSnapshots({
      accountId: account.id,
      points: balanceHistory.points,
    }),
  ]);
  const activities = await readStoredActivities({
    accountId: account.id,
    from: null,
    to: options.to,
  });
  const allClosedTrades = buildClosedTradesFromActivities(activities);
  const trades = filterClosedTrades({
    trades: allClosedTrades,
    from: options.from,
    to: options.to,
  });
  const events = activityCashEvents(activities);
  const equityHistory = equityHistoryFromBalancePoints({
    accountId: account.id,
    range: options.range || "ALL",
    currency: account.baseCurrency,
    points: balanceHistory.points,
    events,
    updatedAt: now.toISOString(),
  });
  const commissions = trades.reduce(
    (sum, trade) => sum + (trade.commissions ?? 0),
    0,
  );
  const realizedPnl = trades.reduce(
    (sum, trade) => sum + (trade.realizedPnl ?? 0),
    0,
  );

  return {
    provider: "snaptrade",
    syncedAt: now.toISOString(),
    account: publicAccount(account),
    activities,
    closedTrades: {
      accountId: account.id,
      currency: account.baseCurrency,
      trades,
      summary: {
        count: trades.length,
        winners: trades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length,
        losers: trades.filter((trade) => (trade.realizedPnl ?? 0) < 0).length,
        realizedPnl: roundFinancialNumber(realizedPnl),
        commissions: roundFinancialNumber(commissions),
        activityCount: activities.length,
        source: "SNAPTRADE_ACTIVITIES",
      },
      updatedAt: now.toISOString(),
    },
    equityHistory,
    balanceHistory: {
      available: balanceHistory.available,
      reason: balanceHistory.available ? null : balanceHistory.reason,
      pointCount: balanceHistory.points.length,
    },
    backfill: {
      activitiesFetched: fetchedActivities.length,
      activitiesStored,
      balanceSnapshotsFetched: balanceHistory.points.length,
      balanceSnapshotsStored,
    },
  };
}

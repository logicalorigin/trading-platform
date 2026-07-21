import type {
  BrokerPositionSnapshot,
  PositionQuoteSnapshot,
} from "../providers/ibkr/client";
import { RobinhoodMcpSession } from "../providers/robinhood/mcp-client";
import { HttpError } from "../lib/errors";
import { normalizeSymbol } from "../lib/values";
import { getRobinhoodAccessToken } from "./robinhood-oauth";

const ROBINHOOD_POSITION_MAX_PAGES = 200;
const ROBINHOOD_QUOTE_BATCH_SIZE = 20;
// ponytail: keep reuse below OAuth's 60s refresh skew; carry token expiry in
// session metadata before extending this window.
const ROBINHOOD_POSITION_SESSION_CACHE_TTL_MS = 45_000;
const ROBINHOOD_POSITION_SESSION_CACHE_MAX_ENTRIES = 64;
const POSITION_QUANTITY_EPSILON = 1e-9;
const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;

export type RobinhoodAccountPositionIdentity = {
  accountId: string;
  accountNumber: string;
};

export type RobinhoodAccountPositionsToolFetcher = (input: {
  appUserId: string;
  name: string;
  arguments: Record<string, unknown>;
}) => Promise<unknown>;

type ReadRobinhoodAccountPositionsOptions = {
  callTool?: RobinhoodAccountPositionsToolFetcher;
  createToolFetcher?: (
    appUserId: string,
    options: ReadRobinhoodAccountPositionsOptions,
  ) => Promise<RobinhoodAccountPositionsToolFetcher>;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  encryptionKey?: string;
  mcpUrl?: string;
  now?: Date;
  onStageTiming?: (
    stage: "session" | "holdings" | "market_data",
    durationMs: number,
  ) => void;
};

type RobinhoodPositionSessionCacheEntry = {
  expiresAt: number;
  promise: Promise<RobinhoodAccountPositionsToolFetcher>;
};

const robinhoodPositionSessions = new Map<
  string,
  RobinhoodPositionSessionCacheEntry
>();

async function timeRobinhoodPositionsStage<T>(
  options: ReadRobinhoodAccountPositionsOptions,
  stage: "session" | "holdings" | "market_data",
  work: () => Promise<T>,
): Promise<T> {
  if (!options.onStageTiming) {
    return work();
  }
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    const durationMs = Math.max(
      0,
      Math.round((performance.now() - startedAt) * 1_000) / 1_000,
    );
    try {
      options.onStageTiming(stage, durationMs);
    } catch {
      // Diagnostics must never affect a broker read.
    }
  }
}

type RobinhoodEquityHolding = {
  accountId: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
};

type RobinhoodOptionHolding = {
  accountId: string;
  optionId: string;
  chainId: string;
  underlying: string;
  quantity: number;
  averagePrice: number;
  multiplier: number;
  expirationDate: Date;
  openedAt: Date | null;
};

type RobinhoodEquityQuote = {
  symbol: string;
  price: number;
  previousClose: number | null;
  updatedAt: Date;
};

type RobinhoodOptionInstrument = {
  id: string;
  chainId: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
};

type RobinhoodOptionQuote = {
  optionId: string;
  mark: number;
  previousClose: number | null;
  updatedAt: Date;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  openInterest: number | null;
  volume: number | null;
};

function positionsUnavailable(): never {
  throw new HttpError(503, "Robinhood account positions are unavailable.", {
    code: "robinhood_account_positions_unavailable",
    expose: true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordOrUnavailable(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : positionsUnavailable();
}

function stringOrUnavailable(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : positionsUnavailable();
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || !DECIMAL_NUMBER_PATTERN.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteNumberOrUnavailable(value: unknown): number {
  return finiteNumberOrNull(value) ?? positionsUnavailable();
}

function nonNegativeNumberOrUnavailable(value: unknown): number {
  const numeric = finiteNumberOrUnavailable(value);
  return numeric >= 0 ? numeric : positionsUnavailable();
}

function positiveNumberOrUnavailable(value: unknown): number {
  const numeric = finiteNumberOrUnavailable(value);
  return numeric > 0 ? numeric : positionsUnavailable();
}

function dateOrUnavailable(value: unknown): Date {
  if (typeof value !== "string" || !value.trim()) {
    return positionsUnavailable();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? positionsUnavailable() : parsed;
}

function dateOnlyOrUnavailable(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return positionsUnavailable();
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? parsed
    : positionsUnavailable();
}

function optionalDateOrUnavailable(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return dateOrUnavailable(value);
}

function payloadRows(payload: unknown, key: string): Record<string, unknown>[] {
  const root = recordOrUnavailable(payload);
  const data = recordOrUnavailable(root["data"]);
  if (!(key in data)) {
    return positionsUnavailable();
  }
  const value = data[key];
  if (value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return positionsUnavailable();
  }
  return value.flatMap((row) =>
    row === null ? [] : [recordOrUnavailable(row)],
  );
}

function nextCursor(payload: unknown): string | null {
  const root = recordOrUnavailable(payload);
  const data = recordOrUnavailable(root["data"]);
  const value = data["next"];
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    return positionsUnavailable();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return positionsUnavailable();
  }
  const cursor = parsed.searchParams.get("cursor")?.trim();
  return cursor || positionsUnavailable();
}

async function readPaginatedRows(input: {
  appUserId: string;
  callTool: RobinhoodAccountPositionsToolFetcher;
  toolName: string;
  arguments: Record<string, unknown>;
  rowKey: string;
}): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < ROBINHOOD_POSITION_MAX_PAGES; page += 1) {
    const payload = await input.callTool({
      appUserId: input.appUserId,
      name: input.toolName,
      arguments: {
        ...input.arguments,
        ...(cursor ? { cursor } : {}),
      },
    });
    rows.push(...payloadRows(payload, input.rowKey));
    const next = nextCursor(payload);
    if (!next) {
      return rows;
    }
    if (seenCursors.has(next)) {
      return positionsUnavailable();
    }
    seenCursors.add(next);
    cursor = next;
  }

  return positionsUnavailable();
}

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function normalizeEquityHolding(
  accountId: string,
  row: Record<string, unknown>,
): RobinhoodEquityHolding | null {
  const symbol = normalizeSymbol(stringOrUnavailable(row, "symbol"));
  const quantity = finiteNumberOrUnavailable(row["quantity"]);
  if (!symbol) {
    return positionsUnavailable();
  }
  const type = stringOrUnavailable(row, "type").toLowerCase();
  if (type === "boxed") {
    return positionsUnavailable();
  }
  if (Math.abs(quantity) <= POSITION_QUANTITY_EPSILON) {
    return null;
  }
  if (
    (type !== "long" && type !== "short") ||
    (type === "long" && quantity < 0) ||
    (type === "short" && quantity > 0)
  ) {
    return positionsUnavailable();
  }
  const averagePrice = nonNegativeNumberOrUnavailable(row["average_buy_price"]);
  return { accountId, symbol, quantity, averagePrice };
}

function normalizeOptionHolding(
  accountId: string,
  row: Record<string, unknown>,
): RobinhoodOptionHolding | null {
  const optionId = stringOrUnavailable(row, "option_id");
  const chainId = stringOrUnavailable(row, "chain_id");
  const underlying = normalizeSymbol(stringOrUnavailable(row, "chain_symbol"));
  const type = stringOrUnavailable(row, "type").toLowerCase();
  if (!underlying || (type !== "long" && type !== "short")) {
    return positionsUnavailable();
  }
  const rawQuantity = finiteNumberOrUnavailable(row["quantity"]);
  if (Math.abs(rawQuantity) <= POSITION_QUANTITY_EPSILON) {
    return null;
  }
  const quantity =
    type === "short" ? -Math.abs(rawQuantity) : Math.abs(rawQuantity);
  const multiplier = positiveNumberOrUnavailable(row["trade_value_multiplier"]);
  const averagePrice =
    Math.abs(finiteNumberOrUnavailable(row["average_price"])) / multiplier;
  return {
    accountId,
    optionId,
    chainId,
    underlying,
    quantity,
    averagePrice,
    multiplier,
    expirationDate: dateOnlyOrUnavailable(row["expiration_date"]),
    openedAt: optionalDateOrUnavailable(row["opened_at"]),
  };
}

function assertUniqueHoldings(input: {
  equities: RobinhoodEquityHolding[];
  options: RobinhoodOptionHolding[];
}): void {
  const identities = [
    ...input.equities.map(
      (holding) => `${holding.accountId}:equity:${holding.symbol}`,
    ),
    ...input.options.map(
      (holding) => `${holding.accountId}:option:${holding.optionId}`,
    ),
  ];
  if (new Set(identities).size !== identities.length) {
    positionsUnavailable();
  }
}

function chooseEquityTradePrice(quote: Record<string, unknown>): {
  price: number;
  updatedAt: Date;
} {
  if (
    quote["has_traded"] !== true ||
    stringOrUnavailable(quote, "state") !== "active"
  ) {
    return positionsUnavailable();
  }
  const regular = {
    price: positiveNumberOrUnavailable(quote["last_trade_price"]),
    updatedAt: dateOrUnavailable(quote["venue_last_trade_time"]),
  };
  const nonRegularPrice = finiteNumberOrNull(quote["last_non_reg_trade_price"]);
  const nonRegularTime = quote["venue_last_non_reg_trade_time"];
  if (
    nonRegularPrice === null &&
    (nonRegularTime === null || nonRegularTime === undefined)
  ) {
    return regular;
  }
  if (nonRegularPrice === null || nonRegularPrice <= 0) {
    return positionsUnavailable();
  }
  const nonRegular = {
    price: nonRegularPrice,
    updatedAt: dateOrUnavailable(nonRegularTime),
  };
  return nonRegular.updatedAt.getTime() > regular.updatedAt.getTime()
    ? nonRegular
    : regular;
}

function normalizeEquityQuote(
  row: Record<string, unknown>,
): RobinhoodEquityQuote {
  const quote = recordOrUnavailable(row["quote"]);
  const symbol = normalizeSymbol(stringOrUnavailable(quote, "symbol"));
  if (!symbol) {
    return positionsUnavailable();
  }
  const selected = chooseEquityTradePrice(quote);
  const previousClose = finiteNumberOrNull(quote["adjusted_previous_close"]);
  return {
    symbol,
    price: selected.price,
    previousClose:
      previousClose !== null && previousClose > 0 ? previousClose : null,
    updatedAt: selected.updatedAt,
  };
}

async function readEquityQuotes(input: {
  appUserId: string;
  callTool: RobinhoodAccountPositionsToolFetcher;
  symbols: string[];
}): Promise<Map<string, RobinhoodEquityQuote>> {
  const quotes = new Map<string, RobinhoodEquityQuote>();
  await Promise.all(
    chunksOf(input.symbols, ROBINHOOD_QUOTE_BATCH_SIZE).map(async (symbols) => {
      const payload = await input.callTool({
        appUserId: input.appUserId,
        name: "get_equity_quotes",
        arguments: { symbols },
      });
      for (const row of payloadRows(payload, "results")) {
        const quote = normalizeEquityQuote(row);
        if (quotes.has(quote.symbol)) {
          positionsUnavailable();
        }
        quotes.set(quote.symbol, quote);
      }
    }),
  );
  if (input.symbols.some((symbol) => !quotes.has(symbol))) {
    positionsUnavailable();
  }
  return quotes;
}

function normalizeOptionInstrument(
  row: Record<string, unknown>,
): RobinhoodOptionInstrument {
  const id = stringOrUnavailable(row, "id");
  const underlying = normalizeSymbol(stringOrUnavailable(row, "chain_symbol"));
  const right = stringOrUnavailable(row, "type").toLowerCase();
  if (!underlying || (right !== "call" && right !== "put")) {
    return positionsUnavailable();
  }
  return {
    id,
    chainId: stringOrUnavailable(row, "chain_id"),
    underlying,
    expirationDate: dateOnlyOrUnavailable(row["expiration_date"]),
    strike: positiveNumberOrUnavailable(row["strike_price"]),
    right,
  };
}

async function readOptionInstruments(input: {
  appUserId: string;
  callTool: RobinhoodAccountPositionsToolFetcher;
  optionIds: string[];
}): Promise<Map<string, RobinhoodOptionInstrument>> {
  const instruments = new Map<string, RobinhoodOptionInstrument>();
  await Promise.all(
    chunksOf(input.optionIds, ROBINHOOD_QUOTE_BATCH_SIZE).map(
      async (optionIds) => {
        let unresolved = optionIds;
        for (const state of [null, "expired", "inactive"] as const) {
          if (!unresolved.length) break;
          const requested = new Set(unresolved);
          const rows = await readPaginatedRows({
            appUserId: input.appUserId,
            callTool: input.callTool,
            toolName: "get_option_instruments",
            arguments: {
              ids: unresolved.join(","),
              ...(state ? { state } : {}),
            },
            rowKey: "instruments",
          });
          for (const row of rows) {
            const instrument = normalizeOptionInstrument(row);
            if (
              !requested.has(instrument.id) ||
              instruments.has(instrument.id)
            ) {
              positionsUnavailable();
            }
            instruments.set(instrument.id, instrument);
          }
          unresolved = unresolved.filter(
            (optionId) => !instruments.has(optionId),
          );
        }
      },
    ),
  );
  if (input.optionIds.some((optionId) => !instruments.has(optionId))) {
    positionsUnavailable();
  }
  return instruments;
}

function normalizeOptionQuote(
  row: Record<string, unknown>,
): RobinhoodOptionQuote {
  const quote = recordOrUnavailable(row["quote"]);
  const optionId = stringOrUnavailable(quote, "instrument_id");
  const mark = nonNegativeNumberOrUnavailable(quote["mark_price"]);
  const adjustedMark = nonNegativeNumberOrUnavailable(
    quote["adjusted_mark_price"],
  );
  // The shared position contract has one mark for both valuation and P&L. A
  // corporate-action adjustment needs two; reject it instead of mixing bases.
  if (Math.abs(mark - adjustedMark) > POSITION_QUANTITY_EPSILON) {
    return positionsUnavailable();
  }
  const close = row["close"];
  let officialClose: number | null = null;
  if (close !== null && close !== undefined) {
    const closeRecord = recordOrUnavailable(close);
    if (stringOrUnavailable(closeRecord, "instrument_id") !== optionId) {
      return positionsUnavailable();
    }
    const interpolated = closeRecord["interpolated"];
    if (
      interpolated !== null &&
      interpolated !== true &&
      interpolated !== false
    ) {
      return positionsUnavailable();
    }
    if (interpolated === false) {
      officialClose = finiteNumberOrNull(closeRecord["price"]);
    }
  }
  const quoteClose = finiteNumberOrNull(quote["previous_close_price"]);
  return {
    optionId,
    mark,
    previousClose:
      officialClose !== null && officialClose > 0 ? officialClose : quoteClose,
    updatedAt: dateOrUnavailable(quote["updated_at"]),
    impliedVolatility: finiteNumberOrNull(quote["implied_volatility"]),
    delta: finiteNumberOrNull(quote["delta"]),
    gamma: finiteNumberOrNull(quote["gamma"]),
    theta: finiteNumberOrNull(quote["theta"]),
    vega: finiteNumberOrNull(quote["vega"]),
    openInterest: finiteNumberOrNull(quote["open_interest"]),
    volume: finiteNumberOrNull(quote["volume"]),
  };
}

async function readOptionQuotes(input: {
  appUserId: string;
  callTool: RobinhoodAccountPositionsToolFetcher;
  optionIds: string[];
}): Promise<Map<string, RobinhoodOptionQuote>> {
  const quotes = new Map<string, RobinhoodOptionQuote>();
  await Promise.all(
    chunksOf(input.optionIds, ROBINHOOD_QUOTE_BATCH_SIZE).map(
      async (optionIds) => {
        const payload = await input.callTool({
          appUserId: input.appUserId,
          name: "get_option_quotes",
          arguments: { instrument_ids: optionIds },
        });
        for (const row of payloadRows(payload, "results")) {
          const quote = normalizeOptionQuote(row);
          if (quotes.has(quote.optionId)) {
            positionsUnavailable();
          }
          quotes.set(quote.optionId, quote);
        }
      },
    ),
  );
  if (input.optionIds.some((optionId) => !quotes.has(optionId))) {
    positionsUnavailable();
  }
  return quotes;
}

function positionQuote(input: {
  mark: number;
  previousClose: number | null;
  updatedAt: Date;
  providerContractId: string | null;
  impliedVolatility?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  openInterest?: number | null;
  volume?: number | null;
}): PositionQuoteSnapshot {
  const dayChange =
    input.previousClose !== null && input.previousClose > 0
      ? input.mark - input.previousClose
      : null;
  return {
    providerContractId: input.providerContractId,
    // This is a provider valuation fallback. Leaving the book empty lets the
    // shared live quote hydrate both the row math and displayed quote when one
    // is available, so two quote sources cannot disagree on the same row.
    bid: null,
    ask: null,
    mid: null,
    last: input.mark,
    mark: input.mark,
    spread: null,
    spreadPercent: null,
    bidSize: null,
    askSize: null,
    updatedAt: input.updatedAt,
    dataUpdatedAt: input.updatedAt,
    freshness: null,
    marketDataMode: null,
    source: "unknown",
    dayChange,
    dayChangePercent:
      dayChange !== null && input.previousClose
        ? (dayChange / input.previousClose) * 100
        : null,
    impliedVolatility: input.impliedVolatility ?? null,
    delta: input.delta ?? null,
    gamma: input.gamma ?? null,
    theta: input.theta ?? null,
    vega: input.vega ?? null,
    openInterest: input.openInterest ?? null,
    volume: input.volume ?? null,
  };
}

function pnlPercent(pnl: number, basis: number): number {
  return basis > POSITION_QUANTITY_EPSILON ? (pnl / basis) * 100 : 0;
}

function stableFinancialNumber(value: number): number {
  return Number(value.toFixed(12));
}

function equityPosition(
  holding: RobinhoodEquityHolding,
  quote: RobinhoodEquityQuote,
): BrokerPositionSnapshot {
  const marketValue = stableFinancialNumber(quote.price * holding.quantity);
  const costBasis = stableFinancialNumber(
    Math.abs(holding.averagePrice * holding.quantity),
  );
  const unrealizedPnl = stableFinancialNumber(
    (quote.price - holding.averagePrice) * holding.quantity,
  );
  return {
    id: `robinhood:${holding.accountId}:equity:${holding.symbol}`,
    accountId: holding.accountId,
    symbol: holding.symbol,
    assetClass: "equity",
    providerSecurityType: "stock",
    quantity: holding.quantity,
    averagePrice: holding.averagePrice,
    marketPrice: quote.price,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent: pnlPercent(unrealizedPnl, costBasis),
    optionContract: null,
    openedAt: null,
    openedAtSource: "unknown",
    quote: positionQuote({
      mark: quote.price,
      previousClose: quote.previousClose,
      updatedAt: quote.updatedAt,
      providerContractId: null,
    }),
  };
}

function optionPosition(
  holding: RobinhoodOptionHolding,
  instrument: RobinhoodOptionInstrument,
  quote: RobinhoodOptionQuote,
): BrokerPositionSnapshot {
  if (
    holding.chainId !== instrument.chainId ||
    holding.underlying !== instrument.underlying ||
    holding.expirationDate.getTime() !== instrument.expirationDate.getTime()
  ) {
    return positionsUnavailable();
  }
  const marketValue = stableFinancialNumber(
    quote.mark * holding.multiplier * holding.quantity,
  );
  const costBasis = stableFinancialNumber(
    Math.abs(holding.averagePrice * holding.multiplier * holding.quantity),
  );
  const unrealizedPnl = stableFinancialNumber(
    (quote.mark - holding.averagePrice) * holding.multiplier * holding.quantity,
  );
  return {
    id: `robinhood:${holding.accountId}:option:${holding.optionId}`,
    accountId: holding.accountId,
    symbol: holding.underlying,
    assetClass: "option",
    providerSecurityType: "robinhood_option",
    quantity: holding.quantity,
    averagePrice: holding.averagePrice,
    marketPrice: quote.mark,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent: pnlPercent(unrealizedPnl, costBasis),
    optionContract: {
      // Robinhood exposes a UUID, not a provable OCC/OPRA identity. Keeping the
      // provider id prevents an adjusted contract from aliasing a standard one.
      ticker: holding.optionId,
      underlying: instrument.underlying,
      expirationDate: instrument.expirationDate,
      strike: instrument.strike,
      right: instrument.right,
      multiplier: holding.multiplier,
      sharesPerContract: holding.multiplier,
      providerContractId: holding.optionId,
      brokerContractId: holding.optionId,
    },
    openedAt: holding.openedAt,
    openedAtSource: holding.openedAt ? "broker" : "unknown",
    quote: positionQuote({
      mark: quote.mark,
      previousClose: quote.previousClose,
      updatedAt: quote.updatedAt,
      providerContractId: holding.optionId,
      impliedVolatility: quote.impliedVolatility,
      delta: quote.delta,
      gamma: quote.gamma,
      theta: quote.theta,
      vega: quote.vega,
      openInterest: quote.openInterest,
      volume: quote.volume,
    }),
  };
}

async function defaultToolFetcher(
  appUserId: string,
  options: ReadRobinhoodAccountPositionsOptions,
): Promise<RobinhoodAccountPositionsToolFetcher> {
  const accessToken = await getRobinhoodAccessToken({
    appUserId,
    env: options.env,
    fetchImpl: options.fetchImpl,
    encryptionKey: options.encryptionKey,
    now: options.now,
  });
  const session = new RobinhoodMcpSession({
    accessToken,
    fetchImpl: options.fetchImpl,
    mcpUrl: options.mcpUrl,
  });
  await session.initialize();
  return (request) => {
    if (request.appUserId !== appUserId) {
      return positionsUnavailable();
    }
    return session.callTool({
      name: request.name,
      arguments: request.arguments,
    });
  };
}

async function cachedDefaultToolFetcher(
  appUserId: string,
  options: ReadRobinhoodAccountPositionsOptions,
): Promise<RobinhoodAccountPositionsToolFetcher> {
  const createToolFetcher = options.createToolFetcher ?? defaultToolFetcher;
  const usesDefaultRuntimeOptions =
    options.createToolFetcher !== undefined ||
    (!options.env &&
      !options.fetchImpl &&
      !options.encryptionKey &&
      !options.mcpUrl &&
      !options.now);
  if (!usesDefaultRuntimeOptions) {
    return createToolFetcher(appUserId, options);
  }

  const now = Date.now();
  for (const [cachedUserId, entry] of robinhoodPositionSessions) {
    if (entry.expiresAt <= now) {
      robinhoodPositionSessions.delete(cachedUserId);
    }
  }

  let entry = robinhoodPositionSessions.get(appUserId);
  if (!entry) {
    if (
      robinhoodPositionSessions.size >=
      ROBINHOOD_POSITION_SESSION_CACHE_MAX_ENTRIES
    ) {
      return createToolFetcher(appUserId, options);
    }
    entry = {
      expiresAt: now + ROBINHOOD_POSITION_SESSION_CACHE_TTL_MS,
      promise: Promise.resolve().then(() =>
        createToolFetcher(appUserId, options),
      ),
    };
    robinhoodPositionSessions.set(appUserId, entry);
    void entry.promise.catch(() => {
      if (robinhoodPositionSessions.get(appUserId) === entry) {
        robinhoodPositionSessions.delete(appUserId);
      }
    });
  }

  const callTool = await entry.promise;
  return async (request) => {
    try {
      return await callTool(request);
    } catch (error) {
      if (robinhoodPositionSessions.get(appUserId) === entry) {
        robinhoodPositionSessions.delete(appUserId);
      }
      throw error;
    }
  };
}

export async function readRobinhoodAccountPositions(
  input: {
    appUserId: string;
    accounts: readonly RobinhoodAccountPositionIdentity[];
  },
  options: ReadRobinhoodAccountPositionsOptions = {},
): Promise<BrokerPositionSnapshot[]> {
  if (!input.appUserId.trim()) {
    return positionsUnavailable();
  }
  if (input.accounts.length === 0) {
    return [];
  }
  if (
    input.accounts.some(
      (account) => !account.accountId.trim() || !account.accountNumber.trim(),
    )
  ) {
    return positionsUnavailable();
  }

  const callTool =
    options.callTool ??
    (await timeRobinhoodPositionsStage(options, "session", () =>
      cachedDefaultToolFetcher(input.appUserId, options),
    ));
  const accountRows = await timeRobinhoodPositionsStage(
    options,
    "holdings",
    () =>
      Promise.all(
        input.accounts.map(async (account) => {
          const [equityRows, optionRows] = await Promise.all([
            readPaginatedRows({
              appUserId: input.appUserId,
              callTool,
              toolName: "get_equity_positions",
              arguments: { account_number: account.accountNumber },
              rowKey: "positions",
            }),
            readPaginatedRows({
              appUserId: input.appUserId,
              callTool,
              toolName: "get_option_positions",
              arguments: {
                account_number: account.accountNumber,
                nonzero: true,
              },
              rowKey: "positions",
            }),
          ]);
          return {
            equities: equityRows.flatMap((row) => {
              const holding = normalizeEquityHolding(account.accountId, row);
              return holding ? [holding] : [];
            }),
            options: optionRows.flatMap((row) => {
              const holding = normalizeOptionHolding(account.accountId, row);
              return holding ? [holding] : [];
            }),
          };
        }),
      ),
  );
  const equities = accountRows.flatMap((rows) => rows.equities);
  const optionsPositions = accountRows.flatMap((rows) => rows.options);
  assertUniqueHoldings({ equities, options: optionsPositions });

  const equitySymbols = Array.from(
    new Set(equities.map((holding) => holding.symbol)),
  );
  const optionIds = Array.from(
    new Set(optionsPositions.map((holding) => holding.optionId)),
  );
  const [equityQuotes, optionInstruments, optionQuotes] =
    await timeRobinhoodPositionsStage(options, "market_data", () =>
      Promise.all([
        readEquityQuotes({
          appUserId: input.appUserId,
          callTool,
          symbols: equitySymbols,
        }),
        readOptionInstruments({
          appUserId: input.appUserId,
          callTool,
          optionIds,
        }),
        readOptionQuotes({
          appUserId: input.appUserId,
          callTool,
          optionIds,
        }),
      ]),
    );

  return [
    ...equities.map((holding) =>
      equityPosition(
        holding,
        equityQuotes.get(holding.symbol) ?? positionsUnavailable(),
      ),
    ),
    ...optionsPositions.map((holding) =>
      optionPosition(
        holding,
        optionInstruments.get(holding.optionId) ?? positionsUnavailable(),
        optionQuotes.get(holding.optionId) ?? positionsUnavailable(),
      ),
    ),
  ];
}

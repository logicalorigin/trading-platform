import { randomUUID } from "node:crypto";
import { HttpError } from "../../lib/errors";
import { fetchJson, withSearchParams, type QueryValue } from "../../lib/http";
import type {
  IbkrRuntimeConfig,
  IbkrTransport,
  RuntimeMode,
} from "../../lib/runtime";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  compact,
  findCaseInsensitiveValue,
  firstDefined,
  getNumberPath,
  getStringPath,
  normalizeSymbol,
  toDate,
  toIbkrMonthCode,
} from "../../lib/values";

type AssetClass = "equity" | "option";
type OptionRight = "call" | "put";
type OrderSide = "buy" | "sell";
type OrderStatus =
  | "pending_submit"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";
type OrderType = "market" | "limit" | "stop" | "stop_limit";
type TimeInForce = "day" | "gtc" | "ioc" | "fok";
export type HistoryBarTimeframe = "1m" | "5m" | "15m" | "1h" | "1d";
export type HistoryDataSource = "trades" | "midpoint" | "bid_ask";
type HeaderInput = ConstructorParameters<typeof Headers>[0];
export type OptionContractSnapshot = {
  ticker: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: OptionRight;
  multiplier: number;
  sharesPerContract: number;
  providerContractId?: string | null;
};

export type BrokerAccountSnapshot = {
  id: string;
  providerAccountId: string;
  provider: "ibkr";
  mode: RuntimeMode;
  displayName: string;
  currency: string;
  buyingPower: number;
  cash: number;
  netLiquidation: number;
  updatedAt: Date;
};

export type BrokerPositionSnapshot = {
  id: string;
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  optionContract: (OptionContractSnapshot & { providerContractId: string | null }) | null;
};

export type BrokerOrderSnapshot = {
  id: string;
  accountId: string;
  mode: RuntimeMode;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  placedAt: Date;
  updatedAt: Date;
  optionContract: BrokerPositionSnapshot["optionContract"];
};

export type PlaceOrderInput = {
  accountId: string;
  mode: RuntimeMode;
  confirm?: boolean | null;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  timeInForce: TimeInForce;
  optionContract: OptionContractSnapshot | null;
};

export type QuoteSnapshot = {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  change: number;
  changePercent: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  updatedAt: Date;
  providerContractId: string | null;
  transport: IbkrTransport;
  delayed: boolean;
};

export type BrokerBarSnapshot = {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  providerContractId: string | null;
  outsideRth: boolean;
  partial: boolean;
  transport: IbkrTransport;
  delayed: boolean;
};

export type ResolvedIbkrContract = {
  conid: number;
  symbol: string;
  secType: string;
  listingExchange: string;
  providerContractId: string;
};

export type IbkrNewsArticle = {
  id: string;
  title: string;
  description: string | null;
  articleUrl: string;
  imageUrl: string | null;
  author: string | null;
  publishedAt: Date;
  tickers: string[];
  publisher: {
    name: string;
    homepageUrl: string | null;
    logoUrl: string | null;
  };
  sentiment: string | null;
  sentimentReasoning: string | null;
};

export type IbkrUniverseTicker = {
  ticker: string;
  name: string;
  market: "stocks" | "indices" | "fx" | "crypto" | "otc";
  locale: string | null;
  type: string | null;
  active: boolean;
  primaryExchange: string | null;
  currencyName: string | null;
  cik: string | null;
  compositeFigi: string | null;
  shareClassFigi: string | null;
  lastUpdatedAt: Date | null;
  provider?: "ibkr" | "polygon" | null;
  providerContractId?: string | null;
};

export type OptionChainContract = {
  contract: {
    ticker: string;
    underlying: string;
    expirationDate: Date;
    strike: number;
    right: OptionRight;
    multiplier: number;
    sharesPerContract: number;
    providerContractId: string | null;
  };
  bid: number;
  ask: number;
  last: number;
  mark: number;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  openInterest: number;
  volume: number;
  updatedAt: Date;
};

export type SessionStatusSnapshot = {
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
  selectedAccountId: string | null;
  accounts: string[];
  updatedAt: Date;
  raw: Record<string, unknown> | null;
};

export type OrderPreviewSnapshot = {
  accountId: string;
  mode: RuntimeMode;
  symbol: string;
  assetClass: AssetClass;
  resolvedContractId: number;
  orderPayload: Record<string, unknown>;
  optionContract: BrokerPositionSnapshot["optionContract"];
};

export type CancelOrderSnapshot = {
  orderId: string;
  accountId: string | null;
  message: string;
  submittedAt: Date;
};

export type ReplaceOrderSnapshot = BrokerOrderSnapshot;

export type BrokerExecutionSnapshot = {
  id: string;
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  quantity: number;
  price: number;
  netAmount: number | null;
  exchange: string | null;
  executedAt: Date;
  orderDescription: string | null;
  contractDescription: string | null;
  providerContractId: string | null;
  orderRef: string | null;
};

export type BrokerMarketDepthLevel = {
  row: number;
  price: number;
  bidSize: number | null;
  askSize: number | null;
  totalSize: number | null;
  isLastTrade: boolean;
};

export type BrokerMarketDepthSnapshot = {
  accountId: string | null;
  symbol: string;
  assetClass: AssetClass;
  providerContractId: string | null;
  exchange: string | null;
  updatedAt: Date;
  levels: BrokerMarketDepthLevel[];
};

const IBKR_TO_INTERNAL_TIF: Record<string, TimeInForce> = {
  DAY: "day",
  GTC: "gtc",
  IOC: "ioc",
  FOK: "fok",
};

const INTERNAL_TO_IBKR_TIF: Record<TimeInForce, string> = {
  day: "DAY",
  gtc: "GTC",
  ioc: "IOC",
  fok: "FOK",
};

const INTERNAL_TO_IBKR_ORDER_TYPE: Record<OrderType, string> = {
  market: "MKT",
  limit: "LMT",
  stop: "STP",
  stop_limit: "STP LMT",
};

export const SNAPSHOT_FIELDS = [
  "31", // last price
  "55", // symbol
  "70", // high
  "71", // low
  "82", // change price
  "83", // change percent
  "84", // bid price
  "85", // ask size
  "86", // ask price
  "87", // volume (formatted)
  "87_raw", // volume (raw integer)
  "88", // bid size
  "7059", // last size
  "7295", // open
  "7296", // prior close
  "7741", // prior day close (alternate)
  "7762", // days volume
  "7638", // option open interest
  "7633", // strike-specific option implied volatility
  "7283", // option implied volatility
  "7308", // option delta
  "7309", // option gamma
  "7310", // option theta
  "7311", // option vega
] as const;
export const STREAMING_SNAPSHOT_FIELDS: readonly string[] = SNAPSHOT_FIELDS.filter(
  (field) => field !== "87_raw",
);

const DEFAULT_HISTORY_BAR_LIMIT = 200;
const HISTORY_RESPONSE_MAX_POINTS = 1_000;
const SNAPSHOT_BATCH_SIZE = 30;
const SECURITY_SEARCH_CACHE_TTL_MS = 60_000;
const OPTION_CHAIN_METADATA_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_OPTION_CHAIN_EXPIRATIONS = 1;
const DEFAULT_OPTION_CHAIN_STRIKES_AROUND_MONEY = 6;
const HISTORY_SOURCE_TO_IBKR: Record<HistoryDataSource, string> = {
  trades: "Trades",
  midpoint: "Midpoint",
  bid_ask: "Bid_Ask",
};

const HISTORY_TIMEFRAME_TO_BAR: Record<HistoryBarTimeframe, string> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "1d": "1d",
};

const HISTORY_TIMEFRAME_STEP_MS: Record<HistoryBarTimeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

function chunk<T>(values: T[], size: number): T[][] {
  const normalizedSize = Math.max(1, size);
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += normalizedSize) {
    chunks.push(values.slice(index, index + normalizedSize));
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortError(signal?: AbortSignal): HttpError {
  return new HttpError(499, "IBKR request was aborted.", {
    code: "ibkr_request_aborted",
    cause: signal?.reason,
    expose: false,
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function readCachedValue<T>(
  cache: Map<string, { value: T; expiresAt: number }>,
  key: string,
): T | null {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function writeCachedValue<T>(
  cache: Map<string, { value: T; expiresAt: number }>,
  key: string,
  value: T,
  ttlMs: number,
): T {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

function parseIbkrTradeDateTime(value: unknown): Date | null {
  const direct = toDate(value);
  if (direct) {
    return direct;
  }

  const text = asString(value);
  if (!text) {
    return null;
  }

  const match = text.match(
    /^(\d{4})(\d{2})(\d{2})-(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatHistoryStartTime(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}:${minutes}:${seconds}`;
}

function resolveHistoryStepMs(timeframe: HistoryBarTimeframe): number {
  return HISTORY_TIMEFRAME_STEP_MS[timeframe];
}

function normalizeHistoryDataSource(source: HistoryDataSource | null | undefined): HistoryDataSource {
  return source ?? "trades";
}

function buildHistoryPeriod(timeframe: HistoryBarTimeframe, barCount: number): string {
  const desiredBars = Math.max(1, Math.min(HISTORY_RESPONSE_MAX_POINTS, Math.ceil(barCount)));
  const totalMs = desiredBars * resolveHistoryStepMs(timeframe);
  const minuteMs = 60_000;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;

  const totalMinutes = Math.ceil(totalMs / minuteMs);
  if (totalMinutes <= 30) {
    return `${Math.max(1, totalMinutes)}min`;
  }

  const totalHours = Math.ceil(totalMs / hourMs);
  if (totalHours <= 8) {
    return `${Math.max(1, totalHours)}h`;
  }

  const totalDays = Math.ceil(totalMs / dayMs);
  if (totalDays <= 1_000) {
    return `${Math.max(1, totalDays)}d`;
  }

  const totalWeeks = Math.ceil(totalMs / weekMs);
  if (totalWeeks <= 792) {
    return `${Math.max(1, totalWeeks)}w`;
  }

  const totalMonths = Math.ceil(totalMs / monthMs);
  if (totalMonths <= 182) {
    return `${Math.max(1, totalMonths)}m`;
  }

  const totalYears = Math.ceil(totalMs / yearMs);
  return `${Math.max(1, totalYears)}y`;
}

function resolveRequestedHistoryBars(input: {
  timeframe: HistoryBarTimeframe;
  limit?: number;
  from?: Date;
  to?: Date;
}): number {
  const requestedLimit = Math.max(1, input.limit ?? DEFAULT_HISTORY_BAR_LIMIT);
  if (!input.from || !input.to) {
    return requestedLimit;
  }

  const stepMs = resolveHistoryStepMs(input.timeframe);
  const durationMs = Math.max(0, input.to.getTime() - input.from.getTime());
  return Math.max(requestedLimit, Math.ceil(durationMs / stepMs) + 1);
}

function normalizeMetricKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function readMetricValue(metric: unknown): number | null {
  if (metric === null || metric === undefined) {
    return null;
  }

  const direct = asNumber(metric);
  if (direct !== null) {
    return direct;
  }

  const record = asRecord(metric);
  if (!record) {
    return null;
  }

  return firstDefined(
    asNumber(record["amount"]),
    asNumber(record["value"]),
    asNumber(record["current"]),
    asNumber(record["rawValue"]),
  );
}

function findMetric(source: unknown, candidates: string[]): number | null {
  const record = asRecord(source);
  if (!record) {
    return null;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeMetricKey(candidate);
    const entry = Object.entries(record).find(
      ([key]) => normalizeMetricKey(key) === normalizedCandidate,
    );

    if (entry) {
      const numeric = readMetricValue(entry[1]);
      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

function normalizeAssetClass(value: string | null): AssetClass | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "OPT") {
    return "option";
  }

  if (normalized === "STK" || normalized === "ETF") {
    return "equity";
  }

  return null;
}

function normalizeOptionRight(value: string | null): OptionRight | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "call" || normalized === "c") {
    return "call";
  }

  if (normalized === "put" || normalized === "p") {
    return "put";
  }

  return null;
}

function normalizeOrderSide(value: string | null): OrderSide {
  return value?.trim().toUpperCase() === "SELL" ? "sell" : "buy";
}

function normalizeOrderType(value: string | null): OrderType {
  const normalized = value?.trim().toUpperCase() ?? "MKT";

  if (normalized === "LMT" || normalized === "LIMIT") {
    return "limit";
  }

  if (normalized === "STP" || normalized === "STOP") {
    return "stop";
  }

  if (normalized === "STP LMT" || normalized === "STOP_LIMIT") {
    return "stop_limit";
  }

  return "market";
}

function normalizeTimeInForce(value: string | null): TimeInForce {
  const normalized = value?.trim().toUpperCase() ?? "DAY";
  return IBKR_TO_INTERNAL_TIF[normalized] ?? "day";
}

function normalizeOrderStatus(
  value: string | null,
  filledQuantity: number,
  remainingQuantity: number,
): OrderStatus {
  const normalized = normalizeMetricKey(value ?? "");

  if (filledQuantity > 0 && remainingQuantity > 0) {
    return "partially_filled";
  }

  if (normalized.includes("pendingsubmit")) {
    return "pending_submit";
  }

  if (normalized.includes("accepted") || normalized.includes("working")) {
    return "accepted";
  }

  if (normalized.includes("submitted") || normalized.includes("presubmitted")) {
    return "submitted";
  }

  if (normalized.includes("filled")) {
    return "filled";
  }

  if (normalized.includes("cancel")) {
    return "canceled";
  }

  if (normalized.includes("expire")) {
    return "expired";
  }

  if (normalized.includes("reject") || normalized.includes("inactive")) {
    return "rejected";
  }

  return "submitted";
}

function parseOptionDetails(record: Record<string, unknown>): BrokerPositionSnapshot["optionContract"] {
  const providerContractId = asString(record["conid"]);
  const underlying =
    firstDefined(
      asString(record["ticker"]),
      asString(record["description1"]),
      asString(record["symbol"]),
    ) ?? null;
  const expirationDate = toDate(
    firstDefined(record["expiry"], record["maturityDate"]),
  );
  const strike =
    firstDefined(asNumber(record["strike"]), asNumber(record["strikePrice"])) ?? null;
  const right = normalizeOptionRight(
    firstDefined(asString(record["putOrCall"]), asString(record["right"])),
  );
  const multiplier = asNumber(record["multiplier"]) ?? 100;

  if (!underlying || !expirationDate || strike === null || !right) {
    return null;
  }

  const description = asString(record["contractDesc"]);
  const bracketMatch = description?.match(/\[([A-Z0-9 ]+\d{6}[CP]\d+)\s+\d+\]$/);
  const ticker =
    bracketMatch?.[1]?.replace(/\s+/g, "") ??
    asString(record["localSymbol"]) ??
    `${underlying}-${expirationDate.toISOString().slice(0, 10)}-${right}-${strike}`;

  return {
    ticker,
    underlying: normalizeSymbol(underlying),
    expirationDate,
    strike,
    right,
    multiplier,
    sharesPerContract: multiplier,
    providerContractId,
  };
}

function normalizeIvFromPercent(value: unknown): number | null {
  const numeric =
    typeof value === "string" && value.trim().endsWith("%")
      ? asNumber(value.trim().slice(0, -1))
      : asNumber(value);

  if (numeric === null) {
    return null;
  }

  return numeric > 2 ? numeric / 100 : numeric;
}

function normalizeEmpiricalOptionIvFallback(value: unknown): number | null {
  const normalized = normalizeIvFromPercent(value);
  if (normalized === null) {
    return null;
  }

  // Field 83 is documented as change percent in Client Portal snapshots, but
  // has been observed carrying option IV when documented IV fields are empty.
  // Keep this guarded so equity change % cannot leak into option IV display.
  return normalized > 0 && normalized <= 10 ? normalized : null;
}

export function parseSnapshotQuote(
  symbol: string,
  providerContractId: string | null,
  payload: Record<string, unknown>,
  assetClass: AssetClass | null = null,
): QuoteSnapshot {
  const delayed =
    [
      payload["31"],
      payload["84"],
      payload["86"],
      payload["70"],
      payload["71"],
      payload["7295"],
      payload["7296"],
    ].some((value) => typeof value === "string" && value.trim().startsWith("@"));
  const lastRaw = firstDefined(
    asNumber(payload["31"]),
    asNumber(payload["last"]),
    asNumber(payload["price"]),
  );
  const bidRaw = firstDefined(
    asNumber(payload["84"]),
    asNumber(payload["bid"]),
  );
  const askRaw = firstDefined(
    asNumber(payload["86"]),
    asNumber(payload["ask"]),
  );
  // IBKR snapshots frequently omit the last-traded price (esp. on paper
  // accounts or for tickers without a recent print in the snapshot window).
  // Fall back to the bid/ask midpoint, then ask, then bid so the watchlist
  // surfaces a sensible "last" instead of 0.
  const midpoint =
    bidRaw !== null && askRaw !== null && bidRaw > 0 && askRaw > 0
      ? (bidRaw + askRaw) / 2
      : null;
  const price =
    (lastRaw !== null && lastRaw > 0 ? lastRaw : null) ??
    midpoint ??
    (askRaw !== null && askRaw > 0 ? askRaw : null) ??
    (bidRaw !== null && bidRaw > 0 ? bidRaw : null) ??
    0;
  const bid = bidRaw ?? 0;
  const ask = askRaw ?? bid;
  const bidSize =
    firstDefined(
      asNumber(payload["88"]),
      asNumber(payload["bidSize"]),
    ) ?? 0;
  const askSize =
    firstDefined(
      asNumber(payload["85"]),
      asNumber(payload["askSize"]),
      asNumber(payload["7059"]),
    ) ?? 0;
  const prevClose =
    firstDefined(
      asNumber(payload["7296"]),
      asNumber(payload["7741"]),
      asNumber(payload["prevClose"]),
      asNumber(payload["close"]),
    );
  const open =
    firstDefined(
      asNumber(payload["7295"]),
      asNumber(payload["open"]),
    );
  const high =
    firstDefined(
      asNumber(payload["70"]),
      asNumber(payload["high"]),
    );
  const low =
    firstDefined(
      asNumber(payload["71"]),
      asNumber(payload["low"]),
    );
  const volume =
    firstDefined(
      asNumber(payload["87_raw"]),
      asNumber(payload["7762"]),
      asNumber(payload["87"]),
      asNumber(payload["volume"]),
    );
  const openInterest =
    firstDefined(
      asNumber(payload["7638"]),
      asNumber(payload["openInterest"]),
    );
  const impliedVolatility = firstDefined(
    normalizeIvFromPercent(payload["7633"]),
    normalizeIvFromPercent(payload["7283"]),
    normalizeIvFromPercent(payload["impliedVolatility"]),
    assetClass === "option"
      ? normalizeEmpiricalOptionIvFallback(payload["83"])
      : null,
  );
  const delta = firstDefined(
    asNumber(payload["7308"]),
    asNumber(payload["delta"]),
  );
  const gamma = firstDefined(
    asNumber(payload["7309"]),
    asNumber(payload["gamma"]),
  );
  const theta = firstDefined(
    asNumber(payload["7310"]),
    asNumber(payload["theta"]),
  );
  const vega = firstDefined(
    asNumber(payload["7311"]),
    asNumber(payload["vega"]),
  );
  // Prefer IBKR-supplied change fields when present; fall back to
  // computing from price - prevClose. This handles the common case where
  // last is 0 but IBKR still publishes a daily change against prior close.
  const ibkrChange = firstDefined(
    asNumber(payload["82"]),
    asNumber(payload["change"]),
  );
  const ibkrChangePct =
    assetClass === "option"
      ? asNumber(payload["changePercent"])
      : firstDefined(
          asNumber(payload["83"]),
          asNumber(payload["changePercent"]),
        );
  const change =
    ibkrChange ?? (prevClose !== null && price > 0 ? price - prevClose : 0);
  const changePercent =
    ibkrChangePct ??
    (prevClose ? (change / prevClose) * 100 : 0);
  const updatedAt =
    toDate(payload["_updated"]) ??
    toDate(payload["updatedAt"]) ??
    new Date();

  return {
    symbol,
    price,
    bid,
    ask,
    bidSize,
    askSize,
    change,
    changePercent,
    open,
    high,
    low,
    prevClose,
    volume,
    openInterest,
    impliedVolatility,
    delta,
    gamma,
    theta,
    vega,
    updatedAt,
    providerContractId,
    transport: "client_portal",
    delayed,
  };
}

function parseHistoricalBars(
  payload: unknown,
  {
    providerContractId,
    outsideRth,
  }: {
    providerContractId: string;
    outsideRth: boolean;
  },
): BrokerBarSnapshot[] {
  const record = asRecord(payload);
  const rawBars = asArray(record?.["data"]);

  return compact(
    rawBars.map((rawBar) => {
      const bar = asRecord(rawBar);
      if (!bar) {
        return null;
      }

      const timestamp = toDate(bar["t"] ?? bar["timestamp"]);
      const open = asNumber(bar["o"] ?? bar["open"]);
      const high = asNumber(bar["h"] ?? bar["high"]);
      const low = asNumber(bar["l"] ?? bar["low"]);
      const close = asNumber(bar["c"] ?? bar["close"]);
      const volume = asNumber(bar["v"] ?? bar["volume"]);

      if (
        !timestamp ||
        open === null ||
        high === null ||
        low === null ||
        close === null ||
        volume === null
      ) {
        return null;
      }

      return {
        timestamp,
        open,
        high,
        low,
        close,
        volume,
        source: "ibkr-history",
        providerContractId,
        outsideRth,
        partial: false,
        transport: "client_portal",
        delayed: false,
      } satisfies BrokerBarSnapshot;
    }),
  ).sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
}

function toOptionChainContract(
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
  quote: QuoteSnapshot | null,
): OptionChainContract {
  const bid = quote?.bid ?? 0;
  const ask = quote?.ask ?? bid;
  const last = quote?.price ?? 0;
  const mark =
    bid > 0 && ask > 0
      ? (bid + ask) / 2
      : last;

  return {
    contract: {
      ticker: optionContract.ticker,
      underlying: optionContract.underlying,
      expirationDate: optionContract.expirationDate,
      strike: optionContract.strike,
      right: optionContract.right,
      multiplier: optionContract.multiplier,
      sharesPerContract: optionContract.sharesPerContract,
      providerContractId: optionContract.providerContractId,
    },
    bid,
    ask,
    last,
    mark,
    impliedVolatility: quote?.impliedVolatility ?? null,
    delta: quote?.delta ?? null,
    gamma: quote?.gamma ?? null,
    theta: quote?.theta ?? null,
    vega: quote?.vega ?? null,
    openInterest: quote?.openInterest ?? 0,
    volume: quote?.volume ?? 0,
    updatedAt: quote?.updatedAt ?? new Date(),
  };
}

export class IbkrClient {
  private readonly securitySearchCache = new Map<
    string,
    { value: Record<string, unknown>[]; expiresAt: number }
  >();
  private readonly optionStrikesCache = new Map<
    string,
    { value: number[]; expiresAt: number }
  >();
  private readonly optionInfoCache = new Map<
    string,
    { value: Record<string, unknown>[]; expiresAt: number }
  >();
  private readonly historyMaxConcurrency = Math.max(
    1,
    Number(process.env["IBKR_HISTORY_MAX_CONCURRENCY"] ?? "1"),
  );
  private readonly optionChainMaxConcurrency = Math.max(
    1,
    Number(process.env["IBKR_OPTION_CHAIN_MAX_CONCURRENCY"] ?? "1"),
  );
  private readonly requestsPerSecond = Math.max(
    1,
    Number(process.env["IBKR_REQUESTS_PER_SECOND"] ?? "8"),
  );
  private readonly requestTimeoutMs = Math.max(
    1,
    Number(process.env["IBKR_REQUEST_TIMEOUT_MS"] ?? "12000"),
  );
  private activeHistoryRequests = 0;
  private activeOptionChainRequests = 0;
  private readonly historyWaiters: Array<() => void> = [];
  private readonly optionChainWaiters: Array<() => void> = [];
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly config: IbkrRuntimeConfig) {}

  private buildHeaders(initHeaders?: HeaderInput): Headers {
    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": "rayalgo-ibkr/1.0",
    });

    Object.entries(this.config.extraHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });

    if (this.config.bearerToken) {
      headers.set("Authorization", `Bearer ${this.config.bearerToken}`);
    }

    if (this.config.cookie) {
      headers.set("Cookie", this.config.cookie);
    }

    new Headers(initHeaders).forEach((value, key) => {
      headers.set(key, value);
    });

    return headers;
  }

  private buildUrl(path: string, params: Record<string, QueryValue> = {}): URL {
    return withSearchParams(`${this.config.baseUrl}${path}`, params);
  }

  private buildWebSocketUrl(): string {
    const url = new URL(this.config.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
    url.search = "";
    return url.toString();
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    params: Record<string, QueryValue> = {},
  ): Promise<T> {
    const headers = this.buildHeaders(init.headers);

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    const inputSignal = init.signal;

    throwIfAborted(inputSignal ?? undefined);
    await this.waitForRequestPermit();
    throwIfAborted(inputSignal ?? undefined);

    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, this.requestTimeoutMs);
    const abortFromInput = () => controller.abort(inputSignal?.reason);

    if (inputSignal?.aborted) {
      controller.abort(inputSignal.reason);
    } else {
      inputSignal?.addEventListener("abort", abortFromInput, { once: true });
    }

    try {
      return await fetchJson<T>(this.buildUrl(path, params), {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (didTimeout) {
        throw new HttpError(504, `IBKR request to ${path} timed out after ${this.requestTimeoutMs}ms.`, {
          code: "ibkr_request_timeout",
          cause: error,
        });
      }

      if (inputSignal?.aborted) {
        throw createAbortError(inputSignal);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      inputSignal?.removeEventListener("abort", abortFromInput);
    }
  }

  private async waitForRequestPermit(): Promise<void> {
    const windowMs = 1_000;

    while (true) {
      const now = Date.now();
      while (
        this.requestTimestamps.length > 0 &&
        this.requestTimestamps[0] <= now - windowMs
      ) {
        this.requestTimestamps.shift();
      }

      if (this.requestTimestamps.length < this.requestsPerSecond) {
        this.requestTimestamps.push(now);
        return;
      }

      const oldest = this.requestTimestamps[0] ?? now;
      await sleep(Math.max(1, windowMs - (now - oldest) + 1));
    }
  }

  private async getPortfolioAccounts(): Promise<Record<string, unknown>[]> {
    const payload = await this.request<unknown>("/portfolio/accounts");
    return compact(asArray(payload).map(asRecord));
  }

  private async getTradingAccountsInfo(): Promise<{
    accounts: string[];
    allowCustomerTime: boolean;
  }> {
    const payload = await this.request<unknown>("/iserver/accounts");
    const record = asRecord(payload);

    return {
      accounts: compact(asArray(record?.["accounts"]).map(asString)),
      allowCustomerTime: Boolean(record?.["allowCustomerTime"]),
    };
  }

  async getSessionStatus(): Promise<SessionStatusSnapshot> {
    const payload = await this.request<unknown>(
      "/iserver/auth/status",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    const record = asRecord(payload);

    return {
      authenticated: Boolean(
        record?.["authenticated"] ??
          record?.["isAuthenticated"] ??
          record?.["connected"],
      ),
      connected: Boolean(
        record?.["connected"] ??
          record?.["authenticated"],
      ),
      competing: Boolean(record?.["competing"]),
      selectedAccountId:
        firstDefined(
          asString(record?.["selectedAccount"]),
          asString(record?.["selectedAccountId"]),
        ) ?? null,
      accounts: compact(asArray(record?.["accounts"]).map(asString)),
      updatedAt: new Date(),
      raw: record,
    };
  }

  async tickleSession(): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      "/tickle",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    return asRecord(payload);
  }

  async initializeBrokerageSession(): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      "/iserver/auth/ssodh/init",
      {
        method: "POST",
        body: JSON.stringify({
          publish: true,
          compete: true,
        }),
      },
    );

    return asRecord(payload);
  }

  async recoverBrokerageSession(): Promise<SessionStatusSnapshot> {
    try {
      await this.initializeBrokerageSession();
    } catch (error) {
      await this.request<unknown>(
        "/iserver/reauthenticate",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ).catch(() => {
        throw error;
      });
    }

    return this.getSessionStatus();
  }

  async getWebSocketConnectionConfig(): Promise<{
    url: string;
    headers: Record<string, string>;
  }> {
    const tickle = await this.tickleSession();
    const sessionToken = asString(tickle?.["session"]);
    const headers = this.buildHeaders();

    if (sessionToken) {
      headers.set("Cookie", `api=${sessionToken}`);
    }

    headers.set("Origin", "interactivebrokers.github.io");

    return {
      url: this.buildWebSocketUrl(),
      headers: Object.fromEntries(headers.entries()),
    };
  }

  async ensureBrokerageSession(): Promise<SessionStatusSnapshot> {
    const status = await this.getSessionStatus();

    if (!status.authenticated && !status.connected) {
      return status;
    }

    const tradingAccounts = await this.getTradingAccountsInfo();
    const selectedAccountId =
      status.selectedAccountId ??
      this.config.defaultAccountId ??
      tradingAccounts.accounts[0] ??
      null;

    return {
      ...status,
      selectedAccountId,
      accounts:
        tradingAccounts.accounts.length > 0
          ? tradingAccounts.accounts
          : status.accounts,
    };
  }

  async setActiveAccount(accountId: string): Promise<string> {
    const payload = await this.request<unknown>("/iserver/account", {
      method: "POST",
      body: JSON.stringify({ acctId: accountId }),
    });
    const record = asRecord(payload);

    return asString(record?.["acctId"]) ?? accountId;
  }

  async resolveActiveAccountId(accountId?: string | null): Promise<string | null> {
    const session = await this.ensureBrokerageSession();
    const targetAccountId =
      accountId ??
      session.selectedAccountId ??
      this.config.defaultAccountId ??
      session.accounts[0] ??
      null;

    if (!targetAccountId) {
      return null;
    }

    if (
      session.accounts.length > 1 &&
      session.selectedAccountId !== targetAccountId
    ) {
      await this.setActiveAccount(targetAccountId);
    }

    return targetAccountId;
  }

  private async withHistoryRequestPermit<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    while (this.activeHistoryRequests >= this.historyMaxConcurrency) {
      await new Promise<void>((resolve) => {
        this.historyWaiters.push(resolve);
      });
    }

    this.activeHistoryRequests += 1;

    try {
      return await task();
    } finally {
      this.activeHistoryRequests = Math.max(0, this.activeHistoryRequests - 1);
      this.historyWaiters.shift()?.();
    }
  }

  private async withOptionChainRequestPermit<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    while (this.activeOptionChainRequests >= this.optionChainMaxConcurrency) {
      throwIfAborted(signal);
      await new Promise<void>((resolve) => {
        const waiter = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = this.optionChainWaiters.indexOf(waiter);
          if (index >= 0) {
            this.optionChainWaiters.splice(index, 1);
          }
          resolve();
        };
        signal?.addEventListener("abort", abort, { once: true });
        this.optionChainWaiters.push(waiter);
      });
    }

    throwIfAborted(signal);
    this.activeOptionChainRequests += 1;

    try {
      return await task();
    } finally {
      this.activeOptionChainRequests = Math.max(
        0,
        this.activeOptionChainRequests - 1,
      );
      this.optionChainWaiters.shift()?.();
    }
  }

  private async searchSecurities(
    symbol: string,
    {
      secType,
      includeName,
      signal,
    }: {
      secType?: string;
      includeName?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<Record<string, unknown>[]> {
    const cacheKey = JSON.stringify({
      symbol: normalizeSymbol(symbol),
      secType: secType ?? null,
      includeName: Boolean(includeName),
    });
    const cached = readCachedValue(this.securitySearchCache, cacheKey);
    if (cached) {
      return cached;
    }

    const payload = await this.request<unknown>(
      "/iserver/secdef/search",
      { signal },
      compact([
        ["symbol", normalizeSymbol(symbol)] as const,
        secType ? (["secType", secType] as const) : null,
        includeName ? (["name", true] as const) : null,
      ]).reduce<Record<string, QueryValue>>((params, [key, value]) => {
        params[key] = value;
        return params;
      }, {}),
    );

    return writeCachedValue(
      this.securitySearchCache,
      cacheKey,
      compact(asArray(payload).map(asRecord)),
      SECURITY_SEARCH_CACHE_TTL_MS,
    );
  }

  private async getCachedOptionStrikes(input: {
    conid: number;
    month: string;
  }, signal?: AbortSignal): Promise<number[]> {
    const cacheKey = `${input.conid}:${input.month}`;
    const cached = readCachedValue(this.optionStrikesCache, cacheKey);
    if (cached) {
      return cached;
    }

    const strikesPayload = await this.request<unknown>(
      "/iserver/secdef/strikes",
      { signal },
      {
        conid: input.conid,
        sectype: "OPT",
        month: input.month,
        exchange: "SMART",
      },
    );
    const strikesRecord = asRecord(strikesPayload);
    const strikes = Array.from(
      new Set(
        [
          ...asArray(strikesRecord?.["call"]),
          ...asArray(strikesRecord?.["put"]),
        ]
          .map((value) => asNumber(value))
          .filter((value): value is number => value !== null)
          .sort((left, right) => left - right),
      ),
    );

    return writeCachedValue(
      this.optionStrikesCache,
      cacheKey,
      strikes,
      OPTION_CHAIN_METADATA_CACHE_TTL_MS,
    );
  }

  private async getCachedOptionInfo(input: {
    conid: number;
    month: string;
    strike: number;
    right: OptionRight;
  }, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
    const cacheKey = `${input.conid}:${input.month}:${input.strike}:${input.right}`;
    const cached = readCachedValue(this.optionInfoCache, cacheKey);
    if (cached) {
      return cached;
    }

    const infoPayload = await this.request<unknown>(
      "/iserver/secdef/info",
      { signal },
      {
        conid: input.conid,
        sectype: "OPT",
        month: input.month,
        exchange: "SMART",
        strike: input.strike,
        right: input.right === "call" ? "C" : "P",
      },
    );

    return writeCachedValue(
      this.optionInfoCache,
      cacheKey,
      compact(asArray(infoPayload).map(asRecord)),
      OPTION_CHAIN_METADATA_CACHE_TTL_MS,
    );
  }

  private async getAccountSummary(accountId: string): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      `/portfolio/${encodeURIComponent(accountId)}/summary`,
    );

    return asRecord(payload);
  }

  private async getAccountLedger(accountId: string): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      `/portfolio/${encodeURIComponent(accountId)}/ledger`,
    );

    return asRecord(payload);
  }

  private getBaseLedger(ledger: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!ledger) {
      return null;
    }

    return (
      asRecord(findCaseInsensitiveValue(ledger, "BASE")) ??
      compact(Object.values(ledger).map(asRecord))[0] ??
      null
    );
  }

  async listAccounts(mode: RuntimeMode): Promise<BrokerAccountSnapshot[]> {
    const accounts = await this.getPortfolioAccounts();

    return Promise.all(
      accounts.map(async (account) => {
        const accountId =
          firstDefined(asString(account["accountId"]), asString(account["id"])) ??
          null;

        if (!accountId) {
          throw new HttpError(502, "IBKR returned an account without an account ID.", {
            code: "ibkr_invalid_account",
          });
        }

        const [summary, ledger] = await Promise.all([
          this.getAccountSummary(accountId),
          this.getAccountLedger(accountId),
        ]);

        const baseLedger = this.getBaseLedger(ledger);
        const currency =
          firstDefined(
            asString(account["currency"]),
            asString(baseLedger?.["currency"]),
            "USD",
          ) ?? "USD";

        const cash =
          firstDefined(
            findMetric(summary, ["totalcashvalue", "cashbalance", "settledcash"]),
            findMetric(baseLedger, ["cashbalance", "settledcash"]),
          ) ?? 0;

        const netLiquidation =
          firstDefined(
            findMetric(summary, ["netliquidation", "netliquidationvalue"]),
            findMetric(baseLedger, ["netliquidationvalue", "netliquidation"]),
          ) ?? cash;

        const buyingPower =
          firstDefined(
            findMetric(summary, ["buyingpower", "availablefunds"]),
            netLiquidation,
          ) ?? 0;

        return {
          id: accountId,
          providerAccountId: accountId,
          provider: "ibkr" as const,
          mode,
          displayName:
            firstDefined(
              asString(account["displayName"]),
              asString(account["accountTitle"]),
              asString(account["desc"]),
              accountId,
            ) ?? accountId,
          currency,
          buyingPower,
          cash,
          netLiquidation,
          updatedAt: new Date(),
        };
      }),
    );
  }

  private async listAccountPositions(accountId: string): Promise<BrokerPositionSnapshot[]> {
    const positions: BrokerPositionSnapshot[] = [];
    let pageId = 0;

    while (pageId < 20) {
      const payload = await this.request<unknown>(
        `/portfolio/${encodeURIComponent(accountId)}/positions/${pageId}`,
      );
      const page = compact(asArray(payload).map(asRecord));

      if (page.length === 0) {
        break;
      }

      positions.push(
        ...compact(
          page.map((position) => {
            const assetClass = normalizeAssetClass(
              firstDefined(
                asString(position["assetClass"]),
                asString(position["secType"]),
              ),
            );
            const quantity = asNumber(position["position"]);

            if (!assetClass || quantity === null) {
              return null;
            }

            const optionContract =
              assetClass === "option" ? parseOptionDetails(position) : null;
            const symbol =
              assetClass === "option"
                ? optionContract?.underlying ?? normalizeSymbol(asString(position["ticker"]) ?? "")
                : normalizeSymbol(
                    firstDefined(
                      asString(position["ticker"]),
                      asString(position["contractDesc"]),
                      asString(position["description"]),
                    ) ?? "",
                  );

            if (!symbol) {
              return null;
            }

            const averagePrice =
              firstDefined(
                asNumber(position["avgPrice"]),
                asNumber(position["avgCost"]),
              ) ?? 0;
            const marketPrice =
              firstDefined(
                asNumber(position["mktPrice"]),
                asNumber(position["marketPrice"]),
              ) ?? averagePrice;
            const marketValue =
              firstDefined(
                asNumber(position["mktValue"]),
                asNumber(position["marketValue"]),
              ) ?? marketPrice * quantity;
            const unrealizedPnl =
              firstDefined(
                asNumber(position["unrealizedPnl"]),
                asNumber(position["unrealized_pnl"]),
              ) ?? 0;
            const multiplier = optionContract?.sharesPerContract ?? 1;
            const denominator =
              Math.abs(averagePrice * quantity * multiplier) || Math.abs(marketValue) || 1;

            return {
              id: `${accountId}:${asString(position["conid"]) ?? symbol}`,
              accountId,
              symbol,
              assetClass,
              quantity,
              averagePrice,
              marketPrice,
              marketValue,
              unrealizedPnl,
              unrealizedPnlPercent: (unrealizedPnl / denominator) * 100,
              optionContract,
            };
          }),
        ),
      );

      if (page.length < 100) {
        break;
      }

      pageId += 1;
    }

    return positions;
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    const accountIds = input.accountId
      ? [input.accountId]
      : (await this.getPortfolioAccounts()).flatMap((account) => {
          const accountId =
            firstDefined(asString(account["accountId"]), asString(account["id"])) ??
            null;
          return accountId ? [accountId] : [];
        });

    const positions = await Promise.all(
      accountIds.map((accountId) => this.listAccountPositions(accountId)),
    );

    return positions.flat();
  }

  async listOrders(input: {
    accountId?: string;
    mode: RuntimeMode;
    status?: OrderStatus;
  }): Promise<BrokerOrderSnapshot[]> {
    const tradingAccounts = await this.getTradingAccountsInfo();
    const accountIds = input.accountId
      ? [input.accountId]
      : tradingAccounts.accounts.length > 0
        ? tradingAccounts.accounts
        : this.config.defaultAccountId
          ? [this.config.defaultAccountId]
          : [];

    if (accountIds.length === 0) {
      return [];
    }

    const orderLists: BrokerOrderSnapshot[][] = [];

    for (const accountId of accountIds) {
      const payload = await this.request<unknown>(
        "/iserver/account/orders",
        {},
        {
          force: true,
          accountId,
        },
      );
      const record = asRecord(payload);
      const orders = compact(
        asArray(record?.["orders"]).map((order) => {
          const raw = asRecord(order);
          if (!raw) {
            return null;
          }

          const filledQuantity =
            firstDefined(
              asNumber(raw["filledQuantity"]),
              asNumber(raw["filled_quantity"]),
            ) ?? 0;
          const remainingQuantity =
            firstDefined(
              asNumber(raw["remainingQuantity"]),
              asNumber(raw["remaining_quantity"]),
            ) ?? 0;
          const status = normalizeOrderStatus(
            firstDefined(
              asString(raw["order_ccp_status"]),
              asString(raw["status"]),
            ),
            filledQuantity,
            remainingQuantity,
          );

          const mapped: BrokerOrderSnapshot = {
            id:
              firstDefined(asString(raw["orderId"]), asString(raw["order_id"])) ??
              randomUUID(),
            accountId:
              firstDefined(
                asString(raw["acct"]),
                asString(raw["account"]),
                accountId,
              ) ?? accountId,
            mode: input.mode,
            symbol: normalizeSymbol(
              firstDefined(
                asString(raw["ticker"]),
                asString(raw["description1"]),
                asString(raw["description"]),
                "UNKNOWN",
              ) ?? "UNKNOWN",
            ),
            assetClass:
              normalizeAssetClass(asString(raw["secType"])) ?? "equity",
            side: normalizeOrderSide(asString(raw["side"])),
            type: normalizeOrderType(
              firstDefined(
                asString(raw["origOrderType"]),
                asString(raw["orderType"]),
              ),
            ),
            timeInForce: normalizeTimeInForce(asString(raw["timeInForce"])),
            status,
            quantity:
              firstDefined(
                asNumber(raw["totalSize"]),
                asNumber(raw["size"]),
                asNumber(raw["quantity"]),
              ) ?? 0,
            filledQuantity,
            limitPrice:
              normalizeOrderType(
                firstDefined(
                  asString(raw["origOrderType"]),
                  asString(raw["orderType"]),
                ),
              ) === "limit"
                ? asNumber(raw["price"])
                : null,
            stopPrice:
              normalizeOrderType(
                firstDefined(
                  asString(raw["origOrderType"]),
                  asString(raw["orderType"]),
                ),
              ) === "stop"
                ? asNumber(raw["price"])
                : asNumber(raw["auxPrice"]),
            placedAt:
              firstDefined(
                toDate(raw["lastExecutionTime_r"]),
                toDate(raw["submitted_at"]),
              ) ?? new Date(),
            updatedAt:
              firstDefined(
                toDate(raw["lastExecutionTime_r"]),
                toDate(raw["updated_at"]),
              ) ?? new Date(),
            optionContract:
              normalizeAssetClass(asString(raw["secType"])) === "option"
                ? parseOptionDetails(raw)
                : null,
          };

          return input.status && mapped.status !== input.status ? null : mapped;
        }),
      );

      orderLists.push(orders);
    }

    return orderLists.flat();
  }

  async listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]> {
    const accountId = await this.resolveActiveAccountId(input.accountId);

    if (!accountId) {
      return [];
    }

    const clampedDays = Math.max(1, Math.min(7, Math.floor(input.days ?? 1)));
    const payload = await this.request<unknown>("/iserver/account/trades", {}, {
      days: clampedDays,
    });
    const rawRows = Array.isArray(payload)
      ? payload
      : asArray(asRecord(payload)?.["trades"]);
    const normalizedSymbol = input.symbol
      ? normalizeSymbol(input.symbol)
      : null;

    const executions = compact(
      rawRows.map((execution) => {
        const raw = asRecord(execution);
        if (!raw) {
          return null;
        }

        const providerContractId =
          firstDefined(asString(raw["conidEx"]), asString(raw["conid"])) ?? null;
        const symbol = normalizeSymbol(
          firstDefined(
            asString(raw["symbol"]),
            asString(raw["contract_description_1"]),
            asString(raw["ticker"]),
            "UNKNOWN",
          ) ?? "UNKNOWN",
        );
        const assetClass =
          normalizeAssetClass(
            firstDefined(
              asString(raw["sec_type"]),
              asString(raw["secType"]),
            ),
          ) ?? "equity";

        if (
          (normalizedSymbol && symbol !== normalizedSymbol) ||
          (input.providerContractId &&
            providerContractId !== input.providerContractId)
        ) {
          return null;
        }

        return {
          id: asString(raw["execution_id"]) ?? randomUUID(),
          accountId:
            firstDefined(
              asString(raw["account"]),
              asString(raw["accountCode"]),
              accountId,
            ) ?? accountId,
          symbol,
          assetClass,
          side: normalizeOrderSide(asString(raw["side"])),
          quantity: asNumber(raw["size"]) ?? 0,
          price: asNumber(raw["price"]) ?? 0,
          netAmount: asNumber(raw["net_amount"]),
          exchange: asString(raw["exchange"]) ?? null,
          executedAt:
            firstDefined(
              toDate(raw["trade_time_r"]),
              parseIbkrTradeDateTime(raw["trade_time"]),
            ) ?? new Date(),
          orderDescription: asString(raw["order_description"]) ?? null,
          contractDescription:
            asString(raw["contract_description_2"]) ?? null,
          providerContractId,
          orderRef: asString(raw["order_ref"]) ?? null,
        } satisfies BrokerExecutionSnapshot;
      }),
    ).sort(
      (left, right) => right.executedAt.getTime() - left.executedAt.getTime(),
    );

    return typeof input.limit === "number" && input.limit > 0
      ? executions.slice(0, input.limit)
      : executions;
  }

  private async preflightMarketData(
    conids: number[],
    fields: readonly string[] = SNAPSHOT_FIELDS,
    signal?: AbortSignal,
  ): Promise<void> {
    if (conids.length === 0) {
      return;
    }

    await this.getTradingAccountsInfo();

    const fieldList = fields.join(",");
    const conidBatches = chunk(conids, SNAPSHOT_BATCH_SIZE);

    for (const conidBatch of conidBatches) {
      await this.request<unknown>(
        "/iserver/marketdata/snapshot",
        { signal },
        {
          conids: conidBatch.join(","),
          fields: fieldList,
        },
      );
    }

    await sleep(150);
  }

  private async getMarketDataSnapshotMap(
    requests: Array<{ conid: number; symbol: string; assetClass?: AssetClass }>,
    signal?: AbortSignal,
  ): Promise<Map<string, QuoteSnapshot>> {
    const byConid = new Map<string, QuoteSnapshot>();
    const fields = SNAPSHOT_FIELDS.join(",");

    await this.preflightMarketData(
      requests.map((request) => request.conid),
      SNAPSHOT_FIELDS,
      signal,
    );

    for (const requestBatch of chunk(requests, SNAPSHOT_BATCH_SIZE)) {
      const payload = await this.request<unknown>(
        "/iserver/marketdata/snapshot",
        { signal },
        {
          conids: requestBatch.map((request) => request.conid).join(","),
          fields,
        },
      );

      const rows = compact(asArray(payload).map(asRecord));

      rows.forEach((row) => {
        const conid = asString(row["conid"]) ?? asString(row["conidEx"]);
        if (!conid) {
          return;
        }

        const request = requestBatch.find((candidate) => String(candidate.conid) === conid);
        if (!request) {
          return;
        }

        byConid.set(
          conid,
          parseSnapshotQuote(
            request.symbol,
            conid,
            row,
            request.assetClass ?? null,
          ),
        );
      });
    }

    return byConid;
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    if (normalizedSymbols.length === 0) {
      return [];
    }

    const resolved = await Promise.all(
      normalizedSymbols.map(async (symbol) => ({
        symbol,
        contract: await this.resolveStockContract(symbol),
      })),
    );
    const quoteMap = await this.getMarketDataSnapshotMap(
      resolved.map((entry) => ({
        conid: entry.contract.conid,
        symbol: entry.symbol,
        assetClass: "equity",
      })),
    );

    return resolved.map(({ symbol, contract }) => (
      quoteMap.get(String(contract.conid)) ?? {
        symbol,
        price: 0,
        bid: 0,
        ask: 0,
        bidSize: 0,
        askSize: 0,
        change: 0,
        changePercent: 0,
        open: null,
        high: null,
        low: null,
        prevClose: null,
        volume: null,
        openInterest: null,
        impliedVolatility: null,
        delta: null,
        gamma: null,
        theta: null,
        vega: null,
        updatedAt: new Date(),
        providerContractId: String(contract.conid),
        transport: "client_portal",
        delayed: false,
      }
    ));
  }

  async getHistoricalBars(input: {
    symbol: string;
    timeframe: HistoryBarTimeframe;
    limit?: number;
    from?: Date;
    to?: Date;
    assetClass?: AssetClass;
    providerContractId?: string | null;
    outsideRth?: boolean;
    source?: HistoryDataSource;
  }): Promise<BrokerBarSnapshot[]> {
    return this.withHistoryRequestPermit(async () => {
      const timeframe = input.timeframe;
      const bar = HISTORY_TIMEFRAME_TO_BAR[timeframe];
      const outsideRth =
        typeof input.outsideRth === "boolean"
          ? input.outsideRth
          : timeframe !== "1d";
      const historySource = normalizeHistoryDataSource(input.source);
      const desiredBars = resolveRequestedHistoryBars({
        timeframe,
        limit: input.limit,
        from: input.from,
        to: input.to,
      });
      const to = input.to ?? new Date();
      const stepMs = resolveHistoryStepMs(timeframe);
      const resolvedContract = await this.resolveHistoryContract({
        symbol: input.symbol,
        assetClass: input.assetClass,
        providerContractId: input.providerContractId,
      });
      const collected = new Map<number, BrokerBarSnapshot>();
      let remainingBars = desiredBars;
      let cursor = new Date(to);
      let safety = 0;

      while (remainingBars > 0 && safety < 8) {
        const chunkBars = Math.min(remainingBars, HISTORY_RESPONSE_MAX_POINTS);
        const historyArgs = {
          conid: resolvedContract.conid,
          exchange: resolvedContract.listingExchange,
          period: buildHistoryPeriod(timeframe, chunkBars),
          bar,
          startTime: formatHistoryStartTime(cursor),
          outsideRth,
          source: HISTORY_SOURCE_TO_IBKR[historySource],
        };
        // IBKR Client Portal occasionally returns a transient
        // 500 "Chart data unavailable" for valid symbols, especially
        // around session boundaries. Retry once before failing the
        // user's chart request — retrying more aggressively here just
        // pins additional upstream history slots and amplifies load
        // when IBKR is genuinely unhappy. The frontend already retries
        // with a backoff and surfaces a single error to the user.
        let payload: unknown;
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            payload = await this.request<unknown>(
              "/iserver/marketdata/history",
              {},
              historyArgs,
            );
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            const status =
              typeof (error as { statusCode?: unknown })?.statusCode === "number"
                ? ((error as { statusCode: number }).statusCode)
                : undefined;
            const detail = (error as { detail?: unknown })?.detail;
            const cause = (error as { cause?: unknown })?.cause;
            const haystack = [
              error instanceof Error ? error.message : String(error ?? ""),
              typeof detail === "string" ? detail : JSON.stringify(detail ?? ""),
              cause instanceof Error ? cause.message : String(cause ?? ""),
            ].join(" | ");
            const isTransientHttp = status !== undefined && status >= 500;
            const isTransientText =
              /Chart data unavailable|HTTP\s+5\d\d|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up|timeout/i.test(
                haystack,
              );
            const isRetryable = isTransientHttp || isTransientText;
            if (!isRetryable || attempt === 1) {
              break;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, 250 * (attempt + 1)),
            );
          }
        }
        if (lastError !== undefined) {
          throw lastError;
        }
        const bars = parseHistoricalBars(payload, {
          providerContractId: resolvedContract.providerContractId,
          outsideRth,
        });

        if (bars.length === 0) {
          break;
        }

        const collectedCountBeforeChunk = collected.size;
        bars.forEach((barPoint) => {
          collected.set(barPoint.timestamp.getTime(), barPoint);
        });
        const addedBars = collected.size - collectedCountBeforeChunk;

        remainingBars = Math.max(0, desiredBars - collected.size);
        const earliestBar = bars[0];

        // Market-hour calendars often return fewer points than the requested
        // chunk window even when older bars exist. Continue paging while the
        // cursor is still moving, but stop if IBKR returns only duplicates.
        if (!earliestBar || addedBars <= 0) {
          break;
        }

        cursor = new Date(earliestBar.timestamp.getTime() - stepMs);
        if (input.from && cursor.getTime() < input.from.getTime()) {
          break;
        }

        safety += 1;
      }

      const sorted = Array.from(collected.values())
        .sort(
          (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
        )
        .filter((barPoint) => (
          (!input.from || barPoint.timestamp.getTime() >= input.from.getTime()) &&
          (!input.to || barPoint.timestamp.getTime() <= input.to.getTime())
        ));

      return sorted.slice(-(input.limit ?? sorted.length));
    });
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: OptionRight | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    return this.withOptionChainRequestPermit(async () => {
      const signal = input.signal;
      throwIfAborted(signal);
      const searchResults = await this.searchSecurities(input.underlying, { signal });
      const normalizedUnderlying = normalizeSymbol(input.underlying);
      const match =
        searchResults.find((result) =>
          normalizeSymbol(asString(result["symbol"]) ?? "") === normalizedUnderlying,
        ) ?? searchResults[0];

      if (!match) {
        throw new HttpError(404, `Unable to resolve IBKR contract for ${input.underlying}.`, {
          code: "ibkr_contract_not_found",
        });
      }

      const underlyingConid = asNumber(match["conid"]);
      if (underlyingConid === null) {
        throw new HttpError(502, `IBKR returned an invalid contract identifier for ${input.underlying}.`, {
          code: "ibkr_invalid_conid",
        });
      }

      const optionSection = compact(asArray(match["sections"]).map(asRecord)).find(
        (section) => asString(section["secType"]) === "OPT",
      );
      const months = (asString(optionSection?.["months"]) ?? "")
        .split(";")
        .map((month) => month.trim())
        .filter(Boolean);

      const requestedMonth = input.expirationDate ? toIbkrMonthCode(input.expirationDate) : null;
      const maxExpirations = positiveIntegerOrDefault(
        input.maxExpirations,
        DEFAULT_OPTION_CHAIN_EXPIRATIONS,
      );
      const candidateMonths = requestedMonth
        ? months.filter((month) => month === requestedMonth)
        : months.slice(0, maxExpirations);

      const underlyingQuote = (await this.getMarketDataSnapshotMap(
        [
          {
            conid: underlyingConid,
            symbol: normalizedUnderlying,
            assetClass: "equity",
          },
        ],
        signal,
      )).get(String(underlyingConid));
      const spotPrice = underlyingQuote?.price ?? 0;
      const strikesAroundMoney = positiveIntegerOrDefault(
        input.strikesAroundMoney,
        DEFAULT_OPTION_CHAIN_STRIKES_AROUND_MONEY,
      );
      const rights: OptionRight[] = input.contractType
        ? [input.contractType]
        : ["call", "put"];

      const contracts = (
        await Promise.all(
          candidateMonths.map(async (month): Promise<
            NonNullable<BrokerPositionSnapshot["optionContract"]>[]
          > => {
            const strikes = await this.getCachedOptionStrikes({
              conid: underlyingConid,
              month,
            }, signal);

            const relevantStrikes =
              spotPrice > 0 && strikes.length > strikesAroundMoney * 2 + 1
                ? (() => {
                    const closestIndex = strikes.reduce((bestIndex, strike, index) => (
                      Math.abs(strike - spotPrice) < Math.abs(strikes[bestIndex] - spotPrice)
                        ? index
                        : bestIndex
                    ), 0);
                    const start = Math.max(0, closestIndex - strikesAroundMoney);
                    const end = Math.min(strikes.length, closestIndex + strikesAroundMoney + 1);
                    return strikes.slice(start, end);
                  })()
                : strikes;

            const contractGroups = await Promise.all(
              relevantStrikes.flatMap((strike) =>
                rights.map(async (right): Promise<
                  NonNullable<BrokerPositionSnapshot["optionContract"]>[]
                > => {
                  const matches = await this.getCachedOptionInfo({
                    conid: underlyingConid,
                    month,
                    strike,
                    right,
                  }, signal);
                  const parsedMatches = compact(
                    matches.map((record) => {
                      const optionContract = parseOptionDetails(record);
                      if (!optionContract) {
                        return null;
                      }

                      if (
                        input.expirationDate &&
                        optionContract.expirationDate.toISOString().slice(0, 10) !==
                          input.expirationDate.toISOString().slice(0, 10)
                      ) {
                        return null;
                      }

                      return {
                        record,
                        optionContract,
                      };
                    }),
                  );

                  const preferredContracts = Array.from(
                    parsedMatches.reduce<
                      Map<
                        string,
                        {
                          record: Record<string, unknown>;
                          optionContract: NonNullable<
                            BrokerPositionSnapshot["optionContract"]
                          >;
                        }
                      >
                    >((acc, candidate) => {
                      const expiryKey = candidate.optionContract.expirationDate
                        .toISOString()
                        .slice(0, 10);
                      const existing = acc.get(expiryKey);
                      const tradingClass = normalizeSymbol(
                        asString(candidate.record["tradingClass"]) ?? "",
                      );
                      const existingTradingClass = normalizeSymbol(
                        asString(existing?.record["tradingClass"]) ?? "",
                      );
                      const candidateScore =
                        tradingClass === normalizedUnderlying
                          ? 0
                          : tradingClass.startsWith(normalizedUnderlying)
                            ? 1
                            : 2;
                      const existingScore =
                        existingTradingClass === normalizedUnderlying
                          ? 0
                          : existingTradingClass.startsWith(normalizedUnderlying)
                            ? 1
                            : 2;

                      if (!existing || candidateScore < existingScore) {
                        acc.set(expiryKey, candidate);
                      }

                      return acc;
                    }, new Map())
                      .values(),
                  ).map((candidate) => candidate.optionContract);

                  return preferredContracts;
                }),
              ),
            );

            return contractGroups.flat();
          }),
        )
      ).flat();

      const uniqueContracts = Array.from(
        new Map(
          contracts.map((contract) => [contract.providerContractId ?? contract.ticker, contract]),
        ).values(),
      ).filter((contract) => {
        if (input.expirationDate) {
          return true;
        }

        const today = new Date();
        const todayUtc = Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate(),
        );
        return contract.expirationDate.getTime() >= todayUtc;
      }).sort((left, right) => (
        left.expirationDate.getTime() - right.expirationDate.getTime() ||
        left.strike - right.strike ||
        left.right.localeCompare(right.right)
      ));
      const allowedExpirations = input.expirationDate
        ? null
        : new Set(
            Array.from(
              new Set(
                uniqueContracts.map((contract) =>
                  contract.expirationDate.toISOString().slice(0, 10),
                ),
              ),
            ).slice(0, maxExpirations),
          );
      const scopedContracts = allowedExpirations
        ? uniqueContracts.filter((contract) =>
            allowedExpirations.has(contract.expirationDate.toISOString().slice(0, 10)),
          )
        : uniqueContracts;
      const quoteRequests = scopedContracts.flatMap((contract) => {
        const conid = asNumber(contract.providerContractId);
        return conid === null
          ? []
          : [{ conid, symbol: contract.ticker, assetClass: "option" as const }];
      });
      let quoteMap = new Map<string, QuoteSnapshot>();

      try {
        quoteMap = await this.getMarketDataSnapshotMap(quoteRequests, signal);
      } catch {
        // Contract metadata is still useful when IBKR has no live option quote
        // snapshot available or an OPRA snapshot request times out.
        quoteMap = new Map<string, QuoteSnapshot>();
      }

      return scopedContracts
        .map((contract) => {
          const quote = contract.providerContractId
            ? quoteMap.get(contract.providerContractId)
            : null;
          return toOptionChainContract(contract, quote ?? null);
        })
        .sort((left, right) => (
          left.contract.expirationDate.getTime() - right.contract.expirationDate.getTime() ||
          left.contract.strike - right.contract.strike ||
          left.contract.right.localeCompare(right.contract.right)
        ));
    }, input.signal);
  }

  private async resolveStockContract(symbol: string): Promise<{
    conid: number;
    secType: string;
    listingExchange: string;
  }> {
    // IBKR represents share-class tickers with a space (e.g. "BRK B"), while the
    // rest of the platform uses Polygon's dotted style (e.g. "BRK.B"). Try the
    // dotted form first, then fall back to the space-separated form on miss.
    const variants = Array.from(
      new Set(
        [symbol, symbol.replace(/\./g, " "), symbol.replace(/\./g, "")]
          .map((variant) => variant.trim())
          .filter(Boolean),
      ),
    );

    let match: Record<string, unknown> | undefined;
    for (const variant of variants) {
      const results = await this.searchSecurities(variant, { secType: "STK" });
      const variantUpper = variant.toUpperCase();
      match =
        results.find(
          (result) =>
            (asString(result["symbol"]) ?? "").toUpperCase() === variantUpper,
        ) ??
        results.find(
          (result) =>
            normalizeSymbol(asString(result["symbol"]) ?? "") === normalizeSymbol(symbol),
        ) ??
        results[0];
      if (match) break;
    }

    if (!match) {
      throw new HttpError(404, `Unable to resolve IBKR contract for ${symbol}.`, {
        code: "ibkr_contract_not_found",
      });
    }

    const conid = asNumber(match["conid"]);

    if (conid === null) {
      throw new HttpError(502, `IBKR returned an invalid contract identifier for ${symbol}.`, {
        code: "ibkr_invalid_conid",
      });
    }

    return {
      conid,
      secType: "STK",
      listingExchange:
        firstDefined(
          asString(match["description"]),
          asString(match["listingExchange"]),
          "SMART",
        ) ?? "SMART",
    };
  }

  async resolveStockContracts(symbols: string[]): Promise<ResolvedIbkrContract[]> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    return Promise.all(
      normalizedSymbols.map(async (symbol) => {
        const resolved = await this.resolveStockContract(symbol);
        return {
          ...resolved,
          symbol,
          providerContractId: String(resolved.conid),
        };
      }),
    );
  }

  private async resolveOptionContract(
    optionContract: NonNullable<PlaceOrderInput["optionContract"]>,
  ): Promise<{
    conid: number;
    secType: string;
    listingExchange: string;
  }> {
    const providedConid = asNumber(optionContract.providerContractId);

    if (providedConid !== null) {
      return {
        conid: providedConid,
        secType: "OPT",
        listingExchange: "SMART",
      };
    }

    const underlying = await this.resolveStockContract(optionContract.underlying);
    const month = toIbkrMonthCode(optionContract.expirationDate);

    const payload = await this.request<unknown>(
      "/iserver/secdef/info",
      {},
      {
        conid: underlying.conid,
        sectype: "OPT",
        month,
        right: optionContract.right === "call" ? "C" : "P",
        strike: optionContract.strike,
        exchange: "SMART",
      },
    );

    const results = compact(asArray(payload).map(asRecord));
    const expectedExpiration = optionContract.expirationDate.toISOString().slice(0, 10).replace(/-/g, "");
    const match =
      results.find((result) => {
        const maturity = asString(result["maturityDate"]);
        const strike = asNumber(result["strike"]);
        const right = normalizeOptionRight(asString(result["right"]));

        return (
          maturity === expectedExpiration &&
          strike === optionContract.strike &&
          right === optionContract.right
        );
      }) ?? results[0];

    if (!match) {
      throw new HttpError(
        404,
        `Unable to resolve IBKR option contract for ${optionContract.ticker}.`,
        {
          code: "ibkr_option_contract_not_found",
        },
      );
    }

    const conid = asNumber(match["conid"]);

    if (conid === null) {
      throw new HttpError(502, "IBKR returned an invalid option contract identifier.", {
        code: "ibkr_invalid_option_conid",
      });
    }

    return {
      conid,
      secType: "OPT",
      listingExchange:
        firstDefined(
          asString(match["exchange"]),
          asString(match["listingExchange"]),
          "SMART",
        ) ?? "SMART",
    };
  }

  private async resolveHistoryContract(input: {
    symbol: string;
    assetClass?: AssetClass;
    providerContractId?: string | null;
  }): Promise<ResolvedIbkrContract> {
    const providedConid = asNumber(input.providerContractId);

    if (providedConid !== null) {
      return {
        conid: providedConid,
        symbol: normalizeSymbol(input.symbol),
        secType: input.assetClass === "option" ? "OPT" : "STK",
        listingExchange: "SMART",
        providerContractId: String(providedConid),
      };
    }

    const resolved = await this.resolveStockContract(input.symbol);
    return {
      ...resolved,
      symbol: normalizeSymbol(input.symbol),
      providerContractId: String(resolved.conid),
    };
  }

  private async confirmOrderReplies(responsePayload: unknown): Promise<Record<string, unknown>> {
    let currentPayload = responsePayload;

    for (let replyCount = 0; replyCount < 5; replyCount += 1) {
      const results = compact(asArray(currentPayload).map(asRecord));
      const successfulOrder = results.find(
        (result) =>
          asString(result["order_id"]) !== null || asString(result["orderId"]) !== null,
      );

      if (successfulOrder) {
        return successfulOrder;
      }

      const reply = results.find((result) => asString(result["id"]) !== null);

      if (!reply) {
        break;
      }

      const replyId = asString(reply["id"]);

      if (!replyId) {
        break;
      }

      currentPayload = await this.request<unknown>(
        `/iserver/reply/${encodeURIComponent(replyId)}`,
        {
          method: "POST",
          body: JSON.stringify({ confirmed: true }),
        },
      );
    }

    throw new HttpError(502, "IBKR order submission did not return a final order acknowledgement.", {
      code: "ibkr_missing_order_ack",
    });
  }

  private async buildStructuredOrderBody(input: PlaceOrderInput): Promise<{
    accountId: string;
    body: Record<string, unknown>;
    resolvedContractId: number;
  }> {
    const tradingAccounts = await this.getTradingAccountsInfo();
    const accountId =
      input.accountId || this.config.defaultAccountId || tradingAccounts.accounts[0];

    if (!accountId) {
      throw new HttpError(400, "No IBKR account was provided for order placement.", {
        code: "ibkr_missing_account_id",
      });
    }

    const resolvedContract =
      input.assetClass === "option" && input.optionContract
        ? await this.resolveOptionContract(input.optionContract)
        : await this.resolveStockContract(input.symbol);

    const body: Record<string, unknown> = {
      orders: [
        {
          acctId: accountId,
          conid: resolvedContract.conid,
          manualIndicator: true,
          secType: `${resolvedContract.conid}:${resolvedContract.secType}`,
          cOID: randomUUID(),
          orderType: INTERNAL_TO_IBKR_ORDER_TYPE[input.type],
          listingExchange: resolvedContract.listingExchange,
          outsideRTH: false,
          side: input.side.toUpperCase(),
          ticker: normalizeSymbol(input.symbol),
          tif: INTERNAL_TO_IBKR_TIF[input.timeInForce],
          quantity: input.quantity,
        },
      ],
    };

    const order = asRecord(asArray(body["orders"])[0]);

    if (!order) {
      throw new HttpError(500, "Order payload construction failed.", {
        code: "ibkr_order_payload_invalid",
      });
    }

    if (tradingAccounts.allowCustomerTime) {
      order["manualOrderTime"] = Date.now();
    }

    if (input.type === "limit" || input.type === "stop_limit") {
      order["price"] = input.limitPrice;
    }

    if (input.type === "stop") {
      order["price"] = input.stopPrice;
    }

    if (input.type === "stop_limit") {
      order["auxPrice"] = input.stopPrice;
    }

    return {
      accountId,
      body,
      resolvedContractId: resolvedContract.conid,
    };
  }

  private mapAcknowledgedOrder(
    input: PlaceOrderInput,
    result: Record<string, unknown>,
    accountId: string,
    placedAt: Date,
  ): BrokerOrderSnapshot {
    const status = normalizeOrderStatus(
      firstDefined(asString(result["order_status"]), asString(result["status"])),
      0,
      input.quantity,
    );

    return {
      id:
        firstDefined(asString(result["order_id"]), asString(result["orderId"])) ??
        randomUUID(),
      accountId,
      mode: input.mode,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      side: input.side,
      type: input.type,
      timeInForce: input.timeInForce,
      status,
      quantity: input.quantity,
      filledQuantity: 0,
      limitPrice: input.limitPrice ?? null,
      stopPrice: input.stopPrice ?? null,
      placedAt,
      updatedAt: placedAt,
      optionContract: input.optionContract
        ? {
            ...input.optionContract,
            providerContractId: input.optionContract.providerContractId ?? null,
          }
        : null,
    };
  }

  async previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    const { accountId, body, resolvedContractId } = await this.buildStructuredOrderBody(input);

    return {
      accountId,
      mode: input.mode,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      resolvedContractId,
      orderPayload: asRecord(asArray(body["orders"])[0]) ?? {},
      optionContract: input.optionContract
        ? {
            ...input.optionContract,
            providerContractId: input.optionContract.providerContractId ?? null,
          }
        : null,
    };
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot> {
    const { accountId, body } = await this.buildStructuredOrderBody(input);

    const responsePayload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(accountId)}/orders`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const result = await this.confirmOrderReplies(responsePayload);
    const placedAt = new Date();
    return this.mapAcknowledgedOrder(input, result, accountId, placedAt);
  }

  async submitRawOrders(input: {
    accountId?: string | null;
    orders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    const tradingAccounts = await this.getTradingAccountsInfo();
    const accountId =
      input.accountId ??
      this.config.defaultAccountId ??
      tradingAccounts.accounts[0] ??
      null;

    if (!accountId) {
      throw new HttpError(400, "No IBKR account was provided for order placement.", {
        code: "ibkr_missing_account_id",
      });
    }

    const payload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(accountId)}/orders`,
      {
        method: "POST",
        body: JSON.stringify({
          orders: input.orders,
        }),
      },
    );

    return await this.confirmOrderReplies(payload);
  }

  async replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
  }): Promise<ReplaceOrderSnapshot> {
    const payload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(input.accountId)}/order/${encodeURIComponent(input.orderId)}`,
      {
        method: "POST",
        body: JSON.stringify(input.order),
      },
    );
    const result = await this.confirmOrderReplies(payload);
    const currentOrders = await this.listOrders({
      accountId: input.accountId,
      mode: input.mode,
    });

    return (
      currentOrders.find((order) => order.id === input.orderId) ?? {
        id:
          firstDefined(asString(result["order_id"]), asString(result["orderId"])) ??
          input.orderId,
        accountId: input.accountId,
        mode: input.mode,
        symbol: normalizeSymbol(asString(input.order["ticker"]) ?? "UNKNOWN"),
        assetClass:
          normalizeAssetClass(asString(input.order["secType"])) ?? "equity",
        side: normalizeOrderSide(asString(input.order["side"])),
        type: normalizeOrderType(asString(input.order["orderType"])),
        timeInForce: normalizeTimeInForce(asString(input.order["tif"])),
        status: "submitted",
        quantity: asNumber(input.order["quantity"]) ?? 0,
        filledQuantity: 0,
        limitPrice: asNumber(input.order["price"]),
        stopPrice: asNumber(input.order["auxPrice"]),
        placedAt: new Date(),
        updatedAt: new Date(),
        optionContract: null,
      }
    );
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    await this.getTradingAccountsInfo();

    const payload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(input.accountId)}/order/${encodeURIComponent(input.orderId)}`,
      {
        method: "DELETE",
      },
      {
        manualIndicator: input.manualIndicator ?? true,
        extOperator: input.extOperator ?? this.config.extOperator,
      },
    );
    const record = asRecord(payload);

    return {
      orderId:
        firstDefined(asString(record?.["order_id"]), asString(record?.["orderId"]), input.orderId) ??
        input.orderId,
      accountId:
        firstDefined(asString(record?.["account"]), asString(record?.["acct"]), input.accountId) ??
        null,
      message:
        firstDefined(asString(record?.["msg"]), asString(record?.["message"]), "Request submitted") ??
        "Request submitted",
      submittedAt: new Date(),
    };
  }

  /**
   * Public ticker search backed by IBKR's `/iserver/secdef/search`. Returns
   * results in the same shape the platform service expects from Polygon's
   * universe-search endpoint so it can be a drop-in primary source.
   */
  async searchTickers(input: {
    search?: string;
    limit?: number;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    const search = input.search?.trim();
    if (!search) return { count: 0, results: [] };

    const limit = Math.max(1, Math.min(input.limit ?? 12, 50));
    let raw: Record<string, unknown>[] = [];
    try {
      raw = await this.searchSecurities(search, { includeName: true });
    } catch {
      return { count: 0, results: [] };
    }

    const results: IbkrUniverseTicker[] = [];
    for (const record of raw) {
      const ticker = asString(record["symbol"]);
      const name =
        firstDefined(
          asString(record["companyHeader"]),
          asString(record["companyName"]),
          asString(record["description"]),
        ) ?? "";
      if (!ticker || !name) continue;

      const secType = asString(record["secType"]);
      // IBKR's secdef/search returns a mix of contract types; we only surface
      // STK rows here so the UI's universe browser stays clean. (Options have
      // their own dedicated chain endpoint.)
      if (secType && secType !== "STK") continue;

      results.push({
        ticker: normalizeSymbol(ticker),
        name,
        market: "stocks",
        locale: null,
        type: secType ?? "CS",
        active: true,
        primaryExchange:
          firstDefined(
            asString(record["listingExchange"]),
            asString(record["description"]),
          ) ?? null,
        currencyName: null,
        cik: null,
        compositeFigi: null,
        shareClassFigi: null,
        lastUpdatedAt: null,
        provider: "ibkr",
        providerContractId: asString(record["conid"]),
      });
      if (results.length >= limit) break;
    }

    return { count: results.length, results };
  }

  /**
   * News headlines from IBKR's `/iserver/news` endpoint. Requires an active
   * Reuters/Dow Jones subscription on the IBKR account; returns an empty list
   * if the subscription isn't present or the endpoint is unavailable, allowing
   * the platform service to fall back to a secondary provider.
   */
  async getNews(input: {
    ticker?: string;
    limit?: number;
  }): Promise<IbkrNewsArticle[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 50));

    let conid: number | null = null;
    if (input.ticker) {
      try {
        const resolved = await this.resolveStockContract(input.ticker);
        conid = resolved.conid;
      } catch {
        return [];
      }
    }

    if (!conid) {
      // IBKR's Client Portal API doesn't expose a general "market news"
      // firehose without a contract id. The caller should fall back to the
      // secondary provider for tickerless requests.
      return [];
    }

    let payload: unknown = null;
    try {
      payload = await this.request<unknown>(
        "/iserver/news",
        {},
        { conids: String(conid), pageSize: limit },
      );
    } catch {
      return [];
    }

    const records = compact(asArray(payload).map(asRecord));
    const ticker = input.ticker ? normalizeSymbol(input.ticker) : null;

    return compact(
      records.map((record): IbkrNewsArticle | null => {
        const id = asString(record["id"]);
        const headline = asString(record["headline"]);
        if (!id || !headline) return null;

        const updated =
          firstDefined(
            asString(record["updated"]),
            asString(record["date"]),
          ) ?? null;
        // IBKR timestamps are typically ms since epoch as a number-or-string,
        // sometimes formatted as "YYYYMMDDhhmmss". Try both shapes.
        let publishedAt: Date | null = null;
        if (updated) {
          const numeric = Number(updated);
          if (Number.isFinite(numeric) && numeric > 1_000_000_000_000) {
            publishedAt = new Date(numeric);
          } else if (/^\d{14}$/.test(updated)) {
            const y = updated.slice(0, 4);
            const mo = updated.slice(4, 6);
            const d = updated.slice(6, 8);
            const hh = updated.slice(8, 10);
            const mm = updated.slice(10, 12);
            const ss = updated.slice(12, 14);
            publishedAt = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`);
          } else {
            const parsed = Date.parse(updated);
            if (!Number.isNaN(parsed)) publishedAt = new Date(parsed);
          }
        }
        if (!publishedAt) publishedAt = new Date();

        const provider =
          firstDefined(
            asString(record["provider"]),
            asString(record["source"]),
          ) ?? "IBKR News";

        return {
          id,
          title: headline,
          description: null,
          // IBKR news bodies are fetched separately via /iserver/news/{id};
          // we don't have a public URL, so point at the IBKR portal as a stable
          // (non-broken) link the UI can render.
          articleUrl: `https://www.interactivebrokers.com/en/index.php?f=2222&conid=${conid}`,
          imageUrl: null,
          author: null,
          publishedAt,
          tickers: ticker ? [ticker] : [],
          publisher: {
            name: provider,
            homepageUrl: null,
            logoUrl: null,
          },
          sentiment: null,
          sentimentReasoning: null,
        };
      }),
    );
  }
}

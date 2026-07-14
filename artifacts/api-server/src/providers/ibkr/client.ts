import { randomUUID } from "node:crypto";
import { resolveUsEquityMarketSession } from "@workspace/market-calendar";
import type {
  AssetClass,
  BrokerAccountSnapshot,
  BrokerBarSnapshot,
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  CancelOrderSnapshot,
  HistoryBarTimeframe,
  HistoryDataSource,
  IbkrNewsArticle,
  IbkrRuntimeConfig,
  IbkrUniverseTicker,
  OptionChainContract,
  OptionRight,
  OrderPreviewSnapshot,
  OrderSide,
  OrderStatus,
  OrderType,
  PlaceOrderInput,
  QuoteSnapshot,
  ReplaceOrderSnapshot,
  ResolvedIbkrContract,
  RuntimeMode,
  SessionStatusSnapshot,
  TimeInForce,
  UniverseMarket,
} from "@workspace/ibkr-contracts";
export type {
  AssetClass,
  BrokerAccountSnapshot,
  BrokerBarSnapshot,
  BrokerExecutionSnapshot,
  BrokerMarketDepthLevel,
  BrokerMarketDepthSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  CancelOrderSnapshot,
  HistoryBarTimeframe,
  HistoryDataSource,
  IbkrNewsArticle,
  IbkrUniverseTicker,
  MarketDataFreshness,
  MarketDataProvider,
  OptionChainContract,
  OptionContractSnapshot,
  OptionOrderAction,
  OptionOrderPositionEffect,
  OptionOrderStrategyIntent,
  OptionRight,
  OrderPreviewSnapshot,
  OrderSide,
  OrderStatus,
  OrderType,
  PlaceOrderInput,
  PositionOpenedAtSource,
  PositionQuoteSnapshot,
  PositionQuoteSource,
  QuoteSnapshot,
  ReplaceOrderSnapshot,
  ResolvedIbkrContract,
  SessionStatusSnapshot,
  TimeInForce,
  UniverseMarket,
} from "@workspace/ibkr-contracts";
import { HttpError } from "../../lib/errors";
import { fetchJson, withSearchParams, type QueryValue } from "../../lib/http";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  compact,
  findCaseInsensitiveValue,
  firstDefined,
  normalizeSymbol,
  toDate,
  toIbkrMonthCode,
} from "../../lib/values";
import { areVerifiedIbkrPaperAccounts } from "../../services/ibkr-paper-account-policy";
import { fingerprintIbkrOrderBody } from "../../services/ibkr-order-intent";
import { signHmacRequest, type OAuthParams } from "./oauth-signer";

type HeaderInput = ConstructorParameters<typeof Headers>[0];

function strictBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function validatedClientOrderId(value: unknown): string | null {
  const clientOrderId = asString(value)?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{1,64}$/u.test(clientOrderId)
    ? clientOrderId
    : null;
}

export type IbkrClientOAuthConfig = {
  consumerKey: string;
  accessToken: string;
  liveSessionToken: string;
  realm: string;
  nonce?: () => string;
  timestamp?: () => string;
};

export type IbkrClientOptions = {
  oauth?: IbkrClientOAuthConfig | null;
  onBrokerageSessionError?: (
    stage: BrokerageSessionStage,
    failure: BrokerageSessionFailure,
  ) => void;
};

export type BrokerageSessionStage =
  | "accounts"
  | "auth_status"
  | "ssodh_init";

export type BrokerageSessionFailure = Readonly<{
  code?: string;
  httpStatus?: number;
}>;

export type IbkrAccountRiskStateSnapshot = {
  accountId: string;
  mode: RuntimeMode;
  positions: BrokerPositionSnapshot[];
  positionsComplete: true;
  positionsObservedAt: Date;
  orders: BrokerOrderSnapshot[];
  ordersComplete: true;
  ordersObservedAt: Date;
  settledCashUsd: number | null;
  settledCashObservedAt: Date;
  optionCollateralContractsVerified: boolean;
  verifiedStandardOptionContractIds: string[];
};

type IbkrListOrdersInput = {
  accountId?: string;
  mode: RuntimeMode;
  status?: OrderStatus;
};

type IbkrListOrdersInternalInput = IbkrListOrdersInput & {
  requireComplete?: boolean;
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

const IBKR_POSITION_PAGE_SIZE = 100;
const IBKR_MAX_POSITION_PAGES = 100;
const IBKR_MAX_ORDER_SNAPSHOT_SIZE = 1_000;
const IBKR_RISK_OPTION_INFO_CONCURRENCY = 4;
const RISK_WORKING_ORDER_STATUSES = new Set<OrderStatus>([
  "pending_submit",
  "pending_cancel",
  "submitted",
  "accepted",
  "partially_filled",
]);

type IbkrRiskOptionContract = NonNullable<
  BrokerPositionSnapshot["optionContract"]
>;
type IbkrRiskOptionContractCache = Map<
  number,
  Promise<IbkrRiskOptionContract>
>;

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
export const STREAMING_SNAPSHOT_FIELDS: readonly string[] =
  SNAPSHOT_FIELDS.filter((field) => field !== "87_raw");

const DEFAULT_HISTORY_BAR_LIMIT = 200;
const HISTORY_RESPONSE_MAX_POINTS = 1_000;
const SNAPSHOT_BATCH_SIZE = 30;
const SECURITY_SEARCH_CACHE_TTL_MS = 60_000;
const OPTION_CHAIN_METADATA_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_OPTION_CHAIN_EXPIRATIONS = 1;
const DEFAULT_OPTION_CHAIN_STRIKES_AROUND_MONEY = 6;
const OPTION_CHAIN_CONTRACT_INFO_CONCURRENCY = 16;
const requestEpochByBaseUrl = new Map<string, number>();
type OptionChainStrikeCoverage = "fast" | "standard" | "full";
type OptionChainQuoteHydration = "metadata" | "snapshot";
const HISTORY_SOURCE_TO_IBKR: Record<HistoryDataSource, string> = {
  trades: "Trades",
  midpoint: "Midpoint",
  bid_ask: "Bid_Ask",
};

const HISTORY_TIMEFRAME_TO_BAR: Partial<Record<HistoryBarTimeframe, string>> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "1d": "1d",
};

const HISTORY_TIMEFRAME_STEP_MS: Record<HistoryBarTimeframe, number> = {
  "5s": 5_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};
const HISTORY_TIMEFRAME_MAX_PAGES: Record<HistoryBarTimeframe, number> = {
  "5s": 20,
  "1m": 20,
  "5m": 20,
  "15m": 15,
  "1h": 10,
  "1d": 5,
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

function positiveIntegerOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function startOfUtcDay(date = new Date()): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (values.length === 0) {
    return [];
  }

  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(values.length, Math.max(1, concurrency));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        throwIfAborted(signal);
        const index = nextIndex;
        nextIndex += 1;

        if (index >= values.length) {
          return;
        }

        results[index] = await task(values[index], index);
      }
    }),
  );

  return results;
}

async function collectSettledWithin<T>(
  tasks: Array<Promise<T>>,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = [];
  let settledCount = 0;
  let resolveWait: () => void = () => {};

  const waitForCompletion = new Promise<void>((resolve) => {
    resolveWait = resolve;
  });
  const timeout = setTimeout(() => resolveWait(), Math.max(1, deadlineMs));
  const abort = () => resolveWait();

  signal?.addEventListener("abort", abort, { once: true });

  tasks.forEach((task) => {
    task
      .then((result) => {
        results.push(result);
      })
      .catch(() => {
        // Individual secType failures should not prevent partial universe
        // results from returning quickly.
      })
      .finally(() => {
        settledCount += 1;
        if (settledCount >= tasks.length) {
          resolveWait();
        }
      });
  });

  if (signal?.aborted) {
    resolveWait();
  }

  await waitForCompletion;
  clearTimeout(timeout);
  signal?.removeEventListener("abort", abort);
  throwIfAborted(signal);
  return results;
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

  const match = text.match(/^(\d{4})(\d{2})(\d{2})-(\d{2}):(\d{2}):(\d{2})$/);
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

function normalizeHistoryDataSource(
  source: HistoryDataSource | null | undefined,
): HistoryDataSource {
  return source ?? "trades";
}

function buildHistoryPeriod(
  timeframe: HistoryBarTimeframe,
  barCount: number,
  outsideRth = true,
): string {
  const desiredBars = Math.max(
    1,
    Math.min(HISTORY_RESPONSE_MAX_POINTS, Math.ceil(barCount)),
  );
  const marketHoursPadding = timeframe === "1d" ? 1 : outsideRth ? 2 : 5;
  const totalMs =
    desiredBars * resolveHistoryStepMs(timeframe) * marketHoursPadding;
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
  if (totalDays <= 365) {
    return `${Math.max(1, totalDays)}d`;
  }

  const totalWeeks = Math.ceil(totalMs / weekMs);
  if (totalWeeks <= 52) {
    return `${Math.max(1, totalWeeks)}w`;
  }

  const totalMonths = Math.ceil(totalMs / monthMs);
  if (totalMonths <= 12) {
    return `${Math.max(1, totalMonths)}m`;
  }

  const totalYears = Math.ceil(totalMs / yearMs);
  return `${Math.max(1, totalYears)}y`;
}

export const __ibkrClientTestInternals = {
  buildHistoryPeriod,
  normalizeHistoricalDataExchange,
};

function normalizeHistoricalDataExchange(value: unknown): string | null {
  const exchange = asString(value)?.trim().toUpperCase() ?? "";
  if (!exchange || exchange === "SMART") {
    return null;
  }
  return exchange === "OVERNIGHT" || exchange === "IBEOS" ? exchange : null;
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
  const normalized = value?.trim().toUpperCase();
  return normalized === "SELL" || normalized === "S" ? "sell" : "buy";
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

  if (
    normalized.includes("pendingcancel") ||
    normalized.includes("precancelled")
  ) {
    return "pending_cancel";
  }

  if (remainingQuantity > 0 && normalized.includes("filled")) {
    return filledQuantity > 0 ? "partially_filled" : "pending_submit";
  }

  if (filledQuantity > 0 && remainingQuantity > 0) {
    return "partially_filled";
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

  if (normalized.includes("pendingsubmit")) {
    return "pending_submit";
  }

  if (normalized.includes("accepted") || normalized.includes("working")) {
    return "accepted";
  }

  if (normalized.includes("submitted") || normalized.includes("presubmitted")) {
    return "submitted";
  }

  return "pending_submit";
}

function hasRecognizedOrderStatus(
  value: string | null,
  filledQuantity: number,
  remainingQuantity: number,
): boolean {
  if (filledQuantity > 0 && remainingQuantity > 0) {
    return true;
  }
  const normalized = normalizeMetricKey(value ?? "");
  return [
    "pendingcancel",
    "precancelled",
    "filled",
    "cancel",
    "expire",
    "reject",
    "inactive",
    "pendingsubmit",
    "apipending",
    "accepted",
    "working",
    "submitted",
    "presubmitted",
  ].some((status) => normalized.includes(status));
}

function hasRecognizedOrderType(value: string | null): boolean {
  return [
    "mkt",
    "market",
    "lmt",
    "limit",
    "stp",
    "stop",
    "stplmt",
    "stoplimit",
  ].includes(normalizeMetricKey(value ?? ""));
}

function hasRecognizedTimeInForce(value: string | null): boolean {
  return Object.hasOwn(IBKR_TO_INTERNAL_TIF, value?.trim().toUpperCase() ?? "");
}

type IbkrOrderMutationEvidence = {
  orderId: string;
  accountId: string;
  clientOrderId: string;
  conid: number;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  orderType: string;
  tif: string;
  status: string;
  limitPrice: number | null;
  editable: boolean;
  cancellable: boolean;
};

type PreparedIbkrOrder = {
  raw: Record<string, unknown>;
  accountId: string;
  clientOrderId: string;
  conid: number;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  ibkrSide: "BUY" | "SELL";
  type: "market" | "limit";
  ibkrOrderType: "mkt" | "lmt";
  timeInForce: TimeInForce;
  quantity: number;
  limitPrice: number | null;
};

function requirePreparedIbkrOrder(
  body: Record<string, unknown>,
  expectedAccountId: string,
  code = "ibkr_order_intent_invalid",
): PreparedIbkrOrder {
  const orders = asArray(body["orders"]);
  const raw = asRecord(orders[0]);
  const accountId = asString(raw?.["acctId"])?.trim() ?? "";
  const clientOrderId = validatedClientOrderId(raw?.["cOID"]);
  const conid = asNumber(raw?.["conid"]);
  const symbol = normalizeSymbol(asString(raw?.["ticker"]) ?? "");
  const ibkrSide = parseIbkrOrderSide(asString(raw?.["side"]));
  const ibkrOrderType = normalizeIbkrOrderTypeKey(
    asString(raw?.["orderType"]) ?? "",
  );
  const tifValue = asString(raw?.["tif"])?.trim().toUpperCase() ?? "";
  const quantity = asNumber(raw?.["quantity"]);
  const limitPrice = asNumber(raw?.["price"]);
  const secType = asString(raw?.["secType"])?.trim().toUpperCase() ?? "";
  const assetClass = secType.endsWith(":OPT")
    ? "option"
    : secType.endsWith(":STK")
      ? "equity"
      : null;
  const isLimit = ibkrOrderType === "lmt";
  const isMarket = ibkrOrderType === "mkt";
  if (
    orders.length !== 1 ||
    !raw ||
    accountId !== expectedAccountId ||
    !clientOrderId ||
    conid === null ||
    !Number.isSafeInteger(conid) ||
    conid <= 0 ||
    !symbol ||
    !ibkrSide ||
    (!isLimit && !isMarket) ||
    (isLimit && (limitPrice === null || limitPrice <= 0)) ||
    (isMarket && Object.hasOwn(raw, "price")) ||
    Object.hasOwn(raw, "auxPrice") ||
    !Object.hasOwn(IBKR_TO_INTERNAL_TIF, tifValue) ||
    quantity === null ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isInteger(quantity) ||
    !assetClass ||
    secType !== `${conid}:${assetClass === "option" ? "OPT" : "STK"}` ||
    strictBoolean(raw["outsideRTH"]) !== false ||
    strictBoolean(raw["manualIndicator"]) !== true
  ) {
    throw new HttpError(409, "The prepared IBKR order intent is invalid.", {
      code,
      expose: true,
    });
  }
  return {
    raw,
    accountId,
    clientOrderId,
    conid,
    symbol,
    assetClass,
    side: ibkrSide === "BUY" ? "buy" : "sell",
    ibkrSide,
    type: isLimit ? "limit" : "market",
    ibkrOrderType: isLimit ? "lmt" : "mkt",
    timeInForce: IBKR_TO_INTERNAL_TIF[tifValue]!,
    quantity,
    limitPrice: isLimit ? limitPrice : null,
  };
}

function preparedIbkrOrderMatchesInput(
  prepared: PreparedIbkrOrder,
  input: PlaceOrderInput,
): boolean {
  const inputContractId = asNumber(input.optionContract?.providerContractId);
  return (
    input.accountId === prepared.accountId &&
    validatedClientOrderId(input.clientOrderId) === prepared.clientOrderId &&
    normalizeSymbol(input.symbol) === prepared.symbol &&
    input.assetClass === prepared.assetClass &&
    input.side === prepared.side &&
    input.type === prepared.type &&
    input.quantity === prepared.quantity &&
    input.timeInForce === prepared.timeInForce &&
    (prepared.type === "limit"
      ? input.limitPrice === prepared.limitPrice && input.stopPrice == null
      : input.limitPrice == null && input.stopPrice == null) &&
    (prepared.assetClass === "option"
      ? Boolean(input.optionContract) &&
        (inputContractId === null || inputContractId === prepared.conid)
      : input.optionContract === null)
  );
}

function sameOptionContractEconomics(
  expected: NonNullable<PlaceOrderInput["optionContract"]>,
  actual: NonNullable<BrokerPositionSnapshot["optionContract"]>,
): boolean {
  return (
    normalizeSymbol(expected.underlying) ===
      normalizeSymbol(actual.underlying) &&
    expected.expirationDate.toISOString().slice(0, 10) ===
      actual.expirationDate.toISOString().slice(0, 10) &&
    expected.strike === actual.strike &&
    expected.right === actual.right &&
    expected.multiplier === actual.multiplier &&
    expected.sharesPerContract === actual.sharesPerContract &&
    (!expected.providerContractId ||
      expected.providerContractId === actual.providerContractId)
  );
}

function classifyIbkrOrderResponse(payload: unknown): {
  results: Record<string, unknown>[];
  brokerError: Record<string, unknown> | null;
  acknowledgement: Record<string, unknown> | null;
  warning: Record<string, unknown> | null;
  ambiguous: boolean;
} {
  const directResult = asRecord(payload);
  const rawResults = directResult ? [directResult] : asArray(payload);
  const results = compact(rawResults.map(asRecord));
  const acknowledgements = results.filter(
    (result) =>
      asString(result["order_id"]) !== null ||
      asString(result["orderId"]) !== null,
  );
  const warnings = results.filter((result) => asString(result["id"]) !== null);
  const orderIds = new Set(
    compact(
      acknowledgements.flatMap((result) => [
        asString(result["order_id"]),
        asString(result["orderId"]),
      ]),
    ),
  );
  const malformed =
    rawResults.length === 0 || results.length !== rawResults.length;

  return {
    results,
    brokerError:
      results.find((result) => asString(result["error"]) !== null) ?? null,
    acknowledgement: acknowledgements[0] ?? null,
    warning: warnings[0] ?? null,
    ambiguous:
      malformed ||
      results.length !== 1 ||
      orderIds.size > 1 ||
      (acknowledgements.length > 0 && warnings.length > 0),
  };
}

function parseIbkrOrderSide(value: string | null): "BUY" | "SELL" | null {
  const side = value?.trim().toUpperCase();
  if (side === "B" || side === "BUY") return "BUY";
  if (side === "S" || side === "SELL") return "SELL";
  return null;
}

function normalizeIbkrOrderTypeKey(value: string): string {
  const normalized = normalizeMetricKey(value);
  if (normalized === "limit") return "lmt";
  if (normalized === "market") return "mkt";
  return normalized;
}

function parseIbkrWhatIf(payload: unknown): OrderPreviewSnapshot["whatIf"] {
  const whatIf =
    asRecord(payload) ?? compact(asArray(payload).map(asRecord))[0] ?? {};
  const amount = asRecord(whatIf["amount"]);
  const equity = asRecord(whatIf["equity"]);
  const initial = asRecord(whatIf["initial"]);
  const maintenance = asRecord(whatIf["maintenance"]);
  const position = asRecord(whatIf["position"]);
  const result = {
    amount: asString(amount?.["amount"]),
    commission: asString(amount?.["commission"]),
    total: asString(amount?.["total"]),
    equityChange: asString(equity?.["change"]),
    initialMarginChange: asString(initial?.["change"]),
    maintenanceMarginChange: asString(maintenance?.["change"]),
    positionChange: asString(position?.["change"]),
    warnings: compact([
      asString(whatIf["warn"]),
      asString(whatIf["warning"]),
      ...asArray(whatIf["warnings"]).map(asString),
    ]),
    error: asString(whatIf["error"]),
  };
  if (
    !result.error &&
    result.amount === null &&
    result.commission === null &&
    result.total === null &&
    result.equityChange === null &&
    result.initialMarginChange === null &&
    result.maintenanceMarginChange === null &&
    result.positionChange === null
  ) {
    result.error = "IBKR did not verify the what-if request.";
  }
  return result;
}

function parseOptionDetails(
  record: Record<string, unknown>,
): BrokerPositionSnapshot["optionContract"] {
  const providerContractId = firstDefined(
    asString(record["conid"]),
    asString(record["con_id"]),
  );
  const underlying =
    firstDefined(
      asString(record["ticker"]),
      asString(record["description1"]),
      asString(record["symbol"]),
    ) ?? null;
  const expirationDate = toDate(
    firstDefined(
      record["expiry"],
      record["maturityDate"],
      record["maturity_date"],
    ),
  );
  const strike =
    firstDefined(asNumber(record["strike"]), asNumber(record["strikePrice"])) ??
    null;
  const right = normalizeOptionRight(
    firstDefined(asString(record["putOrCall"]), asString(record["right"])),
  );
  const multiplier = asNumber(record["multiplier"]) ?? 100;

  if (!underlying || !expirationDate || strike === null || !right) {
    return null;
  }

  const description = firstDefined(
    asString(record["contractDesc"]),
    asString(record["contract_desc"]),
  );
  const bracketMatch = description?.match(
    /\[([A-Z0-9 ]+\d{6}[CP]\d+)\s+\d+\]$/,
  );
  const localSymbol = firstDefined(
    asString(record["localSymbol"]),
    asString(record["local_symbol"]),
  );
  const ticker =
    bracketMatch?.[1]?.replace(/\s+/g, "") ??
    localSymbol ??
    `${underlying}-${expirationDate.toISOString().slice(0, 10)}-${right}-${strike}`;

  const contract = {
    ticker,
    underlying: normalizeSymbol(underlying),
    expirationDate,
    strike,
    right,
    multiplier,
    sharesPerContract: multiplier,
    providerContractId,
  };
  return {
    ...contract,
    standardDeliverableVerified: isStandardIbkrOptionDeliverable(
      record,
      contract,
    ),
  };
}

function isStandardIbkrOptionDeliverable(
  record: Record<string, unknown>,
  contract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
): boolean {
  // ponytail: this proof deliberately stops at exact, unadjusted OCC
  // 100-share metadata. Replace it with explicit deliverable components if
  // IBKR exposes cash/stock deliverables for adjusted contracts.
  const localSymbol = firstDefined(
    asString(record["localSymbol"]),
    asString(record["local_symbol"]),
  )?.toUpperCase();
  const occ = localSymbol?.match(/^([A-Z0-9. ]{1,6})(\d{6})([CP])(\d{8})$/u);
  const tradingClass = normalizeSymbol(
    firstDefined(
      asString(record["tradingClass"]),
      asString(record["trading_class"]),
    ) ?? "",
  );
  const securityType = firstDefined(
    asString(record["secType"]),
    asString(record["assetClass"]),
    asString(record["instrument_type"]),
  )?.toUpperCase();
  const currency = asString(record["currency"])?.toUpperCase();
  const clarificationKeys = [
    "contractClarificationType",
    "contract_clarification_type",
  ] as const;
  const unadjusted = clarificationKeys.some(
    (key) => Object.hasOwn(record, key) && record[key] === null,
  );
  if (
    !occ ||
    securityType !== "OPT" ||
    currency !== "USD" ||
    !unadjusted ||
    asNumber(record["multiplier"]) !== 100 ||
    contract.multiplier !== 100 ||
    contract.sharesPerContract !== 100 ||
    !contract.providerContractId
  ) {
    return false;
  }

  const occUnderlying = normalizeSymbol(occ[1].replace(/\s+/gu, ""));
  const occExpiration = `20${occ[2].slice(0, 2)}-${occ[2].slice(2, 4)}-${occ[2].slice(4, 6)}`;
  const occRight = occ[3] === "C" ? "call" : "put";
  const occStrike = Number(occ[4]) / 1_000;
  return (
    occUnderlying === contract.underlying &&
    tradingClass === contract.underlying &&
    occExpiration === contract.expirationDate.toISOString().slice(0, 10) &&
    occRight === contract.right &&
    occStrike === contract.strike
  );
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
  const delayed = [
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
    firstDefined(asNumber(payload["88"]), asNumber(payload["bidSize"])) ?? 0;
  const askSize =
    firstDefined(
      asNumber(payload["85"]),
      asNumber(payload["askSize"]),
      asNumber(payload["7059"]),
    ) ?? 0;
  const prevClose = firstDefined(
    asNumber(payload["7296"]),
    asNumber(payload["7741"]),
    asNumber(payload["prevClose"]),
    asNumber(payload["close"]),
  );
  const open = firstDefined(
    asNumber(payload["7295"]),
    asNumber(payload["open"]),
  );
  const high = firstDefined(asNumber(payload["70"]), asNumber(payload["high"]));
  const low = firstDefined(asNumber(payload["71"]), asNumber(payload["low"]));
  const volume = firstDefined(
    asNumber(payload["87_raw"]),
    asNumber(payload["7762"]),
    asNumber(payload["87"]),
    asNumber(payload["volume"]),
  );
  const openInterest = firstDefined(
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
    ibkrChangePct ?? (prevClose ? (change / prevClose) * 100 : 0);
  const updatedAt =
    toDate(payload["_updated"]) ?? toDate(payload["updatedAt"]) ?? new Date();
  const marketSession = resolveUsEquityMarketSession(updatedAt).key;
  const extendedBaselinePrice =
    marketSession === "pre" && prevClose !== null ? prevClose : null;

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
    extendedBaselinePrice,
    extendedBaselineAt: extendedBaselinePrice !== null ? updatedAt : null,
    extendedBaselineSource:
      extendedBaselinePrice !== null ? "regular_close" : null,
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
    freshness: delayed ? "delayed" : "live",
    marketDataMode: delayed ? "delayed" : "live",
    dataUpdatedAt: updatedAt,
    ageMs: null,
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
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: timestamp,
        ageMs: null,
      } satisfies BrokerBarSnapshot;
    }),
  ).sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
}

function toOptionChainContract(
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
  quote: QuoteSnapshot | null,
): OptionChainContract {
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const last = quote?.price ?? null;
  const mark =
    bid != null && ask != null && bid > 0 && ask > 0
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
      brokerContractId:
        optionContract.brokerContractId ?? optionContract.providerContractId,
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
    openInterest: quote?.openInterest ?? null,
    volume: quote?.volume ?? null,
    updatedAt: quote?.updatedAt ?? new Date(),
    quoteFreshness: quote?.freshness ?? (quote ? "live" : "metadata"),
    marketDataMode: quote?.marketDataMode ?? null,
    quoteUpdatedAt: quote?.dataUpdatedAt ?? quote?.updatedAt ?? null,
    dataUpdatedAt: quote?.dataUpdatedAt ?? quote?.updatedAt ?? null,
    ageMs: quote?.ageMs ?? null,
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
  private readonly universeSearchPartialDeadlineMs = Math.max(
    250,
    Number(process.env["IBKR_UNIVERSE_SEARCH_PARTIAL_DEADLINE_MS"] ?? "2000"),
  );
  private activeHistoryRequests = 0;
  private activeOptionChainRequests = 0;
  private readonly historyWaiters: Array<() => void> = [];
  private readonly optionChainWaiters: Array<() => void> = [];
  private readonly requestTimestamps: number[] = [];

  constructor(
    private readonly config: IbkrRuntimeConfig,
    private readonly options: IbkrClientOptions = {},
  ) {}

  getCurrentRequestEpoch(): number {
    return requestEpochByBaseUrl.get(this.config.baseUrl) ?? 0;
  }

  private observeBrokerageSessionError(
    stage: BrokerageSessionStage,
    error: unknown,
  ): void {
    const observer = this.options.onBrokerageSessionError;
    if (!observer) return;
    const failure: BrokerageSessionFailure = Object.freeze({
      code: error instanceof HttpError ? error.code : undefined,
      httpStatus: error instanceof HttpError ? error.statusCode : undefined,
    });
    try {
      void Promise.resolve(observer(stage, failure)).catch(() => undefined);
    } catch {
      // Diagnostics must never alter brokerage-session behavior.
    }
  }

  private assertPaperAccounts(accountIds: readonly string[]): void {
    if (
      this.config.paperAccountOnly &&
      !areVerifiedIbkrPaperAccounts(accountIds)
    ) {
      throw new HttpError(
        403,
        "Only an authenticated IBKR Paper Trading account is allowed.",
        {
          code: "ibkr_paper_account_required",
          detail:
            "Sign in with the separate username assigned to your IBKR Paper Trading account.",
          expose: true,
        },
      );
    }
  }

  private buildHeaders(initHeaders?: HeaderInput): Headers {
    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": "pyrus-ibkr/1.0",
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

  private buildOAuthSignatureUrl(url: URL): string {
    const signatureUrl = new URL(url.toString());
    signatureUrl.search = "";
    signatureUrl.hash = "";
    return signatureUrl.toString();
  }

  private buildOAuthQueryParams(params: Record<string, QueryValue>): OAuthParams {
    const oauthParams: OAuthParams = {};

    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return;
      }

      if (Array.isArray(value)) {
        if (value.length > 0) {
          oauthParams[key] = value
            .filter((item) => item !== null && item !== undefined)
            .map((item) => (item instanceof Date ? item.toISOString() : String(item)))
            .join(",");
        }
        return;
      }

      oauthParams[key] = value instanceof Date ? value.toISOString() : String(value);
    });

    return oauthParams;
  }

  private applyOAuthAuthorization(
    headers: Headers,
    method: string,
    url: URL,
    params: Record<string, QueryValue>,
  ): void {
    const oauth = this.options.oauth;
    if (!oauth) {
      return;
    }

    const signed = signHmacRequest({
      method,
      url: this.buildOAuthSignatureUrl(url),
      consumerKey: oauth.consumerKey,
      accessToken: oauth.accessToken,
      liveSessionToken: oauth.liveSessionToken,
      realm: oauth.realm,
      queryParams: this.buildOAuthQueryParams(params),
      nonce: oauth.nonce?.(),
      timestamp: oauth.timestamp?.(),
    });
    headers.set("Authorization", signed.authorizationHeader);
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
    return (await this.requestWithEpoch<T>(path, init, params)).payload;
  }

  private async requestWithEpoch<T>(
    path: string,
    init: RequestInit = {},
    params: Record<string, QueryValue> = {},
    expectedRequestEpoch?: number,
  ): Promise<{ payload: T; requestEpoch: number }> {
    const headers = this.buildHeaders(init.headers);
    const url = this.buildUrl(path, params);
    this.applyOAuthAuthorization(headers, init.method ?? "GET", url, params);

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    const inputSignal = init.signal;

    throwIfAborted(inputSignal ?? undefined);
    await this.waitForRequestPermit();
    throwIfAborted(inputSignal ?? undefined);

    const currentRequestEpoch = this.getCurrentRequestEpoch();
    if (
      expectedRequestEpoch !== undefined &&
      currentRequestEpoch !== expectedRequestEpoch
    ) {
      throw new HttpError(409, "The IBKR warning reply is no longer current.", {
        code: "ibkr_order_reply_epoch_changed",
        expose: true,
      });
    }
    const requestEpoch = currentRequestEpoch + 1;
    requestEpochByBaseUrl.set(this.config.baseUrl, requestEpoch);

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
      const payload = await fetchJson<T>(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      return { payload, requestEpoch };
    } catch (error) {
      if (didTimeout) {
        throw new HttpError(
          504,
          `IBKR request to ${path} timed out after ${this.requestTimeoutMs}ms.`,
          {
            code: "ibkr_request_timeout",
            cause: error,
          },
        );
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
    const accounts = compact(asArray(payload).map(asRecord));
    if (this.config.paperAccountOnly) {
      const accountIds = compact(
        accounts.map((account) =>
          firstDefined(
            asString(account["accountId"]),
            asString(account["id"]),
          ),
        ),
      );
      if (accountIds.length !== accounts.length) {
        this.assertPaperAccounts([]);
      }
      this.assertPaperAccounts(accountIds);
    }
    return accounts;
  }

  private async getTradingAccountsInfo(): Promise<{
    accounts: string[];
    allowCustomerTime: boolean;
    selectedAccountId: string | null;
    isPaper: boolean | null;
  }> {
    const payload = await this.request<unknown>("/iserver/accounts");
    const record = asRecord(payload);

    const result = {
      accounts: compact(asArray(record?.["accounts"]).map(asString)),
      allowCustomerTime: Boolean(record?.["allowCustomerTime"]),
      selectedAccountId:
        firstDefined(
          asString(record?.["selectedAccount"]),
          asString(record?.["selectedAccountId"]),
        ) ?? null,
      isPaper: strictBoolean(record?.["isPaper"]),
    };
    this.assertPaperAccounts(result.accounts);
    return result;
  }

  async getSessionStatus(): Promise<SessionStatusSnapshot> {
    const payload = await this.request<unknown>("/iserver/auth/status", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const record = asRecord(payload);

    return {
      authenticated:
        strictBoolean(
          record?.["authenticated"] ?? record?.["isAuthenticated"],
        ) ?? false,
      connected: strictBoolean(record?.["connected"]) ?? false,
      established: strictBoolean(record?.["established"]),
      isPaper: strictBoolean(record?.["isPaper"]),
      competing: strictBoolean(record?.["competing"]) === true,
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
    const payload = await this.request<unknown>("/tickle", {
      method: "POST",
      body: JSON.stringify({}),
    });

    return asRecord(payload);
  }

  async initializeBrokerageSession(): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>("/iserver/auth/ssodh/init", {
      method: "POST",
      body: JSON.stringify({
        publish: true,
        compete: true,
      }),
    });

    return asRecord(payload);
  }

  async recoverBrokerageSession(): Promise<SessionStatusSnapshot> {
    try {
      await this.initializeBrokerageSession();
    } catch (error) {
      await this.request<unknown>("/iserver/reauthenticate", {
        method: "POST",
        body: JSON.stringify({}),
      }).catch(() => {
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

  async ensureBrokerageSession(
    options: { initializeIfNeeded?: boolean } = {},
  ): Promise<SessionStatusSnapshot> {
    const initializeIfNeeded = options.initializeIfNeeded ?? true;
    let status: SessionStatusSnapshot;
    try {
      status = await this.getSessionStatus();
    } catch (error) {
      this.observeBrokerageSessionError("auth_status", error);
      if (!initializeIfNeeded) throw error;
      // CPG can reject /iserver/auth/status outright with 401 (instead of
      // returning an unauthenticated body) until ssodh/init establishes the
      // REST-side session, including right after a completed web login. Try
      // the init once; if it cannot recover, surface the original error.
      await this.initializeBrokerageSession().catch((initError: unknown) => {
        this.observeBrokerageSessionError("ssodh_init", initError);
        throw error;
      });
      try {
        status = await this.getSessionStatus();
      } catch (retryError) {
        this.observeBrokerageSessionError("auth_status", retryError);
        throw retryError;
      }
    }

    if (!status.authenticated) {
      if (!initializeIfNeeded) return status;
      // A completed Client Portal web login (SSO/2FA finished) leaves
      // /iserver/auth/status unauthenticated until ssodh/init promotes the
      // SSO session to a brokerage session; without this step a finished
      // login is never detected. Init failure just means nobody has logged
      // in yet, so the logged-out status is returned as-is.
      const initialized = await this.initializeBrokerageSession().then(
        () => true,
        (error: unknown) => {
          this.observeBrokerageSessionError("ssodh_init", error);
          return false;
        },
      );
      if (initialized) {
        try {
          status = await this.getSessionStatus();
        } catch (error) {
          this.observeBrokerageSessionError("auth_status", error);
          throw error;
        }
      }
      if (!status.authenticated) {
        return status;
      }
    }

    const tradingAccounts = await this.getTradingAccountsInfo().catch(
      (error: unknown) => {
        this.observeBrokerageSessionError("accounts", error);
        throw error;
      },
    );
    const selectedAccountId =
      tradingAccounts.selectedAccountId ?? status.selectedAccountId;
    this.assertPaperAccounts(
      selectedAccountId
        ? [...tradingAccounts.accounts, selectedAccountId]
        : tradingAccounts.accounts,
    );

    return {
      ...status,
      isPaper: tradingAccounts.isPaper ?? status.isPaper,
      selectedAccountId,
      accounts:
        tradingAccounts.accounts.length > 0
          ? tradingAccounts.accounts
          : status.accounts,
    };
  }

  async setActiveAccount(accountId: string): Promise<string> {
    this.assertPaperAccounts([accountId]);
    const payload = await this.request<unknown>("/iserver/account", {
      method: "POST",
      body: JSON.stringify({ acctId: accountId }),
    });
    const record = asRecord(payload);
    const selectedAccountId = asString(record?.["acctId"]);

    if (
      strictBoolean(record?.["set"]) !== true ||
      selectedAccountId !== accountId
    ) {
      throw new HttpError(502, "IBKR did not confirm the account selection.", {
        code: "ibkr_account_selection_failed",
        expose: true,
      });
    }

    return selectedAccountId;
  }

  private async ensureActiveTradingAccount(
    accountId: string,
    tradingAccounts: Awaited<ReturnType<IbkrClient["getTradingAccountsInfo"]>>,
  ): Promise<Awaited<ReturnType<IbkrClient["getTradingAccountsInfo"]>>> {
    if (!tradingAccounts.accounts.includes(accountId)) {
      throw new HttpError(409, "The selected IBKR account is not tradable.", {
        code: "ibkr_order_account_not_tradable",
        expose: true,
      });
    }

    if (
      tradingAccounts.selectedAccountId === accountId ||
      (tradingAccounts.accounts.length === 1 &&
        tradingAccounts.selectedAccountId === null)
    ) {
      return tradingAccounts;
    }

    await this.setActiveAccount(accountId);
    const verified = await this.getTradingAccountsInfo();
    if (verified.selectedAccountId !== accountId) {
      throw new HttpError(502, "IBKR did not select the requested account.", {
        code: "ibkr_account_selection_failed",
        expose: true,
      });
    }

    return verified;
  }

  async resolveActiveAccountId(
    accountId?: string | null,
  ): Promise<string | null> {
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

    this.assertPaperAccounts([targetAccountId]);

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

  private async getCachedOptionStrikes(
    input: {
      conid: number;
      month: string;
    },
    signal?: AbortSignal,
  ): Promise<number[]> {
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

  private async getCachedOptionInfo(
    input: {
      conid: number;
      month: string;
      strike: number;
      right: OptionRight;
    },
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
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

  private async getAccountSummary(
    accountId: string,
  ): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      `/portfolio/${encodeURIComponent(accountId)}/summary`,
    );

    return asRecord(payload);
  }

  private async getAccountLedger(
    accountId: string,
  ): Promise<Record<string, unknown> | null> {
    const payload = await this.request<unknown>(
      `/portfolio/${encodeURIComponent(accountId)}/ledger`,
    );

    return asRecord(payload);
  }

  private getBaseLedger(
    ledger: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
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
          firstDefined(
            asString(account["accountId"]),
            asString(account["id"]),
          ) ?? null;

        if (!accountId) {
          throw new HttpError(
            502,
            "IBKR returned an account without an account ID.",
            {
              code: "ibkr_invalid_account",
            },
          );
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
            findMetric(summary, [
              "totalcashvalue",
              "cashbalance",
              "settledcash",
            ]),
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
        const totalCashValue = findMetric(summary, ["totalcashvalue"]);
        const settledCash = findMetric(summary, ["settledcash"]);
        const accountType =
          firstDefined(
            asString(findCaseInsensitiveValue(summary ?? {}, "accounttype")),
            asString(account["accountType"]),
            asString(account["type"]),
          ) ?? null;
        const dayTradesRemaining = findMetric(summary, [
          "daytradesremaining",
          "daytradesremainingt+4",
        ]);
        const patternDayTraderRaw = firstDefined(
          asString(findCaseInsensitiveValue(summary ?? {}, "patterndaytrader")),
          asString(
            findCaseInsensitiveValue(summary ?? {}, "ispatterndaytrader"),
          ),
        );

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
          accountType,
          totalCashValue,
          settledCash,
          accruedCash: findMetric(summary, ["accruedcash"]),
          initialMargin: findMetric(summary, [
            "initmarginreq",
            "initialmargin",
          ]),
          maintenanceMargin: findMetric(summary, [
            "maintmarginreq",
            "maintenancemargin",
            "maintenance_margin",
          ]),
          excessLiquidity: findMetric(summary, ["excessliquidity"]),
          cushion: findMetric(summary, ["cushion"]),
          sma: findMetric(summary, ["sma"]),
          dayTradingBuyingPower: findMetric(summary, ["daytradingbuyingpower"]),
          regTInitialMargin: findMetric(summary, [
            "regtmargin",
            "regtinitialmargin",
          ]),
          grossPositionValue: findMetric(summary, ["grosspositionvalue"]),
          leverage: findMetric(summary, ["leverage"]),
          dayTradesRemaining,
          isPatternDayTrader: patternDayTraderRaw
            ? ["true", "yes", "1", "y"].includes(
                patternDayTraderRaw.toLowerCase(),
              )
            : null,
          updatedAt: new Date(),
        };
      }),
    );
  }

  private getRiskOptionContract(
    conid: number,
    cache: IbkrRiskOptionContractCache,
  ): Promise<IbkrRiskOptionContract> {
    const cached = cache.get(conid);
    if (cached) {
      return cached;
    }

    const pending = this.request<unknown>(
      `/iserver/contract/${encodeURIComponent(String(conid))}/info`,
    ).then((payload) => {
      const record = asRecord(payload);
      const returnedConid = firstDefined(
        asNumber(record?.["conid"]),
        asNumber(record?.["con_id"]),
      );
      const assetClass = normalizeAssetClass(
        firstDefined(
          asString(record?.["secType"]),
          asString(record?.["assetClass"]),
          asString(record?.["instrument_type"]),
        ),
      );
      const maturity = firstDefined(
        asString(record?.["expiry"]),
        asString(record?.["maturityDate"]),
        asString(record?.["maturity_date"]),
      );
      const multiplier = asNumber(record?.["multiplier"]);
      const optionContract = record ? parseOptionDetails(record) : null;
      const expectedExpiration = maturity?.match(/^\d{8}$/u)
        ? `${maturity.slice(0, 4)}-${maturity.slice(4, 6)}-${maturity.slice(6, 8)}`
        : null;

      if (
        returnedConid !== conid ||
        !Number.isSafeInteger(returnedConid) ||
        assetClass !== "option" ||
        multiplier === null ||
        multiplier <= 0 ||
        !expectedExpiration ||
        !optionContract ||
        optionContract.providerContractId !== String(conid) ||
        optionContract.expirationDate.toISOString().slice(0, 10) !==
          expectedExpiration
      ) {
        throw new HttpError(
          502,
          "IBKR returned invalid option contract details.",
          {
            code: "ibkr_option_contract_info_invalid",
            expose: false,
          },
        );
      }

      return optionContract;
    });
    cache.set(conid, pending);
    return pending;
  }

  private async getPreparedOrderOptionContract(
    prepared: PreparedIbkrOrder,
    expectedOrder?: PlaceOrderInput,
  ): Promise<BrokerPositionSnapshot["optionContract"]> {
    if (prepared.assetClass !== "option") {
      return null;
    }
    const hydrated = await this.getRiskOptionContract(prepared.conid, new Map());
    if (
      expectedOrder?.optionContract &&
      !sameOptionContractEconomics(expectedOrder.optionContract, hydrated)
    ) {
      throw new HttpError(
        409,
        "The prepared IBKR option contract does not match its broker identifier.",
        {
          code: "ibkr_option_contract_identity_mismatch",
          expose: true,
        },
      );
    }
    return {
      ...(expectedOrder?.optionContract ?? hydrated),
      providerContractId: String(prepared.conid),
      standardDeliverableVerified: hydrated.standardDeliverableVerified,
    };
  }

  private async hydrateRiskOptionContracts(
    records: Record<string, unknown>[],
    cache: IbkrRiskOptionContractCache,
  ): Promise<Map<number, IbkrRiskOptionContract>> {
    const conids = Array.from(
      new Set(
        records.flatMap((record) => {
          const assetClass = normalizeAssetClass(
            firstDefined(
              asString(record["secType"]),
              asString(record["assetClass"]),
            ),
          );
          const conid = firstDefined(
            asNumber(record["conid"]),
            asNumber(record["con_id"]),
            asNumber(record["conidex"]),
          );
          return assetClass === "option" &&
            conid !== null &&
            conid > 0 &&
            Number.isSafeInteger(conid)
            ? [conid]
            : [];
        }),
      ),
    );
    const contracts = await mapWithConcurrency(
      conids,
      IBKR_RISK_OPTION_INFO_CONCURRENCY,
      async (conid) =>
        [conid, await this.getRiskOptionContract(conid, cache)] as const,
    );
    return new Map(contracts);
  }

  private async listAccountPositions(
    accountId: string,
    requireComplete = false,
    riskOptionContractCache: IbkrRiskOptionContractCache = new Map(),
  ): Promise<BrokerPositionSnapshot[]> {
    this.assertPaperAccounts([accountId]);
    const positions: BrokerPositionSnapshot[] = [];
    const seenPositionIds = new Set<string>();
    let pageId = 0;

    while (pageId < IBKR_MAX_POSITION_PAGES) {
      const payload = await this.request<unknown>(
        requireComplete
          ? `/portfolio2/${encodeURIComponent(accountId)}/positions`
          : `/portfolio/${encodeURIComponent(accountId)}/positions/${pageId}`,
      );
      const rawPage = Array.isArray(payload) ? payload : null;
      const page = compact(asArray(payload).map(asRecord));

      if (
        requireComplete &&
        (!rawPage || rawPage.length !== page.length)
      ) {
        throw new HttpError(502, "IBKR returned invalid position evidence.", {
          code: "ibkr_positions_snapshot_invalid",
          expose: false,
        });
      }

      if (page.length === 0) {
        return positions;
      }

      const riskOptionContracts = requireComplete
        ? await this.hydrateRiskOptionContracts(
            page,
            riskOptionContractCache,
          )
        : new Map<number, IbkrRiskOptionContract>();

      const normalizedPage = compact(
        page.map((position) => {
          const providerConid = firstDefined(
            asNumber(position["conid"]),
            asNumber(position["con_id"]),
          );
          const providerContractId =
            providerConid === null ? null : String(providerConid);
          const positionAccountId = firstDefined(
            asString(position["acctId"]),
            asString(position["accountId"]),
          );
          const providerSecurityType =
            firstDefined(
              asString(position["secType"]),
              asString(position["assetClass"]),
            ) ?? null;
          const assetClass = normalizeAssetClass(
            firstDefined(
              asString(position["assetClass"]),
              asString(position["secType"]),
            ),
          );
          const quantity = asNumber(position["position"]);

          if (
            !assetClass ||
            quantity === null ||
            (requireComplete &&
              (!providerContractId ||
                providerConid === null ||
                providerConid <= 0 ||
                !Number.isSafeInteger(providerConid) ||
                (positionAccountId !== null &&
                  positionAccountId !== accountId)))
          ) {
            return null;
          }

          const optionContract =
            assetClass === "option"
              ? requireComplete
                ? providerConid === null
                  ? null
                  : riskOptionContracts.get(providerConid) ?? null
                : parseOptionDetails(position)
              : null;
          if (requireComplete && assetClass === "option" && !optionContract) {
            return null;
          }
          const symbol =
            assetClass === "option"
              ? (optionContract?.underlying ??
                normalizeSymbol(asString(position["ticker"]) ?? ""))
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
          const multiplier = optionContract?.sharesPerContract ?? 1;
          const marketValue =
            firstDefined(
              asNumber(position["mktValue"]),
              asNumber(position["marketValue"]),
            ) ?? marketPrice * quantity * multiplier;
          const unrealizedPnl =
            firstDefined(
              asNumber(position["unrealizedPnl"]),
              asNumber(position["unrealized_pnl"]),
            ) ?? 0;
          const denominator =
            Math.abs(averagePrice * quantity * multiplier) ||
            Math.abs(marketValue) ||
            1;

          return {
            id: `${accountId}:${providerContractId ?? symbol}`,
            accountId,
            symbol,
            assetClass,
            providerSecurityType,
            quantity,
            averagePrice,
            marketPrice,
            marketValue,
            unrealizedPnl,
            unrealizedPnlPercent: (unrealizedPnl / denominator) * 100,
            optionContract,
          };
        }),
      );
      if (requireComplete && normalizedPage.length !== page.length) {
        throw new HttpError(502, "IBKR returned invalid position evidence.", {
          code: "ibkr_positions_snapshot_invalid",
          expose: false,
        });
      }
      if (
        requireComplete &&
        (new Set(normalizedPage.map((position) => position.id)).size !==
          normalizedPage.length ||
          normalizedPage.some((position) => seenPositionIds.has(position.id)))
      ) {
        throw new HttpError(502, "IBKR returned duplicate position evidence.", {
          code: "ibkr_positions_snapshot_invalid",
          expose: false,
        });
      }
      normalizedPage.forEach((position) => seenPositionIds.add(position.id));
      positions.push(...normalizedPage);

      if (requireComplete) {
        return positions;
      }

      if (page.length < IBKR_POSITION_PAGE_SIZE) {
        return positions;
      }

      pageId += 1;
    }

    throw new HttpError(502, "IBKR position paging did not terminate.", {
      code: "ibkr_positions_snapshot_incomplete",
      expose: false,
    });
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    const accountIds = input.accountId
      ? [input.accountId]
      : (await this.getPortfolioAccounts()).flatMap((account) => {
          const accountId =
            firstDefined(
              asString(account["accountId"]),
              asString(account["id"]),
            ) ?? null;
          return accountId ? [accountId] : [];
        });
    this.assertPaperAccounts(accountIds);

    const positions = await Promise.all(
      accountIds.map((accountId) => this.listAccountPositions(accountId)),
    );

    return positions.flat();
  }

  async listOrders(input: IbkrListOrdersInput): Promise<BrokerOrderSnapshot[]> {
    return this.listOrdersInternal(input, new Map());
  }

  private async listOrdersInternal(
    input: IbkrListOrdersInternalInput,
    riskOptionContractCache: IbkrRiskOptionContractCache,
  ): Promise<BrokerOrderSnapshot[]> {
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
    this.assertPaperAccounts(accountIds);

    const orderLists: BrokerOrderSnapshot[][] = [];
    let activeTradingAccounts = tradingAccounts;

    for (const accountId of accountIds) {
      activeTradingAccounts = await this.ensureActiveTradingAccount(
        accountId,
        activeTradingAccounts,
      );
      const payload = await this.request<unknown>(
        "/iserver/account/orders",
        {},
        {
          force: true,
        },
      );
      const record = asRecord(payload);
      const rawOrders = Array.isArray(record?.["orders"])
        ? (record["orders"] as unknown[])
        : null;
      if (
        input.requireComplete === true &&
        (strictBoolean(record?.["snapshot"]) !== true ||
          !rawOrders ||
          rawOrders.length >= IBKR_MAX_ORDER_SNAPSHOT_SIZE)
      ) {
        throw new HttpError(502, "IBKR order evidence is incomplete.", {
          code: "ibkr_orders_snapshot_incomplete",
          expose: false,
        });
      }
      // IBKR calls this its live-order snapshot and documents working orders
      // as members, while the same reference also describes the response as
      // day-scoped. A forced snapshot below the hard 1000-row cap is the
      // provider proof used here; capped or non-snapshot evidence fails shut.
      const orderRows = rawOrders ?? asArray(record?.["orders"]);
      const riskOrderRecords = compact(orderRows.map(asRecord)).filter(
        (order) => {
          const filledQuantity = firstDefined(
            asNumber(order["filledQuantity"]),
            asNumber(order["filled_quantity"]),
          );
          const remainingQuantity = firstDefined(
            asNumber(order["remainingQuantity"]),
            asNumber(order["remaining_quantity"]),
          );
          const statusValue = firstDefined(
            asString(order["order_ccp_status"]),
            asString(order["status"]),
          );
          return (
            filledQuantity !== null &&
            remainingQuantity !== null &&
            hasRecognizedOrderStatus(
              statusValue,
              filledQuantity,
              remainingQuantity,
            ) &&
            RISK_WORKING_ORDER_STATUSES.has(
              normalizeOrderStatus(
                statusValue,
                filledQuantity,
                remainingQuantity,
              ),
            )
          );
        },
      );
      const riskOptionContracts =
        input.requireComplete === true
          ? await this.hydrateRiskOptionContracts(
              riskOrderRecords,
              riskOptionContractCache,
            )
          : new Map<number, IbkrRiskOptionContract>();
      let invalidOrderEvidence = false;
      const seenOrderIds = new Set<string>();
      const orders = compact(
        orderRows.map((order) => {
          const raw = asRecord(order);
          if (!raw) {
            invalidOrderEvidence = true;
            return null;
          }

          const filledQuantity = firstDefined(
            asNumber(raw["filledQuantity"]),
            asNumber(raw["filled_quantity"]),
          );
          const remainingQuantity = firstDefined(
            asNumber(raw["remainingQuantity"]),
            asNumber(raw["remaining_quantity"]),
          );
          if (
            filledQuantity === null ||
            filledQuantity < 0 ||
            remainingQuantity === null ||
            remainingQuantity < 0
          ) {
            invalidOrderEvidence = true;
            return null;
          }
          const statusValue = firstDefined(
            asString(raw["order_ccp_status"]),
            asString(raw["status"]),
          );
          const status = normalizeOrderStatus(
            statusValue,
            filledQuantity,
            remainingQuantity,
          );
          const recognizedStatus = hasRecognizedOrderStatus(
            statusValue,
            filledQuantity,
            remainingQuantity,
          );
          if (input.requireComplete === true && !recognizedStatus) {
            invalidOrderEvidence = true;
            return null;
          }
          if (
            input.requireComplete === true &&
            !RISK_WORKING_ORDER_STATUSES.has(status)
          ) {
            return null;
          }
          const providerConid = firstDefined(
            asNumber(raw["conid"]),
            asNumber(raw["conidex"]),
          );
          const orderId = firstDefined(
            asString(raw["orderId"]),
            asString(raw["order_id"]),
          );
          const orderAccountId = firstDefined(
            asString(raw["acct"]),
            asString(raw["account"]),
            accountId,
          );
          const rawSide = asString(raw["side"]);
          const rawOrderType = firstDefined(
            asString(raw["origOrderType"]),
            asString(raw["orderType"]),
          );
          const orderType = normalizeOrderType(rawOrderType);
          const rawTimeInForce = asString(raw["timeInForce"]);
          const quantity = firstDefined(
            asNumber(raw["totalSize"]),
            asNumber(raw["size"]),
            asNumber(raw["quantity"]),
          );
          const assetClass = normalizeAssetClass(
            firstDefined(asString(raw["secType"]), asString(raw["assetClass"])),
          );
          const rawSymbol = normalizeSymbol(
            firstDefined(
              asString(raw["ticker"]),
              asString(raw["description1"]),
              asString(raw["description"]),
              "",
            ) ?? "",
          );
          const optionContract =
            assetClass === "option"
              ? input.requireComplete === true
                ? providerConid === null
                  ? null
                  : riskOptionContracts.get(providerConid) ?? null
                : parseOptionDetails(raw)
              : null;
          const symbol =
            assetClass === "option"
              ? (optionContract?.underlying ?? rawSymbol)
              : rawSymbol;

          if (
            input.requireComplete === true &&
            (!orderId ||
              seenOrderIds.has(orderId) ||
              orderAccountId !== accountId ||
              providerConid === null ||
              providerConid <= 0 ||
              !Number.isSafeInteger(providerConid) ||
              !symbol ||
              !assetClass ||
              (rawSide?.trim().toUpperCase() !== "BUY" &&
                rawSide?.trim().toUpperCase() !== "SELL") ||
              !hasRecognizedOrderType(rawOrderType) ||
              !hasRecognizedTimeInForce(rawTimeInForce) ||
              !recognizedStatus ||
              quantity === null ||
              quantity <= 0 ||
              filledQuantity + remainingQuantity > quantity + 1e-9 ||
              (assetClass === "option" && !optionContract))
          ) {
            invalidOrderEvidence = true;
            return null;
          }
          if (orderId) seenOrderIds.add(orderId);

          const mapped: BrokerOrderSnapshot = {
            id: orderId ?? randomUUID(),
            accountId: orderAccountId ?? accountId,
            clientOrderId:
              firstDefined(
                asString(raw["order_ref"]),
                asString(raw["orderRef"]),
              ) ?? null,
            providerContractId:
              providerConid === null ? null : String(providerConid),
            mode: input.mode,
            symbol: symbol || "UNKNOWN",
            assetClass: assetClass ?? "equity",
            side: normalizeOrderSide(rawSide),
            type: orderType,
            timeInForce: normalizeTimeInForce(rawTimeInForce),
            status,
            quantity: quantity ?? 0,
            filledQuantity,
            limitPrice:
              orderType === "limit" || orderType === "stop_limit"
                ? asNumber(raw["price"])
                : null,
            stopPrice:
              orderType === "stop"
                ? asNumber(raw["price"])
                : orderType === "stop_limit"
                  ? asNumber(raw["auxPrice"])
                  : null,
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
            optionContract,
          };

          return input.status && mapped.status !== input.status ? null : mapped;
        }),
      );

      if (input.requireComplete === true && invalidOrderEvidence) {
        throw new HttpError(502, "IBKR returned invalid order evidence.", {
          code: "ibkr_orders_snapshot_invalid",
          expose: false,
        });
      }

      orderLists.push(orders);
    }

    return orderLists.flat();
  }

  async readAccountRiskState(input: {
    accountId: string;
    mode: RuntimeMode;
    selectedOptionContractId?: string | null;
  }): Promise<IbkrAccountRiskStateSnapshot> {
    const accountId = input.accountId.trim();
    if (!accountId) {
      throw new HttpError(400, "An IBKR account is required.", {
        code: "ibkr_missing_account_id",
      });
    }
    this.assertPaperAccounts([accountId]);
    const selectedOptionContractId =
      asString(input.selectedOptionContractId)?.trim() ?? null;
    const selectedOptionConid = asNumber(selectedOptionContractId);
    if (
      selectedOptionContractId !== null &&
      (selectedOptionConid === null ||
        selectedOptionConid <= 0 ||
        !Number.isSafeInteger(selectedOptionConid) ||
        String(selectedOptionConid) !== selectedOptionContractId)
    ) {
      throw new HttpError(400, "The selected IBKR option contract is invalid.", {
        code: "ibkr_option_contract_id_invalid",
        expose: true,
      });
    }

    // The portfolio accounts request is the documented preflight for every
    // /portfolio/{accountId} read and also proves the selected account exists.
    const portfolioAccounts = await this.getPortfolioAccounts();
    const portfolioAccount = portfolioAccounts.find(
      (account) =>
        firstDefined(
          asString(account["accountId"]),
          asString(account["id"]),
        ) === accountId,
    );
    if (!portfolioAccount) {
      throw new HttpError(404, "The IBKR account was not found.", {
        code: "ibkr_account_not_found",
        expose: true,
      });
    }

    // Keep these reads sequential so option-contract hydration never exceeds
    // IBKR's documented five-concurrent-request ceiling. The per-read cache
    // also makes a conid shared by a position and order hydrate only once.
    const riskOptionContractCache: IbkrRiskOptionContractCache = new Map();
    const positionsObservedAt = new Date();
    const positions = await this.listAccountPositions(
      accountId,
      true,
      riskOptionContractCache,
    );
    const positionRead = { positions, observedAt: positionsObservedAt };
    const ordersObservedAt = new Date();
    const orders = await this.listOrdersInternal(
      {
        accountId,
        mode: input.mode,
        requireComplete: true,
      },
      riskOptionContractCache,
    );
    const orderRead = { orders, observedAt: ordersObservedAt };
    const selectedOptionContract =
      selectedOptionConid === null
        ? null
        : await this.getRiskOptionContract(
            selectedOptionConid,
            riskOptionContractCache,
          );
    const settledCashObservedAt = new Date();
    const cashRead = await Promise.all([
      this.getAccountSummary(accountId),
      this.getAccountLedger(accountId),
    ]).then(([summary, ledger]) => {
      const usdLedger = asRecord(findCaseInsensitiveValue(ledger ?? {}, "USD"));
      const baseCurrency = firstDefined(
        asString(portfolioAccount["currency"]),
        asString(this.getBaseLedger(ledger)?.["currency"]),
      )?.toUpperCase();
      const settledCashUsd = firstDefined(
        findMetric(usdLedger, ["settledcash"]),
        baseCurrency === "USD" ? findMetric(summary, ["settledcash"]) : null,
      );
      return { settledCashUsd, observedAt: settledCashObservedAt };
    });
    const allOptionContracts = [
      ...(selectedOptionContract ? [selectedOptionContract] : []),
      ...positionRead.positions.flatMap((position) =>
        position.optionContract ? [position.optionContract] : [],
      ),
      ...orderRead.orders.flatMap((order) =>
        order.optionContract ? [order.optionContract] : [],
      ),
    ];
    const verifiedStandardOptionContractIds = Array.from(
      new Set(
        allOptionContracts.flatMap((contract) =>
          contract.standardDeliverableVerified === true &&
          contract.providerContractId
            ? [contract.providerContractId]
            : [],
        ),
      ),
    );
    const collateralContracts = [
      ...positionRead.positions.flatMap((position) =>
        position.assetClass === "option" &&
        position.optionContract?.right === "put" &&
        position.quantity < 0
          ? [position.optionContract]
          : [],
      ),
      ...orderRead.orders.flatMap((order) =>
        RISK_WORKING_ORDER_STATUSES.has(order.status) &&
        order.assetClass === "option" &&
        order.side === "sell" &&
        order.optionContract?.right === "put"
          ? [order.optionContract]
          : [],
      ),
    ];

    return {
      accountId,
      mode: input.mode,
      positions: positionRead.positions,
      positionsComplete: true,
      positionsObservedAt: positionRead.observedAt,
      orders: orderRead.orders,
      ordersComplete: true,
      ordersObservedAt: orderRead.observedAt,
      settledCashUsd: cashRead.settledCashUsd,
      settledCashObservedAt: cashRead.observedAt,
      optionCollateralContractsVerified: collateralContracts.every(
        (contract) => contract.standardDeliverableVerified === true,
      ),
      verifiedStandardOptionContractIds,
    };
  }

  async listExecutions(input: {
    accountId?: string;
    mode?: RuntimeMode;
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
    const payload = await this.request<unknown>(
      "/iserver/account/trades",
      {},
      {
        days: clampedDays,
      },
    );
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
          firstDefined(asString(raw["conid"]), asString(raw["conidEx"])) ??
          null;
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
            firstDefined(asString(raw["sec_type"]), asString(raw["secType"])),
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
          contractDescription: asString(raw["contract_description_2"]) ?? null,
          providerContractId,
          optionContract:
            assetClass === "option" ? parseOptionDetails(raw) : null,
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

    await Promise.all(
      conidBatches.map((conidBatch) =>
        this.request<unknown>(
          "/iserver/marketdata/snapshot",
          { signal },
          {
            conids: conidBatch.join(","),
            fields: fieldList,
          },
        ),
      ),
    );

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

    const batchResults = await Promise.all(
      chunk(requests, SNAPSHOT_BATCH_SIZE).map(async (requestBatch) => {
        const payload = await this.request<unknown>(
          "/iserver/marketdata/snapshot",
          { signal },
          {
            conids: requestBatch.map((request) => request.conid).join(","),
            fields,
          },
        );

        return {
          requestBatch,
          rows: compact(asArray(payload).map(asRecord)),
        };
      }),
    );

    batchResults.forEach(({ requestBatch, rows }) => {
      rows.forEach((row) => {
        const conid = asString(row["conid"]) ?? asString(row["conidEx"]);
        if (!conid) {
          return;
        }

        const request = requestBatch.find(
          (candidate) => String(candidate.conid) === conid,
        );
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
    });

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

    return resolved.map(
      ({ symbol, contract }) =>
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
          extendedBaselinePrice: null,
          extendedBaselineAt: null,
          extendedBaselineSource: null,
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
        },
    );
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
    exchange?: string | null;
  }): Promise<BrokerBarSnapshot[]> {
    return this.withHistoryRequestPermit(async () => {
      const timeframe = input.timeframe;
      const bar = HISTORY_TIMEFRAME_TO_BAR[timeframe];
      if (!bar) {
        throw new HttpError(
          400,
          "IBKR Client Portal historical bars do not support this timeframe.",
          {
            code: "ibkr_history_timeframe_unsupported",
            data: { timeframe },
          },
        );
      }
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
      const exchange =
        normalizeHistoricalDataExchange(input.exchange) ??
        resolvedContract.listingExchange;
      const collected = new Map<number, BrokerBarSnapshot>();
      let remainingBars = desiredBars;
      let cursor = new Date(to);
      let safety = 0;
      const maxPages = HISTORY_TIMEFRAME_MAX_PAGES[timeframe];

      while (remainingBars > 0 && safety < maxPages) {
        const chunkBars = Math.min(remainingBars, HISTORY_RESPONSE_MAX_POINTS);
        const historyArgs = {
          conid: resolvedContract.conid,
          exchange,
          period: buildHistoryPeriod(timeframe, chunkBars, outsideRth),
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
              typeof (error as { statusCode?: unknown })?.statusCode ===
              "number"
                ? (error as { statusCode: number }).statusCode
                : undefined;
            const detail = (error as { detail?: unknown })?.detail;
            const cause = (error as { cause?: unknown })?.cause;
            const haystack = [
              error instanceof Error ? error.message : String(error ?? ""),
              typeof detail === "string"
                ? detail
                : JSON.stringify(detail ?? ""),
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
        .filter(
          (barPoint) =>
            (!input.from ||
              barPoint.timestamp.getTime() >= input.from.getTime()) &&
            (!input.to || barPoint.timestamp.getTime() <= input.to.getTime()),
        );

      return sorted.slice(-(input.limit ?? sorted.length));
    });
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: OptionRight | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    strikeCoverage?: OptionChainStrikeCoverage;
    quoteHydration?: OptionChainQuoteHydration;
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    return this.withOptionChainRequestPermit(async () => {
      const signal = input.signal;
      throwIfAborted(signal);
      const searchResults = await this.searchSecurities(input.underlying, {
        signal,
      });
      const normalizedUnderlying = normalizeSymbol(input.underlying);
      const match =
        searchResults.find(
          (result) =>
            normalizeSymbol(asString(result["symbol"]) ?? "") ===
            normalizedUnderlying,
        ) ?? searchResults[0];

      if (!match) {
        throw new HttpError(
          404,
          `Unable to resolve IBKR contract for ${input.underlying}.`,
          {
            code: "ibkr_contract_not_found",
          },
        );
      }

      const underlyingConid = asNumber(match["conid"]);
      if (underlyingConid === null) {
        throw new HttpError(
          502,
          `IBKR returned an invalid contract identifier for ${input.underlying}.`,
          {
            code: "ibkr_invalid_conid",
          },
        );
      }

      const optionSection = compact(
        asArray(match["sections"]).map(asRecord),
      ).find((section) => asString(section["secType"]) === "OPT");
      const months = (asString(optionSection?.["months"]) ?? "")
        .split(";")
        .map((month) => month.trim())
        .filter(Boolean);

      const requestedMonth = input.expirationDate
        ? toIbkrMonthCode(input.expirationDate)
        : null;
      const maxExpirations = positiveIntegerOrDefault(
        input.maxExpirations,
        DEFAULT_OPTION_CHAIN_EXPIRATIONS,
      );
      const candidateMonths = requestedMonth
        ? months.filter((month) => month === requestedMonth)
        : months.slice(0, maxExpirations);

      const underlyingQuote = (
        await this.getMarketDataSnapshotMap(
          [
            {
              conid: underlyingConid,
              symbol: normalizedUnderlying,
              assetClass: "equity",
            },
          ],
          signal,
        )
      ).get(String(underlyingConid));
      const spotPrice = underlyingQuote?.price ?? 0;
      const strikesAroundMoney = positiveIntegerOrDefault(
        input.strikesAroundMoney,
        DEFAULT_OPTION_CHAIN_STRIKES_AROUND_MONEY,
      );
      const rights: OptionRight[] = input.contractType
        ? [input.contractType]
        : ["call", "put"];
      const quoteHydration = input.quoteHydration ?? "metadata";

      const contracts = (
        await Promise.all(
          candidateMonths.map(
            async (
              month,
            ): Promise<
              NonNullable<BrokerPositionSnapshot["optionContract"]>[]
            > => {
              const strikes = await this.getCachedOptionStrikes(
                {
                  conid: underlyingConid,
                  month,
                },
                signal,
              );

              const relevantStrikes =
                input.strikeCoverage !== "full" &&
                spotPrice > 0 &&
                strikes.length > strikesAroundMoney * 2 + 1
                  ? (() => {
                      const closestIndex = strikes.reduce(
                        (bestIndex, strike, index) =>
                          Math.abs(strike - spotPrice) <
                          Math.abs(strikes[bestIndex] - spotPrice)
                            ? index
                            : bestIndex,
                        0,
                      );
                      const start = Math.max(
                        0,
                        closestIndex - strikesAroundMoney,
                      );
                      const end = Math.min(
                        strikes.length,
                        closestIndex + strikesAroundMoney + 1,
                      );
                      return strikes.slice(start, end);
                    })()
                  : strikes;

              const contractRequests = relevantStrikes.flatMap((strike) =>
                rights.map((right) => ({ strike, right })),
              );
              const contractGroups = await mapWithConcurrency(
                contractRequests,
                OPTION_CHAIN_CONTRACT_INFO_CONCURRENCY,
                async ({
                  strike,
                  right,
                }): Promise<
                  NonNullable<BrokerPositionSnapshot["optionContract"]>[]
                > => {
                  const matches = await this.getCachedOptionInfo(
                    {
                      conid: underlyingConid,
                      month,
                      strike,
                      right,
                    },
                    signal,
                  );
                  const parsedMatches = compact(
                    matches.map((record) => {
                      const optionContract = parseOptionDetails(record);
                      if (!optionContract) {
                        return null;
                      }

                      if (
                        input.expirationDate &&
                        optionContract.expirationDate
                          .toISOString()
                          .slice(0, 10) !==
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
                    parsedMatches
                      .reduce<
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
                        const expiryKey =
                          candidate.optionContract.expirationDate
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
                            : existingTradingClass.startsWith(
                                  normalizedUnderlying,
                                )
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
                },
                signal,
              );

              return contractGroups.flat();
            },
          ),
        )
      ).flat();

      const uniqueContracts = Array.from(
        new Map(
          contracts.map((contract) => [
            contract.providerContractId ?? contract.ticker,
            contract,
          ]),
        ).values(),
      )
        .filter((contract) => {
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
        })
        .sort(
          (left, right) =>
            left.expirationDate.getTime() - right.expirationDate.getTime() ||
            left.strike - right.strike ||
            left.right.localeCompare(right.right),
        );
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
            allowedExpirations.has(
              contract.expirationDate.toISOString().slice(0, 10),
            ),
          )
        : uniqueContracts;
      let quoteMap = new Map<string, QuoteSnapshot>();

      if (quoteHydration === "snapshot") {
        const quoteRequests = scopedContracts.flatMap((contract) => {
          const conid = asNumber(contract.providerContractId);
          return conid === null
            ? []
            : [
                {
                  conid,
                  symbol: contract.ticker,
                  assetClass: "option" as const,
                },
              ];
        });

        try {
          quoteMap = await this.getMarketDataSnapshotMap(quoteRequests, signal);
        } catch {
          // Contract metadata is still useful when IBKR has no live option quote
          // snapshot available or an OPRA snapshot request times out.
          quoteMap = new Map<string, QuoteSnapshot>();
        }
      }

      return scopedContracts
        .map((contract) => {
          const quote = contract.providerContractId
            ? quoteMap.get(contract.providerContractId)
            : null;
          return toOptionChainContract(contract, quote ?? null);
        })
        .sort(
          (left, right) =>
            left.contract.expirationDate.getTime() -
              right.contract.expirationDate.getTime() ||
            left.contract.strike - right.contract.strike ||
            left.contract.right.localeCompare(right.contract.right),
        );
    }, input.signal);
  }

  async getOptionExpirations(input: {
    underlying: string;
    maxExpirations?: number;
    signal?: AbortSignal;
  }): Promise<Date[]> {
    return this.withOptionChainRequestPermit(async () => {
      const signal = input.signal;
      throwIfAborted(signal);
      const searchResults = await this.searchSecurities(input.underlying, {
        signal,
      });
      const normalizedUnderlying = normalizeSymbol(input.underlying);
      const match =
        searchResults.find(
          (result) =>
            normalizeSymbol(asString(result["symbol"]) ?? "") ===
            normalizedUnderlying,
        ) ?? searchResults[0];

      if (!match) {
        throw new HttpError(
          404,
          `Unable to resolve IBKR contract for ${input.underlying}.`,
          {
            code: "ibkr_contract_not_found",
          },
        );
      }

      const underlyingConid = asNumber(match["conid"]);
      if (underlyingConid === null) {
        throw new HttpError(
          502,
          `IBKR returned an invalid contract identifier for ${input.underlying}.`,
          {
            code: "ibkr_invalid_conid",
          },
        );
      }

      const optionSection = compact(
        asArray(match["sections"]).map(asRecord),
      ).find((section) => asString(section["secType"]) === "OPT");
      const months = (asString(optionSection?.["months"]) ?? "")
        .split(";")
        .map((month) => month.trim())
        .filter(Boolean);
      const maxExpirations =
        typeof input.maxExpirations === "number" &&
        Number.isFinite(input.maxExpirations)
          ? Math.max(1, Math.floor(input.maxExpirations))
          : null;
      const candidateMonths =
        maxExpirations === null ? months : months.slice(0, maxExpirations);
      const underlyingQuote = await this.getMarketDataSnapshotMap(
        [
          {
            conid: underlyingConid,
            symbol: normalizedUnderlying,
            assetClass: "equity",
          },
        ],
        signal,
      ).catch(() => new Map<string, QuoteSnapshot>());
      const spotPrice =
        underlyingQuote.get(String(underlyingConid))?.price ?? 0;
      const todayUtc = startOfUtcDay();
      const expirations = new Map<string, Date>();

      await mapWithConcurrency(
        candidateMonths,
        Math.min(OPTION_CHAIN_CONTRACT_INFO_CONCURRENCY, 8),
        async (month) => {
          const strikes = await this.getCachedOptionStrikes(
            {
              conid: underlyingConid,
              month,
            },
            signal,
          );
          if (!strikes.length) {
            return;
          }

          const closestIndex =
            spotPrice > 0
              ? strikes.reduce(
                  (bestIndex, strike, index) =>
                    Math.abs(strike - spotPrice) <
                    Math.abs(strikes[bestIndex] - spotPrice)
                      ? index
                      : bestIndex,
                  0,
                )
              : Math.floor(strikes.length / 2);
          const probeStrike = strikes[closestIndex] ?? strikes[0];
          const matches = await this.getCachedOptionInfo(
            {
              conid: underlyingConid,
              month,
              strike: probeStrike,
              right: "call",
            },
            signal,
          );

          matches.forEach((record) => {
            const optionContract = parseOptionDetails(record);
            const expirationDate = optionContract?.expirationDate;
            if (!expirationDate || expirationDate.getTime() < todayUtc) {
              return;
            }

            expirations.set(
              expirationDate.toISOString().slice(0, 10),
              expirationDate,
            );
          });
        },
        signal,
      );

      const sortedExpirations = Array.from(expirations.values()).sort(
        (left, right) => left.getTime() - right.getTime(),
      );

      return maxExpirations === null
        ? sortedExpirations
        : sortedExpirations.slice(0, maxExpirations);
    }, input.signal);
  }

  private async resolveStockContract(symbol: string): Promise<{
    conid: number;
    secType: string;
    listingExchange: string;
  }> {
    // IBKR represents share-class tickers with a space (e.g. "BRK B"), while the
    // rest of the platform uses Massive's dotted style (e.g. "BRK.B"). Try the
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
            normalizeSymbol(asString(result["symbol"]) ?? "") ===
            normalizeSymbol(symbol),
        ) ??
        results[0];
      if (match) break;
    }

    if (!match) {
      throw new HttpError(
        404,
        `Unable to resolve IBKR contract for ${symbol}.`,
        {
          code: "ibkr_contract_not_found",
        },
      );
    }

    const conid = asNumber(match["conid"]);

    if (conid === null) {
      throw new HttpError(
        502,
        `IBKR returned an invalid contract identifier for ${symbol}.`,
        {
          code: "ibkr_invalid_conid",
        },
      );
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

  async resolveStockContracts(
    symbols: string[],
  ): Promise<ResolvedIbkrContract[]> {
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

  async resolveOptionOrderContract(
    optionContract: NonNullable<PlaceOrderInput["optionContract"]>,
  ): Promise<NonNullable<PlaceOrderInput["optionContract"]>> {
    const resolved = await this.resolveOptionContract(optionContract);
    return {
      ...optionContract,
      providerContractId: String(resolved.conid),
    };
  }

  private async resolveOptionContract(
    optionContract: NonNullable<PlaceOrderInput["optionContract"]>,
  ): Promise<{
    conid: number;
    secType: string;
    listingExchange: string;
  }> {
    const providedContractId = asString(
      optionContract.providerContractId,
    )?.trim();
    const providedConid = asNumber(optionContract.providerContractId);

    if (providedConid !== null) {
      if (
        !providedContractId ||
        String(providedConid) !== providedContractId ||
        !Number.isSafeInteger(providedConid) ||
        providedConid <= 0
      ) {
        throw new HttpError(409, "The selected IBKR option contract is invalid.", {
          code: "ibkr_option_contract_id_invalid",
          expose: true,
        });
      }
      const verified = await this.getRiskOptionContract(
        providedConid,
        new Map(),
      );
      if (!sameOptionContractEconomics(optionContract, verified)) {
        throw new HttpError(
          409,
          "The selected IBKR option contract does not match its broker identifier.",
          {
            code: "ibkr_option_contract_identity_mismatch",
            expose: true,
          },
        );
      }
      return {
        conid: providedConid,
        secType: "OPT",
        listingExchange: "SMART",
      };
    }

    const underlying = await this.resolveStockContract(
      optionContract.underlying,
    );
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
    const expectedExpiration = optionContract.expirationDate
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, "");
    const match = results.find((result) => {
      const maturity = firstDefined(
        asString(result["maturityDate"]),
        asString(result["maturity_date"]),
        asString(result["expiry"]),
      );
      const strike = asNumber(result["strike"]);
      const right = normalizeOptionRight(asString(result["right"]));

      return (
        maturity === expectedExpiration &&
        strike === optionContract.strike &&
        right === optionContract.right
      );
    });

    if (!match) {
      throw new HttpError(
        404,
        `Unable to resolve IBKR option contract for ${optionContract.ticker}.`,
        {
          code: "ibkr_option_contract_not_found",
        },
      );
    }

    const conid = firstDefined(
      asNumber(match["conid"]),
      asNumber(match["con_id"]),
    );

    if (conid === null) {
      throw new HttpError(
        502,
        "IBKR returned an invalid option contract identifier.",
        {
          code: "ibkr_invalid_option_conid",
        },
      );
    }
    const verified = await this.getRiskOptionContract(conid, new Map());
    if (!sameOptionContractEconomics(optionContract, verified)) {
      throw new HttpError(
        409,
        "The resolved IBKR option contract does not match the selected contract.",
        {
          code: "ibkr_option_contract_identity_mismatch",
          expose: true,
        },
      );
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

  private requireOrderAcknowledgement(
    responsePayload: unknown,
    requestEpoch: number,
  ): Record<string, unknown> {
    const response = classifyIbkrOrderResponse(responsePayload);
    if (
      response.ambiguous ||
      (response.brokerError && (response.acknowledgement || response.warning))
    ) {
      throw new HttpError(
        502,
        "IBKR returned an ambiguous order acknowledgement.",
        { code: "ibkr_ambiguous_order_ack" },
      );
    }
    if (response.brokerError) {
      throw new HttpError(409, "IBKR rejected the order request.", {
        code: "ibkr_order_rejected",
        detail: asString(response.brokerError["error"]) ?? undefined,
        expose: true,
      });
    }
    if (response.acknowledgement) {
      return response.acknowledgement;
    }

    if (response.warning) {
      const replyId = asString(response.warning["id"]);
      const messages = compact(
        asArray(response.warning["message"]).map(asString),
      );
      throw new HttpError(
        409,
        "IBKR requires explicit review of an order warning.",
        {
          code: "ibkr_order_warning_confirmation_required",
          data: { replyId, messages, requestEpoch },
          expose: true,
        },
      );
    }

    throw new HttpError(
      502,
      "IBKR order submission did not return a final order acknowledgement.",
      {
        code: "ibkr_missing_order_ack",
      },
    );
  }

  async replyOrderWarning(input: {
    replyId: string;
    confirmed: boolean;
    expectedRequestEpoch: number;
  }): Promise<
    | { kind: "declined" }
    | {
        kind: "warning";
        replyId: string;
        messages: string[];
        requestEpoch: number;
      }
    | {
        kind: "acknowledged";
        acknowledgement: Record<string, unknown>;
      }
  > {
    const replyId = input.replyId.trim();
    if (
      !replyId ||
      replyId.length > 256 ||
      !Number.isSafeInteger(input.expectedRequestEpoch) ||
      input.expectedRequestEpoch < 0
    ) {
      throw new HttpError(409, "The IBKR order warning reply is invalid.", {
        code: "ibkr_order_reply_invalid",
        expose: true,
      });
    }
    const { payload, requestEpoch } = await this.requestWithEpoch<unknown>(
      `/iserver/reply/${encodeURIComponent(replyId)}`,
      {
        method: "POST",
        body: JSON.stringify({ confirmed: input.confirmed }),
      },
      {},
      input.expectedRequestEpoch,
    );
    const response = classifyIbkrOrderResponse(payload);
    if (!input.confirmed) {
      const decline =
        response.results.length === 1 ? response.results[0] : null;
      if (
        !response.ambiguous &&
        decline &&
        Object.keys(decline).every((key) => key === "status") &&
        normalizeMetricKey(asString(decline["status"]) ?? "") === "discarded"
      ) {
        return { kind: "declined" };
      }
      throw new HttpError(
        502,
        "IBKR returned an ambiguous order decline reply.",
        {
          code: "ibkr_ambiguous_order_ack",
        },
      );
    }
    if (
      response.ambiguous ||
      (response.brokerError && (response.acknowledgement || response.warning))
    ) {
      throw new HttpError(
        502,
        "IBKR returned an ambiguous order acknowledgement.",
        { code: "ibkr_ambiguous_order_ack" },
      );
    }
    if (response.brokerError) {
      throw new HttpError(409, "IBKR rejected the order request.", {
        code: "ibkr_order_rejected",
        detail: asString(response.brokerError["error"]) ?? undefined,
        expose: true,
      });
    }
    if (response.acknowledgement) {
      return {
        kind: "acknowledged",
        acknowledgement: response.acknowledgement,
      };
    }
    const nextReplyId = asString(response.warning?.["id"]);
    if (response.warning && nextReplyId) {
      return {
        kind: "warning",
        replyId: nextReplyId,
        messages: compact(asArray(response.warning["message"]).map(asString)),
        requestEpoch,
      };
    }
    throw new HttpError(
      502,
      "IBKR order reply did not return a final acknowledgement.",
      { code: "ibkr_missing_order_ack" },
    );
  }

  private async buildStructuredOrderBody(input: PlaceOrderInput): Promise<{
    accountId: string;
    body: Record<string, unknown>;
    resolvedContractId: number;
  }> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new HttpError(
        409,
        "IBKR share and contract quantities must be whole numbers.",
        {
          code: "ibkr_order_quantity_invalid",
          expose: true,
        },
      );
    }
    const tradingAccounts = await this.getTradingAccountsInfo();
    const accountId = input.accountId.trim();

    if (!accountId) {
      throw new HttpError(
        400,
        "No IBKR account was provided for order placement.",
        {
          code: "ibkr_missing_account_id",
        },
      );
    }
    if (!tradingAccounts.accounts.includes(accountId)) {
      throw new HttpError(409, "The selected IBKR account is not tradable.", {
        code: "ibkr_order_account_not_tradable",
        expose: true,
      });
    }
    this.assertPaperAccounts([accountId]);

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
          cOID: validatedClientOrderId(input.clientOrderId) ?? randomUUID(),
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
      firstDefined(
        asString(result["order_status"]),
        asString(result["status"]),
      ),
      0,
      input.quantity,
    );

    return {
      id:
        firstDefined(
          asString(result["order_id"]),
          asString(result["orderId"]),
        ) ?? randomUUID(),
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
    const { accountId, body, resolvedContractId } =
      await this.buildStructuredOrderBody(input);
    const orderPayload = asRecord(asArray(body["orders"])[0]) ?? {};
    const clientOrderId = asString(orderPayload["cOID"]);
    if (!clientOrderId) {
      throw new HttpError(500, "Prepared IBKR order has no client order ID.", {
        code: "ibkr_order_intent_invalid",
      });
    }
    await this.preflightMarketData([resolvedContractId]);
    const whatIfPayload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(accountId)}/orders/whatif`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const whatIf = parseIbkrWhatIf(whatIfPayload);

    return {
      accountId,
      mode: input.mode,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      resolvedContractId,
      clientOrderId,
      orderFingerprint: fingerprintIbkrOrderBody(body),
      orderPayload,
      whatIf,
      optionContract: input.optionContract
        ? {
            ...input.optionContract,
            providerContractId: String(resolvedContractId),
          }
        : null,
    };
  }

  async placeOrder(
    input: PlaceOrderInput,
  ): Promise<
    BrokerOrderSnapshot & {
      placementConfirmed: boolean;
      reconciliationRequired: boolean;
    }
  > {
    if (!validatedClientOrderId(input.clientOrderId)) {
      throw new HttpError(409, "A prepared IBKR order intent is required.", {
        code: "ibkr_order_intent_required",
        expose: true,
      });
    }
    const { accountId, body } = await this.buildStructuredOrderBody(input);
    return this.placePreparedOrder(input, { accountId, body });
  }

  async placePreparedOrder(
    input: PlaceOrderInput,
    prepared: { accountId: string; body: Record<string, unknown> },
  ): Promise<
    BrokerOrderSnapshot & {
      placementConfirmed: boolean;
      reconciliationRequired: boolean;
    }
  > {
    const clientOrderId = validatedClientOrderId(input.clientOrderId);
    const order = requirePreparedIbkrOrder(prepared.body, prepared.accountId);
    if (
      !clientOrderId ||
      prepared.accountId !== input.accountId ||
      order.clientOrderId !== clientOrderId ||
      !preparedIbkrOrderMatchesInput(order, input)
    ) {
      throw new HttpError(409, "The prepared IBKR order intent is invalid.", {
        code: "ibkr_order_intent_invalid",
        expose: true,
      });
    }
    await this.getPreparedOrderOptionContract(order, input);
    const tradingAccounts = await this.getTradingAccountsInfo();
    if (!tradingAccounts.accounts.includes(prepared.accountId)) {
      throw new HttpError(409, "The selected IBKR account is not tradable.", {
        code: "ibkr_order_account_not_tradable",
        expose: true,
      });
    }

    const { payload: responsePayload, requestEpoch } =
      await this.requestWithEpoch<unknown>(
        `/iserver/account/${encodeURIComponent(prepared.accountId)}/orders`,
        {
          method: "POST",
          body: JSON.stringify(prepared.body),
        },
      );
    const result = this.requireOrderAcknowledgement(
      responsePayload,
      requestEpoch,
    );
    const placedAt = new Date();
    const acknowledged = this.mapAcknowledgedOrder(
      input,
      result,
      prepared.accountId,
      placedAt,
    );
    return this.verifyPreparedOrderPlacement({
      accountId: prepared.accountId,
      orderId: acknowledged.id,
      mode: input.mode,
      preparedOrderBody: prepared.body,
      expectedOrder: input,
    });
  }

  async verifyPreparedOrderPlacement(input: {
    accountId: string;
    orderId: string;
    mode: RuntimeMode;
    preparedOrderBody: Record<string, unknown>;
    expectedOrder?: PlaceOrderInput;
  }): Promise<
    BrokerOrderSnapshot & {
      placementConfirmed: boolean;
      reconciliationRequired: boolean;
    }
  > {
    const prepared = requirePreparedIbkrOrder(
      input.preparedOrderBody,
      input.accountId,
    );
    if (
      input.expectedOrder &&
      !preparedIbkrOrderMatchesInput(prepared, input.expectedOrder)
    ) {
      throw new HttpError(409, "The prepared IBKR order intent is invalid.", {
        code: "ibkr_order_intent_invalid",
        expose: true,
      });
    }
    const preparedOrder = prepared.raw;
    const preparedOrderType = prepared.ibkrOrderType;
    const preparedPrice = prepared.limitPrice;
    const preparedQuantity = prepared.quantity;
    const preparedSide = prepared.ibkrSide;
    const preparedTif = prepared.timeInForce;
    const preparedConid = prepared.conid;
    const preparedClientOrderId = prepared.clientOrderId;
    const preparedIsLimit = prepared.type === "limit";
    const preparedIsMarket = prepared.type === "market";
    const optionContract = await this.getPreparedOrderOptionContract(
      prepared,
      input.expectedOrder,
    );
    let lastOrder: BrokerOrderSnapshot | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const tradingAccounts = await this.getTradingAccountsInfo();
        await this.ensureActiveTradingAccount(input.accountId, tradingAccounts);
        const livePayload = await this.request<unknown>(
          "/iserver/account/orders",
          {},
          { force: true },
        );
        const liveOrder = compact(
          asArray(asRecord(livePayload)?.["orders"]).map(asRecord),
        ).find(
          (order) =>
            firstDefined(
              asString(order["orderId"]),
              asString(order["order_id"]),
            ) === input.orderId,
        );
        const liveOrderId = firstDefined(
          asString(liveOrder?.["orderId"]),
          asString(liveOrder?.["order_id"]),
        );
        const liveAccountId = firstDefined(
          asString(liveOrder?.["acct"]),
          asString(liveOrder?.["account"]),
        );
        const liveClientOrderId = firstDefined(
          asString(liveOrder?.["order_ref"]),
          asString(liveOrder?.["orderRef"]),
        );
        const liveConid = firstDefined(
          asNumber(liveOrder?.["conid"]),
          asNumber(liveOrder?.["conidex"]),
        );
        const liveSide = parseIbkrOrderSide(asString(liveOrder?.["side"]));
        const liveQuantity = firstDefined(
          asNumber(liveOrder?.["totalSize"]),
          asNumber(liveOrder?.["total_size"]),
          asNumber(liveOrder?.["quantity"]),
        );
        const liveFilled = firstDefined(
          asNumber(liveOrder?.["filledQuantity"]),
          asNumber(liveOrder?.["filled_quantity"]),
        );
        const liveRemaining = firstDefined(
          asNumber(liveOrder?.["remainingQuantity"]),
          asNumber(liveOrder?.["remaining_quantity"]),
        );
        const liveOrderType = normalizeIbkrOrderTypeKey(
          firstDefined(
            asString(liveOrder?.["origOrderType"]),
            asString(liveOrder?.["orderType"]),
            "",
          ) ?? "",
        );
        const liveTif = normalizeMetricKey(
          firstDefined(
            asString(liveOrder?.["timeInForce"]),
            asString(liveOrder?.["tif"]),
            "",
          ) ?? "",
        );
        const liveStatus = firstDefined(
          asString(liveOrder?.["status"]),
          asString(liveOrder?.["order_status"]),
        );
        const liveLimitPrice = asNumber(liveOrder?.["price"]);
        const normalizedLiveStatus =
          liveStatus && liveFilled !== null && liveRemaining !== null
            ? normalizeOrderStatus(liveStatus, liveFilled, liveRemaining)
            : null;
        const filledMarketCloseMatchesPreparedDay =
          preparedIsMarket &&
          preparedTif === "day" &&
          liveTif === "close" &&
          normalizedLiveStatus === "filled" &&
          liveFilled === preparedQuantity &&
          liveRemaining === 0;
        if (
          !liveOrder ||
          !liveOrderId ||
          !liveAccountId ||
          !liveClientOrderId ||
          liveConid === null ||
          !liveSide ||
          liveQuantity === null ||
          liveFilled === null ||
          liveRemaining === null ||
          !liveOrderType ||
          !liveTif ||
          !liveStatus ||
          liveOrderId !== input.orderId ||
          liveAccountId !== input.accountId ||
          liveClientOrderId !== preparedClientOrderId ||
          liveConid !== preparedConid ||
          liveSide !== preparedSide ||
          liveQuantity !== preparedQuantity ||
          liveFilled < 0 ||
          liveRemaining < 0 ||
          Math.abs(liveFilled + liveRemaining - liveQuantity) > 1e-9 ||
          liveOrderType !== preparedOrderType ||
          (liveTif !== preparedTif && !filledMarketCloseMatchesPreparedDay) ||
          (preparedIsLimit && liveLimitPrice !== preparedPrice)
        ) {
          throw new HttpError(
            409,
            "The live order does not match its prepared intent.",
            {
              code: "ibkr_order_placement_intent_mismatch",
              expose: true,
            },
          );
        }
        lastOrder = {
          id: liveOrderId,
          accountId: liveAccountId,
          clientOrderId: liveClientOrderId,
          providerContractId: String(liveConid),
          mode: input.mode,
          symbol: normalizeSymbol(
            firstDefined(
              asString(liveOrder["ticker"]),
              asString(preparedOrder["ticker"]),
              "UNKNOWN",
            ) ?? "UNKNOWN",
          ),
          assetClass: prepared.assetClass,
          side: prepared.side,
          type: prepared.type,
          timeInForce: prepared.timeInForce,
          status: normalizeOrderStatus(liveStatus, liveFilled, liveRemaining),
          quantity: liveQuantity,
          filledQuantity: liveFilled,
          limitPrice: preparedIsLimit ? preparedPrice : null,
          stopPrice: null,
          placedAt: new Date(),
          updatedAt: new Date(),
          optionContract,
          optionAction: input.expectedOrder?.optionAction ?? null,
          positionEffect: input.expectedOrder?.positionEffect ?? null,
          strategyIntent: input.expectedOrder?.strategyIntent ?? null,
        };
        return {
          ...lastOrder,
          placementConfirmed: true,
          reconciliationRequired: false,
        };
      } catch {
        // A newly acknowledged order can take a moment to appear in the
        // current-day order snapshot. Keep the bounded fail-closed poll.
      }
      if (attempt < 7) await sleep(500);
    }
    return {
      id: input.orderId,
      accountId: input.accountId,
      clientOrderId: preparedClientOrderId,
      providerContractId:
        preparedConid === null ? null : String(preparedConid),
      mode: input.mode,
      symbol:
        lastOrder?.symbol ??
        normalizeSymbol(asString(preparedOrder["ticker"]) ?? "UNKNOWN"),
      assetClass: prepared.assetClass,
      side: prepared.side,
      type: prepared.type,
      timeInForce: prepared.timeInForce,
      status: lastOrder?.status ?? "pending_submit",
      quantity: preparedQuantity,
      filledQuantity: lastOrder?.filledQuantity ?? 0,
      limitPrice: preparedIsLimit ? preparedPrice : null,
      stopPrice: null,
      placedAt: new Date(),
      updatedAt: new Date(),
      optionContract,
      optionAction: input.expectedOrder?.optionAction ?? null,
      positionEffect: input.expectedOrder?.positionEffect ?? null,
      strategyIntent: input.expectedOrder?.strategyIntent ?? null,
      placementConfirmed: false,
      reconciliationRequired: true,
    };
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
      throw new HttpError(
        400,
        "No IBKR account was provided for order placement.",
        {
          code: "ibkr_missing_account_id",
        },
      );
    }
    this.assertPaperAccounts([
      accountId,
      ...compact(
        input.orders.map((order) =>
          firstDefined(
            asString(order["acctId"]),
            asString(order["accountId"]),
          ),
        ),
      ),
    ]);

    const { payload, requestEpoch } = await this.requestWithEpoch<unknown>(
      `/iserver/account/${encodeURIComponent(accountId)}/orders`,
      {
        method: "POST",
        body: JSON.stringify({
          orders: input.orders,
        }),
      },
    );

    return this.requireOrderAcknowledgement(payload, requestEpoch);
  }

  private async readOrderMutationEvidence(input: {
    accountId: string;
    orderId: string;
  }): Promise<IbkrOrderMutationEvidence> {
    const tradingAccounts = await this.getTradingAccountsInfo();
    await this.ensureActiveTradingAccount(input.accountId, tradingAccounts);
    const livePayload = await this.request<unknown>(
      "/iserver/account/orders",
      {},
      { force: true },
    );
    const liveOrder = compact(
      asArray(asRecord(livePayload)?.["orders"]).map(asRecord),
    ).find(
      (order) =>
        firstDefined(
          asString(order["orderId"]),
          asString(order["order_id"]),
        ) === input.orderId,
    );
    const statusPayload = await this.request<unknown>(
      `/iserver/account/order/status/${encodeURIComponent(input.orderId)}`,
    );
    const statusOrder =
      asRecord(statusPayload) ??
      compact(asArray(statusPayload).map(asRecord))[0] ??
      null;
    const liveOrderId = firstDefined(
      asString(liveOrder?.["orderId"]),
      asString(liveOrder?.["order_id"]),
    );
    const statusOrderId = firstDefined(
      asString(statusOrder?.["orderId"]),
      asString(statusOrder?.["order_id"]),
    );
    const liveAccountId = firstDefined(
      asString(liveOrder?.["acct"]),
      asString(liveOrder?.["account"]),
    );
    const statusAccountId = firstDefined(
      asString(statusOrder?.["account"]),
      asString(statusOrder?.["acct"]),
      asString(statusOrder?.["order_clearing_account"]),
    );
    const liveConid = firstDefined(
      asNumber(liveOrder?.["conid"]),
      asNumber(liveOrder?.["conidex"]),
    );
    const statusConid = firstDefined(
      asNumber(statusOrder?.["conid"]),
      asNumber(statusOrder?.["conidex"]),
    );
    const liveSide = parseIbkrOrderSide(asString(liveOrder?.["side"]));
    const statusSide = parseIbkrOrderSide(asString(statusOrder?.["side"]));
    const liveQuantity = firstDefined(
      asNumber(liveOrder?.["totalSize"]),
      asNumber(liveOrder?.["total_size"]),
      asNumber(liveOrder?.["quantity"]),
    );
    const statusQuantity = firstDefined(
      asNumber(statusOrder?.["total_size"]),
      asNumber(statusOrder?.["totalSize"]),
    );
    const liveFilled = firstDefined(
      asNumber(liveOrder?.["filledQuantity"]),
      asNumber(liveOrder?.["filled_quantity"]),
      asNumber(liveOrder?.["cum_fill"]),
    );
    const statusFilled = firstDefined(
      asNumber(statusOrder?.["cum_fill"]),
      asNumber(statusOrder?.["filledQuantity"]),
      asNumber(statusOrder?.["filled_quantity"]),
    );
    const liveRemaining = firstDefined(
      asNumber(liveOrder?.["remainingQuantity"]),
      asNumber(liveOrder?.["remaining_quantity"]),
    );
    const statusRemaining = firstDefined(
      asNumber(statusOrder?.["size"]),
      asNumber(statusOrder?.["remainingQuantity"]),
      asNumber(statusOrder?.["remaining_quantity"]),
    );
    const liveOrderType = firstDefined(
      asString(liveOrder?.["origOrderType"]),
      asString(liveOrder?.["orderType"]),
    );
    const statusOrderType = firstDefined(
      asString(statusOrder?.["order_type"]),
      asString(statusOrder?.["orderType"]),
    );
    const liveTif = firstDefined(
      asString(liveOrder?.["timeInForce"]),
      asString(liveOrder?.["tif"]),
    );
    const statusTif = firstDefined(
      asString(statusOrder?.["tif"]),
      asString(statusOrder?.["timeInForce"]),
    );
    const clientOrderId = firstDefined(
      asString(liveOrder?.["order_ref"]),
      asString(liveOrder?.["orderRef"]),
    );
    const limitPrice = asNumber(liveOrder?.["price"]);
    const status = firstDefined(
      asString(statusOrder?.["order_status"]),
      asString(statusOrder?.["status"]),
    );
    const orderNotEditable = strictBoolean(statusOrder?.["order_not_editable"]);
    const cannotCancel = strictBoolean(statusOrder?.["cannot_cancel_order"]);
    const normalizedLiveOrderType = liveOrderType
      ? normalizeIbkrOrderTypeKey(liveOrderType)
      : "";
    const normalizedStatusOrderType = statusOrderType
      ? normalizeIbkrOrderTypeKey(statusOrderType)
      : "";

    if (
      !liveOrder ||
      !statusOrder ||
      !liveOrderId ||
      !statusOrderId ||
      !liveAccountId ||
      !statusAccountId ||
      liveConid === null ||
      statusConid === null ||
      !liveSide ||
      !statusSide ||
      liveQuantity === null ||
      statusQuantity === null ||
      liveFilled === null ||
      statusFilled === null ||
      liveRemaining === null ||
      statusRemaining === null ||
      !liveOrderType ||
      !statusOrderType ||
      !liveTif ||
      !statusTif ||
      !clientOrderId ||
      !["lmt", "mkt"].includes(normalizedLiveOrderType) ||
      (normalizedLiveOrderType === "lmt" && limitPrice === null) ||
      !status ||
      orderNotEditable === null ||
      cannotCancel === null
    ) {
      throw new HttpError(409, "IBKR returned incomplete order evidence.", {
        code: "ibkr_replace_verification_incomplete",
        expose: true,
      });
    }
    if (
      liveOrderId !== input.orderId ||
      statusOrderId !== input.orderId ||
      liveAccountId !== input.accountId ||
      statusAccountId !== input.accountId ||
      liveConid !== statusConid ||
      liveSide !== statusSide ||
      liveQuantity !== statusQuantity ||
      liveFilled !== statusFilled ||
      liveRemaining !== statusRemaining ||
      normalizedLiveOrderType !== normalizedStatusOrderType ||
      normalizeMetricKey(liveTif) !== normalizeMetricKey(statusTif)
    ) {
      throw new HttpError(409, "IBKR order evidence conflicts across reads.", {
        code: "ibkr_replace_verification_conflict",
        expose: true,
      });
    }

    return {
      orderId: liveOrderId,
      accountId: liveAccountId,
      clientOrderId,
      conid: liveConid,
      symbol: normalizeSymbol(
        firstDefined(
          asString(liveOrder["ticker"]),
          asString(statusOrder["symbol"]),
          "UNKNOWN",
        ) ?? "UNKNOWN",
      ),
      side: liveSide,
      quantity: liveQuantity,
      filledQuantity: liveFilled,
      remainingQuantity: liveRemaining,
      orderType: normalizedLiveOrderType,
      tif: normalizeMetricKey(liveTif),
      status: normalizeMetricKey(status),
      limitPrice: normalizedLiveOrderType === "lmt" ? limitPrice : null,
      editable: orderNotEditable === false,
      cancellable: cannotCancel === false,
    };
  }

  private requirePreparedOrderIdentity(
    evidence: IbkrOrderMutationEvidence,
    input: {
      accountId: string;
      orderId: string;
      orderBody: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    const prepared = requirePreparedIbkrOrder(
      input.orderBody,
      input.accountId,
      "ibkr_replace_intent_mismatch",
    );
    const priceMatches =
      (prepared.ibkrOrderType === "lmt" &&
        evidence.orderType === "lmt" &&
        prepared.limitPrice === evidence.limitPrice) ||
      (prepared.ibkrOrderType === "mkt" &&
        evidence.orderType === "mkt" &&
        evidence.limitPrice === null);
    if (
      input.orderId !== evidence.orderId ||
      prepared.clientOrderId !== evidence.clientOrderId ||
      prepared.conid !== evidence.conid ||
      prepared.quantity !== evidence.quantity ||
      !priceMatches ||
      prepared.ibkrSide !== evidence.side ||
      normalizeMetricKey(INTERNAL_TO_IBKR_TIF[prepared.timeInForce]) !==
        evidence.tif
    ) {
      throw new HttpError(409, "The live order does not match its prepared intent.", {
        code: "ibkr_replace_intent_mismatch",
        expose: true,
      });
    }
    return prepared.raw;
  }

  private requireUnfilledCancellableOrder(
    evidence: IbkrOrderMutationEvidence,
  ): void {
    if (
      evidence.filledQuantity !== 0 ||
      evidence.remainingQuantity !== evidence.quantity
    ) {
      throw new HttpError(409, "Only a fully unfilled IBKR order can be modified.", {
        code: "ibkr_replace_order_has_fills",
        expose: true,
      });
    }
    if (!evidence.cancellable) {
      throw new HttpError(409, "The IBKR order is not safely cancellable.", {
        code: "ibkr_replace_order_not_editable",
        expose: true,
      });
    }
    if (evidence.status !== "submitted" && evidence.status !== "presubmitted") {
      throw new HttpError(409, "The IBKR order is not in an editable active state.", {
        code: "ibkr_replace_order_not_active",
        expose: true,
      });
    }
  }

  private requirePriceOnlyReplacement(
    evidence: IbkrOrderMutationEvidence,
    input: {
      accountId: string;
      orderId: string;
      orderBody: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    const order = this.requirePreparedOrderIdentity(evidence, input);
    this.requireUnfilledCancellableOrder(evidence);
    if (
      evidence.orderType !== "lmt" ||
      evidence.limitPrice === null ||
      !evidence.editable
    ) {
      throw new HttpError(409, "The IBKR order is not safely editable.", {
        code: "ibkr_replace_order_not_editable",
        expose: true,
      });
    }
    return order;
  }

  async previewOrderReplacement(input: {
    accountId: string;
    orderId: string;
    mode: RuntimeMode;
    originalOrderBody: Record<string, unknown>;
    limitPrice: number;
    expectedOrder?: PlaceOrderInput;
  }): Promise<OrderPreviewSnapshot> {
    if (!/^\d+$/u.test(input.orderId) || !Number.isFinite(input.limitPrice) || input.limitPrice <= 0) {
      throw new HttpError(409, "The IBKR replacement request is invalid.", {
        code: "ibkr_replace_request_invalid",
        expose: true,
      });
    }
    const evidence = await this.readOrderMutationEvidence(input);
    const originalOrder = this.requirePriceOnlyReplacement(evidence, {
      accountId: input.accountId,
      orderId: input.orderId,
      orderBody: input.originalOrderBody,
    });
    const preparedOriginal = requirePreparedIbkrOrder(
      input.originalOrderBody,
      input.accountId,
      "ibkr_replace_intent_mismatch",
    );
    if (
      input.expectedOrder &&
      !preparedIbkrOrderMatchesInput(preparedOriginal, input.expectedOrder)
    ) {
      throw new HttpError(409, "The live order does not match its prepared intent.", {
        code: "ibkr_replace_intent_mismatch",
        expose: true,
      });
    }
    if (input.limitPrice === evidence.limitPrice) {
      throw new HttpError(409, "The replacement price must change.", {
        code: "ibkr_replace_price_unchanged",
        expose: true,
      });
    }
    const body = structuredClone(input.originalOrderBody);
    const modifiedOrder = asRecord(asArray(body["orders"])[0]);
    if (!modifiedOrder) {
      throw new HttpError(409, "The prepared IBKR order intent is invalid.", {
        code: "ibkr_order_intent_invalid",
        expose: true,
      });
    }
    modifiedOrder["price"] = input.limitPrice;
    const rulesPayload = await this.request<unknown>("/iserver/contract/rules", {
      method: "POST",
      body: JSON.stringify({
        conid: evidence.conid,
        exchange: asString(originalOrder["listingExchange"]) ?? "SMART",
        isBuy: evidence.side === "BUY",
        modifyOrder: true,
        orderId: Number(input.orderId),
      }),
    });
    const rules = asRecord(rulesPayload) ?? {};
    const allowedAccounts = compact(asArray(rules["canTradeAcctIds"]).map(asString));
    const allowedOrderTypes = compact(asArray(rules["orderTypes"]).map(asString)).map(
      normalizeMetricKey,
    );
    if (
      asString(rules["error"]) ||
      !allowedAccounts.includes(input.accountId) ||
      !allowedOrderTypes.includes("lmt")
    ) {
      throw new HttpError(409, "IBKR did not confirm the replacement rules.", {
        code: "ibkr_replace_rules_rejected",
        expose: true,
      });
    }
    await this.preflightMarketData([evidence.conid]);
    const whatIfPayload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(input.accountId)}/orders/whatif`,
      { method: "POST", body: JSON.stringify(body) },
    );
    const whatIf = parseIbkrWhatIf(whatIfPayload);
    const optionContract = await this.getPreparedOrderOptionContract(
      preparedOriginal,
      input.expectedOrder,
    );
    return {
      accountId: input.accountId,
      mode: input.mode,
      symbol: evidence.symbol,
      assetClass: preparedOriginal.assetClass,
      resolvedContractId: evidence.conid,
      clientOrderId: evidence.clientOrderId,
      orderFingerprint: fingerprintIbkrOrderBody(body),
      orderPayload: modifiedOrder,
      whatIf,
      optionContract,
    };
  }

  async replacePreparedOrder(input: {
    accountId: string;
    orderId: string;
    mode: RuntimeMode;
    previousOrderBody: Record<string, unknown>;
    preparedOrderBody: Record<string, unknown>;
    expectedOrder?: PlaceOrderInput;
  }): Promise<ReplaceOrderSnapshot> {
    const previousEvidence = await this.readOrderMutationEvidence(input);
    const previousOrder = this.requirePriceOnlyReplacement(previousEvidence, {
      accountId: input.accountId,
      orderId: input.orderId,
      orderBody: input.previousOrderBody,
    });
    const preparedOrders = asArray(input.preparedOrderBody["orders"]);
    const preparedOrder = asRecord(preparedOrders[0]);
    const preparedPrice = asNumber(preparedOrder?.["price"]);
    const expectedBody = structuredClone(input.previousOrderBody);
    const expectedOrder = asRecord(asArray(expectedBody["orders"])[0]);
    if (
      preparedOrders.length !== 1 ||
      !preparedOrder ||
      !expectedOrder ||
      preparedPrice === null ||
      preparedPrice <= 0 ||
      preparedPrice === asNumber(previousOrder["price"])
    ) {
      throw new HttpError(409, "The prepared IBKR replacement is invalid.", {
        code: "ibkr_replace_intent_invalid",
        expose: true,
      });
    }
    const prepared = requirePreparedIbkrOrder(
      input.preparedOrderBody,
      input.accountId,
      "ibkr_replace_intent_invalid",
    );
    if (
      input.expectedOrder &&
      !preparedIbkrOrderMatchesInput(prepared, input.expectedOrder)
    ) {
      throw new HttpError(409, "The prepared IBKR replacement is invalid.", {
        code: "ibkr_replace_intent_mismatch",
        expose: true,
      });
    }
    await this.getPreparedOrderOptionContract(prepared, input.expectedOrder);
    expectedOrder["price"] = preparedPrice;
    if (
      fingerprintIbkrOrderBody(expectedBody) !==
      fingerprintIbkrOrderBody(input.preparedOrderBody)
    ) {
      throw new HttpError(409, "The prepared IBKR replacement changed extra fields.", {
        code: "ibkr_replace_intent_mismatch",
        expose: true,
      });
    }

    const { payload, requestEpoch } = await this.requestWithEpoch<unknown>(
      `/iserver/account/${encodeURIComponent(input.accountId)}/order/${encodeURIComponent(input.orderId)}`,
      { method: "POST", body: JSON.stringify(preparedOrder) },
    );
    this.requireOrderAcknowledgement(payload, requestEpoch);

    return this.verifyPreparedOrderReplacement({
      accountId: input.accountId,
      orderId: input.orderId,
      mode: input.mode,
      preparedOrderBody: input.preparedOrderBody,
      expectedOrder: input.expectedOrder,
    });
  }

  async verifyPreparedOrderReplacement(input: {
    accountId: string;
    orderId: string;
    mode: RuntimeMode;
    preparedOrderBody: Record<string, unknown>;
    expectedOrder?: PlaceOrderInput;
  }): Promise<ReplaceOrderSnapshot> {
    const prepared = requirePreparedIbkrOrder(
      input.preparedOrderBody,
      input.accountId,
      "ibkr_replace_intent_invalid",
    );
    const preparedOrder = prepared.raw;
    const preparedPrice = prepared.limitPrice;
    if (
      prepared.type !== "limit" ||
      preparedPrice === null ||
      (input.expectedOrder &&
        !preparedIbkrOrderMatchesInput(prepared, input.expectedOrder))
    ) {
      throw new HttpError(409, "The prepared IBKR replacement is invalid.", {
        code: "ibkr_replace_intent_invalid",
        expose: true,
      });
    }
    const optionContract = await this.getPreparedOrderOptionContract(
      prepared,
      input.expectedOrder,
    );
    let lastEvidence: IbkrOrderMutationEvidence | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const evidence = await this.readOrderMutationEvidence(input);
        lastEvidence = evidence;
        this.requirePriceOnlyReplacement(evidence, {
          accountId: input.accountId,
          orderId: input.orderId,
          orderBody: input.preparedOrderBody,
        });
        return {
          id: evidence.orderId,
          accountId: evidence.accountId,
          mode: input.mode,
          symbol: evidence.symbol,
          assetClass: prepared.assetClass,
          side: prepared.side,
          type: "limit",
          timeInForce: prepared.timeInForce,
          status: normalizeOrderStatus(
            evidence.status,
            evidence.filledQuantity,
            evidence.remainingQuantity,
          ),
          quantity: evidence.quantity,
          filledQuantity: evidence.filledQuantity,
          limitPrice: evidence.limitPrice,
          stopPrice: null,
          placedAt: new Date(),
          updatedAt: new Date(),
          optionContract,
          optionAction: input.expectedOrder?.optionAction ?? null,
          positionEffect: input.expectedOrder?.positionEffect ?? null,
          strategyIntent: input.expectedOrder?.strategyIntent ?? null,
          replacementConfirmed: true,
          reconciliationRequired: false,
        };
      } catch {
        if (lastEvidence?.filledQuantity && lastEvidence.filledQuantity > 0) break;
      }
      if (attempt < 7) await sleep(500);
    }
    return {
      id: input.orderId,
      accountId: input.accountId,
      mode: input.mode,
      symbol: lastEvidence?.symbol ?? normalizeSymbol(asString(preparedOrder["ticker"]) ?? "UNKNOWN"),
      assetClass: prepared.assetClass,
      side: prepared.side,
      type: "limit",
      timeInForce: prepared.timeInForce,
      status: lastEvidence
        ? normalizeOrderStatus(
            lastEvidence.status,
            lastEvidence.filledQuantity,
            lastEvidence.remainingQuantity,
          )
        : "pending_submit",
      quantity: prepared.quantity,
      filledQuantity: lastEvidence?.filledQuantity ?? 0,
      limitPrice: preparedPrice,
      stopPrice: null,
      placedAt: new Date(),
      updatedAt: new Date(),
      optionContract,
      optionAction: input.expectedOrder?.optionAction ?? null,
      positionEffect: input.expectedOrder?.positionEffect ?? null,
      strategyIntent: input.expectedOrder?.strategyIntent ?? null,
      replacementConfirmed: false,
      reconciliationRequired: true,
    };
  }

  async replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
  }): Promise<ReplaceOrderSnapshot> {
    await this.getTradingAccountsInfo();
    this.assertPaperAccounts(
      compact([
        input.accountId,
        firstDefined(
          asString(input.order["acctId"]),
          asString(input.order["accountId"]),
        ),
      ]),
    );
    const { payload, requestEpoch } = await this.requestWithEpoch<unknown>(
      `/iserver/account/${encodeURIComponent(input.accountId)}/order/${encodeURIComponent(input.orderId)}`,
      {
        method: "POST",
        body: JSON.stringify(input.order),
      },
    );
    const result = this.requireOrderAcknowledgement(payload, requestEpoch);
    const currentOrders = await this.listOrders({
      accountId: input.accountId,
      mode: input.mode,
    });

    const snapshot =
      currentOrders.find((order) => order.id === input.orderId) ?? {
        id:
          firstDefined(
            asString(result["order_id"]),
            asString(result["orderId"]),
          ) ?? input.orderId,
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
      };
    return {
      ...snapshot,
      replacementConfirmed: false,
      reconciliationRequired: true,
    };
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
    mode?: RuntimeMode | null;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
    preparedOrderBody: Record<string, unknown>;
  }): Promise<CancelOrderSnapshot> {
    const evidence = await this.readOrderMutationEvidence(input);
    this.requirePreparedOrderIdentity(evidence, {
      accountId: input.accountId,
      orderId: input.orderId,
      orderBody: input.preparedOrderBody,
    });
    this.requireUnfilledCancellableOrder(evidence);

    const payload = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(input.accountId)}/order/${encodeURIComponent(input.orderId)}`,
      {
        method: "DELETE",
      },
      {
        manualIndicator: true,
        extOperator: this.config.extOperator,
      },
    );
    const record = asRecord(payload);
    let status: OrderStatus = "pending_cancel";
    let filledQuantity = 0;
    let reconciliationRequired = true;
    let cancellationEvidenceComplete = false;
    // ponytail: bounded polling is enough for one manual order; use the order
    // websocket before enabling concurrent automated mutations.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const statusPayload = await this.request<unknown>(
          `/iserver/account/order/status/${encodeURIComponent(input.orderId)}`,
        );
        const statusRecord =
          asRecord(statusPayload) ??
          compact(asArray(statusPayload).map(asRecord))[0] ??
          {};
        const observedFilledQuantity = firstDefined(
          asNumber(statusRecord["filledQuantity"]),
          asNumber(statusRecord["filled_quantity"]),
          asNumber(statusRecord["cum_fill"]),
        );
        const observedRemainingQuantity = firstDefined(
          asNumber(statusRecord["remainingQuantity"]),
          asNumber(statusRecord["remaining_quantity"]),
          asNumber(statusRecord["size"]),
        );
        const observedTotalQuantity = firstDefined(
          asNumber(statusRecord["totalSize"]),
          asNumber(statusRecord["total_size"]),
        );
        cancellationEvidenceComplete =
          observedFilledQuantity !== null &&
          observedFilledQuantity >= 0 &&
          observedFilledQuantity <= evidence.quantity &&
          observedRemainingQuantity !== null &&
          (observedRemainingQuantity === 0 ||
            observedRemainingQuantity === evidence.quantity) &&
          observedTotalQuantity === evidence.quantity;
        if (observedFilledQuantity !== null && observedFilledQuantity >= 0) {
          filledQuantity = Math.max(filledQuantity, observedFilledQuantity);
        }
        status = normalizeOrderStatus(
          firstDefined(
            asString(statusRecord["order_status"]),
            asString(statusRecord["status"]),
          ),
          filledQuantity,
          observedRemainingQuantity ?? 0,
        );
        if (
          status === "canceled" ||
          status === "filled" ||
          status === "rejected" ||
          status === "expired"
        ) {
          reconciliationRequired =
            status !== "canceled" ||
            !cancellationEvidenceComplete ||
            filledQuantity > 0;
          break;
        }
      } catch {
        break;
      }
      if (attempt < 7) {
        await sleep(500);
      }
    }
    const terminal =
      status === "canceled" ||
      status === "filled" ||
      status === "rejected" ||
      status === "expired";

    return {
      orderId:
        firstDefined(
          asString(record?.["order_id"]),
          asString(record?.["orderId"]),
          input.orderId,
        ) ?? input.orderId,
      accountId:
        firstDefined(
          asString(record?.["account"]),
          asString(record?.["acct"]),
          input.accountId,
        ) ?? null,
      message:
        firstDefined(
          asString(record?.["msg"]),
          asString(record?.["message"]),
          "Request submitted",
        ) ?? "Request submitted",
      submittedAt: new Date(),
      status,
      filledQuantity,
      terminal,
      cancelConfirmed:
        status === "canceled" &&
        cancellationEvidenceComplete &&
        filledQuantity === 0,
      reconciliationRequired,
    };
  }

  /**
   * Public ticker search backed by IBKR's `/iserver/secdef/search`. Returns
   * results in the same shape the platform service expects from Massive's
   * universe-search endpoint so it can be a drop-in primary source.
   */
  private extractIbkrExchangeHint(
    value: string | null | undefined,
  ): string | null {
    const text = value?.trim() ?? "";
    const match = text.match(/\(([A-Z0-9._ -]{2,16})\)\s*$/);
    return match?.[1]?.trim() ?? null;
  }

  private looksLikeIbkrEtf(name: string): boolean {
    return /\b(ETF|ETN|ETP|ETC|UCITS|SPDR|ISHARES|PROSHARES|INVESCO|VANGUARD|DIREXION|WISDOMTREE|GLOBAL X|GRAYSCALE|TRACKER|TRUST-US)\b/i.test(
      name,
    );
  }

  private isPreferredIbkrExchange(
    exchange: string | null | undefined,
  ): boolean {
    const normalized =
      exchange
        ?.trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "") ?? "";
    return [
      "NASDAQ",
      "NASDAQNMS",
      "NYSE",
      "ARCA",
      "ARCX",
      "CBOE",
      "CME",
      "IDEALPRO",
      "ZEROHASH",
      "PINK",
      "OTC",
    ].includes(normalized);
  }

  private mapIbkrUniverseMarket(
    secType: string | null,
    exchange: string | null,
    name: string,
  ): UniverseMarket | null {
    const normalizedSecType = secType?.trim().toUpperCase() ?? "";
    const normalizedExchange = exchange?.trim().toUpperCase() ?? "";

    if (normalizedSecType === "ETF") return "etf";
    if (normalizedSecType === "IND") return "indices";
    if (normalizedSecType === "FUT") return "futures";
    if (normalizedSecType === "CASH") return "fx";
    if (normalizedSecType === "CRYPTO") return "crypto";
    if (normalizedSecType === "STK") {
      if (this.looksLikeIbkrEtf(name)) {
        return "etf";
      }
      return /\b(OTC|PINK|PINX|GREY|QB|QX)\b/.test(normalizedExchange)
        ? "otc"
        : "stocks";
    }

    return null;
  }

  private findIbkrSecuritySection(
    record: Record<string, unknown>,
    secType: string | null,
  ): Record<string, unknown> | null {
    const normalizedSecType = secType?.trim().toUpperCase() ?? "";
    if (!normalizedSecType) return null;

    return (
      compact(asArray(record["sections"]).map(asRecord)).find(
        (section) =>
          asString(section["secType"])?.trim().toUpperCase() ===
          normalizedSecType,
      ) ?? null
    );
  }

  private mapIbkrUniverseTicker(
    record: Record<string, unknown>,
    identifierMatch = false,
    fallbackSecType: string | null = null,
  ): IbkrUniverseTicker | null {
    const ticker =
      firstDefined(
        asString(record["symbol"]),
        asString(record["ticker"]),
        asString(record["tradingClass"]),
      ) ?? null;
    const name =
      firstDefined(
        asString(record["companyHeader"]),
        asString(record["companyName"]),
        asString(record["description"]),
        asString(record["name"]),
      ) ?? "";
    if (!ticker || !name) return null;

    const fallbackSection = this.findIbkrSecuritySection(
      record,
      fallbackSecType,
    );
    const recordSecType = asString(record["secType"]);
    if (
      !recordSecType &&
      fallbackSecType &&
      fallbackSecType !== "STK" &&
      !fallbackSection
    ) {
      return null;
    }
    const secType = firstDefined(
      recordSecType,
      asString(fallbackSection?.["secType"]),
      fallbackSecType?.trim().toUpperCase() || null,
    );
    if (secType?.toUpperCase() === "OPT") return null;

    const primaryExchange =
      firstDefined(
        asString(record["listingExchange"]),
        asString(record["exchange"]),
        asString(record["description"]),
        asString(fallbackSection?.["exchange"]),
        this.extractIbkrExchangeHint(name),
      ) ?? null;
    const market = this.mapIbkrUniverseMarket(secType, primaryExchange, name);
    if (!market) return null;

    const normalizedTicker = normalizeSymbol(ticker);
    const providerContractId =
      firstDefined(
        asString(record["conid"]),
        asNumber(record["conid"])?.toString(),
      ) ?? null;

    return {
      ticker: normalizedTicker,
      name,
      market,
      rootSymbol: normalizedTicker.split(/[./:-]/)[0] || normalizedTicker,
      normalizedExchangeMic: primaryExchange,
      exchangeDisplay: primaryExchange,
      logoUrl: null,
      countryCode: null,
      exchangeCountryCode: null,
      sector: null,
      industry: null,
      contractDescription: name,
      contractMeta: {
        secType: secType ?? null,
        identifierMatch,
        rootConid: providerContractId,
        months: asString(fallbackSection?.["months"]),
        exchange: asString(fallbackSection?.["exchange"]) ?? primaryExchange,
      },
      locale: null,
      type: secType ?? null,
      active: true,
      primaryExchange,
      currencyName: asString(record["currency"]),
      cik: null,
      compositeFigi: null,
      shareClassFigi: null,
      lastUpdatedAt: null,
      provider: "ibkr",
      providers: ["ibkr"],
      tradeProvider: "ibkr",
      dataProviderPreference: "ibkr",
      providerContractId,
    };
  }

  private async hydrateFrontFuturesTicker(
    ticker: IbkrUniverseTicker,
    signal?: AbortSignal,
  ): Promise<IbkrUniverseTicker> {
    if (ticker.market !== "futures") return ticker;

    const meta = asRecord(ticker.contractMeta);
    const rootConid = asNumber(
      meta?.["rootConid"] ?? ticker.providerContractId,
    );
    const frontMonth = asString(meta?.["months"])
      ?.split(";")
      .map((month) => month.trim())
      .find(Boolean);
    const exchange =
      asString(meta?.["exchange"])
        ?.split(/[;,]/)
        .map((part) => part.trim())
        .find(Boolean) ||
      ticker.primaryExchange ||
      "CME";

    if (rootConid === null || !frontMonth) {
      return ticker;
    }

    try {
      const infoPayload = await this.request<unknown>(
        "/iserver/secdef/info",
        { signal },
        {
          conid: rootConid,
          sectype: "FUT",
          month: frontMonth,
          exchange,
        },
      );
      const info = compact(asArray(infoPayload).map(asRecord))[0];
      if (!info) return ticker;

      const providerContractId =
        firstDefined(
          asString(info["conid"]),
          asNumber(info["conid"])?.toString(),
        ) ?? ticker.providerContractId;
      const listingExchange =
        firstDefined(
          asString(info["listingExchange"]),
          asString(info["exchange"]),
          ticker.primaryExchange,
        ) ?? ticker.primaryExchange;
      const expiry =
        firstDefined(
          asString(info["maturityDate"]),
          asString(info["lastTradeDate"]),
        ) ?? null;
      const description = asString(info["desc1"]);

      return {
        ...ticker,
        providerContractId,
        primaryExchange: listingExchange,
        normalizedExchangeMic: listingExchange,
        exchangeDisplay: listingExchange,
        contractDescription: [ticker.name, description]
          .filter(Boolean)
          .join(" "),
        contractMeta: {
          ...(ticker.contractMeta ?? {}),
          rootConid: String(rootConid),
          frontMonth,
          expiry,
          lastTradeDateOrContractMonth: frontMonth,
          multiplier: asString(info["multiplier"]),
          exchange: listingExchange,
          tradingClass: asString(info["tradingClass"]),
        },
        currencyName: asString(info["currency"]) ?? ticker.currencyName,
      };
    } catch {
      return ticker;
    }
  }

  private resolveIbkrSearchSecTypes(markets?: UniverseMarket[]): string[] {
    const selectedMarkets = markets?.length
      ? new Set(markets)
      : new Set<UniverseMarket>([
          "stocks",
          "etf",
          "indices",
          "futures",
          "fx",
          "crypto",
          "otc",
        ]);
    const secTypes = new Set<string>();

    const searchesStockLikeMarkets =
      selectedMarkets.has("stocks") || selectedMarkets.has("otc");

    if (searchesStockLikeMarkets) {
      secTypes.add("STK");
    }
    if (selectedMarkets.has("etf")) {
      // Client Portal commonly exposes ETFs as STK rows whose description
      // carries the ETF identity. Mixed stock/ETF searches only need STK in
      // the interactive path; keep the extra ETF secType for ETF-only filters.
      secTypes.add("STK");
      if (!searchesStockLikeMarkets) {
        secTypes.add("ETF");
      }
    }
    if (selectedMarkets.has("indices")) secTypes.add("IND");
    if (selectedMarkets.has("futures")) secTypes.add("FUT");
    if (selectedMarkets.has("fx")) secTypes.add("CASH");
    if (selectedMarkets.has("crypto")) secTypes.add("CRYPTO");

    return Array.from(secTypes);
  }

  private scoreIbkrUniverseTicker(
    ticker: IbkrUniverseTicker,
    query: string,
    requestedMarkets: Set<UniverseMarket>,
  ): number {
    const normalizedQuery = normalizeSymbol(query);
    const normalizedTicker = normalizeSymbol(ticker.ticker);
    const normalizedName = ticker.name.trim().toLowerCase();
    const normalizedQueryLower = query.trim().toLowerCase();
    const meta = asRecord(ticker.contractMeta);
    let score = 0;

    if (meta?.["identifierMatch"]) score += 5_000;
    if (ticker.providerContractId === query.trim()) score += 4_500;
    if (normalizedTicker === normalizedQuery) score += 3_000;
    else if (normalizedTicker.startsWith(normalizedQuery)) score += 1_050;
    else if (normalizedTicker.includes(normalizedQuery)) score += 780;

    if (normalizedName === normalizedQueryLower) score += 720;
    else if (normalizedName.startsWith(normalizedQueryLower)) score += 560;
    else if (
      normalizedName
        .split(/[\s./-]+/)
        .some((part) => part && part.startsWith(normalizedQueryLower))
    ) {
      score += 500;
    } else if (normalizedName.includes(normalizedQueryLower)) {
      score += 320;
    }

    if (requestedMarkets.size && requestedMarkets.has(ticker.market))
      score += 120;
    if (
      this.isPreferredIbkrExchange(
        ticker.primaryExchange ?? ticker.exchangeDisplay,
      )
    ) {
      score += 180;
    }
    if (ticker.providerContractId) score += 40;
    if (ticker.primaryExchange || ticker.exchangeDisplay) score += 10;

    return score;
  }

  async searchTickers(input: {
    search?: string;
    market?: UniverseMarket;
    markets?: UniverseMarket[];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    const search = input.search?.trim();
    if (!search) return { count: 0, results: [] };

    const limit = Number.isFinite(input.limit)
      ? Math.max(1, Math.floor(Number(input.limit)))
      : 50;
    const requestedMarkets = new Set(
      input.markets?.length
        ? input.markets
        : input.market
          ? [input.market]
          : [],
    );
    const identifierSearch = search.toUpperCase();
    const isLikelyFigi =
      identifierSearch.startsWith("BBG") ||
      (/^[A-Z0-9]{12}$/.test(identifierSearch) &&
        !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(identifierSearch));
    const raw: Array<{
      record: Record<string, unknown>;
      identifierMatch: boolean;
      fallbackSecType: string | null;
    }> = [];

    if (/^\d+$/.test(search)) {
      try {
        const infoPayload = await this.request<unknown>(
          "/iserver/secdef/info",
          { signal: input.signal },
          { conid: Number(search) },
        );
        const infoRecords = Array.isArray(infoPayload)
          ? compact(asArray(infoPayload).map(asRecord))
          : compact([asRecord(infoPayload)]);
        raw.push(
          ...infoRecords.map((record) => ({
            record,
            identifierMatch: true,
            fallbackSecType: null,
          })),
        );
      } catch {
        // Fall through to normal symbol search.
      }
    }

    try {
      const secTypes = this.resolveIbkrSearchSecTypes(
        input.markets ?? (input.market ? [input.market] : undefined),
      );
      const searchTasks = secTypes.map(async (secType) =>
        (
          await this.searchSecurities(search, {
            secType,
            includeName: secType === "STK" || secType === "ETF",
            signal: input.signal,
          }).catch(() => [] as Record<string, unknown>[])
        ).map((record) => ({
          record,
          fallbackSecType: secType,
        })),
      );
      const searchBatches =
        searchTasks.length <= 2
          ? await Promise.all(searchTasks)
          : await collectSettledWithin(
              searchTasks,
              this.universeSearchPartialDeadlineMs,
              input.signal,
            );
      raw.push(
        ...searchBatches.flat().map(({ record, fallbackSecType }) => ({
          record,
          identifierMatch: isLikelyFigi,
          fallbackSecType,
        })),
      );
    } catch {
      // Keep identifier results if available; otherwise return an empty result set.
    }

    const seenConids = new Set<string>();
    const mappedResults: Array<{ ticker: IbkrUniverseTicker; index: number }> =
      [];
    for (const { record, identifierMatch, fallbackSecType } of raw) {
      let mapped = this.mapIbkrUniverseTicker(
        record,
        identifierMatch,
        fallbackSecType,
      );
      if (mapped?.market === "futures") {
        mapped = await this.hydrateFrontFuturesTicker(mapped, input.signal);
      }
      if (!mapped) continue;
      if (requestedMarkets.size && !requestedMarkets.has(mapped.market))
        continue;
      const conidKey =
        mapped.providerContractId ??
        `${mapped.ticker}:${mapped.market}:${mapped.primaryExchange ?? ""}`;
      if (seenConids.has(conidKey)) continue;
      seenConids.add(conidKey);

      mappedResults.push({ ticker: mapped, index: mappedResults.length });
    }

    const results = mappedResults
      .sort((left, right) => {
        const scoreDiff =
          this.scoreIbkrUniverseTicker(right.ticker, search, requestedMarkets) -
          this.scoreIbkrUniverseTicker(left.ticker, search, requestedMarkets);
        if (scoreDiff !== 0) return scoreDiff;
        const tickerDiff = left.ticker.ticker.localeCompare(
          right.ticker.ticker,
        );
        return tickerDiff !== 0 ? tickerDiff : left.index - right.index;
      })
      .map(({ ticker }) => ticker)
      .slice(0, limit);

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
          firstDefined(asString(record["updated"]), asString(record["date"])) ??
          null;
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

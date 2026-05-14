import {
  asArray,
  asNumber,
  asRecord,
  asString,
  compact,
  firstDefined,
  getNumberPath,
  getStringPath,
  normalizeSymbol,
  toDate,
  toIsoDateString,
} from "../../lib/values";
import { fetchJson, withSearchParams } from "../../lib/http";
import type { PolygonRuntimeConfig } from "../../lib/runtime";

type BarTimeframe = "1s" | "5s" | "15s" | "1m" | "5m" | "15m" | "1h" | "1d";
type OptionRight = "call" | "put";
type FlowSentiment = "bullish" | "bearish" | "neutral";
type FlowEventSideBasis = "quote_match" | "tick_test" | "none";
type FlowEventSideConfidence = "high" | "medium" | "low" | "none";
const POLYGON_TICKER_LOGO_CACHE_TTL_MS = 10 * 60 * 1_000;
const POLYGON_TICKER_DETAILS_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export type UniverseMarket =
  | "stocks"
  | "etf"
  | "indices"
  | "futures"
  | "fx"
  | "crypto"
  | "otc";
export type MarketDataProvider = "ibkr" | "polygon";
export type UniverseTickerContractMeta =
  | Record<string, string | number | boolean | null>
  | null;

export type NewsArticle = {
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

export type UniverseTicker = {
  ticker: string;
  name: string;
  market: UniverseMarket;
  rootSymbol: string | null;
  normalizedExchangeMic: string | null;
  exchangeDisplay: string | null;
  logoUrl: string | null;
  countryCode: string | null;
  exchangeCountryCode: string | null;
  sector: string | null;
  industry: string | null;
  contractDescription: string | null;
  contractMeta: UniverseTickerContractMeta;
  locale: string | null;
  type: string | null;
  active: boolean;
  primaryExchange: string | null;
  currencyName: string | null;
  cik: string | null;
  compositeFigi: string | null;
  shareClassFigi: string | null;
  lastUpdatedAt: Date | null;
  provider: MarketDataProvider | null;
  providers: MarketDataProvider[];
  tradeProvider: MarketDataProvider | null;
  dataProviderPreference: MarketDataProvider | null;
  providerContractId?: string | null;
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
  updatedAt: Date;
};

export type BarSnapshot = {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PolygonAggregateBarsPage = {
  bars: BarSnapshot[];
  nextUrl: string | null;
  pageCount: number;
  pageLimitReached: boolean;
  requestedFrom: Date;
  requestedTo: Date;
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

export type HistoricalOptionContract = {
  ticker: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: OptionRight;
  multiplier: number;
  sharesPerContract: number;
  providerContractId: string | null;
};

export type FlowEvent = {
  id: string;
  underlying: string;
  provider: "polygon";
  basis: "trade";
  optionTicker: string;
  providerContractId: string | null;
  strike: number;
  expirationDate: Date;
  right: OptionRight;
  price: number;
  size: number;
  premium: number;
  openInterest: number;
  impliedVolatility: number | null;
  exchange: string;
  side: string;
  sideBasis?: FlowEventSideBasis;
  sideConfidence?: FlowEventSideConfidence;
  sentiment: FlowSentiment;
  tradeConditions: string[];
  occurredAt: Date;
  unusualScore: number;
  isUnusual: boolean;
  bid?: number | null;
  ask?: number | null;
  mark?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  underlyingPrice?: number | null;
  moneyness?: string | null;
  distancePercent?: number | null;
  confidence?: "confirmed_trade" | "snapshot_activity" | "fallback_estimate";
  sourceBasis?: "confirmed_trade" | "snapshot_activity" | "fallback_estimate";
};

export type HistoricalOptionFlowEventsResult = {
  events: FlowEvent[];
  contractCount: number;
  contractsScanned: number;
};

export type StockGroupedDailyAggregate = {
  symbol: string;
  volume: number;
  vwap: number | null;
  transactions: number | null;
  timestamp: Date | null;
  otc: boolean;
};

export type PremiumDistributionSide = "buy" | "sell" | "neutral";
export type PremiumDistributionSideBasis =
  | "quote_match"
  | "tick_test"
  | "mixed"
  | "none";
export type PremiumDistributionClassificationConfidence =
  | "high"
  | "medium"
  | "low"
  | "very_low"
  | "none";
export type PremiumDistributionDataAccess =
  | "available"
  | "unavailable"
  | "forbidden"
  | "unknown";
export type PremiumDistributionQuoteProbeStatus =
  | "not_attempted"
  | "available"
  | "forbidden"
  | "unavailable"
  | "failed";
export type PremiumDistributionBucketName = "small" | "medium" | "large";
export type PremiumDistributionTimeframe = "today" | "week";
export type PremiumDistributionMarketCapTier =
  | "mega"
  | "large"
  | "mid"
  | "small_or_unknown";

export type PremiumDistributionBucketThresholds = {
  smallMin: number;
  mediumMin: number;
  largeMin: number;
};

export type PremiumDistributionBucket = {
  inflowPremium: number;
  outflowPremium: number;
  buyPremium: number;
  sellPremium: number;
  neutralPremium: number;
  totalPremium: number;
  count: number;
};

export type PremiumDistributionHydrationDiagnostics = {
  snapshotCount: number;
  usablePremiumSnapshotCount: number;
  usablePremiumTotal: number;
  selectedPremiumTotal: number;
  classificationTargetPremiumCoverage: number;
  selectedPremiumCoverage: number;
  pageCount: number;
  snapshotTradingDate: string | null;
  tradeLookbackStartDate: string | null;
  quoteProbeDate: string | null;
  quoteProbeStatus: PremiumDistributionQuoteProbeStatus;
  quoteProbeMessage: string | null;
  tradeContractCandidateCount: number;
  tradeContractHydratedCount: number;
  tradeCallAttemptCount: number;
  tradeCallSuccessCount: number;
  tradeCallErrorCount: number;
  tradeCallForbiddenCount: number;
  eligibleTradeCount: number;
  ineligibleTradeCount: number;
  unknownConditionTradeCount: number;
  conditionCodes: string[];
  exchangeCodes: string[];
  classifiedContractCoverage: number;
};

export type OptionPremiumDistribution = {
  symbol: string;
  asOf: Date;
  timeframe: PremiumDistributionTimeframe;
  stockDayVolume: number | null;
  marketCap: number | null;
  marketCapTier: PremiumDistributionMarketCapTier;
  bucketThresholds: PremiumDistributionBucketThresholds;
  premiumTotal: number;
  classifiedPremium: number;
  classificationCoverage: number;
  classificationConfidence: PremiumDistributionClassificationConfidence;
  hydrationWarning: string | null;
  hydrationDiagnostics: PremiumDistributionHydrationDiagnostics;
  netPremium: number;
  inflowPremium: number;
  outflowPremium: number;
  buyPremium: number;
  sellPremium: number;
  neutralPremium: number;
  callPremium: number;
  putPremium: number;
  buckets: Record<PremiumDistributionBucketName, PremiumDistributionBucket>;
  contractCount: number;
  tradeCount: number;
  classifiedTradeCount: number;
  quoteMatchedCount: number;
  tickTestMatchedCount: number;
  sideBasis: PremiumDistributionSideBasis;
  quoteAccess: PremiumDistributionDataAccess;
  tradeAccess: PremiumDistributionDataAccess;
  source: "polygon-options-snapshot";
  confidence: "snapshot" | "partial";
  delayed: boolean;
  pageCount: number;
};

type PremiumDistributionTradeBucket = {
  buyPremium: number;
  sellPremium: number;
  count: number;
};

type PremiumDistributionTradeBuckets = Record<
  PremiumDistributionBucketName,
  PremiumDistributionTradeBucket
>;

export type PremiumDistributionTradeClassification = {
  buyPremium: number;
  sellPremium: number;
  tradeCount: number;
  eligibleTradeCount?: number;
  ineligibleTradeCount?: number;
  unknownConditionTradeCount?: number;
  tickTestMatchedCount: number;
  conditionCodes?: string[];
  exchangeCodes?: string[];
  buckets?: PremiumDistributionTradeBuckets;
};

/*
Polygon/Massive premium distribution mapping:
- Options snapshots provide the session/day price and volume used for total premium.
- Snapshot last_quote plus last_trade classifies only the latest bid/ask-matched print.
- Options trades provide the tick-test fallback for top contracts; condition and exchange
  codes are retained for audits but are not side signals yet.
- Grouped daily stock aggregates only choose candidate underlyings. Bucket thresholds are
  RayAlgo display heuristics, not vendor-defined Webull buckets.
*/

export type PolygonApiDiagnosticsStatus =
  | "ok"
  | "degraded"
  | "unconfigured"
  | "unknown";

export type PolygonApiDiagnostics = {
  configured: boolean;
  status: PolygonApiDiagnosticsStatus;
  baseUrl: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
};

const polygonApiDiagnosticsState: {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
} = {
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
};

const polygonErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "Polygon request failed.";

export function recordPolygonApiSuccess(at: Date = new Date()): void {
  polygonApiDiagnosticsState.lastSuccessAt = at;
}

export function recordPolygonApiFailure(
  error: unknown,
  at: Date = new Date(),
): void {
  polygonApiDiagnosticsState.lastFailureAt = at;
  polygonApiDiagnosticsState.lastError = polygonErrorMessage(error);
}

export function getPolygonApiDiagnostics(
  config: PolygonRuntimeConfig | null | undefined,
): PolygonApiDiagnostics {
  if (!config) {
    return {
      configured: false,
      status: "unconfigured",
      baseUrl: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
    };
  }

  const lastSuccessAt = polygonApiDiagnosticsState.lastSuccessAt;
  const lastFailureAt = polygonApiDiagnosticsState.lastFailureAt;
  const status: PolygonApiDiagnosticsStatus =
    lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt)
      ? "degraded"
      : lastSuccessAt
        ? "ok"
        : "unknown";

  return {
    configured: true,
    status,
    baseUrl: config.baseUrl,
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: lastFailureAt?.toISOString() ?? null,
    lastError: polygonApiDiagnosticsState.lastError,
  };
}

const TIMEFRAME_TO_POLYGON_RANGE: Record<
  BarTimeframe,
  { multiplier: number; timespan: string; stepMs: number }
> = {
  "1s": { multiplier: 1, timespan: "second", stepMs: 1_000 },
  "5s": { multiplier: 5, timespan: "second", stepMs: 5_000 },
  "15s": { multiplier: 15, timespan: "second", stepMs: 15_000 },
  "1m": { multiplier: 1, timespan: "minute", stepMs: 60_000 },
  "5m": { multiplier: 5, timespan: "minute", stepMs: 300_000 },
  "15m": { multiplier: 15, timespan: "minute", stepMs: 900_000 },
  "1h": { multiplier: 1, timespan: "hour", stepMs: 3_600_000 },
  "1d": { multiplier: 1, timespan: "day", stepMs: 86_400_000 },
};

const MASSIVE_DELAYED_INTRADAY_LAG_MS = 15 * 60 * 1_000;
const AGGREGATE_BASE_LIMIT_MAX = 50_000;
const INTRADAY_AGGREGATE_WINDOW_MS = 31 * 24 * 60 * 60 * 1_000;
const AGGREGATE_CHUNK_MAX = 60;
const AGGREGATE_NEXT_PAGE_MAX = 4;
const OPTION_AGGREGATE_INTRADAY_LOOKBACK_MS = 10 * 24 * 60 * 60 * 1_000;
const OPTION_FLOW_EXPIRATION_LOOKAHEAD_DAYS = 60;
const OPTION_FLOW_SNAPSHOT_PAGE_LIMIT = 250;
const OPTION_FLOW_SNAPSHOT_MAX_PAGES = 12;
const OPTION_FLOW_TRADE_CONTRACT_LIMIT = 80;
const OPTION_FLOW_TRADE_LIMIT = 2_500;
const OPTION_FLOW_TRADE_CONCURRENCY = 4;
const OPTION_FLOW_TRADE_PAGE_MAX = 20;
const OPTION_PREMIUM_DISTRIBUTION_SNAPSHOT_MAX_PAGES = 20;
const OPTION_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT = 60;
const OPTION_PREMIUM_DISTRIBUTION_TRADE_LIMIT = 50_000;
const OPTION_PREMIUM_DISTRIBUTION_TRADE_CONCURRENCY = 4;
const OPTION_QUOTE_ACCESS_PROBE_CACHE_TTL_MS = 5 * 60_000;

function isIntradayTimeframe(timeframe: BarTimeframe): boolean {
  return timeframe !== "1d";
}

function resolveAggregateBaseLimit(timeframe: BarTimeframe, desiredBars: number): number {
  const safeBars = Math.max(desiredBars, 1);

  switch (timeframe) {
    case "1s":
      return safeBars;
    case "5s":
      return safeBars * 5;
    case "15s":
      return safeBars * 15;
    case "1m":
      return safeBars;
    case "5m":
      return safeBars * 5;
    case "15m":
      return safeBars * 15;
    case "1h":
      return safeBars * 60;
    case "1d":
      return safeBars;
    default:
      return safeBars;
  }
}

function resolveAggregateWindowBaseLimit(
  timeframe: BarTimeframe,
  from: Date,
  to: Date,
): number {
  const rangeConfig = TIMEFRAME_TO_POLYGON_RANGE[timeframe];
  const approximateBars = Math.max(
    1,
    Math.ceil(
      Math.max(rangeConfig.stepMs, to.getTime() - from.getTime()) /
        rangeConfig.stepMs,
    ) + 1,
  );
  return resolveAggregateBaseLimit(timeframe, approximateBars);
}

function resolveAggregateChunkWindowMs(timeframe: BarTimeframe): number {
  const rangeConfig = TIMEFRAME_TO_POLYGON_RANGE[timeframe];
  const baseAggregatesPerBar = Math.max(
    1,
    resolveAggregateBaseLimit(timeframe, 1),
  );
  const maxBarsPerWindow = Math.max(
    1,
    Math.floor(AGGREGATE_BASE_LIMIT_MAX / baseAggregatesPerBar),
  );
  return Math.min(
    INTRADAY_AGGREGATE_WINDOW_MS,
    Math.max(rangeConfig.stepMs, maxBarsPerWindow * rangeConfig.stepMs),
  );
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000);
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function toUnixNanosecondsString(date: Date): string {
  return (BigInt(date.getTime()) * 1_000_000n).toString();
}

function midpoint(bid: number, ask: number, fallback: number): number {
  if (bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }

  return fallback;
}

function deriveSnapshotArray(payload: unknown): unknown[] {
  const record = asRecord(payload);

  if (!record) {
    return [];
  }

  return asArray(record["tickers"] ?? record["results"]);
}

function readPolygonTicker(snapshot: unknown): string | null {
  const record = asRecord(snapshot);

  if (!record) {
    return null;
  }

  return asString(record["ticker"] ?? record["symbol"]);
}

function mapStockSnapshot(snapshot: unknown): QuoteSnapshot | null {
  const record = asRecord(snapshot);

  if (!record) {
    return null;
  }

  const symbol = readPolygonTicker(snapshot);

  if (!symbol) {
    return null;
  }

  const lastTrade = asRecord(record["lastTrade"] ?? record["last_trade"]);
  const lastQuote = asRecord(record["lastQuote"] ?? record["last_quote"]);
  const minuteBar = asRecord(record["min"] ?? record["minute"] ?? record["minuteBar"]);
  const dayBar = asRecord(record["day"]);
  const prevDayBar = asRecord(record["prevDay"] ?? record["prev_day"]);

  const price =
    firstDefined(
      getNumberPath(lastTrade, ["p"]),
      getNumberPath(lastTrade, ["price"]),
      getNumberPath(minuteBar, ["c"]),
      getNumberPath(dayBar, ["c"]),
      asNumber(record["currentPrice"]),
    ) ?? 0;

  const bid =
    firstDefined(
      getNumberPath(lastQuote, ["p"]),
      getNumberPath(lastQuote, ["bp"]),
      getNumberPath(lastQuote, ["bid"]),
      getNumberPath(lastQuote, ["bidPrice"]),
    ) ?? 0;

  const ask =
    firstDefined(
      getNumberPath(lastQuote, ["P"]),
      getNumberPath(lastQuote, ["ap"]),
      getNumberPath(lastQuote, ["ask"]),
      getNumberPath(lastQuote, ["askPrice"]),
    ) ?? bid;

  const bidSize =
    firstDefined(
      getNumberPath(lastQuote, ["s"]),
      getNumberPath(lastQuote, ["bs"]),
      getNumberPath(lastQuote, ["bidSize"]),
    ) ?? 0;

  const askSize =
    firstDefined(
      getNumberPath(lastQuote, ["S"]),
      getNumberPath(lastQuote, ["as"]),
      getNumberPath(lastQuote, ["askSize"]),
    ) ?? 0;

  const prevClose =
    firstDefined(
      getNumberPath(prevDayBar, ["c"]),
      getNumberPath(prevDayBar, ["close"]),
    );

  const change =
    firstDefined(
      asNumber(record["todaysChange"]),
      asNumber(record["change"]),
      prevClose !== null ? price - prevClose : null,
    ) ?? 0;

  const changePercent =
    firstDefined(
      asNumber(record["todaysChangePerc"]),
      asNumber(record["changePercent"]),
      asNumber(record["change_percent"]),
      prevClose && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null,
    ) ?? 0;

  const open =
    firstDefined(
      getNumberPath(dayBar, ["o"]),
      getNumberPath(dayBar, ["open"]),
    );

  const high =
    firstDefined(
      getNumberPath(dayBar, ["h"]),
      getNumberPath(dayBar, ["high"]),
    );

  const low =
    firstDefined(
      getNumberPath(dayBar, ["l"]),
      getNumberPath(dayBar, ["low"]),
    );

  const volume =
    firstDefined(
      getNumberPath(dayBar, ["v"]),
      getNumberPath(dayBar, ["volume"]),
      getNumberPath(minuteBar, ["v"]),
      getNumberPath(minuteBar, ["volume"]),
    );

  const updatedAt =
    firstDefined(
      toDate(getNumberPath(lastQuote, ["t"])),
      toDate(getNumberPath(lastQuote, ["timestamp"])),
      toDate(getNumberPath(lastTrade, ["t"])),
      toDate(getNumberPath(lastTrade, ["timestamp"])),
      toDate(getNumberPath(minuteBar, ["t"])),
      toDate(getNumberPath(dayBar, ["t"])),
    ) ?? new Date();

  return {
    symbol: normalizeSymbol(symbol),
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
    updatedAt,
  };
}

function mapAggregateBar(result: unknown): BarSnapshot | null {
  const record = asRecord(result);

  if (!record) {
    return null;
  }

  const timestamp = toDate(record["t"] ?? record["timestamp"]);
  const open = asNumber(record["o"] ?? record["open"]);
  const high = asNumber(record["h"] ?? record["high"]);
  const low = asNumber(record["l"] ?? record["low"]);
  const close = asNumber(record["c"] ?? record["close"]);
  const volume = asNumber(record["v"] ?? record["volume"]);

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
  };
}

function mapGroupedDailyAggregate(result: unknown): StockGroupedDailyAggregate | null {
  const record = asRecord(result);

  if (!record) {
    return null;
  }

  const symbol = normalizeSymbol(asString(record["T"] ?? record["ticker"]) ?? "");
  const volume = asNumber(record["v"] ?? record["volume"]);

  if (!symbol || volume === null) {
    return null;
  }

  return {
    symbol,
    volume,
    vwap: asNumber(record["vw"] ?? record["vwap"]),
    transactions: asNumber(record["n"] ?? record["transactions"]),
    timestamp: toDate(record["t"] ?? record["timestamp"]),
    otc: Boolean(record["otc"]),
  };
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

function mapChainContract(
  underlying: string,
  result: unknown,
): OptionChainContract | null {
  const record = asRecord(result);

  if (!record) {
    return null;
  }

  const details = asRecord(record["details"]) ?? record;
  const contractTicker = asString(details["ticker"]);
  const expirationDate = toDate(details["expiration_date"]);
  const strike = asNumber(details["strike_price"]);
  const right = normalizeOptionRight(asString(details["contract_type"]));
  const sharesPerContract = asNumber(details["shares_per_contract"]) ?? 100;

  if (!contractTicker || !expirationDate || strike === null || !right) {
    return null;
  }

  const lastQuote = asRecord(record["last_quote"]);
  const lastTrade = asRecord(record["last_trade"]);
  const day = asRecord(record["day"]);
  const greeks = asRecord(record["greeks"]);

  const bid =
    firstDefined(
      getNumberPath(lastQuote, ["bid_price"]),
      getNumberPath(lastQuote, ["bp"]),
      getNumberPath(lastQuote, ["p"]),
    ) ?? 0;

  const ask =
    firstDefined(
      getNumberPath(lastQuote, ["ask_price"]),
      getNumberPath(lastQuote, ["ap"]),
      getNumberPath(lastQuote, ["P"]),
    ) ?? bid;

  const last =
    firstDefined(
      getNumberPath(lastTrade, ["price"]),
      getNumberPath(lastTrade, ["p"]),
      getNumberPath(day, ["close"]),
      getNumberPath(day, ["c"]),
    ) ?? midpoint(bid, ask, 0);

  const updatedAt =
    firstDefined(
      toDate(getNumberPath(lastQuote, ["sip_timestamp"])),
      toDate(getNumberPath(lastQuote, ["last_updated"])),
      toDate(getNumberPath(lastTrade, ["sip_timestamp"])),
      toDate(getNumberPath(lastTrade, ["participant_timestamp"])),
      toDate(getNumberPath(day, ["last_updated"])),
    ) ?? new Date();

  return {
    contract: {
      ticker: contractTicker,
      underlying: normalizeSymbol(
        asString(details["underlying_ticker"]) ?? underlying,
      ),
      expirationDate,
      strike,
      right,
      multiplier: sharesPerContract,
      sharesPerContract,
      providerContractId: null,
    },
    bid,
    ask,
    last,
    mark: midpoint(bid, ask, last),
    impliedVolatility: asNumber(record["implied_volatility"]),
    delta: asNumber(greeks?.["delta"]),
    gamma: asNumber(greeks?.["gamma"]),
    theta: asNumber(greeks?.["theta"]),
    vega: asNumber(greeks?.["vega"]),
    openInterest: asNumber(record["open_interest"]) ?? 0,
    volume:
      firstDefined(
        getNumberPath(day, ["volume"]),
        getNumberPath(day, ["v"]),
      ) ?? 0,
    updatedAt,
  };
}

function mapHistoricalOptionContract(
  underlying: string,
  result: unknown,
): HistoricalOptionContract | null {
  const record = asRecord(result);

  if (!record) {
    return null;
  }

  const details = asRecord(record["details"]) ?? record;
  const ticker = asString(details["ticker"]);
  const expirationDate = toDate(details["expiration_date"]);
  const strike = asNumber(details["strike_price"]);
  const right = normalizeOptionRight(asString(details["contract_type"]));
  const sharesPerContract = asNumber(details["shares_per_contract"]) ?? 100;

  if (!ticker || !expirationDate || strike === null || !right) {
    return null;
  }

  return {
    ticker,
    underlying: normalizeSymbol(
      asString(details["underlying_ticker"]) ?? underlying,
    ),
    expirationDate,
    strike,
    right,
    multiplier: sharesPerContract,
    sharesPerContract,
    providerContractId: asString(details["provider_contract_id"]),
  };
}

type FlowEventSideClassification = {
  side: PremiumDistributionSide;
  sideBasis: FlowEventSideBasis;
  sideConfidence: FlowEventSideConfidence;
};

const neutralFlowEventSideClassification = (): FlowEventSideClassification => ({
  side: "neutral",
  sideBasis: "none",
  sideConfidence: "none",
});

function inferTradeSideFromQuote(
  lastTradePrice: number,
  bid: number,
  ask: number,
): PremiumDistributionSide {
  if (bid <= 0 || ask <= 0 || ask < bid || lastTradePrice <= 0) {
    return "neutral";
  }

  const spread = ask - bid;
  const tolerance = Math.max(0.01, spread * 0.1);
  const midpointPrice = (bid + ask) / 2;
  const atAsk = lastTradePrice >= ask - tolerance;
  const atBid = lastTradePrice <= bid + tolerance;

  if (atAsk && atBid) {
    return lastTradePrice >= midpointPrice ? "buy" : "sell";
  }

  if (atAsk) return "buy";
  if (atBid) return "sell";
  return "neutral";
}

function classifyFlowEventSideFromQuote(
  lastTradePrice: number,
  bid: number,
  ask: number,
): FlowEventSideClassification {
  const side = inferTradeSideFromQuote(lastTradePrice, bid, ask);
  return side === "neutral"
    ? neutralFlowEventSideClassification()
    : { side, sideBasis: "quote_match", sideConfidence: "high" };
}

function inferPremiumDistributionSide(
  lastTradePrice: number,
  bid: number,
  ask: number,
): PremiumDistributionSide {
  return inferTradeSideFromQuote(lastTradePrice, bid, ask);
}

function resolveMarketCapTier(
  marketCap: number | null | undefined,
): PremiumDistributionMarketCapTier {
  if (!marketCap || marketCap < 2_000_000_000) return "small_or_unknown";
  if (marketCap >= 200_000_000_000) return "mega";
  if (marketCap >= 10_000_000_000) return "large";
  return "mid";
}

function resolvePremiumBucketThresholds(
  marketCapTier: PremiumDistributionMarketCapTier,
): PremiumDistributionBucketThresholds {
  if (marketCapTier === "mega") {
    return { smallMin: 0, mediumMin: 50_000, largeMin: 250_000 };
  }

  if (marketCapTier === "large") {
    return { smallMin: 0, mediumMin: 25_000, largeMin: 100_000 };
  }

  if (marketCapTier === "mid") {
    return { smallMin: 0, mediumMin: 10_000, largeMin: 50_000 };
  }

  return { smallMin: 0, mediumMin: 5_000, largeMin: 25_000 };
}

function premiumBucketForValue(
  value: number,
  thresholds: PremiumDistributionBucketThresholds,
): PremiumDistributionBucketName {
  if (value >= thresholds.largeMin) return "large";
  if (value >= thresholds.mediumMin) return "medium";
  return "small";
}

function emptyPremiumBuckets(): Record<PremiumDistributionBucketName, PremiumDistributionBucket> {
  return {
    small: {
      inflowPremium: 0,
      outflowPremium: 0,
      buyPremium: 0,
      sellPremium: 0,
      neutralPremium: 0,
      totalPremium: 0,
      count: 0,
    },
    medium: {
      inflowPremium: 0,
      outflowPremium: 0,
      buyPremium: 0,
      sellPremium: 0,
      neutralPremium: 0,
      totalPremium: 0,
      count: 0,
    },
    large: {
      inflowPremium: 0,
      outflowPremium: 0,
      buyPremium: 0,
      sellPremium: 0,
      neutralPremium: 0,
      totalPremium: 0,
      count: 0,
    },
  };
}

function emptyPremiumTradeBuckets(): PremiumDistributionTradeBuckets {
  return {
    small: { buyPremium: 0, sellPremium: 0, count: 0 },
    medium: { buyPremium: 0, sellPremium: 0, count: 0 },
    large: { buyPremium: 0, sellPremium: 0, count: 0 },
  };
}

function emptyPremiumHydrationDiagnostics(): PremiumDistributionHydrationDiagnostics {
  return {
    snapshotCount: 0,
    usablePremiumSnapshotCount: 0,
    usablePremiumTotal: 0,
    selectedPremiumTotal: 0,
    classificationTargetPremiumCoverage: 0,
    selectedPremiumCoverage: 0,
    pageCount: 0,
    snapshotTradingDate: null,
    tradeLookbackStartDate: null,
    quoteProbeDate: null,
    quoteProbeStatus: "not_attempted",
    quoteProbeMessage: null,
    tradeContractCandidateCount: 0,
    tradeContractHydratedCount: 0,
    tradeCallAttemptCount: 0,
    tradeCallSuccessCount: 0,
    tradeCallErrorCount: 0,
    tradeCallForbiddenCount: 0,
    eligibleTradeCount: 0,
    ineligibleTradeCount: 0,
    unknownConditionTradeCount: 0,
    conditionCodes: [],
    exchangeCodes: [],
    classifiedContractCoverage: 0,
  };
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].filter(Boolean).sort();
}

function clampUnitInterval(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 0;
}

function addPremiumToTradeBucket(input: {
  buckets: PremiumDistributionTradeBuckets;
  thresholds: PremiumDistributionBucketThresholds;
  side: Exclude<PremiumDistributionSide, "neutral">;
  premium: number;
  count?: number;
}): void {
  if (!Number.isFinite(input.premium) || input.premium <= 0) {
    return;
  }

  const bucketName = premiumBucketForValue(input.premium, input.thresholds);
  const bucket = input.buckets[bucketName];
  if (input.side === "buy") {
    bucket.buyPremium += input.premium;
  } else {
    bucket.sellPremium += input.premium;
  }
  bucket.count += Math.max(1, Math.floor(input.count ?? 1));
}

function buildAggregateClassifiedBuckets(input: {
  thresholds: PremiumDistributionBucketThresholds;
  buyPremium: number;
  sellPremium: number;
}): PremiumDistributionTradeBuckets {
  const buckets = emptyPremiumTradeBuckets();
  addPremiumToTradeBucket({
    buckets,
    thresholds: input.thresholds,
    side: "buy",
    premium: input.buyPremium,
  });
  addPremiumToTradeBucket({
    buckets,
    thresholds: input.thresholds,
    side: "sell",
    premium: input.sellPremium,
  });
  return buckets;
}

function scalePremiumTradeBuckets(input: {
  buckets: PremiumDistributionTradeBuckets;
  buyScale: number;
  sellScale: number;
}): PremiumDistributionTradeBuckets {
  const output = emptyPremiumTradeBuckets();
  (["small", "medium", "large"] as const).forEach((bucketName) => {
    const bucket = input.buckets[bucketName];
    output[bucketName] = {
      buyPremium: bucket.buyPremium * input.buyScale,
      sellPremium: bucket.sellPremium * input.sellScale,
      count: bucket.count,
    };
  });
  return output;
}

function readQuoteBid(record: Record<string, unknown> | null): number {
  return (
    firstDefined(
      getNumberPath(record, ["bid_price"]),
      getNumberPath(record, ["bidPrice"]),
      getNumberPath(record, ["bid"]),
      getNumberPath(record, ["bp"]),
      getNumberPath(record, ["p"]),
    ) ?? 0
  );
}

function readQuoteAsk(record: Record<string, unknown> | null): number {
  return (
    firstDefined(
      getNumberPath(record, ["ask_price"]),
      getNumberPath(record, ["askPrice"]),
      getNumberPath(record, ["ask"]),
      getNumberPath(record, ["ap"]),
      getNumberPath(record, ["P"]),
    ) ?? 0
  );
}

function readOptionSnapshotTicker(snapshot: unknown): string | null {
  const record = asRecord(snapshot);
  const details = asRecord(record?.["details"]) ?? record;
  return asString(details?.["ticker"]);
}

function readOptionSnapshotSharesPerContract(snapshot: unknown): number {
  const record = asRecord(snapshot);
  const details = asRecord(record?.["details"]) ?? record;
  const sharesPerContract =
    asNumber(details?.["shares_per_contract"]) ??
    asNumber(details?.["multiplier"]) ??
    100;
  return sharesPerContract > 0 ? sharesPerContract : 100;
}

function readOptionSnapshotUnderlyingPrice(snapshot: unknown): number | null {
  const record = asRecord(snapshot);
  const underlyingAsset = asRecord(record?.["underlying_asset"]);
  const price =
    firstDefined(
      asNumber(record?.["underlying_price"]),
      asNumber(record?.["underlyingPrice"]),
      asNumber(underlyingAsset?.["price"]),
      asNumber(underlyingAsset?.["last_price"]),
    ) ?? null;
  return price !== null && price > 0 ? price : null;
}

function syntheticSnapshotFromHistoricalContract(
  contract: HistoricalOptionContract,
  underlyingPrice: number | null,
): unknown {
  return {
    details: {
      ticker: contract.ticker,
      underlying_ticker: contract.underlying,
      expiration_date: contract.expirationDate,
      strike_price: contract.strike,
      contract_type: contract.right,
      shares_per_contract: contract.sharesPerContract,
      multiplier: contract.multiplier,
    },
    open_interest: 0,
    underlying_price: underlyingPrice,
  };
}

function latestDate(values: Iterable<Date | null>): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (!value || Number.isNaN(value.getTime())) continue;
    if (!latest || value.getTime() > latest.getTime()) {
      latest = value;
    }
  }
  return latest;
}

function deriveOptionSnapshotTradingDate(
  snapshots: unknown[],
  fallback: Date,
): Date {
  const dayDates: Array<Date | null> = [];
  const tradeDates: Array<Date | null> = [];

  snapshots.forEach((snapshot) => {
    const record = asRecord(snapshot);
    const day = asRecord(record?.["day"]);
    const lastTrade = asRecord(record?.["last_trade"]);
    dayDates.push(toDate(getNumberPath(day, ["last_updated"])));
    tradeDates.push(
      firstDefined(
        toDate(getNumberPath(lastTrade, ["sip_timestamp"])),
        toDate(getNumberPath(lastTrade, ["participant_timestamp"])),
        toDate(getNumberPath(lastTrade, ["t"])),
      ),
    );
  });

  return latestDate(dayDates) ?? latestDate(tradeDates) ?? fallback;
}

function clampClassifiedPremium(
  totalPremium: number,
  buyPremium: number,
  sellPremium: number,
): { buyPremium: number; sellPremium: number; classifiedPremium: number } {
  const safeBuy = Math.max(0, Number.isFinite(buyPremium) ? buyPremium : 0);
  const safeSell = Math.max(0, Number.isFinite(sellPremium) ? sellPremium : 0);
  const clampedBuy = Math.min(totalPremium, safeBuy);
  const clampedSell = Math.min(Math.max(0, totalPremium - clampedBuy), safeSell);
  return {
    buyPremium: clampedBuy,
    sellPremium: clampedSell,
    classifiedPremium: clampedBuy + clampedSell,
  };
}

function getOptionSnapshotPremium(
  snapshot: unknown,
  tradeClassification?: PremiumDistributionTradeClassification,
  bucketThresholds: PremiumDistributionBucketThresholds = resolvePremiumBucketThresholds(
    "small_or_unknown",
  ),
): {
  totalPremium: number;
  classifiedPremium: number;
  buyPremium: number;
  sellPremium: number;
  neutralPremium: number;
  classifiedBuckets: PremiumDistributionTradeBuckets;
  right: OptionRight | null;
  tradeCount: number;
  quoteMatchedCount: number;
  tickTestMatchedCount: number;
  sideBasis: Exclude<PremiumDistributionSideBasis, "mixed">;
  hasQuote: boolean;
} | null {
  const record = asRecord(snapshot);

  if (!record) {
    return null;
  }

  const details = asRecord(record["details"]) ?? record;
  const right = normalizeOptionRight(asString(details["contract_type"]));
  const sharesPerContract =
    asNumber(details["shares_per_contract"]) ??
    asNumber(details["multiplier"]) ??
    100;
  const day = asRecord(record["day"]);
  const session = asRecord(record["session"]);
  const lastTrade = asRecord(record["last_trade"]);
  const lastQuote = asRecord(record["last_quote"]);
  const totalPrice =
    firstDefined(
      getNumberPath(session, ["vwap"]),
      getNumberPath(session, ["vw"]),
      getNumberPath(day, ["vw"]),
      getNumberPath(day, ["vwap"]),
      getNumberPath(day, ["close"]),
      getNumberPath(day, ["c"]),
    ) ?? null;
  const totalVolume =
    firstDefined(
      getNumberPath(session, ["volume"]),
      getNumberPath(session, ["v"]),
      getNumberPath(day, ["volume"]),
      getNumberPath(day, ["v"]),
    ) ?? null;

  if (
    totalPrice === null ||
    totalVolume === null ||
    totalPrice <= 0 ||
    totalVolume <= 0 ||
    sharesPerContract <= 0
  ) {
    return null;
  }

  const totalPremium = totalPrice * totalVolume * sharesPerContract;
  const bid = readQuoteBid(lastQuote);
  const ask = readQuoteAsk(lastQuote);
  const hasQuote = bid > 0 && ask > 0;
  const explicitLastTradePrice =
    firstDefined(
      getNumberPath(lastTrade, ["price"]),
      getNumberPath(lastTrade, ["p"]),
    ) ?? null;
  const explicitLastTradeSize =
    firstDefined(
      getNumberPath(lastTrade, ["size"]),
      getNumberPath(lastTrade, ["s"]),
    ) ?? null;
  const hasTrade =
    explicitLastTradePrice !== null &&
    explicitLastTradePrice > 0 &&
    explicitLastTradeSize !== null &&
    explicitLastTradeSize > 0;
  const side = hasTrade
    ? inferPremiumDistributionSide(explicitLastTradePrice, bid, ask)
    : "neutral";

  if (hasTrade && side !== "neutral") {
    const rawClassifiedPremium =
      explicitLastTradePrice * explicitLastTradeSize * sharesPerContract;
    const classified = clampClassifiedPremium(
      totalPremium,
      side === "buy" ? rawClassifiedPremium : 0,
      side === "sell" ? rawClassifiedPremium : 0,
    );
    const classifiedBuckets = emptyPremiumTradeBuckets();
    if (classified.buyPremium > 0) {
      addPremiumToTradeBucket({
        buckets: classifiedBuckets,
        thresholds: bucketThresholds,
        side: "buy",
        premium: classified.buyPremium,
      });
    }
    if (classified.sellPremium > 0) {
      addPremiumToTradeBucket({
        buckets: classifiedBuckets,
        thresholds: bucketThresholds,
        side: "sell",
        premium: classified.sellPremium,
      });
    }
    return {
      totalPremium,
      ...classified,
      neutralPremium: Math.max(0, totalPremium - classified.classifiedPremium),
      classifiedBuckets,
      right,
      tradeCount: 1,
      quoteMatchedCount: 1,
      tickTestMatchedCount: 0,
      sideBasis: "quote_match",
      hasQuote,
    };
  }

  if (tradeClassification && tradeClassification.tradeCount > 0) {
    const classified = clampClassifiedPremium(
      totalPremium,
      tradeClassification.buyPremium,
      tradeClassification.sellPremium,
    );
    const sourceBuckets =
      tradeClassification.buckets ??
      buildAggregateClassifiedBuckets({
        thresholds: bucketThresholds,
        buyPremium: tradeClassification.buyPremium,
        sellPremium: tradeClassification.sellPremium,
      });
    const classifiedBuckets = scalePremiumTradeBuckets({
      buckets: sourceBuckets,
      buyScale:
        tradeClassification.buyPremium > 0
          ? classified.buyPremium / tradeClassification.buyPremium
          : 0,
      sellScale:
        tradeClassification.sellPremium > 0
          ? classified.sellPremium / tradeClassification.sellPremium
          : 0,
    });
    return {
      totalPremium,
      ...classified,
      neutralPremium: Math.max(0, totalPremium - classified.classifiedPremium),
      classifiedBuckets,
      right,
      tradeCount: tradeClassification.tradeCount,
      quoteMatchedCount: 0,
      tickTestMatchedCount: tradeClassification.tickTestMatchedCount,
      sideBasis: classified.classifiedPremium > 0 ? "tick_test" : "none",
      hasQuote,
    };
  }

  return {
    totalPremium,
    classifiedPremium: 0,
    buyPremium: 0,
    sellPremium: 0,
    neutralPremium: totalPremium,
    classifiedBuckets: emptyPremiumTradeBuckets(),
    right,
    tradeCount: hasTrade ? 1 : 0,
    quoteMatchedCount: 0,
    tickTestMatchedCount: 0,
    sideBasis: "none",
    hasQuote,
  };
}

function combinePremiumDistributionSideBasis(input: {
  quoteMatchedCount: number;
  tickTestMatchedCount: number;
}): PremiumDistributionSideBasis {
  if (input.quoteMatchedCount > 0 && input.tickTestMatchedCount > 0) {
    return "mixed";
  }
  if (input.quoteMatchedCount > 0) return "quote_match";
  if (input.tickTestMatchedCount > 0) return "tick_test";
  return "none";
}

export function resolvePremiumDistributionClassificationConfidence(input: {
  classificationCoverage: number;
  sideBasis: PremiumDistributionSideBasis;
  quoteAccess: PremiumDistributionDataAccess;
  tradeAccess: PremiumDistributionDataAccess;
}): PremiumDistributionClassificationConfidence {
  const coverage = Number.isFinite(input.classificationCoverage)
    ? Math.max(0, Math.min(1, input.classificationCoverage))
    : 0;

  if (input.sideBasis === "none" || coverage <= 0) {
    return "none";
  }
  if (coverage < 0.01) {
    return "very_low";
  }
  if (coverage < 0.1) {
    return "low";
  }
  if (coverage < 0.35) {
    return "medium";
  }
  return "high";
}

function buildPremiumDistributionHydrationWarning(input: {
  classificationConfidence: PremiumDistributionClassificationConfidence;
  classificationCoverage: number;
  quoteAccess: PremiumDistributionDataAccess;
  tradeAccess: PremiumDistributionDataAccess;
}): string | null {
  if (input.quoteAccess === "forbidden" && input.tradeAccess === "forbidden") {
    return "Option quote-match and option trades are unavailable from the current Polygon/Massive endpoints; totals are hydrated but side split is unavailable.";
  }
  if (input.quoteAccess === "forbidden") {
    return "Option quote-match data is unavailable from the current Polygon/Massive endpoint; side split uses option trade tick-test.";
  }
  if (input.tradeAccess === "forbidden") {
    return "Option trades are unavailable from the current Polygon/Massive endpoint; side split is unavailable.";
  }
  if (
    input.classificationConfidence === "none" ||
    input.classificationConfidence === "very_low"
  ) {
    const percent =
      input.classificationCoverage > 0 && input.classificationCoverage < 0.01
        ? "<1%"
        : `${Math.round(input.classificationCoverage * 100)}%`;
    return `${percent} trade-classified; totals are hydrated but side split is uncertain.`;
  }
  return null;
}

export type OptionTradePrint = {
  price: number;
  size: number;
  occurredAt: Date;
  sequenceNumber: number | null;
  conditionCodes: string[];
  exchange: string | null;
};

type OptionPremiumTradePrint = OptionTradePrint;

type OptionTradeConditionMetadata = {
  updatesVolume: boolean | null;
  name: string | null;
};

type OptionTradeConditionMap = ReadonlyMap<string, OptionTradeConditionMetadata>;

function mapOptionPremiumTradePrint(result: unknown): OptionPremiumTradePrint | null {
  const record = asRecord(result);
  if (!record) return null;

  const price =
    firstDefined(
      getNumberPath(record, ["price"]),
      getNumberPath(record, ["p"]),
    ) ?? null;
  const size =
    firstDefined(
      getNumberPath(record, ["size"]),
      getNumberPath(record, ["s"]),
    ) ?? null;
  const occurredAt =
    firstDefined(
      toDate(getNumberPath(record, ["sip_timestamp"])),
      toDate(getNumberPath(record, ["participant_timestamp"])),
      toDate(getNumberPath(record, ["t"])),
    ) ?? null;

  if (
    price === null ||
    price <= 0 ||
    size === null ||
    size <= 0 ||
    !occurredAt
  ) {
    return null;
  }

  return {
    price,
    size,
    occurredAt,
    sequenceNumber: asNumber(record["sequence_number"]),
    conditionCodes: [
      ...new Set(
        asArray(record["conditions"])
          .map((condition) => asString(condition))
          .filter((condition): condition is string => condition !== null),
      ),
    ],
    exchange:
      firstDefined(asString(record["exchange"]), asString(record["x"])) ?? null,
  };
}

function optionTradePrintEligibility(
  trade: OptionPremiumTradePrint,
  conditionMetadata?: OptionTradeConditionMap,
): { eligible: boolean; unknownCondition: boolean } {
  if (!conditionMetadata || !trade.conditionCodes.length) {
    return { eligible: true, unknownCondition: false };
  }

  let unknownCondition = false;
  for (const code of trade.conditionCodes) {
    const condition = conditionMetadata.get(code);
    if (!condition) {
      unknownCondition = true;
      continue;
    }
    if (condition.updatesVolume === false) {
      return { eligible: false, unknownCondition };
    }
  }

  return { eligible: true, unknownCondition };
}

const compareOptionTradePrints = (
  left: OptionPremiumTradePrint,
  right: OptionPremiumTradePrint,
): number => {
  const timeDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
  if (timeDelta !== 0) return timeDelta;
  return (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0);
};

const createTickTestSideClassifier = (): ((
  trade: Pick<OptionPremiumTradePrint, "price">,
) => FlowEventSideClassification) => {
  let previousPrice: number | null = null;
  let previousSide: PremiumDistributionSide = "neutral";

  return (trade) => {
    let side: PremiumDistributionSide = "neutral";
    let sideConfidence: FlowEventSideConfidence = "none";

    if (previousPrice !== null) {
      if (trade.price > previousPrice) {
        side = "buy";
        sideConfidence = "medium";
      } else if (trade.price < previousPrice) {
        side = "sell";
        sideConfidence = "medium";
      } else if (previousSide !== "neutral") {
        side = previousSide;
        sideConfidence = "low";
      }
    }

    if (side !== "neutral") {
      previousSide = side;
    }
    previousPrice = trade.price;

    return side === "neutral"
      ? neutralFlowEventSideClassification()
      : { side, sideBasis: "tick_test", sideConfidence };
  };
};

function classifyOptionPremiumTradePrints(input: {
  trades: unknown[];
  sharesPerContract: number;
  bucketThresholds: PremiumDistributionBucketThresholds;
  conditionMetadata?: OptionTradeConditionMap;
}): PremiumDistributionTradeClassification {
  const trades = compact(input.trades.map(mapOptionPremiumTradePrint)).sort(
    compareOptionTradePrints,
  );
  const sharesPerContract =
    input.sharesPerContract > 0 ? input.sharesPerContract : 100;
  const classifyTickTestSide = createTickTestSideClassifier();
  let buyPremium = 0;
  let sellPremium = 0;
  let tickTestMatchedCount = 0;
  let eligibleTradeCount = 0;
  let ineligibleTradeCount = 0;
  let unknownConditionTradeCount = 0;
  const conditionCodes = new Set<string>();
  const exchangeCodes = new Set<string>();
  const buckets = emptyPremiumTradeBuckets();

  trades.forEach((trade) => {
    trade.conditionCodes.forEach((code) => conditionCodes.add(code));
    if (trade.exchange) exchangeCodes.add(trade.exchange);
    const eligibility = optionTradePrintEligibility(
      trade,
      input.conditionMetadata,
    );
    if (!eligibility.eligible) {
      ineligibleTradeCount += 1;
      return;
    }
    eligibleTradeCount += 1;
    if (eligibility.unknownCondition) {
      unknownConditionTradeCount += 1;
    }

    const { side } = classifyTickTestSide(trade);

    if (side !== "neutral") {
      const premium = trade.price * trade.size * sharesPerContract;
      if (side === "buy") {
        buyPremium += premium;
        addPremiumToTradeBucket({
          buckets,
          thresholds: input.bucketThresholds,
          side: "buy",
          premium,
        });
      }
      if (side === "sell") {
        sellPremium += premium;
        addPremiumToTradeBucket({
          buckets,
          thresholds: input.bucketThresholds,
          side: "sell",
          premium,
        });
      }
      tickTestMatchedCount += 1;
    }
  });

  return {
    buyPremium,
    sellPremium,
    tradeCount: trades.length,
    eligibleTradeCount,
    ineligibleTradeCount,
    unknownConditionTradeCount,
    tickTestMatchedCount,
    conditionCodes: uniqueSorted(conditionCodes),
    exchangeCodes: uniqueSorted(exchangeCodes),
    buckets,
  };
}

async function mapWithLocalConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );

  return results;
}

function isHttpStatus(error: unknown, statusCode: number): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { statusCode?: unknown }).statusCode === statusCode
  );
}

export function aggregateOptionPremiumDistributionSnapshots(input: {
  underlying: string;
  snapshots: unknown[];
  tradeClassifications?: ReadonlyMap<string, PremiumDistributionTradeClassification>;
  stockDayVolume?: number | null;
  timeframe?: PremiumDistributionTimeframe;
  marketCap?: number | null;
  asOf?: Date;
  delayed?: boolean;
  quoteAccess?: PremiumDistributionDataAccess;
  tradeAccess?: PremiumDistributionDataAccess;
  hydrationDiagnostics?: Partial<PremiumDistributionHydrationDiagnostics>;
  pageCount?: number;
}): OptionPremiumDistribution {
  const marketCap =
    input.marketCap && input.marketCap > 0 ? input.marketCap : null;
  const marketCapTier = resolveMarketCapTier(marketCap);
  const bucketThresholds = resolvePremiumBucketThresholds(marketCapTier);
  const buckets = emptyPremiumBuckets();
  let premiumTotal = 0;
  let buyPremium = 0;
  let sellPremium = 0;
  let neutralPremium = 0;
  let callPremium = 0;
  let putPremium = 0;
  let contractCount = 0;
  let tradeCount = 0;
  let classifiedTradeCount = 0;
  let quoteMatchedCount = 0;
  let tickTestMatchedCount = 0;
  let quoteSampleCount = 0;
  let eligibleTradeCount = 0;
  let ineligibleTradeCount = 0;
  let unknownConditionTradeCount = 0;
  let tradeContractHydratedCount = 0;
  const conditionCodes = new Set<string>();
  const exchangeCodes = new Set<string>();

  input.snapshots.forEach((snapshot) => {
    const ticker = readOptionSnapshotTicker(snapshot);
    const premium = getOptionSnapshotPremium(
      snapshot,
      ticker ? input.tradeClassifications?.get(ticker) : undefined,
      bucketThresholds,
    );
    if (!premium) {
      return;
    }

    contractCount += 1;
    tradeCount += premium.tradeCount;
    classifiedTradeCount +=
      premium.quoteMatchedCount + premium.tickTestMatchedCount;
    quoteMatchedCount += premium.quoteMatchedCount;
    tickTestMatchedCount += premium.tickTestMatchedCount;
    if (premium.hasQuote) quoteSampleCount += 1;
    const tradeClassification = ticker
      ? input.tradeClassifications?.get(ticker)
      : undefined;
    if (tradeClassification) {
      if (tradeClassification.tradeCount > 0) {
        tradeContractHydratedCount += 1;
      }
      eligibleTradeCount +=
        tradeClassification.eligibleTradeCount ?? tradeClassification.tradeCount;
      ineligibleTradeCount += tradeClassification.ineligibleTradeCount ?? 0;
      unknownConditionTradeCount +=
        tradeClassification.unknownConditionTradeCount ?? 0;
      tradeClassification.conditionCodes?.forEach((code) =>
        conditionCodes.add(code),
      );
      tradeClassification.exchangeCodes?.forEach((code) =>
        exchangeCodes.add(code),
      );
    }

    premiumTotal += premium.totalPremium;
    if (premium.right === "call") callPremium += premium.totalPremium;
    if (premium.right === "put") putPremium += premium.totalPremium;

    buyPremium += premium.buyPremium;
    sellPremium += premium.sellPremium;
    neutralPremium += premium.neutralPremium;

    (["small", "medium", "large"] as const).forEach((bucketName) => {
      const classifiedBucket = premium.classifiedBuckets[bucketName];
      const bucket = buckets[bucketName];
      bucket.inflowPremium += classifiedBucket.buyPremium;
      bucket.buyPremium += classifiedBucket.buyPremium;
      bucket.outflowPremium += classifiedBucket.sellPremium;
      bucket.sellPremium += classifiedBucket.sellPremium;
      bucket.totalPremium +=
        classifiedBucket.buyPremium + classifiedBucket.sellPremium;
      bucket.count += classifiedBucket.count;
    });

    const neutralBucket =
      buckets[premiumBucketForValue(premium.totalPremium, bucketThresholds)];
    neutralBucket.neutralPremium += premium.neutralPremium;
    neutralBucket.totalPremium += premium.neutralPremium;
    if (premium.neutralPremium > 0) {
      neutralBucket.count += 1;
    }
  });

  const classifiedPremium = buyPremium + sellPremium;
  const sideBasis = combinePremiumDistributionSideBasis({
    quoteMatchedCount,
    tickTestMatchedCount,
  });
  const classificationCoverage =
    premiumTotal > 0 ? classifiedPremium / premiumTotal : 0;
  const quoteAccess: PremiumDistributionDataAccess =
    input.quoteAccess ??
    (quoteSampleCount > 0 ? "available" : "unavailable");
  const tradeAccess: PremiumDistributionDataAccess =
    input.tradeAccess ?? (tradeCount > 0 ? "available" : "unavailable");
  const classificationConfidence =
    resolvePremiumDistributionClassificationConfidence({
      classificationCoverage,
      sideBasis,
      quoteAccess,
      tradeAccess,
    });
  const hydrationDiagnostics: PremiumDistributionHydrationDiagnostics = {
    ...emptyPremiumHydrationDiagnostics(),
    ...input.hydrationDiagnostics,
    snapshotCount: input.snapshots.length,
    usablePremiumSnapshotCount: contractCount,
    usablePremiumTotal:
      input.hydrationDiagnostics?.usablePremiumTotal ?? premiumTotal,
    selectedPremiumTotal:
      input.hydrationDiagnostics?.selectedPremiumTotal ?? 0,
    classificationTargetPremiumCoverage:
      input.hydrationDiagnostics?.classificationTargetPremiumCoverage ?? 0,
    selectedPremiumCoverage:
      input.hydrationDiagnostics?.selectedPremiumCoverage ??
      (premiumTotal > 0
        ? Math.min(
            1,
            Math.max(0, input.hydrationDiagnostics?.selectedPremiumTotal ?? 0) /
              premiumTotal,
          )
        : 0),
    pageCount: Math.max(0, Math.floor(input.pageCount ?? 0)),
    tradeContractHydratedCount:
      input.hydrationDiagnostics?.tradeContractHydratedCount ??
      tradeContractHydratedCount,
    eligibleTradeCount:
      input.hydrationDiagnostics?.eligibleTradeCount ?? eligibleTradeCount,
    ineligibleTradeCount:
      input.hydrationDiagnostics?.ineligibleTradeCount ?? ineligibleTradeCount,
    unknownConditionTradeCount:
      input.hydrationDiagnostics?.unknownConditionTradeCount ??
      unknownConditionTradeCount,
    conditionCodes: uniqueSorted([
      ...(input.hydrationDiagnostics?.conditionCodes ?? []),
      ...conditionCodes,
    ]),
    exchangeCodes: uniqueSorted([
      ...(input.hydrationDiagnostics?.exchangeCodes ?? []),
      ...exchangeCodes,
    ]),
    classifiedContractCoverage:
      contractCount > 0
        ? Math.min(contractCount, quoteMatchedCount + tradeContractHydratedCount) /
          contractCount
        : 0,
  };
  const hydrationWarning = buildPremiumDistributionHydrationWarning({
    classificationConfidence,
    classificationCoverage,
    quoteAccess,
    tradeAccess,
  });

  return {
    symbol: normalizeSymbol(input.underlying),
    asOf: input.asOf ?? new Date(),
    timeframe: input.timeframe ?? "today",
    stockDayVolume: input.stockDayVolume ?? null,
    marketCap,
    marketCapTier,
    bucketThresholds,
    premiumTotal,
    classifiedPremium,
    classificationCoverage,
    classificationConfidence,
    hydrationWarning,
    hydrationDiagnostics,
    netPremium: buyPremium - sellPremium,
    inflowPremium: buyPremium,
    outflowPremium: sellPremium,
    buyPremium,
    sellPremium,
    neutralPremium,
    callPremium,
    putPremium,
    buckets,
    contractCount,
    tradeCount,
    classifiedTradeCount,
    quoteMatchedCount,
    tickTestMatchedCount,
    sideBasis,
    quoteAccess,
    tradeAccess,
    source: "polygon-options-snapshot",
    confidence:
      contractCount > 0 && quoteMatchedCount === contractCount ? "snapshot" : "partial",
    delayed: Boolean(input.delayed),
    pageCount: Math.max(0, Math.floor(input.pageCount ?? 0)),
  };
}

function inferSentiment(right: OptionRight, side: string): FlowSentiment {
  const normalizedSide = side.toLowerCase();
  if (normalizedSide !== "buy" && normalizedSide !== "sell") {
    return "neutral";
  }

  if (right === "call") {
    return normalizedSide === "buy" ? "bullish" : "bearish";
  }

  return normalizedSide === "buy" ? "bearish" : "bullish";
}

// Volume relative to open interest indicates "unusual" options activity:
// when more contracts trade in a session than were open at the prior close,
// the print is much more likely to represent a fresh institutional position
// rather than routine market-making turnover. We surface both a continuous
// score (volume / openInterest, capped) and a boolean flag using a default
// threshold of 1.0 so consumers can highlight the print or change the cutoff.
export const UNUSUAL_VOLUME_OI_RATIO = 1;

export function computeUnusualMetrics(
  size: number,
  openInterest: number,
  threshold: number = UNUSUAL_VOLUME_OI_RATIO,
): { unusualScore: number; isUnusual: boolean } {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 0;
  const safeOi = Number.isFinite(openInterest) && openInterest > 0 ? openInterest : 0;
  if (safeSize <= 0) {
    return { unusualScore: 0, isUnusual: false };
  }
  // When OI is unknown/zero treat any non-trivial volume as unusual but cap
  // the score at 10 so a single missing-OI print can't dominate sorting.
  if (safeOi <= 0) {
    return { unusualScore: 10, isUnusual: true };
  }
  const ratio = safeSize / safeOi;
  // Cap at 10× so a single extreme print can't dominate score-based sorting
  // and so the field has a documented upper bound.
  const cappedRatio = Math.min(10, ratio);
  const unusualScore = Math.round(cappedRatio * 100) / 100;
  return { unusualScore, isUnusual: ratio >= threshold };
}

function mapFlowEvent(
  underlying: string,
  result: unknown,
  unusualThreshold?: number,
  sideClassification?: FlowEventSideClassification,
): FlowEvent | null {
  const record = asRecord(result);

  if (!record) {
    return null;
  }

  const details = asRecord(record["details"]) ?? record;
  const lastTrade = asRecord(record["last_trade"]);

  if (!lastTrade) {
    return null;
  }

  const optionTicker = asString(details["ticker"]);
  const expirationDate = toDate(details["expiration_date"]);
  const strike = asNumber(details["strike_price"]);
  const right = normalizeOptionRight(asString(details["contract_type"]));
  const price =
    firstDefined(
      getNumberPath(lastTrade, ["price"]),
      getNumberPath(lastTrade, ["p"]),
    ) ?? null;
  const size =
    firstDefined(
      getNumberPath(lastTrade, ["size"]),
      getNumberPath(lastTrade, ["s"]),
    ) ?? null;

  if (
    !optionTicker ||
    !expirationDate ||
    strike === null ||
    !right ||
    price === null ||
    size === null
  ) {
    return null;
  }

  const lastQuote = asRecord(record["last_quote"]);
  const bid =
    firstDefined(
      getNumberPath(lastQuote, ["bid_price"]),
      getNumberPath(lastQuote, ["bp"]),
      getNumberPath(lastQuote, ["p"]),
    ) ?? 0;
  const ask =
    firstDefined(
      getNumberPath(lastQuote, ["ask_price"]),
      getNumberPath(lastQuote, ["ap"]),
      getNumberPath(lastQuote, ["P"]),
    ) ?? 0;
  const greeks = asRecord(record["greeks"]);
  const underlyingAsset = asRecord(record["underlying_asset"]);
  const underlyingPrice = firstDefined(
    asNumber(record["underlying_price"]),
    asNumber(record["underlyingPrice"]),
    asNumber(underlyingAsset?.["price"]),
    asNumber(underlyingAsset?.["last_price"]),
  );
  const distancePercent =
    underlyingPrice !== null && underlyingPrice > 0
      ? ((strike - underlyingPrice) / underlyingPrice) * 100
      : null;
  const absoluteDistance =
    underlyingPrice !== null ? Math.abs(strike - underlyingPrice) : null;
  const atmBand =
    underlyingPrice !== null ? Math.max(0.01, underlyingPrice * 0.0025) : null;
  const moneyness =
    underlyingPrice === null || atmBand === null || absoluteDistance === null
      ? null
      : absoluteDistance <= atmBand
        ? "ATM"
        : right === "call"
          ? strike < underlyingPrice
            ? "ITM"
            : "OTM"
          : strike > underlyingPrice
            ? "ITM"
            : "OTM";

  const sharesPerContract = asNumber(details["shares_per_contract"]) ?? 100;
  const occurredAt =
    firstDefined(
      toDate(getNumberPath(lastTrade, ["sip_timestamp"])),
      toDate(getNumberPath(lastTrade, ["participant_timestamp"])),
      toDate(getNumberPath(lastTrade, ["t"])),
    ) ?? new Date();
  const resolvedSideClassification =
    sideClassification ?? classifyFlowEventSideFromQuote(price, bid, ask);
  const side =
    resolvedSideClassification.side === "neutral"
      ? "mid"
      : resolvedSideClassification.side;
  const openInterest = asNumber(record["open_interest"]) ?? 0;
  const { unusualScore, isUnusual } = computeUnusualMetrics(
    size,
    openInterest,
    unusualThreshold,
  );

  return {
    id: `${optionTicker}-${occurredAt.getTime()}`,
    underlying: normalizeSymbol(
      asString(details["underlying_ticker"]) ?? underlying,
    ),
    provider: "polygon",
    basis: "trade",
    optionTicker,
    providerContractId: null,
    strike,
    expirationDate,
    right,
    price,
    size,
    premium: price * size * sharesPerContract,
    openInterest,
    impliedVolatility: asNumber(record["implied_volatility"]),
    exchange:
      firstDefined(
        asString(lastTrade["exchange"]),
        asString(lastTrade["exchange_code"]),
      ) ?? "unknown",
    side,
    sideBasis: resolvedSideClassification.sideBasis,
    sideConfidence: resolvedSideClassification.sideConfidence,
    sentiment: inferSentiment(right, side),
    tradeConditions: compact(
      asArray(lastTrade["conditions"]).map((condition) => asString(condition)),
    ),
    occurredAt,
    unusualScore,
    isUnusual,
    bid,
    ask,
    mark: bid > 0 && ask > 0 ? (bid + ask) / 2 : price,
    delta: asNumber(greeks?.["delta"]),
    gamma: asNumber(greeks?.["gamma"]),
    theta: asNumber(greeks?.["theta"]),
    vega: asNumber(greeks?.["vega"]),
    underlyingPrice,
    moneyness,
    distancePercent,
    confidence: "confirmed_trade",
    sourceBasis: "confirmed_trade",
  };
}

function mapNewsArticle(article: unknown, preferredTicker?: string): NewsArticle | null {
  const record = asRecord(article);

  if (!record) {
    return null;
  }

  const id = asString(record["id"]);
  const title = asString(record["title"]);
  const articleUrl = asString(record["article_url"]);
  const publishedAt = toDate(record["published_utc"]);
  const publisher = asRecord(record["publisher"]);
  const insights = asArray(record["insights"]).flatMap((entry) => {
    const insight = asRecord(entry);
    return insight ? [insight] : [];
  });
  const matchingInsight = insights.find((insight) => {
    const ticker = asString(insight["ticker"]);
    return ticker && preferredTicker && normalizeSymbol(ticker) === normalizeSymbol(preferredTicker);
  }) ?? insights[0] ?? null;

  if (!id || !title || !articleUrl || !publishedAt) {
    return null;
  }

  return {
    id,
    title,
    description: asString(record["description"]),
    articleUrl,
    imageUrl: asString(record["image_url"]),
    author: asString(record["author"]),
    publishedAt,
    tickers: compact(
      asArray(record["tickers"]).map((ticker) => {
        const text = asString(ticker);
        return text ? normalizeSymbol(text) : null;
      }),
    ),
    publisher: {
      name: asString(publisher?.["name"]) ?? "Unknown",
      homepageUrl: asString(publisher?.["homepage_url"]),
      logoUrl: asString(publisher?.["logo_url"]),
    },
    sentiment: asString(matchingInsight?.["sentiment"]),
    sentimentReasoning: asString(matchingInsight?.["sentiment_reasoning"]),
  };
}

function mapPolygonUniverseMarket(
  market: string,
  type: string | null,
): UniverseMarket | null {
  const normalizedMarket = market.trim().toLowerCase();
  const normalizedType = type?.trim().toUpperCase() ?? "";

  if (
    normalizedMarket === "stocks" &&
    ["ETF", "ETN", "ETV", "ETS", "ETP"].includes(normalizedType)
  ) {
    return "etf";
  }

  if (
    normalizedMarket === "stocks" ||
    normalizedMarket === "indices" ||
    normalizedMarket === "fx" ||
    normalizedMarket === "crypto" ||
    normalizedMarket === "otc"
  ) {
    return normalizedMarket;
  }

  return null;
}

function mapUniverseTicker(result: unknown): UniverseTicker | null {
  const record = asRecord(result);

  if (!record) {
    return null;
  }

  const ticker = asString(record["ticker"]);
  const name = asString(record["name"]);
  const market = asString(record["market"]);
  const type = asString(record["type"]);
  const mappedMarket = market ? mapPolygonUniverseMarket(market, type) : null;

  if (!ticker || !name || !mappedMarket) {
    return null;
  }

  const normalizedTicker = normalizeSymbol(ticker);
  const primaryExchange = asString(record["primary_exchange"]);

  return {
    ticker: normalizedTicker,
    name,
    market: mappedMarket,
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
      polygonMarket: market,
      polygonType: type,
    },
    locale: asString(record["locale"]),
    type,
    active: record["active"] !== false,
    primaryExchange,
    currencyName: asString(record["currency_name"]),
    cik: asString(record["cik"]),
    compositeFigi: asString(record["composite_figi"]),
    shareClassFigi: asString(record["share_class_figi"]),
    lastUpdatedAt: toDate(record["last_updated_utc"]),
    provider: "polygon",
    providers: ["polygon"],
    tradeProvider: null,
    dataProviderPreference: "polygon",
    providerContractId: null,
  };
}

export class PolygonMarketDataClient {
  private readonly tickerLogoCache = new Map<
    string,
    { expiresAt: number; logoUrl: string | null }
  >();
  private readonly tickerMarketCapCache = new Map<
    string,
    { expiresAt: number; marketCap: number | null }
  >();
  private optionTradeConditionMetadataCache:
    | { expiresAt: number; value: Map<string, OptionTradeConditionMetadata> }
    | null = null;
  private optionQuoteAccessProbeCache:
    | {
        expiresAt: number;
        status: Extract<
          PremiumDistributionQuoteProbeStatus,
          "available" | "forbidden"
        >;
        message: string | null;
      }
    | null = null;

  constructor(private readonly config: PolygonRuntimeConfig) {}

  private async fetchJson<T>(
    input: string | URL,
    init: RequestInit = {},
  ): Promise<T> {
    try {
      const payload = await fetchJson<T>(input, init);
      recordPolygonApiSuccess();
      return payload;
    } catch (error) {
      recordPolygonApiFailure(error);
      throw error;
    }
  }

  private buildUrl(pathOrUrl: string, params: Record<string, unknown> = {}): URL {
    const baseUrl = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.config.baseUrl}${pathOrUrl}`;

    return withSearchParams(baseUrl, {
      ...params,
      apiKey: this.config.apiKey,
    });
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const normalizedSymbols = [...new Set(symbols.map(normalizeSymbol))].filter(Boolean);

    if (normalizedSymbols.length === 0) {
      return [];
    }

    const payload = await this.fetchJson<unknown>(
      this.buildUrl("/v2/snapshot/locale/us/markets/stocks/tickers", {
        tickers: normalizedSymbols.join(","),
      }),
    );

    const bySymbol = new Map(
      deriveSnapshotArray(payload)
        .map((snapshot) => {
          const mapped = mapStockSnapshot(snapshot);
          return mapped ? [mapped.symbol, mapped] : null;
        })
        .filter((entry): entry is [string, QuoteSnapshot] => entry !== null),
    );

    return normalizedSymbols.flatMap((symbol) => {
      const snapshot = bySymbol.get(symbol);
      return snapshot ? [snapshot] : [];
    });
  }

  async getGroupedDailyStockAggregates(input: {
    date: Date;
    adjusted?: boolean;
    includeOtc?: boolean;
  }): Promise<StockGroupedDailyAggregate[]> {
    const payload = await this.fetchJson<unknown>(
      this.buildUrl(
        `/v2/aggs/grouped/locale/us/market/stocks/${encodeURIComponent(
          toIsoDateString(input.date),
        )}`,
        {
          adjusted: input.adjusted ?? true,
          include_otc: input.includeOtc ?? false,
        },
      ),
    );
    const record = asRecord(payload);

    return compact(
      asArray(record?.["results"])
        .map(mapGroupedDailyAggregate)
        .filter((aggregate) => aggregate && !aggregate.otc),
    );
  }

  async getBarsPage(input: {
    symbol: string;
    timeframe: BarTimeframe;
    limit?: number;
    from?: Date;
    to?: Date;
  }): Promise<PolygonAggregateBarsPage> {
    const rangeConfig = TIMEFRAME_TO_POLYGON_RANGE[input.timeframe];
    const desiredBars = Math.max(input.limit ?? 200, 1);
    const defaultTo =
      !input.to && this.config.baseUrl.includes("massive.com") && isIntradayTimeframe(input.timeframe)
        ? new Date(Date.now() - MASSIVE_DELAYED_INTRADAY_LAG_MS)
        : new Date();
    const to = input.to ?? defaultTo;
    const lookbackMs = isIntradayTimeframe(input.timeframe)
      ? Math.max(rangeConfig.stepMs * desiredBars * 3, 24 * 60 * 60 * 1_000)
      : rangeConfig.stepMs * desiredBars;
    const from =
      input.from ?? new Date(to.getTime() - lookbackMs);
    const normalizedSymbol = normalizeSymbol(input.symbol);
    const fetchAggregateWindow = async (
      windowFrom: Date,
      windowTo: Date,
    ): Promise<{
      bars: BarSnapshot[];
      nextUrl: string | null;
      pageCount: number;
      pageLimitReached: boolean;
    }> => {
      const approximateBars = Math.max(
        1,
        Math.ceil(
          Math.max(rangeConfig.stepMs, windowTo.getTime() - windowFrom.getTime()) /
            rangeConfig.stepMs,
        ) + 1,
      );
      const baseAggregateLimit = Math.min(
        AGGREGATE_BASE_LIMIT_MAX,
        resolveAggregateBaseLimit(input.timeframe, approximateBars),
      );
      const url = this.buildUrl(
        `/v2/aggs/ticker/${encodeURIComponent(normalizedSymbol)}/range/${rangeConfig.multiplier}/${rangeConfig.timespan}/${windowFrom.getTime()}/${windowTo.getTime()}`,
        {
          adjusted: true,
          sort: "asc",
          limit: baseAggregateLimit,
        },
      );
      const bars: BarSnapshot[] = [];
      let nextUrl: string | null = url.toString();
      let rawProviderNextUrl: string | null = null;
      let pageCount = 0;
      while (nextUrl && pageCount < AGGREGATE_NEXT_PAGE_MAX) {
        const payload = await this.fetchJson<unknown>(nextUrl);
        const record = asRecord(payload);
        bars.push(...compact(asArray(record?.["results"]).map(mapAggregateBar)));
        const rawNextUrl = asString(record?.["next_url"]);
        rawProviderNextUrl = rawNextUrl;
        nextUrl = rawNextUrl ? this.buildUrl(rawNextUrl).toString() : null;
        pageCount += 1;
      }

      return {
        bars,
        nextUrl: nextUrl ? rawProviderNextUrl : null,
        pageCount,
        pageLimitReached: Boolean(nextUrl),
      };
    };
    const rangeBaseLimit = resolveAggregateWindowBaseLimit(
      input.timeframe,
      from,
      to,
    );

    const needsChunking =
      isIntradayTimeframe(input.timeframe) &&
      (to.getTime() - from.getTime() > INTRADAY_AGGREGATE_WINDOW_MS ||
        rangeBaseLimit > AGGREGATE_BASE_LIMIT_MAX);

    if (!needsChunking) {
      const page = await fetchAggregateWindow(from, to);
      return {
        ...page,
        bars: page.bars.slice(-desiredBars),
        requestedFrom: from,
        requestedTo: to,
      };
    }

    const barsByTimestamp = new Map<number, BarSnapshot>();
    let cursor = new Date(to);
    let chunkCount = 0;
    const chunkWindowMs = resolveAggregateChunkWindowMs(input.timeframe);
    let totalPageCount = 0;
    let providerNextUrl: string | null = null;
    let providerPageLimitReached = false;

    while (
      cursor.getTime() > from.getTime() &&
      barsByTimestamp.size < desiredBars &&
      chunkCount < AGGREGATE_CHUNK_MAX
    ) {
      const windowFrom = new Date(
        Math.max(from.getTime(), cursor.getTime() - chunkWindowMs),
      );
      const chunkPage = await fetchAggregateWindow(windowFrom, cursor);
      totalPageCount += chunkPage.pageCount;
      if (chunkPage.nextUrl) {
        providerNextUrl = chunkPage.nextUrl;
      }
      providerPageLimitReached =
        providerPageLimitReached || chunkPage.pageLimitReached;
      chunkPage.bars.forEach((bar) => {
        barsByTimestamp.set(bar.timestamp.getTime(), bar);
      });

      cursor = new Date(windowFrom.getTime() - rangeConfig.stepMs);
      chunkCount += 1;
    }

    return {
      bars: Array.from(barsByTimestamp.values())
        .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
        .slice(-desiredBars),
      nextUrl: providerNextUrl,
      pageCount: totalPageCount,
      pageLimitReached: providerPageLimitReached,
      requestedFrom: from,
      requestedTo: to,
    };
  }

  async getBars(input: {
    symbol: string;
    timeframe: BarTimeframe;
    limit?: number;
    from?: Date;
    to?: Date;
  }): Promise<BarSnapshot[]> {
    return (await this.getBarsPage(input)).bars;
  }

  async getBarsProviderCursorPage(input: {
    symbol: string;
    timeframe: BarTimeframe;
    providerNextUrl: string;
    limit?: number;
  }): Promise<PolygonAggregateBarsPage> {
    const desiredBars = Math.max(input.limit ?? 200, 1);
    const bars: BarSnapshot[] = [];
    let nextUrl: string | null = this.buildUrl(input.providerNextUrl).toString();
    let rawProviderNextUrl: string | null = null;
    let pageCount = 0;

    while (nextUrl && pageCount < AGGREGATE_NEXT_PAGE_MAX) {
      const payload = await this.fetchJson<unknown>(nextUrl);
      const record = asRecord(payload);
      bars.push(...compact(asArray(record?.["results"]).map(mapAggregateBar)));
      const rawNextUrl = asString(record?.["next_url"]);
      rawProviderNextUrl = rawNextUrl;
      nextUrl = rawNextUrl ? this.buildUrl(rawNextUrl).toString() : null;
      pageCount += 1;
    }

    const sortedBars = bars
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
      .slice(-desiredBars);
    const requestedFrom = sortedBars[0]?.timestamp ?? new Date(0);
    const requestedTo =
      sortedBars[sortedBars.length - 1]?.timestamp ?? requestedFrom;

    return {
      bars: sortedBars,
      nextUrl: nextUrl ? rawProviderNextUrl : null,
      pageCount,
      pageLimitReached: Boolean(nextUrl),
      requestedFrom,
      requestedTo,
    };
  }

  async getOptionAggregateBarsPage(input: {
    optionTicker: string;
    timeframe: BarTimeframe;
    limit?: number;
    from?: Date;
    to?: Date;
  }): Promise<PolygonAggregateBarsPage> {
    const desiredBars = Math.max(input.limit ?? 200, 1);
    const to =
      input.to ??
      (this.config.baseUrl.includes("massive.com") &&
      isIntradayTimeframe(input.timeframe)
        ? new Date(Date.now() - MASSIVE_DELAYED_INTRADAY_LAG_MS)
        : undefined);
    const from =
      input.from ??
      (isIntradayTimeframe(input.timeframe)
        ? new Date(
            (to?.getTime() ?? Date.now()) -
              Math.max(
                OPTION_AGGREGATE_INTRADAY_LOOKBACK_MS,
                TIMEFRAME_TO_POLYGON_RANGE[input.timeframe].stepMs * desiredBars * 20,
              ),
          )
        : undefined);

    return this.getBarsPage({
      symbol: input.optionTicker.trim().toUpperCase(),
      timeframe: input.timeframe,
      limit: input.limit,
      from,
      to,
    });
  }

  async getOptionAggregateBars(input: {
    optionTicker: string;
    timeframe: BarTimeframe;
    limit?: number;
    from?: Date;
    to?: Date;
  }): Promise<BarSnapshot[]> {
    return (await this.getOptionAggregateBarsPage(input)).bars;
  }

  async getNews(input: {
    ticker?: string;
    limit?: number;
  }): Promise<NewsArticle[]> {
    const payload = await this.fetchJson<unknown>(
      this.buildUrl("/v2/reference/news", {
        ticker: input.ticker ? normalizeSymbol(input.ticker) : undefined,
        order: "desc",
        sort: "published_utc",
        limit: Math.max(1, Math.min(input.limit ?? 10, 50)),
      }),
    );
    const record = asRecord(payload);

    return compact(
      asArray(record?.["results"]).map((article) => mapNewsArticle(article, input.ticker)),
    );
  }

  async searchUniverseTickers(input: {
    search?: string;
    market?: UniverseTicker["market"];
    markets?: UniverseTicker["market"][];
    type?: string;
    cusip?: string;
    active?: boolean;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ count: number; results: UniverseTicker[] }> {
    const requestedMarkets = new Set(input.markets ?? (input.market ? [input.market] : []));
    const polygonMarket =
      input.market === "etf"
        ? "stocks"
        : input.market === "futures"
          ? null
          : input.market;
    const polygonType =
      input.market === "etf" ? input.type ?? "ETF" : asString(input.type);

    if (polygonMarket === null) {
      return { count: 0, results: [] };
    }

    const limit = Number.isFinite(input.limit)
      ? Math.max(1, Math.floor(Number(input.limit)))
      : 50;
    const payload = await this.fetchJson<unknown>(
      this.buildUrl("/v3/reference/tickers", {
        search: input.cusip ? undefined : asString(input.search),
        cusip: asString(input.cusip),
        market: polygonMarket,
        type: polygonType,
        active: input.active,
        sort: "ticker",
        order: "asc",
        limit,
      }),
      { signal: input.signal },
    );
    const record = asRecord(payload);
    const results = compact(asArray(record?.["results"]).map(mapUniverseTicker))
      .filter((ticker) => !requestedMarkets.size || requestedMarkets.has(ticker.market))
      .map((ticker) =>
        input.cusip
          ? {
              ...ticker,
              contractMeta: {
                ...(ticker.contractMeta ?? {}),
                identifierMatch: true,
                identifierType: "cusip",
              },
            }
          : ticker,
      );

    return {
      count: asNumber(record?.["count"]) ?? results.length,
      results,
    };
  }

  async listUniverseTickersPage(input: {
    market: UniverseTicker["market"];
    type?: string;
    active?: boolean;
    limit?: number;
    cursorUrl?: string | null;
    signal?: AbortSignal;
  }): Promise<{
    count: number;
    results: UniverseTicker[];
    nextUrl: string | null;
  }> {
    const polygonMarket =
      input.market === "etf"
        ? "stocks"
        : input.market === "futures"
          ? null
          : input.market;
    const polygonType =
      input.market === "etf" ? input.type ?? "ETF" : asString(input.type);

    if (polygonMarket === null) {
      return { count: 0, results: [], nextUrl: null };
    }

    const payload = await this.fetchJson<unknown>(
      input.cursorUrl
        ? this.buildUrl(input.cursorUrl)
        : this.buildUrl("/v3/reference/tickers", {
            market: polygonMarket,
            type: polygonType,
            active: input.active,
            sort: "ticker",
            order: "asc",
            limit: Math.max(1, Math.min(input.limit ?? 1000, 1000)),
          }),
      { signal: input.signal },
    );
    const record = asRecord(payload);

    return {
      count: asNumber(record?.["count"]) ?? 0,
      results: compact(asArray(record?.["results"]).map(mapUniverseTicker)),
      nextUrl: asString(record?.["next_url"]),
    };
  }

  async getTickerLogoUrl(
    ticker: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const normalizedTicker = normalizeSymbol(ticker);
    if (!normalizedTicker) return null;

    const cached = this.tickerLogoCache.get(normalizedTicker);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.logoUrl;
    }

    let logoUrl: string | null = null;
    try {
      const payload = await this.fetchJson<unknown>(
        this.buildUrl(`/v3/reference/tickers/${encodeURIComponent(normalizedTicker)}`),
        { signal },
      );
      const record = asRecord(payload);
      const results = asRecord(record?.["results"]);
      const branding = asRecord(results?.["branding"]);
      const brandingLogoUrl = asString(branding?.["logo_url"]);
      if (brandingLogoUrl) {
        const logoResponse = await fetch(this.buildUrl(brandingLogoUrl), { signal });
        const contentType = logoResponse.headers.get("content-type") ?? "";
        const contentLength = Number(logoResponse.headers.get("content-length") ?? 0);
        if (
          logoResponse.ok &&
          contentType.startsWith("image/") &&
          (!Number.isFinite(contentLength) || contentLength <= 250_000)
        ) {
          const bytes = Buffer.from(await logoResponse.arrayBuffer());
          logoUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
        }
      }
    } catch {
      logoUrl = null;
    }

    this.tickerLogoCache.set(normalizedTicker, {
      expiresAt: Date.now() + POLYGON_TICKER_LOGO_CACHE_TTL_MS,
      logoUrl,
    });
    return logoUrl;
  }

  async getTickerMarketCap(
    ticker: string,
    signal?: AbortSignal,
  ): Promise<number | null> {
    const normalizedTicker = normalizeSymbol(ticker);
    if (!normalizedTicker) return null;

    const cached = this.tickerMarketCapCache.get(normalizedTicker);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.marketCap;
    }

    const payload = await this.fetchJson<unknown>(
      this.buildUrl(`/v3/reference/tickers/${encodeURIComponent(normalizedTicker)}`),
      { signal },
    );
    const record = asRecord(payload);
    const results = asRecord(record?.["results"]);
    const marketCap = firstDefined(
      asNumber(results?.["market_cap"]),
      asNumber(results?.["marketCap"]),
    );
    const normalizedMarketCap =
      marketCap !== null && marketCap > 0 ? marketCap : null;

    this.tickerMarketCapCache.set(normalizedTicker, {
      expiresAt: Date.now() + POLYGON_TICKER_DETAILS_CACHE_TTL_MS,
      marketCap: normalizedMarketCap,
    });
    return normalizedMarketCap;
  }

  async enrichUniverseTickerLogos(
    input: UniverseTicker[],
    limit = 10,
    signal?: AbortSignal,
  ): Promise<UniverseTicker[]> {
    const logoTargets = input
      .slice(0, Math.max(0, limit))
      .map((ticker, index) => ({ ticker, index }))
      .filter(
        ({ ticker }) =>
          ticker.providers.includes("polygon") || ticker.provider === "polygon",
      );
    const logoEntries = await Promise.all(
      logoTargets.map(async ({ ticker, index }) => [
        index,
        ticker.logoUrl ?? (await this.getTickerLogoUrl(ticker.ticker, signal)),
      ] as const),
    );
    const logoByIndex = new Map(logoEntries);

    return input.map((ticker, index) => ({
      ...ticker,
      logoUrl: ticker.logoUrl ?? logoByIndex.get(index) ?? null,
    }));
  }

  async getUniverseTickerByTicker(
    ticker: string,
    signal?: AbortSignal,
  ): Promise<UniverseTicker | null> {
    const normalizedTicker = normalizeSymbol(ticker);
    if (!normalizedTicker) return null;

    const payload = await this.fetchJson<unknown>(
      this.buildUrl(`/v3/reference/tickers/${encodeURIComponent(normalizedTicker)}`),
      { signal },
    );
    const record = asRecord(payload);
    const mapped = mapUniverseTicker(record?.["results"]);
    return mapped
      ? {
          ...mapped,
          contractMeta: {
            ...(mapped.contractMeta ?? {}),
            exactTickerLookup: true,
          },
        }
      : null;
  }

  private async fetchChainPage(
    nextUrl: string,
    signal?: AbortSignal,
  ): Promise<{ results: unknown[]; nextUrl: string | null }> {
    const payload = await this.fetchJson<unknown>(this.buildUrl(nextUrl), { signal });
    const record = asRecord(payload);

    return {
      results: asArray(record?.["results"]),
      nextUrl: asString(record?.["next_url"]),
    };
  }

  private async fetchOptionTradePrints(input: {
    optionTicker: string;
    since: Date;
    until?: Date;
    limit?: number;
    exactWindow?: boolean;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<unknown[]> {
    const params: Record<string, string | number | undefined> = {
      "timestamp.gte": input.exactWindow
        ? toUnixNanosecondsString(input.since)
        : toIsoDateString(input.since),
      order: "asc",
      sort: "timestamp",
      limit: Math.max(
        1,
        Math.min(input.limit ?? OPTION_PREMIUM_DISTRIBUTION_TRADE_LIMIT, 50_000),
      ),
    };
    if (input.until) {
      params["timestamp.lte"] = input.exactWindow
        ? toUnixNanosecondsString(input.until)
        : toIsoDateString(input.until);
    }
    const results: unknown[] = [];
    let nextUrl: string | null = this.buildUrl(
      `/v3/trades/${encodeURIComponent(input.optionTicker)}`,
      params,
    ).toString();
    const maxPages = Math.max(
      1,
      Math.min(input.maxPages ?? OPTION_FLOW_TRADE_PAGE_MAX, 100),
    );
    let pageCount = 0;

    while (nextUrl && pageCount < maxPages) {
      const payload = await this.fetchJson<unknown>(nextUrl, {
        signal: input.signal,
      });
      const record = asRecord(payload);
      results.push(...asArray(record?.["results"]));
      const rawNextUrl = asString(record?.["next_url"]);
      nextUrl = rawNextUrl ? this.buildUrl(rawNextUrl).toString() : null;
      pageCount += 1;
    }

    return results;
  }

  async getOptionTradePrints(input: {
    optionTicker: string;
    from: Date;
    to: Date;
    limit?: number;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<OptionTradePrint[]> {
    const conditionMetadata = await this.fetchOptionTradeConditionMetadata(
      input.signal,
    );
    const rawTrades = await this.fetchOptionTradePrints({
      optionTicker: input.optionTicker,
      since: input.from,
      until: input.to,
      limit: input.limit,
      maxPages: input.maxPages,
      exactWindow: true,
      signal: input.signal,
    });
    return compact(rawTrades.map((trade) => mapOptionPremiumTradePrint(trade)))
      .filter(
        (trade) => optionTradePrintEligibility(trade, conditionMetadata).eligible,
      )
      .sort(compareOptionTradePrints);
  }

  private async probeOptionQuoteAccess(input: {
    optionTicker: string | null;
    since: Date;
    signal?: AbortSignal;
  }): Promise<{
    status: PremiumDistributionQuoteProbeStatus;
    message: string | null;
  }> {
    if (!input.optionTicker) {
      return { status: "not_attempted", message: null };
    }

    const cached = this.optionQuoteAccessProbeCache;
    if (cached && cached.expiresAt > Date.now()) {
      return { status: cached.status, message: cached.message };
    }

    try {
      const payload = await this.fetchJson<unknown>(
        this.buildUrl(`/v3/quotes/${encodeURIComponent(input.optionTicker)}`, {
          "timestamp.gte": toIsoDateString(input.since),
          order: "desc",
          sort: "timestamp",
          limit: 1,
        }),
        { signal: input.signal },
      );
      const record = asRecord(payload);
      const status = asArray(record?.["results"]).length
        ? "available"
        : "unavailable";
      if (status === "available") {
        this.optionQuoteAccessProbeCache = {
          expiresAt: Date.now() + OPTION_QUOTE_ACCESS_PROBE_CACHE_TTL_MS,
          status,
          message: null,
        };
      }
      return {
        status,
        message: null,
      };
    } catch (error) {
      if (isHttpStatus(error, 403)) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Option quotes are not available for this Polygon/Massive plan.";
        this.optionQuoteAccessProbeCache = {
          expiresAt: Date.now() + OPTION_QUOTE_ACCESS_PROBE_CACHE_TTL_MS,
          status: "forbidden",
          message,
        };
        return {
          status: "forbidden",
          message,
        };
      }
      return {
        status: "failed",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Option quote probe failed.",
      };
    }
  }

  private async fetchOptionTradeConditionMetadata(
    signal?: AbortSignal,
  ): Promise<Map<string, OptionTradeConditionMetadata> | undefined> {
    const cached = this.optionTradeConditionMetadataCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const payload = await this.fetchJson<unknown>(
        this.buildUrl("/v3/reference/conditions", {
          asset_class: "options",
          data_type: "trade",
          limit: 1_000,
        }),
        { signal },
      );
      const conditionMetadata = new Map<string, OptionTradeConditionMetadata>();
      asArray(asRecord(payload)?.["results"]).forEach((result) => {
        const record = asRecord(result);
        if (!record) return;
        const id = asString(record["id"]);
        if (!id) return;
        const updateRules =
          asRecord(record["update_rules"]) ?? asRecord(record["updateRules"]);
        const consolidated = asRecord(updateRules?.["consolidated"]);
        const updatesVolume = consolidated?.["updates_volume"];
        conditionMetadata.set(id, {
          updatesVolume:
            typeof updatesVolume === "boolean" ? updatesVolume : null,
          name: asString(record["name"]),
        });
      });
      this.optionTradeConditionMetadataCache = {
        expiresAt: Date.now() + 24 * 60 * 60_000,
        value: conditionMetadata,
      };
      return conditionMetadata;
    } catch {
      return undefined;
    }
  }

  private async fetchOptionPremiumTradeClassifications(input: {
    snapshots: unknown[];
    bucketThresholds: PremiumDistributionBucketThresholds;
    tradeLookbackStart: Date;
    contractLimit?: number;
    premiumCoverageTarget?: number;
    tradeLimit?: number;
    signal?: AbortSignal;
  }): Promise<{
    tradeClassifications: Map<string, PremiumDistributionTradeClassification>;
    tradeAccess: PremiumDistributionDataAccess;
    hydrationDiagnostics: Partial<PremiumDistributionHydrationDiagnostics>;
  }> {
    const candidatesByTicker = new Map<
      string,
      { ticker: string; sharesPerContract: number; totalPremium: number }
    >();

    input.snapshots.forEach((snapshot) => {
      const ticker = readOptionSnapshotTicker(snapshot);
      const premium = getOptionSnapshotPremium(
        snapshot,
        undefined,
        input.bucketThresholds,
      );
      if (!ticker || !premium || premium.totalPremium <= 0) {
        return;
      }

      const existing = candidatesByTicker.get(ticker);
      if (!existing || premium.totalPremium > existing.totalPremium) {
        candidatesByTicker.set(ticker, {
          ticker,
          sharesPerContract: readOptionSnapshotSharesPerContract(snapshot),
          totalPremium: premium.totalPremium,
        });
      }
    });

    const allCandidates = [...candidatesByTicker.values()].sort(
      (left, right) => right.totalPremium - left.totalPremium,
    );
    const usablePremiumTotal = allCandidates.reduce(
      (sum, candidate) => sum + candidate.totalPremium,
      0,
    );
    const contractLimit = Math.max(
      1,
      Math.min(
        input.contractLimit ?? OPTION_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT,
        allCandidates.length,
      ),
    );
    const premiumCoverageTarget = clampUnitInterval(input.premiumCoverageTarget);
    let selectedPremiumTotal = 0;
    const candidates: Array<{
      ticker: string;
      sharesPerContract: number;
      totalPremium: number;
    }> = [];

    for (const candidate of allCandidates) {
      if (candidates.length >= contractLimit) break;
      candidates.push(candidate);
      selectedPremiumTotal += candidate.totalPremium;
      if (
        premiumCoverageTarget > 0 &&
        usablePremiumTotal > 0 &&
        selectedPremiumTotal / usablePremiumTotal >= premiumCoverageTarget
      ) {
        break;
      }
    }

    const selectedPremiumCoverage =
      usablePremiumTotal > 0 ? selectedPremiumTotal / usablePremiumTotal : 0;

    if (!candidates.length) {
      return {
        tradeClassifications: new Map(),
        tradeAccess: "unavailable",
        hydrationDiagnostics: {
          tradeContractCandidateCount: 0,
          tradeContractHydratedCount: 0,
          usablePremiumTotal,
          selectedPremiumTotal: 0,
          classificationTargetPremiumCoverage: premiumCoverageTarget,
          selectedPremiumCoverage: 0,
        },
      };
    }

    const conditionMetadata = await this.fetchOptionTradeConditionMetadata(
      input.signal,
    );
    let forbiddenCount = 0;
    let errorCount = 0;
    let successCount = 0;
    const summaries = await mapWithLocalConcurrency(
      candidates,
      OPTION_PREMIUM_DISTRIBUTION_TRADE_CONCURRENCY,
      async (candidate) => {
        try {
          const trades = await this.fetchOptionTradePrints({
            optionTicker: candidate.ticker,
            since: input.tradeLookbackStart,
            limit: input.tradeLimit,
            signal: input.signal,
          });
          successCount += 1;
          return {
            ticker: candidate.ticker,
            summary: classifyOptionPremiumTradePrints({
              trades,
              sharesPerContract: candidate.sharesPerContract,
              bucketThresholds: input.bucketThresholds,
              conditionMetadata,
            }),
          };
        } catch (error) {
          if (isHttpStatus(error, 403)) {
            forbiddenCount += 1;
          } else {
            errorCount += 1;
          }
          return null;
        }
      },
    );

    const tradeClassifications = new Map<
      string,
      PremiumDistributionTradeClassification
    >();
    summaries.forEach((entry) => {
      if (entry?.summary.tradeCount) {
        tradeClassifications.set(entry.ticker, entry.summary);
      }
    });
    const conditionCodes = new Set<string>();
    const exchangeCodes = new Set<string>();
    let eligibleTradeCount = 0;
    let ineligibleTradeCount = 0;
    let unknownConditionTradeCount = 0;
    tradeClassifications.forEach((summary) => {
      eligibleTradeCount += summary.eligibleTradeCount ?? summary.tradeCount;
      ineligibleTradeCount += summary.ineligibleTradeCount ?? 0;
      unknownConditionTradeCount += summary.unknownConditionTradeCount ?? 0;
      summary.conditionCodes?.forEach((code) => conditionCodes.add(code));
      summary.exchangeCodes?.forEach((code) => exchangeCodes.add(code));
    });

    return {
      tradeClassifications,
      tradeAccess:
        tradeClassifications.size > 0
          ? "available"
          : forbiddenCount > 0 && forbiddenCount >= candidates.length - errorCount
            ? "forbidden"
            : "unavailable",
      hydrationDiagnostics: {
        tradeContractCandidateCount: candidates.length,
        tradeContractHydratedCount: tradeClassifications.size,
        usablePremiumTotal,
        selectedPremiumTotal,
        classificationTargetPremiumCoverage: premiumCoverageTarget,
        selectedPremiumCoverage,
        tradeCallAttemptCount: candidates.length,
        tradeCallSuccessCount: successCount,
        tradeCallErrorCount: errorCount,
        tradeCallForbiddenCount: forbiddenCount,
        eligibleTradeCount,
        ineligibleTradeCount,
        unknownConditionTradeCount,
        conditionCodes: uniqueSorted(conditionCodes),
        exchangeCodes: uniqueSorted(exchangeCodes),
      },
    };
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: OptionRight;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    const underlying = normalizeSymbol(input.underlying);
    let nextUrl: string | null = this.buildUrl(`/v3/snapshot/options/${encodeURIComponent(underlying)}`, {
      expiration_date: input.expirationDate
        ? toIsoDateString(input.expirationDate)
        : undefined,
      contract_type: input.contractType,
      order: "asc",
      sort: "strike_price",
      limit: 250,
    }).toString();
    const contracts: OptionChainContract[] = [];
    let pageCount = 0;
    const maxPages = Math.max(1, Math.min(input.maxPages ?? 10, 100));

    while (nextUrl && pageCount < maxPages) {
      const page = await this.fetchChainPage(nextUrl, input.signal);
      contracts.push(
        ...compact(page.results.map((result) => mapChainContract(underlying, result))),
      );
      nextUrl = page.nextUrl;
      pageCount += 1;
    }

    return contracts;
  }

  async getHistoricalOptionContracts(input: {
    underlying: string;
    asOf?: Date;
    expirationDateGte?: Date;
    expirationDateLte?: Date;
    contractType?: OptionRight;
    limit?: number;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<HistoricalOptionContract[]> {
    const underlying = normalizeSymbol(input.underlying);
    const fetchContracts = async (
      expired: boolean,
    ): Promise<HistoricalOptionContract[]> => {
      let nextUrl: string | null = this.buildUrl(
        "/v3/reference/options/contracts",
        {
          underlying_ticker: underlying,
          as_of: input.asOf ? toIsoDateString(input.asOf) : undefined,
          contract_type: input.contractType,
          expired,
          order: "asc",
          sort: "expiration_date",
          limit: Math.max(1, Math.min(input.limit ?? 250, 1_000)),
          "expiration_date.gte": input.expirationDateGte
            ? toIsoDateString(input.expirationDateGte)
            : undefined,
          "expiration_date.lte": input.expirationDateLte
            ? toIsoDateString(input.expirationDateLte)
            : undefined,
        },
      ).toString();
      const contracts: HistoricalOptionContract[] = [];
      const maxPages = Math.max(1, Math.min(input.maxPages ?? 100, 500));
      let pageCount = 0;

      while (nextUrl && pageCount < maxPages) {
        const page = await this.fetchChainPage(nextUrl, input.signal);
        contracts.push(
          ...compact(
            page.results.map((result) =>
              mapHistoricalOptionContract(underlying, result),
            ),
          ),
        );
        nextUrl = page.nextUrl;
        pageCount += 1;
      }

      return contracts;
    };

    const combined = [
      ...(await fetchContracts(false)),
      ...(await fetchContracts(true)),
    ];
    const byTicker = new Map(combined.map((contract) => [contract.ticker, contract]));
    return [...byTicker.values()];
  }

  async getHistoricalOptionFlowEvents(input: {
    underlying: string;
    from: Date;
    to: Date;
    unusualThreshold?: number;
    maxDte?: number | null;
    tradeConcurrency?: number;
    contractPageLimit?: number;
    contractLimit?: number;
    tradePageLimit?: number;
    tradeLimit?: number;
    signal?: AbortSignal;
    onEvents?: (events: FlowEvent[]) => void | Promise<void>;
  }): Promise<HistoricalOptionFlowEventsResult> {
    const underlying = normalizeSymbol(input.underlying);
    const from = input.from;
    const to = input.to;
    if (
      !underlying ||
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from.getTime() > to.getTime()
    ) {
      return { events: [], contractCount: 0, contractsScanned: 0 };
    }

    const expirationDateLte =
      typeof input.maxDte === "number" &&
      Number.isFinite(input.maxDte) &&
      input.maxDte >= 0
        ? addUtcDays(startOfUtcDay(from), Math.floor(input.maxDte))
        : undefined;
    const contractLimit = Math.max(
      1,
      Math.min(Math.floor(input.contractLimit ?? 1_000), 1_000),
    );
    const contracts = await this.getHistoricalOptionContracts({
      underlying,
      asOf: from,
      expirationDateGte: startOfUtcDay(from),
      expirationDateLte,
      limit: contractLimit,
      maxPages: input.contractPageLimit,
      signal: input.signal,
    });
    if (!contracts.length) {
      return { events: [], contractCount: 0, contractsScanned: 0 };
    }

    const contractsToScan = contracts.slice(0, contractLimit);
    const conditionMetadata = await this.fetchOptionTradeConditionMetadata(
      input.signal,
    );
    const eventsById = new Map<string, FlowEvent>();
    const concurrency = Math.max(
      1,
      Math.min(input.tradeConcurrency ?? OPTION_FLOW_TRADE_CONCURRENCY, 16),
    );
    const summaries = await mapWithLocalConcurrency(
      contractsToScan,
      concurrency,
      async (contract) => {
        try {
          const rawTrades = await this.fetchOptionTradePrints({
            optionTicker: contract.ticker,
            since: from,
            until: to,
            limit: input.tradeLimit ?? 50_000,
            maxPages: input.tradePageLimit,
            exactWindow: true,
            signal: input.signal,
          });
          const trades = compact(
            rawTrades.map((trade) => mapOptionPremiumTradePrint(trade)),
          ).sort(compareOptionTradePrints);
          const classifyTickTestSide = createTickTestSideClassifier();
          const events = trades.flatMap((trade) => {
            const timestamp = trade.occurredAt.getTime();
            if (timestamp < from.getTime() || timestamp > to.getTime()) {
              return [];
            }
            if (!optionTradePrintEligibility(trade, conditionMetadata).eligible) {
              return [];
            }
            const sideClassification = classifyTickTestSide(trade);

            const snapshotRecord = asRecord(
              syntheticSnapshotFromHistoricalContract(contract, null),
            );
            if (!snapshotRecord) {
              return [];
            }
            const event = mapFlowEvent(
              underlying,
              {
                ...snapshotRecord,
                last_trade: {
                  price: trade.price,
                  size: trade.size,
                  sip_timestamp: trade.occurredAt.getTime(),
                  conditions: trade.conditionCodes,
                  exchange: trade.exchange,
                },
              },
              input.unusualThreshold,
              sideClassification,
            );
            if (!event) {
              return [];
            }

            const id = `${event.optionTicker}-${trade.occurredAt.getTime()}-${
              trade.sequenceNumber ?? "trade"
            }-${trade.price}-${trade.size}`;
            return [
              {
                ...event,
                id,
                exchange: trade.exchange ?? event.exchange,
                tradeConditions: trade.conditionCodes,
                confidence: "confirmed_trade" as const,
                sourceBasis: "confirmed_trade" as const,
              },
            ];
          });
          if (events.length > 0) {
            await input.onEvents?.(events);
          }
          return {
            contract,
            events,
          };
        } catch {
          return null;
        }
      },
    );

    summaries.forEach((summary) => {
      summary?.events.forEach((event) => {
        eventsById.set(event.id, event);
      });
    });

    return {
      events: [...eventsById.values()].sort((left, right) => {
        const timeDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return right.premium - left.premium;
      }),
      contractCount: contracts.length,
      contractsScanned: summaries.filter(Boolean).length,
    };
  }

  async getDerivedFlowEvents(input: {
    underlying: string;
    limit?: number;
    unusualThreshold?: number;
    from?: Date;
    to?: Date;
    snapshotPageLimit?: number;
    tradeConcurrency?: number;
    contractPageLimit?: number;
    contractLimit?: number;
    tradePageLimit?: number;
    tradeLimit?: number;
    signal?: AbortSignal;
  }): Promise<FlowEvent[]> {
    const underlying = normalizeSymbol(input.underlying);
    const limit = Math.max(1, Math.min(input.limit ?? 50, 250));
    const now = new Date();
    let nextUrl: string | null = this.buildUrl(
      `/v3/snapshot/options/${encodeURIComponent(underlying)}`,
      {
        "expiration_date.gte": toIsoDateString(now),
        "expiration_date.lte": toIsoDateString(
          addUtcDays(now, OPTION_FLOW_EXPIRATION_LOOKAHEAD_DAYS),
        ),
        order: "asc",
        sort: "expiration_date",
        limit: OPTION_FLOW_SNAPSHOT_PAGE_LIMIT,
      },
    ).toString();
    const results: unknown[] = [];
    let pageCount = 0;

    const snapshotMaxPages = Math.max(
      1,
      Math.min(input.snapshotPageLimit ?? OPTION_FLOW_SNAPSHOT_MAX_PAGES, 100),
    );

    while (nextUrl && pageCount < snapshotMaxPages) {
      const page = await this.fetchChainPage(nextUrl, input.signal);
      results.push(...page.results);
      nextUrl = page.nextUrl;
      pageCount += 1;
    }

    if (results.length === 0) {
      const fallbackUrl = this.buildUrl(
        `/v3/snapshot/options/${encodeURIComponent(underlying)}`,
        {
          order: "desc",
          sort: "expiration_date",
          limit: OPTION_FLOW_SNAPSHOT_PAGE_LIMIT,
        },
      );
      const payload = await this.fetchJson<unknown>(fallbackUrl, {
        signal: input.signal,
      });
      const record = asRecord(payload);
      results.push(...asArray(record?.["results"]));
    }

    if (input.from || input.to) {
      return this.getHistoricalDerivedFlowEvents({
        underlying,
        snapshots: results,
        from: input.from,
        to: input.to ?? now,
        limit,
        unusualThreshold: input.unusualThreshold,
        tradeConcurrency: input.tradeConcurrency,
        contractPageLimit: input.contractPageLimit,
        contractLimit: input.contractLimit,
        tradePageLimit: input.tradePageLimit,
        tradeLimit: input.tradeLimit,
        signal: input.signal,
      });
    }

    return compact(
      results.map((result) => {
        const event = mapFlowEvent(underlying, result, input.unusualThreshold);
        if (!event) {
          return null;
        }

        const record = asRecord(result);
        const day = asRecord(record?.["day"]);
        const dayVolume =
          firstDefined(
            getNumberPath(day, ["volume"]),
            getNumberPath(day, ["v"]),
          ) ?? event.size;

        return { event, dayVolume };
      }),
    )
      .sort((left, right) => {
        const timeDelta =
          right.event.occurredAt.getTime() - left.event.occurredAt.getTime();
        if (timeDelta !== 0) {
          return timeDelta;
        }

        if (left.event.isUnusual !== right.event.isUnusual) {
          return left.event.isUnusual ? -1 : 1;
        }
        if (
          left.event.isUnusual &&
          right.event.isUnusual &&
          left.event.unusualScore !== right.event.unusualScore
        ) {
          return right.event.unusualScore - left.event.unusualScore;
        }

        const volumeDelta = right.dayVolume - left.dayVolume;
        if (volumeDelta !== 0) {
          return volumeDelta;
        }

        return right.event.premium - left.event.premium;
      })
      .slice(0, limit)
      .map(({ event }) => event);
  }

  private async getHistoricalDerivedFlowEvents(input: {
    underlying: string;
    snapshots: unknown[];
    from?: Date;
    to: Date;
    limit: number;
    unusualThreshold?: number;
    tradeConcurrency?: number;
    contractPageLimit?: number;
    contractLimit?: number;
    tradePageLimit?: number;
    tradeLimit?: number;
    signal?: AbortSignal;
  }): Promise<FlowEvent[]> {
    const to = input.to;
    const from = input.from ?? addUtcDays(to, -2);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return [];
    }
    if (from.getTime() > to.getTime()) {
      return [];
    }

    const candidates = input.snapshots
      .map((snapshot) => {
        const ticker = readOptionSnapshotTicker(snapshot);
        if (!ticker) {
          return null;
        }
        const premium =
          getOptionSnapshotPremium(snapshot)?.totalPremium ??
          mapFlowEvent(input.underlying, snapshot, input.unusualThreshold)?.premium ??
          0;
        return { ticker, snapshot, premium };
      })
      .filter(
        (candidate): candidate is { ticker: string; snapshot: unknown; premium: number } =>
          candidate !== null,
      )
      .sort((left, right) => right.premium - left.premium);

    const anchorPrice =
      input.snapshots
        .map((snapshot) => readOptionSnapshotUnderlyingPrice(snapshot))
        .find((price): price is number => price !== null) ?? null;
    const tradeContractLimit = Math.max(
      1,
      Math.min(input.contractLimit ?? OPTION_FLOW_TRADE_CONTRACT_LIMIT, 250),
    );
    const snapshotSeedLimit = Math.max(
      1,
      Math.floor(tradeContractLimit / 2),
    );
    const candidatesByTicker = new Map<
      string,
      { ticker: string; snapshot: unknown; premium: number }
    >();
    const addCandidate = (candidate: {
      ticker: string;
      snapshot: unknown;
      premium: number;
    }) => {
      if (!candidatesByTicker.has(candidate.ticker)) {
        candidatesByTicker.set(candidate.ticker, candidate);
      }
    };
    candidates.slice(0, snapshotSeedLimit).forEach(addCandidate);

    try {
      const historicalContracts = await this.getHistoricalOptionContracts({
        underlying: input.underlying,
        asOf: from,
        expirationDateGte: startOfUtcDay(from),
        expirationDateLte: addUtcDays(
          startOfUtcDay(to),
          OPTION_FLOW_EXPIRATION_LOOKAHEAD_DAYS,
        ),
        limit: tradeContractLimit,
        maxPages: input.contractPageLimit,
        signal: input.signal,
      });
      historicalContracts
        .map((contract) => ({
          ticker: contract.ticker,
          snapshot: syntheticSnapshotFromHistoricalContract(contract, anchorPrice),
          premium: 0,
          expirationTime: contract.expirationDate.getTime(),
          distance:
            anchorPrice !== null
              ? Math.abs(contract.strike - anchorPrice) / anchorPrice
              : Number.POSITIVE_INFINITY,
          strike: contract.strike,
          right: contract.right,
        }))
        .sort(
          (left, right) =>
            left.expirationTime - right.expirationTime ||
            left.distance - right.distance ||
            left.strike - right.strike ||
            left.right.localeCompare(right.right),
        )
        .slice(0, Math.max(0, tradeContractLimit - candidatesByTicker.size))
        .forEach(addCandidate);
    } catch {
      // Current snapshots still provide historical trade hydration for active contracts.
    }

    candidates.forEach((candidate) => {
      if (candidatesByTicker.size < tradeContractLimit) {
        addCandidate(candidate);
      }
    });

    const candidatesForTrades = [...candidatesByTicker.values()];

    if (!candidatesForTrades.length) {
      return [];
    }

    const conditionMetadata = await this.fetchOptionTradeConditionMetadata(
      input.signal,
    );
    const eventsById = new Map<string, FlowEvent>();
    const tradeConcurrency = Math.max(
      1,
      Math.min(input.tradeConcurrency ?? OPTION_FLOW_TRADE_CONCURRENCY, 16),
    );
    const summaries = await mapWithLocalConcurrency(
      candidatesForTrades,
      tradeConcurrency,
      async (candidate) => {
        try {
          const rawTrades = await this.fetchOptionTradePrints({
            optionTicker: candidate.ticker,
            since: from,
            until: to,
            limit: input.tradeLimit ?? OPTION_FLOW_TRADE_LIMIT,
            maxPages: input.tradePageLimit,
            exactWindow: true,
            signal: input.signal,
          });
          return {
            candidate,
            trades: compact(
              rawTrades.map((trade) => mapOptionPremiumTradePrint(trade)),
            ).sort(compareOptionTradePrints),
          };
        } catch {
          return null;
        }
      },
    );

    summaries.forEach((summary) => {
      const classifyTickTestSide = createTickTestSideClassifier();
      summary?.trades.forEach((trade) => {
        const timestamp = trade.occurredAt.getTime();
        if (timestamp < from.getTime() || timestamp > to.getTime()) {
          return;
        }
        if (!optionTradePrintEligibility(trade, conditionMetadata).eligible) {
          return;
        }
        const tickTestClassification = classifyTickTestSide(trade);

        const snapshotRecord = asRecord(summary.candidate.snapshot);
        if (!snapshotRecord) {
          return;
        }
        const lastQuote = asRecord(snapshotRecord["last_quote"]);
        const quoteBid =
          firstDefined(
            getNumberPath(lastQuote, ["bid_price"]),
            getNumberPath(lastQuote, ["bp"]),
            getNumberPath(lastQuote, ["p"]),
          ) ?? 0;
        const quoteAsk =
          firstDefined(
            getNumberPath(lastQuote, ["ask_price"]),
            getNumberPath(lastQuote, ["ap"]),
            getNumberPath(lastQuote, ["P"]),
          ) ?? 0;
        const quoteClassification = classifyFlowEventSideFromQuote(
          trade.price,
          quoteBid,
          quoteAsk,
        );
        const sideClassification =
          quoteClassification.sideBasis === "quote_match"
            ? quoteClassification
            : tickTestClassification;
        const event = mapFlowEvent(
          input.underlying,
          {
            ...snapshotRecord,
            last_trade: {
              price: trade.price,
              size: trade.size,
              sip_timestamp: trade.occurredAt.getTime(),
              conditions: trade.conditionCodes,
              exchange: trade.exchange,
            },
          },
          input.unusualThreshold,
          sideClassification,
        );
        if (!event) {
          return;
        }

        const id = `${event.optionTicker}-${trade.occurredAt.getTime()}-${
          trade.sequenceNumber ?? "trade"
        }`;
        eventsById.set(id, {
          ...event,
          id,
          exchange: trade.exchange ?? event.exchange,
          tradeConditions: trade.conditionCodes,
          confidence: "confirmed_trade",
          sourceBasis: "confirmed_trade",
        });
      });
    });

    return [...eventsById.values()]
      .sort((left, right) => {
        const premiumDelta = right.premium - left.premium;
        if (premiumDelta !== 0) {
          return premiumDelta;
        }
        return left.occurredAt.getTime() - right.occurredAt.getTime();
      })
      .slice(0, input.limit)
      .sort((left, right) => {
        const timeDelta = left.occurredAt.getTime() - right.occurredAt.getTime();
        if (timeDelta !== 0) {
          return timeDelta;
        }
        return right.premium - left.premium;
      });
  }

  async getOptionPremiumDistribution(input: {
    underlying: string;
    stockDayVolume?: number | null;
    timeframe?: PremiumDistributionTimeframe;
    marketCap?: number | null;
    maxPages?: number;
    enrichTrades?: boolean;
    tradeContractLimit?: number;
    tradePremiumCoverageTarget?: number;
    tradeLimit?: number;
    signal?: AbortSignal;
  }): Promise<OptionPremiumDistribution> {
    const underlying = normalizeSymbol(input.underlying);
    const maxPages = Math.max(
      1,
      Math.min(
        input.maxPages ?? 1,
        OPTION_PREMIUM_DISTRIBUTION_SNAPSHOT_MAX_PAGES,
      ),
    );
    const now = new Date();
    let nextUrl: string | null = this.buildUrl(
      `/v3/snapshot/options/${encodeURIComponent(underlying)}`,
      {
        "expiration_date.gte": toIsoDateString(now),
        "expiration_date.lte": toIsoDateString(
          addUtcDays(now, OPTION_FLOW_EXPIRATION_LOOKAHEAD_DAYS),
        ),
        order: "asc",
        sort: "expiration_date",
        limit: OPTION_FLOW_SNAPSHOT_PAGE_LIMIT,
      },
    ).toString();
    const results: unknown[] = [];
    let pageCount = 0;

    while (nextUrl && pageCount < maxPages) {
      const page = await this.fetchChainPage(nextUrl, input.signal);
      results.push(...page.results);
      nextUrl = page.nextUrl;
      pageCount += 1;
    }

    let marketCap = input.marketCap ?? null;
    if (input.marketCap === undefined) {
      try {
        marketCap = await this.getTickerMarketCap(underlying, input.signal);
      } catch {
        marketCap = null;
      }
    }
    const bucketThresholds = resolvePremiumBucketThresholds(
      resolveMarketCapTier(marketCap),
    );
    const snapshotTradingDate = deriveOptionSnapshotTradingDate(results, now);
    const tradeLookbackStart =
      input.timeframe === "week"
        ? addUtcDays(snapshotTradingDate, -7)
        : snapshotTradingDate;
    const firstTradeCandidate = results
      .map((snapshot) => ({
        ticker: readOptionSnapshotTicker(snapshot),
        totalPremium: getOptionSnapshotPremium(
          snapshot,
          undefined,
          bucketThresholds,
        )?.totalPremium ?? 0,
      }))
      .filter((candidate) => candidate.ticker && candidate.totalPremium > 0)
      .sort((left, right) => right.totalPremium - left.totalPremium)[0];
    const quoteProbe = await this.probeOptionQuoteAccess({
      optionTicker: firstTradeCandidate?.ticker ?? null,
      since: tradeLookbackStart,
      signal: input.signal,
    });

    const tradeClassificationResult =
      input.enrichTrades === false
        ? {
            tradeClassifications: new Map<
              string,
              PremiumDistributionTradeClassification
            >(),
            tradeAccess: "unknown" as PremiumDistributionDataAccess,
            hydrationDiagnostics: {
              tradeContractCandidateCount: 0,
              tradeContractHydratedCount: 0,
              classificationTargetPremiumCoverage: clampUnitInterval(
                input.tradePremiumCoverageTarget,
              ),
            } as Partial<PremiumDistributionHydrationDiagnostics>,
          }
        : await this.fetchOptionPremiumTradeClassifications({
            snapshots: results,
            bucketThresholds,
            tradeLookbackStart,
            contractLimit: input.tradeContractLimit,
            premiumCoverageTarget: input.tradePremiumCoverageTarget,
            tradeLimit: input.tradeLimit,
            signal: input.signal,
          });
    return aggregateOptionPremiumDistributionSnapshots({
      underlying,
      snapshots: results,
      tradeClassifications: tradeClassificationResult.tradeClassifications,
      stockDayVolume: input.stockDayVolume,
      timeframe: input.timeframe,
      marketCap,
      asOf: now,
      delayed: this.config.baseUrl.includes("massive.com"),
      quoteAccess:
        quoteProbe.status === "available"
          ? "available"
          : quoteProbe.status === "forbidden"
            ? "forbidden"
            : undefined,
      tradeAccess: tradeClassificationResult.tradeAccess,
      hydrationDiagnostics: {
        snapshotTradingDate: toIsoDateString(snapshotTradingDate),
        tradeLookbackStartDate: toIsoDateString(tradeLookbackStart),
        quoteProbeDate: toIsoDateString(tradeLookbackStart),
        quoteProbeStatus: quoteProbe.status,
        quoteProbeMessage: quoteProbe.message,
        ...tradeClassificationResult.hydrationDiagnostics,
      },
      pageCount,
    });
  }
}

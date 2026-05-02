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
const POLYGON_TICKER_LOGO_CACHE_TTL_MS = 10 * 60 * 1_000;
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

function inferTradeSide(lastTradePrice: number, bid: number, ask: number): string {
  if (bid > 0 && lastTradePrice <= bid) {
    return "sell";
  }

  if (ask > 0 && lastTradePrice >= ask) {
    return "buy";
  }

  return "mid";
}

function inferSentiment(right: OptionRight, side: string): FlowSentiment {
  if (side === "mid") {
    return "neutral";
  }

  if (right === "call") {
    return side === "buy" ? "bullish" : "bearish";
  }

  return side === "buy" ? "bearish" : "bullish";
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
  const side = inferTradeSide(price, bid, ask);
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
  ): Promise<{ results: unknown[]; nextUrl: string | null }> {
    const payload = await this.fetchJson<unknown>(this.buildUrl(nextUrl));
    const record = asRecord(payload);

    return {
      results: asArray(record?.["results"]),
      nextUrl: asString(record?.["next_url"]),
    };
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: OptionRight;
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

    while (nextUrl && pageCount < 10) {
      const page = await this.fetchChainPage(nextUrl);
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
      let pageCount = 0;

      while (nextUrl && pageCount < 10) {
        const page = await this.fetchChainPage(nextUrl);
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

  async getDerivedFlowEvents(input: {
    underlying: string;
    limit?: number;
    unusualThreshold?: number;
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

    while (nextUrl && pageCount < OPTION_FLOW_SNAPSHOT_MAX_PAGES) {
      const page = await this.fetchChainPage(nextUrl);
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
      const payload = await this.fetchJson<unknown>(fallbackUrl);
      const record = asRecord(payload);
      results.push(...asArray(record?.["results"]));
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
}

import { HttpError } from "../lib/errors";
import { getPolygonRuntimeConfig, type PolygonRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  PolygonMarketDataClient,
  type FlowEvent,
  type OptionChainContract,
  type QuoteSnapshot,
  type UniverseTicker,
} from "../providers/polygon/market-data";

export type GexOptionRow = {
  strike: number;
  expireYear: number;
  expireMonth: number;
  expireDay: number;
  cp: "C" | "P";
  gamma: number;
  delta: number;
  openInterest: number;
  impliedVol: number;
  bid: number;
  ask: number;
};

export type GexResponse = {
  ticker: string;
  tickerDetails: {
    ticker: string;
    name: string;
    sector: string;
    industry: string;
    marketCap: number | null;
    exchangeShortName: string;
    country: string;
    isEtf: boolean;
    isFund: boolean;
  };
  profile: {
    price: number;
    changes?: number;
    range?: string;
    dayLow: number;
    dayHigh: number;
    yearLow: number | null;
    yearHigh: number | null;
    mktCap: number | null;
    logo?: string | null;
  };
  spot: number;
  timestamp: string;
  isStale: boolean;
  options: GexOptionRow[];
  snapshots: Array<{ ts: string; netGex: number }>;
  flowContext: {
    bullishShare: number;
    todayVol: number;
    avg30dVol: number | null;
    netDelta: number;
    refDelta: number;
    eventCount: number;
    volumeBaselineReady: boolean;
  } | null;
  flowContextStatus: "ok" | "unavailable";
  source: {
    provider: "massive" | "polygon";
    status: "ok" | "partial" | "unavailable";
    optionCount: number;
    usableOptionCount: number;
    withGamma: number;
    withOpenInterest: number;
    withImpliedVolatility: number;
    quoteUpdatedAt: string | null;
    chainUpdatedAt: string | null;
    flowStatus: "ok" | "unavailable";
    flowEventCount: number;
    classifiedFlowEventCount: number;
    flowClassificationCoverage: number;
    flowClassificationBasisCounts: {
      quoteMatch: number;
      tickTest: number;
      none: number;
    };
    flowClassificationConfidenceCounts: {
      high: number;
      medium: number;
      low: number;
      none: number;
    };
    message: string | null;
  };
};

type GexMarketDataClient = Pick<
  PolygonMarketDataClient,
  | "getOptionChain"
  | "getQuoteSnapshots"
  | "getUniverseTickerByTicker"
  | "getDerivedFlowEvents"
  | "getBarsPage"
  | "getTickerMarketCap"
>;

type GexMarketDataClientFactory = (
  config: PolygonRuntimeConfig,
) => GexMarketDataClient;

const GEX_DASHBOARD_CACHE_TTL_MS = 60_000;
const GEX_FLOW_LOOKBACK_MS = 14 * 60 * 60 * 1000;
const GEX_FLOW_EVENT_LIMIT = 100;
const GEX_FLOW_SNAPSHOT_PAGE_LIMIT = 3;
const GEX_FLOW_TRADE_CONTRACT_LIMIT = 64;
const GEX_FLOW_TRADE_PAGE_LIMIT = 1;
const GEX_FLOW_TRADE_LIMIT = 500;
const GEX_FLOW_TRADE_CONCURRENCY = 6;

let gexMarketDataClientFactory: GexMarketDataClientFactory | null = null;
const gexDashboardCache = new Map<
  string,
  {
    expiresAt: number;
    data?: GexResponse;
    pending?: Promise<GexResponse>;
  }
>();

export function __setGexMarketDataClientFactoryForTests(
  factory: GexMarketDataClientFactory | null,
): void {
  gexMarketDataClientFactory = factory;
  gexDashboardCache.clear();
}

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function getGexRuntimeConfig(): PolygonRuntimeConfig | null {
  const massiveApiKey = firstEnv([
    "MASSIVE_API_KEY",
    "MASSIVE_MARKET_DATA_API_KEY",
  ]);
  if (massiveApiKey) {
    return {
      apiKey: massiveApiKey,
      baseUrl: (
        firstEnv(["MASSIVE_API_BASE_URL"]) ?? "https://api.massive.com"
      ).replace(/\/+$/, ""),
    };
  }

  return getPolygonRuntimeConfig();
}

function getGexMarketDataClient(): {
  client: GexMarketDataClient;
  config: PolygonRuntimeConfig;
} {
  const config = getGexRuntimeConfig();
  if (!config) {
    throw new HttpError(503, "Massive market data is not configured.", {
      code: "massive_not_configured",
      detail:
        "Set MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY before requesting GEX.",
    });
  }

  return {
    client: gexMarketDataClientFactory?.(config) ?? new PolygonMarketDataClient(config),
    config,
  };
}

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveOrNull = (value: unknown): number | null => {
  const numeric = finiteOrNull(value);
  return numeric != null && numeric > 0 ? numeric : null;
};

const finiteOrZero = (value: unknown): number => finiteOrNull(value) ?? 0;

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

function providerFromConfig(config: PolygonRuntimeConfig): "massive" | "polygon" {
  return config.baseUrl.includes("massive.com") ? "massive" : "polygon";
}

function optionExpirationParts(expirationDate: Date): {
  year: number;
  month: number;
  day: number;
} | null {
  if (!(expirationDate instanceof Date) || Number.isNaN(expirationDate.getTime())) {
    return null;
  }
  return {
    year: expirationDate.getUTCFullYear(),
    month: expirationDate.getUTCMonth() + 1,
    day: expirationDate.getUTCDate(),
  };
}

function mapGexOptions(contracts: OptionChainContract[]): {
  rows: GexOptionRow[];
  optionCount: number;
  usableOptionCount: number;
  withGamma: number;
  withOpenInterest: number;
  withImpliedVolatility: number;
  chainUpdatedAt: Date | null;
} {
  const rows: GexOptionRow[] = [];
  let withGamma = 0;
  let withOpenInterest = 0;
  let withImpliedVolatility = 0;
  let chainUpdatedAt: Date | null = null;

  contracts.forEach((quote) => {
    const expiration = optionExpirationParts(quote.contract.expirationDate);
    const strike = finiteOrNull(quote.contract.strike);
    const gamma = finiteOrNull(quote.gamma);
    const openInterest = finiteOrNull(quote.openInterest);
    const impliedVolatility = finiteOrNull(quote.impliedVolatility);
    const cp =
      quote.contract.right === "call"
        ? "C"
        : quote.contract.right === "put"
          ? "P"
          : null;

    if (gamma != null) withGamma += 1;
    if (openInterest != null) withOpenInterest += 1;
    if (impliedVolatility != null) withImpliedVolatility += 1;

    if (
      !cp ||
      !expiration ||
      strike == null ||
      gamma == null ||
      openInterest == null
    ) {
      return;
    }

    rows.push({
      strike,
      expireYear: expiration.year,
      expireMonth: expiration.month,
      expireDay: expiration.day,
      cp,
      gamma,
      delta: finiteOrZero(quote.delta),
      openInterest: Math.max(0, openInterest),
      impliedVol: impliedVolatility ?? 0,
      bid: finiteOrZero(quote.bid),
      ask: finiteOrZero(quote.ask),
    });

    if (
      quote.updatedAt instanceof Date &&
      !Number.isNaN(quote.updatedAt.getTime()) &&
      (!chainUpdatedAt || quote.updatedAt.getTime() > chainUpdatedAt.getTime())
    ) {
      chainUpdatedAt = quote.updatedAt;
    }
  });

  return {
    rows,
    optionCount: contracts.length,
    usableOptionCount: rows.length,
    withGamma,
    withOpenInterest,
    withImpliedVolatility,
    chainUpdatedAt,
  };
}

function buildTickerDetails(input: {
  ticker: string;
  details: UniverseTicker | null;
  marketCap: number | null;
}) {
  const { ticker, details, marketCap } = input;
  const type = String(details?.type || "").toLowerCase();
  return {
    ticker,
    name: details?.name || ticker,
    sector: details?.sector || "",
    industry: details?.industry || "",
    marketCap,
    exchangeShortName:
      details?.primaryExchange ||
      details?.exchangeDisplay ||
      details?.normalizedExchangeMic ||
      "",
    country: details?.countryCode || details?.exchangeCountryCode || "",
    isEtf: type.includes("etf") || details?.market === "etf",
    isFund: type.includes("fund"),
  };
}

function buildProfile(input: {
  spot: number;
  quote: QuoteSnapshot | null;
  details: UniverseTicker | null;
  marketCap: number | null;
  yearRange: { low: number | null; high: number | null };
}) {
  const { spot, quote, details, marketCap, yearRange } = input;
  const dayLow = positiveOrNull(quote?.low) ?? spot;
  const dayHigh = positiveOrNull(quote?.high) ?? spot;
  return {
    price: spot,
    changes: finiteOrZero(quote?.change),
    range: `${dayLow.toFixed(2)}-${dayHigh.toFixed(2)}`,
    dayLow,
    dayHigh,
    yearLow: yearRange.low,
    yearHigh: yearRange.high,
    mktCap: marketCap,
    logo: details?.logoUrl ?? null,
  };
}

function contractGex(option: GexOptionRow, spot: number): number {
  const sign = option.cp === "P" ? -1 : 1;
  return sign * option.gamma * option.openInterest * 100 * spot * spot * 0.01;
}

function buildFlowContext(events: FlowEvent[], todayOptionVolume: number) {
  const basisCounts = {
    quoteMatch: 0,
    tickTest: 0,
    none: 0,
  };
  const confidenceCounts = {
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };

  if (events.length === 0) {
    return {
      status: "unavailable" as const,
      context: null,
      eventCount: 0,
      classifiedEventCount: 0,
      classificationCoverage: 0,
      basisCounts,
      confidenceCounts,
    };
  }

  let bullishPremium = 0;
  let bearishPremium = 0;
  let totalVolume = 0;
  let netDelta = 0;
  let grossDelta = 0;
  let classifiedEventCount = 0;

  events.forEach((event) => {
    const premium = Math.max(0, finiteOrZero(event.premium));
    const size = Math.max(0, finiteOrZero(event.size));
    const deltaExposure =
      Math.abs(finiteOrZero(event.delta)) * Math.max(1, size) * 100;
    const sentiment = String(event.sentiment || "").toLowerCase();
    const side = String(event.side || "").toLowerCase();
    const right = String(event.right || "").toLowerCase();
    const sideBasis = String(event.sideBasis || "none").toLowerCase();
    const sideConfidence = String(event.sideConfidence || "none").toLowerCase();
    if (sideBasis === "quote_match") {
      basisCounts.quoteMatch += 1;
    } else if (sideBasis === "tick_test") {
      basisCounts.tickTest += 1;
    } else {
      basisCounts.none += 1;
    }
    if (sideConfidence === "high") {
      confidenceCounts.high += 1;
    } else if (sideConfidence === "medium") {
      confidenceCounts.medium += 1;
    } else if (sideConfidence === "low") {
      confidenceCounts.low += 1;
    } else {
      confidenceCounts.none += 1;
    }
    const hasClassifiedSide =
      (sideBasis === "quote_match" || sideBasis === "tick_test") &&
      (side === "buy" || side === "sell");
    const bullish =
      hasClassifiedSide &&
      (sentiment === "bullish" ||
        (right === "call" && side === "buy") ||
        (right === "put" && side === "sell"));
    const bearish =
      hasClassifiedSide &&
      (sentiment === "bearish" ||
        (right === "put" && side === "buy") ||
        (right === "call" && side === "sell"));

    if (bullish) bullishPremium += premium;
    if (bearish) bearishPremium += premium;
    if (bullish || bearish) {
      classifiedEventCount += 1;
      grossDelta += deltaExposure;
    }
    totalVolume += size;
    netDelta += bullish ? deltaExposure : bearish ? -deltaExposure : 0;
  });

  const directionalPremium = bullishPremium + bearishPremium;
  if (directionalPremium <= 0 || classifiedEventCount === 0) {
    return {
      status: "unavailable" as const,
      context: null,
      eventCount: events.length,
      classifiedEventCount,
      classificationCoverage: classifiedEventCount / events.length,
      basisCounts,
      confidenceCounts,
    };
  }

  return {
    status: "ok" as const,
    context: {
      bullishShare: bullishPremium / directionalPremium,
      todayVol: todayOptionVolume > 0 ? todayOptionVolume : totalVolume,
      avg30dVol: null,
      netDelta,
      refDelta: Math.max(1, grossDelta),
      eventCount: events.length,
      volumeBaselineReady: false,
    },
    eventCount: events.length,
    classifiedEventCount,
    classificationCoverage: classifiedEventCount / events.length,
    basisCounts,
    confidenceCounts,
  };
}

function resolveYearRange(
  bars: Array<{ high: number; low: number }>,
): { low: number | null; high: number | null } {
  let low: number | null = null;
  let high: number | null = null;

  bars.forEach((bar) => {
    const barLow = positiveOrNull(bar.low);
    const barHigh = positiveOrNull(bar.high);
    if (barLow != null) {
      low = low == null ? barLow : Math.min(low, barLow);
    }
    if (barHigh != null) {
      high = high == null ? barHigh : Math.max(high, barHigh);
    }
  });

  return { low, high };
}

async function loadGexDashboardData(input: {
  ticker: string;
  signal?: AbortSignal;
}): Promise<GexResponse> {
  const ticker = input.ticker;
  const { client, config } = getGexMarketDataClient();
  const now = new Date();
  const yearRangeFrom = new Date(now.getTime() - 366 * 24 * 60 * 60 * 1000);
  const flowFrom = new Date(now.getTime() - GEX_FLOW_LOOKBACK_MS);
  const [quotes, chain, tickerDetails, marketCap, yearBarsPage, flowEvents] =
    await Promise.all([
    client.getQuoteSnapshots([ticker]),
    client.getOptionChain({ underlying: ticker, maxPages: 100, signal: input.signal }),
    client.getUniverseTickerByTicker(ticker, input.signal).catch(() => null),
    client.getTickerMarketCap(ticker, input.signal).catch(() => null),
    client
      .getBarsPage({
        symbol: ticker,
        timeframe: "1d",
        from: yearRangeFrom,
        to: now,
        limit: 260,
      })
      .catch(() => ({ bars: [] })),
    client
      .getDerivedFlowEvents({
        underlying: ticker,
        limit: GEX_FLOW_EVENT_LIMIT,
        snapshotPageLimit: GEX_FLOW_SNAPSHOT_PAGE_LIMIT,
        from: flowFrom,
        to: now,
        contractLimit: GEX_FLOW_TRADE_CONTRACT_LIMIT,
        contractPageLimit: 1,
        tradeLimit: GEX_FLOW_TRADE_LIMIT,
        tradePageLimit: GEX_FLOW_TRADE_PAGE_LIMIT,
        tradeConcurrency: GEX_FLOW_TRADE_CONCURRENCY,
        signal: input.signal,
      })
      .catch(() => [] as FlowEvent[]),
  ]);

  const quote = quotes.find((snapshot) => snapshot.symbol === ticker) ?? null;
  const spot = finiteOrNull(quote?.price);
  if (spot == null || spot <= 0) {
    throw new HttpError(503, `Spot price unavailable for ${ticker}.`, {
      code: "gex_spot_unavailable",
      detail: "GEX requires a current underlying quote from Massive.",
    });
  }

  const mappedOptions = mapGexOptions(chain);
  if (mappedOptions.rows.length === 0) {
    throw new HttpError(503, `GEX option chain unavailable for ${ticker}.`, {
      code: "gex_chain_unavailable",
      detail:
        "Massive returned no option contracts with both gamma and open interest.",
    });
  }

  const todayOptionVolume = chain.reduce(
    (sum, row) => sum + Math.max(0, finiteOrZero(row.volume)),
    0,
  );
  const flow = buildFlowContext(flowEvents, todayOptionVolume);
  const tickerDetailsWithMarketCap = tickerDetails
    ? ({ ...tickerDetails, marketCap } as UniverseTicker & {
        marketCap: number | null;
      })
    : null;
  const yearRange = resolveYearRange(yearBarsPage.bars);
  const netGex = mappedOptions.rows.reduce(
    (sum, row) => sum + contractGex(row, spot),
    0,
  );
  const quoteUpdatedAt =
    quote?.updatedAt instanceof Date && !Number.isNaN(quote.updatedAt.getTime())
      ? quote.updatedAt
      : null;
  const newestDataAt = [quoteUpdatedAt, mappedOptions.chainUpdatedAt]
    .filter((date): date is Date => date instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const staleAgeMs = newestDataAt ? now.getTime() - newestDataAt.getTime() : Infinity;
  const partialSource =
    mappedOptions.usableOptionCount < mappedOptions.optionCount ||
    flow.status === "unavailable" ||
    flow.context?.volumeBaselineReady === false;

  return {
    ticker,
    tickerDetails: buildTickerDetails({
      ticker,
      details: tickerDetailsWithMarketCap,
      marketCap,
    }),
    profile: buildProfile({
      spot,
      quote,
      details: tickerDetailsWithMarketCap,
      marketCap,
      yearRange,
    }),
    spot,
    timestamp: now.toISOString(),
    isStale: staleAgeMs > 15 * 60_000,
    options: mappedOptions.rows,
    snapshots: [{ ts: now.toISOString(), netGex }],
    flowContext: flow.context,
    flowContextStatus: flow.status,
    source: {
      provider: providerFromConfig(config),
      status: partialSource ? "partial" : "ok",
      optionCount: mappedOptions.optionCount,
      usableOptionCount: mappedOptions.usableOptionCount,
      withGamma: mappedOptions.withGamma,
      withOpenInterest: mappedOptions.withOpenInterest,
      withImpliedVolatility: mappedOptions.withImpliedVolatility,
      quoteUpdatedAt: quoteUpdatedAt?.toISOString() ?? null,
      chainUpdatedAt: mappedOptions.chainUpdatedAt?.toISOString() ?? null,
      flowStatus: flow.status,
      flowEventCount: flow.eventCount,
      classifiedFlowEventCount: flow.classifiedEventCount,
      flowClassificationCoverage: flow.classificationCoverage,
      flowClassificationBasisCounts: flow.basisCounts,
      flowClassificationConfidenceCounts: flow.confidenceCounts,
      message: partialSource
        ? "GEX is computed from Massive contracts with usable gamma and open interest. Flow direction uses confirmed option trade prints only when side classifies by quote match or tick test; volume confirmation stays conservative until a real 30-day baseline is available."
        : null,
    },
  };
}

export async function getGexDashboardData(input: {
  underlying: string;
  signal?: AbortSignal;
}): Promise<GexResponse> {
  const ticker = normalizeSymbol(input.underlying);
  if (!ticker) {
    throw new HttpError(400, "GEX ticker is required.", {
      code: "gex_ticker_required",
    });
  }

  const now = Date.now();
  const cached = gexDashboardCache.get(ticker);
  if (cached?.data && cached.expiresAt > now) {
    return cached.data;
  }
  if (cached?.pending) {
    return cached.pending;
  }

  const pending = loadGexDashboardData({
    ticker,
    signal: input.signal,
  });
  gexDashboardCache.set(ticker, {
    expiresAt: now + GEX_DASHBOARD_CACHE_TTL_MS,
    pending,
  });

  try {
    const data = await pending;
    gexDashboardCache.set(ticker, {
      expiresAt: Date.now() + GEX_DASHBOARD_CACHE_TTL_MS,
      data,
    });
    return data;
  } catch (error) {
    const current = gexDashboardCache.get(ticker);
    if (current?.pending === pending) {
      gexDashboardCache.delete(ticker);
    }
    throw error;
  }
}

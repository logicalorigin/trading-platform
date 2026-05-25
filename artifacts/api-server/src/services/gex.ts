import { HttpError } from "../lib/errors";
import { getPolygonRuntimeConfig, type PolygonRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import type {
  MarketDataFreshness,
  OptionChainContract as IbkrOptionChainContract,
  QuoteSnapshot as IbkrQuoteSnapshot,
} from "../providers/ibkr/client";
import {
  PolygonMarketDataClient,
  type OptionChainContract as PolygonOptionChainContract,
  type UniverseTicker,
} from "../providers/polygon/market-data";
import {
  batchOptionChains as platformBatchOptionChains,
  getOptionExpirationsWithDebug as platformGetOptionExpirationsWithDebug,
  getQuoteSnapshots as platformGetQuoteSnapshots,
} from "./platform";

export type GexOptionRow = {
  strike: number;
  expireYear: number;
  expireMonth: number;
  expireDay: number;
  cp: "C" | "P";
  ticker: string | null;
  underlying: string | null;
  expirationDate: string;
  providerContractId: string | null;
  gamma: number;
  delta: number;
  openInterest: number;
  impliedVol: number;
  bid: number;
  ask: number;
  multiplier: number;
  sharesPerContract: number;
  volume: number;
  updatedAt: string | null;
  quoteFreshness: MarketDataFreshness | null;
  marketDataMode: string | null;
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
    provider: "ibkr" | "massive" | "polygon";
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
  | "getUniverseTickerByTicker"
  | "getBarsPage"
  | "getTickerMarketCap"
  | "getOptionChain"
>;

type GexMarketDataClientFactory = (
  config: PolygonRuntimeConfig,
) => GexMarketDataClient;

type GexPlatformDataClient = {
  getQuoteSnapshots: typeof platformGetQuoteSnapshots;
  getOptionExpirationsWithDebug: typeof platformGetOptionExpirationsWithDebug;
  batchOptionChains: typeof platformBatchOptionChains;
};

type GexPlatformDataClientFactory = () => GexPlatformDataClient;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const GEX_DASHBOARD_CACHE_TTL_MS = readPositiveIntegerEnv(
  "GEX_DASHBOARD_CACHE_TTL_MS",
  15_000,
);
const GEX_DASHBOARD_LOAD_TIMEOUT_MS = readPositiveIntegerEnv(
  "GEX_DASHBOARD_LOAD_TIMEOUT_MS",
  10_000,
);
const GEX_EXPIRATION_LIMIT = readPositiveIntegerEnv("GEX_EXPIRATION_LIMIT", 10);
const GEX_REFERENCE_CHAIN_MAX_PAGES = readPositiveIntegerEnv(
  "GEX_REFERENCE_CHAIN_MAX_PAGES",
  20,
);

let gexMarketDataClientFactory: GexMarketDataClientFactory | null = null;
let gexPlatformDataClientFactory: GexPlatformDataClientFactory | null = null;
const gexDashboardCache = new Map<
  string,
  {
    expiresAt: number;
    data?: GexResponse;
    pending?: Promise<GexResponse>;
  }
>();
let gexDashboardLoadTimeoutMsForTests: number | null = null;

export function __setGexMarketDataClientFactoryForTests(
  factory: GexMarketDataClientFactory | null,
): void {
  gexMarketDataClientFactory = factory;
  gexDashboardCache.clear();
}

export function __setGexPlatformDataClientFactoryForTests(
  factory: GexPlatformDataClientFactory | null,
): void {
  gexPlatformDataClientFactory = factory;
  gexDashboardCache.clear();
}

export function __setGexDashboardLoadTimeoutMsForTests(
  value: number | null,
): void {
  gexDashboardLoadTimeoutMsForTests =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : null;
}

export function __expireGexDashboardCacheForTests(underlying: string): void {
  const ticker = normalizeSymbol(underlying);
  const cached = ticker ? gexDashboardCache.get(ticker) : null;
  if (!ticker || !cached) return;
  gexDashboardCache.set(ticker, {
    ...cached,
    expiresAt: 0,
  });
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

function getOptionalGexMarketDataClient(): {
  client: GexMarketDataClient;
  config: PolygonRuntimeConfig;
} | null {
  const config = getGexRuntimeConfig();
  if (!config) {
    return null;
  }

  return {
    client: gexMarketDataClientFactory?.(config) ?? new PolygonMarketDataClient(config),
    config,
  };
}

function getGexReferenceProvider(
  config: PolygonRuntimeConfig,
): GexResponse["source"]["provider"] {
  return config.baseUrl.includes("massive.com") ? "massive" : "polygon";
}

function getGexPlatformDataClient(): GexPlatformDataClient {
  return (
    gexPlatformDataClientFactory?.() ?? {
      getQuoteSnapshots: platformGetQuoteSnapshots,
      getOptionExpirationsWithDebug: platformGetOptionExpirationsWithDebug,
      batchOptionChains: platformBatchOptionChains,
    }
  );
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

const toDateOrNull = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

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

function readOptionUpdatedAt(option: IbkrOptionChainContract): Date | null {
  return (
    toDateOrNull(option.dataUpdatedAt) ??
    toDateOrNull(option.quoteUpdatedAt) ??
    toDateOrNull(option.updatedAt)
  );
}

function deriveSpotFromOptionChain(
  contracts: IbkrOptionChainContract[],
): number | null {
  const prices = contracts
    .map((contract) => positiveOrNull(contract.underlyingPrice))
    .filter((price): price is number => price !== null);
  if (!prices.length) return null;
  return prices[Math.floor((prices.length - 1) / 2)];
}

function isIbkrQuoteSnapshot(quote: IbkrQuoteSnapshot): boolean {
  const source = String((quote as { source?: unknown }).source ?? "ibkr").toLowerCase();
  return source === "ibkr";
}

function mapGexOptions(contracts: IbkrOptionChainContract[]): {
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
    const multiplier =
      positiveOrNull(quote.contract.multiplier) ??
      positiveOrNull(quote.contract.sharesPerContract) ??
      100;
    const sharesPerContract =
      positiveOrNull(quote.contract.sharesPerContract) ?? multiplier;
    const updatedAt = readOptionUpdatedAt(quote);
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
      ticker: quote.contract.ticker || null,
      underlying: quote.contract.underlying || null,
      expirationDate: `${String(expiration.year).padStart(4, "0")}-${String(
        expiration.month,
      ).padStart(2, "0")}-${String(expiration.day).padStart(2, "0")}`,
      providerContractId: quote.contract.providerContractId ?? null,
      gamma,
      delta: finiteOrZero(quote.delta),
      openInterest: Math.max(0, openInterest),
      impliedVol: impliedVolatility ?? 0,
      bid: finiteOrZero(quote.bid),
      ask: finiteOrZero(quote.ask),
      multiplier,
      sharesPerContract,
      volume: Math.max(0, finiteOrZero(quote.volume)),
      updatedAt: updatedAt?.toISOString() ?? null,
      quoteFreshness: quote.quoteFreshness ?? null,
      marketDataMode: quote.marketDataMode ?? null,
    });

    if (
      updatedAt instanceof Date &&
      (!chainUpdatedAt || updatedAt.getTime() > chainUpdatedAt.getTime())
    ) {
      chainUpdatedAt = updatedAt;
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

function mapGexReferenceOptions(
  contracts: PolygonOptionChainContract[],
  delayed: boolean,
): {
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
  const quoteFreshness: MarketDataFreshness = delayed ? "delayed" : "live";
  const marketDataMode = delayed ? "delayed" : "live";

  contracts.forEach((snapshot) => {
    const expiration = optionExpirationParts(snapshot.contract.expirationDate);
    const strike = finiteOrNull(snapshot.contract.strike);
    const gamma = finiteOrNull(snapshot.gamma);
    const openInterest = finiteOrNull(snapshot.openInterest);
    const impliedVolatility = finiteOrNull(snapshot.impliedVolatility);
    const multiplier =
      positiveOrNull(snapshot.contract.multiplier) ??
      positiveOrNull(snapshot.contract.sharesPerContract) ??
      100;
    const sharesPerContract =
      positiveOrNull(snapshot.contract.sharesPerContract) ?? multiplier;
    const updatedAt = toDateOrNull(snapshot.updatedAt);
    const cp =
      snapshot.contract.right === "call"
        ? "C"
        : snapshot.contract.right === "put"
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
      ticker: snapshot.contract.ticker || null,
      underlying: snapshot.contract.underlying || null,
      expirationDate: `${String(expiration.year).padStart(4, "0")}-${String(
        expiration.month,
      ).padStart(2, "0")}-${String(expiration.day).padStart(2, "0")}`,
      providerContractId: snapshot.contract.providerContractId ?? null,
      gamma,
      delta: finiteOrZero(snapshot.delta),
      openInterest: Math.max(0, openInterest),
      impliedVol: impliedVolatility ?? 0,
      bid: finiteOrZero(snapshot.bid),
      ask: finiteOrZero(snapshot.ask),
      multiplier,
      sharesPerContract,
      volume: Math.max(0, finiteOrZero(snapshot.volume)),
      updatedAt: updatedAt?.toISOString() ?? null,
      quoteFreshness,
      marketDataMode,
    });

    if (
      updatedAt instanceof Date &&
      (!chainUpdatedAt || updatedAt.getTime() > chainUpdatedAt.getTime())
    ) {
      chainUpdatedAt = updatedAt;
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

async function loadGexReferenceOptionSnapshots(input: {
  client: GexMarketDataClient;
  ticker: string;
  expirationDates: Date[];
  signal?: AbortSignal;
}): Promise<{
  contracts: PolygonOptionChainContract[];
  failedExpirationCount: number;
}> {
  const settled = await Promise.all(
    input.expirationDates.map(async (expirationDate) => {
      try {
        return await input.client.getOptionChain({
          underlying: input.ticker,
          expirationDate,
          maxPages: GEX_REFERENCE_CHAIN_MAX_PAGES,
          signal: input.signal,
        });
      } catch {
        return null;
      }
    }),
  );

  return {
    contracts: settled.flatMap((contracts) => contracts ?? []),
    failedExpirationCount: settled.filter((contracts) => contracts === null).length,
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
  quote: IbkrQuoteSnapshot | null;
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
  return (
    sign *
    option.gamma *
    option.openInterest *
    option.multiplier *
    spot *
    spot *
    0.01
  );
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

function getGexDashboardLoadTimeoutMs(): number {
  return gexDashboardLoadTimeoutMsForTests ?? GEX_DASHBOARD_LOAD_TIMEOUT_MS;
}

function withGexDashboardTimeout<T>(
  promise: Promise<T>,
  ticker: string,
): Promise<T> {
  const timeoutMs = getGexDashboardLoadTimeoutMs();
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(
        new HttpError(504, `GEX dashboard load timed out for ${ticker}.`, {
          code: "gex_dashboard_timeout",
          detail:
            "IBKR quote, expiration, or option-chain hydration did not finish inside the chart marker budget.",
        }),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function appendGexSourceMessage(
  existing: string | null | undefined,
  message: string,
): string {
  return existing?.trim() ? `${existing} ${message}` : message;
}

function markGexDashboardStale(data: GexResponse, message: string): GexResponse {
  return {
    ...data,
    isStale: true,
    source: {
      ...data.source,
      status: "partial",
      message: appendGexSourceMessage(data.source.message, message),
    },
  };
}

function mergeGexDashboardSnapshots(
  previousData: GexResponse | undefined,
  nextData: GexResponse,
): GexResponse {
  const sessionDate = nextData.timestamp.slice(0, 10);
  const bySnapshot = new Map<string, { ts: string; netGex: number }>();
  for (const snapshot of [
    ...(previousData?.ticker === nextData.ticker ? previousData.snapshots : []),
    ...nextData.snapshots,
  ]) {
    if (
      !snapshot?.ts ||
      snapshot.ts.slice(0, 10) !== sessionDate ||
      !Number.isFinite(snapshot.netGex)
    ) {
      continue;
    }
    bySnapshot.set(`${snapshot.ts}:${snapshot.netGex}`, snapshot);
  }
  const snapshots = Array.from(bySnapshot.values())
    .sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts))
    .slice(-240);
  return {
    ...nextData,
    snapshots,
  };
}

function startGexDashboardRefresh(
  ticker: string,
  previousData?: GexResponse,
): Promise<GexResponse> {
  let pending: Promise<GexResponse>;
  pending = withGexDashboardTimeout(
    loadGexDashboardData({
      ticker,
    }),
    ticker,
  )
    .then((data) => {
      const mergedData = mergeGexDashboardSnapshots(previousData, data);
      gexDashboardCache.set(ticker, {
        expiresAt: Date.now() + GEX_DASHBOARD_CACHE_TTL_MS,
        data: mergedData,
      });
      return mergedData;
    })
    .catch((error) => {
      const current = gexDashboardCache.get(ticker);
      if (current?.pending === pending) {
        if (previousData) {
          gexDashboardCache.set(ticker, {
            expiresAt: 0,
            data: previousData,
          });
        } else {
          gexDashboardCache.delete(ticker);
        }
      }
      if (previousData) {
        return markGexDashboardStale(
          previousData,
          "Returning the previous zero-gamma dashboard because the refresh did not complete.",
        );
      }
      throw error;
    });

  gexDashboardCache.set(ticker, {
    expiresAt: previousData ? 0 : Date.now() + GEX_DASHBOARD_CACHE_TTL_MS,
    data: previousData,
    pending,
  });
  return pending;
}

async function loadGexDashboardData(input: {
  ticker: string;
  signal?: AbortSignal;
}): Promise<GexResponse> {
  const ticker = input.ticker;
  const platformClient = getGexPlatformDataClient();
  const referenceData = getOptionalGexMarketDataClient();
  const referenceClient = referenceData?.client ?? null;
  const referenceProvider = referenceData
    ? getGexReferenceProvider(referenceData.config)
    : null;
  const referenceDelayed = referenceProvider === "massive";
  const now = new Date();
  const yearRangeFrom = new Date(now.getTime() - 366 * 24 * 60 * 60 * 1000);
  const [quotePayload, expirationsPayload, tickerDetails, marketCap, yearBarsPage] =
    await Promise.all([
      platformClient.getQuoteSnapshots({ symbols: ticker }).catch(() => ({
        quotes: [],
        transport: null,
        delayed: false,
        fallbackUsed: false,
      })),
      platformClient.getOptionExpirationsWithDebug({
        underlying: ticker,
        maxExpirations: GEX_EXPIRATION_LIMIT,
      }),
      referenceClient
        ? referenceClient.getUniverseTickerByTicker(ticker, input.signal).catch(() => null)
        : Promise.resolve(null),
      referenceClient
        ? referenceClient.getTickerMarketCap(ticker, input.signal).catch(() => null)
        : Promise.resolve(null),
      referenceClient
        ? referenceClient
            .getBarsPage({
              symbol: ticker,
              timeframe: "1d",
              from: yearRangeFrom,
              to: now,
              limit: 260,
            })
            .catch(() => ({ bars: [] }))
        : Promise.resolve({ bars: [] }),
    ]);

  const expirationDates = expirationsPayload.expirations.map(
    (expiration) => expiration.expirationDate,
  );
  if (expirationDates.length === 0) {
    throw new HttpError(503, `GEX option expirations unavailable for ${ticker}.`, {
      code: "gex_chain_unavailable",
      detail: "IBKR returned no option expirations for this symbol.",
    });
  }

  const referenceChainPayload = referenceClient
    ? await loadGexReferenceOptionSnapshots({
        client: referenceClient,
        ticker,
        expirationDates,
        signal: input.signal,
      })
    : null;
  let chainPayload: Awaited<ReturnType<typeof platformBatchOptionChains>> | null =
    null;
  let chain: IbkrOptionChainContract[] = [];
  let mappedOptions =
    referenceChainPayload && referenceProvider
      ? mapGexReferenceOptions(referenceChainPayload.contracts, referenceDelayed)
      : null;
  let sourceProvider: GexResponse["source"]["provider"] =
    mappedOptions?.rows.length && referenceProvider ? referenceProvider : "ibkr";

  if (mappedOptions === null || mappedOptions.rows.length === 0) {
    chainPayload = await platformClient.batchOptionChains({
      underlying: ticker,
      expirationDates,
      strikeCoverage: "full",
      quoteHydration: "snapshot",
    });
    chain = chainPayload.results.flatMap((result) => result.contracts);
    mappedOptions = mapGexOptions(chain);
    sourceProvider = "ibkr";
  }

  const quoteRows = (quotePayload.quotes || []) as IbkrQuoteSnapshot[];
  const quote =
    quoteRows.find(
      (snapshot) => snapshot.symbol === ticker && isIbkrQuoteSnapshot(snapshot),
    ) ?? null;
  const latestReferenceClose =
    yearBarsPage.bars.length > 0
      ? positiveOrNull(yearBarsPage.bars[yearBarsPage.bars.length - 1]?.close)
      : null;
  const spot =
    positiveOrNull(quote?.price) ??
    deriveSpotFromOptionChain(chain) ??
    latestReferenceClose;
  if (spot == null || spot <= 0) {
    throw new HttpError(503, `Spot price unavailable for ${ticker}.`, {
      code: "gex_spot_unavailable",
      detail:
        "GEX requires a current IBKR underlying quote, option-chain underlying price, or reference-provider close.",
    });
  }

  if (mappedOptions.rows.length === 0) {
    throw new HttpError(503, `GEX option chain unavailable for ${ticker}.`, {
      code: "gex_chain_unavailable",
      detail:
        "No configured provider returned option contracts with both gamma and open interest.",
    });
  }

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
  const quoteUpdatedAt = toDateOrNull(quote?.dataUpdatedAt) ?? toDateOrNull(quote?.updatedAt);
  const newestDataAt = [quoteUpdatedAt, mappedOptions.chainUpdatedAt]
    .filter((date): date is Date => date instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const staleAgeMs = newestDataAt ? now.getTime() - newestDataAt.getTime() : Infinity;
  const isStale = staleAgeMs > 15 * 60_000;
  const batchHasFailures = chainPayload
    ? chainPayload.results.some(
        (result) => result.status !== "loaded" || result.contracts.length === 0,
      )
    : false;
  const referenceHasFailures =
    sourceProvider !== "ibkr" &&
    (referenceChainPayload?.failedExpirationCount ?? 0) > 0;
  const partialSource =
    mappedOptions.usableOptionCount < mappedOptions.optionCount ||
    batchHasFailures ||
    referenceHasFailures ||
    !quote;
  const providerLabel =
    sourceProvider === "massive"
      ? "Massive"
      : sourceProvider === "polygon"
        ? "Polygon"
        : "IBKR";
  const partialMessage =
    sourceProvider === "ibkr"
      ? "GEX is computed from IBKR option-chain snapshots. Source is partial when an expiration batch fails, a quote is missing, or contracts lack usable gamma/open interest."
      : `GEX is computed from ${providerLabel} option-chain snapshots before using IBKR option snapshot lines. Source is partial when a reference expiration fails, a quote is missing, or contracts lack usable gamma/open interest.`;
  const flowBasisCounts = {
    quoteMatch: 0,
    tickTest: 0,
    none: 0,
  };
  const flowConfidenceCounts = {
    high: 0,
    medium: 0,
    low: 0,
    none: 0,
  };

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
    isStale,
    options: mappedOptions.rows,
    snapshots: [{ ts: now.toISOString(), netGex }],
    flowContext: null,
    flowContextStatus: "unavailable",
    source: {
      provider: sourceProvider,
      status: partialSource ? "partial" : "ok",
      optionCount: mappedOptions.optionCount,
      usableOptionCount: mappedOptions.usableOptionCount,
      withGamma: mappedOptions.withGamma,
      withOpenInterest: mappedOptions.withOpenInterest,
      withImpliedVolatility: mappedOptions.withImpliedVolatility,
      quoteUpdatedAt: quoteUpdatedAt?.toISOString() ?? null,
      chainUpdatedAt: mappedOptions.chainUpdatedAt?.toISOString() ?? null,
      flowStatus: "unavailable",
      flowEventCount: 0,
      classifiedFlowEventCount: 0,
      flowClassificationCoverage: 0,
      flowClassificationBasisCounts: flowBasisCounts,
      flowClassificationConfidenceCounts: flowConfidenceCounts,
      message: partialSource ? partialMessage : null,
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
    if (cached.data) {
      return markGexDashboardStale(
        cached.data,
        "Returning the previous zero-gamma dashboard while the refresh is still loading.",
      );
    }
    return cached.pending;
  }

  const pending = startGexDashboardRefresh(ticker, cached?.data);
  if (cached?.data) {
    return markGexDashboardStale(
      cached.data,
      "Returning the previous zero-gamma dashboard while the refresh is loading.",
    );
  }
  return pending;
}

import { createHash } from "node:crypto";

import { HttpError, isHttpError } from "../lib/errors";
import { getMassiveRuntimeConfig, type MassiveRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import type {
  MarketDataFreshness,
  OptionChainContract as IbkrOptionChainContract,
  QuoteSnapshot as IbkrQuoteSnapshot,
} from "../providers/ibkr/client";
import {
  MassiveMarketDataClient,
  type UniverseTicker,
} from "../providers/massive/market-data";
import {
  batchOptionChains as platformBatchOptionChains,
  getOptionExpirationsWithDebug as platformGetOptionExpirationsWithDebug,
  getQuoteSnapshots as platformGetQuoteSnapshots,
  OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS,
} from "./platform";
import {
  enqueueMarketDataJob,
  getMarketDataIngestDiagnostics,
  getLatestChartGexSnapshot,
  getLatestGexSnapshot,
  isMarketDataIngestDatabaseConfigured,
  isMarketDataIngestConfigured,
  type EnqueueMarketDataJobInput,
  type EnqueueMarketDataJobResult,
  type LatestGexSnapshot,
  type MarketDataIngestDiagnostics,
} from "./market-data-ingest";
import {
  buildGexProjection,
  type GexProjectionDividendYieldInput,
  type GexProjectionRatesInput,
  type GexProjectionResponse,
  type GexProjectionSourceInput,
} from "./gex-projection";
import {
  buildGexZeroGammaSimulation,
  type GexZeroGammaSimulation,
} from "./gex-zero-gamma-simulation";
import { fetchTreasuryYieldCurveRates } from "./treasury-yield-curve";

export type GexOptionRow = {
  strike: number;
  expireYear: number;
  expireMonth: number;
  expireDay: number;
  cp: "C" | "P";
  ticker?: string | null;
  underlying?: string | null;
  expirationDate: string;
  providerContractId?: string | null;
  gamma: number;
  delta: number;
  theta?: number;
  vega?: number;
  openInterest: number;
  impliedVol: number;
  bid: number;
  ask: number;
  mark?: number;
  multiplier: number;
  sharesPerContract?: number;
  volume?: number;
  updatedAt?: string | null;
  quoteFreshness?: MarketDataFreshness | null;
  marketDataMode?: string | null;
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
    provider: "ibkr" | "massive";
    status: "ok" | "partial" | "unavailable";
    expirationCoverage: {
      requestedCount: number;
      returnedCount: number;
      loadedCount: number;
      failedCount: number;
      complete: boolean;
      capped: boolean;
    };
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

export type GexZeroGammaResponse = {
  ticker: string;
  spot: number | null;
  zeroGamma: number | null;
  asOf: string | null;
  isStale: boolean;
  simulation?: GexZeroGammaSimulation | null;
  source: {
    provider: GexResponse["source"]["provider"];
    status: GexResponse["source"]["status"];
    optionCount: number;
    usableOptionCount: number;
    message: string | null;
  };
};

type GexMarketDataClient = Pick<
  MassiveMarketDataClient,
  | "getUniverseTickerByTicker"
  | "getBarsPage"
  | "getTickerMarketCap"
>;

type GexMarketDataClientFactory = (
  config: MassiveRuntimeConfig,
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
const GEX_DASHBOARD_STALE_CACHE_TTL_MS = readPositiveIntegerEnv(
  "GEX_DASHBOARD_STALE_CACHE_TTL_MS",
  5_000,
);
const GEX_DASHBOARD_LOAD_TIMEOUT_MS = readPositiveIntegerEnv(
  "GEX_DASHBOARD_LOAD_TIMEOUT_MS",
  10_000,
);
const GEX_SNAPSHOT_MAX_AGE_MS = readPositiveIntegerEnv(
  "GEX_SNAPSHOT_MAX_AGE_MS",
  60_000,
);
const GEX_CHART_PROJECTION_LIVE_MAX_EXPIRATIONS = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_MAX_EXPIRATIONS",
  4,
);
const GEX_CHART_PROJECTION_SNAPSHOT_MAX_EXPIRATIONS = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_SNAPSHOT_MAX_EXPIRATIONS",
  8,
);
const GEX_CHART_PROJECTION_STRIKES_AROUND_MONEY = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_STRIKES_AROUND_MONEY",
  8,
);
const GEX_CHART_PROJECTION_RATES_TIMEOUT_MS = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_RATES_TIMEOUT_MS",
  250,
);
const GEX_CHART_PROJECTION_SNAPSHOT_WAIT_MS = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_SNAPSHOT_WAIT_MS",
  10_000,
);
const GEX_CHART_PROJECTION_QUOTE_WAIT_MS = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_QUOTE_WAIT_MS",
  500,
);
const GEX_CHART_PROJECTION_EXPIRATION_WAIT_MS = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_EXPIRATION_WAIT_MS",
  750,
);
const GEX_CHART_PROJECTION_CHAIN_WAIT_MS = readPositiveIntegerEnv(
  "GEX_CHART_PROJECTION_CHAIN_WAIT_MS",
  750,
);
const GEX_CHART_PROJECTION_CHAIN_TIMEOUT = Symbol(
  "gex_chart_projection_chain_timeout",
);

type GexOptionChainBatchPayload = Awaited<
  ReturnType<GexPlatformDataClient["batchOptionChains"]>
>;
type ChartGexDataMode = "active" | "snapshot";

let gexMarketDataClientFactory: GexMarketDataClientFactory | null = null;
let gexPlatformDataClientFactory: GexPlatformDataClientFactory | null = null;
let gexIngestFacadeForTests: {
  getLatestChartGexSnapshot?: typeof getLatestChartGexSnapshot;
  getLatestGexSnapshot?: typeof getLatestGexSnapshot;
  enqueueMarketDataJob?: typeof enqueueMarketDataJob;
  getDiagnostics?: typeof getMarketDataIngestDiagnostics;
  isConfigured?: typeof isMarketDataIngestConfigured;
} | null = null;
let gexProjectionRatesProviderForTests:
  | ((input: { signal?: AbortSignal }) => Promise<GexProjectionRatesInput>)
  | null = null;
const gexDashboardCache = new Map<
  string,
  {
    expiresAt: number;
    data?: GexResponse;
    pending?: Promise<GexResponse>;
  }
>();
let gexDashboardLoadTimeoutMsForTests: number | null = null;
let gexChartProjectionChainWaitMsForTests: number | null = null;
let gexChartProjectionQuoteWaitMsForTests: number | null = null;
let gexChartProjectionSnapshotWaitMsForTests: number | null = null;

export type GexDashboardHttpCacheMetadata = {
  ticker: string;
  eTag: string;
};

export type GexDashboardHttpCacheEntry = GexDashboardHttpCacheMetadata & {
  data: GexResponse;
};

function buildGexDashboardETag(data: GexResponse): string {
  const version = [
    data.ticker,
    data.timestamp,
    data.isStale ? "stale" : "fresh",
    data.source.provider,
    data.source.status,
    data.source.message ?? "",
    String(data.source.optionCount),
    String(data.options.length),
  ].join("\0");
  const digest = createHash("sha256")
    .update(version)
    .digest("base64url")
    .slice(0, 32);
  return `W/"gex-${digest}"`;
}

export function buildGexDashboardHttpCacheMetadata(
  data: GexResponse,
): GexDashboardHttpCacheMetadata {
  return {
    ticker: data.ticker,
    eTag: buildGexDashboardETag(data),
  };
}

export function getCachedGexDashboardHttpCacheEntry(
  underlying: string,
): GexDashboardHttpCacheEntry | null {
  const ticker = normalizeSymbol(underlying);
  if (!ticker) return null;
  const cached = gexDashboardCache.get(ticker);
  if (!cached?.data || cached.pending || cached.expiresAt <= Date.now()) {
    return null;
  }
  const metadata = buildGexDashboardHttpCacheMetadata(cached.data);
  return {
    ...metadata,
    ticker,
    data: cached.data,
  };
}

export function getCachedGexDashboardHttpCacheMetadata(
  underlying: string,
): GexDashboardHttpCacheMetadata | null {
  const entry = getCachedGexDashboardHttpCacheEntry(underlying);
  if (!entry) return null;
  return {
    ticker: entry.ticker,
    eTag: entry.eTag,
  };
}

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

export function __setGexChartProjectionChainWaitMsForTests(
  value: number | null,
): void {
  gexChartProjectionChainWaitMsForTests =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : null;
}

export function __setGexChartProjectionQuoteWaitMsForTests(
  value: number | null,
): void {
  gexChartProjectionQuoteWaitMsForTests =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : null;
}

export function __setGexChartProjectionSnapshotWaitMsForTests(
  value: number | null,
): void {
  gexChartProjectionSnapshotWaitMsForTests =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : null;
}

export function __setGexIngestFacadeForTests(
  facade: typeof gexIngestFacadeForTests,
): void {
  gexIngestFacadeForTests = facade;
  gexDashboardCache.clear();
}

export function __setGexProjectionRatesProviderForTests(
  provider: typeof gexProjectionRatesProviderForTests,
): void {
  gexProjectionRatesProviderForTests = provider;
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

function shouldUsePersistedGexSnapshots(): boolean {
  if (process.env["GEX_DB_FIRST_ENABLED"] === "0") {
    return false;
  }
  if (gexIngestFacadeForTests) {
    return gexIngestFacadeForTests.isConfigured?.() ?? true;
  }
  if (gexPlatformDataClientFactory || gexMarketDataClientFactory) {
    return false;
  }
  return isMarketDataIngestDatabaseConfigured();
}

function getGexIngestFacade(): {
  getLatestChartGexSnapshot: typeof getLatestChartGexSnapshot;
  getLatestGexSnapshot: typeof getLatestGexSnapshot;
  enqueueMarketDataJob: typeof enqueueMarketDataJob;
  getDiagnostics: typeof getMarketDataIngestDiagnostics;
  isConfigured: typeof isMarketDataIngestConfigured;
} {
  const testFullSnapshot = gexIngestFacadeForTests?.getLatestGexSnapshot;
  const isConfigured =
    gexIngestFacadeForTests?.isConfigured ?? isMarketDataIngestConfigured;
  return {
    getLatestChartGexSnapshot:
      gexIngestFacadeForTests?.getLatestChartGexSnapshot ??
      (testFullSnapshot
        ? async (symbol, maxAgeMs) => testFullSnapshot(symbol, maxAgeMs)
        : getLatestChartGexSnapshot),
    getLatestGexSnapshot:
      testFullSnapshot ?? getLatestGexSnapshot,
    enqueueMarketDataJob:
      gexIngestFacadeForTests?.enqueueMarketDataJob ?? enqueueMarketDataJob,
    getDiagnostics:
      gexIngestFacadeForTests?.getDiagnostics ??
      (gexIngestFacadeForTests
        ? async () => buildNeutralGexIngestDiagnostics(isConfigured())
        : getMarketDataIngestDiagnostics),
    isConfigured,
  };
}

function buildNeutralGexIngestDiagnostics(
  configured: boolean,
): MarketDataIngestDiagnostics {
  return {
    configured,
    providerConfigured: configured,
    queueDepth: {},
    oldestQueuedAgeMs: null,
    runningCount: 0,
    expiredLeaseCount: 0,
    claimableQueuedJobCount: 0,
    claimableQueuedJobsByKind: {},
    workerLikelyInactive: false,
    workerInactiveReason: null,
    blockedGexJobCount: 0,
    oldestBlockedGexAgeMs: null,
    blockedGexJobs: [],
    recentProviderFailures: [],
    recentCompletedJobs: [],
  };
}

async function getGexProjectionRates(input: {
  signal?: AbortSignal;
}): Promise<GexProjectionRatesInput> {
  if (gexProjectionRatesProviderForTests) {
    return gexProjectionRatesProviderForTests(input);
  }
  return fetchTreasuryYieldCurveRates(input);
}

function unavailableChartGexProjectionRates(
  message: string,
): GexProjectionRatesInput {
  return {
    status: "unavailable",
    source: "treasury_daily_par_yield_curve",
    asOf: null,
    points: [],
    message,
  };
}

async function getChartGexProjectionRates(input: {
  signal?: AbortSignal;
}): Promise<GexProjectionRatesInput> {
  const ratesPromise = getGexProjectionRates(input).catch((error) =>
    unavailableChartGexProjectionRates(
      error instanceof Error
        ? error.message
        : "Chart GEX projection rates are unavailable.",
    ),
  );
  const timeoutMs = GEX_CHART_PROJECTION_RATES_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return ratesPromise;
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(
        unavailableChartGexProjectionRates(
          "Treasury yield curve did not respond inside the chart projection budget.",
        ),
      );
    }, timeoutMs);

    ratesPromise.then((rates) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(rates);
    });
  });
}

function getGexChartProjectionChainWaitMs(): number {
  return (
    gexChartProjectionChainWaitMsForTests ??
    GEX_CHART_PROJECTION_CHAIN_WAIT_MS
  );
}

function getGexChartProjectionQuoteWaitMs(): number {
  return (
    gexChartProjectionQuoteWaitMsForTests ??
    GEX_CHART_PROJECTION_QUOTE_WAIT_MS
  );
}

function getGexChartProjectionSnapshotWaitMs(): number {
  return (
    gexChartProjectionSnapshotWaitMsForTests ??
    GEX_CHART_PROJECTION_SNAPSHOT_WAIT_MS
  );
}

function waitForChartGexProjectionValue<T>(
  request: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return request;
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);
    timer.unref?.();

    request.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function chartGexProjectionChainTimeout(
  ms: number,
  abort: () => void,
): Promise<typeof GEX_CHART_PROJECTION_CHAIN_TIMEOUT> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      abort();
      resolve(GEX_CHART_PROJECTION_CHAIN_TIMEOUT);
    }, ms);
    timeout.unref?.();
  });
}

async function waitForChartGexProjectionChain(
  input: {
    signal?: AbortSignal;
    request: (signal: AbortSignal) => Promise<GexOptionChainBatchPayload>;
  },
): Promise<
  GexOptionChainBatchPayload | typeof GEX_CHART_PROJECTION_CHAIN_TIMEOUT
> {
  const timeoutMs = getGexChartProjectionChainWaitMs();
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return input.request(input.signal ?? new AbortController().signal);
  }
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(
        new Error(
          "Compact option-chain data did not respond inside the chart projection budget.",
        ),
      );
    }
  };
  if (input.signal?.aborted) {
    abort();
  } else {
    input.signal?.addEventListener("abort", abort, { once: true });
  }
  const timeout = chartGexProjectionChainTimeout(timeoutMs, abort);
  const request = Promise.resolve()
    .then(() => input.request(controller.signal))
    .catch((error): typeof GEX_CHART_PROJECTION_CHAIN_TIMEOUT => {
      if (controller.signal.aborted) {
        return GEX_CHART_PROJECTION_CHAIN_TIMEOUT;
      }
      throw error;
    });
  try {
    return await Promise.race([timeout, request]);
  } finally {
    input.signal?.removeEventListener("abort", abort);
  }
}

async function queueGexSnapshotRefresh(
  ticker: string,
  reason: string,
  options: { dedupeBucket?: number | null } = {},
): Promise<GexSnapshotRefreshOutcome> {
  const dedupeBucket =
    typeof options.dedupeBucket === "number" &&
    Number.isSafeInteger(options.dedupeBucket) &&
    options.dedupeBucket >= 0
      ? options.dedupeBucket
      : Math.floor(Date.now() / 60_000);
  const facade = getGexIngestFacade();
  const baseInput = {
    symbol: ticker,
    payload: { reason, dedupeBucket },
  } satisfies Pick<EnqueueMarketDataJobInput, "symbol" | "payload">;
  const inputs = [
    {
      ...baseInput,
      priority: 1,
      kind: "stock_snapshot" as const,
    },
    {
      ...baseInput,
      priority: 2,
      kind: "option_chain_snapshot" as const,
    },
    {
      ...baseInput,
      priority: 3,
      kind: "gex_snapshot" as const,
    },
  ];
  const results = await Promise.all(
    inputs.map(async (input): Promise<GexSnapshotRefreshJobResult> => {
      try {
        const result = await facade.enqueueMarketDataJob(input);
        return { kind: input.kind, ...result };
      } catch (error) {
        return {
          kind: input.kind,
          queued: false,
          dedupeKey: "",
          reason:
            error instanceof Error && error.message
              ? error.message
              : "enqueue_error",
        };
      }
    }),
  );
  let diagnostics: MarketDataIngestDiagnostics | null = null;
  let diagnosticsError: string | null = null;
  try {
    diagnostics = await facade.getDiagnostics();
  } catch (error) {
    diagnosticsError =
      error instanceof Error && error.message
        ? error.message
        : "diagnostics_unavailable";
  }
  return {
    results,
    allQueued: results.every((result) => result.queued),
    diagnostics,
    diagnosticsError,
    workerLikelyInactive: Boolean(diagnostics?.workerLikelyInactive),
    workerInactiveReason: diagnostics?.workerInactiveReason ?? null,
  };
}

function resolveGexSnapshotRefreshDedupeBucket(
  snapshot: LatestGexSnapshot | null | undefined,
): number {
  const computedAtMs =
    snapshot?.computedAt instanceof Date &&
    Number.isFinite(snapshot.computedAt.getTime())
      ? snapshot.computedAt.getTime()
      : Date.now();
  return Math.max(0, Math.floor(computedAtMs / 60_000));
}

type GexSnapshotRefreshJobKind =
  | "stock_snapshot"
  | "option_chain_snapshot"
  | "gex_snapshot";

type GexSnapshotRefreshJobResult = EnqueueMarketDataJobResult & {
  kind: GexSnapshotRefreshJobKind;
};

type GexSnapshotRefreshOutcome = {
  results: GexSnapshotRefreshJobResult[];
  allQueued: boolean;
  diagnostics: MarketDataIngestDiagnostics | null;
  diagnosticsError: string | null;
  workerLikelyInactive: boolean;
  workerInactiveReason: string | null;
};

function describeGexRefreshFailures(
  outcome: GexSnapshotRefreshOutcome,
): string {
  return outcome.results
    .filter((result) => !result.queued)
    .map((result) =>
      result.reason ? `${result.kind} (${result.reason})` : result.kind,
    )
    .join(", ");
}

function buildGexRefreshPendingDetail(ticker: string): string {
  return `The market-data ingest worker must hydrate option-chain data and compute a GEX snapshot for ${ticker} before this route can return fresh data.`;
}

function buildGexRefreshUnavailableError(
  ticker: string,
  outcome: GexSnapshotRefreshOutcome,
): HttpError | null {
  const failures = describeGexRefreshFailures(outcome);
  if (failures) {
    return new HttpError(
      503,
      `GEX snapshot refresh could not be queued for ${ticker}.`,
      {
        code: "gex_snapshot_enqueue_failed",
        detail: `The refresh queue rejected one or more required jobs: ${failures}.`,
      },
    );
  }
  if (outcome.workerLikelyInactive) {
    const reason =
      outcome.workerInactiveReason ?? "claimable jobs are waiting without a running worker";
    return new HttpError(
      503,
      `GEX snapshot worker appears inactive for ${ticker}.`,
      {
        code: "gex_snapshot_worker_inactive",
        detail: `${buildGexRefreshPendingDetail(ticker)} Worker diagnostic: ${reason}.`,
      },
    );
  }
  return null;
}

function buildPersistedGexStaleMessage(
  outcome: GexSnapshotRefreshOutcome | null,
): string {
  if (!outcome) {
    return "Returning the latest persisted GEX snapshot while a refresh is being scheduled.";
  }
  const failures = describeGexRefreshFailures(outcome);
  if (failures) {
    return `Returning the latest persisted GEX snapshot because the refresh queue rejected required jobs: ${failures}.`;
  }
  if (outcome.workerLikelyInactive) {
    const reason =
      outcome.workerInactiveReason ?? "claimable jobs are waiting without a running worker";
    return `Returning the latest persisted GEX snapshot; refresh jobs are queued but the market-data ingest worker appears inactive (${reason}).`;
  }
  if (outcome.diagnosticsError) {
    return `Returning the latest persisted GEX snapshot while a refresh is queued. Ingest diagnostics were unavailable: ${outcome.diagnosticsError}.`;
  }
  return "Returning the latest persisted GEX snapshot while a refresh is queued.";
}

function markPersistedGexSnapshotStale(
  snapshot: LatestGexSnapshot,
  outcome: GexSnapshotRefreshOutcome | null,
): GexResponse {
  return markGexDashboardStale(
    compactPersistedGexDashboard(snapshot.payload),
    buildPersistedGexStaleMessage(outcome),
  );
}

function cachePersistedGexSnapshotStale(
  ticker: string,
  snapshot: LatestGexSnapshot,
  outcome: GexSnapshotRefreshOutcome | null,
): GexResponse {
  const stale = markPersistedGexSnapshotStale(snapshot, outcome);
  gexDashboardCache.set(ticker, {
    expiresAt: Date.now() + GEX_DASHBOARD_STALE_CACHE_TTL_MS,
    data: stale,
  });
  return stale;
}

function schedulePersistedGexSnapshotRefresh(
  ticker: string,
  snapshot: LatestGexSnapshot,
  reason: string,
): GexResponse {
  const stale = cachePersistedGexSnapshotStale(ticker, snapshot, null);
  void queueGexSnapshotRefresh(ticker, reason, {
    dedupeBucket: resolveGexSnapshotRefreshDedupeBucket(snapshot),
  })
    .then((outcome) => {
      const current = gexDashboardCache.get(ticker);
      if (
        current?.data?.isStale === true &&
        current.data.ticker === stale.ticker &&
        current.data.timestamp === stale.timestamp
      ) {
        cachePersistedGexSnapshotStale(ticker, snapshot, outcome);
      }
    })
    .catch(() => {
      // Stale data is already cached for the caller; the next cache miss will retry.
    });
  return stale;
}

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function getGexRuntimeConfig(): MassiveRuntimeConfig | null {
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

  return getMassiveRuntimeConfig();
}

function getOptionalGexMarketDataClient(): {
  client: GexMarketDataClient;
  config: MassiveRuntimeConfig;
} | null {
  const config = getGexRuntimeConfig();
  if (!config) {
    return null;
  }

  return {
    client: gexMarketDataClientFactory?.(config) ?? new MassiveMarketDataClient(config),
    config,
  };
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

function isLiveGexStockSpotQuote(quote: IbkrQuoteSnapshot): boolean {
  const source = String((quote as { source?: unknown }).source ?? "ibkr").toLowerCase();
  const freshness = String((quote as { freshness?: unknown }).freshness ?? "").toLowerCase();
  const marketDataMode = String(
    (quote as { marketDataMode?: unknown }).marketDataMode ?? "",
  ).toLowerCase();
  return (
    (source === "ibkr" || source === "massive") &&
    quote.delayed !== true &&
    freshness !== "delayed" &&
    marketDataMode !== "delayed" &&
    marketDataMode !== "delayed_frozen"
  );
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

function buildGexStrikeProfile(rows: GexOptionRow[], spot: number): Array<{
  strike: number;
  netGex: number;
}> {
  const byStrike = new Map<number, { strike: number; netGex: number }>();

  rows.forEach((option) => {
    const strike = finiteOrNull(option.strike);
    if (strike == null) return;

    const current = byStrike.get(strike) || { strike, netGex: 0 };
    current.netGex += contractGex(option, spot);
    byStrike.set(strike, current);
  });

  return Array.from(byStrike.values()).sort(
    (left, right) => left.strike - right.strike,
  );
}

function findGexZeroGamma(rows: GexOptionRow[], spot: number): number | null {
  const profile = buildGexStrikeProfile(rows, spot);
  if (!profile.length) return null;

  let previousStrike = profile[0].strike;
  let previousCum = profile[0].netGex;
  if (previousCum === 0) return previousStrike;

  for (let index = 1; index < profile.length; index += 1) {
    const row = profile[index];
    const nextCum = previousCum + row.netGex;
    if (
      (previousCum < 0 && nextCum >= 0) ||
      (previousCum > 0 && nextCum <= 0) ||
      nextCum === 0
    ) {
      const denominator = Math.abs(previousCum) + Math.abs(nextCum);
      const ratio = denominator > 0 ? Math.abs(previousCum) / denominator : 0;
      return previousStrike + ratio * (row.strike - previousStrike);
    }
    previousStrike = row.strike;
    previousCum = nextCum;
  }

  return null;
}

function resolveGexZeroGammaAsOf(data: GexResponse): string | null {
  return (
    data.source.chainUpdatedAt ||
    data.source.quoteUpdatedAt ||
    data.timestamp ||
    null
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

function ensureGexExpirationCoverage(data: GexResponse): GexResponse {
  if (data.source.expirationCoverage) return data;
  const loadedCount = new Set(
    (data.options || [])
      .map((option) => option.expirationDate)
      .filter((expirationDate): expirationDate is string => Boolean(expirationDate)),
  ).size;
  return {
    ...data,
    source: {
      ...data.source,
      expirationCoverage: {
        requestedCount: loadedCount,
        returnedCount: loadedCount,
        loadedCount,
        failedCount: 0,
        complete: data.source.status === "ok",
        capped: false,
      },
    },
  };
}

function resolveGexDashboardReferenceTimeMs(data: GexResponse): number {
  for (const value of [
    data.timestamp,
    data.source.chainUpdatedAt,
    data.source.quoteUpdatedAt,
  ]) {
    const time = Date.parse(String(value || ""));
    if (Number.isFinite(time)) {
      return time;
    }
  }
  return Date.now();
}

function validGexExpirationParts(
  year: number | null,
  month: number | null,
  day: number | null,
): { year: number; month: number; day: number } | null {
  if (
    year == null ||
    month == null ||
    day == null ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function compactPersistedGexOption(row: GexOptionRow): GexOptionRow | null {
  const strike = finiteOrNull(row.strike);
  const expiration = validGexExpirationParts(
    finiteOrNull(row.expireYear),
    finiteOrNull(row.expireMonth),
    finiteOrNull(row.expireDay),
  );
  const cp = row.cp === "C" || row.cp === "P" ? row.cp : null;
  if (strike == null || !expiration || !cp) {
    return null;
  }
  const multiplier =
    positiveOrNull(row.multiplier) ??
    positiveOrNull(row.sharesPerContract) ??
    100;

  return {
    strike,
    expireYear: expiration.year,
    expireMonth: expiration.month,
    expireDay: expiration.day,
    cp,
    expirationDate:
      row.expirationDate ||
      `${String(expiration.year).padStart(4, "0")}-${String(
        expiration.month,
      ).padStart(2, "0")}-${String(expiration.day).padStart(2, "0")}`,
    gamma: finiteOrZero(row.gamma),
    delta: finiteOrZero(row.delta),
    openInterest: Math.max(0, finiteOrZero(row.openInterest)),
    impliedVol: finiteOrZero(row.impliedVol),
    bid: finiteOrZero(row.bid),
    ask: finiteOrZero(row.ask),
    multiplier,
    // Pass through traded volume (massive populates it ~84% of rows) so the GEX
    // page can render the volume profile / Vol-OI ratio. Preserve missing as
    // undefined rather than coercing to 0 so coverage stays accurate.
    volume:
      typeof row.volume === "number" && Number.isFinite(row.volume)
        ? row.volume
        : undefined,
    // theta/vega/mark (massive populates theta+vega ~90%, mark ~84%) power the
    // vega-exposure profile, theta-decay map, and premium notional.
    theta:
      typeof row.theta === "number" && Number.isFinite(row.theta)
        ? row.theta
        : undefined,
    vega:
      typeof row.vega === "number" && Number.isFinite(row.vega)
        ? row.vega
        : undefined,
    mark:
      typeof row.mark === "number" && Number.isFinite(row.mark)
        ? row.mark
        : undefined,
  };
}

function compactPersistedGexDashboard(data: GexResponse): GexResponse {
  const normalized = ensureGexExpirationCoverage(data);
  const referenceTimeMs = resolveGexDashboardReferenceTimeMs(normalized);
  const options = normalized.options.flatMap((row) => {
    const compact = compactPersistedGexOption(row);
    if (!compact) {
      return [];
    }
    const expirationTimeMs = gexRowExpirationTimeMs(compact);
    if (expirationTimeMs != null && expirationTimeMs <= referenceTimeMs) {
      return [];
    }
    return [compact];
  });

  return {
    ...normalized,
    options,
  };
}

function markGexDashboardStale(data: GexResponse, message: string): GexResponse {
  const normalized = ensureGexExpirationCoverage(data);
  return {
    ...normalized,
    isStale: true,
    source: {
      ...normalized.source,
      status: "partial",
      message: appendGexSourceMessage(normalized.source.message, message),
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

  const chainPayload = await platformClient.batchOptionChains({
    underlying: ticker,
    expirationDates,
    strikeCoverage: "full",
    quoteHydration: "snapshot",
  });
  const loadedExpirationCount = chainPayload.results.filter(
    (result) => result.status === "loaded" && result.contracts.length > 0,
  ).length;
  const failedExpirationCount =
    chainPayload.results.filter(
      (result) => result.status !== "loaded" || result.contracts.length === 0,
    ).length + Math.max(0, expirationDates.length - chainPayload.results.length);
  const expirationCoverage = {
    requestedCount:
      expirationsPayload.debug?.requestedCount ?? expirationDates.length,
    returnedCount: expirationsPayload.debug?.returnedCount ?? expirationDates.length,
    loadedCount: loadedExpirationCount,
    failedCount: failedExpirationCount,
    complete:
      expirationsPayload.debug?.complete === true &&
      expirationsPayload.debug?.capped !== true &&
      failedExpirationCount === 0 &&
      loadedExpirationCount === expirationDates.length,
    capped: expirationsPayload.debug?.capped === true,
  };
  const chain = chainPayload.results.flatMap((result) => result.contracts);
  const mappedOptions = mapGexOptions(chain);
  const sourceProvider: GexResponse["source"]["provider"] = "ibkr";

  const quoteRows = (quotePayload.quotes || []) as IbkrQuoteSnapshot[];
  const quote =
    quoteRows.find(
      (snapshot) => snapshot.symbol === ticker && isLiveGexStockSpotQuote(snapshot),
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
        "GEX requires a current IBKR or Massive underlying quote, option-chain underlying price, or reference-provider close.",
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
  const partialSource =
    mappedOptions.usableOptionCount < mappedOptions.optionCount ||
    !expirationCoverage.complete ||
    expirationCoverage.capped ||
    expirationCoverage.failedCount > 0 ||
    !quote;
  const partialMessage =
    "GEX is computed from IBKR option-chain snapshots with live IBKR or Massive stock spot. Source is partial when expiration discovery is incomplete or capped, an expiration batch fails, a live spot quote is missing, or contracts lack usable gamma/open interest.";
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
      expirationCoverage,
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

  if (shouldUsePersistedGexSnapshots()) {
    const facade = getGexIngestFacade();
    const snapshot = await facade.getLatestGexSnapshot(
      ticker,
      GEX_SNAPSHOT_MAX_AGE_MS,
    );
    if (snapshot && !snapshot.stale) {
      const payload = compactPersistedGexDashboard(snapshot.payload);
      gexDashboardCache.set(ticker, {
        expiresAt: Date.now() + GEX_DASHBOARD_CACHE_TTL_MS,
        data: payload,
      });
      return payload;
    }
    if (snapshot) {
      return schedulePersistedGexSnapshotRefresh(
        ticker,
        snapshot,
        "gex_snapshot_stale",
      );
    }
    if (facade.isConfigured()) {
      const refresh = await queueGexSnapshotRefresh(
        ticker,
        "gex_snapshot_missing",
      );
      const unavailableError = buildGexRefreshUnavailableError(
        ticker,
        refresh,
      );
      if (unavailableError) {
        throw unavailableError;
      }
      throw new HttpError(503, `GEX snapshot is pending for ${ticker}.`, {
        code: "gex_snapshot_pending",
        detail: buildGexRefreshPendingDetail(ticker),
      });
    }
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

function buildUnavailableGexZeroGammaData(
  ticker: string,
  message: string,
): GexZeroGammaResponse {
  return {
    ticker,
    spot: null,
    zeroGamma: null,
    asOf: null,
    isStale: true,
    simulation: null,
    source: {
      provider: "ibkr",
      status: "unavailable",
      optionCount: 0,
      usableOptionCount: 0,
      message,
    },
  };
}

function buildGexZeroGammaDataFromDashboard(
  data: GexResponse,
): GexZeroGammaResponse {
  const spot = finiteOrNull(data.spot);
  const asOf = resolveGexZeroGammaAsOf(data);
  const simulation =
    spot != null && asOf
      ? buildGexZeroGammaSimulation({
          ticker: data.ticker,
          spot,
          asOf,
          options: data.options,
        })
      : null;
  const legacyZeroGamma =
    spot != null ? findGexZeroGamma(data.options, spot) : null;
  const zeroGamma = simulation?.zeroGamma ?? legacyZeroGamma;

  return {
    ticker: data.ticker,
    spot,
    zeroGamma,
    asOf,
    isStale: Boolean(data.isStale),
    simulation,
    source: {
      provider: data.source.provider,
      status: data.source.status,
      optionCount: data.source.optionCount,
      usableOptionCount: data.source.usableOptionCount,
      message: data.source.message,
    },
  };
}

export async function getGexZeroGammaData(input: {
  underlying: string;
  signal?: AbortSignal;
  mode?: ChartGexDataMode;
}): Promise<GexZeroGammaResponse> {
  const mode: ChartGexDataMode =
    input.mode === "snapshot" ? "snapshot" : "active";
  const ticker = normalizeSymbol(input.underlying);
  if (mode === "snapshot") {
    if (!ticker) {
      throw new HttpError(400, "GEX ticker is required.", {
        code: "gex_ticker_required",
      });
    }
    if (!shouldUsePersistedGexSnapshots()) {
      return buildUnavailableGexZeroGammaData(
        ticker,
        "Persisted GEX snapshots are not configured.",
      );
    }
    const snapshot = await loadLatestPassiveZeroGammaSnapshot(ticker);
    if (!snapshot?.payload?.options?.length) {
      return buildUnavailableGexZeroGammaData(
        ticker,
        "No persisted GEX snapshot is available.",
      );
    }
    const compact = compactPersistedGexDashboard(snapshot.payload);
    const data = snapshot.stale
      ? markGexDashboardStale(
          compact,
          "Persisted GEX snapshot is stale; no refresh was queued for passive chart mode.",
        )
      : compact;
    return buildGexZeroGammaDataFromDashboard(data);
  }

  let data: GexResponse;
  try {
    data = await getGexDashboardData(input);
  } catch (error) {
    if (
      isHttpError(error) &&
      [
        "gex_snapshot_pending",
        "gex_snapshot_enqueue_failed",
        "gex_snapshot_worker_inactive",
      ].includes(String(error.code))
    ) {
      return buildUnavailableGexZeroGammaData(
        ticker,
        error.detail ||
          error.message ||
          "GEX snapshot is pending while market-data ingest catches up.",
      );
    }
    throw error;
  }
  return buildGexZeroGammaDataFromDashboard(data);
}

function buildProjectionSource(data: GexResponse): GexProjectionSourceInput {
  return {
    provider: data.source.provider,
    status: data.source.status,
    expirationCoverage: data.source.expirationCoverage,
    optionCount: data.source.optionCount,
    usableOptionCount: data.source.usableOptionCount,
    withGamma: data.source.withGamma,
    withOpenInterest: data.source.withOpenInterest,
    withImpliedVolatility: data.source.withImpliedVolatility,
    flowStatus: data.source.flowStatus,
    flowEventCount: data.source.flowEventCount,
    classifiedFlowEventCount: data.source.classifiedFlowEventCount,
    flowClassificationCoverage: data.source.flowClassificationCoverage,
    flowClassificationConfidenceCounts:
      data.source.flowClassificationConfidenceCounts,
  };
}

function resolveGexProjectionDividendYield(
  _data: GexResponse,
): GexProjectionDividendYieldInput {
  return {
    status: "unavailable",
    value: 0,
    source: "unavailable",
    message:
      "No provider dividend-yield source is currently attached to GEX snapshots.",
  };
}

function buildUnavailableGexProjection(input: {
  ticker: string;
  spot?: number | null;
  asOf?: string | null;
  message: string;
}): GexProjectionResponse {
  return buildGexProjection({
    ticker: input.ticker,
    spot: positiveOrNull(input.spot) ?? 0,
    asOf: input.asOf || new Date().toISOString(),
    options: [],
    source: {
      provider: "ibkr",
      status: "unavailable",
      expirationCoverage: {
        requestedCount: 0,
        returnedCount: 0,
        loadedCount: 0,
        failedCount: 0,
        complete: false,
        capped: false,
      },
      optionCount: 0,
      usableOptionCount: 0,
      withGamma: 0,
      withOpenInterest: 0,
      withImpliedVolatility: 0,
      flowStatus: "unavailable",
      flowEventCount: 0,
      classifiedFlowEventCount: 0,
      flowClassificationCoverage: 0,
      flowClassificationConfidenceCounts: {
        high: 0,
        medium: 0,
        low: 0,
        none: 0,
      },
    },
    rates: {
      status: "unavailable",
      source: "unavailable",
      asOf: null,
      points: [],
      message: input.message,
    },
    dividendYield: {
      status: "unavailable",
      value: 0,
      source: "unavailable",
      message:
        "No provider dividend-yield source is currently attached to chart GEX projections.",
    },
    flowContext: null,
  });
}

const GEX_PROJECTION_EXPIRATION_UTC_HOUR = 20;

function gexRowExpirationTimeMs(row: GexOptionRow): number | null {
  if (
    !Number.isInteger(row.expireYear) ||
    !Number.isInteger(row.expireMonth) ||
    !Number.isInteger(row.expireDay)
  ) {
    return null;
  }
  const time = Date.UTC(
    row.expireYear,
    row.expireMonth - 1,
    row.expireDay,
    GEX_PROJECTION_EXPIRATION_UTC_HOUR,
    0,
    0,
    0,
  );
  return Number.isFinite(time) ? time : null;
}

function selectChartProjectionRowsFromSnapshot(
  rows: GexOptionRow[],
  spot: number,
  nowMs: number,
  maxExpirations = GEX_CHART_PROJECTION_SNAPSHOT_MAX_EXPIRATIONS,
): GexOptionRow[] {
  const rowsByExpiration = new Map<string, GexOptionRow[]>();
  rows.forEach((row) => {
    if (!row.expirationDate) {
      return;
    }
    const expirationTimeMs = gexRowExpirationTimeMs(row);
    if (expirationTimeMs != null && expirationTimeMs <= nowMs) {
      return;
    }
    const current = rowsByExpiration.get(row.expirationDate) ?? [];
    current.push(row);
    rowsByExpiration.set(row.expirationDate, current);
  });

  const selectedExpirations = Array.from(rowsByExpiration.keys())
    .sort((left, right) => left.localeCompare(right))
    .slice(0, Math.max(1, maxExpirations));
  const strikesPerExpiration =
    GEX_CHART_PROJECTION_STRIKES_AROUND_MONEY * 2 + 1;

  return selectedExpirations.flatMap((expirationDate) => {
    const expirationRows = rowsByExpiration.get(expirationDate) ?? [];
    const selectedStrikes = new Set(
      Array.from(new Set(expirationRows.map((row) => row.strike)))
        .filter((strike) => Number.isFinite(strike))
        .sort(
          (left, right) =>
            Math.abs(left - spot) - Math.abs(right - spot) || left - right,
        )
        .slice(0, strikesPerExpiration),
    );
    return expirationRows.filter((row) => selectedStrikes.has(row.strike));
  });
}

function summarizeChartProjectionRows(rows: GexOptionRow[]) {
  return {
    optionCount: rows.length,
    usableOptionCount: rows.length,
    withGamma: rows.filter((row) => finiteOrNull(row.gamma) != null).length,
    withOpenInterest: rows.filter((row) => finiteOrNull(row.openInterest) != null)
      .length,
    withImpliedVolatility: rows.filter(
      (row) => finiteOrNull(row.impliedVol) != null,
    ).length,
  };
}

async function loadLatestChartGexSnapshot(
  ticker: string,
): Promise<LatestGexSnapshot | null> {
  const facade = getGexIngestFacade();
  return (
    (await facade.getLatestChartGexSnapshot(ticker, GEX_SNAPSHOT_MAX_AGE_MS, {
      maxExpirations: GEX_CHART_PROJECTION_SNAPSHOT_MAX_EXPIRATIONS,
      strikesAroundMoney: GEX_CHART_PROJECTION_STRIKES_AROUND_MONEY,
    })) ??
    (await facade.getLatestGexSnapshot(ticker, GEX_SNAPSHOT_MAX_AGE_MS))
  );
}

async function loadLatestPassiveZeroGammaSnapshot(
  ticker: string,
): Promise<LatestGexSnapshot | null> {
  const facade = getGexIngestFacade();
  return (
    (await facade.getLatestGexSnapshot(ticker, GEX_SNAPSHOT_MAX_AGE_MS)) ??
    (await facade.getLatestChartGexSnapshot(ticker, GEX_SNAPSHOT_MAX_AGE_MS, {
      maxExpirations: GEX_CHART_PROJECTION_SNAPSHOT_MAX_EXPIRATIONS,
      strikesAroundMoney: GEX_CHART_PROJECTION_STRIKES_AROUND_MONEY,
    }))
  );
}

function buildChartGexProjectionFromPersistedSnapshot(input: {
  ticker: string;
  rates: GexProjectionRatesInput;
  snapshot: LatestGexSnapshot;
}): GexProjectionResponse | null {
  const snapshot = input.snapshot;
  if (!snapshot?.payload?.options?.length) {
    return null;
  }

  const payload = ensureGexExpirationCoverage(snapshot.payload);
  const spot = positiveOrNull(payload.spot);
  if (spot == null) {
    return null;
  }

  const selectedRows = selectChartProjectionRowsFromSnapshot(
    payload.options,
    spot,
    Date.now(),
    GEX_CHART_PROJECTION_SNAPSHOT_MAX_EXPIRATIONS,
  );
  if (!selectedRows.length) {
    return null;
  }

  const expirationCount = new Set(
    selectedRows.map((row) => row.expirationDate).filter(Boolean),
  ).size;
  const rowSummary = summarizeChartProjectionRows(selectedRows);
  return buildGexProjection({
    ticker: payload.ticker,
    spot,
    asOf: payload.timestamp,
    options: selectedRows,
    source: {
      provider: payload.source.provider,
      status:
        snapshot.stale || payload.source.status === "unavailable"
          ? "partial"
          : payload.source.status,
      expirationCoverage: {
        requestedCount: expirationCount,
        returnedCount: expirationCount,
        loadedCount: expirationCount,
        failedCount: 0,
        complete: expirationCount > 0,
        capped: false,
      },
      ...rowSummary,
      flowStatus: payload.source.flowStatus,
      flowEventCount: payload.source.flowEventCount,
      classifiedFlowEventCount: payload.source.classifiedFlowEventCount,
      flowClassificationCoverage: payload.source.flowClassificationCoverage,
      flowClassificationConfidenceCounts:
        payload.source.flowClassificationConfidenceCounts,
    },
    rates: input.rates,
    dividendYield: resolveGexProjectionDividendYield(payload),
    flowContext: payload.flowContext,
  });
}

async function buildChartGexProjectionFromLatestSnapshot(input: {
  ticker: string;
  rates: GexProjectionRatesInput;
  queueRefreshOnEmpty?: boolean;
}): Promise<GexProjectionResponse | null> {
  const snapshot = await loadLatestChartGexSnapshot(input.ticker);
  if (!snapshot?.payload?.options?.length) {
    if (input.queueRefreshOnEmpty !== false) {
      const facade = getGexIngestFacade();
      if (facade.isConfigured()) {
        void queueGexSnapshotRefresh(input.ticker, "chart_gex_projection_empty").catch(
          () => {},
        );
      }
    }
    return null;
  }

  return buildChartGexProjectionFromPersistedSnapshot({
    ticker: input.ticker,
    rates: input.rates,
    snapshot,
  });
}

async function getChartGexProjectionData(input: {
  underlying: string;
  signal?: AbortSignal;
  mode?: ChartGexDataMode;
}): Promise<GexProjectionResponse> {
  const ticker = normalizeSymbol(input.underlying);
  if (!ticker) {
    throw new HttpError(400, "GEX ticker is required.", {
      code: "gex_ticker_required",
    });
  }

  const mode: ChartGexDataMode =
    input.mode === "snapshot" ? "snapshot" : "active";
  if (mode === "snapshot") {
    if (!shouldUsePersistedGexSnapshots()) {
      return buildUnavailableGexProjection({
        ticker,
        message: "Persisted chart GEX snapshots are not configured.",
      });
    }
    const snapshot = await loadLatestChartGexSnapshot(ticker);
    if (!snapshot?.payload?.options?.length) {
      return buildUnavailableGexProjection({
        ticker,
        message: "No persisted chart GEX snapshot is available.",
      });
    }
    const rates = await getChartGexProjectionRates({ signal: input.signal });
    return (
      buildChartGexProjectionFromPersistedSnapshot({ ticker, rates, snapshot }) ??
      buildUnavailableGexProjection({
        ticker,
        message: "Persisted chart GEX snapshot has no usable projection rows.",
      })
    );
  }

  const rates = await getChartGexProjectionRates({ signal: input.signal });
  let snapshotProjectionAttempted = false;
  const trySnapshotProjection = async () => {
    if (snapshotProjectionAttempted || !shouldUsePersistedGexSnapshots()) {
      return null;
    }
    snapshotProjectionAttempted = true;
    return waitForChartGexProjectionValue(
      buildChartGexProjectionFromLatestSnapshot({ ticker, rates }),
      getGexChartProjectionSnapshotWaitMs(),
      null,
    );
  };

  const snapshotProjection = await trySnapshotProjection();
  if (snapshotProjection) {
    return snapshotProjection;
  }

  try {
    const platformClient = getGexPlatformDataClient();
    const now = new Date();
    const [quotePayload, expirationsPayload] = await Promise.all([
      waitForChartGexProjectionValue(
        platformClient.getQuoteSnapshots({ symbols: ticker }).catch(() => ({
          quotes: [],
          transport: null,
          delayed: false,
          fallbackUsed: false,
        })),
        getGexChartProjectionQuoteWaitMs(),
        {
          quotes: [],
          transport: null,
          delayed: false,
          fallbackUsed: false,
        },
      ),
      platformClient.getOptionExpirationsWithDebug({
        underlying: ticker,
        maxExpirations: GEX_CHART_PROJECTION_LIVE_MAX_EXPIRATIONS,
        recordBridgeFailure: false,
        foregroundWaitMs: Math.min(
          OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS,
          GEX_CHART_PROJECTION_EXPIRATION_WAIT_MS,
        ),
        signal: input.signal,
      }),
    ]);

    const quoteRows = (quotePayload.quotes || []) as IbkrQuoteSnapshot[];
    const quote =
      quoteRows.find(
        (snapshot) => snapshot.symbol === ticker && isLiveGexStockSpotQuote(snapshot),
      ) ?? null;
    const quoteSpot = positiveOrNull(quote?.price);
    if (quoteSpot == null) {
      return (
        (await trySnapshotProjection()) ??
        buildUnavailableGexProjection({
          ticker,
          spot: null,
          asOf: now.toISOString(),
          message:
            "A live quote did not respond inside the chart projection budget.",
        })
      );
    }
    const expirationDates = expirationsPayload.expirations
      .map((expiration) => expiration.expirationDate)
      .filter(
        (expirationDate): expirationDate is Date =>
          expirationDate instanceof Date &&
          !Number.isNaN(expirationDate.getTime()),
      )
      .slice(0, GEX_CHART_PROJECTION_LIVE_MAX_EXPIRATIONS);

    if (!expirationDates.length) {
      return (
        (await trySnapshotProjection()) ??
        buildUnavailableGexProjection({
          ticker,
          spot: quoteSpot,
          asOf: now.toISOString(),
          message: "No option expirations are available for chart projection.",
        })
      );
    }

    const chainPayload = await waitForChartGexProjectionChain({
      signal: input.signal,
      request: (signal) =>
        platformClient.batchOptionChains({
          underlying: ticker,
          expirationDates,
          strikeCoverage: "standard",
          strikesAroundMoney: GEX_CHART_PROJECTION_STRIKES_AROUND_MONEY,
          quoteHydration: "snapshot",
          underlyingSpotPrice: quoteSpot,
          recordBridgeFailure: false,
          signal,
        }),
    });
    if (chainPayload === GEX_CHART_PROJECTION_CHAIN_TIMEOUT) {
      return (
        (await trySnapshotProjection()) ??
        buildUnavailableGexProjection({
          ticker,
          spot: quoteSpot,
          asOf: now.toISOString(),
          message:
            "Compact option-chain data did not respond inside the chart projection budget.",
        })
      );
    }
    const loadedExpirationCount = chainPayload.results.filter(
      (result) => result.status === "loaded" && result.contracts.length > 0,
    ).length;
    const failedExpirationCount =
      chainPayload.results.filter(
        (result) => result.status !== "loaded" || result.contracts.length === 0,
      ).length + Math.max(0, expirationDates.length - chainPayload.results.length);
    const chain = chainPayload.results.flatMap((result) => result.contracts);
    const mappedOptions = mapGexOptions(chain);
    const spot =
      quoteSpot ?? deriveSpotFromOptionChain(chain) ?? positiveOrNull(mappedOptions.rows[0]?.strike);

    if (spot == null || spot <= 0 || mappedOptions.rows.length === 0) {
      return (
        (await trySnapshotProjection()) ??
        buildUnavailableGexProjection({
          ticker,
          spot,
          asOf: now.toISOString(),
          message:
            "Near-expiration option data is unavailable for chart projection.",
        })
      );
    }

    const expirationCoverage = {
      requestedCount: expirationDates.length,
      returnedCount: expirationDates.length,
      loadedCount: loadedExpirationCount,
      failedCount: failedExpirationCount,
      complete:
        failedExpirationCount === 0 &&
        loadedExpirationCount === expirationDates.length,
      capped: false,
    };
    const partialSource =
      mappedOptions.usableOptionCount < mappedOptions.optionCount ||
      !expirationCoverage.complete ||
      !quote;

    return buildGexProjection({
      ticker,
      spot,
      asOf: now.toISOString(),
      options: mappedOptions.rows,
      source: {
        provider: "ibkr",
        status: partialSource ? "partial" : "ok",
        expirationCoverage,
        optionCount: mappedOptions.optionCount,
        usableOptionCount: mappedOptions.usableOptionCount,
        withGamma: mappedOptions.withGamma,
        withOpenInterest: mappedOptions.withOpenInterest,
        withImpliedVolatility: mappedOptions.withImpliedVolatility,
        flowStatus: "unavailable",
        flowEventCount: 0,
        classifiedFlowEventCount: 0,
        flowClassificationCoverage: 0,
        flowClassificationConfidenceCounts: {
          high: 0,
          medium: 0,
          low: 0,
          none: 0,
        },
      },
      rates,
      dividendYield: {
        status: "unavailable",
        value: 0,
        source: "unavailable",
        message:
          "No provider dividend-yield source is currently attached to chart GEX projections.",
      },
      flowContext: null,
    });
  } catch (error) {
    if (isHttpError(error) && error.statusCode === 400) {
      throw error;
    }
    return (
      (await trySnapshotProjection()) ??
      buildUnavailableGexProjection({
        ticker,
        asOf: new Date().toISOString(),
        message:
          error instanceof Error
            ? error.message
            : "Chart GEX projection is unavailable.",
      })
    );
  }
}

export async function getGexProjectionData(input: {
  underlying: string;
  signal?: AbortSignal;
  scope?: "full" | "chart";
  mode?: ChartGexDataMode;
}): Promise<GexProjectionResponse> {
  if (input.scope === "chart") {
    return getChartGexProjectionData(input);
  }
  const data = await getGexDashboardData(input);
  const rates = await getGexProjectionRates({ signal: input.signal });
  return buildGexProjection({
    ticker: data.ticker,
    spot: data.spot,
    asOf: data.timestamp,
    options: data.options,
    source: buildProjectionSource(data),
    rates,
    dividendYield: resolveGexProjectionDividendYield(data),
    flowContext: data.flowContext,
  });
}

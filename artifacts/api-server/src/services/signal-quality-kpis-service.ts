// Per-deployment signal-quality KPI orchestration.
//
// Resolves the deployment's control-panel signal settings (draft override >
// saved config > profile defaults), loads a rolling stored-bar window for a
// bounded slice of the symbol universe, post-filters the backtested signals
// through the signal-options MTF-alignment gate, and computes the eight
// signal-quality KPIs (delegated to computeSignalQualityKpis). Runs inline in
// the request handler with an ephemeral cache keyed by
// (deploymentId, settingsHash, asOfDay): short TTL, in-flight dedupe,
// stale-while-recompute. No persistence table and no job queue (v1).
import { createHash } from "node:crypto";
import { algoDeploymentsTable, db } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
} from "@workspace/pyrus-signals-core";
import {
  resolveSignalOptionsExecutionProfile,
  signalOptionsDefaultMtfTimeframes,
} from "@workspace/backtest-core";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getSignalMonitorProfile } from "./signal-monitor";
import {
  computeSignalQualityKpis,
  type SignalQualityKpiResult,
  type SignalQualityMtfConfig,
} from "./signal-quality-kpis";

const BAR_CACHE_SOURCE = "massive-history";
// Settings preview window. ~90 trading days, capped by a per-symbol bar budget
// that keeps each indexed read inside the database statement timeout (the live
// app keeps bar_cache hot/contended; large desc-scans time out -- see the
// de-risk probe). At 5m this caps the realized window to roughly the most recent
// ~9 trading days; coarser timeframes reach the full 90d. Actual coverage is
// always reported back.
const ROLLING_WINDOW_DAYS = 90;
const MAX_BARS_PER_SYMBOL = 720;
// Inline-budget guardrails. The universe can be 500+ symbols; computing KPIs
// over all of them inline is infeasible, so we cap the symbol slice (head of the
// curated universe) and report the cap in metadata.
const MAX_SYMBOLS = 30;
const BAR_FETCH_CONCURRENCY = 3;
// Distinct draft settings produce distinct cache keys. Serialize cold recomputes
// so slider previews and the sidebar cannot make several 30-symbol bar_cache
// fanouts run at once.
const KPI_COMPUTE_CONCURRENCY = 1;

const CACHE_TTL_MS = 60_000;
// Recompute kicked off in the background may serve slightly older data for this
// long before it is considered too stale to serve at all.
const CACHE_HARD_MAX_AGE_MS = 5 * 60_000;

type StrategySignalTimeframe = "1m" | "2m" | "5m" | "15m" | "1h" | "1d";
const STRATEGY_SIGNAL_TIMEFRAMES: readonly StrategySignalTimeframe[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
];
// Coarser-tf fallback order used when the resolved timeframe cannot reach the
// rolling window (or is 1m, defaulted to 5m for preview latency). Each entry
// must be a valid bar_cache timeframe.
const TIMEFRAME_FALLBACK_ORDER: readonly StrategySignalTimeframe[] = [
  "5m",
  "15m",
  "1h",
  "1d",
];
const PYRUS_BOS_CONFIRMATIONS = ["close", "wicks"] as const;
const DEFAULT_STRATEGY_SIGNAL_SETTINGS = {
  signalTimeframe: "5m" as StrategySignalTimeframe,
  timeHorizon: 8,
  bosConfirmation: "wicks" as (typeof PYRUS_BOS_CONFIRMATIONS)[number],
  chochAtrBuffer: 0,
  chochBodyExpansionAtr: 0,
  chochVolumeGate: 0,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
}

function timeframeFromValue(
  value: unknown,
): StrategySignalTimeframe | undefined {
  const timeframe = String(value ?? "").trim();
  return STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe as StrategySignalTimeframe)
    ? (timeframe as StrategySignalTimeframe)
    : undefined;
}

// Optional draft settings mirroring the strategy-settings payload shape (the
// patch the control panel sends to PATCH .../strategy-settings).
export type SignalQualityDraftOverride = {
  signalTimeframe?: unknown;
  timeHorizon?: unknown;
  bosConfirmation?: unknown;
  chochAtrBuffer?: unknown;
  chochBodyExpansionAtr?: unknown;
  chochVolumeGate?: unknown;
};

export type ResolvedStrategySignalSettings = {
  signalTimeframe: StrategySignalTimeframe;
  timeHorizon: number;
  bosConfirmation: (typeof PYRUS_BOS_CONFIRMATIONS)[number];
  chochAtrBuffer: number;
  chochBodyExpansionAtr: number;
  chochVolumeGate: number;
};

// Ports algoHelpers.resolveStrategySignalSettings to the server with the
// control-panel precedence the user locked: draft override > saved deployment
// config > signal-monitor profile defaults. (algoHelpers prefers the profile
// over config; the KPI route flips that so an unsaved preview reflects the draft
// first, then what was last saved on the deployment, then profile baselines.)
export function resolveDeploymentSignalSettings(input: {
  deploymentConfig: unknown;
  profilePyrusSignalsSettings: unknown;
  profileTimeframe: unknown;
  draft?: SignalQualityDraftOverride;
}): ResolvedStrategySignalSettings {
  const draft = input.draft ?? {};
  const parameters = asRecord(asRecord(input.deploymentConfig).parameters);
  const pyrusSignalsSettings = asRecord(input.profilePyrusSignalsSettings);
  const profileMarketStructure = asRecord(pyrusSignalsSettings.marketStructure);
  const configMarketStructure = asRecord(parameters.marketStructure);

  // draft > config > profile, with profile.marketStructure / top-level both
  // considered as the lowest-precedence baseline (as the Pyrus reader does).
  const pick = (
    draftValue: unknown,
    ...candidates: unknown[]
  ): unknown => {
    if (draftValue !== undefined) {
      return draftValue;
    }
    for (const candidate of candidates) {
      if (candidate !== undefined) {
        return candidate;
      }
    }
    return undefined;
  };

  const signalTimeframe =
    timeframeFromValue(draft.signalTimeframe) ??
    timeframeFromValue(parameters.signalTimeframe) ??
    timeframeFromValue(input.profileTimeframe) ??
    DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe;

  const rawBos = String(
    pick(
      draft.bosConfirmation,
      configMarketStructure.bosConfirmation,
      parameters.bosConfirmation,
      profileMarketStructure.bosConfirmation,
      pyrusSignalsSettings.bosConfirmation,
    ) ?? "",
  );
  const bosConfirmation = PYRUS_BOS_CONFIRMATIONS.includes(
    rawBos as (typeof PYRUS_BOS_CONFIRMATIONS)[number],
  )
    ? (rawBos as (typeof PYRUS_BOS_CONFIRMATIONS)[number])
    : DEFAULT_STRATEGY_SIGNAL_SETTINGS.bosConfirmation;

  return {
    signalTimeframe,
    timeHorizon: Math.round(
      boundedNumber(
        pick(
          draft.timeHorizon,
          configMarketStructure.timeHorizon,
          parameters.timeHorizon,
          profileMarketStructure.timeHorizon,
          pyrusSignalsSettings.timeHorizon,
        ),
        DEFAULT_STRATEGY_SIGNAL_SETTINGS.timeHorizon,
        2,
        50,
      ),
    ),
    bosConfirmation,
    chochAtrBuffer: boundedNumber(
      pick(
        draft.chochAtrBuffer,
        configMarketStructure.chochAtrBuffer,
        parameters.chochAtrBuffer,
        profileMarketStructure.chochAtrBuffer,
        pyrusSignalsSettings.chochAtrBuffer,
      ),
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochAtrBuffer,
      0,
      20,
    ),
    chochBodyExpansionAtr: boundedNumber(
      pick(
        draft.chochBodyExpansionAtr,
        configMarketStructure.chochBodyExpansionAtr,
        parameters.chochBodyExpansionAtr,
        profileMarketStructure.chochBodyExpansionAtr,
        pyrusSignalsSettings.chochBodyExpansionAtr,
      ),
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochBodyExpansionAtr,
      0,
      20,
    ),
    chochVolumeGate: boundedNumber(
      pick(
        draft.chochVolumeGate,
        configMarketStructure.chochVolumeGate,
        parameters.chochVolumeGate,
        profileMarketStructure.chochVolumeGate,
        pyrusSignalsSettings.chochVolumeGate,
      ),
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochVolumeGate,
      0,
      20,
    ),
  };
}

// Maps the resolved strategy settings into the full PyrusSignalsSignalSettings
// the evaluator consumes (resolvePyrusSignalsSignalSettings fills the rest with
// defaults). MTF filters are left disabled inside the engine because alignment
// is applied as an explicit post-filter that mirrors signal-options behavior.
function toPyrusSettings(resolved: ResolvedStrategySignalSettings) {
  return resolvePyrusSignalsSignalSettings({
    timeHorizon: resolved.timeHorizon,
    bosConfirmation: resolved.bosConfirmation,
    chochAtrBuffer: resolved.chochAtrBuffer,
    chochBodyExpansionAtr: resolved.chochBodyExpansionAtr,
    chochVolumeGate: resolved.chochVolumeGate,
  });
}

function previewTimeframeFor(
  signalTimeframe: StrategySignalTimeframe,
): StrategySignalTimeframe {
  // 1m has the worst latency / bar volume; default preview to 5m.
  return signalTimeframe === "1m" ? "5m" : signalTimeframe;
}

type SymbolBars = {
  symbol: string;
  bars: PyrusSignalsBar[];
  timedOut: boolean;
};

// One indexed read per symbol: latest MAX_BARS_PER_SYMBOL bars at-or-after the
// window start. No upper bound -- the rolling window always ends at "now", and
// adding `starts_at <= now` defeats the index and times out (de-risk finding).
async function loadSymbolBars(
  symbol: string,
  timeframe: StrategySignalTimeframe,
  from: Date,
  limit: number,
): Promise<SymbolBars> {
  try {
    const result = await db.execute(sql`
      select starts_at, open, high, low, close, volume
      from bar_cache
      where symbol = ${symbol}
        and timeframe = ${timeframe}
        and source = ${BAR_CACHE_SOURCE}
        and starts_at >= ${from}
      order by starts_at desc
      limit ${limit}
    `);
    type BarRow = {
      starts_at: Date | string;
      open: string | number;
      high: string | number;
      low: string | number;
      close: string | number;
      volume: string | number;
    };
    const rows = result.rows as BarRow[];
    // Ascending for the evaluator; rows arrive newest-first.
    const bars: PyrusSignalsBar[] = rows
      .map((row) => {
        const timestamp =
          row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at);
        const time = Math.floor(timestamp.getTime() / 1000);
        return {
          time,
          ts: timestamp.toISOString(),
          o: Number(row.open),
          h: Number(row.high),
          l: Number(row.low),
          c: Number(row.close),
          v: Number(row.volume),
        };
      })
      .sort((left, right) => left.time - right.time);
    return { symbol, bars, timedOut: false };
  } catch (error) {
    // A statement timeout for a single symbol must not fail the whole request;
    // record it in coverage metadata and continue with the rest.
    logger.warn(
      { error, symbol, timeframe },
      "signal-quality KPI bar load failed for symbol",
    );
    return { symbol, bars: [], timedOut: true };
  }
}

async function loadBarsForSymbols(
  symbols: string[],
  timeframe: StrategySignalTimeframe,
  from: Date,
): Promise<SymbolBars[]> {
  const results: SymbolBars[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await loadSymbolBars(
        symbols[index],
        timeframe,
        from,
        MAX_BARS_PER_SYMBOL,
      );
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BAR_FETCH_CONCURRENCY, symbols.length) }, worker),
  );
  return results;
}

export type SignalQualityCoverage = {
  requestedTimeframe: StrategySignalTimeframe;
  resolvedTimeframe: StrategySignalTimeframe;
  requestedWindowDays: number;
  windowStart: string | null;
  windowEnd: string | null;
  requestedSymbolCount: number;
  evaluatedSymbolCount: number;
  symbolsWithBars: number;
  symbolsTimedOut: number;
  barsPerSymbolCap: number;
  totalBars: number;
  truncatedSymbolUniverse: boolean;
  usedTimeframeFallback: boolean;
};

export type SignalQualityKpiResponse = {
  deploymentId: string;
  asOfDay: string;
  settings: ResolvedStrategySignalSettings;
  mtf: SignalQualityMtfConfig;
  kpis: SignalQualityKpiResult;
  coverage: SignalQualityCoverage;
  generatedAt: string;
};

function asOfDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function settingsHash(
  settings: ResolvedStrategySignalSettings,
  mtf: SignalQualityMtfConfig,
  symbols: string[],
): string {
  return createHash("sha1")
    .update(JSON.stringify({ settings, mtf, symbols }))
    .digest("hex")
    .slice(0, 16);
}

async function resolveDeploymentContext(deploymentId: string) {
  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, deploymentId))
    .limit(1);
  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }
  const profile = await getSignalMonitorProfile({
    environment: deployment.mode,
  });
  return { deployment, profile };
}

type DeploymentSignalQualityContext = Awaited<
  ReturnType<typeof resolveDeploymentContext>
>;

// Resolve the MTF gate from the deployment's signal-options execution profile,
// mirroring evaluateSignalOptionsEntryGate: the gate is active only when both
// entryHaltControls.mtfAlignmentEnabled !== false and mtfAlignment.enabled.
function resolveMtfConfig(deploymentConfig: unknown): SignalQualityMtfConfig {
  const profile = resolveSignalOptionsExecutionProfile(deploymentConfig);
  const alignment = profile.entryGate.mtfAlignment;
  const enabled =
    profile.entryHaltControls.mtfAlignmentEnabled !== false &&
    alignment.enabled === true;
  const timeframes = alignment.timeframes.length
    ? [...alignment.timeframes]
    : [...signalOptionsDefaultMtfTimeframes];
  return {
    enabled,
    requiredCount: alignment.requiredCount,
    timeframes,
  };
}

async function computeResponse(
  deploymentId: string,
  draft: SignalQualityDraftOverride | undefined,
  now: Date,
  context?: DeploymentSignalQualityContext,
): Promise<SignalQualityKpiResponse> {
  const { deployment, profile } =
    context ?? (await resolveDeploymentContext(deploymentId));
  const settings = resolveDeploymentSignalSettings({
    deploymentConfig: deployment.config,
    profilePyrusSignalsSettings: profile.pyrusSignalsSettings,
    profileTimeframe: profile.timeframe,
    draft,
  });
  const mtf = resolveMtfConfig(deployment.config);

  const universe = Array.isArray(deployment.symbolUniverse)
    ? deployment.symbolUniverse
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean)
    : [];
  const symbols = universe.slice(0, MAX_SYMBOLS);
  const truncatedSymbolUniverse = universe.length > symbols.length;

  const requestedTimeframe = settings.signalTimeframe;
  const previewTimeframe = previewTimeframeFor(requestedTimeframe);
  const from = new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Try the preview timeframe, then coarser fallbacks until at least one symbol
  // returns bars (coverage exists for the universe; this guards thin tickers and
  // statement-timeout pressure on finer timeframes).
  const fallbackChain: StrategySignalTimeframe[] = [
    previewTimeframe,
    ...TIMEFRAME_FALLBACK_ORDER.filter(
      (timeframe) =>
        STRATEGY_SIGNAL_TIMEFRAMES.indexOf(timeframe) >
        STRATEGY_SIGNAL_TIMEFRAMES.indexOf(previewTimeframe),
    ),
  ].filter((timeframe, index, all) => all.indexOf(timeframe) === index);

  let resolvedTimeframe = previewTimeframe;
  let loaded: SymbolBars[] = [];
  for (const timeframe of fallbackChain) {
    resolvedTimeframe = timeframe;
    loaded = symbols.length ? await loadBarsForSymbols(symbols, timeframe, from) : [];
    if (loaded.some((entry) => entry.bars.length > 0)) {
      break;
    }
  }

  const barsBySymbol: Record<string, PyrusSignalsBar[]> = {};
  let windowStartMs: number | null = null;
  let windowEndMs: number | null = null;
  let totalBars = 0;
  let symbolsWithBars = 0;
  let symbolsTimedOut = 0;
  for (const entry of loaded) {
    if (entry.timedOut) {
      symbolsTimedOut += 1;
    }
    if (!entry.bars.length) {
      continue;
    }
    barsBySymbol[entry.symbol] = entry.bars;
    symbolsWithBars += 1;
    totalBars += entry.bars.length;
    const first = entry.bars[0].time * 1000;
    const last = entry.bars[entry.bars.length - 1].time * 1000;
    windowStartMs = windowStartMs == null ? first : Math.min(windowStartMs, first);
    windowEndMs = windowEndMs == null ? last : Math.max(windowEndMs, last);
  }

  const kpis = computeSignalQualityKpis({
    settings: toPyrusSettings(settings),
    barsBySymbol,
    horizonBars: settings.timeHorizon,
    mtf,
    sourceStrategy: deployment.strategyId,
    sourceProfile: deployment.mode,
    sourceTimeframe: resolvedTimeframe,
  });

  return {
    deploymentId,
    asOfDay: asOfDay(now),
    settings,
    mtf,
    kpis,
    coverage: {
      requestedTimeframe,
      resolvedTimeframe,
      requestedWindowDays: ROLLING_WINDOW_DAYS,
      windowStart: windowStartMs == null ? null : new Date(windowStartMs).toISOString(),
      windowEnd: windowEndMs == null ? null : new Date(windowEndMs).toISOString(),
      requestedSymbolCount: universe.length,
      evaluatedSymbolCount: symbols.length,
      symbolsWithBars,
      symbolsTimedOut,
      barsPerSymbolCap: MAX_BARS_PER_SYMBOL,
      totalBars,
      truncatedSymbolUniverse,
      usedTimeframeFallback: resolvedTimeframe !== previewTimeframe,
    },
    generatedAt: now.toISOString(),
  };
}

type CacheEntry = {
  response: SignalQualityKpiResponse;
  storedAtMs: number;
};

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SignalQualityKpiResponse>>();
let activeKpiComputes = 0;
const kpiComputeQueue: Array<() => void> = [];

function drainKpiComputeQueue() {
  while (
    activeKpiComputes < KPI_COMPUTE_CONCURRENCY &&
    kpiComputeQueue.length > 0
  ) {
    const run = kpiComputeQueue.shift();
    run?.();
  }
}

function runQueuedKpiCompute<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeKpiComputes += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeKpiComputes = Math.max(0, activeKpiComputes - 1);
          drainKpiComputeQueue();
        });
    };
    kpiComputeQueue.push(run);
    drainKpiComputeQueue();
  });
}

function cacheKey(
  deploymentId: string,
  hash: string,
  day: string,
): string {
  return `${deploymentId}:${hash}:${day}`;
}

export async function getDeploymentSignalQualityKpis(input: {
  deploymentId: string;
  draft?: SignalQualityDraftOverride;
}): Promise<SignalQualityKpiResponse> {
  const deploymentId = String(input.deploymentId ?? "").trim();
  if (!deploymentId) {
    throw new HttpError(400, "Missing deploymentId.", {
      code: "invalid_request",
    });
  }

  // The cache key needs the resolved settings, but resolving them requires a DB
  // read. To keep the cache cheap while honoring (deploymentId, settingsHash,
  // asOfDay), resolve settings first (cheap relative to bar loading + KPI math),
  // then key the heavy work.
  const now = new Date();
  const { deployment, profile } = await resolveDeploymentContext(deploymentId);
  const settings = resolveDeploymentSignalSettings({
    deploymentConfig: deployment.config,
    profilePyrusSignalsSettings: profile.pyrusSignalsSettings,
    profileTimeframe: profile.timeframe,
    draft: input.draft,
  });
  const mtf = resolveMtfConfig(deployment.config);
  const universe = Array.isArray(deployment.symbolUniverse)
    ? deployment.symbolUniverse
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean)
        .slice(0, MAX_SYMBOLS)
    : [];
  const key = cacheKey(
    deploymentId,
    settingsHash(settings, mtf, universe),
    asOfDay(now),
  );

  const cached = responseCache.get(key);
  const ageMs = cached ? now.getTime() - cached.storedAtMs : Infinity;
  if (cached && ageMs < CACHE_TTL_MS) {
    return cached.response;
  }

  // In-flight dedupe: concurrent callers for the same key share one computation.
  const existing = inFlight.get(key);
  if (existing) {
    if (cached && ageMs < CACHE_HARD_MAX_AGE_MS) {
      return cached.response;
    }
    return existing;
  }

  const work = runQueuedKpiCompute(() =>
    computeResponse(deploymentId, input.draft, now, { deployment, profile }),
  )
    .then((response) => {
      responseCache.set(key, { response, storedAtMs: Date.now() });
      return response;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, work);

  // Stale-while-recompute: serve the stale entry immediately if it is still
  // within the hard max age; otherwise wait for the fresh computation.
  if (cached && ageMs < CACHE_HARD_MAX_AGE_MS) {
    work.catch((error) => {
      logger.warn({ error, deploymentId }, "signal-quality KPI recompute failed");
    });
    return cached.response;
  }
  return work;
}

export const __signalQualityKpisServiceInternalsForTests = {
  resolveDeploymentSignalSettings,
  resolveMtfConfig,
  previewTimeframeFor,
  runQueuedKpiCompute,
  getKpiComputeQueueSnapshot: () => ({
    active: activeKpiComputes,
    queued: kpiComputeQueue.length,
    concurrency: KPI_COMPUTE_CONCURRENCY,
    barFetchConcurrency: BAR_FETCH_CONCURRENCY,
  }),
};

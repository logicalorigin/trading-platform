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
import {
  resolvePreviousUsEquitySessionClose,
  resolveUsEquityMarketStatus,
} from "@workspace/market-calendar";
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
// Match the active signal-matrix universe cap (SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT, now 2000).
// Calibration covers the full deployment universe; the cold-sweep budget below is scaled
// to match so the 0.98 coverage gate can still be met at 2000 symbols.
const MAX_SYMBOLS = 2000;
// Load bars in set-based lateral chunks instead of one DB round-trip per symbol.
// The KPI compute itself is still globally serialized below.
const BAR_FETCH_CHUNK_SIZE = 20;
const BAR_FETCH_CONCURRENCY = 3;
// Bound cold full-universe sweeps. Scaled ~4x with MAX_SYMBOLS (500 -> 2000) so the 0.98
// coverage gate stays reachable; chunks not started inside this budget time out and block
// recommendations. A cold 2000-symbol calibration can take up to this long.
const BAR_FETCH_HARD_BUDGET_MS = 480_000;
// Distinct draft settings produce distinct cache keys. Serialize cold recomputes
// so slider previews and the sidebar cannot make several 500-symbol bar_cache
// fanouts run at once.
const KPI_COMPUTE_CONCURRENCY = 1;
const MIN_CALIBRATION_SYMBOL_COVERAGE_RATIO = 0.98;
const MAX_CALIBRATION_SYMBOL_TIMEOUT_RATIO = 0.01;

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
const TIMEFRAME_MS: Record<StrategySignalTimeframe, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
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
  outcomeHorizonBars?: unknown;
  bosConfirmation?: unknown;
  chochAtrBuffer?: unknown;
  chochBodyExpansionAtr?: unknown;
  chochVolumeGate?: unknown;
};

export type ResolvedStrategySignalSettings = {
  signalTimeframe: StrategySignalTimeframe;
  timeHorizon: number;
  // Outcome-measurement window (bars forward) used only for signal-quality
  // KPIs. Independent of timeHorizon (the engine swing-pivot lookback).
  outcomeHorizonBars: number;
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

  const timeHorizon = Math.round(
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
  );

  // Outcome-measurement horizon: how many bars forward the signal-quality KPIs
  // realize each signal's outcome. Independent of timeHorizon (the swing-pivot
  // lookback the engine uses for structure detection). Defaults to timeHorizon
  // so deployments with no explicit outcomeHorizonBars see byte-identical KPIs.
  const outcomeHorizonBars = Math.round(
    boundedNumber(
      pick(
        draft.outcomeHorizonBars,
        configMarketStructure.outcomeHorizonBars,
        parameters.outcomeHorizonBars,
        profileMarketStructure.outcomeHorizonBars,
        pyrusSignalsSettings.outcomeHorizonBars,
      ),
      timeHorizon,
      1,
      120,
    ),
  );

  return {
    signalTimeframe,
    timeHorizon,
    outcomeHorizonBars,
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

function normalizeSignalQualityUniverse(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const item of value) {
    const symbol = String(item ?? "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

function selectSignalQualitySymbols(universe: readonly string[]): string[] {
  return universe.slice(0, MAX_SYMBOLS);
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

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function signalQualityLatestBarStaleWindowMs(
  timeframe: StrategySignalTimeframe,
): number {
  const timeframeMs = TIMEFRAME_MS[timeframe];
  const minimumWindowMs =
    timeframe === "1d" ? 4 * TIMEFRAME_MS["1d"] : 15 * 60_000;
  return Math.max(timeframeMs * 4, minimumWindowMs);
}

function expectedSignalQualityLatestBarAt(input: {
  timeframe: StrategySignalTimeframe;
  now: Date;
}): Date | null {
  if (input.timeframe === "1d") {
    return resolvePreviousUsEquitySessionClose(input.now);
  }
  const status = resolveUsEquityMarketStatus(input.now);
  const quiet = status.session.key === "closed" || !status.calendarDay?.tradingDay;
  if (quiet) {
    return resolvePreviousUsEquitySessionClose(input.now);
  }
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  return new Date(Math.floor(input.now.getTime() / timeframeMs) * timeframeMs);
}

function isSignalQualityQuietMarketSession(now: Date): boolean {
  const status = resolveUsEquityMarketStatus(now);
  return status.session.key === "closed" || !status.calendarDay?.tradingDay;
}

function signalQualityBarWindowFresh(input: {
  timeframe: StrategySignalTimeframe;
  latestBarAt: Date | null;
  now: Date;
}): boolean {
  if (!input.latestBarAt || Number.isNaN(input.latestBarAt.getTime())) {
    return false;
  }
  const expectedLatestBarAt = expectedSignalQualityLatestBarAt(input);
  if (!expectedLatestBarAt) {
    return false;
  }
  if (input.timeframe === "1d") {
    return utcDateKey(input.latestBarAt) >= utcDateKey(expectedLatestBarAt);
  }
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  if (
    input.latestBarAt.getTime() >=
    expectedLatestBarAt.getTime() - timeframeMs
  ) {
    return true;
  }
  if (!isSignalQualityQuietMarketSession(input.now)) {
    return false;
  }
  const staleWindowMs = signalQualityLatestBarStaleWindowMs(input.timeframe);
  return expectedLatestBarAt.getTime() - input.latestBarAt.getTime() <= staleWindowMs;
}

function latestBarAtForLoadedBars(loaded: readonly SymbolBars[]): Date | null {
  let latestMs: number | null = null;
  for (const entry of loaded) {
    const last = entry.bars.at(-1);
    if (!last) {
      continue;
    }
    const barMs = last.time * 1000;
    if (!Number.isFinite(barMs)) {
      continue;
    }
    latestMs = latestMs == null ? barMs : Math.max(latestMs, barMs);
  }
  return latestMs == null ? null : new Date(latestMs);
}

type SymbolBars = {
  symbol: string;
  bars: PyrusSignalsBar[];
  timedOut: boolean;
};

function chunkArray<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  const chunkSize = Math.max(1, Math.floor(size));
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

// One indexed lateral read per symbol inside a bounded multi-symbol chunk:
// latest MAX_BARS_PER_SYMBOL bars at-or-after the window start. No upper bound
// -- the rolling window always ends at "now", and adding `starts_at <= now`
// defeats the index and times out (de-risk finding).
async function loadSymbolBarsChunk(
  symbols: string[],
  timeframe: StrategySignalTimeframe,
  from: Date,
  limit: number,
): Promise<SymbolBars[]> {
  if (!symbols.length) {
    return [];
  }
  const symbolValues = sql.join(
    symbols.map((symbol) => sql`${symbol}`),
    sql`, `,
  );
  try {
    const result = await db.execute(sql`
      select b.symbol, b.starts_at, b.open, b.high, b.low, b.close, b.volume
      from unnest(array[${symbolValues}]::text[]) as s(symbol)
      cross join lateral (
        select symbol, starts_at, open, high, low, close, volume
        from bar_cache
        where symbol = s.symbol
          and timeframe = ${timeframe}
          and source = ${BAR_CACHE_SOURCE}
          and starts_at >= ${from}
        order by starts_at desc
        limit ${limit}
      ) b
    `);
    type BarRow = {
      symbol: string;
      starts_at: Date | string;
      open: string | number;
      high: string | number;
      low: string | number;
      close: string | number;
      volume: string | number;
    };
    const rows = result.rows as BarRow[];
    const barsBySymbol = new Map<string, PyrusSignalsBar[]>(
      symbols.map((symbol) => [symbol, []]),
    );
    for (const row of rows) {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      const bars = barsBySymbol.get(symbol);
      if (!bars) {
        continue;
      }
      const timestamp =
        row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at);
      const time = Math.floor(timestamp.getTime() / 1000);
      bars.push({
        time,
        ts: timestamp.toISOString(),
        o: Number(row.open),
        h: Number(row.high),
        l: Number(row.low),
        c: Number(row.close),
        v: Number(row.volume),
      });
    }
    // Keep the SQL on the indexed per-symbol desc-scan path; the cross-symbol
    // result order is irrelevant because each symbol is sorted locally here.
    return symbols.map((symbol) => ({
      symbol,
      bars: (barsBySymbol.get(symbol) ?? []).sort(
        (left, right) => left.time - right.time,
      ),
      timedOut: false,
    }));
  } catch (error) {
    // A statement timeout for a chunk must not fail the whole request; record
    // it in coverage metadata and continue with the rest.
    logger.warn(
      { error, symbolCount: symbols.length, timeframe },
      "signal-quality KPI bar load failed for symbol chunk",
    );
    return symbols.map((symbol) => ({ symbol, bars: [], timedOut: true }));
  }
}

async function loadBarsForSymbols(
  symbols: string[],
  timeframe: StrategySignalTimeframe,
  from: Date,
  deadlineMs: number,
): Promise<SymbolBars[]> {
  const chunks = chunkArray(symbols, BAR_FETCH_CHUNK_SIZE);
  const chunkResults: SymbolBars[][] = [];
  let cursor = 0;
  const timedOutChunk = (chunk: readonly string[]): SymbolBars[] =>
    chunk.map((symbol) => ({ symbol, bars: [], timedOut: true }));
  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      if (Date.now() >= deadlineMs) {
        chunkResults[index] = timedOutChunk(chunks[index]);
        continue;
      }
      chunkResults[index] = await loadSymbolBarsChunk(
        chunks[index],
        timeframe,
        from,
        MAX_BARS_PER_SYMBOL,
      );
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BAR_FETCH_CONCURRENCY, chunks.length) }, worker),
  );
  const bySymbol = new Map<string, SymbolBars>();
  chunkResults.flat().forEach((entry) => {
    bySymbol.set(entry.symbol, entry);
  });
  return symbols.map(
    (symbol) => bySymbol.get(symbol) ?? { symbol, bars: [], timedOut: false },
  );
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

type SignalScoreCalibrationReason =
  SignalQualityKpiResult["scoreModelComparisons"]["calibration"]["reasons"][number];
type SignalQualityCalibrationCoverageGate = {
  supported: boolean;
  reasons: SignalScoreCalibrationReason[];
  symbolCoverageRatio: number;
  timeoutRatio: number;
};
type SignalQualityCalibrationCoverageGateInput = Pick<
  SignalQualityCoverage,
  "evaluatedSymbolCount" | "symbolsWithBars" | "symbolsTimedOut"
>;

const COVERAGE_DEGRADED_REASON: SignalScoreCalibrationReason =
  "coverage_degraded";

function nonNegativeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function signalQualityCalibrationCoverageGate(
  input: SignalQualityCalibrationCoverageGateInput,
): SignalQualityCalibrationCoverageGate {
  const evaluatedSymbolCount = nonNegativeCount(input.evaluatedSymbolCount);
  if (evaluatedSymbolCount === 0) {
    return {
      supported: false,
      reasons: [COVERAGE_DEGRADED_REASON],
      symbolCoverageRatio: 0,
      timeoutRatio: 1,
    };
  }

  const symbolsWithBars = Math.min(
    evaluatedSymbolCount,
    nonNegativeCount(input.symbolsWithBars),
  );
  const symbolsTimedOut = Math.min(
    evaluatedSymbolCount,
    nonNegativeCount(input.symbolsTimedOut),
  );
  const symbolCoverageRatio = symbolsWithBars / evaluatedSymbolCount;
  const timeoutRatio = symbolsTimedOut / evaluatedSymbolCount;
  const supported =
    symbolCoverageRatio >= MIN_CALIBRATION_SYMBOL_COVERAGE_RATIO &&
    timeoutRatio <= MAX_CALIBRATION_SYMBOL_TIMEOUT_RATIO;

  return {
    supported,
    reasons: supported ? [] : [COVERAGE_DEGRADED_REASON],
    symbolCoverageRatio,
    timeoutRatio,
  };
}

function applySignalQualityCalibrationCoverageGate(
  kpis: SignalQualityKpiResult,
  gate: SignalQualityCalibrationCoverageGate,
): SignalQualityKpiResult {
  if (gate.supported) {
    return kpis;
  }

  const comparisons = kpis.scoreModelComparisons;
  const reasons = Array.from(
    new Set([
      ...gate.reasons,
      ...comparisons.calibration.reasons,
    ]),
  );
  return {
    ...kpis,
    scoreModelComparisons: {
      ...comparisons,
      recommendedModelKey: null,
      calibration: {
        ...comparisons.calibration,
        state:
          comparisons.observationCount > 0 ? "uncalibrated" : "needs_more_data",
        recommendedModelKey: null,
        supportedModelCount: 0,
        reasons,
      },
    },
  };
}

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

  const universe = normalizeSignalQualityUniverse(deployment.symbolUniverse);
  const symbols = selectSignalQualitySymbols(universe);
  const truncatedSymbolUniverse = universe.length > symbols.length;

  const requestedTimeframe = settings.signalTimeframe;
  const previewTimeframe = previewTimeframeFor(requestedTimeframe);
  const from = new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const barFetchDeadlineMs = Date.now() + BAR_FETCH_HARD_BUDGET_MS;

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
    loaded = symbols.length
      ? await loadBarsForSymbols(symbols, timeframe, from, barFetchDeadlineMs)
      : [];
    const latestBarAt = latestBarAtForLoadedBars(loaded);
    if (
      loaded.some((entry) => entry.bars.length > 0) &&
      signalQualityBarWindowFresh({ timeframe, latestBarAt, now })
    ) {
      break;
    }
    if (Date.now() >= barFetchDeadlineMs) {
      loaded = symbols.map((symbol) => ({
        symbol,
        bars: [],
        timedOut: true,
      }));
      break;
    }
    loaded = [];
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

  const coverage: SignalQualityCoverage = {
    requestedTimeframe,
    resolvedTimeframe,
    requestedWindowDays: ROLLING_WINDOW_DAYS,
    windowStart:
      windowStartMs == null ? null : new Date(windowStartMs).toISOString(),
    windowEnd: windowEndMs == null ? null : new Date(windowEndMs).toISOString(),
    requestedSymbolCount: universe.length,
    evaluatedSymbolCount: symbols.length,
    symbolsWithBars,
    symbolsTimedOut,
    barsPerSymbolCap: MAX_BARS_PER_SYMBOL,
    totalBars,
    truncatedSymbolUniverse,
    usedTimeframeFallback: resolvedTimeframe !== previewTimeframe,
  };
  const rawKpis = computeSignalQualityKpis({
    settings: toPyrusSettings(settings),
    barsBySymbol,
    horizonBars: settings.outcomeHorizonBars,
    mtf,
    sourceStrategy: deployment.strategyId,
    sourceProfile: deployment.mode,
    sourceTimeframe: resolvedTimeframe,
  });
  const kpis = applySignalQualityCalibrationCoverageGate(
    rawKpis,
    signalQualityCalibrationCoverageGate(coverage),
  );

  return {
    deploymentId,
    asOfDay: asOfDay(now),
    settings,
    mtf,
    kpis,
    coverage,
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
  const universe = selectSignalQualitySymbols(
    normalizeSignalQualityUniverse(deployment.symbolUniverse),
  );
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
  signalQualityBarWindowFresh,
  expectedSignalQualityLatestBarAt,
  signalQualityCalibrationCoverageGate,
  applySignalQualityCalibrationCoverageGate,
  selectSignalQualitySymbols,
  runQueuedKpiCompute,
  getKpiComputeQueueSnapshot: () => ({
    active: activeKpiComputes,
    queued: kpiComputeQueue.length,
    concurrency: KPI_COMPUTE_CONCURRENCY,
    barFetchConcurrency: BAR_FETCH_CONCURRENCY,
    barFetchHardBudgetMs: BAR_FETCH_HARD_BUDGET_MS,
  }),
};

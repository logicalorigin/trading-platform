// Per-deployment signal-quality KPI orchestration.
//
// Resolves the deployment's control-panel signal settings (draft override >
// saved config > profile defaults), loads a rolling stored-bar window for a
// bounded slice of the symbol universe, post-filters the backtested signals
// through the signal-options MTF-alignment gate, and computes the eight
// signal-quality KPIs (delegated to computeSignalQualityKpis). The normal GET
// route returns a materialized snapshot; explicit refresh/background work owns
// the expensive full-universe bar-cache sweep.
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
  algoDeploymentsTable,
  db,
  signalQualityKpiSnapshotsTable,
} from "@workspace/db";
import {
  resolvePreviousUsEquitySessionClose,
  resolveUsEquityMarketStatus,
} from "@workspace/market-calendar";
import { and, desc, eq, sql } from "drizzle-orm";
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
const BAR_FETCH_TIMEOUT_RETRY_CHUNK_SIZE = 5;
const BAR_FETCH_CONCURRENCY = 1;
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
const SNAPSHOT_METADATA_KEY = "__signalQualityKpiSnapshot";
const SNAPSHOT_FALLBACK_SCAN_LIMIT = 20;

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
  candidates: readonly unknown[],
  fallback: number,
  min: number,
  max: number,
): number {
  for (const candidate of candidates) {
    const parsed =
      typeof candidate === "number"
        ? candidate
        : typeof candidate === "string" && candidate.trim()
          ? Number(candidate)
          : Number.NaN;
    if (Number.isFinite(parsed)) {
      return Math.min(max, Math.max(min, parsed));
    }
  }
  return fallback;
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
  outcomeTimeframe?: unknown;
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
  // Measurement timeframe the KPI/calibration pipeline evaluates on. KPI-only:
  // it never feeds the live signal-monitor profile (whose timeframe the
  // strategy-settings PATCH updates alongside signalTimeframe), so changing it
  // re-anchors score calibration without touching what the deployment trades.
  // Defaults to signalTimeframe, keeping unset deployments byte-identical.
  outcomeTimeframe: StrategySignalTimeframe;
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
      [
        draft.timeHorizon,
        configMarketStructure.timeHorizon,
        parameters.timeHorizon,
        profileMarketStructure.timeHorizon,
        pyrusSignalsSettings.timeHorizon,
      ],
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
      [
        draft.outcomeHorizonBars,
        configMarketStructure.outcomeHorizonBars,
        parameters.outcomeHorizonBars,
        profileMarketStructure.outcomeHorizonBars,
        pyrusSignalsSettings.outcomeHorizonBars,
      ],
      timeHorizon,
      1,
      120,
    ),
  );

  // KPI-only measurement timeframe (same precedence chain as signalTimeframe;
  // falls back to signalTimeframe so unset deployments are unchanged).
  const outcomeTimeframe =
    timeframeFromValue(draft.outcomeTimeframe) ??
    timeframeFromValue(parameters.outcomeTimeframe) ??
    timeframeFromValue(pyrusSignalsSettings.outcomeTimeframe) ??
    signalTimeframe;

  return {
    signalTimeframe,
    timeHorizon,
    outcomeHorizonBars,
    outcomeTimeframe,
    bosConfirmation,
    chochAtrBuffer: boundedNumber(
      [
        draft.chochAtrBuffer,
        configMarketStructure.chochAtrBuffer,
        parameters.chochAtrBuffer,
        profileMarketStructure.chochAtrBuffer,
        pyrusSignalsSettings.chochAtrBuffer,
      ],
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochAtrBuffer,
      0,
      20,
    ),
    chochBodyExpansionAtr: boundedNumber(
      [
        draft.chochBodyExpansionAtr,
        configMarketStructure.chochBodyExpansionAtr,
        parameters.chochBodyExpansionAtr,
        profileMarketStructure.chochBodyExpansionAtr,
        pyrusSignalsSettings.chochBodyExpansionAtr,
      ],
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochBodyExpansionAtr,
      0,
      20,
    ),
    chochVolumeGate: boundedNumber(
      [
        draft.chochVolumeGate,
        configMarketStructure.chochVolumeGate,
        parameters.chochVolumeGate,
        profileMarketStructure.chochVolumeGate,
        pyrusSignalsSettings.chochVolumeGate,
      ],
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

function signalQualityUsedTimeframeFallback(
  requestedTimeframe: StrategySignalTimeframe,
  resolvedTimeframe: StrategySignalTimeframe,
): boolean {
  return resolvedTimeframe !== requestedTimeframe;
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

function isSignalQualityStrictLiveSession(now: Date): boolean {
  const status = resolveUsEquityMarketStatus(now);
  return status.session.key === "rth" && status.calendarDay?.tradingDay === true;
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
  if (isSignalQualityStrictLiveSession(input.now)) {
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

async function latestBarCacheStartsAtForTimeframe(
  timeframe: StrategySignalTimeframe,
): Promise<Date | null | undefined> {
  try {
    const result = await db.execute(sql`
      select starts_at
      from bar_cache
      where timeframe = ${timeframe}
        and source = ${BAR_CACHE_SOURCE}
      order by starts_at desc
      limit 1
    `);
    const row = result.rows[0] as { starts_at?: Date | string } | undefined;
    if (!row?.starts_at) {
      return null;
    }
    return row.starts_at instanceof Date
      ? row.starts_at
      : new Date(row.starts_at);
  } catch (error) {
    logger.warn(
      { error, timeframe },
      "signal-quality KPI latest bar preflight failed; loading timeframe",
    );
    return undefined;
  }
}

type SymbolBars = {
  symbol: string;
  bars: PyrusSignalsBar[];
  timedOut: boolean;
};

type LoadSymbolBarsOnce = (
  symbols: string[],
  timeframe: StrategySignalTimeframe,
  from: Date,
  limit: number,
) => Promise<SymbolBars[]>;

function timedOutSymbolBars(symbols: readonly string[]): SymbolBars[] {
  return symbols.map((symbol) => ({ symbol, bars: [], timedOut: true }));
}

function isStatementTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const maybeError = current as {
      cause?: unknown;
      code?: unknown;
      message?: unknown;
    };
    if (maybeError.code === "57014") {
      return true;
    }
    if (
      String(maybeError.message ?? "")
        .toLowerCase()
        .includes("statement timeout")
    ) {
      return true;
    }
    current = maybeError.cause;
  }
  return false;
}

function shouldRetryBarLoadChunk(
  error: unknown,
  symbolCount: number,
): boolean {
  return (
    symbolCount > BAR_FETCH_TIMEOUT_RETRY_CHUNK_SIZE &&
    isStatementTimeoutError(error)
  );
}

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
async function loadSymbolBarsChunkOnce(
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
}

async function loadSymbolBarsChunk(
  symbols: string[],
  timeframe: StrategySignalTimeframe,
  from: Date,
  limit: number,
  deadlineMs = Number.POSITIVE_INFINITY,
  loadOnce: LoadSymbolBarsOnce = loadSymbolBarsChunkOnce,
): Promise<SymbolBars[]> {
  if (!symbols.length) {
    return [];
  }
  try {
    return await loadOnce(symbols, timeframe, from, limit);
  } catch (error) {
    if (shouldRetryBarLoadChunk(error, symbols.length) && Date.now() < deadlineMs) {
      logger.warn(
        {
          error,
          symbolCount: symbols.length,
          retryChunkSize: BAR_FETCH_TIMEOUT_RETRY_CHUNK_SIZE,
          timeframe,
        },
        "signal-quality KPI bar load timed out; retrying smaller symbol chunks",
      );
      const retryChunks = chunkArray(
        symbols,
        BAR_FETCH_TIMEOUT_RETRY_CHUNK_SIZE,
      );
      const retryResults: SymbolBars[][] = [];
      // Keep retries sequential so a timeout recovery does not increase DB fanout.
      for (const chunk of retryChunks) {
        if (Date.now() >= deadlineMs) {
          retryResults.push(timedOutSymbolBars(chunk));
          continue;
        }
        try {
          retryResults.push(await loadOnce(chunk, timeframe, from, limit));
        } catch (retryError) {
          logger.warn(
            { error: retryError, symbolCount: chunk.length, timeframe },
            "signal-quality KPI bar load failed for retry symbol chunk",
          );
          retryResults.push(timedOutSymbolBars(chunk));
        }
      }
      return retryResults.flat();
    }

    // A chunk failure must not fail the whole request; record it in coverage
    // metadata and continue with the rest.
    logger.warn(
      { error, symbolCount: symbols.length, timeframe },
      "signal-quality KPI bar load failed for symbol chunk",
    );
    return timedOutSymbolBars(symbols);
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
  async function worker() {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      if (Date.now() >= deadlineMs) {
        chunkResults[index] = timedOutSymbolBars(chunks[index]);
        continue;
      }
      chunkResults[index] = await loadSymbolBarsChunk(
        chunks[index],
        timeframe,
        from,
        MAX_BARS_PER_SYMBOL,
        deadlineMs,
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

function errorHasPostgresCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const maybeError = current as { cause?: unknown; code?: unknown };
    if (maybeError.code === code) {
      return true;
    }
    current = maybeError.cause;
  }
  return false;
}

function nonDraftSnapshotCondition() {
  return sql`
    coalesce(
      ${signalQualityKpiSnapshotsTable.response}
        -> ${SNAPSHOT_METADATA_KEY} ->> 'draft',
      'false'
    ) <> 'true'
  `;
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

  const requestedTimeframe = settings.outcomeTimeframe;
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
    const latestPreflightBarAt =
      await latestBarCacheStartsAtForTimeframe(timeframe);
    if (
      latestPreflightBarAt !== undefined &&
      !signalQualityBarWindowFresh({
        timeframe,
        latestBarAt: latestPreflightBarAt,
        now,
      })
    ) {
      logger.info(
        {
          timeframe,
          latestBarAt: latestPreflightBarAt?.toISOString() ?? null,
          requestedTimeframe,
        },
        "signal-quality KPI skipping stale bar-cache timeframe",
      );
      continue;
    }
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
    usedTimeframeFallback: signalQualityUsedTimeframeFallback(
      requestedTimeframe,
      resolvedTimeframe,
    ),
  };
  // Env-gated raw-observation dump for offline score-model calibration/audit
  // tooling (JSONL, one observation per line, settings header per batch). The
  // pure KPI module exposes only the callback; this layer owns the IO.
  const observationDumpPath = process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
  const rawKpis = computeSignalQualityKpis({
    settings: toPyrusSettings(settings),
    barsBySymbol,
    horizonBars: settings.outcomeHorizonBars,
    mtf,
    sourceStrategy: deployment.strategyId,
    sourceProfile: deployment.mode,
    sourceTimeframe: resolvedTimeframe,
    onObservations: observationDumpPath
      ? (observations) => {
          appendFileSync(
            observationDumpPath,
            [
              JSON.stringify({
                header: true,
                resolvedTimeframe,
                outcomeHorizonBars: settings.outcomeHorizonBars,
                count: observations.length,
              }),
              ...observations.map((observation) => JSON.stringify(observation)),
            ].join("\n") + "\n",
          );
        }
      : undefined,
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

let computeSignalQualityResponse = computeResponse;

function buildEmptyKpiMetrics() {
  return {
    signalCount: 0,
    avgDirectionalMovePercent: 0,
    correctnessPercent: 0,
    expectancyPercent: 0,
    payoffRatio: 0,
    avgMfePercent: 0,
    avgMaePercent: 0,
    consistencyStdDevPercent: 0,
  };
}

function buildSnapshotPendingKpis(
  horizonBars: number,
): SignalQualityKpiResult {
  const emptyMetrics = buildEmptyKpiMetrics();
  return {
    ...emptyMetrics,
    horizonBars,
    mtfFilteredOutCount: 0,
    perSymbol: [],
    byDirection: {
      buy: buildEmptyKpiMetrics(),
      sell: buildEmptyKpiMetrics(),
    },
    byScoreRange: {},
    scoreBuckets: [],
    scoreRangeBuckets: [],
    featureSummaries: [],
    scoreModelComparisons: {
      observationCount: 0,
      modelKeys: [],
      recommendedModelKey: null,
      calibration: {
        state: "needs_more_data",
        recommendedModelKey: null,
        candidateModelKey: null,
        supportedModelCount: 0,
        reasons: ["min_observation_count"],
      },
      models: [],
    },
  };
}

function buildSnapshotPendingResponse(input: {
  deploymentId: string;
  now: Date;
  settings: ResolvedStrategySignalSettings;
  mtf: SignalQualityMtfConfig;
  universe: readonly string[];
  symbols: readonly string[];
}): SignalQualityKpiResponse {
  const previewTimeframe = previewTimeframeFor(input.settings.outcomeTimeframe);
  return {
    deploymentId: input.deploymentId,
    asOfDay: asOfDay(input.now),
    settings: input.settings,
    mtf: input.mtf,
    kpis: buildSnapshotPendingKpis(input.settings.outcomeHorizonBars),
    coverage: {
      requestedTimeframe: input.settings.outcomeTimeframe,
      resolvedTimeframe: previewTimeframe,
      requestedWindowDays: ROLLING_WINDOW_DAYS,
      windowStart: null,
      windowEnd: null,
      requestedSymbolCount: input.universe.length,
      evaluatedSymbolCount: input.symbols.length,
      symbolsWithBars: 0,
      symbolsTimedOut: 0,
      barsPerSymbolCap: MAX_BARS_PER_SYMBOL,
      totalBars: 0,
      truncatedSymbolUniverse: input.universe.length > input.symbols.length,
      usedTimeframeFallback: signalQualityUsedTimeframeFallback(
        input.settings.outcomeTimeframe,
        previewTimeframe,
      ),
    },
    generatedAt: input.now.toISOString(),
  };
}

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

type ResolvedSignalQualityRequest = {
  deploymentId: string;
  draft: SignalQualityDraftOverride | undefined;
  now: Date;
  deployment: DeploymentSignalQualityContext["deployment"];
  profile: DeploymentSignalQualityContext["profile"];
  settings: ResolvedStrategySignalSettings;
  mtf: SignalQualityMtfConfig;
  universe: string[];
  symbols: string[];
  settingsHash: string;
  day: string;
  key: string;
};

async function resolveSignalQualityRequest(input: {
  deploymentId: string;
  draft?: SignalQualityDraftOverride;
  now?: Date;
}): Promise<ResolvedSignalQualityRequest> {
  const deploymentId = String(input.deploymentId ?? "").trim();
  if (!deploymentId) {
    throw new HttpError(400, "Missing deploymentId.", {
      code: "invalid_request",
    });
  }

  const now = input.now ?? new Date();
  const { deployment, profile } = await resolveDeploymentContext(deploymentId);
  const settings = resolveDeploymentSignalSettings({
    deploymentConfig: deployment.config,
    profilePyrusSignalsSettings: profile.pyrusSignalsSettings,
    profileTimeframe: profile.timeframe,
    draft: input.draft,
  });
  const mtf = resolveMtfConfig(deployment.config);
  const universe = normalizeSignalQualityUniverse(deployment.symbolUniverse);
  const symbols = selectSignalQualitySymbols(universe);
  const hash = settingsHash(settings, mtf, symbols);
  const day = asOfDay(now);
  return {
    deploymentId,
    draft: input.draft,
    now,
    deployment,
    profile,
    settings,
    mtf,
    universe,
    symbols,
    settingsHash: hash,
    day,
    key: cacheKey(deploymentId, hash, day),
  };
}

function signalQualityKpiResponseFromSnapshot(
  value: unknown,
): SignalQualityKpiResponse | null {
  const record = asRecord(value);
  if (
    typeof record.deploymentId !== "string" ||
    typeof record.asOfDay !== "string" ||
    typeof record.generatedAt !== "string" ||
    !record.settings ||
    !record.mtf ||
    !record.kpis ||
    !record.coverage
  ) {
    return null;
  }
  const response = { ...record };
  delete response[SNAPSHOT_METADATA_KEY];
  return response as unknown as SignalQualityKpiResponse;
}

function signalQualityKpiSnapshotHasMetadata(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(
    asRecord(value),
    SNAPSHOT_METADATA_KEY,
  );
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function snapshotMatchesResolvedRequest(
  response: SignalQualityKpiResponse,
  request: ResolvedSignalQualityRequest,
): boolean {
  return (
    response.settings.signalTimeframe === request.settings.signalTimeframe &&
    response.settings.timeHorizon === request.settings.timeHorizon &&
    response.settings.outcomeHorizonBars === request.settings.outcomeHorizonBars &&
    response.settings.outcomeTimeframe === request.settings.outcomeTimeframe &&
    response.settings.bosConfirmation === request.settings.bosConfirmation &&
    response.settings.chochAtrBuffer === request.settings.chochAtrBuffer &&
    response.settings.chochBodyExpansionAtr ===
      request.settings.chochBodyExpansionAtr &&
    response.settings.chochVolumeGate === request.settings.chochVolumeGate &&
    response.mtf.enabled === request.mtf.enabled &&
    response.mtf.requiredCount === request.mtf.requiredCount &&
    sameStringArray(response.mtf.timeframes, request.mtf.timeframes)
  );
}

function signalQualityKpiResponseFromFallbackSnapshot(
  value: unknown,
  request: ResolvedSignalQualityRequest,
): SignalQualityKpiResponse | null {
  const hasMetadata = signalQualityKpiSnapshotHasMetadata(value);
  const response = signalQualityKpiResponseFromSnapshot(value);
  if (!response) {
    return null;
  }
  if (
    !hasMetadata &&
    request.settings &&
    request.mtf &&
    !snapshotMatchesResolvedRequest(response, request)
  ) {
    return null;
  }
  return response;
}

function firstSignalQualityKpiFallbackSnapshot(
  snapshots: { response: unknown }[],
  request: ResolvedSignalQualityRequest,
): SignalQualityKpiResponse | null {
  for (const snapshot of snapshots) {
    const response = signalQualityKpiResponseFromFallbackSnapshot(
      snapshot.response,
      request,
    );
    if (response) {
      return response;
    }
  }
  return null;
}

async function readSignalQualityKpiSnapshot(
  request: ResolvedSignalQualityRequest,
): Promise<SignalQualityKpiResponse | null> {
  try {
    const [snapshot] = await db
      .select({ response: signalQualityKpiSnapshotsTable.response })
      .from(signalQualityKpiSnapshotsTable)
      .where(
        and(
          eq(signalQualityKpiSnapshotsTable.deploymentId, request.deploymentId),
          eq(signalQualityKpiSnapshotsTable.settingsHash, request.settingsHash),
          eq(signalQualityKpiSnapshotsTable.asOfDay, request.day),
        ),
      )
      .limit(1);
    const exact = signalQualityKpiResponseFromSnapshot(snapshot?.response);
    if (exact || request.draft) {
      return exact;
    }

    const latestSameDay = await db
      .select({ response: signalQualityKpiSnapshotsTable.response })
      .from(signalQualityKpiSnapshotsTable)
      .where(
        and(
          eq(signalQualityKpiSnapshotsTable.deploymentId, request.deploymentId),
          eq(signalQualityKpiSnapshotsTable.asOfDay, request.day),
          nonDraftSnapshotCondition(),
        ),
      )
      .orderBy(desc(signalQualityKpiSnapshotsTable.generatedAt))
      .limit(SNAPSHOT_FALLBACK_SCAN_LIMIT);
    const sameDay = firstSignalQualityKpiFallbackSnapshot(
      latestSameDay,
      request,
    );
    if (sameDay) {
      return sameDay;
    }

    const latestDeploymentSnapshots = await db
      .select({ response: signalQualityKpiSnapshotsTable.response })
      .from(signalQualityKpiSnapshotsTable)
      .where(
        and(
          eq(signalQualityKpiSnapshotsTable.deploymentId, request.deploymentId),
          nonDraftSnapshotCondition(),
        ),
      )
      .orderBy(desc(signalQualityKpiSnapshotsTable.generatedAt))
      .limit(SNAPSHOT_FALLBACK_SCAN_LIMIT);
    return firstSignalQualityKpiFallbackSnapshot(
      latestDeploymentSnapshots,
      request,
    );
  } catch (error) {
    if (errorHasPostgresCode(error, "42P01")) {
      logger.warn(
        { error },
        "signal-quality KPI snapshot table missing; returning pending response",
      );
      return null;
    }
    throw error;
  }
}

function dateOrNow(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function writeSignalQualityKpiSnapshot(
  request: ResolvedSignalQualityRequest,
  response: SignalQualityKpiResponse,
): Promise<void> {
  const calibration = response.kpis.scoreModelComparisons.calibration;
  const snapshotResponse = {
    ...(response as unknown as Record<string, unknown>),
    [SNAPSHOT_METADATA_KEY]: {
      draft: request.draft !== undefined,
    },
  };
  const row = {
    deploymentId: request.deploymentId,
    settingsHash: request.settingsHash,
    asOfDay: request.day,
    generatedAt: dateOrNow(response.generatedAt),
    resolvedTimeframe: response.coverage.resolvedTimeframe,
    calibrationState: calibration.state,
    recommendedModelKey: calibration.recommendedModelKey,
    evaluatedSymbolCount: response.coverage.evaluatedSymbolCount,
    symbolsWithBars: response.coverage.symbolsWithBars,
    symbolsTimedOut: response.coverage.symbolsTimedOut,
    response: snapshotResponse,
    updatedAt: new Date(),
  };
  await db
    .insert(signalQualityKpiSnapshotsTable)
    .values(row)
    .onConflictDoUpdate({
      target: [
        signalQualityKpiSnapshotsTable.deploymentId,
        signalQualityKpiSnapshotsTable.settingsHash,
        signalQualityKpiSnapshotsTable.asOfDay,
      ],
      set: {
        generatedAt: row.generatedAt,
        resolvedTimeframe: row.resolvedTimeframe,
        calibrationState: row.calibrationState,
        recommendedModelKey: row.recommendedModelKey,
        evaluatedSymbolCount: row.evaluatedSymbolCount,
        symbolsWithBars: row.symbolsWithBars,
        symbolsTimedOut: row.symbolsTimedOut,
        response: row.response,
        updatedAt: row.updatedAt,
      },
    });
}

export async function getDeploymentSignalQualityKpis(input: {
  deploymentId: string;
  draft?: SignalQualityDraftOverride;
}): Promise<SignalQualityKpiResponse> {
  const request = await resolveSignalQualityRequest(input);
  const snapshot = await readSignalQualityKpiSnapshot(request);
  if (snapshot) {
    return snapshot;
  }
  return buildSnapshotPendingResponse({
    deploymentId: request.deploymentId,
    now: request.now,
    settings: request.settings,
    mtf: request.mtf,
    universe: request.universe,
    symbols: request.symbols,
  });
}

export async function refreshDeploymentSignalQualityKpiSnapshot(input: {
  deploymentId: string;
  draft?: SignalQualityDraftOverride;
}): Promise<SignalQualityKpiResponse> {
  const request = await resolveSignalQualityRequest(input);
  // In-flight dedupe: concurrent callers for the same key share one computation.
  const existing = inFlight.get(request.key);
  if (existing) {
    return existing;
  }

  const work = runQueuedKpiCompute(() =>
    computeSignalQualityResponse(request.deploymentId, request.draft, request.now, {
      deployment: request.deployment,
      profile: request.profile,
    }),
  )
    .then(async (response) => {
      await writeSignalQualityKpiSnapshot(request, response);
      return response;
    })
    .finally(() => {
      inFlight.delete(request.key);
    });
  inFlight.set(request.key, work);

  return work;
}

export const __signalQualityKpisServiceInternalsForTests = {
  resolveDeploymentSignalSettings,
  resolveMtfConfig,
  previewTimeframeFor,
  signalQualityUsedTimeframeFallback,
  signalQualityBarWindowFresh,
  expectedSignalQualityLatestBarAt,
  signalQualityCalibrationCoverageGate,
  applySignalQualityCalibrationCoverageGate,
  selectSignalQualitySymbols,
  isStatementTimeoutError,
  shouldRetryBarLoadChunk,
  loadSymbolBarsChunk,
  buildSnapshotPendingResponse,
  readSignalQualityKpiSnapshot,
  writeSignalQualityKpiSnapshot,
  __setComputeResponseForTests: (
    next: typeof computeSignalQualityResponse,
  ): (() => void) => {
    const previous = computeSignalQualityResponse;
    computeSignalQualityResponse = next;
    return () => {
      computeSignalQualityResponse = previous;
    };
  },
  runQueuedKpiCompute,
  getKpiComputeQueueSnapshot: () => ({
    active: activeKpiComputes,
    queued: kpiComputeQueue.length,
    concurrency: KPI_COMPUTE_CONCURRENCY,
    barFetchConcurrency: BAR_FETCH_CONCURRENCY,
    barFetchHardBudgetMs: BAR_FETCH_HARD_BUDGET_MS,
  }),
};

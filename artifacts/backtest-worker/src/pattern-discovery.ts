// MTF pattern-discovery engine (pure logic; the worker supplies I/O).
//
// A "pattern" is the per-timeframe signal-direction vector at a point in time,
// e.g. "1m:sell|2m:sell|5m:sell|15m:buy". We observe patterns in history and
// score each by the UNDERLYING's forward return over N bars, aggregated across
// all occurrences, then rank. This is a statistical study, not a position
// backtest. Occurrences are sampled at pattern TRANSITIONS (formation), which is
// both meaningful ("enter when the pattern forms") and sparse enough that the
// reused forward-return scorer stays efficient.
import {
  type BacktestBar,
  buildSignalForwardReturnDataset,
  type SignalForwardReturnSignal,
} from "@workspace/backtest-core";
import {
  evaluatePyrusSignalsSignals,
  type PyrusSignalsBar,
  type PyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";

export type PatternDirection = "buy" | "sell" | "none";

export type PatternDiscoveryConfig = {
  symbols: string[];
  timeframeSet: string[];
  baseTimeframe: string;
  forwardHorizonsBars: number[];
  minSampleThreshold: number;
  // Per-timeframe PyrusSignals settings overrides (from the calibration step);
  // missing keys fall back to DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.
  signalSettingsByTimeframe?: Record<string, Partial<PyrusSignalsSignalSettings>>;
  persistOccurrences?: boolean;
};

// Per-timeframe PyrusSignals settings (overrides vs DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS),
// seeded from the per-TF calibration: bar-count windows shrink as the interval grows
// (a fixed bar count is a longer wall-clock lookback on higher TFs), ATR-relative
// thresholds self-scale, and bosConfirmation goes close-to-wicks on slower TFs. atrLength
// stays at the default (ATR self-scales). These are starting points; the calibration
// sweep refines them empirically. A study's signalSettingsByTimeframe overrides these.
export const DEFAULT_SIGNAL_SETTINGS_BY_TIMEFRAME: Record<
  string,
  Partial<PyrusSignalsSignalSettings>
> = {
  "1m": { basisLength: 100, atrSmoothing: 30, timeHorizon: 12, volatilityMultiplier: 2.5, shadowLength: 30, chochAtrBuffer: 0.25, bosConfirmation: "close" },
  "2m": { basisLength: 90, atrSmoothing: 25, timeHorizon: 10, volatilityMultiplier: 2.25, shadowLength: 25, chochAtrBuffer: 0.2, bosConfirmation: "close" },
  "5m": { basisLength: 80, atrSmoothing: 21, timeHorizon: 8, volatilityMultiplier: 2.0, shadowLength: 20, chochAtrBuffer: 0.15, bosConfirmation: "wicks" },
  "15m": { basisLength: 60, atrSmoothing: 18, timeHorizon: 8, volatilityMultiplier: 2.0, shadowLength: 20, chochAtrBuffer: 0.1, bosConfirmation: "wicks" },
  "1h": { basisLength: 50, atrSmoothing: 14, timeHorizon: 6, volatilityMultiplier: 1.75, shadowLength: 20, chochAtrBuffer: 0, bosConfirmation: "wicks" },
  "1d": { basisLength: 30, atrSmoothing: 10, timeHorizon: 5, volatilityMultiplier: 1.5, shadowLength: 20, chochAtrBuffer: 0, bosConfirmation: "wicks" },
};

// Calendar-day warmup buffer loaded BEFORE the study window so signal indicators are
// stable at the window start (~1000+ bars needed; the worker does not otherwise enforce
// warmup - the #1 silent-overfit risk per the calibration analysis). Scaled by bars/day.
const WARMUP_DAYS_BY_TIMEFRAME: Record<string, number> = {
  "1m": 7,
  "2m": 10,
  "5m": 20,
  "15m": 50,
  "1h": 200,
  "1d": 1100,
};
export function warmupDaysForTimeframe(timeframe: string): number {
  return WARMUP_DAYS_BY_TIMEFRAME[timeframe] ?? 30;
}

export type DirectionEvent = { timeMs: number; direction: PatternDirection };

export type PatternOccurrence = {
  symbol: string;
  occurredAt: Date;
  patternKey: string;
};

export type PatternResultRow = {
  patternKey: string;
  horizonBars: number;
  sampleCount: number;
  bias: "long" | "short" | "neutral";
  winRatePct: number | null;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  stdReturnPct: number | null;
  avgMaePct: number | null;
  avgMfePct: number | null;
  score: number | null;
  tStat: number | null;
  rank: number;
};

export type PatternOccurrenceRow = {
  symbol: string;
  occurredAt: Date;
  patternKey: string;
  horizonBars: number;
  realizedReturnPct: number | null;
  maePct: number | null;
  mfePct: number | null;
};

// Map a stored OHLCV bar into the signal evaluator's bar shape (seconds epoch).
export function toPyrusSignalsBar(bar: BacktestBar): PyrusSignalsBar {
  return {
    time: Math.floor(bar.startsAt.getTime() / 1000),
    o: bar.open,
    h: bar.high,
    l: bar.low,
    c: bar.close,
    v: bar.volume,
  };
}

// Ordered direction events for one timeframe from its native bars.
// includeProvisionalSignals=false -> completed-bar signals only (no lookahead).
export function computeDirectionEvents(
  bars: BacktestBar[],
  settings: PyrusSignalsSignalSettings,
): DirectionEvent[] {
  if (bars.length === 0) return [];
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: bars.map(toPyrusSignalsBar),
    settings,
    includeProvisionalSignals: false,
  });
  return evaluation.signalEvents.map((event) => ({
    timeMs: event.time * 1000,
    direction: event.direction === "long" ? "buy" : "sell",
  }));
}

// Forward-fill reader: the direction state at time t is the latest event with
// time <= t, else "none". Uses a monotonic cursor, so call with non-decreasing t.
export function directionStateReader(
  events: DirectionEvent[],
): (tMs: number) => PatternDirection {
  let cursor = 0;
  let state: PatternDirection = "none";
  return (tMs: number) => {
    while (cursor < events.length && events[cursor].timeMs <= tMs) {
      state = events[cursor].direction;
      cursor += 1;
    }
    return state;
  };
}

// Canonical pattern key over the fixed timeframe set.
export function patternKeyOf(
  timeframeSet: string[],
  directions: PatternDirection[],
): string {
  return timeframeSet.map((tf, index) => `${tf}:${directions[index]}`).join("|");
}

// Emit an occurrence at each base-bar where the pattern vector CHANGES from the
// previous base bar (pattern formation). Each TF's direction is forward-filled to
// the base bar's start time.
export function sampleTransitions(input: {
  symbol: string;
  timeframeSet: string[];
  baseBars: BacktestBar[];
  eventsByTimeframe: Record<string, DirectionEvent[]>;
}): PatternOccurrence[] {
  const readers = input.timeframeSet.map((tf) =>
    directionStateReader(input.eventsByTimeframe[tf] ?? []),
  );
  const occurrences: PatternOccurrence[] = [];
  let prevKey: string | null = null;
  for (const bar of input.baseBars) {
    const tMs = bar.startsAt.getTime();
    const directions = readers.map((read) => read(tMs));
    const key = patternKeyOf(input.timeframeSet, directions);
    if (key !== prevKey) {
      occurrences.push({
        symbol: input.symbol,
        occurredAt: bar.startsAt,
        patternKey: key,
      });
      prevKey = key;
    }
  }
  return occurrences;
}

const round6 = (value: number): number | null =>
  Number.isFinite(value) ? Number(value.toFixed(6)) : null;
const PATTERN_HORIZON_KEY_SEPARATOR = "\u0000";
const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
const stddev = (values: number[], mean: number): number => {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};
const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

// Score every observed pattern by underlying forward return, aggregated per
// (patternKey, horizon). Direction "long" makes realizedReturnPercent the raw
// signed underlying move; goodness/bias is decided here from the sign.
export function scorePatterns(input: {
  occurrences: PatternOccurrence[];
  barsBySymbol: Record<string, BacktestBar[]>;
  baseTimeframe: string;
  horizonsBars: number[];
  minSampleThreshold: number;
}): { results: PatternResultRow[]; occurrenceRows: PatternOccurrenceRow[] } {
  const signals: SignalForwardReturnSignal[] = input.occurrences.map(
    (occ, index) => ({
      signalId: `${occ.symbol}:${occ.occurredAt.getTime()}:${index}`,
      signalAt: occ.occurredAt,
      symbol: occ.symbol,
      direction: "long",
      score: 1,
      sourceStrategy: "mtf_pattern",
      sourceProfile: "mtf_pattern",
      sourceTimeframe: input.baseTimeframe,
    }),
  );
  const dataset = buildSignalForwardReturnDataset({
    signals,
    barsBySymbol: input.barsBySymbol,
    horizonsBars: input.horizonsBars,
  });

  type Acc = { returns: number[]; maes: number[]; mfes: number[] };
  const accByKey = new Map<string, Acc>();
  const occurrenceRows: PatternOccurrenceRow[] = [];
  dataset.rows.forEach((row, index) => {
    const occ = input.occurrences[index];
    if (!occ) return;
    for (const window of row.windows) {
      if (window.status !== "complete" || window.realizedReturnPercent == null) {
        continue;
      }
      const key = `${occ.patternKey}${PATTERN_HORIZON_KEY_SEPARATOR}${window.horizonBars}`;
      let acc = accByKey.get(key);
      if (!acc) {
        acc = { returns: [], maes: [], mfes: [] };
        accByKey.set(key, acc);
      }
      acc.returns.push(window.realizedReturnPercent);
      if (window.maxAdverseExcursionPercent != null) {
        acc.maes.push(window.maxAdverseExcursionPercent);
      }
      if (window.maxFavorableExcursionPercent != null) {
        acc.mfes.push(window.maxFavorableExcursionPercent);
      }
      occurrenceRows.push({
        symbol: occ.symbol,
        occurredAt: occ.occurredAt,
        patternKey: occ.patternKey,
        horizonBars: window.horizonBars,
        realizedReturnPct: window.realizedReturnPercent,
        maePct: window.maxAdverseExcursionPercent,
        mfePct: window.maxFavorableExcursionPercent,
      });
    }
  });

  const results: PatternResultRow[] = [];
  for (const [key, acc] of accByKey) {
    const n = acc.returns.length;
    if (n < input.minSampleThreshold) continue;
    const [patternKey, horizonPart] = key.split(PATTERN_HORIZON_KEY_SEPARATOR);
    const horizonBars = Number(horizonPart);
    const mean = average(acc.returns);
    const std = stddev(acc.returns, mean);
    const winRate = (acc.returns.filter((r) => r > 0).length / n) * 100;
    const score = std > 1e-9 ? mean / std : 0;
    const tStat = std > 1e-9 ? mean / (std / Math.sqrt(n)) : 0;
    results.push({
      patternKey,
      horizonBars,
      sampleCount: n,
      bias: mean > 0.0001 ? "long" : mean < -0.0001 ? "short" : "neutral",
      winRatePct: round6(winRate),
      meanReturnPct: round6(mean),
      medianReturnPct: round6(median(acc.returns)),
      stdReturnPct: round6(std),
      avgMaePct: round6(average(acc.maes)),
      avgMfePct: round6(average(acc.mfes)),
      score: round6(score),
      tStat: round6(tStat),
      rank: 0,
    });
  }

  // Rank within each horizon by predictive STRENGTH (|t-stat|, both directions),
  // tie-broken by sample count - penalizes lucky tiny-sample patterns.
  const byHorizon = new Map<number, PatternResultRow[]>();
  for (const row of results) {
    const list = byHorizon.get(row.horizonBars) ?? [];
    list.push(row);
    byHorizon.set(row.horizonBars, list);
  }
  for (const list of byHorizon.values()) {
    list.sort(
      (a, b) =>
        Math.abs(b.tStat ?? 0) - Math.abs(a.tStat ?? 0) ||
        b.sampleCount - a.sampleCount,
    );
    list.forEach((row, index) => {
      row.rank = index + 1;
    });
  }

  return { results, occurrenceRows };
}

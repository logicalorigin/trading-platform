// Pure signal-quality KPI computation for an algo deployment.
//
// Chains the Pyrus Signals evaluator -> backtest-core forward-return dataset ->
// an aggregate of eight signal-INDICATOR quality metrics (not trading P&L), plus
// a per-symbol breakdown. Kept side-effect free so it can be unit-tested against
// hand-computed fixtures; the route layer owns bar loading, settings resolution,
// and caching.
import {
  aggregatePyrusSignalsBarsForTimeframe,
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsTrendDirection,
  type PyrusSignalsBar,
  type PyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";
import {
  buildSignalForwardReturnDataset,
  type SignalForwardReturnSignal,
} from "@workspace/backtest-core";
import type { BacktestBar } from "@workspace/backtest-core";

export type SignalQualityKpiMetrics = {
  // Eight headline KPIs (all percentages are in percentage points, e.g. 0.42 = 0.42%).
  signalCount: number;
  avgDirectionalMovePercent: number;
  correctnessPercent: number;
  expectancyPercent: number;
  payoffRatio: number;
  avgMfePercent: number;
  avgMaePercent: number;
  consistencyStdDevPercent: number;
};

export type SignalQualitySymbolBreakdown = SignalQualityKpiMetrics & {
  symbol: string;
};

// The same eight metrics computed over only the buy (long) and only the sell
// (short) observations. realizedReturnPercent / MFE / MAE are already signed in
// the signal's direction by buildSignalForwardReturnDataset, so each side is a
// clean partition through the identical aggregation -- no direction-specific math.
export type SignalQualityDirectionalBreakdown = {
  buy: SignalQualityKpiMetrics;
  sell: SignalQualityKpiMetrics;
};

export type SignalQualityKpiResult = SignalQualityKpiMetrics & {
  horizonBars: number;
  mtfFilteredOutCount: number;
  perSymbol: SignalQualitySymbolBreakdown[];
  byDirection: SignalQualityDirectionalBreakdown;
};

// Mirrors the signal-options MTF-alignment confluence gate
// (evaluateSignalOptionsEntryGate in signal-options-automation.ts): a candidate
// is admitted when at least `requiredCount` of the configured timeframes carry a
// trend direction matching the signal direction. When the gate is disabled,
// every signal passes. requiredCount is clamped to [1, frameCount].
export type SignalQualityMtfConfig = {
  enabled: boolean;
  requiredCount: number;
  timeframes: string[];
};

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Population standard deviation (matches "stddev of the per-signal realized
// return %"). Returns 0 for fewer than two samples.
function populationStdDev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// One realized observation per signal at the requested horizon.
type SignalObservation = {
  symbol: string;
  direction: "long" | "short";
  realizedReturnPercent: number;
  mfePercent: number;
  maePercent: number;
};

function aggregateObservations(
  observations: SignalObservation[],
): SignalQualityKpiMetrics {
  const signalCount = observations.length;
  if (!signalCount) {
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

  const returns = observations.map((item) => item.realizedReturnPercent);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value <= 0);
  const hitRate = wins.length / signalCount;
  const missRate = losses.length / signalCount;
  // avgWin / avgLoss are magnitudes (avgLoss is the mean of |loss|).
  const avgWin = wins.length ? mean(wins) : 0;
  const avgLoss = losses.length ? Math.abs(mean(losses)) : 0;

  return {
    signalCount,
    avgDirectionalMovePercent: roundTo(mean(returns), 6),
    correctnessPercent: roundTo(hitRate * 100, 6),
    expectancyPercent: roundTo(hitRate * avgWin - missRate * avgLoss, 6),
    payoffRatio: avgLoss > 0 ? roundTo(avgWin / avgLoss, 6) : 0,
    avgMfePercent: roundTo(mean(observations.map((item) => item.mfePercent)), 6),
    avgMaePercent: roundTo(mean(observations.map((item) => item.maePercent)), 6),
    consistencyStdDevPercent: roundTo(populationStdDev(returns), 6),
  };
}

function pyrusBarsToBacktestBars(bars: PyrusSignalsBar[]): BacktestBar[] {
  return bars.map((bar) => ({
    startsAt: new Date(bar.time * 1000),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }));
}

// Point-in-time trend direction per configured MTF timeframe, computed from the
// signal symbol's own bars up to and including the signal bar (the same
// higher-timeframe trend resolution the Pyrus filter state uses). +1 / -1.
function mtfDirectionsAtBar(
  bars: PyrusSignalsBar[],
  signalBarIndex: number,
  timeframes: string[],
  basisLength: number,
): number[] {
  const window = bars.slice(0, signalBarIndex + 1);
  return timeframes.map((timeframe) =>
    resolvePyrusSignalsTrendDirection(
      aggregatePyrusSignalsBarsForTimeframe(window, timeframe),
      basisLength,
    ),
  );
}

function passesMtfGate(
  mtfDirections: number[],
  directionSign: number,
  mtf: SignalQualityMtfConfig,
): boolean {
  if (!mtf.enabled || !mtfDirections.length) {
    return true;
  }
  const frameCount = Math.max(1, mtfDirections.length);
  const requiredCount = Math.min(
    frameCount,
    Math.max(1, Math.round(mtf.requiredCount)),
  );
  const matches = mtfDirections.filter(
    (direction) => direction === directionSign,
  ).length;
  return matches >= requiredCount;
}

export type ComputeSignalQualityKpisInput = {
  settings: PyrusSignalsSignalSettings;
  // Stored bars per symbol, ascending by time, already in PyrusSignalsBar shape.
  barsBySymbol: Record<string, PyrusSignalsBar[]>;
  horizonBars: number;
  mtf: SignalQualityMtfConfig;
  // Identifiers carried through to the forward-return dataset rows.
  sourceStrategy?: string;
  sourceProfile?: string;
  sourceTimeframe?: string;
};

export function computeSignalQualityKpis(
  input: ComputeSignalQualityKpisInput,
): SignalQualityKpiResult {
  const horizonBars = Math.max(1, Math.round(input.horizonBars));
  const sourceStrategy = input.sourceStrategy ?? "signal-quality-kpi";
  const sourceProfile = input.sourceProfile ?? "preview";
  const sourceTimeframe = input.sourceTimeframe ?? "5m";

  const observations: SignalObservation[] = [];
  let mtfFilteredOutCount = 0;

  for (const [symbol, bars] of Object.entries(input.barsBySymbol)) {
    if (!bars.length) {
      continue;
    }
    const sorted = bars
      .slice()
      .sort((left, right) => left.time - right.time);

    const evaluation = evaluatePyrusSignalsSignals({
      chartBars: sorted,
      settings: input.settings,
      includeProvisionalSignals: false,
    });
    if (!evaluation.signalEvents.length) {
      continue;
    }

    // Post-filter the engine's actionable signals through the MTF gate so KPIs
    // match live signal-options admission, then map survivors into the
    // forward-return dataset's signal shape.
    const forwardSignals: SignalForwardReturnSignal[] = [];
    for (const event of evaluation.signalEvents) {
      const directionSign = event.direction === "long" ? 1 : -1;
      const mtfDirections = mtfDirectionsAtBar(
        sorted,
        event.barIndex,
        input.mtf.timeframes,
        input.settings.basisLength,
      );
      if (!passesMtfGate(mtfDirections, directionSign, input.mtf)) {
        mtfFilteredOutCount += 1;
        continue;
      }
      forwardSignals.push({
        signalId: event.id,
        signalAt: new Date(event.time * 1000),
        symbol,
        direction: event.direction,
        // Score is required by the dataset only to flag "score_missing"; the KPI
        // math reads realized windows, not score, so a constant is fine.
        score: 1,
        sourceStrategy,
        sourceProfile,
        sourceTimeframe,
      });
    }
    if (!forwardSignals.length) {
      continue;
    }

    const dataset = buildSignalForwardReturnDataset({
      signals: forwardSignals,
      barsBySymbol: { [symbol]: pyrusBarsToBacktestBars(sorted) },
      horizonsBars: [horizonBars],
    });

    collectForwardObservations(dataset, horizonBars, observations);
  }

  return buildKpiResult(observations, horizonBars, mtfFilteredOutCount);
}

// Extract one realized observation per COMPLETE forward-return window. Shared by
// the engine-recompute path and the persisted-signal (Signal Matrix) path so both
// produce identical observation shapes.
function collectForwardObservations(
  dataset: ReturnType<typeof buildSignalForwardReturnDataset>,
  horizonBars: number,
  observations: SignalObservation[],
): void {
  for (const row of dataset.rows) {
    const window = row.windows.find((item) => item.horizonBars === horizonBars);
    if (
      !window ||
      window.status !== "complete" ||
      window.realizedReturnPercent == null ||
      window.maxFavorableExcursionPercent == null ||
      window.maxAdverseExcursionPercent == null
    ) {
      continue;
    }
    observations.push({
      symbol: row.symbol,
      direction: row.direction,
      realizedReturnPercent: window.realizedReturnPercent,
      mfePercent: window.maxFavorableExcursionPercent,
      maePercent: window.maxAdverseExcursionPercent,
    });
  }
}

// Aggregate observations into the full result (overall + per-symbol + buy/sell).
// Shared tail so the engine path and the persisted-signal path stay identical.
function buildKpiResult(
  observations: SignalObservation[],
  horizonBars: number,
  mtfFilteredOutCount: number,
): SignalQualityKpiResult {
  const overall = aggregateObservations(observations);

  const perSymbolMap = new Map<string, SignalObservation[]>();
  for (const observation of observations) {
    const list = perSymbolMap.get(observation.symbol) ?? [];
    list.push(observation);
    perSymbolMap.set(observation.symbol, list);
  }
  const perSymbol: SignalQualitySymbolBreakdown[] = [...perSymbolMap.entries()]
    .map(([symbol, items]) => ({
      symbol,
      ...aggregateObservations(items),
    }))
    .sort((left, right) => right.signalCount - left.signalCount);

  const byDirection: SignalQualityDirectionalBreakdown = {
    buy: aggregateObservations(
      observations.filter((observation) => observation.direction === "long"),
    ),
    sell: aggregateObservations(
      observations.filter((observation) => observation.direction === "short"),
    ),
  };

  return {
    ...overall,
    horizonBars,
    mtfFilteredOutCount,
    perSymbol,
    byDirection,
  };
}

// A signal sourced from the persisted Signal Matrix (signal_monitor_events)
// instead of re-running the engine. mtfDirections is the gate decision RECORDED
// when the signal fired (the real traded gate), so the KPI MTF gate matches what
// the deployment actually traded rather than a re-derivation.
export type PersistedSignalInput = {
  signalId: string;
  symbol: string;
  direction: "long" | "short";
  signalAt: Date;
  mtfDirections: number[];
};

export type ComputeFromPersistedSignalsInput = {
  signals: PersistedSignalInput[];
  // Forward bars per symbol (ascending), covering each signal + horizonBars ahead.
  barsBySymbol: Record<string, PyrusSignalsBar[]>;
  horizonBars: number;
  mtf: SignalQualityMtfConfig;
  sourceStrategy?: string;
  sourceProfile?: string;
  sourceTimeframe?: string;
};

// Compute the same KPIs from already-persisted Signal Matrix signals: apply the
// STORED MTF gate (no per-signal re-aggregation), attach realized forward windows
// from the provided bars, and reuse the identical aggregation. No re-detection.
export function computeSignalQualityKpisFromPersistedSignals(
  input: ComputeFromPersistedSignalsInput,
): SignalQualityKpiResult {
  const horizonBars = Math.max(1, Math.round(input.horizonBars));
  const sourceStrategy = input.sourceStrategy ?? "signal-quality-kpi";
  const sourceProfile = input.sourceProfile ?? "signal-matrix";
  const sourceTimeframe = input.sourceTimeframe ?? "5m";

  // Gate using the recorded MTF directions (matches the gate the signal traded),
  // then group survivors by symbol for forward-window evaluation.
  const gatedBySymbol = new Map<string, PersistedSignalInput[]>();
  let mtfFilteredOutCount = 0;
  for (const signal of input.signals) {
    const directionSign = signal.direction === "long" ? 1 : -1;
    if (!passesMtfGate(signal.mtfDirections, directionSign, input.mtf)) {
      mtfFilteredOutCount += 1;
      continue;
    }
    const list = gatedBySymbol.get(signal.symbol) ?? [];
    list.push(signal);
    gatedBySymbol.set(signal.symbol, list);
  }

  const observations: SignalObservation[] = [];
  for (const [symbol, signals] of gatedBySymbol.entries()) {
    const bars = input.barsBySymbol[symbol];
    if (!bars || !bars.length) {
      continue;
    }
    const sorted = bars.slice().sort((left, right) => left.time - right.time);
    const forwardSignals: SignalForwardReturnSignal[] = signals.map((signal) => ({
      signalId: signal.signalId,
      signalAt: signal.signalAt,
      symbol,
      direction: signal.direction,
      score: 1,
      sourceStrategy,
      sourceProfile,
      sourceTimeframe,
    }));
    const dataset = buildSignalForwardReturnDataset({
      signals: forwardSignals,
      barsBySymbol: { [symbol]: pyrusBarsToBacktestBars(sorted) },
      horizonsBars: [horizonBars],
    });
    collectForwardObservations(dataset, horizonBars, observations);
  }

  return buildKpiResult(observations, horizonBars, mtfFilteredOutCount);
}

// Exported for unit tests: the aggregation math and the MTF predicate are the
// load-bearing pieces and are asserted directly against hand-computed fixtures.
export const __signalQualityKpisInternalsForTests = {
  aggregateObservations,
  passesMtfGate,
  populationStdDev,
  mean,
};

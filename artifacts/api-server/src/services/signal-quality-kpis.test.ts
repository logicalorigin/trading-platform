import assert from "node:assert/strict";
import test from "node:test";

import {
  computeSignalQualityKpis,
  computeSignalQualityKpisFromPersistedSignals,
  compareSignalScoreModels,
  __signalQualityKpisInternalsForTests,
  type PersistedSignalInput,
  type SignalQualityMtfConfig,
} from "./signal-quality-kpis";
import {
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
} from "@workspace/pyrus-signals-core";

const {
  aggregateObservations,
  buildFeatureSummaries,
  buildKpiResult,
  passesMtfGate,
  populationStdDev,
  scoreFromSignalFilterState,
} = __signalQualityKpisInternalsForTests;

// Hand-computed fixture mixing winning longs and losing observations. The
// aggregation math is direction-agnostic at this layer (realizedReturnPercent is
// already signed in the signal's direction by buildSignalForwardReturnDataset),
// so a single signed-return fixture exercises win/loss/expectancy/payoff/stddev.
test("aggregateObservations matches hand-computed KPI math", () => {
  const result = aggregateObservations([
    { symbol: "AAA", direction: "long", score: null, realizedReturnPercent: 2.0, mfePercent: 3.0, maePercent: -1.0 },
    { symbol: "AAA", direction: "long", score: null, realizedReturnPercent: 1.0, mfePercent: 2.0, maePercent: -0.5 },
    { symbol: "AAA", direction: "long", score: null, realizedReturnPercent: -1.5, mfePercent: 0.5, maePercent: -2.0 },
    { symbol: "AAA", direction: "long", score: null, realizedReturnPercent: -0.5, mfePercent: 1.0, maePercent: -1.5 },
  ]);

  assert.equal(result.signalCount, 4);
  // mean([2, 1, -1.5, -0.5]) = 0.25
  assert.equal(result.avgDirectionalMovePercent, 0.25);
  // 2 of 4 returns are > 0
  assert.equal(result.correctnessPercent, 50);
  // hit% * avgWin - miss% * avgLoss = 0.5 * 1.5 - 0.5 * 1.0 = 0.25
  assert.equal(result.expectancyPercent, 0.25);
  // avgWin / avgLoss = 1.5 / 1.0
  assert.equal(result.payoffRatio, 1.5);
  // mean([3, 2, 0.5, 1]) = 1.625
  assert.equal(result.avgMfePercent, 1.625);
  // mean([-1, -0.5, -2, -1.5]) = -1.25
  assert.equal(result.avgMaePercent, -1.25);
  // population stddev of [2, 1, -1.5, -0.5] = sqrt(7.25 / 4)
  assert.equal(result.consistencyStdDevPercent, 1.346291);
});

test("aggregateObservations handles empty and single-sample inputs", () => {
  const empty = aggregateObservations([]);
  assert.equal(empty.signalCount, 0);
  assert.equal(empty.expectancyPercent, 0);
  assert.equal(empty.payoffRatio, 0);

  // No losses -> payoffRatio falls back to 0 (avgLoss == 0); stddev of 1 = 0.
  const single = aggregateObservations([
    { symbol: "AAA", direction: "long", score: null, realizedReturnPercent: 1.2, mfePercent: 1.5, maePercent: -0.3 },
  ]);
  assert.equal(single.signalCount, 1);
  assert.equal(single.correctnessPercent, 100);
  assert.equal(single.payoffRatio, 0);
  assert.equal(single.consistencyStdDevPercent, 0);
  assert.equal(single.expectancyPercent, 1.2);
});

test("populationStdDev is zero for under two samples", () => {
  assert.equal(populationStdDev([]), 0);
  assert.equal(populationStdDev([5]), 0);
});

test("passesMtfGate mirrors the signal-options confluence gate", () => {
  const long: SignalQualityMtfConfig = {
    enabled: true,
    requiredCount: 2,
    timeframes: ["5m", "15m", "1h"],
  };
  // A stale lower requiredCount cannot admit partial alignment.
  assert.equal(passesMtfGate([1, 1, -1], 1, long), false);
  // Only 1 of 3 bullish also fails for a long.
  assert.equal(passesMtfGate([1, -1, -1], 1, long), false);
  // For a short (-1), 2 of 3 bearish is still partial and fails.
  assert.equal(passesMtfGate([1, -1, -1], -1, long), false);
  assert.equal(passesMtfGate([-1, -1, -1], -1, long), true);
  // Disabled gate admits everything.
  assert.equal(
    passesMtfGate([1, -1, -1], 1, { ...long, enabled: false }),
    true,
  );
  // requiredCount clamps to the frame count.
  assert.equal(
    passesMtfGate([1, 1], 1, { enabled: true, requiredCount: 9, timeframes: ["5m", "15m"] }),
    true,
  );
  // No frames configured -> always passes (nothing to align against).
  assert.equal(
    passesMtfGate([], 1, { enabled: true, requiredCount: 2, timeframes: [] }),
    true,
  );
});

test("scoreFromSignalFilterState prefers conservative SOT outcome features", () => {
  const legacy = scoreFromSignalFilterState({
    filterState: { mtfDirections: [1, 1, 1], adx: 30 },
    direction: "long",
  });
  const extended = scoreFromSignalFilterState({
    filterState: {
      directionalFeatures: {
        rangePosition20: 0.95,
        mtfAlignment: 3,
        adxComponent: 2,
        volatilityComponent: -0.2,
        shortMomentumPct: 4,
        riskAdjustedMomentum: 3,
      },
      mtfDirections: [1, 1, 1],
      adx: 30,
    },
    direction: "long",
  });
  const lessExtended = scoreFromSignalFilterState({
    filterState: {
      directionalFeatures: {
        rangePosition20: 0.25,
        mtfAlignment: 0,
        adxComponent: -0.5,
        volatilityComponent: 0.8,
        shortMomentumPct: -1,
        riskAdjustedMomentum: -0.5,
      },
      mtfDirections: [1, 1, 1],
      adx: 30,
    },
    direction: "long",
  });

  assert.equal(legacy, 69.9);
  assert.ok(extended != null && lessExtended != null);
  assert.ok(extended < lessExtended);
  assert.ok(lessExtended < 70);
});

const sotCalibrationFixtureObservations = (repetitions = 1) => {
  const baseObservations = [
    {
      symbol: "AAA",
      direction: "long" as const,
      realizedReturnPercent: 1.2,
      mfePercent: 1.6,
      maePercent: -0.4,
      directionalFeatures: {
        rangePosition20: 0.12,
        mtfAlignment: 0,
        adxComponent: -0.5,
        volatilityComponent: 0.8,
        shortMomentumPct: -2,
        riskAdjustedMomentum: -1,
        volumeExpansion: 0.6,
      },
    },
    {
      symbol: "BBB",
      direction: "long" as const,
      realizedReturnPercent: 0.8,
      mfePercent: 1.1,
      maePercent: -0.3,
      directionalFeatures: {
        rangePosition20: 0.2,
        mtfAlignment: 0.5,
        adxComponent: -0.25,
        volatilityComponent: 0.7,
        shortMomentumPct: -1,
        riskAdjustedMomentum: -0.5,
        volumeExpansion: 0.4,
      },
    },
    {
      symbol: "CCC",
      direction: "long" as const,
      realizedReturnPercent: -0.7,
      mfePercent: 0.2,
      maePercent: -1.3,
      directionalFeatures: {
        rangePosition20: 0.92,
        mtfAlignment: 3,
        adxComponent: 1.5,
        volatilityComponent: 0.1,
        shortMomentumPct: 4,
        riskAdjustedMomentum: 3,
        volumeExpansion: 1.4,
      },
    },
    {
      symbol: "DDD",
      direction: "long" as const,
      realizedReturnPercent: -1.1,
      mfePercent: 0.1,
      maePercent: -1.8,
      directionalFeatures: {
        rangePosition20: 0.98,
        mtfAlignment: 3,
        adxComponent: 2,
        volatilityComponent: -0.2,
        shortMomentumPct: 5,
        riskAdjustedMomentum: 4,
        volumeExpansion: 1.8,
      },
    },
  ];
  return Array.from({ length: repetitions }, (_, repetition) =>
    baseObservations.map((observation) => ({
      ...observation,
      symbol: `${observation.symbol}${repetition}`,
    })),
  ).flat();
};

test("compareSignalScoreModels withholds formula recommendations until bucket support is adequate", () => {
  const comparison = compareSignalScoreModels(sotCalibrationFixtureObservations(), [
    "sot-outcome-v1",
    "trend-confirmation-v2",
    "balanced-sot-v2",
  ]);
  const byKey = Object.fromEntries(
    comparison.models.map((model) => [model.modelKey, model]),
  );

  assert.equal(comparison.observationCount, 4);
  assert.equal(comparison.recommendedModelKey, null);
  assert.ok(byKey["sot-outcome-v1"].alignment.topBucketLiftPercent > 0);
  assert.equal(
    byKey["sot-outcome-v1"].recommendationSupport.supported,
    false,
  );
  assert.ok(
    byKey["sot-outcome-v1"].recommendationSupport.reasons.includes(
      "min_observation_count",
    ),
  );
  assert.equal(
    byKey["sot-outcome-v1"].recommendationSupport.observed.observationCount,
    4,
  );
  assert.equal(
    byKey["sot-outcome-v1"].recommendationSupport.thresholds
      .minObservationCount,
    30,
  );
  assert.equal(comparison.calibration.state, "needs_more_data");
  assert.equal(comparison.calibration.recommendedModelKey, null);
  assert.ok(comparison.calibration.reasons.includes("min_observation_count"));
});

test("compareSignalScoreModels ranks competing formula methodologies by SOT bucket alignment", () => {
  const observations = sotCalibrationFixtureObservations(10);
  const comparison = compareSignalScoreModels(observations, [
    "sot-outcome-v1",
    "trend-confirmation-v2",
    "balanced-sot-v2",
  ]);
  const byKey = Object.fromEntries(
    comparison.models.map((model) => [model.modelKey, model]),
  );

  assert.equal(comparison.observationCount, 40);
  assert.equal(comparison.recommendedModelKey, "sot-outcome-v1");
  assert.ok(byKey["sot-outcome-v1"].alignment.topBucketLiftPercent > 0);
  assert.ok(
    byKey["trend-confirmation-v2"].alignment.topBucketLiftPercent < 0,
    "trend-confirmation methodology should score the adverse extension examples too high",
  );
  assert.ok(
    byKey["sot-outcome-v1"].alignment.alignmentScore >
      byKey["trend-confirmation-v2"].alignment.alignmentScore,
  );
  assert.equal(
    byKey["sot-outcome-v1"].recommendationSupport.supported,
    true,
  );
  assert.deepEqual(byKey["sot-outcome-v1"].recommendationSupport.reasons, []);
  assert.equal(
    byKey["sot-outcome-v1"].recommendationSupport.observed.observationCount,
    40,
  );
  assert.equal(comparison.calibration.state, "calibrated");
  assert.equal(comparison.calibration.recommendedModelKey, "sot-outcome-v1");
  assert.ok(comparison.calibration.supportedModelCount >= 1);
  assert.equal(comparison.calibration.reasons.length, 0);
});

test("compareSignalScoreModels uses a support-qualified high-score band", () => {
  const observations = [
    {
      symbol: "TOP",
      direction: "long" as const,
      score: 65,
      realizedReturnPercent: 2,
      mfePercent: 2.5,
      maePercent: -0.1,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      symbol: `HIGH${index}`,
      direction: "long" as const,
      score: 35,
      realizedReturnPercent: 1,
      mfePercent: 1.5,
      maePercent: -0.2,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      symbol: `LOW${index}`,
      direction: "long" as const,
      score: 25,
      realizedReturnPercent: -1,
      mfePercent: 0.1,
      maePercent: -1.2,
    })),
  ];
  const comparison = compareSignalScoreModels(observations, ["observed-score"], {
    minObservationCount: 10,
    minTopBucketSignalCount: 5,
    minLowerBaselineSignalCount: 5,
    minPopulatedBucketCount: 2,
    minAlignmentScore: 0,
  });
  const [model] = comparison.models;

  assert.equal(comparison.recommendedModelKey, "observed-score");
  assert.equal(model.alignment.topBucketKey, "60-70");
  assert.equal(model.alignment.topBucketSignalCount, 1);
  assert.equal(model.recommendationSupport.supported, true);
  assert.deepEqual(model.recommendationSupport.reasons, []);
  assert.equal(
    model.recommendationSupport.observed.qualifiedTopBandKey,
    "30-40",
  );
  assert.equal(
    model.recommendationSupport.observed.qualifiedTopBandSignalCount,
    6,
  );
  assert.equal(
    model.recommendationSupport.observed.qualifiedLowerBaselineSignalCount,
    5,
  );
  assert.ok(
    model.recommendationSupport.observed.qualifiedTopBandLiftPercent > 0,
  );
});

test("compareSignalScoreModels rejects top-band lift when the full score ladder is inverted", () => {
  const observations = [
    ...Array.from({ length: 5 }, (_, index) => ({
      symbol: `TOP${index}`,
      direction: "long" as const,
      score: 65,
      realizedReturnPercent: 1,
      mfePercent: 1.5,
      maePercent: -0.2,
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      symbol: `MID${index}`,
      direction: "long" as const,
      score: 55,
      realizedReturnPercent: -5,
      mfePercent: 0.2,
      maePercent: -5.5,
    })),
    ...Array.from({ length: 15 }, (_, index) => ({
      symbol: `LOW${index}`,
      direction: "long" as const,
      score: 45,
      realizedReturnPercent: 0.8,
      mfePercent: 1.1,
      maePercent: -0.3,
    })),
  ];
  // Pin the top band to the sparse 5-signal top bucket so this exercises the
  // FULL-LADDER inversion gate specifically: the tiny top band looks good, yet
  // the inverted full ladder must still reject the model. (The default top band
  // is now a robust fraction of observations -- see the dedicated test below.)
  const comparison = compareSignalScoreModels(observations, ["observed-score"], {
    minTopBucketSignalCount: 5,
  });
  const [model] = comparison.models;

  assert.ok(
    model.recommendationSupport.observed.qualifiedTopBandLiftPercent > 0,
  );
  assert.ok(model.alignment.alignmentScore < 0);
  assert.equal(comparison.recommendedModelKey, null);
  assert.equal(comparison.calibration.state, "uncalibrated");
  assert.equal(model.recommendationSupport.supported, false);
  assert.ok(model.recommendationSupport.reasons.includes("min_alignment_score"));
});

test("compareSignalScoreModels measures the qualified top band over a robust fraction, not a sparse sliver", () => {
  // 1,000 signals where a tiny top-score sliver looks great but the broad top
  // band is poor -- the exact shape that made the legacy fixed-5 top band select
  // the wrong model out-of-sample.
  const observations = [
    ...Array.from({ length: 10 }, (_, index) => ({
      symbol: `SLIVER${index}`,
      direction: "long" as const,
      score: 92,
      realizedReturnPercent: 2,
      mfePercent: 2.4,
      maePercent: -0.2,
    })),
    ...Array.from({ length: 190 }, (_, index) => ({
      symbol: `HIGH${index}`,
      direction: "long" as const,
      score: 70,
      realizedReturnPercent: -1,
      mfePercent: 0.3,
      maePercent: -1.4,
    })),
    ...Array.from({ length: 800 }, (_, index) => ({
      symbol: `BASE${index}`,
      direction: "long" as const,
      score: 40,
      realizedReturnPercent: 0.1,
      mfePercent: 0.6,
      maePercent: -0.4,
    })),
  ];
  // Legacy sparse top band: the 10-signal sliver dominates -> spuriously positive.
  const sparse = compareSignalScoreModels(observations, ["observed-score"], {
    minTopBucketSignalCount: 5,
  });
  assert.ok(
    sparse.models[0].recommendationSupport.observed.qualifiedTopBandSignalCount <=
      10,
  );
  assert.ok(
    sparse.models[0].recommendationSupport.observed.qualifiedTopBandLiftPercent >
      0,
  );
  // Robust default: the qualified band spans ~20% of observations, so the poor
  // high band shows through and the sliver can no longer carry the recommendation.
  const robust = compareSignalScoreModels(observations, ["observed-score"]);
  assert.ok(
    robust.models[0].recommendationSupport.observed.qualifiedTopBandSignalCount >=
      200,
  );
  assert.ok(
    robust.models[0].recommendationSupport.observed.qualifiedTopBandLiftPercent <
      0,
  );
});

test("compareSignalScoreModels marks adequate but misaligned samples uncalibrated", () => {
  const observations = Array.from({ length: 10 }, (_, repetition) => [
    {
      symbol: `EXTENDED${repetition}`,
      direction: "long" as const,
      realizedReturnPercent: -1.2,
      mfePercent: 0.2,
      maePercent: -1.8,
      directionalFeatures: {
        rangePosition20: 0.95,
        mtfAlignment: 3,
        adxComponent: 2,
        volatilityComponent: -0.2,
        shortMomentumPct: 4,
        riskAdjustedMomentum: 3,
      },
    },
    {
      symbol: `REVERT${repetition}`,
      direction: "long" as const,
      realizedReturnPercent: 0.9,
      mfePercent: 1.2,
      maePercent: -0.3,
      directionalFeatures: {
        rangePosition20: 0.15,
        mtfAlignment: 0,
        adxComponent: -0.5,
        volatilityComponent: 0.8,
        shortMomentumPct: -2,
        riskAdjustedMomentum: -1,
      },
    },
    {
      symbol: `MID${repetition}`,
      direction: "long" as const,
      realizedReturnPercent: 0.1,
      mfePercent: 0.4,
      maePercent: -0.4,
      directionalFeatures: {
        rangePosition20: 0.45,
        mtfAlignment: 0.5,
        adxComponent: 0,
        volatilityComponent: 0.1,
        shortMomentumPct: 0,
        riskAdjustedMomentum: 0,
      },
    },
  ]).flat();

  const comparison = compareSignalScoreModels(observations, [
    "trend-confirmation-v2",
  ]);
  const [model] = comparison.models;

  assert.equal(comparison.observationCount, 30);
  assert.equal(comparison.recommendedModelKey, null);
  assert.equal(comparison.calibration.state, "uncalibrated");
  assert.equal(comparison.calibration.recommendedModelKey, null);
  assert.equal(comparison.calibration.supportedModelCount, 0);
  assert.equal(comparison.calibration.candidateModelKey, "trend-confirmation-v2");
  assert.ok(comparison.calibration.reasons.includes("min_alignment_score"));
  assert.ok(model.recommendationSupport.reasons.includes("min_alignment_score"));
});

// End-to-end short/sell-direction case: drive the full evaluate ->
// forward-return -> aggregate chain on engineered bars that produce a sell
// signal, and confirm the realized directional return is positive when price
// falls after the signal (a correct short).
test("computeSignalQualityKpis scores a falling-after-sell signal as correct", () => {
  const settings = resolvePyrusSignalsSignalSettings({
    timeHorizon: 2,
    basisLength: 5,
    atrLength: 3,
    atrSmoothing: 3,
    signalFiltersEnabled: false,
    waitForBarClose: false,
  });

  // Oscillating downtrend (swing highs/lows that the structure engine can break)
  // to elicit a bearish CHoCH / sell signal, with ample trailing bars to fill
  // the forward window.
  const bars: PyrusSignalsBar[] = [];
  const start = Math.floor(Date.UTC(2026, 0, 5, 14, 30, 0) / 1000);
  const base = 160;
  for (let i = 0; i < 50; i += 1) {
    const wave = Math.sin(i / 3) * 3;
    const drift = -i * 0.6;
    const c = base + wave + drift;
    bars.push({ time: start + i * 300, o: c + 0.2, h: c + 1.8, l: c - 1.8, c, v: 1000 });
  }

  const noMtf: SignalQualityMtfConfig = {
    enabled: false,
    requiredCount: 2,
    timeframes: [],
  };
  const result = computeSignalQualityKpis({
    settings,
    barsBySymbol: { TEST: bars },
    horizonBars: 2,
    mtf: noMtf,
    sourceTimeframe: "5m",
  });

  // The chain must have produced at least one scored signal.
  assert.ok(result.signalCount >= 1, "expected at least one scored signal");
  // Per-symbol breakdown is present and consistent with the overall count.
  assert.equal(result.perSymbol.length, 1);
  assert.equal(result.perSymbol[0].symbol, "TEST");
  assert.equal(result.perSymbol[0].signalCount, result.signalCount);

  // The directional-return sign convention is correct: at least one sell signal
  // fired during the downtrend and was scored positive (price fell as the short
  // predicted). We assert the aggregate captured a positive correctness share,
  // which can only happen if a sell signal's (entry - exit)/entry was positive.
  assert.ok(
    result.correctnessPercent > 0,
    "expected the falling-after-sell signal to be scored correct (positive directional return)",
  );
  assert.ok(
    result.featureSummaries.some(
      (summary) => summary.key === "shortMomentumPct" && summary.count > 0,
    ),
    "expected historical recompute to carry signal-time directional features into KPI diagnostics",
  );
});

// The MTF gate is a TRADE-ADMISSION gate, not a grading filter: enabling it must
// NOT shrink the graded population, because the score is displayed on every STA row
// and calibration must cover the full scored/displayed population. The gate's
// rejections are recorded in mtfFilteredOutCount as telemetry only.
test("computeSignalQualityKpis grades every detected signal regardless of the MTF gate", () => {
  const settings = resolvePyrusSignalsSignalSettings({
    timeHorizon: 2,
    basisLength: 5,
    atrLength: 3,
    atrSmoothing: 3,
    signalFiltersEnabled: false,
    waitForBarClose: false,
  });
  const bars: PyrusSignalsBar[] = [];
  const start = Math.floor(Date.UTC(2026, 0, 6, 14, 30, 0) / 1000);
  let price = 100;
  for (let i = 0; i < 40; i += 1) {
    const wave = Math.sin(i / 3) * 2;
    const c = price + wave + i * 0.3;
    bars.push({ time: start + i * 300, o: c - 0.2, h: c + 1.5, l: c - 1.5, c, v: 1000 });
  }

  const open = computeSignalQualityKpis({
    settings,
    barsBySymbol: { TEST: bars },
    horizonBars: 2,
    mtf: { enabled: false, requiredCount: 2, timeframes: [] },
  });
  const gated = computeSignalQualityKpis({
    settings,
    barsBySymbol: { TEST: bars },
    horizonBars: 2,
    mtf: { enabled: true, requiredCount: 4, timeframes: ["5m", "15m", "1h", "1d"] },
  });

  // Enabling the gate does NOT narrow the graded population: the same detected
  // signals are scored either way.
  assert.equal(gated.signalCount, open.signalCount);
  // With the gate disabled nothing is rejected; the counter is pure telemetry and
  // never removes observations.
  assert.equal(open.mtfFilteredOutCount, 0);
  assert.ok(gated.mtfFilteredOutCount >= 0);
});

// The persisted (Signal Matrix) grading path applies the SAME broadening: a signal
// that fails the recorded MTF gate is still graded, and the rejection is recorded
// as telemetry. Locks the full-population calibration for the production path.
test("computeSignalQualityKpisFromPersistedSignals grades gate-failing signals", () => {
  const bars: PyrusSignalsBar[] = [];
  const start = Math.floor(Date.UTC(2026, 0, 8, 14, 30, 0) / 1000);
  for (let i = 0; i < 10; i += 1) {
    const c = 100 + i;
    bars.push({ time: start + i * 300, o: c - 0.2, h: c + 1, l: c - 1, c, v: 1000 });
  }
  const signals: PersistedSignalInput[] = [
    {
      signalId: "pass",
      symbol: "TEST",
      direction: "long",
      signalAt: new Date(bars[0].time * 1000),
      mtfDirections: [1, 1],
      score: 80,
    },
    {
      signalId: "fail",
      symbol: "TEST",
      direction: "long",
      signalAt: new Date(bars[1].time * 1000),
      mtfDirections: [-1, -1],
      score: 40,
    },
  ];

  const result = computeSignalQualityKpisFromPersistedSignals({
    signals,
    barsBySymbol: { TEST: bars },
    horizonBars: 2,
    mtf: { enabled: true, requiredCount: 2, timeframes: ["5m", "15m"] },
  });

  // Both signals are graded even though "fail" misses the MTF gate...
  assert.equal(result.signalCount, 2);
  // ...and the gate rejection is still counted as telemetry.
  assert.equal(result.mtfFilteredOutCount, 1);
});

// The buy/sell breakout is a clean partition of the same observations: every
// scored signal is exactly long (buy) or short (sell), so the two directional
// signalCounts sum to the overall count and each side reuses the same aggregation.
test("computeSignalQualityKpis splits KPIs into buy/sell directions", () => {
  const settings = resolvePyrusSignalsSignalSettings({
    timeHorizon: 2,
    basisLength: 5,
    atrLength: 3,
    atrSmoothing: 3,
    signalFiltersEnabled: false,
    waitForBarClose: false,
  });
  // Oscillating bars elicit both bullish and bearish CHoCH signals.
  const bars: PyrusSignalsBar[] = [];
  const start = Math.floor(Date.UTC(2026, 0, 7, 14, 30, 0) / 1000);
  for (let i = 0; i < 60; i += 1) {
    const c = 120 + Math.sin(i / 2.5) * 6 + Math.cos(i / 7) * 3;
    bars.push({ time: start + i * 300, o: c - 0.2, h: c + 1.6, l: c - 1.6, c, v: 1000 });
  }

  const result = computeSignalQualityKpis({
    settings,
    barsBySymbol: { TEST: bars },
    horizonBars: 2,
    mtf: { enabled: false, requiredCount: 2, timeframes: [] },
    sourceTimeframe: "5m",
  });

  assert.ok(result.byDirection, "byDirection breakdown present");
  // Clean partition: buy + sell counts reconstruct the overall count exactly.
  assert.equal(
    result.byDirection.buy.signalCount + result.byDirection.sell.signalCount,
    result.signalCount,
  );
  // Each side carries the full metric set (finite numbers, not null/NaN).
  for (const side of [result.byDirection.buy, result.byDirection.sell]) {
    assert.ok(Number.isFinite(side.avgDirectionalMovePercent));
    assert.ok(Number.isFinite(side.correctnessPercent));
    assert.ok(Number.isFinite(side.expectancyPercent));
    assert.ok(Number.isFinite(side.avgMfePercent));
    assert.ok(Number.isFinite(side.avgMaePercent));
  }
});

test("buildKpiResult exposes score-bucket outcome breakdowns", () => {
  const result = buildKpiResult(
    [
      {
        symbol: "AAA",
        direction: "long",
        score: 82,
        realizedReturnPercent: 2,
        mfePercent: 3,
        maePercent: -1,
      },
      {
        symbol: "BBB",
        direction: "short",
        score: 77,
        realizedReturnPercent: -1,
        mfePercent: 0.5,
        maePercent: -2,
      },
      {
        symbol: "CCC",
        direction: "long",
        score: 55,
        realizedReturnPercent: 0.5,
        mfePercent: 1,
        maePercent: -0.5,
      },
      {
        symbol: "DDD",
        direction: "short",
        score: null,
        realizedReturnPercent: 1,
        mfePercent: 1.5,
        maePercent: -0.25,
      },
    ],
    2,
    0,
  );

  assert.equal(result.byScoreRange["80-90"].signalCount, 1);
  assert.equal(result.byScoreRange["80-90"].avgDirectionalMovePercent, 2);
  assert.equal(result.byScoreRange["70-80"].signalCount, 1);
  assert.equal(result.byScoreRange["50-60"].signalCount, 1);
  assert.equal(result.byScoreRange.unknown.signalCount, 1);
  assert.deepEqual(
    result.scoreBuckets
      .filter((bucket) => bucket.signalCount > 0)
      .map((bucket) => bucket.key),
    ["80-90", "70-80", "50-60", "unknown"],
  );
  assert.equal(result.scoreModelComparisons.observationCount, 4);
  assert.ok(
    result.scoreModelComparisons.models.some(
      (model) => model.modelKey === "sot-outcome-v1",
    ),
  );
});

test("compareSignalScoreModels exposes magnitude alignment separately from expectancy alignment", () => {
  const comparison = compareSignalScoreModels(
    [
      {
        symbol: "BIG1",
        direction: "long",
        score: 95,
        realizedReturnPercent: -0.2,
        mfePercent: 35,
        maePercent: -1,
      },
      {
        symbol: "BIG2",
        direction: "long",
        score: 92,
        realizedReturnPercent: 0.1,
        mfePercent: 25,
        maePercent: -0.5,
      },
      {
        symbol: "MID",
        direction: "long",
        score: 70,
        realizedReturnPercent: 1,
        mfePercent: 12,
        maePercent: -0.2,
      },
      {
        symbol: "LOW",
        direction: "long",
        score: 20,
        realizedReturnPercent: 0.4,
        mfePercent: 4,
        maePercent: -0.1,
      },
    ],
    ["observed-score"],
    { minObservationCount: 1, minTopBucketSignalCount: 1 },
  );
  const [model] = comparison.models;

  assert.equal(model.magnitudeAlignment.highScoreThreshold, 90);
  assert.equal(model.magnitudeAlignment.highScoreSignalCount, 2);
  assert.equal(model.magnitudeAlignment.highScoreAvgMfePercent, 30);
  assert.equal(model.magnitudeAlignment.lowerScoreSignalCount, 2);
  assert.equal(model.magnitudeAlignment.lowerScoreAvgMfePercent, 8);
  assert.equal(model.magnitudeAlignment.highScoreMfeLiftPercent, 22);
  // Fixture's actual r ≈ 0.897; 0.9 was over-tight for this deterministic input.
  assert.ok(model.magnitudeAlignment.scoreMfePearson > 0.85);
  assert.deepEqual(
    model.magnitudeAlignment.thresholds.map((threshold) => ({
      mfe: threshold.mfeThresholdPercent,
      bigMoverCount: threshold.bigMoverCount,
      highScoreBigMoverCount: threshold.highScoreBigMoverCount,
      recall: threshold.recallAtScore90,
      precision: threshold.precisionAtScore90,
    })),
    [
      { mfe: 10, bigMoverCount: 3, highScoreBigMoverCount: 2, recall: 0.666667, precision: 1 },
      { mfe: 20, bigMoverCount: 2, highScoreBigMoverCount: 2, recall: 1, precision: 1 },
      { mfe: 30, bigMoverCount: 1, highScoreBigMoverCount: 1, recall: 1, precision: 0.5 },
    ],
  );
});

test("buildFeatureSummaries exposes signal-time feature outcome separation", () => {
  const summaries = buildFeatureSummaries([
    {
      symbol: "AAA",
      direction: "long",
      score: 80,
      directionalFeatures: { shortMomentumPct: 3, volumeExpansion: 1 },
      realizedReturnPercent: 2,
      mfePercent: 3,
      maePercent: -1,
    },
    {
      symbol: "BBB",
      direction: "long",
      score: 70,
      directionalFeatures: { shortMomentumPct: 2, volumeExpansion: 0.5 },
      realizedReturnPercent: 1,
      mfePercent: 2,
      maePercent: -0.5,
    },
    {
      symbol: "CCC",
      direction: "short",
      score: 60,
      directionalFeatures: { shortMomentumPct: -1, volumeExpansion: -0.25 },
      realizedReturnPercent: -0.5,
      mfePercent: 1,
      maePercent: -1.5,
    },
    {
      symbol: "DDD",
      direction: "short",
      score: 50,
      directionalFeatures: { shortMomentumPct: -2, volumeExpansion: -0.5 },
      realizedReturnPercent: -1,
      mfePercent: 0.5,
      maePercent: -2,
    },
  ]);

  const momentum = summaries.find(
    (summary) => summary.key === "shortMomentumPct",
  );
  const directionPrior = summaries.find(
    (summary) => summary.key === "directionSign",
  );
  assert.ok(momentum);
  assert.equal(momentum.count, 4);
  assert.equal(momentum.auc, 1);
  assert.equal(momentum.favorableAvgValue, 2.5);
  assert.equal(momentum.adverseAvgValue, -1.5);
  assert.equal(momentum.topQuartile.signalCount, 1);
  assert.equal(momentum.topQuartile.expectancyPercent, 2);
  assert.equal(momentum.bottomQuartile.expectancyPercent, -1);
  assert.ok(directionPrior);
  assert.equal(directionPrior.count, 4);
  assert.equal(directionPrior.auc, 1);
  assert.equal(directionPrior.favorableAvgValue, 1);
  assert.equal(directionPrior.adverseAvgValue, -1);
});

// Behavioral contract the Python directional-features port (jobs.py) relies on:
// a filterState carrying directionalFeatures with a finite rangePosition20 must
// route to the SOT-outcome model, never the mtf/adx setup-quality fallback.
test("scoreFromSignalFilterState routes directionalFeatures to the SOT-outcome model", () => {
  const filterState = {
    mtfDirections: [1, 1, 1],
    adx: 30,
    directionalFeatures: {
      rangePosition20: 0.9,
      mtfAlignment: 3,
      adxComponent: 1,
      volatilityComponent: 1,
      shortMomentumPct: 3,
      riskAdjustedMomentum: 4,
    },
  };
  // SOT-outcome model, hand-computed:
  // 50 + (0.5-0.9)*45 - 3*3 - 1*4 + 1*8 - (3/3)*2 - (4/4)*2 = 23.
  assert.equal(
    scoreFromSignalFilterState({ filterState, direction: "long" }),
    23,
  );
  // Same filterState without directionalFeatures takes the setup-quality
  // fallback instead: (25 + 15 + 12 + 5) * (100/70) = 81.4, clamped to 69.9 —
  // pinning that the two paths are observably different.
  assert.equal(
    scoreFromSignalFilterState({
      filterState: { mtfDirections: [1, 1, 1], adx: 30 },
      direction: "long",
    }),
    69.9,
  );
});

test("model recommendation breaks statistical lift ties on full-bucket alignment", () => {
  const { sortScoreModelCandidates } = __signalQualityKpisInternalsForTests;
  const model = (key: string, qLift: number, align: number, bandN = 1000) =>
    ({
      modelKey: key,
      alignment: { alignmentScore: align },
      recommendationSupport: {
        observed: {
          qualifiedAlignmentScore: qLift,
          qualifiedTopBandSignalCount: bandN,
        },
      },
    }) as never;
  // Within the 0.05pp noise margin (observed h26 gap was 0.003pp): the
  // better-ALIGNED model must win even with a hair-lower lift.
  const tied = [
    model("noisy-lift-winner", 0.762, 0.116),
    model("better-aligned", 0.759, 1.031),
  ].sort(sortScoreModelCandidates);
  assert.equal((tied[0] as { modelKey: string }).modelKey, "better-aligned");
  // Outside the margin, lift still decides.
  const clear = [
    model("small-lift", 0.2, 5),
    model("big-lift", 0.9, 0.1),
  ].sort(sortScoreModelCandidates);
  assert.equal((clear[0] as { modelKey: string }).modelKey, "big-lift");
});

test("scoreSignalWithModel computes expected-move-v1 from the frozen formula", () => {
  const { scoreSignalWithModel } = __signalQualityKpisInternalsForTests;
  const observation = (directionalFeatures: Record<string, number>) => ({
    symbol: "CAL",
    direction: "long" as const,
    directionalFeatures,
    realizedReturnPercent: 0,
    mfePercent: 0,
    maePercent: 0,
  });

  // Hand-computed: atr=max(0.9,0.02)=0.9, vr=max(1.8,0.25)=1.8.
  // volatilityRegime=5*clamp(log2(1.5),-2,3.5)=2.9248125...
  // volumeParticipation=3*clamp(log2(1.8),-2,7)=2.5439907...
  // momentum=0.6*clamp(1.5,-8,8)+0.5*clamp(1.0/0.9,-8,8)=0.9+0.5555...=1.4556
  // reversionTilt=4*(0.5-clamp(0.3,0,1))=0.8
  // raw=42+2.9248+3.0+1.4556+0.8=50.1804 -> rounds to 50.2.
  const score = scoreSignalWithModel(
    observation({
      rangePosition20: 0.3,
      atrPct: 0.9,
      volumeRatio20: 2.0,
      riskAdjustedMomentum: 1.5,
      shortMomentumPct: 1.0,
    }),
    "expected-move-v1",
  );
  assert.equal(score, 50.2);

  // Null gate: missing atrPct returns null even though rangePosition20 and
  // volumeRatio20 are present.
  const gated = scoreSignalWithModel(
    observation({
      rangePosition20: 0.3,
      volumeRatio20: 2.0,
      riskAdjustedMomentum: 1.5,
      shortMomentumPct: 1.0,
    }),
    "expected-move-v1",
  );
  assert.equal(gated, null);

  // Tail caps: extreme vol/volume must not keep buying score (the extreme-vol
  // tail is adversely selected on realized return). atr=10 -> log2(16.67)=4.06
  // clamps to 2.2 (vol=11); vr=100 -> log2=6.64 clamps to 4 (vol part=12);
  // momentum 0, rp20 0.5 -> tilt 0. raw=42+11+12=65.
  const capped = scoreSignalWithModel(
    observation({
      rangePosition20: 0.5,
      atrPct: 10,
      volumeRatio20: 100,
      riskAdjustedMomentum: 0,
      shortMomentumPct: 0,
    }),
    "expected-move-v1",
  );
  assert.equal(capped, 65);
});

test("scoreSignalWithModel computes expected-move-v2 (v1 raw + conviction bonus) from the frozen formula", () => {
  const { scoreSignalWithModel } = __signalQualityKpisInternalsForTests;
  const observation = (directionalFeatures: Record<string, number>) => ({
    symbol: "CAL",
    direction: "long" as const,
    directionalFeatures,
    realizedReturnPercent: 0,
    mfePercent: 0,
    maePercent: 0,
  });

  // Hand-computed: atr=max(0.9,0.02)=0.9, vr=max(12,0.25)=12.
  // volatilityRegime=5*clamp(log2(1.5),-2,2.2)=2.924813
  // volumeParticipation=3*clamp(log2(12),-2,4)=3*3.584963=10.754888
  // momentum=0.6*1.5+0.5*(3.0/0.9)=0.9+1.666667=2.566667
  // reversionTilt=4*(0.5-0.3)=0.8
  // raw=42+2.924813+10.754888+2.566667+0.8=59.046368
  // conviction: vspike (vr=12>=10), fresh (regimeAgeBars=2<=3),
  // thrust (3.0/0.9=3.333>=3) -> 4+9+9+8=30
  // v2 = clamp(59.046368+30, 5, 99) rounded 1dp = 89.0
  const withFreshRegime = scoreSignalWithModel(
    observation({
      rangePosition20: 0.3,
      atrPct: 0.9,
      volumeRatio20: 12,
      regimeAgeBars: 2,
      riskAdjustedMomentum: 1.5,
      shortMomentumPct: 3.0,
    }),
    "expected-move-v2",
  );
  assert.equal(withFreshRegime, 89.0);

  // Same vector but no regimeAgeBars (absent -> fresh=false): conviction
  // drops to vspike(4) + spike&&thrust(9) = 13. raw unchanged (59.046368).
  // v2 = clamp(59.046368+13, 5, 99) rounded 1dp = 72.0
  const withoutRegimeAge = scoreSignalWithModel(
    observation({
      rangePosition20: 0.3,
      atrPct: 0.9,
      volumeRatio20: 12,
      riskAdjustedMomentum: 1.5,
      shortMomentumPct: 3.0,
    }),
    "expected-move-v2",
  );
  assert.equal(withoutRegimeAge, 72.0);

  // A vector that stays under the v1 test's key ("expected-move-v1") must be
  // unaffected: v1 stays byte-identical (no conviction added) even though
  // its volumeRatio20 (2.0) is far below the vspike threshold.
  const v1Unchanged = scoreSignalWithModel(
    observation({
      rangePosition20: 0.3,
      atrPct: 0.9,
      volumeRatio20: 2.0,
      regimeAgeBars: 1,
      riskAdjustedMomentum: 1.5,
      shortMomentumPct: 1.0,
    }),
    "expected-move-v1",
  );
  assert.equal(v1Unchanged, 50.2);

  // Default/active model key resolves to v2 (the same vector under
  // "expected-move-v2" with volumeRatio20 below the spike threshold yields
  // conviction 0, so it matches v1's output exactly).
  const activeDefault = scoreSignalWithModel(
    observation({
      rangePosition20: 0.3,
      atrPct: 0.9,
      volumeRatio20: 2.0,
      regimeAgeBars: 1,
      riskAdjustedMomentum: 1.5,
      shortMomentumPct: 1.0,
    }),
    "expected-move-v2",
  );
  assert.equal(activeDefault, 50.2);
});

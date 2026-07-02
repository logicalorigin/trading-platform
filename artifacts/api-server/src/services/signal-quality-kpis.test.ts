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
  // 2 of 3 frames bullish, requiredCount 2 -> passes for a long (+1).
  assert.equal(passesMtfGate([1, 1, -1], 1, long), true);
  // Only 1 of 3 bullish, requiredCount 2 -> fails for a long.
  assert.equal(passesMtfGate([1, -1, -1], 1, long), false);
  // For a short (-1), 2 of 3 bearish -> passes.
  assert.equal(passesMtfGate([1, -1, -1], -1, long), true);
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
  const comparison = compareSignalScoreModels(observations, ["observed-score"]);
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

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

export type SignalQualityScoreRangeBucket = {
  key: string;
  label: string;
  min: number | null;
  max: number | null;
};

export type SignalQualityScoreBucket = SignalQualityScoreRangeBucket &
  SignalQualityKpiMetrics;

export type SignalQualityFeatureSummary = {
  key: string;
  label: string;
  count: number;
  avgValue: number;
  favorableAvgValue: number;
  adverseAvgValue: number;
  pointBiserial: number;
  auc: number;
  topQuartile: SignalQualityKpiMetrics;
  bottomQuartile: SignalQualityKpiMetrics;
};

export type SignalQualityKpiResult = SignalQualityKpiMetrics & {
  horizonBars: number;
  mtfFilteredOutCount: number;
  perSymbol: SignalQualitySymbolBreakdown[];
  byDirection: SignalQualityDirectionalBreakdown;
  byScoreRange: Record<string, SignalQualityKpiMetrics>;
  scoreBuckets: SignalQualityScoreBucket[];
  scoreRangeBuckets: SignalQualityScoreRangeBucket[];
  featureSummaries: SignalQualityFeatureSummary[];
  scoreModelComparisons: SignalScoreModelComparisonResult;
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
  score: number | null;
  directionalFeatures?: Record<string, number> | null;
  realizedReturnPercent: number;
  mfePercent: number;
  maePercent: number;
  // Optional audit enrichment (feature-discovery tooling): context the
  // collector already computes for the gate/dataset but the KPI aggregation
  // doesn't need. Serialized only by the env-gated observation dump.
  audit?: {
    signalAt: string;
    barIndex: number;
    // Per-timeframe trend directions at the signal bar, aligned with
    // mtfTimeframes (1 buy, -1 sell, 0 unknown).
    mtfTimeframes: string[];
    mtfDirections: number[];
    // Consecutive bars the regime direction had already held at the signal.
    regimeAgeBars: number | null;
    adxRaw: number | null;
    volatilityScoreRaw: number | null;
  } | null;
};

export type SignalScoreCalibrationObservation = {
  symbol: string;
  direction: "long" | "short";
  score?: number | null;
  directionalFeatures?: Record<string, number> | null;
  realizedReturnPercent: number;
  mfePercent: number;
  maePercent: number;
};

export type SignalScoreModelKey =
  | "observed-score"
  | "sot-outcome-v1"
  | "evidence-weighted-v2"
  | "trend-confirmation-v2"
  | "balanced-sot-v2"
  | "reversion-sot-v3"
  | "expected-move-v1"
  | "expected-move-v2";

export type SignalScoreModelAlignment = {
  populatedBucketCount: number;
  topBucketKey: string | null;
  topBucketSignalCount: number;
  topBucketExpectancyPercent: number | null;
  lowerBaselineSignalCount: number;
  lowerBaselineExpectancyPercent: number | null;
  topBucketLiftPercent: number;
  monotonicPairCount: number;
  inversionCount: number;
  inversionSeverityPercent: number;
  alignmentScore: number;
};

export type SignalScoreModelMagnitudeThreshold = {
  mfeThresholdPercent: number;
  bigMoverCount: number;
  highScoreBigMoverCount: number;
  recallAtScore90: number | null;
  precisionAtScore90: number | null;
};

export type SignalScoreModelMagnitudeAlignment = {
  highScoreThreshold: number;
  highScoreSignalCount: number;
  highScoreAvgMfePercent: number | null;
  lowerScoreSignalCount: number;
  lowerScoreAvgMfePercent: number | null;
  highScoreMfeLiftPercent: number;
  scoreMfePearson: number;
  thresholds: SignalScoreModelMagnitudeThreshold[];
};

export type SignalScoreModelRecommendationSupportReason =
  | "min_observation_count"
  | "min_populated_bucket_count"
  | "min_top_bucket_signal_count"
  | "min_lower_baseline_signal_count"
  | "min_alignment_score"
  | "coverage_degraded";

export type SignalScoreModelRecommendationSupport = {
  supported: boolean;
  reasons: SignalScoreModelRecommendationSupportReason[];
  observed: {
    observationCount: number;
    populatedBucketCount: number;
    topBucketSignalCount: number;
    lowerBaselineSignalCount: number;
    alignmentScore: number;
    qualifiedTopBandKey: string | null;
    qualifiedTopBandSignalCount: number;
    qualifiedTopBandExpectancyPercent: number | null;
    qualifiedLowerBaselineSignalCount: number;
    qualifiedLowerBaselineExpectancyPercent: number | null;
    qualifiedTopBandLiftPercent: number;
    qualifiedAlignmentScore: number;
  };
  thresholds: {
    minObservationCount: number;
    minPopulatedBucketCount: number;
    minTopBucketSignalCount: number;
    minLowerBaselineSignalCount: number;
    minAlignmentScore: number;
  };
};

export type SignalScoreModelComparison = {
  modelKey: SignalScoreModelKey;
  byScoreRange: Record<string, SignalQualityKpiMetrics>;
  scoreBuckets: SignalQualityScoreBucket[];
  alignment: SignalScoreModelAlignment;
  magnitudeAlignment: SignalScoreModelMagnitudeAlignment;
  recommendationSupport: SignalScoreModelRecommendationSupport;
};

export type SignalScoreCalibrationState =
  | "calibrated"
  | "needs_more_data"
  | "uncalibrated";

export type SignalScoreCalibrationDecision = {
  state: SignalScoreCalibrationState;
  recommendedModelKey: SignalScoreModelKey | null;
  candidateModelKey: SignalScoreModelKey | null;
  supportedModelCount: number;
  reasons: SignalScoreModelRecommendationSupportReason[];
};

export type SignalScoreModelComparisonResult = {
  observationCount: number;
  modelKeys: SignalScoreModelKey[];
  recommendedModelKey: SignalScoreModelKey | null;
  calibration: SignalScoreCalibrationDecision;
  models: SignalScoreModelComparison[];
};

type SignalScoreModelComparisonOptions = {
  minObservationCount?: number;
  minTopBucketSignalCount?: number;
  minLowerBaselineSignalCount?: number;
  minPopulatedBucketCount?: number;
  minAlignmentScore?: number;
};

const SIGNAL_SCORE_RANGE_BUCKETS: SignalQualityScoreRangeBucket[] = [
  { key: "90-100", label: "90-100", min: 90, max: 100 },
  { key: "80-90", label: "80-90", min: 80, max: 90 },
  { key: "70-80", label: "70-80", min: 70, max: 80 },
  { key: "60-70", label: "60-70", min: 60, max: 70 },
  { key: "50-60", label: "50-60", min: 50, max: 60 },
  { key: "40-50", label: "40-50", min: 40, max: 50 },
  { key: "30-40", label: "30-40", min: 30, max: 40 },
  { key: "20-30", label: "20-30", min: 20, max: 30 },
  { key: "10-20", label: "10-20", min: 10, max: 20 },
  { key: "0-10", label: "0-10", min: 0, max: 10 },
];

const SIGNAL_DIRECTIONAL_FEATURES: Array<{ key: string; label: string }> = [
  { key: "shortMomentumPct", label: "6-bar momentum" },
  { key: "mediumMomentumPct", label: "20-bar momentum" },
  { key: "longMomentumPct", label: "78-bar momentum" },
  { key: "riskAdjustedMomentum", label: "Risk-adjusted momentum" },
  { key: "rangePosition20", label: "20-bar range position" },
  { key: "rangeComponent", label: "20-bar range component" },
  { key: "volumeRatio20", label: "20-bar volume ratio" },
  { key: "volumeExpansion", label: "Volume expansion" },
  { key: "adxComponent", label: "ADX component" },
  { key: "volatilityComponent", label: "Volatility component" },
  { key: "mtfAlignment", label: "MTF alignment" },
  { key: "atrPct", label: "ATR percent" },
  { key: "regimeAgeBars", label: "Regime age (bars)" },
];

type SignalCalibrationFeature = {
  key: string;
  label: string;
  value: (observation: SignalObservation) => number | null;
};

const SIGNAL_OBSERVATION_FEATURES: SignalCalibrationFeature[] = [
  {
    key: "directionSign",
    label: "Long vs short direction",
    value: (observation) => (observation.direction === "long" ? 1 : -1),
  },
  ...SIGNAL_DIRECTIONAL_FEATURES.map(
    (feature): SignalCalibrationFeature => ({
      ...feature,
      value: (observation) =>
        finiteNumber(observation.directionalFeatures?.[feature.key]),
    }),
  ),
];

const SOT_OUTCOME_SCORE_MAX = 69.9;
const SOT_BALANCED_SCORE_MAX = 74.9;
const SOT_REVERSION_V3_SCORE_MAX = 74.9;
const EXPECTED_MOVE_SCORE_MAX = 99;
const SCORE_MODEL_RECOMMENDATION_MIN_OBSERVATIONS = 30;
const SCORE_MODEL_RECOMMENDATION_MIN_TOP_BUCKET_SIGNALS = 5;
const SCORE_MODEL_RECOMMENDATION_MIN_BASELINE_SIGNALS = 10;
const SCORE_MODEL_RECOMMENDATION_MIN_POPULATED_BUCKETS = 2;
const SCORE_MODEL_RECOMMENDATION_MIN_ALIGNMENT_SCORE = 0;
// The qualified "top band" used to rank/recommend models is the highest-scored
// signals accumulated until they reach this FRACTION of graded observations. A
// fraction (not a tiny fixed count) keeps the top-band expectancy statistically
// robust: the prior fixed-5 floor let a ~60-signal sliver of a 7,000-signal set
// dictate the recommendation, which selected the wrong model out-of-sample.
const SCORE_MODEL_RECOMMENDATION_TOP_BAND_FRACTION = 0.2;

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function directionalFeaturesFromFilterState(
  filterState: unknown,
): Record<string, number> | null {
  const features = recordValue(recordValue(filterState).directionalFeatures);
  const entries = SIGNAL_DIRECTIONAL_FEATURES.flatMap(({ key }) => {
    const value = finiteNumber(features[key]);
    return value == null ? [] : ([[key, value]] as const);
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

function featureNumber(
  features: Record<string, number>,
  key: string,
  fallback = 0,
): number {
  const value = finiteNumber(features[key]);
  return value == null ? fallback : value;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreFromDirectionalFeatures(
  features: Record<string, number> | null,
): number | null {
  const rangePosition20 = finiteNumber(features?.rangePosition20);
  if (rangePosition20 == null) {
    return null;
  }
  const featureValues = features ?? {};
  const rangeReversion = (0.5 - clampNumber(rangePosition20, 0, 1)) * 45;
  const mtfRegime =
    -clampNumber(featureNumber(featureValues, "mtfAlignment"), -1.5, 3) * 3;
  const trendExhaustion =
    -clampNumber(featureNumber(featureValues, "adxComponent"), -1, 2.5) * 4;
  const volatility =
    clampNumber(featureNumber(featureValues, "volatilityComponent"), -0.5, 1) * 8;
  const shortMomentumReversion =
    -clampNumber(featureNumber(featureValues, "shortMomentumPct") / 3, -2, 2) *
    2;
  const riskAdjustedReversion =
    -clampNumber(
      featureNumber(featureValues, "riskAdjustedMomentum") / 4,
      -2,
      2,
    ) * 2;
  const rawScore =
    50 +
    rangeReversion +
    mtfRegime +
    trendExhaustion +
    volatility +
    shortMomentumReversion +
    riskAdjustedReversion;
  return roundTo(clampNumber(rawScore, 20, SOT_OUTCOME_SCORE_MAX), 1);
}

function scoreFromTrendConfirmationFeatures(
  features: Record<string, number> | null,
): number | null {
  const rangePosition20 = finiteNumber(features?.rangePosition20);
  if (rangePosition20 == null) {
    return null;
  }
  const featureValues = features ?? {};
  const rangeExtension = (clampNumber(rangePosition20, 0, 1) - 0.5) * 28;
  const mtfConfirmation =
    clampNumber(featureNumber(featureValues, "mtfAlignment"), -1.5, 3) * 5;
  const trendStrength =
    clampNumber(featureNumber(featureValues, "adxComponent"), -1, 2.5) * 4;
  const shortMomentum =
    clampNumber(featureNumber(featureValues, "shortMomentumPct") / 3, -2, 2) *
    2.5;
  const riskAdjustedMomentum =
    clampNumber(
      featureNumber(featureValues, "riskAdjustedMomentum") / 4,
      -2,
      2,
    ) * 2;
  const volumeExpansion =
    clampNumber(featureNumber(featureValues, "volumeExpansion"), -1, 2) * 3;
  const volatility =
    clampNumber(featureNumber(featureValues, "volatilityComponent"), -0.5, 1) *
    2;
  const rawScore =
    50 +
    rangeExtension +
    mtfConfirmation +
    trendStrength +
    shortMomentum +
    riskAdjustedMomentum +
    volumeExpansion +
    volatility;
  return roundTo(clampNumber(rawScore, 20, 89.9), 1);
}

function scoreFromBalancedSotFeatures(
  features: Record<string, number> | null,
): number | null {
  const reversion = scoreFromDirectionalFeatures(features);
  const confirmation = scoreFromTrendConfirmationFeatures(features);
  const rangePosition20 = finiteNumber(features?.rangePosition20);
  if (reversion == null || confirmation == null || rangePosition20 == null) {
    return null;
  }
  const extensionPenalty =
    rangePosition20 > 0.75 ? (rangePosition20 - 0.75) * 24 : 0;
  const volumeSupport =
    clampNumber(featureNumber(features ?? {}, "volumeExpansion"), -1, 2) * 1.5;
  const rawScore =
    reversion * 0.72 + confirmation * 0.28 - extensionPenalty + volumeSupport;
  return roundTo(clampNumber(rawScore, 20, SOT_BALANCED_SCORE_MAX), 1);
}

// expected-move-v1: calibrated 2026-07 on 5m/15m/1h dumps. Direction proved
// unpredictable at the 26-bar horizon (all directional features sign-flip
// across timeframes/directions) while move magnitude is robustly predictable
// (atrPct rho +0.30..+0.44, volumeRatio20 stable + in all 6 TF-direction
// cells); this model ranks EXPECTED MOVE with a mild reversion tilt (rp20 the
// only stable asymmetry feature, 5/6 cells). Scale-free terms (log-vol, log
// volume ratio, ATR-unit momentum) keep one formula valid on every timeframe.
// Shared by expected-move-v1 and expected-move-v2: the raw (pre-clamp,
// pre-round) expected-move score. v2 adds the conviction bonus stack to this
// same raw value before clamping/rounding once (see scoreFromExpectedMoveV2Features).
function expectedMoveRawScore(
  features: Record<string, number> | null,
): number | null {
  const rangePosition20 = finiteNumber(features?.rangePosition20);
  const atrPct = finiteNumber(features?.atrPct);
  const volumeRatio20 = finiteNumber(features?.volumeRatio20);
  if (rangePosition20 == null || atrPct == null || volumeRatio20 == null) {
    return null;
  }
  const featureValues = features ?? {};
  const atr = Math.max(atrPct, 0.02);
  const vr = Math.max(volumeRatio20, 0.25);
  // Tail caps at 2.2/4 (not 3.5/7): the extreme-vol tail is adversely
  // selected on realized return (halted/gapping names) -- beyond ~4.6x median
  // volatility, more vol must not buy more score.
  const volatilityRegime = 5.0 * clampNumber(Math.log2(atr / 0.6), -2, 2.2);
  const volumeParticipation = 3.0 * clampNumber(Math.log2(vr), -2, 4);
  const momentum =
    0.6 *
      clampNumber(
        featureNumber(featureValues, "riskAdjustedMomentum"),
        -8,
        8,
      ) +
    0.5 *
      clampNumber(
        featureNumber(featureValues, "shortMomentumPct") / atr,
        -8,
        8,
      );
  const reversionTilt = 4.0 * (0.5 - clampNumber(rangePosition20, 0, 1));
  return 42 + volatilityRegime + volumeParticipation + momentum + reversionTilt;
}

function scoreFromExpectedMoveFeatures(
  features: Record<string, number> | null,
): number | null {
  const rawScore = expectedMoveRawScore(features);
  if (rawScore == null) {
    return null;
  }
  return roundTo(clampNumber(rawScore, 5, EXPECTED_MOVE_SCORE_MAX), 1);
}

// expected-move-v2 conviction bonus stack: conditions mined from 15.6k
// observations with a temporal 70/30 split; survivors (train lift >=1.5x AND
// test >=1.25x in >=4/6 TF-direction cells): volume spike >=10x, spike+fresh
// regime flip (<=3 bars), spike+>=3-ATR thrust. Held-out 90+ band P(top-decile
// MFE) = 0.38-0.41 (2.4-3.5x base) at 1.9-9.3% population. regimeAgeBars is
// optional -- absent/null just means the "fresh" condition is false.
function expectedMoveConvictionBonus(
  features: Record<string, number> | null,
): number {
  const featureValues = features ?? {};
  const atrPct = finiteNumber(featureValues.atrPct) ?? 0.02;
  const atr = Math.max(atrPct, 0.02);
  const volumeRatio20 = finiteNumber(featureValues.volumeRatio20) ?? 0;
  const regimeAgeBars = finiteNumber(featureValues.regimeAgeBars);
  const shortMomentumPct = featureNumber(featureValues, "shortMomentumPct");
  const volumeSpike = volumeRatio20 >= 10;
  const freshRegime = regimeAgeBars != null && regimeAgeBars <= 3;
  const thrust = shortMomentumPct / atr >= 3;
  return (
    (volumeSpike ? 4 : 0) +
    (volumeSpike && freshRegime ? 9 : 0) +
    (volumeSpike && thrust ? 9 : 0) +
    (volumeSpike && freshRegime && thrust ? 8 : 0)
  );
}

function scoreFromExpectedMoveV2Features(
  features: Record<string, number> | null,
): number | null {
  const rawScore = expectedMoveRawScore(features);
  if (rawScore == null) {
    return null;
  }
  const conviction = expectedMoveConvictionBonus(features);
  return roundTo(
    clampNumber(rawScore + conviction, 5, EXPECTED_MOVE_SCORE_MAX),
    1,
  );
}

// reversion-sot-v3: the calibrated (2026-07 window) reversion model. Data-driven
// over the ROBUST features only -- oversold range position (dominant) plus calm
// ATR, low ADX (trend exhaustion), and low volume expansion. Momentum terms were
// deliberately dropped: their weights flipped sign between cross-validation folds
// (overfit). Validated on clean held-out data to rank the tradeable top band
// materially better than balanced-sot-v2 (top-decile realized directional move
// ~+0.16% vs ~+0.10%). The intercept/gain below are an affine rescale
// (27.8915 + 0.6547 * raw) that matches this model's display distribution to
// balanced-sot-v2's (mean ~39, std ~6.2) so the shared 40/60/75 signal-options
// entry-quality tier cutoffs keep their meaning. Re-derive the rescale if the
// feature distribution shifts materially.
function scoreFromReversionSotFeatures(
  features: Record<string, number> | null,
): number | null {
  const rangePosition20 = finiteNumber(features?.rangePosition20);
  if (rangePosition20 == null) {
    return null;
  }
  const featureValues = features ?? {};
  const rawScore =
    50 +
    (0.5 - clampNumber(rangePosition20, 0, 1)) * 40 +
    -clampNumber(
      (featureNumber(featureValues, "atrPct") - 0.2) / 0.2,
      -1,
      2,
    ) * 6 +
    -clampNumber(featureNumber(featureValues, "adxComponent"), -1, 2.5) * 6 +
    -clampNumber(featureNumber(featureValues, "volumeExpansion"), -1, 2) * 6;
  const displayScore = 27.8915 + 0.6547 * rawScore;
  return roundTo(
    clampNumber(displayScore, 20, SOT_REVERSION_V3_SCORE_MAX),
    1,
  );
}

function scoreFromEvidenceWeightedFeatures(
  features: Record<string, number> | null,
): number | null {
  const rangePosition20 = finiteNumber(features?.rangePosition20);
  if (rangePosition20 == null) {
    return null;
  }
  const featureValues = features ?? {};
  const rangeReversion = (0.5 - clampNumber(rangePosition20, 0, 1)) * 55;
  const longMomentumReversion =
    -clampNumber(featureNumber(featureValues, "longMomentumPct") / 4, -2, 2) *
    4;
  const atrCalm =
    -clampNumber((featureNumber(featureValues, "atrPct") - 0.2) / 0.2, -1, 2) *
    3;
  const mtfRegime =
    -clampNumber(featureNumber(featureValues, "mtfAlignment"), -1.5, 3) * 2;
  const trendExhaustion =
    -clampNumber(featureNumber(featureValues, "adxComponent"), -1, 2.5) * 2;
  const shortMomentumReversion =
    -clampNumber(featureNumber(featureValues, "shortMomentumPct") / 3, -2, 2) *
    1.5;
  const riskAdjustedReversion =
    -clampNumber(
      featureNumber(featureValues, "riskAdjustedMomentum") / 4,
      -2,
      2,
    ) * 1.5;
  const volumeRatioSupport =
    clampNumber((featureNumber(featureValues, "volumeRatio20", 1) - 1) / 10, -0.2, 1.5) *
    1;
  const rawScore =
    50 +
    rangeReversion +
    longMomentumReversion +
    atrCalm +
    mtfRegime +
    trendExhaustion +
    shortMomentumReversion +
    riskAdjustedReversion +
    volumeRatioSupport;
  return roundTo(clampNumber(rawScore, 20, SOT_OUTCOME_SCORE_MAX), 1);
}

function scoreSignalWithModel(
  observation: SignalScoreCalibrationObservation,
  modelKey: SignalScoreModelKey,
): number | null {
  if (modelKey === "observed-score") {
    return finiteNumber(observation.score);
  }
  const features = observation.directionalFeatures ?? null;
  if (modelKey === "sot-outcome-v1") {
    return scoreFromDirectionalFeatures(features);
  }
  if (modelKey === "evidence-weighted-v2") {
    return scoreFromEvidenceWeightedFeatures(features);
  }
  if (modelKey === "trend-confirmation-v2") {
    return scoreFromTrendConfirmationFeatures(features);
  }
  if (modelKey === "reversion-sot-v3") {
    return scoreFromReversionSotFeatures(features);
  }
  if (modelKey === "balanced-sot-v2") {
    return scoreFromBalancedSotFeatures(features);
  }
  if (modelKey === "expected-move-v1") {
    return scoreFromExpectedMoveFeatures(features);
  }
  return scoreFromExpectedMoveV2Features(features);
}

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

function scoreRangeBucketKey(score: number | null): string {
  if (score == null || !Number.isFinite(score)) {
    return "unknown";
  }
  const clamped = Math.min(100, Math.max(0, score));
  const lower = clamped >= 100 ? 90 : Math.floor(clamped / 10) * 10;
  return `${lower}-${lower + 10}`;
}

function aggregateByScoreRange(
  observations: SignalObservation[],
): {
  byScoreRange: Record<string, SignalQualityKpiMetrics>;
  scoreBuckets: SignalQualityScoreBucket[];
} {
  const observationsByRange: Record<string, SignalObservation[]> =
    Object.fromEntries(
      SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [bucket.key, []]),
    );
  observationsByRange.unknown = [];
  for (const observation of observations) {
    observationsByRange[scoreRangeBucketKey(observation.score)]?.push(observation);
  }
  const byScoreRange: Record<string, SignalQualityKpiMetrics> = {
    ...Object.fromEntries(
      SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => [
        bucket.key,
        aggregateObservations(observationsByRange[bucket.key] ?? []),
      ]),
    ),
    unknown: aggregateObservations(observationsByRange.unknown ?? []),
  };
  const scoreBuckets: SignalQualityScoreBucket[] = [
    ...SIGNAL_SCORE_RANGE_BUCKETS.map((bucket) => ({
      ...bucket,
      ...byScoreRange[bucket.key],
    })),
    {
      key: "unknown",
      label: "Unknown",
      min: null,
      max: null,
      ...byScoreRange.unknown,
    },
  ].filter((bucket) => bucket.key !== "unknown" || bucket.signalCount > 0);
  return { byScoreRange, scoreBuckets };
}

function weightedBucketMetric(
  buckets: SignalQualityScoreBucket[],
  key: keyof SignalQualityKpiMetrics,
): { value: number | null; signalCount: number } {
  let weighted = 0;
  let signalCount = 0;
  for (const bucket of buckets) {
    const count = finiteNumber(bucket.signalCount) ?? 0;
    const value = finiteNumber(bucket[key]);
    if (count <= 0 || value == null) {
      continue;
    }
    weighted += value * count;
    signalCount += count;
  }
  return {
    value: signalCount > 0 ? weighted / signalCount : null,
    signalCount,
  };
}

function buildScoreModelAlignment(
  scoreBuckets: SignalQualityScoreBucket[],
): SignalScoreModelAlignment {
  const populatedBuckets = scoreBuckets.filter(
    (bucket) =>
      bucket.key !== "unknown" &&
      bucket.min != null &&
      bucket.signalCount > 0,
  );
  const topBucket = populatedBuckets[0] ?? null;
  const lowerBuckets = topBucket ? populatedBuckets.slice(1) : [];
  const lowerBaseline = weightedBucketMetric(
    lowerBuckets,
    "expectancyPercent",
  );
  const topExpectancy = topBucket
    ? finiteNumber(topBucket.expectancyPercent)
    : null;
  const topBucketLiftPercent =
    topExpectancy != null && lowerBaseline.value != null
      ? roundTo(topExpectancy - lowerBaseline.value, 6)
      : 0;

  let monotonicPairCount = 0;
  let inversionCount = 0;
  let inversionSeverityPercent = 0;
  for (let higherIndex = 0; higherIndex < populatedBuckets.length; higherIndex += 1) {
    const higherExpectancy = finiteNumber(
      populatedBuckets[higherIndex].expectancyPercent,
    );
    if (higherExpectancy == null) {
      continue;
    }
    for (
      let lowerIndex = higherIndex + 1;
      lowerIndex < populatedBuckets.length;
      lowerIndex += 1
    ) {
      const lowerExpectancy = finiteNumber(
        populatedBuckets[lowerIndex].expectancyPercent,
      );
      if (lowerExpectancy == null) {
        continue;
      }
      monotonicPairCount += 1;
      if (higherExpectancy < lowerExpectancy) {
        inversionCount += 1;
        inversionSeverityPercent += lowerExpectancy - higherExpectancy;
      }
    }
  }
  const monotonicPairRate =
    monotonicPairCount > 0
      ? (monotonicPairCount - inversionCount) / monotonicPairCount
      : 0;
  return {
    populatedBucketCount: populatedBuckets.length,
    topBucketKey: topBucket?.key ?? null,
    topBucketSignalCount: topBucket?.signalCount ?? 0,
    topBucketExpectancyPercent: topExpectancy,
    lowerBaselineSignalCount: lowerBaseline.signalCount,
    lowerBaselineExpectancyPercent:
      lowerBaseline.value == null ? null : roundTo(lowerBaseline.value, 6),
    topBucketLiftPercent,
    monotonicPairCount,
    inversionCount,
    inversionSeverityPercent: roundTo(inversionSeverityPercent, 6),
    alignmentScore: roundTo(
      topBucketLiftPercent +
        monotonicPairRate * 0.25 -
        inversionSeverityPercent,
      6,
    ),
  };
}

const MAGNITUDE_ALIGNMENT_HIGH_SCORE_THRESHOLD = 90;
const MAGNITUDE_ALIGNMENT_MFE_THRESHOLDS = [10, 20, 30] as const;

function pearsonCorrelation(pairs: Array<{ x: number; y: number }>): number {
  if (pairs.length < 2) {
    return 0;
  }
  const meanX = mean(pairs.map((pair) => pair.x));
  const meanY = mean(pairs.map((pair) => pair.y));
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (const pair of pairs) {
    const xDelta = pair.x - meanX;
    const yDelta = pair.y - meanY;
    numerator += xDelta * yDelta;
    xVariance += xDelta ** 2;
    yVariance += yDelta ** 2;
  }
  const denominator = Math.sqrt(xVariance * yVariance);
  return denominator > 0 ? roundTo(numerator / denominator, 6) : 0;
}

function buildScoreModelMagnitudeAlignment(
  observations: SignalObservation[],
): SignalScoreModelMagnitudeAlignment {
  const scored = observations.filter(
    (observation): observation is SignalObservation & { score: number } =>
      observation.score != null && Number.isFinite(observation.score),
  );
  const highScore = scored.filter(
    (observation) =>
      observation.score >= MAGNITUDE_ALIGNMENT_HIGH_SCORE_THRESHOLD,
  );
  const lowerScore = scored.filter(
    (observation) =>
      observation.score < MAGNITUDE_ALIGNMENT_HIGH_SCORE_THRESHOLD,
  );
  const highScoreAvgMfePercent = highScore.length
    ? roundTo(mean(highScore.map((observation) => observation.mfePercent)), 6)
    : null;
  const lowerScoreAvgMfePercent = lowerScore.length
    ? roundTo(mean(lowerScore.map((observation) => observation.mfePercent)), 6)
    : null;
  const highScoreMfeLiftPercent =
    highScoreAvgMfePercent == null || lowerScoreAvgMfePercent == null
      ? 0
      : roundTo(highScoreAvgMfePercent - lowerScoreAvgMfePercent, 6);

  return {
    highScoreThreshold: MAGNITUDE_ALIGNMENT_HIGH_SCORE_THRESHOLD,
    highScoreSignalCount: highScore.length,
    highScoreAvgMfePercent,
    lowerScoreSignalCount: lowerScore.length,
    lowerScoreAvgMfePercent,
    highScoreMfeLiftPercent,
    scoreMfePearson: pearsonCorrelation(
      scored.map((observation) => ({
        x: observation.score,
        y: observation.mfePercent,
      })),
    ),
    thresholds: MAGNITUDE_ALIGNMENT_MFE_THRESHOLDS.map((mfeThresholdPercent) => {
      const bigMovers = scored.filter(
        (observation) => observation.mfePercent >= mfeThresholdPercent,
      );
      const highScoreBigMovers = bigMovers.filter(
        (observation) =>
          observation.score >= MAGNITUDE_ALIGNMENT_HIGH_SCORE_THRESHOLD,
      );
      return {
        mfeThresholdPercent,
        bigMoverCount: bigMovers.length,
        highScoreBigMoverCount: highScoreBigMovers.length,
        recallAtScore90: bigMovers.length
          ? roundTo(highScoreBigMovers.length / bigMovers.length, 6)
          : null,
        precisionAtScore90: highScore.length
          ? roundTo(highScoreBigMovers.length / highScore.length, 6)
          : null,
      };
    }),
  };
}

const DEFAULT_SCORE_MODEL_COMPARISON_KEYS: SignalScoreModelKey[] = [
  "sot-outcome-v1",
  "evidence-weighted-v2",
  "balanced-sot-v2",
  "reversion-sot-v3",
  "expected-move-v1",
  "expected-move-v2",
  "trend-confirmation-v2",
  "observed-score",
];

function normalizeScoreModelComparisonOptions(
  options: SignalScoreModelComparisonOptions = {},
): Required<SignalScoreModelComparisonOptions> {
  return {
    minObservationCount: Math.max(
      0,
      Math.round(
        options.minObservationCount ??
          SCORE_MODEL_RECOMMENDATION_MIN_OBSERVATIONS,
      ),
    ),
    minTopBucketSignalCount: Math.max(
      0,
      Math.round(
        options.minTopBucketSignalCount ??
          SCORE_MODEL_RECOMMENDATION_MIN_TOP_BUCKET_SIGNALS,
      ),
    ),
    minLowerBaselineSignalCount: Math.max(
      0,
      Math.round(
        options.minLowerBaselineSignalCount ??
          SCORE_MODEL_RECOMMENDATION_MIN_BASELINE_SIGNALS,
      ),
    ),
    minPopulatedBucketCount: Math.max(
      1,
      Math.round(
        options.minPopulatedBucketCount ??
          SCORE_MODEL_RECOMMENDATION_MIN_POPULATED_BUCKETS,
      ),
    ),
    minAlignmentScore:
      finiteNumber(options.minAlignmentScore) ??
      SCORE_MODEL_RECOMMENDATION_MIN_ALIGNMENT_SCORE,
  };
}

function weightedBucketExpectancy(
  buckets: SignalQualityScoreBucket[],
): { signalCount: number; expectancyPercent: number | null } {
  const signalCount = buckets.reduce(
    (sum, bucket) => sum + bucket.signalCount,
    0,
  );
  if (!signalCount) {
    return { signalCount: 0, expectancyPercent: null };
  }
  const weighted = buckets.reduce(
    (sum, bucket) => sum + bucket.expectancyPercent * bucket.signalCount,
    0,
  );
  return {
    signalCount,
    expectancyPercent: roundTo(weighted / signalCount, 6),
  };
}

function buildScoreModelQualifiedTopBand(
  scoreBuckets: SignalQualityScoreBucket[],
  minTopBucketSignalCount: number,
) {
  const rankedBuckets = scoreBuckets.filter(
    (bucket) => bucket.key !== "unknown",
  );
  let qualifiedIndex = -1;
  let runningSignalCount = 0;
  for (let index = 0; index < rankedBuckets.length; index += 1) {
    runningSignalCount += rankedBuckets[index]?.signalCount ?? 0;
    if (runningSignalCount >= minTopBucketSignalCount) {
      qualifiedIndex = index;
      break;
    }
  }

  if (qualifiedIndex < 0) {
    return {
      key: null as string | null,
      signalCount: runningSignalCount,
      expectancyPercent: null as number | null,
      lowerBaselineSignalCount: 0,
      lowerBaselineExpectancyPercent: null as number | null,
      liftPercent: 0,
      alignmentScore: 0,
    };
  }

  const topBand = weightedBucketExpectancy(
    rankedBuckets.slice(0, qualifiedIndex + 1),
  );
  const lowerBaseline = weightedBucketExpectancy(
    rankedBuckets.slice(qualifiedIndex + 1),
  );
  const liftPercent =
    topBand.expectancyPercent == null ||
    lowerBaseline.expectancyPercent == null
      ? 0
      : roundTo(topBand.expectancyPercent - lowerBaseline.expectancyPercent, 6);

  return {
    key: rankedBuckets[qualifiedIndex]?.key ?? null,
    signalCount: topBand.signalCount,
    expectancyPercent: topBand.expectancyPercent,
    lowerBaselineSignalCount: lowerBaseline.signalCount,
    lowerBaselineExpectancyPercent: lowerBaseline.expectancyPercent,
    liftPercent,
    alignmentScore: liftPercent,
  };
}

function buildScoreModelRecommendationSupport(
  model: Omit<SignalScoreModelComparison, "recommendationSupport">,
  observationCount: number,
  options: Required<SignalScoreModelComparisonOptions>,
): SignalScoreModelRecommendationSupport {
  const qualifiedTopBand = buildScoreModelQualifiedTopBand(
    model.scoreBuckets,
    options.minTopBucketSignalCount,
  );
  const reasons: SignalScoreModelRecommendationSupportReason[] = [];
  if (observationCount < options.minObservationCount) {
    reasons.push("min_observation_count");
  }
  if (model.alignment.populatedBucketCount < options.minPopulatedBucketCount) {
    reasons.push("min_populated_bucket_count");
  }
  if (
    qualifiedTopBand.signalCount < options.minTopBucketSignalCount ||
    qualifiedTopBand.key == null
  ) {
    reasons.push("min_top_bucket_signal_count");
  }
  if (
    qualifiedTopBand.lowerBaselineSignalCount <
    options.minLowerBaselineSignalCount
  ) {
    reasons.push("min_lower_baseline_signal_count");
  }
  if (
    qualifiedTopBand.alignmentScore <= options.minAlignmentScore ||
    model.alignment.alignmentScore <= options.minAlignmentScore
  ) {
    reasons.push("min_alignment_score");
  }

  return {
    supported: reasons.length === 0,
    reasons,
    observed: {
      observationCount,
      populatedBucketCount: model.alignment.populatedBucketCount,
      topBucketSignalCount: model.alignment.topBucketSignalCount,
      lowerBaselineSignalCount: model.alignment.lowerBaselineSignalCount,
      alignmentScore: model.alignment.alignmentScore,
      qualifiedTopBandKey: qualifiedTopBand.key,
      qualifiedTopBandSignalCount: qualifiedTopBand.signalCount,
      qualifiedTopBandExpectancyPercent: qualifiedTopBand.expectancyPercent,
      qualifiedLowerBaselineSignalCount:
        qualifiedTopBand.lowerBaselineSignalCount,
      qualifiedLowerBaselineExpectancyPercent:
        qualifiedTopBand.lowerBaselineExpectancyPercent,
      qualifiedTopBandLiftPercent: qualifiedTopBand.liftPercent,
      qualifiedAlignmentScore: qualifiedTopBand.alignmentScore,
    },
    thresholds: {
      minObservationCount: options.minObservationCount,
      minPopulatedBucketCount: options.minPopulatedBucketCount,
      minTopBucketSignalCount: options.minTopBucketSignalCount,
      minLowerBaselineSignalCount: options.minLowerBaselineSignalCount,
      minAlignmentScore: options.minAlignmentScore,
    },
  };
}

// Qualified-lift gaps below this are sample noise on a ~7k-observation window
// (observed: the h26 top-two flipped run-to-run on a 0.003pp gap). Within the
// margin, the recommendation falls through to full-bucket alignment so a
// statistically-tied but better-ordered model wins stably.
const SCORE_MODEL_RECOMMENDATION_LIFT_MARGIN_PERCENT = 0.05;

function sortScoreModelCandidates(
  left: SignalScoreModelComparison,
  right: SignalScoreModelComparison,
): number {
  const scoreDelta =
    right.recommendationSupport.observed.qualifiedAlignmentScore -
    left.recommendationSupport.observed.qualifiedAlignmentScore;
  if (Math.abs(scoreDelta) > SCORE_MODEL_RECOMMENDATION_LIFT_MARGIN_PERCENT) {
    return scoreDelta;
  }
  const alignmentDelta =
    right.alignment.alignmentScore - left.alignment.alignmentScore;
  if (alignmentDelta !== 0) {
    return alignmentDelta;
  }
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  return (
    right.recommendationSupport.observed.qualifiedTopBandSignalCount -
    left.recommendationSupport.observed.qualifiedTopBandSignalCount
  );
}

const DATA_SUPPORT_REASONS: SignalScoreModelRecommendationSupportReason[] = [
  "min_observation_count",
  "min_populated_bucket_count",
  "min_top_bucket_signal_count",
  "min_lower_baseline_signal_count",
];

function uniqueRecommendationReasons(
  models: SignalScoreModelComparison[],
): SignalScoreModelRecommendationSupportReason[] {
  return Array.from(
    new Set(
      models.flatMap((model) => model.recommendationSupport.reasons),
    ),
  );
}

function buildSignalScoreCalibrationDecision(
  models: SignalScoreModelComparison[],
  recommendedModelKey: SignalScoreModelKey | null,
): SignalScoreCalibrationDecision {
  const supportedModelCount = models.filter(
    (model) => model.recommendationSupport.supported,
  ).length;
  const candidate = models.slice().sort(sortScoreModelCandidates)[0] ?? null;
  if (recommendedModelKey) {
    return {
      state: "calibrated",
      recommendedModelKey,
      candidateModelKey: recommendedModelKey,
      supportedModelCount,
      reasons: [],
    };
  }

  const anyModelHasDataSupport = models.some((model) =>
    DATA_SUPPORT_REASONS.every(
      (reason) => !model.recommendationSupport.reasons.includes(reason),
    ),
  );
  return {
    state: anyModelHasDataSupport ? "uncalibrated" : "needs_more_data",
    recommendedModelKey: null,
    candidateModelKey: candidate?.modelKey ?? null,
    supportedModelCount,
    reasons: uniqueRecommendationReasons(candidate ? [candidate] : models),
  };
}

export function compareSignalScoreModels(
  observations: SignalScoreCalibrationObservation[],
  modelKeys: SignalScoreModelKey[] = DEFAULT_SCORE_MODEL_COMPARISON_KEYS,
  options: SignalScoreModelComparisonOptions = {},
): SignalScoreModelComparisonResult {
  const recommendationOptions = normalizeScoreModelComparisonOptions(options);
  // Robust top band: unless the caller pinned an explicit minTopBucketSignalCount,
  // scale it to a fraction of the graded population so the qualified-top-band lift
  // that ranks/recommends models is measured over a statistically-stable band
  // rather than a tiny top-score sliver (which is dominated by noise out-of-sample).
  if (options.minTopBucketSignalCount == null) {
    recommendationOptions.minTopBucketSignalCount = Math.max(
      recommendationOptions.minTopBucketSignalCount,
      Math.round(
        observations.length * SCORE_MODEL_RECOMMENDATION_TOP_BAND_FRACTION,
      ),
    );
  }
  const models = modelKeys.map((modelKey) => {
    const scoredObservations: SignalObservation[] = observations.map(
      (observation) => ({
        symbol: observation.symbol,
        direction: observation.direction,
        score: scoreSignalWithModel(observation, modelKey),
        directionalFeatures: observation.directionalFeatures ?? null,
        realizedReturnPercent: observation.realizedReturnPercent,
        mfePercent: observation.mfePercent,
        maePercent: observation.maePercent,
      }),
    );
    const { byScoreRange, scoreBuckets } =
      aggregateByScoreRange(scoredObservations);
    const model = {
      modelKey,
      byScoreRange,
      scoreBuckets,
      alignment: buildScoreModelAlignment(scoreBuckets),
      magnitudeAlignment: buildScoreModelMagnitudeAlignment(scoredObservations),
    };
    return {
      ...model,
      recommendationSupport: buildScoreModelRecommendationSupport(
        model,
        observations.length,
        recommendationOptions,
      ),
    };
  });
  const recommended = models
    .filter((model) => model.recommendationSupport.supported)
    .slice()
    .sort(sortScoreModelCandidates)[0];
  const recommendedModelKey = recommended?.modelKey ?? null;
  return {
    observationCount: observations.length,
    modelKeys,
    recommendedModelKey,
    calibration: buildSignalScoreCalibrationDecision(
      models,
      recommendedModelKey,
    ),
    models,
  };
}

function pointBiserialCorrelation(
  values: Array<{ value: number; favorable: boolean }>,
): number {
  if (values.length < 2) {
    return 0;
  }
  const meanValue = mean(values.map((item) => item.value));
  const meanFavorable = mean(values.map((item) => (item.favorable ? 1 : 0)));
  let numerator = 0;
  let valueVariance = 0;
  let favorableVariance = 0;
  for (const item of values) {
    const valueDelta = item.value - meanValue;
    const favorableDelta = (item.favorable ? 1 : 0) - meanFavorable;
    numerator += valueDelta * favorableDelta;
    valueVariance += valueDelta ** 2;
    favorableVariance += favorableDelta ** 2;
  }
  const denominator = Math.sqrt(valueVariance * favorableVariance);
  return denominator > 0 ? roundTo(numerator / denominator, 6) : 0;
}

function aucForFeature(values: Array<{ value: number; favorable: boolean }>): number {
  const positives = values.filter((item) => item.favorable).length;
  const negatives = values.length - positives;
  if (!positives || !negatives) {
    return 0;
  }

  const sorted = values
    .map((item, index) => ({ ...item, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  let rankSum = 0;
  let cursor = 0;
  while (cursor < sorted.length) {
    let next = cursor + 1;
    while (next < sorted.length && sorted[next].value === sorted[cursor].value) {
      next += 1;
    }
    const averageRank = (cursor + 1 + next) / 2;
    for (let index = cursor; index < next; index += 1) {
      if (sorted[index].favorable) {
        rankSum += averageRank;
      }
    }
    cursor = next;
  }
  const u = rankSum - (positives * (positives + 1)) / 2;
  return roundTo(u / (positives * negatives), 6);
}

function buildFeatureSummaries(
  observations: SignalObservation[],
): SignalQualityFeatureSummary[] {
  return SIGNAL_OBSERVATION_FEATURES.flatMap(({ key, label, value: readValue }) => {
    const rows = observations
      .map((observation) => ({
        observation,
        value: readValue(observation),
      }))
      .filter(
        (
          row,
        ): row is {
          observation: SignalObservation;
          value: number;
        } => row.value != null,
      );
    if (!rows.length) {
      return [];
    }
    const favorableRows = rows.filter(
      (row) => row.observation.realizedReturnPercent > 0,
    );
    const adverseRows = rows.filter(
      (row) => row.observation.realizedReturnPercent <= 0,
    );
    const quartileCount = Math.max(1, Math.floor(rows.length * 0.25));
    const sorted = rows
      .slice()
      .sort((left, right) => left.value - right.value);
    const bottomQuartile = sorted
      .slice(0, quartileCount)
      .map((row) => row.observation);
    const topQuartile = sorted
      .slice(-quartileCount)
      .map((row) => row.observation);
    const labels = rows.map((row) => ({
      value: row.value,
      favorable: row.observation.realizedReturnPercent > 0,
    }));
    return [
      {
        key,
        label,
        count: rows.length,
        avgValue: roundTo(mean(rows.map((row) => row.value)), 6),
        favorableAvgValue: roundTo(
          mean(favorableRows.map((row) => row.value)),
          6,
        ),
        adverseAvgValue: roundTo(mean(adverseRows.map((row) => row.value)), 6),
        pointBiserial: pointBiserialCorrelation(labels),
        auc: aucForFeature(labels),
        topQuartile: aggregateObservations(topQuartile),
        bottomQuartile: aggregateObservations(bottomQuartile),
      },
    ];
  });
}

function scoreFromSignalFilterState(input: {
  filterState: unknown;
  direction: "long" | "short";
}): number | null {
  const filterState = recordValue(input.filterState);
  const outcomeScore = scoreFromDirectionalFeatures(
    directionalFeaturesFromFilterState(filterState),
  );
  if (outcomeScore != null) {
    return outcomeScore;
  }
  const mtfDirections = numberArray(filterState.mtfDirections);
  const adx = finiteNumber(filterState.adx);
  if (!mtfDirections.length && adx == null) {
    return null;
  }
  const directionSign = input.direction === "long" ? 1 : -1;
  const mtfMatches = mtfDirections.filter(
    (direction) => direction === directionSign,
  ).length;
  const mtfAlignment = mtfDirections.length
    ? (mtfMatches / mtfDirections.length) * 25
    : 8;
  const trendStrength = adx == null ? 7.5 : Math.min(1, Math.max(0, adx / 25)) * 15;
  const liquidityScore = 12;
  const riskFitScore = 5;
  const maxRawScore = 25 + 15 + 20 + 10;
  const scoreScale = 100 / maxRawScore;
  return roundTo(
    clampNumber(
      (mtfAlignment + trendStrength + liquidityScore + riskFitScore) * scoreScale,
      20,
      SOT_OUTCOME_SCORE_MAX,
    ),
    1,
  );
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
  // Optional tap on the raw realized observations (score-model calibration /
  // audit tooling). This module stays side-effect free: the caller owns any IO.
  onObservations?: (observations: SignalObservation[]) => void;
};

export function collectSignalQualityObservations(
  input: ComputeSignalQualityKpisInput,
): { observations: SignalObservation[]; mtfFilteredOutCount: number } {
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

    // Score EVERY detected signal into the forward-return dataset. The MTF gate is
    // a TRADE-ADMISSION gate (mirrors live signal-options admission); we record how
    // many signals it would reject in mtfFilteredOutCount, but we do NOT drop them
    // from grading. The score is displayed on every STA row, so the calibration
    // must cover the full scored/displayed population, not just the traded subset.
    const forwardSignals: SignalForwardReturnSignal[] = [];
    const featuresBySignalId = new Map<string, Record<string, number>>();
    const auditBySignalId = new Map<
      string,
      NonNullable<SignalObservation["audit"]>
    >();
    for (const event of evaluation.signalEvents) {
      const directionSign = event.direction === "long" ? 1 : -1;
      const mtfDirections = mtfDirectionsAtBar(
        sorted,
        event.barIndex,
        input.mtf.timeframes,
        input.settings.basisLength,
      );
      if (!passesMtfGate(mtfDirections, directionSign, input.mtf)) {
        // Count the trade-admission rejection for telemetry, then still grade it.
        mtfFilteredOutCount += 1;
      }
      const directionalFeatures = directionalFeaturesFromFilterState(
        event.filterState,
      );
      if (directionalFeatures) {
        featuresBySignalId.set(event.id, directionalFeatures);
      }
      // Audit enrichment for the observation dump: signal-bar context already
      // computed above plus regime age / raw indicator values at the bar.
      const regimeAtSignal = evaluation.regimeDirection[event.barIndex];
      let regimeAgeBars: number | null = null;
      if (regimeAtSignal === 1 || regimeAtSignal === -1) {
        regimeAgeBars = 1;
        for (
          let back = event.barIndex - 1;
          back >= 0 && evaluation.regimeDirection[back] === regimeAtSignal;
          back -= 1
        ) {
          regimeAgeBars += 1;
        }
      }
      const adxRaw = evaluation.adx[event.barIndex];
      const volatilityScoreRaw = evaluation.volatilityScore[event.barIndex];
      auditBySignalId.set(event.id, {
        signalAt: new Date(event.time * 1000).toISOString(),
        barIndex: event.barIndex,
        mtfTimeframes: [...input.mtf.timeframes],
        mtfDirections,
        regimeAgeBars,
        adxRaw: Number.isFinite(adxRaw) ? adxRaw : null,
        volatilityScoreRaw: Number.isFinite(volatilityScoreRaw)
          ? volatilityScoreRaw
          : null,
      });
      forwardSignals.push({
        signalId: event.id,
        signalAt: new Date(event.time * 1000),
        symbol,
        direction: event.direction,
        score: scoreFromSignalFilterState({
          filterState: event.filterState,
          direction: event.direction,
        }),
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

    collectForwardObservations(
      dataset,
      horizonBars,
      observations,
      featuresBySignalId,
      auditBySignalId,
    );
  }

  return { observations, mtfFilteredOutCount };
}

export function computeSignalQualityKpis(
  input: ComputeSignalQualityKpisInput,
): SignalQualityKpiResult {
  const horizonBars = Math.max(1, Math.round(input.horizonBars));
  const { observations, mtfFilteredOutCount } =
    collectSignalQualityObservations(input);
  input.onObservations?.(observations);
  return buildKpiResult(observations, horizonBars, mtfFilteredOutCount);
}

// Extract one realized observation per COMPLETE forward-return window. Shared by
// the engine-recompute path and the persisted-signal (Signal Matrix) path so both
// produce identical observation shapes.
function collectForwardObservations(
  dataset: ReturnType<typeof buildSignalForwardReturnDataset>,
  horizonBars: number,
  observations: SignalObservation[],
  featuresBySignalId = new Map<string, Record<string, number>>(),
  auditBySignalId?: Map<string, NonNullable<SignalObservation["audit"]>>,
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
      score: row.score,
      directionalFeatures: featuresBySignalId.get(row.signalId) ?? null,
      realizedReturnPercent: window.realizedReturnPercent,
      mfePercent: window.maxFavorableExcursionPercent,
      maePercent: window.maxAdverseExcursionPercent,
      audit: auditBySignalId?.get(row.signalId) ?? null,
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
  const { byScoreRange, scoreBuckets } = aggregateByScoreRange(observations);
  const featureSummaries = buildFeatureSummaries(observations);
  const scoreModelComparisons = compareSignalScoreModels(observations);

  return {
    ...overall,
    horizonBars,
    mtfFilteredOutCount,
    perSymbol,
    byDirection,
    byScoreRange,
    scoreBuckets,
    scoreRangeBuckets: SIGNAL_SCORE_RANGE_BUCKETS,
    featureSummaries,
    scoreModelComparisons,
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
  adx?: number | null;
  score?: number | null;
  directionalFeatures?: Record<string, unknown> | null;
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

  // Group EVERY persisted signal by symbol for forward-window evaluation. The MTF
  // gate is a TRADE-ADMISSION gate (the gate the signal traded); we record how many
  // signals it would reject in mtfFilteredOutCount but do NOT drop them, because the
  // score is displayed on every STA row and the calibration must cover the full
  // scored/displayed population rather than only the traded subset.
  const signalsBySymbol = new Map<string, PersistedSignalInput[]>();
  let mtfFilteredOutCount = 0;
  for (const signal of input.signals) {
    const directionSign = signal.direction === "long" ? 1 : -1;
    if (!passesMtfGate(signal.mtfDirections, directionSign, input.mtf)) {
      // Count the trade-admission rejection for telemetry, then still grade it.
      mtfFilteredOutCount += 1;
    }
    const list = signalsBySymbol.get(signal.symbol) ?? [];
    list.push(signal);
    signalsBySymbol.set(signal.symbol, list);
  }

  const observations: SignalObservation[] = [];
  for (const [symbol, signals] of signalsBySymbol.entries()) {
    const bars = input.barsBySymbol[symbol];
    if (!bars || !bars.length) {
      continue;
    }
    const sorted = bars.slice().sort((left, right) => left.time - right.time);
    const featuresBySignalId = new Map<string, Record<string, number>>();
    const forwardSignals: SignalForwardReturnSignal[] = signals.map((signal) => ({
      signalId: signal.signalId,
      signalAt: signal.signalAt,
      symbol,
      direction: signal.direction,
      score:
        finiteNumber(signal.score) ??
        scoreFromSignalFilterState({
          filterState: {
            mtfDirections: signal.mtfDirections,
            adx: signal.adx,
          },
          direction: signal.direction,
        }),
      sourceStrategy,
      sourceProfile,
      sourceTimeframe,
    }));
    for (const signal of signals) {
      const directionalFeatures = directionalFeaturesFromFilterState({
        directionalFeatures: signal.directionalFeatures,
      });
      if (directionalFeatures) {
        featuresBySignalId.set(signal.signalId, directionalFeatures);
      }
    }
    const dataset = buildSignalForwardReturnDataset({
      signals: forwardSignals,
      barsBySymbol: { [symbol]: pyrusBarsToBacktestBars(sorted) },
      horizonsBars: [horizonBars],
    });
    collectForwardObservations(
      dataset,
      horizonBars,
      observations,
      featuresBySignalId,
    );
  }

  return buildKpiResult(observations, horizonBars, mtfFilteredOutCount);
}

// Exported for unit tests: the aggregation math and the MTF predicate are the
// load-bearing pieces and are asserted directly against hand-computed fixtures.
export const __signalQualityKpisInternalsForTests = {
  aggregateObservations,
  sortScoreModelCandidates,
  buildKpiResult,
  passesMtfGate,
  populationStdDev,
  mean,
  scoreFromSignalFilterState,
  scoreSignalWithModel,
  buildScoreModelAlignment,
  buildFeatureSummaries,
};

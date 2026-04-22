import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRayAlgoSignalScore,
  normalizeRayAlgoScoringConfig,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK,
  RAYALGO_SIGNAL_ROLE_ACTIONABLE,
  RAYALGO_SIGNAL_ROLE_ADVISORY,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_REGIME_RANK,
  RAYALGO_SCORING_VERSION_VNEXT_2M,
  RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK,
  RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR,
  RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
  RAYALGO_SCORING_VERSION_VNEXT_2M_REGIME_RANK,
} from "./rayalgoScoring.js";

function buildScore({ marketSymbol, signalClass, signalDirection, rayConviction = 0.6, displayMode } = {}) {
  return buildRayAlgoSignalScore({
    rayConviction,
    signalClass,
    signalDirection,
    signalTs: "2026-03-26T15:30:00Z",
    signalTimeMs: Date.parse("2026-03-26T15:30:00Z"),
    precursorEventsByFrame: {},
    signalFeatures: {},
    config: {
      marketSymbol,
      activeTimeframe: "5m",
      threshold: 0.4,
      ...(displayMode ? { displayMode } : {}),
    },
  });
}

function buildTimeSeries(startIso, stepMinutes, count) {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) => start + index * stepMinutes * 60 * 1000);
}

function buildPhaseScore({ activeTimeframe, fiveEvent, fifteenEvent } = {}) {
  const signalTimeMs = Date.parse("2026-03-26T15:30:00Z");
  return buildRayAlgoSignalScore({
    rayConviction: 0.6,
    signalClass: "trend_change",
    signalDirection: "long",
    signalTs: "2026-03-26T15:30:00Z",
    signalTimeMs,
    precursorEventsByFrame: {
      ...(fiveEvent ? { "5m": [fiveEvent] } : {}),
      ...(fifteenEvent ? { "15m": [fifteenEvent] } : {}),
    },
    precursorBarTimesByFrame: {
      "5m": buildTimeSeries("2026-03-26T15:00:00Z", 5, 7),
      "15m": buildTimeSeries("2026-03-26T14:45:00Z", 15, 4),
    },
    signalFeatures: {},
    config: {
      marketSymbol: "SPY",
      activeTimeframe,
      threshold: 0.4,
      precursorFrames: ["5m", "15m"],
    },
  });
}

function buildFeatureScore({ signalClass = "trend_change", signalDirection = "long", signalFeatures = {} } = {}) {
  return buildRayAlgoSignalScore({
    rayConviction: 0.6,
    signalClass,
    signalDirection,
    signalTs: "2026-03-26T15:30:00Z",
    signalTimeMs: Date.parse("2026-03-26T15:30:00Z"),
    precursorEventsByFrame: {},
    signalFeatures,
    config: {
      marketSymbol: "SPY",
      activeTimeframe: "5m",
      threshold: 0.4,
    },
  });
}

function buildFeatureScoreWithConfig({
  signalClass = "trend_change",
  signalDirection = "long",
  signalFeatures = {},
  config = {},
  rayConviction = 0.6,
  signalMinuteOfDay = null,
} = {}) {
  return buildRayAlgoSignalScore({
    rayConviction,
    signalClass,
    signalDirection,
    signalTs: "2026-03-26T15:30:00Z",
    signalTimeMs: Date.parse("2026-03-26T15:30:00Z"),
    signalMinuteOfDay,
    precursorEventsByFrame: {},
    signalFeatures,
    config: {
      marketSymbol: "SPY",
      activeTimeframe: "5m",
      threshold: 0.4,
      ...config,
    },
  });
}

test("buildRayAlgoSignalScore uses the follow-through calibrated effective score map", () => {
  const spyTrendLong = buildScore({ marketSymbol: "SPY", signalClass: "trend_change", signalDirection: "long" });
  assert.equal(spyTrendLong.effectiveScoreMode, "final");
  assert.equal(spyTrendLong.displayScoreMode, "final");
  assert.equal(spyTrendLong.displayScoreValue, spyTrendLong.effectiveScore);
  assert.equal(spyTrendLong.displayScoreText, spyTrendLong.effectiveScore.toFixed(2));

  const qqqTrendLong = buildScore({ marketSymbol: "QQQ", signalClass: "trend_change", signalDirection: "long" });
  assert.equal(qqqTrendLong.effectiveScoreMode, "raw");
  assert.equal(qqqTrendLong.displayScoreMode, "raw");
  assert.equal(qqqTrendLong.displayScoreValue, qqqTrendLong.effectiveScore);

  const qqqTrendShort = buildScore({ marketSymbol: "QQQ", signalClass: "trend_change", signalDirection: "short" });
  assert.equal(qqqTrendShort.effectiveScoreMode, "final");
  assert.equal(qqqTrendShort.displayScoreMode, "final");
  assert.equal(qqqTrendShort.displayScoreValue, qqqTrendShort.effectiveScore);

});

test("buildRayAlgoSignalScore respects explicit display mode overrides", () => {
  const forcedRaw = buildScore({
    marketSymbol: "SPY",
    signalClass: "trend_change",
    signalDirection: "long",
    displayMode: "raw",
  });
  assert.equal(forcedRaw.effectiveScoreMode, "final");
  assert.equal(forcedRaw.displayScoreMode, "raw");
  assert.equal(forcedRaw.displayScoreValue, forcedRaw.rawScore);

  const forcedFinal = buildScore({
    marketSymbol: "QQQ",
    signalClass: "trend_change",
    signalDirection: "long",
    displayMode: "final",
  });
  assert.equal(forcedFinal.effectiveScoreMode, "raw");
  assert.equal(forcedFinal.displayScoreMode, "final");
  assert.equal(forcedFinal.displayScoreValue, forcedFinal.qualityScore);
});


test("buildRayAlgoSignalScore applies SPY 1m phase-aware adjustments", () => {
  const freshSupport = buildPhaseScore({
    activeTimeframe: "1m",
    fiveEvent: { ts: "2026-03-26T15:25:00Z", timeMs: Date.parse("2026-03-26T15:25:00Z"), barIndex: 5, direction: "long", score: 0.6 },
    fifteenEvent: { ts: "2026-03-26T15:15:00Z", timeMs: Date.parse("2026-03-26T15:15:00Z"), barIndex: 2, direction: "long", score: 0.6 },
  });
  const staleSupport = buildPhaseScore({
    activeTimeframe: "1m",
    fiveEvent: { ts: "2026-03-26T15:05:00Z", timeMs: Date.parse("2026-03-26T15:05:00Z"), barIndex: 1, direction: "long", score: 0.6 },
    fifteenEvent: { ts: "2026-03-26T14:45:00Z", timeMs: Date.parse("2026-03-26T14:45:00Z"), barIndex: 0, direction: "long", score: 0.6 },
  });
  const mixedPhase = buildPhaseScore({
    activeTimeframe: "1m",
    fiveEvent: { ts: "2026-03-26T15:25:00Z", timeMs: Date.parse("2026-03-26T15:25:00Z"), barIndex: 5, direction: "long", score: 0.6 },
    fifteenEvent: { ts: "2026-03-26T14:45:00Z", timeMs: Date.parse("2026-03-26T14:45:00Z"), barIndex: 0, direction: "short", score: 0.6 },
  });

  assert.equal(freshSupport.phaseContext.bucket, "fresh_support");
  assert.equal(staleSupport.phaseContext.bucket, "stale_support");
  assert.equal(mixedPhase.phaseContext.bucket, "mixed_phase");
  assert.ok(freshSupport.qualityScore > staleSupport.qualityScore);
  assert.ok(mixedPhase.qualityScore > freshSupport.qualityScore);
});

test("buildRayAlgoSignalScore applies SPY 2m phase-aware adjustments", () => {
  const freshSupport = buildPhaseScore({
    activeTimeframe: "2m",
    fiveEvent: { ts: "2026-03-26T15:25:00Z", timeMs: Date.parse("2026-03-26T15:25:00Z"), barIndex: 5, direction: "long", score: 0.6 },
    fifteenEvent: { ts: "2026-03-26T15:15:00Z", timeMs: Date.parse("2026-03-26T15:15:00Z"), barIndex: 2, direction: "long", score: 0.6 },
  });
  const staleOpposition = buildPhaseScore({
    activeTimeframe: "2m",
    fiveEvent: { ts: "2026-03-26T15:00:00Z", timeMs: Date.parse("2026-03-26T15:00:00Z"), barIndex: 0, direction: "short", score: 0.6 },
    fifteenEvent: { ts: "2026-03-26T14:45:00Z", timeMs: Date.parse("2026-03-26T14:45:00Z"), barIndex: 0, direction: "short", score: 0.6 },
  });

  assert.equal(freshSupport.phaseContext.bucket, "fresh_support");
  assert.equal(staleOpposition.phaseContext.bucket, "stale_opposition");
  assert.ok(staleOpposition.qualityScore > freshSupport.qualityScore);
});


test("buildRayAlgoSignalScore penalizes overextended trend-change setups", () => {
  const cleanTrend = buildFeatureScore({
    signalClass: "trend_change",
    signalDirection: "long",
    signalFeatures: {
      regimeAligned: true,
      volRatio: 2.1,
    },
  });
  const overextendedTrend = buildFeatureScore({
    signalClass: "trend_change",
    signalDirection: "long",
    signalFeatures: {
      regimeAligned: true,
      volRatio: 2.1,
      distanceToE21Bps: 24,
      distanceToBandBasisBps: 22,
      vwapPositionAligned: true,
    },
  });

  assert.ok(overextendedTrend.qualityScore < cleanTrend.qualityScore);
  assert.ok(overextendedTrend.featureContext.rulesApplied.some((entry) => entry.reason === "ema21_overextended"));
  assert.ok(overextendedTrend.featureContext.rulesApplied.some((entry) => entry.reason === "band_basis_overextended"));
  assert.ok(overextendedTrend.featureContext.rulesApplied.some((entry) => entry.reason === "vwap_stretched"));
});

test("buildRayAlgoSignalScore penalizes short-side drift and sweep noise", () => {
  const cleanShortTrend = buildFeatureScore({
    signalClass: "trend_change",
    signalDirection: "short",
    signalFeatures: {
      regimeAligned: true,
    },
  });
  const noisyShortTrend = buildFeatureScore({
    signalClass: "trend_change",
    signalDirection: "short",
    signalFeatures: {
      regimeAligned: true,
      sweepAligned: true,
      emaBiasAligned: false,
    },
  });

  assert.ok(noisyShortTrend.qualityScore < cleanShortTrend.qualityScore);
  assert.ok(noisyShortTrend.featureContext.rulesApplied.some((entry) => entry.reason === "trend_change_sweep_noise"));
  assert.ok(noisyShortTrend.featureContext.rulesApplied.some((entry) => entry.reason === "ema_bias_misaligned"));
});

test("buildRayAlgoSignalScore vNext rewards non-recent fresh trend-change context", () => {
  const recentCrossNoise = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
      recentCross: true,
      distanceToE21Bps: 14,
      distanceToBandBasisBps: 12,
    },
    config: {
      scoringVersion: "rayalgo_tranche1_vnext_1",
      executionProfile: "rayalgo_tranche1_vnext_1",
    },
  });
  const freshCompactTrend = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
      recentCross: false,
      freshCross: true,
      distanceToE21Bps: 3,
      distanceToBandBasisBps: 4,
      bandTrendAligned: true,
      bandRetestAligned: true,
    },
    config: {
      scoringVersion: "rayalgo_tranche1_vnext_1",
      executionProfile: "rayalgo_tranche1_vnext_1",
    },
  });

  assert.ok(freshCompactTrend.qualityScore > recentCrossNoise.qualityScore);
  assert.ok(freshCompactTrend.featureContext.rulesApplied.some((entry) => entry.reason === "vnext_not_recent_cross"));
  assert.ok(recentCrossNoise.featureContext.rulesApplied.some((entry) => entry.reason === "vnext_recent_cross_noise"));
});

test("buildRayAlgoSignalScore vNext disables legacy base calibration", () => {
  const legacy = buildFeatureScoreWithConfig({
    config: {
      marketSymbol: "SPY",
      activeTimeframe: "5m",
    },
  });
  const vnext = buildFeatureScoreWithConfig({
    config: {
      scoringVersion: "rayalgo_tranche1_vnext_1",
      executionProfile: "rayalgo_tranche1_vnext_1",
    },
  });

  assert.notEqual(legacy.calibrationContext.reason, "disabled_for_vnext");
  assert.equal(vnext.calibrationContext.reason, "disabled_for_vnext");
  assert.equal(vnext.calibrationDelta, 0);
});

test("buildRayAlgoSignalScore tranche2 2m profile marks 1m as advisory without suppressing the label", () => {
  const advisory1m = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
    },
    config: {
      activeTimeframe: "1m",
      scoringVersion: "rayalgo_tranche2_vnext_2m",
      executionProfile: "rayalgo_tranche2_vnext_2m",
    },
  });

  assert.equal(advisory1m.signalRole, RAYALGO_SIGNAL_ROLE_ADVISORY);
  assert.equal(advisory1m.signalFired, true);
  assert.equal(advisory1m.displayScoreText, advisory1m.displayScoreValue.toFixed(2));
  assert.notEqual(advisory1m.calibrationContext.reason, "disabled_for_vnext");
});

test("buildRayAlgoSignalScore tranche2 2m profile keeps 2m actionable and penalizes noisy extended setups", () => {
  const clean2m = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
      recentCross: false,
      sweepAligned: true,
      smcAlignedCount: 3,
      bandTrendAligned: true,
      bandRetestAligned: true,
      bandBasisAligned: true,
      distanceToE21Bps: 3,
      distanceToBandBasisBps: 4,
      volRatio: 2.1,
      rsi: 71,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: "rayalgo_tranche2_vnext_2m",
      executionProfile: "rayalgo_tranche2_vnext_2m",
    },
  });
  const noisy2m = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: false,
      trendAligned: false,
      chochAligned: true,
      recentCross: true,
      emaBiasAligned: false,
      vwapPositionAligned: true,
      bandBasisAligned: false,
      distanceToE21Bps: 24,
      distanceToBandBasisBps: 22,
      rsi: 28,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: "rayalgo_tranche2_vnext_2m",
      executionProfile: "rayalgo_tranche2_vnext_2m",
    },
  });

  assert.equal(clean2m.signalRole, RAYALGO_SIGNAL_ROLE_ACTIONABLE);
  assert.equal(clean2m.calibrationContext.reason, "disabled_for_vnext");
  assert.equal(clean2m.calibrationDelta, 0);
  assert.ok(clean2m.qualityScore > noisy2m.qualityScore);
  assert.ok(clean2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_not_recent_cross"));
  assert.ok(clean2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_sweep_confirmation"));
  assert.ok(clean2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_smc_stack"));
  assert.ok(clean2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_volume_expansion"));
  assert.ok(clean2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_rsi_momentum_high"));
  assert.ok(noisy2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_recent_cross_noise"));
  assert.ok(noisy2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_choch_noise"));
  assert.ok(noisy2m.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_band_basis_misaligned"));
});

test("buildRayAlgoSignalScore direction-rank 2m profile promotes long momentum continuation and tighter short fades", () => {
  const longBaseline = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
      recentCross: true,
      freshCross: true,
      nearSlowEma: true,
      smcAlignedCount: 3,
      volRatio: 2.1,
      rsi: 71,
      bandBasisAligned: true,
      distanceToE21Bps: 24,
      distanceToBandBasisBps: 22,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M,
    },
  });
  const longDirectionRank = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
      recentCross: true,
      freshCross: true,
      nearSlowEma: true,
      smcAlignedCount: 3,
      volRatio: 2.1,
      rsi: 71,
      bandBasisAligned: true,
      distanceToE21Bps: 24,
      distanceToBandBasisBps: 22,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK,
    },
  });
  const shortBaseline = buildFeatureScoreWithConfig({
    signalDirection: "short",
    rayConviction: 0.45,
    signalFeatures: {
      regime: "range",
      recentCross: false,
      smcAlignedCount: 0,
      distanceToE21Bps: 3,
      bandBasisAligned: true,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M,
    },
  });
  const shortDirectionRank = buildFeatureScoreWithConfig({
    signalDirection: "short",
    rayConviction: 0.45,
    signalFeatures: {
      regime: "range",
      recentCross: false,
      smcAlignedCount: 0,
      distanceToE21Bps: 3,
      bandBasisAligned: true,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK,
    },
  });

  assert.ok(longDirectionRank.qualityScore > longBaseline.qualityScore);
  assert.ok(longDirectionRank.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_rank_long_ema21_momentum_relief"));
  assert.ok(longDirectionRank.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_rank_long_fresh_compact_bonus"));
  assert.ok(shortDirectionRank.qualityScore > shortBaseline.qualityScore);
  assert.ok(shortDirectionRank.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_rank_short_stale_cross_bonus"));
  assert.ok(shortDirectionRank.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_rank_short_clean_structure_bonus"));
});

test("buildRayAlgoSignalScore regime-rank 2m profile adds range-short and aligned-session bonuses without gating", () => {
  const shortDirectionRank = buildFeatureScoreWithConfig({
    signalDirection: "short",
    rayConviction: 0.45,
    signalFeatures: {
      regime: "range",
      recentCross: false,
      smcAlignedCount: 0,
      distanceToE21Bps: 3,
    },
    signalMinuteOfDay: 10 * 60,
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK,
    },
  });
  const shortRegimeRank = buildFeatureScoreWithConfig({
    signalDirection: "short",
    rayConviction: 0.45,
    signalFeatures: {
      regime: "range",
      recentCross: false,
      smcAlignedCount: 0,
      distanceToE21Bps: 3,
    },
    signalMinuteOfDay: 10 * 60,
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_REGIME_RANK,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_REGIME_RANK,
    },
  });
  const middayMisalignedLong = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: false,
      regime: "range",
      recentCross: true,
      bandBasisAligned: false,
      distanceToE21Bps: 14,
      distanceToBandBasisBps: 12,
    },
    signalMinuteOfDay: 12 * 60,
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_REGIME_RANK,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_REGIME_RANK,
    },
  });

  assert.equal(shortRegimeRank.signalRole, RAYALGO_SIGNAL_ROLE_ACTIONABLE);
  assert.equal(shortRegimeRank.eligibilityGate.status, "not_applicable");
  assert.ok(shortRegimeRank.qualityScore > shortDirectionRank.qualityScore);
  assert.ok(shortRegimeRank.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_regime_short_range_bonus"));
  assert.ok(middayMisalignedLong.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_regime_midday_base_penalty"));
  assert.ok(middayMisalignedLong.featureContext.rulesApplied.some((entry) => entry.reason === "vnext2m_regime_midday_misaligned_penalty"));
});

test("buildRayAlgoSignalScore tranche3 gated 2m profile keeps 1m advisory and exposes the directional floor", () => {
  const advisory1m = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
    },
    config: {
      activeTimeframe: "1m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
    },
  });

  assert.equal(advisory1m.signalRole, RAYALGO_SIGNAL_ROLE_ADVISORY);
  assert.equal(advisory1m.eligibilityGate.status, "not_applicable");

  const long2m = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
    },
  });
  const short2m = buildFeatureScoreWithConfig({
    signalDirection: "short",
    signalFeatures: {
      regimeAligned: true,
      recentCross: false,
      distanceToE21Bps: 3,
      distanceToBandBasisBps: 4,
      vwapPositionAligned: false,
      obAligned: false,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
    },
  });

  assert.equal(long2m.signalRole, RAYALGO_SIGNAL_ROLE_ACTIONABLE);
  assert.equal(long2m.eligibilityGate.minimumScore, 0.5);
  assert.equal(short2m.eligibilityGate.minimumScore, 0.45);
});

test("buildRayAlgoSignalScore tranche3 split-floor 2m profile keeps 1m advisory and applies direction floors without hard blocks", () => {
  const advisory1m = buildFeatureScoreWithConfig({
    signalFeatures: {
      regimeAligned: true,
    },
    config: {
      activeTimeframe: "1m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR,
    },
  });

  assert.equal(advisory1m.signalRole, RAYALGO_SIGNAL_ROLE_ADVISORY);
  assert.equal(advisory1m.eligibilityGate.status, "not_applicable");

  const belowFloorLong = buildFeatureScoreWithConfig({
    rayConviction: 0.42,
    signalFeatures: {
      regimeAligned: true,
      chochAligned: true,
      trendAligned: false,
      bandBasisAligned: false,
      opposingBandTrend: true,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR,
    },
  });
  const cleanShort = buildFeatureScoreWithConfig({
    rayConviction: 0.7,
    signalDirection: "short",
    signalFeatures: {
      regimeAligned: true,
      recentCross: false,
      distanceToE21Bps: 3,
      distanceToBandBasisBps: 4,
      vwapPositionAligned: true,
      obAligned: true,
      chochAligned: true,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR,
    },
  });

  assert.equal(belowFloorLong.signalRole, RAYALGO_SIGNAL_ROLE_ACTIONABLE);
  assert.equal(belowFloorLong.eligibilityGate.profile, "rayalgo_tranche3_2m_split_floor");
  assert.equal(belowFloorLong.eligibilityGate.minimumScore, 0.5);
  assert.equal(belowFloorLong.eligibilityGate.hardBlocked, false);
  assert.equal(belowFloorLong.eligibilityGate.status, "below_floor");
  assert.deepEqual(belowFloorLong.eligibilityGate.hardBlockReasons, []);
  assert.ok(belowFloorLong.eligibilityGate.reasonsApplied.includes("gate_min_quality_long"));
  assert.equal(cleanShort.eligibilityGate.minimumScore, 0.45);
  assert.equal(cleanShort.eligibilityGate.hardBlocked, false);
  assert.equal(cleanShort.eligibilityGate.status, "passed");
  assert.equal(cleanShort.signalFired, true);
});

test("normalizeRayAlgoScoringConfig preserves null floor slots across repeated normalization", () => {
  const normalized = normalizeRayAlgoScoringConfig({
    activeTimeframe: "2m",
    precursorFrames: ["5m", "15m"],
    scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR,
    executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR,
  });
  const renormalized = normalizeRayAlgoScoringConfig(normalized);
  const splitFloor = buildFeatureScoreWithConfig({
    signalDirection: "short",
    rayConviction: 0.41,
    signalFeatures: {
      regimeAligned: false,
      chochAligned: true,
      vwapPositionAligned: true,
      obAligned: true,
      emaBiasAligned: false,
      recentCross: true,
      distanceToE21Bps: 14,
      distanceToBandBasisBps: 12,
      rsi: 28,
    },
    config: renormalized,
  });

  assert.equal(renormalized.qualityFloor, null);
  assert.equal(renormalized.qualityFloorByDirection.long, null);
  assert.equal(renormalized.qualityFloorByDirection.short, null);
  assert.equal(renormalized.qualityFloorBySignalClass.trend_change, null);
  assert.equal(renormalized.qualityFloorBySignalClassDirection.trend_change.long, null);
  assert.equal(renormalized.qualityFloorBySignalClassDirection.trend_change.short, null);
  assert.equal(splitFloor.eligibilityGate.minimumScore, 0.45);
  assert.equal(splitFloor.eligibilityGate.status, "below_floor");
  assert.equal(splitFloor.signalFired, false);
});

test("buildRayAlgoSignalScore tranche3 gated 2m profile blocks hard long-side entry defects", () => {
  const blockedLong = buildFeatureScoreWithConfig({
    rayConviction: 0.78,
    signalFeatures: {
      regimeAligned: false,
      chochAligned: true,
      trendAligned: false,
      bandBasisAligned: false,
      opposingBandTrend: true,
      distanceToE21Bps: 24,
      distanceToBandBasisBps: 22,
      volRatio: 2.1,
      rsi: 71,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
    },
  });

  assert.equal(blockedLong.signalFired, false);
  assert.equal(blockedLong.eligibilityGate.status, "blocked");
  assert.ok(blockedLong.eligibilityGate.reasonsApplied.includes("gate_regime_misaligned"));
  assert.ok(blockedLong.eligibilityGate.reasonsApplied.includes("gate_choch_aligned"));
  assert.ok(blockedLong.eligibilityGate.reasonsApplied.includes("gate_long_band_basis_misaligned"));
  assert.ok(blockedLong.eligibilityGate.reasonsApplied.includes("gate_long_opposing_band_trend"));
});

test("buildRayAlgoSignalScore tranche3 gated 2m profile passes clean short setups and blocks stretched short setups", () => {
  const cleanShort = buildFeatureScoreWithConfig({
    rayConviction: 0.7,
    signalDirection: "short",
    signalFeatures: {
      regimeAligned: true,
      recentCross: false,
      distanceToE21Bps: 3,
      distanceToBandBasisBps: 4,
      vwapPositionAligned: false,
      obAligned: false,
      chochAligned: false,
      volRatio: 2.1,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
    },
  });
  const blockedShort = buildFeatureScoreWithConfig({
    rayConviction: 0.78,
    signalDirection: "short",
    signalFeatures: {
      regimeAligned: true,
      chochAligned: true,
      vwapPositionAligned: true,
      obAligned: true,
      distanceToE21Bps: 14,
      distanceToBandBasisBps: 12,
    },
    config: {
      activeTimeframe: "2m",
      scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
      executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
    },
  });

  assert.equal(cleanShort.signalFired, true);
  assert.equal(cleanShort.eligibilityGate.status, "passed");
  assert.equal(blockedShort.signalFired, false);
  assert.equal(blockedShort.eligibilityGate.status, "blocked");
  assert.ok(blockedShort.eligibilityGate.reasonsApplied.includes("gate_short_vwap_stretched"));
  assert.ok(blockedShort.eligibilityGate.reasonsApplied.includes("gate_short_order_block_conflict"));
  assert.ok(blockedShort.eligibilityGate.reasonsApplied.includes("gate_short_ema21_extended"));
  assert.ok(blockedShort.eligibilityGate.reasonsApplied.includes("gate_short_band_basis_extended"));
});

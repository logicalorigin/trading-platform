import { timeframeToMinutes } from "../chart/timeframeModel.js";

export const RAYALGO_SCORING_VERSION = "rayalgo_tranche1_v4";
export const RAYALGO_SCORING_VERSION_VNEXT_1 = "rayalgo_tranche1_vnext_1";
export const RAYALGO_SCORING_VERSION_VNEXT_2M = "rayalgo_tranche2_vnext_2m";
export const RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR = "rayalgo_tranche3_vnext_2m_split_floor";
export const RAYALGO_SCORING_VERSION_VNEXT_2M_GATED = "rayalgo_tranche3_vnext_2m_gated";
export const RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK = "rayalgo_tranche4_vnext_2m_direction_rank_v1";
export const RAYALGO_SCORING_VERSION_VNEXT_2M_REGIME_RANK = "rayalgo_tranche4_vnext_2m_regime_rank_v1";
export const RAYALGO_EXECUTION_PROFILE = "rayalgo_tranche1";
export const RAYALGO_EXECUTION_PROFILE_VNEXT_1 = "rayalgo_tranche1_vnext_1";
export const RAYALGO_EXECUTION_PROFILE_VNEXT_2M = "rayalgo_tranche2_vnext_2m";
export const RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR = "rayalgo_tranche3_vnext_2m_split_floor";
export const RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED = "rayalgo_tranche3_vnext_2m_gated";
export const RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK = "rayalgo_tranche4_vnext_2m_direction_rank_v1";
export const RAYALGO_EXECUTION_PROFILE_VNEXT_2M_REGIME_RANK = "rayalgo_tranche4_vnext_2m_regime_rank_v1";
export const RAYALGO_CONFLICT_POLICY_V2_NUANCE = "v2_nuance";
export const RAYALGO_AUTHORITY_OBSERVE_ONLY = "observe_only";
export const RAYALGO_AUTHORITY_SIZE_UPGRADE_ONLY = "size_upgrade_only";
export const RAYALGO_PRECURSOR_LADDER_NONE = "none";
export const RAYALGO_PRECURSOR_LADDER_AUTO = "auto";
export const RAYALGO_DISPLAY_MODE_AUTO = "auto";
export const RAYALGO_DISPLAY_MODE_RAW = "raw";
export const RAYALGO_DISPLAY_MODE_FINAL = "final";
export const RAYALGO_EFFECTIVE_SCORE_MODE_RAW = "raw";
export const RAYALGO_EFFECTIVE_SCORE_MODE_FINAL = "final";
export const RAYALGO_SIGNAL_ROLE_ACTIONABLE = "actionable";
export const RAYALGO_SIGNAL_ROLE_ADVISORY = "advisory";

const DEFAULT_THRESHOLD = 0.4;
const PRECURSOR_REPEAT_STEP = 0.02;
const PRECURSOR_REPEAT_CAP = 0.04;
const PRECURSOR_TOTAL_CAP = 0.18;
const PRECURSOR_STRENGTH_CAP = 0.7;
const QUALITY_SCORE_SCALE = 0.7;
const QUALITY_SCORE_SCALE_VNEXT_1 = 0.8;
const QUALITY_SCORE_SCALE_VNEXT_2M = 0.8;
const QUALITY_ADJUSTMENT_CAP = 0.12;
const SPY_PHASE_CONTEXT_PROFILES = Object.freeze({
  "1m": Object.freeze({
    frames: Object.freeze({
      "5m": 3,
      "15m": 2,
    }),
    adjustments: Object.freeze({
      fresh_support: 0.04,
      stale_support: -0.05,
      fresh_opposition: -0.03,
      stale_opposition: 0.01,
      mixed_phase: 0.06,
    }),
  }),
  "2m": Object.freeze({
    frames: Object.freeze({
      "5m": 3,
      "15m": 2,
    }),
    adjustments: Object.freeze({
      fresh_support: 0.015,
      stale_support: 0,
      fresh_opposition: -0.025,
      stale_opposition: 0.05,
      mixed_phase: 0.055,
    }),
  }),
});
const SCORE_BUCKETS = Object.freeze([
  { key: "b40", lower: 0.4, upper: 0.5 },
  { key: "b50", lower: 0.5, upper: 0.6 },
  { key: "b60", lower: 0.6, upper: 0.7 },
  { key: "b70", lower: 0.7, upper: 0.8 },
  { key: "b80", lower: 0.8, upper: 0.9 },
  { key: "b90", lower: 0.9, upper: 1.0001 },
]);
const CALIBRATION_RULES = Object.freeze({
  "5m": Object.freeze({
    long: Object.freeze({
      b50: Object.freeze({ delta: -0.05, reason: "weak_5m_long_mid_bucket" }),
      b80: Object.freeze({ delta: 0.03, reason: "strong_5m_long_high_bucket" }),
      b90: Object.freeze({ delta: -0.07, reason: "saturated_5m_long_top_bucket" }),
    }),
    short: Object.freeze({
      b70: Object.freeze({ delta: -0.03, reason: "weak_5m_short_upper_mid_bucket" }),
      b80: Object.freeze({ delta: -0.04, reason: "weak_5m_short_high_bucket" }),
      b90: Object.freeze({ delta: -0.08, reason: "saturated_5m_short_top_bucket" }),
    }),
  }),
});

const PRECURSOR_TEMPLATE_REGISTRY = Object.freeze({
  "1m": [{ id: "none", frames: [] }],
  "2m": [
    { id: "none", frames: [] },
    { id: "1m", frames: ["1m"] },
  ],
  "5m": [
    { id: "none", frames: [] },
    { id: "2m", frames: ["2m"] },
    { id: "1m+2m", frames: ["1m", "2m"] },
  ],
  "15m": [
    { id: "none", frames: [] },
    { id: "5m", frames: ["5m"] },
    { id: "2m+5m", frames: ["2m", "5m"] },
  ],
  "30m": [
    { id: "none", frames: [] },
    { id: "15m", frames: ["15m"] },
    { id: "5m+15m", frames: ["5m", "15m"] },
  ],
  "1h": [
    { id: "none", frames: [] },
    { id: "30m", frames: ["30m"] },
    { id: "15m+30m", frames: ["15m", "30m"] },
  ],
  "4h": [
    { id: "none", frames: [] },
    { id: "1h", frames: ["1h"] },
    { id: "30m+1h", frames: ["30m", "1h"] },
  ],
});

function normalizeTimeframeLabel(value, fallback = "5m") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizeId(value, fallback) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizePrecursorLadderId(value, fallback = RAYALGO_PRECURSOR_LADDER_NONE) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizeAuthority(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === RAYALGO_AUTHORITY_SIZE_UPGRADE_ONLY
    ? RAYALGO_AUTHORITY_SIZE_UPGRADE_ONLY
    : RAYALGO_AUTHORITY_OBSERVE_ONLY;
}

function normalizeDisplayMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === RAYALGO_DISPLAY_MODE_RAW) {
    return RAYALGO_DISPLAY_MODE_RAW;
  }
  if (normalized === RAYALGO_DISPLAY_MODE_FINAL) {
    return RAYALGO_DISPLAY_MODE_FINAL;
  }
  return RAYALGO_DISPLAY_MODE_AUTO;
}

const RAYALGO_EFFECTIVE_SCORE_MODE_OVERRIDES = Object.freeze({
  QQQ: Object.freeze({
    trend_change: Object.freeze({
      long: RAYALGO_EFFECTIVE_SCORE_MODE_RAW,
    }),
  }),
});

function resolveLiveDisplayMode(preference, effectiveMode = RAYALGO_EFFECTIVE_SCORE_MODE_FINAL) {
  const normalizedPreference = normalizeDisplayMode(preference);
  if (normalizedPreference === RAYALGO_DISPLAY_MODE_RAW || normalizedPreference === RAYALGO_DISPLAY_MODE_FINAL) {
    return normalizedPreference;
  }
  return effectiveMode === RAYALGO_EFFECTIVE_SCORE_MODE_RAW
    ? RAYALGO_DISPLAY_MODE_RAW
    : RAYALGO_DISPLAY_MODE_FINAL;
}

function resolveEffectiveScoreMode({
  marketSymbol = null,
  signalClass = "trend_change",
  direction = null,
} = {}) {
  const normalizedSymbol = String(marketSymbol || "").trim().toUpperCase();
  const normalizedSignalClass = normalizeSignalClass(signalClass);
  const normalizedDirection = normalizeDirection(direction, "long");
  const symbolOverrides = RAYALGO_EFFECTIVE_SCORE_MODE_OVERRIDES[normalizedSymbol];
  const resolvedMode = symbolOverrides?.[normalizedSignalClass]?.[normalizedDirection];
  if (resolvedMode === RAYALGO_EFFECTIVE_SCORE_MODE_RAW || resolvedMode === RAYALGO_EFFECTIVE_SCORE_MODE_FINAL) {
    return resolvedMode;
  }
  return RAYALGO_EFFECTIVE_SCORE_MODE_FINAL;
}

function buildEffectiveScoreContext({
  marketSymbol = null,
  signalClass = "trend_change",
  direction = null,
  rawScore = 0,
  finalScore = 0,
} = {}) {
  const mode = resolveEffectiveScoreMode({
    marketSymbol,
    signalClass,
    direction,
  });
  return {
    mode,
    score: clampUnit(mode === RAYALGO_EFFECTIVE_SCORE_MODE_RAW ? rawScore : finalScore),
  };
}

function normalizeOptionalUnit(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" && !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return clampUnit(numeric);
}

function normalizeSignalClass(value, fallback = "trend_change") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "trend_change" ? "trend_change" : fallback;
}

function normalizePrecursorFrameList(value, activeTimeframe = "5m") {
  const activeLabel = normalizeTimeframeLabel(activeTimeframe);
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const seen = new Set();
  const normalized = [];
  for (const entry of raw) {
    const timeframe = normalizeTimeframeLabel(entry, "");
    if (!timeframe || timeframe === activeLabel) {
      continue;
    }
    if (!Number.isFinite(timeframeToMinutes(timeframe)) || seen.has(timeframe)) {
      continue;
    }
    seen.add(timeframe);
    normalized.push(timeframe);
  }
  return normalized;
}

function normalizeDirection(value, fallback = null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "long" || normalized === "short") {
    return normalized;
  }
  return fallback;
}

function normalizeFloorMapBySignalClass(value = {}) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    ["trend_change"].map((signalClass) => [
      signalClass,
      normalizeOptionalUnit(value?.[signalClass]),
    ]),
  );
}

function normalizeFloorMapByDirection(value = {}) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    ["long", "short"].map((direction) => [
      direction,
      normalizeOptionalUnit(value?.[direction]),
    ]),
  );
}

function normalizeFloorMapBySignalClassDirection(value = {}) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    ["trend_change"].map((signalClass) => [
      signalClass,
      normalizeFloorMapByDirection(value?.[signalClass]),
    ]),
  );
}

function normalizeConflictPolicy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || RAYALGO_CONFLICT_POLICY_V2_NUANCE;
}

function resolveTemplatesForTimeframe(activeTimeframe) {
  const normalized = normalizeTimeframeLabel(activeTimeframe);
  return PRECURSOR_TEMPLATE_REGISTRY[normalized]
    || [{ id: "none", frames: [] }];
}

function resolveAutoTemplateId(activeTimeframe) {
  const templates = resolveTemplatesForTimeframe(activeTimeframe);
  const richest = [...templates]
    .filter((template) => template.id !== "none")
    .sort((left, right) => right.frames.length - left.frames.length)[0];
  return richest?.id || "none";
}

function resolveTemplate(activeTimeframe, requestedTemplateId = RAYALGO_PRECURSOR_LADDER_AUTO) {
  const templates = resolveTemplatesForTimeframe(activeTimeframe);
  const normalizedId = normalizePrecursorLadderId(requestedTemplateId, RAYALGO_PRECURSOR_LADDER_AUTO);
  const resolvedId = normalizedId === RAYALGO_PRECURSOR_LADDER_AUTO
    ? resolveAutoTemplateId(activeTimeframe)
    : normalizedId;
  return templates.find((template) => template.id === resolvedId)
    || templates.find((template) => template.id === RAYALGO_PRECURSOR_LADDER_NONE)
    || { id: RAYALGO_PRECURSOR_LADDER_NONE, frames: [] };
}

function computeBaseWeight(frameIndex) {
  return frameIndex === 0 ? 0.10 : 0.06;
}

function upperBoundNumeric(values = [], target) {
  let low = 0;
  let high = Array.isArray(values) ? values.length : 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((Number(values[mid]) || 0) <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function findContainingBarIndex(barTimeMs = [], epochMs) {
  if (!Array.isArray(barTimeMs) || !barTimeMs.length || !Number.isFinite(Number(epochMs))) {
    return null;
  }
  const insertIndex = upperBoundNumeric(barTimeMs, Number(epochMs));
  if (insertIndex <= 0) {
    return 0;
  }
  return Math.min(barTimeMs.length - 1, insertIndex - 1);
}

function clampUnit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric));
}

function hasFiniteNumericValue(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

function classifyVolRatio(volRatio) {
  const numeric = Number(volRatio);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric >= 2) {
    return "2.0+";
  }
  if (numeric >= 1.5) {
    return "1.5-2.0";
  }
  if (numeric >= 1) {
    return "1.0-1.5";
  }
  return "<1.0";
}

function classifyAbsDistanceBucket(distanceBps) {
  const numeric = Math.abs(Number(distanceBps));
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric >= 20) {
    return "20bps+";
  }
  if (numeric >= 10) {
    return "10-20bps";
  }
  if (numeric >= 5) {
    return "5-10bps";
  }
  return "<5bps";
}

function classifyRsiBucket(rsi) {
  const numeric = Number(rsi);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric >= 68) {
    return "68+";
  }
  if (numeric >= 60) {
    return "60-68";
  }
  if (numeric >= 40) {
    return "40-60";
  }
  if (numeric >= 32) {
    return "32-40";
  }
  return "<32";
}

function normalizeFeatureRegime(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bull" || normalized === "bear" || normalized === "range") {
    return normalized;
  }
  return null;
}

function resolveSignalSessionBucket(minuteOfDay = null) {
  const numeric = Number(minuteOfDay);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < 10 * 60 + 30) {
    return "morning";
  }
  if (numeric >= 15 * 60) {
    return "power_hour";
  }
  return "midday";
}

function buildQualityFeatureAdjustment(signalFeatures = null, signalClass = "trend_change") {
  const features = signalFeatures && typeof signalFeatures === "object" ? signalFeatures : {};
  const volRatioBucket = classifyVolRatio(features.volRatio);
  const e21DistanceBucket = classifyAbsDistanceBucket(features.distanceToE21Bps);
  const bandBasisDistanceBucket = classifyAbsDistanceBucket(features.distanceToBandBasisBps);
  let adjustment = 0;
  const rulesApplied = [];
  const apply = (condition, delta, reason) => {
    if (!condition) {
      return;
    }
    adjustment += delta;
    rulesApplied.push({
      reason,
      delta: +Number(delta).toFixed(3),
    });
  };

  apply(features.regimeAligned === true, 0.025, "regime_aligned");
  apply(features.regimeAligned === false, -0.05, "regime_misaligned");
  apply(features.emaBiasAligned === false, -0.02, "ema_bias_misaligned");
  apply(features.rsiExtended === true, -0.035, "rsi_extended");
  apply(features.rsiSupportive === true && features.rsiExtended !== true, 0.01, "rsi_supportive");
  apply(features.vwapPositionAligned === true, -0.025, "vwap_stretched");
  apply(features.opposingBandTrend === true, -0.025, "opposing_band_trend");
  apply(features.opposingBandRetest === true, -0.015, "opposing_band_retest");
  apply(volRatioBucket === "2.0+", 0.015, "high_relative_volume");
  apply(volRatioBucket === "1.5-2.0", -0.01, "murky_relative_volume");
  apply(e21DistanceBucket === "10-20bps", -0.015, "ema21_extended");
  apply(e21DistanceBucket === "20bps+", -0.03, "ema21_overextended");
  apply(bandBasisDistanceBucket === "10-20bps", -0.015, "band_basis_extended");
  apply(bandBasisDistanceBucket === "20bps+", -0.03, "band_basis_overextended");
  apply(
    features.bandTrendAligned === true && features.bandRetestAligned === true && features.vwapPositionAligned !== true,
    0.015,
    "clean_band_alignment",
  );
  apply(features.chochAligned === true, -0.015, "trend_change_choch_marker_only");
  apply(features.sweepAligned === true, -0.02, "trend_change_sweep_noise");

  const clampedAdjustment = Math.max(-QUALITY_ADJUSTMENT_CAP, Math.min(QUALITY_ADJUSTMENT_CAP, adjustment));
  return {
    adjustment: +clampedAdjustment.toFixed(4),
    rulesApplied,
  };
}

function buildQualityFeatureAdjustmentVNext(signalFeatures = null, signalClass = "trend_change") {
  const features = signalFeatures && typeof signalFeatures === "object" ? signalFeatures : {};
  const volRatioBucket = classifyVolRatio(features.volRatio);
  const e21DistanceBucket = classifyAbsDistanceBucket(features.distanceToE21Bps);
  const bandBasisDistanceBucket = classifyAbsDistanceBucket(features.distanceToBandBasisBps);
  let adjustment = 0;
  const rulesApplied = [];
  const apply = (condition, delta, reason) => {
    if (!condition) return;
    adjustment += delta;
    rulesApplied.push({
      reason,
      delta: +Number(delta).toFixed(3),
    });
  };

  if (normalizeSignalClass(signalClass) === "trend_change") {
    apply(features.regimeAligned === true, 0.04, "vnext_regime_aligned");
    apply(features.regimeAligned === false, -0.08, "vnext_regime_misaligned");
    apply(features.freshCross === true, 0.03, "vnext_fresh_cross");
    apply(features.recentCross === false, 0.035, "vnext_not_recent_cross");
    apply(features.recentCross === true, -0.03, "vnext_recent_cross_noise");
    apply(features.emaBiasAligned === false, -0.035, "vnext_ema_bias_misaligned");
    apply(features.rsiExtended === true, -0.03, "vnext_rsi_extended");
    apply(features.vwapPositionAligned === true, -0.025, "vnext_vwap_stretched");
    apply(features.opposingBandTrend === true, -0.04, "vnext_opposing_band_trend");
    apply(features.opposingBandRetest === true, -0.02, "vnext_opposing_band_retest");
    apply(features.sweepAligned === true, -0.03, "vnext_sweep_noise");
    apply(features.bandTrendAligned === true && features.bandRetestAligned === true, 0.02, "vnext_clean_band_alignment");

    apply(e21DistanceBucket === "<5bps", 0.02, "vnext_ema21_compact");
    apply(e21DistanceBucket === "5-10bps", 0.005, "vnext_ema21_near");
    apply(e21DistanceBucket === "10-20bps", -0.025, "vnext_ema21_extended");
    apply(e21DistanceBucket === "20bps+", -0.05, "vnext_ema21_overextended");

    apply(bandBasisDistanceBucket === "<5bps", 0.015, "vnext_band_basis_compact");
    apply(bandBasisDistanceBucket === "5-10bps", 0.005, "vnext_band_basis_near");
    apply(bandBasisDistanceBucket === "10-20bps", -0.02, "vnext_band_basis_extended");
    apply(bandBasisDistanceBucket === "20bps+", -0.04, "vnext_band_basis_overextended");

    apply(volRatioBucket === "1.0-1.5", 0.01, "vnext_volume_supportive");
    apply(volRatioBucket === "1.5-2.0", 0.015, "vnext_volume_strong");
    apply(volRatioBucket === "2.0+", 0.02, "vnext_volume_expansion");
  }

  const clampedAdjustment = Math.max(-QUALITY_ADJUSTMENT_CAP, Math.min(QUALITY_ADJUSTMENT_CAP, adjustment));
  return {
    adjustment: +clampedAdjustment.toFixed(4),
    rulesApplied,
  };
}

function buildQualityFeatureAdjustmentVNext2m(signalFeatures = null, signalClass = "trend_change", activeTimeframe = "5m") {
  const normalizedTimeframe = normalizeTimeframeLabel(activeTimeframe, "");
  if (normalizedTimeframe !== "2m") {
    return buildQualityFeatureAdjustment(signalFeatures, signalClass);
  }

  const features = signalFeatures && typeof signalFeatures === "object" ? signalFeatures : {};
  const volRatioBucket = classifyVolRatio(features.volRatio);
  const e21DistanceBucket = classifyAbsDistanceBucket(features.distanceToE21Bps);
  const bandBasisDistanceBucket = classifyAbsDistanceBucket(features.distanceToBandBasisBps);
  const rsiBucket = classifyRsiBucket(features.rsi);
  let adjustment = 0;
  const rulesApplied = [];
  const apply = (condition, delta, reason) => {
    if (!condition) {
      return;
    }
    adjustment += delta;
    rulesApplied.push({
      reason,
      delta: +Number(delta).toFixed(3),
    });
  };

  if (normalizeSignalClass(signalClass) === "trend_change") {
    apply(features.regimeAligned === true, 0.05, "vnext2m_regime_aligned");
    apply(features.regimeAligned === false, -0.08, "vnext2m_regime_misaligned");
    apply(features.trendAligned === false, -0.03, "vnext2m_trend_misaligned");
    apply(features.chochAligned === true, -0.05, "vnext2m_choch_noise");
    apply(Number(features.smcAlignedCount) >= 3, 0.03, "vnext2m_smc_stack");
    apply(Number(features.smcAlignedCount) === 2, 0.01, "vnext2m_smc_pair");
    apply(features.recentCross === false, 0.04, "vnext2m_not_recent_cross");
    apply(features.recentCross === true, -0.035, "vnext2m_recent_cross_noise");
    apply(features.freshCross === true && features.nearSlowEma === true, 0.015, "vnext2m_fresh_compact_cross");
    apply(features.emaBiasAligned === false, -0.035, "vnext2m_ema_bias_misaligned");
    apply(rsiBucket === "68+", 0.02, "vnext2m_rsi_momentum_high");
    apply(rsiBucket === "60-68", 0.01, "vnext2m_rsi_momentum_supportive");
    apply(rsiBucket === "<32", -0.03, "vnext2m_rsi_oversold");
    apply(features.vwapPositionAligned === true, -0.015, "vnext2m_vwap_stretched");
    apply(features.bandBasisAligned === false, -0.02, "vnext2m_band_basis_misaligned");
    apply(features.opposingBandTrend === true, -0.04, "vnext2m_opposing_band_trend");
    apply(features.opposingBandRetest === true, -0.02, "vnext2m_opposing_band_retest");
    apply(features.sweepAligned === true, 0.02, "vnext2m_sweep_confirmation");
    apply(
      features.bandTrendAligned === true
        && features.bandRetestAligned === true
        && features.vwapPositionAligned !== true,
      0.025,
      "vnext2m_clean_band_alignment",
    );

    apply(e21DistanceBucket === "<5bps", 0.02, "vnext2m_ema21_compact");
    apply(e21DistanceBucket === "5-10bps", 0.005, "vnext2m_ema21_near");
    apply(e21DistanceBucket === "10-20bps", -0.04, "vnext2m_ema21_extended");
    apply(e21DistanceBucket === "20bps+", -0.05, "vnext2m_ema21_overextended");

    apply(bandBasisDistanceBucket === "<5bps", 0.015, "vnext2m_band_basis_compact");
    apply(bandBasisDistanceBucket === "5-10bps", 0.005, "vnext2m_band_basis_near");
    apply(bandBasisDistanceBucket === "10-20bps", -0.04, "vnext2m_band_basis_extended");
    apply(bandBasisDistanceBucket === "20bps+", -0.045, "vnext2m_band_basis_overextended");

    apply(volRatioBucket === "1.5-2.0", 0.005, "vnext2m_volume_supportive");
    apply(volRatioBucket === "2.0+", 0.03, "vnext2m_volume_expansion");
  }

  const clampedAdjustment = Math.max(-QUALITY_ADJUSTMENT_CAP, Math.min(QUALITY_ADJUSTMENT_CAP, adjustment));
  return {
    adjustment: +clampedAdjustment.toFixed(4),
    rulesApplied,
  };
}

function buildQualityRankingAdjustmentVNext2m({
  config = {},
  signalFeatures = null,
  signalClass = "trend_change",
  direction = null,
  signalMinuteOfDay = null,
} = {}) {
  const normalizedTimeframe = normalizeTimeframeLabel(config?.activeTimeframe, "");
  const normalizedSignalClass = normalizeSignalClass(signalClass, "");
  const normalizedDirection = normalizeDirection(direction, null);
  const directionalRankProfile = isVNext2mDirectionalRankProfile(config);
  const regimeRankProfile = isVNext2mRegimeRankProfile(config);

  if (
    normalizedTimeframe !== "2m"
    || normalizedSignalClass !== "trend_change"
    || !normalizedDirection
    || (!directionalRankProfile && !regimeRankProfile)
  ) {
    return {
      adjustment: 0,
      rulesApplied: [],
    };
  }

  const features = signalFeatures && typeof signalFeatures === "object" ? signalFeatures : {};
  const e21DistanceBucket = classifyAbsDistanceBucket(features.distanceToE21Bps);
  const bandBasisDistanceBucket = classifyAbsDistanceBucket(features.distanceToBandBasisBps);
  const volRatioBucket = classifyVolRatio(features.volRatio);
  const rsiBucket = classifyRsiBucket(features.rsi);
  const smcAlignedCount = Number(features.smcAlignedCount) || 0;
  const regime = normalizeFeatureRegime(features.regime);
  const sessionBucket = resolveSignalSessionBucket(signalMinuteOfDay);
  let adjustment = 0;
  const rulesApplied = [];
  const apply = (condition, delta, reason) => {
    if (!condition) {
      return;
    }
    adjustment += delta;
    rulesApplied.push({
      reason,
      delta: +Number(delta).toFixed(3),
    });
  };

  if (normalizedDirection === "long") {
    apply(features.recentCross === false, -0.05, "vnext2m_rank_long_stale_cross_penalty");
    apply(features.recentCross === true, 0.025, "vnext2m_rank_long_recent_cross_relief");
    apply(features.freshCross === true && features.nearSlowEma === true, 0.015, "vnext2m_rank_long_fresh_compact_bonus");
    apply(smcAlignedCount >= 3, 0.02, "vnext2m_rank_long_smc_stack_bonus");
    apply(volRatioBucket === "2.0+", 0.015, "vnext2m_rank_long_volume_expansion_bonus");
    apply(rsiBucket === "68+", 0.01, "vnext2m_rank_long_momentum_extension_bonus");
    apply(e21DistanceBucket === "10-20bps", 0.025, "vnext2m_rank_long_ema21_expansion_relief");
    apply(e21DistanceBucket === "20bps+", 0.045, "vnext2m_rank_long_ema21_momentum_relief");
    apply(bandBasisDistanceBucket === "10-20bps", 0.025, "vnext2m_rank_long_band_expansion_relief");
    apply(bandBasisDistanceBucket === "20bps+", 0.04, "vnext2m_rank_long_band_momentum_relief");
    apply(features.bandBasisAligned === false, -0.01, "vnext2m_rank_long_band_basis_misaligned_extra");
    apply(features.regimeAligned === false, -0.01, "vnext2m_rank_long_regime_misaligned_extra");
  } else if (normalizedDirection === "short") {
    apply(features.recentCross === false, 0.015, "vnext2m_rank_short_stale_cross_bonus");
    apply(features.recentCross === true, -0.015, "vnext2m_rank_short_recent_cross_extra_penalty");
    apply(smcAlignedCount === 0, 0.01, "vnext2m_rank_short_clean_structure_bonus");
    apply(smcAlignedCount === 2, -0.015, "vnext2m_rank_short_smc_pair_penalty");
    apply(smcAlignedCount >= 3, -0.03, "vnext2m_rank_short_smc_stack_penalty");
    apply(e21DistanceBucket === "<5bps", 0.015, "vnext2m_rank_short_ema21_compact_bonus");
    apply(e21DistanceBucket === "5-10bps", 0.005, "vnext2m_rank_short_ema21_near_bonus");
    apply(e21DistanceBucket === "10-20bps", -0.015, "vnext2m_rank_short_ema21_extended_penalty");
    apply(e21DistanceBucket === "20bps+", -0.02, "vnext2m_rank_short_ema21_overextended_penalty");
    apply(bandBasisDistanceBucket === "<5bps", 0.015, "vnext2m_rank_short_band_compact_bonus");
    apply(bandBasisDistanceBucket === "5-10bps", 0.005, "vnext2m_rank_short_band_near_bonus");
    apply(bandBasisDistanceBucket === "10-20bps", -0.015, "vnext2m_rank_short_band_extended_penalty");
    apply(bandBasisDistanceBucket === "20bps+", -0.02, "vnext2m_rank_short_band_overextended_penalty");
    apply(features.vwapPositionAligned === true, -0.01, "vnext2m_rank_short_vwap_stretched_extra");
  }

  if (regimeRankProfile) {
    apply(normalizedDirection === "long" && regime === "bull", 0.01, "vnext2m_regime_long_bull_bonus");
    apply(normalizedDirection === "long" && regime === "range", -0.006, "vnext2m_regime_long_range_penalty");
    apply(normalizedDirection === "long" && regime === "bear", -0.015, "vnext2m_regime_long_bear_penalty");
    apply(normalizedDirection === "short" && regime === "range", 0.012, "vnext2m_regime_short_range_bonus");
    apply(normalizedDirection === "short" && regime === "bear", 0.008, "vnext2m_regime_short_bear_bonus");
    apply(normalizedDirection === "short" && regime === "bull", -0.015, "vnext2m_regime_short_bull_penalty");

    apply(sessionBucket === "midday", -0.004, "vnext2m_regime_midday_base_penalty");
    apply(sessionBucket === "midday" && features.regimeAligned === false, -0.004, "vnext2m_regime_midday_misaligned_penalty");
    apply(sessionBucket === "morning" && features.regimeAligned === true, 0.006, "vnext2m_regime_morning_aligned_bonus");
    apply(sessionBucket === "power_hour" && features.regimeAligned === true, 0.006, "vnext2m_regime_power_hour_aligned_bonus");
    apply(sessionBucket === "morning" && features.regimeAligned === false, -0.006, "vnext2m_regime_morning_misaligned_penalty");
    apply(sessionBucket === "power_hour" && features.regimeAligned === false, -0.006, "vnext2m_regime_power_hour_misaligned_penalty");
  }

  const clampedAdjustment = Math.max(-QUALITY_ADJUSTMENT_CAP, Math.min(QUALITY_ADJUSTMENT_CAP, adjustment));
  return {
    adjustment: +clampedAdjustment.toFixed(4),
    rulesApplied,
  };
}

function isVNext1Profile(config = {}) {
  const scoringVersion = String(config?.scoringVersion || "").trim();
  const executionProfile = String(config?.executionProfile || "").trim();
  return (
    scoringVersion === RAYALGO_SCORING_VERSION_VNEXT_1
    || executionProfile === RAYALGO_EXECUTION_PROFILE_VNEXT_1
  );
}

function isVNext2mProfile(config = {}) {
  const scoringVersion = String(config?.scoringVersion || "").trim();
  const executionProfile = String(config?.executionProfile || "").trim();
  return (
    scoringVersion === RAYALGO_SCORING_VERSION_VNEXT_2M
    || executionProfile === RAYALGO_EXECUTION_PROFILE_VNEXT_2M
  );
}

function isVNext2mSplitFloorProfile(config = {}) {
  const scoringVersion = String(config?.scoringVersion || "").trim();
  const executionProfile = String(config?.executionProfile || "").trim();
  return (
    scoringVersion === RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR
    || executionProfile === RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR
  );
}

function isVNext2mGatedProfile(config = {}) {
  const scoringVersion = String(config?.scoringVersion || "").trim();
  const executionProfile = String(config?.executionProfile || "").trim();
  return (
    scoringVersion === RAYALGO_SCORING_VERSION_VNEXT_2M_GATED
    || executionProfile === RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED
  );
}

function isVNext2mDirectionalRankProfile(config = {}) {
  const scoringVersion = String(config?.scoringVersion || "").trim();
  const executionProfile = String(config?.executionProfile || "").trim();
  return (
    scoringVersion === RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK
    || executionProfile === RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK
  );
}

function isVNext2mRegimeRankProfile(config = {}) {
  const scoringVersion = String(config?.scoringVersion || "").trim();
  const executionProfile = String(config?.executionProfile || "").trim();
  return (
    scoringVersion === RAYALGO_SCORING_VERSION_VNEXT_2M_REGIME_RANK
    || executionProfile === RAYALGO_EXECUTION_PROFILE_VNEXT_2M_REGIME_RANK
  );
}

function isVNext2mDirectionalFloorProfile(config = {}) {
  return isVNext2mSplitFloorProfile(config) || isVNext2mGatedProfile(config);
}

function isVNext2mFamilyProfile(config = {}) {
  return (
    isVNext2mProfile(config)
    || isVNext2mSplitFloorProfile(config)
    || isVNext2mGatedProfile(config)
    || isVNext2mDirectionalRankProfile(config)
    || isVNext2mRegimeRankProfile(config)
  );
}

function resolveQualityFeatureAdjustment(
  config = {},
  signalFeatures = null,
  signalClass = "trend_change",
  {
    direction = null,
    signalMinuteOfDay = null,
  } = {},
) {
  if (isVNext2mFamilyProfile(config)) {
    const base = buildQualityFeatureAdjustmentVNext2m(signalFeatures, signalClass, config?.activeTimeframe);
    const ranking = buildQualityRankingAdjustmentVNext2m({
      config,
      signalFeatures,
      signalClass,
      direction,
      signalMinuteOfDay,
    });
    const totalAdjustment = Math.max(
      -QUALITY_ADJUSTMENT_CAP,
      Math.min(QUALITY_ADJUSTMENT_CAP, (Number(base.adjustment) || 0) + (Number(ranking.adjustment) || 0)),
    );
    return {
      adjustment: +Number(totalAdjustment).toFixed(4),
      rulesApplied: [
        ...(Array.isArray(base.rulesApplied) ? base.rulesApplied : []),
        ...(Array.isArray(ranking.rulesApplied) ? ranking.rulesApplied : []),
      ],
    };
  }
  if (isVNext1Profile(config)) {
    return buildQualityFeatureAdjustmentVNext(signalFeatures, signalClass);
  }
  return buildQualityFeatureAdjustment(signalFeatures, signalClass);
}

function resolveQualityScoreScale(config = {}) {
  if (isVNext2mFamilyProfile(config)) {
    return normalizeTimeframeLabel(config?.activeTimeframe, "") === "2m"
      ? QUALITY_SCORE_SCALE_VNEXT_2M
      : QUALITY_SCORE_SCALE;
  }
  if (isVNext1Profile(config)) {
    return QUALITY_SCORE_SCALE_VNEXT_1;
  }
  return QUALITY_SCORE_SCALE;
}

function shouldApplyBaseCalibration(config = {}) {
  if (isVNext2mFamilyProfile(config)) {
    return normalizeTimeframeLabel(config?.activeTimeframe, "") !== "2m";
  }
  return !isVNext1Profile(config);
}

function resolveSignalRole(config = {}) {
  if (
    isVNext2mFamilyProfile(config)
    && normalizeTimeframeLabel(config?.activeTimeframe, "") === "1m"
  ) {
    return RAYALGO_SIGNAL_ROLE_ADVISORY;
  }
  return RAYALGO_SIGNAL_ROLE_ACTIONABLE;
}

function resolveScoreBucketKey(score) {
  const normalized = clampUnit(score);
  const bucket = SCORE_BUCKETS.find((entry) => normalized >= entry.lower && normalized < entry.upper);
  return bucket?.key || SCORE_BUCKETS[SCORE_BUCKETS.length - 1].key;
}

function resolveBaseScoreCalibration(activeTimeframe, direction, rawScore) {
  const timeframe = normalizeTimeframeLabel(activeTimeframe);
  const normalizedDirection = direction === "short" ? "short" : "long";
  const bucketKey = resolveScoreBucketKey(rawScore);
  const rule = CALIBRATION_RULES[timeframe]?.[normalizedDirection]?.[bucketKey] || null;
  const delta = Number(rule?.delta) || 0;
  return {
    bucketKey,
    reason: rule?.reason || null,
    delta: +delta.toFixed(4),
    calibratedBaseScore: clampUnit(rawScore + delta),
  };
}

function resolveQualityFloor(config = {}, { signalClass = "trend_change", direction = null } = {}) {
  const normalizedSignalClass = normalizeSignalClass(signalClass);
  const normalizedDirection = normalizeDirection(direction, null);
  const classDirectionFloor = normalizedDirection
    ? config?.qualityFloorBySignalClassDirection?.[normalizedSignalClass]?.[normalizedDirection]
    : null;
  if (hasFiniteNumericValue(classDirectionFloor)) {
    return classDirectionFloor;
  }
  const signalClassFloor = config?.qualityFloorBySignalClass?.[normalizedSignalClass];
  if (hasFiniteNumericValue(signalClassFloor)) {
    return signalClassFloor;
  }
  if (normalizedDirection) {
    const directionFloor = config?.qualityFloorByDirection?.[normalizedDirection];
    if (hasFiniteNumericValue(directionFloor)) {
      return directionFloor;
    }
  }
  if (hasFiniteNumericValue(config?.qualityFloor)) {
    return config.qualityFloor;
  }
  if (
    isVNext2mDirectionalFloorProfile(config)
    && normalizeTimeframeLabel(config?.activeTimeframe, "") === "2m"
    && normalizedSignalClass === "trend_change"
  ) {
    if (normalizedDirection === "long") {
      return 0.5;
    }
    if (normalizedDirection === "short") {
      return 0.45;
    }
  }
  return null;
}

function buildSignalEligibilityGate({
  config = {},
  signalFeatures = null,
  signalClass = "trend_change",
  direction = null,
  qualityScore = null,
  qualityFloor = null,
} = {}) {
  const normalizedDirection = normalizeDirection(direction, null);
  const normalizedSignalClass = normalizeSignalClass(signalClass);
  const defaultGate = {
    profile: null,
    status: "not_applicable",
    passed: true,
    hardBlocked: false,
    minimumScore: hasFiniteNumericValue(qualityFloor) ? clampUnit(qualityFloor) : null,
    reasonsApplied: [],
    hardBlockReasons: [],
  };
  if (
    !isVNext2mDirectionalFloorProfile(config)
    || normalizeTimeframeLabel(config?.activeTimeframe, "") !== "2m"
    || normalizedSignalClass !== "trend_change"
    || !normalizedDirection
  ) {
    return defaultGate;
  }

  const features = signalFeatures && typeof signalFeatures === "object" ? signalFeatures : {};
  const e21DistanceBucket = classifyAbsDistanceBucket(features.distanceToE21Bps);
  const bandBasisDistanceBucket = classifyAbsDistanceBucket(features.distanceToBandBasisBps);
  const minimumScore = hasFiniteNumericValue(qualityFloor)
    ? clampUnit(qualityFloor)
    : null;
  const hardBlockReasons = [];
  const applyHardBlock = (condition, reason) => {
    if (!condition) {
      return;
    }
    hardBlockReasons.push(reason);
  };

  if (isVNext2mGatedProfile(config)) {
    applyHardBlock(features.chochAligned === true, "gate_choch_aligned");
    applyHardBlock(features.regimeAligned === false, "gate_regime_misaligned");

    if (normalizedDirection === "long") {
      applyHardBlock(features.trendAligned === false, "gate_long_trend_misaligned");
      applyHardBlock(features.bandBasisAligned === false, "gate_long_band_basis_misaligned");
      applyHardBlock(features.opposingBandTrend === true, "gate_long_opposing_band_trend");
    } else if (normalizedDirection === "short") {
      applyHardBlock(features.vwapPositionAligned === true, "gate_short_vwap_stretched");
      applyHardBlock(features.obAligned === true, "gate_short_order_block_conflict");
      applyHardBlock(
        e21DistanceBucket === "10-20bps" || e21DistanceBucket === "20bps+",
        "gate_short_ema21_extended",
      );
      applyHardBlock(
        bandBasisDistanceBucket === "10-20bps" || bandBasisDistanceBucket === "20bps+",
        "gate_short_band_basis_extended",
      );
    }
  }

  const floorPassed = !Number.isFinite(minimumScore) || clampUnit(qualityScore) >= minimumScore;
  const reasonsApplied = [...hardBlockReasons];
  if (!floorPassed && Number.isFinite(minimumScore)) {
    reasonsApplied.push(`gate_min_quality_${normalizedDirection}`);
  }

  return {
    profile: isVNext2mGatedProfile(config)
      ? "rayalgo_tranche3_2m_directional_gate"
      : "rayalgo_tranche3_2m_split_floor",
    status: hardBlockReasons.length
      ? "blocked"
      : floorPassed
        ? "passed"
        : "below_floor",
    passed: hardBlockReasons.length === 0 && floorPassed,
    hardBlocked: hardBlockReasons.length > 0,
    minimumScore,
    reasonsApplied,
    hardBlockReasons,
  };
}

function normalizeBonusEntry(entry = {}) {
  return {
    ts: String(entry.ts || "").trim(),
    timeMs: Number(entry.timeMs),
    barIndex: Number.isFinite(Number(entry.barIndex)) ? Math.round(Number(entry.barIndex)) : null,
    direction: String(entry.direction || "").trim().toLowerCase() === "short" ? "short" : "long",
    rawScore: clampUnit(entry.rawScore),
    score: clampUnit(entry.score),
  };
}

function resolvePhaseContextProfile({ marketSymbol = null, activeTimeframe = "5m", signalClass = "trend_change" } = {}) {
  const normalizedSymbol = String(marketSymbol || "").trim().toUpperCase();
  if (normalizedSymbol !== "SPY" || normalizeSignalClass(signalClass) !== "trend_change") {
    return null;
  }
  return SPY_PHASE_CONTEXT_PROFILES[normalizeTimeframeLabel(activeTimeframe, "")] || null;
}

function resolveLatestFrameEvent(frameEvents = [], signalTimeMs) {
  const normalized = (Array.isArray(frameEvents) ? frameEvents : [])
    .map(normalizeBonusEntry)
    .filter((entry) => Number.isFinite(entry.timeMs) && entry.timeMs < signalTimeMs)
    .sort((left, right) => Number(left.timeMs) - Number(right.timeMs));
  return normalized[normalized.length - 1] || null;
}

function buildPhaseContextAdjustment({
  marketSymbol = null,
  activeTimeframe = "5m",
  signalClass = "trend_change",
  signalDirection = null,
  signalTimeMs = null,
  precursorEventsByFrame = {},
  precursorBarTimesByFrame = {},
} = {}) {
  const profile = resolvePhaseContextProfile({
    marketSymbol,
    activeTimeframe,
    signalClass,
  });
  if (!profile || !Number.isFinite(Number(signalTimeMs)) || !signalDirection) {
    return {
      bucket: null,
      adjustment: 0,
      states: {},
      rulesApplied: [],
    };
  }

  let hasFreshSame = false;
  let hasStaleSame = false;
  let hasFreshOpp = false;
  let hasStaleOpp = false;
  let resolved = 0;
  const states = {};

  for (const [timeframe, freshBars] of Object.entries(profile.frames || {})) {
    const latest = resolveLatestFrameEvent(precursorEventsByFrame?.[timeframe], Number(signalTimeMs));
    if (!latest) {
      states[timeframe] = {
        relation: "missing",
        freshness: "missing",
        ageContextBars: null,
      };
      continue;
    }
    const contextMinutes = Math.max(1, Number(timeframeToMinutes(timeframe)) || 0);
    const contextBarIndex = findContainingBarIndex(precursorBarTimesByFrame?.[timeframe], Number(signalTimeMs));
    const ageContextBars = Number.isInteger(contextBarIndex) && Number.isInteger(latest.barIndex)
      ? Math.max(0, contextBarIndex - latest.barIndex)
      : Math.max(0, Math.floor((Number(signalTimeMs) - Number(latest.timeMs)) / (Math.max(1, contextMinutes) * 60000)));
    const freshness = ageContextBars <= freshBars ? "fresh" : "stale";
    const relation = latest.direction === signalDirection ? "same" : "opp";
    states[timeframe] = {
      relation,
      freshness,
      ageContextBars,
      lastSignalTs: latest.ts || null,
      lastSignalScore: latest.score ?? latest.rawScore ?? null,
    };
    resolved += 1;
    if (relation === "same" && freshness === "fresh") hasFreshSame = true;
    if (relation === "same" && freshness === "stale") hasStaleSame = true;
    if (relation === "opp" && freshness === "fresh") hasFreshOpp = true;
    if (relation === "opp" && freshness === "stale") hasStaleOpp = true;
  }

  let bucket = "unresolved";
  if (resolved === 0) bucket = "unresolved";
  else if (hasFreshOpp) bucket = "fresh_opposition";
  else if (hasFreshSame && !hasStaleOpp) bucket = "fresh_support";
  else if (hasStaleSame && !hasStaleOpp && !hasFreshSame) bucket = "stale_support";
  else if (hasStaleOpp && !hasFreshSame && !hasFreshOpp) bucket = "stale_opposition";
  else bucket = "mixed_phase";

  const adjustment = Number(profile.adjustments?.[bucket]) || 0;
  return {
    bucket,
    adjustment: +adjustment.toFixed(4),
    states,
    rulesApplied: adjustment
      ? [{ reason: `spy_${normalizeTimeframeLabel(activeTimeframe, "")}_${bucket}`, delta: +adjustment.toFixed(3) }]
      : [],
  };
}

function resolveEligibleWindowStart(signalTimeMs, activeTimeframe) {
  const activeMinutes = Math.max(1, timeframeToMinutes(activeTimeframe) || 5);
  return signalTimeMs - (activeMinutes * 60 * 1000);
}

function buildFrameContribution({
  timeframe,
  signalDirection,
  signalTimeMs,
  activeTimeframe,
  frameEvents = [],
  frameIndex = 0,
}) {
  const windowStart = resolveEligibleWindowStart(signalTimeMs, activeTimeframe);
  const inWindow = frameEvents
    .map(normalizeBonusEntry)
    .filter((entry) => Number.isFinite(entry.timeMs) && entry.timeMs < signalTimeMs && entry.timeMs >= windowStart);
  const aligned = inWindow.filter((entry) => entry.direction === signalDirection);
  const conflicting = inWindow.filter((entry) => entry.direction !== signalDirection);
  const latestAligned = aligned[aligned.length - 1] || null;
  const activeWindowMs = Math.max(1, signalTimeMs - windowStart);
  const recentThreshold = signalTimeMs - activeWindowMs / 2;
  const recencyMultiplier = latestAligned && latestAligned.timeMs >= recentThreshold ? 1.0 : 0.6;
  const strengthMultiplier = latestAligned
    ? Math.min(1, (latestAligned.rawScore || latestAligned.score || 0) / PRECURSOR_STRENGTH_CAP)
    : 0;
  const repeatBonus = Math.min(PRECURSOR_REPEAT_CAP, Math.max(0, aligned.length - 1) * PRECURSOR_REPEAT_STEP);
  const baseWeight = computeBaseWeight(frameIndex);
  const maxFrameBonus = baseWeight + PRECURSOR_REPEAT_CAP;
  const contribution = conflicting.length || !latestAligned
    ? 0
    : Math.min(maxFrameBonus, (baseWeight + repeatBonus) * recencyMultiplier * strengthMultiplier);

  return {
    timeframe,
    hits: aligned.length,
    conflict: conflicting.length > 0,
    contribution: +contribution.toFixed(4),
    repeatCount: Math.max(0, aligned.length - 1),
    lastSignalTs: latestAligned?.ts || null,
    lastSignalScore: latestAligned?.score ?? latestAligned?.rawScore ?? null,
  };
}

export function getRayAlgoPrecursorTemplates(activeTimeframe) {
  return resolveTemplatesForTimeframe(activeTimeframe).map((template) => ({
    id: template.id,
    frames: [...template.frames],
  }));
}

export function normalizeRayAlgoScoringPreferences(value = {}) {
  return {
    precursorLadderId: normalizePrecursorLadderId(
      value.precursorLadderId || value.ladderId || RAYALGO_PRECURSOR_LADDER_NONE,
    ),
    conflictPolicy: normalizeConflictPolicy(
      value.conflictPolicy || RAYALGO_CONFLICT_POLICY_V2_NUANCE,
    ),
    authority: normalizeAuthority(
      value.authority || RAYALGO_AUTHORITY_OBSERVE_ONLY,
    ),
    displayMode: normalizeDisplayMode(
      value.displayMode || value.displayScoreMode || value.scoreDisplayMode || value.scoreDisplay || RAYALGO_DISPLAY_MODE_AUTO,
    ),
  };
}

export function normalizeRayAlgoScoringConfig(value = {}) {
  const activeTimeframe = normalizeTimeframeLabel(value.activeTimeframe || value.signalTimeframe || "5m");
  const preferences = normalizeRayAlgoScoringPreferences(value);
  const template = resolveTemplate(activeTimeframe, preferences.precursorLadderId);
  const explicitPrecursorFrames = normalizePrecursorFrameList(
    value.precursorFrames || value.contextFrames || value.contextTimeframes || value.scoringContextFrames,
    activeTimeframe,
  );
  const marketSymbol = String(value.marketSymbol || value.symbol || "").trim().toUpperCase() || null;
  return {
    executionProfile: normalizeId(value.executionProfile, RAYALGO_EXECUTION_PROFILE),
    scoringVersion: normalizeId(value.scoringVersion, RAYALGO_SCORING_VERSION),
    marketSymbol,
    activeTimeframe,
    precursorLadderId: explicitPrecursorFrames.length ? "custom" : template.id,
    precursorFrames: explicitPrecursorFrames.length ? explicitPrecursorFrames : [...template.frames],
    conflictPolicy: preferences.conflictPolicy,
    authority: preferences.authority,
    displayModePreference: preferences.displayMode,
    displayMode: preferences.displayMode,
    signalRole: resolveSignalRole({
      executionProfile: normalizeId(value.executionProfile, RAYALGO_EXECUTION_PROFILE),
      scoringVersion: normalizeId(value.scoringVersion, RAYALGO_SCORING_VERSION),
      activeTimeframe,
    }),
    threshold: clampUnit(value.threshold ?? DEFAULT_THRESHOLD) || DEFAULT_THRESHOLD,
    qualityFloor: normalizeOptionalUnit(value.qualityFloor ?? value.tradeQualityFloor ?? value.minQualityScore),
    qualityFloorBySignalClass: normalizeFloorMapBySignalClass(
      value.qualityFloorBySignalClass || value.tradeQualityFloorBySignalClass || value.minQualityScoreBySignalClass,
    ),
    qualityFloorByDirection: normalizeFloorMapByDirection(
      value.qualityFloorByDirection || value.tradeQualityFloorByDirection || value.minQualityScoreByDirection,
    ),
    qualityFloorBySignalClassDirection: normalizeFloorMapBySignalClassDirection(
      value.qualityFloorBySignalClassDirection || value.tradeQualityFloorBySignalClassDirection || value.minQualityScoreBySignalClassDirection,
    ),
  };
}

export function listRayAlgoScoringTimeframes(config = {}) {
  const normalized = normalizeRayAlgoScoringConfig(config);
  return Array.from(new Set([
    normalized.activeTimeframe,
    ...normalized.precursorFrames,
  ]));
}

export function formatRayAlgoScoreLabel(score) {
  const numeric = Number(score);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : "";
}

export function buildRayAlgoSignalScore({
  rayConviction,
  signalDirection = null,
  signalClass = "trend_change",
  signalTs = null,
  signalTimeMs = null,
  signalMinuteOfDay = null,
  precursorEventsByFrame = {},
  precursorBarTimesByFrame = {},
  signalFeatures = null,
  config = {},
} = {}) {
  const normalizedConfig = normalizeRayAlgoScoringConfig(config);
  const signalRole = resolveSignalRole(normalizedConfig);
  const direction = signalDirection === "short" ? "short" : signalDirection === "long" ? "long" : null;
  const normalizedSignalClass = normalizeSignalClass(signalClass);
  const absoluteConviction = Math.abs(Number(rayConviction) || 0);
  const qualityScoreScale = resolveQualityScoreScale(normalizedConfig);
  const rawScore = absoluteConviction >= 0.65
    ? Math.min(1, absoluteConviction * 1.1)
    : absoluteConviction;
  const applyBaseCalibration = shouldApplyBaseCalibration(normalizedConfig);
  const calibration = applyBaseCalibration
    ? resolveBaseScoreCalibration(normalizedConfig.activeTimeframe, direction, rawScore)
    : {
      bucketKey: resolveScoreBucketKey(rawScore),
      reason: "disabled_for_vnext",
      delta: 0,
      calibratedBaseScore: clampUnit(rawScore),
    };
  const qualityFeatureAdjustment = resolveQualityFeatureAdjustment(
    normalizedConfig,
    signalFeatures,
    normalizedSignalClass,
    {
      direction,
      signalMinuteOfDay,
    },
  );
  const qualityFloor = resolveQualityFloor(normalizedConfig, {
    signalClass: normalizedSignalClass,
    direction,
  });
  const baseQualityScore = clampUnit(rawScore * qualityScoreScale + qualityFeatureAdjustment.adjustment);
  const baseEffectiveScore = buildEffectiveScoreContext({
    marketSymbol: normalizedConfig.marketSymbol,
    signalClass: normalizedSignalClass,
    direction,
    rawScore,
    finalScore: baseQualityScore,
  });
  const baseQualityGatePassed = !hasFiniteNumericValue(qualityFloor) || baseQualityScore >= qualityFloor;
  const baseDisplayMode = resolveLiveDisplayMode(normalizedConfig.displayMode, baseEffectiveScore.mode);
  const baseDisplayScoreValue = baseDisplayMode === RAYALGO_DISPLAY_MODE_RAW ? clampUnit(rawScore) : baseQualityScore;
  const baseEligibilityGate = buildSignalEligibilityGate({
    config: normalizedConfig,
    signalFeatures,
    signalClass: normalizedSignalClass,
    direction,
    qualityScore: baseQualityScore,
    qualityFloor,
  });

  if (!direction || rawScore < normalizedConfig.threshold) {
    return {
      signalFired: false,
      signalClass: normalizedSignalClass,
      direction: direction || null,
      activeTimeframe: normalizedConfig.activeTimeframe,
      marketSymbol: normalizedConfig.marketSymbol,
      rawScore: clampUnit(rawScore),
      calibratedBaseScore: calibration.calibratedBaseScore,
      calibrationDelta: calibration.delta,
      precursorBonus: 0,
      confidenceScore: clampUnit(rawScore),
      qualityScore: baseQualityScore,
      effectiveScore: baseEffectiveScore.score,
      effectiveScoreMode: baseEffectiveScore.mode,
      score: baseQualityScore,
      components: {
        baseScore: clampUnit(rawScore),
        calibratedBaseScore: calibration.calibratedBaseScore,
        calibrationDelta: calibration.delta,
        confidenceScore: clampUnit(rawScore),
        qualityScale: qualityScoreScale,
        qualityAdjustment: qualityFeatureAdjustment.adjustment,
        phaseAdjustment: 0,
      },
      calibrationContext: {
        bucketKey: calibration.bucketKey,
        reason: calibration.reason,
      },
      qualityGate: {
        floor: qualityFloor,
        passed: baseQualityGatePassed,
      },
      eligibilityGate: baseEligibilityGate,
      featureContext: {
        snapshot: signalFeatures || null,
        qualityAdjustment: qualityFeatureAdjustment.adjustment,
        phaseAdjustment: 0,
        rulesApplied: qualityFeatureAdjustment.rulesApplied,
      },
      phaseContext: {
        bucket: null,
        adjustment: 0,
        states: {},
        rulesApplied: [],
      },
      precursorContext: {
        ladderId: normalizedConfig.precursorLadderId,
        frames: normalizedConfig.precursorFrames.map((timeframe) => ({
          timeframe,
          hits: 0,
          conflict: false,
          contribution: 0,
          repeatCount: 0,
          lastSignalTs: null,
          lastSignalScore: null,
        })),
        hasConflict: false,
        totalHits: 0,
        dataStatus: "idle",
      },
      precursorLadderId: normalizedConfig.precursorLadderId,
      conflictPolicy: normalizedConfig.conflictPolicy,
      scoringVersion: normalizedConfig.scoringVersion,
      executionProfile: normalizedConfig.executionProfile,
      signalRole,
      authority: normalizedConfig.authority,
      displayModePreference: normalizedConfig.displayModePreference,
      displayScoreMode: baseDisplayMode,
      displayScoreValue: baseDisplayScoreValue,
      displayScoreText: formatRayAlgoScoreLabel(baseDisplayScoreValue),
    };
  }

  const resolvedSignalTimeMs = Number.isFinite(Number(signalTimeMs))
    ? Number(signalTimeMs)
    : Date.parse(String(signalTs || ""));
  const frameSummaries = [];
  for (const [frameIndex, timeframe] of normalizedConfig.precursorFrames.entries()) {
    const frameEvents = Array.isArray(precursorEventsByFrame?.[timeframe]) ? precursorEventsByFrame[timeframe] : [];
    frameSummaries.push(buildFrameContribution({
      timeframe,
      signalDirection: direction,
      signalTimeMs: resolvedSignalTimeMs,
      activeTimeframe: normalizedConfig.activeTimeframe,
      frameEvents,
      frameIndex,
    }));
  }

  const precursorBonus = Math.min(
    PRECURSOR_TOTAL_CAP,
    frameSummaries.reduce((sum, frame) => sum + (Number(frame.contribution) || 0), 0),
  );
  const totalHits = frameSummaries.reduce((sum, frame) => sum + frame.hits, 0);
  const hasConflict = frameSummaries.some((frame) => frame.conflict);
  const confidenceScore = Math.min(1, calibration.calibratedBaseScore + precursorBonus);
  const phaseContext = buildPhaseContextAdjustment({
    marketSymbol: normalizedConfig.marketSymbol,
    activeTimeframe: normalizedConfig.activeTimeframe,
    signalClass: normalizedSignalClass,
    signalDirection: direction,
    signalTimeMs: resolvedSignalTimeMs,
    precursorEventsByFrame,
    precursorBarTimesByFrame,
  });
  const totalQualityAdjustment = qualityFeatureAdjustment.adjustment + phaseContext.adjustment;
  const qualityScore = clampUnit((confidenceScore * qualityScoreScale) + totalQualityAdjustment);
  const effectiveScore = buildEffectiveScoreContext({
    marketSymbol: normalizedConfig.marketSymbol,
    signalClass: normalizedSignalClass,
    direction,
    rawScore,
    finalScore: qualityScore,
  });
  const qualityGatePassed = !hasFiniteNumericValue(qualityFloor) || qualityScore >= qualityFloor;
  const eligibilityGate = buildSignalEligibilityGate({
    config: normalizedConfig,
    signalFeatures,
    signalClass: normalizedSignalClass,
    direction,
    qualityScore,
    qualityFloor,
  });
  const liveDisplayMode = resolveLiveDisplayMode(normalizedConfig.displayMode, effectiveScore.mode);
  const displayScoreValue = liveDisplayMode === RAYALGO_DISPLAY_MODE_RAW ? clampUnit(rawScore) : qualityScore;
  const dataStatus = normalizedConfig.precursorFrames.length
    ? (Number.isFinite(resolvedSignalTimeMs) ? "ready" : "degraded")
    : "none";

  return {
    signalFired: qualityGatePassed && eligibilityGate.passed,
    signalClass: normalizedSignalClass,
    direction,
    activeTimeframe: normalizedConfig.activeTimeframe,
    marketSymbol: normalizedConfig.marketSymbol,
    rawScore: clampUnit(rawScore),
    calibratedBaseScore: calibration.calibratedBaseScore,
    calibrationDelta: calibration.delta,
    precursorBonus: +precursorBonus.toFixed(4),
    confidenceScore: clampUnit(confidenceScore),
    qualityScore,
    effectiveScore: effectiveScore.score,
    effectiveScoreMode: effectiveScore.mode,
    score: qualityScore,
    components: {
      baseScore: clampUnit(rawScore),
      calibratedBaseScore: calibration.calibratedBaseScore,
      calibrationDelta: calibration.delta,
      precursorBonus: +precursorBonus.toFixed(4),
      confidenceScore: clampUnit(confidenceScore),
      qualityScale: qualityScoreScale,
      qualityAdjustment: qualityFeatureAdjustment.adjustment,
      phaseAdjustment: phaseContext.adjustment,
      totalQualityAdjustment: +totalQualityAdjustment.toFixed(4),
    },
    calibrationContext: {
      bucketKey: calibration.bucketKey,
      reason: calibration.reason,
    },
    qualityGate: {
      floor: qualityFloor,
      passed: qualityGatePassed,
    },
    eligibilityGate,
    featureContext: {
      snapshot: signalFeatures || null,
      qualityAdjustment: qualityFeatureAdjustment.adjustment,
      phaseAdjustment: phaseContext.adjustment,
      rulesApplied: [...qualityFeatureAdjustment.rulesApplied, ...phaseContext.rulesApplied],
    },
    phaseContext,
    precursorContext: {
      ladderId: normalizedConfig.precursorLadderId,
      frames: frameSummaries,
      hasConflict,
      totalHits,
      dataStatus,
    },
    precursorLadderId: normalizedConfig.precursorLadderId,
    conflictPolicy: normalizedConfig.conflictPolicy,
    scoringVersion: normalizedConfig.scoringVersion,
    executionProfile: normalizedConfig.executionProfile,
    signalRole,
    authority: normalizedConfig.authority,
    displayModePreference: normalizedConfig.displayModePreference,
    displayScoreMode: liveDisplayMode,
    displayScoreValue,
    displayScoreText: formatRayAlgoScoreLabel(displayScoreValue),
  };
}

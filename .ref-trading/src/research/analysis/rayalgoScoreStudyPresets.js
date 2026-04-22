import { normalizeRayAlgoSettings } from "../config/rayalgoSettings.js";
import {
  normalizeRayAlgoScoringConfig,
  normalizeRayAlgoScoringPreferences,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_REGIME_RANK,
  RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR,
  RAYALGO_SCORING_VERSION_VNEXT_2M,
  RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK,
  RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
  RAYALGO_SCORING_VERSION_VNEXT_2M_REGIME_RANK,
  RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR,
} from "../engine/rayalgoScoring.js";

export const RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP = "current_setup";
export const RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M = "tranche2_2m";
export const RAYALGO_SCORE_STUDY_PRESET_DIRECTION_RANK_V1 = "direction_rank_v1";
export const RAYALGO_SCORE_STUDY_PRESET_REGIME_RANK_V1 = "regime_rank_v1";
export const RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR = "tranche3_split_floor";
export const RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED = "tranche3_hard_gated";
export const RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES = Object.freeze(["2m", "5m", "15m"]);

const PRESET_DEFINITIONS = Object.freeze({
  [RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP]: Object.freeze({
    id: RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP,
    label: "Current Setup",
    description: "Use the active workbench RayAlgo settings and scoring config.",
    dynamic: true,
    timeframes: RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES,
    contextTimeframes: [],
    preferredTf: "1m",
    initialDays: 60,
  }),
  [RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M]: Object.freeze({
    id: RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M,
    label: "Tranche2 2m",
    description: "Baseline 2m scorer used for the latest tranche comparison.",
    scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M,
    executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M,
    activeTimeframe: "2m",
    timeframes: RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES,
    contextTimeframes: Object.freeze(["5m", "15m"]),
    preferredTf: "1m",
    initialDays: 60,
  }),
  [RAYALGO_SCORE_STUDY_PRESET_DIRECTION_RANK_V1]: Object.freeze({
    id: RAYALGO_SCORE_STUDY_PRESET_DIRECTION_RANK_V1,
    label: "Direction Rank v1",
    description: "2m non-gating ranker that separates long and short momentum structure.",
    scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_DIRECTION_RANK,
    executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_DIRECTION_RANK,
    activeTimeframe: "2m",
    timeframes: RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES,
    contextTimeframes: Object.freeze(["5m", "15m"]),
    preferredTf: "1m",
    initialDays: 60,
  }),
  [RAYALGO_SCORE_STUDY_PRESET_REGIME_RANK_V1]: Object.freeze({
    id: RAYALGO_SCORE_STUDY_PRESET_REGIME_RANK_V1,
    label: "Regime Rank v1",
    description: "2m non-gating ranker that layers regime and session context on top of direction-aware weights.",
    scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_REGIME_RANK,
    executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_REGIME_RANK,
    activeTimeframe: "2m",
    timeframes: RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES,
    contextTimeframes: Object.freeze(["5m", "15m"]),
    preferredTf: "1m",
    initialDays: 60,
  }),
  [RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR]: Object.freeze({
    id: RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR,
    label: "Tranche3 Split Floor",
    description: "2m split-floor scorer with advisory 1m behavior and directional floors.",
    scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_SPLIT_FLOOR,
    executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_SPLIT_FLOOR,
    activeTimeframe: "2m",
    timeframes: RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES,
    contextTimeframes: Object.freeze(["5m", "15m"]),
    preferredTf: "1m",
    initialDays: 60,
  }),
  [RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED]: Object.freeze({
    id: RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED,
    label: "Tranche3 Hard Gated",
    description: "2m hard-gated scorer used in the March 31 and April 1 comparisons.",
    scoringVersion: RAYALGO_SCORING_VERSION_VNEXT_2M_GATED,
    executionProfile: RAYALGO_EXECUTION_PROFILE_VNEXT_2M_GATED,
    activeTimeframe: "2m",
    timeframes: RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES,
    contextTimeframes: Object.freeze(["5m", "15m"]),
    preferredTf: "1m",
    initialDays: 60,
  }),
});

const PRESET_ORDER = Object.freeze([
  RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE2_2M,
  RAYALGO_SCORE_STUDY_PRESET_DIRECTION_RANK_V1,
  RAYALGO_SCORE_STUDY_PRESET_REGIME_RANK_V1,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_SPLIT_FLOOR,
  RAYALGO_SCORE_STUDY_PRESET_TRANCHE3_HARD_GATED,
]);

function normalizeSymbol(value) {
  return String(value || "SPY").trim().toUpperCase() || "SPY";
}

function normalizeTimeframe(value, fallback = "5m") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

export function listRayAlgoScoreStudyPresets() {
  return PRESET_ORDER.map((presetId) => PRESET_DEFINITIONS[presetId]);
}

export function getRayAlgoScoreStudyPresetDefinition(presetId = RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP) {
  return PRESET_DEFINITIONS[presetId] || PRESET_DEFINITIONS[RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP];
}

export function inferRayAlgoScoreStudyPresetId({ scoringVersion = null, executionProfile = null } = {}) {
  const normalizedScoringVersion = String(scoringVersion || "").trim();
  const normalizedExecutionProfile = String(executionProfile || "").trim();

  for (const presetId of PRESET_ORDER) {
    const preset = PRESET_DEFINITIONS[presetId];
    if (preset.dynamic) {
      continue;
    }
    if (
      normalizedScoringVersion
      && normalizedScoringVersion === String(preset.scoringVersion || "").trim()
    ) {
      return presetId;
    }
    if (
      normalizedExecutionProfile
      && normalizedExecutionProfile === String(preset.executionProfile || "").trim()
    ) {
      return presetId;
    }
  }

  return RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP;
}

export function resolveRayAlgoScoreStudyPresetConfig({
  presetId = RAYALGO_SCORE_STUDY_PRESET_CURRENT_SETUP,
  marketSymbol = "SPY",
  signalTimeframe = "5m",
  currentRayalgoSettings = null,
  currentRayalgoScoringConfig = null,
} = {}) {
  const preset = getRayAlgoScoreStudyPresetDefinition(presetId);
  const normalizedMarketSymbol = normalizeSymbol(marketSymbol);
  const normalizedSettings = normalizeRayAlgoSettings(currentRayalgoSettings || {});
  const currentPreferences = normalizeRayAlgoScoringPreferences(currentRayalgoScoringConfig || {});

  if (preset.dynamic) {
    const activeTimeframe = normalizeTimeframe(
      currentRayalgoScoringConfig?.activeTimeframe || signalTimeframe,
      "5m",
    );
    const normalizedScoringConfig = normalizeRayAlgoScoringConfig({
      ...(currentRayalgoScoringConfig || {}),
      ...currentPreferences,
      marketSymbol: normalizedMarketSymbol,
      activeTimeframe,
    });

    return {
      presetId: preset.id,
      presetLabel: preset.label,
      description: preset.description,
      marketSymbol: normalizedMarketSymbol,
      timeframes: [...RAYALGO_SCORE_STUDY_SIGNAL_TIMEFRAMES],
      requestedContextTimeframes: [...(normalizedScoringConfig.precursorFrames || [])],
      preferredTf: preset.preferredTf,
      initialDays: preset.initialDays,
      rayalgoSettings: normalizedSettings,
      rayalgoScoringConfig: normalizedScoringConfig,
    };
  }

  const normalizedScoringConfig = normalizeRayAlgoScoringConfig({
    ...currentPreferences,
    marketSymbol: normalizedMarketSymbol,
    activeTimeframe: preset.activeTimeframe,
    precursorFrames: preset.contextTimeframes,
    scoringVersion: preset.scoringVersion,
    executionProfile: preset.executionProfile,
  });

  return {
    presetId: preset.id,
    presetLabel: preset.label,
    description: preset.description,
    marketSymbol: normalizedMarketSymbol,
    timeframes: [...preset.timeframes],
    requestedContextTimeframes: [...preset.contextTimeframes],
    preferredTf: preset.preferredTf,
    initialDays: preset.initialDays,
    rayalgoSettings: normalizedSettings,
    rayalgoScoringConfig: normalizedScoringConfig,
  };
}

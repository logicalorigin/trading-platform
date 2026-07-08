import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
  SIGNAL_OPTIONS_MTF_TIMEFRAMES,
  STRATEGY_SIGNAL_TIMEFRAMES,
  normalizeSignalOptionsMtfTimeframes,
} from "./algoHelpers";

export const ALGO_TIMEFRAME_OPTIONS = Object.freeze([...STRATEGY_SIGNAL_TIMEFRAMES]);

export const normalizeAlgoExecutionTimeframe = (
  value,
  fallback = DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe,
) => {
  const timeframe = String(value || "").trim();
  return STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe)
    ? timeframe
    : STRATEGY_SIGNAL_TIMEFRAMES.includes(fallback)
      ? fallback
      : DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe;
};

export const normalizeAlgoMtfTimeframes = (
  value,
  fallback = SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
) => normalizeSignalOptionsMtfTimeframes(value, fallback);

const orderedMtfTimeframes = (timeframes) => {
  const selected = new Set(timeframes);
  return SIGNAL_OPTIONS_MTF_TIMEFRAMES.filter((timeframe) =>
    selected.has(timeframe),
  );
};

const buildMtfSelectionPatch = (timeframes, requiredCount = null) => {
  const selectedTimeframes = orderedMtfTimeframes(timeframes);
  return {
    timeframes: selectedTimeframes,
    preset: "custom",
    requiredCount: normalizeAlgoMtfRequiredCount(
      requiredCount,
      selectedTimeframes,
    ),
  };
};

const normalizeOptionalExecutionTimeframe = (value) => {
  const timeframe = String(value || "").trim();
  return STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe) ? timeframe : "";
};

export const normalizeAlgoAlignedMtfTimeframes = (
  selectedTimeframes,
  executionTimeframe,
  fallback = SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
) => {
  const normalized = normalizeAlgoMtfTimeframes(selectedTimeframes, fallback);
  const execution = normalizeOptionalExecutionTimeframe(executionTimeframe);
  if (!execution || normalized.includes(execution)) {
    return normalized;
  }
  return orderedMtfTimeframes([...normalized, execution]);
};

export const normalizeAlgoMtfRequiredCount = (
  value,
  selectedTimeframes,
  fallback = 2,
) => {
  // product ruling 2026-07-07: the panel's n-of-N governs. The stored value is
  // honored (clamped to the selection size); full-count is only the ceiling,
  // never forced — discarding the value here made every panel interaction
  // write unanimity back into the profile.
  const frameCount = Math.max(
    1,
    Array.isArray(selectedTimeframes) ? selectedTimeframes.length : 0,
  );
  // Number(null) === 0 — treat null/undefined/"" as unset, not as zero.
  const numericValue =
    value == null || value === "" ? Number.NaN : Number(value);
  const numericFallback =
    fallback == null || fallback === "" ? Number.NaN : Number(fallback);
  const base = Number.isFinite(numericValue)
    ? Math.round(numericValue)
    : Number.isFinite(numericFallback)
      ? Math.round(numericFallback)
      : frameCount;
  return Math.max(1, Math.min(frameCount, base));
};

export const buildAlgoExecutionTimeframePatch = (
  timeframe,
  fallback,
  selectedTimeframes,
  requiredCount = null,
) => {
  const signalTimeframe = normalizeAlgoExecutionTimeframe(timeframe, fallback);
  const currentMtfTimeframes = normalizeAlgoMtfTimeframes(selectedTimeframes);
  const alignedMtfTimeframes = normalizeAlgoAlignedMtfTimeframes(
    currentMtfTimeframes,
    signalTimeframe,
    currentMtfTimeframes,
  );
  if (alignedMtfTimeframes.length === currentMtfTimeframes.length) {
    return { signalTimeframe };
  }
  return {
    signalTimeframe,
    ...buildMtfSelectionPatch(alignedMtfTimeframes, requiredCount),
  };
};

export const buildAlgoMtfTimeframeTogglePatch = ({
  selectedTimeframes,
  timeframe,
  executionTimeframe,
  requiredCount = null,
}) => {
  const current = normalizeAlgoAlignedMtfTimeframes(
    selectedTimeframes,
    executionTimeframe,
  );
  const normalizedTimeframe = String(timeframe || "").trim();
  if (!SIGNAL_OPTIONS_MTF_TIMEFRAMES.includes(normalizedTimeframe)) {
    return buildMtfSelectionPatch(current, requiredCount);
  }
  if (normalizedTimeframe === normalizeOptionalExecutionTimeframe(executionTimeframe)) {
    return buildMtfSelectionPatch(current, requiredCount);
  }

  const nextSet = new Set(current);
  if (nextSet.has(normalizedTimeframe)) {
    if (nextSet.size > 1) {
      nextSet.delete(normalizedTimeframe);
    }
  } else {
    nextSet.add(normalizedTimeframe);
  }

  return buildMtfSelectionPatch([...nextSet], requiredCount);
};

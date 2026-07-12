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
  _value,
  selectedTimeframes,
  _fallback = 2,
) => {
  return Math.max(
    1,
    Array.isArray(selectedTimeframes) ? selectedTimeframes.length : 0,
  );
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

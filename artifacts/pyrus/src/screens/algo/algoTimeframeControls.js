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

const buildMtfSelectionPatch = (timeframes) => {
  const selectedTimeframes = orderedMtfTimeframes(timeframes);
  return {
    timeframes: selectedTimeframes,
    preset: "custom",
    requiredCount: normalizeAlgoMtfRequiredCount(null, selectedTimeframes),
  };
};

export const normalizeAlgoAlignedMtfTimeframes = (
  selectedTimeframes,
  executionTimeframe,
  fallback = SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
) => {
  void executionTimeframe;
  return normalizeAlgoMtfTimeframes(selectedTimeframes, fallback);
};

export const normalizeAlgoMtfRequiredCount = (
  _value,
  selectedTimeframes,
  _fallback = 2,
) => {
  return Math.max(1, Array.isArray(selectedTimeframes) ? selectedTimeframes.length : 0);
};

export const buildAlgoExecutionTimeframePatch = (
  timeframe,
  fallback,
  selectedTimeframes,
) => {
  void selectedTimeframes;
  const signalTimeframe = normalizeAlgoExecutionTimeframe(timeframe, fallback);
  return { signalTimeframe };
};

export const buildAlgoMtfTimeframeTogglePatch = ({
  selectedTimeframes,
  timeframe,
}) => {
  const current = normalizeAlgoMtfTimeframes(selectedTimeframes);
  const normalizedTimeframe = String(timeframe || "").trim();
  if (!SIGNAL_OPTIONS_MTF_TIMEFRAMES.includes(normalizedTimeframe)) {
    return buildMtfSelectionPatch(current);
  }

  const nextSet = new Set(current);
  if (nextSet.has(normalizedTimeframe)) {
    if (nextSet.size > 1) {
      nextSet.delete(normalizedTimeframe);
    }
  } else {
    nextSet.add(normalizedTimeframe);
  }

  return buildMtfSelectionPatch([...nextSet]);
};

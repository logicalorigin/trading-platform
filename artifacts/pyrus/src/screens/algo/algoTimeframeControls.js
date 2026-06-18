import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
  SIGNAL_OPTIONS_MTF_TIMEFRAMES,
  STRATEGY_SIGNAL_TIMEFRAMES,
  normalizeSignalOptionsMtfTimeframes,
  numberFrom,
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

const normalizeOptionalExecutionTimeframe = (value) => {
  const timeframe = String(value || "").trim();
  return STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe) &&
    SIGNAL_OPTIONS_MTF_TIMEFRAMES.includes(timeframe)
    ? timeframe
    : "";
};

const buildMtfSelectionPatch = (timeframes) => {
  const selectedTimeframes = orderedMtfTimeframes(timeframes);
  return {
    timeframes: selectedTimeframes,
    preset: "custom",
    // Selected frames must all align: required count tracks the selection.
    requiredCount: Math.max(1, selectedTimeframes.length),
  };
};

export const normalizeAlgoAlignedMtfTimeframes = (
  selectedTimeframes,
  executionTimeframe,
  fallback = SIGNAL_OPTIONS_DEFAULT_MTF_TIMEFRAMES,
) => {
  const current = normalizeAlgoMtfTimeframes(selectedTimeframes, fallback);
  const normalizedExecutionTimeframe =
    normalizeOptionalExecutionTimeframe(executionTimeframe);
  return normalizedExecutionTimeframe
    ? orderedMtfTimeframes([...current, normalizedExecutionTimeframe])
    : current;
};

export const normalizeAlgoMtfRequiredCount = (
  value,
  selectedTimeframes,
  fallback = 2,
) => {
  const selectedCount = Math.max(1, selectedTimeframes.length);
  const parsed = Math.round(numberFrom(value, fallback));
  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(selectedCount, Math.max(1, next));
};

export const buildAlgoExecutionTimeframePatch = (
  timeframe,
  fallback,
  selectedTimeframes,
) => {
  const signalTimeframe = normalizeAlgoExecutionTimeframe(timeframe, fallback);
  const patch = { signalTimeframe };
  if (!Array.isArray(selectedTimeframes)) {
    return patch;
  }

  return {
    ...patch,
    ...buildMtfSelectionPatch(
      normalizeAlgoAlignedMtfTimeframes(selectedTimeframes, signalTimeframe),
    ),
  };
};

export const buildAlgoMtfTimeframeTogglePatch = ({
  selectedTimeframes,
  timeframe,
  executionTimeframe,
}) => {
  const current = normalizeAlgoMtfTimeframes(selectedTimeframes);
  const normalizedTimeframe = String(timeframe || "").trim();
  const normalizedExecutionTimeframe =
    normalizeOptionalExecutionTimeframe(executionTimeframe);
  if (!SIGNAL_OPTIONS_MTF_TIMEFRAMES.includes(normalizedTimeframe)) {
    return buildMtfSelectionPatch(
      normalizeAlgoAlignedMtfTimeframes(current, normalizedExecutionTimeframe),
    );
  }

  const nextSet = new Set(current);
  if (nextSet.has(normalizedTimeframe)) {
    if (
      nextSet.size > 1 &&
      normalizedTimeframe !== normalizedExecutionTimeframe
    ) {
      nextSet.delete(normalizedTimeframe);
    }
  } else {
    nextSet.add(normalizedTimeframe);
  }

  return buildMtfSelectionPatch(
    normalizeAlgoAlignedMtfTimeframes([...nextSet], normalizedExecutionTimeframe),
  );
};

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

export const buildAlgoExecutionTimeframePatch = (timeframe, fallback) => ({
  signalTimeframe: normalizeAlgoExecutionTimeframe(timeframe, fallback),
});

export const buildAlgoMtfTimeframeTogglePatch = ({
  selectedTimeframes,
  timeframe,
}) => {
  const current = normalizeAlgoMtfTimeframes(selectedTimeframes);
  const normalizedTimeframe = String(timeframe || "").trim();
  if (!SIGNAL_OPTIONS_MTF_TIMEFRAMES.includes(normalizedTimeframe)) {
    return {
      timeframes: current,
      preset: "custom",
      // Selected frames must all align: required count tracks the selection.
      requiredCount: Math.max(1, current.length),
    };
  }

  const nextSet = new Set(current);
  if (nextSet.has(normalizedTimeframe)) {
    if (nextSet.size > 1) {
      nextSet.delete(normalizedTimeframe);
    }
  } else {
    nextSet.add(normalizedTimeframe);
  }

  const timeframes = orderedMtfTimeframes([...nextSet]);
  return {
    timeframes,
    preset: "custom",
    // Selected frames must all align: required count tracks the selection.
    requiredCount: Math.max(1, timeframes.length),
  };
};

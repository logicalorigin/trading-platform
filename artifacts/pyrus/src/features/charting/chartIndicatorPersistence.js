import {
  PYRUS_SIGNALS_PINE_SCRIPT_KEY,
  resolvePyrusSignalsRuntimeSettings,
} from "./pyrusSignalsPineAdapter";

export const normalizeIndicatorSelection = (value, fallback = []) => {
  const source = Array.isArray(value) ? value : fallback;
  const seen = new Set();
  return source.filter((indicatorId) => {
    if (typeof indicatorId !== "string" || !indicatorId.trim()) {
      return false;
    }
    if (seen.has(indicatorId)) {
      return false;
    }
    seen.add(indicatorId);
    return true;
  });
};

export const mergeIndicatorSelections = (...selections) =>
  normalizeIndicatorSelection(selections.flat(), []);

export const resolvePersistedIndicatorPreset = ({
  indicators,
  defaults,
  persistedVersion,
  currentVersion,
}) => {
  const normalized = normalizeIndicatorSelection(indicators, defaults);
  return persistedVersion === currentVersion
    ? normalized
    : mergeIndicatorSelections(defaults, normalized);
};

export const resolvePersistedPyrusSignalsSettings = (value) =>
  resolvePyrusSignalsRuntimeSettings(
    value && typeof value === "object" ? value : undefined,
  );

export const buildPyrusSignalsIndicatorSettings = (settings) => ({
  [PYRUS_SIGNALS_PINE_SCRIPT_KEY]: settings,
});

export const isPyrusSignalsIndicatorSelected = (selectedIndicators = []) =>
  selectedIndicators.includes(PYRUS_SIGNALS_PINE_SCRIPT_KEY);

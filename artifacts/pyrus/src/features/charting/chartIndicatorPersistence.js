import {
  DEFAULT_PYRUS_SIGNALS_SETTINGS,
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

const asRecord = (value) =>
  value && typeof value === "object" ? value : {};

const usesLegacyPyrusSignalDefaults = (value) => {
  const record = asRecord(value);
  const marketStructure = asRecord(record.marketStructure);
  const timeHorizon = marketStructure.timeHorizon ?? record.timeHorizon;
  const bosConfirmation =
    marketStructure.bosConfirmation ?? record.bosConfirmation;
  return (
    Number(timeHorizon) === 10 &&
    String(bosConfirmation || "close").trim().toLowerCase() === "close"
  );
};

export const resolvePersistedPyrusSignalsSettings = (value) => {
  const source = value && typeof value === "object" ? value : undefined;
  const resolved = resolvePyrusSignalsRuntimeSettings(source);
  if (!source || !usesLegacyPyrusSignalDefaults(source)) {
    return resolved;
  }

  return {
    ...resolved,
    timeHorizon: DEFAULT_PYRUS_SIGNALS_SETTINGS.timeHorizon,
    bosConfirmation: DEFAULT_PYRUS_SIGNALS_SETTINGS.bosConfirmation,
  };
};

export const buildPyrusSignalsIndicatorSettings = (settings) => ({
  [PYRUS_SIGNALS_PINE_SCRIPT_KEY]: settings,
});

export const isPyrusSignalsIndicatorSelected = (selectedIndicators = []) =>
  selectedIndicators.includes(PYRUS_SIGNALS_PINE_SCRIPT_KEY);

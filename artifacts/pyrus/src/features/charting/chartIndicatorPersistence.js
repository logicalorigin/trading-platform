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

const PYRUS_SIGNALS_ALGO_SYNC_KEYS = [
  "timeHorizon",
  "bosConfirmation",
  "chochAtrBuffer",
  "chochBodyExpansionAtr",
  "chochVolumeGate",
];

const valuesMatch = (left, right) => {
  if (typeof left === "number" || typeof right === "number") {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber === rightNumber
      : left === right;
  }
  return left === right;
};

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

export const resolveAlgoPyrusSignalsSettingsPatch = ({
  deployment = null,
  signalMonitorProfile = null,
  settings = null,
} = {}) => {
  const explicitSettings = asRecord(settings);
  const profileSettings = asRecord(signalMonitorProfile?.pyrusSignalsSettings);
  const parameters = asRecord(asRecord(deployment?.config).parameters);
  const marketStructure = asRecord(
    explicitSettings.marketStructure ??
      profileSettings.marketStructure ??
      parameters.marketStructure,
  );
  const source = {
    timeHorizon:
      marketStructure.timeHorizon ??
      explicitSettings.timeHorizon ??
      profileSettings.timeHorizon ??
      parameters.timeHorizon,
    bosConfirmation:
      marketStructure.bosConfirmation ??
      explicitSettings.bosConfirmation ??
      profileSettings.bosConfirmation ??
      parameters.bosConfirmation,
    chochAtrBuffer:
      marketStructure.chochAtrBuffer ??
      explicitSettings.chochAtrBuffer ??
      profileSettings.chochAtrBuffer ??
      parameters.chochAtrBuffer,
    chochBodyExpansionAtr:
      marketStructure.chochBodyExpansionAtr ??
      explicitSettings.chochBodyExpansionAtr ??
      profileSettings.chochBodyExpansionAtr ??
      parameters.chochBodyExpansionAtr,
    chochVolumeGate:
      marketStructure.chochVolumeGate ??
      explicitSettings.chochVolumeGate ??
      profileSettings.chochVolumeGate ??
      parameters.chochVolumeGate,
  };
  const resolved = resolvePyrusSignalsRuntimeSettings(source);
  return PYRUS_SIGNALS_ALGO_SYNC_KEYS.reduce((patch, key) => {
    patch[key] = resolved[key];
    return patch;
  }, {});
};

export const resolvePyrusSignalsSettingsWithAlgoDefaults = ({
  currentSettings,
  deployment = null,
  signalMonitorProfile = null,
  previousAlgoSettings = null,
} = {}) => {
  const current = resolvePersistedPyrusSignalsSettings(currentSettings);
  const nextAlgoSettings = resolveAlgoPyrusSignalsSettingsPatch({
    deployment,
    signalMonitorProfile,
  });
  const previousAlgoPatch = previousAlgoSettings
    ? resolveAlgoPyrusSignalsSettingsPatch({ settings: previousAlgoSettings })
    : null;

  return resolvePyrusSignalsRuntimeSettings(
    PYRUS_SIGNALS_ALGO_SYNC_KEYS.reduce(
      (next, key) => {
        const previousValue = previousAlgoPatch?.[key];
        const fallbackValue = DEFAULT_PYRUS_SIGNALS_SETTINGS[key];
        const shouldSync =
          previousAlgoPatch != null
            ? valuesMatch(current[key], previousValue)
            : valuesMatch(current[key], fallbackValue);
        if (shouldSync) {
          next[key] = nextAlgoSettings[key];
        }
        return next;
      },
      { ...current },
    ),
  );
};

export const buildPyrusSignalsIndicatorSettings = (settings) => ({
  [PYRUS_SIGNALS_PINE_SCRIPT_KEY]: settings,
});

export const isPyrusSignalsIndicatorSelected = (selectedIndicators = []) =>
  selectedIndicators.includes(PYRUS_SIGNALS_PINE_SCRIPT_KEY);

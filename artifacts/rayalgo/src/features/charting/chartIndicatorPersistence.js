import {
  RAY_REPLICA_PINE_SCRIPT_KEY,
  resolveRayReplicaRuntimeSettings,
} from "./rayReplicaPineAdapter";

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

export const resolvePersistedRayReplicaSettings = (value) =>
  resolveRayReplicaRuntimeSettings(
    value && typeof value === "object" ? value : undefined,
  );

export const buildRayReplicaIndicatorSettings = (settings) => ({
  [RAY_REPLICA_PINE_SCRIPT_KEY]: settings,
});

export const isRayReplicaIndicatorSelected = (selectedIndicators = []) =>
  selectedIndicators.includes(RAY_REPLICA_PINE_SCRIPT_KEY);

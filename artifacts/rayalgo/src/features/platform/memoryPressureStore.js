import { useMemo, useSyncExternalStore } from "react";

const INITIAL_STATE = {
  level: "normal",
  score: 0,
  trend: "steady",
  sourceQuality: "low",
  browserMemoryMb: null,
  browserSource: "heuristic",
  apiHeapUsedPercent: null,
  activeWorkloadCount: 0,
  pollCount: 0,
  streamCount: 0,
  chartScopeCount: 0,
  prependScopeCount: 0,
  queryCount: 0,
  heavyQueryCount: 0,
  storeEntryCount: 0,
  dominantDrivers: [],
  observedAt: null,
  measurement: null,
};

let snapshot = INITIAL_STATE;
let version = 0;
const listeners = new Set();

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshotVersion = () => version;

const notify = () => {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
};

export const getMemoryPressureSnapshot = () => snapshot;

export const setMemoryPressureSnapshot = (next) => {
  if (!next || typeof next !== "object") {
    return;
  }
  snapshot = { ...INITIAL_STATE, ...next };
  notify();
};

export const useMemoryPressureSnapshot = (enabled = true) => {
  const token = useSyncExternalStore(
    enabled ? subscribe : () => () => {},
    enabled ? getSnapshotVersion : () => 0,
    () => 0,
  );

  return useMemo(() => getMemoryPressureSnapshot(), [token]);
};

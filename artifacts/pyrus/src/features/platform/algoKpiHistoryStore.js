import { useSyncExternalStore } from "react";

const ALGO_KPI_HISTORY_STORE_KEY = Symbol.for("pyrus.algoKpiHistoryStore");

const DEFAULT_CAPACITY = 60;

const EMPTY = Object.freeze([]);

const createStore = ({ capacity = DEFAULT_CAPACITY } = {}) => {
  const buffers = new Map();
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    push(deploymentId, sample) {
      if (!deploymentId || !sample) return;
      const prev = buffers.get(deploymentId) || [];
      const next = [...prev, sample].slice(-capacity);
      buffers.set(deploymentId, next);
      emit();
    },
    getBuffer(deploymentId) {
      if (!deploymentId) return EMPTY;
      return buffers.get(deploymentId) || EMPTY;
    },
    prune(activeDeploymentId) {
      if (!activeDeploymentId) {
        if (buffers.size === 0) return;
        buffers.clear();
        emit();
        return;
      }
      let changed = false;
      for (const key of buffers.keys()) {
        if (key !== activeDeploymentId) {
          buffers.delete(key);
          changed = true;
        }
      }
      if (changed) emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    __resetForTests() {
      buffers.clear();
      emit();
    },
  };
};

const store =
  globalThis[ALGO_KPI_HISTORY_STORE_KEY] ??
  (globalThis[ALGO_KPI_HISTORY_STORE_KEY] = createStore());

export const algoKpiHistoryStore = store;

export const pushAlgoKpiSample = (deploymentId, sample) =>
  store.push(deploymentId, sample);

export const pruneAlgoKpiHistory = (activeDeploymentId) =>
  store.prune(activeDeploymentId);

export const useAlgoKpiHistory = (deploymentId) =>
  useSyncExternalStore(
    store.subscribe,
    () => store.getBuffer(deploymentId),
    () => EMPTY,
  );

export const buildKpiSample = ({
  cockpitKpis,
  cockpitSignalFreshness,
  signalOptionsPerformanceSummary,
  signalOptionsPositions,
  timestampMs,
} = {}) => {
  const fresh = Number(cockpitSignalFreshness?.fresh ?? 0);
  return {
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : Date.now(),
    realized: Number(cockpitKpis?.dailyRealizedPnl ?? 0),
    unrealized: Number(cockpitKpis?.openUnrealizedPnl ?? 0),
    winRate: Number(signalOptionsPerformanceSummary?.winRatePercent ?? NaN),
    profitFactor: Number(signalOptionsPerformanceSummary?.profitFactor ?? NaN),
    freshSignals: fresh,
    openPositions: Number(
      cockpitKpis?.openPositions ?? signalOptionsPositions?.length ?? 0,
    ),
  };
};

export const seriesFromBuffer = (buffer, metric) =>
  (buffer || []).map((sample) => Number(sample?.[metric] ?? 0));

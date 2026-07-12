import { useSyncExternalStore } from "react";

const ALGO_STA_EXECUTION_TIMEFRAME_STORE_KEY = Symbol.for(
  "pyrus.algoStaExecutionTimeframeStore",
);

// Shared, stable empty array so the MTF snapshot keeps a constant identity when
// nothing is published. useSyncExternalStore requires getSnapshot to return a
// stable reference, or it re-renders/loops.
const EMPTY_MTF_TIMEFRAMES = Object.freeze([]);
const EMPTY_MTF_ALIGNMENT_CONFIG = null;

const createStore = () => {
  let timeframe = "";
  let mtfTimeframes = EMPTY_MTF_TIMEFRAMES;
  let mtfKey = "";
  let mtfAlignmentConfig = EMPTY_MTF_ALIGNMENT_CONFIG;
  let mtfAlignmentKey = "";
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const normalizeMtfAlignmentConfig = (next) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return EMPTY_MTF_ALIGNMENT_CONFIG;
    }
    const timeframes = Array.isArray(next.timeframes)
      ? next.timeframes
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];
    return Object.freeze({
      enabled: next.enabled !== false,
      preset: String(next.preset || "").trim() || null,
      timeframes,
      requiredCount: Math.max(1, timeframes.length),
    });
  };
  return {
    getSnapshot: () => timeframe,
    // Returns a STABLE array reference between changes — the reference only
    // swaps when the joined value changes, so consumers (useSyncExternalStore)
    // do not re-render or loop on value-equal re-publishes.
    getMtfSnapshot: () => mtfTimeframes,
    getMtfAlignmentConfigSnapshot: () => mtfAlignmentConfig,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTimeframe: (nextTimeframe) => {
      const normalized = String(nextTimeframe || "").trim();
      if (normalized === timeframe) return;
      timeframe = normalized;
      emit();
    },
    setMtfTimeframes: (next) => {
      const normalized = Array.isArray(next)
        ? next.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const key = normalized.join(",");
      if (key === mtfKey) return; // value-equal: keep the same reference, no emit
      mtfKey = key;
      mtfTimeframes = normalized.length ? normalized : EMPTY_MTF_TIMEFRAMES;
      emit();
    },
    setMtfAlignmentConfig: (next) => {
      const normalized = normalizeMtfAlignmentConfig(next);
      const key = normalized ? JSON.stringify(normalized) : "";
      if (key === mtfAlignmentKey) return;
      mtfAlignmentKey = key;
      mtfAlignmentConfig = normalized;
      emit();
    },
    reset: () => {
      if (
        !timeframe &&
        mtfTimeframes === EMPTY_MTF_TIMEFRAMES &&
        mtfAlignmentConfig === EMPTY_MTF_ALIGNMENT_CONFIG
      ) {
        return;
      }
      timeframe = "";
      mtfTimeframes = EMPTY_MTF_TIMEFRAMES;
      mtfKey = "";
      mtfAlignmentConfig = EMPTY_MTF_ALIGNMENT_CONFIG;
      mtfAlignmentKey = "";
      emit();
    },
  };
};

const store =
  globalThis[ALGO_STA_EXECUTION_TIMEFRAME_STORE_KEY] ??
  (globalThis[ALGO_STA_EXECUTION_TIMEFRAME_STORE_KEY] = createStore());

export const publishAlgoStaExecutionTimeframe = (timeframe) =>
  store.setTimeframe(timeframe);

export const publishAlgoStaMtfTimeframes = (timeframes) =>
  store.setMtfTimeframes(timeframes);

export const publishAlgoStaMtfAlignmentConfig = (config) =>
  store.setMtfAlignmentConfig(config);

export const clearAlgoStaExecutionTimeframe = () => store.reset();

export const useAlgoStaExecutionTimeframe = () =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

export const useAlgoStaMtfTimeframes = () =>
  useSyncExternalStore(
    store.subscribe,
    store.getMtfSnapshot,
    store.getMtfSnapshot,
  );

export const useAlgoStaMtfAlignmentConfig = () =>
  useSyncExternalStore(
    store.subscribe,
    store.getMtfAlignmentConfigSnapshot,
    store.getMtfAlignmentConfigSnapshot,
  );

export const getAlgoStaExecutionTimeframeForTests = () => store.getSnapshot();

export const getAlgoStaMtfTimeframesForTests = () => store.getMtfSnapshot();

export const getAlgoStaMtfAlignmentConfigForTests = () =>
  store.getMtfAlignmentConfigSnapshot();

export const resetAlgoStaExecutionTimeframeForTests = () => store.reset();

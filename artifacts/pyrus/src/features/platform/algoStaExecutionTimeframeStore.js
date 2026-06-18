import { useSyncExternalStore } from "react";

const ALGO_STA_EXECUTION_TIMEFRAME_STORE_KEY = Symbol.for(
  "pyrus.algoStaExecutionTimeframeStore",
);

// Shared, stable empty array so the MTF snapshot keeps a constant identity when
// nothing is published. useSyncExternalStore requires getSnapshot to return a
// stable reference, or it re-renders/loops.
const EMPTY_MTF_TIMEFRAMES = Object.freeze([]);

const createStore = () => {
  let timeframe = "";
  let mtfTimeframes = EMPTY_MTF_TIMEFRAMES;
  let mtfKey = "";
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => timeframe,
    // Returns a STABLE array reference between changes — the reference only
    // swaps when the joined value changes, so consumers (useSyncExternalStore)
    // do not re-render or loop on value-equal re-publishes.
    getMtfSnapshot: () => mtfTimeframes,
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
    reset: () => {
      if (!timeframe && mtfTimeframes === EMPTY_MTF_TIMEFRAMES) return;
      timeframe = "";
      mtfTimeframes = EMPTY_MTF_TIMEFRAMES;
      mtfKey = "";
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

export const clearAlgoStaExecutionTimeframe = () => store.reset();

export const useAlgoStaExecutionTimeframe = () =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

export const useAlgoStaMtfTimeframes = () =>
  useSyncExternalStore(
    store.subscribe,
    store.getMtfSnapshot,
    store.getMtfSnapshot,
  );

export const getAlgoStaExecutionTimeframeForTests = () => store.getSnapshot();

export const getAlgoStaMtfTimeframesForTests = () => store.getMtfSnapshot();

export const resetAlgoStaExecutionTimeframeForTests = () => store.reset();

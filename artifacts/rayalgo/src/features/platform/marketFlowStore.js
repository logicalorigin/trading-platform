import { useMemo, useSyncExternalStore } from "react";

const EMPTY_PROVIDER_SUMMARY = Object.freeze({
  label: "Loading flow",
  color: null,
  fallbackUsed: false,
  sourcesBySymbol: Object.freeze({}),
  failures: Object.freeze([]),
  erroredSource: null,
  providers: Object.freeze([]),
  appliedUnusualThreshold: null,
  appliedUnusualThresholdConsistent: true,
  coverage: Object.freeze({
    totalSymbols: 0,
    scannedSymbols: 0,
    batchSize: 0,
    currentBatch: Object.freeze([]),
    cycle: 0,
    isFetching: false,
    lastScannedAt: Object.freeze({}),
    isRotating: false,
  }),
});

export const EMPTY_MARKET_FLOW_SNAPSHOT = Object.freeze({
  hasLiveFlow: false,
  flowStatus: "loading",
  providerSummary: EMPTY_PROVIDER_SUMMARY,
  flowEvents: Object.freeze([]),
  flowTide: Object.freeze([]),
  tickerFlow: Object.freeze([]),
  flowClock: Object.freeze([]),
  sectorFlow: Object.freeze([]),
  dteBuckets: Object.freeze([]),
  marketOrderFlow: Object.freeze({
    buyXL: 0,
    buyL: 0,
    buyM: 0,
    buyS: 0,
    sellXL: 0,
    sellL: 0,
    sellM: 0,
    sellS: 0,
  }),
  putCall: Object.freeze({
    total: null,
    equities: null,
    indices: null,
    calls: 0,
    puts: 0,
  }),
});

const storeEntries = new Map();

const normalizeSymbols = (symbols = []) =>
  Array.from(
    new Set(
      (symbols || [])
        .map((symbol) => symbol?.trim?.().toUpperCase?.() || "")
        .filter(Boolean),
    ),
  ).sort();

export const buildMarketFlowStoreKey = (symbols = []) =>
  normalizeSymbols(symbols).join(",");

const ensureEntry = (storeKey) => {
  const normalizedKey = storeKey || "__empty__";
  if (!storeEntries.has(normalizedKey)) {
    storeEntries.set(normalizedKey, {
      version: 0,
      snapshot: EMPTY_MARKET_FLOW_SNAPSHOT,
      listeners: new Set(),
    });
  }
  return storeEntries.get(normalizedKey);
};

export const publishMarketFlowSnapshot = (storeKey, snapshot) => {
  const entry = ensureEntry(storeKey);
  if (entry.snapshot === snapshot) {
    return;
  }
  entry.snapshot = snapshot || EMPTY_MARKET_FLOW_SNAPSHOT;
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
};

export const clearMarketFlowSnapshot = (storeKey) => {
  const entry = ensureEntry(storeKey);
  if (entry.snapshot === EMPTY_MARKET_FLOW_SNAPSHOT) {
    return;
  }
  entry.snapshot = EMPTY_MARKET_FLOW_SNAPSHOT;
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
};

const subscribeToMarketFlowSnapshot = (storeKey, listener) => {
  const entry = ensureEntry(storeKey);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
};

const getMarketFlowSnapshotVersion = (storeKey) =>
  ensureEntry(storeKey).version;

const getMarketFlowSnapshot = (storeKey) =>
  ensureEntry(storeKey).snapshot || EMPTY_MARKET_FLOW_SNAPSHOT;

export const useMarketFlowSnapshot = (
  symbols = [],
  { subscribe = true } = {},
) => {
  const storeKey = useMemo(() => buildMarketFlowStoreKey(symbols), [symbols]);

  useSyncExternalStore(
    subscribe
      ? (listener) => subscribeToMarketFlowSnapshot(storeKey, listener)
      : () => () => {},
    subscribe
      ? () => getMarketFlowSnapshotVersion(storeKey)
      : () => 0,
    () => 0,
  );

  return getMarketFlowSnapshot(storeKey);
};

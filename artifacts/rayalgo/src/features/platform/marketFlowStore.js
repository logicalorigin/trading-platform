import { useMemo, useSyncExternalStore } from "react";
import { RAYALGO_STORAGE_KEY } from "../../lib/uiTokens";
import {
  DEFAULT_FLOW_SCANNER_CONFIG,
  normalizeFlowScannerConfig,
} from "./marketFlowScannerConfig.js";
import { providerSummaryHasTransientFlowState } from "./flowSourceState.js";

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

export const MARKET_FLOW_STORE_ENTRY_CAP = 8;
export const BROAD_MARKET_FLOW_STORE_KEY = "__broad_market_flow__";

const storeEntries = new Map();
const flowScannerControlListeners = new Set();
const flowScannerOwnerLeases = new Set();
let flowScannerControlVersion = 0;
const DEFAULT_FLOW_SCANNER_ENABLED = true;
const MANUAL_FLOW_SCANNER_OWNER = "manual";

const readPersistedFlowScannerConfig = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return normalizeFlowScannerConfig(DEFAULT_FLOW_SCANNER_CONFIG);
    }
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeFlowScannerConfig(
      parsed.flowScannerConfig || DEFAULT_FLOW_SCANNER_CONFIG,
    );
  } catch (_error) {
    return normalizeFlowScannerConfig(DEFAULT_FLOW_SCANNER_CONFIG);
  }
};

const persistFlowScannerConfig = (config) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const current = JSON.parse(
      window.localStorage.getItem(RAYALGO_STORAGE_KEY) || "{}",
    );
    window.localStorage.setItem(
      RAYALGO_STORAGE_KEY,
      JSON.stringify({
        ...current,
        flowScannerConfig: normalizeFlowScannerConfig(config),
      }),
    );
  } catch (_error) {}
};

let flowScannerControlState = {
  enabled: DEFAULT_FLOW_SCANNER_ENABLED,
  ownerActive: false,
  config: readPersistedFlowScannerConfig(),
};

const getFlowScannerControlVersion = () => flowScannerControlVersion;

const subscribeToFlowScannerControlState = (listener) => {
  flowScannerControlListeners.add(listener);
  return () => {
    flowScannerControlListeners.delete(listener);
  };
};

const notifyFlowScannerControlListeners = () => {
  flowScannerControlVersion += 1;
  flowScannerControlListeners.forEach((listener) => listener());
};

export const getFlowScannerControlState = () => flowScannerControlState;

const syncFlowScannerOwnerActive = () => {
  const ownerActive = flowScannerOwnerLeases.size > 0;
  if (flowScannerControlState.ownerActive === ownerActive) {
    return flowScannerControlState;
  }
  flowScannerControlState = {
    ...flowScannerControlState,
    ownerActive,
  };
  notifyFlowScannerControlListeners();
  return flowScannerControlState;
};

export const acquireFlowScannerOwner = (
  ownerId = Symbol("flow-scanner-owner"),
) => {
  flowScannerOwnerLeases.add(ownerId);
  syncFlowScannerOwnerActive();
  return () => {
    releaseFlowScannerOwner(ownerId);
  };
};

export const releaseFlowScannerOwner = (ownerId) => {
  flowScannerOwnerLeases.delete(ownerId);
  return syncFlowScannerOwnerActive();
};

export const setFlowScannerControlState = (
  patch = {},
  { persistConfig = true } = {},
) => {
  const current = flowScannerControlState;
  const hasConfigPatch = Object.prototype.hasOwnProperty.call(patch, "config");
  const hasOwnerPatch = Object.prototype.hasOwnProperty.call(
    patch,
    "ownerActive",
  );
  if (hasOwnerPatch) {
    if (patch.ownerActive) {
      flowScannerOwnerLeases.add(MANUAL_FLOW_SCANNER_OWNER);
    } else {
      flowScannerOwnerLeases.delete(MANUAL_FLOW_SCANNER_OWNER);
    }
  }
  const config = hasConfigPatch
    ? normalizeFlowScannerConfig({
        ...current.config,
        ...(patch.config || {}),
      })
    : current.config;
  const next = {
    enabled: Object.prototype.hasOwnProperty.call(patch, "enabled")
      ? Boolean(patch.enabled)
      : current.enabled,
    ownerActive: flowScannerOwnerLeases.size > 0,
    config,
  };

  if (JSON.stringify(next) === JSON.stringify(current)) {
    return current;
  }

  flowScannerControlState = next;
  if (persistConfig && hasConfigPatch) {
    persistFlowScannerConfig(next.config);
  }
  notifyFlowScannerControlListeners();
  return next;
};

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

const normalizeStoreKey = (storeKey) => storeKey || "__empty__";

const evictOldestUnusedMarketFlowEntry = (protectedKey = null) => {
  if (storeEntries.size <= MARKET_FLOW_STORE_ENTRY_CAP) return;
  for (const [key, value] of storeEntries) {
    if (key === protectedKey) {
      continue;
    }
    if (!value.listeners || value.listeners.size === 0) {
      storeEntries.delete(key);
      return;
    }
  }
};

const deleteEntryIfUnused = (storeKey) => {
  const normalizedKey = normalizeStoreKey(storeKey);
  const entry = storeEntries.get(normalizedKey);
  if (entry && entry.listeners.size === 0) {
    storeEntries.delete(normalizedKey);
  }
};

const ensureEntry = (storeKey) => {
  const normalizedKey = normalizeStoreKey(storeKey);
  if (!storeEntries.has(normalizedKey)) {
    storeEntries.set(normalizedKey, {
      version: 0,
      snapshot: EMPTY_MARKET_FLOW_SNAPSHOT,
      listeners: new Set(),
    });
    evictOldestUnusedMarketFlowEntry(normalizedKey);
  } else {
    const existing = storeEntries.get(normalizedKey);
    storeEntries.delete(normalizedKey);
    storeEntries.set(normalizedKey, existing);
  }
  return storeEntries.get(normalizedKey);
};

const hasSnapshotFlowEvents = (snapshot) =>
  Array.isArray(snapshot?.flowEvents) && snapshot.flowEvents.length > 0;

const shouldPreserveMarketFlowSnapshot = (current, next) =>
  Boolean(
    hasSnapshotFlowEvents(current) &&
      !hasSnapshotFlowEvents(next) &&
      (next?.flowStatus === "loading" ||
        next?.flowStatus === "offline" ||
        providerSummaryHasTransientFlowState(next?.providerSummary)),
  );

const preserveMarketFlowSnapshotEvents = (current, next) => ({
  ...next,
  hasLiveFlow: true,
  flowStatus: "live",
  flowEvents: current.flowEvents,
  flowTide: current.flowTide,
  tickerFlow: current.tickerFlow,
  flowClock: current.flowClock,
  sectorFlow: current.sectorFlow,
  dteBuckets: current.dteBuckets,
  marketOrderFlow: current.marketOrderFlow,
  putCall: current.putCall,
  staleFlowEvents: true,
});

export const publishMarketFlowSnapshot = (storeKey, snapshot) => {
  const entry = ensureEntry(storeKey);
  if (entry.snapshot === snapshot) {
    return;
  }
  const nextSnapshot = snapshot || EMPTY_MARKET_FLOW_SNAPSHOT;
  entry.snapshot = shouldPreserveMarketFlowSnapshot(entry.snapshot, nextSnapshot)
    ? preserveMarketFlowSnapshotEvents(entry.snapshot, nextSnapshot)
    : nextSnapshot;
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
};

export const clearMarketFlowSnapshot = (storeKey) => {
  const entry = ensureEntry(storeKey);
  if (entry.snapshot === EMPTY_MARKET_FLOW_SNAPSHOT) {
    deleteEntryIfUnused(storeKey);
    return;
  }
  entry.snapshot = EMPTY_MARKET_FLOW_SNAPSHOT;
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
  deleteEntryIfUnused(storeKey);
};

const subscribeToMarketFlowSnapshot = (storeKey, listener) => {
  const entry = ensureEntry(storeKey);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.snapshot === EMPTY_MARKET_FLOW_SNAPSHOT) {
      deleteEntryIfUnused(storeKey);
    } else {
      evictOldestUnusedMarketFlowEntry();
    }
  };
};

const getMarketFlowSnapshotVersion = (storeKey) =>
  storeEntries.get(normalizeStoreKey(storeKey))?.version ?? 0;

const getMarketFlowSnapshot = (storeKey) =>
  storeEntries.get(normalizeStoreKey(storeKey))?.snapshot ||
  EMPTY_MARKET_FLOW_SNAPSHOT;

export const getMarketFlowStoreEntryCount = () => storeEntries.size;

export const getMarketFlowSnapshotForStoreKey = (storeKey) =>
  getMarketFlowSnapshot(storeKey);

export const resetMarketFlowStoreForTests = () => {
  storeEntries.clear();
};

export const resetFlowScannerControlForTests = () => {
  flowScannerOwnerLeases.clear();
  flowScannerControlState = {
    enabled: DEFAULT_FLOW_SCANNER_ENABLED,
    ownerActive: false,
    config: normalizeFlowScannerConfig(DEFAULT_FLOW_SCANNER_CONFIG),
  };
  notifyFlowScannerControlListeners();
};

export const useFlowScannerControlState = ({ subscribe = true } = {}) => {
  useSyncExternalStore(
    subscribe ? subscribeToFlowScannerControlState : () => () => {},
    subscribe ? getFlowScannerControlVersion : () => 0,
    () => 0,
  );

  return getFlowScannerControlState();
};

export const useMarketFlowSnapshotForStoreKey = (
  storeKey,
  { subscribe = true } = {},
) => {
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

export const useMarketFlowSnapshot = (
  symbols = [],
  { subscribe = true } = {},
) => {
  const storeKey = useMemo(() => buildMarketFlowStoreKey(symbols), [symbols]);
  return useMarketFlowSnapshotForStoreKey(storeKey, { subscribe });
};

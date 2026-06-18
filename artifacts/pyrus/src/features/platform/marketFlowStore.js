import { useMemo, useSyncExternalStore } from "react";
import { PYRUS_STORAGE_KEY } from "../../lib/workspaceStorage";
import {
  DEFAULT_FLOW_SCANNER_CONFIG,
  FLOW_SCANNER_CONFIG_VERSION,
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
    cycleScannedSymbols: 0,
    batchSize: 0,
    concurrency: 0,
    intervalMs: 0,
    lineBudget: null,
    estimatedCycleMs: null,
    currentBatch: Object.freeze([]),
    cycle: 0,
    isFetching: false,
    lastScannedAt: Object.freeze({}),
    oldestScanAt: null,
    newestScanAt: null,
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
const MARKET_FLOW_LAST_SNAPSHOT_STORAGE_KEY = `${PYRUS_STORAGE_KEY}:market-flow:last-broad`;
const MARKET_FLOW_LAST_SNAPSHOT_SCHEMA_VERSION = 1;
const MARKET_FLOW_LAST_SNAPSHOT_MAX_AGE_MS = 72 * 60 * 60 * 1_000;
const MARKET_FLOW_LAST_SNAPSHOT_EVENT_LIMIT = 200;

const storeEntries = new Map();
const flowScannerControlListeners = new Set();
const flowScannerOwnerLeases = new Set();
let flowScannerControlVersion = 0;
const DEFAULT_FLOW_SCANNER_ENABLED = true;
const MANUAL_FLOW_SCANNER_OWNER = "manual";

const getLocalStorage = () =>
  typeof window !== "undefined" && window.localStorage ? window.localStorage : null;

const readCurrentWorkspaceState = () => {
  const storage = getLocalStorage();
  if (!storage) return null;
  const raw = storage.getItem(PYRUS_STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const buildPersistedFlowScannerConfigPayload = (current, config) => ({
  ...current,
  flowScannerConfig: normalizeFlowScannerConfig(config),
  flowScannerConfigVersion: FLOW_SCANNER_CONFIG_VERSION,
});

const readPersistedFlowScannerConfig = () => {
  try {
    const parsed = readCurrentWorkspaceState();
    if (!parsed) {
      return normalizeFlowScannerConfig(DEFAULT_FLOW_SCANNER_CONFIG);
    }
    const hasPersistedConfig = Boolean(parsed.flowScannerConfig);
    const storedVersion = Number(parsed.flowScannerConfigVersion);
    const isLegacyConfig =
      hasPersistedConfig &&
      (!Number.isFinite(storedVersion) ||
        storedVersion < FLOW_SCANNER_CONFIG_VERSION);
    const config = normalizeFlowScannerConfig(
      parsed.flowScannerConfig || DEFAULT_FLOW_SCANNER_CONFIG,
    );
    if (
      isLegacyConfig &&
      config.concurrency < DEFAULT_FLOW_SCANNER_CONFIG.concurrency
    ) {
      const migrated = normalizeFlowScannerConfig({
        ...config,
        concurrency: DEFAULT_FLOW_SCANNER_CONFIG.concurrency,
      });
      window.localStorage.setItem(
        PYRUS_STORAGE_KEY,
        JSON.stringify(buildPersistedFlowScannerConfigPayload(parsed, migrated)),
      );
      return migrated;
    }
    return config;
  } catch (_error) {
    return normalizeFlowScannerConfig(DEFAULT_FLOW_SCANNER_CONFIG);
  }
};

const persistFlowScannerConfig = (config) => {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    const current = readCurrentWorkspaceState();
    if (!current) return;
    storage.setItem(
      PYRUS_STORAGE_KEY,
      JSON.stringify(buildPersistedFlowScannerConfigPayload(current, config)),
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

const limitedArray = (value, limit = MARKET_FLOW_LAST_SNAPSHOT_EVENT_LIMIT) =>
  Array.isArray(value) ? value.slice(0, limit) : [];

const sanitizeFlowProviderSummaryForStorage = (providerSummary) => {
  const summary =
    providerSummary && typeof providerSummary === "object"
      ? providerSummary
      : EMPTY_PROVIDER_SUMMARY;
  const coverage =
    summary.coverage && typeof summary.coverage === "object"
      ? summary.coverage
      : EMPTY_PROVIDER_SUMMARY.coverage;
  return {
    ...summary,
    sourcesBySymbol: { ...(summary.sourcesBySymbol || {}) },
    failures: limitedArray(summary.failures, 20),
    providers: limitedArray(summary.providers, 10),
    coverage: {
      ...coverage,
      currentBatch: limitedArray(coverage.currentBatch, 30),
      lastScannedAt: {},
    },
  };
};

const sanitizeMarketFlowSnapshotForStorage = (snapshot) => ({
  ...snapshot,
  hasLiveFlow: true,
  flowStatus: "live",
  providerSummary: sanitizeFlowProviderSummaryForStorage(snapshot.providerSummary),
  flowEvents: limitedArray(snapshot.flowEvents),
  flowTide: limitedArray(snapshot.flowTide, 80),
  tickerFlow: limitedArray(snapshot.tickerFlow, 80),
  flowClock: limitedArray(snapshot.flowClock, 80),
  sectorFlow: limitedArray(snapshot.sectorFlow, 80),
  dteBuckets: limitedArray(snapshot.dteBuckets, 80),
  marketOrderFlow: snapshot.marketOrderFlow || EMPTY_MARKET_FLOW_SNAPSHOT.marketOrderFlow,
  putCall: snapshot.putCall || EMPTY_MARKET_FLOW_SNAPSHOT.putCall,
});

const isBroadMarketFlowStoreKey = (storeKey) =>
  normalizeStoreKey(storeKey) === BROAD_MARKET_FLOW_STORE_KEY;

const persistLastBroadMarketFlowSnapshot = (snapshot) => {
  if (!hasSnapshotFlowEvents(snapshot)) {
    return;
  }
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      MARKET_FLOW_LAST_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: MARKET_FLOW_LAST_SNAPSHOT_SCHEMA_VERSION,
        cachedAt: Date.now(),
        snapshot: sanitizeMarketFlowSnapshotForStorage(snapshot),
      }),
    );
  } catch (_error) {}
};

const removeLastBroadMarketFlowSnapshot = () => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(MARKET_FLOW_LAST_SNAPSHOT_STORAGE_KEY);
  } catch (_error) {}
};

const shouldRetainLastBroadMarketFlowSnapshot = (snapshot) =>
  Boolean(
    hasSnapshotFlowEvents(snapshot) ||
      snapshot?.flowStatus === "loading" ||
      snapshot?.flowStatus === "offline" ||
      providerSummaryHasTransientFlowState(snapshot?.providerSummary),
  );

const readLastBroadMarketFlowSnapshot = (nowMs = Date.now()) => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(MARKET_FLOW_LAST_SNAPSHOT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const cachedAt = Number(parsed?.cachedAt);
    const snapshot = parsed?.snapshot;
    if (
      parsed?.schemaVersion !== MARKET_FLOW_LAST_SNAPSHOT_SCHEMA_VERSION ||
      !Number.isFinite(cachedAt) ||
      nowMs - cachedAt > MARKET_FLOW_LAST_SNAPSHOT_MAX_AGE_MS ||
      !hasSnapshotFlowEvents(snapshot)
    ) {
      storage.removeItem(MARKET_FLOW_LAST_SNAPSHOT_STORAGE_KEY);
      return null;
    }
    return {
      ...EMPTY_MARKET_FLOW_SNAPSHOT,
      ...snapshot,
      hasLiveFlow: true,
      flowStatus: "live",
      providerSummary: {
        ...EMPTY_PROVIDER_SUMMARY,
        ...(snapshot.providerSummary || {}),
      },
      staleFlowEvents: true,
    };
  } catch (_error) {
    storage.removeItem(MARKET_FLOW_LAST_SNAPSHOT_STORAGE_KEY);
    return null;
  }
};

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
      snapshot:
        normalizedKey === BROAD_MARKET_FLOW_STORE_KEY
          ? readLastBroadMarketFlowSnapshot() || EMPTY_MARKET_FLOW_SNAPSHOT
          : EMPTY_MARKET_FLOW_SNAPSHOT,
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

const areStructuredValuesEquivalent = (left, right) => {
  if (left === right) return true;
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
};

export const publishMarketFlowSnapshot = (storeKey, snapshot) => {
  const entry = ensureEntry(storeKey);
  if (entry.snapshot === snapshot) {
    return;
  }
  const nextSnapshot = snapshot || EMPTY_MARKET_FLOW_SNAPSHOT;
  const nextSnapshotForStore = shouldPreserveMarketFlowSnapshot(
    entry.snapshot,
    nextSnapshot,
  )
    ? preserveMarketFlowSnapshotEvents(entry.snapshot, nextSnapshot)
    : nextSnapshot;
  if (areStructuredValuesEquivalent(entry.snapshot, nextSnapshotForStore)) {
    return;
  }
  entry.snapshot = nextSnapshotForStore;
  if (isBroadMarketFlowStoreKey(storeKey)) {
    if (hasSnapshotFlowEvents(entry.snapshot)) {
      persistLastBroadMarketFlowSnapshot(entry.snapshot);
    } else if (!shouldRetainLastBroadMarketFlowSnapshot(entry.snapshot)) {
      removeLastBroadMarketFlowSnapshot();
    }
  }
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

const getMarketFlowSnapshot = (storeKey) => {
  const normalizedKey = normalizeStoreKey(storeKey);
  const entry = storeEntries.get(normalizedKey);
  if (entry) {
    return entry.snapshot;
  }
  if (normalizedKey === BROAD_MARKET_FLOW_STORE_KEY) {
    const persisted = readLastBroadMarketFlowSnapshot();
    if (persisted) {
      storeEntries.set(normalizedKey, {
        version: 0,
        snapshot: persisted,
        listeners: new Set(),
      });
      evictOldestUnusedMarketFlowEntry(normalizedKey);
      return persisted;
    }
  }
  return EMPTY_MARKET_FLOW_SNAPSHOT;
};

export const getMarketFlowStoreEntryCount = () => storeEntries.size;

export const getMarketFlowSnapshotForStoreKey = (storeKey) =>
  getMarketFlowSnapshot(storeKey);

export const getMarketFlowSnapshotVersionForTests = getMarketFlowSnapshotVersion;

export const subscribeToMarketFlowSnapshotForTests =
  subscribeToMarketFlowSnapshot;

export const resetMarketFlowStoreForTests = () => {
  storeEntries.clear();
};

export const resetFlowScannerControlForTests = ({ readPersisted = false } = {}) => {
  flowScannerOwnerLeases.clear();
  flowScannerControlState = {
    enabled: DEFAULT_FLOW_SCANNER_ENABLED,
    ownerActive: false,
    config: readPersisted
      ? readPersistedFlowScannerConfig()
      : normalizeFlowScannerConfig(DEFAULT_FLOW_SCANNER_CONFIG),
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

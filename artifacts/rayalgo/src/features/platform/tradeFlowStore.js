import { useMemo, useSyncExternalStore } from "react";

const EMPTY_TRADE_FLOW_SNAPSHOT = Object.freeze({
  events: Object.freeze([]),
  status: "empty",
});

const tradeFlowEntries = new Map();
export const TRADE_FLOW_STORE_ENTRY_CAP = 16;

const evictOldestUnusedTradeFlowEntry = () => {
  if (tradeFlowEntries.size <= TRADE_FLOW_STORE_ENTRY_CAP) return;
  for (const [key, value] of tradeFlowEntries) {
    if (!value.listeners || value.listeners.size === 0) {
      tradeFlowEntries.delete(key);
      return;
    }
  }
};

const normalizeTicker = (ticker) => ticker?.trim?.().toUpperCase?.() || "";

const deleteEntryIfUnused = (ticker) => {
  const normalizedTicker = normalizeTicker(ticker) || "__empty__";
  const entry = tradeFlowEntries.get(normalizedTicker);
  if (entry && entry.listeners.size === 0) {
    tradeFlowEntries.delete(normalizedTicker);
  }
};

const ensureEntry = (ticker) => {
  const normalizedTicker = normalizeTicker(ticker) || "__empty__";
  if (!tradeFlowEntries.has(normalizedTicker)) {
    tradeFlowEntries.set(normalizedTicker, {
      version: 0,
      snapshot: EMPTY_TRADE_FLOW_SNAPSHOT,
      listeners: new Set(),
    });
    evictOldestUnusedTradeFlowEntry();
  } else {
    const existing = tradeFlowEntries.get(normalizedTicker);
    tradeFlowEntries.delete(normalizedTicker);
    tradeFlowEntries.set(normalizedTicker, existing);
  }
  return tradeFlowEntries.get(normalizedTicker);
};

const areTradeFlowEventsEquivalent = (left = [], right = []) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current?.id !== next?.id ||
      current?.ticker !== next?.ticker ||
      current?.contract !== next?.contract ||
      current?.premium !== next?.premium ||
      current?.vol !== next?.vol ||
      current?.cp !== next?.cp ||
      current?.side !== next?.side ||
      current?.golden !== next?.golden ||
      current?.score !== next?.score ||
      current?.occurredAt !== next?.occurredAt
    ) {
      return false;
    }
  }

  return true;
};

export const publishTradeFlowSnapshot = (ticker, nextSnapshot) => {
  const entry = ensureEntry(ticker);
  const normalizedSnapshot = nextSnapshot
    ? {
        events: nextSnapshot.events || EMPTY_TRADE_FLOW_SNAPSHOT.events,
        status: nextSnapshot.status || "empty",
      }
    : EMPTY_TRADE_FLOW_SNAPSHOT;

  if (
    entry.snapshot.status === normalizedSnapshot.status &&
    areTradeFlowEventsEquivalent(entry.snapshot.events, normalizedSnapshot.events)
  ) {
    return;
  }

  entry.snapshot = normalizedSnapshot;
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
};

export const clearTradeFlowSnapshot = (ticker) => {
  const normalizedTicker = normalizeTicker(ticker) || "__empty__";
  const entry = tradeFlowEntries.get(normalizedTicker);
  if (!entry) {
    return;
  }
  if (entry.snapshot === EMPTY_TRADE_FLOW_SNAPSHOT) {
    deleteEntryIfUnused(normalizedTicker);
    return;
  }
  entry.snapshot = EMPTY_TRADE_FLOW_SNAPSHOT;
  entry.version += 1;
  entry.listeners.forEach((listener) => listener());
  deleteEntryIfUnused(normalizedTicker);
};

const subscribeToTradeFlowSnapshot = (ticker, listener) => {
  const entry = ensureEntry(ticker);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.snapshot === EMPTY_TRADE_FLOW_SNAPSHOT) {
      deleteEntryIfUnused(ticker);
    } else {
      evictOldestUnusedTradeFlowEntry();
    }
  };
};

const getTradeFlowSnapshotVersion = (ticker) => ensureEntry(ticker).version;

const getTradeFlowSnapshot = (ticker) =>
  ensureEntry(ticker).snapshot || EMPTY_TRADE_FLOW_SNAPSHOT;

export const getTradeFlowStoreEntryCount = () => tradeFlowEntries.size;

export const resetTradeFlowStoreForTests = () => {
  tradeFlowEntries.clear();
};

export const useTradeFlowSnapshot = (
  ticker,
  { subscribe = true } = {},
) => {
  const normalizedTicker = useMemo(() => normalizeTicker(ticker), [ticker]);

  useSyncExternalStore(
    subscribe && normalizedTicker
      ? (listener) => subscribeToTradeFlowSnapshot(normalizedTicker, listener)
      : () => () => {},
    subscribe && normalizedTicker
      ? () => getTradeFlowSnapshotVersion(normalizedTicker)
      : () => 0,
    () => 0,
  );

  return getTradeFlowSnapshot(normalizedTicker);
};

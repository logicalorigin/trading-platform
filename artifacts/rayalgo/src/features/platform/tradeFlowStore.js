import { useMemo, useSyncExternalStore } from "react";
import { shouldPreserveFlowEvents } from "./flowSourceState";

const EMPTY_TRADE_FLOW_SNAPSHOT = Object.freeze({
  events: Object.freeze([]),
  status: "empty",
  source: null,
});

const tradeFlowEntries = new Map();
export const TRADE_FLOW_STORE_ENTRY_CAP = 16;

const evictOldestUnusedTradeFlowEntry = (protectedKey = null) => {
  if (tradeFlowEntries.size <= TRADE_FLOW_STORE_ENTRY_CAP) return;
  for (const [key, value] of tradeFlowEntries) {
    if (key === protectedKey) {
      continue;
    }
    if (!value.listeners || value.listeners.size === 0) {
      tradeFlowEntries.delete(key);
      return;
    }
  }
};

const normalizeTicker = (ticker) => ticker?.trim?.().toUpperCase?.() || "";

const readFlowEventTicker = (event) =>
  normalizeTicker(event?.ticker || event?.underlying || event?.symbol);

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
    evictOldestUnusedTradeFlowEntry(normalizedTicker);
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

export const groupTradeFlowEventsByTicker = (events = [], symbols = []) => {
  const allowedSymbols = new Set(
    (symbols || []).map(normalizeTicker).filter(Boolean),
  );
  const grouped = {};
  allowedSymbols.forEach((symbol) => {
    grouped[symbol] = [];
  });

  (Array.isArray(events) ? events : []).forEach((event) => {
    const symbol = readFlowEventTicker(event);
    if (!symbol || (allowedSymbols.size && !allowedSymbols.has(symbol))) {
      return;
    }
    if (!grouped[symbol]) {
      grouped[symbol] = [];
    }
    grouped[symbol].push(event);
  });

  return grouped;
};

export const publishTradeFlowSnapshotsByTicker = ({
  symbols = [],
  events = [],
  status = "live",
  source = null,
  sourceBySymbol = null,
  includeEmpty = false,
  preserveExistingOnEmpty = false,
} = {}) => {
  const grouped = groupTradeFlowEventsByTicker(events, symbols);
  const tickers = Array.from(
    new Set([
      ...(symbols || []).map(normalizeTicker).filter(Boolean),
      ...Object.keys(grouped),
    ]),
  );

  tickers.forEach((ticker) => {
    const tickerEvents = grouped[ticker] || [];
    if (!includeEmpty && tickerEvents.length === 0) {
      return;
    }
    publishTradeFlowSnapshot(
      ticker,
      {
        events: tickerEvents,
        status: tickerEvents.length ? "live" : status,
        source: sourceBySymbol?.[ticker] || source,
      },
      { preserveExistingOnEmpty },
    );
  });
};

export const publishTradeFlowSnapshot = (
  ticker,
  nextSnapshot,
  { preserveExistingOnEmpty = false } = {},
) => {
  const entry = ensureEntry(ticker);
  const normalizedSnapshot = nextSnapshot
    ? {
        events: nextSnapshot.events || EMPTY_TRADE_FLOW_SNAPSHOT.events,
        status: nextSnapshot.status || "empty",
        source: nextSnapshot.source || null,
      }
    : EMPTY_TRADE_FLOW_SNAPSHOT;
  const shouldRetainExistingEvents =
    shouldPreserveFlowEvents(entry.snapshot, normalizedSnapshot) ||
    Boolean(
      preserveExistingOnEmpty &&
        entry.snapshot?.events?.length &&
        !normalizedSnapshot.events?.length,
    );
  const nextSnapshotForStore = shouldRetainExistingEvents
    ? {
        ...entry.snapshot,
        status: "stale",
        source: normalizedSnapshot.source,
      }
    : normalizedSnapshot;

  if (
    entry.snapshot.status === nextSnapshotForStore.status &&
    entry.snapshot.source === nextSnapshotForStore.source &&
    areTradeFlowEventsEquivalent(entry.snapshot.events, nextSnapshotForStore.events)
  ) {
    return;
  }

  entry.snapshot = nextSnapshotForStore;
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
export const subscribeToTradeFlowSnapshotForTests = subscribeToTradeFlowSnapshot;

const getTradeFlowSnapshotVersion = (ticker) => ensureEntry(ticker).version;

const getTradeFlowSnapshot = (ticker) =>
  ensureEntry(ticker).snapshot || EMPTY_TRADE_FLOW_SNAPSHOT;
export const getTradeFlowSnapshotForTests = getTradeFlowSnapshot;

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

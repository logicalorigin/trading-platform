import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export type BrokerStockAggregateMessage = {
  eventType: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  accumulatedVolume: number | null;
  vwap: number | null;
  sessionVwap: number | null;
  officialOpen: number | null;
  averageTradeSize: number | null;
  startMs: number;
  endMs: number;
  delayed: boolean;
  source: "ibkr-websocket-derived";
  latency?: {
    bridgeReceivedAt?: string | null;
    bridgeEmittedAt?: string | null;
    apiServerReceivedAt?: string | null;
    apiServerEmittedAt?: string | null;
  } | null;
};

export type MassiveStockAggregateMessage = BrokerStockAggregateMessage;

type UseBrokerStockAggregateStreamInput = {
  symbols: string[];
  enabled?: boolean;
  onAggregate?: (message: BrokerStockAggregateMessage) => void;
};

type StreamConsumer = {
  id: number;
  symbols: Set<string>;
  onAggregate?: (message: BrokerStockAggregateMessage) => void;
};

type AggregateStreamStats = {
  activeConsumerCount: number;
  unionSymbolCount: number;
  reconnectCount: number;
  refreshCount: number;
  eventCount: number;
  streamGapCount: number;
  maxGapMs: number;
  lastEventAtMs: number | null;
};

const MAX_MINUTE_AGGREGATES_PER_SYMBOL = 2_048;
const EVENT_SOURCE_RETRY_DELAY_MS = 5_000;
const EVENT_SOURCE_RECONFIGURE_DEBOUNCE_MS = 150;
const STREAM_GAP_THRESHOLD_MS = 2_500;

const normalizeSymbols = (symbols: string[]): string[] => (
  Array.from(
    new Set(
      symbols
        .map((symbol) => symbol?.trim?.().toUpperCase?.() || "")
        .filter(Boolean),
    ),
  ).sort()
);

const buildStreamUrl = (symbols: string[]): string | null => {
  if (!symbols.length) {
    return null;
  }

  const params = new URLSearchParams({
    symbols: symbols.join(","),
  });

  return `/api/streams/stocks/aggregates?${params.toString()}`;
};

const parseAggregateMessage = (payload: string): BrokerStockAggregateMessage | null => {
  try {
    return JSON.parse(payload) as BrokerStockAggregateMessage;
  } catch {
    return null;
  }
};

const consumers = new Map<number, StreamConsumer>();
const minuteCacheBySymbol = new Map<string, Map<number, BrokerStockAggregateMessage>>();
const storeListeners = new Set<() => void>();
const symbolStoreListeners = new Map<string, Set<() => void>>();
const symbolStoreVersions = new Map<string, number>();
const latencyStoreListeners = new Set<() => void>();
const latencySamples = {
  bridgeToApiMs: [] as number[],
  apiToReactMs: [] as number[],
  totalMs: [] as number[],
};
const MAX_LIVE_LATENCY_SAMPLE_AGE_MS = 10_000;
const aggregateStreamStats: AggregateStreamStats = {
  activeConsumerCount: 0,
  unionSymbolCount: 0,
  reconnectCount: 0,
  refreshCount: 0,
  eventCount: 0,
  streamGapCount: 0,
  maxGapMs: 0,
  lastEventAtMs: null,
};

let nextConsumerId = 1;
let storeVersion = 0;
let latencyStoreVersion = 0;
let eventSource: EventSource | null = null;
let eventSourceSignature = "";
let reconnectTimer: number | null = null;
let refreshTimer: number | null = null;
let reconnectBlockedUntil = 0;
let storeNotifyScheduled = false;
let streamPaused = false;

const flushStoreListeners = () => {
  storeNotifyScheduled = false;
  storeVersion += 1;
  Array.from(storeListeners).forEach((listener) => listener());
};

const notifyStoreListeners = () => {
  if (storeNotifyScheduled) {
    return;
  }

  storeNotifyScheduled = true;
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(flushStoreListeners);
    return;
  }

  setTimeout(flushStoreListeners, 0);
};

const notifySymbolStoreListeners = (symbol: string) => {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) {
    return;
  }

  const listeners = symbolStoreListeners.get(normalizedSymbol);
  if (!listeners?.size) {
    symbolStoreVersions.set(
      normalizedSymbol,
      (symbolStoreVersions.get(normalizedSymbol) ?? 0) + 1,
    );
    return;
  }

  symbolStoreVersions.set(
    normalizedSymbol,
    (symbolStoreVersions.get(normalizedSymbol) ?? 0) + 1,
  );
  Array.from(listeners).forEach((listener) => listener());
};

const notifyLatencyStoreListeners = () => {
  latencyStoreVersion += 1;
  Array.from(latencyStoreListeners).forEach((listener) => listener());
};

const subscribeToLatencyStore = (listener: () => void): (() => void) => {
  latencyStoreListeners.add(listener);
  return () => {
    latencyStoreListeners.delete(listener);
  };
};

const getLatencyStoreSnapshot = (): number => latencyStoreVersion;

const updateAggregateStreamStats = (
  patch: Partial<AggregateStreamStats>,
): void => {
  let changed = false;

  (Object.entries(patch) as Array<
    [keyof AggregateStreamStats, AggregateStreamStats[keyof AggregateStreamStats]]
  >).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (aggregateStreamStats[key] === value) {
      return;
    }

    aggregateStreamStats[key] = value as never;
    changed = true;
  });

  if (changed) {
    notifyLatencyStoreListeners();
  }
};

const syncAggregateConsumerStats = (): void => {
  updateAggregateStreamStats({
    activeConsumerCount: consumers.size,
    unionSymbolCount: getUnionSymbols().length,
  });
};

const readTimestampMs = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pushLatencySample = (bucket: number[], value: number | null) => {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return;
  }

  bucket.push(value);
  while (bucket.length > 256) {
    bucket.shift();
  }
};

const percentile = (values: number[], pct: number): number | null => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[index];
};

const summarizeBucket = (values: number[]) => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
});

const recordLatencySample = (message: BrokerStockAggregateMessage): boolean => {
  const latency = message.latency;
  if (!latency) {
    return false;
  }

  const now = Date.now();
  const bridgeReceivedAt = readTimestampMs(latency.bridgeReceivedAt);
  const bridgeEmittedAt = readTimestampMs(latency.bridgeEmittedAt);
  const apiServerReceivedAt = readTimestampMs(latency.apiServerReceivedAt);
  const apiServerEmittedAt = readTimestampMs(latency.apiServerEmittedAt);
  const endToEndAgeMs =
    bridgeReceivedAt !== null ? now - bridgeReceivedAt : null;
  const bridgeToApiMs =
    bridgeEmittedAt !== null && apiServerReceivedAt !== null
      ? apiServerReceivedAt - bridgeEmittedAt
      : null;
  const apiToReactMs =
    apiServerEmittedAt !== null ? now - apiServerEmittedAt : null;
  let changed = false;

  if (bridgeToApiMs !== null && bridgeToApiMs <= MAX_LIVE_LATENCY_SAMPLE_AGE_MS) {
    pushLatencySample(latencySamples.bridgeToApiMs, bridgeToApiMs);
    changed = true;
  }
  if (apiToReactMs !== null && apiToReactMs <= MAX_LIVE_LATENCY_SAMPLE_AGE_MS) {
    pushLatencySample(latencySamples.apiToReactMs, apiToReactMs);
    changed = true;
  }
  if (endToEndAgeMs !== null && endToEndAgeMs <= MAX_LIVE_LATENCY_SAMPLE_AGE_MS) {
    pushLatencySample(latencySamples.totalMs, endToEndAgeMs);
    changed = true;
  }

  return changed;
};

const subscribeToAggregateStore = (listener: () => void): (() => void) => {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
};

const getAggregateStoreSnapshot = (): number => storeVersion;

const subscribeToAggregateStoreForSymbol = (
  symbol: string,
  listener: () => void,
): (() => void) => {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) {
    return () => {};
  }

  const listeners = symbolStoreListeners.get(normalizedSymbol) ?? new Set<() => void>();
  listeners.add(listener);
  symbolStoreListeners.set(normalizedSymbol, listeners);

  return () => {
    const currentListeners = symbolStoreListeners.get(normalizedSymbol);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      symbolStoreListeners.delete(normalizedSymbol);
    }
  };
};

const getAggregateStoreSnapshotForSymbol = (symbol: string): number => {
  const normalizedSymbol = symbol.trim().toUpperCase();
  return normalizedSymbol ? (symbolStoreVersions.get(normalizedSymbol) ?? 0) : 0;
};

const subscribeToAggregateStoreForSymbols = (
  symbols: string[],
  listener: () => void,
): (() => void) => {
  const unsubscribeAll = normalizeSymbols(symbols).map((symbol) =>
    subscribeToAggregateStoreForSymbol(symbol, listener),
  );

  return () => {
    unsubscribeAll.forEach((unsubscribe) => unsubscribe());
  };
};

const getAggregateStoreSnapshotForSymbols = (symbols: string[]): number => (
  normalizeSymbols(symbols).reduce(
    (version, symbol) => version + (symbolStoreVersions.get(symbol) ?? 0),
    0,
  )
);

const clearReconnectTimer = () => {
  if (reconnectTimer == null) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
};

const clearRefreshTimer = () => {
  if (refreshTimer == null) {
    return;
  }

  clearTimeout(refreshTimer);
  refreshTimer = null;
};

const getUnionSymbols = (): string[] => normalizeSymbols(
  Array.from(consumers.values()).flatMap((consumer) => Array.from(consumer.symbols)),
);

const closeEventSource = () => {
  if (!eventSource) {
    eventSourceSignature = "";
    return;
  }

  eventSource.close();
  eventSource = null;
  eventSourceSignature = "";
};

const scheduleRefreshEventSource = (
  delayMs = EVENT_SOURCE_RECONFIGURE_DEBOUNCE_MS,
) => {
  if (typeof window === "undefined") {
    refreshEventSource();
    return;
  }

  clearRefreshTimer();
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    refreshEventSource();
  }, Math.max(0, delayMs));
};

const trimMinuteCache = (cache: Map<number, BrokerStockAggregateMessage>) => {
  while (cache.size > MAX_MINUTE_AGGREGATES_PER_SYMBOL) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey == null) {
      break;
    }

    cache.delete(oldestKey);
  }
};

const hasAggregateChanged = (
  current: BrokerStockAggregateMessage | undefined,
  next: BrokerStockAggregateMessage,
): boolean => {
  if (!current) {
    return true;
  }

  return (
    current.open !== next.open ||
    current.high !== next.high ||
    current.low !== next.low ||
    current.close !== next.close ||
    current.volume !== next.volume ||
    current.accumulatedVolume !== next.accumulatedVolume ||
    current.vwap !== next.vwap ||
    current.sessionVwap !== next.sessionVwap ||
    current.averageTradeSize !== next.averageTradeSize ||
    current.endMs !== next.endMs
  );
};

const recordAggregate = (message: BrokerStockAggregateMessage) => {
  const symbol = message.symbol.toUpperCase();
  const symbolCache = minuteCacheBySymbol.get(symbol) ?? new Map<number, BrokerStockAggregateMessage>();
  const current = symbolCache.get(message.startMs);

  if (!hasAggregateChanged(current, message)) {
    return;
  }

  symbolCache.set(message.startMs, {
    ...message,
    symbol,
  });
  trimMinuteCache(symbolCache);
  minuteCacheBySymbol.set(symbol, symbolCache);
  notifyStoreListeners();
  notifySymbolStoreListeners(symbol);
};

const handleAggregateMessage = (message: BrokerStockAggregateMessage) => {
  const now = Date.now();
  const lastEventAtMs = aggregateStreamStats.lastEventAtMs;
  const gapMs =
    lastEventAtMs === null
      ? null
      : Math.max(0, now - lastEventAtMs);
  const streamGapCount =
    gapMs !== null && gapMs > STREAM_GAP_THRESHOLD_MS
      ? aggregateStreamStats.streamGapCount + 1
      : aggregateStreamStats.streamGapCount;
  const maxGapMs =
    gapMs !== null ? Math.max(aggregateStreamStats.maxGapMs, gapMs) : aggregateStreamStats.maxGapMs;
  const latencyChanged = recordLatencySample(message);

  aggregateStreamStats.lastEventAtMs = now;
  aggregateStreamStats.eventCount += 1;
  aggregateStreamStats.streamGapCount = streamGapCount;
  aggregateStreamStats.maxGapMs = maxGapMs;

  recordAggregate(message);
  if (latencyChanged || gapMs !== null) {
    notifyLatencyStoreListeners();
  }

  consumers.forEach((consumer) => {
    if (!consumer.symbols.has(message.symbol)) {
      return;
    }

    consumer.onAggregate?.(message);
  });
};

const refreshEventSource = () => {
  if (streamPaused) {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
    clearRefreshTimer();
    closeEventSource();
    return;
  }

  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
    clearRefreshTimer();
    closeEventSource();
    return;
  }

  const unionSymbols = getUnionSymbols();
  const signature = unionSymbols.join(",");

  if (!signature) {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
    clearRefreshTimer();
    closeEventSource();
    return;
  }

  if (eventSource && signature === eventSourceSignature) {
    return;
  }

  if (reconnectBlockedUntil > Date.now()) {
    if (reconnectTimer == null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        refreshEventSource();
      }, Math.max(0, reconnectBlockedUntil - Date.now()));
    }
    return;
  }

  clearReconnectTimer();
  clearRefreshTimer();

  closeEventSource();

  const streamUrl = buildStreamUrl(unionSymbols);
  if (!streamUrl) {
    return;
  }

  updateAggregateStreamStats({
    refreshCount: aggregateStreamStats.refreshCount + 1,
  });
  const source = new EventSource(streamUrl);
  source.onopen = () => {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
    clearRefreshTimer();
  };
  const handleAggregate = (event: MessageEvent<string>) => {
    const message = parseAggregateMessage(event.data);
    if (!message) {
      return;
    }

    handleAggregateMessage(message);
  };

  source.addEventListener("aggregate", handleAggregate as EventListener);
  source.onerror = () => {
    if (source.readyState !== EventSource.CLOSED || eventSource !== source) {
      return;
    }

    reconnectBlockedUntil = Date.now() + EVENT_SOURCE_RETRY_DELAY_MS;
    updateAggregateStreamStats({
      reconnectCount: aggregateStreamStats.reconnectCount + 1,
    });
    closeEventSource();
    refreshEventSource();
  };

  eventSource = source;
  eventSourceSignature = signature;
};

export const setBrokerStockAggregateStreamPaused = (paused: boolean): void => {
  if (streamPaused === paused) {
    return;
  }

  streamPaused = paused;
  if (streamPaused) {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
    clearRefreshTimer();
    closeEventSource();
    return;
  }

  scheduleRefreshEventSource(0);
};

const registerConsumer = (
  symbols: string[],
  onAggregate?: (message: BrokerStockAggregateMessage) => void,
): (() => void) => {
  const id = nextConsumerId;
  nextConsumerId += 1;

  consumers.set(id, {
    id,
    symbols: new Set(symbols),
    onAggregate,
  });
  syncAggregateConsumerStats();
  scheduleRefreshEventSource();

  return () => {
    consumers.delete(id);
    syncAggregateConsumerStats();
    scheduleRefreshEventSource();
  };
};

export const getStoredBrokerMinuteAggregates = (symbol: string): BrokerStockAggregateMessage[] => {
  const normalized = symbol?.trim?.().toUpperCase?.() || "";
  if (!normalized) {
    return [];
  }

  return Array.from(minuteCacheBySymbol.get(normalized)?.values() || [])
    .sort((left, right) => left.startMs - right.startMs);
};

export const useStockMinuteAggregateStoreVersion = (): number => (
  useSyncExternalStore(
    subscribeToAggregateStore,
    getAggregateStoreSnapshot,
    () => 0,
  )
);

export const useStockMinuteAggregateSymbolVersion = (symbol: string): number => (
  useSyncExternalStore(
    (listener) => subscribeToAggregateStoreForSymbol(symbol, listener),
    () => getAggregateStoreSnapshotForSymbol(symbol),
    () => 0,
  )
);

export const useStockMinuteAggregateSymbolsVersion = (symbols: string[]): number => {
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols]);
  const symbolsSignature = normalizedSymbols.join(",");
  const stableSymbols = useMemo(
    () => (symbolsSignature ? symbolsSignature.split(",") : []),
    [symbolsSignature],
  );

  return useSyncExternalStore(
    (listener) => subscribeToAggregateStoreForSymbols(stableSymbols, listener),
    () => getAggregateStoreSnapshotForSymbols(stableSymbols),
    () => 0,
  );
};

export const useIbkrLatencyStats = () => {
  useSyncExternalStore(
    subscribeToLatencyStore,
    getLatencyStoreSnapshot,
    () => 0,
  );

  return {
    bridgeToApiMs: summarizeBucket(latencySamples.bridgeToApiMs),
    apiToReactMs: summarizeBucket(latencySamples.apiToReactMs),
    totalMs: summarizeBucket(latencySamples.totalMs),
    sampleCount: Math.max(
      latencySamples.bridgeToApiMs.length,
      latencySamples.apiToReactMs.length,
      latencySamples.totalMs.length,
    ),
    stream: {
      activeConsumerCount: aggregateStreamStats.activeConsumerCount,
      unionSymbolCount: aggregateStreamStats.unionSymbolCount,
      reconnectCount: aggregateStreamStats.reconnectCount,
      refreshCount: aggregateStreamStats.refreshCount,
      eventCount: aggregateStreamStats.eventCount,
      streamGapCount: aggregateStreamStats.streamGapCount,
      maxGapMs: aggregateStreamStats.maxGapMs,
      lastEventAgeMs:
        aggregateStreamStats.lastEventAtMs === null
          ? null
          : Math.max(0, Date.now() - aggregateStreamStats.lastEventAtMs),
    },
  };
};

export const useBrokerStockAggregateStream = ({
  symbols,
  enabled = true,
  onAggregate,
}: UseBrokerStockAggregateStreamInput): void => {
  const onAggregateRef = useRef(onAggregate);
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols]);
  const subscriptionSignature = normalizedSymbols.join(",");
  const stableSymbols = useMemo(
    () => (subscriptionSignature ? subscriptionSignature.split(",") : []),
    [subscriptionSignature],
  );

  useEffect(() => {
    onAggregateRef.current = onAggregate;
  }, [onAggregate]);

  useEffect(() => {
    if (!enabled || !stableSymbols.length) {
      return undefined;
    }

    return registerConsumer(
      stableSymbols,
      (message) => onAggregateRef.current?.(message),
    );
  }, [enabled, stableSymbols]);
};

export const getStoredStockMinuteAggregates = getStoredBrokerMinuteAggregates;
export const useMassiveStockAggregateStream = useBrokerStockAggregateStream;

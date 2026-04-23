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

const MAX_MINUTE_AGGREGATES_PER_SYMBOL = 2_048;
const EVENT_SOURCE_RETRY_DELAY_MS = 30_000;

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
const latencyStoreListeners = new Set<() => void>();
const latencySamples = {
  bridgeToApiMs: [] as number[],
  apiToReactMs: [] as number[],
  totalMs: [] as number[],
};
const MAX_LIVE_LATENCY_SAMPLE_AGE_MS = 10_000;

let nextConsumerId = 1;
let storeVersion = 0;
let latencyStoreVersion = 0;
let eventSource: EventSource | null = null;
let eventSourceSignature = "";
let reconnectTimer: number | null = null;
let reconnectBlockedUntil = 0;
let storeNotifyScheduled = false;

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

const recordLatencySample = (message: BrokerStockAggregateMessage) => {
  const latency = message.latency;
  if (!latency) {
    return;
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

  if (bridgeToApiMs !== null && bridgeToApiMs <= MAX_LIVE_LATENCY_SAMPLE_AGE_MS) {
    pushLatencySample(latencySamples.bridgeToApiMs, bridgeToApiMs);
  }
  if (apiToReactMs !== null && apiToReactMs <= MAX_LIVE_LATENCY_SAMPLE_AGE_MS) {
    pushLatencySample(latencySamples.apiToReactMs, apiToReactMs);
  }
  if (endToEndAgeMs !== null && endToEndAgeMs <= MAX_LIVE_LATENCY_SAMPLE_AGE_MS) {
    pushLatencySample(latencySamples.totalMs, endToEndAgeMs);
  }
  notifyLatencyStoreListeners();
};

const subscribeToAggregateStore = (listener: () => void): (() => void) => {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
};

const getAggregateStoreSnapshot = (): number => storeVersion;

const clearReconnectTimer = () => {
  if (reconnectTimer == null) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
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
};

const handleAggregateMessage = (message: BrokerStockAggregateMessage) => {
  recordAggregate(message);
  recordLatencySample(message);

  consumers.forEach((consumer) => {
    if (!consumer.symbols.has(message.symbol)) {
      return;
    }

    consumer.onAggregate?.(message);
  });
};

const refreshEventSource = () => {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
    closeEventSource();
    return;
  }

  const unionSymbols = getUnionSymbols();
  const signature = unionSymbols.join(",");

  if (!signature) {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
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

  closeEventSource();

  const streamUrl = buildStreamUrl(unionSymbols);
  if (!streamUrl) {
    return;
  }

  const source = new EventSource(streamUrl);
  source.onopen = () => {
    reconnectBlockedUntil = 0;
    clearReconnectTimer();
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
    closeEventSource();
    refreshEventSource();
  };

  eventSource = source;
  eventSourceSignature = signature;
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
  refreshEventSource();

  return () => {
    consumers.delete(id);
    refreshEventSource();
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

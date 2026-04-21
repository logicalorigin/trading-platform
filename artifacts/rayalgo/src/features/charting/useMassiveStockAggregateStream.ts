import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export type MassiveStockAggregateMessage = {
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
  delayed: true;
  source: "massive-delayed-websocket";
};

type UseMassiveStockAggregateStreamInput = {
  symbols: string[];
  enabled?: boolean;
  onAggregate?: (message: MassiveStockAggregateMessage) => void;
};

type StreamConsumer = {
  id: number;
  symbols: Set<string>;
  onAggregate?: (message: MassiveStockAggregateMessage) => void;
};

const MAX_MINUTE_AGGREGATES_PER_SYMBOL = 2_048;

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

const parseAggregateMessage = (payload: string): MassiveStockAggregateMessage | null => {
  try {
    return JSON.parse(payload) as MassiveStockAggregateMessage;
  } catch {
    return null;
  }
};

const consumers = new Map<number, StreamConsumer>();
const minuteCacheBySymbol = new Map<string, Map<number, MassiveStockAggregateMessage>>();
const storeListeners = new Set<() => void>();

let nextConsumerId = 1;
let storeVersion = 0;
let eventSource: EventSource | null = null;
let eventSourceSignature = "";

const notifyStoreListeners = () => {
  storeVersion += 1;
  storeListeners.forEach((listener) => listener());
};

const subscribeToAggregateStore = (listener: () => void): (() => void) => {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
};

const getAggregateStoreSnapshot = (): number => storeVersion;

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

const trimMinuteCache = (cache: Map<number, MassiveStockAggregateMessage>) => {
  while (cache.size > MAX_MINUTE_AGGREGATES_PER_SYMBOL) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey == null) {
      break;
    }

    cache.delete(oldestKey);
  }
};

const hasAggregateChanged = (
  current: MassiveStockAggregateMessage | undefined,
  next: MassiveStockAggregateMessage,
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

const recordAggregate = (message: MassiveStockAggregateMessage) => {
  const symbol = message.symbol.toUpperCase();
  const symbolCache = minuteCacheBySymbol.get(symbol) ?? new Map<number, MassiveStockAggregateMessage>();
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

const handleAggregateMessage = (message: MassiveStockAggregateMessage) => {
  recordAggregate(message);

  consumers.forEach((consumer) => {
    if (!consumer.symbols.has(message.symbol)) {
      return;
    }

    consumer.onAggregate?.(message);
  });
};

const refreshEventSource = () => {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    closeEventSource();
    return;
  }

  const unionSymbols = getUnionSymbols();
  const signature = unionSymbols.join(",");

  if (!signature) {
    closeEventSource();
    return;
  }

  if (eventSource && signature === eventSourceSignature) {
    return;
  }

  closeEventSource();

  const streamUrl = buildStreamUrl(unionSymbols);
  if (!streamUrl) {
    return;
  }

  const source = new EventSource(streamUrl);
  const handleAggregate = (event: MessageEvent<string>) => {
    const message = parseAggregateMessage(event.data);
    if (!message) {
      return;
    }

    handleAggregateMessage(message);
  };

  source.addEventListener("aggregate", handleAggregate as EventListener);
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED && eventSource === source) {
      closeEventSource();
      refreshEventSource();
    }
  };

  eventSource = source;
  eventSourceSignature = signature;
};

const registerConsumer = (
  symbols: string[],
  onAggregate?: (message: MassiveStockAggregateMessage) => void,
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

export const getStoredStockMinuteAggregates = (symbol: string): MassiveStockAggregateMessage[] => {
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

export const useMassiveStockAggregateStream = ({
  symbols,
  enabled = true,
  onAggregate,
}: UseMassiveStockAggregateStreamInput): void => {
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

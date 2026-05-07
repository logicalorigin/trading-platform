import { getProviderConfiguration } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import { subscribeBridgeQuoteSnapshots } from "./bridge-quote-stream";
import {
  getCurrentPolygonStockMinuteAggregates,
  getPolygonDelayedWebSocketDiagnostics,
  isPolygonDelayedWebSocketConfigured,
  subscribePolygonStockMinuteAggregates,
  type PolygonDelayedStockAggregate,
} from "./polygon-delayed-stream";

export type StockMinuteAggregateSource =
  | "ibkr-websocket-derived"
  | "polygon-delayed-websocket";

export type StockMinuteAggregateMessage = {
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
  source: StockMinuteAggregateSource;
  latency?: QuoteSnapshot["latency"];
};

type Subscriber = {
  id: number;
  symbols: Set<string>;
  onAggregate: (message: StockMinuteAggregateMessage) => void;
};
export type StockMinuteAggregateSubscription = {
  setSymbols(symbols: string[]): void;
  unsubscribe(): void;
};
type BridgeQuoteSnapshotPayload = Parameters<
  Parameters<typeof subscribeBridgeQuoteSnapshots>[1]
>[0];

type MinuteAccumulator = {
  startMs: number;
  endMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  accumulatedVolume: number | null;
  lastObservedDayVolume: number | null;
  latency?: QuoteSnapshot["latency"];
};

type SymbolAggregateStats = {
  eventCount: number;
  gapCount: number;
  maxGapMs: number;
  lastQuoteAt: Date | null;
  lastAggregateAt: Date | null;
  lastGapAt: Date | null;
};

const subscribers = new Map<number, Subscriber>();
const accumulators = new Map<string, MinuteAccumulator>();
const STREAM_RECONFIGURE_DEBOUNCE_MS = 150;
const AGGREGATE_FANOUT_FLUSH_MS = 100;
const AGGREGATE_STALE_HEARTBEAT_MS = 5_000;
const AGGREGATE_QUOTE_FRESH_MS = 10_000;

let nextSubscriberId = 1;
let quoteUnsubscribe: (() => void) | null = null;
let polygonUnsubscribe: (() => void) | null = null;
let quoteSubscriptionSignature = "";
let activeStreamSource: StockMinuteAggregateSource | "none" = "none";
let refreshTimer: NodeJS.Timeout | null = null;
let fanoutTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
const pendingFanoutBySymbol = new Map<string, StockMinuteAggregateMessage>();
const aggregateStatsBySymbol = new Map<string, SymbolAggregateStats>();
let aggregateEventCount = 0;
let aggregateGapCount = 0;
let maxAggregateGapMs = 0;
let lastAggregateAt: Date | null = null;
let lastAggregateGapAt: Date | null = null;

function getSymbolAggregateStats(symbol: string): SymbolAggregateStats {
  const existing = aggregateStatsBySymbol.get(symbol);
  if (existing) {
    return existing;
  }
  const created: SymbolAggregateStats = {
    eventCount: 0,
    gapCount: 0,
    maxGapMs: 0,
    lastQuoteAt: null,
    lastAggregateAt: null,
    lastGapAt: null,
  };
  aggregateStatsBySymbol.set(symbol, created);
  return created;
}

function recordQuoteEvent(symbol: string, observedAt: number): void {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return;
  }
  getSymbolAggregateStats(normalized).lastQuoteAt = new Date(observedAt);
}

function recordAggregateEvent(symbol: string, observedAt = Date.now()): void {
  const normalized = normalizeSymbol(symbol);
  const now = new Date(observedAt);
  if (lastAggregateAt) {
    const gapMs = Math.max(0, now.getTime() - lastAggregateAt.getTime());
    maxAggregateGapMs = Math.max(maxAggregateGapMs, gapMs);
    if (gapMs >= 10_000) {
      aggregateGapCount += 1;
      lastAggregateGapAt = now;
    }
  }

  aggregateEventCount += 1;
  lastAggregateAt = now;

  if (!normalized) {
    return;
  }
  const stats = getSymbolAggregateStats(normalized);
  if (stats.lastAggregateAt) {
    const symbolGapMs = Math.max(
      0,
      now.getTime() - stats.lastAggregateAt.getTime(),
    );
    stats.maxGapMs = Math.max(stats.maxGapMs, symbolGapMs);
    if (symbolGapMs >= 10_000) {
      stats.gapCount += 1;
      stats.lastGapAt = now;
    }
  }
  stats.eventCount += 1;
  stats.lastAggregateAt = now;
}

function getDesiredSymbols(): string[] {
  return Array.from(
    new Set(
      Array.from(subscribers.values()).flatMap((subscriber) => Array.from(subscriber.symbols)),
    ),
  ).sort();
}

function getMinuteWindow(timestamp: number) {
  const startMs = Math.floor(timestamp / 60_000) * 60_000;
  return {
    startMs,
    endMs: startMs + 59_999,
  };
}

function broadcastAggregate(message: StockMinuteAggregateMessage) {
  subscribers.forEach((subscriber) => {
    if (!subscriber.symbols.has(message.symbol)) {
      return;
    }

    subscriber.onAggregate(message);
  });
}

function flushAggregateFanout() {
  fanoutTimer = null;
  const messages = Array.from(pendingFanoutBySymbol.values());
  pendingFanoutBySymbol.clear();
  messages.forEach(broadcastAggregate);
}

function scheduleAggregateFanout(
  message: StockMinuteAggregateMessage,
  observedAt = Date.now(),
) {
  recordAggregateEvent(message.symbol, observedAt);
  pendingFanoutBySymbol.set(message.symbol, message);
  if (fanoutTimer) {
    return;
  }

  fanoutTimer = setTimeout(flushAggregateFanout, AGGREGATE_FANOUT_FLUSH_MS);
  fanoutTimer.unref?.();
}

function toAggregateMessage(symbol: string, accumulator: MinuteAccumulator): StockMinuteAggregateMessage {
  return {
    eventType: "AM",
    symbol,
    open: accumulator.open,
    high: accumulator.high,
    low: accumulator.low,
    close: accumulator.close,
    volume: accumulator.volume,
    accumulatedVolume: accumulator.accumulatedVolume,
    vwap: null,
    sessionVwap: null,
    officialOpen: accumulator.open,
    averageTradeSize: null,
    startMs: accumulator.startMs,
    endMs: accumulator.endMs,
    delayed: false,
    source: "ibkr-websocket-derived",
    latency: accumulator.latency,
  };
}

export function getCurrentStockMinuteAggregates(
  symbols: string[],
): StockMinuteAggregateMessage[] {
  const normalizedSymbols = Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );
  const provider = getPreferredStockAggregateStreamSource();

  if (provider === "polygon-delayed-websocket") {
    return getCurrentPolygonStockMinuteAggregates(normalizedSymbols);
  }

  return normalizedSymbols.flatMap((symbol) => {
    const accumulator = accumulators.get(symbol);
    return accumulator ? [toAggregateMessage(symbol, accumulator)] : [];
  });
}

function updateAccumulator(input: {
  symbol: string;
  price: number;
  dayVolume: number | null;
  observedAt: number;
  latency?: QuoteSnapshot["latency"];
}) {
  const { startMs, endMs } = getMinuteWindow(input.observedAt);
  const existing = accumulators.get(input.symbol);
  const nextVolumeIncrement =
    existing?.lastObservedDayVolume !== null &&
    existing?.lastObservedDayVolume !== undefined &&
    input.dayVolume !== null &&
    input.dayVolume >= existing.lastObservedDayVolume
      ? input.dayVolume - existing.lastObservedDayVolume
      : 0;

  if (!existing || existing.startMs !== startMs) {
    const nextAccumulator: MinuteAccumulator = {
      startMs,
      endMs,
      open: input.price,
      high: input.price,
      low: input.price,
      close: input.price,
      volume: Math.max(0, nextVolumeIncrement),
      accumulatedVolume: input.dayVolume,
      lastObservedDayVolume: input.dayVolume,
      latency: input.latency,
    };
    accumulators.set(input.symbol, nextAccumulator);
    scheduleAggregateFanout(
      toAggregateMessage(input.symbol, nextAccumulator),
      input.observedAt,
    );
    return;
  }

  const nextAccumulator: MinuteAccumulator = {
    ...existing,
    high: Math.max(existing.high, input.price),
    low: Math.min(existing.low, input.price),
    close: input.price,
    volume: existing.volume + Math.max(0, nextVolumeIncrement),
    accumulatedVolume: input.dayVolume,
    lastObservedDayVolume: input.dayVolume,
    latency: input.latency,
  };
  accumulators.set(input.symbol, nextAccumulator);
  scheduleAggregateFanout(
    toAggregateMessage(input.symbol, nextAccumulator),
    input.observedAt,
  );
}

function handleQuoteSnapshot(
  payload: BridgeQuoteSnapshotPayload,
  observedAt = Date.now(),
) {

  payload.quotes.forEach((quote) => {
    const symbol = normalizeSymbol(quote.symbol);
    recordQuoteEvent(symbol, observedAt);
    const price = quote.price > 0 ? quote.price : quote.bid > 0 ? quote.bid : quote.ask;
    if (!price || !Number.isFinite(price)) {
      return;
    }

    updateAccumulator({
      symbol,
      price,
      dayVolume: quote.volume ?? null,
      observedAt,
      latency: quote.latency,
    });
  });
}

function handlePolygonAggregate(message: PolygonDelayedStockAggregate): void {
  scheduleAggregateFanout(message, Date.now());
}

function clearRefreshTimer() {
  if (!refreshTimer) {
    return;
  }

  clearTimeout(refreshTimer);
  refreshTimer = null;
}

function clearHeartbeatTimer() {
  if (!heartbeatTimer) {
    return;
  }
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function emitAggregateHeartbeats(now = Date.now()): void {
  if (getPreferredStockAggregateStreamSource() !== "ibkr-websocket-derived") {
    return;
  }
  getDesiredSymbols().forEach((symbol) => {
    const accumulator = accumulators.get(symbol);
    const stats = aggregateStatsBySymbol.get(symbol);
    if (!accumulator || !stats?.lastQuoteAt || !stats.lastAggregateAt) {
      return;
    }
    const lastQuoteAgeMs = now - stats.lastQuoteAt.getTime();
    const lastAggregateAgeMs = now - stats.lastAggregateAt.getTime();
    if (
      lastQuoteAgeMs <= AGGREGATE_QUOTE_FRESH_MS &&
      lastAggregateAgeMs >= AGGREGATE_STALE_HEARTBEAT_MS
    ) {
      scheduleAggregateFanout(toAggregateMessage(symbol, accumulator), now);
    }
  });
}

function ensureHeartbeatTimer() {
  if (heartbeatTimer || subscribers.size === 0) {
    return;
  }
  heartbeatTimer = setInterval(
    () => emitAggregateHeartbeats(),
    AGGREGATE_STALE_HEARTBEAT_MS,
  );
  heartbeatTimer.unref?.();
}

function refreshQuoteSubscription() {
  clearRefreshTimer();
  const symbols = getDesiredSymbols();
  const provider = getPreferredStockAggregateStreamSource();
  const nextSignature =
    !symbols.length || provider === "none" ? "" : `${provider}:${symbols.join(",")}`;

  if (nextSignature === quoteSubscriptionSignature) {
    return;
  }

  quoteUnsubscribe?.();
  quoteUnsubscribe = null;
  polygonUnsubscribe?.();
  polygonUnsubscribe = null;
  quoteSubscriptionSignature = nextSignature;
  activeStreamSource = !symbols.length ? "none" : provider;

  if (!symbols.length || provider === "none") {
    clearHeartbeatTimer();
    return;
  }

  if (provider === "polygon-delayed-websocket") {
    clearHeartbeatTimer();
    polygonUnsubscribe = subscribePolygonStockMinuteAggregates(
      symbols,
      handlePolygonAggregate,
    );
    return;
  }

  ensureHeartbeatTimer();
  quoteUnsubscribe = subscribeBridgeQuoteSnapshots(symbols, handleQuoteSnapshot);
}

function scheduleRefreshQuoteSubscription(
  delayMs = STREAM_RECONFIGURE_DEBOUNCE_MS,
) {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshQuoteSubscription();
  }, Math.max(0, delayMs));
  refreshTimer.unref?.();
}

export function isStockAggregateStreamingAvailable(): boolean {
  return getPreferredStockAggregateStreamSource() !== "none";
}

export function getPreferredStockAggregateStreamSource():
  | StockMinuteAggregateSource
  | "none" {
  return resolvePreferredStockAggregateStreamSource({
    ibkrConfigured: getProviderConfiguration().ibkr,
    polygonDelayedConfigured: isPolygonDelayedWebSocketConfigured(),
  });
}

export function resolvePreferredStockAggregateStreamSource({
  ibkrConfigured,
  polygonDelayedConfigured,
}: {
  ibkrConfigured: boolean;
  polygonDelayedConfigured: boolean;
}): StockMinuteAggregateSource | "none" {
  if (ibkrConfigured) {
    return "ibkr-websocket-derived";
  }
  if (polygonDelayedConfigured) {
    return "polygon-delayed-websocket";
  }
  return "none";
}

export function getStockAggregateStreamDiagnostics() {
  const desiredSymbols = getDesiredSymbols();
  const now = Date.now();
  const lastAggregateAgeMs = lastAggregateAt
    ? Math.max(0, now - lastAggregateAt.getTime())
    : null;

  return {
    provider: getPreferredStockAggregateStreamSource(),
    activeProvider: activeStreamSource,
    activeConsumerCount: subscribers.size,
    unionSymbolCount: desiredSymbols.length,
    accumulatorCount: accumulators.size,
    pendingFanoutCount: pendingFanoutBySymbol.size,
    eventCount: aggregateEventCount,
    gapCount: aggregateGapCount,
    maxGapMs: aggregateEventCount > 1 ? maxAggregateGapMs : null,
    lastAggregateAt: lastAggregateAt?.toISOString() ?? null,
    lastAggregateAgeMs,
    lastGapAt: lastAggregateGapAt?.toISOString() ?? null,
    quoteSubscriptionActive: Boolean(quoteUnsubscribe ?? polygonUnsubscribe),
    quoteSubscriptionSignature,
    perSymbol: desiredSymbols.map((symbol) => {
      const stats = aggregateStatsBySymbol.get(symbol);
      const accumulator = accumulators.get(symbol);
      return {
        symbol,
        hasAccumulator: Boolean(accumulator),
        eventCount: stats?.eventCount ?? 0,
        gapCount: stats?.gapCount ?? 0,
        maxGapMs:
          stats && stats.eventCount > 1 ? stats.maxGapMs : null,
        lastQuoteAt: stats?.lastQuoteAt?.toISOString() ?? null,
        lastQuoteAgeMs: stats?.lastQuoteAt
          ? Math.max(0, now - stats.lastQuoteAt.getTime())
          : null,
        lastAggregateAt: stats?.lastAggregateAt?.toISOString() ?? null,
        lastAggregateAgeMs: stats?.lastAggregateAt
          ? Math.max(0, now - stats.lastAggregateAt.getTime())
          : null,
        lastGapAt: stats?.lastGapAt?.toISOString() ?? null,
      };
    }),
    polygonDelayedWebSocket: getPolygonDelayedWebSocketDiagnostics(),
  };
}

export function subscribeStockMinuteAggregates(
  symbols: string[],
  onAggregate: (message: StockMinuteAggregateMessage) => void,
): () => void {
  return subscribeMutableStockMinuteAggregates(symbols, onAggregate).unsubscribe;
}

export function subscribeMutableStockMinuteAggregates(
  symbols: string[],
  onAggregate: (message: StockMinuteAggregateMessage) => void,
): StockMinuteAggregateSubscription {
  const normalizedSymbols = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;

  subscribers.set(subscriberId, {
    id: subscriberId,
    symbols: normalizedSymbols,
    onAggregate,
  });
  scheduleRefreshQuoteSubscription();

  const unsubscribe = () => {
    subscribers.delete(subscriberId);
    if (subscribers.size === 0) {
      if (fanoutTimer) {
        clearTimeout(fanoutTimer);
        fanoutTimer = null;
      }
      clearHeartbeatTimer();
      pendingFanoutBySymbol.clear();
    }
    scheduleRefreshQuoteSubscription();
  };

  return {
    setSymbols(nextSymbols: string[]) {
      const subscriber = subscribers.get(subscriberId);
      if (!subscriber) {
        return;
      }
      subscriber.symbols = new Set(
        nextSymbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
      );
      scheduleRefreshQuoteSubscription();
    },
    unsubscribe,
  };
}

export const __stockAggregateStreamTestInternals = {
  handleQuoteSnapshot,
  emitAggregateHeartbeats,
  flushAggregateFanout,
  reset() {
    subscribers.clear();
    accumulators.clear();
    pendingFanoutBySymbol.clear();
    aggregateStatsBySymbol.clear();
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (fanoutTimer) {
      clearTimeout(fanoutTimer);
      fanoutTimer = null;
    }
    clearHeartbeatTimer();
    nextSubscriberId = 1;
    quoteUnsubscribe = null;
    polygonUnsubscribe = null;
    quoteSubscriptionSignature = "";
    activeStreamSource = "none";
    aggregateEventCount = 0;
    aggregateGapCount = 0;
    maxAggregateGapMs = 0;
    lastAggregateAt = null;
    lastAggregateGapAt = null;
  },
};

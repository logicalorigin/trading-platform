import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  getCurrentMassiveStockMinuteAggregates,
  getMassiveDelayedWebSocketDiagnostics,
  isMassiveDelayedWebSocketConfigured,
  subscribeMassiveStockMinuteAggregates,
  type MassiveDelayedStockAggregate,
} from "./massive-stock-aggregate-stream";
import { subscribeMassiveStockQuoteSnapshots } from "./massive-stock-quote-stream";
import { serializeSseEventData } from "./sse-stream-diagnostics";

export type StockMinuteAggregateSource =
  | "ibkr-websocket-derived"
  | "massive-websocket"
  | "massive-delayed-websocket";

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
  rawQuotePatches: boolean;
  // serializeEvent is a per-broadcast memoized thunk: calling it returns the SSE
  // `data` JSON, serialized at most once and shared across all subscribers of the
  // same broadcast. Non-SSE subscribers (e.g. signal-monitor evaluation) ignore
  // it and pay no serialization cost.
  onAggregate: (
    message: StockMinuteAggregateMessage,
    serializeEvent?: () => string,
  ) => void;
};
export type StockMinuteAggregateSubscription = {
  setSymbols(symbols: string[]): void;
  unsubscribe(): void;
};
export type StockMinuteAggregateSubscriptionOptions = {
  rawQuotePatches?: boolean;
};
type MassiveQuoteSnapshotPayload = Parameters<
  Parameters<typeof subscribeMassiveStockQuoteSnapshots>[1]
>[0];

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === "") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function isBackgroundStockAggregateStreamingEnabled(): boolean {
  return readBooleanEnv(
    "PYRUS_BACKGROUND_STOCK_AGGREGATE_STREAMS_ENABLED",
    false,
  );
}

export function isForegroundSignalMatrixStockAggregateStreamingEnabled(): boolean {
  return readBooleanEnv(
    "PYRUS_SIGNAL_MATRIX_STOCK_AGGREGATE_STREAMS_ENABLED",
    true,
  );
}

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
  source: StockMinuteAggregateSource;
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
const aggregateHistoryBySymbol = new Map<string, StockMinuteAggregateMessage[]>();
const STREAM_RECONFIGURE_DEBOUNCE_MS = 150;
const AGGREGATE_FANOUT_FLUSH_MS = 100;
export const STOCK_AGGREGATE_HISTORY_RETENTION_MS = 4 * 60 * 60_000;

let nextSubscriberId = 1;
let massiveUnsubscribe: (() => void) | null = null;
let massiveQuoteUnsubscribe: (() => void) | null = null;
let quoteSubscriptionSignature = "";
let activeStreamSource: StockMinuteAggregateSource | "none" = "none";
let refreshTimer: NodeJS.Timeout | null = null;
let fanoutTimer: NodeJS.Timeout | null = null;
const pendingFanoutBySymbol = new Map<
  string,
  { message: StockMinuteAggregateMessage; observedAt: number }
>();
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

function getRawQuotePatchSymbols(): string[] {
  return Array.from(
    new Set(
      Array.from(subscribers.values())
        .filter((subscriber) => subscriber.rawQuotePatches)
        .flatMap((subscriber) => Array.from(subscriber.symbols)),
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

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? Math.min(max, Math.max(min, Math.round(resolved)))
    : fallback;
}

function aggregateFanoutKey(message: StockMinuteAggregateMessage): string {
  return `${message.symbol}:${message.startMs}`;
}

function recordAggregateHistory(message: StockMinuteAggregateMessage): void {
  const symbol = normalizeSymbol(message.symbol);
  if (!symbol) {
    return;
  }

  // History entries are replaced on correction, never mutated in place. Keep
  // their identity stable so read-side derived caches can reuse work safely.
  const normalizedMessage = Object.freeze({ ...message, symbol });
  const cutoffMs = message.startMs - STOCK_AGGREGATE_HISTORY_RETENTION_MS;
  const history = aggregateHistoryBySymbol.get(symbol);
  if (!history) {
    aggregateHistoryBySymbol.set(symbol, [normalizedMessage]);
    return;
  }

  const last = history[history.length - 1];
  if (last?.startMs === message.startMs) {
    history[history.length - 1] = normalizedMessage;
  } else if (!last || message.startMs > last.startMs) {
    history.push(normalizedMessage);
  } else {
    const matchingIndex = history.findIndex(
      (entry) => entry.startMs === message.startMs,
    );
    if (matchingIndex >= 0) {
      history[matchingIndex] = normalizedMessage;
    } else {
      const insertIndex = history.findIndex(
        (entry) => entry.startMs > message.startMs,
      );
      history.splice(
        insertIndex >= 0 ? insertIndex : history.length,
        0,
        normalizedMessage,
      );
    }
  }

  while (history.length > 0 && history[0].startMs < cutoffMs) {
    history.shift();
  }
}

function broadcastAggregate(message: StockMinuteAggregateMessage) {
  // Serialize the per-symbol aggregate at most ONCE per broadcast and share the
  // bytes across every matching SSE subscriber — previously each subscriber ran
  // its own JSON.stringify of the same payload (O(subscribers) per event). The
  // thunk is lazy: a broadcast with only non-SSE subscribers never serializes.
  // apiServerEmittedAt is stamped once per broadcast (shared) instead of once per
  // delivery; deliveries are microseconds apart.
  let serialized: string | undefined;
  const serializeEvent = (): string => {
    if (serialized === undefined) {
      serialized = serializeSseEventData({
        ...message,
        latency: {
          ...(message.latency ?? {}),
          apiServerEmittedAt: new Date(),
        },
      });
    }
    return serialized;
  };
  subscribers.forEach((subscriber) => {
    if (!subscriber.symbols.has(message.symbol)) {
      return;
    }

    subscriber.onAggregate(message, serializeEvent);
  });
}

function flushAggregateFanout() {
  if (fanoutTimer) {
    clearTimeout(fanoutTimer);
  }
  fanoutTimer = null;
  const fanoutItems = Array.from(pendingFanoutBySymbol.values());
  pendingFanoutBySymbol.clear();
  fanoutItems.forEach(({ message, observedAt }) => {
    recordAggregateEvent(message.symbol, observedAt);
    recordAggregateHistory(message);
    broadcastAggregate(message);
  });
}

function scheduleAggregateFanout(
  message: StockMinuteAggregateMessage,
  observedAt = Date.now(),
) {
  pendingFanoutBySymbol.set(aggregateFanoutKey(message), {
    message,
    observedAt,
  });
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
    source: accumulator.source,
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

  if (provider === "massive-delayed-websocket" || provider === "massive-websocket") {
    const bySymbolAndMinute = new Map<string, StockMinuteAggregateMessage>();
    getCurrentMassiveStockMinuteAggregates(normalizedSymbols).forEach((message) => {
      bySymbolAndMinute.set(`${message.symbol}:${message.startMs}`, message);
    });
    normalizedSymbols.forEach((symbol) => {
      const accumulator = accumulators.get(symbol);
      if (accumulator?.source === "massive-websocket") {
        const message = toAggregateMessage(symbol, accumulator);
        bySymbolAndMinute.set(`${message.symbol}:${message.startMs}`, message);
      }
    });
    return Array.from(bySymbolAndMinute.values()).sort(
      (left, right) => left.startMs - right.startMs,
    );
  }

  return normalizedSymbols.flatMap((symbol) => {
    const accumulator = accumulators.get(symbol);
    return accumulator ? [toAggregateMessage(symbol, accumulator)] : [];
  });
}

export function getRecentStockMinuteAggregateHistory(input: {
  symbol: string;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
}): StockMinuteAggregateMessage[] {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return [];
  }
  const sinceMs =
    typeof input.sinceMs === "number" && Number.isFinite(input.sinceMs)
      ? input.sinceMs
      : Number.NEGATIVE_INFINITY;
  const untilMs =
    typeof input.untilMs === "number" && Number.isFinite(input.untilMs)
      ? input.untilMs
      : Number.POSITIVE_INFINITY;
  const limit = positiveInteger(input.limit, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER);

  return (aggregateHistoryBySymbol.get(symbol) ?? [])
    .filter((message) => message.startMs >= sinceMs && message.startMs <= untilMs)
    .sort((left, right) => left.startMs - right.startMs)
    .slice(-limit);
}

function updateAccumulator(input: {
  symbol: string;
  price: number;
  dayVolume: number | null;
  observedAt: number;
  source?: StockMinuteAggregateSource;
  latency?: QuoteSnapshot["latency"];
}) {
  const { startMs, endMs } = getMinuteWindow(input.observedAt);
  const existing = accumulators.get(input.symbol);
  const previousDayVolume = existing?.lastObservedDayVolume;
  const nextVolumeIncrement =
    previousDayVolume !== null &&
    previousDayVolume !== undefined &&
    input.dayVolume !== null
      ? input.dayVolume >= previousDayVolume
        ? input.dayVolume - previousDayVolume
        : input.dayVolume
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
      source: input.source ?? "massive-websocket",
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
    source: input.source ?? existing.source,
    latency: input.latency,
  };
  accumulators.set(input.symbol, nextAccumulator);
  scheduleAggregateFanout(
    toAggregateMessage(input.symbol, nextAccumulator),
    input.observedAt,
  );
}

function handleMassiveQuoteSnapshot(
  payload: MassiveQuoteSnapshotPayload,
  observedAt = Date.now(),
) {
  payload.quotes.forEach((quote) => {
    const symbol = normalizeSymbol(quote.symbol);
    recordQuoteEvent(symbol, observedAt);
    const price =
      quote.price > 0 ? quote.price : quote.bid > 0 ? quote.bid : quote.ask;
    if (!price || !Number.isFinite(price)) {
      return;
    }

    updateAccumulator({
      symbol,
      price,
      dayVolume: quote.volume ?? null,
      observedAt,
      source: "massive-websocket",
      latency: quote.latency,
    });
  });
}

function handleMassiveAggregate(message: MassiveDelayedStockAggregate): void {
  scheduleAggregateFanout(message, Date.now());
}

function clearRefreshTimer() {
  if (!refreshTimer) {
    return;
  }

  clearTimeout(refreshTimer);
  refreshTimer = null;
}

function refreshQuoteSubscription() {
  clearRefreshTimer();
  const symbols = getDesiredSymbols();
  const rawQuoteSymbols = getRawQuotePatchSymbols();
  const provider = getPreferredStockAggregateStreamSource();
  const nextSignature =
    !symbols.length || provider === "none"
      ? ""
      : `${provider}:${symbols.join(",")}|raw:${rawQuoteSymbols.join(",")}`;

  if (nextSignature === quoteSubscriptionSignature) {
    return;
  }

  massiveUnsubscribe?.();
  massiveUnsubscribe = null;
  massiveQuoteUnsubscribe?.();
  massiveQuoteUnsubscribe = null;
  quoteSubscriptionSignature = nextSignature;
  activeStreamSource = !symbols.length ? "none" : provider;

  if (!symbols.length || provider === "none") {
    return;
  }

  if (provider === "massive-delayed-websocket" || provider === "massive-websocket") {
    massiveUnsubscribe = subscribeMassiveStockMinuteAggregates(
      symbols,
      handleMassiveAggregate,
      { extendedHoursTrades: false },
    );
    if (provider === "massive-websocket" && rawQuoteSymbols.length) {
      massiveQuoteUnsubscribe = subscribeMassiveStockQuoteSnapshots(
        rawQuoteSymbols,
        // Ignore the serialize-once thunk (2nd arg) — this is a non-SSE consumer
        // that feeds the aggregate accumulator; observedAt stays Date.now() as
        // before (the provider never passed it positionally).
        (payload) => handleMassiveQuoteSnapshot(payload),
      );
    }
    return;
  }
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
    massiveDelayedConfigured: isMassiveDelayedWebSocketConfigured(),
    massiveRealtimeConfigured: isMassiveStocksRealtimeConfigured(),
  });
}

export function resolvePreferredStockAggregateStreamSource({
  massiveDelayedConfigured,
  massiveRealtimeConfigured = false,
}: {
  massiveDelayedConfigured: boolean;
  massiveRealtimeConfigured?: boolean;
}): StockMinuteAggregateSource | "none" {
  if (massiveRealtimeConfigured) {
    return "massive-websocket";
  }
  if (massiveDelayedConfigured) {
    return "massive-delayed-websocket";
  }
  return "none";
}

export function getActiveStockAggregateStreamSource():
  | StockMinuteAggregateSource
  | "none" {
  return activeStreamSource;
}

export function getStockAggregateStreamDiagnostics() {
  const desiredSymbols = getDesiredSymbols();
  const rawQuoteSymbols = getRawQuotePatchSymbols();
  const now = Date.now();
  const lastAggregateAgeMs = lastAggregateAt
    ? Math.max(0, now - lastAggregateAt.getTime())
    : null;

  return {
    provider: getPreferredStockAggregateStreamSource(),
    activeProvider: activeStreamSource,
    activeConsumerCount: subscribers.size,
    unionSymbolCount: desiredSymbols.length,
    rawQuoteSymbolCount: rawQuoteSymbols.length,
    accumulatorCount: accumulators.size,
    pendingFanoutCount: pendingFanoutBySymbol.size,
    historySymbolCount: aggregateHistoryBySymbol.size,
    historyAggregateCount: Array.from(aggregateHistoryBySymbol.values()).reduce(
      (sum, entries) => sum + entries.length,
      0,
    ),
    eventCount: aggregateEventCount,
    gapCount: aggregateGapCount,
    maxGapMs: aggregateEventCount > 1 ? maxAggregateGapMs : null,
    lastAggregateAt: lastAggregateAt?.toISOString() ?? null,
    lastAggregateAgeMs,
    lastGapAt: lastAggregateGapAt?.toISOString() ?? null,
    quoteSubscriptionActive: Boolean(massiveUnsubscribe ?? massiveQuoteUnsubscribe),
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
    massiveDelayedWebSocket: getMassiveDelayedWebSocketDiagnostics(),
  };
}

export function hasRecentStockAggregateSourceActivity(input: {
  symbols: string[];
  now?: Date;
  maxAgeMs: number;
}): boolean {
  const maxAgeMs = Number(input.maxAgeMs);
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return false;
  }
  const nowMs = input.now?.getTime() ?? Date.now();
  if (!Number.isFinite(nowMs)) {
    return false;
  }
  const provider = getPreferredStockAggregateStreamSource();
  if (provider === "none") {
    return false;
  }
  return Array.from(
    new Set(input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  ).some((symbol) => {
    const stats = aggregateStatsBySymbol.get(symbol);
    const sourceTime = stats?.lastAggregateAt;
    if (!sourceTime) {
      return false;
    }
    return nowMs - sourceTime.getTime() <= maxAgeMs;
  });
}

export function subscribeStockMinuteAggregates(
  symbols: string[],
  onAggregate: (message: StockMinuteAggregateMessage) => void,
  options: StockMinuteAggregateSubscriptionOptions = {},
): () => void {
  return subscribeMutableStockMinuteAggregates(
    symbols,
    onAggregate,
    options,
  ).unsubscribe;
}

export function subscribeMutableStockMinuteAggregates(
  symbols: string[],
  onAggregate: (
    message: StockMinuteAggregateMessage,
    serializeEvent?: () => string,
  ) => void,
  options: StockMinuteAggregateSubscriptionOptions = {},
): StockMinuteAggregateSubscription {
  const normalizedSymbols = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;

  subscribers.set(subscriberId, {
    id: subscriberId,
    symbols: normalizedSymbols,
    rawQuotePatches: options.rawQuotePatches === true,
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
  handleMassiveQuoteSnapshot,
  flushAggregateFanout,
  scheduleAggregateFanoutForTests: scheduleAggregateFanout,
  // Push a finalized minute aggregate straight into the in-memory history ring so
  // tests can drive the signal-monitor stream-bar path without a live feed.
  ingestAggregateForTests(message: StockMinuteAggregateMessage) {
    recordAggregateHistory(message);
  },
  reset() {
    subscribers.clear();
    accumulators.clear();
    aggregateHistoryBySymbol.clear();
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
    nextSubscriberId = 1;
    massiveUnsubscribe = null;
    massiveQuoteUnsubscribe = null;
    quoteSubscriptionSignature = "";
    activeStreamSource = "none";
    aggregateEventCount = 0;
    aggregateGapCount = 0;
    maxAggregateGapMs = 0;
    lastAggregateAt = null;
    lastAggregateGapAt = null;
  },
};

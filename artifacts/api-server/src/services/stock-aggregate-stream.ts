import { getProviderConfiguration } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import { subscribeBridgeQuoteSnapshots } from "./bridge-quote-stream";

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
  delayed: false;
  source: "ibkr-websocket-derived";
  latency?: QuoteSnapshot["latency"];
};

type Subscriber = {
  id: number;
  symbols: Set<string>;
  onAggregate: (message: StockMinuteAggregateMessage) => void;
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

const subscribers = new Map<number, Subscriber>();
const accumulators = new Map<string, MinuteAccumulator>();
const STREAM_RECONFIGURE_DEBOUNCE_MS = 150;

let nextSubscriberId = 1;
let quoteUnsubscribe: (() => void) | null = null;
let quoteSubscriptionSignature = "";
let refreshTimer: NodeJS.Timeout | null = null;

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
  return Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  ).flatMap((symbol) => {
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
    broadcastAggregate(toAggregateMessage(input.symbol, nextAccumulator));
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
  broadcastAggregate(toAggregateMessage(input.symbol, nextAccumulator));
}

function handleQuoteSnapshot(payload: BridgeQuoteSnapshotPayload) {
  const observedAt = Date.now();

  payload.quotes.forEach((quote) => {
    const price = quote.price > 0 ? quote.price : quote.bid > 0 ? quote.bid : quote.ask;
    if (!price || !Number.isFinite(price)) {
      return;
    }

    updateAccumulator({
      symbol: normalizeSymbol(quote.symbol),
      price,
      dayVolume: quote.volume ?? null,
      observedAt,
      latency: quote.latency,
    });
  });
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
  const nextSignature = symbols.join(",");

  if (nextSignature === quoteSubscriptionSignature) {
    return;
  }

  quoteUnsubscribe?.();
  quoteUnsubscribe = null;
  quoteSubscriptionSignature = nextSignature;

  if (!symbols.length) {
    return;
  }

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
  return getProviderConfiguration().ibkr;
}

export function subscribeStockMinuteAggregates(
  symbols: string[],
  onAggregate: (message: StockMinuteAggregateMessage) => void,
): () => void {
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

  return () => {
    subscribers.delete(subscriberId);
    scheduleRefreshQuoteSubscription();
  };
}

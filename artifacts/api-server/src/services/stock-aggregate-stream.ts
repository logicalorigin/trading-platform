import { getProviderConfiguration } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { logger } from "../lib/logger";

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
};

type Subscriber = {
  id: number;
  symbols: Set<string>;
  onAggregate: (message: StockMinuteAggregateMessage) => void;
};

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
};

const POLL_INTERVAL_MS = 1_000;
const subscribers = new Map<number, Subscriber>();
const accumulators = new Map<string, MinuteAccumulator>();
const bridgeClient = new IbkrBridgeClient();

let nextSubscriberId = 1;
let pollTimer: NodeJS.Timeout | null = null;
let pollInFlight = false;

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
  };
  accumulators.set(input.symbol, nextAccumulator);
  broadcastAggregate(toAggregateMessage(input.symbol, nextAccumulator));
}

async function pollQuotesOnce() {
  if (pollInFlight) {
    return;
  }

  const symbols = getDesiredSymbols();
  if (symbols.length === 0) {
    return;
  }

  pollInFlight = true;

  try {
    const quotes = await bridgeClient.getQuoteSnapshots(symbols);
    const observedAt = Date.now();

    quotes.forEach((quote) => {
      const price = quote.price > 0 ? quote.price : quote.bid > 0 ? quote.bid : quote.ask;
      if (!price || !Number.isFinite(price)) {
        return;
      }

      updateAccumulator({
        symbol: normalizeSymbol(quote.symbol),
        price,
        dayVolume: quote.volume ?? null,
        observedAt,
      });
    });
  } catch (error) {
    logger.warn({ err: error }, "IBKR quote polling failed");
  } finally {
    pollInFlight = false;
  }
}

function ensurePolling() {
  if (pollTimer || subscribers.size === 0) {
    return;
  }

  pollTimer = setInterval(() => {
    void pollQuotesOnce();
  }, POLL_INTERVAL_MS);
  pollTimer.unref?.();
  void pollQuotesOnce();
}

function stopPollingIfIdle() {
  if (subscribers.size > 0 || !pollTimer) {
    return;
  }

  clearInterval(pollTimer);
  pollTimer = null;
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
  ensurePolling();

  return () => {
    subscribers.delete(subscriberId);
    stopPollingIfIdle();
  };
}

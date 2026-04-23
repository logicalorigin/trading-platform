import { normalizeSymbol } from "../lib/values";
import { logger } from "../lib/logger";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type { QuoteSnapshot } from "../providers/ibkr/client";

type QuoteWithSource = QuoteSnapshot & {
  source: "ibkr";
};

type QuoteSnapshotPayload = {
  quotes: QuoteWithSource[];
};

type Subscriber = {
  id: number;
  symbols: Set<string>;
  onSnapshot: (payload: QuoteSnapshotPayload) => void;
};

const bridgeClient = new IbkrBridgeClient();
const subscribers = new Map<number, Subscriber>();
const quoteCacheBySymbol = new Map<string, QuoteSnapshot>();
const RECONNECT_DELAY_MS = 1_000;
const STREAM_RECONFIGURE_DEBOUNCE_MS = 150;

let nextSubscriberId = 1;
let streamSignature = "";
let streamUnsubscribe: (() => void) | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  ).sort();
}

function getDesiredSymbols(): string[] {
  return normalizeSymbols(
    Array.from(subscribers.values()).flatMap((subscriber) =>
      Array.from(subscriber.symbols),
    ),
  );
}

function addApiLatency(
  quote: QuoteSnapshot,
  timestampKey: "apiServerReceivedAt" | "apiServerEmittedAt",
  at = new Date(),
): QuoteSnapshot {
  return {
    ...quote,
    latency: {
      ...(quote.latency ?? {}),
      [timestampKey]: at,
    },
  };
}

function toPayloadQuote(quote: QuoteSnapshot): QuoteWithSource {
  return {
    ...addApiLatency(quote, "apiServerEmittedAt"),
    source: "ibkr",
  };
}

function cacheQuote(quote: QuoteSnapshot): QuoteSnapshot {
  const normalizedSymbol = normalizeSymbol(quote.symbol);
  const cached = addApiLatency(
    {
      ...quote,
      symbol: normalizedSymbol,
    },
    "apiServerReceivedAt",
  );
  quoteCacheBySymbol.set(normalizedSymbol, cached);
  return cached;
}

function notifySubscribers(quotes: QuoteSnapshot[]) {
  subscribers.forEach((subscriber) => {
    const matchedQuotes = quotes
      .filter((quote) => subscriber.symbols.has(normalizeSymbol(quote.symbol)))
      .map(toPayloadQuote);

    if (matchedQuotes.length > 0) {
      subscriber.onSnapshot({ quotes: matchedQuotes });
    }
  });
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function clearRefreshTimer() {
  if (!refreshTimer) {
    return;
  }

  clearTimeout(refreshTimer);
  refreshTimer = null;
}

function stopStream() {
  clearRefreshTimer();
  streamUnsubscribe?.();
  streamUnsubscribe = null;
  streamSignature = "";
}

function scheduleReconnect() {
  if (reconnectTimer || subscribers.size === 0) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    refreshBridgeQuoteStream();
  }, RECONNECT_DELAY_MS);
  reconnectTimer.unref?.();
}

function handleStreamError(expectedSignature: string, error: unknown) {
  if (streamSignature !== expectedSignature) {
    return;
  }

  logger.warn({ err: error, symbols: expectedSignature }, "IBKR bridge quote stream failed");
  stopStream();
  scheduleReconnect();
}

function refreshBridgeQuoteStream() {
  clearReconnectTimer();
  clearRefreshTimer();

  const symbols = getDesiredSymbols();
  const nextSignature = symbols.join(",");

  if (nextSignature === streamSignature) {
    return;
  }

  stopStream();

  if (!nextSignature) {
    return;
  }

  streamSignature = nextSignature;
  streamUnsubscribe = bridgeClient.streamQuoteSnapshots(
    symbols,
    (quotes) => {
      const cachedQuotes = quotes.map(cacheQuote);
      notifySubscribers(cachedQuotes);
    },
    (error) => handleStreamError(nextSignature, error),
  );
}

function scheduleRefreshBridgeQuoteStream(
  delayMs = STREAM_RECONFIGURE_DEBOUNCE_MS,
) {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshBridgeQuoteStream();
  }, Math.max(0, delayMs));
  refreshTimer.unref?.();
}

export function getCurrentBridgeQuoteSnapshots(symbols: string[]): QuoteWithSource[] {
  return normalizeSymbols(symbols).flatMap((symbol) => {
    const quote = quoteCacheBySymbol.get(symbol);
    return quote ? [toPayloadQuote(quote)] : [];
  });
}

export async function fetchBridgeQuoteSnapshots(
  symbols: string[],
): Promise<QuoteSnapshotPayload> {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (!normalizedSymbols.length) {
    return { quotes: [] };
  }

  const cachedQuotes = getCurrentBridgeQuoteSnapshots(normalizedSymbols);
  const cachedSymbols = new Set(cachedQuotes.map((quote) => normalizeSymbol(quote.symbol)));

  if (cachedSymbols.size < normalizedSymbols.length) {
    const freshQuotes = await bridgeClient.getQuoteSnapshots(normalizedSymbols);
    freshQuotes.map(cacheQuote);
  }

  return {
    quotes: getCurrentBridgeQuoteSnapshots(normalizedSymbols),
  };
}

export function subscribeBridgeQuoteSnapshots(
  symbols: string[],
  onSnapshot: (payload: QuoteSnapshotPayload) => void,
): () => void {
  const normalizedSymbols = normalizeSymbols(symbols);
  if (!normalizedSymbols.length) {
    return () => {};
  }

  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;
  subscribers.set(subscriberId, {
    id: subscriberId,
    symbols: new Set(normalizedSymbols),
    onSnapshot,
  });

  const cachedQuotes = getCurrentBridgeQuoteSnapshots(normalizedSymbols);
  if (cachedQuotes.length > 0) {
    onSnapshot({ quotes: cachedQuotes });
  }

  scheduleRefreshBridgeQuoteStream();

  return () => {
    subscribers.delete(subscriberId);
    scheduleRefreshBridgeQuoteStream();
  };
}

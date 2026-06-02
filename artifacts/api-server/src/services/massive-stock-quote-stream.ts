import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import {
  asNumber,
  asRecord,
  asString,
  normalizeSymbol,
  toDate,
} from "../lib/values";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  __massiveStockWebSocketInternalsForTests,
  getMassiveStockWebSocketDiagnostics,
  subscribeMassiveStockWebSocket,
} from "./massive-stock-websocket";

type MassiveStockQuote = QuoteSnapshot & { source: "massive" };
type QuoteSnapshotPayload = {
  quotes: MassiveStockQuote[];
};
type Subscriber = {
  id: number;
  symbols: Set<string>;
  onSnapshot: (payload: QuoteSnapshotPayload) => void;
};
type QuoteState = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  volume: number | null;
  updatedAt: Date;
};

const subscribers = new Map<number, Subscriber>();
const quoteCacheBySymbol = new Map<string, QuoteState>();
const REFRESH_DEBOUNCE_MS = 150;

let nextSubscriberId = 1;
let subscriptionSignature = "";
let refreshTimer: NodeJS.Timeout | null = null;
let transportUnsubscribe: (() => void) | null = null;
let eventCount = 0;

export function isMassiveStockQuoteStreamConfigured(): boolean {
  return isMassiveStocksRealtimeConfigured();
}

function getDesiredSymbols(): string[] {
  return Array.from(
    new Set(
      Array.from(subscribers.values()).flatMap((subscriber) =>
        Array.from(subscriber.symbols),
      ),
    ),
  ).sort();
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readEventTimestamp(record: Record<string, unknown>): Date {
  return (
    toDate(
      readNumber(record, [
        "sip_timestamp",
        "participant_timestamp",
        "trf_timestamp",
        "t",
        "timestamp",
      ]),
    ) ?? new Date()
  );
}

function quoteFromState(state: QuoteState): MassiveStockQuote | null {
  const bid = state.bid ?? 0;
  const ask = state.ask ?? 0;
  const midpoint = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
  const price = state.last ?? midpoint ?? (bid > 0 ? bid : ask > 0 ? ask : 0);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const now = Date.now();
  return {
    symbol: state.symbol,
    price,
    last: state.last,
    mark: midpoint ?? price,
    bid,
    ask: ask || bid,
    bidSize: state.bidSize ?? 0,
    askSize: state.askSize ?? 0,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: state.volume,
    openInterest: null,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    updatedAt: state.updatedAt,
    providerContractId: null,
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: state.updatedAt,
    ageMs: Math.max(0, now - state.updatedAt.getTime()),
    cacheAgeMs: null,
    latency: null,
    source: "massive",
  };
}

function getCurrentPayload(symbols: string[]): QuoteSnapshotPayload {
  return {
    quotes: Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)))
      .flatMap((symbol) => {
        const state = quoteCacheBySymbol.get(symbol);
        const quote = state ? quoteFromState(state) : null;
        return quote ? [quote] : [];
      }),
  };
}

export function getCurrentMassiveStockQuoteSnapshots(
  symbols: string[],
): MassiveStockQuote[] {
  return getCurrentPayload(symbols).quotes;
}

function notifySubscribers(symbol: string): void {
  subscribers.forEach((subscriber) => {
    if (!subscriber.symbols.has(symbol)) {
      return;
    }
    const payload = getCurrentPayload(Array.from(subscriber.symbols));
    if (payload.quotes.length) {
      subscriber.onSnapshot(payload);
    }
  });
}

function mergeQuoteState(input: Partial<QuoteState> & { symbol: string }): void {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return;
  }
  const existing = quoteCacheBySymbol.get(symbol);
  quoteCacheBySymbol.set(symbol, {
    symbol,
    last: input.last ?? existing?.last ?? null,
    bid: input.bid ?? existing?.bid ?? null,
    ask: input.ask ?? existing?.ask ?? null,
    bidSize: input.bidSize ?? existing?.bidSize ?? null,
    askSize: input.askSize ?? existing?.askSize ?? null,
    volume: input.volume ?? existing?.volume ?? null,
    updatedAt: input.updatedAt ?? existing?.updatedAt ?? new Date(),
  });
  eventCount += 1;
  notifySubscribers(symbol);
}

function handleWebSocketMessage(message: unknown): void {
  const record = asRecord(message);
  if (!record) {
    return;
  }
  const eventType = readString(record, ["ev", "eventType"]);
  const symbol = normalizeSymbol(readString(record, ["sym", "symbol"]) ?? "");
  if (!eventType || !symbol) {
    return;
  }
  const updatedAt = readEventTimestamp(record);
  if (eventType === "Q") {
    mergeQuoteState({
      symbol,
      bid: readNumber(record, ["bp", "bid", "bidPrice"]),
      ask: readNumber(record, ["ap", "ask", "askPrice"]),
      bidSize: readNumber(record, ["bs", "bidSize"]),
      askSize: readNumber(record, ["as", "askSize"]),
      updatedAt,
    });
    return;
  }
  if (eventType === "T") {
    mergeQuoteState({
      symbol,
      last: readNumber(record, ["p", "price"]),
      volume: readNumber(record, ["s", "size"]),
      updatedAt,
    });
  }
}

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function closeTransport(): void {
  transportUnsubscribe?.();
  transportUnsubscribe = null;
  subscriptionSignature = "";
}

function refreshTransport(): void {
  clearRefreshTimer();
  const symbols = getDesiredSymbols();
  const signature = symbols.join(",");
  if (!symbols.length || !isMassiveStockQuoteStreamConfigured()) {
    closeTransport();
    return;
  }
  if (signature === subscriptionSignature) {
    return;
  }
  closeTransport();

  transportUnsubscribe = subscribeMassiveStockWebSocket({
    channels: ["Q", "T"],
    symbols,
    onMessage: handleWebSocketMessage,
  });
  subscriptionSignature = signature;
}

function scheduleRefresh(): void {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshTransport();
  }, REFRESH_DEBOUNCE_MS);
  refreshTimer.unref?.();
}

export function subscribeMassiveStockQuoteSnapshots(
  symbols: string[],
  onSnapshot: (payload: QuoteSnapshotPayload) => void,
): () => void {
  const normalizedSymbols = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  if (!normalizedSymbols.size || !isMassiveStockQuoteStreamConfigured()) {
    return () => {};
  }
  const subscriberId = nextSubscriberId++;
  subscribers.set(subscriberId, {
    id: subscriberId,
    symbols: normalizedSymbols,
    onSnapshot,
  });

  const cachedPayload = getCurrentPayload(Array.from(normalizedSymbols));
  if (cachedPayload.quotes.length) {
    onSnapshot(cachedPayload);
  }
  scheduleRefresh();

  return () => {
    subscribers.delete(subscriberId);
    scheduleRefresh();
  };
}

export function getMassiveStockQuoteStreamDiagnostics() {
  const diagnostics = getMassiveStockWebSocketDiagnostics(["Q", "T"]);
  return {
    ...diagnostics,
    configured: isMassiveStockQuoteStreamConfigured(),
    activeConsumerCount: subscribers.size,
    cachedQuoteCount: quoteCacheBySymbol.size,
    eventCount,
  };
}

export const __massiveStockQuoteStreamInternalsForTests = {
  handleWebSocketMessage,
  reset() {
    closeTransport();
    clearRefreshTimer();
    subscribers.clear();
    quoteCacheBySymbol.clear();
    nextSubscriberId = 1;
    eventCount = 0;
    __massiveStockWebSocketInternalsForTests.reset();
  },
};

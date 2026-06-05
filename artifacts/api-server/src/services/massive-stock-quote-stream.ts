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
import { enrichStockQuoteWithDayChangeContext } from "./stock-quote-day-change-context";

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
const SNAPSHOT_NOTIFY_FLUSH_MS = 100;

let nextSubscriberId = 1;
let subscriptionSignature = "";
let refreshTimer: NodeJS.Timeout | null = null;
let snapshotNotifyTimer: NodeJS.Timeout | null = null;
let transportUnsubscribe: (() => void) | null = null;
let eventCount = 0;
const pendingSnapshotSymbols = new Set<string>();

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
  const quote: MassiveStockQuote = {
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
  return enrichStockQuoteWithDayChangeContext(quote);
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

function clearSnapshotNotifyTimer(): void {
  if (snapshotNotifyTimer) {
    clearTimeout(snapshotNotifyTimer);
    snapshotNotifyTimer = null;
  }
}

function flushSnapshotNotifications(): void {
  clearSnapshotNotifyTimer();
  const symbols = Array.from(pendingSnapshotSymbols);
  pendingSnapshotSymbols.clear();
  if (!symbols.length) {
    return;
  }

  subscribers.forEach((subscriber) => {
    const matchedSymbols = symbols.filter((symbol) => subscriber.symbols.has(symbol));
    if (!matchedSymbols.length) {
      return;
    }
    const payload = getCurrentPayload(matchedSymbols);
    if (payload.quotes.length) {
      subscriber.onSnapshot(payload);
    }
  });
}

function scheduleSnapshotNotification(symbol: string): void {
  if (!subscribers.size) {
    return;
  }
  pendingSnapshotSymbols.add(symbol);
  if (snapshotNotifyTimer) {
    return;
  }
  snapshotNotifyTimer = setTimeout(
    flushSnapshotNotifications,
    SNAPSHOT_NOTIFY_FLUSH_MS,
  );
  snapshotNotifyTimer.unref?.();
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
  scheduleSnapshotNotification(symbol);
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
    if (!subscribers.size) {
      pendingSnapshotSymbols.clear();
      clearSnapshotNotifyTimer();
    }
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
    pendingSnapshotSymbolCount: pendingSnapshotSymbols.size,
    eventCount,
  };
}

export const __massiveStockQuoteStreamInternalsForTests = {
  handleWebSocketMessage,
  flushSnapshotNotifications,
  reset() {
    closeTransport();
    clearRefreshTimer();
    clearSnapshotNotifyTimer();
    subscribers.clear();
    quoteCacheBySymbol.clear();
    pendingSnapshotSymbols.clear();
    nextSubscriberId = 1;
    eventCount = 0;
    __massiveStockWebSocketInternalsForTests.reset();
  },
};

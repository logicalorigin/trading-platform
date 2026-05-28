import { WebSocket } from "ws";
import { logger } from "../lib/logger";
import {
  getPolygonRuntimeConfig,
  isMassiveStocksRealtimeConfigured,
} from "../lib/runtime";
import {
  asNumber,
  asRecord,
  asString,
  normalizeSymbol,
  toDate,
} from "../lib/values";
import type { QuoteSnapshot } from "../providers/ibkr/client";

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
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 150;

let nextSubscriberId = 1;
let socket: WebSocket | null = null;
let subscriptionSignature = "";
let refreshTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let authState: "idle" | "authenticating" | "authenticated" | "failed" = "idle";
let lastError: string | null = null;
let lastErrorAt: Date | null = null;
let lastOpenAt: Date | null = null;
let lastMessageAt: Date | null = null;
let reconnectCount = 0;
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
  lastMessageAt = new Date();
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

function send(value: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

function recordSocketError(error: unknown, message: string): void {
  lastError = error instanceof Error ? error.message : String(error);
  lastErrorAt = new Date();
  logger.warn({ err: error }, message);
}

function closeSocket(nextAuthState: typeof authState = "idle"): void {
  const currentSocket = socket;
  if (currentSocket) {
    socket = null;
    currentSocket.removeAllListeners();
    currentSocket.on("error", (error) => {
      recordSocketError(error, "Massive stock WebSocket failed while closing");
    });
    if (currentSocket.readyState === WebSocket.CONNECTING) {
      currentSocket.terminate();
    } else if (currentSocket.readyState === WebSocket.OPEN) {
      currentSocket.close();
    }
  }
  authState = nextAuthState;
  subscriptionSignature = "";
}

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function subscribeSocketSymbols(symbols: string[]): void {
  const signature = symbols.join(",");
  if (!socket || authState !== "authenticated" || signature === subscriptionSignature) {
    return;
  }
  if (subscriptionSignature) {
    const previousParams = subscriptionSignature
      .split(",")
      .filter(Boolean)
      .flatMap((symbol) => [`Q.${symbol}`, `T.${symbol}`])
      .join(",");
    send({ action: "unsubscribe", params: previousParams });
  }
  subscriptionSignature = signature;
  if (symbols.length) {
    const params = symbols
      .flatMap((symbol) => [`Q.${symbol}`, `T.${symbol}`])
      .join(",");
    send({ action: "subscribe", params });
  }
}

function refreshSocket(): void {
  clearRefreshTimer();
  const symbols = getDesiredSymbols();
  if (!symbols.length || !isMassiveStockQuoteStreamConfigured()) {
    closeSocket();
    return;
  }

  const config = getPolygonRuntimeConfig();
  if (!config) {
    closeSocket();
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    subscribeSocketSymbols(symbols);
    return;
  }
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    return;
  }

  closeSocket();
  authState = "authenticating";
  socket = new WebSocket("wss://socket.massive.com/stocks");

  socket.on("open", () => {
    lastOpenAt = new Date();
    lastError = null;
    lastErrorAt = null;
    send({ action: "auth", params: config.apiKey });
  });

  socket.on("message", (raw) => {
    lastMessageAt = new Date();
    let messages: unknown[];
    try {
      const parsed = JSON.parse(raw.toString());
      messages = Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      logger.debug({ err: error }, "Massive stock WebSocket payload parse failed");
      return;
    }

    messages.forEach((message) => {
      const record = asRecord(message);
      if (record) {
        const status = readString(record, ["status"]);
        const authMessage = readString(record, ["message"]);
        if (status === "auth_success") {
          authState = "authenticated";
          reconnectAttempt = 0;
          subscribeSocketSymbols(getDesiredSymbols());
          return;
        }
        if (status === "auth_failed") {
          lastError = authMessage ?? "Massive stock WebSocket authentication failed.";
          lastErrorAt = new Date();
          closeSocket("failed");
          return;
        }
      }
      handleWebSocketMessage(message);
    });
  });

  socket.on("close", () => {
    socket = null;
    subscriptionSignature = "";
    if (subscribers.size > 0 && authState !== "failed") {
      scheduleReconnect();
    }
  });

  socket.on("error", (error) => {
    recordSocketError(error, "Massive stock WebSocket failed");
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer || subscribers.size === 0) {
    return;
  }
  reconnectCount += 1;
  const delayMs = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_MIN_MS * 2 ** reconnectAttempt,
  );
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    refreshSocket();
  }, delayMs);
  reconnectTimer.unref?.();
}

function scheduleRefresh(): void {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshSocket();
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
  const now = Date.now();
  const subscribedSymbolCount = subscriptionSignature
    ? subscriptionSignature.split(",").filter(Boolean).length
    : 0;
  return {
    configured: isMassiveStockQuoteStreamConfigured(),
    providerIdentity: "massive",
    mode: "real-time",
    socketHost: "socket.massive.com",
    availableChannels: ["Q", "T"],
    subscribedChannels: subscribedSymbolCount > 0 ? ["Q", "T"] : [],
    authState,
    connected: socket?.readyState === WebSocket.OPEN,
    subscribedSymbolCount,
    subscriptionCount: subscribedSymbolCount * 2,
    activeConsumerCount: subscribers.size,
    cachedQuoteCount: quoteCacheBySymbol.size,
    reconnectCount,
    eventCount,
    lastOpenAt: lastOpenAt?.toISOString() ?? null,
    lastMessageAt: lastMessageAt?.toISOString() ?? null,
    lastMessageAgeMs: lastMessageAt ? Math.max(0, now - lastMessageAt.getTime()) : null,
    lastError,
    lastErrorAt: lastErrorAt?.toISOString() ?? null,
  };
}

export const __massiveStockQuoteStreamInternalsForTests = {
  handleWebSocketMessage,
  reset() {
    closeSocket();
    clearRefreshTimer();
    clearReconnectTimer();
    subscribers.clear();
    quoteCacheBySymbol.clear();
    nextSubscriberId = 1;
    reconnectAttempt = 0;
    reconnectCount = 0;
    eventCount = 0;
    authState = "idle";
    lastError = null;
    lastErrorAt = null;
    lastOpenAt = null;
    lastMessageAt = null;
  },
};

import { WebSocket } from "ws";
import { logger } from "../lib/logger";
import { getPolygonRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";

export type PolygonDelayedStockAggregate = {
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
  source: "polygon-delayed-websocket";
};

type Subscriber = {
  id: number;
  symbols: Set<string>;
  onAggregate: (message: PolygonDelayedStockAggregate) => void;
};

const subscribers = new Map<number, Subscriber>();
const aggregateCache = new Map<string, PolygonDelayedStockAggregate>();
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

function getDesiredSymbols(): string[] {
  return Array.from(
    new Set(
      Array.from(subscribers.values()).flatMap((subscriber) =>
        Array.from(subscriber.symbols),
      ),
    ),
  ).sort();
}

function polygonDelayedStocksUrl(): string | null {
  const config = getPolygonRuntimeConfig();
  if (!config) {
    return null;
  }
  if (config.baseUrl.includes("massive.com")) {
    return "wss://delayed.massive.com/stocks";
  }
  return "wss://delayed.polygon.io/stocks";
}

export function isPolygonDelayedWebSocketConfigured(): boolean {
  return Boolean(getPolygonRuntimeConfig() && polygonDelayedStocksUrl());
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function mapAggregate(value: unknown): PolygonDelayedStockAggregate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const eventType = readString(record, ["ev", "eventType"]) ?? "";
  if (eventType !== "AM") {
    return null;
  }
  const symbol = normalizeSymbol(readString(record, ["sym", "symbol"]) ?? "");
  const open = readNumber(record, ["o", "open"]);
  const high = readNumber(record, ["h", "high"]);
  const low = readNumber(record, ["l", "low"]);
  const close = readNumber(record, ["c", "close"]);
  const volume = readNumber(record, ["v", "volume"]);
  const startMs = readNumber(record, ["s", "startMs"]);
  const endMs = readNumber(record, ["e", "endMs"]);
  if (
    !symbol ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    startMs === null ||
    endMs === null
  ) {
    return null;
  }

  return {
    eventType,
    symbol,
    open,
    high,
    low,
    close,
    volume,
    accumulatedVolume: readNumber(record, ["av", "accumulatedVolume"]),
    vwap: readNumber(record, ["vw", "vwap"]),
    sessionVwap: readNumber(record, ["a", "sessionVwap"]),
    officialOpen: open,
    averageTradeSize: readNumber(record, ["z", "averageTradeSize"]),
    startMs,
    endMs,
    delayed: true,
    source: "polygon-delayed-websocket",
  };
}

function send(value: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(value));
  }
}

function closeSocket(nextAuthState: typeof authState = "idle"): void {
  if (socket) {
    socket.removeAllListeners();
    socket.close();
    socket = null;
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

function broadcast(message: PolygonDelayedStockAggregate): void {
  eventCount += 1;
  lastMessageAt = new Date();
  aggregateCache.set(message.symbol, message);
  subscribers.forEach((subscriber) => {
    if (subscriber.symbols.has(message.symbol)) {
      subscriber.onAggregate(message);
    }
  });
}

function subscribeSocketSymbols(symbols: string[]): void {
  const signature = symbols.join(",");
  if (!socket || authState !== "authenticated" || signature === subscriptionSignature) {
    return;
  }
  if (subscriptionSignature) {
    send({
      action: "unsubscribe",
      params: subscriptionSignature
        .split(",")
        .filter(Boolean)
        .map((symbol) => `AM.${symbol}`)
        .join(","),
    });
  }
  subscriptionSignature = signature;
  if (symbols.length) {
    send({
      action: "subscribe",
      params: symbols.map((symbol) => `AM.${symbol}`).join(","),
    });
  }
}

function refreshSocket(): void {
  clearRefreshTimer();
  const symbols = getDesiredSymbols();
  if (!symbols.length) {
    closeSocket();
    return;
  }

  const config = getPolygonRuntimeConfig();
  const url = polygonDelayedStocksUrl();
  if (!config || !url) {
    closeSocket();
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    subscribeSocketSymbols(symbols);
    return;
  }

  closeSocket();
  authState = "authenticating";
  socket = new WebSocket(url);

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
      logger.debug({ err: error }, "Polygon delayed WebSocket payload parse failed");
      return;
    }

    messages.forEach((message) => {
      if (message && typeof message === "object" && !Array.isArray(message)) {
        const record = message as Record<string, unknown>;
        const status = readString(record, ["status"]);
        const authMessage = readString(record, ["message"]);
        if (status === "auth_success") {
          authState = "authenticated";
          reconnectAttempt = 0;
          subscribeSocketSymbols(getDesiredSymbols());
          return;
        }
        if (status === "auth_failed") {
          lastError = authMessage ?? "Polygon delayed WebSocket authentication failed.";
          lastErrorAt = new Date();
          closeSocket("failed");
          return;
        }
      }

      const aggregate = mapAggregate(message);
      if (aggregate) {
        broadcast(aggregate);
      }
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
    lastError = error instanceof Error ? error.message : String(error);
    lastErrorAt = new Date();
    logger.warn({ err: error }, "Polygon delayed WebSocket failed");
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

export function getCurrentPolygonStockMinuteAggregates(
  symbols: string[],
): PolygonDelayedStockAggregate[] {
  return Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)))
    .flatMap((symbol) => {
      const aggregate = aggregateCache.get(symbol);
      return aggregate ? [aggregate] : [];
    });
}

export function subscribePolygonStockMinuteAggregates(
  symbols: string[],
  onAggregate: (message: PolygonDelayedStockAggregate) => void,
): () => void {
  const normalizedSymbols = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  if (!normalizedSymbols.size || !isPolygonDelayedWebSocketConfigured()) {
    return () => {};
  }

  const subscriberId = nextSubscriberId++;
  subscribers.set(subscriberId, {
    id: subscriberId,
    symbols: normalizedSymbols,
    onAggregate,
  });
  scheduleRefresh();

  return () => {
    subscribers.delete(subscriberId);
    scheduleRefresh();
  };
}

export function getPolygonDelayedWebSocketDiagnostics() {
  const now = Date.now();
  return {
    configured: isPolygonDelayedWebSocketConfigured(),
    authState,
    connected: socket?.readyState === WebSocket.OPEN,
    subscribedSymbolCount: subscriptionSignature
      ? subscriptionSignature.split(",").filter(Boolean).length
      : 0,
    activeConsumerCount: subscribers.size,
    reconnectCount,
    eventCount,
    lastOpenAt: lastOpenAt?.toISOString() ?? null,
    lastMessageAt: lastMessageAt?.toISOString() ?? null,
    lastMessageAgeMs: lastMessageAt ? Math.max(0, now - lastMessageAt.getTime()) : null,
    lastError,
    lastErrorAt: lastErrorAt?.toISOString() ?? null,
  };
}

export function __resetPolygonDelayedWebSocketForTests(): void {
  closeSocket();
  clearRefreshTimer();
  clearReconnectTimer();
  subscribers.clear();
  aggregateCache.clear();
  nextSubscriberId = 1;
  reconnectAttempt = 0;
  reconnectCount = 0;
  eventCount = 0;
  authState = "idle";
  lastError = null;
  lastErrorAt = null;
  lastOpenAt = null;
  lastMessageAt = null;
}

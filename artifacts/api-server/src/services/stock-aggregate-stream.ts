import {
  websocketClient,
  type IAggregateStockEvent,
  type IWebsocketClient,
} from "@massive.com/client-js";
import { logger } from "../lib/logger";
import { getPolygonRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";

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
  delayed: true;
  source: "massive-delayed-websocket";
};

type Subscriber = {
  id: number;
  symbols: Set<string>;
  onAggregate: (message: StockMinuteAggregateMessage) => void;
};

const DELAYED_MASSIVE_SOCKET_URL = "wss://delayed.massive.com";
const STOCK_MINUTE_CHANNEL_PREFIX = "AM.";
const OPEN_READY_STATE = 1;
const RECONNECT_DELAY_MS = 3_000;

let socket: StockWebsocket | null = null;
let socketReady = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let nextSubscriberId = 1;
const subscribers = new Map<number, Subscriber>();
let subscribedSymbols = new Set<string>();
type StockWebsocket = ReturnType<IWebsocketClient["stocks"]>;

function getMassiveRuntimeConfig() {
  const config = getPolygonRuntimeConfig();

  if (!config || !config.baseUrl.includes("massive.com")) {
    return null;
  }

  return config;
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function getDesiredSymbols(): Set<string> {
  return new Set(
    Array.from(subscribers.values()).flatMap((subscriber) => Array.from(subscriber.symbols)),
  );
}

function normalizeSymbols(symbols: string[]): Set<string> {
  return new Set(
    symbols
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean),
  );
}

function parseSocketMessages(raw: unknown): unknown[] {
  const payload = typeof raw === "string"
    ? raw
    : raw instanceof Buffer
      ? raw.toString("utf8")
      : null;

  if (!payload) {
    return [];
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function mapAggregateMessage(message: IAggregateStockEvent): StockMinuteAggregateMessage {
  return {
    eventType: message.ev,
    symbol: normalizeSymbol(message.sym),
    open: message.o,
    high: message.h,
    low: message.l,
    close: message.c,
    volume: message.v,
    accumulatedVolume: Number.isFinite(message.av) ? message.av : null,
    vwap: Number.isFinite(message.vw) ? message.vw : null,
    sessionVwap: Number.isFinite(message.a) ? message.a : null,
    officialOpen: Number.isFinite(message.op) ? message.op : null,
    averageTradeSize: Number.isFinite(message.z) ? message.z : null,
    startMs: message.s,
    endMs: message.e,
    delayed: true,
    source: "massive-delayed-websocket",
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

function syncSubscriptions() {
  if (!socket || socket.readyState !== OPEN_READY_STATE || !socketReady) {
    return;
  }

  const desiredSymbols = getDesiredSymbols();
  const symbolsToAdd = Array.from(desiredSymbols).filter((symbol) => !subscribedSymbols.has(symbol));
  const symbolsToRemove = Array.from(subscribedSymbols).filter((symbol) => !desiredSymbols.has(symbol));

  if (symbolsToAdd.length) {
    socket.send(JSON.stringify({
      action: "subscribe",
      params: symbolsToAdd.map((symbol) => `${STOCK_MINUTE_CHANNEL_PREFIX}${symbol}`).join(","),
    }));
    symbolsToAdd.forEach((symbol) => subscribedSymbols.add(symbol));
  }

  if (symbolsToRemove.length) {
    socket.send(JSON.stringify({
      action: "unsubscribe",
      params: symbolsToRemove.map((symbol) => `${STOCK_MINUTE_CHANNEL_PREFIX}${symbol}`).join(","),
    }));
    symbolsToRemove.forEach((symbol) => subscribedSymbols.delete(symbol));
  }

  if (!desiredSymbols.size) {
    socket.close();
  }
}

function cleanupSocket() {
  socket = null;
  socketReady = false;
  subscribedSymbols = new Set<string>();
}

function scheduleReconnect() {
  if (reconnectTimer || subscribers.size === 0 || !getMassiveRuntimeConfig()) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureSocket();
  }, RECONNECT_DELAY_MS);
}

function ensureSocket() {
  const config = getMassiveRuntimeConfig();

  if (!config || subscribers.size === 0 || socket) {
    return;
  }

  const upstream: StockWebsocket = websocketClient(
    config.apiKey,
    DELAYED_MASSIVE_SOCKET_URL,
  ).stocks();
  const sdkOnOpen = upstream.onopen;

  upstream.onopen = (event: unknown) => {
    sdkOnOpen?.(event);
    clearReconnectTimer();
    socketReady = false;
    subscribedSymbols = new Set<string>();
    logger.info({ subscribers: subscribers.size }, "Connected Massive delayed stock aggregate stream");
  };

  upstream.onmessage = (event: { data?: unknown; response?: unknown }) => {
    const messages = parseSocketMessages(event?.data ?? event?.response);

    messages.forEach((message) => {
      const record = message as Partial<IAggregateStockEvent> & {
        ev?: string;
        status?: string;
        message?: string;
      };

      if (record.ev === "status") {
        if (record.status === "auth_success" || record.message?.toLowerCase?.().includes("authenticated")) {
          socketReady = true;
          syncSubscriptions();
        }
        return;
      }

      if (record.ev === "AM" && typeof record.sym === "string") {
        socketReady = true;
        broadcastAggregate(mapAggregateMessage(record as IAggregateStockEvent));
      }
    });
  };

  upstream.onerror = (error: unknown) => {
    logger.warn({ err: error }, "Massive delayed stock aggregate stream error");
  };

  upstream.onclose = (event: { code?: number; reason?: string }) => {
    logger.warn(
      {
        code: event.code,
        reason: event.reason,
        subscribers: subscribers.size,
      },
      "Massive delayed stock aggregate stream closed",
    );
    cleanupSocket();
    scheduleReconnect();
  };

  socket = upstream;
}

export function isStockAggregateStreamingAvailable(): boolean {
  return Boolean(getMassiveRuntimeConfig());
}

export function subscribeStockMinuteAggregates(
  symbols: string[],
  onAggregate: (message: StockMinuteAggregateMessage) => void,
): () => void {
  const normalizedSymbols = normalizeSymbols(symbols);
  const subscriberId = nextSubscriberId;
  nextSubscriberId += 1;

  subscribers.set(subscriberId, {
    id: subscriberId,
    symbols: normalizedSymbols,
    onAggregate,
  });

  ensureSocket();
  syncSubscriptions();

  return () => {
    subscribers.delete(subscriberId);
    syncSubscriptions();

    if (subscribers.size === 0) {
      clearReconnectTimer();
      if (socket) {
        socket.close();
      }
      cleanupSocket();
    }
  };
}

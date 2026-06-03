import { WebSocket } from "ws";
import { logger } from "../lib/logger";
import {
  getMassiveProviderIdentity,
  getMassiveRuntimeConfig,
  isMassiveStocksRealtimeConfigured,
} from "../lib/runtime";
import { asRecord, asString, normalizeSymbol } from "../lib/values";

export type MassiveStockWebSocketChannel = "AM" | "Q" | "T";
export type MassiveStockWebSocketMessage = Record<string, unknown>;

type Subscriber = {
  id: number;
  channels: Set<MassiveStockWebSocketChannel>;
  symbols: Set<string>;
  onMessage: (message: MassiveStockWebSocketMessage) => void;
};

type WebSocketLike = {
  readyState: number;
  send(payload: string): void;
  close(): void;
  terminate(): void;
  removeAllListeners(): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (raw: unknown) => void): unknown;
  on(event: "close", listener: (code?: unknown, reason?: unknown) => void): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

type WebSocketFactory = (url: string) => WebSocketLike;

const CHANNELS: MassiveStockWebSocketChannel[] = ["AM", "Q", "T"];
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 150;

const subscribers = new Map<number, Subscriber>();
const activeSubscriptionParams = new Set<string>();
const eventCountByChannel = new Map<MassiveStockWebSocketChannel, number>();
const lastDataMessageAtByChannel = new Map<
  MassiveStockWebSocketChannel,
  Date
>();

let nextSubscriberId = 1;
let socket: WebSocketLike | null = null;
let socketUrl: string | null = null;
let webSocketFactory: WebSocketFactory = (url) => new WebSocket(url);
let refreshTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let reconnectCount = 0;
let authState: "idle" | "authenticating" | "authenticated" | "failed" =
  "idle";
let lastError: string | null = null;
let lastErrorAt: Date | null = null;
let lastOpenAt: Date | null = null;
let lastSocketMessageAt: Date | null = null;
let lastProviderStatus: string | null = null;
let lastProviderMessage: string | null = null;
let lastProviderStatusAt: Date | null = null;
let lastCloseCode: number | null = null;
let lastCloseReason: string | null = null;
let lastCloseAt: Date | null = null;

function massiveStocksUrl(): string | null {
  const config = getMassiveRuntimeConfig();
  if (!config) {
    return null;
  }
  return isMassiveStocksRealtimeConfigured(config)
    ? "wss://socket.massive.com/stocks"
    : "wss://delayed.massive.com/stocks";
}

export function isMassiveStockWebSocketConfigured(): boolean {
  return Boolean(getMassiveRuntimeConfig() && massiveStocksUrl());
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

function parseParam(param: string): {
  channel: MassiveStockWebSocketChannel;
  symbol: string;
} | null {
  const [channel, symbol] = param.split(".");
  if (
    channel !== "AM" &&
    channel !== "Q" &&
    channel !== "T"
  ) {
    return null;
  }
  const normalizedSymbol = normalizeSymbol(symbol ?? "");
  return normalizedSymbol ? { channel, symbol: normalizedSymbol } : null;
}

function getDesiredParams(): string[] {
  const params = new Set<string>();
  for (const subscriber of subscribers.values()) {
    for (const channel of subscriber.channels) {
      for (const symbol of subscriber.symbols) {
        params.add(`${channel}.${symbol}`);
      }
    }
  }
  return Array.from(params).sort();
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

function closeReasonToString(reason: unknown): string | null {
  if (typeof reason === "string") {
    return reason || null;
  }
  if (Buffer.isBuffer(reason)) {
    const value = reason.toString();
    return value || null;
  }
  if (reason instanceof Uint8Array) {
    const value = Buffer.from(reason).toString();
    return value || null;
  }
  return null;
}

function rawMessageToString(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString();
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString();
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString();
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(
      raw.map((part) =>
        Buffer.isBuffer(part)
          ? part
          : part instanceof ArrayBuffer
            ? Buffer.from(part)
            : part instanceof Uint8Array
              ? Buffer.from(part)
              : Buffer.from(String(part)),
      ),
    ).toString();
  }
  return String(raw);
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
  socketUrl = null;
  activeSubscriptionParams.clear();
  authState = nextAuthState;
}

function subscribeSocketParams(params: string[]): void {
  if (!socket || authState !== "authenticated") {
    return;
  }
  const nextParams = new Set(params);
  const removed = Array.from(activeSubscriptionParams).filter(
    (param) => !nextParams.has(param),
  );
  const added = params.filter((param) => !activeSubscriptionParams.has(param));

  if (removed.length) {
    send({ action: "unsubscribe", params: removed.join(",") });
  }
  if (added.length) {
    send({ action: "subscribe", params: added.join(",") });
  }

  activeSubscriptionParams.clear();
  for (const param of params) {
    activeSubscriptionParams.add(param);
  }
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

function isProviderErrorStatus(status: string): boolean {
  return (
    status === "auth_failed" ||
    status === "max_connections" ||
    status === "error" ||
    status.endsWith("_error") ||
    status.includes("not_authorized")
  );
}

function handleProviderStatus(record: Record<string, unknown>): boolean {
  const status = readString(record, ["status"]);
  if (!status) {
    return false;
  }

  const message = readString(record, ["message"]);
  lastProviderStatus = status;
  lastProviderMessage = message;
  lastProviderStatusAt = new Date();

  if (status === "auth_success") {
    authState = "authenticated";
    reconnectAttempt = 0;
    lastError = null;
    lastErrorAt = null;
    subscribeSocketParams(getDesiredParams());
    return true;
  }

  if (isProviderErrorStatus(status)) {
    lastError = message ?? `Massive stock WebSocket status: ${status}`;
    lastErrorAt = new Date();
  }

  if (status === "auth_failed") {
    closeSocket("failed");
  }

  return true;
}

function dispatchDataMessage(message: unknown, receivedAt: Date): void {
  const record = asRecord(message);
  if (!record) {
    return;
  }
  const channel = readString(record, ["ev", "eventType"]);
  if (channel !== "AM" && channel !== "Q" && channel !== "T") {
    return;
  }
  const symbol = normalizeSymbol(readString(record, ["sym", "symbol"]) ?? "");
  if (!symbol) {
    return;
  }

  eventCountByChannel.set(channel, (eventCountByChannel.get(channel) ?? 0) + 1);
  lastDataMessageAtByChannel.set(channel, receivedAt);
  for (const subscriber of subscribers.values()) {
    if (subscriber.channels.has(channel) && subscriber.symbols.has(symbol)) {
      subscriber.onMessage(record);
    }
  }
}

function handleRawMessage(raw: unknown): void {
  const receivedAt = new Date();
  lastSocketMessageAt = receivedAt;
  let messages: unknown[];
  try {
    const parsed = JSON.parse(rawMessageToString(raw));
    messages = Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    logger.debug({ err: error }, "Massive stock WebSocket payload parse failed");
    return;
  }

  for (const message of messages) {
    const record = asRecord(message);
    if (record && handleProviderStatus(record)) {
      continue;
    }
    dispatchDataMessage(message, receivedAt);
  }
}

function refreshSocket(): void {
  clearRefreshTimer();
  const params = getDesiredParams();
  if (!params.length) {
    closeSocket();
    return;
  }

  const config = getMassiveRuntimeConfig();
  const url = massiveStocksUrl();
  if (!config || !url) {
    closeSocket();
    return;
  }
  if (socket && socketUrl && socketUrl !== url) {
    closeSocket();
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    if (authState === "authenticated") {
      subscribeSocketParams(params);
    }
    return;
  }
  if (socket && socket.readyState === WebSocket.CONNECTING) {
    return;
  }

  closeSocket();
  authState = "authenticating";
  socketUrl = url;
  socket = webSocketFactory(url);

  socket.on("open", () => {
    lastOpenAt = new Date();
    lastError = null;
    lastErrorAt = null;
    send({ action: "auth", params: config.apiKey });
  });

  socket.on("message", handleRawMessage);

  socket.on("close", (code, reason) => {
    socket = null;
    socketUrl = null;
    activeSubscriptionParams.clear();
    lastCloseCode = typeof code === "number" ? code : null;
    lastCloseReason = closeReasonToString(reason);
    lastCloseAt = new Date();
    if (subscribers.size > 0 && authState !== "failed") {
      scheduleReconnect();
    }
  });

  socket.on("error", (error) => {
    recordSocketError(error, "Massive stock WebSocket failed");
  });
}

export function subscribeMassiveStockWebSocket(input: {
  channels: MassiveStockWebSocketChannel[];
  symbols: string[];
  onMessage: (message: MassiveStockWebSocketMessage) => void;
}): () => void {
  const channels = new Set(
    input.channels.filter((channel) => CHANNELS.includes(channel)),
  );
  const symbols = new Set(
    input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  if (!channels.size || !symbols.size || !isMassiveStockWebSocketConfigured()) {
    return () => {};
  }

  const subscriberId = nextSubscriberId++;
  subscribers.set(subscriberId, {
    id: subscriberId,
    channels,
    symbols,
    onMessage: input.onMessage,
  });
  scheduleRefresh();

  return () => {
    subscribers.delete(subscriberId);
    scheduleRefresh();
  };
}

export function getMassiveStockWebSocketDiagnostics(
  channels: MassiveStockWebSocketChannel[] = CHANNELS,
) {
  const now = Date.now();
  const config = getMassiveRuntimeConfig();
  const providerIdentity = getMassiveProviderIdentity(config);
  const url = massiveStocksUrl();
  const mode =
    providerIdentity === "massive" && isMassiveStocksRealtimeConfigured(config)
      ? "real-time"
      : url
        ? "delayed"
        : null;
  const configuredChannels: MassiveStockWebSocketChannel[] =
    mode === "real-time" ? CHANNELS : mode === "delayed" ? ["AM"] : [];
  const channelFilter = new Set(channels);
  const params = Array.from(activeSubscriptionParams)
    .map(parseParam)
    .filter(
      (
        param,
      ): param is {
        channel: MassiveStockWebSocketChannel;
        symbol: string;
      } => Boolean(param && channelFilter.has(param.channel)),
    );
  const subscribedChannels = CHANNELS.filter((channel) =>
    params.some((param) => param.channel === channel),
  );
  const subscribedSymbols = new Set(params.map((param) => param.symbol));
  const activeConsumerCount = Array.from(subscribers.values()).filter(
    (subscriber) =>
      Array.from(subscriber.channels).some((channel) =>
        channelFilter.has(channel),
      ),
  ).length;
  const eventCount = Array.from(channelFilter).reduce(
    (total, channel) => total + (eventCountByChannel.get(channel) ?? 0),
    0,
  );
  const lastDataMessageTimes = Array.from(channelFilter)
    .map((channel) => lastDataMessageAtByChannel.get(channel)?.getTime())
    .filter((value): value is number => Number.isFinite(value));
  const lastDataMessageTime = lastDataMessageTimes.length
    ? Math.max(...lastDataMessageTimes)
    : null;

  return {
    configured: isMassiveStockWebSocketConfigured(),
    providerIdentity,
    mode,
    socketHost: url ? new URL(url).host : null,
    availableChannels: configuredChannels.filter((channel) =>
      channelFilter.has(channel),
    ),
    subscribedChannels,
    subscribedSymbolCount: subscribedSymbols.size,
    subscriptionCount: params.length,
    activeConsumerCount,
    connected: socket?.readyState === WebSocket.OPEN,
    authState,
    reconnectCount,
    eventCount,
    lastOpenAt: lastOpenAt?.toISOString() ?? null,
    lastMessageAt:
      lastDataMessageTime !== null
        ? new Date(lastDataMessageTime).toISOString()
        : null,
    lastMessageAgeMs: lastDataMessageTime !== null
      ? Math.max(0, now - lastDataMessageTime)
      : null,
    lastSocketMessageAt: lastSocketMessageAt?.toISOString() ?? null,
    lastSocketMessageAgeMs: lastSocketMessageAt
      ? Math.max(0, now - lastSocketMessageAt.getTime())
      : null,
    lastProviderStatus,
    lastProviderMessage,
    lastProviderStatusAt: lastProviderStatusAt?.toISOString() ?? null,
    lastCloseCode,
    lastCloseReason,
    lastCloseAt: lastCloseAt?.toISOString() ?? null,
    lastError,
    lastErrorAt: lastErrorAt?.toISOString() ?? null,
  };
}

function resetMassiveStockWebSocketForTests(): void {
  closeSocket();
  clearRefreshTimer();
  clearReconnectTimer();
  subscribers.clear();
  activeSubscriptionParams.clear();
  eventCountByChannel.clear();
  lastDataMessageAtByChannel.clear();
  nextSubscriberId = 1;
  reconnectAttempt = 0;
  reconnectCount = 0;
  authState = "idle";
  lastError = null;
  lastErrorAt = null;
  lastOpenAt = null;
  lastSocketMessageAt = null;
  lastProviderStatus = null;
  lastProviderMessage = null;
  lastProviderStatusAt = null;
  lastCloseCode = null;
  lastCloseReason = null;
  lastCloseAt = null;
  socketUrl = null;
  webSocketFactory = (url) => new WebSocket(url);
}

export const __massiveStockWebSocketInternalsForTests = {
  reset: resetMassiveStockWebSocketForTests,
  refreshNow(): void {
    clearRefreshTimer();
    refreshSocket();
  },
  setWebSocketFactory(factory: WebSocketFactory): void {
    webSocketFactory = factory;
  },
};

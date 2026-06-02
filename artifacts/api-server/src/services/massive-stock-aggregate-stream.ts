import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  __massiveStockWebSocketInternalsForTests,
  getMassiveStockWebSocketDiagnostics,
  isMassiveStockWebSocketConfigured,
  subscribeMassiveStockWebSocket,
} from "./massive-stock-websocket";

export type MassiveDelayedStockAggregate = {
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
  source: "massive-websocket" | "massive-delayed-websocket";
};

type Subscriber = {
  id: number;
  symbols: Set<string>;
  onAggregate: (message: MassiveDelayedStockAggregate) => void;
};

const subscribers = new Map<number, Subscriber>();
const aggregateCache = new Map<string, MassiveDelayedStockAggregate>();
const REFRESH_DEBOUNCE_MS = 150;

let nextSubscriberId = 1;
let subscriptionSignature = "";
let refreshTimer: NodeJS.Timeout | null = null;
let transportUnsubscribe: (() => void) | null = null;
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

export function isMassiveDelayedWebSocketConfigured(): boolean {
  return isMassiveStockWebSocketConfigured();
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

function mapAggregate(value: unknown): MassiveDelayedStockAggregate | null {
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

  const realtimeMassive = isMassiveStocksRealtimeConfigured();
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
    delayed: !realtimeMassive,
    source: realtimeMassive ? "massive-websocket" : "massive-delayed-websocket",
  };
}

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function broadcast(message: MassiveDelayedStockAggregate): void {
  eventCount += 1;
  aggregateCache.set(message.symbol, message);
  subscribers.forEach((subscriber) => {
    if (subscriber.symbols.has(message.symbol)) {
      subscriber.onAggregate(message);
    }
  });
}

function closeTransport(): void {
  transportUnsubscribe?.();
  transportUnsubscribe = null;
  subscriptionSignature = "";
}

function handleTransportMessage(message: Record<string, unknown>): void {
  const aggregate = mapAggregate(message);
  if (aggregate) {
    broadcast(aggregate);
  }
}

function refreshTransport(): void {
  clearRefreshTimer();
  const symbols = getDesiredSymbols();
  const signature = symbols.join(",");
  if (!symbols.length) {
    closeTransport();
    return;
  }
  if (!isMassiveDelayedWebSocketConfigured()) {
    closeTransport();
    return;
  }
  if (signature === subscriptionSignature) {
    return;
  }
  closeTransport();

  transportUnsubscribe = subscribeMassiveStockWebSocket({
    channels: ["AM"],
    symbols,
    onMessage: handleTransportMessage,
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

export function getCurrentMassiveStockMinuteAggregates(
  symbols: string[],
): MassiveDelayedStockAggregate[] {
  return Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)))
    .flatMap((symbol) => {
      const aggregate = aggregateCache.get(symbol);
      return aggregate ? [aggregate] : [];
    });
}

export function subscribeMassiveStockMinuteAggregates(
  symbols: string[],
  onAggregate: (message: MassiveDelayedStockAggregate) => void,
): () => void {
  const normalizedSymbols = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  if (!normalizedSymbols.size || !isMassiveDelayedWebSocketConfigured()) {
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

export function getMassiveDelayedWebSocketDiagnostics() {
  const diagnostics = getMassiveStockWebSocketDiagnostics(["AM"]);
  return {
    ...diagnostics,
    activeConsumerCount: subscribers.size,
    eventCount,
  };
}

export function __resetMassiveDelayedWebSocketForTests(): void {
  closeTransport();
  clearRefreshTimer();
  subscribers.clear();
  aggregateCache.clear();
  nextSubscriberId = 1;
  eventCount = 0;
  __massiveStockWebSocketInternalsForTests.reset();
}

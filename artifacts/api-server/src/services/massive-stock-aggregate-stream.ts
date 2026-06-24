import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  __massiveStockWebSocketInternalsForTests,
  getMassiveStockWebSocketDiagnostics,
  isMassiveStockWebSocketConfigured,
  type MassiveStockWebSocketChannel,
  subscribeMassiveStockWebSocket,
} from "./massive-stock-websocket";
import {
  TradeBarAggregator,
  type TradeMinuteBar,
} from "./massive-stock-trade-bars";

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

// Trade-derived minute bars (Massive "T" channel) backfill the extended-hours
// minutes where the "AM" aggregate channel is silent. We only subscribe to the
// trade firehose outside regular trading hours (AM is complete and the RTH trade
// volume is large), and only emit a trade-derived bar for a minute the AM channel
// did not already cover, so AM stays authoritative.
const TRADE_FLUSH_INTERVAL_MS = 5_000;
// Finalize a trade minute this long after it closes, giving a late AM bar for the
// same minute time to arrive first so we can suppress the duplicate.
const TRADE_FINALIZE_GRACE_MS = 12_000;
const AM_MINUTE_RETENTION = 6;

const tradeAggregator = new TradeBarAggregator();
// Per-symbol set of minute-start timestamps the AM channel has covered, used to
// suppress duplicate trade-derived bars. Pruned to the most recent minutes.
const amMinutesBySymbol = new Map<string, Set<number>>();

let nextSubscriberId = 1;
let subscriptionSignature = "";
let refreshTimer: NodeJS.Timeout | null = null;
let transportUnsubscribe: (() => void) | null = null;
let tradeFlushTimer: NodeJS.Timeout | null = null;
let eventCount = 0;
let tradeBarCount = 0;

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
  // A wire AM bar with close <= 0 is non-physical. Number.isFinite(0) is true, so
  // the null-only guard let a c:0 bar through and it surfaced as a "$0.00" last in
  // the signal-matrix price column. Drop it so latestBarClose keeps the prior good
  // bar. (volume may legitimately be 0 on a quiet minute, so it is not gated here.)
  if (
    !symbol ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    close <= 0 ||
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

// Massive trade timestamps are nanosecond epoch values ("pass nanosecond UTC
// timestamps" per their docs). Normalize ns/µs/ms to milliseconds defensively.
function normalizeTradeTimestampMs(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value >= 1e17) return Math.floor(value / 1e6); // nanoseconds
  if (value >= 1e14) return Math.floor(value / 1e3); // microseconds
  return Math.floor(value); // already milliseconds
}

function mapTrade(
  value: unknown,
): { symbol: string; price: number; size: number; tsMs: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if ((readString(record, ["ev", "eventType"]) ?? "") !== "T") {
    return null;
  }
  const symbol = normalizeSymbol(readString(record, ["sym", "symbol"]) ?? "");
  const price = readNumber(record, ["p", "price"]);
  const size = readNumber(record, ["s", "size"]);
  const rawTs = readNumber(record, ["t", "timestamp"]);
  if (
    !symbol ||
    price === null ||
    price <= 0 ||
    size === null ||
    size <= 0 ||
    rawTs === null
  ) {
    return null;
  }
  const tsMs = normalizeTradeTimestampMs(rawTs);
  return tsMs === null ? null : { symbol, price, size, tsMs };
}

// Trades flow during pre-market, after-hours and the overnight session; during
// regular hours the AM channel is authoritative and the trade firehose is heavy,
// so we skip it. "closed" has no trades.
function isTradeBackfillSession(): boolean {
  const key = resolveUsEquityMarketStatus(new Date()).session.key;
  return key === "pre" || key === "after" || key === "overnight";
}

function recordAmMinute(symbol: string, startMs: number): void {
  let minutes = amMinutesBySymbol.get(symbol);
  if (!minutes) {
    minutes = new Set<number>();
    amMinutesBySymbol.set(symbol, minutes);
  }
  minutes.add(startMs);
  if (minutes.size > AM_MINUTE_RETENTION) {
    const sorted = Array.from(minutes).sort((a, b) => a - b);
    for (const stale of sorted.slice(0, sorted.length - AM_MINUTE_RETENTION)) {
      minutes.delete(stale);
    }
  }
}

function tradeBarToAggregate(bar: TradeMinuteBar): MassiveDelayedStockAggregate {
  const realtimeMassive = isMassiveStocksRealtimeConfigured();
  return {
    eventType: "AM",
    symbol: bar.symbol,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    accumulatedVolume: null,
    vwap: bar.vwap,
    sessionVwap: null,
    officialOpen: bar.open,
    averageTradeSize:
      bar.tradeCount > 0 ? bar.volume / bar.tradeCount : null,
    startMs: bar.startMs,
    endMs: bar.endMs,
    delayed: !realtimeMassive,
    source: realtimeMassive ? "massive-websocket" : "massive-delayed-websocket",
  };
}

function maybeBroadcastTradeBar(bar: TradeMinuteBar): void {
  // AM owns any minute it reported; only fill the gaps.
  if (amMinutesBySymbol.get(bar.symbol)?.has(bar.startMs)) {
    return;
  }
  tradeBarCount += 1;
  broadcast(tradeBarToAggregate(bar));
}

// Periodic tick while subscribed: finalize trailing trade minutes and re-check
// the market session so we (un)subscribe the trade channel across session edges.
function onTradeTick(): void {
  for (const bar of tradeAggregator.flush(Date.now(), TRADE_FINALIZE_GRACE_MS)) {
    maybeBroadcastTradeBar(bar);
  }
  refreshTransport();
}

function startTradeFlushTimer(): void {
  if (tradeFlushTimer) {
    return;
  }
  tradeFlushTimer = setInterval(onTradeTick, TRADE_FLUSH_INTERVAL_MS);
  tradeFlushTimer.unref?.();
}

function stopTradeFlushTimer(): void {
  if (tradeFlushTimer) {
    clearInterval(tradeFlushTimer);
    tradeFlushTimer = null;
  }
}

function clearTradeState(): void {
  tradeAggregator.reset();
  amMinutesBySymbol.clear();
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
  stopTradeFlushTimer();
  clearTradeState();
}

function handleTransportMessage(message: Record<string, unknown>): void {
  const aggregate = mapAggregate(message);
  if (aggregate) {
    recordAmMinute(aggregate.symbol, aggregate.startMs);
    broadcast(aggregate);
    return;
  }
  const trade = mapTrade(message);
  if (trade) {
    const finalized = tradeAggregator.ingest(trade);
    if (finalized) {
      maybeBroadcastTradeBar(finalized);
    }
  }
}

function refreshTransport(): void {
  clearRefreshTimer();
  const symbols = getDesiredSymbols();
  if (!symbols.length) {
    closeTransport();
    return;
  }
  if (!isMassiveDelayedWebSocketConfigured()) {
    closeTransport();
    return;
  }
  // The trade channel is a real-time-only entitlement; the delayed feed serves AM
  // only. Only request trades outside regular hours, where AM is silent.
  const tradeBackfill =
    isMassiveStocksRealtimeConfigured() && isTradeBackfillSession();
  const channels: MassiveStockWebSocketChannel[] = tradeBackfill
    ? ["AM", "T"]
    : ["AM"];
  const signature = `${channels.join("+")}|${symbols.join(",")}`;

  // Keep the tick alive while subscribed so session edges are detected even
  // during RTH (when the trade channel itself is off).
  startTradeFlushTimer();
  if (tradeBackfill) {
    tradeAggregator.retainOnly(symbols);
  } else {
    clearTradeState();
  }

  if (signature === subscriptionSignature) {
    return;
  }
  // Tear down only the transport subscription; keep trade timer/state managed above.
  transportUnsubscribe?.();
  transportUnsubscribe = null;

  transportUnsubscribe = subscribeMassiveStockWebSocket({
    channels,
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
  const diagnostics = getMassiveStockWebSocketDiagnostics(["AM", "T"]);
  return {
    ...diagnostics,
    activeConsumerCount: subscribers.size,
    eventCount,
    tradeBackfillActive: tradeFlushTimer !== null,
    tradeBarCount,
  };
}

export function __resetMassiveDelayedWebSocketForTests(): void {
  closeTransport();
  clearRefreshTimer();
  subscribers.clear();
  aggregateCache.clear();
  nextSubscriberId = 1;
  eventCount = 0;
  tradeBarCount = 0;
  tradeAggregator.reset();
  amMinutesBySymbol.clear();
  __massiveStockWebSocketInternalsForTests.reset();
}

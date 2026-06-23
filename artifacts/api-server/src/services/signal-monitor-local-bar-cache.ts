import { logger } from "../lib/logger";
import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import type { BrokerBarSnapshot } from "../providers/ibkr/client";
import {
  subscribeMassiveStockMinuteAggregates,
  type MassiveDelayedStockAggregate,
} from "./massive-stock-aggregate-stream";
import {
  loadStoredMarketBars,
  persistMarketDataBars,
  type MarketDataStoreTimeframe,
} from "./market-data-store";

export type SignalMonitorLocalBarCacheTimeframe =
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "1h"
  | "1d";

type CachedBar = BrokerBarSnapshot & { symbol: string };
type PendingPersistBar = {
  symbol: string;
  timeframe: MarketDataStoreTimeframe;
  sourceName: string;
  bar: CachedBar;
};

const LOCAL_CACHE_TIMEFRAMES: SignalMonitorLocalBarCacheTimeframe[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
];
const INTRADAY_TIMEFRAMES: Exclude<
  SignalMonitorLocalBarCacheTimeframe,
  "1d"
>[] = ["1m", "2m", "5m", "15m", "1h"];
const TIMEFRAME_MS: Record<SignalMonitorLocalBarCacheTimeframe, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
const DEFAULT_MEMORY_RETENTION_MS = 72 * 60 * 60_000;
const DEFAULT_PERSIST_FLUSH_MS = 1_000;
function storeSourceNames(): string[] {
  const streamSourceName = isMassiveStocksRealtimeConfigured()
    ? "massive-websocket"
    : "massive-delayed-websocket";
  return [streamSourceName, "massive-history"];
}

const minuteBarsBySymbol = new Map<string, Map<number, CachedBar>>();
const trackedSymbols = new Set<string>();
const pendingPersistBars = new Map<string, PendingPersistBar>();
const persistedBarSignatures = new Map<string, string>();

let unsubscribeMassiveAggregates: (() => void) | null = null;
let subscriptionSignature = "";
let persistFlushTimer: NodeJS.Timeout | null = null;
let persistFlushInFlight = false;
let aggregateEventCount = 0;
let persistedBarCount = 0;
let lastAggregateAt: Date | null = null;
let lastPersistAt: Date | null = null;
let lastPersistError: string | null = null;
let lastPersistErrorAt: Date | null = null;

function readPositiveIntegerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  const value = raw == null || raw.trim() === "" ? fallback : Number(raw);
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

function memoryRetentionMs(): number {
  return readPositiveIntegerEnv(
    "PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS",
    DEFAULT_MEMORY_RETENTION_MS,
    60_000,
    30 * 24 * 60 * 60_000,
  );
}

function persistFlushMs(): number {
  return readPositiveIntegerEnv(
    "PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_FLUSH_MS",
    DEFAULT_PERSIST_FLUSH_MS,
    100,
    60_000,
  );
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function isFinitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function aggregateClosedAtMs(aggregate: MassiveDelayedStockAggregate): number {
  const startMs = Number(aggregate.startMs);
  const endMs = Number(aggregate.endMs);
  const expectedEndMs = startMs + TIMEFRAME_MS["1m"];
  if (
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    Math.abs(endMs - expectedEndMs) <= 1
  ) {
    return expectedEndMs;
  }
  return endMs;
}

function aggregateToCachedMinuteBar(
  aggregate: MassiveDelayedStockAggregate,
  observedAt: Date,
): CachedBar | null {
  const symbol = normalizeSymbol(aggregate.symbol).toUpperCase();
  if (
    !symbol ||
    !isFinitePrice(aggregate.open) ||
    !isFinitePrice(aggregate.high) ||
    !isFinitePrice(aggregate.low) ||
    !isFinitePrice(aggregate.close) ||
    !Number.isFinite(aggregate.startMs) ||
    !Number.isFinite(aggregate.endMs)
  ) {
    return null;
  }

  const volume = Number(aggregate.volume);
  const dataUpdatedAt = new Date(aggregateClosedAtMs(aggregate));
  return {
    symbol,
    timestamp: new Date(aggregate.startMs),
    open: aggregate.open,
    high: aggregate.high,
    low: aggregate.low,
    close: aggregate.close,
    volume: Number.isFinite(volume) ? volume : 0,
    bid: null,
    ask: null,
    mid: null,
    quoteAsOf: null,
    source: aggregate.source,
    providerContractId: null,
    outsideRth: true,
    partial: false,
    transport: "massive_websocket",
    delayed: aggregate.delayed,
    freshness: aggregate.delayed ? "delayed" : "live",
    marketDataMode: aggregate.delayed ? "delayed" : "live",
    dataUpdatedAt,
    ageMs: Math.max(0, observedAt.getTime() - dataUpdatedAt.getTime()),
  };
}

function cacheKey(input: {
  symbol: string;
  timeframe: string;
  sourceName: string;
  timestamp: Date;
}): string {
  return [
    input.symbol,
    input.timeframe,
    input.sourceName,
    input.timestamp.getTime(),
  ].join(":");
}

function barSignature(bar: BrokerBarSnapshot): string {
  return [
    bar.open,
    bar.high,
    bar.low,
    bar.close,
    bar.volume,
    dateOrNull(bar.dataUpdatedAt)?.getTime() ?? "",
  ].join(":");
}

function prunePersistedBarSignatures(): void {
  const maxEntries = 100_000;
  if (persistedBarSignatures.size <= maxEntries) {
    return;
  }
  const overflow = persistedBarSignatures.size - maxEntries;
  Array.from(persistedBarSignatures.keys())
    .slice(0, overflow)
    .forEach((key) => persistedBarSignatures.delete(key));
}

function mergeBarsByTimestamp(
  bars: Array<BrokerBarSnapshot | CachedBar>,
  limit: number,
): BrokerBarSnapshot[] {
  const byTimestamp = new Map<number, BrokerBarSnapshot>();
  bars.forEach((bar) => {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) {
      return;
    }
    const existing = byTimestamp.get(timestamp.getTime());
    if (!existing || (existing.delayed && !bar.delayed)) {
      byTimestamp.set(timestamp.getTime(), {
        ...bar,
        timestamp,
      });
    }
  });
  return Array.from(byTimestamp.entries())
    .sort(([left], [right]) => left - right)
    .map(([, bar]) => bar)
    .slice(-Math.max(1, Math.floor(limit || 1)));
}

function storeMinuteBar(bar: CachedBar): void {
  const timestamp = dateOrNull(bar.timestamp);
  if (!timestamp) {
    return;
  }
  const symbolBars = minuteBarsBySymbol.get(bar.symbol) ?? new Map();
  symbolBars.set(timestamp.getTime(), bar);
  minuteBarsBySymbol.set(bar.symbol, symbolBars);

  const retentionBoundary = Date.now() - memoryRetentionMs();
  for (const key of symbolBars.keys()) {
    if (key < retentionBoundary) {
      symbolBars.delete(key);
    }
  }
}

function sourceNameForBar(bar: BrokerBarSnapshot): string {
  return bar.source === "massive-delayed-websocket"
    ? "massive-delayed-websocket"
    : "massive-websocket";
}

function queuePersist(input: {
  symbol: string;
  timeframe: MarketDataStoreTimeframe;
  bar: CachedBar;
}): void {
  const timestamp = dateOrNull(input.bar.timestamp);
  if (!timestamp) {
    return;
  }
  const sourceName = sourceNameForBar(input.bar);
  const key = cacheKey({
    symbol: input.symbol,
    timeframe: input.timeframe,
    sourceName,
    timestamp,
  });
  const signature = barSignature(input.bar);
  if (persistedBarSignatures.get(key) === signature) {
    return;
  }
  pendingPersistBars.set(
    key,
    {
      symbol: input.symbol,
      timeframe: input.timeframe,
      sourceName,
      bar: input.bar,
    },
  );
}

function schedulePersistFlush(): void {
  if (persistFlushTimer) {
    return;
  }
  persistFlushTimer = setTimeout(() => {
    persistFlushTimer = null;
    void flushPendingPersistBars();
  }, persistFlushMs());
  persistFlushTimer.unref?.();
}

function isCompletedBucket(input: {
  bucketStartMs: number;
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  evaluatedAt: Date;
}): boolean {
  return (
    input.bucketStartMs + TIMEFRAME_MS[input.timeframe] <=
    input.evaluatedAt.getTime()
  );
}

function rollupMinuteBars(input: {
  bars: CachedBar[];
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  evaluatedAt: Date;
  limit: number;
  includeProvisional?: boolean;
}): CachedBar[] {
  if (input.timeframe === "1d") {
    return [];
  }
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  const sorted = [...input.bars].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  if (input.timeframe === "1m") {
    return sorted
      .filter((bar) => {
        const timestamp = dateOrNull(bar.timestamp);
        if (!timestamp || timestamp.getTime() > input.evaluatedAt.getTime()) {
          return false;
        }
        return (
          input.includeProvisional ||
          isCompletedBucket({
            bucketStartMs: timestamp.getTime(),
            timeframe: "1m",
            evaluatedAt: input.evaluatedAt,
          })
        );
      })
      .slice(-input.limit);
  }

  const grouped = new Map<number, CachedBar[]>();
  sorted.forEach((bar) => {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) {
      return;
    }
    const bucketStartMs = Math.floor(timestamp.getTime() / timeframeMs) * timeframeMs;
    const group = grouped.get(bucketStartMs) ?? [];
    group.push(bar);
    grouped.set(bucketStartMs, group);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucketStartMs, bars]): CachedBar | null => {
      const complete = isCompletedBucket({
        bucketStartMs,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      });
      const provisional = Boolean(
        input.includeProvisional &&
          bucketStartMs <= input.evaluatedAt.getTime() &&
          !complete &&
          bars.length,
      );
      if (!complete && !provisional) {
        return null;
      }
      const first = bars[0];
      const last = bars.at(-1);
      if (!first || !last) {
        return null;
      }
      const dataUpdatedAt = provisional
        ? input.evaluatedAt
        : new Date(bucketStartMs + timeframeMs);
      const delayed = bars.some((bar) => bar.delayed);
      return {
        ...last,
        symbol: first.symbol,
        timestamp: new Date(bucketStartMs),
        open: first.open,
        high: Math.max(...bars.map((bar) => bar.high)),
        low: Math.min(...bars.map((bar) => bar.low)),
        close: last.close,
        volume: bars.reduce((total, bar) => total + bar.volume, 0),
        partial: provisional,
        delayed,
        freshness: delayed ? "delayed" : "live",
        marketDataMode: delayed ? "delayed" : "live",
        dataUpdatedAt,
        ageMs: Math.max(0, input.evaluatedAt.getTime() - dataUpdatedAt.getTime()),
      };
    })
    .filter((bar): bar is CachedBar => Boolean(bar))
    .slice(-input.limit);
}

function readMemoryBars(input: {
  symbol: string;
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  evaluatedAt: Date;
  limit: number;
  includeProvisional?: boolean;
}): CachedBar[] {
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  const minuteBars = Array.from(minuteBarsBySymbol.get(symbol)?.values() ?? []);
  if (!minuteBars.length) {
    return [];
  }
  return rollupMinuteBars({
    bars: minuteBars,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
    limit: input.limit,
    includeProvisional: input.includeProvisional,
  });
}

async function readStoredBars(input: {
  symbol: string;
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  evaluatedAt: Date;
  limit: number;
}): Promise<BrokerBarSnapshot[]> {
  const results = await Promise.all(
    storeSourceNames().map((sourceName) =>
      loadStoredMarketBars({
        symbol: input.symbol,
        timeframe: input.timeframe,
        limit: input.limit,
        to: input.evaluatedAt,
        assetClass: "equity",
        outsideRth: true,
        source: "trades",
        recentWindowMinutes: 0,
        sourceName,
      }),
    ),
  );
  return mergeBarsByTimestamp(results.flat(), input.limit);
}

async function flushPendingPersistBars(): Promise<void> {
  if (persistFlushInFlight) {
    schedulePersistFlush();
    return;
  }
  const pending = Array.from(pendingPersistBars.values());
  pendingPersistBars.clear();
  if (!pending.length) {
    return;
  }
  persistFlushInFlight = true;
  try {
    const groups = new Map<string, PendingPersistBar[]>();
    pending.forEach((entry) => {
      const key = [entry.symbol, entry.timeframe, entry.sourceName].join(":");
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    });
    for (const group of groups.values()) {
      const first = group[0];
      if (!first) {
        continue;
      }
      const persisted = await persistMarketDataBars({
        request: {
          symbol: first.symbol,
          timeframe: first.timeframe,
          assetClass: "equity",
          outsideRth: true,
          source: "trades",
          recentWindowMinutes: 0,
        },
        sourceName: first.sourceName,
        bars: group.map((entry) => ({
          timestamp: entry.bar.timestamp,
          open: entry.bar.open,
          high: entry.bar.high,
          low: entry.bar.low,
          close: entry.bar.close,
          volume: entry.bar.volume,
        })),
      });
      if (persisted) {
        persistedBarCount += group.length;
        group.forEach((entry) => {
          persistedBarSignatures.set(
            cacheKey({
              symbol: entry.symbol,
              timeframe: entry.timeframe,
              sourceName: entry.sourceName,
              timestamp: entry.bar.timestamp,
            }),
            barSignature(entry.bar),
          );
        });
        prunePersistedBarSignatures();
      }
    }
    lastPersistAt = new Date();
    lastPersistError = null;
    lastPersistErrorAt = null;
  } catch (error) {
    pending.forEach((entry) => {
      pendingPersistBars.set(
        cacheKey({
          symbol: entry.symbol,
          timeframe: entry.timeframe,
          sourceName: entry.sourceName,
          timestamp: entry.bar.timestamp,
        }),
        entry,
      );
    });
    lastPersistError = error instanceof Error ? error.message : String(error);
    lastPersistErrorAt = new Date();
    logger.warn({ err: error }, "Signal monitor local bar cache persist failed");
  } finally {
    persistFlushInFlight = false;
    if (pendingPersistBars.size) {
      schedulePersistFlush();
    }
  }
}

function enqueueRollups(symbol: string, evaluatedAt: Date): void {
  const minuteBars = Array.from(minuteBarsBySymbol.get(symbol)?.values() ?? []);
  if (!minuteBars.length) {
    return;
  }
  INTRADAY_TIMEFRAMES.forEach((timeframe) => {
    const bars = rollupMinuteBars({
      bars: minuteBars,
      timeframe,
      evaluatedAt,
      limit: 3,
    });
    bars.forEach((bar) =>
      queuePersist({
        symbol,
        timeframe,
        bar,
      }),
    );
  });
  schedulePersistFlush();
}

function handleMassiveAggregate(aggregate: MassiveDelayedStockAggregate): void {
  const observedAt = new Date();
  const bar = aggregateToCachedMinuteBar(aggregate, observedAt);
  if (!bar) {
    return;
  }
  aggregateEventCount += 1;
  lastAggregateAt = observedAt;
  storeMinuteBar(bar);
  enqueueRollups(bar.symbol, observedAt);
}

function refreshMassiveSubscription(): void {
  const symbols = Array.from(trackedSymbols).sort();
  const signature = symbols.join(",");
  if (signature === subscriptionSignature) {
    return;
  }
  unsubscribeMassiveAggregates?.();
  unsubscribeMassiveAggregates = null;
  subscriptionSignature = signature;
  if (!symbols.length) {
    return;
  }
  unsubscribeMassiveAggregates = subscribeMassiveStockMinuteAggregates(
    symbols,
    handleMassiveAggregate,
  );
}

export function primeSignalMonitorLocalBarCache(symbols: string[]): void {
  symbols
    .map((symbol) => normalizeSymbol(symbol).toUpperCase())
    .filter(Boolean)
    .forEach((symbol) => trackedSymbols.add(symbol));
  refreshMassiveSubscription();
}

export async function loadSignalMonitorLocalBarCache(input: {
  symbol: string;
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  evaluatedAt: Date;
  limit: number;
  includeProvisional?: boolean;
}): Promise<BrokerBarSnapshot[]> {
  if (!LOCAL_CACHE_TIMEFRAMES.includes(input.timeframe)) {
    return [];
  }
  const memoryBars = readMemoryBars(input);
  if (memoryBars.length >= input.limit) {
    return mergeBarsByTimestamp(memoryBars, input.limit);
  }
  const storedBars = await readStoredBars(input);
  return mergeBarsByTimestamp([...storedBars, ...memoryBars], input.limit);
}

// Memory-only read: NEVER touches the database (no readStoredBars augment), so it
// adds zero DB-pool load even under contention. Returns the rolled-up bars
// currently held in the in-process minute cache for the symbol/timeframe,
// newest-capped to `limit`, ascending. Callers (e.g. the signal-quality KPI
// preview) accept the bounded ~retention-window depth (≈72h) the cache holds in
// exchange for never queueing on the shared pool. Mirrors the memory branch of
// loadSignalMonitorLocalBarCache.
export function readSignalMonitorLocalMemoryBars(input: {
  symbol: string;
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  evaluatedAt: Date;
  limit: number;
  includeProvisional?: boolean;
}): BrokerBarSnapshot[] {
  if (!LOCAL_CACHE_TIMEFRAMES.includes(input.timeframe)) {
    return [];
  }
  return mergeBarsByTimestamp(readMemoryBars(input), input.limit);
}

export function getSignalMonitorLocalBarCacheDiagnostics() {
  const now = Date.now();
  const minuteBarCount = Array.from(minuteBarsBySymbol.values()).reduce(
    (total, bars) => total + bars.size,
    0,
  );
  const lastAggregateAgeMs = lastAggregateAt
    ? Math.max(0, now - lastAggregateAt.getTime())
    : null;
  const lastPersistAgeMs = lastPersistAt
    ? Math.max(0, now - lastPersistAt.getTime())
    : null;

  return {
    active: Boolean(unsubscribeMassiveAggregates),
    subscribedSymbolCount: trackedSymbols.size,
    cachedSymbolCount: minuteBarsBySymbol.size,
    minuteBarCount,
    pendingPersistBarCount: pendingPersistBars.size,
    persistedBarSignatureCount: persistedBarSignatures.size,
    persistFlushInFlight,
    aggregateEventCount,
    persistedBarCount,
    lastAggregateAt: lastAggregateAt?.toISOString() ?? null,
    lastAggregateAgeMs,
    lastPersistAt: lastPersistAt?.toISOString() ?? null,
    lastPersistAgeMs,
    lastPersistError,
    lastPersistErrorAt: lastPersistErrorAt?.toISOString() ?? null,
    memoryRetentionMs: memoryRetentionMs(),
  };
}

export const __signalMonitorLocalBarCacheInternalsForTests = {
  reset(): void {
    unsubscribeMassiveAggregates?.();
    unsubscribeMassiveAggregates = null;
    subscriptionSignature = "";
    trackedSymbols.clear();
    minuteBarsBySymbol.clear();
    pendingPersistBars.clear();
    persistedBarSignatures.clear();
    if (persistFlushTimer) {
      clearTimeout(persistFlushTimer);
      persistFlushTimer = null;
    }
    persistFlushInFlight = false;
    aggregateEventCount = 0;
    persistedBarCount = 0;
    lastAggregateAt = null;
    lastPersistAt = null;
    lastPersistError = null;
    lastPersistErrorAt = null;
  },
  ingest(aggregate: MassiveDelayedStockAggregate): void {
    handleMassiveAggregate(aggregate);
  },
  storeSourceNames,
  readMemoryBars,
};

import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";

import {
  resolvePreviousUsEquitySessionClose,
  resolveUsEquityMarketSession,
} from "@workspace/market-calendar";

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
  loadStoredMarketBarsForSymbols,
  loadStoredMarketBarsForSymbolsSince,
  onBarCacheRowsChanged,
  persistMarketDataBarsMixed,
  type MarketDataStoreBarInput,
  type MarketDataStoreTimeframe,
} from "./market-data-store";
import {
  getApiResourcePressureSnapshot,
  isApiResourcePressureHardBlock,
} from "./resource-pressure";

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
// A Friday 16:00 close to a Tuesday 09:30 open across a Monday holiday is 89.5h,
// so the old 72h retention (chosen "to span a weekend") did NOT span a holiday
// weekend — the memory-only reader (readSignalMonitorLocalMemoryBars, feeding the
// signal-quality KPI preview) returned near-zero prior-session bars on a
// Tuesday-after-holiday open. 120h clears 89.5h with margin. (Cell count is
// bounded separately; this only widens the per-symbol minute retention.)
const DEFAULT_MEMORY_RETENTION_MS = 120 * 60 * 60_000;
const DEFAULT_PERSIST_FLUSH_MS = 5_000;
const MINUTE_BAR_RETENTION_PRUNE_INTERVAL_MS = 5 * 60_000;
// A normal full-universe prefetch is 2,000 symbols * 6 local timeframes * 2
// sources = 24,000 cells. Keep the default above that footprint so the LRU does
// not scan-evict the same universe it just loaded and turn every cycle into a
// cold full read.
const DEFAULT_STORED_BARS_CACHE_MAX_CELLS = 30_000;
// Per-aggregate rollups only emit limit:3 buckets of the largest intraday
// timeframe (1h). The last 3 completed/provisional 1h buckets span at most 3h;
// floored-bucket alignment can pull a bar up to ~1h older into the oldest kept
// bucket, so a 4h window (3h coverage + 1h margin) is the intra-session width
// that reproduces the full-history rollup output. Capping the per-aggregate scan
// keeps it O(recent window) instead of O(retained history). "3 buckets ≤ 4h" only
// holds intra-session, though: right after a weekend/holiday reopen the recent
// buckets straddle the closed gap and live partly in the prior session — see
// rollupScanCutoffMs, which reaches across a genuine gap via the market calendar.
const ROLLUP_RECENT_WINDOW_MS = TIMEFRAME_MS["1h"] * 3 + TIMEFRAME_MS["1h"];
// Background durable reads should yield to foreground/stream DB work during app
// bring-up. Operators can raise this after measuring their DB/cache headroom.
const DEFAULT_STORED_BARS_PREFETCH_CONCURRENCY = 1;
// Bound durable prefetch queries by expected returned rows, not just symbol count.
// The old fixed 32-symbol cap still allowed slow high-limit `bar_cache` chunks;
// size batches from `limit` so each DB read stays around this row budget instead.
const STORED_BARS_PREFETCH_TARGET_ROWS_PER_QUERY = 480;
// Delta reads (rows strictly after a per-symbol high-water mark) return at most a
// few rows per symbol regardless of `limit` — their result size is bounded by the
// high-water filter, not by the per-symbol `limit`. So the row-budget batching
// used for full reads is irrelevant here; batch deltas wide to coalesce many
// symbols into a single pooled connection instead of one acquisition per symbol.
const STORED_BARS_DELTA_SYMBOL_BATCH = 64;
const STORED_BARS_DELTA_READ_LIMIT = 8;
const STORED_BARS_DELTA_SHADOW_SAMPLE_DIVISOR = 16;
type StoredBarsDeltaMode = "off" | "shadow" | "on";
export function storeSourceNames(): string[] {
  const streamSourceName = isMassiveStocksRealtimeConfigured()
    ? "massive-websocket"
    : "massive-delayed-websocket";
  return [streamSourceName, "massive-history"];
}

// Request-scoped prefetch for the per-symbol stored-bar augment (readStoredBars).
// A batch evaluator (the matrix/monitor symbol loop) prefetches all of a batch's
// (timeframe × source × symbol) stored bars in a few set-based queries via
// runWithSignalMonitorStoredBarsPrefetch; readStoredBars then serves from the
// prefetch instead of issuing one pooled connection per (symbol, source). The
// prefetched bars come from loadStoredMarketBarsForSymbols — a proven behavior-equal
// mirror of the per-symbol loadStoredMarketBars — so results are IDENTICAL to the
// un-prefetched path, which remains the fallback for any miss, mismatched
// evaluatedAt/limit, or absent context.
type StoredBarsPrefetch = {
  evaluatedAtMs: number;
  limit: number;
  // timeframe -> sourceName -> normalizedSymbol -> bars
  byTimeframe: Map<string, Map<string, Map<string, BrokerBarSnapshot[]>>>;
};
const storedBarsPrefetchStore = new AsyncLocalStorage<StoredBarsPrefetch>();

type StoredBarsCacheCell = {
  baseKey: string;
  key: string;
  symbol: string;
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  sourceName: string;
  limit: number;
  bars: BrokerBarSnapshot[];
  highWaterMs: number | null;
  pendingMaxStartsAtMs: number | null;
  lastDeltaBucketMs: number | null;
  deltaDue: boolean;
  invalidated: boolean;
  lastAccessMs: number;
};

const storedBarsCrossCycleCache = new Map<string, StoredBarsCacheCell>();
const storedBarsCacheKeysByBase = new Map<string, Set<string>>();
let unsubscribeBarCacheRowsChanged: (() => void) | null = null;
let storedBarsCacheHitCount = 0;
let storedBarsCacheMissCount = 0;
let storedBarsCacheFullReadCount = 0;
let storedBarsCacheDeltaReadCount = 0;
let storedBarsCacheInvalidationCount = 0;
let storedBarsCacheInvalidationEventsCount = 0;
let storedBarsCacheInvalidationFullCount = 0;
let storedBarsCacheInvalidationDeltaDueCount = 0;
let storedBarsCacheEvictionCount = 0;
let storedBarsDeltaReadCount = 0;
let storedBarsDeltaFullReadCount = 0;
let storedBarsDeltaAppliedAppendCount = 0;
let storedBarsDeltaGapFallbackCount = 0;
let storedBarsDeltaShadowCheckCount = 0;
let storedBarsDeltaShadowMismatchCount = 0;
// Prefetch-vs-fallback accounting for readStoredBars. The fallback branch takes one
// pooled connection per source, so its rate gauges whether the per-symbol path is a
// real cost or a structural rarity (audit-flagged "rare but uncounted"). Split by
// reason: no prefetch present vs prefetch present but key-mismatched.
let storedBarsPrefetchHitCount = 0;
let storedBarsPrefetchFallbackCount = 0;
let storedBarsPrefetchFallbackNoPrefetchCount = 0;
let storedBarsPrefetchFallbackMismatchCount = 0;
let storedBarsPrefetchPressureSkipCount = 0;
let lastStoredBarsPrefetchPressureSkippedAt: Date | null = null;

const minuteBarsBySymbol = new Map<string, Map<number, CachedBar>>();
const minuteBarLastPrunedAtMsBySymbol = new Map<string, number>();
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
let lastEnqueueScannedBarCount = 0;
let minuteBarRetentionPruneRunCount = 0;
let lastMinuteBarRetentionPruneScannedBarCount = 0;
let liveAggregatePersistSkipCount = 0;
let lastLiveAggregatePersistSkippedAt: Date | null = null;

type PersistMarketDataBarsMixedFn = typeof persistMarketDataBarsMixed;
let persistMarketDataBarsMixedOverride: PersistMarketDataBarsMixedFn | null = null;
type LoadStoredMarketBarsForSymbolsFn = typeof loadStoredMarketBarsForSymbols;
let loadStoredMarketBarsForSymbolsOverride: LoadStoredMarketBarsForSymbolsFn | null =
  null;
type LoadStoredMarketBarsForSymbolsSinceFn =
  typeof loadStoredMarketBarsForSymbolsSince;
let loadStoredMarketBarsForSymbolsSinceOverride:
  | LoadStoredMarketBarsForSymbolsSinceFn
  | null = null;

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

function minuteBarRetentionBoundaryMs(nowMs: number): number {
  return nowMs - memoryRetentionMs();
}

function minuteBarRetentionPruneSizeLimit(): number {
  return (
    Math.ceil(memoryRetentionMs() / TIMEFRAME_MS["1m"]) +
    Math.ceil(MINUTE_BAR_RETENTION_PRUNE_INTERVAL_MS / TIMEFRAME_MS["1m"])
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

function storedBarsCacheMaxCells(): number {
  return readPositiveIntegerEnv(
    "PYRUS_SIGNAL_MONITOR_STORED_BARS_CACHE_MAX_CELLS",
    DEFAULT_STORED_BARS_CACHE_MAX_CELLS,
    0,
    100_000,
  );
}

function storedBarsDeltaMode(): StoredBarsDeltaMode {
  const mode = process.env["PYRUS_SIGNALS_STORED_BARS_DELTA"]
    ?.trim()
    .toLowerCase();
  return mode === "on" || mode === "shadow" ? mode : "off";
}

function isStoredBarsDeltaShadowSample(key: string): boolean {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash, 31) + key.charCodeAt(index);
  }
  return (hash >>> 0) % STORED_BARS_DELTA_SHADOW_SAMPLE_DIVISOR === 0;
}

function storedBarsPrefetchConcurrency(): number {
  return readPositiveIntegerEnv(
    "PYRUS_SIGNAL_MONITOR_STORED_BARS_PREFETCH_CONCURRENCY",
    DEFAULT_STORED_BARS_PREFETCH_CONCURRENCY,
    1,
    8,
  );
}

function liveAggregatePersistEnabled(): boolean {
  const raw =
    process.env["PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES"];
  return raw === "1" || raw?.trim().toLowerCase() === "true";
}

// Bounded-concurrency map: runs `worker` over `items` with at most `limit`
// invocations in flight at once, preserving per-item results by index. Errors
// from a worker reject the returned promise (after in-flight work settles), so
// callers can fall back to per-item handling instead.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const bound = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index] as T, index);
    }
  }
  await Promise.all(
    Array.from({ length: bound }, () => runWorker()),
  );
  return results;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const normalizedSize = Math.max(1, Math.floor(size || 1));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedSize) {
    chunks.push(items.slice(index, index + normalizedSize));
  }
  return chunks;
}

function storedBarsPrefetchSymbolBatchSize(limit: number): number {
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.ceil(limit) : 1;
  // Floor chosen conservatively (8, not 1): full OHLCV reads carry real per-row
  // parse cost (see market-data-store.ts:505-510), so we cannot batch as wide as
  // deltas, but high-`limit` paths must still coalesce at least 8 symbols/query
  // rather than degrade to one pooled acquisition per symbol. The 480-row budget
  // still shrinks batches below this only for very high limits.
  return Math.max(
    8,
    Math.floor(STORED_BARS_PREFETCH_TARGET_ROWS_PER_QUERY / normalizedLimit),
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

function storedBarsCellBaseKey(input: {
  symbol: string;
  timeframe: string;
  sourceName: string;
}): string {
  return [
    normalizeSymbol(input.symbol),
    input.timeframe,
    input.sourceName,
  ].join("|");
}

function storedBarsCellKey(input: {
  symbol: string;
  timeframe: string;
  sourceName: string;
  limit: number;
}): string {
  return [
    storedBarsCellBaseKey(input),
    Math.max(1, Math.floor(input.limit || 1)),
  ].join("|");
}

function evaluatedBucketMs(
  evaluatedAtMs: number,
  timeframe: SignalMonitorLocalBarCacheTimeframe,
): number {
  const stepMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1m"];
  return Math.floor(evaluatedAtMs / stepMs) * stepMs;
}

function highWaterMsForBars(bars: readonly BrokerBarSnapshot[]): number | null {
  let highWaterMs: number | null = null;
  for (const bar of bars) {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) {
      continue;
    }
    highWaterMs =
      highWaterMs == null
        ? timestamp.getTime()
        : Math.max(highWaterMs, timestamp.getTime());
  }
  return highWaterMs;
}

function barsThroughEvaluatedAt(
  bars: readonly BrokerBarSnapshot[],
  evaluatedAtMs: number,
  limit: number,
): BrokerBarSnapshot[] {
  return bars
    .filter((bar) => {
      const timestamp = dateOrNull(bar.timestamp);
      return Boolean(timestamp && timestamp.getTime() <= evaluatedAtMs);
    })
    .slice(-Math.max(1, Math.floor(limit || 1)));
}

function removeStoredBarsCacheCell(key: string): void {
  const cell = storedBarsCrossCycleCache.get(key);
  if (!cell) {
    return;
  }
  storedBarsCrossCycleCache.delete(key);
  const keys = storedBarsCacheKeysByBase.get(cell.baseKey);
  keys?.delete(key);
  if (keys && !keys.size) {
    storedBarsCacheKeysByBase.delete(cell.baseKey);
  }
}

function rememberStoredBarsCacheCell(cell: StoredBarsCacheCell): void {
  storedBarsCrossCycleCache.set(cell.key, cell);
  const keys = storedBarsCacheKeysByBase.get(cell.baseKey) ?? new Set<string>();
  keys.add(cell.key);
  storedBarsCacheKeysByBase.set(cell.baseKey, keys);
}

function pruneStoredBarsCache(): void {
  const maxCells = storedBarsCacheMaxCells();
  if (maxCells <= 0) {
    const removed = storedBarsCrossCycleCache.size;
    storedBarsCrossCycleCache.clear();
    storedBarsCacheKeysByBase.clear();
    storedBarsCacheEvictionCount += removed;
    return;
  }
  while (storedBarsCrossCycleCache.size > maxCells) {
    let oldestKey: string | null = null;
    let oldestAccessMs = Number.POSITIVE_INFINITY;
    for (const [key, cell] of storedBarsCrossCycleCache) {
      if (cell.lastAccessMs < oldestAccessMs) {
        oldestAccessMs = cell.lastAccessMs;
        oldestKey = key;
      }
    }
    if (!oldestKey) {
      return;
    }
    removeStoredBarsCacheCell(oldestKey);
    storedBarsCacheEvictionCount += 1;
  }
}

function writeStoredBarsCacheCell(input: {
  symbol: string;
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  sourceName: string;
  limit: number;
  bars: BrokerBarSnapshot[];
  evaluatedAtMs: number;
  deltaBucketMs: number | null;
}): StoredBarsCacheCell {
  const symbol = normalizeSymbol(input.symbol);
  const baseKey = storedBarsCellBaseKey({
    symbol,
    timeframe: input.timeframe,
    sourceName: input.sourceName,
  });
  const key = storedBarsCellKey({
    symbol,
    timeframe: input.timeframe,
    sourceName: input.sourceName,
    limit: input.limit,
  });
  const bars = mergeBarsByTimestamp(input.bars, input.limit);
  const cell: StoredBarsCacheCell = {
    baseKey,
    key,
    symbol,
    timeframe: input.timeframe,
    sourceName: input.sourceName,
    limit: Math.max(1, Math.floor(input.limit || 1)),
    bars,
    highWaterMs: highWaterMsForBars(bars),
    pendingMaxStartsAtMs: null,
    lastDeltaBucketMs: input.deltaBucketMs,
    deltaDue: false,
    invalidated: false,
    lastAccessMs: Date.now(),
  };
  removeStoredBarsCacheCell(key);
  rememberStoredBarsCacheCell(cell);
  pruneStoredBarsCache();
  return cell;
}

function updateStoredBarsCacheCellWithDelta(input: {
  cell: StoredBarsCacheCell;
  deltaBars: BrokerBarSnapshot[];
  deltaBucketMs: number;
  evaluatedAtMs: number;
}): StoredBarsCacheCell {
  const bars = mergeBarsByTimestamp(
    [...input.cell.bars, ...input.deltaBars],
    input.cell.limit,
  );
  const highWaterMs = highWaterMsForBars(bars);
  const pendingMaxStartsAtMs =
    input.cell.pendingMaxStartsAtMs != null &&
    (highWaterMs == null || highWaterMs < input.cell.pendingMaxStartsAtMs)
      ? input.cell.pendingMaxStartsAtMs
      : null;
  const cell: StoredBarsCacheCell = {
    ...input.cell,
    bars,
    highWaterMs,
    pendingMaxStartsAtMs,
    lastDeltaBucketMs: input.deltaBucketMs,
    deltaDue:
      pendingMaxStartsAtMs != null &&
      pendingMaxStartsAtMs <= input.evaluatedAtMs,
    invalidated: false,
    lastAccessMs: Date.now(),
  };
  storedBarsCrossCycleCache.set(cell.key, cell);
  return cell;
}

function ensureStoredBarsCacheSubscription(): void {
  if (unsubscribeBarCacheRowsChanged) {
    return;
  }
  unsubscribeBarCacheRowsChanged = onBarCacheRowsChanged((changes) => {
    for (const change of changes) {
      storedBarsCacheInvalidationEventsCount += 1;
      const baseKey = storedBarsCellBaseKey({
        symbol: change.symbol,
        timeframe: change.timeframe,
        sourceName: change.sourceName,
      });
      const keys = storedBarsCacheKeysByBase.get(baseKey);
      if (!keys?.size) {
        continue;
      }
      for (const key of keys) {
        const cell = storedBarsCrossCycleCache.get(key);
        if (!cell) {
          continue;
        }
        storedBarsCacheInvalidationCount += 1;
        if (change.kind === "historical" || cell.highWaterMs == null) {
          storedBarsCacheInvalidationFullCount += 1;
          cell.invalidated = true;
          cell.deltaDue = false;
          cell.pendingMaxStartsAtMs = null;
        } else if (change.maxStartsAtMs > cell.highWaterMs) {
          storedBarsCacheInvalidationDeltaDueCount += 1;
          cell.deltaDue = true;
          cell.pendingMaxStartsAtMs = Math.max(
            cell.pendingMaxStartsAtMs ?? change.maxStartsAtMs,
            change.maxStartsAtMs,
          );
        }
      }
    }
  });
}

function getLoadStoredMarketBarsForSymbols(): LoadStoredMarketBarsForSymbolsFn {
  return loadStoredMarketBarsForSymbolsOverride ?? loadStoredMarketBarsForSymbols;
}

function getLoadStoredMarketBarsForSymbolsSince(): LoadStoredMarketBarsForSymbolsSinceFn {
  return (
    loadStoredMarketBarsForSymbolsSinceOverride ??
    loadStoredMarketBarsForSymbolsSince
  );
}

type StoredBarsPrefetchLoadInput = {
  symbols: string[];
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  limit: number;
  to: Date;
  sourceName: string;
};

function mergeLoadedStoredBars(
  target: Map<string, BrokerBarSnapshot[]>,
  loaded: Map<string, BrokerBarSnapshot[]>,
): void {
  for (const [symbol, bars] of loaded) {
    target.set(symbol, bars);
  }
}

async function loadFullStoredBarsForPrefetch(
  input: StoredBarsPrefetchLoadInput,
): Promise<Map<string, BrokerBarSnapshot[]>> {
  const fullLoader = getLoadStoredMarketBarsForSymbols();
  const result = new Map<string, BrokerBarSnapshot[]>();
  for (const symbols of chunkArray(
    input.symbols,
    storedBarsPrefetchSymbolBatchSize(input.limit),
  )) {
    mergeLoadedStoredBars(
      result,
      await fullLoader({
        symbols,
        timeframe: input.timeframe,
        limit: input.limit,
        to: input.to,
        assetClass: "equity",
        outsideRth: true,
        source: "trades",
        recentWindowMinutes: 0,
        sourceName: input.sourceName,
      }),
    );
  }
  return result;
}

async function loadDeltaStoredBarsForPrefetch(
  input: StoredBarsPrefetchLoadInput & { after: Date },
): Promise<Map<string, BrokerBarSnapshot[]>> {
  const deltaLoader = getLoadStoredMarketBarsForSymbolsSince();
  const result = new Map<string, BrokerBarSnapshot[]>();
  // Deltas batch wide (STORED_BARS_DELTA_SYMBOL_BATCH) rather than by the
  // limit-based full-read budget: their rows are bounded by the high-water filter,
  // not by `limit`. Grouping/order/limit/after semantics of each query are
  // otherwise unchanged — only how many symbols share one query differs.
  for (const symbols of chunkArray(
    input.symbols,
    STORED_BARS_DELTA_SYMBOL_BATCH,
  )) {
    mergeLoadedStoredBars(
      result,
      await deltaLoader({
        symbols,
        timeframe: input.timeframe,
        limit: Math.min(input.limit, STORED_BARS_DELTA_READ_LIMIT),
        to: input.to,
        after: input.after,
        assetClass: "equity",
        outsideRth: true,
        source: "trades",
        recentWindowMinutes: 0,
        sourceName: input.sourceName,
      }),
    );
  }
  return result;
}

function deltaBarsExtendCachedTail(input: {
  cell: StoredBarsCacheCell;
  deltaBars: readonly BrokerBarSnapshot[];
  evaluatedAtMs: number;
}): boolean {
  if (input.cell.highWaterMs == null) {
    return false;
  }
  const stepMs = TIMEFRAME_MS[input.cell.timeframe];
  let expectedMs = input.cell.highWaterMs + stepMs;
  let lastDeltaMs: number | null = null;
  for (const bar of input.deltaBars) {
    const timestamp = dateOrNull(bar.timestamp);
    if (
      !timestamp ||
      timestamp.getTime() !== expectedMs ||
      timestamp.getTime() > input.evaluatedAtMs
    ) {
      return false;
    }
    lastDeltaMs = timestamp.getTime();
    expectedMs += stepMs;
  }
  return !(
    input.cell.pendingMaxStartsAtMs != null &&
    input.cell.pendingMaxStartsAtMs <= input.evaluatedAtMs &&
    lastDeltaMs !== input.cell.pendingMaxStartsAtMs
  );
}

function shouldPruneMinuteBarsForSymbol(
  symbol: string,
  symbolBars: Map<number, CachedBar>,
  nowMs: number,
): boolean {
  const lastPrunedAtMs = minuteBarLastPrunedAtMsBySymbol.get(symbol);
  return (
    lastPrunedAtMs == null ||
    nowMs - lastPrunedAtMs >= MINUTE_BAR_RETENTION_PRUNE_INTERVAL_MS ||
    symbolBars.size > minuteBarRetentionPruneSizeLimit()
  );
}

function pruneMinuteBarsForSymbol(
  symbol: string,
  symbolBars: Map<number, CachedBar>,
  nowMs: number,
): void {
  const retentionBoundary = minuteBarRetentionBoundaryMs(nowMs);
  let scanned = 0;
  for (const key of symbolBars.keys()) {
    scanned += 1;
    if (key < retentionBoundary) {
      symbolBars.delete(key);
    }
  }
  minuteBarRetentionPruneRunCount += 1;
  lastMinuteBarRetentionPruneScannedBarCount = scanned;
  if (symbolBars.size) {
    minuteBarLastPrunedAtMsBySymbol.set(symbol, nowMs);
  } else {
    minuteBarsBySymbol.delete(symbol);
    minuteBarLastPrunedAtMsBySymbol.delete(symbol);
  }
}

function storeMinuteBar(bar: CachedBar): void {
  const timestamp = dateOrNull(bar.timestamp);
  if (!timestamp) {
    return;
  }
  const symbolBars = minuteBarsBySymbol.get(bar.symbol) ?? new Map();
  symbolBars.set(timestamp.getTime(), bar);
  minuteBarsBySymbol.set(bar.symbol, symbolBars);

  const nowMs = Date.now();
  if (shouldPruneMinuteBarsForSymbol(bar.symbol, symbolBars, nowMs)) {
    pruneMinuteBarsForSymbol(bar.symbol, symbolBars, nowMs);
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
  if (!liveAggregatePersistEnabled()) {
    liveAggregatePersistSkipCount += 1;
    lastLiveAggregatePersistSkippedAt = new Date();
    return;
  }
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

function schedulePersistFlush(delayMs = persistFlushMs()): void {
  if (persistFlushTimer) {
    return;
  }
  persistFlushTimer = setTimeout(() => {
    persistFlushTimer = null;
    void flushPendingPersistBars();
  }, delayMs);
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
  const retentionBoundary = minuteBarRetentionBoundaryMs(Date.now());
  const minuteBars = Array.from(
    minuteBarsBySymbol.get(symbol)?.values() ?? [],
  ).filter((bar) => bar.timestamp.getTime() >= retentionBoundary);
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
  const sourceNames = storeSourceNames();
  const prefetch = storedBarsPrefetchStore.getStore();
  if (
    prefetch !== undefined &&
    prefetch.evaluatedAtMs === input.evaluatedAt.getTime() &&
    prefetch.limit === input.limit &&
    prefetch.byTimeframe.has(input.timeframe)
  ) {
    // Serve from the batch prefetch — the set-based read per source is already
    // done, so no pooled connection is taken here.
    const bySource = prefetch.byTimeframe.get(input.timeframe)!;
    const symbol = normalizeSymbol(input.symbol);
    const prefetched = sourceNames.map(
      (sourceName) => bySource.get(sourceName)?.get(symbol) ?? [],
    );
    storedBarsPrefetchHitCount += 1;
    return mergeBarsByTimestamp(prefetched.flat(), input.limit);
  }
  if (getApiResourcePressureSnapshot().level === "high") {
    storedBarsPrefetchPressureSkipCount += 1;
    lastStoredBarsPrefetchPressureSkippedAt = new Date();
    return [];
  }
  storedBarsPrefetchFallbackCount += 1;
  if (prefetch === undefined) {
    storedBarsPrefetchFallbackNoPrefetchCount += 1;
  } else {
    storedBarsPrefetchFallbackMismatchCount += 1;
  }
  // Fallback: per-symbol read (one pooled connection per source). Unchanged from
  // the pre-prefetch behavior, and behavior-equal to the prefetch path above.
  const results = await Promise.all(
    sourceNames.map((sourceName) =>
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

async function loadStoredBarsForSymbolsForShadow(input: {
  symbols: string[];
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  limit: number;
  to: Date;
  sourceName: string;
}): Promise<Map<string, BrokerBarSnapshot[]>> {
  ensureStoredBarsCacheSubscription();
  const evaluatedAtMs = input.to.getTime();
  const deltaBucketMs = evaluatedBucketMs(evaluatedAtMs, input.timeframe);
  const sampledCells = new Map<string, StoredBarsCacheCell>();
  const deltaReadSymbolsByAfter = new Map<number, string[]>();
  for (const rawSymbol of input.symbols) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) {
      continue;
    }
    const key = storedBarsCellKey({
      symbol,
      timeframe: input.timeframe,
      sourceName: input.sourceName,
      limit: input.limit,
    });
    const cell = storedBarsCrossCycleCache.get(key);
    if (!cell || cell.invalidated || !isStoredBarsDeltaShadowSample(key)) {
      continue;
    }
    sampledCells.set(symbol, cell);
    if (
      cell.highWaterMs != null &&
      (cell.deltaDue || (cell.lastDeltaBucketMs ?? -1) < deltaBucketMs) &&
      cell.highWaterMs < evaluatedAtMs
    ) {
      const symbols = deltaReadSymbolsByAfter.get(cell.highWaterMs) ?? [];
      symbols.push(symbol);
      deltaReadSymbolsByAfter.set(cell.highWaterMs, symbols);
    }
  }

  storedBarsCacheFullReadCount += 1;
  storedBarsDeltaFullReadCount += 1;
  const full = await loadFullStoredBarsForPrefetch({
    symbols: input.symbols,
    timeframe: input.timeframe,
    limit: input.limit,
    to: input.to,
    sourceName: input.sourceName,
  });
  const deltaSymbols = new Set(
    Array.from(deltaReadSymbolsByAfter.values()).flat(),
  );
  for (const [symbol, cell] of sampledCells) {
    if (deltaSymbols.has(symbol)) {
      continue;
    }
    storedBarsDeltaShadowCheckCount += 1;
    if (
      !isDeepStrictEqual(
        barsThroughEvaluatedAt(cell.bars, evaluatedAtMs, input.limit),
        full.get(symbol) ?? [],
      )
    ) {
      storedBarsDeltaShadowMismatchCount += 1;
    }
  }

  for (const [afterMs, symbols] of deltaReadSymbolsByAfter) {
    storedBarsCacheDeltaReadCount += 1;
    storedBarsDeltaReadCount += 1;
    const loaded = await loadDeltaStoredBarsForPrefetch({
      symbols,
      timeframe: input.timeframe,
      limit: input.limit,
      to: input.to,
      after: new Date(afterMs),
      sourceName: input.sourceName,
    });
    for (const symbol of symbols) {
      const cell = sampledCells.get(symbol);
      if (!cell) {
        continue;
      }
      const deltaBars = loaded.get(symbol) ?? [];
      if (!deltaBarsExtendCachedTail({ cell, deltaBars, evaluatedAtMs })) {
        storedBarsDeltaGapFallbackCount += 1;
        continue;
      }
      const candidate = barsThroughEvaluatedAt(
        mergeBarsByTimestamp([...cell.bars, ...deltaBars], input.limit),
        evaluatedAtMs,
        input.limit,
      );
      storedBarsDeltaShadowCheckCount += 1;
      if (!isDeepStrictEqual(candidate, full.get(symbol) ?? [])) {
        storedBarsDeltaShadowMismatchCount += 1;
      }
    }
  }

  for (const rawSymbol of input.symbols) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) {
      continue;
    }
    writeStoredBarsCacheCell({
      symbol,
      timeframe: input.timeframe,
      sourceName: input.sourceName,
      limit: input.limit,
      bars: full.get(symbol) ?? [],
      evaluatedAtMs,
      deltaBucketMs,
    });
  }
  return full;
}

async function loadStoredBarsForSymbolsForPrefetch(input: {
  symbols: string[];
  timeframe: SignalMonitorLocalBarCacheTimeframe;
  limit: number;
  to: Date;
  sourceName: string;
}): Promise<Map<string, BrokerBarSnapshot[]>> {
  const deltaMode = storedBarsDeltaMode();
  if (deltaMode === "off" || storedBarsCacheMaxCells() <= 0) {
    storedBarsCacheFullReadCount += 1;
    storedBarsDeltaFullReadCount += 1;
    return loadFullStoredBarsForPrefetch({
      symbols: input.symbols,
      timeframe: input.timeframe,
      limit: input.limit,
      to: input.to,
      sourceName: input.sourceName,
    });
  }
  if (deltaMode === "shadow") {
    return loadStoredBarsForSymbolsForShadow(input);
  }

  ensureStoredBarsCacheSubscription();
  const result = new Map<string, BrokerBarSnapshot[]>();
  const evaluatedAtMs = input.to.getTime();
  const deltaBucketMs = evaluatedBucketMs(evaluatedAtMs, input.timeframe);
  const fullReadSymbols: string[] = [];
  const deltaReadSymbolsByAfter = new Map<number, string[]>();
  const reusableCellsBySymbol = new Map<string, StoredBarsCacheCell>();

  for (const rawSymbol of input.symbols) {
    const symbol = normalizeSymbol(rawSymbol);
    if (!symbol) {
      continue;
    }
    const key = storedBarsCellKey({
      symbol,
      timeframe: input.timeframe,
      sourceName: input.sourceName,
      limit: input.limit,
    });
    const cell = storedBarsCrossCycleCache.get(key);
    if (!cell || cell.invalidated) {
      storedBarsCacheMissCount += 1;
      fullReadSymbols.push(symbol);
      continue;
    }
    cell.lastAccessMs = Date.now();
    reusableCellsBySymbol.set(symbol, cell);
    if (
      cell.highWaterMs != null &&
      (cell.deltaDue || (cell.lastDeltaBucketMs ?? -1) < deltaBucketMs) &&
      cell.highWaterMs < evaluatedAtMs
    ) {
      const group = deltaReadSymbolsByAfter.get(cell.highWaterMs) ?? [];
      group.push(symbol);
      deltaReadSymbolsByAfter.set(cell.highWaterMs, group);
      continue;
    }
    storedBarsCacheHitCount += 1;
    result.set(
      symbol,
      barsThroughEvaluatedAt(cell.bars, evaluatedAtMs, input.limit),
    );
  }

  if (fullReadSymbols.length) {
    storedBarsCacheFullReadCount += 1;
    storedBarsDeltaFullReadCount += 1;
    const loaded = await loadFullStoredBarsForPrefetch({
      symbols: fullReadSymbols,
      timeframe: input.timeframe,
      limit: input.limit,
      to: input.to,
      sourceName: input.sourceName,
    });
    for (const symbol of fullReadSymbols) {
      const bars = loaded.get(symbol) ?? [];
      const cell = writeStoredBarsCacheCell({
        symbol,
        timeframe: input.timeframe,
        sourceName: input.sourceName,
        limit: input.limit,
        bars,
        evaluatedAtMs,
        deltaBucketMs,
      });
      result.set(
        symbol,
        barsThroughEvaluatedAt(cell.bars, evaluatedAtMs, input.limit),
      );
    }
  }

  const gapFallbackSymbols: string[] = [];
  for (const [afterMs, symbols] of deltaReadSymbolsByAfter) {
    storedBarsCacheDeltaReadCount += 1;
    storedBarsDeltaReadCount += 1;
    const loaded = await loadDeltaStoredBarsForPrefetch({
      symbols,
      timeframe: input.timeframe,
      limit: input.limit,
      to: input.to,
      after: new Date(afterMs),
      sourceName: input.sourceName,
    });
    for (const symbol of symbols) {
      const existing = reusableCellsBySymbol.get(symbol);
      if (!existing) {
        continue;
      }
      const deltaBars = loaded.get(symbol) ?? [];
      if (
        !deltaBarsExtendCachedTail({
          cell: existing,
          deltaBars,
          evaluatedAtMs,
        })
      ) {
        storedBarsDeltaGapFallbackCount += 1;
        gapFallbackSymbols.push(symbol);
        continue;
      }
      const cell = updateStoredBarsCacheCellWithDelta({
        cell: existing,
        deltaBars,
        deltaBucketMs,
        evaluatedAtMs,
      });
      storedBarsDeltaAppliedAppendCount += deltaBars.length;
      storedBarsCacheHitCount += 1;
      result.set(
        symbol,
        barsThroughEvaluatedAt(cell.bars, evaluatedAtMs, input.limit),
      );
    }
  }

  if (gapFallbackSymbols.length) {
    storedBarsCacheFullReadCount += 1;
    storedBarsDeltaFullReadCount += 1;
    const symbols = Array.from(new Set(gapFallbackSymbols));
    const loaded = await loadFullStoredBarsForPrefetch({
      symbols,
      timeframe: input.timeframe,
      limit: input.limit,
      to: input.to,
      sourceName: input.sourceName,
    });
    for (const symbol of symbols) {
      const cell = writeStoredBarsCacheCell({
        symbol,
        timeframe: input.timeframe,
        sourceName: input.sourceName,
        limit: input.limit,
        bars: loaded.get(symbol) ?? [],
        evaluatedAtMs,
        deltaBucketMs,
      });
      result.set(
        symbol,
        barsThroughEvaluatedAt(cell.bars, evaluatedAtMs, input.limit),
      );
    }
  }

  return result;
}

// Prefetch a whole batch's stored bars (symbols × timeframes × sources) in a few
// set-based queries, then run `fn` with that prefetch active so the per-symbol
// readStoredBars calls inside serve from it instead of issuing one pooled
// connection per (symbol, source). Behavior-equal to running `fn` without the
// prefetch. Only the DB-augmentable LOCAL_CACHE_TIMEFRAMES are prefetched; an empty
// symbol/timeframe set (or a non-matching evaluatedAt/limit at read time) falls
// straight through to the per-symbol path.
export async function runWithSignalMonitorStoredBarsPrefetch<T>(
  input: {
    symbols: readonly string[];
    timeframes: readonly string[];
    evaluatedAt: Date;
    limit: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const symbols = Array.from(
    new Set(input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );
  const timeframes = Array.from(
    new Set(
      input.timeframes.filter(
        (timeframe): timeframe is SignalMonitorLocalBarCacheTimeframe =>
          (LOCAL_CACHE_TIMEFRAMES as readonly string[]).includes(timeframe),
      ),
    ),
  );
  if (!symbols.length || !timeframes.length) {
    return fn();
  }
  const sourceNames = storeSourceNames();
  const byTimeframe: StoredBarsPrefetch["byTimeframe"] = new Map();
  timeframes.forEach((timeframe) => {
    byTimeframe.set(timeframe, new Map());
  });
  if (isApiResourcePressureHardBlock()) {
    storedBarsPrefetchPressureSkipCount += 1;
    lastStoredBarsPrefetchPressureSkippedAt = new Date();
    for (const timeframe of timeframes) {
      const bySource = byTimeframe.get(timeframe)!;
      for (const sourceName of sourceNames) {
        bySource.set(sourceName, new Map());
      }
    }
    return storedBarsPrefetchStore.run(
      {
        evaluatedAtMs: input.evaluatedAt.getTime(),
        limit: input.limit,
        byTimeframe,
      },
      fn,
    );
  }
  const tasks = timeframes.flatMap((timeframe) =>
    sourceNames.map((sourceName) => ({ timeframe, sourceName })),
  );
  await mapWithConcurrency(
    tasks,
    storedBarsPrefetchConcurrency(),
    async ({ timeframe, sourceName }) => {
      byTimeframe.get(timeframe)!.set(
        sourceName,
        await loadStoredBarsForSymbolsForPrefetch({
          symbols,
          timeframe,
          limit: input.limit,
          to: input.evaluatedAt,
          sourceName,
        }),
      );
    },
  );
  return storedBarsPrefetchStore.run(
    {
      evaluatedAtMs: input.evaluatedAt.getTime(),
      limit: input.limit,
      byTimeframe,
    },
    fn,
  );
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
  const persist = persistMarketDataBarsMixedOverride ?? persistMarketDataBarsMixed;
  try {
    // Merge the whole drained backlog into ONE mixed upsert. The bar_cache conflict
    // target carries timeframe + source, so a single chunked statement legally spans
    // every (symbol, timeframe, source) tuple in `pending` — a ≤5000-row flush issues
    // exactly one bar_cache write (plus the instruments resolution it already needs),
    // replacing the former one-INSERT-set-per-(timeframe,source) fan-out. Bars are
    // grouped per (symbol, timeframe, source) so each entry hands the writer the same
    // normalized bars a per-symbol persist would; the writer returns a per-entry ok
    // flag and every bar in a not-ok entry is requeued exactly (all-or-nothing per
    // chunk) with no loss or double-count.
    type FlushEntry = {
      symbol: string;
      timeframe: MarketDataStoreTimeframe;
      sourceName: string;
      bars: MarketDataStoreBarInput[];
      pending: PendingPersistBar[];
    };
    const entryByKey = new Map<string, FlushEntry>();
    for (const entry of pending) {
      const key = [entry.symbol, entry.timeframe, entry.sourceName].join(":");
      let flushEntry = entryByKey.get(key);
      if (!flushEntry) {
        flushEntry = {
          symbol: entry.symbol,
          timeframe: entry.timeframe,
          sourceName: entry.sourceName,
          bars: [],
          pending: [],
        };
        entryByKey.set(key, flushEntry);
      }
      flushEntry.bars.push({
        timestamp: entry.bar.timestamp,
        open: entry.bar.open,
        high: entry.bar.high,
        low: entry.bar.low,
        close: entry.bar.close,
        volume: entry.bar.volume,
      });
      flushEntry.pending.push(entry);
    }
    const flushEntries = Array.from(entryByKey.values());
    const requeueEntry = (flushEntry: FlushEntry) => {
      flushEntry.pending.forEach((entry) => {
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
    };

    let lastError: unknown = null;
    try {
      const result = await persist({
        assetClass: "equity",
        outsideRth: true,
        source: "trades",
        recentWindowMinutes: 0,
        entries: flushEntries.map((flushEntry) => ({
          symbol: flushEntry.symbol,
          timeframe: flushEntry.timeframe,
          sourceName: flushEntry.sourceName,
          bars: flushEntry.bars,
        })),
      });
      lastError = result.error;
      let persistedAny = false;
      flushEntries.forEach((flushEntry, index) => {
        if (result.okByIndex[index]) {
          persistedBarCount += flushEntry.pending.length;
          flushEntry.pending.forEach((entry) => {
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
          persistedAny = true;
        } else {
          // A not-ok entry is a failed chunk, a swallowed DB error, or a
          // disabled/backoff store — requeue its bars so they retry; never drop.
          requeueEntry(flushEntry);
        }
      });
      if (persistedAny) {
        prunePersistedBarSignatures();
      }
    } catch (error) {
      // The mixed writer swallows DB errors, but guard the unexpected: requeue the
      // whole backlog so nothing is lost.
      lastError = error;
      flushEntries.forEach(requeueEntry);
    }
    if (lastError) {
      lastPersistError =
        lastError instanceof Error ? lastError.message : String(lastError);
      lastPersistErrorAt = new Date();
      logger.warn(
        { err: lastError },
        "Signal monitor local bar cache persist failed",
      );
    } else {
      lastPersistAt = new Date();
      lastPersistError = null;
      lastPersistErrorAt = null;
    }
  } finally {
    persistFlushInFlight = false;
    if (pendingPersistBars.size) {
      schedulePersistFlush();
    }
  }
}

// Start of the minute-bar slice that can feed the limit:3 rollups at
// `evaluatedAt`. Normally the intra-session ROLLUP_RECENT_WINDOW_MS (4h). But when
// that window's far edge lands in a fully-closed period — i.e. the market just
// reopened after a weekend/holiday and the recent 1h buckets straddle the gap —
// reach back to the previous regular-session close so the prior session's bars are
// included. Only "closed" (no-session) edges widen; open extended-hours edges
// (pre/rth/after/overnight) keep the tight 4h scan. In production the widened span
// is nearly empty (no bars arrive while closed), so the scan stays bounded by real
// bar density, not wall-clock width.
function rollupScanCutoffMs(evaluatedAt: Date): number {
  const plainCutoffMs = evaluatedAt.getTime() - ROLLUP_RECENT_WINDOW_MS;
  if (resolveUsEquityMarketSession(new Date(plainCutoffMs)).open) {
    return plainCutoffMs;
  }
  const previousCloseMs =
    resolvePreviousUsEquitySessionClose(evaluatedAt)?.getTime() ?? null;
  return previousCloseMs == null
    ? plainCutoffMs
    : Math.min(plainCutoffMs, previousCloseMs);
}

function enqueueRollups(symbol: string, evaluatedAt: Date): void {
  if (!liveAggregatePersistEnabled()) {
    liveAggregatePersistSkipCount += 1;
    lastLiveAggregatePersistSkippedAt = new Date();
    lastEnqueueScannedBarCount = 0;
    return;
  }
  const symbolBars = minuteBarsBySymbol.get(symbol);
  if (!symbolBars?.size) {
    lastEnqueueScannedBarCount = 0;
    return;
  }
  // Only the recent (session-aware) window can contribute to the limit:3 rollups
  // we emit here, so scan that slice instead of the full retained history. The map
  // is keyed by minute timestamp (ms); keep entries at or after the window start.
  const windowStartMs = rollupScanCutoffMs(evaluatedAt);
  const minuteBars: CachedBar[] = [];
  for (const [timestampMs, bar] of symbolBars) {
    if (timestampMs >= windowStartMs) {
      minuteBars.push(bar);
    }
  }
  lastEnqueueScannedBarCount = minuteBars.length;
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
    liveAggregatePersistEnabled: liveAggregatePersistEnabled(),
    liveAggregatePersistSkipCount,
    lastLiveAggregatePersistSkippedAt:
      lastLiveAggregatePersistSkippedAt?.toISOString() ?? null,
    memoryRetentionMs: memoryRetentionMs(),
    storedBarsCache: {
      maxCells: storedBarsCacheMaxCells(),
      cellCount: storedBarsCrossCycleCache.size,
      hitCount: storedBarsCacheHitCount,
      missCount: storedBarsCacheMissCount,
      fullReadCount: storedBarsCacheFullReadCount,
      deltaReadCount: storedBarsCacheDeltaReadCount,
      invalidationCount: storedBarsCacheInvalidationCount,
      invalidationEventsCount: storedBarsCacheInvalidationEventsCount,
      invalidationFullCount: storedBarsCacheInvalidationFullCount,
      invalidationDeltaDueCount: storedBarsCacheInvalidationDeltaDueCount,
      evictionCount: storedBarsCacheEvictionCount,
    },
    storedBarsDelta: {
      mode: storedBarsDeltaMode(),
      deltaReads: storedBarsDeltaReadCount,
      fullReads: storedBarsDeltaFullReadCount,
      appliedAppends: storedBarsDeltaAppliedAppendCount,
      gapFallbacks: storedBarsDeltaGapFallbackCount,
      shadowChecks: storedBarsDeltaShadowCheckCount,
      shadowMismatches: storedBarsDeltaShadowMismatchCount,
    },
    storedBarsRead: {
      prefetchHitCount: storedBarsPrefetchHitCount,
      fallbackCount: storedBarsPrefetchFallbackCount,
      fallbackNoPrefetchCount: storedBarsPrefetchFallbackNoPrefetchCount,
      fallbackMismatchCount: storedBarsPrefetchFallbackMismatchCount,
      pressureSkipCount: storedBarsPrefetchPressureSkipCount,
      lastPressureSkippedAt:
        lastStoredBarsPrefetchPressureSkippedAt?.toISOString() ?? null,
    },
    lastEnqueueScannedBarCount,
  };
}

export const __signalMonitorLocalBarCacheInternalsForTests = {
  reset(): void {
    unsubscribeBarCacheRowsChanged?.();
    unsubscribeBarCacheRowsChanged = null;
    unsubscribeMassiveAggregates?.();
    unsubscribeMassiveAggregates = null;
    subscriptionSignature = "";
    trackedSymbols.clear();
    minuteBarsBySymbol.clear();
    minuteBarLastPrunedAtMsBySymbol.clear();
    storedBarsCrossCycleCache.clear();
    storedBarsCacheKeysByBase.clear();
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
    lastEnqueueScannedBarCount = 0;
    minuteBarRetentionPruneRunCount = 0;
    lastMinuteBarRetentionPruneScannedBarCount = 0;
    liveAggregatePersistSkipCount = 0;
    lastLiveAggregatePersistSkippedAt = null;
    storedBarsCacheHitCount = 0;
    storedBarsCacheMissCount = 0;
    storedBarsCacheFullReadCount = 0;
    storedBarsCacheDeltaReadCount = 0;
    storedBarsCacheInvalidationCount = 0;
    storedBarsCacheInvalidationEventsCount = 0;
    storedBarsCacheInvalidationFullCount = 0;
    storedBarsCacheInvalidationDeltaDueCount = 0;
    storedBarsCacheEvictionCount = 0;
    storedBarsDeltaReadCount = 0;
    storedBarsDeltaFullReadCount = 0;
    storedBarsDeltaAppliedAppendCount = 0;
    storedBarsDeltaGapFallbackCount = 0;
    storedBarsDeltaShadowCheckCount = 0;
    storedBarsDeltaShadowMismatchCount = 0;
    storedBarsPrefetchHitCount = 0;
    storedBarsPrefetchFallbackCount = 0;
    storedBarsPrefetchFallbackNoPrefetchCount = 0;
    storedBarsPrefetchFallbackMismatchCount = 0;
    storedBarsPrefetchPressureSkipCount = 0;
    lastStoredBarsPrefetchPressureSkippedAt = null;
    persistMarketDataBarsMixedOverride = null;
    loadStoredMarketBarsForSymbolsOverride = null;
    loadStoredMarketBarsForSymbolsSinceOverride = null;
  },
  ingest(aggregate: MassiveDelayedStockAggregate): void {
    handleMassiveAggregate(aggregate);
  },
  __setPersistMarketDataBarsMixedForTests(
    fn: PersistMarketDataBarsMixedFn | null,
  ): void {
    persistMarketDataBarsMixedOverride = fn;
  },
  __setLoadStoredMarketBarsForSymbolsForTests(
    fn: LoadStoredMarketBarsForSymbolsFn | null,
  ): void {
    loadStoredMarketBarsForSymbolsOverride = fn;
  },
  __setLoadStoredMarketBarsForSymbolsSinceForTests(
    fn: LoadStoredMarketBarsForSymbolsSinceFn | null,
  ): void {
    loadStoredMarketBarsForSymbolsSinceOverride = fn;
  },
  async flushNow(): Promise<void> {
    await flushPendingPersistBars();
  },
  storeSourceNames,
  readMemoryBars,
  storedBarsPrefetchSymbolBatchSize,
  isStoredBarsDeltaShadowSample,
  STORED_BARS_DELTA_SYMBOL_BATCH,
  get lastEnqueueScannedBarCount(): number {
    return lastEnqueueScannedBarCount;
  },
  get minuteBarRetentionPruneRunCount(): number {
    return minuteBarRetentionPruneRunCount;
  },
  get lastMinuteBarRetentionPruneScannedBarCount(): number {
    return lastMinuteBarRetentionPruneScannedBarCount;
  },
};

import { AsyncLocalStorage } from "node:async_hooks";

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
  persistMarketDataBarsForSymbols,
  type MarketDataStoreBarInput,
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
// Per-aggregate rollups only emit limit:3 buckets of the largest intraday
// timeframe (1h). The last 3 completed/provisional 1h buckets span at most 3h;
// floored-bucket alignment can pull a bar up to ~1h older into the oldest kept
// bucket, so a 4h window (3h coverage + 1h margin) is the smallest slice that
// reproduces the full-history rollup output. Capping the per-aggregate scan to
// this window keeps it O(recent window) instead of O(72h retained history).
const ROLLUP_RECENT_WINDOW_MS = TIMEFRAME_MS["1h"] * 3 + TIMEFRAME_MS["1h"];
const DEFAULT_PERSIST_FLUSH_CONCURRENCY = 5;
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
let lastEnqueueScannedBarCount = 0;

type PersistMarketDataBarsForSymbolsFn = typeof persistMarketDataBarsForSymbols;
let persistMarketDataBarsForSymbolsOverride: PersistMarketDataBarsForSymbolsFn | null =
  null;

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

function persistFlushConcurrency(): number {
  return readPositiveIntegerEnv(
    "PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_FLUSH_CONCURRENCY",
    DEFAULT_PERSIST_FLUSH_CONCURRENCY,
    1,
    32,
  );
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
    return mergeBarsByTimestamp(prefetched.flat(), input.limit);
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
  await Promise.all(
    timeframes.map(async (timeframe) => {
      const bySource = new Map<string, Map<string, BrokerBarSnapshot[]>>();
      await Promise.all(
        sourceNames.map(async (sourceName) => {
          bySource.set(
            sourceName,
            await loadStoredMarketBarsForSymbols({
              symbols,
              timeframe,
              limit: input.limit,
              to: input.evaluatedAt,
              assetClass: "equity",
              outsideRth: true,
              source: "trades",
              recentWindowMinutes: 0,
              sourceName,
            }),
          );
        }),
      );
      byTimeframe.set(timeframe, bySource);
    }),
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
  const persist =
    persistMarketDataBarsForSymbolsOverride ?? persistMarketDataBarsForSymbols;
  try {
    // Group by (timeframe, sourceName) — one multi-symbol upsert per group cuts
    // write round-trips vs one INSERT-set per symbol. A group's bars across ALL
    // symbols commit or requeue together (the merged upsert is all-or-nothing);
    // requeue is idempotent so there is no loss or double-count. Bounded
    // concurrency unchanged. Mutating shared bookkeeping inside the worker is
    // safe because Node runs each await continuation to completion without
    // interleaving synchronous work.
    const groups = new Map<string, PendingPersistBar[]>();
    pending.forEach((entry) => {
      const key = [entry.timeframe, entry.sourceName].join(":");
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    });
    const groupList = Array.from(groups.values()).filter(
      (group) => group.length > 0,
    );
    let lastError: unknown = null;
    await mapWithConcurrency(
      groupList,
      persistFlushConcurrency(),
      async (group) => {
        const first = group[0];
        if (!first) {
          return;
        }
        const barsBySymbol = new Map<string, MarketDataStoreBarInput[]>();
        group.forEach((entry) => {
          const bars = barsBySymbol.get(entry.symbol) ?? [];
          bars.push({
            timestamp: entry.bar.timestamp,
            open: entry.bar.open,
            high: entry.bar.high,
            low: entry.bar.low,
            close: entry.bar.close,
            volume: entry.bar.volume,
          });
          barsBySymbol.set(entry.symbol, bars);
        });
        const requeueGroup = () => {
          group.forEach((entry) => {
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
        try {
          const persisted = await persist({
            timeframe: first.timeframe,
            sourceName: first.sourceName,
            assetClass: "equity",
            outsideRth: true,
            source: "trades",
            recentWindowMinutes: 0,
            bySymbol: Array.from(barsBySymbol, ([symbol, bars]) => ({
              symbol,
              bars,
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
          } else {
            // A false return is a swallowed DB error or a disabled/backoff store
            // — requeue the group so the bars retry; never drop them.
            requeueGroup();
          }
        } catch (error) {
          lastError = error;
          requeueGroup();
        }
      },
    );
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

function enqueueRollups(symbol: string, evaluatedAt: Date): void {
  const symbolBars = minuteBarsBySymbol.get(symbol);
  if (!symbolBars?.size) {
    lastEnqueueScannedBarCount = 0;
    return;
  }
  // Only the recent window can contribute to the limit:3 rollups we emit here,
  // so scan that slice instead of the full 72h retained history. The map is
  // keyed by minute timestamp (ms); keep entries at or after the window start.
  const windowStartMs = evaluatedAt.getTime() - ROLLUP_RECENT_WINDOW_MS;
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
    memoryRetentionMs: memoryRetentionMs(),
    lastEnqueueScannedBarCount,
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
    lastEnqueueScannedBarCount = 0;
    persistMarketDataBarsForSymbolsOverride = null;
  },
  ingest(aggregate: MassiveDelayedStockAggregate): void {
    handleMassiveAggregate(aggregate);
  },
  __setPersistMarketDataBarsForSymbolsForTests(
    fn: PersistMarketDataBarsForSymbolsFn | null,
  ): void {
    persistMarketDataBarsForSymbolsOverride = fn;
  },
  async flushNow(): Promise<void> {
    await flushPendingPersistBars();
  },
  storeSourceNames,
  readMemoryBars,
  get lastEnqueueScannedBarCount(): number {
    return lastEnqueueScannedBarCount;
  },
};

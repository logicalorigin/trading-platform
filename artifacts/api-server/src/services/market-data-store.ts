import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import {
  barCacheTable,
  db,
  getPostgresDiagnosticContext,
  instrumentsTable,
  runWithPostgresDiagnosticContext,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import {
  createTransientPostgresBackoff,
  isPoolContentionError,
} from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";
import { isBarCacheWriteBlockedByDbDiskUsage } from "./db-disk-usage-guard";
import { isApiResourcePressureHardBlock } from "./resource-pressure";
import type {
  BrokerBarSnapshot,
  MarketDataFreshness,
} from "../providers/ibkr/client";
import type { UniverseMarket } from "../providers/massive/market-data";

export type MarketDataStoreTimeframe =
  | "1s"
  | "5s"
  | "15s"
  | "30s"
  | "1m"
  | "2m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "12h"
  | "1d"
  | "1w"
  | "1month"
  | "1year";

export type MarketDataStoreRequest = {
  symbol: string;
  timeframe: MarketDataStoreTimeframe;
  limit?: number;
  from?: Date;
  to?: Date;
  assetClass?: "equity" | "option";
  market?: UniverseMarket;
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
  recentWindowMinutes?: number | null;
};

export type MarketDataStoreBarInput = {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type PersistMarketDataBarsResult = boolean | "skipped";

const DEFAULT_RECENT_WINDOW_MINUTES = 60;
// Chunk bar_cache upserts to the Postgres bind-parameter ceiling: each row binds
// 11 params, so 65535 / 11 ≈ 5957 rows/statement — 5000 leaves margin while letting
// one persist flush (≤5000 rolled-up bars) land as a SINGLE INSERT..ON CONFLICT
// instead of one statement per (timeframe, source) group.
const BAR_CACHE_WRITE_BATCH_SIZE = 5000;
// The durable store self-heals instead of disabling permanently. A pool-acquire
// timeout (e.g. the cold-start read burst) does NOT back off — the next call
// retries immediately; any other DB error opens a short, time-boxed backoff that
// auto-clears on the next successful read or write.
const marketDataStoreBackoff = createTransientPostgresBackoff({
  backoffMs: 15_000,
  warningCooldownMs: 60_000,
});

function runWithMarketDataStoreContext<T>(
  workloadFamily: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (getPostgresDiagnosticContext()) {
    return fn();
  }
  // Await `fn()` INSIDE the diagnostic scope. `fn` returns a lazy drizzle
  // thenable; passing it straight to `als.run` builds the query synchronously
  // but fires `pool.query()` from the caller's later `await` — after the scope
  // has already restored the previous (null) store — so every background
  // bar_cache op was landing as null-context. The `async` wrapper keeps the
  // context active when the query actually executes.
  return runWithPostgresDiagnosticContext(
    { routeClass: "background", workloadFamily },
    async () => fn(),
  );
}

export function __resetMarketDataStoreBackoffForTests(): void {
  marketDataStoreBackoff.resetForTest();
}

const TIMEFRAME_STEP_MS: Partial<Record<MarketDataStoreTimeframe, number>> = {
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "30s": 30_000,
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "10m": 10 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1month": 30 * 24 * 60 * 60_000,
  "1year": 365 * 24 * 60 * 60_000,
};

// Historical corruption left some intraday bar_cache rows stored under a coarse
// timeframe with lower-timeframe timestamps (for example SPY 15m rows at :09/:13).
// Current writers bucket before upsert. Keep the indexed SQL read simple and reject
// old dirty rows in Node; a modulo predicate in SQL timed out on hot 5m ranges.
const STORED_BAR_ALIGNMENT_MAX_STEP_MS = 4 * 60 * 60_000;

const storedBarAlignmentSecondsForTimeframe = (
  timeframe: MarketDataStoreTimeframe,
): number | null => {
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  if (
    !stepMs ||
    stepMs <= 1_000 ||
    stepMs > STORED_BAR_ALIGNMENT_MAX_STEP_MS
  ) {
    return null;
  }
  const seconds = stepMs / 1_000;
  return Number.isInteger(seconds) ? seconds : null;
};

const storedBarTimestampAlignedToTimeframe = (
  timestamp: Date | string,
  timeframe: MarketDataStoreTimeframe,
): boolean => {
  const seconds = storedBarAlignmentSecondsForTimeframe(timeframe);
  if (!seconds) {
    return true;
  }
  const timestampMs =
    timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  return Math.floor(timestampMs / 1_000) % seconds === 0;
};

function alignedStoredBarRows<T>(
  rows: T[],
  timeframe: MarketDataStoreTimeframe,
  startsAt: (row: T) => Date | string,
): T[] {
  return rows.filter((row) =>
    storedBarTimestampAlignedToTimeframe(startsAt(row), timeframe),
  );
}

const numberFromDb = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const resolveRecentWindowMs = (
  recentWindowMinutes: number | null | undefined,
): number => {
  if (
    typeof recentWindowMinutes === "number" &&
    Number.isFinite(recentWindowMinutes) &&
    recentWindowMinutes >= 0
  ) {
    return recentWindowMinutes * 60_000;
  }
  return DEFAULT_RECENT_WINDOW_MINUTES * 60_000;
};

const bucketStartForTimeframe = (
  timestamp: Date,
  timeframe: MarketDataStoreTimeframe,
): Date => {
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  if (!stepMs) {
    return timestamp;
  }
  return new Date(Math.floor(timestamp.getTime() / stepMs) * stepMs);
};

// Largest timeframe step for which we drop the still-forming bar. Its epoch-grid
// bucket boundary must coincide with actual (wall-clock) bar closure — true for
// intraday steps (<=1h). See the gate in filterClosedBarsForStore.
const FORMING_BAR_FILTER_MAX_STEP_MS = 60 * 60_000; // 1h

// Persist CLOSED buckets only — drop the still-forming (open) bar. The forming bar
// is a hot row that concurrent /bars fetches re-upsert on every tick; it is served
// from the in-memory chart cache + the WS forming-bar overlay until it closes, then
// persisted on the next fetch after the bucket boundary. Mirrors the signal-monitor
// writer's closed-only invariant. A bar is closed once its bucket's END (start +
// step) has passed; the boundary is inclusive (a bar whose bucket ends exactly at
// `now` is closed).
//
// Applies to INTRADAY timeframes only (step <= 1h). Two reasons to leave coarse
// timeframes (4h/12h/1d/1w/1month/1year) untouched and persist all of their bars:
//   1. Correctness: bucketStartForTimeframe floors on the UTC epoch grid, so a coarse
//      bucket "closes" at 00:00 UTC, NOT at session end. A US-session daily bar
//      (final ~20:00-21:00 UTC) would be mis-classified as still-forming and withheld
//      from durable storage for hours until UTC rollover — visible to recentWindow=0
//      readers (e.g. watchlist backtest, 1d).
//   2. Leverage: coarse timeframes are fetched far less often, so their open bucket is
//      not a churn hotspot; the skip-guard still de-dupes their no-op re-upserts.
// Unknown timeframe -> no bucket math, also persist all.
//
// Durability note (intraday): a symbol that stops being fetched right after its last
// bar closes won't have that bar written by this path — it self-heals on the next
// chart fetch (provider re-fetch persists it as closed), monitored symbols are covered
// by the signal-monitor closed-only writer, and recentWindow=0 readers re-fetch via
// getBars in-memory on a store miss. (The "store declines the <60m edge" masking only
// applies to the 60m chart read, not to recentWindow=0 callers.)
export function filterClosedBarsForStore(
  bars: MarketDataStoreBarInput[],
  timeframe: MarketDataStoreTimeframe,
  now: Date = new Date(),
): MarketDataStoreBarInput[] {
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  if (!stepMs || stepMs > FORMING_BAR_FILTER_MAX_STEP_MS) {
    return bars;
  }
  const nowMs = now.getTime();
  return bars.filter(
    (bar) =>
      bucketStartForTimeframe(bar.timestamp, timeframe).getTime() + stepMs <=
      nowMs,
  );
}

const expandStoredRowsLimit = (
  limit: number,
  timeframe: MarketDataStoreTimeframe,
): number => {
  if (storedBarAlignmentSecondsForTimeframe(timeframe)) {
    return limit;
  }
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  if (
    !stepMs ||
    stepMs <= 1_000 ||
    ["10m", "12h", "1d", "1w", "1month", "1year"].includes(timeframe)
  ) {
    return limit;
  }
  const assumedContaminatedBaseMs = stepMs < 60_000 ? 1_000 : 60_000;
  return Math.max(limit, Math.ceil((limit * stepMs) / assumedContaminatedBaseMs));
};

export function __expandStoredRowsLimitForTests(
  limit: number,
  timeframe: MarketDataStoreTimeframe,
): number {
  return expandStoredRowsLimit(limit, timeframe);
}

export function __storedBarAlignmentSecondsForTests(
  timeframe: MarketDataStoreTimeframe,
): number | null {
  return storedBarAlignmentSecondsForTimeframe(timeframe);
}

export function normalizeBarsToStoreTimeframe<T extends MarketDataStoreBarInput>(
  bars: T[],
  timeframe: MarketDataStoreTimeframe,
): T[] {
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  if (!stepMs || stepMs <= 1_000 || ["1w", "1month", "1year"].includes(timeframe)) {
    return [...bars].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  }

  const sorted = [...bars].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const buckets = new Map<number, T[]>();
  sorted.forEach((bar) => {
    const bucketStart = bucketStartForTimeframe(bar.timestamp, timeframe).getTime();
    const bucket = buckets.get(bucketStart) || [];
    bucket.push(bar);
    buckets.set(bucketStart, bucket);
  });

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucketStart, bucket]) => {
      const first = bucket[0];
      const last = bucket[bucket.length - 1];
      if (!first || !last) {
        return null;
      }
      return {
        ...last,
        timestamp: new Date(bucketStart),
        open: first.open,
        high: Math.max(...bucket.map((bar) => bar.high)),
        low: Math.min(...bucket.map((bar) => bar.low)),
        close: last.close,
        volume: bucket.reduce((total, bar) => total + bar.volume, 0),
      };
    })
    .filter((bar): bar is T => bar !== null);
}

export const shouldUseDurableMarketDataStore = (
  input: MarketDataStoreRequest,
): boolean => {
  if (marketDataStoreBackoff.isActive(Date.now())) {
    return false;
  }
  if (input.assetClass === "option" || input.providerContractId?.trim()) {
    return false;
  }
  if (input.source && input.source !== "trades") {
    return false;
  }
  if (input.market && !["stocks", "etf", "indices", "otc"].includes(input.market)) {
    return false;
  }
  return Boolean(input.symbol?.trim() && input.timeframe);
};

export const resolveDurableHistoryWindow = (
  input: MarketDataStoreRequest,
  now = new Date(),
): { from?: Date; to: Date } | null => {
  if (!shouldUseDurableMarketDataStore(input)) {
    return null;
  }

  const requestedTo = input.to ?? now;
  const recentBoundary = new Date(
    now.getTime() - resolveRecentWindowMs(input.recentWindowMinutes),
  );
  const to = new Date(Math.min(requestedTo.getTime(), recentBoundary.getTime()));
  if (input.from && input.from.getTime() > to.getTime()) {
    return null;
  }

  return {
    from: input.from,
    to,
  };
};

// instruments.id is a stable UUID keyed on a unique symbol and rows are never
// deleted/reassigned here, so a resolved symbol->id mapping is safe to keep
// in-process. Under the write storm the same handful of symbols repeat on every
// persist call; caching the id removes a SELECT round-trip (and a held pool
// connection) per call for already-known symbols.
const storeInstrumentIdCache = new Map<string, string>();

export function __resetStoreInstrumentCacheForTests(): void {
  storeInstrumentIdCache.clear();
}

async function ensureStoreInstruments(inputs: Array<{
  symbol: string;
  assetClass?: "equity" | "option";
}>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missingBySymbol = new Map<
    string,
    { symbol: string; assetClass?: "equity" | "option" }
  >();
  for (const input of inputs) {
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol) {
      continue;
    }
    const cached = storeInstrumentIdCache.get(symbol);
    if (cached) {
      out.set(symbol, cached);
      continue;
    }
    if (!missingBySymbol.has(symbol)) {
      missingBySymbol.set(symbol, { ...input, symbol });
    }
  }

  const missing = Array.from(missingBySymbol.values());
  if (!missing.length) {
    return out;
  }

  await runWithMarketDataStoreContext("bar-cache-instrument", () =>
    db
      .insert(instrumentsTable)
      .values(
        missing.map((input) => ({
          symbol: input.symbol,
          assetClass: input.assetClass ?? "equity",
          name: input.symbol,
          currency: "USD",
          isActive: true,
        })),
      )
      .onConflictDoNothing({ target: instrumentsTable.symbol }),
  );

  const rows = await runWithMarketDataStoreContext(
    "bar-cache-instrument",
    () =>
      db
        .select({ id: instrumentsTable.id, symbol: instrumentsTable.symbol })
        .from(instrumentsTable)
        .where(
          inArray(
            instrumentsTable.symbol,
            missing.map((input) => input.symbol),
          ),
        ),
  );

  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) {
      continue;
    }
    storeInstrumentIdCache.set(symbol, row.id);
    out.set(symbol, row.id);
  }
  return out;
}

async function ensureStoreInstrument(input: {
  symbol: string;
  assetClass?: "equity" | "option";
}): Promise<string | null> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return null;
  }
  return (await ensureStoreInstruments([input])).get(symbol) ?? null;
}

const handleStoreError = (
  error: unknown,
  operation: string,
): "skipped" | "failed" => {
  // Pool-acquire timeouts mean "all connections are busy right now" (e.g. the
  // cold-start read burst), not "the store is broken" — backing off here would
  // bypass the cache during the exact window the pool is saturated, so we let the
  // next call retry immediately. Every other error opens a short, self-healing
  // backoff instead of the old permanent disable.
  if (isPoolContentionError(error)) {
    return "skipped";
  }
  marketDataStoreBackoff.markFailure({
    error,
    logger,
    message: `durable market data store temporarily unavailable (${operation}); serving provider fallback`,
    nowMs: Date.now(),
  });
  return "failed";
};

export function __handleMarketDataStoreErrorForTests(
  error: unknown,
): "skipped" | "failed" {
  return handleStoreError(error, "test");
}

export async function loadStoredMarketBars(
  input: MarketDataStoreRequest & {
    sourceName: string;
    order?: "asc" | "desc";
  },
): Promise<BrokerBarSnapshot[]> {
  if (isApiResourcePressureHardBlock()) {
    return [];
  }
  const window = resolveDurableHistoryWindow(input);
  if (!window) {
    return [];
  }

  try {
    const symbol = normalizeSymbol(input.symbol);
    const conditions = [
      eq(barCacheTable.symbol, symbol),
      eq(barCacheTable.timeframe, input.timeframe),
      eq(barCacheTable.source, input.sourceName),
      lte(barCacheTable.startsAt, window.to),
    ];
    if (window.from) {
      conditions.push(gte(barCacheTable.startsAt, window.from));
    }
    const desiredLimit = Math.max(1, input.limit ?? 500);
    const limit = expandStoredRowsLimit(desiredLimit, input.timeframe);
    // Project ONLY the columns the snapshot mapping below consumes. The full-row
    // `.select()` pulled all 13 columns (incl. two uuids, three varchars and two
    // extra timestamptz that are never read), and deserializing those rows in
    // Node (pg `_parseRowAsArray` + drizzle per-column `mapFromDriverValue`) is
    // the dominant event-loop cost under the universe-wide read fan-out — the
    // Postgres query itself is ~13ms. Six columns ≈ halves the parse/GC cost.
    // Read OHLCV as float8 so node-postgres decodes them natively (parseFloat in
    // pg's own row loop) instead of returning numeric as strings that numberFromDb
    // must Number() per cell on the event loop. Precision-neutral: the stored
    // numeric(18,6) cast to float8 is the exact double numberFromDb already derived
    // from the string (verified: to_char(x::float8,6) == to_char(x,6), 0 mismatch).
    const barColumns = {
      startsAt: barCacheTable.startsAt,
      open: sql<number>`${barCacheTable.open}::float8`,
      high: sql<number>`${barCacheTable.high}::float8`,
      low: sql<number>`${barCacheTable.low}::float8`,
      close: sql<number>`${barCacheTable.close}::float8`,
      volume: sql<number>`${barCacheTable.volume}::float8`,
    };
    const readRows = (rowLimit: number) =>
      runWithMarketDataStoreContext("bar-cache-read", () =>
        window.from && input.order !== "desc"
          ? db
              .select(barColumns)
              .from(barCacheTable)
              .where(and(...conditions))
              .orderBy(asc(barCacheTable.startsAt))
              .limit(rowLimit)
          : db
              .select(barColumns)
              .from(barCacheTable)
              .where(and(...conditions))
              .orderBy(desc(barCacheTable.startsAt))
              .limit(rowLimit),
      );
    const rows = await readRows(limit);
    const alignedRows = alignedStoredBarRows(
      rows,
      input.timeframe,
      (row) => row.startsAt,
    );

    // A successful read proves the store is healthy again — clear any backoff.
    marketDataStoreBackoff.clear();

    const normalizedSourceName = input.sourceName.toLowerCase();
    const delayed =
      normalizedSourceName.includes("delayed") ||
      (normalizedSourceName.includes("massive") &&
        !isMassiveStocksRealtimeConfigured());
    const transport = normalizedSourceName.includes("websocket")
      ? "massive_websocket"
      : "massive_rest";
    const freshness: MarketDataFreshness = delayed ? "delayed" : "live";

    return normalizeBarsToStoreTimeframe(
      alignedRows
        .map((row): BrokerBarSnapshot => ({
          timestamp: row.startsAt,
          open: numberFromDb(row.open),
          high: numberFromDb(row.high),
          low: numberFromDb(row.low),
          close: numberFromDb(row.close),
          volume: numberFromDb(row.volume),
          source: input.sourceName,
          providerContractId: null,
          outsideRth: input.outsideRth !== false,
          partial: false,
          transport,
          delayed,
          freshness,
          dataUpdatedAt: row.startsAt,
        }))
        .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      input.timeframe,
    ).slice(-desiredLimit);
  } catch (error) {
    handleStoreError(error, "loadStoredMarketBars");
    return [];
  }
}

export async function loadStoredMarketBarsBySymbol(input: {
  symbols: string[];
  timeframe: MarketDataStoreTimeframe;
  limit?: number;
  from?: Date;
  to?: Date;
  sourceName: string;
  outsideRth?: boolean;
  // Sparkline-only reader: callers render only the close line, so this returns
  // lean {timestamp, close} bars and the query selects only those columns —
  // deserializing the unused OHLV columns across the universe-wide read was the
  // dominant event-loop cost (the SQL itself is ~13ms).
}): Promise<Record<string, Array<{ timestamp: Date; close: number }>>> {
  if (isApiResourcePressureHardBlock()) {
    return {};
  }
  const symbols = Array.from(
    new Set(input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );
  if (!symbols.length) {
    return {};
  }

  const desiredLimit = Math.max(1, Math.min(720, Math.floor(input.limit ?? 120)));
  const rowLimit = expandStoredRowsLimit(desiredLimit, input.timeframe);
  const symbolValues = sql.join(
    symbols.map((symbol) => sql`${symbol}`),
    sql`, `,
  );
  const fromCondition = input.from
    ? sql`and starts_at >= ${input.from}`
    : sql``;
  const toCondition = input.to
    ? sql`and starts_at <= ${input.to}`
    : sql``;
  type BulkBarCacheRow = {
    symbol: string;
    starts_at: Date | string;
    close: string | number;
  };

  try {
    const readRows = async (limit: number) => {
      const result = await runWithMarketDataStoreContext("bar-cache-read", () =>
        db.execute(sql<BulkBarCacheRow>`
          select b.symbol, b.starts_at, b.close::float8 as close
          from unnest(array[${symbolValues}]::text[]) as s(symbol)
          cross join lateral (
            select symbol, starts_at, close
            from bar_cache
            where symbol = s.symbol
              and timeframe = ${input.timeframe}
              and source = ${input.sourceName}
              ${fromCondition}
              ${toCondition}
            order by starts_at desc
            limit ${limit}
          ) b
          order by b.symbol, b.starts_at
        `),
      );
      return result.rows as BulkBarCacheRow[];
    };
    const rows = await readRows(rowLimit);

    const rowsBySymbol = new Map<string, BulkBarCacheRow[]>();
    rows.forEach((row) => {
      const symbol = normalizeSymbol(row.symbol);
      if (!symbol) {
        return;
      }
      if (
        !storedBarTimestampAlignedToTimeframe(row.starts_at, input.timeframe)
      ) {
        return;
      }
      const current = rowsBySymbol.get(symbol) || [];
      current.push(row);
      rowsBySymbol.set(symbol, current);
    });

    return Object.fromEntries(
      symbols
        .map((symbol) => {
          const symbolRows = rowsBySymbol.get(symbol) || [];
          // Rows already come from bar_cache AT input.timeframe, so the per-bar
          // normalize/bucket step is an identity here — skip it and build the lean
          // {timestamp, close} points the sparkline renders, oldest-first. (Any
          // duplicate timestamps are collapsed downstream by mergeSparklineSeedBars.)
          const bars = symbolRows
            .map((row) => ({
              timestamp:
                row.starts_at instanceof Date
                  ? row.starts_at
                  : new Date(row.starts_at),
              close: numberFromDb(row.close),
            }))
            .sort(
              (left, right) =>
                left.timestamp.getTime() - right.timestamp.getTime(),
            )
            .slice(-desiredLimit);
          return bars.length ? [symbol, bars] : null;
        })
        .filter(
          (entry): entry is [string, Array<{ timestamp: Date; close: number }>] =>
            entry !== null,
        ),
    );
  } catch (error) {
    logger.warn({ error }, "bulk durable market data sparkline seed failed");
    throw error;
  }
}

type StoredBarsBySymbolRow = {
  symbol: string;
  starts_at: Date | string;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume: string | number;
};

function storedBarRowsToSnapshotsBySymbol(input: {
  symbols: string[];
  sourceName: string;
  outsideRth?: boolean;
  timeframe: MarketDataStoreTimeframe;
  desiredLimit: number;
  rows: StoredBarsBySymbolRow[];
}): Map<string, BrokerBarSnapshot[]> {
  const out = new Map<string, BrokerBarSnapshot[]>();
  const rowsBySymbol = new Map<string, StoredBarsBySymbolRow[]>();
  for (const row of input.rows) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) {
      continue;
    }
    const current = rowsBySymbol.get(symbol);
    if (current) {
      current.push(row);
    } else {
      rowsBySymbol.set(symbol, [row]);
    }
  }

  const normalizedSourceName = input.sourceName.toLowerCase();
  const delayed =
    normalizedSourceName.includes("delayed") ||
    (normalizedSourceName.includes("massive") &&
      !isMassiveStocksRealtimeConfigured());
  const transport = normalizedSourceName.includes("websocket")
    ? "massive_websocket"
    : "massive_rest";
  const freshness: MarketDataFreshness = delayed ? "delayed" : "live";

  for (const symbol of input.symbols) {
    const symbolRows = rowsBySymbol.get(symbol) ?? [];
    const bars = normalizeBarsToStoreTimeframe(
      symbolRows
        .filter((row) =>
          storedBarTimestampAlignedToTimeframe(row.starts_at, input.timeframe),
        )
        .map((row): BrokerBarSnapshot => {
          const timestamp =
            row.starts_at instanceof Date
              ? row.starts_at
              : new Date(row.starts_at);
          return {
            timestamp,
            open: numberFromDb(row.open),
            high: numberFromDb(row.high),
            low: numberFromDb(row.low),
            close: numberFromDb(row.close),
            volume: numberFromDb(row.volume),
            source: input.sourceName,
            providerContractId: null,
            outsideRth: input.outsideRth !== false,
            partial: false,
            transport,
            delayed,
            freshness,
            dataUpdatedAt: timestamp,
          };
        })
        .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      input.timeframe,
    ).slice(-input.desiredLimit);
    if (bars.length) {
      out.set(symbol, bars);
    }
  }
  return out;
}

// Batched, behavior-equal mirror of loadStoredMarketBars across many symbols that
// share the same timeframe / source / window. resolveDurableHistoryWindow is
// symbol-independent (it keys on to/from/recentWindow/timeframe), so the window is
// computed ONCE and a single set-based query replaces one pooled connection per
// symbol. Returns a Map<symbol, bars>; a symbol with no rows is omitted (callers
// treat absence as []). Each symbol's result is IDENTICAL to loadStoredMarketBars
// for the same inputs — same filter, expandStoredRowsLimit, asc-when-`from`/else-desc
// ordering, row->snapshot mapping, normalizeBarsToStoreTimeframe, slice(-desiredLimit).
// (Distinct from loadStoredMarketBarsBySymbol, which uses a different window/limit/order
// for the sparkline-seed route and is NOT a drop-in for the monitor read path.)
export async function loadStoredMarketBarsForSymbols(
  input: Omit<MarketDataStoreRequest, "symbol"> & {
    symbols: string[];
    sourceName: string;
  },
): Promise<Map<string, BrokerBarSnapshot[]>> {
  const out = new Map<string, BrokerBarSnapshot[]>();
  if (isApiResourcePressureHardBlock()) {
    return out;
  }
  const symbols = Array.from(
    new Set(input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );
  if (!symbols.length) {
    return out;
  }
  // The window is symbol-independent EXCEPT for shouldUseDurableMarketDataStore's
  // symbol-PRESENCE check (it requires a non-empty symbol). Pass a representative
  // symbol so the resolved window matches what each per-symbol loadStoredMarketBars
  // call resolves for the same batch params.
  const window = resolveDurableHistoryWindow({ ...input, symbol: symbols[0] });
  if (!window) {
    return out;
  }

  try {
    const desiredLimit = Math.max(1, input.limit ?? 500);
    const rowLimit = expandStoredRowsLimit(desiredLimit, input.timeframe);
    const symbolValues = sql.join(
      symbols.map((symbol) => sql`${symbol}`),
      sql`, `,
    );
    const fromCondition = window.from
      ? sql`and starts_at >= ${window.from}`
      : sql``;
    // Match loadStoredMarketBars ordering exactly: ascending when a from-bound
    // exists (oldest-N in window), otherwise descending (newest-N).
    const orderBy = window.from
      ? sql`order by starts_at asc`
      : sql`order by starts_at desc`;
    const readRows = async (limit: number) => {
      const result = await runWithMarketDataStoreContext("bar-cache-read", () =>
        db.execute(sql<StoredBarsBySymbolRow>`
          select b.symbol, b.starts_at, b.open::float8 as open, b.high::float8 as high, b.low::float8 as low, b.close::float8 as close, b.volume::float8 as volume
          from unnest(array[${symbolValues}]::text[]) as s(symbol)
          cross join lateral (
            select symbol, starts_at, open, high, low, close, volume
            from bar_cache
            where symbol = s.symbol
              and timeframe = ${input.timeframe}
              and source = ${input.sourceName}
              and starts_at <= ${window.to}
              ${fromCondition}
            ${orderBy}
            limit ${limit}
          ) b
        `),
      );
      return result.rows as StoredBarsBySymbolRow[];
    };
    const rows = await readRows(rowLimit);
    // A successful read proves the store is healthy again — clear any backoff.
    marketDataStoreBackoff.clear();

    return storedBarRowsToSnapshotsBySymbol({
      symbols,
      sourceName: input.sourceName,
      outsideRth: input.outsideRth,
      timeframe: input.timeframe,
      desiredLimit,
      rows,
    });
  } catch (error) {
    handleStoreError(error, "loadStoredMarketBarsForSymbols");
    return out;
  }
}

// Delta sibling for the signal-monitor cross-cycle stored-bar cache. The cold
// path above loads the full latest window once; subsequent evaluation cycles only
// need rows after a cached cell's high-water timestamp. This keeps the query
// set-based but stops repeatedly deserializing the same 240 closed bars per
// (symbol, timeframe, source) on every cycle.
export async function loadStoredMarketBarsForSymbolsSince(
  input: Omit<MarketDataStoreRequest, "symbol"> & {
    symbols: string[];
    sourceName: string;
    after: Date;
  },
): Promise<Map<string, BrokerBarSnapshot[]>> {
  const out = new Map<string, BrokerBarSnapshot[]>();
  if (isApiResourcePressureHardBlock()) {
    return out;
  }
  const symbols = Array.from(
    new Set(input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );
  if (!symbols.length) {
    return out;
  }
  const window = resolveDurableHistoryWindow({ ...input, symbol: symbols[0] });
  if (!window || input.after.getTime() >= window.to.getTime()) {
    return out;
  }

  try {
    const desiredLimit = Math.max(1, input.limit ?? 500);
    const rowLimit = expandStoredRowsLimit(desiredLimit, input.timeframe);
    const symbolValues = sql.join(
      symbols.map((symbol) => sql`${symbol}`),
      sql`, `,
    );
    const fromCondition = window.from
      ? sql`and starts_at >= ${window.from}`
      : sql``;
    const readRows = async (limit: number) => {
      const result = await runWithMarketDataStoreContext("bar-cache-read", () =>
        db.execute(sql<StoredBarsBySymbolRow>`
          select b.symbol, b.starts_at, b.open::float8 as open, b.high::float8 as high, b.low::float8 as low, b.close::float8 as close, b.volume::float8 as volume
          from unnest(array[${symbolValues}]::text[]) as s(symbol)
          cross join lateral (
            select symbol, starts_at, open, high, low, close, volume
            from bar_cache
            where symbol = s.symbol
              and timeframe = ${input.timeframe}
              and source = ${input.sourceName}
              and starts_at > ${input.after}
              and starts_at <= ${window.to}
              ${fromCondition}
            order by starts_at asc
            limit ${limit}
          ) b
        `),
      );
      return result.rows as StoredBarsBySymbolRow[];
    };
    const rows = await readRows(rowLimit);
    marketDataStoreBackoff.clear();
    return storedBarRowsToSnapshotsBySymbol({
      symbols,
      sourceName: input.sourceName,
      outsideRth: input.outsideRth,
      timeframe: input.timeframe,
      desiredLimit,
      rows,
    });
  } catch (error) {
    handleStoreError(error, "loadStoredMarketBarsForSymbolsSince");
    return out;
  }
}

// Skip-guard for the bar_cache upserts: only DO UPDATE when an actual OHLCV value
// changed. Re-fetching the same already-stored closed bars is the common case (every
// /bars cache-miss re-upserts ~200 unchanged rows), so without this WHERE the upsert
// rewrites excluded.* + updatedAt on rows that did not change — driving n_tup_upd
// 3.62M vs n_tup_ins 831K (4.4:1), dead tuples, and index write-amp on a 5GB table.
// All five columns are NOT NULL numerics, so plain IS DISTINCT FROM is exact (no
// NULL-handling needed). Shared by both writers below so they stay behavior-identical.
const barCacheRowChangedPredicate = sql`
  ${barCacheTable.open} IS DISTINCT FROM excluded.open
  OR ${barCacheTable.high} IS DISTINCT FROM excluded.high
  OR ${barCacheTable.low} IS DISTINCT FROM excluded.low
  OR ${barCacheTable.close} IS DISTINCT FROM excluded.close
  OR ${barCacheTable.volume} IS DISTINCT FROM excluded.volume
`;

// Cross-cycle bar-cache invalidation hook (Lever-2 Option E). The signal-monitor
// cross-cycle history cache assumes closed bars are immutable; that holds ~99.6% of
// the time, but a genuinely-changed row — a provider correction/restatement, a
// massive-history backfill gap-fill, or a trade-bar-filter force-accept — DOES
// rewrite bar_cache below the cache's high-water, where a delta-only refetch would
// miss it. Each writer captures the key's pre-write max and uses the guarded
// upsert's RETURNING rows to classify the whole key as append-only or historical;
// no-op re-upserts return no rows and emit nothing. The cache marks append-only
// keys delta-due; for historical keys it truncates cells at the earliest changed
// row and delta-refills (full invalidation only when nothing survives). In-process
// and complete:
// the API is the sole bar_cache writer (the Rust worker only runs retention
// DELETEs), so this catches 100% of relevant changes with no IPC.
export type BarCacheChange = {
  symbol: string;
  timeframe: string;
  sourceName: string;
  startsAtMs: number;
  maxStartsAtMs: number;
  kind: "append" | "historical";
};
type BarCacheChangeListener = (changes: BarCacheChange[]) => void;
const barCacheChangeListeners = new Set<BarCacheChangeListener>();

type BarCacheWriteKey = {
  symbol: string;
  timeframe: string;
  sourceName: string;
};
type ChangedBarCacheRow = BarCacheWriteKey & {
  startsAt: Date | string;
};

export function onBarCacheRowsChanged(
  listener: BarCacheChangeListener,
): () => void {
  barCacheChangeListeners.add(listener);
  return () => {
    barCacheChangeListeners.delete(listener);
  };
}

function startsAtToMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function barCacheChangeKey(input: BarCacheWriteKey): string {
  return [input.symbol, input.timeframe, input.sourceName].join("|");
}

async function loadPreviousBarCacheMaxStartsAt(
  rows: readonly BarCacheWriteKey[],
): Promise<Map<string, number | null> | null> {
  const keysByValue = new Map<string, BarCacheWriteKey>();
  for (const row of rows) {
    keysByValue.set(barCacheChangeKey(row), row);
  }
  const keys = Array.from(keysByValue.values());
  if (!keys.length) {
    return new Map();
  }
  const symbolValues = sql.join(
    keys.map((key) => sql`${key.symbol}`),
    sql`, `,
  );
  const timeframeValues = sql.join(
    keys.map((key) => sql`${key.timeframe}`),
    sql`, `,
  );
  const sourceValues = sql.join(
    keys.map((key) => sql`${key.sourceName}`),
    sql`, `,
  );
  type PreviousMaxRow = {
    symbol: string;
    timeframe: string;
    source_name: string;
    max_starts_at: Date | string | null;
  };

  try {
    const result = await runWithMarketDataStoreContext(
      "bar-cache-write-high-water",
      () =>
        db.execute(sql<PreviousMaxRow>`
          select keys.symbol, keys.timeframe, keys.source as source_name,
                 latest.starts_at as max_starts_at
          from unnest(
            array[${symbolValues}]::text[],
            array[${timeframeValues}]::text[],
            array[${sourceValues}]::text[]
          ) as keys(symbol, timeframe, source)
          left join lateral (
            select starts_at
            from bar_cache
            where symbol = keys.symbol
              and timeframe = keys.timeframe
              and source = keys.source
            order by starts_at desc
            limit 1
          ) latest on true
        `),
    );
    const previousMaxByKey = new Map<string, number | null>(
      keys.map((key) => [barCacheChangeKey(key), null]),
    );
    for (const row of result.rows as PreviousMaxRow[]) {
      previousMaxByKey.set(
        barCacheChangeKey({
          symbol: row.symbol,
          timeframe: row.timeframe,
          sourceName: row.source_name,
        }),
        row.max_starts_at == null ? null : startsAtToMs(row.max_starts_at),
      );
    }
    return previousMaxByKey;
  } catch {
    // Persistence remains authoritative. An unavailable pre-write high-water is
    // classified conservatively as historical below so readers do a full reload.
    return null;
  }
}

function buildBarCacheChanges(
  rows: readonly ChangedBarCacheRow[],
  previousMaxByKey: Map<string, number | null> | null,
): BarCacheChange[] {
  const summaryByKey = new Map<
    string,
    { maxStartsAtMs: number; historical: boolean }
  >();
  for (const row of rows) {
    const key = barCacheChangeKey(row);
    const startsAtMs = startsAtToMs(row.startsAt);
    const previousMaxStartsAtMs = previousMaxByKey?.get(key) ?? null;
    const existing = summaryByKey.get(key);
    summaryByKey.set(key, {
      maxStartsAtMs: Math.max(
        existing?.maxStartsAtMs ?? previousMaxStartsAtMs ?? startsAtMs,
        startsAtMs,
      ),
      historical:
        previousMaxByKey === null ||
        existing?.historical === true ||
        (previousMaxStartsAtMs != null && startsAtMs <= previousMaxStartsAtMs),
    });
  }
  return rows.map((row) => {
    const summary = summaryByKey.get(barCacheChangeKey(row))!;
    return {
      symbol: row.symbol,
      timeframe: row.timeframe,
      sourceName: row.sourceName,
      startsAtMs: startsAtToMs(row.startsAt),
      maxStartsAtMs: summary.maxStartsAtMs,
      kind: summary.historical ? "historical" : "append",
    };
  });
}

function dispatchBarCacheChanges(changes: BarCacheChange[]): void {
  if (!changes.length || !barCacheChangeListeners.size) {
    return;
  }
  for (const listener of barCacheChangeListeners) {
    try {
      listener(changes);
    } catch {
      // Invalidation must never break persistence.
    }
  }
}

export async function persistMarketDataBars(input: {
  request: MarketDataStoreRequest;
  sourceName: string;
  bars: MarketDataStoreBarInput[];
}): Promise<PersistMarketDataBarsResult> {
  if (!input.bars.length) {
    return false;
  }
  if (marketDataStoreBackoff.isActive(Date.now())) {
    return "skipped";
  }
  // Disk-quota guard: pauses ONLY the bar_cache write path while the DB sits
  // at/above its hard cap (see db-disk-usage-guard.ts); reads are unaffected.
  if (isBarCacheWriteBlockedByDbDiskUsage()) {
    return "skipped";
  }
  if (!shouldUseDurableMarketDataStore(input.request)) {
    return false;
  }

  try {
    const instrumentId = await ensureStoreInstrument({
      symbol: input.request.symbol,
      assetClass: input.request.assetClass,
    });
    if (!instrumentId) {
      return false;
    }

    const symbol = normalizeSymbol(input.request.symbol);
    const normalizedBars = normalizeBarsToStoreTimeframe(
      input.bars,
      input.request.timeframe,
    );
    const shouldDispatchChanges = barCacheChangeListeners.size > 0;
    const previousMaxByKey = shouldDispatchChanges
      ? await loadPreviousBarCacheMaxStartsAt(
          normalizedBars.length
            ? [
                {
                  symbol,
                  timeframe: input.request.timeframe,
                  sourceName: input.sourceName,
                },
              ]
            : [],
        )
      : null;
    const changedRowsForNotification: ChangedBarCacheRow[] = [];
    for (
      let offset = 0;
      offset < normalizedBars.length;
      offset += BAR_CACHE_WRITE_BATCH_SIZE
    ) {
      const batch = normalizedBars.slice(
        offset,
        offset + BAR_CACHE_WRITE_BATCH_SIZE,
      );
      const now = new Date();
      const values = batch.map((bar) => ({
        instrumentId,
        symbol,
        timeframe: input.request.timeframe,
        startsAt: bar.timestamp,
        open: String(bar.open),
        high: String(bar.high),
        low: String(bar.low),
        close: String(bar.close),
        volume: String(bar.volume),
        source: input.sourceName,
        updatedAt: now,
      }));

      if (values.length) {
        const changedRows = await runWithMarketDataStoreContext(
          "bar-cache-write",
          () =>
            db
              .insert(barCacheTable)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  barCacheTable.instrumentId,
                  barCacheTable.timeframe,
                  barCacheTable.source,
                  barCacheTable.startsAt,
                ],
                set: {
                  symbol,
                  open: sql`excluded.open`,
                  high: sql`excluded.high`,
                  low: sql`excluded.low`,
                  close: sql`excluded.close`,
                  volume: sql`excluded.volume`,
                  updatedAt: now,
                },
                setWhere: barCacheRowChangedPredicate,
              })
              .returning({
                symbol: barCacheTable.symbol,
                timeframe: barCacheTable.timeframe,
                startsAt: barCacheTable.startsAt,
              }),
        );
        if (shouldDispatchChanges) {
          for (const row of changedRows) {
            changedRowsForNotification.push({
              symbol: row.symbol,
              timeframe: row.timeframe,
              sourceName: input.sourceName,
              startsAt: row.startsAt,
            });
          }
        }
      }
    }
    if (shouldDispatchChanges) {
      dispatchBarCacheChanges(
        buildBarCacheChanges(changedRowsForNotification, previousMaxByKey),
      );
    }
    // A successful write proves the store is healthy again — clear any backoff.
    marketDataStoreBackoff.clear();
    return true;
  } catch (error) {
    return handleStoreError(error, "persistMarketDataBars") === "skipped"
      ? "skipped"
      : false;
  }
}

// Multi-symbol behavior-equal sibling of persistMarketDataBars: upserts bars for
// MANY symbols that share one timeframe/source/eligibility using chunked multi-row
// INSERTs instead of one INSERT-set per symbol — cutting write round-trips on the
// persist flush. Each row's bar_cache result is identical to the per-symbol path
// (same instrumentId, normalized bars, conflict target, and excluded.* update;
// `set.symbol = excluded.symbol` because a chunk spans symbols, and symbol is
// functionally determined by instrumentId so it is unchanged on conflict). Returns
// false (not throw) on a DB error, matching persistMarketDataBars.
export async function persistMarketDataBarsForSymbols(input: {
  timeframe: MarketDataStoreTimeframe;
  sourceName: string;
  assetClass?: MarketDataStoreRequest["assetClass"];
  outsideRth?: boolean;
  source?: MarketDataStoreRequest["source"];
  recentWindowMinutes?: number | null;
  bySymbol: { symbol: string; bars: MarketDataStoreBarInput[] }[];
}): Promise<boolean> {
  const groups = input.bySymbol.filter((group) => group.bars.length);
  if (!groups.length) {
    return false;
  }
  // Disk-quota guard: pauses ONLY the bar_cache write path while the DB sits
  // at/above its hard cap (see db-disk-usage-guard.ts); reads are unaffected.
  if (isBarCacheWriteBlockedByDbDiskUsage()) {
    return false;
  }
  // Eligibility is symbol-independent for these batch params (gates on
  // assetClass/source/backoff + symbol PRESENCE), so check once with a
  // representative symbol — matching what each per-symbol persist would resolve.
  if (
    !shouldUseDurableMarketDataStore({
      symbol: groups[0]!.symbol,
      timeframe: input.timeframe,
      assetClass: input.assetClass,
      outsideRth: input.outsideRth,
      source: input.source,
      recentWindowMinutes: input.recentWindowMinutes,
    })
  ) {
    return false;
  }

  try {
    type BarCacheInsertRow = {
      instrumentId: string;
      symbol: string;
      timeframe: MarketDataStoreTimeframe;
      startsAt: Date;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      source: string;
    };
    const instrumentIds = await ensureStoreInstruments(
      groups.map((group) => ({
        symbol: group.symbol,
        assetClass: input.assetClass,
      })),
    );
    const rows: BarCacheInsertRow[] = [];
    for (const group of groups) {
      const symbol = normalizeSymbol(group.symbol);
      const instrumentId = instrumentIds.get(symbol);
      if (!instrumentId) {
        continue;
      }
      const normalizedBars = normalizeBarsToStoreTimeframe(
        group.bars,
        input.timeframe,
      );
      for (const bar of normalizedBars) {
        rows.push({
          instrumentId,
          symbol,
          timeframe: input.timeframe,
          startsAt: bar.timestamp,
          open: String(bar.open),
          high: String(bar.high),
          low: String(bar.low),
          close: String(bar.close),
          volume: String(bar.volume),
          source: input.sourceName,
        });
      }
    }
    if (!rows.length) {
      return false;
    }
    const shouldDispatchChanges = barCacheChangeListeners.size > 0;
    const previousMaxByKey = shouldDispatchChanges
      ? await loadPreviousBarCacheMaxStartsAt(
          rows.map((row) => ({
            symbol: row.symbol,
            timeframe: row.timeframe,
            sourceName: row.source,
          })),
        )
      : null;
    const changedRowsForNotification: ChangedBarCacheRow[] = [];
    for (
      let offset = 0;
      offset < rows.length;
      offset += BAR_CACHE_WRITE_BATCH_SIZE
    ) {
      const batch = rows.slice(offset, offset + BAR_CACHE_WRITE_BATCH_SIZE);
      const now = new Date();
      const changedRows = await runWithMarketDataStoreContext(
        "bar-cache-write",
        () =>
          db
            .insert(barCacheTable)
            .values(batch.map((row) => ({ ...row, updatedAt: now })))
            .onConflictDoUpdate({
              target: [
                barCacheTable.instrumentId,
                barCacheTable.timeframe,
                barCacheTable.source,
                barCacheTable.startsAt,
              ],
              set: {
                symbol: sql`excluded.symbol`,
                open: sql`excluded.open`,
                high: sql`excluded.high`,
                low: sql`excluded.low`,
                close: sql`excluded.close`,
                volume: sql`excluded.volume`,
                updatedAt: now,
              },
              setWhere: barCacheRowChangedPredicate,
            })
            .returning({
              symbol: barCacheTable.symbol,
              timeframe: barCacheTable.timeframe,
              startsAt: barCacheTable.startsAt,
            }),
      );
      if (shouldDispatchChanges) {
        for (const row of changedRows) {
          changedRowsForNotification.push({
            symbol: row.symbol,
            timeframe: row.timeframe,
            sourceName: input.sourceName,
            startsAt: row.startsAt,
          });
        }
      }
    }
    if (shouldDispatchChanges) {
      dispatchBarCacheChanges(
        buildBarCacheChanges(changedRowsForNotification, previousMaxByKey),
      );
    }
    marketDataStoreBackoff.clear();
    return true;
  } catch (error) {
    handleStoreError(error, "persistMarketDataBarsForSymbols");
    return false;
  }
}

export type PersistMarketDataBarsMixedEntry = {
  symbol: string;
  timeframe: MarketDataStoreTimeframe;
  sourceName: string;
  bars: MarketDataStoreBarInput[];
};

export type PersistMarketDataBarsMixedResult = {
  // Parallel to input.entries: entry i persisted (or had nothing to persist) iff
  // okByIndex[i]. Chunking is all-or-nothing per chunk, so an entry with a row in
  // a failed chunk is not-ok and the caller requeues exactly its bars.
  okByIndex: boolean[];
  // The last DB error a chunk (or instrument resolution) hit, else null. Callers
  // surface it for diagnostics; the writer itself never throws for a DB error.
  error: unknown;
};

// Mixed-tuple sibling of persistMarketDataBarsForSymbols. The signal-monitor persist
// flush drains pending bars spanning MANY (symbol, timeframe, source) tuples at once;
// the bar_cache conflict target already carries timeframe + source, so ONE chunked
// INSERT..ON CONFLICT can legally upsert rows across mixed timeframes AND sources.
// This collapses the flush from one INSERT-set per (timeframe, source) group to ~one
// statement per BAR_CACHE_WRITE_BATCH_SIZE-row chunk (a ≤5000-row flush = one write,
// plus the instruments resolution it already needs). Each row's bar_cache result is
// IDENTICAL to persistMarketDataBarsForSymbols (same instrumentId resolution, per-entry
// normalizeBarsToStoreTimeframe, composite conflict target, excluded.* set + the
// row-changed setWhere). Returns a per-entry-index ok flag plus the last DB error;
// never throws for a DB error — matching the swallow-and-report contract of the other
// writers (it reports the error in the result instead).
export async function persistMarketDataBarsMixed(input: {
  assetClass?: MarketDataStoreRequest["assetClass"];
  outsideRth?: boolean;
  source?: MarketDataStoreRequest["source"];
  recentWindowMinutes?: number | null;
  entries: PersistMarketDataBarsMixedEntry[];
}): Promise<PersistMarketDataBarsMixedResult> {
  const okByIndex = input.entries.map(() => false);
  const activeEntries = input.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.bars.length > 0);
  if (!activeEntries.length) {
    return { okByIndex, error: null };
  }
  // Disk-quota guard: pauses ONLY the bar_cache write path while the DB sits
  // at/above its hard cap (see db-disk-usage-guard.ts); reads are unaffected.
  if (isBarCacheWriteBlockedByDbDiskUsage()) {
    return { okByIndex, error: null };
  }
  // Eligibility is symbol-independent for these params (gates on assetClass/source/
  // backoff + symbol PRESENCE), so check once with a representative symbol — matching
  // what each per-symbol persist would resolve.
  if (
    !shouldUseDurableMarketDataStore({
      symbol: activeEntries[0]!.entry.symbol,
      timeframe: activeEntries[0]!.entry.timeframe,
      assetClass: input.assetClass,
      outsideRth: input.outsideRth,
      source: input.source,
      recentWindowMinutes: input.recentWindowMinutes,
    })
  ) {
    return { okByIndex, error: null };
  }

  try {
    type BarCacheInsertRow = {
      entryIndex: number;
      instrumentId: string;
      symbol: string;
      timeframe: MarketDataStoreTimeframe;
      startsAt: Date;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
      source: string;
    };
    const instrumentIds = await ensureStoreInstruments(
      activeEntries.map(({ entry }) => ({
        symbol: entry.symbol,
        assetClass: input.assetClass,
      })),
    );
    const rows: BarCacheInsertRow[] = [];
    for (const { entry, index } of activeEntries) {
      const symbol = normalizeSymbol(entry.symbol);
      const instrumentId = instrumentIds.get(symbol);
      if (!instrumentId) {
        continue;
      }
      const normalizedBars = normalizeBarsToStoreTimeframe(
        entry.bars,
        entry.timeframe,
      );
      for (const bar of normalizedBars) {
        rows.push({
          entryIndex: index,
          instrumentId,
          symbol,
          timeframe: entry.timeframe,
          startsAt: bar.timestamp,
          open: String(bar.open),
          high: String(bar.high),
          low: String(bar.low),
          close: String(bar.close),
          volume: String(bar.volume),
          source: entry.sourceName,
        });
      }
    }
    // Provisionally mark every active entry ok. An entry that resolved no instrument
    // (produced no rows) has nothing to persist and nothing to requeue, so it stays
    // ok (dropped) — matching persistMarketDataBarsForSymbols, which skips such
    // symbols yet still reports success. A failed chunk below revokes ok for the
    // entries whose rows it carried.
    for (const { index } of activeEntries) {
      okByIndex[index] = true;
    }
    if (!rows.length) {
      marketDataStoreBackoff.clear();
      return { okByIndex, error: null };
    }

    const shouldDispatchChanges = barCacheChangeListeners.size > 0;
    const previousMaxByKey = shouldDispatchChanges
      ? await loadPreviousBarCacheMaxStartsAt(
          rows.map((row) => ({
            symbol: row.symbol,
            timeframe: row.timeframe,
            sourceName: row.source,
          })),
        )
      : null;
    const changedRowsForNotification: ChangedBarCacheRow[] = [];
    let lastChunkError: unknown = null;
    let anyChunkSucceeded = false;
    for (
      let offset = 0;
      offset < rows.length;
      offset += BAR_CACHE_WRITE_BATCH_SIZE
    ) {
      const batch = rows.slice(offset, offset + BAR_CACHE_WRITE_BATCH_SIZE);
      const now = new Date();
      try {
        const changedRows = await runWithMarketDataStoreContext(
          "bar-cache-write",
          () =>
            db
              .insert(barCacheTable)
              .values(
                batch.map((row) => ({
                  instrumentId: row.instrumentId,
                  symbol: row.symbol,
                  timeframe: row.timeframe,
                  startsAt: row.startsAt,
                  open: row.open,
                  high: row.high,
                  low: row.low,
                  close: row.close,
                  volume: row.volume,
                  source: row.source,
                  updatedAt: now,
                })),
              )
              .onConflictDoUpdate({
                target: [
                  barCacheTable.instrumentId,
                  barCacheTable.timeframe,
                  barCacheTable.source,
                  barCacheTable.startsAt,
                ],
                set: {
                  symbol: sql`excluded.symbol`,
                  open: sql`excluded.open`,
                  high: sql`excluded.high`,
                  low: sql`excluded.low`,
                  close: sql`excluded.close`,
                  volume: sql`excluded.volume`,
                  updatedAt: now,
                },
                setWhere: barCacheRowChangedPredicate,
              })
              .returning({
                symbol: barCacheTable.symbol,
                timeframe: barCacheTable.timeframe,
                source: barCacheTable.source,
                startsAt: barCacheTable.startsAt,
              }),
        );
        anyChunkSucceeded = true;
        if (shouldDispatchChanges) {
          for (const row of changedRows) {
            changedRowsForNotification.push({
              symbol: row.symbol,
              timeframe: row.timeframe,
              sourceName: row.source,
              startsAt: row.startsAt,
            });
          }
        }
      } catch (error) {
        lastChunkError = error;
        handleStoreError(error, "persistMarketDataBarsMixed");
        for (const row of batch) {
          okByIndex[row.entryIndex] = false;
        }
      }
    }
    if (shouldDispatchChanges) {
      dispatchBarCacheChanges(
        buildBarCacheChanges(changedRowsForNotification, previousMaxByKey),
      );
    }
    if (anyChunkSucceeded && !lastChunkError) {
      // A fully-successful flush proves the store is healthy again — clear any
      // backoff. If any chunk failed, leave the backoff to handleStoreError above.
      marketDataStoreBackoff.clear();
    }
    return { okByIndex, error: lastChunkError };
  } catch (error) {
    handleStoreError(error, "persistMarketDataBarsMixed");
    return { okByIndex: input.entries.map(() => false), error };
  }
}

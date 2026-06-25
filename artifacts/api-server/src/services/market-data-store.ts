import {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import {
  barCacheTable,
  db,
  instrumentsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import {
  createTransientPostgresBackoff,
  isPoolContentionError,
} from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";
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

const DEFAULT_RECENT_WINDOW_MINUTES = 60;
const STORE_BATCH_SIZE = 500;
// The durable store self-heals instead of disabling permanently. A pool-acquire
// timeout (e.g. the cold-start read burst) does NOT back off — the next call
// retries immediately; any other DB error opens a short, time-boxed backoff that
// auto-clears on the next successful read or write.
const marketDataStoreBackoff = createTransientPostgresBackoff({
  backoffMs: 15_000,
  warningCooldownMs: 60_000,
});

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

async function ensureStoreInstrument(input: {
  symbol: string;
  assetClass?: "equity" | "option";
}): Promise<string | null> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return null;
  }

  const cached = storeInstrumentIdCache.get(symbol);
  if (cached) {
    return cached;
  }

  const [existing] = await db
    .select({ id: instrumentsTable.id })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, symbol))
    .limit(1);
  if (existing?.id) {
    storeInstrumentIdCache.set(symbol, existing.id);
    return existing.id;
  }

  await db
    .insert(instrumentsTable)
    .values({
      symbol,
      assetClass: input.assetClass ?? "equity",
      name: symbol,
      currency: "USD",
      isActive: true,
    })
    .onConflictDoNothing({ target: instrumentsTable.symbol });

  const [created] = await db
    .select({ id: instrumentsTable.id })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, symbol))
    .limit(1);

  if (created?.id) {
    storeInstrumentIdCache.set(symbol, created.id);
  }
  return created?.id ?? null;
}

const handleStoreError = (error: unknown, operation: string): void => {
  // Pool-acquire timeouts mean "all connections are busy right now" (e.g. the
  // cold-start read burst), not "the store is broken" — backing off here would
  // bypass the cache during the exact window the pool is saturated, so we let the
  // next call retry immediately. Every other error opens a short, self-healing
  // backoff instead of the old permanent disable.
  if (isPoolContentionError(error)) {
    return;
  }
  marketDataStoreBackoff.markFailure({
    error,
    logger,
    message: `durable market data store temporarily unavailable (${operation}); serving provider fallback`,
    nowMs: Date.now(),
  });
};

export function __handleMarketDataStoreErrorForTests(error: unknown): void {
  handleStoreError(error, "test");
}

export async function loadStoredMarketBars(
  input: MarketDataStoreRequest & { sourceName: string },
): Promise<BrokerBarSnapshot[]> {
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
    const barColumns = {
      startsAt: barCacheTable.startsAt,
      open: barCacheTable.open,
      high: barCacheTable.high,
      low: barCacheTable.low,
      close: barCacheTable.close,
      volume: barCacheTable.volume,
    };
    const rows = window.from
      ? await db
          .select(barColumns)
          .from(barCacheTable)
          .where(and(...conditions))
          .orderBy(asc(barCacheTable.startsAt))
          .limit(limit)
      : await db
          .select(barColumns)
          .from(barCacheTable)
          .where(and(...conditions))
          .orderBy(desc(barCacheTable.startsAt))
          .limit(limit);

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
      rows
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
  const symbols = Array.from(
    new Set(input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );
  if (!symbols.length) {
    return {};
  }

  const desiredLimit = Math.max(1, Math.min(720, Math.floor(input.limit ?? 120)));
  const expandedLimit = expandStoredRowsLimit(desiredLimit, input.timeframe);
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
    const result = await db.execute(sql<BulkBarCacheRow>`
      select b.symbol, b.starts_at, b.close
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
        limit ${expandedLimit}
      ) b
      order by b.symbol, b.starts_at
    `);
    const rows = result.rows as BulkBarCacheRow[];

    const rowsBySymbol = new Map<string, BulkBarCacheRow[]>();
    rows.forEach((row) => {
      const symbol = normalizeSymbol(row.symbol);
      if (!symbol) {
        return;
      }
      const current = rowsBySymbol.get(symbol) || [];
      if (current.length >= expandedLimit) {
        return;
      }
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
    type BarCacheRow = {
      symbol: string;
      starts_at: Date | string;
      open: string | number;
      high: string | number;
      low: string | number;
      close: string | number;
      volume: string | number;
    };
    const result = await db.execute(sql<BarCacheRow>`
      select b.symbol, b.starts_at, b.open, b.high, b.low, b.close, b.volume
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
        limit ${rowLimit}
      ) b
    `);
    // A successful read proves the store is healthy again — clear any backoff.
    marketDataStoreBackoff.clear();

    const rowsBySymbol = new Map<string, BarCacheRow[]>();
    for (const row of result.rows as BarCacheRow[]) {
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

    for (const symbol of symbols) {
      const symbolRows = rowsBySymbol.get(symbol) ?? [];
      const bars = normalizeBarsToStoreTimeframe(
        symbolRows
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
          .sort(
            (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
          ),
        input.timeframe,
      ).slice(-desiredLimit);
      if (bars.length) {
        out.set(symbol, bars);
      }
    }
    return out;
  } catch (error) {
    handleStoreError(error, "loadStoredMarketBarsForSymbols");
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

export async function persistMarketDataBars(input: {
  request: MarketDataStoreRequest;
  sourceName: string;
  bars: MarketDataStoreBarInput[];
}): Promise<boolean> {
  if (!input.bars.length || !shouldUseDurableMarketDataStore(input.request)) {
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
    for (let offset = 0; offset < normalizedBars.length; offset += STORE_BATCH_SIZE) {
      const batch = normalizedBars.slice(offset, offset + STORE_BATCH_SIZE);
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
        await db
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
          });
      }
    }
    // A successful write proves the store is healthy again — clear any backoff.
    marketDataStoreBackoff.clear();
    return true;
  } catch (error) {
    handleStoreError(error, "persistMarketDataBars");
    return false;
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
    const rows: BarCacheInsertRow[] = [];
    for (const group of groups) {
      const instrumentId = await ensureStoreInstrument({
        symbol: group.symbol,
        assetClass: input.assetClass,
      });
      if (!instrumentId) {
        continue;
      }
      const symbol = normalizeSymbol(group.symbol);
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
    for (let offset = 0; offset < rows.length; offset += STORE_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + STORE_BATCH_SIZE);
      const now = new Date();
      await db
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
        });
    }
    marketDataStoreBackoff.clear();
    return true;
  } catch (error) {
    handleStoreError(error, "persistMarketDataBarsForSymbols");
    return false;
  }
}

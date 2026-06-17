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
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d";

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
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
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

const expandStoredRowsLimit = (
  limit: number,
  timeframe: MarketDataStoreTimeframe,
): number => {
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  if (!stepMs || stepMs <= 1_000 || timeframe === "1d") {
    return limit;
  }
  const assumedContaminatedBaseMs = stepMs < 60_000 ? 1_000 : 60_000;
  return Math.max(limit, Math.ceil((limit * stepMs) / assumedContaminatedBaseMs));
};

export function normalizeBarsToStoreTimeframe<T extends MarketDataStoreBarInput>(
  bars: T[],
  timeframe: MarketDataStoreTimeframe,
): T[] {
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  if (!stepMs || stepMs <= 1_000) {
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

async function ensureStoreInstrument(input: {
  symbol: string;
  assetClass?: "equity" | "option";
}): Promise<string | null> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return null;
  }

  const [existing] = await db
    .select({ id: instrumentsTable.id })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, symbol))
    .limit(1);
  if (existing?.id) {
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
    const rows = window.from
      ? await db
          .select()
          .from(barCacheTable)
          .where(and(...conditions))
          .orderBy(asc(barCacheTable.startsAt))
          .limit(limit)
      : await db
          .select()
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

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
} from "drizzle-orm";
import {
  barCacheTable,
  db,
  instrumentsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import type {
  BrokerBarSnapshot,
  MarketDataFreshness,
} from "../providers/ibkr/client";
import type { UniverseMarket } from "../providers/polygon/market-data";

export type MarketDataStoreTimeframe =
  | "1s"
  | "5s"
  | "15s"
  | "1m"
  | "5m"
  | "15m"
  | "1h"
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
let marketDataStoreDisabled = false;

const TIMEFRAME_STEP_MS: Partial<Record<MarketDataStoreTimeframe, number>> = {
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
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
  if (marketDataStoreDisabled) {
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

const disableStoreAfterError = (error: unknown, operation: string): void => {
  marketDataStoreDisabled = true;
  logger.debug(
    { err: error, operation },
    "durable market data store disabled after database error",
  );
};

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

    const freshness: MarketDataFreshness = input.sourceName.includes("massive")
      ? "delayed"
      : "live";

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
          transport: "tws" as const,
          delayed: input.sourceName.includes("massive"),
          freshness,
          dataUpdatedAt: row.updatedAt ?? row.createdAt ?? row.startsAt,
        }))
        .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime()),
      input.timeframe,
    ).slice(-desiredLimit);
  } catch (error) {
    disableStoreAfterError(error, "loadStoredMarketBars");
    return [];
  }
}

export async function persistMarketDataBars(input: {
  request: MarketDataStoreRequest;
  sourceName: string;
  bars: MarketDataStoreBarInput[];
}): Promise<void> {
  if (!input.bars.length || !shouldUseDurableMarketDataStore(input.request)) {
    return;
  }

  try {
    const instrumentId = await ensureStoreInstrument({
      symbol: input.request.symbol,
      assetClass: input.request.assetClass,
    });
    if (!instrumentId) {
      return;
    }

    const symbol = normalizeSymbol(input.request.symbol);
    const normalizedBars = normalizeBarsToStoreTimeframe(
      input.bars,
      input.request.timeframe,
    );
    for (let offset = 0; offset < normalizedBars.length; offset += STORE_BATCH_SIZE) {
      const batch = normalizedBars.slice(offset, offset + STORE_BATCH_SIZE);
      const timestamps = batch.map((bar) => bar.timestamp);
      const existingRows = timestamps.length
        ? await db
            .select({ startsAt: barCacheTable.startsAt })
            .from(barCacheTable)
            .where(
              and(
                eq(barCacheTable.instrumentId, instrumentId),
                eq(barCacheTable.timeframe, input.request.timeframe),
                eq(barCacheTable.source, input.sourceName),
                inArray(barCacheTable.startsAt, timestamps),
              ),
            )
        : [];
      const existing = new Set(
        existingRows.map((row) => row.startsAt.getTime()),
      );
      const values = batch
        .filter((bar) => !existing.has(bar.timestamp.getTime()))
        .map((bar) => ({
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
        }));

      if (values.length) {
        await db.insert(barCacheTable).values(values);
      }
    }
  } catch (error) {
    disableStoreAfterError(error, "persistMarketDataBars");
  }
}

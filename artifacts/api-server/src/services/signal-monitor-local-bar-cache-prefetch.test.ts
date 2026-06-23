import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { barCacheTable, db, instrumentsTable } from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import { isMassiveStocksRealtimeConfigured } from "../lib/runtime";
import { __resetMarketDataStoreBackoffForTests } from "./market-data-store";
import {
  loadSignalMonitorLocalBarCache,
  runWithSignalMonitorStoredBarsPrefetch,
} from "./signal-monitor-local-bar-cache";

const TWO_HOURS_MS = 2 * 60 * 60_000;
const TIMEFRAME = "1m" as const;
// Mirror storeSourceNames() so seeded rows match what readStoredBars queries.
const SOURCES = isMassiveStocksRealtimeConfigured()
  ? ["massive-websocket", "massive-history"]
  : ["massive-delayed-websocket", "massive-history"];

let testDb: TestDatabase;
before(async () => {
  testDb = await createTestDb();
});
after(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  __resetMarketDataStoreBackoffForTests();
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
});

async function seed(symbol: string, count: number): Promise<void> {
  const [instrument] = await db
    .insert(instrumentsTable)
    .values({
      symbol,
      assetClass: "equity",
      name: symbol,
      currency: "USD",
      isActive: true,
    })
    .returning({ id: instrumentsTable.id });
  if (!count) {
    return;
  }
  const base = Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000;
  const rows = SOURCES.flatMap((source) =>
    Array.from({ length: count }, (_unused, index) => {
      const price = 100 + index + (source === "massive-history" ? 0 : 0.1);
      return {
        instrumentId: instrument!.id,
        symbol,
        timeframe: TIMEFRAME,
        startsAt: new Date(base + index * 60_000),
        open: String(price),
        high: String(price + 0.5),
        low: String(price - 0.5),
        close: String(price + 0.25),
        volume: String((index + 1) * 1000),
        source,
      };
    }),
  );
  await db.insert(barCacheTable).values(rows);
}

test("loadSignalMonitorLocalBarCache is identical with and without the batch prefetch", async () => {
  await seed("AAPL", 4);
  await seed("MSFT", 3);
  await seed("NVDA", 0); // instrument only, no bars

  const symbols = ["AAPL", "MSFT", "NVDA"];
  const evaluatedAt = new Date();
  const limit = 50;

  const without: Record<string, unknown[]> = {};
  for (const symbol of symbols) {
    without[symbol] = await loadSignalMonitorLocalBarCache({
      symbol,
      timeframe: TIMEFRAME,
      evaluatedAt,
      limit,
    });
  }

  const withPrefetch = await runWithSignalMonitorStoredBarsPrefetch(
    { symbols, timeframes: [TIMEFRAME], evaluatedAt, limit },
    async () => {
      const out: Record<string, unknown[]> = {};
      for (const symbol of symbols) {
        out[symbol] = await loadSignalMonitorLocalBarCache({
          symbol,
          timeframe: TIMEFRAME,
          evaluatedAt,
          limit,
        });
      }
      return out;
    },
  );

  for (const symbol of symbols) {
    assert.deepEqual(
      withPrefetch[symbol],
      without[symbol],
      `prefetch path must equal non-prefetch path for ${symbol}`,
    );
  }
  // Meaningful: bars actually flowed through both paths.
  assert.ok(without["AAPL"]!.length > 0, "AAPL should return bars");
  assert.ok(without["MSFT"]!.length > 0, "MSFT should return bars");
  assert.equal(without["NVDA"]!.length, 0, "NVDA has no bars");
});

test("a mismatched evaluatedAt/limit falls through to the per-symbol path identically", async () => {
  await seed("AAPL", 4);
  const evaluatedAt = new Date();
  const limit = 50;

  const baseline = await loadSignalMonitorLocalBarCache({
    symbol: "AAPL",
    timeframe: TIMEFRAME,
    evaluatedAt,
    limit,
  });

  // Prefetch built for a DIFFERENT limit -> readStoredBars must ignore it and
  // fall back to the per-symbol read, still producing the same bars.
  const mismatched = await runWithSignalMonitorStoredBarsPrefetch(
    { symbols: ["AAPL"], timeframes: [TIMEFRAME], evaluatedAt, limit: limit + 1 },
    async () =>
      loadSignalMonitorLocalBarCache({
        symbol: "AAPL",
        timeframe: TIMEFRAME,
        evaluatedAt,
        limit,
      }),
  );

  assert.deepEqual(mismatched, baseline);
  assert.ok(baseline.length > 0);
});

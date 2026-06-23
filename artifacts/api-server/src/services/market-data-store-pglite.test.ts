import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { barCacheTable, db, instrumentsTable } from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  loadStoredMarketBars,
  __resetMarketDataStoreBackoffForTests,
} from "./market-data-store";

// Bars must sit OUTSIDE the durable store's recent-window (default 60 min): the
// reader intentionally only serves bars older than that boundary. Anchor the
// seed two hours back so the window includes them.
const TWO_HOURS_MS = 2 * 60 * 60_000;

let testDb: TestDatabase;

before(async () => {
  testDb = await createTestDb();
});

after(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  __resetMarketDataStoreBackoffForTests();
  // Fresh state per test: truncate the tables this suite touches.
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
});

test("loadStoredMarketBars returns seeded bar_cache rows via the real reader", async () => {
  const symbol = "AAPL";
  const sourceName = "massive";
  const timeframe = "1m" as const;

  // Seed an instrument, then two bars using the SAME `db` the production reader
  // imports — proving the seam routes both writes and reads to PGlite.
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
  assert.ok(instrument?.id, "instrument should be inserted into PGlite");

  // The reader buckets bars to the timeframe boundary (1m -> floor to minute),
  // so seed on exact minute boundaries to keep returned timestamps equal to the
  // seeded ones.
  const olderTs = new Date(Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000);
  const newerTs = new Date(olderTs.getTime() + 60_000);

  await db.insert(barCacheTable).values([
    {
      instrumentId: instrument.id,
      symbol,
      timeframe,
      startsAt: olderTs,
      open: "100.5",
      high: "101.25",
      low: "100.0",
      close: "101.0",
      volume: "1000",
      source: sourceName,
    },
    {
      instrumentId: instrument.id,
      symbol,
      timeframe,
      startsAt: newerTs,
      open: "101.0",
      high: "102.5",
      low: "100.75",
      close: "102.0",
      volume: "2000",
      source: sourceName,
    },
  ]);

  const bars = await loadStoredMarketBars({
    symbol,
    timeframe,
    sourceName,
    limit: 100,
  });

  assert.equal(bars.length, 2, "both seeded bars should be returned");

  // Ascending by timestamp.
  const [first, second] = bars;
  assert.equal(first.timestamp.getTime(), olderTs.getTime());
  assert.equal(second.timestamp.getTime(), newerTs.getTime());

  // numeric columns come back as strings from pg; the reader coerces to number.
  assert.deepEqual(
    { open: first.open, high: first.high, low: first.low, close: first.close, volume: first.volume },
    { open: 100.5, high: 101.25, low: 100, close: 101, volume: 1000 },
  );
  assert.deepEqual(
    { open: second.open, high: second.high, low: second.low, close: second.close, volume: second.volume },
    { open: 101, high: 102.5, low: 100.75, close: 102, volume: 2000 },
  );
  assert.equal(first.source, sourceName);
});

test("loadStoredMarketBars filters by source and timeframe", async () => {
  const symbol = "MSFT";
  const baseTs = new Date(Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000);

  const [instrument] = await db
    .insert(instrumentsTable)
    .values({ symbol, assetClass: "equity", name: symbol, currency: "USD", isActive: true })
    .returning({ id: instrumentsTable.id });

  await db.insert(barCacheTable).values([
    // wanted
    { instrumentId: instrument.id, symbol, timeframe: "1m", startsAt: baseTs, open: "1", high: "1", low: "1", close: "1", volume: "1", source: "massive" },
    // wrong source
    { instrumentId: instrument.id, symbol, timeframe: "1m", startsAt: new Date(baseTs.getTime() + 60_000), open: "9", high: "9", low: "9", close: "9", volume: "9", source: "ibkr" },
    // wrong timeframe
    { instrumentId: instrument.id, symbol, timeframe: "5m", startsAt: new Date(baseTs.getTime() + 120_000), open: "9", high: "9", low: "9", close: "9", volume: "9", source: "massive" },
  ]);

  const bars = await loadStoredMarketBars({ symbol, timeframe: "1m", sourceName: "massive", limit: 100 });

  assert.equal(bars.length, 1, "only the matching (source, timeframe) bar should return");
  assert.equal(bars[0].close, 1);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { barCacheTable, db, instrumentsTable } from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  loadStoredMarketBars,
  loadStoredMarketBarsForSymbols,
  __resetMarketDataStoreBackoffForTests,
} from "./market-data-store";

// Asserts the batched mirror == the per-symbol reader. Both paths run against the
// SAME in-process PGlite instance, so the equality property holds regardless of any
// PGlite-vs-production-Postgres serialization differences (numeric-as-string,
// timestamptz-as-Date); this proves the two readers agree, not that either matches
// production Postgres byte-for-byte (that is an inherent in-process-emulation limit).
//
// Bars must sit outside the reader's recent-window (default 60 min); anchor 2h back.
const TWO_HOURS_MS = 2 * 60 * 60_000;
const SOURCE = "massive";
const TIMEFRAME = "1m" as const;

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

async function ensureInstrument(symbol: string): Promise<string> {
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
  return instrument!.id;
}

async function insertBars(
  instrumentId: string,
  symbol: string,
  count: number,
  opts: { source?: string; timeframe?: string } = {},
): Promise<void> {
  if (!count) {
    return;
  }
  const base = Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000;
  const rows = Array.from({ length: count }, (_unused, index) => {
    const price = 100 + index;
    return {
      instrumentId,
      symbol,
      timeframe: opts.timeframe ?? TIMEFRAME,
      startsAt: new Date(base + index * 60_000),
      open: String(price),
      high: String(price + 0.5),
      low: String(price - 0.5),
      close: String(price + 0.25),
      volume: String((index + 1) * 1000),
      source: opts.source ?? SOURCE,
    };
  });
  await db.insert(barCacheTable).values(rows);
}

test("batched mirror equals N x loadStoredMarketBars for every symbol", async () => {
  const aapl = await ensureInstrument("AAPL");
  await insertBars(aapl, "AAPL", 5);
  await insertBars(aapl, "AAPL", 2, { source: "ibkr" }); // noise: wrong source
  await insertBars(aapl, "AAPL", 2, { timeframe: "5m" }); // noise: wrong timeframe

  const msft = await ensureInstrument("MSFT");
  await insertBars(msft, "MSFT", 3);

  const nvda = await ensureInstrument("NVDA");
  await insertBars(nvda, "NVDA", 1);

  await ensureInstrument("TSLA"); // instrument only, no bars

  const symbols = ["AAPL", "MSFT", "NVDA", "TSLA"];
  const batched = await loadStoredMarketBarsForSymbols({
    symbols,
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    limit: 100,
  });

  for (const symbol of symbols) {
    const perSymbol = await loadStoredMarketBars({
      symbol,
      timeframe: TIMEFRAME,
      sourceName: SOURCE,
      limit: 100,
    });
    assert.deepEqual(
      batched.get(symbol) ?? [],
      perSymbol,
      `batched mirror must equal per-symbol result for ${symbol}`,
    );
  }

  // Noise excluded identically; empty symbol omitted from the batched map.
  assert.equal((batched.get("AAPL") ?? []).length, 5);
  assert.equal((batched.get("MSFT") ?? []).length, 3);
  assert.equal((batched.get("NVDA") ?? []).length, 1);
  assert.equal(batched.has("TSLA"), false);
});

test("batched mirror matches per-symbol under limit truncation (newest-N)", async () => {
  const aapl = await ensureInstrument("AAPL");
  await insertBars(aapl, "AAPL", 5);

  const batched = await loadStoredMarketBarsForSymbols({
    symbols: ["AAPL"],
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    limit: 2,
  });
  const perSymbol = await loadStoredMarketBars({
    symbol: "AAPL",
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    limit: 2,
  });

  assert.equal((batched.get("AAPL") ?? []).length, 2);
  assert.deepEqual(batched.get("AAPL"), perSymbol);
});

test("empty / unknown symbols return an empty map without querying", async () => {
  const empty = await loadStoredMarketBarsForSymbols({
    symbols: [],
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    limit: 100,
  });
  assert.equal(empty.size, 0);

  const unknown = await loadStoredMarketBarsForSymbols({
    symbols: ["NOPE"],
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    limit: 100,
  });
  assert.equal(unknown.size, 0);
});

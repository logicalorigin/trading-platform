import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { barCacheTable, db } from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  __resetMarketDataStoreBackoffForTests,
  __resetStoreInstrumentCacheForTests,
  persistMarketDataBars,
  persistMarketDataBarsForSymbols,
} from "./market-data-store";

// Proves persistMarketDataBarsForSymbols (the multi-symbol batched upsert used by
// the local-bar-cache flush) writes bar_cache rows byte-identical to N separate
// per-symbol persistMarketDataBars calls. Both run against the same PGlite instance.

const TWO_HOURS_MS = 2 * 60 * 60_000;
const TIMEFRAME = "1m" as const;
const SOURCE = "massive-history";

let testDb: TestDatabase;
before(async () => {
  testDb = await createTestDb();
});
after(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  __resetMarketDataStoreBackoffForTests();
  __resetStoreInstrumentCacheForTests();
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
});

function makeBars(seed: number, count: number) {
  const base = Math.floor((Date.now() - TWO_HOURS_MS) / 60_000) * 60_000;
  return Array.from({ length: count }, (_unused, index) => {
    const price = seed + index;
    return {
      timestamp: new Date(base + index * 60_000),
      open: price,
      high: price + 0.5,
      low: price - 0.5,
      close: price + 0.25,
      volume: (index + 1) * 100,
    };
  });
}

// Compare on the meaningful columns (instrumentId is a per-run random uuid and
// updatedAt is a write timestamp — both legitimately differ between the two paths).
async function readBarCacheRows() {
  const rows = await db
    .select({
      symbol: barCacheTable.symbol,
      timeframe: barCacheTable.timeframe,
      source: barCacheTable.source,
      startsAt: barCacheTable.startsAt,
      open: barCacheTable.open,
      high: barCacheTable.high,
      low: barCacheTable.low,
      close: barCacheTable.close,
      volume: barCacheTable.volume,
    })
    .from(barCacheTable);
  return rows
    .map((r) => ({
      symbol: r.symbol,
      timeframe: r.timeframe,
      source: r.source,
      startsAt: (r.startsAt instanceof Date
        ? r.startsAt
        : new Date(r.startsAt)
      ).getTime(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }))
    .sort((a, b) =>
      a.symbol === b.symbol ? a.startsAt - b.startsAt : a.symbol < b.symbol ? -1 : 1,
    );
}

const batchParams = {
  assetClass: "equity" as const,
  outsideRth: true,
  source: "trades" as const,
  recentWindowMinutes: 0,
};

test("persistMarketDataBarsForSymbols writes the same rows as N x persistMarketDataBars", async () => {
  const bySymbol = [
    { symbol: "AAPL", bars: makeBars(100, 4) },
    { symbol: "MSFT", bars: makeBars(200, 3) },
    { symbol: "NVDA", bars: makeBars(300, 5) },
  ];

  // Multi-symbol batched path.
  const ok = await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    ...batchParams,
    bySymbol,
  });
  assert.equal(ok, true);
  const batched = await readBarCacheRows();
  assert.equal(batched.length, 12, "all 4+3+5 bars stored");

  // Reset and replay via the per-symbol path.
  __resetStoreInstrumentCacheForTests();
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
  for (const group of bySymbol) {
    const r = await persistMarketDataBars({
      request: { symbol: group.symbol, timeframe: TIMEFRAME, ...batchParams },
      sourceName: SOURCE,
      bars: group.bars,
    });
    assert.equal(r, "success");
  }
  const perSymbol = await readBarCacheRows();

  assert.deepEqual(batched, perSymbol);
});

test("batched upsert overwrites on conflict identically to per-symbol", async () => {
  const first = [{ symbol: "AAPL", bars: makeBars(100, 3) }];
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    ...batchParams,
    bySymbol: first,
  });
  // Re-write the same timestamps with new values via the batched path.
  const updated = [{ symbol: "AAPL", bars: makeBars(500, 3) }];
  await persistMarketDataBarsForSymbols({
    timeframe: TIMEFRAME,
    sourceName: SOURCE,
    ...batchParams,
    bySymbol: updated,
  });
  const batched = await readBarCacheRows();

  // Per-symbol reference: write then overwrite the same way.
  __resetStoreInstrumentCacheForTests();
  await testDb.client.exec(
    "truncate table bar_cache, instruments restart identity cascade",
  );
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: makeBars(100, 3),
  });
  await persistMarketDataBars({
    request: { symbol: "AAPL", timeframe: TIMEFRAME, ...batchParams },
    sourceName: SOURCE,
    bars: makeBars(500, 3),
  });
  const perSymbol = await readBarCacheRows();

  assert.equal(batched.length, 3, "still 3 rows after conflict-update");
  assert.deepEqual(batched, perSymbol);
  assert.equal(batched[0]!.open, 500, "values updated to the second write");
});

test("empty input returns false and writes nothing", async () => {
  assert.equal(
    await persistMarketDataBarsForSymbols({
      timeframe: TIMEFRAME,
      sourceName: SOURCE,
      ...batchParams,
      bySymbol: [],
    }),
    false,
  );
  assert.equal(
    await persistMarketDataBarsForSymbols({
      timeframe: TIMEFRAME,
      sourceName: SOURCE,
      ...batchParams,
      bySymbol: [{ symbol: "AAPL", bars: [] }],
    }),
    false,
  );
  assert.equal((await readBarCacheRows()).length, 0);
});

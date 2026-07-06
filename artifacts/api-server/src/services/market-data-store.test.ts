import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __storedBarAlignmentSecondsForTests,
  __expandStoredRowsLimitForTests,
  __handleMarketDataStoreErrorForTests,
  __resetMarketDataStoreBackoffForTests,
  normalizeBarsToStoreTimeframe,
  shouldUseDurableMarketDataStore,
  type MarketDataStoreBarInput,
} from "./market-data-store";

const REQUEST = { symbol: "AAPL", timeframe: "1m" } as const;
const source = readFileSync(new URL("./market-data-store.ts", import.meta.url), "utf8");

test("pool-acquire timeout does NOT disable the durable store (used to be a permanent kill)", () => {
  __resetMarketDataStoreBackoffForTests();
  // The cold-start read burst throws this exact pg-pool message.
  __handleMarketDataStoreErrorForTests(
    new Error("timeout exceeded when trying to connect"),
  );
  assert.equal(
    shouldUseDurableMarketDataStore(REQUEST),
    true,
    "pool contention must not trip the store backoff",
  );
  __resetMarketDataStoreBackoffForTests();
});

test("a non-contention DB error time-boxes the store, then it self-heals", () => {
  __resetMarketDataStoreBackoffForTests();
  __handleMarketDataStoreErrorForTests(
    new Error('relation "bar_cache" does not exist'),
  );
  assert.equal(
    shouldUseDurableMarketDataStore(REQUEST),
    false,
    "a genuine error opens the (time-boxed) backoff so reads bypass the store",
  );
  __resetMarketDataStoreBackoffForTests();
  assert.equal(
    shouldUseDurableMarketDataStore(REQUEST),
    true,
    "store recovers once the backoff clears",
  );
});

test("aligned fixed-step intraday timeframes do not expand durable cache reads", () => {
  for (const timeframe of ["15s", "10m", "15m", "30m", "1h", "4h"] as const) {
    assert.equal(
      __expandStoredRowsLimitForTests(360, timeframe),
      360,
      `${timeframe} should read exactly the requested aligned row count`,
    );
  }
});

test("coarse native timeframes do not use fixed-step timestamp alignment", () => {
  for (const timeframe of ["12h", "1d", "1w", "1month", "1year"] as const) {
    assert.equal(__storedBarAlignmentSecondsForTests(timeframe), null);
    assert.equal(
      __expandStoredRowsLimitForTests(360, timeframe),
      360,
      `${timeframe} should not over-fetch cached rows`,
    );
  }
});

test("fixed-step reader alignment matches timeframe seconds", () => {
  assert.equal(__storedBarAlignmentSecondsForTests("15s"), 15);
  assert.equal(__storedBarAlignmentSecondsForTests("15m"), 900);
  assert.equal(__storedBarAlignmentSecondsForTests("1h"), 3600);
});

test("write normalization floors off-grid timestamps onto the epoch grid (guards the 2026-04 corruption)", () => {
  // A retired backfill wrote minute-resolution Massive-history timestamps (:59/:04/
  // :09) under 5m/15m WITHOUT flooring, so raw off-grid rows coexisted with the
  // canonical aligned bars under the (instrument,timeframe,source,starts_at) unique
  // key (~13k rows across SPY/QQQ/AAPL). The live writer already floors via
  // normalizeBarsToStoreTimeframe; this pins that invariant so it cannot regress.
  const bar = (iso: string, close: number): MarketDataStoreBarInput => ({
    timestamp: new Date(iso),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  });
  for (const [timeframe, stepMs] of [
    ["5m", 300_000],
    ["15m", 900_000],
  ] as const) {
    const out = normalizeBarsToStoreTimeframe(
      [
        bar("2026-04-27T22:59:00Z", 1),
        bar("2026-04-27T23:04:00Z", 2),
        bar("2026-04-27T23:09:00Z", 3),
      ],
      timeframe,
    );
    assert.ok(out.length > 0, `${timeframe} produced no bars`);
    for (const b of out) {
      assert.equal(
        b.timestamp.getTime() % stepMs,
        0,
        `${timeframe}: ${b.timestamp.toISOString()} must land on the epoch grid`,
      );
    }
  }
  // Specific floor: a :59 bar lands in the :55 5m bucket, never a new :59 row.
  const floored = normalizeBarsToStoreTimeframe([bar("2026-04-27T22:59:00Z", 42)], "5m");
  assert.equal(floored[0]?.timestamp.toISOString(), "2026-04-27T22:55:00.000Z");
});

test("multi-symbol bar-cache writer resolves instruments in one batch", () => {
  const start = source.indexOf("export async function persistMarketDataBarsForSymbols");
  const end = source.indexOf("// Notify", start);
  const block = source.slice(start, end === -1 ? undefined : end);

  assert.match(block, /ensureStoreInstruments\(/);
  assert.doesNotMatch(block, /await ensureStoreInstrument\(/);
});

test("bar-cache writes chunk to the Postgres bind-parameter ceiling", () => {
  assert.match(
    source,
    /const BAR_CACHE_WRITE_BATCH_SIZE = 5000;/,
    "bar_cache write chunks size to the 11-param/row 65535-param ceiling (~5957 max) so a full flush is one statement",
  );
  assert.doesNotMatch(source, /STORE_BATCH_SIZE/);
});

test("mixed bar-cache writer merges tuples into one chunked upsert", () => {
  const start = source.indexOf(
    "export async function persistMarketDataBarsMixed",
  );
  assert(start !== -1, "persistMarketDataBarsMixed writer must exist");
  const block = source.slice(start);

  // Resolves all distinct symbols in one batch, not one SELECT per symbol.
  assert.match(block, /ensureStoreInstruments\(/);
  assert.doesNotMatch(block, /await ensureStoreInstrument\(/);
  // Chunks by the shared batch-size constant (one statement per <=5000-row chunk).
  assert.match(block, /offset \+= BAR_CACHE_WRITE_BATCH_SIZE/);
  // Same composite conflict target as the per-symbol writer — the target already
  // carries timeframe + source, so one statement legally spans mixed tuples.
  assert.match(block, /barCacheTable\.instrumentId,/);
  assert.match(block, /barCacheTable\.timeframe,/);
  assert.match(block, /barCacheTable\.source,/);
  assert.match(block, /barCacheTable\.startsAt,/);
  // Row-changed setWhere is preserved so no-op re-upserts are skipped.
  assert.match(block, /setWhere: barCacheRowChangedPredicate/);
});

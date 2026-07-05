import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __storedBarAlignmentSecondsForTests,
  __expandStoredRowsLimitForTests,
  __handleMarketDataStoreErrorForTests,
  __resetMarketDataStoreBackoffForTests,
  shouldUseDurableMarketDataStore,
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

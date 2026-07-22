import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildBarCacheUpsertQuery,
  __storedBarAlignmentSecondsForTests,
  __expandStoredRowsLimitForTests,
  __handleMarketDataStoreErrorForTests,
  __resetMarketDataStoreBackoffForTests,
  isDurableMarketDataStoreRequestEligible,
  normalizeBarsToStoreTimeframe,
  persistMarketDataBars,
  shouldUseDurableMarketDataStore,
  type MarketDataStoreBarInput,
} from "./market-data-store";

const REQUEST = { symbol: "AAPL", timeframe: "1m" } as const;
const source = readFileSync(
  new URL("./market-data-store.ts", import.meta.url),
  "utf8",
);

test("bar-cache upsert SQL uses a constant parameter count for every batch size", () => {
  const updatedAt = new Date("2026-07-17T00:00:00.000Z");
  const row = {
    instrumentId: "11111111-1111-4111-8111-111111111111",
    symbol: "AAPL",
    timeframe: "1m" as const,
    startsAt: new Date("2026-07-16T20:00:00.000Z"),
    open: "100",
    high: "101",
    low: "99",
    close: "100.5",
    volume: "1000",
    source: "massive-history",
  };
  const dialect = new PgDialect();
  const oneRow = dialect.sqlToQuery(buildBarCacheUpsertQuery([row], updatedAt));
  const fullBatch = dialect.sqlToQuery(
    buildBarCacheUpsertQuery(
      Array.from({ length: 5_000 }, (_unused, index) => ({
        ...row,
        startsAt: new Date(row.startsAt.getTime() + index * 60_000),
      })),
      updatedAt,
    ),
  );

  assert.equal(oneRow.params.length, 11);
  assert.equal(fullBatch.params.length, 11);
  assert.equal(fullBatch.sql, oneRow.sql);
});

test("pool-acquire timeout does NOT disable the durable store (used to be a permanent kill)", () => {
  __resetMarketDataStoreBackoffForTests();
  // The cold-start read burst throws this exact pg-pool message.
  assert.equal(
    __handleMarketDataStoreErrorForTests(
      new Error("timeout exceeded when trying to connect"),
    ),
    "retryable",
  );
  assert.equal(
    shouldUseDurableMarketDataStore(REQUEST),
    true,
    "pool contention must not trip the store backoff",
  );
  __resetMarketDataStoreBackoffForTests();
});

test("a terminal query error does not disable unrelated durable-store keys", () => {
  __resetMarketDataStoreBackoffForTests();
  assert.equal(
    __handleMarketDataStoreErrorForTests(
      new Error('relation "bar_cache" does not exist'),
    ),
    "terminal",
  );
  assert.equal(
    shouldUseDurableMarketDataStore(REQUEST),
    true,
    "a query-local/schema failure must not manufacture global cache misses",
  );
  __resetMarketDataStoreBackoffForTests();
  assert.equal(
    shouldUseDurableMarketDataStore(REQUEST),
    true,
    "store recovers once the backoff clears",
  );
});

test("a transient connection error is retryable while the store backoff is active", () => {
  __resetMarketDataStoreBackoffForTests();
  const error = Object.assign(new Error("connection reset by peer"), {
    code: "ECONNRESET",
  });
  assert.equal(__handleMarketDataStoreErrorForTests(error), "retryable");
  assert.equal(shouldUseDurableMarketDataStore(REQUEST), false);
  __resetMarketDataStoreBackoffForTests();
});

test("a bar-cache statement timeout is retryable without a global store backoff", () => {
  __resetMarketDataStoreBackoffForTests();
  const error = Object.assign(
    new Error("canceling statement due to statement timeout"),
    { code: "57014" },
  );
  assert.equal(__handleMarketDataStoreErrorForTests(error), "retryable");
  assert.equal(
    shouldUseDurableMarketDataStore(REQUEST),
    true,
    "one slow query must not disable every symbol/timeframe",
  );
  __resetMarketDataStoreBackoffForTests();
});

test("durable bar-cache request eligibility excludes deterministic non-writes without consulting backoff", () => {
  __resetMarketDataStoreBackoffForTests();
  __handleMarketDataStoreErrorForTests(new Error("connection terminated unexpectedly"));

  assert.equal(isDurableMarketDataStoreRequestEligible(REQUEST), true);
  assert.equal(
    isDurableMarketDataStoreRequestEligible({
      ...REQUEST,
      assetClass: "option",
    }),
    false,
  );
  assert.equal(
    isDurableMarketDataStoreRequestEligible({
      ...REQUEST,
      providerContractId: "O:AAPL260717C00200000",
    }),
    false,
  );
  assert.equal(
    isDurableMarketDataStoreRequestEligible({ ...REQUEST, source: "midpoint" }),
    false,
  );
  __resetMarketDataStoreBackoffForTests();
});

test("durable bar-cache persistence classifies empty work and active backoff explicitly", async () => {
  __resetMarketDataStoreBackoffForTests();
  assert.equal(
    await persistMarketDataBars({
      request: REQUEST,
      sourceName: "test",
      bars: [],
    }),
    "terminal",
  );

  __handleMarketDataStoreErrorForTests(
    new Error("connection terminated unexpectedly"),
  );
  assert.equal(
    await persistMarketDataBars({
      request: REQUEST,
      sourceName: "test",
      bars: [
        {
          timestamp: new Date("2026-07-16T18:00:00.000Z"),
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
        },
      ],
    }),
    "retryable",
  );
  __resetMarketDataStoreBackoffForTests();
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

test("bar-cache writes retain a bounded statement payload", () => {
  assert.match(
    source,
    /const BAR_CACHE_WRITE_BATCH_SIZE = 5000;/,
    "bar_cache write chunks bound each statement payload and RETURNING set",
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
  // Every writer shares the constant-shape raw upsert, including its composite
  // conflict target and row-changed predicate.
  assert.match(block, /upsertBarCacheRows\(batch, now\)/);
  assert.doesNotMatch(block, /\.insert\(barCacheTable\)/);
  assert.match(source, /on conflict \(symbol, timeframe, source, starts_at\)/);
  assert.match(source, /where \$\{barCacheRowChangedPredicate\}/);
});

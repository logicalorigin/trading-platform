import assert from "node:assert/strict";
import test from "node:test";

import {
  __expandStoredRowsLimitForTests,
  __handleMarketDataStoreErrorForTests,
  __resetMarketDataStoreBackoffForTests,
  shouldUseDurableMarketDataStore,
} from "./market-data-store";

const REQUEST = { symbol: "AAPL", timeframe: "1m" } as const;

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

test("native long timeframes do not expand durable cache reads", () => {
  for (const timeframe of ["10m", "12h", "1w", "1month", "1year"] as const) {
    assert.equal(
      __expandStoredRowsLimitForTests(360, timeframe),
      360,
      `${timeframe} should read exactly the requested cached row count`,
    );
  }
});

test("synthetic rollup timeframes still expand cache reads enough to normalize", () => {
  assert.equal(__expandStoredRowsLimitForTests(10, "15s"), 150);
  assert.equal(__expandStoredRowsLimitForTests(10, "30m"), 300);
  assert.equal(__expandStoredRowsLimitForTests(10, "4h"), 2400);
});

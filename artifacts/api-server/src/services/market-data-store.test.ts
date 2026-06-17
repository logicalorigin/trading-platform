import assert from "node:assert/strict";
import test from "node:test";

import {
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

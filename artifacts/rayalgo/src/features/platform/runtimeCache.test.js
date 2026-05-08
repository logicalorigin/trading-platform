import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChartBarsCacheKey,
  buildFlowEventsCacheKey,
  buildOptionChainSnapshotCacheKey,
  isRuntimeCacheEntryFresh,
} from "./runtimeCache.js";

test("runtime cache keys normalize identity components", () => {
  assert.equal(
    buildChartBarsCacheKey({
      symbol: " spy ",
      timeframe: "5m",
      session: "regular+extended",
      source: "trade:equity",
      identity: "primary|500",
    }),
    "bars:SPY:5m:regular+extended:trade_equity:primary_500",
  );
  assert.equal(
    buildFlowEventsCacheKey({
      ticker: " aapl ",
      provider: "trade-flow",
      filterSignature: "5m:60",
    }),
    "flow:AAPL:trade-flow:5m_60",
  );
  assert.equal(
    buildOptionChainSnapshotCacheKey({
      underlying: "qqq",
      expiration: "all",
      coverage: "window",
      marketDataMode: "metadata",
    }),
    "options:QQQ:all:window:metadata",
  );
});

test("runtime cache freshness requires a future expiration", () => {
  assert.equal(
    isRuntimeCacheEntryFresh({ expiresAt: 1_001 }, 1_000),
    true,
  );
  assert.equal(
    isRuntimeCacheEntryFresh({ expiresAt: 999 }, 1_000),
    false,
  );
  assert.equal(isRuntimeCacheEntryFresh(null, 1_000), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_CACHE_CLASS,
  RUNTIME_CACHE_POLICIES,
  buildAccountHistoryCacheKey,
  buildChartBarsCacheKey,
  buildFlowEventsCacheKey,
  buildOptionChainSnapshotCacheKey,
  isRuntimeCacheEntryFresh,
  isRuntimeCacheEntryUsable,
  runtimeCacheMetaFromEntry,
  stripRuntimeCacheMeta,
  withRuntimeCacheMeta,
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
      provider: "massive",
    }),
    "options:QQQ:all:window:metadata:massive",
  );
  assert.equal(
    buildAccountHistoryCacheKey({
      accountId: "shadow",
      mode: "paper",
      environment: "paper",
      range: "1Y",
      assetClass: "options",
      benchmark: "SPY",
      source: "equity-history",
      filters: { tag: "runner" },
    }),
    'account:shadow:paper:paper:1Y:options:SPY:equity-history:{"tag"_"runner"}',
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

test("runtime cache stale window stays usable after fresh expiration", () => {
  const entry = {
    updatedAt: 500,
    expiresAt: 900,
    staleExpiresAt: 1_500,
  };
  assert.equal(isRuntimeCacheEntryFresh(entry, 1_000), false);
  assert.equal(isRuntimeCacheEntryUsable(entry, 1_000), true);
  assert.equal(isRuntimeCacheEntryUsable(entry, 1_600), false);
});

test("runtime cache metadata marks stale records and preserves source", () => {
  assert.deepEqual(
    runtimeCacheMetaFromEntry(
      {
        updatedAt: 500,
        expiresAt: 900,
        staleExpiresAt: 1_500,
        source: "massive",
        provider: "massive",
      },
      1_000,
    ),
    {
      cacheStatus: "stale",
      cacheAgeMs: 500,
      stale: true,
      updatedAt: 500,
      source: "massive",
      provider: "massive",
    },
  );
});

test("runtime cache metadata is attached and stripped without mutating payload", () => {
  const payload = { bars: [1] };
  const meta = { cacheStatus: "hit", stale: false };
  const hydrated = withRuntimeCacheMeta(payload, meta);
  assert.deepEqual(payload, { bars: [1] });
  assert.deepEqual(hydrated, { bars: [1], runtimeCache: meta });
  assert.deepEqual(stripRuntimeCacheMeta(hydrated), { bars: [1] });
});

test("runtime cache policy blocks persisted live-critical data", () => {
  assert.equal(RUNTIME_CACHE_POLICIES[RUNTIME_CACHE_CLASS.liveCritical].persist, false);
  assert.equal(
    RUNTIME_CACHE_POLICIES[RUNTIME_CACHE_CLASS.managementLive].allowActionFromStale,
    false,
  );
  assert.equal(RUNTIME_CACHE_POLICIES[RUNTIME_CACHE_CLASS.historicalHeavy].persist, true);
});

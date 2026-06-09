import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

type TestShadowPositionsResponse = {
  positions: Array<{ id: string; symbol: string; assetClass: string }>;
  totals: Record<string, unknown>;
  stale?: boolean;
  reason?: string;
};

test("shadow read cache serves stale values immediately while refresh continues", async () => {
  const key = `test-shadow-read-immediate-${Date.now()}-${Math.random()}`;
  let resolveRefresh: (value: TestShadowPositionsResponse) => void = () => {
    throw new Error("refresh promise was not initialized");
  };
  let refreshStarted = false;

  internals.setShadowReadCacheWindowsForTests({
    ttlMs: 5,
    staleTtlMs: 1_000,
    staleWaitMs: 250,
  });

  try {
    await internals.withShadowReadCache(
      key,
      async () => ({
        positions: [{ id: "cached", symbol: "CACHED", assetClass: "stock" }],
        totals: {},
      }),
      { allowStale: () => true },
    );

    await new Promise((resolve) => setTimeout(resolve, 15));

    const refresh = new Promise<TestShadowPositionsResponse>((resolve) => {
      resolveRefresh = resolve;
    });

    const startedAt = Date.now();
    const stale = await internals.withShadowReadCache(
      key,
      () => {
        refreshStarted = true;
        return refresh;
      },
      {
        allowStale: () => true,
        staleStrategy: "immediate",
      },
    );

    assert.equal(refreshStarted, true);
    assert.equal(stale.stale, true);
    assert.equal(stale.reason, "shadow_read_stale_cache");
    assert.equal(stale.positions[0]?.id, "cached");
    assert.ok(
      Date.now() - startedAt < 100,
      "stale value should return without waiting for the refresh",
    );

    resolveRefresh({
      positions: [{ id: "fresh", symbol: "FRESH", assetClass: "stock" }],
      totals: {},
    });
    await refresh;
  } finally {
    internals.setShadowReadCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
      staleWaitMs: null,
    });
  }
});

test("shadow option quote cache keeps stale display quotes during live refresh gaps", async () => {
  const providerContractId = `twsopt:test-${Date.now()}-${Math.random()}`;
  const positions = [
    {
      optionContract: {
        ticker: providerContractId,
        underlying: "SPY",
        expirationDate: new Date("2026-06-12T00:00:00.000Z"),
        strike: 600,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId,
      },
    },
  ];

  internals.clearShadowOptionQuoteCachesForTests();
  internals.setShadowOptionQuoteCacheWindowsForTests({
    ttlMs: 5,
    staleTtlMs: 1_000,
  });

  try {
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      bid: 1.23,
      ask: 1.35,
      updatedAt: "2026-06-08T15:56:31.004Z",
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    const freshOnly =
      internals.readCachedShadowOptionQuotesForTests(positions);
    assert.equal(freshOnly.size, 0);

    const staleAllowed =
      internals.readCachedShadowOptionQuotesForTests(positions, {
        allowStale: true,
      });
    assert.equal(staleAllowed.size, 1);
    assert.equal(
      (staleAllowed.get(providerContractId) as Record<string, unknown>)?.bid,
      1.23,
    );
  } finally {
    internals.clearShadowOptionQuoteCachesForTests();
    internals.setShadowOptionQuoteCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
    });
  }
});

test("shadow option quote cache does not replace display quotes with empty updates", () => {
  const providerContractId = `twsopt:test-empty-${Date.now()}-${Math.random()}`;
  const positions = [
    {
      optionContract: {
        ticker: providerContractId,
        underlying: "SPY",
        expirationDate: new Date("2026-06-12T00:00:00.000Z"),
        strike: 600,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId,
      },
    },
  ];

  internals.clearShadowOptionQuoteCachesForTests();
  internals.setShadowOptionQuoteCacheWindowsForTests({
    ttlMs: 1_000,
    staleTtlMs: 1_000,
  });

  try {
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      bid: 2.1,
      ask: 2.3,
      updatedAt: "2026-06-08T15:56:31.004Z",
    });
    internals.rememberShadowOptionQuoteForTests(providerContractId, {
      providerContractId,
      updatedAt: "2026-06-08T15:56:32.004Z",
    });

    const quotes = internals.readCachedShadowOptionQuotesForTests(positions);
    assert.equal(quotes.size, 1);
    assert.equal(
      (quotes.get(providerContractId) as Record<string, unknown>)?.bid,
      2.1,
    );
    assert.equal(
      (quotes.get(providerContractId) as Record<string, unknown>)?.ask,
      2.3,
    );
  } finally {
    internals.clearShadowOptionQuoteCachesForTests();
    internals.setShadowOptionQuoteCacheWindowsForTests({
      ttlMs: null,
      staleTtlMs: null,
    });
  }
});

test("shadow account positions use immediate stale cache strategy", () => {
  const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function getShadowAccountPositions");
  const end = source.indexOf("function dateFromShadowPositionResponse", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(block, /allowStale:\s*shadowReadCacheValueHasRows/);
  assert.match(block, /staleStrategy:\s*"immediate"/);
  assert.doesNotMatch(block, /staleStrategy:\s*"never"/);
});

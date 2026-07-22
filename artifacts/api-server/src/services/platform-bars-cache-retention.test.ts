import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  __platformBarsCacheTestInternals,
  __resetOptionChainCachesForTests,
  getBarsWithDebug,
} from "./platform";

const realDateNow = Date.now;

const input = {
  symbol: "CACHE",
  timeframe: "1m" as const,
  limit: 1,
  to: new Date("2026-07-14T14:00:00.000Z"),
  assetClass: "equity" as const,
  outsideRth: true,
  source: "trades" as const,
};

const result = (close: number) =>
  ({
    symbol: input.symbol,
    timeframe: input.timeframe,
    bars: [
      {
        timestamp: new Date("2026-07-14T13:59:00.000Z"),
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
        source: "massive-history",
        partial: false,
        delayed: false,
        dataUpdatedAt: new Date("2026-07-14T14:00:00.000Z"),
      },
    ],
    transport: null,
    delayed: false,
    gapFilled: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-07-14T14:00:00.000Z"),
    ageMs: 0,
    emptyReason: null,
    historySource: "massive-history",
    studyFallback: false,
    historyPage: {
      requestedFrom: null,
      requestedTo: input.to,
      oldestBarAt: new Date("2026-07-14T13:59:00.000Z"),
      newestBarAt: new Date("2026-07-14T13:59:00.000Z"),
      returnedCount: 1,
      nextBefore: null,
      provider: "massive-history",
      exhaustedBefore: true,
      providerCursor: null,
      providerNextUrl: null,
      providerPageCount: 1,
      providerPageLimitReached: false,
      historyCursor: null,
      hydrationStatus: "warm",
      cacheStatus: null,
    },
  }) as never;

beforeEach(() => {
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
});

afterEach(() => {
  Date.now = realDateNow;
  __platformBarsCacheTestInternals.setBarsLoaderForTests(null);
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
});

test("settled bars-cache retention defaults on and supports an explicit write opt-out", () => {
  const { shouldRetainSettledBarsCacheEntry } =
    __platformBarsCacheTestInternals;

  assert.equal(shouldRetainSettledBarsCacheEntry({}), true);
  assert.equal(
    shouldRetainSettledBarsCacheEntry({ retainSettledCacheEntry: true }),
    true,
  );
  assert.equal(
    shouldRetainSettledBarsCacheEntry({ retainSettledCacheEntry: false }),
    false,
  );
});

test("a retaining in-flight joiner upgrades an opt-out creator's settled retention", async () => {
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loaderStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  __platformBarsCacheTestInternals.setBarsLoaderForTests(async () => {
    calls += 1;
    started();
    await gate;
    return result(101);
  });

  const optOut = getBarsWithDebug(input, {
    retainSettledCacheEntry: false,
  });
  await loaderStarted;
  const retainingJoiner = getBarsWithDebug(input);
  release();

  const [creatorValue, joinerValue] = await Promise.all([
    optOut,
    retainingJoiner,
  ]);
  assert.equal(creatorValue.debug.cacheStatus, "miss");
  assert.equal(joinerValue.debug.cacheStatus, "inflight");

  const later = await getBarsWithDebug(input);
  assert.equal(later.debug.cacheStatus, "hit");
  assert.equal(calls, 1);
});

test("an opt-out joiner cannot downgrade a retaining in-flight creator", async () => {
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loaderStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  __platformBarsCacheTestInternals.setBarsLoaderForTests(async () => {
    calls += 1;
    started();
    await gate;
    return result(101);
  });

  const retainingCreator = getBarsWithDebug(input);
  await loaderStarted;
  const optOutJoiner = getBarsWithDebug(input, {
    retainSettledCacheEntry: false,
  });
  release();
  await Promise.all([retainingCreator, optOutJoiner]);

  const later = await getBarsWithDebug(input);
  assert.equal(later.debug.cacheStatus, "hit");
  assert.equal(calls, 1);
});

test("aborting an in-flight creator does not cancel a non-aborted joiner", async () => {
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const loaderStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  __platformBarsCacheTestInternals.setBarsLoaderForTests(
    async (_input, options) => {
      calls += 1;
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new Error("loader aborted"));
        options.signal?.addEventListener("abort", onAbort, { once: true });
        release = () => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve(result(303));
        };
        started();
      });
    },
  );

  const controller = new AbortController();
  const creator = getBarsWithDebug(input, { signal: controller.signal });
  await loaderStarted;
  const joiner = getBarsWithDebug(input).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  controller.abort();
  await assert.rejects(creator, /aborted/i);
  release();
  const joined = await joiner;

  assert.equal(joined.ok, true);
  if (joined.ok) {
    assert.equal(joined.value.debug.cacheStatus, "inflight");
    assert.equal(joined.value.bars[0]?.close, 303);
  }
  assert.equal(calls, 1);
});

test("two opt-out participants share one flight without retaining its result", async () => {
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loaderStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  __platformBarsCacheTestInternals.setBarsLoaderForTests(async () => {
    calls += 1;
    started();
    if (calls === 1) {
      await gate;
    }
    return result(101 + calls);
  });

  const creator = getBarsWithDebug(input, {
    retainSettledCacheEntry: false,
  });
  await loaderStarted;
  const joiner = getBarsWithDebug(input, {
    retainSettledCacheEntry: false,
  });
  release();
  await Promise.all([creator, joiner]);

  const later = await getBarsWithDebug(input, {
    retainSettledCacheEntry: false,
  });
  assert.equal(later.debug.cacheStatus, "miss");
  assert.equal(calls, 2);
});

test("an opt-out stale hit awaits and consumes a non-retained refresh", async () => {
  const seededAt = Date.parse("2026-07-14T15:00:00.000Z");
  Date.now = () => seededAt;
  __platformBarsCacheTestInternals.setBarsLoaderForTests(async () =>
    result(101),
  );
  const seeded = await getBarsWithDebug(input);
  assert.equal(seeded.bars[0]?.close, 101);

  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loaderStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  __platformBarsCacheTestInternals.setBarsLoaderForTests(async () => {
    started();
    await gate;
    return result(202);
  });
  // Completed-window entries are fresh for ten minutes and stale-serveable
  // for another 9.5 minutes. Move just into that stale-only interval.
  Date.now = () => seededAt + 10 * 60_000 + 1;

  let settled = false;
  const refreshed = getBarsWithDebug(input, {
    retainSettledCacheEntry: false,
  }).then((value) => {
    settled = true;
    return value;
  });
  await loaderStarted;
  await Promise.resolve();
  const settledBeforeRefresh = settled;
  release();
  const value = await refreshed;

  assert.equal(settledBeforeRefresh, false);
  assert.equal(value.debug.cacheStatus, "miss");
  assert.equal(value.bars[0]?.close, 202);
});

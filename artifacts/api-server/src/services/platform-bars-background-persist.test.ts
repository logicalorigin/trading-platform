import assert from "node:assert/strict";
import test from "node:test";

import {
  __platformBarsCacheTestInternals,
  __resetOptionChainCachesForTests,
} from "./platform";

const waitTurn = () => new Promise((resolve) => setImmediate(resolve));

function makePersistInput(symbol: string) {
  return {
    request: {
      symbol,
      timeframe: "1m" as const,
      assetClass: "equity" as const,
      outsideRth: true,
      source: "trades" as const,
      recentWindowMinutes: 0,
    },
    sourceName: "massive-history",
    bars: [
      {
        timestamp: new Date("2026-07-02T14:30:00.000Z"),
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
    ],
  };
}

test("background bar-cache persists drain one at a time by default", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });

  const releases: Array<() => void> = [];
  const started: string[] = [];
  let running = 0;
  let maxRunning = 0;

  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async (input) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        started.push(input.request.symbol);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        running -= 1;
        return true;
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("AAA"),
    );
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("BBB"),
    );
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("CCC"),
    );

    assert.deepEqual(started, ["AAA"]);
    assert.deepEqual(
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics(),
      {
        active: 1,
        queued: 2,
        concurrency: 1,
        enqueued: 3,
        completed: 0,
        failed: 0,
        maxQueueLength: 2,
      },
    );

    releases.shift()?.();
    await waitTurn();
    assert.deepEqual(started, ["AAA", "BBB"]);

    releases.shift()?.();
    await waitTurn();
    assert.deepEqual(started, ["AAA", "BBB", "CCC"]);

    releases.shift()?.();
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.equal(maxRunning, 1);
    assert.equal(
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics()
        .completed,
      3,
    );
  } finally {
    while (releases.length) {
      releases.shift()?.();
    }
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
    if (previousConcurrency === undefined) {
      delete process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
    } else {
      process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = previousConcurrency;
    }
  }
});

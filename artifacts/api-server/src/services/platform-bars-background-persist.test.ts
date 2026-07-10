import assert from "node:assert/strict";
import test from "node:test";

import {
  __platformBarsCacheTestInternals,
  __resetOptionChainCachesForTests,
} from "./platform";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

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
        skipped: 0,
        pressureSkipped: 0,
        coalesced: 0,
        activeCoalesceCandidates: 0,
        dropped: 0,
        droppedForPressure: 0,
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

test("background bar-cache persist yields to hard DB-pool pressure", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  let calls = 0;
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => {
        calls += 1;
        return true;
      },
    );
    updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });
    updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("PRESSURE"),
    );
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    const diagnostics =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(calls, 0);
    assert.equal(diagnostics.active, 0);
    assert.equal(diagnostics.queued, 0);
    assert.equal(diagnostics.enqueued, 1);
    assert.equal(diagnostics.completed, 0);
    assert.equal(diagnostics.failed, 0);
    assert.equal(diagnostics.skipped, 1);
    assert.equal(diagnostics.pressureSkipped, 1);
  } finally {
    __resetApiResourcePressureForTests();
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
    if (previousConcurrency === undefined) {
      delete process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
    } else {
      process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = previousConcurrency;
    }
  }
});

test("background bar-cache persist sheds oldest excess work under pressure", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  const previousShedDepth = process.env.BARS_PERSIST_SHED_QUEUE_DEPTH;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  process.env.BARS_PERSIST_SHED_QUEUE_DEPTH = "2";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  const releases: Array<() => void> = [];
  const started: string[] = [];
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async (input) => {
        started.push(input.request.symbol);
        if (input.request.symbol === "HOLD") {
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        }
        return true;
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("HOLD"),
    );
    updateApiResourcePressure({
      dbPoolActive: 12,
      dbPoolWaiting: 1,
      dbPoolMax: 12,
    });
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("A"),
    );
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("B"),
    );

    const atThreshold =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(atThreshold.active, 1);
    assert.equal(atThreshold.queued, 2);
    assert.equal(atThreshold.dropped, 0);
    assert.equal(atThreshold.droppedForPressure, 0);

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("C"),
    );
    const shed =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(shed.active, 1);
    assert.equal(shed.queued, 2);
    assert.equal(shed.dropped, 1);
    assert.equal(shed.droppedForPressure, 1);

    releases.shift()?.();
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.deepEqual(started, ["HOLD", "B", "C"]);
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
    __resetApiResourcePressureForTests();
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
    if (previousConcurrency === undefined) {
      delete process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
    } else {
      process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = previousConcurrency;
    }
    if (previousShedDepth === undefined) {
      delete process.env.BARS_PERSIST_SHED_QUEUE_DEPTH;
    } else {
      process.env.BARS_PERSIST_SHED_QUEUE_DEPTH = previousShedDepth;
    }
  }
});

test("background bar-cache persist contention skips are not counted as failures", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });

  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => "skipped",
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("AAA"),
    );
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    const diagnostics =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(diagnostics.completed, 0);
    assert.equal(diagnostics.failed, 0);
    assert.equal(diagnostics.skipped, 1);
  } finally {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
    if (previousConcurrency === undefined) {
      delete process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
    } else {
      process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = previousConcurrency;
    }
  }
});

test("background bar-cache persist replaces duplicate pending windows", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });

  const releases: Array<() => void> = [];
  const started: Array<{ symbol: string; close: number }> = [];

  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async (input) => {
        started.push({
          symbol: input.request.symbol,
          close: input.bars[0]?.close ?? 0,
        });
        if (input.request.symbol === "HOLD") {
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        }
        return true;
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("HOLD"),
    );
    const first = makePersistInput("AAPL");
    const replacement = makePersistInput("AAPL");
    replacement.bars = [{ ...replacement.bars[0]!, close: 123.45 }];
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(first);
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(replacement);

    const queued =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(queued.queued, 1);
    assert.equal(queued.coalesced, 1);

    releases.shift()?.();
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.deepEqual(started, [
      { symbol: "HOLD", close: 100.5 },
      { symbol: "AAPL", close: 123.45 },
    ]);
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

test("background bar-cache persist queue drops oldest entry at the cap", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });

  const releases: Array<() => void> = [];
  const started: string[] = [];

  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async (input) => {
        started.push(input.request.symbol);
        if (input.request.symbol === "HOLD") {
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        }
        return true;
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("HOLD"),
    );
    for (let index = 0; index < 513; index += 1) {
      __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
        makePersistInput(`S${String(index).padStart(3, "0")}`),
      );
    }

    const capped =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(capped.queued, 512);
    assert.equal(capped.dropped, 1);
    assert.equal(capped.droppedForPressure, 0);
    assert.equal(capped.maxQueueLength, 512);

    releases.shift()?.();
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.equal(started.includes("S000"), false);
    assert.equal(started.includes("S001"), true);
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

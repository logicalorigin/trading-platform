import assert from "node:assert/strict";
import test from "node:test";

import {
  currentDbAdmissionSignal,
  runWithDbAdmissionSignal,
} from "@workspace/db";

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
        return "success";
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
        retryable: 0,
        terminal: 0,
        ineligible: 0,
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

test("background bar-cache persists outlive the initiating request signal", async () => {
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  const firstRequest = new AbortController();
  firstRequest.abort();
  let observedSignal: AbortSignal | undefined;

  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => {
        observedSignal = currentDbAdmissionSignal();
        return observedSignal?.aborted ? "terminal" : "success";
      },
    );

    runWithDbAdmissionSignal(firstRequest.signal, () =>
      __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
        makePersistInput("DETACHED"),
      ),
    );
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.notEqual(observedSignal, firstRequest.signal);
    assert.equal(observedSignal?.aborted, false);
    assert.equal(
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics()
        .completed,
      1,
    );
  } finally {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});

test("background bar-cache persist rejects deterministic ineligible inputs before queue admission", async () => {
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  let calls = 0;
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => {
        calls += 1;
        return "success";
      },
    );
    const baseInput = makePersistInput("O:SPY260717C00600000");
    const input = {
      ...baseInput,
      request: {
        ...baseInput.request,
        assetClass: "option" as const,
        providerContractId: "O:SPY260717C00600000",
      },
    };

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(input);
    await waitTurn();
    updateApiResourcePressure({
      dbPoolActive: 0,
      dbPoolWaiting: 0,
      dbPoolMax: 12,
    });
    await waitTurn();

    const diagnostics =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(calls, 0);
    assert.equal(diagnostics.queued, 0);
    assert.equal(diagnostics.enqueued, 0);
    assert.equal(diagnostics.ineligible, 1);
  } finally {
    __resetApiResourcePressureForTests();
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});

test("terminal bar-cache persist outcomes are not retained or retried", async () => {
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  let attempts = 0;
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => {
        attempts += 1;
        return "terminal";
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("TERMINAL"),
    );
    await waitTurn();
    updateApiResourcePressure({
      dbPoolActive: 0,
      dbPoolWaiting: 0,
      dbPoolMax: 12,
    });
    await waitTurn();

    const diagnostics =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(attempts, 1);
    assert.equal(diagnostics.queued, 0);
    assert.equal(diagnostics.terminal, 1);
  } finally {
    __resetApiResourcePressureForTests();
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
  }
});

test("retryable bar-cache persist outcomes remain queued until recovery", async () => {
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  let attempts = 0;
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => {
        attempts += 1;
        return attempts === 1 ? "retryable" : "success";
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("TRANSIENT"),
    );
    await waitTurn();

    const retained =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(attempts, 1);
    assert.equal(retained.queued, 1);
    assert.equal(retained.retryable, 1);

    updateApiResourcePressure({
      dbPoolActive: 0,
      dbPoolWaiting: 0,
      dbPoolMax: 12,
    });
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.equal(attempts, 2);
    assert.equal(
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics()
        .queued,
      0,
    );
  } finally {
    __resetApiResourcePressureForTests();
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(null);
    __resetOptionChainCachesForTests({ resetFlowScanner: false });
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
        return "success";
      },
    );
    updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });
    updateApiResourcePressure({ dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 });

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("PRESSURE"),
    );
    await waitTurn();

    const deferred =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(calls, 0);
    assert.equal(deferred.active, 0);
    assert.equal(deferred.queued, 1);
    assert.equal(deferred.enqueued, 1);
    assert.equal(deferred.completed, 0);
    assert.equal(deferred.failed, 0);
    assert.equal(deferred.skipped, 0);
    assert.equal(deferred.pressureSkipped, 0);

    updateApiResourcePressure({ dbPoolActive: 0, dbPoolWaiting: 0, dbPoolMax: 12 });
    updateApiResourcePressure({ dbPoolActive: 0, dbPoolWaiting: 0, dbPoolMax: 12 });
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    const recovered =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(calls, 1);
    assert.equal(recovered.queued, 0);
    assert.equal(recovered.completed, 1);
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

test("background bar-cache persist keeps draining under memory-only pressure", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  let calls = 0;
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => {
        calls += 1;
        return "success";
      },
    );
    updateApiResourcePressure({ apiHeapUsedPercent: 85 });
    updateApiResourcePressure({ apiHeapUsedPercent: 85 });

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("MEMORY"),
    );
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.equal(calls, 1);
    assert.equal(
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics()
        .queued,
      0,
    );
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

test("background bar-cache persist retains work behind a waiting DB caller and resumes", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
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
        return "success";
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

    const queued =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(queued.active, 1);
    assert.equal(queued.queued, 2);
    assert.equal(queued.dropped, 0);
    assert.equal(queued.droppedForPressure, 0);

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("C"),
    );
    const retained =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(retained.active, 1);
    assert.equal(retained.queued, 3);
    assert.equal(retained.dropped, 0);
    assert.equal(retained.droppedForPressure, 0);

    releases.shift()?.();
    await waitTurn();
    assert.deepEqual(started, ["HOLD"]);
    updateApiResourcePressure({
      dbPoolActive: 0,
      dbPoolWaiting: 0,
      dbPoolMax: 12,
    });
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.deepEqual(started, ["HOLD", "A", "B", "C"]);
    assert.equal(
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics()
        .completed,
      4,
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
  }
});

test("background bar-cache persist contention skips retain work until a recovery signal", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  let attempts = 0;
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async () => {
        attempts += 1;
        return attempts === 1 ? "retryable" : "success";
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("AAA"),
    );
    await waitTurn();

    const retained =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(attempts, 1);
    assert.equal(retained.queued, 1);
    assert.equal(retained.completed, 0);
    assert.equal(retained.failed, 0);
    assert.equal(retained.skipped, 1);

    const newer = makePersistInput("AAA");
    newer.bars = [
      {
        ...newer.bars[0]!,
        timestamp: new Date("2026-07-02T14:31:00.000Z"),
        close: 101.25,
      },
    ];
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(newer);
    await waitTurn();
    assert.equal(
      attempts,
      1,
      "new bars coalesce without hot-looping a blocked persistence key",
    );

    // The diagnostics sampler publishes pressure observations independently of
    // this queue. A normal observation is an event-driven recovery opportunity;
    // the queue must retry retained work without a guessed retry timer.
    updateApiResourcePressure({
      dbPoolActive: 0,
      dbPoolWaiting: 0,
      dbPoolMax: 12,
    });
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    const diagnostics =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(attempts, 2);
    assert.equal(diagnostics.queued, 0);
    assert.equal(diagnostics.completed, 1);
    assert.equal(diagnostics.failed, 0);
    assert.equal(diagnostics.skipped, 1);
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

test("retryable in-flight bar persists merge their bars with newer queued work before retry", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "2";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __resetApiResourcePressureForTests();

  let releaseFirst!: () => void;
  let attempts = 0;
  const persistedCloses: number[][] = [];
  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async (input) => {
        attempts += 1;
        persistedCloses.push(input.bars.map((bar) => bar.close));
        if (attempts === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return "retryable";
        }
        return "success";
      },
    );

    const first = makePersistInput("AAPL");
    const newer = makePersistInput("AAPL");
    newer.bars = [
      {
        ...newer.bars[0]!,
        timestamp: new Date("2026-07-02T14:31:00.000Z"),
        close: 123.45,
      },
    ];
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(first);
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(newer);
    await waitTurn();
    assert.equal(
      attempts,
      1,
      "same-key work stays serialized even when global concurrency is available",
    );
    releaseFirst();
    await waitTurn();

    const retained =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(retained.queued, 1);
    assert.equal(retained.failed, 0);
    assert.equal(retained.retryable, 1);

    updateApiResourcePressure({
      dbPoolActive: 0,
      dbPoolWaiting: 0,
      dbPoolMax: 12,
    });
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.deepEqual(persistedCloses, [[100.5], [100.5, 123.45]]);
    assert.equal(
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics()
        .completed,
      1,
    );
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

test("background bar-cache persist coalesces duplicate pending windows without losing bars", async () => {
  const previousConcurrency = process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY;
  process.env.BARS_BACKGROUND_PERSIST_CONCURRENCY = "1";
  __resetOptionChainCachesForTests({ resetFlowScanner: false });

  const releases: Array<() => void> = [];
  const started: Array<{ symbol: string; closes: number[] }> = [];

  try {
    __platformBarsCacheTestInternals.setBarsBackgroundPersistWorkerForTests(
      async (input) => {
        started.push({
          symbol: input.request.symbol,
          closes: input.bars.map((bar) => bar.close),
        });
        if (input.request.symbol === "HOLD") {
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
        }
        return "success";
      },
    );

    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(
      makePersistInput("HOLD"),
    );
    const first = makePersistInput("AAPL");
    const replacement = makePersistInput("AAPL");
    replacement.bars = [{
      ...replacement.bars[0]!,
      timestamp: new Date("2026-07-02T14:31:00.000Z"),
      close: 123.45,
    }];
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(first);
    __platformBarsCacheTestInternals.queueBarsBackgroundPersistForTests(replacement);

    const queued =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(queued.queued, 1);
    assert.equal(queued.coalesced, 1);

    releases.shift()?.();
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.deepEqual(started, [
      { symbol: "HOLD", closes: [100.5] },
      { symbol: "AAPL", closes: [100.5, 123.45] },
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

test("background bar-cache persist queue retains distinct durable windows", async () => {
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
        return "success";
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

    const queued =
      __platformBarsCacheTestInternals.getBarsBackgroundPersistDiagnostics();
    assert.equal(queued.queued, 513);
    assert.equal(queued.dropped, 0);
    assert.equal(queued.droppedForPressure, 0);
    assert.equal(queued.maxQueueLength, 513);

    releases.shift()?.();
    await __platformBarsCacheTestInternals.waitForBarsBackgroundPersistIdleForTests();

    assert.equal(started.includes("S000"), true);
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

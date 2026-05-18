import assert from "node:assert/strict";
import test from "node:test";
import type { AlgoDeployment } from "@workspace/db";
import { createSignalOptionsWorker } from "./signal-options-worker";

function createNoopLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
  };
}

async function emptyMaintenance() {
  return { closedCount: 0, skippedCount: 0, dueCount: 0, orphanCount: 0 };
}

function deployment(
  overrides: Partial<AlgoDeployment> = {},
): AlgoDeployment {
  const now = new Date("2026-04-28T14:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    strategyId: "22222222-2222-4222-8222-222222222222",
    name: "Signal Options",
    mode: "paper",
    enabled: true,
    providerAccountId: "DU123",
    symbolUniverse: ["SPY"],
    config: {
      signalOptions: {
        worker: {
          pollIntervalSeconds: 60,
        },
      },
    },
    lastEvaluatedAt: null,
    lastSignalAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("signal-options worker start is idempotent and stop clears scheduled wakeup", async () => {
  let listCalls = 0;
  let clearCalls = 0;
  const worker = createSignalOptionsWorker({
    listDeployments: async () => {
      listCalls += 1;
      return [];
    },
    scanDeployment: async () => {},
    runMaintenance: emptyMaintenance,
    acquireTickLock: async () => async () => {},
    setTimer: (() => 1) as never,
    clearTimer: (() => {
      clearCalls += 1;
    }) as never,
    logger: createNoopLogger(),
  });

  worker.start();
  worker.start();
  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();

  assert.equal(listCalls, 1);
  assert.equal(clearCalls, 1);
});

test("signal-options worker skips a tick when advisory lock is unavailable", async () => {
  let listCalls = 0;
  let maintenanceCalls = 0;
  const worker = createSignalOptionsWorker({
    listDeployments: async () => {
      listCalls += 1;
      return [deployment()];
    },
    scanDeployment: async () => {},
    runMaintenance: async () => {
      maintenanceCalls += 1;
      return emptyMaintenance();
    },
    acquireTickLock: async () => null,
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  assert.equal(listCalls, 0);
  assert.equal(maintenanceCalls, 0);
});

test("signal-options worker runs shadow option maintenance without deployments", async () => {
  let maintenanceCalls = 0;
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [],
    scanDeployment: async () => {},
    runMaintenance: async () => {
      maintenanceCalls += 1;
      return { closedCount: 2, skippedCount: 1, dueCount: 3, orphanCount: 2 };
    },
    acquireTickLock: async () => async () => {},
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  assert.equal(maintenanceCalls, 1);
  assert.deepEqual(worker.getRuntimeSnapshot().maintenance, {
    runCount: 1,
    totalClosedCount: 2,
    lastRunAt: worker.getRuntimeSnapshot().maintenance.lastRunAt,
    lastError: null,
    lastClosedCount: 2,
    lastSkippedCount: 1,
    lastDueCount: 3,
    lastOrphanCount: 2,
  });
  assert.ok(worker.getRuntimeSnapshot().maintenance.lastRunAt);
});

test("signal-options worker backs off transient database lock failures", async () => {
  let now = new Date("2026-04-28T14:00:00.000Z");
  let lockCalls = 0;
  const warnings: string[] = [];
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => {},
    runMaintenance: emptyMaintenance,
    acquireTickLock: async () => {
      lockCalls += 1;
      throw new Error("timeout exceeded when trying to connect");
    },
    now: () => now,
    logger: {
      debug() {},
      info() {},
      warn(...args: unknown[]) {
        warnings.push(String(args[1]));
      },
    },
  });

  await worker.runOnce();
  now = new Date("2026-04-28T14:00:30.000Z");
  await worker.runOnce();
  now = new Date("2026-04-28T14:01:01.000Z");
  await worker.runOnce();

  assert.equal(lockCalls, 2);
  assert.deepEqual(warnings, [
    "Signal-options database unavailable; pausing worker ticks",
    "Signal-options database unavailable; pausing worker ticks",
  ]);
});

test("signal-options worker interval-gates scans and rescans after config changes", async () => {
  let scanCalls = 0;
  let currentDeployment = deployment();
  let now = new Date("2026-04-28T14:00:00.000Z");
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [currentDeployment],
    scanDeployment: async () => {
      scanCalls += 1;
    },
    runMaintenance: emptyMaintenance,
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  await worker.runOnce();
  currentDeployment = deployment({
    config: {
      signalOptions: {
        worker: {
          pollIntervalSeconds: 60,
        },
        riskCaps: {
          maxContracts: 1,
        },
      },
    },
  });
  await worker.runOnce();
  now = new Date("2026-04-28T14:01:01.000Z");
  await worker.runOnce();

  assert.equal(scanCalls, 3);
});

test("signal-options worker records signal freshness from successful scans", async () => {
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => ({
      signals: [
        {
          symbol: "SPY",
          fresh: true,
          status: "ok",
          latestBarAt: "2026-04-28T13:55:00.000Z",
        },
        {
          symbol: "QQQ",
          fresh: false,
          status: "stale",
          latestBarAt: "2026-04-28T13:15:00.000Z",
        },
        {
          symbol: "DIA",
          fresh: false,
          status: "unavailable",
          latestBarAt: null,
        },
      ],
      candidates: [
        { status: "candidate", actionStatus: "blocked" },
        { status: "skipped", actionStatus: "candidate" },
        { status: "open", actionStatus: "shadow_filled" },
      ],
    }),
    runMaintenance: emptyMaintenance,
    acquireTickLock: async () => async () => {},
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  const runtime = worker.getRuntimeSnapshot().deployments[0];
  assert.equal(runtime?.lastSignalCount, 3);
  assert.equal(runtime?.lastFreshSignalCount, 1);
  assert.equal(runtime?.lastStaleSignalCount, 1);
  assert.equal(runtime?.lastUnavailableSignalCount, 1);
  assert.equal(runtime?.lastLatestSignalBarAt, "2026-04-28T13:55:00.000Z");
  assert.equal(runtime?.lastOldestSignalBarAt, "2026-04-28T13:15:00.000Z");
  assert.equal(runtime?.lastCandidateCount, 3);
  assert.equal(runtime?.lastBlockedCandidateCount, 2);
});

test("signal-options worker accepts lightweight scan summaries", async () => {
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => ({
      summary: {
        signalCount: 90,
        freshSignalCount: 6,
        staleSignalCount: 0,
        unavailableSignalCount: 0,
        latestSignalBarAt: "2026-05-18T18:20:00.000Z",
        oldestSignalBarAt: "2026-05-18T18:05:00.000Z",
        candidateCount: 5,
        blockedCandidateCount: 4,
      },
    }),
    runMaintenance: emptyMaintenance,
    acquireTickLock: async () => async () => {},
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  const runtime = worker.getRuntimeSnapshot().deployments[0];
  assert.equal(runtime?.lastSignalCount, 90);
  assert.equal(runtime?.lastFreshSignalCount, 6);
  assert.equal(runtime?.lastLatestSignalBarAt, "2026-05-18T18:20:00.000Z");
  assert.equal(runtime?.lastOldestSignalBarAt, "2026-05-18T18:05:00.000Z");
  assert.equal(runtime?.lastCandidateCount, 5);
  assert.equal(runtime?.lastBlockedCandidateCount, 4);
});

test("signal-options worker backs off failed deployment scans", async () => {
  let scanCalls = 0;
  let now = new Date("2026-04-28T14:00:00.000Z");
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => {
      scanCalls += 1;
      throw new Error("Gateway unavailable");
    },
    runMaintenance: emptyMaintenance,
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  await worker.runOnce();
  now = new Date("2026-04-28T14:01:01.000Z");
  await worker.runOnce();

  assert.equal(scanCalls, 2);
  assert.equal(worker.getRuntimeSnapshot().deployments[0]?.failureCount, 2);
  assert.equal(worker.getRuntimeSnapshot().deployments[0]?.totalFailureCount, 2);
});

test("signal-options worker resets consecutive failures after a successful scan", async () => {
  let scanCalls = 0;
  let now = new Date("2026-04-28T14:00:00.000Z");
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => {
      scanCalls += 1;
      if (scanCalls <= 2) {
        throw new Error("Gateway unavailable");
      }
    },
    runMaintenance: emptyMaintenance,
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  now = new Date("2026-04-28T14:01:01.000Z");
  await worker.runOnce();
  now = new Date("2026-04-28T14:02:02.000Z");
  await worker.runOnce();

  const runtime = worker.getRuntimeSnapshot().deployments[0];
  assert.equal(runtime?.scanCount, 1);
  assert.equal(runtime?.failureCount, 0);
  assert.equal(runtime?.totalFailureCount, 2);
  assert.equal(runtime?.lastError, null);
  assert.equal(runtime?.lastFailureAt, "2026-04-28T14:01:01.000Z");
});

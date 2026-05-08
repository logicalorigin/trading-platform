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
  const worker = createSignalOptionsWorker({
    listDeployments: async () => {
      listCalls += 1;
      return [deployment()];
    },
    scanDeployment: async () => {},
    acquireTickLock: async () => null,
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  assert.equal(listCalls, 0);
});

test("signal-options worker backs off transient database lock failures", async () => {
  let now = new Date("2026-04-28T14:00:00.000Z");
  let lockCalls = 0;
  const warnings: string[] = [];
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => {},
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

test("signal-options worker backs off failed deployment scans", async () => {
  let scanCalls = 0;
  let now = new Date("2026-04-28T14:00:00.000Z");
  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment()],
    scanDeployment: async () => {
      scanCalls += 1;
      throw new Error("Gateway unavailable");
    },
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
});

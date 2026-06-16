import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import { createSignalOptionsWorker } from "./signal-options-worker";
import type { OvernightSpotWorkerDeployment } from "./overnight-spot-execution";
import { createOvernightSpotWorker } from "./overnight-spot-worker";
import { createSignalMonitorEvaluationWorker } from "./signal-monitor-evaluation-worker";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
};

function highResourcePressureSnapshot() {
  __resetApiResourcePressureForTests();
  return updateApiResourcePressure({
    eventLoopDelayP95Ms: 300,
  });
}

function normalPressureSnapshot() {
  __resetApiResourcePressureForTests();
  return updateApiResourcePressure({
    apiP95LatencyMs: 100,
    dominantSlowRouteP95Ms: 100,
  });
}

test("signal-options worker runs maintenance without refreshing signals under high resource pressure", async () => {
  highResourcePressureSnapshot();
  let maintenanceCount = 0;
  const releaseLock = async () => {};

  const worker = createSignalOptionsWorker({
    runMaintenance: async () => {
      maintenanceCount += 1;
      return {};
    },
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(maintenanceCount, 1);
  assert.equal(snapshot.scanEnabled, false);
  assert.equal(snapshot.deploymentCount, 0);
  assert.equal(snapshot.activeDeploymentCount, 0);
  assert.equal(snapshot.maintenance.runCount, 1);

  __resetApiResourcePressureForTests();
});

test("signal-options worker does not run deployment scans", async () => {
  normalPressureSnapshot();
  let releaseCount = 0;
  let setTimerCount = 0;

  const worker = createSignalOptionsWorker({
    runMaintenance: async () => ({}),
    acquireTickLock: async () => async () => {
      releaseCount += 1;
    },
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    setTimer: () => {
      setTimerCount += 1;
      return { unref() {} } as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(releaseCount, 1);
  assert.equal(setTimerCount, 0);
  assert.equal(snapshot.tickRunning, false);
  assert.equal(snapshot.deploymentCount, 0);
  assert.equal(snapshot.activeDeploymentCount, 0);

  __resetApiResourcePressureForTests();
});

test("signal-options worker does not subscribe to aggregate signal evaluation in passive mode", async () => {
  normalPressureSnapshot();
  let maintenanceCount = 0;
  const releaseLock = async () => {};

  const worker = createSignalOptionsWorker({
    runMaintenance: async () => {
      maintenanceCount += 1;
      return {};
    },
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
  });

  await worker.runOnce();

  assert.equal(maintenanceCount, 1);
  assert.equal(worker.getRuntimeSnapshot().scanEnabled, false);

  __resetApiResourcePressureForTests();
});

test("signal monitor worker stays idle in passive mode", async () => {
  let lockCount = 0;
  let subscribeCount = 0;
  const worker = createSignalMonitorEvaluationWorker({
    isSignalMonitorBarEvaluationEnabled: () => false,
    acquireTickLock: async () => {
      lockCount += 1;
      return async () => {};
    },
    subscribeStockMinuteAggregates: () => {
      subscribeCount += 1;
      return {
        unsubscribe() {},
        setSymbols() {},
      };
    },
    logger: noopLogger,
  });

  await worker.runOnce();

  assert.equal(lockCount, 0);
  assert.equal(subscribeCount, 0);
});

test("overnight spot worker pauses deployment scans under high resource pressure", async () => {
  const pressure = highResourcePressureSnapshot();
  let scanCount = 0;
  const releaseLock = async () => {};
  const deployment = {
    id: "overnight-spot-test",
    enabled: true,
    mode: "paper",
    providerAccountId: null,
    symbolUniverse: ["SPY"],
    config: {
      overnightSpot: {
        worker: { pollIntervalSeconds: 15 },
      },
    },
  } as unknown as OvernightSpotWorkerDeployment;

  const worker = createOvernightSpotWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async () => {
      scanCount += 1;
      return {
        deploymentId: deployment.id,
        executionMode: "shadow",
        runActions: true,
        candidateCount: 0,
        trackedCount: 0,
        executedCount: 0,
        blockedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        results: [],
      };
    },
    getResourcePressure: () => pressure,
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scanCount, 0);
  assert.equal(snapshot.deployments[0]?.lastSkipReason, "resource_pressure");
  assert.equal(snapshot.deployments[0]?.nextScanDueInMs, 30_000);

  __resetApiResourcePressureForTests();
});

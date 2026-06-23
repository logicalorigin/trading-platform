import assert from "node:assert/strict";
import test from "node:test";

import type { AlgoDeployment } from "@workspace/db";
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
  // Two sustained samples above the event-loop high threshold (400ms) enter "high"
  // server saturation via the 2-sample hysteresis.
  updateApiResourcePressure({
    eventLoopDelayP95Ms: 500,
  });
  return updateApiResourcePressure({
    eventLoopDelayP95Ms: 500,
  });
}

function normalPressureSnapshot() {
  __resetApiResourcePressureForTests();
  return updateApiResourcePressure({
    apiP95LatencyMs: 100,
    dominantSlowRouteP95Ms: 100,
  });
}

function signalOptionsDeployment(
  id = "signal-options-test",
): AlgoDeployment {
  return {
    id,
    enabled: true,
    mode: "shadow",
    providerAccountId: null,
    symbolUniverse: ["SPY"],
    config: {
      signalOptions: {
        worker: { pollIntervalSeconds: 15 },
      },
    },
  } as unknown as AlgoDeployment;
}

test("signal-options worker pauses deployment scans under high resource pressure while running maintenance", async () => {
  const pressure = highResourcePressureSnapshot();
  let maintenanceCount = 0;
  let scanCount = 0;
  const releaseLock = async () => {};
  const deployment = signalOptionsDeployment();

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async () => {
      scanCount += 1;
      return {};
    },
    runMaintenance: async () => {
      maintenanceCount += 1;
      return {};
    },
    getResourcePressure: () => pressure,
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(maintenanceCount, 1);
  assert.equal(scanCount, 0);
  assert.equal(snapshot.scanEnabled, true);
  assert.equal(snapshot.deploymentCount, 1);
  assert.equal(snapshot.deployments[0]?.lastSkipReason, "resource_pressure");
  assert.equal(snapshot.deployments[0]?.nextScanDueInMs, 30_000);
  assert.equal(snapshot.maintenance.runCount, 1);

  __resetApiResourcePressureForTests();
});

test("signal-options worker scans enabled deployments with bounded action work", async () => {
  normalPressureSnapshot();
  const scanCalls: unknown[] = [];
  let releaseCount = 0;
  let setTimerCount = 0;
  const deployment = signalOptionsDeployment();

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async (input) => {
      scanCalls.push(input);
      return {
        summary: {
          signalCount: 3,
          freshSignalCount: 1,
          staleSignalCount: 2,
          unavailableSignalCount: 0,
          latestSignalBarAt: "2026-06-09T18:40:00.000Z",
          oldestSignalBarAt: "2026-06-09T18:20:00.000Z",
          candidateCount: 1,
          blockedCandidateCount: 0,
          activePositionCount: 1,
          lastSignalScanAt: "2026-06-09T18:41:00.000Z",
          signalSourcePolicy: "stored",
          heavyWorkDeferred: false,
          activeScanPhase: "action_scan",
          batch: {
            symbols: ["SPY"],
            universeCount: 1,
            batchSize: 1,
            startIndex: 0,
            nextIndex: 0,
            capacity: 12,
            fullUniverse: true,
          },
        },
      };
    },
    runMaintenance: async () => ({}),
    getResourcePressure: normalPressureSnapshot,
    acquireTickLock: async () => async () => {
      releaseCount += 1;
    },
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
    setTimer: () => {
      setTimerCount += 1;
      return { unref() {} } as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scanCalls.length, 1);
  const scanCall = scanCalls[0] as Record<string, unknown>;
  assert.equal(scanCall["deploymentId"], deployment.id);
  assert.equal(scanCall["forceEvaluate"], false);
  assert.equal(scanCall["preferStoredMonitorState"], true);
  assert.equal(scanCall["source"], "worker");
  assert.equal(scanCall["actionWorkBudgetMs"], 60_000);
  assert.equal(scanCall["actionWorkItemLimit"], 4);
  assert.ok(scanCall["signal"] instanceof AbortSignal);
  assert.equal(releaseCount, 1);
  assert.equal(setTimerCount, 0);
  assert.equal(snapshot.scanEnabled, true);
  assert.equal(snapshot.tickRunning, false);
  assert.equal(snapshot.deploymentCount, 1);
  assert.equal(snapshot.activeDeploymentCount, 0);
  assert.equal(snapshot.deployments[0]?.scanCount, 1);
  assert.equal(snapshot.deployments[0]?.lastCandidateCount, 1);
  assert.equal(snapshot.deployments[0]?.lastActivePositionCount, 1);
  assert.deepEqual(snapshot.deployments[0]?.lastBatchSymbols, ["SPY"]);

  __resetApiResourcePressureForTests();
});

test("signal-options worker keeps scanning when signal evaluation is passive", async () => {
  normalPressureSnapshot();
  let maintenanceCount = 0;
  let scanCount = 0;
  const releaseLock = async () => {};
  const deployment = signalOptionsDeployment("signal-options-passive-test");

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async () => {
      scanCount += 1;
      return {};
    },
    runMaintenance: async () => {
      maintenanceCount += 1;
      return {};
    },
    getResourcePressure: normalPressureSnapshot,
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  assert.equal(maintenanceCount, 1);
  assert.equal(scanCount, 1);
  assert.equal(worker.getRuntimeSnapshot().scanEnabled, true);

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
    mode: "shadow",
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

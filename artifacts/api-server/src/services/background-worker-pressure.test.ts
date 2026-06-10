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
import { createTradeMonitorWorker } from "./trade-monitor-worker";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
};

function highPressureSnapshot() {
  __resetApiResourcePressureForTests();
  return updateApiResourcePressure({
    apiP95LatencyMs: 12_000,
    dominantSlowRouteP95Ms: 12_000,
  });
}

function normalPressureSnapshot() {
  __resetApiResourcePressureForTests();
  return updateApiResourcePressure({
    apiP95LatencyMs: 100,
    dominantSlowRouteP95Ms: 100,
  });
}

test("signal-options worker pauses deployment scans under high API pressure", async () => {
  const pressure = highPressureSnapshot();
  let scanCount = 0;
  const releaseLock = async () => {};
  const deployment = {
    id: "signal-options-test",
    enabled: true,
    mode: "paper",
    providerAccountId: null,
    symbolUniverse: ["SPY"],
    config: {
      signalOptions: {
        worker: { pollIntervalSeconds: 15 },
      },
    },
  } as unknown as AlgoDeployment;

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async () => {
      scanCount += 1;
      return {};
    },
    runMaintenance: async () => ({}),
    getResourcePressure: () => pressure,
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
    isAggregateStreamingAvailable: () => true,
    subscribeAggregates: () => ({
      unsubscribe() {},
      setSymbols() {},
    }),
    evaluateStreamSignalSymbols: async () => ({}),
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scanCount, 0);
  assert.equal(snapshot.deployments[0]?.lastSkipReason, "resource_pressure");
  assert.equal(snapshot.deployments[0]?.pressurePaused, true);
  assert.equal(snapshot.deployments[0]?.lastResourcePressureLevel, "high");

  __resetApiResourcePressureForTests();
});

test("signal-options worker does not subscribe to aggregate signal evaluation in passive mode", async () => {
  const pressure = normalPressureSnapshot();
  let scanCount = 0;
  let subscribeCount = 0;
  let streamEvaluationCount = 0;
  const releaseLock = async () => {};
  const deployment = {
    id: "signal-options-passive-test",
    enabled: true,
    mode: "paper",
    providerAccountId: null,
    symbolUniverse: ["SPY"],
    config: {
      signalOptions: {
        worker: { pollIntervalSeconds: 15 },
      },
    },
  } as unknown as AlgoDeployment;

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async () => {
      scanCount += 1;
      return {};
    },
    runMaintenance: async () => ({}),
    getResourcePressure: () => pressure,
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
    isSignalMonitorBarEvaluationEnabled: () => false,
    isAggregateStreamingAvailable: () => true,
    subscribeAggregates: () => {
      subscribeCount += 1;
      return {
        unsubscribe() {},
        setSymbols() {},
      };
    },
    evaluateStreamSignalSymbols: async () => {
      streamEvaluationCount += 1;
      return {};
    },
  });

  await worker.runOnce();

  assert.equal(scanCount, 1);
  assert.equal(subscribeCount, 0);
  assert.equal(streamEvaluationCount, 0);

  __resetApiResourcePressureForTests();
});

test("signal monitor worker stays idle in passive mode", async () => {
  let lockCount = 0;
  let subscribeCount = 0;
  const worker = createTradeMonitorWorker({
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

test("overnight spot worker pauses deployment scans under high API pressure", async () => {
  const pressure = highPressureSnapshot();
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
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scanCount, 0);
  assert.equal(snapshot.deployments[0]?.lastSkipReason, "resource_pressure");
  assert.equal(snapshot.deployments[0]?.nextScanDueInMs, 30_000);

  __resetApiResourcePressureForTests();
});

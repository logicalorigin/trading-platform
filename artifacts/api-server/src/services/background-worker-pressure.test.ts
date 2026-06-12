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

test("signal-options worker refreshes signals under high resource pressure", async () => {
  highResourcePressureSnapshot();
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
      return {
        summary: {
          signalCount: 3,
          freshSignalCount: 1,
          staleSignalCount: 0,
          unavailableSignalCount: 0,
          latestSignalBarAt: "2026-06-09T18:40:00.000Z",
          oldestSignalBarAt: "2026-06-09T18:35:00.000Z",
          lastSignalScanAt: "2026-06-09T18:41:00.000Z",
          signalSourcePolicy: "stored_state",
          heavyWorkDeferred: false,
          activeScanPhase: "action_scan",
          candidateCount: 0,
          blockedCandidateCount: 0,
          activePositionCount: 0,
          batch: {
            symbols: ["SPY"],
            universeCount: 1,
            batchSize: 1,
            startIndex: 0,
            nextIndex: 0,
            capacity: 1,
            fullUniverse: true,
          },
        },
      };
    },
    runMaintenance: async () => ({}),
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
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
  assert.equal(scanCount, 1);
  assert.equal(snapshot.deployments[0]?.lastSkipReason, null);
  assert.equal(snapshot.deployments[0]?.lastScanOutcome, "success");
  assert.equal(snapshot.deployments[0]?.lastSignalScanAt, "2026-06-09T18:41:00.000Z");
  assert.equal(snapshot.deployments[0]?.lastSignalCount, 3);
  assert.equal(snapshot.deployments[0]?.lastHeavyWorkDeferred, false);

  __resetApiResourcePressureForTests();
});

test("signal-options worker aborts deployment scans that exceed the scan timeout", async () => {
  normalPressureSnapshot();
  let nowMs = Date.parse("2026-06-09T18:41:00.000Z");
  let scanCount = 0;
  let releaseCount = 0;
  let clearTimerCount = 0;
  let timeoutCallback: (() => void) | null = null;
  let resolveTimeoutRegistered: (() => void) | null = null;
  const timeoutRegistered = new Promise<void>((resolve) => {
    resolveTimeoutRegistered = resolve;
  });
  let scanAborted = false;
  const deployment = {
    id: "signal-options-timeout-test",
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
    scanDeployment: async (input) => {
      scanCount += 1;
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => {
            scanAborted = true;
            reject(input.signal?.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      });
    },
    runMaintenance: async () => ({}),
    acquireTickLock: async () => async () => {
      releaseCount += 1;
    },
    now: () => new Date(nowMs),
    logger: noopLogger,
    scanTimeoutMs: 1_000,
    setTimer: (callback, delayMs) => {
      if (delayMs === 1_000) {
        timeoutCallback = callback;
        resolveTimeoutRegistered?.();
      }
      return { unref() {} } as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      clearTimerCount += 1;
    },
    subscribeCockpitChanges: () => () => {},
    isAggregateStreamingAvailable: () => true,
    subscribeAggregates: () => ({
      unsubscribe() {},
      setSymbols() {},
    }),
    evaluateStreamSignalSymbols: async () => ({}),
  });

  const runPromise = worker.runOnce();
  await timeoutRegistered;
  if (typeof timeoutCallback !== "function") {
    throw new Error("scan timeout was not registered");
  }
  const fireTimeout: () => void = timeoutCallback;
  nowMs += 1_000;
  fireTimeout();
  await runPromise;
  await Promise.resolve();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scanCount, 1);
  assert.equal(scanAborted, true);
  assert.equal(releaseCount, 1);
  assert.equal(clearTimerCount, 1);
  assert.equal(snapshot.tickRunning, false);
  assert.equal(snapshot.activeDeploymentCount, 0);
  assert.equal(snapshot.deployments[0]?.timedOut, true);
  assert.equal(snapshot.deployments[0]?.unsettledAfterTimeout, false);
  assert.equal(snapshot.deployments[0]?.lastScanOutcome, "timed_out");

  __resetApiResourcePressureForTests();
});

test("signal-options worker does not subscribe to aggregate signal evaluation in passive mode", async () => {
  normalPressureSnapshot();
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
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
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

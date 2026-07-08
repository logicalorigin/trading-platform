import assert from "node:assert/strict";
import test from "node:test";

import type { AlgoDeployment } from "@workspace/db";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import {
  createSignalOptionsWorker,
  resolveWorkerScanTimeoutMs,
} from "./signal-options-worker";
import type { OvernightSpotWorkerDeployment } from "./overnight-spot-execution";
import { createOvernightSpotWorker } from "./overnight-spot-worker";
import { createSignalMonitorEvaluationWorker } from "./signal-monitor-evaluation-worker";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
};

function highFiniteResourcePressureSnapshot() {
  __resetApiResourcePressureForTests();
  // Two sustained samples of a SATURATED pool with a deep wait-queue enter "high"
  // finite-resource pressure (pool exhaustion) via the 2-sample hysteresis. This
  // is what drives isApiResourcePressureHardBlock now — a busy event loop no
  // longer does (finite-resource decouple), so the old event-loop-only snapshot
  // stopped tripping the hard block.
  const saturatedPool = {
    dbPoolActive: 12,
    dbPoolMax: 12,
    dbPoolWaiting: 8,
  };
  updateApiResourcePressure(saturatedPool);
  return updateApiResourcePressure(saturatedPool);
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

test("signal-options worker degrades to a positions-only scan under high resource pressure (does not fully pause)", async () => {
  const pressure = highFiniteResourcePressureSnapshot();
  let maintenanceCount = 0;
  const scanCalls: Record<string, unknown>[] = [];
  const releaseLock = async () => {};
  const deployment = signalOptionsDeployment();

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async (input) => {
      scanCalls.push(input as Record<string, unknown>);
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
  // Owner directive 2026-07-07: entries never pause under pressure. The scan
  // runs in full — pressure recovery comes from demand fixes, not trading stops.
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0]?.["skipEntryWork"], false);
  assert.equal(scanCalls[0]?.["source"], "worker");
  assert.equal(snapshot.scanEnabled, true);
  assert.equal(snapshot.deploymentCount, 1);
  assert.notEqual(
    snapshot.deployments[0]?.lastSkipReason,
    "resource_pressure",
  );
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

test("signal-options worker default scan timeout scales with active positions unless overridden", () => {
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 0, undefined), 120_000);
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 10, undefined), 150_000);
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 100, undefined), 300_000);
  assert.equal(resolveWorkerScanTimeoutMs("45000", 100, undefined), 45_000);
  assert.equal(resolveWorkerScanTimeoutMs(undefined, 100, "45000"), 45_000);
  assert.equal(resolveWorkerScanTimeoutMs(null, 100, undefined), null);
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

test("overnight spot worker degrades to an exit-only scan under high resource pressure (outside RTH)", async () => {
  const pressure = highFiniteResourcePressureSnapshot();
  const scanCalls: Record<string, unknown>[] = [];
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
    scanDeployment: async (input) => {
      scanCalls.push(input as Record<string, unknown>);
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
    // Overnight session so the RTH full-pause does not pre-empt the pressure path.
    getMarketSessionKey: () => "overnight",
    acquireTickLock: async () => releaseLock,
    now: () => new Date("2026-06-09T06:41:00.000Z"),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  // Owner directive 2026-07-07: entries never pause under pressure — the worker
  // no longer sets skipEntryWork at all. RTH still fully pauses elsewhere.
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0]?.["skipEntryWork"], undefined);
  assert.notEqual(
    snapshot.deployments[0]?.lastSkipReason,
    "resource_pressure",
  );

  __resetApiResourcePressureForTests();
});

test("entry work runs on every tick under sustained hard block (no pressure gate)", async () => {
  const pressure = highFiniteResourcePressureSnapshot();
  const scanCalls: Record<string, unknown>[] = [];
  let nowMs = new Date("2026-06-09T18:41:00.000Z").getTime();

  const worker = createSignalOptionsWorker({
    listDeployments: async () => [signalOptionsDeployment()],
    scanDeployment: async (input) => {
      scanCalls.push(input as Record<string, unknown>);
      return {};
    },
    runMaintenance: async () => ({}),
    getResourcePressure: () => pressure,
    acquireTickLock: async () => async () => {},
    now: () => new Date(nowMs),
    logger: noopLogger,
    scanTimeoutMs: null,
    subscribeCockpitChanges: () => () => {},
  });

  for (let tick = 0; tick < 21; tick += 1) {
    await worker.runOnce();
    nowMs += 16_000;
  }

  assert.equal(scanCalls.length, 21);
  // Owner directive 2026-07-07: the entry gate and its starvation floor are
  // removed — every tick runs full entry work even under sustained hard block.
  assert.equal(
    scanCalls.filter((call) => call["skipEntryWork"] === false).length,
    21,
  );

  __resetApiResourcePressureForTests();
});

import assert from "node:assert/strict";
import test from "node:test";
import { createOvernightSpotWorker } from "./overnight-spot-worker";
import type { ApiResourcePressureSnapshot } from "./resource-pressure";

const now = new Date("2026-06-03T02:30:00.000Z");

function deployment(patch: Record<string, unknown> = {}) {
  return {
    id: "deployment-1",
    name: "Overnight Spot",
    mode: "paper" as const,
    enabled: true,
    providerAccountId: "shadow",
    symbolUniverse: ["AAPL"],
    config: {
      parameters: {
        signalTimeframe: "5m",
      },
      overnightSpot: {
        enabled: true,
        executionMode: "shadow",
        defaultOrderNotional: 1_000,
        maxOrderNotional: 1_500,
        maxShareQuantity: 10,
        worker: {
          pollIntervalSeconds: 15,
        },
      },
    },
    ...patch,
  };
}

function pressure(
  level: ApiResourcePressureSnapshot["level"] = "normal",
): ApiResourcePressureSnapshot {
  return {
    level,
    observedAt: now.toISOString(),
    drivers: [],
    scannerPressure: {
      level: "normal",
      drivers: [],
      activeLongScanCount: null,
    },
    caps: {
      signalOptions: {
        maintenanceOnly: false,
        skipDeploymentScans: false,
        signalRefreshAllowed: true,
        actionScansAllowed: true,
        positionMarksAllowed: true,
        watchlistPrewarmAllowed: true,
      },
    },
    inputs: {
      rssMb: null,
      apiHeapUsedPercent: null,
      apiP95LatencyMs: null,
      dominantSlowRouteP95Ms: null,
      clientLevel: null,
      cacheLevel: null,
      automationActiveLongScanCount: null,
    },
  };
}

function workerDependencies(overrides: Record<string, unknown> = {}) {
  return {
    listDeployments: async () => [deployment()],
    scanDeployment: async () => ({
      deploymentId: "deployment-1",
      executionMode: "shadow" as const,
      runActions: true,
      candidateCount: 1,
      trackedCount: 1,
      blockedCount: 0,
      skippedCount: 0,
      executedCount: 1,
      failedCount: 0,
      results: [],
    }),
    getResourcePressure: () => pressure(),
    acquireTickLock: async () => async () => {},
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    now: () => now,
    logger: {
      debug() {},
      info() {},
      warn() {},
    },
    subscribeCockpitChanges: () => () => {},
    ...overrides,
  };
}

test("overnight spot worker scans enabled deployments in action mode", async () => {
  const scans: Array<Record<string, unknown>> = [];
  const worker = createOvernightSpotWorker(
    workerDependencies({
      scanDeployment: async (input: Record<string, unknown>) => {
        scans.push(input);
        return {
          deploymentId: "deployment-1",
          executionMode: "shadow" as const,
          runActions: true,
          candidateCount: 1,
          trackedCount: 1,
          blockedCount: 0,
          skippedCount: 0,
          executedCount: 1,
          failedCount: 0,
          results: [],
        };
      },
    }),
  );

  await worker.runOnce();

  assert.deepEqual(scans, [
    {
      deploymentId: "deployment-1",
      runActions: true,
      recordSignals: true,
    },
  ]);
  assert.equal(worker.getRuntimeSnapshot().deployments[0]?.lastExecutedCount, 1);
});

test("overnight spot worker skips scans under critical resource pressure", async () => {
  const scans: Array<Record<string, unknown>> = [];
  const worker = createOvernightSpotWorker(
    workerDependencies({
      getResourcePressure: () => pressure("critical"),
      scanDeployment: async (input: Record<string, unknown>) => {
        scans.push(input);
        throw new Error("scan should not run");
      },
    }),
  );

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scans.length, 0);
  assert.equal(snapshot.deployments[0]?.lastSkipReason, "resource_pressure_critical");
  assert.equal(snapshot.deployments[0]?.skippedScanCount, 1);
});

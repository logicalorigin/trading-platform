import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import type { OvernightSpotWorkerDeployment } from "./overnight-spot-execution";
import { createOvernightSpotWorker } from "./overnight-spot-worker";

const noopLogger = { debug() {}, info() {}, warn() {} };

function normalPressureSnapshot() {
  __resetApiResourcePressureForTests();
  return updateApiResourcePressure({
    apiP95LatencyMs: 100,
    dominantSlowRouteP95Ms: 100,
  });
}

const deployment = {
  id: "overnight-spot-test",
  enabled: true,
  mode: "shadow",
  providerAccountId: null,
  symbolUniverse: ["SPY"],
  config: { overnightSpot: { worker: { pollIntervalSeconds: 15 } } },
} as unknown as OvernightSpotWorkerDeployment;

const scanResult = {
  deploymentId: deployment.id,
  executionMode: "shadow" as const,
  runActions: true as const,
  candidateCount: 0,
  trackedCount: 0,
  executedCount: 0,
  blockedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  results: [],
};

function buildWorker(input: {
  sessionKey: "overnight" | "pre" | "rth" | "after" | "closed";
  onScan: () => void;
}) {
  const pressure = normalPressureSnapshot();
  return createOvernightSpotWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async () => {
      input.onScan();
      return scanResult;
    },
    getResourcePressure: () => pressure,
    getMarketSessionKey: () => input.sessionKey,
    acquireTickLock: async () => async () => {},
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    subscribeCockpitChanges: () => () => {},
  });
}

test("overnight spot worker stays dormant during regular trading hours", async () => {
  let scanCount = 0;
  const worker = buildWorker({ sessionKey: "rth", onScan: () => (scanCount += 1) });

  await worker.runOnce();

  const snapshot = worker.getRuntimeSnapshot();
  assert.equal(scanCount, 0, "no scan (and therefore no blocked-signal toast) during RTH");
  assert.equal(snapshot.deployments[0]?.lastSkipReason, "regular_market_session");
  assert.equal(snapshot.deployments[0]?.nextScanDueInMs, 60_000);

  __resetApiResourcePressureForTests();
});

test("overnight spot worker still scans outside regular trading hours", async () => {
  let scanCount = 0;
  const worker = buildWorker({
    sessionKey: "overnight",
    onScan: () => (scanCount += 1),
  });

  await worker.runOnce();

  assert.equal(scanCount, 1, "overnight session is the strategy's live window");
  assert.equal(worker.getRuntimeSnapshot().deployments[0]?.lastSkipReason, null);

  __resetApiResourcePressureForTests();
});

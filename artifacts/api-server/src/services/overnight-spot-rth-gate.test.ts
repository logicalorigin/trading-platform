import assert from "node:assert/strict";
import test from "node:test";

import type { UsEquityMarketSessionKey } from "@workspace/market-calendar";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import type { EquityExecutionStyle } from "./overnight-spot-automation";
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

function deploymentForStyles(
  styles: EquityExecutionStyle[],
): OvernightSpotWorkerDeployment {
  return {
    id: `equity-execution-${styles.join("-")}`,
    enabled: true,
    mode: "shadow",
    providerAccountId: null,
    symbolUniverse: ["SPY"],
    config: {
      equityExecution: {
        enabled: true,
        executionMode: "shadow",
        styles,
        worker: { pollIntervalSeconds: 15 },
      },
    },
  } as unknown as OvernightSpotWorkerDeployment;
}

function buildWorker(input: {
  styles: EquityExecutionStyle[];
  sessionKey: UsEquityMarketSessionKey;
  onScan: (sessionKey: UsEquityMarketSessionKey) => void;
}) {
  const pressure = normalPressureSnapshot();
  const deployment = deploymentForStyles(input.styles);
  return createOvernightSpotWorker({
    listDeployments: async () => [deployment],
    scanDeployment: async ({ marketSessionKey }) => {
      input.onScan(marketSessionKey);
      return {
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
    },
    getResourcePressure: () => pressure,
    getMarketSessionKey: () => input.sessionKey,
    acquireTickLock: async () =>
      Object.assign(async () => {}, {
        signal: new AbortController().signal,
      }),
    now: () => new Date("2026-06-09T18:41:00.000Z"),
    logger: noopLogger,
    subscribeCockpitChanges: () => () => {},
  });
}

test("equity worker dispatches only a selected style's eligible session", async (t) => {
  const cases: Array<{
    name: string;
    styles: EquityExecutionStyle[];
    sessionKey: UsEquityMarketSessionKey;
    expectedScanCount: number;
  }> = [
    {
      name: "day scans RTH",
      styles: ["day"],
      sessionKey: "rth",
      expectedScanCount: 1,
    },
    {
      name: "day skips overnight",
      styles: ["day"],
      sessionKey: "overnight",
      expectedScanCount: 0,
    },
    {
      name: "overnight scans overnight",
      styles: ["overnight"],
      sessionKey: "overnight",
      expectedScanCount: 1,
    },
    {
      name: "overnight skips RTH",
      styles: ["overnight"],
      sessionKey: "rth",
      expectedScanCount: 0,
    },
    {
      name: "combined scans RTH",
      styles: ["day", "overnight"],
      sessionKey: "rth",
      expectedScanCount: 1,
    },
    {
      name: "combined scans overnight",
      styles: ["day", "overnight"],
      sessionKey: "overnight",
      expectedScanCount: 1,
    },
    {
      name: "combined skips premarket",
      styles: ["day", "overnight"],
      sessionKey: "pre",
      expectedScanCount: 0,
    },
    {
      name: "combined skips after-hours",
      styles: ["day", "overnight"],
      sessionKey: "after",
      expectedScanCount: 0,
    },
    {
      name: "combined skips closed",
      styles: ["day", "overnight"],
      sessionKey: "closed",
      expectedScanCount: 0,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      let scanCount = 0;
      const scanSessions: UsEquityMarketSessionKey[] = [];
      const worker = buildWorker({
        styles: testCase.styles,
        sessionKey: testCase.sessionKey,
        onScan: (sessionKey) => {
          scanCount += 1;
          scanSessions.push(sessionKey);
        },
      });

      await worker.runOnce();

      const snapshot = worker.getRuntimeSnapshot();
      assert.equal(scanCount, testCase.expectedScanCount);
      assert.deepEqual(
        scanSessions,
        testCase.expectedScanCount === 1 ? [testCase.sessionKey] : [],
      );
      assert.equal(
        snapshot.deployments[0]?.lastSkipReason,
        testCase.expectedScanCount === 1
          ? null
          : "execution_style_session_unavailable",
      );

      __resetApiResourcePressureForTests();
    });
  }
});

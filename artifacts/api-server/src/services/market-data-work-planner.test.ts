import assert from "node:assert/strict";
import test from "node:test";
import {
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
  __resetMarketDataAdmissionForTests,
} from "./market-data-admission";
import { buildMarketDataWorkPlan } from "./market-data-work-planner";

test.afterEach(() => {
  __resetMarketDataAdmissionForTests();
});

test("buildMarketDataWorkPlan splits IBKR live lines from persisted provider jobs", () => {
  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "polygon",
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: "twsopt:test-contract",
      },
    ],
    fallbackProvider: "none",
  });

  const plan = buildMarketDataWorkPlan({
    generatedAt: "2026-05-29T18:00:00.000Z",
    admission: getMarketDataAdmissionDiagnostics(),
    bridge: { diagnosticsAvailable: true, activeLineCount: 1, lineBudget: 200 },
    drift: {
      status: "mixed",
      bridgeOnlyLineCount: 1,
      bridgeOnlyLineSample: ["equity:MSFT"],
      persistentApiOnlyLineCount: 1,
      persistentApiOnlyLineSample: ["option:twsopt:test-contract"],
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      marketDataMode: "live",
      resourcePressure: { level: "normal" },
      scannerPressure: { level: "normal" },
      lineUtilization: {
        effectiveConcurrency: 2,
        maxDeepScanLines: 80,
      },
      deepScanner: {
        activeCount: 0,
        queuedCount: 0,
        draining: false,
        lastBatch: ["SPY"],
      },
      plannedHorizon: {
        symbolCount: 12,
        symbols: ["SPY", "QQQ"],
        batchSize: 2,
        intervalMs: 30_000,
        estimatedCycleMs: 180_000,
        coverageHealth: "healthy",
      },
    },
    ingest: {
      configured: true,
      providerConfigured: true,
      queueDepth: { queued: 3, running: 1 },
      oldestQueuedAgeMs: 5_000,
      runningCount: 1,
      blockedGexJobCount: 1,
      oldestBlockedGexAgeMs: 4_000,
      blockedGexJobs: [
        {
          symbol: "SPY",
          dedupeBucket: "29422440",
          missingKind: "option_chain_snapshot",
          prerequisiteStatus: "missing",
          ageMs: 4_000,
        },
      ],
      recentCompletedJobs: [
        {
          kind: "gex_snapshot",
          symbol: "SPY",
          updatedAt: "2026-05-29T18:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.summary.ibkrEquityLineCount, 1);
  assert.equal(plan.summary.ibkrOptionLineCount, 1);
  assert.equal(plan.summary.persistQueuedJobCount, 3);
  assert.equal(plan.summary.persistRunningJobCount, 1);
  assert.equal(plan.summary.persistBlockedJobCount, 1);
  assert.equal(plan.summary.releaseLineCount, 1);
  assert.equal(plan.summary.evictLineCount, 1);
  assert.equal(plan.scanner.plannedHorizonCount, 12);
  assert.equal(plan.scanner.effectiveConcurrency, 2);
  assert.equal(plan.memoryAction.action, "normal");
  assert.deepEqual(plan.ibkrEquityLive[0]?.symbols, ["AAPL"]);
  assert.deepEqual(plan.ibkrOptionLive[0]?.symbols, ["SPY"]);
  assert.ok(
    plan.persistJobs.some(
      (job) => job.kind === "gex_snapshot" && job.status === "blocked",
    ),
  );
});

test("buildMarketDataWorkPlan sheds scanner work under critical pressure", () => {
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: "twsopt:test-contract",
      },
    ],
    fallbackProvider: "none",
  });

  const plan = buildMarketDataWorkPlan({
    admission: getMarketDataAdmissionDiagnostics(),
    optionsFlowScanner: {
      resourcePressure: { level: "critical" },
      scannerPressure: { level: "critical", hardBlocked: true },
      lineUtilization: { effectiveConcurrency: 0, maxDeepScanLines: 0 },
    },
  });

  assert.equal(plan.memoryAction.action, "shed-background-scanner");
  assert.equal(plan.evict.length, 1);
  assert.equal(plan.evict[0]?.owner, "flow-scanner");
});

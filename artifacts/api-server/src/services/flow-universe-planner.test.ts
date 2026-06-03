import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlowUniverseScanPlan,
  type FlowUniversePlannerCandidate,
} from "./flow-universe-planner";

const NOW = new Date("2026-05-29T15:30:00.000Z");

function candidate(
  symbol: string,
  input: Partial<FlowUniversePlannerCandidate> = {},
): FlowUniversePlannerCandidate {
  return {
    symbol,
    market: "stocks",
    sourceIds: ["other_listed"],
    flowScore: 0,
    previousSessionFlowScore: 0,
    lastScannedAt: null,
    lastFlowAt: null,
    cooldownUntil: null,
    ...input,
  };
}

function plan(input: Partial<Parameters<typeof buildFlowUniverseScanPlan>[0]> = {}) {
  return buildFlowUniverseScanPlan({
    candidates: [],
    prioritySymbolGroups: {},
    targetSize: 10,
    batchSize: 5,
    lineBudget: 100,
    perScanLineBudget: 20,
    effectiveConcurrency: 1,
    generatedAt: NOW,
    ...input,
  });
}

test("flow universe planner prioritizes verified account, runtime, watchlist, then built-in symbols", () => {
  const result = plan({
    candidates: [
      candidate("SPY", { sourceIds: ["sp500"] }),
      candidate("AAPL", { sourceIds: ["sp500"] }),
      candidate("MSFT", { sourceIds: ["sp500"] }),
      candidate("NVDA", { sourceIds: ["sp500"] }),
    ],
    prioritySymbolGroups: {
      "built-in": ["SPY"],
      watchlists: ["AAPL"],
      runtime: ["MSFT"],
      account: ["NVDA"],
    },
  });

  assert.deepEqual(result.nextScanBatch.slice(0, 4), [
    "NVDA",
    "MSFT",
    "AAPL",
    "SPY",
  ]);
  assert.deepEqual(result.prioritySymbolsBySource.account, ["NVDA"]);
  assert.equal(result.selectedPoolCounts.priority, 4);
});

test("flow universe planner never scans unverified priority symbols", () => {
  const result = plan({
    candidates: [candidate("SPY", { sourceIds: ["sp500"] })],
    prioritySymbolGroups: {
      watchlists: ["SPY", "TSLA"],
    },
  });

  assert.deepEqual(result.nextScanBatch, ["SPY"]);
  assert.deepEqual(result.verificationSymbols, ["TSLA"]);
  assert.deepEqual(result.skipped.unverifiedPrioritySymbols, ["TSLA"]);
});

test("flow universe planner treats verified low-liquidity priority symbols as scan candidates", () => {
  const result = plan({
    candidates: [
      candidate("MSFT", {
        sourceIds: ["sp500"],
        price: 415,
        dollarVolume: 415,
      }),
      candidate("NVDA", {
        sourceIds: ["sp500"],
        price: 214,
        dollarVolume: 5_567,
      }),
    ],
    prioritySymbolGroups: {
      watchlists: ["MSFT", "NVDA"],
    },
  });

  assert.deepEqual(result.nextScanBatch.slice(0, 2), ["MSFT", "NVDA"]);
  assert.deepEqual(result.verificationSymbols, []);
  assert.equal(result.diagnostics.candidateSymbols, 2);
});

test("flow universe planner promotes hot symbols ahead of core and broad rotation", () => {
  const result = plan({
    candidates: [
      candidate("AAPL", {
        sourceIds: ["sp500"],
        lastScannedAt: new Date("2026-05-29T14:00:00.000Z"),
      }),
      candidate("RKT", {
        sourceIds: ["other_listed"],
        flowScore: 8,
        lastFlowAt: new Date("2026-05-29T15:20:00.000Z"),
      }),
      candidate("ZZZ", {
        sourceIds: ["other_listed"],
        lastScannedAt: new Date("2026-05-29T13:00:00.000Z"),
      }),
    ],
  });

  assert.equal(result.nextScanBatch[0], "RKT");
  assert.equal(result.selectedPoolCounts.hot, 1);
});

test("flow universe planner rotates S&P core and broad listed pools by oldest scan", () => {
  const result = plan({
    candidates: [
      candidate("MSFT", {
        sourceIds: ["sp500"],
        lastScannedAt: new Date("2026-05-29T15:00:00.000Z"),
      }),
      candidate("AAPL", {
        sourceIds: ["sp500"],
        lastScannedAt: new Date("2026-05-29T12:00:00.000Z"),
      }),
      candidate("BROAD2", {
        sourceIds: ["other_listed"],
        lastScannedAt: new Date("2026-05-29T10:00:00.000Z"),
      }),
      candidate("BROAD1", {
        sourceIds: ["nasdaq_listed"],
        lastScannedAt: new Date("2026-05-29T11:00:00.000Z"),
      }),
    ],
  });

  assert.deepEqual(result.nextScanBatch.slice(0, 4), [
    "AAPL",
    "MSFT",
    "BROAD2",
    "BROAD1",
  ]);
  assert.equal(result.pools.core.totalSymbols, 2);
  assert.equal(result.pools.broad.totalSymbols, 2);
});

test("flow universe planner skips cooldown symbols and reports them", () => {
  const result = plan({
    candidates: [
      candidate("AAPL", {
        sourceIds: ["sp500"],
        cooldownUntil: new Date("2026-05-29T15:45:00.000Z"),
      }),
      candidate("MSFT", { sourceIds: ["sp500"] }),
    ],
    prioritySymbolGroups: {
      watchlists: ["AAPL", "MSFT"],
    },
  });

  assert.deepEqual(result.nextScanBatch, ["MSFT"]);
  assert.deepEqual(result.skipped.cooldownSymbols, ["AAPL"]);
  assert.equal(result.pools.priority.skippedCooldownSymbols, 1);
});

test("flow universe planner caps next scan batch by line budget", () => {
  const result = plan({
    candidates: [
      candidate("AAPL", { sourceIds: ["sp500"] }),
      candidate("MSFT", { sourceIds: ["sp500"] }),
      candidate("NVDA", { sourceIds: ["sp500"] }),
      candidate("TSLA", { sourceIds: ["sp500"] }),
    ],
    batchSize: 4,
    lineBudget: 40,
    perScanLineBudget: 20,
    effectiveConcurrency: 1,
  });

  assert.deepEqual(result.nextScanBatch, ["AAPL", "MSFT"]);
  assert.equal(result.diagnostics.allowedSymbols, 2);
  assert.equal(result.diagnostics.limitingReason, "line-budget");
  assert.equal(result.skipped.lineBudgetSymbolCount, 2);
});

test("flow universe planner does not multiply per-scan line budget by concurrency", () => {
  const result = plan({
    candidates: [
      candidate("AAPL", { sourceIds: ["sp500"] }),
      candidate("MSFT", { sourceIds: ["sp500"] }),
      candidate("NVDA", { sourceIds: ["sp500"] }),
      candidate("TSLA", { sourceIds: ["sp500"] }),
    ],
    batchSize: 4,
    lineBudget: 80,
    perScanLineBudget: 40,
    effectiveConcurrency: 2,
  });

  assert.deepEqual(result.nextScanBatch, ["AAPL", "MSFT"]);
  assert.equal(result.diagnostics.allowedSymbols, 2);
  assert.equal(result.diagnostics.limitingReason, "line-budget");
});

test("flow universe planner treats one-line ticker slots as broad scanner capacity", () => {
  const result = plan({
    candidates: Array.from({ length: 200 }, (_unused, index) =>
      candidate(`SLOT${index}`, { sourceIds: ["other_listed"] }),
    ),
    targetSize: 200,
    batchSize: 200,
    lineBudget: 200,
    perScanLineBudget: 1,
    effectiveConcurrency: 8,
  });

  assert.equal(result.nextScanBatch.length, 200);
  assert.equal(result.diagnostics.allowedSymbols, 200);
  assert.equal(result.diagnostics.limitingReason, "none");
});

test("flow universe planner returns no batch when scanner has no effective budget", () => {
  const result = plan({
    candidates: [candidate("AAPL", { sourceIds: ["sp500"] })],
    lineBudget: 0,
  });

  assert.deepEqual(result.nextScanBatch, []);
  assert.equal(result.diagnostics.limitingReason, "no-budget");
});

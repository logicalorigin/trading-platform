import assert from "node:assert/strict";
import test from "node:test";

import { buildFlowUniverseScanPlan } from "./flow-universe-planner";

test("retired S&P membership does not outrank the Massive-listed universe", () => {
  const plan = buildFlowUniverseScanPlan({
    candidates: [
      {
        symbol: "LISTED_OLD",
        market: "stocks",
        sourceIds: ["nasdaq_listed"],
        lastScannedAt: new Date("2026-07-14T15:00:00.000Z"),
      },
      {
        symbol: "FORMER_INDEX_RECENT",
        market: "stocks",
        sourceIds: ["sp500", "nasdaq_listed"],
        lastScannedAt: new Date("2026-07-14T16:00:00.000Z"),
      },
    ],
    targetSize: 2,
    batchSize: 2,
    lineBudget: 100,
    perScanLineBudget: 50,
    effectiveConcurrency: 1,
    generatedAt: new Date("2026-07-14T17:00:00.000Z"),
  });

  assert.deepEqual(plan.nextScanBatch, ["LISTED_OLD", "FORMER_INDEX_RECENT"]);
  assert.equal("coreSymbols" in plan, false);
  assert.equal("core" in plan.selectedPoolCounts, false);
  assert.equal("core" in plan.pools, false);
});

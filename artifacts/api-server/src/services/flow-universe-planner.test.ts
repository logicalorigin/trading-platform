import assert from "node:assert/strict";
import test from "node:test";

import { buildFlowUniverseScanPlan } from "./flow-universe-planner";

test("planner exposes the full rotation universe without truncating it to one provider batch", () => {
  const plan = buildFlowUniverseScanPlan({
    candidates: [
      {
        symbol: "PRIORITY",
        market: "stocks",
        lastScannedAt: new Date("2026-07-14T17:00:00.000Z"),
      },
      {
        symbol: "BROAD_NEW",
        market: "stocks",
        sourceIds: ["nasdaq_listed"],
        lastScannedAt: new Date("2026-07-14T16:00:00.000Z"),
      },
      {
        symbol: "BROAD_OLD",
        market: "stocks",
        sourceIds: ["nasdaq_listed"],
        lastScannedAt: new Date("2026-07-14T15:00:00.000Z"),
      },
      {
        symbol: "UNLISTED",
        market: "stocks",
        lastScannedAt: new Date("2026-07-14T14:00:00.000Z"),
      },
    ],
    prioritySymbolGroups: { watchlists: ["PRIORITY"] },
    targetSize: 3,
    batchSize: 1,
    lineBudget: 50,
    perScanLineBudget: 50,
    effectiveConcurrency: 1,
    generatedAt: new Date("2026-07-14T17:30:00.000Z"),
  });

  assert.deepEqual(plan.nextScanBatch, ["PRIORITY"]);
  assert.deepEqual(plan.scanUniverseSymbols, [
    "PRIORITY",
    "BROAD_OLD",
    "BROAD_NEW",
  ]);
});

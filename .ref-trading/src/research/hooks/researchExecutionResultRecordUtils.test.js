import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDisplayedResultRecord,
  buildRecentResultSummary,
} from "./researchExecutionResultRecordUtils.js";

test("buildRecentResultSummary keeps only lightweight result metadata", () => {
  const result = buildRecentResultSummary({
    resultId: "run-1",
    createdAt: "2026-03-27T15:00:00Z",
    marketSymbol: "SPY",
    strategy: "rayalgo",
    mode: "interactive",
    status: "completed",
    metrics: { n: 12, roi: 4.2 },
    trades: [{ id: 1 }],
    equity: [{ x: 1 }],
    skippedTrades: [{ id: 2 }],
    replayMeta: { selectionSummaryLabel: "SPY sample" },
    resultMeta: { dataSource: "massive", spotDataMeta: { source: "db" } },
  });

  assert.equal(result.resultId, "run-1");
  assert.equal(result.metrics?.n, 12);
  assert.equal("trades" in result, false);
  assert.equal("equity" in result, false);
  assert.equal("skippedTrades" in result, false);
});

test("buildDisplayedResultRecord stays compact while preserving header metadata", () => {
  const displayed = buildDisplayedResultRecord({
    resultId: "run-2",
    createdAt: "2026-03-27T15:10:00Z",
    marketSymbol: "QQQ",
    strategy: "smc",
    mode: "background",
    status: "completed",
    metrics: { n: 8, roi: -1.5 },
    replayMeta: {
      selectionSummaryLabel: "QQQ replay",
      replayDatasetSummary: { candidates: 30, resolved: 28 },
    },
    resultMeta: {
      selectionSummaryLabel: "QQQ replay",
      dataSource: "massive",
    },
    trades: [{ id: 1 }],
    equity: [{ i: 1, value: 100 }],
    skippedTrades: [{ id: 3 }],
    skippedByReason: { foo: 1 },
    riskStop: { mode: "disabled" },
    rayalgoScoringContext: { activeTimeframe: "5m" },
    draftSignature: "draft-2",
  }, "latest");

  assert.equal(displayed.origin, "latest");
  assert.equal(displayed.mode, "background");
  assert.deepEqual(displayed.replayDatasetSummary, { candidates: 30, resolved: 28 });
  assert.deepEqual(displayed.riskStop, { mode: "disabled" });
  assert.deepEqual(displayed.rayalgoScoringContext, { activeTimeframe: "5m" });
  assert.equal("trades" in displayed, false);
  assert.equal("equity" in displayed, false);
  assert.equal("skippedTrades" in displayed, false);
  assert.equal("skippedByReason" in displayed, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStageAVariants,
  buildStageBVariants,
  computeMaxRealizedDrawdown,
  computeSweepMetrics,
  rankSweepResults,
  type SweepResult,
  type SweepVariant,
} from "./pyrus-signals-options-sweep";

function variant(id: string): SweepVariant {
  return {
    id,
    stage: "A",
    pyrusSignalsSettingsPatch: { timeHorizon: 10 },
  };
}

function result(
  id: string,
  metrics: Partial<SweepResult["metrics"]>,
  status: SweepResult["status"] = "succeeded",
): SweepResult {
  return {
    variant: variant(id),
    status,
    eligible: true,
    ineligibleReason: null,
    startedAt: "2026-05-01T00:00:00.000Z",
    finishedAt: "2026-05-01T00:00:01.000Z",
    durationMs: 1000,
    window: null,
    timeframe: "5m",
    metrics: {
      realizedPnl: 0,
      winRate: 0,
      profitFactor: 0,
      closedTrades: 25,
      maxDrawdownAbs: 500,
      openPositions: 0,
      riskAdjustedScore: 0,
      ...metrics,
    },
    summary: null,
    error: null,
  };
}

test("Pyrus Signals signal-options sweep grid builds 55 dry variants", () => {
  const stageA = buildStageAVariants();
  const stageB = buildStageBVariants([4, 10]);

  assert.equal(stageA.length, 7);
  assert.equal(stageB.length, 48);
  assert.equal(stageA.length + stageB.length, 55);
});

test("sweep metrics compute daily realized drawdown and profit factor", () => {
  const closedTrades = [
    { closedAt: "2026-05-01T15:00:00.000Z", pnl: 1000 },
    { closedAt: "2026-05-02T15:00:00.000Z", pnl: -600 },
    { closedAt: "2026-05-03T15:00:00.000Z", pnl: 100 },
  ];
  const metrics = computeSweepMetrics({
    summary: {
      realizedPnl: 500,
      winningTrades: 2,
      losingTrades: 1,
      closedTrades,
    },
    openPositions: [{ id: "open-1" }],
  });

  assert.equal(computeMaxRealizedDrawdown(closedTrades), 600);
  assert.equal(metrics.realizedPnl, 500);
  assert.equal(metrics.closedTrades, 3);
  assert.equal(metrics.maxDrawdownAbs, 600);
  assert.equal(metrics.openPositions, 1);
  assert.equal(metrics.winRate, 2 / 3);
  assert.equal(Number(metrics.profitFactor.toFixed(3)), 1.833);
  assert.equal(metrics.riskAdjustedScore, 0.833333);
});

test("sweep ranking filters ineligible runs and applies primary ordering", () => {
  const ranked = rankSweepResults([
    result("failed", { riskAdjustedScore: 100, closedTrades: 25 }, "failed"),
    result("too-few-trades", { riskAdjustedScore: 100, closedTrades: 19 }),
    result("lower-score", {
      realizedPnl: 1200,
      riskAdjustedScore: 1.2,
      profitFactor: 3,
      closedTrades: 50,
      openPositions: 0,
    }),
    result("winner-score", {
      realizedPnl: 900,
      riskAdjustedScore: 1.8,
      profitFactor: 1.5,
      closedTrades: 25,
      openPositions: 4,
    }),
  ]);

  assert.deepEqual(
    ranked.map((item) => item.variant.id),
    ["winner-score", "lower-score"],
  );
});

test("sweep ranking tie breakers prefer pnl, profit factor, trades, then fewer opens", () => {
  const ranked = rankSweepResults([
    result("more-open", {
      realizedPnl: 1000,
      riskAdjustedScore: 2,
      profitFactor: 2,
      closedTrades: 30,
      openPositions: 3,
    }),
    result("more-trades", {
      realizedPnl: 1000,
      riskAdjustedScore: 2,
      profitFactor: 2,
      closedTrades: 35,
      openPositions: 5,
    }),
    result("better-pf", {
      realizedPnl: 1000,
      riskAdjustedScore: 2,
      profitFactor: 3,
      closedTrades: 25,
      openPositions: 5,
    }),
    result("better-pnl", {
      realizedPnl: 1100,
      riskAdjustedScore: 2,
      profitFactor: 1,
      closedTrades: 25,
      openPositions: 5,
    }),
  ]);

  assert.deepEqual(
    ranked.map((item) => item.variant.id),
    ["better-pnl", "better-pf", "more-trades", "more-open"],
  );
});

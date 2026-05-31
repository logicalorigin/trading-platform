import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateBacktestMetrics } from "./analytics";
import type { BacktestPoint, BacktestTrade } from "./types";

function point(index: number, equity: number, drawdownPercent = 0): BacktestPoint {
  return {
    occurredAt: new Date(Date.UTC(2024, 0, index + 1, 14, 30)),
    equity,
    cash: equity,
    grossExposure: 0,
    drawdownPercent,
  };
}

function trade(index: number, netPnl = 10): BacktestTrade {
  return {
    symbol: `T${index}`,
    side: "long",
    entryAt: new Date(Date.UTC(2024, 0, index + 1, 14, 30)),
    exitAt: new Date(Date.UTC(2024, 0, index + 1, 15, 30)),
    entryPrice: 10,
    exitPrice: 11,
    quantity: 1,
    entryValue: 10,
    exitValue: 11,
    grossPnl: netPnl,
    netPnl,
    netPnlPercent: netPnl,
    barsHeld: 1,
    commissionPaid: 0,
    exitReason: "strategy_exit",
  };
}

test("calculateBacktestMetrics emits stable structured validation warnings", () => {
  const metrics = calculateBacktestMetrics(
    [
      point(0, 10_000),
      point(1, 10_100),
      point(2, 9_900, -1.98),
      point(3, 10_050, -0.5),
    ],
    [trade(0)],
    10_000,
    {
      trialCount: 64,
      parameterCount: 6,
      validationWarnings: ["Existing string warning."],
    },
  );

  assert.ok(metrics.validation);
  assert.deepEqual(
    metrics.validation.warningDetails.map((warning) => warning.code),
    [
      "external_validation_warning",
      "low_trade_count",
      "too_many_trials",
      "missing_out_of_sample_window",
      "insufficient_sample_size",
    ],
  );
  assert.deepEqual(metrics.validation.warningDetails[1], {
    code: "low_trade_count",
    severity: "warning",
    scope: "sample",
    message: "Trade count is below 30; statistical confidence is limited.",
    evidence: {
      tradeCount: 1,
      minimumTradeCount: 30,
    },
  });
  assert.ok(metrics.validation.warnings.includes("Existing string warning."));
  assert.ok(
    metrics.validation.warnings.includes(
      "Multiple tested candidates without an out-of-sample window increase overfitting risk.",
    ),
  );
  assert.equal(typeof metrics.advanced?.deflatedSharpeRatio, "number");
  assert.equal(typeof metrics.advanced?.probabilisticSharpeRatio, "number");
});

test("calculateBacktestMetrics keeps healthy validation runs quiet", () => {
  const points = Array.from({ length: 40 }, (_, index) =>
    point(index, 10_000 + index * 25),
  );
  const trades = Array.from({ length: 30 }, (_, index) => trade(index, 25));
  const metrics = calculateBacktestMetrics(points, trades, 10_000, {
    trialCount: 1,
    oosWindowCount: 1,
    parameterCount: 2,
  });

  assert.ok(metrics.validation);
  assert.deepEqual(metrics.validation.warningDetails, []);
  assert.deepEqual(metrics.validation.warnings, []);
  assert.equal(metrics.tradeCount, 30);
});

test("calculateBacktestMetrics warns on drawdown duration and unstable Sharpe", () => {
  const points = Array.from({ length: 36 }, (_, index) =>
    point(
      index,
      10_000 + index * 250 + (index % 2 === 0 ? 50 : -25),
      index >= 5 && index <= 25 ? -1 : 0,
    ),
  );
  const metrics = calculateBacktestMetrics(
    points,
    Array.from({ length: 12 }, (_, index) => trade(index, 40)),
    10_000,
    {
      trialCount: 100,
      oosWindowCount: 2,
      parameterCount: 5,
    },
  );

  const codes = metrics.validation?.warningDetails.map((warning) => warning.code) ?? [];
  assert.ok(codes.includes("excessive_drawdown_duration"));
  assert.ok(codes.includes("unstable_sharpe"));
});

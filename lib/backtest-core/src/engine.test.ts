import assert from "node:assert/strict";
import { test } from "node:test";
import { runBacktest } from "./engine";
import type { BacktestBar, StudyDefinition } from "./types";

function bar(index: number, open: number, high: number, low: number, close: number): BacktestBar {
  return {
    startsAt: new Date(Date.UTC(2024, 0, index + 1, 14, 30)),
    open,
    high,
    low,
    close,
    volume: 1_000,
  };
}

function study(overrides: Partial<StudyDefinition> = {}): StudyDefinition {
  return {
    strategyId: "sma_crossover",
    strategyVersion: "v1",
    symbols: ["AAPL"],
    timeframe: "1d",
    from: new Date(Date.UTC(2024, 0, 1)),
    to: new Date(Date.UTC(2024, 0, 5)),
    parameters: {
      shortWindow: 1,
      longWindow: 2,
    },
    executionProfile: {
      commissionBps: 0,
      slippageBps: 0,
    },
    portfolioRules: {
      initialCapital: 10_000,
      positionSizePercent: 50,
      maxConcurrentPositions: 1,
      maxGrossExposurePercent: 100,
    },
    ...overrides,
  };
}

test("runBacktest records advanced validation metrics", () => {
  const result = runBacktest(study(), {
    AAPL: [
      bar(0, 10, 10, 9, 10),
      bar(1, 9, 10, 9, 9),
      bar(2, 12, 12, 11, 12),
      bar(3, 12, 13, 12, 13),
      bar(4, 13, 13, 12, 12),
    ],
  });

  assert.ok(result.metrics.advanced);
  assert.ok(result.metrics.validation);
  assert.equal(result.metrics.validation.trialCount, 1);
  assert.equal(result.metrics.advanced.monteCarlo.seed, 42417);
});

test("runBacktest exits on an enabled trailing stop", () => {
  const result = runBacktest(
    study({
      riskRules: {
        trailingStopPercent: 5,
        trailingActivationPercent: 0,
      },
    }),
    {
      AAPL: [
        bar(0, 10, 10, 9, 10),
        bar(1, 9, 10, 9, 9),
        bar(2, 12, 12, 11, 12),
        bar(3, 12, 13, 11, 12),
        bar(4, 12, 12, 11, 11),
      ],
    },
  );

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.exitReason, "trailing_stop");
  assert.equal(result.trades[0]?.exitPrice, 12);
});

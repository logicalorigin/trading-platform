import assert from "node:assert/strict";
import test from "node:test";

import { runBacktest } from "./engine";
import type { BacktestBar, StudyDefinition } from "./types";

function bar(index: number, close: number): BacktestBar {
  return {
    startsAt: new Date(Date.UTC(2026, 6, 13 + index, 14, 30)),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  };
}

test("rejects the whole proposed entry when it would exceed max gross exposure", () => {
  const study: StudyDefinition = {
    strategyId: "sma_crossover",
    strategyVersion: "v1",
    symbols: ["AAA", "BBB"],
    timeframe: "1d",
    from: new Date("2026-07-13T00:00:00.000Z"),
    to: new Date("2026-07-17T23:59:59.999Z"),
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
      positionSizePercent: 40,
      maxConcurrentPositions: 2,
      maxGrossExposurePercent: 50,
    },
  };
  const bars = [bar(0, 10), bar(1, 8), bar(2, 10), bar(3, 10), bar(4, 10)];

  const result = runBacktest(study, { AAA: bars, BBB: bars });

  assert.deepEqual(
    result.trades.map((trade) => ({
      symbol: trade.symbol,
      entryValue: trade.entryValue,
    })),
    [{ symbol: "AAA", entryValue: 4_000 }],
  );
  assert.ok(result.points.every((point) => point.grossExposure <= 5_000));
});

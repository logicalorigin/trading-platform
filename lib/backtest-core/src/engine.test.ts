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

function quoteBar(
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  bid: number,
  ask: number,
): BacktestBar {
  const startsAt = new Date(Date.UTC(2024, 0, index + 1, 14, 30));
  return {
    startsAt,
    open,
    high,
    low,
    close,
    volume: 1_000,
    bid,
    ask,
    mid: (bid + ask) / 2,
    quoteAsOf: startsAt,
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

test("runBacktest uses trailing stop once it is more protective than fixed stop", () => {
  const result = runBacktest(
    study({
      riskRules: {
        stopLossPercent: 5,
        trailingStopPercent: 5,
        trailingActivationPercent: 0,
      },
    }),
    {
      AAPL: [
        bar(0, 10, 10, 9, 10),
        bar(1, 9, 10, 9, 9),
        bar(2, 12, 12, 11, 12),
        bar(3, 13, 13, 13, 13),
        bar(4, 15, 15, 12, 12),
      ],
    },
  );

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.exitReason, "trailing_stop");
  assert.equal(result.trades[0]?.exitPrice, 14.25);
});

test("runBacktest keeps legacy fills when no option fill policy is selected", () => {
  const result = runBacktest(study(), {
    AAPL: [
      quoteBar(0, 10, 10, 9, 10, 9.5, 10.5),
      quoteBar(1, 9, 10, 9, 9, 8.5, 9.5),
      quoteBar(2, 12, 12, 11, 12, 11.5, 12.5),
      quoteBar(3, 12, 13, 12, 13, 12.5, 13.5),
      quoteBar(4, 13, 13, 12, 12, 11.5, 12.5),
    ],
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.entryPrice, 12);
  assert.equal(result.trades[0]?.exitPrice, 12);
});

test("runBacktest uses conservative quote fills when explicitly selected", () => {
  const result = runBacktest(
    study({
      executionProfile: {
        commissionBps: 0,
        slippageBps: 0,
        optionFillPolicy: {
          model: "conservative_quote",
        },
      },
    }),
    {
      AAPL: [
        quoteBar(0, 10, 10, 9, 10, 9.5, 10.5),
        quoteBar(1, 9, 10, 9, 9, 8.5, 9.5),
        quoteBar(2, 12, 12, 11, 12, 11.5, 12.5),
        quoteBar(3, 12, 13, 12, 13, 12.5, 13.5),
        quoteBar(4, 13, 13, 12, 12, 11.5, 12.5),
      ],
    },
  );

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.entryPrice, 13.5);
  assert.equal(result.trades[0]?.exitPrice, 11.5);
  assert.deepEqual(result.warnings, []);
});

test("runBacktest skips conservative entries when quote data is missing", () => {
  const result = runBacktest(
    study({
      executionProfile: {
        commissionBps: 0,
        slippageBps: 0,
        optionFillPolicy: {
          model: "conservative_quote",
        },
      },
    }),
    {
      AAPL: [
        bar(0, 10, 10, 9, 10),
        bar(1, 9, 10, 9, 9),
        bar(2, 12, 12, 11, 12),
        bar(3, 12, 13, 12, 13),
        bar(4, 13, 13, 12, 12),
      ],
    },
  );

  assert.equal(result.trades.length, 0);
  assert.match(result.warnings[0] ?? "", /conservative_quote buy AAPL .*missing_quote/);
});

test("runBacktest keeps final exposure when conservative liquidation rejects", () => {
  const result = runBacktest(
    study({
      executionProfile: {
        commissionBps: 0,
        slippageBps: 0,
        optionFillPolicy: {
          model: "conservative_quote",
        },
      },
    }),
    {
      AAPL: [
        quoteBar(0, 10, 10, 9, 10, 9.5, 10.5),
        quoteBar(1, 9, 10, 9, 9, 8.5, 9.5),
        quoteBar(2, 12, 12, 11, 12, 11.5, 12.5),
        quoteBar(3, 12, 13, 12, 13, 12.5, 13.5),
        bar(4, 13, 13, 12, 12),
      ],
    },
  );

  const finalPoint = result.points.at(-1);

  assert.equal(result.trades.length, 0);
  assert.ok(finalPoint);
  assert.equal(finalPoint.grossExposure, 4440);
  assert.equal(finalPoint.cash, 5005);
  assert.equal(finalPoint.equity, 9445);
  assert.match(
    result.warnings.join("\n"),
    /unable to liquidate open position at end of test/,
  );
});

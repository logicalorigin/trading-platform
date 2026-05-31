import assert from "node:assert/strict";
import test from "node:test";
import type { BacktestBar, StudyDefinition } from "@workspace/backtest-core";
import { runOptionsBacktest } from "./index";

const CALL_TICKER = "O:SPY240119C00480000";
const PUT_TICKER = "O:SPY240119P00480000";
type RunOptionsBacktestDependencies = NonNullable<
  Parameters<typeof runOptionsBacktest>[2]
>;

function time(minute: number): Date {
  return new Date(Date.UTC(2024, 0, 1, 14, 30 + minute));
}

function spotBar(
  minute: number,
  open: number,
  high: number,
  low: number,
  close: number,
): BacktestBar {
  return {
    startsAt: time(minute),
    open,
    high,
    low,
    close,
    volume: 1_000,
  };
}

function optionBar(
  minute: number,
  bid: number,
  ask: number,
  overrides: Partial<BacktestBar> = {},
): BacktestBar {
  const startsAt = time(minute);
  const mid = (bid + ask) / 2;
  return {
    startsAt,
    open: mid,
    high: ask,
    low: bid,
    close: mid,
    volume: 100,
    bid,
    ask,
    mid,
    quoteAsOf: startsAt,
    providerContractId: "contract-call",
    ...overrides,
  };
}

function oneSignalSpotBars(): BacktestBar[] {
  return [
    spotBar(0, 10, 10, 9, 9),
    spotBar(1, 9, 11, 8, 10),
    spotBar(2, 10, 10, 9, 9.5),
    spotBar(3, 9.5, 10, 9, 9.2),
    spotBar(4, 9.2, 12, 9, 11.5),
    spotBar(5, 11.5, 12, 11, 11.8),
  ];
}

function longThenShortSpotBars(): BacktestBar[] {
  return [
    ...oneSignalSpotBars(),
    spotBar(6, 11.8, 12, 10.5, 11),
    spotBar(7, 11, 11.5, 9, 9.5),
    spotBar(8, 9.5, 10, 8, 8.5),
    spotBar(9, 8.5, 9, 8, 8.25),
  ];
}

function study(overrides: Partial<StudyDefinition> = {}): StudyDefinition {
  return {
    strategyId: "pyrus_signals",
    strategyVersion: "v1",
    symbols: ["SPY"],
    timeframe: "1m",
    from: time(0),
    to: time(9),
    parameters: {
      executionMode: "options",
      timeHorizon: 1,
      optionFillModel: "conservative_quote",
    },
    executionProfile: {
      commissionBps: 0,
      slippageBps: 0,
    },
    portfolioRules: {
      initialCapital: 10_000,
      positionSizePercent: 10,
      maxConcurrentPositions: 1,
      maxGrossExposurePercent: 100,
    },
    ...overrides,
  };
}

function contractFor(right: "call" | "put") {
  return {
    ticker: right === "call" ? CALL_TICKER : PUT_TICKER,
    underlying: "SPY",
    expirationDate: new Date(Date.UTC(2024, 0, 19)),
    strike: 480,
    right,
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: `contract-${right}`,
    contractPresetId: "test",
    dte: 18,
  };
}

function datasetFor(symbol: string, bars: BacktestBar[]) {
  return {
    id: `dataset-${symbol}`,
    symbol,
    timeframe: "1m",
    source: "test",
    sessionMode: "regular",
    startsAt: bars[0]?.startsAt ?? time(0),
    endsAt: bars.at(-1)?.startsAt ?? time(9),
    barCount: bars.length,
    byteSize: 0,
    pinnedCount: 0,
    isSeeded: false,
    lastAccessedAt: time(0),
    createdAt: time(0),
    updatedAt: time(0),
  };
}

function dependencies(
  barsByTicker: Record<string, BacktestBar[]>,
): RunOptionsBacktestDependencies {
  return {
    resolveOptionContractForSignal: async (input) =>
      contractFor(input.right) as never,
    loadDataset: async (input) => {
      const bars = barsByTicker[input.symbol] ?? [];
      return {
        dataset: datasetFor(input.symbol, bars) as never,
        bars,
      };
    },
  };
}

test("runOptionsBacktest fills quote-populated conservative option bars end to end", async () => {
  const result = await runOptionsBacktest(
    study({ to: time(5) }),
    { SPY: oneSignalSpotBars() },
    dependencies({
      [CALL_TICKER]: [optionBar(4, 1.05, 1.15), optionBar(5, 1.35, 1.45)],
    }),
  );

  const trade = result.result.trades[0];

  assert.equal(result.result.warnings.length, 0);
  assert.equal(result.result.trades.length, 1);
  assert.ok(trade);
  assert.equal(trade.entryAt.toISOString(), time(4).toISOString());
  assert.equal(trade.exitAt.toISOString(), time(5).toISOString());
  assert.equal(trade.entryPrice, 1.15);
  assert.equal(trade.exitPrice, 1.35);
  assert.equal(trade.exitReason, "end_of_run");
  assert.equal(result.datasetBindings.length, 1);
  assert.equal(result.datasetBindings[0]?.dataset.symbol, CALL_TICKER);
});

test("runOptionsBacktest expires rejected conservative entries without fallback fills", async () => {
  const result = await runOptionsBacktest(
    study({ to: time(5) }),
    { SPY: oneSignalSpotBars() },
    dependencies({
      [CALL_TICKER]: [optionBar(4, 1.2, 1.1), optionBar(5, 1.25, 1.35)],
    }),
  );

  assert.equal(result.result.trades.length, 0);
  assert.equal(result.datasetBindings.length, 0);
  assert.match(
    result.result.warnings.join("\n"),
    /SPY: O:SPY240119C00480000 buy conservative_quote fill rejected .*crossed_quote/,
  );
});

test("runOptionsBacktest keeps rejected exits pending until run-end quote liquidation", async () => {
  const result = await runOptionsBacktest(
    study(),
    { SPY: longThenShortSpotBars() },
    dependencies({
      [CALL_TICKER]: [
        optionBar(4, 1.05, 1.15),
        optionBar(8, 1.5, 1),
        optionBar(9, 1.25, 1.35),
      ],
    }),
  );

  const trade = result.result.trades[0];

  assert.equal(result.result.trades.length, 1);
  assert.ok(trade);
  assert.equal(trade.entryPrice, 1.15);
  assert.equal(trade.exitPrice, 1.25);
  assert.equal(trade.exitAt.toISOString(), time(9).toISOString());
  assert.equal(trade.exitReason, "end_of_run");
  assert.match(
    result.result.warnings.join("\n"),
    /SPY: O:SPY240119C00480000 sell conservative_quote fill rejected .*crossed_quote/,
  );
});

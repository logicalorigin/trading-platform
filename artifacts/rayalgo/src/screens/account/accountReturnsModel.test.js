import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountReturnsModel,
  holdDurationBucket,
} from "./accountReturnsModel.js";

const point = (timestamp, netLiquidation, returnPercent, benchmarkPercent = null) => ({
  timestamp,
  netLiquidation,
  currency: "USD",
  source: "FLEX",
  deposits: 0,
  withdrawals: 0,
  dividends: 0,
  fees: 0,
  returnPercent,
  benchmarkPercent,
});

test("buildAccountReturnsModel computes period return, benchmark deltas, and drawdown", () => {
  const model = buildAccountReturnsModel({
    range: "1M",
    equityHistory: {
      range: "1M",
      points: [
        point("2026-04-01T00:00:00.000Z", 100_000, 0),
        point("2026-04-02T00:00:00.000Z", 110_000, 10),
        point("2026-04-03T00:00:00.000Z", 99_000, -1),
        point("2026-04-04T00:00:00.000Z", 108_000, 8),
      ],
    },
    benchmarkHistories: {
      SPY: {
        range: "1M",
        points: [
          point("2026-04-01T00:00:00.000Z", 100_000, 0, 0),
          point("2026-04-04T00:00:00.000Z", 108_000, 8, 5),
        ],
      },
    },
  });

  assert.equal(model.equity.returnPercent, 8);
  assert.equal(model.equity.navDelta, 8_000);
  assert.equal(model.equity.maxDrawdownAmount, -11_000);
  assert.equal(model.equity.maxDrawdownPercent, -10);
  assert.equal(model.equity.currentDrawdownPercent, -1.8181818181818181);
  assert.deepEqual(
    model.equity.pnlBars.map((bar) => ({
      value: bar.value,
      direction: bar.direction,
      magnitude: bar.magnitude,
    })),
    [
      { value: 10_000, direction: "up", magnitude: 10_000 / 11_000 },
      { value: -11_000, direction: "down", magnitude: 1 },
      { value: 9_000, direction: "up", magnitude: 9_000 / 11_000 },
    ],
  );
  assert.deepEqual(model.equity.benchmarkDeltas, [
    {
      key: "SPY",
      label: "SPY",
      returnPercent: 5,
      deltaPercent: 3,
    },
  ]);
});

test("buildAccountReturnsModel excludes external transfers from returns and P&L bars", () => {
  const model = buildAccountReturnsModel({
    range: "1M",
    equityHistory: {
      range: "1M",
      points: [
        point("2026-04-01T00:00:00.000Z", 100_000, null),
        {
          ...point("2026-04-02T00:00:00.000Z", 110_000, null),
          deposits: 10_000,
        },
        {
          ...point("2026-04-03T00:00:00.000Z", 108_500, null),
          withdrawals: 2_000,
        },
        point("2026-04-04T00:00:00.000Z", 112_000, null),
      ],
    },
  });

  assert.equal(model.equity.navDelta, 12_000);
  assert.equal(model.equity.navReturnPercent, 12);
  assert.equal(model.equity.transferAdjustedPnl, 4_000);
  assert.equal(model.equity.transferAdjustedCapitalBase, 110_000);
  assert.equal(model.equity.transferAdjustedReturnPercent, 100 * (4_000 / 110_000));
  assert.equal(model.equity.returnPercent, 100 * (4_000 / 110_000));
  assert.deepEqual(
    model.equity.pnlBars.map((bar) => bar.value),
    [0, 500, 3_500],
  );
});

test("buildAccountReturnsModel prefers provider transfer-adjusted return when present", () => {
  const model = buildAccountReturnsModel({
    equityHistory: {
      points: [
        point("2026-04-01T00:00:00.000Z", 100_000, 0),
        {
          ...point("2026-04-02T00:00:00.000Z", 110_000, 0),
          deposits: 10_000,
        },
      ],
    },
  });

  assert.equal(model.equity.returnPercent, 0);
  assert.equal(model.equity.navReturnPercent, 10);
});

test("buildAccountReturnsModel backs first-point external transfers out of YTD baseline", () => {
  const model = buildAccountReturnsModel({
    range: "YTD",
    equityHistory: {
      range: "YTD",
      points: [
        {
          ...point("2026-01-01T00:00:00.000Z", 110_000, null),
          deposits: 10_000,
        },
        point("2026-04-30T00:00:00.000Z", 115_000, null),
      ],
    },
  });

  assert.equal(model.equity.startNav, 110_000);
  assert.equal(model.equity.transferAdjustedStartNav, 100_000);
  assert.equal(model.equity.transferAdjustedCapitalBase, 110_000);
  assert.equal(model.equity.navReturnPercent, 100 * (5_000 / 110_000));
  assert.equal(model.equity.transferAdjustedPnl, 5_000);
  assert.equal(model.equity.transferAdjustedReturnPercent, 100 * (5_000 / 110_000));
  assert.equal(model.equity.returnPercent, 100 * (5_000 / 110_000));
  assert.deepEqual(
    model.equity.pnlBars.map((bar) => bar.value),
    [5_000],
  );
});

test("buildAccountReturnsModel does not inflate YTD returns when deposits dwarf starting NAV", () => {
  const model = buildAccountReturnsModel({
    range: "YTD",
    equityHistory: {
      range: "YTD",
      points: [
        point("2026-03-02T00:00:00.000Z", 0, null),
        {
          ...point("2026-03-03T00:00:00.000Z", 500, null),
          deposits: 500,
        },
        {
          ...point("2026-03-30T00:00:00.000Z", 225.5, null),
          withdrawals: 250,
        },
        {
          ...point("2026-04-21T00:00:00.000Z", 3_757.3, null),
          deposits: 3_500,
        },
        {
          ...point("2026-04-28T00:00:00.000Z", 5_724.7, null),
          deposits: 2_000,
        },
        point("2026-04-30T00:00:00.000Z", 5_759.34, null),
      ],
    },
  });

  assert.equal(model.equity.transferAdjustedCapitalBase, 6_000);
  assert.equal(Number(model.equity.transferAdjustedPnl.toFixed(2)), 9.34);
  assert.equal(
    Number(model.equity.transferAdjustedReturnPercent.toFixed(6)),
    0.155667,
  );
  assert.ok(model.equity.returnPercent < 1);
});

test("buildAccountReturnsModel summarizes trade attribution and expectancy", () => {
  const model = buildAccountReturnsModel({
    tradesResponse: {
      trades: [
        {
          symbol: "AAPL",
          assetClass: "Stocks",
          source: "LIVE",
          strategyLabel: "Manual",
          realizedPnl: 120,
          commissions: 1,
          holdDurationMinutes: 90,
        },
        {
          symbol: "AAPL",
          assetClass: "Stocks",
          source: "LIVE",
          strategyLabel: "Manual",
          realizedPnl: -40,
          commissions: 1,
          holdDurationMinutes: 2_900,
        },
        {
          symbol: "TSLA",
          assetClass: "Options",
          source: "FLEX",
          sourceType: "automation",
          realizedPnl: 20,
          commissions: 2,
          holdDurationMinutes: 12_000,
        },
      ],
    },
  });

  assert.equal(model.trades.count, 3);
  assert.equal(model.trades.winners, 2);
  assert.equal(model.trades.losers, 1);
  assert.equal(model.trades.realizedPnl, 100);
  assert.equal(model.trades.commissions, 4);
  assert.equal(model.trades.profitFactor, 3.5);
  assert.equal(model.trades.expectancy, 100 / 3);
  assert.equal(model.trades.groups.symbols[0].label, "AAPL");
  assert.equal(model.trades.groups.symbols[0].realizedPnl, 80);
  assert.equal(model.trades.groups.strategies[1].label, "automation");
});

test("buildAccountReturnsModel includes cash, positions, and insufficient-data flags", () => {
  const model = buildAccountReturnsModel({
    summary: {
      metrics: {
        netLiquidation: { value: 50_000 },
        totalCash: { value: 5_000 },
        totalPnl: { value: 1_500 },
        dayPnl: { value: -25 },
      },
    },
    positionsResponse: {
      positions: [
        { quantity: 10, unrealizedPnl: 700 },
        { quantity: 0, unrealizedPnl: 999 },
        { unrealizedPnl: -50 },
      ],
    },
    cashResponse: {
      dividendsMonth: 20,
      dividendsYtd: 120,
      interestPaidEarnedYtd: 12,
      feesYtd: 8,
    },
  });

  assert.equal(model.available.hasEquity, false);
  assert.equal(model.available.hasRiskAdjustedStats, false);
  assert.equal(model.positions.count, 2);
  assert.equal(model.positions.unrealizedPnl, 650);
  assert.equal(model.positions.totalPnl, 1_500);
  assert.equal(model.positions.dayPnl, -25);
  assert.equal(model.cash.cashWeightPercent, 10);
  assert.equal(model.cash.dividendsYtd, 120);
  assert.equal(model.cash.interestYtd, 12);
  assert.equal(model.cash.feesYtd, 8);
});

test("buildAccountReturnsModel samples compact point-to-point P&L bars", () => {
  const model = buildAccountReturnsModel({
    equityHistory: {
      points: Array.from({ length: 41 }, (_, index) =>
        point(
          new Date(Date.UTC(2026, 3, 1 + index)).toISOString(),
          100_000 + index * 100,
          index / 10,
        ),
      ),
    },
  });

  assert.equal(model.equity.pnlBars.length, 28);
  assert.ok(model.equity.pnlBars.every((bar) => Number.isFinite(bar.value)));
  assert.ok(model.equity.pnlBars.every((bar) => bar.direction === "up"));
  assert.ok(
    model.equity.pnlBars.every(
      (bar) => bar.magnitude > 0 && bar.magnitude <= 1,
    ),
  );
});

test("buildAccountReturnsModel omits P&L bars without enough equity points", () => {
  const model = buildAccountReturnsModel({
    equityHistory: {
      points: [point("2026-04-01T00:00:00.000Z", 100_000, 0)],
    },
  });

  assert.deepEqual(model.equity.pnlBars, []);
});

test("holdDurationBucket maps trade hold times into compact attribution buckets", () => {
  assert.equal(holdDurationBucket(null), "Unknown");
  assert.equal(holdDurationBucket(30), "Intraday");
  assert.equal(holdDurationBucket(2 * 24 * 60), "Swing");
  assert.equal(holdDurationBucket(10 * 24 * 60), "Position");
});

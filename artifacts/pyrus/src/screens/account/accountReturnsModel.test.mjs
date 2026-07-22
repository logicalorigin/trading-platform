import assert from "node:assert/strict";
import test from "node:test";

const { buildAccountReturnsModel } = await import("./accountReturnsModel.js");

// The account hero "Unrealized" KPI reads returnsModel.positions.unrealizedPnl.
// These tests pin the field so a degraded/absent positions response can never be
// misreported as a confident "+$0" (formatSignedMoney(0) -> "+$0", but
// formatSignedMoney(null) -> "—").

test("sums per-row unrealized P&L when open rows carry finite values", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [
        { quantity: 10, unrealizedPnl: 3182.1 },
        { quantity: 5, unrealizedPnl: 6660 },
      ],
      totals: { unrealizedPnl: 9999 },
    },
  });
  // Per-row sum wins over totals when rows have finite values.
  assert.equal(model.positions.unrealizedPnl, 3182.1 + 6660);
  assert.equal(model.positions.count, 2);
});

test("absent positions response yields null (renders '—'), not 0", () => {
  const model = buildAccountReturnsModel({ positionsResponse: undefined });
  assert.equal(model.positions.unrealizedPnl, null);
  assert.equal(model.positions.count, null);
});

test("drawdown stays unavailable until an authoritative NAV point exists", () => {
  const absent = buildAccountReturnsModel({});
  const observedFlat = buildAccountReturnsModel({
    equityHistory: {
      points: [
        {
          timestamp: "2026-07-21T20:00:00.000Z",
          netLiquidation: 1_000,
        },
      ],
    },
  });

  assert.equal(absent.equity.maxDrawdownAmount, null);
  assert.equal(absent.equity.maxDrawdownPercent, null);
  assert.equal(observedFlat.equity.maxDrawdownAmount, 0);
  assert.equal(observedFlat.equity.maxDrawdownPercent, 0);
});

test("absent trade populations stay unknown while explicit empty populations are zero", () => {
  const absent = buildAccountReturnsModel({ tradesResponse: undefined });
  const empty = buildAccountReturnsModel({ tradesResponse: { trades: [] } });

  assert.equal(absent.trades.count, null);
  assert.equal(absent.trades.outcomeCount, null);
  assert.equal(absent.trades.winners, null);
  assert.equal(absent.trades.losers, null);
  assert.equal(empty.trades.count, 0);
  assert.equal(empty.trades.outcomeCount, 0);
  assert.equal(empty.trades.winners, 0);
  assert.equal(empty.trades.losers, 0);
});

test("explicit empty position populations report zero positions", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: { positions: [], totals: {} },
  });
  assert.equal(model.positions.count, 0);
});

test("degraded response with empty rows but populated totals uses totals", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [],
      totals: { unrealizedPnl: 3182.1 },
    },
  });
  assert.equal(model.positions.unrealizedPnl, 3182.1);
});

test("present response with open rows lacking unrealized falls back to totals", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [{ quantity: 10, unrealizedPnl: null }],
      totals: { unrealizedPnl: 1234.5 },
    },
  });
  assert.equal(model.positions.unrealizedPnl, 1234.5);
});

test("a partial row population falls back to the complete unrealized total", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [
        { quantity: 10, unrealizedPnl: 25 },
        { quantity: 5, unrealizedPnl: null },
      ],
      totals: { unrealizedPnl: 75 },
    },
  });

  assert.equal(model.positions.unrealizedPnl, 75);
});

test("present response with no rows and no totals is unknown (null), not 0", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: { positions: [], totals: {} },
  });
  assert.equal(model.positions.unrealizedPnl, null);
});

test("genuinely flat account (rows report zero) reports 0, not null", () => {
  const model = buildAccountReturnsModel({
    positionsResponse: {
      positions: [{ quantity: 10, unrealizedPnl: 0 }],
      totals: { unrealizedPnl: 0 },
    },
  });
  assert.equal(model.positions.unrealizedPnl, 0);
});

test("incomplete trade populations withhold aggregate hero economics", () => {
  const model = buildAccountReturnsModel({
    tradesResponse: {
      trades: [
        { symbol: "SPY", realizedPnl: 100 },
        { symbol: "SPY", realizedPnl: null },
        { symbol: "SPY", realizedPnl: "" },
        { symbol: "SPY", realizedPnl: -50 },
      ],
    },
  });

  assert.equal(model.trades.count, 4);
  assert.equal(model.trades.outcomeCount, 2);
  assert.equal(model.trades.realizedPnl, null);
  assert.equal(model.trades.winRate, null);
  assert.equal(model.trades.expectancy, null);
});

test("all-missing trade economics remain unavailable instead of becoming zero", () => {
  const model = buildAccountReturnsModel({
    tradesResponse: {
      trades: [
        { symbol: "SPY", realizedPnl: null, commissions: null },
        { symbol: "QQQ", realizedPnl: "", commissions: "" },
      ],
    },
  });

  assert.equal(model.trades.outcomeCount, 0);
  assert.equal(model.trades.realizedPnl, null);
  assert.equal(model.trades.winRate, null);
  assert.equal(model.trades.profitFactor, null);
  assert.equal(model.trades.expectancy, null);
});

test("returns model exposes only fields consumed by the account hero", () => {
  const model = buildAccountReturnsModel({});

  assert.deepEqual(Object.keys(model).sort(), [
    "available",
    "cash",
    "equity",
    "positions",
    "range",
    "risk",
    "trades",
  ]);
  assert.deepEqual(Object.keys(model.equity).sort(), [
    "currentDrawdownAmount",
    "currentDrawdownPercent",
    "maxDrawdownAmount",
    "maxDrawdownPercent",
    "providerReturnPercent",
    "returnPercent",
    "returnPercentDiscrepancy",
    "transferAdjustedPnl",
  ]);
  assert.deepEqual(Object.keys(model.trades).sort(), [
    "count",
    "expectancy",
    "losers",
    "outcomeCount",
    "profitFactor",
    "realizedPnl",
    "winRate",
    "winners",
  ]);
  assert.deepEqual(Object.keys(model.positions).sort(), ["count", "unrealizedPnl"]);
  assert.deepEqual(Object.keys(model.cash).sort(), [
    "dividendsYtd",
    "feesYtd",
    "interestYtd",
  ]);
  assert.deepEqual(Object.keys(model.risk).sort(), [
    "sharpeLike",
    "sortinoLike",
    "volatilityPercent",
  ]);
  assert.deepEqual(Object.keys(model.available), ["hasRiskAdjustedStats"]);
});

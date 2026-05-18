import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountAnalysisReadiness,
  buildAccountTradeLifecycleRows,
  buildAccountTradingAnalysisModel,
  feeDragBucket,
  getAccountTradeId,
  holdDurationBucket,
} from "./accountTradingAnalysis.js";

const trades = [
  {
    id: "t1",
    source: "SHADOW",
    symbol: "AAPL",
    side: "sell",
    assetClass: "Stocks",
    quantity: 10,
    avgOpen: 100,
    avgClose: 108,
    closeDate: "2026-05-01T15:00:00.000Z",
    realizedPnl: 80,
    commissions: 1,
    sourceType: "manual",
    strategyLabel: "Manual",
    holdDurationMinutes: 75,
  },
  {
    id: "t2",
    source: "SHADOW",
    symbol: "MSFT",
    side: "sell",
    assetClass: "Stocks",
    quantity: 4,
    avgOpen: 300,
    avgClose: 285,
    closeDate: "2026-05-01T16:00:00.000Z",
    realizedPnl: -60,
    commissions: 18,
    sourceType: "automation",
    strategyLabel: "Signal Bot",
    candidateId: "cand-1",
    holdDurationMinutes: 20,
  },
  {
    id: "t3",
    source: "SHADOW",
    symbol: "MSFT",
    side: "sell",
    assetClass: "Stocks",
    quantity: 4,
    avgOpen: 280,
    avgClose: 270,
    closeDate: "2026-05-01T17:00:00.000Z",
    realizedPnl: -40,
    commissions: 2,
    sourceType: "automation",
    strategyLabel: "Signal Bot",
    holdDurationMinutes: 180,
  },
];

test("account trading analysis selects representative trades and issue cards", () => {
  const model = buildAccountTradingAnalysisModel({
    trades,
    orders: [],
    positions: [],
  });

  assert.equal(model.summary.count, 3);
  assert.equal(model.representativeTrades[0].key, "best-winner");
  assert.equal(model.representativeTrades[0].tradeId, "SHADOW:t1");
  assert.equal(model.issueCards[0].key, "worst-symbol");
  assert.equal(model.issueCards[0].symbol, "MSFT");
  assert.equal(model.bucketGroups.source[0].key, "automation");
});

test("account trading analysis builds selected trade details and lifecycle rows", () => {
  const model = buildAccountTradingAnalysisModel({
    trades,
    selectedTradeId: "SHADOW:t2",
    orders: [
      {
        id: "o1",
        symbol: "MSFT",
        type: "LMT",
        status: "filled",
        sourceType: "automation",
        candidateId: "cand-1",
        filledAt: "2026-05-01T16:00:00.000Z",
      },
    ],
    positions: [{ id: "p1", symbol: "MSFT", quantity: 2 }],
  });

  assert.equal(getAccountTradeId(model.selectedTradeDetail.trade), "SHADOW:t2");
  assert.equal(model.selectedTradeDetail.relatedOrders.length, 1);
  assert.equal(model.selectedTradeDetail.relatedPositions.length, 1);
  assert.ok(model.lifecycleRows.some((row) => row.key === "order"));
  assert.ok(model.lifecycleRows.some((row) => row.key === "position"));
});

test("account trade ids stay distinct when imported trades lack source ids", () => {
  const first = getAccountTradeId({
    symbol: "RBLX",
    closeDate: "2026-05-13T15:00:00.000Z",
    side: "sell",
    quantity: 1,
  });
  const second = getAccountTradeId({
    symbol: "RBLX",
    closeDate: "2026-05-13T16:00:00.000Z",
    side: "sell",
    quantity: 1,
  });

  assert.notEqual(first, second);
  assert.equal(first.startsWith("TRADE:RBLX:"), true);
});

test("account lifecycle omits unavailable rows", () => {
  const rows = buildAccountTradeLifecycleRows({
    trade: {
      id: "solo",
      source: "FLEX",
      symbol: "QQQ",
      closeDate: "2026-05-01T16:00:00.000Z",
      realizedPnl: 12,
    },
  });

  assert.ok(rows.some((row) => row.key === "result"));
  assert.equal(rows.some((row) => row.key === "order"), false);
});

test("account trading analysis buckets hold time and fee drag", () => {
  assert.equal(holdDurationBucket(10), "intraday-fast");
  assert.equal(holdDurationBucket(120), "intraday");
  assert.equal(holdDurationBucket(720), "swing");
  assert.equal(holdDurationBucket(3_000), "multi-day");
  assert.equal(feeDragBucket({ realizedPnl: -60, commissions: 18 }), "high");
  assert.equal(feeDragBucket({ realizedPnl: 80, commissions: 1 }), "low");
});

test("account trading analysis reports readiness state", () => {
  const model = buildAccountTradingAnalysisModel({
    trades,
    orders: [{ id: "o1", symbol: "AAPL" }],
    positions: [{ id: "p1", symbol: "AAPL" }],
  });

  const closedTrades = model.readiness.find((row) => row.key === "closed-trades");
  const feeCoverage = model.readiness.find((row) => row.key === "fee-coverage");
  const orderContext = model.readiness.find((row) => row.key === "order-context");

  assert.equal(closedTrades.state, "ready");
  assert.equal(closedTrades.value, 3);
  assert.equal(feeCoverage.state, "ready");
  assert.equal(orderContext.value, 1);
});

test("account analysis readiness distinguishes waiting and optional inputs", () => {
  const readiness = buildAccountAnalysisReadiness();

  assert.equal(readiness.find((row) => row.key === "closed-trades").state, "waiting");
  assert.equal(readiness.find((row) => row.key === "fee-coverage").state, "optional");
  assert.equal(readiness.find((row) => row.key === "order-context").detail, "No order rows");
});

test("account trading analysis groups option outcomes and stop scenarios", () => {
  const model = buildAccountTradingAnalysisModel({
    trades: [
      {
        id: "opt-1",
        source: "SHADOW",
        symbol: "SPY",
        side: "sell",
        assetClass: "Options",
        quantity: 2,
        avgOpen: 1,
        avgClose: 0.4,
        closeDate: "2026-05-01T16:00:00.000Z",
        realizedPnl: -120,
        commissions: 2,
        optionRight: "put",
        dte: 1,
        strikeSlot: 2,
        exitReason: "hard_stop",
        peakPrice: 1.7,
        mfePercent: 70,
        givebackPercent: 130,
        adx: 18,
        mtfDirections: [1, 1, 1],
      },
      {
        id: "opt-2",
        source: "SHADOW",
        symbol: "QQQ",
        side: "sell",
        assetClass: "Options",
        quantity: 1,
        avgOpen: 1,
        avgClose: 2.2,
        closeDate: "2026-05-01T17:00:00.000Z",
        realizedPnl: 120,
        commissions: 1,
        optionRight: "call",
        dte: 3,
        strikeSlot: 3,
        exitReason: "expiration",
        peakPrice: 2.4,
        mfePercent: 140,
        givebackPercent: 20,
        adx: 30,
        mtfDirections: [1, 1, 1],
      },
    ],
  });

  assert.equal(model.bucketGroups.optionRight.length, 2);
  assert.equal(model.bucketGroups.exitReason.some((group) => group.key === "hard_stop"), true);
  assert.equal(model.bucketGroups.dte.some((group) => group.key === "1dte"), true);
  assert.equal(model.bucketGroups.mfeGiveback.some((group) => group.key === "large-giveback"), true);
  assert.ok(model.stopScenarios.length >= 3);
  assert.equal(model.contractBreakdowns.strikeSlot.some((group) => group.key === "2"), true);
});

test("risk metrics: empty trades produce nulls", () => {
  const model = buildAccountTradingAnalysisModel({ trades: [] });
  assert.equal(model.riskMetrics.sortinoRatio, null);
  assert.equal(model.riskMetrics.calmarRatio, null);
  assert.equal(model.riskMetrics.maxDrawdown, null);
  assert.equal(model.riskMetrics.monteCarloP05Pnl, null);
  assert.equal(model.riskMetrics.monteCarloLossProbabilityPercent, null);
  assert.deepEqual(model.waterfall, []);
});

test("risk metrics: Sortino positive when mean > 0 with one loser", () => {
  const sample = [
    { id: "s1", symbol: "AAA", closeDate: "2026-01-01T15:00:00Z", realizedPnl: 100 },
    { id: "s2", symbol: "BBB", closeDate: "2026-01-02T15:00:00Z", realizedPnl: 80 },
    { id: "s3", symbol: "CCC", closeDate: "2026-01-03T15:00:00Z", realizedPnl: -40 },
  ];
  const model = buildAccountTradingAnalysisModel({ trades: sample });
  assert.ok(model.riskMetrics.sortinoRatio > 0);
});

test("risk metrics: Sortino null when no losers", () => {
  const sample = [
    { id: "w1", symbol: "AAA", closeDate: "2026-01-01T15:00:00Z", realizedPnl: 100 },
    { id: "w2", symbol: "BBB", closeDate: "2026-01-02T15:00:00Z", realizedPnl: 80 },
    { id: "w3", symbol: "CCC", closeDate: "2026-01-03T15:00:00Z", realizedPnl: 60 },
  ];
  const model = buildAccountTradingAnalysisModel({ trades: sample });
  assert.equal(model.riskMetrics.sortinoRatio, null);
});

test("risk metrics: max drawdown reflects peak-to-trough", () => {
  const sample = [
    { id: "d1", symbol: "X", closeDate: "2026-01-01T15:00:00Z", realizedPnl: 200 },
    { id: "d2", symbol: "X", closeDate: "2026-01-02T15:00:00Z", realizedPnl: -150 },
    { id: "d3", symbol: "X", closeDate: "2026-01-03T15:00:00Z", realizedPnl: 50 },
  ];
  const model = buildAccountTradingAnalysisModel({ trades: sample });
  assert.equal(model.riskMetrics.peakEquity, 200);
  assert.equal(model.riskMetrics.maxDrawdown, 150);
  assert.equal(model.riskMetrics.calmarRatio, (200 - 150 + 50) / 150);
});

test("risk metrics: Monte Carlo only runs with 10+ trades", () => {
  const few = [
    { id: "a", symbol: "X", closeDate: "2026-01-01T15:00:00Z", realizedPnl: 5 },
    { id: "b", symbol: "X", closeDate: "2026-01-02T15:00:00Z", realizedPnl: -3 },
  ];
  const fewModel = buildAccountTradingAnalysisModel({ trades: few });
  assert.equal(fewModel.riskMetrics.monteCarloP05Pnl, null);

  const many = Array.from({ length: 12 }).map((_, index) => ({
    id: `mc${index}`,
    symbol: "X",
    closeDate: `2026-01-${String(index + 1).padStart(2, "0")}T15:00:00Z`,
    realizedPnl: index % 2 === 0 ? 50 : -20,
  }));
  const manyModel = buildAccountTradingAnalysisModel({ trades: many });
  assert.equal(typeof manyModel.riskMetrics.monteCarloP05Pnl, "number");
  assert.equal(
    typeof manyModel.riskMetrics.monteCarloLossProbabilityPercent,
    "number",
  );
});

test("waterfall: returns trades sorted by close time with running cumulative", () => {
  const sample = [
    { id: "w-c", symbol: "C", closeDate: "2026-01-03T15:00:00Z", realizedPnl: 30 },
    { id: "w-a", symbol: "A", closeDate: "2026-01-01T15:00:00Z", realizedPnl: 100 },
    { id: "w-b", symbol: "B", closeDate: "2026-01-02T15:00:00Z", realizedPnl: -40 },
  ];
  const model = buildAccountTradingAnalysisModel({ trades: sample });
  assert.equal(model.waterfall.length, 3);
  assert.equal(model.waterfall[0].symbol, "A");
  assert.equal(model.waterfall[0].cumulative, 100);
  assert.equal(model.waterfall[1].symbol, "B");
  assert.equal(model.waterfall[1].cumulative, 60);
  assert.equal(model.waterfall[2].symbol, "C");
  assert.equal(model.waterfall[2].cumulative, 90);
});

test("waterfall: caps to last 40 trades", () => {
  const sample = Array.from({ length: 55 }).map((_, index) => ({
    id: `t${index}`,
    symbol: `T${index}`,
    closeDate: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T${String(
      index % 24,
    ).padStart(2, "0")}:00:00Z`,
    realizedPnl: index % 3 === 0 ? -10 : 5,
  }));
  const model = buildAccountTradingAnalysisModel({ trades: sample });
  assert.equal(model.waterfall.length, 40);
});

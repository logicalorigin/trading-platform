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

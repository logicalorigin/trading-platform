import assert from "node:assert/strict";
import test from "node:test";

import * as filterModel from "./tradingAnalysisFilters.js";
import {
  buildAccountAnalysisQueryParams,
  buildRangeDateBounds,
  buildSymbolSparklineMap,
  buildTradingAnalysisKpis,
  defaultTradingAnalysisFilters,
  normalizeTradingAnalysisFilters,
  resolveTradingAnalysisDateScope,
  tradingAnalysisFilterReducer,
} from "./tradingAnalysisModel.js";

test("empty trading analysis leaves ratio metrics undefined", () => {
  const { metrics } = buildTradingAnalysisKpis({ trades: [] });

  assert.equal(metrics.trades, 0);
  assert.equal(metrics.netPnl, null);
  assert.equal(metrics.commissions, null);
  assert.equal(metrics.profitFactor, null);
  assert.equal(metrics.averageWin, null);
  assert.equal(metrics.averageLoss, null);
});

test("trading analysis exposes average winner and loser for compact account cards", () => {
  const { metrics } = buildTradingAnalysisKpis({
    trades: [
      {
        realizedPnl: 100,
        closeDate: "2026-07-01T20:00:00.000Z",
      },
      {
        realizedPnl: -40,
        closeDate: "2026-07-02T20:00:00.000Z",
      },
      {
        realizedPnl: 60,
        closeDate: "2026-07-03T20:00:00.000Z",
      },
      {
        realizedPnl: -20,
        closeDate: "2026-07-04T20:00:00.000Z",
      },
    ],
  });

  assert.equal(metrics.netPnl, 100);
  assert.equal(metrics.winRatePercent, 50);
  assert.equal(metrics.averageWin, 80);
  assert.equal(metrics.averageLoss, -30);
  assert.equal(metrics.profitFactor, 160 / 60);
  assert.equal(metrics.maxDrawdown, 40);
});

test("order-dependent metrics require a close instant for every outcome", () => {
  const { metrics } = buildTradingAnalysisKpis({
    trades: [
      { realizedPnl: 100, closeDate: "2026-07-01T20:00:00.000Z" },
      { realizedPnl: -80, closeDate: "2026-07-02T20:00:00.000Z" },
      { realizedPnl: 10 },
    ],
  });

  assert.equal(metrics.netPnl, 30);
  assert.equal(metrics.maxDrawdown, null);
  assert.equal(metrics.calmarRatio, null);
});

test("an entry timestamp cannot stand in for missing realized-P&L chronology", () => {
  const trades = [
    {
      symbol: "AAPL",
      realizedPnl: 100,
      closeDate: "2026-07-01T20:00:00.000Z",
    },
    {
      symbol: "AAPL",
      realizedPnl: -20,
      openDate: "2026-07-02T14:00:00.000Z",
    },
    {
      symbol: "MSFT",
      realizedPnl: 5,
      closeDate: "2026-07-03T20:00:00.000Z",
    },
  ];
  const { metrics } = buildTradingAnalysisKpis({ trades });
  const sparklines = buildSymbolSparklineMap(trades);

  assert.equal(metrics.maxDrawdown, null);
  assert.equal(metrics.calmarRatio, null);
  assert.equal(sparklines.has("AAPL"), false);
  assert.deepEqual(sparklines.get("MSFT"), [5]);
});

test("a complete all-winner sequence preserves its known zero drawdown", () => {
  const { metrics } = buildTradingAnalysisKpis({
    trades: [
      { realizedPnl: 10, closeDate: "2026-07-01T20:00:00.000Z" },
      { realizedPnl: 20, closeDate: "2026-07-02T20:00:00.000Z" },
      { realizedPnl: 30, closeDate: "2026-07-03T20:00:00.000Z" },
    ],
  });

  assert.equal(metrics.maxDrawdown, 0);
  assert.equal(metrics.calmarRatio, null);
});

test("trading analysis excludes missing outcomes and hold durations", () => {
  const { metrics } = buildTradingAnalysisKpis({
    trades: [
      { realizedPnl: 100, holdDurationMinutes: 30 },
      { realizedPnl: null, holdDurationMinutes: null },
      { realizedPnl: "", holdDurationMinutes: " " },
      { realizedPnl: -40, holdDurationMinutes: 90 },
    ],
  });

  assert.equal(metrics.trades, 4);
  assert.equal(metrics.outcomeCount, 2);
  assert.equal(metrics.netPnl, null);
  assert.equal(metrics.winRatePercent, null);
  assert.equal(metrics.expectancy, null);
  assert.equal(metrics.averageHoldMinutes, null);
  assert.equal(metrics.maxDrawdown, null);
  assert.equal(metrics.sharpeRatio, null);
});

test("trading-analysis KPIs expose only production-consumed fields", () => {
  const result = buildTradingAnalysisKpis({ trades: [] });

  assert.equal("sparkline" in result, false);
  assert.equal("feeCount" in result.metrics, false);
  assert.equal("holdDurationCount" in result.metrics, false);
});

test("trading analysis does not total an incomplete commission population", () => {
  const { metrics } = buildTradingAnalysisKpis({
    trades: [
      { realizedPnl: 10, commissions: 1 },
      { realizedPnl: -5, commissions: null },
    ],
  });

  assert.equal(metrics.netPnl, 5);
  assert.equal(metrics.commissions, null);
});

test("trading analysis model reuses the shared filter helpers", () => {
  assert.equal(
    defaultTradingAnalysisFilters,
    filterModel.defaultTradingAnalysisFilters,
  );
  assert.equal(
    normalizeTradingAnalysisFilters,
    filterModel.normalizeTradingAnalysisFilters,
  );
  assert.equal(
    tradingAnalysisFilterReducer,
    filterModel.tradingAnalysisFilterReducer,
  );
  assert.equal(buildRangeDateBounds, filterModel.buildRangeDateBounds);
  assert.equal(
    resolveTradingAnalysisDateScope,
    filterModel.resolveTradingAnalysisDateScope,
  );
  assert.equal(
    buildAccountAnalysisQueryParams,
    filterModel.buildAccountAnalysisQueryParams,
  );
});

test("shared trading analysis filters preserve normalization behavior", () => {
  assert.deepEqual(
    normalizeTradingAnalysisFilters({
      symbol: " spy ",
      assetClass: "option",
      pnlSign: "winners",
      side: " LONG ",
      holdDuration: "intraday",
      feeDrags: ["high", "all", "high"],
      closeHour: 9,
      recentOnly: 1,
    }),
    {
      ...defaultTradingAnalysisFilters(),
      symbol: "SPY",
      assetClass: "option",
      pnlSign: "winners",
      side: "long",
      holdDuration: "intraday",
      holdDurations: ["intraday"],
      feeDrags: ["high"],
      closeHour: "9",
      recentOnly: true,
    },
  );

  assert.deepEqual(
    tradingAnalysisFilterReducer(
      { holdDurations: ["intraday"], feeDrags: ["high"] },
      { type: "toggleArray", key: "holdDurations", value: "swing" },
    ).holdDurations,
    ["intraday", "swing"],
  );
});

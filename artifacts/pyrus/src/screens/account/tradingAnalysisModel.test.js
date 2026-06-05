import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountAnalysisQueryParams,
  buildRangeDateBounds,
  buildTradingAnalysisKpis,
  closeDateMatchesTradingAnalysisHour,
  defaultTradingAnalysisFilters,
  describeActiveAnalysisFilters,
  filterAccountAnalysisTrades,
  tradingAnalysisFilterReducer,
} from "./tradingAnalysisModel.js";

const NOW = Date.UTC(2026, 4, 21, 16, 0, 0);

const trades = [
  {
    id: "a",
    source: "FLEX",
    symbol: "AAPL",
    side: "buy",
    assetClass: "Stocks",
    closeDate: "2026-05-21T15:00:00.000Z",
    realizedPnl: 120,
    commissions: 2,
    holdDurationMinutes: 40,
    sourceType: "manual",
    strategyLabel: "Manual",
  },
  {
    id: "b",
    source: "FLEX",
    symbol: "MSFT",
    side: "sell short",
    assetClass: "Options",
    closeDate: "2026-05-20T15:00:00.000Z",
    realizedPnl: -80,
    commissions: 30,
    holdDurationMinutes: 20,
    sourceType: "automation",
    strategyLabel: "Signal Bot",
    optionRight: "call",
    dte: 1,
  },
  {
    id: "c",
    source: "FLEX",
    symbol: "NVDA",
    side: "sell",
    assetClass: "Stocks",
    closeDate: "2026-04-01T15:00:00.000Z",
    realizedPnl: 40,
    commissions: 1,
    holdDurationMinutes: 2_000,
    sourceType: "manual",
    strategyLabel: "Manual",
  },
];

test("trading analysis range bounds derive deterministic date scopes", () => {
  assert.deepEqual(buildRangeDateBounds("1W", NOW), { from: "2026-05-15", to: "" });
  assert.deepEqual(buildRangeDateBounds("YTD", NOW), { from: "2026-01-01", to: "" });
  assert.deepEqual(buildRangeDateBounds("ALL", NOW), { from: "", to: "" });
});

test("trading analysis query params keep server-safe filters only", () => {
  const params = buildAccountAnalysisQueryParams({
    modeParams: { mode: "live" },
    range: "1W",
    nowMs: NOW,
    filters: {
      symbol: "aapl",
      assetClass: "Stocks",
      pnlSign: "winners",
      side: "long",
      holdDurations: ["intraday"],
      feeDrags: ["low", "high"],
    },
  });

  assert.equal(params.mode, "live");
  assert.equal(params.symbol, "AAPL");
  assert.equal(params.assetClass, "Stocks");
  assert.equal(params.pnlSign, "winners");
  assert.equal(params.holdDuration, "intraday");
  assert.match(params.from, /^2026-05-15T/);
  assert.equal(params.to, undefined);
  assert.equal("side" in params, false);
  assert.equal("feeDrags" in params, false);
});

test("trading analysis filters apply client-only dimensions together", () => {
  const filtered = filterAccountAnalysisTrades({
    trades,
    range: "ALL",
    nowMs: NOW,
    filters: {
      side: "short",
      feeDrags: ["high"],
      sourceType: "automation",
      holdDurations: ["intraday-fast"],
    },
  });

  assert.deepEqual(filtered.map((trade) => trade.symbol), ["MSFT"]);
});

test("trading analysis close-hour lens uses New York market time", () => {
  assert.equal(closeDateMatchesTradingAnalysisHour("2026-05-01T14:30:00.000Z", "10"), true);
  assert.equal(closeDateMatchesTradingAnalysisHour("2026-05-01T14:30:00.000Z", "09"), false);
});

test("trading analysis explicit date range overrides account range", () => {
  const filtered = filterAccountAnalysisTrades({
    trades,
    range: "1D",
    nowMs: NOW,
    filters: { from: "2026-04-01", to: "2026-05-20" },
  });

  assert.deepEqual(filtered.map((trade) => trade.symbol), ["MSFT", "NVDA"]);
});

test("trading analysis reducer toggles multi-value filters", () => {
  let state = defaultTradingAnalysisFilters();
  state = tradingAnalysisFilterReducer(state, {
    type: "toggleArray",
    key: "holdDurations",
    value: "intraday",
  });
  state = tradingAnalysisFilterReducer(state, {
    type: "toggleArray",
    key: "holdDurations",
    value: "swing",
  });
  state = tradingAnalysisFilterReducer(state, {
    type: "remove",
    key: "holdDurations",
    value: "intraday",
  });

  assert.deepEqual(state.holdDurations, ["swing"]);
});

test("trading analysis kpis include added risk metrics", () => {
  const kpis = buildTradingAnalysisKpis({ trades });

  assert.equal(kpis.metrics.trades, 3);
  assert.equal(kpis.metrics.netPnl, 80);
  assert.equal(kpis.metrics.averageHoldMinutes, 686.6666666666666);
  assert.equal(typeof kpis.metrics.sharpeRatio, "number");
  assert.equal(typeof kpis.metrics.sortinoRatio, "number");
  assert.equal(kpis.metrics.maxDrawdown, 80);
});

test("trading analysis kpis count unknown-P&L manual activity without treating it as flat", () => {
  const kpis = buildTradingAnalysisKpis({
    trades: [
      {
        id: "known",
        source: "FLEX",
        symbol: "AAPL",
        closeDate: "2026-05-21T15:00:00.000Z",
        realizedPnl: 120,
        sourceType: "manual",
      },
      {
        id: "manual-live-order",
        source: "LIVE_ORDER",
        symbol: "F",
        closeDate: "2026-05-21T16:00:00.000Z",
        realizedPnl: null,
        sourceType: "manual",
      },
    ],
  });

  assert.equal(kpis.metrics.trades, 2);
  assert.equal(kpis.metrics.netPnl, 120);
  assert.equal(kpis.metrics.winRatePercent, 100);
  assert.equal(kpis.metrics.expectancy, 120);
});

test("trading analysis active chips describe clearable state", () => {
  const chips = describeActiveAnalysisFilters({
    symbol: "aapl",
    pnlSign: "winners",
    holdDurations: ["intraday"],
    feeDrags: ["high"],
    from: "2026-05-01",
  });

  assert.deepEqual(
    chips.map((chip) => chip.label),
    ["Symbol: AAPL", "Winners", "Hold: 30m-4h", "Fee: High fee", "Dates: 2026-05-01 -> now"],
  );
});

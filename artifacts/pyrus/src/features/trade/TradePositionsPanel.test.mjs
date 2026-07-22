import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPositionTradeManagement } from "../account/positionTradeManagement.js";
import { __tradePositionsPanelInternalsForTests } from "./TradePositionsPanel.jsx";

const {
  buildTradePositionFallbackSparklineData,
  buildTradePositionLoadIntent,
  resolveTradePositionSparklinePositive,
  resolveTradePositionsViewState,
  resolveTradeSpotPrice,
  resolveTradeSpotSymbol,
  tradeManagementStopBadge,
  tradeManagementTrailBadge,
} = __tradePositionsPanelInternalsForTests;

const source = readFileSync(
  new URL("./TradePositionsPanel.jsx", import.meta.url),
  "utf8",
);

test("seven-day broker history does not impose a silent 64-execution cap", () => {
  assert.match(
    source,
    /listBrokerExecutionsRequest\(\{\s*accountId,\s*days:\s*7,\s*\}\)/,
  );
  assert.match(
    source,
    /new URLSearchParams\(\{\s*accountId,\s*days:\s*"7",\s*\}\)/,
  );
  assert.doesNotMatch(source, /\blimit:\s*(?:64|"64")/);
});

test("the execution stream uses the same direct-broker gate as its REST query", () => {
  assert.match(
    source,
    /const executionsQuery = useQuery\([\s\S]*?enabled: brokerPanelEnabled,[\s\S]*?useEffect\(\(\) => \{\s*if \(\s*!brokerPanelEnabled \|\|\s*streamingPaused/,
  );
  assert.match(
    source,
    /normalizeBrokerExecutionsPayload\(JSON\.parse\(event\.data\)\)/,
  );
});

test("open positions keep loading, error, stale, and refreshing states distinct", () => {
  assert.deepEqual(
    resolveTradePositionsViewState({
      enabled: true,
      isPending: true,
    }),
    { kind: "loading", preserveRows: false },
  );
  assert.deepEqual(
    resolveTradePositionsViewState({
      enabled: true,
      isError: true,
    }),
    { kind: "error", preserveRows: false },
  );
  assert.deepEqual(
    resolveTradePositionsViewState({
      enabled: true,
      data: { positions: [] },
      isError: true,
    }),
    { kind: "stale", preserveRows: true },
  );
  assert.deepEqual(
    resolveTradePositionsViewState({
      enabled: true,
      data: { positions: [] },
      isFetching: true,
    }),
    { kind: "refreshing", preserveRows: true },
  );
  assert.deepEqual(
    resolveTradePositionsViewState({
      enabled: true,
      data: { positions: [] },
    }),
    { kind: "ready", preserveRows: true },
  );
  assert.deepEqual(
    resolveTradePositionsViewState({
      enabled: false,
      isPending: true,
    }),
    { kind: "idle", preserveRows: false },
  );
});

test("trade positions use canonical account rows for Spot and trailing-stop state", () => {
  assert.match(source, /useGetAccountPositions/);
  assert.doesNotMatch(source, /\buseListPositions\b/);
  assert.match(source, /position\.marketDataSymbol/);
  assert.match(source, /entry:\s*position\.averageCost/);
  assert.match(source, /mark:\s*position\.mark/);
  assert.match(source, /position\?\.underlyingMarket/);
});

test("ALM option Spot uses its equity underlier and canonical risk overlay", () => {
  const canonical = {
    id: "shadow:ALM-put",
    accountId: "shadow",
    symbol: "ALM",
    marketDataSymbol: "ALM",
    assetClass: "Options",
    quantity: 7,
    averageCost: 1.99,
    mark: 2.77,
    unrealizedPnl: 546,
    unrealizedPnlPercent: 39.2,
    optionContract: {
      underlying: "ALM",
      expirationDate: "2026-07-17",
      strike: 17.5,
      right: "put",
      multiplier: 100,
    },
    underlyingMarket: { symbol: "ALM", price: 15.01 },
    optionQuote: { mark: 2.77, underlyingPrice: 15.01 },
    riskOverlay: {
      activeStopKind: "trailing_stop",
      activeStopPrice: 1.99,
      hardStopPrice: 1.59,
      trailActive: true,
      trailHasTakenOver: true,
      trailStopPrice: 1.99,
    },
  };

  assert.equal(resolveTradeSpotSymbol(canonical), "ALM");
  assert.equal(resolveTradeSpotPrice(canonical), 15.01);
  assert.equal(resolveTradeSpotPrice(canonical, { ALM: { price: 15.02 } }), 15.02);
  assert.equal(buildPositionTradeManagement(canonical).trail?.price, 1.99);

  const noUnderlying = {
    ...canonical,
    underlyingMarket: null,
    optionQuote: { mark: 2.77, underlyingPrice: 2.77 },
    quote: { underlyingPrice: 2.77 },
  };
  assert.equal(resolveTradeSpotPrice(noUnderlying), null);
});

test("Trade SL and TRL badges show signed projected returns instead of stop distance", () => {
  assert.equal(
    tradeManagementStopBadge({
      stop: { price: 90 },
      trail: null,
      riskDistancePct: 18.2,
      stopProjectedReturnPct: -10,
    }),
    "-10.0%",
  );
  assert.equal(
    tradeManagementTrailBadge({
      trail: { price: 120 },
      riskDistancePct: 7.7,
      trailProjectedReturnPct: 20,
    }),
    "+20.0%",
  );
  assert.equal(
    tradeManagementStopBadge({
      stop: { price: 80 },
      trail: { price: 120 },
      stopProjectedReturnPct: -20,
    }),
    "-20.0%",
    "the hard-stop outcome remains visible beside its active trail outcome",
  );
});

test("Trade option sparkline cannot use option premium or option return as stock history", () => {
  const optionPosition = {
    ticker: "ALM",
    mark: 2.77,
    entry: 1.99,
    pct: 39.2,
    optionContract: { underlying: "ALM" },
    underlyingMarket: null,
  };

  assert.deepEqual(
    buildTradePositionFallbackSparklineData(optionPosition, null, "ALM"),
    [],
  );

  const data = buildTradePositionFallbackSparklineData(
    optionPosition,
    { price: 15, pct: -2 },
    "ALM",
  );
  assert.ok(Math.abs(data[0].v - 15 / 0.98) < 1e-9);
  assert.equal(data.at(-1).v, 15);
});

test("Trade sparkline stays empty without a real prior-price baseline", () => {
  assert.deepEqual(
    buildTradePositionFallbackSparklineData(
      { ticker: "AAPL", assetClass: "equity" },
      { price: 210 },
      "AAPL",
    ),
    [],
  );
});

test("Trade option sparkline color follows the stock, not the option return", () => {
  const optionPosition = {
    ticker: "ALM",
    pct: 39.2,
    optionContract: { underlying: "ALM" },
    underlyingMarket: null,
  };

  assert.equal(resolveTradePositionSparklinePositive(optionPosition, null), null);
  assert.equal(
    resolveTradePositionSparklinePositive(optionPosition, { pct: -2 }),
    false,
  );
});

test("position Trade actions preserve equity versus option ticket intent", () => {
  assert.deepEqual(
    buildTradePositionLoadIntent({ ticker: "AAPL", optionLoadContract: null }),
    { ticker: "AAPL", assetMode: "equity" },
  );
  assert.deepEqual(
    buildTradePositionLoadIntent({
      ticker: "SPY",
      optionLoadContract: { strike: 600, cp: "C", exp: "2026-07-17" },
    }),
    {
      ticker: "SPY",
      assetMode: "option",
      strike: 600,
      cp: "C",
      exp: "2026-07-17",
    },
  );
  assert.equal(
    buildTradePositionLoadIntent({
      ticker: "SPY",
      optionContract: { right: "unknown" },
      optionLoadContract: null,
    }),
    null,
    "an option with incomplete identity must not fall back to an equity ticket",
  );
  assert.equal(buildTradePositionLoadIntent({ ticker: "" }), null);
});

test("live Trade Close position routes to the prepared ticket while dead row actions are omitted", () => {
  const closeRowStart = source.indexOf("const closeRow =");
  const closeAllStart = source.indexOf("const handleCloseAll", closeRowStart);
  const closeRowSource = source.slice(closeRowStart, closeAllStart);

  assert.ok(closeRowStart >= 0 && closeAllStart > closeRowStart);
  assert.match(source, /buildIbkrCloseReviewIntent/);
  assert.match(source, /accountProvider/);
  assert.match(source, /const brokerAccountMode = directIbkrAccount \? "live" : environment/);
  assert.match(source, /provider: accountProvider/);
  assert.doesNotMatch(source, /provider: "ibkr"/);
  assert.match(source, /closeReviewIntent: closeReview\.intent/);
  assert.match(source, /label: "Close position"/);
  assert.match(source, /onLoadPosition\?\.\(closeLoadIntent\)/);
  assert.doesNotMatch(closeRowSource, /mutateAsync|buildCloseOrderRequest|confirm:/);
  assert.doesNotMatch(source, /id: "cancel"/);
  assert.doesNotMatch(source, /const protectDisabled =/);
  assert.match(
    source,
    /p\._isLive\s*\?\s*null\s*:\s*\{\s*id: "protect"/,
  );
  assert.match(source, /tab !== "orders" && !brokerConfigured/);
  assert.doesNotMatch(source, /disabled=\{bulkPositionManagementDisabled\}/);
  assert.doesNotMatch(
    source,
    /usePlaceOrder|usePreviewOrder|useReplaceOrder|useCancelOrder|BrokerActionConfirmDialog/,
  );
  assert.match(
    source,
    /id: "actions"[\s\S]*?width: "minmax\(96px, max-content\)"[\s\S]*?minWidth: "96px"/,
  );
  assert.match(
    source,
    /tradeOpenPositionCellStyle\("actions",[\s\S]*?overflow: "visible"[\s\S]*?padding: 0/,
    "the action cell must preserve the 50px + 44px split and its keyboard focus ring",
  );
});

test("Quick Trade exposes only controls backed by an implemented action", () => {
  for (const placeholder of [
    'id: "quote"',
    'id: "risk"',
    'id: "alert"',
    'id: "adjust"',
  ]) {
    assert.doesNotMatch(source, new RegExp(placeholder));
  }

  assert.doesNotMatch(source, /not wired/i);
  assert.doesNotMatch(source, /id: "roll"/);
  assert.doesNotMatch(source, /handleRollRow|handleRollAll|pos\.rollPosition/);
});

test("Trade rows expose ticket loading only through native controls", () => {
  const positionRowStart = source.indexOf("const loadPositionIntoTicket =");
  const positionMenuStart = source.indexOf("<PositionRowActionMenu", positionRowStart);
  const positionRowSource = source.slice(positionRowStart, positionMenuStart);

  assert.ok(positionRowStart >= 0 && positionMenuStart > positionRowStart);
  assert.doesNotMatch(positionRowSource, /onClick|Click to load/);
  assert.match(source, /aria-label=\{`Load \$\{contractLabel\} into Order Ticket`\}/);
  assert.match(source, /onClick=\{loadOrderIntoTicket\}/);
  assert.doesNotMatch(
    source,
    /ORDER_BLOTTER_CANCELLATION|handleCancelOrder|cancelOrderMutation/,
  );
});

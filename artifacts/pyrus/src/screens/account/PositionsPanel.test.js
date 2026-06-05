import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_POSITION_DEFAULT_COLUMN_IDS,
  ALGO_POSITION_DEFAULT_COLUMN_IDS,
  getPositionTableColumns,
} from "../../features/account/positionTableColumns.js";
import { CSS_COLOR } from "../../lib/uiTokens.jsx";
import {
  __positionsPanelInternalsForTests,
  buildPositionOptionQuoteGroups,
} from "./PositionsPanel.jsx";
import { optionQuoteStreamGroupOwner } from "./PositionOptionQuoteStreams.jsx";

const source = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");
const rowActionMenuSource = readFileSync(
  new URL("../../features/account/PositionRowActionMenu.jsx", import.meta.url),
  "utf8",
);
const quoteStreamsSource = readFileSync(
  new URL("./PositionOptionQuoteStreams.jsx", import.meta.url),
  "utf8",
);

const currentNewYorkDateKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

test("positions panel does not key nested order rows directly by broker order id", () => {
  assert.match(source, /positionOpenOrderKey/);
  assert.match(source, /positionSourceAttributionKey/);
  assert.doesNotMatch(source, /key=\{order\.id\}/);
});

test("positions source filters are views within the shadow ledger", () => {
  assert.match(source, /label: "All Sources"/);
  assert.match(source, /label: "Watchlist BT"/);
  assert.doesNotMatch(source, /label: "Options BT"/);
  assert.doesNotMatch(source, /label: "Live Ledger"/);
});

test("positions panel keeps option contract identity compact in symbol cells", () => {
  assert.match(source, /const compactPositionContractDetail/);
  assert.match(source, /optionContractTermsLabel\(row\?\.optionContract\)/);
  assert.match(source, /data-testid="account-position-symbol"/);
  assert.match(source, /data-testid="account-position-date-symbol"/);
});

test("positions panel surfaces option contract and market detail in rows", () => {
  assert.match(source, /const optionInlineDetail/);
  assert.match(source, /optionContractTermsLabel\(contract\)/);
  assert.match(source, /optionDisplayQuote\(row\)/);
  assert.match(source, /const formatOptionExpiryLabel/);
  assert.match(source, /parsed\.getUTCFullYear\(\)/);
  assert.match(source, /Opt \$\{quoteBidAsk\}/);
  assert.match(source, /U bid\/ask/);
  assert.match(source, /formatTimestampDetail/);
});

test("positions panel option info row omits repeated ticker and uses backend quote fallback", () => {
  const { optionInlineDetail, optionDetailMetrics } = __positionsPanelInternalsForTests;
  const row = {
    id: "opt-1",
    symbol: "AAPL",
    optionContract: {
      underlying: "AAPL",
      expirationDate: "2026-05-22T00:00:00.000Z",
      strike: 100,
      right: "call",
      providerContractId: "123",
      multiplier: 100,
    },
    quote: {
      bid: 1.2,
      ask: 1.4,
      mark: 1.3,
      source: "option_quote",
    },
  };

  const inline = optionInlineDetail(row, false);
  assert.match(inline, /^5\/22\/26 100 CALL/);
  assert.doesNotMatch(inline, /^AAPL 5\/22\/26/);
  assert.match(inline, /Opt 1\.20 \/ 1\.40/);

  const bidAsk = optionDetailMetrics(row, "USD", false).find(
    (metric) => metric.label === "Bid / Ask",
  );
  assert.equal(bidAsk?.value, "1.20 / 1.40");
  const contract = optionDetailMetrics(row, "USD", false).find(
    (metric) => metric.label === "Contract",
  );
  assert.equal(contract?.value, "5/22/26 100 CALL");
});

test("positions panel does not render zero underlying bid ask as live market data", () => {
  const { optionInlineDetail, optionDetailMetrics } = __positionsPanelInternalsForTests;
  const row = {
    id: "opt-zero-underlying",
    symbol: "SMCI",
    optionContract: {
      underlying: "SMCI",
      expirationDate: "2026-05-22T00:00:00.000Z",
      strike: 32,
      right: "call",
      providerContractId: "smci-option",
      multiplier: 100,
    },
    underlyingMarket: {
      symbol: "SMCI",
      price: 42.12,
      bid: 0,
      ask: 0,
      updatedAt: "2026-05-22T14:30:00.000Z",
    },
  };

  const inline = optionInlineDetail(row, false);
  assert.match(inline, /SMCI/);
  assert.doesNotMatch(inline, /U bid\/ask 0\.00 \/ 0\.00/);

  const underlying = optionDetailMetrics(row, "USD", false).find(
    (metric) => metric.label === "Underlying",
  );
  assert.equal(underlying?.detail, "2026-05-22T14:30:00.000Z");
});

test("positions panel suppresses redundant option asset chips", () => {
  assert.match(source, /data-testid="account-position-symbol"/);
  assert.doesNotMatch(source, /MarketIdentityInline/);
  assert.match(source, /row\.assetClass && !isOptionPosition\(row\)/);
});

test("positions panel surfaces algo signal lifecycle and risk counters", () => {
  assert.match(source, /automationPositionMetrics/);
  assert.match(source, /PositionSignalRiskCell/);
  assert.match(source, /DenseSignalCell/);
  assert.match(source, /signalContext/);
  assert.match(source, /bars since signal/);
  assert.match(source, /from stop/);
  assert.match(source, /past stop/);
  assert.match(source, /return \$\{formatAccountPercent/);
  assert.match(source, /mobileSummary/);
  assert.match(source, /label: "Purchased"/);
  assert.match(source, /label: "Entry Signal"/);
  assert.match(source, /giveback/);
});

test("position table defaults keep quote, greeks, sparkline, and signal context visible", () => {
  const expected = [
    "symbol",
    "underlyingPrice",
    "quantity",
    "averageCost",
    "price",
    "quote",
    "stop",
    "trail",
    "day",
    "unrealized",
    "exposure",
    "greeks",
    "signalContext",
    "actions",
  ];

  assert.deepEqual(ACCOUNT_POSITION_DEFAULT_COLUMN_IDS, expected);
  assert.deepEqual(ALGO_POSITION_DEFAULT_COLUMN_IDS, expected);
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "underlyingPrice")?.label, "Spot");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "underlyingPrice")?.title, "Underlying price");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "underlyingPrice")?.width, "clamp(50px, 5vw, 64px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "averageCost")?.label, "Avg");
  assert.equal(getPositionTableColumns("algo").find((column) => column.id === "averageCost")?.label, "Avg");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "quote")?.label, "Bid / Ask");
  assert.equal(getPositionTableColumns("algo").find((column) => column.id === "quote")?.label, "Bid / Ask");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "stop")?.label, "Stop");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "stop")?.shortLabel, "SL");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "stop")?.width, "clamp(52px, 5vw, 62px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "stop")?.minWidth, "52px");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "trail")?.shortLabel, "TRL");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "trail")?.width, "clamp(52px, 5vw, 62px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "trail")?.minWidth, "52px");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "symbol")?.width, "clamp(136px, 14vw, 190px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "symbol")?.minWidth, "136px");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "quote")?.width, "clamp(90px, 9vw, 112px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "greeks")?.shortLabel, "Δ/θ");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "greeks")?.width, "clamp(50px, 5vw, 64px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "greeks")?.minWidth, "50px");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "signalContext")?.shortLabel, "Sig");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "signalContext")?.width, "clamp(66px, 7vw, 92px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "signalContext")?.minWidth, "66px");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "signalContext")?.align, "center");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "actions")?.width, "clamp(74px, 8vw, 90px)");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "actions")?.minWidth, "74px");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "target"), undefined);
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "riskDistance"), undefined);
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "stop")?.groupEdge, "start");
  assert.equal(getPositionTableColumns("account").find((column) => column.id === "trail")?.groupEdge, "end");
  assert.match(source, /const DenseStackedValue/);
  assert.match(source, /column\.shortLabel \|\| column\.label/);
  assert.match(source, /const denseColumnBoundaryStyle/);
  assert.match(source, /const denseTableMinWidth/);
  assert.match(source, /column\.id === "underlyingPrice"/);
  assert.match(source, /const DenseUnderlyingPriceCell = /);
  assert.match(source, /useValueFlash\(underlyingPrice\)/);
  assert.match(source, /className=\{flashClassName\}/);
  assert.match(source, /column\.id === "averageCost"/);
  assert.match(source, /column\.id === "price"/);
  assert.match(source, /column\.id === "quote"/);
  assert.match(source, /column\.id === "stop"/);
  assert.match(source, /column\.id === "trail"/);
  assert.doesNotMatch(source, /column\.id === "target"/);
  assert.doesNotMatch(source, /column\.id === "riskDistance"/);
  assert.match(source, /tradeManagementStopSubtext/);
  assert.match(source, /tradeManagementTrailSubtext/);
  assert.match(source, /formatTradeManagementDistanceBadge/);
  assert.match(source, /tradeManagementDistanceTone/);
  assert.match(source, /const POSITION_TABLE_ROW_HEIGHT = 34/);
  assert.match(source, /const POSITION_TABLE_HEADER_HEIGHT = 24/);
  assert.match(source, /const denseVisualAlign/);
  assert.match(source, /const denseCellPadding/);
  assert.match(source, /sp\("1px 2px"\)/);
  assert.match(source, /textAlign: denseVisualAlign\(column\.align\)/);
  assert.match(source, /textAlign: denseVisualAlign\(align\)/);
  assert.doesNotMatch(source, /sp\("2px 3px 2px 2px"\)/);
  assert.doesNotMatch(source, /sp\("2px 3px"\)/);
  assert.match(source, /const denseTableColumnStyle/);
  assert.match(source, /style=\{denseTableColumnStyle\(column\)\}/);
  assert.match(source, /tableLayout: "auto"/);
  assert.match(source, /column\.id === "greeks"/);
  assert.match(source, /const DenseGreekCell/);
  assert.match(source, /Δ\{delta\}/);
  assert.match(source, /θ\{theta\}/);
  assert.match(source, /<Zap size=\{11\}/);
  assert.match(source, /PositionRowActionMenu/);
  assert.match(source, /testId="account-position-row-action-menu"/);
  assert.match(source, /snapshotsBySymbol=\{tickerSnapshotsBySymbol\}/);
  assert.match(source, /underlyingSnapshotsBySymbol=\{underlyingSnapshotsBySymbol\}/);
  assert.doesNotMatch(source, /secondary=\{underlyingSymbol\}/);
  assert.match(source, /data-testid="account-positions-table-scroll"/);
  assert.match(source, /data-testid="account-positions-cash-row"/);
  assert.match(source, /<DenseCashRow/);
  assert.match(source, /data-testid="account-positions-summary-row"/);
  assert.match(source, /denseSummaryCellStyle/);
  assert.match(source, /Cash \$\{cashSegment\.value\}/);
  assert.match(source, /NLV \$\{nlvSegment\.value\}/);
  assert.match(source, /BP \$\{buyingPowerSegment\.value\}/);
  assert.doesNotMatch(source, /colSpan=\{columns\.length\}/);
  assert.doesNotMatch(source, /secondary=\{`Avg/);
  assert.doesNotMatch(source, /data-testid="account-position-context-strip"/);
});

test("position row action menu keeps trade and radial management affordances together", () => {
  assert.match(rowActionMenuSource, /DropdownMenuTrigger asChild/);
  assert.match(rowActionMenuSource, /data-testid="position-row-action-radial-menu"/);
  assert.match(rowActionMenuSource, /data-testid="position-row-action-management-bar"/);
  assert.match(rowActionMenuSource, /primaryAction/);
  assert.match(rowActionMenuSource, /quoteItems/);
  assert.match(rowActionMenuSource, /managementActions/);
  assert.match(rowActionMenuSource, /background-color \$\{motionFast\}/);
  assert.doesNotMatch(rowActionMenuSource, /transition:\s*["']all/);
});

test("position tables render bid ask under the column header without row labels", () => {
  const densePriceBranch = source.slice(
    source.indexOf('} else if (column.id === "price")'),
    source.indexOf('} else if (column.id === "quote")'),
  );
  const denseQuoteBranch = source.slice(
    source.indexOf('} else if (column.id === "quote")'),
    source.indexOf('} else if (column.id === "stop")'),
  );

  assert.match(source, /const formatPositionBidAskPair/);
  assert.match(source, /`\$\{formatSide\(quote\?\.bid\)\} \/ \$\{formatSide\(quote\?\.ask\)\}`/);
  assert.match(source, /const hasPositionBidAsk/);
  assert.match(source, /"Bid \/ Ask"/);
  assert.match(densePriceBranch, /primary=\{formatAccountPrice\(markValue, 2, maskValues\)\}/);
  assert.doesNotMatch(densePriceBranch, /secondary=/);
  assert.doesNotMatch(densePriceBranch, /Last/);
  assert.match(denseQuoteBranch, /primary=\{bidAsk\}/);
  assert.doesNotMatch(denseQuoteBranch, /secondary=/);
  assert.match(denseQuoteBranch, /title=\{\[bidAsk, quoteDetail\]\.filter\(Boolean\)\.join\(" · "\)\}/);
  assert.doesNotMatch(source, /`Bid \$\{formatSide/);
  assert.doesNotMatch(source, /label="Quote"/);
});

test("positions automation metrics distinguish stop distance and breached stops", () => {
  const {
    automationPositionMetrics,
    automationStopTone,
    formatAutomationStopDistanceLabel,
  } = __positionsPanelInternalsForTests;

  assert.equal(formatAutomationStopDistanceLabel(22.34, false), "22.3% from stop");
  assert.equal(formatAutomationStopDistanceLabel(-1.26, false), "1.3% past stop");
  assert.equal(automationStopTone(-0.1), CSS_COLOR.red);
  assert.equal(automationStopTone(18), CSS_COLOR.amber);
  assert.equal(automationStopTone(21), CSS_COLOR.textSec);

  const nearStop = automationPositionMetrics(
    {
      mark: 10,
      averageCost: 8,
      automationContext: {
        stopPrice: 8.2,
        peakPrice: 12,
        entryPrice: 8,
        signalScore: 82,
        barsSinceSignal: 3,
        premiumAtRisk: 240,
      },
    },
    "USD",
    false,
  );
  assert.match(nearStop.riskMain, /18\.0% from stop/);
  assert.match(nearStop.riskDetail, /return 25\.0%/);
  assert.match(nearStop.mobileSummary, /82\.0 score · 3 bars since signal · 18\.0% from stop/);
  assert.equal(nearStop.stopTone, CSS_COLOR.amber);

  const breachedStop = automationPositionMetrics(
    {
      mark: 7.9,
      averageCost: 8,
      automationContext: {
        stopPrice: 8,
        entryPrice: 8,
        signalScore: 74,
        barsSinceSignal: 4,
      },
    },
    "USD",
    false,
  );
  assert.match(breachedStop.riskMain, /1\.3% past stop/);
  assert.match(breachedStop.mobileSummary, /74\.0 score · 4 bars since signal · 1\.3% past stop/);
  assert.equal(breachedStop.stopTone, CSS_COLOR.red);
});

test("position option quote stream owners are scoped per underlying", () => {
  const baseOwner = "account-position-option-quotes:shadow";

  assert.equal(
    optionQuoteStreamGroupOwner(baseOwner, {
      underlying: "spy",
      providerContractIds: ["spy-contract"],
    }),
    "account-position-option-quotes:shadow:SPY",
  );
  assert.equal(
    optionQuoteStreamGroupOwner(baseOwner, {
      underlying: "QQQ",
      providerContractIds: ["qqq-contract"],
    }),
    "account-position-option-quotes:shadow:QQQ",
  );
  assert.notEqual(
    optionQuoteStreamGroupOwner(baseOwner, {
      underlying: "SPY",
      providerContractIds: ["spy-contract"],
    }),
    optionQuoteStreamGroupOwner(baseOwner, {
      underlying: "QQQ",
      providerContractIds: ["qqq-contract"],
    }),
  );
});

test("positions panel overlays live option quotes onto displayed rows and totals", () => {
  assert.match(quoteStreamsSource, /useIbkrOptionQuoteStream/);
  assert.match(quoteStreamsSource, /intent: "account-monitor-live"/);
  assert.match(quoteStreamsSource, /owner = "account-position-option-quotes:ui"/);
  assert.match(quoteStreamsSource, /optionQuoteStreamGroupOwner\(owner, group\)/);
  assert.match(quoteStreamsSource, /owner,\s*\n\s*intent: "account-monitor-live"/);
  assert.doesNotMatch(quoteStreamsSource, /account-positions:\$\{underlying\}/);
  assert.match(source, /useStoredOptionQuoteSnapshotVersion/);
  assert.match(source, /getStoredOptionQuoteSnapshot/);
  assert.match(source, /applyLiveOptionQuoteToRow/);
  assert.match(source, /applyLiveEquityQuoteToRow/);
  assert.match(source, /useRegisterPositionMarketDataSymbols/);
  assert.match(source, /buildDisplayTotals/);
  assert.match(source, /displayTotals\.netExposure/);
});

test("positions display totals preserve cash while recalculating live row values", () => {
  const { buildDisplayTotals } = __positionsPanelInternalsForTests;
  const totals = buildDisplayTotals(
    [
      {
        marketValue: 120,
        unrealizedPnl: 10,
        dayChange: 3,
        weightPercent: 12,
      },
      {
        marketValue: -20,
        unrealizedPnl: -2,
        dayChange: -1,
        weightPercent: 2,
      },
    ],
    {
      cash: 900,
      buyingPower: 1500,
      netLiquidation: 1000,
    },
  );

  assert.equal(totals.netExposure, 100);
  assert.equal(totals.unrealizedPnl, 8);
  assert.equal(totals.dayChange, 2);
  assert.equal(totals.cash, 900);
  assert.equal(totals.totalCash, 900);
  assert.equal(totals.buyingPower, 1500);
  assert.equal(totals.netLiquidation, 1000);
});

test("positions panel normalizes option quote valuation when live stream has no snapshot", () => {
  const { applyDisplayWeights, applyLiveOptionQuoteToRow } =
    __positionsPanelInternalsForTests;
  const row = {
    id: "real-f-call",
    accountId: "U24762790",
    source: "LIVE",
    symbol: "F",
    assetClass: "Options",
    quantity: 5,
    averageCost: 1.134,
    mark: 0.86,
    marketValue: -51556,
    weightPercent: 754.05,
    unrealizedPnl: -137,
    optionContract: {
      underlying: "F",
      expirationDate: "2026-06-26",
      strike: 15,
      right: "CALL",
      multiplier: 100,
    },
    optionQuote: {
      bid: 0.86,
      ask: 0.86,
      mark: 0.86,
      delta: 0.62,
      theta: -0.01,
      source: "option_quote",
    },
  };

  const patched = applyLiveOptionQuoteToRow(row, null);
  assert.equal(Number(patched.marketValue.toFixed(2)), 430);
  assert.equal(Number(patched.unrealizedPnl.toFixed(2)), -137);
  assert.equal(patched.betaWeightedDelta, 310);

  const [weighted] = applyDisplayWeights([patched], { netLiquidation: 56_800 });
  assert.equal(Number(weighted.weightPercent.toFixed(2)), 0.76);
});

test("positions display totals tolerate missing totals while positions load", () => {
  const { buildDisplayTotals } = __positionsPanelInternalsForTests;
  const totals = buildDisplayTotals([], null);

  assert.equal(totals.cash, null);
  assert.equal(totals.totalCash, null);
  assert.equal(totals.buyingPower, null);
  assert.equal(totals.netLiquidation, null);
});

test("positions panel overlays Massive equity snapshots onto displayed rows", () => {
  const { applyLiveEquityQuoteToRow } = __positionsPanelInternalsForTests;
  const patched = applyLiveEquityQuoteToRow(
    {
      id: "real-fcel",
      symbol: "FCEL",
      assetClass: "Stocks",
      quantity: 100,
      averageCost: 1.5,
      mark: 1.8,
      marketValue: 180,
      unrealizedPnl: 30,
      unrealizedPnlPercent: 20,
      dayChange: 0,
      dayChangePercent: 0,
      quote: {
        bid: 1.79,
        ask: 1.81,
        mark: 1.8,
        source: "position_mark",
      },
    },
    {
      symbol: "FCEL",
      price: 2.1,
      bid: 2.09,
      ask: 2.11,
      chg: 0.2,
      pct: 10.53,
      source: "massive",
      transport: "websocket",
      dataUpdatedAt: "2026-06-04T14:30:00.000Z",
    },
  );

  assert.equal(patched.mark, 2.1);
  assert.equal(patched.marketPrice, 2.1);
  assert.equal(Math.round(patched.marketValue), 210);
  assert.equal(Math.round(patched.unrealizedPnl), 60);
  assert.equal(Number(patched.unrealizedPnlPercent.toFixed(2)), 40);
  assert.equal(Number(patched.dayChange.toFixed(2)), 20);
  assert.equal(patched.dayChangePercent, 10.53);
  assert.equal(patched.quote.bid, 2.09);
  assert.equal(patched.quote.ask, 2.11);
  assert.equal(patched.quote.source, "massive");
  assert.equal(patched.quote.transport, "websocket");
  assert.equal(patched.underlyingMarket.price, 2.1);
});

test("positions panel adds spot snapshots to option rows without repricing options", () => {
  const { applyLiveEquityQuoteToRow } = __positionsPanelInternalsForTests;
  const patched = applyLiveEquityQuoteToRow(
    {
      id: "real-f-option",
      symbol: "F",
      assetClass: "Options",
      quantity: 5,
      averageCost: 1.04,
      mark: 0.86,
      marketValue: 430,
      unrealizedPnl: -90,
      dayChange: -150,
      optionContract: {
        underlying: "F",
        multiplier: 100,
      },
      optionQuote: {
        bid: 0.84,
        ask: 0.88,
        mark: 0.86,
        source: "option_quote",
      },
    },
    {
      symbol: "F",
      price: 15.32,
      bid: 15.31,
      ask: 15.33,
      chg: -0.39,
      pct: -2.48,
      source: "massive",
      transport: "websocket",
      dataUpdatedAt: "2026-06-04T21:01:15.555Z",
    },
  );

  assert.equal(patched.mark, 0.86);
  assert.equal(patched.marketValue, 430);
  assert.equal(patched.unrealizedPnl, -90);
  assert.equal(patched.dayChange, -150);
  assert.equal(patched.underlyingMarket.symbol, "F");
  assert.equal(patched.underlyingMarket.price, 15.32);
  assert.equal(patched.underlyingMarket.source, "massive");
});

test("positions panel renders compact underlying sparklines inside position rows", () => {
  assert.match(source, /import \{ MicroSparkline \}/);
  assert.match(source, /import \{ Button \} from "\.\.\/\.\.\/components\/ui\/Button\.jsx"/);
  assert.match(source, /useRuntimeTickerSnapshots\(positionSparklineSymbols\)/);
  assert.match(source, /const positionUnderlyingSymbols = useMemo/);
  assert.match(source, /marketDataOwner: `positions:\$\{surfaceId\}`/);
  assert.match(source, /useRegisterPositionMarketDataSymbols\(\s*marketDataOwner,\s*positionUnderlyingSymbols/);
  assert.match(source, /useRuntimeTickerSnapshots\(\s*registerMarketDataSymbols \? positionUnderlyingSymbols : \[\]/);
  assert.match(source, /denseColumnSortValue\(a, sort\.id, underlyingSnapshotsBySymbol\)/);
  assert.match(source, /const resolvePositionSparklineSymbol/);
  assert.match(source, /const resolvePositionUnderlyingSymbol/);
  assert.match(source, /const resolvePositionUnderlyingPrice/);
  assert.match(source, /snapshot\?\.price/);
  assert.match(source, /staticUnderlying\?\.price/);
  assert.match(source, /!isOptionPosition\(row\)/);
  assert.match(source, /row\?\.marketDataSymbol/);
  assert.match(source, /row\?\.optionContract\?\.underlying/);
  assert.match(source, /row\?\.underlyingMarket\?\.symbol/);
  assert.match(source, /data-testid="account-position-sparkline"/);
  assert.match(source, /const buildPositionFallbackSparklineData = /);
  assert.match(source, /SPARKLINE_RENDER_POINT_LIMIT/);
  assert.match(source, /TABLE_SPARKLINE_WIDTH/);
  assert.match(source, /TABLE_SPARKLINE_HEIGHT/);
  assert.match(source, /TABLE_SPARKLINE_COMPACT_WIDTH/);
  assert.match(source, /TABLE_SPARKLINE_COMPACT_HEIGHT/);
  assert.match(source, /buildDetailedFallbackSparklineData/);
  assert.match(source, /pointCount: SPARKLINE_RENDER_POINT_LIMIT/);
  assert.match(source, /return buildPositionFallbackSparklineData\(row, snapshot, symbol\)/);
  assert.match(source, /inline = false/);
  assert.match(source, /positionSparklineShellStyle\(compact, inline\)/);
  assert.match(
    source,
    /<PositionTrendSparkline[\s\S]*?inline[\s\S]*?data-testid="account-position-symbol"/,
  );
  assert.doesNotMatch(source, /\["trend", "Trend"/);
});

test("position row expansion includes lots attribution orders and management details", () => {
  assert.match(source, /const hasExpandablePositionDetails/);
  assert.match(source, /row\?\.sourceAttribution\?\.length/);
  assert.match(source, /row\?\.openOrders\?\.length/);
  assert.match(source, /hasTradeManagementDetail\(row\)/);
  assert.match(source, /if \(hasExpandablePositionDetails\(row\)\)/);
  assert.doesNotMatch(source, /<PositionOptionDetails/);
  assert.doesNotMatch(source, /<PositionFactsDetails/);
});

test("positions panel stays focused on current positions, not equity-date inspection", () => {
  const signature = source.match(
    /export const PositionsPanel = \(\{[\s\S]*?\n\}\) => \{/,
  )?.[0] ?? "";

  assert.doesNotMatch(signature, /positionsAtDateQuery/);
  assert.doesNotMatch(signature, /activeEquityDate/);
  assert.doesNotMatch(signature, /pinnedEquityDate/);
  assert.doesNotMatch(signature, /currentPositionsCount/);
  assert.doesNotMatch(signature, /onClearEquityPin/);
  assert.doesNotMatch(source, /const showInspector/);
  assert.doesNotMatch(source, /const inspectingDate/);
});

test("equity-date inspector keeps the default empty state clean", () => {
  assert.match(source, /title="Move over the equity curve"/);
  assert.match(source, /error=\{inspecting \? query\.error : null\}/);
  assert.match(source, /onRetry=\{inspecting \? query\.refetch : undefined\}/);
});

test("equity-date inspector omits live-only quote and greeks columns", () => {
  const inspectorSource = source.slice(
    source.indexOf("const historicalPositionHeaders = ["),
    source.indexOf("export const PositionsPanel"),
  );

  assert.match(inspectorSource, /const historicalPositionHeaders = \[/);
  assert.match(inspectorSource, /"Qty"/);
  assert.match(inspectorSource, /"Avg"/);
  assert.match(inspectorSource, /"Price"/);
  assert.match(inspectorSource, /"Exposure"/);
  assert.doesNotMatch(inspectorSource, /"Bid \/ Ask"/);
  assert.doesNotMatch(inspectorSource, /"Greeks"/);
  assert.match(inspectorSource, /data-testid="account-position-date-symbol"/);
  assert.match(inspectorSource, /snapshotsBySymbol=\{\{\}\}/);
  assert.match(inspectorSource, /const markValue = row\.mark/);
  assert.doesNotMatch(inspectorSource, /formatPositionBidAskPair/);
  assert.doesNotMatch(inspectorSource, /formatGreek|formatIv/);
  assert.doesNotMatch(inspectorSource, /Last \$\{formatAccountPrice/);
});

test("positions panel live quote overlay does not revalue options to zero", () => {
  const row = {
    id: "shadow-aapl",
    symbol: "AAPL",
    quantity: 2,
    averageCost: 6.44,
    mark: 7.57,
    marketValue: 1514,
    dayChange: 226,
    dayChangePercent: 17.55,
    unrealizedPnl: 226,
    unrealizedPnlPercent: 17.55,
    optionContract: {
      providerContractId: "twsopt:aapl",
      multiplier: 100,
    },
    optionQuote: {
      mark: 7.57,
      bid: 7.5,
      ask: 7.64,
      price: 7.57,
    },
  };

  const patched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(row, {
      providerContractId: "twsopt:aapl",
      mark: 0,
      price: 0,
      bid: 0,
      ask: 0,
      change: -7.57,
      changePercent: -100,
      openInterest: 250,
      delta: 0.52,
    });

  assert.equal(patched.mark, 7.57);
  assert.equal(patched.marketValue, 1514);
  assert.equal(patched.dayChange, 226);
  assert.equal(patched.dayChangePercent, 17.55);
  assert.equal(Math.round(patched.unrealizedPnl), 226);
  assert.ok(Math.abs(patched.unrealizedPnlPercent - 17.55) < 0.01);
  assert.equal(patched.optionQuote.openInterest, 250);
  assert.equal(patched.betaWeightedDelta, 104);

  const staleChangePatched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(row, {
      providerContractId: "twsopt:aapl",
      price: 7.57,
      bid: 7.5,
      ask: 7.64,
      change: -7.57,
      changePercent: -100,
      openInterest: 260,
    });

  assert.equal(staleChangePatched.mark, 7.57);
  assert.equal(staleChangePatched.dayChange, 226);
  assert.equal(staleChangePatched.dayChangePercent, 17.55);
  assert.equal(staleChangePatched.optionQuote.openInterest, 260);
});

test("positions panel live quote overlay preserves zero option bid with usable ask", () => {
  const row = {
    id: "shadow-spy",
    symbol: "SPY",
    quantity: 1,
    averageCost: 2,
    mark: 2.4,
    marketValue: 240,
    dayChange: null,
    dayChangePercent: null,
    optionContract: {
      providerContractId: "twsopt:spy",
      multiplier: 100,
    },
    optionQuote: null,
  };

  const patched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(row, {
      providerContractId: "twsopt:spy",
      price: 2.45,
      bid: 0,
      ask: 2.5,
      change: 0.15,
      changePercent: 6.52,
    });

  assert.equal(patched.optionQuote.bid, 0);
  assert.equal(patched.optionQuote.ask, 2.5);
  assert.equal(patched.mark, 2.45);
  assert.equal(patched.dayChange, 15);
  assert.equal(patched.dayChangePercent, 6.52);
});

test("positions panel live quote overlay uses entry basis for same-day options", () => {
  const openedAt = currentNewYorkDateKey();
  const patched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(
      {
        id: "same-day-option",
        symbol: "SPY",
        quantity: 1,
        averageCost: 1,
        mark: 1,
        marketValue: 100,
        dayChange: 5,
        dayChangePercent: 5,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        openedAt,
        optionContract: {
          providerContractId: "twsopt:spy",
          multiplier: 100,
        },
        optionQuote: null,
      },
      {
        providerContractId: "twsopt:spy",
        price: 1.5,
        bid: 1.45,
        ask: 1.55,
        change: 0.05,
        changePercent: 3.45,
      },
    );

  assert.equal(Number(patched.unrealizedPnl.toFixed(2)), 50);
  assert.equal(Number(patched.dayChange.toFixed(2)), 50);
  assert.equal(Number(patched.dayChangePercent.toFixed(2)), 50);
  assert.equal(Number(patched.unrealizedPnlPercent.toFixed(2)), 50);
});

test("positions panel same-day helper accepts date-only market dates", () => {
  assert.equal(
    __positionsPanelInternalsForTests.positionOpenedOnCurrentMarketDay(
      "2026-05-27",
      new Date("2026-05-27T19:01:00.000Z"),
    ),
    true,
  );
  assert.equal(
    __positionsPanelInternalsForTests.positionOpenedOnCurrentMarketDay(
      new Date("2026-05-27T00:00:00.000Z"),
      new Date("2026-05-27T19:01:00.000Z"),
    ),
    true,
  );
});

test("positions panel starts live streams from hydrated option quote conids", () => {
  const groups = buildPositionOptionQuoteGroups([
    {
      symbol: "HOOD",
      optionContract: {
        underlying: "HOOD",
        providerContractId: "O:HOOD260522P00076000",
      },
      optionQuote: {
        providerContractId: "123456789",
      },
    },
  ]);

  assert.deepEqual(groups, [
    {
      underlying: "HOOD",
      providerContractIds: ["123456789"],
    },
  ]);
});

test("positions panel derives structured IBKR option ids before numeric account conids", () => {
  const groups = buildPositionOptionQuoteGroups([
    {
      symbol: "SPY",
      optionContract: {
        underlying: "SPY",
        expirationDate: "2026-06-04",
        strike: 753,
        right: "call",
        providerContractId: "885885495",
        multiplier: 100,
      },
    },
  ]);
  const [providerContractId] = groups[0].providerContractIds;
  const payload = JSON.parse(
    Buffer.from(providerContractId.slice("twsopt:".length), "base64url").toString(
      "utf8",
    ),
  );

  assert.deepEqual(groups[0].underlying, "SPY");
  assert.deepEqual(payload, {
    v: 1,
    u: "SPY",
    e: "20260604",
    s: 753,
    r: "C",
    x: "SMART",
    tc: "SPY",
    m: 100,
  });
});

test("positions panel derives structured IBKR option ids before stale hydrated numeric quotes", () => {
  const groups = buildPositionOptionQuoteGroups([
    {
      symbol: "SPY",
      optionContract: {
        underlying: "SPY",
        expirationDate: "2026-06-04",
        strike: 753,
        right: "call",
        providerContractId: "885885495",
        multiplier: 100,
      },
      optionQuote: {
        providerContractId: "885885495",
      },
    },
  ]);
  const [providerContractId] = groups[0].providerContractIds;
  const payload = JSON.parse(
    Buffer.from(providerContractId.slice("twsopt:".length), "base64url").toString(
      "utf8",
    ),
  );

  assert.notEqual(providerContractId, "885885495");
  assert.deepEqual(payload, {
    v: 1,
    u: "SPY",
    e: "20260604",
    s: 753,
    r: "C",
    x: "SMART",
    tc: "SPY",
    m: 100,
  });
});

test("positions panel live quote overlay replaces stale provider source labels", () => {
  const patched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(
      {
        symbol: "HOOD",
        quantity: 1,
        averageCost: 1,
        mark: 1,
        optionContract: {
          providerContractId: "123456789",
          multiplier: 100,
        },
        optionQuote: {
          bid: 1,
          ask: 1.2,
          mark: 1.1,
          source: "massive_option_quote",
        },
      },
      {
        providerContractId: "123456789",
        bid: 1.05,
        ask: 1.15,
        price: 1.1,
      },
    );

  assert.equal(patched.optionQuote.source, "option_quote");
  assert.equal(patched.optionQuote.bid, 1.05);
  assert.equal(patched.optionQuote.ask, 1.15);
});

test("positions panel keeps shadow ledger valuation stable over live quote overlay", () => {
  const patched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(
      {
        id: "shadow-opt",
        accountId: "shadow",
        source: "SHADOW_LEDGER",
        symbol: "HOOD",
        quantity: 2,
        averageCost: 1,
        mark: 1.1,
        dayChange: 14,
        dayChangePercent: 7,
        marketValue: 220,
        unrealizedPnl: 20,
        unrealizedPnlPercent: 10,
        optionContract: {
          providerContractId: "123456789",
          multiplier: 100,
        },
        optionQuote: {
          bid: 1.05,
          ask: 1.15,
          mark: 1.1,
          dayChangePercent: 7,
          source: "shadow_ledger",
        },
      },
      {
        providerContractId: "123456789",
        bid: 1.2,
        ask: 1.4,
        price: 1.3,
        change: 0.3,
        changePercent: 30,
      },
    );

  assert.equal(Number(patched.mark.toFixed(2)), 1.1);
  assert.equal(Number(patched.marketValue.toFixed(2)), 220);
  assert.equal(Number(patched.unrealizedPnl.toFixed(2)), 20);
  assert.equal(patched.dayChange, 14);
  assert.equal(patched.dayChangePercent, 7);
  assert.equal(patched.optionQuote.source, "option_quote");
  assert.equal(Number(patched.optionQuote.bid.toFixed(2)), 1.2);
  assert.equal(Number(patched.optionQuote.ask.toFixed(2)), 1.4);
});

test("positions panel reprices shadow ledger rows only when backend and quote permit valuation", () => {
  const baseRow = {
    id: "shadow-opt",
    accountId: "shadow",
    source: "SHADOW_LEDGER",
    valuationEligible: true,
    symbol: "HOOD",
    quantity: 2,
    averageCost: 1,
    mark: 1.1,
    dayChange: 14,
    dayChangePercent: 7,
    marketValue: 220,
    optionContract: {
      providerContractId: "123456789",
      multiplier: 100,
    },
    optionQuote: {
      bid: 1.05,
      ask: 1.15,
      mark: 1.1,
      source: "shadow_ledger",
    },
  };

  const livePatched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(baseRow, {
      providerContractId: "123456789",
      bid: 1.2,
      ask: 1.4,
      price: 1.3,
      change: 0.3,
      changePercent: 30,
      freshness: "live",
      marketDataMode: "live",
    });

  assert.equal(Number(livePatched.mark.toFixed(2)), 1.3);
  assert.equal(Number(livePatched.marketValue.toFixed(2)), 260);

  const frozenPatched =
    __positionsPanelInternalsForTests.applyLiveOptionQuoteToRow(baseRow, {
      providerContractId: "123456789",
      bid: 1.3,
      ask: 1.5,
      price: 1.4,
      freshness: "live",
      marketDataMode: "frozen",
    });

  assert.equal(Number(frozenPatched.mark.toFixed(2)), 1.1);
  assert.equal(Number(frozenPatched.marketValue.toFixed(2)), 220);
  assert.equal(Number(frozenPatched.optionQuote.bid.toFixed(2)), 1.3);
  assert.equal(Number(frozenPatched.optionQuote.ask.toFixed(2)), 1.5);
});

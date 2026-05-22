import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { T } from "../../lib/uiTokens.jsx";
import { __positionsPanelInternalsForTests } from "./PositionsPanel.jsx";

const source = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");

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

test("positions panel maps option assets to option market identity", () => {
  assert.match(source, /normalized === "options"/);
  assert.match(source, /return "options"/);
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

test("positions panel suppresses redundant option asset chips", () => {
  assert.match(source, /showChips=\{!isOptionPosition\(row\)\}/);
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

test("positions automation metrics distinguish stop distance and breached stops", () => {
  const {
    automationPositionMetrics,
    automationStopTone,
    formatAutomationStopDistanceLabel,
  } = __positionsPanelInternalsForTests;

  assert.equal(formatAutomationStopDistanceLabel(22.34, false), "22.3% from stop");
  assert.equal(formatAutomationStopDistanceLabel(-1.26, false), "1.3% past stop");
  assert.equal(automationStopTone(-0.1), T.red);
  assert.equal(automationStopTone(18), T.amber);
  assert.equal(automationStopTone(21), T.textSec);

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
  assert.equal(nearStop.stopTone, T.amber);

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
  assert.equal(breachedStop.stopTone, T.red);
});

test("positions panel overlays live option quotes onto displayed rows and totals", () => {
  assert.match(source, /useIbkrOptionQuoteStream/);
  assert.match(source, /useStoredOptionQuoteSnapshotVersion/);
  assert.match(source, /getStoredOptionQuoteSnapshot/);
  assert.match(source, /applyLiveOptionQuoteToRow/);
  assert.match(source, /buildDisplayTotals/);
  assert.match(source, /displayTotals\.netExposure/);
});

test("positions panel renders compact underlying sparklines without adding table columns", () => {
  assert.match(source, /import \{ Button, MicroSparkline \}/);
  assert.match(source, /useRuntimeTickerSnapshots\(positionSparklineSymbols\)/);
  assert.match(source, /const resolvePositionSparklineSymbol/);
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
    /<PositionTrendSparkline[\s\S]*?inline[\s\S]*?<MarketIdentityInline/,
  );
  assert.doesNotMatch(source, /\["trend", "Trend"/);
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

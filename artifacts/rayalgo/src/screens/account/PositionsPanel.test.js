import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
  assert.match(source, /optionContractLabel\(contract\)/);
  assert.match(source, /const formatOptionExpiryLabel/);
  assert.match(source, /parsed\.getUTCFullYear\(\)/);
  assert.match(source, /Opt \$\{quoteBidAsk\}/);
  assert.match(source, /U bid\/ask/);
  assert.match(source, /formatTimestampDetail/);
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

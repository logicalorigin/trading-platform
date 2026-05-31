import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradePositionsPanel.jsx", import.meta.url), "utf8");

test("live trade order rows keep stable identities when broker ids are absent", () => {
  assert.match(source, /export const getTradeLiveOrderRowId = \(order\) =>/);
  assert.match(source, /const orderRowId = getTradeLiveOrderRowId\(order\)/);
  assert.match(source, /key=\{orderRowId\}/);
  assert.doesNotMatch(source, /key=\{order\.id\}/);
});

test("trade open positions reuse runtime ticker snapshots for compact sparklines", () => {
  assert.match(source, /import \{ DataUnavailableState, MicroSparkline \}/);
  assert.match(source, /useRuntimeTickerSnapshots\(openPositionSymbols\)/);
  assert.match(source, /useRegisterPositionMarketDataSymbols\(\s*`trade-positions:\$\{environment\}:\$\{accountId \|\| "none"\}`,\s*openPositionSymbols,\s*isVisible,\s*\)/);
  assert.match(source, /data-testid="trade-position-sparkline"/);
  assert.match(source, /<TradePositionSparkline/);
  assert.match(source, /const buildTradePositionFallbackSparklineData = /);
  assert.match(source, /position\.marketDataSymbol/);
  assert.match(source, /position\.optionContract\?\.underlying/);
  assert.match(source, /SPARKLINE_RENDER_POINT_LIMIT/);
  assert.match(source, /buildDetailedFallbackSparklineData/);
  assert.match(source, /pointCount: SPARKLINE_RENDER_POINT_LIMIT/);
  assert.match(source, /return buildTradePositionFallbackSparklineData\(position, snapshot, symbol\)/);
  assert.match(source, /const OPEN_POSITION_GRID_TEMPLATE =/);
  assert.match(source, /const OPEN_POSITION_COLUMNS = \[/);
  assert.match(source, /id: "ticker", label: "Tick", title: "Ticker", width: "minmax\(68px, 1fr\)", minWidth: "68px"/);
  assert.match(source, /id: "spot", label: "Spot", title: "Underlying price", width: "minmax\(40px, max-content\)", minWidth: "40px"/);
  assert.match(source, /id: "stop", label: "SL", title: "Stop loss", width: "minmax\(52px, max-content\)", minWidth: "52px"/);
  assert.match(source, /id: "trail", label: "TRL", title: "Trailing stop", width: "minmax\(52px, max-content\)", minWidth: "52px"/);
  assert.match(source, /id: "actions", label: "", title: "Actions", width: "minmax\(74px, max-content\)", minWidth: "74px"/);
  assert.match(source, /column\.track \|\| column\.width/);
  assert.match(source, /const tradeVisualAlign/);
  assert.match(source, /textAlign: tradeVisualAlign\(column\.align\)/);
  assert.doesNotMatch(source, /sp\("2px 3px 2px 1px"\)/);
  assert.match(source, /id: "stop", label: "SL", title: "Stop loss"[\s\S]*groupEdge: "start"/);
  assert.match(source, /id: "trail", label: "TRL", title: "Trailing stop"[\s\S]*groupEdge: "end"/);
  assert.doesNotMatch(source, /id: "target", label: "TP"/);
  assert.doesNotMatch(source, /id: "riskDistance", label: "DIST"/);
  assert.match(source, /TradeManagementLevelCell/);
  assert.match(source, /OPEN_POSITION_COLUMNS\.map\(/);
  assert.match(source, /tradeOpenPositionHeaderCellStyle\(column\)/);
  assert.match(source, /const resolveTradeSpotPrice = /);
  assert.match(source, /const TradeSpotPriceCell = /);
  assert.match(source, /resolveTradeSpotPrice\(position, snapshotsBySymbol\)/);
  assert.match(source, /useValueFlash\(spotPrice\)/);
  assert.match(source, /className=\{flashClassName\}/);
  assert.match(source, /tradeOpenPositionCellStyle\(\s*"spot"/);
  assert.match(source, /title=\{tradeSpotTitle\(position, snapshotsBySymbol\)\}/);
  assert.match(source, /<TradeSpotPriceCell[\s\S]*?snapshotsBySymbol=\{tickerSnapshotsBySymbol\}/);
  assert.match(source, /position\?\.optionContract[\s\S]*\?[\s\S]*null[\s\S]*firstPositiveNumber\(position\?\.mark/);
  assert.match(source, /tradeManagementForPosition\(p, liveOrders\)/);
  assert.match(source, /data-testid="trade-open-positions-table-scroll"/);
  assert.match(source, /testId="trade-position-row-action-menu"/);
  assert.match(source, /PositionRowActionMenu/);
  assert.match(source, /data-testid="trade-executions-table-scroll"/);
  assert.match(source, /data-testid="trade-live-orders-table-scroll"/);
  assert.match(source, /ra-dense-table-scroll/);
  assert.match(source, /role="table"/);
  assert.match(source, /id: "averageCost", label: "Avg", title: "Average cost"/);
  assert.match(source, /const openedText = display\.openedLabel \|\| MISSING_VALUE/);
  assert.match(
    source,
    /<TradePositionSparkline[\s\S]*?snapshotsBySymbol=\{tickerSnapshotsBySymbol\}[\s\S]*?\{p\.ticker\}/,
  );
});

test("trade open positions use shared trade-management thresholds", () => {
  assert.match(source, /buildPositionTradeManagement/);
  assert.match(source, /orderMatchesManagementPosition/);
  assert.match(source, /const tradeManagementForPosition = /);
  assert.match(source, /openOrders: tradePositionOrders\(position, liveOrders\)/);
  assert.match(source, /mark: position\.mark/);
  assert.match(source, /localStopLoss: position\.sl/);
  assert.match(source, /position\.automationContext\?\.stopLossPrice/);
  assert.doesNotMatch(source, /position\.automationContext\?\.takeProfitPrice/);
  assert.doesNotMatch(source, /automationTargetIsTrailActivation/);
  assert.doesNotMatch(source, /position\.automationContext\?\.trailActivationPrice/);
  assert.match(source, /tradeOpenPositionCellStyle\(\s*"stop"/);
  assert.match(source, /tradeManagementPrice\(management\.stop\)/);
  assert.match(source, /tradeOpenPositionCellStyle\(\s*"trail"/);
  assert.match(source, /tradeManagementPrice\(management\.trail\)/);
  assert.doesNotMatch(source, /tradeOpenPositionCellStyle\(\s*"target"/);
  assert.doesNotMatch(source, /tradeManagementPrice\(management\.target\)/);
  assert.match(source, /tradeManagementStopBadge\(management\)/);
  assert.match(source, /tradeManagementTrailBadge\(management\)/);
  assert.match(source, /tradeManagementDistanceBadge/);
  assert.match(source, /tradeManagementBadgeTone/);
  assert.match(source, /Distance \$\{tradeManagementDistanceLabel\(management\)\}/);
});

test("trade position actions expose ticket, linked-order, protect, close, and roll flows", () => {
  assert.match(source, /const handleProtectRow = async \(p\) =>/);
  assert.match(source, /const handleRollRow = \(p\) =>/);
  assert.match(source, /linkedWorkingOrders/);
  assert.match(source, /setTab\("orders"\)/);
  assert.match(source, /handleCancelOrder\(firstLinkedOrder\)/);
  assert.match(source, /handleProtectRow\(p\)/);
  assert.match(source, /closeRow\(p\)/);
  assert.match(source, /handleRollRow\(p\)/);
  assert.match(source, /label: "Adjust"/);
  assert.match(source, /label: "Close"/);
  assert.match(source, /label: "Roll"/);
});

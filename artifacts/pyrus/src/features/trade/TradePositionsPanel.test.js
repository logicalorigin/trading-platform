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
  assert.match(source, /id: "stop", label: "SL", title: "Stop loss"[\s\S]*groupEdge: "start"/);
  assert.match(source, /id: "trail", label: "TRL", title: "Trailing stop"/);
  assert.match(source, /id: "target", label: "TP", title: "Profit target"/);
  assert.match(source, /id: "riskDistance", label: "DIST", title: "Risk distance \/ amount"[\s\S]*groupEdge: "end"/);
  assert.match(source, /OPEN_POSITION_COLUMNS\.map\(\(column\) => \(/);
  assert.match(source, /tradeOpenPositionHeaderCellStyle\(column\)/);
  assert.match(source, /tradeManagementForPosition\(p, liveOrders\)/);
  assert.match(source, /data-testid="trade-open-positions-table-scroll"/);
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
  assert.match(source, /localTakeProfit: position\.tp/);
  assert.match(source, /tradeOpenPositionCellStyle\(\s*"stop"/);
  assert.match(source, /tradeManagementPrice\(management\.stop\)/);
  assert.match(source, /tradeManagementDistance\(management\)/);
});

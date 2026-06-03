import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const positionsSource = () =>
  readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");

const tradingAnalysisSource = () =>
  readFileSync(new URL("./TradingAnalysisWorkbench.jsx", import.meta.url), "utf8");

test("position tables support persisted column reordering per surface", () => {
  const source = positionsSource();

  assert.match(source, /TableHeaderDndContext/);
  assert.match(source, /SortableColumnHeaderCell/);
  assert.match(source, /POSITION_LOCKED_COLUMN_IDS = \["symbol", "actions"\]/);
  assert.match(source, /accountPositionColumnOrder/);
  assert.match(source, /algoPositionColumnOrder/);
  assert.match(source, /const reorderPositionColumn = useCallback\(\s*\(activeColumnId, overColumnId\) =>/);
  assert.match(source, /reorderColumnOrder\(\s*current,\s*activeColumnId,\s*overColumnId,/);
  assert.doesNotMatch(source, /meta\.activeColumnId/);
  assert.doesNotMatch(source, /meta\.overColumnId/);
});

test("trading analysis trades support persisted column reordering", () => {
  const source = tradingAnalysisSource();

  assert.match(source, /TableHeaderDndContext/);
  assert.match(source, /SortableColumnHeaderCell/);
  assert.match(source, /tradingAnalysisTradeColumnOrder/);
  assert.match(source, /const TABLE_COLUMN_IDS = TABLE_COLUMNS\.map/);
  assert.match(source, /const tradeTableGridTemplate = \(columns\) =>/);
  assert.match(source, /columns=\{orderedColumns\}/);
  assert.match(source, /const reorderTradeColumn = \(activeColumnId, overColumnId\) =>/);
  assert.match(source, /reorderColumnOrder\(\s*current,\s*activeColumnId,\s*overColumnId,/);
  assert.doesNotMatch(source, /meta\.activeColumnId/);
  assert.doesNotMatch(source, /meta\.overColumnId/);
});

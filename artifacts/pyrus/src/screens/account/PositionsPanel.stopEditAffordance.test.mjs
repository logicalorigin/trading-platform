import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");
const columnsSource = readFileSync(
  new URL("../../features/account/positionTableColumns.js", import.meta.url),
  "utf8",
);

test("the Stop column is read-only until a prepared stop lifecycle exists", () => {
  const stopCellStart = panelSource.indexOf('column.id === "stop"');
  const stopCellEnd = panelSource.indexOf('column.id === "trail"', stopCellStart);
  const stopCell = panelSource.slice(stopCellStart, stopCellEnd);

  assert.ok(stopCell, "Missing Stop cell branch");
  assert.doesNotMatch(panelSource, /StopEditAffordance/);
  assert.doesNotMatch(stopCell, /onEditProtection|canManagePositions/);
  assert.match(stopCell, /<DenseStackedValue/);
});

test("the action column fits the 50px Trade and 44px More touch targets", () => {
  const actionColumn = columnsSource.match(
    /id:\s*"actions"[\s\S]*?numeric:\s*false,[\s\S]*?\}\),/,
  )?.[0];

  assert.ok(actionColumn, "Missing actions column definition");
  assert.match(actionColumn, /width:\s*"96px"/);
  assert.match(actionColumn, /minWidth:\s*"96px"/);
});

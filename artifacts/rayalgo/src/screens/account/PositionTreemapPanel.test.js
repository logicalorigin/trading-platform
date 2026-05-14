import assert from "node:assert/strict";
import test from "node:test";
import { buildTreemapItems } from "./PositionTreemapPanel.jsx";

test("position treemap gives duplicate symbols stable distinct ids", () => {
  const items = buildTreemapItems([
    { id: "stock-rblx", symbol: "RBLX", assetClass: "Stocks", marketValue: 100 },
    { id: "option-rblx", symbol: "RBLX", assetClass: "Options", marketValue: 50 },
  ]);

  assert.deepEqual(
    items.map((item) => item.id),
    ["stock-rblx", "option-rblx"],
  );
  assert.equal(new Set(items.map((item) => item.id)).size, 2);
});

test("position treemap falls back to unique ids when source ids are missing", () => {
  const items = buildTreemapItems([
    { symbol: "PLTR", assetClass: "Stocks", marketValue: 100 },
    { symbol: "PLTR", assetClass: "Options", marketValue: 50 },
  ]);

  assert.equal(new Set(items.map((item) => item.id)).size, 2);
});

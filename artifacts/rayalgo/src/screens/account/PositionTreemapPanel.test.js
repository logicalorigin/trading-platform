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

test("position treemap preserves missing day percent instead of rendering flat zero", () => {
  const [item] = buildTreemapItems([
    {
      id: "shadow-option",
      symbol: "NVDA",
      assetClass: "Options",
      marketValue: 835,
      dayChange: null,
      dayChangePercent: null,
    },
  ]);

  assert.equal(item.dayChangePercent, null);
});

test("position treemap derives day percent from day P&L when API percent is absent", () => {
  const [item] = buildTreemapItems([
    {
      id: "shadow-option",
      symbol: "NVDA",
      assetClass: "Options",
      marketValue: 525,
      dayChange: 25,
      dayChangePercent: null,
    },
  ]);

  assert.equal(Number(item.dayChangePercent.toFixed(6)), 5);
});

test("position treemap derives unrealized percent from shadow option cost basis", () => {
  const [item] = buildTreemapItems([
    {
      id: "shadow-option",
      symbol: "NVDA",
      assetClass: "Options",
      quantity: 1,
      averageCost: 8.25,
      marketValue: 835,
      unrealizedPnl: 10,
      unrealizedPnlPercent: 0,
      optionContract: {
        multiplier: 100,
      },
    },
  ]);

  assert.equal(Number(item.unrealizedPnlPercent.toFixed(6)), 1.212121);
});

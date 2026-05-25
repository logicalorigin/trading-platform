import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTreemapItems,
  buildTreemapTransitionFrame,
  easeTreemapTransition,
  interpolateTreemapRect,
  stabilizeTreemapItemOrder,
} from "./PositionTreemapPanel.jsx";

test("position treemap transition uses gradual smoothstep easing", () => {
  assert.equal(easeTreemapTransition(0), 0);
  assert.equal(easeTreemapTransition(1), 1);
  assert.ok(easeTreemapTransition(0.1) < 0.1);
  assert.ok(easeTreemapTransition(0.9) > 0.9);
});

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

test("position treemap preserves prior visual order during value refreshes", () => {
  const previous = [
    { id: "aapl", value: 100 },
    { id: "tsla", value: 90 },
    { id: "nvda", value: 80 },
  ];
  const refreshed = [
    { id: "nvda", value: 130 },
    { id: "aapl", value: 95 },
    { id: "crwd", value: 120 },
    { id: "tsla", value: 85 },
  ];

  assert.deepEqual(
    stabilizeTreemapItemOrder(refreshed, previous).map((item) => item.id),
    ["aapl", "tsla", "nvda", "crwd"],
  );
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

test("position treemap interpolates stable rectangles between live updates", () => {
  const from = {
    id: "stock-aapl",
    symbol: "AAPL",
    x: 0,
    y: 10,
    w: 100,
    h: 80,
    value: 100,
    marketValue: 100,
    dayChangePercent: -4,
    unrealizedPnlPercent: 2,
  };
  const to = {
    ...from,
    x: 100,
    y: 30,
    w: 200,
    h: 120,
    value: 200,
    marketValue: 200,
    dayChangePercent: 4,
    unrealizedPnlPercent: -2,
  };

  const mid = interpolateTreemapRect(from, to, 0.5);

  assert.equal(mid.x, 50);
  assert.equal(mid.y, 20);
  assert.equal(mid.w, 150);
  assert.equal(mid.h, 100);
  assert.equal(mid.marketValue, 150);
  assert.equal(mid.dayChangePercent, 0);
  assert.equal(mid.unrealizedPnlPercent, 0);
});

test("position treemap expands entering positions from their target center", () => {
  const target = {
    id: "option-nvda",
    symbol: "NVDA",
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    value: 500,
    marketValue: 500,
    dayChangePercent: 3,
    unrealizedPnlPercent: 12,
  };

  const [entering] = buildTreemapTransitionFrame({
    fromRects: [],
    toRects: [target],
    progress: 0.1,
  });

  assert.equal(entering.id, "option-nvda");
  assert.equal(entering.isLeaving, false);
  assert.ok(entering.opacity > 0 && entering.opacity < 1);
  assert.ok(entering.w > 0 && entering.w < target.w);
  assert.ok(entering.h > 0 && entering.h < target.h);
  assert.ok(entering.x > target.x && entering.x < target.x + target.w / 2);
  assert.ok(entering.y > target.y && entering.y < target.y + target.h / 2);
});

test("position treemap fades leaving positions before dropping them", () => {
  const oldRect = {
    id: "stock-tsla",
    symbol: "TSLA",
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    value: 500,
    marketValue: 500,
    dayChangePercent: -3,
    unrealizedPnlPercent: -12,
  };

  const [leaving] = buildTreemapTransitionFrame({
    fromRects: [oldRect],
    toRects: [],
    progress: 0.1,
  });
  const complete = buildTreemapTransitionFrame({
    fromRects: [oldRect],
    toRects: [],
    progress: 1,
  });

  assert.equal(leaving.id, "stock-tsla");
  assert.equal(leaving.isLeaving, true);
  assert.ok(leaving.opacity > 0 && leaving.opacity < 1);
  assert.ok(leaving.w > 0 && leaving.w < oldRect.w);
  assert.ok(leaving.h > 0 && leaving.h < oldRect.h);
  assert.deepEqual(complete, []);
});

test("position treemap reduced-motion frames jump directly to target layout", () => {
  const from = {
    id: "stock-aapl",
    symbol: "AAPL",
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    value: 100,
    marketValue: 100,
    dayChangePercent: -4,
    unrealizedPnlPercent: 2,
  };
  const to = {
    ...from,
    x: 100,
    y: 30,
    w: 200,
    h: 120,
    value: 200,
    marketValue: 200,
    dayChangePercent: 4,
    unrealizedPnlPercent: -2,
  };

  const frame = buildTreemapTransitionFrame({
    fromRects: [from],
    toRects: [to],
    progress: 0,
    reducedMotion: true,
  });

  assert.deepEqual(frame, [{ ...to, opacity: 1, isLeaving: false }]);
});

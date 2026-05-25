import assert from "node:assert/strict";
import test from "node:test";
import { buildChartPositionOverlays } from "./chartPositionOverlays";
import type { ChartBar, ChartBarRange } from "./types";

const chartBars: ChartBar[] = [
  {
    time: 1_700_000_000,
    ts: "2023-11-14T22:13:20.000Z",
    date: "2023-11-14",
    o: 100,
    h: 101,
    l: 99,
    c: 100.5,
    v: 1000,
  },
  {
    time: 1_700_000_060,
    ts: "2023-11-14T22:14:20.000Z",
    date: "2023-11-14",
    o: 101,
    h: 102,
    l: 100,
    c: 101.5,
    v: 1000,
  },
];

const chartBarRanges: ChartBarRange[] = [
  { startMs: 1_700_000_000_000, endMs: 1_700_000_060_000 },
  { startMs: 1_700_000_060_000, endMs: 1_700_000_120_000 },
];

test("buildChartPositionOverlays shapes a spot position", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: { surfaceKind: "spot", symbol: "AAPL" },
    mark: 105,
    chartBars,
    chartBarRanges,
    positions: [
      {
        id: "pos-1",
        accountId: "U1",
        symbol: "AAPL",
        assetClass: "equity",
        quantity: 10,
        averagePrice: 100,
        marketPrice: 104,
        unrealizedPnl: 40,
      },
    ],
    executions: [
      {
        id: "exec-1",
        symbol: "AAPL",
        side: "buy",
        quantity: 10,
        price: 100,
        executedAt: "2023-11-14T22:14:40.000Z",
      },
    ],
  });

  assert.equal(overlays.entryLines.length, 1);
  assert.equal(overlays.entryLines[0].price, 100);
  assert.equal(overlays.pnlBubbles[0].label, "+$50.00");
  assert.equal(overlays.fillMarkers.length, 1);
  assert.equal(overlays.fillMarkers[0].time, chartBars[1].time);
});

test("buildChartPositionOverlays matches option contracts by provider id", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: {
      surfaceKind: "option",
      symbol: "SPY",
      optionContract: {
        underlying: "SPY",
        expirationDate: "2026-06-19",
        strike: 500,
        right: "call",
        providerContractId: "123",
      },
    },
    positions: [
      {
        id: "match",
        symbol: "SPY",
        assetClass: "option",
        quantity: 1,
        averagePrice: 2,
        marketPrice: 2.5,
        optionContract: {
          underlying: "SPY",
          expirationDate: "2026-06-19",
          strike: 510,
          right: "put",
          providerContractId: "123",
        },
      },
      {
        id: "miss",
        symbol: "SPY",
        assetClass: "option",
        quantity: 1,
        averagePrice: 1,
        marketPrice: 1,
        optionContract: {
          underlying: "SPY",
          expirationDate: "2026-06-19",
          strike: 500,
          right: "call",
          providerContractId: "999",
        },
      },
    ],
  });

  assert.deepEqual(overlays.entryLines.map((line) => line.id), ["match"]);
});

test("buildChartPositionOverlays falls back to option tuple matching", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: {
      surfaceKind: "option",
      symbol: "SPY",
      optionContract: {
        underlying: "SPY",
        expirationDate: "2026-06-19T00:00:00.000Z",
        strike: "500",
        right: "C",
        providerContractId: "chart-provider",
      },
    },
    positions: [
      {
        id: "tuple",
        symbol: "SPY",
        assetClass: "option",
        quantity: 2,
        averagePrice: 1.25,
        marketPrice: 1.5,
        optionContract: {
          underlying: "spy",
          expirationDate: new Date("2026-06-19T12:00:00.000Z"),
          strike: 500,
          right: "call",
        },
      },
    ],
  });

  assert.equal(overlays.entryLines.length, 1);
  assert.equal(overlays.entryLines[0].id, "tuple");
});

test("buildChartPositionOverlays rejects impossible expiration tuple matches", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: {
      surfaceKind: "option",
      symbol: "SPY",
      optionContract: {
        underlying: "SPY",
        expirationDate: "2026-03-03",
        strike: 500,
        right: "call",
      },
    },
    positions: [
      {
        id: "invalid-expiration",
        symbol: "SPY",
        assetClass: "option",
        quantity: 2,
        averagePrice: 1.25,
        marketPrice: 1.5,
        optionContract: {
          underlying: "SPY",
          expirationDate: "2026-02-31",
          strike: 500,
          right: "call",
        },
      },
    ],
  });

  assert.equal(overlays.entryLines.length, 0);
  assert.equal(overlays.pnlBubbles.length, 0);
});

test("buildChartPositionOverlays returns no overlays for unrelated symbols", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: { surfaceKind: "spot", symbol: "MSFT" },
    positions: [
      {
        id: "pos-1",
        symbol: "AAPL",
        assetClass: "equity",
        quantity: 10,
        averagePrice: 100,
      },
    ],
  });

  assert.equal(overlays.entryLines.length, 0);
  assert.equal(overlays.pnlBubbles.length, 0);
});

test("buildChartPositionOverlays does not match incomplete option tuples", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: {
      surfaceKind: "option",
      symbol: "SPY",
      optionContract: {},
    },
    positions: [
      {
        id: "incomplete",
        symbol: "SPY",
        assetClass: "option",
        quantity: 1,
        averagePrice: 1,
        marketPrice: 1.2,
        optionContract: {},
      },
    ],
  });

  assert.equal(overlays.entryLines.length, 0);
});

test("buildChartPositionOverlays creates mini off-pane indicators", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: { surfaceKind: "mini", symbol: "AAPL" },
    visiblePriceRange: { min: 95, max: 105 },
    positions: [
      {
        id: "above",
        symbol: "AAPL",
        quantity: 5,
        averagePrice: 150,
        marketPrice: 102,
      },
    ],
  });

  assert.equal(overlays.entryLines.length, 0);
  assert.equal(overlays.offPaneIndicators.length, 1);
  assert.equal(overlays.offPaneIndicators[0].direction, "above");
});

test("buildChartPositionOverlays filters fills outside loaded chart bars", () => {
  const overlays = buildChartPositionOverlays({
    chartContext: { surfaceKind: "spot", symbol: "AAPL" },
    chartBars,
    chartBarRanges,
    positions: [
      {
        id: "pos-1",
        symbol: "AAPL",
        quantity: 1,
        averagePrice: 100,
      },
    ],
    executions: [
      {
        id: "old",
        symbol: "AAPL",
        side: "buy",
        quantity: 1,
        price: 100,
        executedAt: "2023-11-13T22:14:40.000Z",
      },
    ],
  });

  assert.equal(overlays.fillMarkers.length, 0);
});

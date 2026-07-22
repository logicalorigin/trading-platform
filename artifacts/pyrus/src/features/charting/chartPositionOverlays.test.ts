import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChartPositionOverlays } from "./chartPositionOverlays.ts";
import type { ChartBar } from "./types.ts";

test("trailing-stop history is only reconstructed from a known chart start", () => {
  const chartBars: ChartBar[] = Array.from({ length: 5 }, (_, index) => ({
    time: 1_700_000_000 + index * 60,
    ts: new Date((1_700_000_000 + index * 60) * 1_000).toISOString(),
    date: new Date((1_700_000_000 + index * 60) * 1_000)
      .toISOString()
      .slice(0, 10),
    o: 100 + index,
    h: 102 + index,
    l: 99 + index,
    c: 101 + index,
    v: 1_000,
  }));
  const position = {
    id: "position-1",
    symbol: "AAPL",
    quantity: 1,
    averagePrice: 100,
    riskOverlay: {
      entryPrice: 100,
      hardStopPrice: 95,
      trailActive: true,
      trailStopPrice: 104,
      trailHasTakenOver: true,
      trailActivationPct: 1,
      givebackPct: 20,
    },
  };

  const overlays = buildChartPositionOverlays({
    chartContext: { surfaceKind: "spot", symbol: "AAPL" },
    chartBars,
    positions: [position],
  });

  const trailingPath = overlays.riskLinePaths.find(
    (path) => path.kind === "trailingStop",
  );
  assert.equal(trailingPath?.fallbackOnly, true);
  assert.equal(trailingPath?.points.length, 2);

  const knownStartOverlays = buildChartPositionOverlays({
    chartContext: { surfaceKind: "spot", symbol: "AAPL" },
    chartBars,
    positions: [
      {
        ...position,
        riskOverlay: {
          ...position.riskOverlay,
          openedAt: new Date(chartBars[0].time * 1_000),
        },
      },
    ],
  });
  const reconstructedPath = knownStartOverlays.riskLinePaths.find(
    (path) => path.kind === "trailingStop",
  );
  assert.equal(reconstructedPath?.fallbackOnly, false);
  assert.equal(reconstructedPath?.points.length, chartBars.length);
  assert.equal(reconstructedPath?.points[0]?.price, 101.6);
});

test("spot charts reject option rows even when contract enrichment is absent", () => {
  const time = Date.parse("2026-07-20T14:30:00.000Z");
  const chartBars: ChartBar[] = [
    {
      time: time / 1_000,
      ts: new Date(time).toISOString(),
      date: "2026-07-20",
      o: 100,
      h: 101,
      l: 99,
      c: 100,
      v: 1_000,
    },
  ];

  const overlays = buildChartPositionOverlays({
    chartContext: { surfaceKind: "spot", symbol: "AAPL" },
    chartBars,
    positions: [
      {
        id: "option-position",
        symbol: "AAPL",
        assetClass: "option",
        optionContract: null,
        quantity: 1,
        averagePrice: 2,
      },
    ],
    executions: [
      {
        id: "option-execution",
        symbol: "AAPL",
        assetClass: "option",
        optionContract: null,
        side: "buy",
        price: 2,
        quantity: 1,
        executedAt: new Date(time),
      },
    ],
  });

  assert.equal(overlays.entryLines.length, 0);
  assert.equal(overlays.fillMarkers.length, 0);
});

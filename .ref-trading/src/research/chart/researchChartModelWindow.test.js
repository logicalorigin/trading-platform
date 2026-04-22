import assert from "node:assert/strict";
import test from "node:test";

import { resolveResearchChartSourceSlice } from "./researchChartModelWindow.js";

function buildBars(count = 10000, startMs = Date.UTC(2026, 0, 2, 14, 30), stepMs = 60 * 1000) {
  return Array.from({ length: count }, (_, index) => ({
    time: startMs + (index * stepMs),
    date: "2026-01-02",
    hour: 9,
    min: 30,
    o: 1,
    h: 1,
    l: 1,
    c: 1,
    v: 1,
  }));
}

test("resolveResearchChartSourceSlice follows viewportTimeBounds ahead of autoTimeBounds", () => {
  const bars = buildBars();
  const slice = resolveResearchChartSourceSlice({
    bars,
    chartRange: "1W",
    chartWindowMode: "custom",
    effectiveTf: "1m",
    tfMin: 1,
    viewportTimeBounds: {
      startMs: bars[1200].time,
      endMs: bars[1260].time,
    },
    autoTimeBounds: {
      startMs: bars[7600].time,
      endMs: bars[7660].time,
    },
  });

  assert.equal(slice.reason, "viewport");
  assert.ok(slice.endIndex < 3000);
});

test("resolveResearchChartSourceSlice falls back to autoTimeBounds when no viewportTimeBounds exist", () => {
  const bars = buildBars();
  const slice = resolveResearchChartSourceSlice({
    bars,
    chartRange: "1W",
    chartWindowMode: "custom",
    effectiveTf: "1m",
    tfMin: 1,
    autoTimeBounds: {
      startMs: bars[7600].time,
      endMs: bars[7660].time,
    },
  });

  assert.equal(slice.reason, "viewport");
  assert.ok(slice.startIndex > 5000);
});

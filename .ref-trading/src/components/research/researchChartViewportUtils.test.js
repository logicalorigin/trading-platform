import test from "node:test";
import assert from "node:assert/strict";
import {
  clampVisibleLogicalRange,
  resolveBaseSeriesMode,
  resolveVisibleRangeRightPaddingBars,
  toVisibleBarIndexRange,
} from "./researchChartViewportUtils.js";

test("15m all-candles datasets switch out of full-series sooner", () => {
  const limits15m = {
    startMaxBars: 3200,
    retainMaxBars: 4800,
    renderWindowMaxBars: 3200,
  };

  assert.equal(resolveBaseSeriesMode(3000, "empty", limits15m, {
    fullSeriesDirectMaxBars: 6000,
    fullBaseDataCacheMaxBars: 125000,
  }), "full-series");

  assert.equal(resolveBaseSeriesMode(3600, "empty", limits15m, {
    fullSeriesDirectMaxBars: 6000,
    fullBaseDataCacheMaxBars: 125000,
  }), "full-cache-window");

  assert.equal(resolveBaseSeriesMode(5200, "full-series", limits15m, {
    fullSeriesDirectMaxBars: 6000,
    fullBaseDataCacheMaxBars: 125000,
  }), "full-cache-window");
});

test("panning into right whitespace still keeps a real-candle foothold in view", () => {
  const clampedRange = clampVisibleLogicalRange({ from: 120, to: 140 }, 100, 24);
  const visibleBarRange = toVisibleBarIndexRange(clampedRange, 100, 0, 24);

  assert.equal(visibleBarRange.to, 99);
  assert.ok(visibleBarRange.from <= 98);
});

test("right-whitespace padding is preserved without losing the loaded candle anchor", () => {
  const clampedRange = clampVisibleLogicalRange({ from: 95, to: 119 }, 100, 24);
  const rightPaddingBars = resolveVisibleRangeRightPaddingBars(clampedRange, 100, 24);
  const visibleBarRange = toVisibleBarIndexRange(clampedRange, 100, 0, 24);

  assert.ok(rightPaddingBars > 0);
  assert.equal(visibleBarRange.to, 99);
});

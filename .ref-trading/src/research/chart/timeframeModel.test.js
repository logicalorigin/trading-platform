import test from "node:test";
import assert from "node:assert/strict";

import {
  CHART_WINDOW_MODE_ALL,
  CHART_WINDOW_MODE_FULL,
  resolveAutoTimeframeByRange,
  resolveChartWindowDisplayState,
  resolveDefaultVisibleRangeForTimeframe,
} from "./timeframeModel.js";

test("resolveDefaultVisibleRangeForTimeframe defaults auto charts to 3M", () => {
  assert.equal(resolveDefaultVisibleRangeForTimeframe("auto"), "3M");
  assert.equal(resolveDefaultVisibleRangeForTimeframe("5m"), "3M");
});

test("resolveAutoTimeframeByRange keeps the new wider default load at 5m for 3M", () => {
  assert.equal(resolveAutoTimeframeByRange("3M"), "5m");
});

test("resolveChartWindowDisplayState falls back to the active preset when no viewport bounds exist", () => {
  const state = resolveChartWindowDisplayState({
    chartRange: "2W",
    chartWindowMode: "default",
    effectiveTf: "15m",
  });

  assert.deepEqual(state, {
    label: "2W",
    menuValue: "2W",
    presetKey: "2W",
    isFull: false,
    isPresetMatch: true,
    hasViewportBounds: false,
    visibleTradingDays: null,
  });
});

test("resolveChartWindowDisplayState matches viewport spans to the nearest preset using visible bar counts", () => {
  const state = resolveChartWindowDisplayState({
    chartRange: "1W",
    chartWindowMode: "default",
    effectiveTf: "15m",
    visibleBars: 260,
    timeBounds: {
      startMs: Date.UTC(2025, 0, 2),
      endMs: Date.UTC(2025, 0, 17),
    },
  });

  assert.equal(state.label, "2W");
  assert.equal(state.menuValue, "2W");
  assert.equal(state.presetKey, "2W");
  assert.equal(state.isPresetMatch, true);
  assert.equal(state.isFull, false);
});

test("resolveChartWindowDisplayState uses a compact derived label for custom spans", () => {
  const state = resolveChartWindowDisplayState({
    chartRange: "1W",
    chartWindowMode: "default",
    effectiveTf: "D",
    visibleBars: 8,
    timeBounds: {
      startMs: Date.UTC(2025, 0, 2),
      endMs: Date.UTC(2025, 0, 13),
    },
  });

  assert.equal(state.label, "1.6W");
  assert.equal(state.menuValue, "__custom__");
  assert.equal(state.presetKey, null);
  assert.equal(state.isPresetMatch, false);
  assert.equal(state.isFull, false);
});

test("resolveChartWindowDisplayState promotes full-history coverage to Full", () => {
  const loadedTimeBounds = {
    startMs: Date.UTC(2025, 0, 2),
    endMs: Date.UTC(2025, 1, 28),
  };
  const state = resolveChartWindowDisplayState({
    chartRange: "1M",
    chartWindowMode: "default",
    effectiveTf: "D",
    visibleBars: 40,
    timeBounds: loadedTimeBounds,
    loadedTimeBounds,
  });

  assert.equal(state.label, "Full");
  assert.equal(state.menuValue, CHART_WINDOW_MODE_FULL);
  assert.equal(state.isFull, true);
});

test("resolveChartWindowDisplayState keeps explicit all mode on Full even before bounds are known", () => {
  const state = resolveChartWindowDisplayState({
    chartRange: "1M",
    chartWindowMode: CHART_WINDOW_MODE_ALL,
    effectiveTf: "D",
  });

  assert.equal(state.label, "Full");
  assert.equal(state.menuValue, CHART_WINDOW_MODE_FULL);
  assert.equal(state.isFull, true);
});

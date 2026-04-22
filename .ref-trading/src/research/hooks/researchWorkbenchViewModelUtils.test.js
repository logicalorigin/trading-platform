import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpotChartBaseSeriesModeKey,
  buildSpotChartRangePresetKey,
  normalizeSpotChartPresetWindowMode,
  resolveSpotChartModelWindowMode,
} from "./researchWorkbenchViewModelUtils.js";

test("resolveSpotChartModelWindowMode keeps all-candles mode for the model", () => {
  assert.equal(resolveSpotChartModelWindowMode({ chartWindowMode: "all" }), "all");
});

test("manual intervals let the model follow a real viewport", () => {
  assert.equal(resolveSpotChartModelWindowMode({
    chartWindowMode: "default",
    candleTf: "2m",
    hasViewportTimeBounds: true,
  }), "custom");
});

test("auto mode keeps default model ownership for ordinary viewport updates", () => {
  assert.equal(resolveSpotChartModelWindowMode({
    chartWindowMode: "default",
    candleTf: "auto",
    hasViewportTimeBounds: true,
  }), "default");
});

test("resolveSpotChartModelWindowMode normalizes unknown values to default", () => {
  assert.equal(resolveSpotChartModelWindowMode({ chartWindowMode: "" }), "default");
  assert.equal(resolveSpotChartModelWindowMode({ chartWindowMode: null }), "default");
  assert.equal(resolveSpotChartModelWindowMode({ chartWindowMode: "preset" }), "default");
});

test("normalizeSpotChartPresetWindowMode still prevents custom viewport churn from looking like a preset change", () => {
  assert.equal(normalizeSpotChartPresetWindowMode("custom"), "default");
});

test("buildSpotChartRangePresetKey ignores auto timeframe churn and only tracks true preset/window changes", () => {
  assert.equal(
    buildSpotChartRangePresetKey({ chartRange: "1W", chartWindowMode: "default", chartPresetVersion: 2 }),
    "1W|default|2",
  );
  assert.equal(
    buildSpotChartRangePresetKey({ chartRange: "1W", chartWindowMode: "custom", chartPresetVersion: 2 }),
    "1W|default|2",
  );
});

test("buildSpotChartBaseSeriesModeKey keeps timeframe-specific render limits separate from preset identity", () => {
  assert.equal(buildSpotChartBaseSeriesModeKey({ effectiveTf: "15m" }), "15m");
  assert.equal(buildSpotChartBaseSeriesModeKey({ effectiveTf: "D" }), "D");
});

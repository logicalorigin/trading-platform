import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CHART_TYPE,
  VOLUME_CHART_TYPE,
  isVolumeChartType,
  normalizeChartType,
} from "./volumeChartType.js";

test("normalizeChartType defaults invalid values to candles", () => {
  assert.equal(normalizeChartType(""), DEFAULT_CHART_TYPE);
  assert.equal(normalizeChartType("line"), DEFAULT_CHART_TYPE);
  assert.equal(normalizeChartType(null), DEFAULT_CHART_TYPE);
});

test("normalizeChartType accepts volume candles", () => {
  assert.equal(normalizeChartType(VOLUME_CHART_TYPE), VOLUME_CHART_TYPE);
});

test("isVolumeChartType only returns true for volume candles", () => {
  assert.equal(isVolumeChartType(VOLUME_CHART_TYPE), true);
  assert.equal(isVolumeChartType(DEFAULT_CHART_TYPE), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveVisibleRangeHydrationAction,
  CHART_HYDRATION_ACTION,
} from "./chartHydrationRuntime.js";

// Focused guard for "Chart older candle hydration on pan/zoom" option (a):
// PREPEND_OLDER must fire at the left edge even while the initial window is
// still below targetLimit (pressure-throttled), because PREPEND_OLDER is not
// shed by the hydration pressure gate whereas the EXPAND_LIMIT fallback is.
const base = {
  enabled: true,
  range: { from: 0, to: 100 }, // from <= leftEdgeBuffer (24) => near the left edge
  loadedBarCount: 200,
  targetLimit: 1800,
  maxLimit: 12000,
  timeframe: "5m",
  role: "primary",
  oldestLoadedAtMs: 1_700_000_000_000,
  canPrependOlderHistory: true,
  hasExhaustedOlderHistory: false,
  pressure: "normal",
};

test("PREPEND_OLDER fires at the left edge even when requestedLimit < targetLimit (the fix)", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360, // initial window still throttled below target
  });
  assert.equal(action.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
  assert.equal(action.reason, "near-left-edge");
});

test("PREPEND_OLDER still fires when the window IS at target (unchanged)", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 1800,
  });
  assert.equal(action.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
});

test("PREPEND_OLDER keeps full page size under pressure for foreground pan/zoom", () => {
  const normalAction = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    pressure: "normal",
  });
  const backoffAction = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    pressure: "backoff",
  });
  const stalledAction = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    pressure: "stalled",
  });

  assert.equal(backoffAction.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
  assert.equal(stalledAction.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
  assert.equal(backoffAction.pageSize, normalAction.pageSize);
  assert.equal(stalledAction.pageSize, normalAction.pageSize);
});

test("without a prepend source the left edge falls back to EXPAND_LIMIT (the gate-shed path)", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    canPrependOlderHistory: false,
  });
  assert.equal(action.action, CHART_HYDRATION_ACTION.EXPAND_LIMIT);
});

test("exhausted older history does not prepend", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    hasExhaustedOlderHistory: true,
  });
  assert.notEqual(action.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
});

test("a non-finite oldestLoadedAtMs does not prepend (needs a contiguous anchor)", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    oldestLoadedAtMs: null,
  });
  assert.notEqual(action.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
});

test("away from the left edge does nothing", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    range: { from: 500, to: 600 },
  });
  assert.equal(action.action, CHART_HYDRATION_ACTION.NONE);
  assert.equal(action.reason, "not-near-left-edge");
});

test("an in-flight prepend suppresses another prepend", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    requestedLimit: 360,
    isPrependingOlder: true,
  });
  assert.equal(action.action, CHART_HYDRATION_ACTION.NONE);
  assert.equal(action.reason, "prepend-in-flight");
});

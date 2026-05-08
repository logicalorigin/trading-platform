import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_HYDRATION_ACTION,
  resolveUnderfilledChartBackfillAction,
  resolveVisibleRangeHydrationAction,
} from "./chartHydrationRuntime.js";

test("visible range hydration ignores ranges away from the left edge", () => {
  const action = resolveVisibleRangeHydrationAction({
    range: { from: 200, to: 320 },
    loadedBarCount: 320,
    requestedLimit: 500,
    targetLimit: 1000,
    maxLimit: 5000,
    timeframe: "5m",
  });

  assert.equal(action.action, CHART_HYDRATION_ACTION.NONE);
  assert.equal(action.reason, "not-near-left-edge");
});

test("visible range hydration expands the requested window before prepending", () => {
  const action = resolveVisibleRangeHydrationAction({
    range: { from: 8, to: 128 },
    loadedBarCount: 240,
    requestedLimit: 240,
    targetLimit: 1000,
    maxLimit: 5000,
    timeframe: "1m",
    canPrependOlderHistory: true,
    oldestLoadedAtMs: Date.parse("2026-05-01T13:30:00.000Z"),
  });

  assert.equal(action.action, CHART_HYDRATION_ACTION.EXPAND_LIMIT);
  assert.equal(action.nextRequestedLimit >= 1000, true);
});

test("visible range hydration prepends older option bars at the left edge", () => {
  const action = resolveVisibleRangeHydrationAction({
    range: { from: 0, to: 80 },
    loadedBarCount: 1000,
    requestedLimit: 1000,
    targetLimit: 1000,
    maxLimit: 5000,
    timeframe: "1m",
    role: "option",
    canPrependOlderHistory: true,
    oldestLoadedAtMs: Date.parse("2026-05-01T13:30:00.000Z"),
  });

  assert.equal(action.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
  assert.equal(action.pageSize >= 240, true);
});

test("visible range hydration prepends older bars after a zoom-out into left whitespace", () => {
  const action = resolveVisibleRangeHydrationAction({
    range: { from: -240, to: 180 },
    loadedBarCount: 1000,
    requestedLimit: 1000,
    targetLimit: 1000,
    maxLimit: 5000,
    timeframe: "5m",
    canPrependOlderHistory: true,
    oldestLoadedAtMs: Date.parse("2026-05-01T13:30:00.000Z"),
  });

  assert.equal(action.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
  assert.equal(action.reason, "near-left-edge");
  assert.equal(action.pageSize >= 840, true);
});

test("visible range hydration does not request older bars while a prepend is active", () => {
  const action = resolveVisibleRangeHydrationAction({
    range: { from: 0, to: 80 },
    loadedBarCount: 1000,
    requestedLimit: 1000,
    targetLimit: 1000,
    maxLimit: 5000,
    timeframe: "1m",
    role: "option",
    canPrependOlderHistory: true,
    isPrependingOlder: true,
    oldestLoadedAtMs: Date.parse("2026-05-01T13:30:00.000Z"),
  });

  assert.equal(action.action, CHART_HYDRATION_ACTION.NONE);
  assert.equal(action.reason, "prepend-in-flight");
});

test("visible range hydration waits for an active requested-window fetch", () => {
  const action = resolveVisibleRangeHydrationAction({
    range: { from: 0, to: 80 },
    loadedBarCount: 240,
    requestedLimit: 1000,
    targetLimit: 1000,
    maxLimit: 5000,
    timeframe: "1m",
    role: "option",
    canPrependOlderHistory: true,
    isHydratingRequestedWindow: true,
    oldestLoadedAtMs: Date.parse("2026-05-01T13:30:00.000Z"),
  });

  assert.equal(action.action, CHART_HYDRATION_ACTION.NONE);
  assert.equal(action.reason, "requested-window-loading");
});

test("underfilled chart hydration backfills missing initial bars", () => {
  const action = resolveUnderfilledChartBackfillAction({
    scopeKey: "SPY::1m",
    loadedBarCount: 120,
    requestedLimit: 500,
    minPageSize: 240,
    hasPrependOlderBars: true,
  });

  assert.equal(action.action, CHART_HYDRATION_ACTION.BACKFILL_UNDERFILLED);
  assert.equal(action.pageSize >= 380, true);
});

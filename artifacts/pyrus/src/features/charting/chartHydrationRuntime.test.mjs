import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  resolveVisibleRangeHydrationAction,
  CHART_HYDRATION_ACTION,
  useMeasuredChartModel,
} from "./chartHydrationRuntime.js";
import { __chartStreamingTestInternals } from "./useMassiveStreamedStockBars";
import { getChartHydrationStatsSnapshot } from "./chartHydrationStats.ts";

const { resolvePrependLookbackMs } = __chartStreamingTestInternals;
const DAY_MS = 24 * 60 * 60 * 1_000;

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

test("coarse timeframe prepends use their initial bar limits as page floors", () => {
  for (const [timeframe, pageSize] of [
    ["1w", 156],
    ["1month", 120],
    ["1year", 20],
  ]) {
    const action = resolveVisibleRangeHydrationAction({
      ...base,
      timeframe,
      range: { from: 0, to: 1 },
    });

    assert.equal(action.action, CHART_HYDRATION_ACTION.PREPEND_OLDER);
    assert.equal(action.pageSize, pageSize, timeframe);
  }
});

test("coarse timeframe prepend lookbacks are one page with a bounded maximum window", () => {
  for (const [timeframe, pageSize, maxWindowMs] of [
    ["1w", 156, 156 * 7 * DAY_MS],
    ["1month", 120, 120 * 30 * DAY_MS],
    ["1year", 20, 20 * 365 * DAY_MS],
  ]) {
    assert.equal(resolvePrependLookbackMs(timeframe, pageSize), maxWindowMs);
    assert.equal(resolvePrependLookbackMs(timeframe, 10_000), maxWindowMs);
  }
});

test("fine timeframe prepend page floors and lookbacks stay unchanged", () => {
  const action = resolveVisibleRangeHydrationAction({
    ...base,
    timeframe: "5m",
  });

  assert.equal(action.pageSize, 360);
  assert.equal(resolvePrependLookbackMs("5m", 360), 7 * DAY_MS);
  assert.equal(resolvePrependLookbackMs("1h", 360), 45 * DAY_MS);
  assert.equal(resolvePrependLookbackMs("1d", 360), 360 * DAY_MS);
});

test("measured chart models retain committed state only within the active scope", async () => {
  const globalNames = [
    "cancelAnimationFrame",
    "document",
    "HTMLIFrameElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "requestAnimationFrame",
    "window",
  ];
  const previousGlobals = globalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  const noop = () => {};
  const document = {
    activeElement: null,
    addEventListener: noop,
    defaultView: globalThis,
    nodeType: 9,
    removeEventListener: noop,
  };
  const container = {
    addEventListener: noop,
    firstChild: null,
    lastChild: null,
    nodeType: 1,
    ownerDocument: document,
    parentNode: null,
    removeEventListener: noop,
    tagName: "DIV",
  };
  document.documentElement = container;
  globalThis.cancelAnimationFrame = noop;
  globalThis.document = document;
  globalThis.HTMLIFrameElement = class {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.window = globalThis;

  let computeCount = 0;
  const selectedIndicators = ["deferred-probe"];
  const indicatorSettings = {};
  const indicatorMarkers = [];
  const indicatorRegistry = {
    "deferred-probe": {
      id: "deferred-probe",
      liveUpdateMode: "defer-on-tail-patch",
      compute: () => {
        computeCount += 1;
        return {};
      },
    },
  };
  const initialBars = [
    {
      timestamp: new Date("2026-07-20T14:30:00.000Z"),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1_000,
    },
  ];
  const patchedBars = [{ ...initialBars[0], close: 101.5 }];
  const nextScopeBars = [{ ...initialBars[0], close: 102 }];

  function Harness({ bars, scopeKey }) {
    useMeasuredChartModel({
      scopeKey,
      bars,
      buildInput: {
        bars,
        timeframe: "1m",
        selectedIndicators,
        indicatorSettings,
        indicatorMarkers,
        indicatorRegistry,
      },
      deps: [bars],
    });
    return null;
  }

  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        React.createElement(Harness, {
          bars: initialBars,
          scopeKey: "measured-model-test",
        }),
      ),
    );
    assert.equal(computeCount, 1);
    assert.ok(
      getChartHydrationStatsSnapshot().scopes.some(
        (scope) =>
          scope.scope === "measured-model-test" &&
          Number.isFinite(scope.modelBuildMs),
      ),
    );

    await act(async () =>
      root.render(
        React.createElement(Harness, {
          bars: patchedBars,
          scopeKey: "measured-model-test",
        }),
      ),
    );
    assert.equal(computeCount, 1);

    await act(async () =>
      root.render(
        React.createElement(Harness, {
          bars: nextScopeBars,
          scopeKey: "next-measured-model-test",
        }),
      ),
    );
    assert.equal(computeCount, 2);
  } finally {
    await act(async () => root.unmount());
    previousGlobals.forEach(([name, descriptor]) => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
});

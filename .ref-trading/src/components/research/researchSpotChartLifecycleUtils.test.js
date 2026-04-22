import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResearchSpotChartMountSignature,
  shouldAutoFocusSelectedTradeViewport,
  shouldApplyDefaultRangeOnPresetChange,
  shouldResolvePreservedViewportFromTimeBounds,
} from "./researchSpotChartLifecycleUtils.js";

test("mount signature stays stable across runtime prop churn while bars remain loaded", () => {
  const initialSignature = buildResearchSpotChartMountSignature({
    hasBars: true,
    barCount: 1500,
    selectedTradeId: "trade-1",
    hoveredTradeId: "trade-1",
    defaultVisibleLogicalRange: { from: 1200, to: 1499 },
    rangePresetKey: "3M|5m",
    linkedViewportRequest: { chartId: "leader", token: 1, timeBounds: { startMs: 1, endMs: 2 } },
    onVisibleTimeBoundsChange: () => {},
    onRuntimeHealthChange: () => {},
    pricePrecision: 2,
  });
  const laterSignature = buildResearchSpotChartMountSignature({
    hasBars: true,
    barCount: 6400,
    selectedTradeId: "trade-9",
    hoveredTradeId: null,
    defaultVisibleLogicalRange: { from: 6100, to: 6399 },
    rangePresetKey: "1W|1m",
    linkedViewportRequest: { chartId: "leader", token: 2, timeBounds: { startMs: 10, endMs: 20 } },
    onVisibleTimeBoundsChange: () => {},
    onRuntimeHealthChange: () => {},
    pricePrecision: 4,
  });

  assert.equal(initialSignature, laterSignature);
});

test("mount signature changes only when the chart transitions between empty and loaded states", () => {
  const emptySignature = buildResearchSpotChartMountSignature({
    hasBars: false,
    barCount: 0,
  });
  const loadedSignature = buildResearchSpotChartMountSignature({
    hasBars: true,
    barCount: 1,
  });

  assert.notEqual(emptySignature, loadedSignature);
});

test("preset-key churn from a user-owned viewport does not reset back to the default range", () => {
  const shouldApply = shouldApplyDefaultRangeOnPresetChange({
    rangePresetChanged: true,
    hasDefaultVisibleRange: true,
    shouldPreserveUserRange: true,
    shouldRecoverStableUserViewport: false,
  });

  assert.equal(shouldApply, false);
});

test("true preset changes still reset to the default range when no user viewport should be preserved", () => {
  const shouldApply = shouldApplyDefaultRangeOnPresetChange({
    rangePresetChanged: true,
    hasDefaultVisibleRange: true,
    shouldPreserveUserRange: false,
    shouldRecoverStableUserViewport: false,
  });

  assert.equal(shouldApply, true);
});

test("user-owned viewports reproject from time bounds when the chart rebuckets candles", () => {
  const shouldResolve = shouldResolvePreservedViewportFromTimeBounds({
    hasPreservedTimeBounds: true,
    shouldPreserveUserRange: true,
    shouldRecoverStableUserViewport: false,
  });

  assert.equal(shouldResolve, true);
});

test("missing time bounds cannot reproject a preserved viewport", () => {
  const shouldResolve = shouldResolvePreservedViewportFromTimeBounds({
    hasPreservedTimeBounds: false,
    shouldPreserveUserRange: true,
    shouldRecoverStableUserViewport: false,
  });

  assert.equal(shouldResolve, false);
});

test("spot charts can disable selected-trade viewport auto-focus entirely", () => {
  const shouldFocus = shouldAutoFocusSelectedTradeViewport({
    autoFocusSelectedTrade: false,
    selectedTradeId: "trade-1",
    chartId: "spot",
  });

  assert.equal(shouldFocus, false);
});

test("a chart does not auto-focus a trade selection that already originated from that same chart", () => {
  const shouldFocus = shouldAutoFocusSelectedTradeViewport({
    autoFocusSelectedTrade: true,
    selectedTradeId: "trade-1",
    chartId: "option",
    selectedTradeSourceChartId: "option",
  });

  assert.equal(shouldFocus, false);
});

test("a different chart can still auto-focus the active trade selection", () => {
  const shouldFocus = shouldAutoFocusSelectedTradeViewport({
    autoFocusSelectedTrade: true,
    selectedTradeId: "trade-1",
    chartId: "option",
    selectedTradeSourceChartId: "spot",
  });

  assert.equal(shouldFocus, true);
});

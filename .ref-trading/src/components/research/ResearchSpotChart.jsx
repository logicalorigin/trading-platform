import React, { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";
import {
  DEFAULT_RESEARCH_STRATEGY,
  getStrategyLabel,
  normalizeResearchStrategy,
} from "../../research/config/strategyPresets.js";
import { formatMarketDateLabel } from "../../research/market/time.js";
import {
  isDeferredPresentationSource,
  isUserRangeSource,
  resolveDeferredPresentationDelayMs,
  shouldDeferVisibleRangeClampUntilIdle,
  shouldDeferRenderWindowRefreshUntilIdle,
  shouldReassertVisibleRangeOnIdle,
  shouldTreatVisibleRangeChangeAsActiveUserInteraction,
} from "./researchChartInteractionPolicy.js";
import {
  buildBaseDataCache,
  createEmptyBaseDataCache,
  cancelAnimationFrameRefs,
  clearTimeoutRefs,
  resetBaseDataCacheRefs,
  resetPendingRenderWindowRef,
  sliceBaseDataCache,
} from "./researchChartRuntimeUtils.js";
import {
  baseSeriesModeUsesRenderWindow as baseSeriesModeUsesRenderWindowUtil,
  buildRenderWindowSignature as buildRenderWindowSignatureUtil,
  buildRenderWindowSpec as buildRenderWindowSpecUtil,
  clampVisibleLogicalRange as clampVisibleLogicalRangeUtil,
  globalToLocalLogicalRange as globalToLocalLogicalRangeUtil,
  localToGlobalLogicalRange as localToGlobalLogicalRangeUtil,
  renderWindowMatches as renderWindowMatchesUtil,
  resolveActiveBarCap as resolveActiveBarCapUtil,
  resolveBaseSeriesMode as resolveBaseSeriesModeUtil,
  resolveBaseSeriesModeLimits as resolveBaseSeriesModeLimitsUtil,
  resolveVisibleRangeRightPaddingBars as resolveVisibleRangeRightPaddingBarsUtil,
  shouldRefreshRenderWindow as shouldRefreshRenderWindowUtil,
  toVisibleBarIndexRange as toVisibleBarIndexRangeUtil,
} from "./researchChartViewportUtils.js";
import {
  buildOverlayRectSignature,
  buildOverlayZoneSignature,
  getOverlayMergeGapBars,
  reduceIndicatorZoneOverlaps,
  resolveDominantIndicatorWindows,
  syncOverlayRectNodes,
  syncOverlayZoneNodes,
} from "./researchChartOverlayUtils.js";
import {
  EMPTY_INDICATOR_MARKER_PAYLOAD,
  buildMarkerSetSignature,
  buildTradeMarkers,
  createHoverSnapshotStore,
  markerFallsWithinRange,
  resolveIndicatorMarkers,
} from "./researchChartMarkerUtils.js";
import {
  buildResearchSpotChartMountSignature,
  shouldAutoFocusSelectedTradeViewport,
  shouldApplyDefaultRangeOnPresetChange,
  shouldResolvePreservedViewportFromTimeBounds,
} from "./researchSpotChartLifecycleUtils.js";
import { resolveOlderHistoryPrefetchDecision } from "./researchSpotChartHistoryUtils.js";
import { resolveOlderHistoryRequestSettleState } from "./researchSpotChartHistoryUtils.js";
import { createVolumeCandlePrimitive } from "./researchVolumeCandlePrimitive.js";
import {
  DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
  usesTraditionalRayalgoCandleColors,
} from "../../research/chart/rayalgoCandleColorMode.js";
import {
  DEFAULT_CHART_TYPE,
  isVolumeChartType,
} from "../../research/chart/volumeChartType.js";

const FONT_MONO = "'IBM Plex Mono','Fira Code',monospace";
const BULL = "#22c55e";
const BEAR = "#ef4444";
const SIGNAL_BUY = "#2563eb";
const ACCENT = "#4f46e5";
const SHADE_BULL = "#3b82f6";
const SHADE_BEAR = "#ef4444";
const RAYALGO_BULL = "#38bdf8";
const RAYALGO_BEAR = "#f472b6";
const RAYALGO_BULL_VOLUME = "rgba(56,189,248,0.3)";
const RAYALGO_BEAR_VOLUME = "rgba(244,114,182,0.3)";
const TEXT = "#111827";
const MUTED = "#94a3b8";
const GRID = "#e8eaed";
const PRICE_LINE_COLOR = "#475569";
const OLDER_HISTORY_EDGE_TRIGGER_BARS = 24;
const FULL_SERIES_DIRECT_MAX_BARS = 6000;
const RENDER_WINDOW_MIN_BARS = 1800;
const RENDER_WINDOW_MIN_EDGE_BARS = 240;
const RENDER_WINDOW_OVERSCAN_MULTIPLIER = 1.5;
const RENDER_WINDOW_RESIZE_THRESHOLD = 1.6;
// Small intraday views can hydrate well past 75k bars in the Backtest surface.
// We still want the 1m chart to stay direct to preserve zoom stability, but
// heavier 5m+ views need to fall back to windowed rendering sooner so the page
// does not become unresponsive during hydration.
const FULL_BASE_DATA_CACHE_MAX_BARS = 125000;
const MANUAL_FULL_INTERVAL_MAX_BARS = 260000;
const OVERLAY_MERGE_TARGET_WIDTH_PX = 6;
const LINKED_VIEWPORT_MIN_OVERLAP_RATIO = 0.35;
const LINKED_VIEWPORT_SETTLE_MS = 140;
const USER_RANGE_INTENT_MAX_AGE_MS = 2500;
// Some programmatic range callbacks land several seconds after wheel/render-window
// changes complete. Keep this window comfortably longer than user intent so
// delayed callbacks are still recognized as chart-owned updates instead of
// fresh input.
const PROGRAMMATIC_RANGE_MAX_AGE_MS = 12000;
const PROGRAMMATIC_RANGE_SKIP_TOLERANCE = 0.05;
const USER_RANGE_CLAMP_TOLERANCE = 0.35;
const OLDER_HISTORY_REQUEST_INTENT_MAX_AGE_MS = 1600;
const RANGE_INTERACTION_CLICK_SUPPRESS_MS = 450;
const RANGE_INTERACTION_DRAG_THRESHOLD_PX = 8;
const SELECTION_VIEWPORT_LOCK_MS = 260;
const DEFAULT_RIGHT_VIEWPORT_OFFSET_BARS = 8;
const MAX_RIGHT_VIEWPORT_WHITESPACE_BARS = 24;
const TRADE_SELECTION_PICKER_WIDTH_PX = 320;
const TRADE_SELECTION_PICKER_BASE_HEIGHT_PX = 72;
const TRADE_SELECTION_PICKER_ROW_HEIGHT_PX = 56;
const TRADE_SELECTION_PICKER_EDGE_PADDING_PX = 12;
const TRADE_SELECTION_PICKER_OFFSET_PX = 10;
const RENDER_WINDOW_TRANSITION_MAX_AGE_MS = 12000;
const PRESENTATION_SYNC_DEFER_MS = 220;
const PRESENTATION_SYNC_DRAG_DEFER_MS = 280;
const PRESENTATION_SYNC_WHEEL_DEFER_MS = 320;
const RESIZE_PRESENTATION_SYNC_DEBOUNCE_MS = 96;
const SELECTED_TRADE_FOCUS_MIN_BARS = 48;
const SELECTED_TRADE_FOCUS_MAX_BARS = 240;
const PRESENTATION_DELAY_CONFIG = {
  defaultDelayMs: PRESENTATION_SYNC_DEFER_MS,
  dragDelayMs: PRESENTATION_SYNC_DRAG_DEFER_MS,
  wheelDelayMs: PRESENTATION_SYNC_WHEEL_DEFER_MS,
};
const FULL_SERIES_MODE_LIMITS_BY_TF = {
  "1m": { startMaxBars: 125000, retainMaxBars: 125000, renderWindowMaxBars: 18000 },
  "2m": { startMaxBars: 70000, retainMaxBars: 90000, renderWindowMaxBars: 16000 },
  "5m": { startMaxBars: 24000, retainMaxBars: 60000, renderWindowMaxBars: 50000 },
  "15m": { startMaxBars: 3200, retainMaxBars: 4800, renderWindowMaxBars: 3200 },
  "30m": { startMaxBars: 6000, retainMaxBars: 9000, renderWindowMaxBars: 4200 },
  "1h": { startMaxBars: 6000, retainMaxBars: 8000, renderWindowMaxBars: 3800 },
  "4h": { startMaxBars: 6000, retainMaxBars: 8000, renderWindowMaxBars: 3400 },
  D: { startMaxBars: 6000, retainMaxBars: 8000, renderWindowMaxBars: 3200 },
  W: { startMaxBars: 6000, retainMaxBars: 8000, renderWindowMaxBars: 2600 },
};

const STRATEGY_COLORS = {
  rayalgo: RAYALGO_BULL,
  momentum_breakout: "#0891b2",
  sweep_reversal: "#ca8a04",
  vwap_extreme: "#0f766e",
  ema_stack: "#2563eb",
  bb_squeeze: "#b45309",
};

function resolveChartVisualTheme(strategy) {
  const normalizedStrategy = String(strategy || "").trim().toLowerCase();
  if (normalizedStrategy === "rayalgo") {
    return {
      bull: RAYALGO_BULL,
      bear: RAYALGO_BEAR,
      signalBuy: RAYALGO_BULL,
      shadeBull: RAYALGO_BULL,
      shadeBear: RAYALGO_BEAR,
      volumeBull: RAYALGO_BULL_VOLUME,
      volumeBear: RAYALGO_BEAR_VOLUME,
      zoneBull: {
        border: withAlpha(RAYALGO_BULL, 0.72),
        background: withAlpha(RAYALGO_BULL, 0.14),
        innerBorder: withAlpha("#082f49", 0.16),
        labelColor: "#082f49",
        labelBackground: withAlpha("#e0f2fe", 0.92),
      },
      zoneBear: {
        border: withAlpha(RAYALGO_BEAR, 0.72),
        background: withAlpha(RAYALGO_BEAR, 0.14),
        innerBorder: withAlpha("#500724", 0.16),
        labelColor: "#500724",
        labelBackground: withAlpha("#fce7f3", 0.92),
      },
      gapBull: {
        border: withAlpha(RAYALGO_BULL, 0.5),
        background: withAlpha(RAYALGO_BULL, 0.08),
        innerBorder: withAlpha("#082f49", 0.1),
        labelColor: "#164e63",
        labelBackground: withAlpha("#ecfeff", 0.88),
      },
      gapBear: {
        border: withAlpha(RAYALGO_BEAR, 0.5),
        background: withAlpha(RAYALGO_BEAR, 0.08),
        innerBorder: withAlpha("#831843", 0.1),
        labelColor: "#831843",
        labelBackground: withAlpha("#fdf2f8", 0.88),
      },
    };
  }
  return {
    bull: BULL,
    bear: BEAR,
    signalBuy: SIGNAL_BUY,
    shadeBull: SHADE_BULL,
    shadeBear: SHADE_BEAR,
    volumeBull: "rgba(34,197,94,0.28)",
    volumeBear: "rgba(239,68,68,0.28)",
    zoneBull: {
      border: withAlpha(BULL, 0.58),
      background: withAlpha("#14b8a6", 0.07),
      innerBorder: withAlpha("#164e63", 0.14),
      labelColor: "#082f49",
      labelBackground: withAlpha("#e0f2fe", 0.88),
    },
    zoneBear: {
      border: withAlpha(BEAR, 0.58),
      background: withAlpha("#f43f5e", 0.07),
      innerBorder: withAlpha("#881337", 0.14),
      labelColor: "#4c0519",
      labelBackground: withAlpha("#ffe4e6", 0.88),
    },
    gapBull: {
      border: withAlpha("#38bdf8", 0.58),
      background: withAlpha("#38bdf8", 0.09),
      innerBorder: withAlpha("#164e63", 0.14),
      labelColor: "#082f49",
      labelBackground: withAlpha("#e0f2fe", 0.88),
    },
    gapBear: {
      border: withAlpha("#fb7185", 0.58),
      background: withAlpha("#fb7185", 0.09),
      innerBorder: withAlpha("#881337", 0.14),
      labelColor: "#4c0519",
      labelBackground: withAlpha("#ffe4e6", 0.88),
    },
  };
}

function renderWindowMatches(left, right) {
  return renderWindowMatchesUtil(left, right);
}

function buildRenderWindowSignature(renderWindow, barCount = 0) {
  return buildRenderWindowSignatureUtil(renderWindow, barCount);
}

function clampVisibleLogicalRange(range, barCount) {
  return clampVisibleLogicalRangeUtil(range, barCount, MAX_RIGHT_VIEWPORT_WHITESPACE_BARS);
}

function toVisibleBarIndexRange(range, barCount, overscan = 0) {
  return toVisibleBarIndexRangeUtil(
    range,
    barCount,
    overscan,
    MAX_RIGHT_VIEWPORT_WHITESPACE_BARS,
  );
}

function resolveVisibleRangeRightPaddingBars(range, barCount) {
  return resolveVisibleRangeRightPaddingBarsUtil(
    range,
    barCount,
    MAX_RIGHT_VIEWPORT_WHITESPACE_BARS,
  );
}

function buildRenderWindowSpec(range, barCount, maxWindowBars = null) {
  return buildRenderWindowSpecUtil(range, barCount, {
    clampVisibleLogicalRangeFn: clampVisibleLogicalRange,
    maxWindowBars,
    minBars: RENDER_WINDOW_MIN_BARS,
    minEdgeBars: RENDER_WINDOW_MIN_EDGE_BARS,
    overscanMultiplier: RENDER_WINDOW_OVERSCAN_MULTIPLIER,
  });
}

function resolveBaseSeriesModeLimits(rangePresetKey = "", allowFullIntervalSeries = false) {
  if (allowFullIntervalSeries) {
    return {
      startMaxBars: MANUAL_FULL_INTERVAL_MAX_BARS,
      retainMaxBars: MANUAL_FULL_INTERVAL_MAX_BARS,
      renderWindowMaxBars: MANUAL_FULL_INTERVAL_MAX_BARS,
    };
  }
  return resolveBaseSeriesModeLimitsUtil(rangePresetKey, FULL_SERIES_MODE_LIMITS_BY_TF, {
    startMaxBars: FULL_SERIES_DIRECT_MAX_BARS,
    retainMaxBars: 8000,
    renderWindowMaxBars: 8000,
  });
}

function resolveBaseSeriesMode(barCount, currentMode = "empty", limits = null) {
  return resolveBaseSeriesModeUtil(barCount, currentMode, limits, {
    fullSeriesDirectMaxBars: FULL_SERIES_DIRECT_MAX_BARS,
    fullBaseDataCacheMaxBars: FULL_BASE_DATA_CACHE_MAX_BARS,
  });
}

function baseSeriesModeUsesRenderWindow(mode) {
  return baseSeriesModeUsesRenderWindowUtil(mode);
}

function resolveActiveBarCap(mode, limits, barCount) {
  return resolveActiveBarCapUtil(mode, limits, barCount, RENDER_WINDOW_MIN_BARS);
}

function shouldRefreshRenderWindow(currentWindow, targetRange, barCount, maxWindowBars = null) {
  return shouldRefreshRenderWindowUtil(currentWindow, targetRange, barCount, {
    buildRenderWindowSpecFn: buildRenderWindowSpec,
    maxWindowBars,
    resizeThreshold: RENDER_WINDOW_RESIZE_THRESHOLD,
  });
}

function globalToLocalLogicalRange(range, renderWindow, barCount) {
  return globalToLocalLogicalRangeUtil(
    range,
    renderWindow,
    barCount,
    clampVisibleLogicalRange,
  );
}

function localToGlobalLogicalRange(range, renderWindow, barCount) {
  return localToGlobalLogicalRangeUtil(
    range,
    renderWindow,
    barCount,
    clampVisibleLogicalRange,
  );
}

function toChartTime(bar) {
  const time = Number(bar?.time);
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function normalizeChartTime(time) {
  if (typeof time === "number") {
    return time;
  }
  if (typeof time === "string") {
    const epochMs = Date.parse(`${time}T00:00:00Z`);
    return Number.isFinite(epochMs) ? Math.floor(epochMs / 1000) : null;
  }
  if (time && typeof time === "object") {
    const year = Number(time.year);
    const month = Number(time.month);
    const day = Number(time.day);
    if ([year, month, day].every(Number.isFinite)) {
      return Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0, 0) / 1000);
    }
  }
  return null;
}

function buildBarSignature(chartBars = []) {
  if (!Array.isArray(chartBars) || !chartBars.length) {
    return "empty";
  }
  const formatBarValue = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(6) : "na";
  };
  const lastIndex = chartBars.length - 1;
  const sampleIndexes = Array.from(new Set([
    0,
    Math.floor(lastIndex * 0.25),
    Math.floor(lastIndex * 0.5),
    Math.floor(lastIndex * 0.75),
    lastIndex,
  ]));
  return [
    chartBars.length,
    ...sampleIndexes.map((index) => {
      const bar = chartBars[index] || {};
      return [
        index,
        Number(bar?.time) || 0,
        formatBarValue(bar?.o),
        formatBarValue(bar?.h),
        formatBarValue(bar?.l),
        formatBarValue(bar?.c),
        formatBarValue(bar?.v),
      ].join(":");
    }),
  ].join("|");
}

function buildTimeBoundsSignature(timeBounds = null) {
  if (!timeBounds) {
    return "empty";
  }
  return [
    Number(timeBounds?.startMs) || 0,
    Number(timeBounds?.endMs) || 0,
  ].join(":");
}

function buildLogicalRangeSignature(range = null) {
  if (!range) {
    return "empty";
  }
  const from = Number(range?.from);
  const to = Number(range?.to);
  return [
    Number.isFinite(from) ? from.toFixed(2) : "na",
    Number.isFinite(to) ? to.toFixed(2) : "na",
  ].join(":");
}

function buildHiddenVolumeData(volumeData = []) {
  if (!Array.isArray(volumeData) || !volumeData.length) {
    return [];
  }
  return volumeData.map((entry) => ({
    ...entry,
    color: "rgba(0,0,0,0)",
  }));
}

function logicalRangesMatch(left = null, right = null, tolerance = 0.01) {
  if (!left || !right) {
    return false;
  }
  const leftFrom = Number(left?.from);
  const leftTo = Number(left?.to);
  const rightFrom = Number(right?.from);
  const rightTo = Number(right?.to);
  if (![leftFrom, leftTo, rightFrom, rightTo].every(Number.isFinite)) {
    return false;
  }
  const threshold = Math.max(0, Number(tolerance) || 0);
  return Math.abs(leftFrom - rightFrom) <= threshold && Math.abs(leftTo - rightTo) <= threshold;
}

function resolveTimeBoundsOverlapRatio(chartBarRanges, timeBounds) {
  if (!Array.isArray(chartBarRanges) || !chartBarRanges.length) {
    return 0;
  }
  const startMs = Number(timeBounds?.startMs);
  const endMs = Number(timeBounds?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  const domainStart = Number(chartBarRanges[0]?.startMs);
  const domainEnd = Number(chartBarRanges[chartBarRanges.length - 1]?.endMs);
  if (!Number.isFinite(domainStart) || !Number.isFinite(domainEnd) || domainEnd <= domainStart) {
    return 0;
  }
  const overlapStart = Math.max(startMs, domainStart);
  const overlapEnd = Math.min(endMs, domainEnd);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  return overlapMs / Math.max(1, endMs - startMs);
}

function resolveBoundaryBarIndexForVisibleRange(chartBarRanges, targetMs, side = "start") {
  if (!Array.isArray(chartBarRanges) || !chartBarRanges.length) {
    return null;
  }
  const target = Number(targetMs);
  if (!Number.isFinite(target)) {
    return null;
  }
  if (side === "end") {
    for (let index = chartBarRanges.length - 1; index >= 0; index -= 1) {
      const barStartMs = Number(chartBarRanges[index]?.startMs);
      if (Number.isFinite(barStartMs) && barStartMs <= target) {
        return index;
      }
    }
    return 0;
  }
  for (let index = 0; index < chartBarRanges.length; index += 1) {
    const barEndMs = Number(chartBarRanges[index]?.endMs);
    if (Number.isFinite(barEndMs) && barEndMs > target) {
      return index;
    }
  }
  return chartBarRanges.length - 1;
}

function resolveVisibleLogicalRangeFromTimeBounds(chartBarRanges, timeBounds) {
  if (!Array.isArray(chartBarRanges) || !chartBarRanges.length) {
    return null;
  }
  const startMs = Number(timeBounds?.startMs);
  const endMs = Number(timeBounds?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  const startIndex = resolveBoundaryBarIndexForVisibleRange(chartBarRanges, startMs, "start");
  const endIndex = resolveBoundaryBarIndexForVisibleRange(chartBarRanges, Math.max(startMs, endMs - 1), "end");
  if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) {
    return null;
  }

  return clampVisibleLogicalRange({
    from: startIndex - 0.5,
    to: endIndex + 0.5,
  }, chartBarRanges.length);
}

function getNowMs() {
  return Date.now();
}

function buildVisibleTimeBounds(visibleRange = null, chartBarRanges = []) {
  if (!visibleRange || !Array.isArray(chartBarRanges) || !chartBarRanges.length) {
    return null;
  }
  const from = Math.max(0, Math.floor(Number(visibleRange?.from) || 0));
  const to = Math.max(from, Math.ceil(Number(visibleRange?.to) || from));
  const boundedFrom = Math.min(chartBarRanges.length - 1, from);
  const boundedTo = Math.min(chartBarRanges.length - 1, to);
  const startMs = Number(chartBarRanges[boundedFrom]?.startMs);
  const endMs = Number(chartBarRanges[boundedTo]?.endMs ?? chartBarRanges[boundedTo]?.startMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return {
    startMs,
    endMs,
  };
}

function sliceStudySpecs(specs = [], renderWindow = null) {
  if (!renderWindow) {
    return Array.isArray(specs) ? specs : [];
  }
  const start = Math.max(0, Number(renderWindow.start) || 0);
  const end = Math.max(start, Number(renderWindow.end) || start);
  return (Array.isArray(specs) ? specs : []).map((spec) => ({
    ...spec,
    data: Array.isArray(spec?.data) ? spec.data.slice(start, end + 1) : [],
  }));
}

const PRESENTATION_BUCKET_SIZE = 48;

function createEmptyIndexedCollection() {
  return {
    bucketSize: PRESENTATION_BUCKET_SIZE,
    buckets: new Map(),
    count: 0,
  };
}

function buildIndexedCollection(items = [], getRange = null) {
  const buckets = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const range = typeof getRange === "function" ? getRange(item) : null;
    const start = Math.max(0, Math.floor(Number(range?.from) || 0));
    const end = Math.max(start, Math.floor(Number(range?.to) || start));
    const fromBucket = Math.floor(start / PRESENTATION_BUCKET_SIZE);
    const toBucket = Math.floor(end / PRESENTATION_BUCKET_SIZE);
    for (let bucketKey = fromBucket; bucketKey <= toBucket; bucketKey += 1) {
      const current = buckets.get(bucketKey) || [];
      current.push(item);
      buckets.set(bucketKey, current);
    }
  }
  return {
    bucketSize: PRESENTATION_BUCKET_SIZE,
    buckets,
    count: Array.isArray(items) ? items.length : 0,
  };
}

function buildChartRuntimeSignature(runtime = {}) {
  return [
    runtime?.status || "",
    runtime?.reason || "",
    runtime?.message || "",
    Number(runtime?.loadedBarCount) || 0,
    Number(runtime?.activeBarCount) || 0,
    Number(runtime?.activeBarCap) || 0,
    runtime?.baseDataMode || "",
    Number(runtime?.baseSeriesWindowSwapCount) || 0,
  ].join("|");
}

function buildSelectedTradeOverlaySignature(payload = {}) {
  if (!payload?.visible) {
    return "hidden";
  }
  return [
    Math.round(Number(payload?.entryAnchorX) || 0),
    Math.round(Number(payload?.entryAnchorY) || 0),
    Math.round(Number(payload?.entryBadgeLeft) || 0),
    Math.round(Number(payload?.entryBadgeTop) || 0),
    String(payload?.entryLabel || ""),
    Math.round(Number(payload?.exitAnchorX) || 0),
    Math.round(Number(payload?.exitAnchorY) || 0),
    Math.round(Number(payload?.exitBadgeLeft) || 0),
    Math.round(Number(payload?.exitBadgeTop) || 0),
    String(payload?.exitLabel || ""),
    String(payload?.tradePath || ""),
    String(payload?.entryLeaderPath || ""),
    String(payload?.exitLeaderPath || ""),
    String(payload?.thresholdSignature || "none"),
  ].join("|");
}

function clampTradeSelectionPickerPosition(point, viewport, itemCount = 1) {
  const viewportWidth = Number(viewport?.width);
  const viewportHeight = Number(viewport?.height);
  const pointX = Number(point?.x);
  const pointY = Number(point?.y);
  const resolvedItemCount = Math.max(1, Number(itemCount) || 1);
  const estimatedHeight = TRADE_SELECTION_PICKER_BASE_HEIGHT_PX + (resolvedItemCount * TRADE_SELECTION_PICKER_ROW_HEIGHT_PX);
  const fallbackLeft = TRADE_SELECTION_PICKER_EDGE_PADDING_PX;
  const fallbackTop = TRADE_SELECTION_PICKER_EDGE_PADDING_PX;
  const maxPickerHeight = Number.isFinite(viewportHeight)
    ? Math.max(160, viewportHeight - (TRADE_SELECTION_PICKER_EDGE_PADDING_PX * 2))
    : Math.max(160, estimatedHeight);
  const left = Number.isFinite(viewportWidth)
    ? Math.max(
      TRADE_SELECTION_PICKER_EDGE_PADDING_PX,
      Math.min(
        Number.isFinite(pointX) ? pointX + TRADE_SELECTION_PICKER_OFFSET_PX : fallbackLeft,
        viewportWidth - TRADE_SELECTION_PICKER_WIDTH_PX - TRADE_SELECTION_PICKER_EDGE_PADDING_PX,
      ),
    )
    : (Number.isFinite(pointX) ? pointX + TRADE_SELECTION_PICKER_OFFSET_PX : fallbackLeft);
  const top = Number.isFinite(viewportHeight)
    ? Math.max(
      TRADE_SELECTION_PICKER_EDGE_PADDING_PX,
      Math.min(
        Number.isFinite(pointY) ? pointY + TRADE_SELECTION_PICKER_OFFSET_PX : fallbackTop,
        viewportHeight - Math.min(maxPickerHeight, estimatedHeight) - TRADE_SELECTION_PICKER_EDGE_PADDING_PX,
      ),
    )
    : (Number.isFinite(pointY) ? pointY + TRADE_SELECTION_PICKER_OFFSET_PX : fallbackTop);
  return {
    left,
    top,
    maxHeight: maxPickerHeight,
  };
}

function collectIndexedItems(indexedCollection, visibleBarRange, itemKeyResolver = null) {
  if (!visibleBarRange) {
    const allItems = [];
    for (const items of indexedCollection?.buckets?.values?.() || []) {
      allItems.push(...items);
    }
    return allItems;
  }
  const bucketSize = Number(indexedCollection?.bucketSize) || PRESENTATION_BUCKET_SIZE;
  const fromBucket = Math.max(0, Math.floor(visibleBarRange.from / bucketSize));
  const toBucket = Math.max(fromBucket, Math.floor(visibleBarRange.to / bucketSize));
  const nextItems = [];
  const seen = new Set();
  for (let bucketKey = fromBucket; bucketKey <= toBucket; bucketKey += 1) {
    const items = indexedCollection?.buckets?.get?.(bucketKey) || [];
    for (const item of items) {
      const itemKey = typeof itemKeyResolver === "function" ? itemKeyResolver(item) : null;
      if (itemKey && seen.has(itemKey)) {
        continue;
      }
      if (itemKey) {
        seen.add(itemKey);
      }
      nextItems.push(item);
    }
  }
  return nextItems;
}

function formatPrice(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }
  return `$${numeric.toFixed(clampPricePrecision(precision, 2))}`;
}

function clampPricePrecision(value, fallback = 2) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(6, numeric));
}

function createCurrencyFormatter(precision = 2) {
  const resolvedPrecision = clampPricePrecision(precision, 2);
  return (value) => `$${Number(value).toFixed(resolvedPrecision)}`;
}

function formatVolume(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "—";
  }
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(2)}M`;
  }
  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(numeric)}`;
}

function formatOverlayTradeLabel(overlay) {
  const side = overlay?.dir === "short" ? "Short" : "Long";
  const strategyLabel = getStrategyLabel(String(overlay?.strat || "").trim() || DEFAULT_RESEARCH_STRATEGY);
  const qty = Number.isFinite(Number(overlay?.qty)) ? Number(overlay.qty) : 0;
  return `${side} ${strategyLabel} x${qty}`;
}

function resolveOverlayEntryExecutionPrice(overlay) {
  const entryPrice = Number(overlay?.oe);
  return Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : null;
}

function resolveOverlayEntryPrice(overlay) {
  const displayPrice = Number(overlay?.entryPrice);
  if (Number.isFinite(displayPrice) && displayPrice > 0) {
    return displayPrice;
  }
  return resolveOverlayEntryExecutionPrice(overlay);
}

function resolveOverlayExitExecutionPrice(overlay) {
  const exitFill = Number(overlay?.exitFill);
  if (Number.isFinite(exitFill) && exitFill >= 0) {
    return exitFill;
  }
  const exitMark = Number(overlay?.ep);
  return Number.isFinite(exitMark) && exitMark >= 0 ? exitMark : null;
}

function resolveOverlayExitPrice(overlay) {
  const displayPrice = Number(overlay?.exitPrice);
  if (Number.isFinite(displayPrice) && displayPrice >= 0) {
    return displayPrice;
  }
  return resolveOverlayExitExecutionPrice(overlay);
}

function formatTradeOutcomeDetail(overlay, pricePrecision = 2) {
  if (!overlay) {
    return "";
  }
  const parts = [];
  const epsilon = 1 / (10 ** clampPricePrecision(pricePrecision, 2));
  const entryPrice = resolveOverlayEntryPrice(overlay);
  if (Number.isFinite(entryPrice)) {
    parts.push(`In ${formatPrice(entryPrice, pricePrecision)}`);
  }
  const entryFill = resolveOverlayEntryExecutionPrice(overlay);
  if (Number.isFinite(entryFill) && (!Number.isFinite(entryPrice) || Math.abs(entryFill - entryPrice) > epsilon)) {
    parts.push(`Entry fill ${formatPrice(entryFill, pricePrecision)}`);
  }
  const exitPrice = resolveOverlayExitPrice(overlay);
  if (Number.isFinite(exitPrice)) {
    parts.push(`Out ${formatPrice(exitPrice, pricePrecision)}`);
  }
  const exitFill = resolveOverlayExitExecutionPrice(overlay);
  if (Number.isFinite(exitFill) && (!Number.isFinite(exitPrice) || Math.abs(exitFill - exitPrice) > epsilon)) {
    parts.push(`Exit fill ${formatPrice(exitFill, pricePrecision)}`);
  }
  if (Number.isFinite(Number(overlay.pnl))) {
    const pnl = Number(overlay.pnl);
    parts.push(`P&L ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`);
  }
  if (overlay?.er) {
    parts.push(String(overlay.er).replace(/_/g, " "));
  }
  return parts.join(" · ");
}

function formatSignedCurrency(value, precision = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }
  const resolvedPrecision = clampPricePrecision(precision, 2);
  return `${numeric >= 0 ? "+" : "-"}$${Math.abs(numeric).toFixed(resolvedPrecision)}`;
}

function formatTradeEntryBadgeLabel(overlay, pricePrecision = 2) {
  const entryPrice = resolveOverlayEntryPrice(overlay);
  if (Number.isFinite(entryPrice)) {
    return formatPrice(entryPrice, pricePrecision);
  }
  return "Entry";
}

function formatTradeExitBadgeLabel(overlay, pricePrecision = 2) {
  const exitPrice = resolveOverlayExitPrice(overlay);
  const exitPriceLabel = Number.isFinite(exitPrice) ? formatPrice(exitPrice, pricePrecision) : "Exit";
  if (Number.isFinite(Number(overlay?.pnl))) {
    return `${exitPriceLabel} · ${formatSignedCurrency(overlay.pnl, 2)}`;
  }
  return exitPriceLabel;
}

function formatTradeExitReason(overlay) {
  const raw = String(overlay?.er || "").trim();
  if (!raw) {
    return "—";
  }
  return raw.replace(/_/g, " ");
}

function resolveFiniteThresholdPrice(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function buildTradeThresholdLineDescriptors(overlay, pricePrecision = 2) {
  if (!overlay) {
    return [];
  }
  const epsilon = 1 / (10 ** clampPricePrecision(pricePrecision, 2));
  const descriptors = [];
  const pushDescriptor = (id, label, value, color, style = "dashed") => {
    const numericValue = resolveFiniteThresholdPrice(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }
    if (descriptors.some((descriptor) => Math.abs(descriptor.value - numericValue) <= epsilon)) {
      return;
    }
    descriptors.push({ id, label, value: numericValue, color, style });
  };

  pushDescriptor("take-profit", "TP", overlay?.takeProfitPrice, BULL, "dashed");
  pushDescriptor("stop-loss", "SL", overlay?.stopLossPrice, BEAR, "dashed");
  pushDescriptor("trail-arm", "ARM", overlay?.trailActivationPrice, "#d97706", "dotted");
  pushDescriptor("trail-stop", "TRAIL", overlay?.lastTrailStopPrice, "#b45309", "solid");
  pushDescriptor("exit-trigger", "EXIT", overlay?.exitTriggerPrice, ACCENT, "solid");

  return descriptors;
}

function buildTradeThresholdSummary(overlay, pricePrecision = 2) {
  if (!overlay) {
    return "";
  }
  const takeProfit = resolveFiniteThresholdPrice(overlay?.takeProfitPrice);
  const stopLoss = resolveFiniteThresholdPrice(overlay?.stopLossPrice);
  const trail = resolveFiniteThresholdPrice(overlay?.lastTrailStopPrice)
    ?? resolveFiniteThresholdPrice(overlay?.trailActivationPrice);
  const parts = [
    Number.isFinite(takeProfit) ? `TP ${formatPrice(takeProfit, pricePrecision)}` : null,
    Number.isFinite(stopLoss) ? `SL ${formatPrice(stopLoss, pricePrecision)}` : null,
    Number.isFinite(trail)
      ? `${Number.isFinite(resolveFiniteThresholdPrice(overlay?.lastTrailStopPrice)) ? "Trail" : "Arm"} ${formatPrice(trail, pricePrecision)}`
      : null,
  ].filter(Boolean);
  return parts.length ? `Opt ${parts.join(" · ")}` : "";
}

function buildTradeThresholdSignature(lines = []) {
  if (!Array.isArray(lines) || !lines.length) {
    return "none";
  }
  return lines
    .map((line) => [
      line?.id || "",
      Math.round(Number(line?.left) || 0),
      Math.round(Number(line?.top) || 0),
      Math.round(Number(line?.width) || 0),
      String(line?.label || ""),
      String(line?.style || "solid"),
      String(line?.color || ""),
      Math.round((Number(line?.strokeWidth) || 0) * 100),
      Math.round((Number(line?.opacity) || 0) * 1000),
    ].join(":"))
    .join("|");
}

function resolveTradeThresholdLineVisual(segment = {}) {
  const kind = String(segment?.kind || "").trim().toLowerCase();
  if (kind === "take_profit") {
    return { color: BULL, style: "dashed", opacity: segment.hit ? 0.92 : 0.82, strokeWidth: segment.hit ? 2 : 1 };
  }
  if (kind === "stop_loss") {
    return { color: BEAR, style: "dashed", opacity: segment.hit ? 0.92 : 0.82, strokeWidth: segment.hit ? 2 : 1 };
  }
  if (kind === "trail_arm") {
    return { color: "#d97706", style: "dotted", opacity: 0.72, strokeWidth: 1 };
  }
  if (kind === "trail_stop") {
    return { color: segment.hit ? ACCENT : "#b45309", style: "solid", opacity: segment.hit ? 0.88 : 0.82, strokeWidth: segment.hit ? 2 : 1.25 };
  }
  if (kind === "exit_trigger") {
    return { color: ACCENT, style: "solid", opacity: 0.8, strokeWidth: 2 };
  }
  return { color: ACCENT, style: "solid", opacity: 0.82, strokeWidth: 1 };
}

function buildTradeThresholdLinesFromPath({
  overlay = null,
  chart = null,
  chartBars = [],
  paneBounds = null,
  candleSeries = null,
  viewportHeight = 0,
  pricePrecision = 2,
} = {}) {
  const segments = Array.isArray(overlay?.thresholdPath?.segments) ? overlay.thresholdPath.segments : [];
  if (!overlay || !chart || !candleSeries || !segments.length || !Array.isArray(chartBars) || !chartBars.length) {
    return [];
  }
  const freshestEndX = estimateZoneEndCoordinate(chart, chartBars, chartBars.length - 1);
  const lines = [];
  for (const segment of segments) {
    const startBarIndex = Number.isInteger(segment?.startBarIndex)
      ? Math.max(0, Math.min(chartBars.length - 1, segment.startBarIndex))
      : null;
    const endBarIndex = Number.isInteger(segment?.endBarIndex)
      ? Math.max(0, Math.min(chartBars.length - 1, segment.endBarIndex))
      : startBarIndex;
    if (startBarIndex == null || endBarIndex == null) {
      continue;
    }
    const startX = estimateBarStartCoordinate(chart, chartBars, startBarIndex);
    const endX = resolveWindowEndCoordinate(chart, chartBars, { endBarIndex });
    const boundedEndX = Number.isFinite(endX) && Number.isFinite(freshestEndX)
      ? Math.min(endX, freshestEndX)
      : (Number.isFinite(endX) ? endX : freshestEndX);
    const clampedRect = clampOverlayRectToBounds(startX, boundedEndX, paneBounds);
    if (!clampedRect) {
      continue;
    }
    const y = candleSeries.priceToCoordinate(segment.value);
    if (!Number.isFinite(y) || y < 0 || y > viewportHeight) {
      continue;
    }
    const visual = resolveTradeThresholdLineVisual(segment);
    const valueLabel = formatPrice(segment.value, pricePrecision);
    const segmentLabel = String(segment?.label || "").trim();
    lines.push({
      id: String(overlay?.tradeSelectionId || overlay?.id || "trade") + ":" + String(segment?.id || segment?.kind || "threshold"),
      left: clampedRect.left,
      top: y,
      width: clampedRect.width,
      label: segmentLabel ? segmentLabel + " " + valueLabel : "",
      title: formatOverlayTradeLabel(overlay) + " · " + (segmentLabel ? segmentLabel + " " + valueLabel : valueLabel),
      color: visual.color,
      style: visual.style,
      opacity: visual.opacity,
      strokeWidth: visual.strokeWidth,
    });
  }
  return lines;
}

function formatOverlayExpiryDate(overlay) {
  const raw = String(overlay?.expiryDate || "").trim();
  if (!raw) {
    return "—";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return formatMarketDateLabel(raw);
  }
  const normalized = new Date(raw);
  if (Number.isNaN(normalized.getTime())) {
    return raw;
  }
  return normalized.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function formatOverlayEntryIv(overlay) {
  const numeric = Number(overlay?.entryIV);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "—";
  }
  return `${(numeric * 100).toFixed(0)}%`;
}

function resolveOverlayHoldBars(overlay) {
  const entryBarIndex = Number(overlay?.entryBarIndex);
  const exitBarIndex = Number(overlay?.exitBarIndex);
  if (!Number.isFinite(entryBarIndex) || !Number.isFinite(exitBarIndex)) {
    return null;
  }
  return Math.max(1, Math.round(exitBarIndex - entryBarIndex + 1));
}

function withAlpha(hexColor, alpha = 1) {
  const color = String(hexColor || "").trim();
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return color;
  }
  const numericAlpha = Math.max(0, Math.min(1, Number(alpha)));
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${numericAlpha})`;
}

function getStrategyOverlayColor(strategy) {
  return STRATEGY_COLORS[String(strategy || "").trim().toLowerCase()] || ACCENT;
}

function estimateBarStartCoordinate(chart, chartBars, barIndex) {
  const currentTime = toChartTime(chartBars[barIndex]);
  const currentX = chart.timeScale().timeToCoordinate(currentTime);
  if (!Number.isFinite(currentX)) {
    return null;
  }
  const previousTime = toChartTime(chartBars[barIndex - 1]);
  const previousX = previousTime != null ? chart.timeScale().timeToCoordinate(previousTime) : null;
  if (Number.isFinite(previousX)) {
    return (previousX + currentX) / 2;
  }
  const nextTime = toChartTime(chartBars[barIndex + 1]);
  const nextX = nextTime != null ? chart.timeScale().timeToCoordinate(nextTime) : null;
  if (Number.isFinite(nextX)) {
    return currentX - Math.max(6, (nextX - currentX) / 2);
  }
  return currentX - 6;
}

function estimateZoneEndCoordinate(chart, chartBars, endBarIndex) {
  const currentTime = toChartTime(chartBars[endBarIndex]);
  const nextTime = toChartTime(chartBars[endBarIndex + 1]);
  const currentX = chart.timeScale().timeToCoordinate(currentTime);
  if (!Number.isFinite(currentX)) {
    return null;
  }
  const nextX = nextTime != null ? chart.timeScale().timeToCoordinate(nextTime) : null;
  if (Number.isFinite(nextX)) {
    return (currentX + nextX) / 2;
  }
  const previousTime = toChartTime(chartBars[endBarIndex - 1]);
  const previousX = previousTime != null ? chart.timeScale().timeToCoordinate(previousTime) : null;
  if (Number.isFinite(previousX)) {
    return currentX + Math.max(6, (currentX - previousX) / 2);
  }
  return currentX + 6;
}

function resolveWindowEndCoordinate(chart, chartBars, indicatorWindow) {
  if (!indicatorWindow || indicatorWindow.endBarIndex == null) {
    return null;
  }
  return estimateZoneEndCoordinate(chart, chartBars, indicatorWindow.endBarIndex);
}

function resolvePanePlotBounds(chart, overlayHost = null) {
  if (!chart) {
    return null;
  }
  const paneSize = typeof chart.paneSize === "function" ? chart.paneSize(0) : null;
  const paneWidth = Number(paneSize?.width);
  const paneHeight = Number(paneSize?.height);
  const hostWidth = Number(overlayHost?.clientWidth);
  const hostHeight = Number(overlayHost?.clientHeight);
  const width = Number.isFinite(paneWidth) && paneWidth > 0
    ? paneWidth
    : (Number.isFinite(hostWidth) && hostWidth > 0 ? hostWidth : null);
  const height = Number.isFinite(paneHeight) && paneHeight > 0
    ? paneHeight
    : (Number.isFinite(hostHeight) && hostHeight > 0 ? hostHeight : null);
  if (!Number.isFinite(width) || width <= 0) {
    return null;
  }
  return {
    left: 0,
    right: width,
    width,
    height: Number.isFinite(height) && height > 0 ? height : null,
  };
}

function clampOverlayRectToBounds(startX, endX, bounds) {
  if (![startX, endX].every(Number.isFinite) || !bounds) {
    return null;
  }
  const left = Math.max(Number(bounds.left) || 0, Math.min(startX, endX));
  const right = Math.min(Number(bounds.right) || 0, Math.max(startX, endX));
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
    return null;
  }
  return {
    left,
    width: Math.max(1, right - left),
  };
}

function clampOverlayBoxToBounds(startX, endX, topY, bottomY, bounds) {
  if (![startX, endX, topY, bottomY].every(Number.isFinite) || !bounds) {
    return null;
  }
  const horizontal = clampOverlayRectToBounds(startX, endX, bounds);
  const maxHeight = Number(bounds?.height);
  if (!horizontal || !Number.isFinite(maxHeight) || maxHeight <= 0) {
    return null;
  }
  const top = Math.max(0, Math.min(topY, bottomY));
  const bottom = Math.min(maxHeight, Math.max(topY, bottomY));
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) {
    return null;
  }
  return {
    ...horizontal,
    top,
    height: Math.max(1, bottom - top),
  };
}

function computeEma(values, period) {
  if (!values.length) {
    return [];
  }
  const alpha = 2 / (period + 1);
  let current = values[0];
  return values.map((value) => {
    current = alpha * value + (1 - alpha) * current;
    return current;
  });
}

function buildValueSeries(bars, values) {
  return bars
    .map((bar, index) => {
      const time = toChartTime(bar);
      const value = Number(values[index]);
      if (!Number.isFinite(time) || !Number.isFinite(value)) {
        return null;
      }
      return { time, value };
    })
    .filter(Boolean);
}

function computeVwapBands(bars) {
  const vwap = new Float64Array(bars.length);
  const upperOne = new Float64Array(bars.length);
  const lowerOne = new Float64Array(bars.length);
  const upperTwo = new Float64Array(bars.length);
  const lowerTwo = new Float64Array(bars.length);

  let cumulativeTpv = 0;
  let cumulativeVolume = 0;
  let cumulativeTpvSquared = 0;
  let previousDate = "";

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.date !== previousDate) {
      cumulativeTpv = 0;
      cumulativeVolume = 0;
      cumulativeTpvSquared = 0;
      previousDate = bar.date;
    }

    const typicalPrice = (bar.h + bar.l + bar.c) / 3;
    const volume = Math.max(1, Number(bar.v) || 0);
    cumulativeTpv += typicalPrice * volume;
    cumulativeVolume += volume;
    cumulativeTpvSquared += typicalPrice * typicalPrice * volume;

    const currentVwap = cumulativeTpv / cumulativeVolume;
    const variance = Math.max(0, cumulativeTpvSquared / cumulativeVolume - currentVwap * currentVwap);
    const deviation = Math.sqrt(variance);

    vwap[index] = currentVwap;
    upperOne[index] = currentVwap + 1.5 * deviation;
    lowerOne[index] = currentVwap - 1.5 * deviation;
    upperTwo[index] = currentVwap + 2.5 * deviation;
    lowerTwo[index] = currentVwap - 2.5 * deviation;
  }

  return { vwap, upperOne, lowerOne, upperTwo, lowerTwo };
}

function computeBollingerBands(bars) {
  const closes = bars.map((bar) => Number(bar.c));
  const middle = new Float64Array(bars.length);
  const upper = new Float64Array(bars.length);
  const lower = new Float64Array(bars.length);
  const period = 20;

  for (let index = 0; index < bars.length; index += 1) {
    if (index < period - 1) {
      middle[index] = closes[index];
      upper[index] = closes[index];
      lower[index] = closes[index];
      continue;
    }

    let sum = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      sum += closes[cursor];
    }
    const average = sum / period;
    let varianceSum = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      varianceSum += (closes[cursor] - average) ** 2;
    }
    const deviation = Math.sqrt(varianceSum / period);
    middle[index] = average;
    upper[index] = average + 2 * deviation;
    lower[index] = average - 2 * deviation;
  }

  return { middle, upper, lower };
}

function computeMacd(bars) {
  const closes = bars.map((bar) => Number(bar.c));
  const ema12 = computeEma(closes, 12);
  const ema26 = computeEma(closes, 26);
  const line = new Float64Array(bars.length);
  const signal = new Float64Array(bars.length);
  const histogram = new Float64Array(bars.length);

  for (let index = 0; index < bars.length; index += 1) {
    line[index] = ema12[index] - ema26[index];
  }

  const alpha = 2 / 10;
  let signalValue = line[0] || 0;
  for (let index = 0; index < bars.length; index += 1) {
    signalValue = alpha * line[index] + (1 - alpha) * signalValue;
    signal[index] = signalValue;
    histogram[index] = line[index] - signalValue;
  }

  return { line, signal, histogram };
}

function computeSmcMarkers(bars) {
  if (bars.length < 20) {
    return [];
  }

  const highs = bars.map((bar) => Number(bar.h));
  const lows = bars.map((bar) => Number(bar.l));
  const closes = bars.map((bar) => Number(bar.c));
  const opens = bars.map((bar) => Number(bar.o));
  const swingWindow = 8;
  const swingHighs = [];
  const swingLows = [];

  for (let index = swingWindow; index < bars.length - swingWindow; index += 1) {
    let isHigh = true;
    let isLow = true;
    for (let cursor = index - swingWindow; cursor <= index + swingWindow; cursor += 1) {
      if (highs[cursor] > highs[index]) {
        isHigh = false;
      }
      if (lows[cursor] < lows[index]) {
        isLow = false;
      }
    }
    if (isHigh) {
      swingHighs.push({ index, value: highs[index] });
    }
    if (isLow) {
      swingLows.push({ index, value: lows[index] });
    }
  }

  const swingLabels = {};
  let previousHigh = null;
  for (const swingHigh of swingHighs) {
    swingLabels[swingHigh.index] = previousHigh && swingHigh.value <= previousHigh.value ? "LH" : "HH";
    previousHigh = swingHigh;
  }

  let previousLow = null;
  for (const swingLow of swingLows) {
    swingLabels[swingLow.index] = previousLow && swingLow.value > previousLow.value ? "HL" : "LL";
    previousLow = swingLow;
  }

  const structureBreaks = [];
  let trend = 0;
  let priorSwingHigh = null;
  let priorSwingLow = null;
  const swings = swingHighs
    .map((entry) => ({ ...entry, kind: "H" }))
    .concat(swingLows.map((entry) => ({ ...entry, kind: "L" })))
    .sort((left, right) => left.index - right.index);

  for (const swing of swings) {
    if (swing.kind === "H") {
      if (priorSwingHigh && swing.value > priorSwingHigh.value) {
        structureBreaks.push({
          index: swing.index,
          dir: 1,
          label: trend === -1 ? "CH" : "BOS",
        });
        trend = 1;
      }
      priorSwingHigh = swing;
      continue;
    }

    if (priorSwingLow && swing.value < priorSwingLow.value) {
      structureBreaks.push({
        index: swing.index,
        dir: -1,
        label: trend === 1 ? "CH" : "BOS",
      });
      trend = -1;
    }
    priorSwingLow = swing;
  }

  const liquiditySweeps = [];
  for (let index = 15; index < bars.length; index += 1) {
    let recentHigh = -Infinity;
    let recentLow = Infinity;
    for (let cursor = index - 15; cursor < index; cursor += 1) {
      recentHigh = Math.max(recentHigh, highs[cursor]);
      recentLow = Math.min(recentLow, lows[cursor]);
    }
    if (lows[index] < recentLow && closes[index] > recentLow) {
      liquiditySweeps.push({ index, dir: 1 });
    }
    if (highs[index] > recentHigh && closes[index] < recentHigh) {
      liquiditySweeps.push({ index, dir: -1 });
    }
  }

  const markers = [];
  for (const swing of swingHighs.slice(-24)) {
    const time = toChartTime(bars[swing.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-high-${swing.index}`,
      barIndex: swing.index,
      time,
      position: "aboveBar",
      shape: "circle",
      color: "#f59e0b",
      text: swingLabels[swing.index] || "HH",
      size: 0.5,
    });
  }
  for (const swing of swingLows.slice(-24)) {
    const time = toChartTime(bars[swing.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-low-${swing.index}`,
      barIndex: swing.index,
      time,
      position: "belowBar",
      shape: "circle",
      color: "#f59e0b",
      text: swingLabels[swing.index] || "LL",
      size: 0.5,
    });
  }
  for (const event of structureBreaks.slice(-18)) {
    const time = toChartTime(bars[event.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-structure-${event.index}`,
      barIndex: event.index,
      time,
      position: event.dir > 0 ? "aboveBar" : "belowBar",
      shape: event.dir > 0 ? "square" : "square",
      color: event.label === "CH" ? "#ef4444" : "#3b82f6",
      text: event.label,
      size: 0.6,
    });
  }
  for (const sweep of liquiditySweeps.slice(-12)) {
    const time = toChartTime(bars[sweep.index]);
    if (time == null) continue;
    markers.push({
      id: `smc-sweep-${sweep.index}`,
      barIndex: sweep.index,
      time,
      position: sweep.dir > 0 ? "belowBar" : "aboveBar",
      shape: sweep.dir > 0 ? "arrowUp" : "arrowDown",
      color: "#7c3aed",
      text: "SWP",
      size: 0.7,
    });
  }

  return markers;
}

function overlayMatchesStrategy(selectedStrategy, overlayStrategy) {
  const normalizedOverlayStrategy = String(overlayStrategy || "").trim().toLowerCase();
  const effectiveOverlayStrategy = normalizedOverlayStrategy === "all"
    ? DEFAULT_RESEARCH_STRATEGY
    : normalizedOverlayStrategy;
  return effectiveOverlayStrategy === normalizeResearchStrategy(selectedStrategy);
}

function windowMatchesStrategy(selectedStrategy, indicatorWindow) {
  const signalRefs = Array.isArray(indicatorWindow?.signalRefs) ? indicatorWindow.signalRefs : [];
  if (signalRefs.length) {
    return signalRefs.every((signalRef) => overlayMatchesStrategy(selectedStrategy, signalRef?.strategy));
  }
  return overlayMatchesStrategy(selectedStrategy, indicatorWindow?.strategy);
}

function syncTradeThresholdNodes(container, nodeMap, lines) {
  if (!container) {
    return;
  }
  const nextIds = new Set();
  for (const line of Array.isArray(lines) ? lines : []) {
    nextIds.add(line.id);
    let refs = nodeMap.get(line.id) || null;
    if (!refs) {
      const node = document.createElement("div");
      node.style.position = "absolute";
      node.style.height = "0";
      node.style.pointerEvents = "none";
      node.style.overflow = "visible";

      const stroke = document.createElement("div");
      stroke.style.position = "absolute";
      stroke.style.left = "0";
      stroke.style.right = "0";
      stroke.style.top = "0";
      stroke.style.borderTopWidth = "1px";

      const label = document.createElement("div");
      label.style.position = "absolute";
      label.style.right = "0";
      label.style.top = "0";
      label.style.transform = "translateY(-50%)";
      label.style.padding = "1px 6px";
      label.style.borderRadius = "999px";
      label.style.fontFamily = FONT_MONO;
      label.style.fontSize = "10px";
      label.style.fontWeight = "800";
      label.style.whiteSpace = "nowrap";
      label.style.boxShadow = "0 3px 8px rgba(15,23,42,0.08)";

      node.appendChild(stroke);
      node.appendChild(label);
      refs = { node, stroke, label };
      nodeMap.set(line.id, refs);
      container.appendChild(node);
    }

    refs.node.style.display = "block";
    refs.node.style.left = `${line.left}px`;
    refs.node.style.top = `${line.top}px`;
    refs.node.style.width = `${line.width}px`;
    refs.node.title = line.title || "";

    refs.stroke.style.borderTopWidth = line.strokeWidth == null ? "1px" : String(line.strokeWidth) + "px";
    refs.stroke.style.borderTopStyle = line.style === "solid" ? "solid" : line.style === "dotted" ? "dotted" : "dashed";
    refs.stroke.style.borderTopColor = line.color;
    refs.stroke.style.opacity = line.opacity == null ? "1" : String(line.opacity);

    const hasLabel = Boolean(String(line.label || "").trim());
    refs.label.style.display = hasLabel ? "block" : "none";
    refs.label.textContent = hasLabel ? line.label : "";
    refs.label.style.color = line.color;
    refs.label.style.border = `1px solid ${withAlpha(line.color, 0.24)}`;
    refs.label.style.background = withAlpha(line.color, 0.12);
    refs.label.style.maxWidth = `${Math.max(92, Math.round(line.width))}px`;
  }

  for (const [lineId, refs] of nodeMap.entries()) {
    if (nextIds.has(lineId)) {
      continue;
    }
    refs.node.remove();
    nodeMap.delete(lineId);
  }
}

function setTradeActionBadgeNode(node, badge) {
  if (!node) {
    return;
  }
  if (!badge?.visible) {
    node.style.display = "none";
    node.style.visibility = "hidden";
    node.textContent = "";
    node.title = "";
    return;
  }

  node.style.display = "inline-flex";
  node.style.visibility = "visible";
  node.style.transform = "none";
  node.style.left = `${badge.left}px`;
  node.style.top = `${badge.top}px`;
  node.style.color = badge.color;
  node.style.background = badge.background;
  node.style.borderColor = badge.border;
  node.textContent = badge.label;
  node.title = badge.title || "";
}

function setTradeActionConnectorNode(node, connector) {
  if (!node) {
    return;
  }
  if (!connector?.visible) {
    node.style.display = "none";
    node.removeAttribute("d");
    return;
  }

  node.style.display = "block";
  node.setAttribute("d", String(connector.path || ""));
  node.setAttribute("stroke", connector.color);
}

function measureTradeActionBadge(node, label) {
  if (!node) {
    return { width: 0, height: 0 };
  }
  const previousDisplay = node.style.display;
  const previousVisibility = node.style.visibility;
  const previousTransform = node.style.transform;
  const previousLeft = node.style.left;
  const previousTop = node.style.top;
  node.style.display = "inline-flex";
  node.style.visibility = "hidden";
  node.style.transform = "none";
  node.style.left = "0px";
  node.style.top = "0px";
  node.textContent = label || "";
  const rect = node.getBoundingClientRect();
  node.style.display = previousDisplay;
  node.style.visibility = previousVisibility;
  node.style.transform = previousTransform;
  node.style.left = previousLeft;
  node.style.top = previousTop;
  return {
    width: rect.width || 0,
    height: rect.height || 0,
  };
}

function resolveTradeActionPlacement(kind, direction) {
  if (kind === "exit") {
    return direction === "short" ? "below" : "above";
  }
  return direction === "short" ? "above" : "below";
}

function buildSelectedTradeFocusRange({
  overlay = null,
  chartBarsLength = 0,
  currentVisibleRange = null,
} = {}) {
  const barCount = Math.max(0, Number(chartBarsLength) || 0);
  if (!overlay || barCount <= 0) {
    return null;
  }

  const entryIndex = Number.isInteger(overlay?.entryBarIndex)
    ? Math.max(0, Math.min(barCount - 1, overlay.entryBarIndex))
    : null;
  if (entryIndex == null) {
    return null;
  }
  const rawEndIndex = Number.isInteger(overlay?.exitBarIndex)
    ? overlay.exitBarIndex
    : entryIndex;
  const endIndex = Math.max(entryIndex, Math.min(barCount - 1, rawEndIndex));
  const tradeSpanBars = Math.max(1, endIndex - entryIndex + 1);
  const currentVisibleBars = currentVisibleRange
    ? Math.max(1, Math.ceil(Number(currentVisibleRange?.to)) - Math.floor(Number(currentVisibleRange?.from)) + 1)
    : 0;
  const desiredVisibleBars = Math.min(
    barCount,
    Math.max(
      SELECTED_TRADE_FOCUS_MIN_BARS,
      Math.min(
        SELECTED_TRADE_FOCUS_MAX_BARS,
        Math.max(currentVisibleBars, Math.round(tradeSpanBars * 1.8)),
      ),
    ),
  );
  const tradeMidpoint = (entryIndex + endIndex) * 0.5;
  const halfVisibleBars = (desiredVisibleBars - 1) * 0.5;
  let fromIndex = Math.max(0, Math.floor(tradeMidpoint - halfVisibleBars));
  let toIndex = Math.min(barCount - 1, fromIndex + desiredVisibleBars - 1);
  const visibleBars = toIndex - fromIndex + 1;
  if (visibleBars < desiredVisibleBars) {
    fromIndex = Math.max(0, toIndex - desiredVisibleBars + 1);
  }

  return {
    from: Math.max(-0.5, fromIndex - 0.5),
    to: Math.min(barCount - 0.5, toIndex + 0.5),
  };
}

function resolveTradeActionX(chart, chartBars, barIndex, visibleBarRange) {
  if (!Number.isInteger(barIndex) || !Array.isArray(chartBars) || !chartBars[barIndex]) {
    return null;
  }
  if (visibleBarRange && (barIndex < visibleBarRange.from || barIndex > visibleBarRange.to)) {
    return null;
  }
  const time = toChartTime(chartBars[barIndex]);
  const coordinate = time != null ? chart?.timeScale?.().timeToCoordinate?.(time) : null;
  if (Number.isFinite(coordinate)) {
    return coordinate;
  }
  return null;
}

function resolveTradeActionAnchorY(candleSeries, bar, placement, viewportHeight, tradePrice = null) {
  if (!bar || !candleSeries?.priceToCoordinate) {
    return null;
  }
  const anchorPrice = Number.isFinite(Number(tradePrice))
    ? Number(tradePrice)
    : (placement === "above" ? Number(bar.h) : Number(bar.l));
  const baseCoordinate = candleSeries.priceToCoordinate(anchorPrice);
  if (!Number.isFinite(baseCoordinate)) {
    return null;
  }
  const minY = 10;
  const maxY = Math.max(minY, Number(viewportHeight) - 10);
  return Math.max(minY, Math.min(maxY, baseCoordinate));
}

function clampTradeActionX(x, viewportWidth, margin = 8) {
  if (x == null) {
    return null;
  }
  const numericX = Number(x);
  const width = Number(viewportWidth);
  if (!Number.isFinite(numericX) || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  const safeMargin = Math.max(2, Math.min(Math.floor(width / 2), Math.floor(Number(margin) || 8)));
  return Math.max(safeMargin, Math.min(width - safeMargin, numericX));
}

function clampTradeActionBadgeLeft(left, badgeWidth, viewportWidth, edgePadding = 8) {
  const usableWidth = Math.max(edgePadding, Number(viewportWidth) || 0);
  const clampedWidth = Math.max(0, Number(badgeWidth) || 0);
  return Math.max(edgePadding, Math.min(usableWidth - clampedWidth - edgePadding, Number(left) || 0));
}

function clampTradeActionBadgeTop(top, badgeHeight, viewportHeight, edgePadding = 8) {
  const usableHeight = Math.max(edgePadding, Number(viewportHeight) || 0);
  const clampedHeight = Math.max(0, Number(badgeHeight) || 0);
  return Math.max(edgePadding, Math.min(usableHeight - clampedHeight - edgePadding, Number(top) || 0));
}

function resolveTradeActionCandleBounds(candleSeries, bar, viewportHeight, padding = 8) {
  if (!bar || !candleSeries?.priceToCoordinate) {
    return null;
  }
  const highY = candleSeries.priceToCoordinate(Number(bar.h));
  const lowY = candleSeries.priceToCoordinate(Number(bar.l));
  if (!Number.isFinite(highY) || !Number.isFinite(lowY)) {
    return null;
  }
  const safePadding = Math.max(4, Number(padding) || 0);
  const minY = 10;
  const maxY = Math.max(minY, Number(viewportHeight) - 10);
  const top = Math.max(minY, Math.min(maxY, Math.min(highY, lowY) - safePadding));
  const bottom = Math.max(minY, Math.min(maxY, Math.max(highY, lowY) + safePadding));
  return bottom >= top
    ? { top, bottom }
    : null;
}
function finalizeTradeActionBadgeLayout(layout, viewportWidth, viewportHeight, edgePadding = 8) {
  if (!layout) {
    return null;
  }
  const width = Math.max(42, Math.ceil(Number(layout.width) || 0));
  const height = Math.max(24, Math.ceil(Number(layout.height) || 0));
  const left = clampTradeActionBadgeLeft(layout.left, width, viewportWidth, edgePadding);
  const top = clampTradeActionBadgeTop(layout.top, height, viewportHeight, edgePadding);
  const anchorX = Number(layout.anchorX);
  const attachX = Number.isFinite(anchorX)
    ? Math.max(left + 6, Math.min(left + width - 6, anchorX))
    : left + (width / 2);
  const placement = layout.placement === "above" ? "above" : "below";
  return {
    ...layout,
    placement,
    left,
    top,
    width,
    height,
    attachX,
    attachY: placement === "above" ? top + height : top,
  };
}

function shiftTradeActionBadgeLayout(layout, {
  deltaX = 0,
  deltaY = 0,
  viewportWidth,
  viewportHeight,
  edgePadding = 8,
} = {}) {
  if (!layout) {
    return null;
  }
  return finalizeTradeActionBadgeLayout({
    ...layout,
    left: Number(layout.left) + Number(deltaX || 0),
    top: Number(layout.top) + Number(deltaY || 0),
  }, viewportWidth, viewportHeight, edgePadding);
}

function doTradeActionBadgesOverlap(firstBadge, secondBadge, padding = 6) {
  if (!firstBadge || !secondBadge) {
    return false;
  }
  const gap = Math.max(0, Number(padding) || 0);
  return !(
    firstBadge.left + firstBadge.width + gap <= secondBadge.left
    || secondBadge.left + secondBadge.width + gap <= firstBadge.left
    || firstBadge.top + firstBadge.height + gap <= secondBadge.top
    || secondBadge.top + secondBadge.height + gap <= firstBadge.top
  );
}

function resolveTradeActionBadgePairLayouts({
  entryBadge = null,
  exitBadge = null,
  entryBarIndex = null,
  exitBarIndex = null,
  viewportWidth = 0,
  viewportHeight = 0,
}) {
  if (!entryBadge || !exitBadge) {
    return { entryBadge, exitBadge };
  }

  let nextEntryBadge = entryBadge;
  let nextExitBadge = exitBadge;
  const sameBar = Number.isInteger(entryBarIndex) && Number.isInteger(exitBarIndex) && entryBarIndex === exitBarIndex;
  const stackBadgeOutward = (badge, distance) => shiftTradeActionBadgeLayout(badge, {
    deltaY: badge?.placement === "above"
      ? -Math.abs(distance)
      : Math.abs(distance),
    viewportWidth,
    viewportHeight,
  });
  const resolveOutwardOverlapShift = (movingBadge, stationaryBadge, padding = 8) => {
    if (!movingBadge || !stationaryBadge) {
      return 0;
    }
    const safePadding = Math.max(0, Number(padding) || 0);
    if (movingBadge.placement === "above") {
      return Math.max(0, (movingBadge.top + movingBadge.height + safePadding) - stationaryBadge.top);
    }
    return Math.max(0, (stationaryBadge.top + stationaryBadge.height + safePadding) - movingBadge.top);
  };

  if (sameBar && doTradeActionBadgesOverlap(nextEntryBadge, nextExitBadge, 8)) {
    nextExitBadge = stackBadgeOutward(
      nextExitBadge,
      Math.max(nextExitBadge.height + 10, resolveOutwardOverlapShift(nextExitBadge, nextEntryBadge, 10)),
    );
  }

  if (doTradeActionBadgesOverlap(nextEntryBadge, nextExitBadge, 8)) {
    const keepEntryCloser = !Number.isInteger(entryBarIndex)
      || !Number.isInteger(exitBarIndex)
      || entryBarIndex <= exitBarIndex;
    const stationaryBadge = keepEntryCloser ? nextEntryBadge : nextExitBadge;
    const movingBadge = keepEntryCloser ? nextExitBadge : nextEntryBadge;
    let resolvedMovingBadge = movingBadge;
    const overlapDistance = resolveOutwardOverlapShift(movingBadge, stationaryBadge, 10);
    if (overlapDistance > 0) {
      resolvedMovingBadge = stackBadgeOutward(movingBadge, overlapDistance);
    }
    if (doTradeActionBadgesOverlap(stationaryBadge, resolvedMovingBadge, 8)) {
      resolvedMovingBadge = stackBadgeOutward(resolvedMovingBadge, resolvedMovingBadge.height + 10);
    }
    if (keepEntryCloser) {
      nextExitBadge = resolvedMovingBadge;
    } else {
      nextEntryBadge = resolvedMovingBadge;
    }
  }

  return {
    entryBadge: nextEntryBadge,
    exitBadge: nextExitBadge,
  };
}
function resolveTradeActionBadgeLayout({
  anchorX,
  anchorY,
  placement,
  preferredSide = "right",
  candleBounds = null,
  label,
  node,
  viewportWidth,
  viewportHeight,
  horizontalOffset = 0,
  verticalOffset = 0,
}) {
  if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY) || !node) {
    return null;
  }
  const { width, height } = measureTradeActionBadge(node, label);
  const badgeWidth = Math.max(42, Math.ceil(width || 0));
  const badgeHeight = Math.max(24, Math.ceil(height || 0));
  const gap = 10;
  const edgePadding = 8;
  const usableHeight = Math.max(edgePadding, Number(viewportHeight) || 0);
  const preferredTopEdge = Number.isFinite(Number(candleBounds?.top))
    ? Number(candleBounds.top)
    : Number(anchorY);
  const preferredBottomEdge = Number.isFinite(Number(candleBounds?.bottom))
    ? Number(candleBounds.bottom)
    : Number(anchorY);
  const fitsAbove = preferredTopEdge - gap - badgeHeight >= edgePadding;
  const fitsBelow = preferredBottomEdge + gap + badgeHeight <= usableHeight - edgePadding;
  let resolvedPlacement = placement === "above" ? "above" : "below";
  if (resolvedPlacement === "above" && !fitsAbove && fitsBelow) {
    resolvedPlacement = "below";
  } else if (resolvedPlacement === "below" && !fitsBelow && fitsAbove) {
    resolvedPlacement = "above";
  }
  const desiredTop = resolvedPlacement === "above"
    ? preferredTopEdge - badgeHeight - gap - Math.abs(Number(verticalOffset) || 0)
    : preferredBottomEdge + gap + Math.abs(Number(verticalOffset) || 0);
  const preferredLeft = anchorX - (badgeWidth / 2) + Number(horizontalOffset || 0);
  return finalizeTradeActionBadgeLayout({
    left: preferredLeft,
    top: desiredTop,
    width: badgeWidth,
    height: badgeHeight,
    placement: resolvedPlacement,
    anchorX,
    anchorY,
    preferredSide,
  }, viewportWidth, viewportHeight, edgePadding);
}
function buildTradeActionConnectorPath({
  entryAnchor = null,
  exitAnchor = null,
}) {
  if (!entryAnchor || !exitAnchor) {
    return "";
  }
  if (![entryAnchor.x, entryAnchor.y, exitAnchor.x, exitAnchor.y].every((value) => Number.isFinite(Number(value)))) {
    return "";
  }
  return `M ${Number(entryAnchor.x).toFixed(1)} ${Number(entryAnchor.y).toFixed(1)} L ${Number(exitAnchor.x).toFixed(1)} ${Number(exitAnchor.y).toFixed(1)}`;
}

function buildTradeActionLeaderPath(fromPoint = null, toPoint = null) {
  if (!fromPoint || !toPoint) {
    return "";
  }
  if (![fromPoint.x, fromPoint.y, toPoint.x, toPoint.y].every((value) => Number.isFinite(Number(value)))) {
    return "";
  }
  return `M ${Number(fromPoint.x).toFixed(1)} ${Number(fromPoint.y).toFixed(1)} L ${Number(toPoint.x).toFixed(1)} ${Number(toPoint.y).toFixed(1)}`;
}

const TRADE_INTERACTION_HIT_RADIUS_PX = 18;
const TRADE_INTERACTION_SELECTED_HIT_RADIUS_PX = 22;
const TRADE_INTERACTION_MARKER_OFFSET_PX = 14;

function normalizeInteractionTradeId(value) {
  const text = String(value || "").trim();
  return text || null;
}

function orderInteractionTradeIds(tradeIds, selectedTradeId = null, preferredTradeId = null) {
  const normalizedTradeIds = Array.from(new Set(
    (Array.isArray(tradeIds) ? tradeIds : [])
      .map((tradeId) => normalizeInteractionTradeId(tradeId))
      .filter(Boolean),
  ));
  if (!normalizedTradeIds.length) {
    return [];
  }
  const orderedTradeIds = [];
  const pushTradeId = (tradeId) => {
    const normalizedTradeId = normalizeInteractionTradeId(tradeId);
    if (!normalizedTradeId || orderedTradeIds.includes(normalizedTradeId) || !normalizedTradeIds.includes(normalizedTradeId)) {
      return;
    }
    orderedTradeIds.push(normalizedTradeId);
  };
  pushTradeId(selectedTradeId);
  pushTradeId(preferredTradeId);
  normalizedTradeIds.forEach(pushTradeId);
  return orderedTradeIds;
}

function resolveTradeInteractionY(candleSeries, bar, placement, viewportHeight) {
  if (!bar || !candleSeries?.priceToCoordinate) {
    return null;
  }
  const anchorPrice = placement === "above" ? Number(bar.h) : Number(bar.l);
  const baseCoordinate = candleSeries.priceToCoordinate(anchorPrice);
  if (!Number.isFinite(baseCoordinate)) {
    return null;
  }
  const desired = baseCoordinate + (placement === "above" ? -TRADE_INTERACTION_MARKER_OFFSET_PX : TRADE_INTERACTION_MARKER_OFFSET_PX);
  const minY = 34;
  const maxY = Math.max(minY, Number(viewportHeight) - 24);
  return Math.max(minY, Math.min(maxY, desired));
}

function buildTradeInteractionTargets({
  chart = null,
  candleSeries = null,
  chartBars = [],
  interactionGroups = [],
  viewportWidth = 0,
  viewportHeight = 0,
} = {}) {
  if (!chart || !candleSeries) {
    return [];
  }
  const resolvedWidth = Number(viewportWidth);
  const resolvedHeight = Number(viewportHeight);
  if (!Number.isFinite(resolvedWidth) || !Number.isFinite(resolvedHeight) || resolvedWidth <= 0 || resolvedHeight <= 0) {
    return [];
  }

  const targets = [];
  for (const group of Array.isArray(interactionGroups) ? interactionGroups : []) {
    const barIndex = Number.isInteger(group?.barIndex) ? group.barIndex : null;
    const bar = barIndex != null ? chartBars[barIndex] : null;
    if (!bar) {
      continue;
    }
    const x = resolveTradeActionX(chart, chartBars, barIndex, null);
    if (!Number.isFinite(x) || x < -32 || x > resolvedWidth + 32) {
      continue;
    }
    const placement = resolveTradeActionPlacement(group?.kind, group?.dir);
    const y = resolveTradeInteractionY(candleSeries, bar, placement, resolvedHeight);
    if (!Number.isFinite(y)) {
      continue;
    }
    const tradeIds = Array.from(new Set(
      (Array.isArray(group?.overlays) ? group.overlays : [])
        .map((overlay) => normalizeInteractionTradeId(overlay?.tradeSelectionId))
        .filter(Boolean),
    ));
    if (!tradeIds.length) {
      continue;
    }
    targets.push({
      id: String(group?.id || `${group?.kind || "trade"}-${barIndex}`),
      kind: group?.kind === "exit" ? "exit" : "entry",
      x,
      y,
      tradeIds,
      hitRadius: tradeIds.length > 1 ? TRADE_INTERACTION_SELECTED_HIT_RADIUS_PX : TRADE_INTERACTION_HIT_RADIUS_PX,
    });
  }
  return targets;
}

function findNearestTradeInteractionTarget(targets, point, selectedTradeId = null) {
  const pointX = Number(point?.x);
  const pointY = Number(point?.y);
  if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
    return null;
  }

  let winner = null;
  for (const target of Array.isArray(targets) ? targets : []) {
    const dx = pointX - Number(target?.x);
    const dy = pointY - Number(target?.y);
    const distSq = (dx * dx) + (dy * dy);
    const hitRadius = Number(target?.hitRadius) || TRADE_INTERACTION_HIT_RADIUS_PX;
    if (distSq > hitRadius * hitRadius) {
      continue;
    }
    const containsSelected = Boolean(
      selectedTradeId
      && Array.isArray(target?.tradeIds)
      && target.tradeIds.includes(selectedTradeId),
    );
    const rank = [
      distSq,
      containsSelected ? 0 : 1,
      Array.isArray(target?.tradeIds) ? target.tradeIds.length : Number.POSITIVE_INFINITY,
      String(target?.kind || "entry") === "entry" ? 0 : 1,
    ];
    if (!winner || rank.some((value, index) => value !== winner.rank[index] && value < winner.rank[index])) {
      winner = {
        target,
        rank,
        containsSelected,
      };
    }
  }

  if (!winner?.target) {
    return null;
  }
  const orderedTradeIds = orderInteractionTradeIds(winner.target.tradeIds, selectedTradeId);
  return {
    ...winner.target,
    containsSelected: winner.containsSelected,
    orderedTradeIds,
    preferredTradeId: orderedTradeIds[0] || null,
  };
}

const STUDY_SERIES_TYPE = {
  line: LineSeries,
  histogram: HistogramSeries,
};

function syncStudySeriesSet(chart, refs, specs = []) {
  const nextKeys = new Set((Array.isArray(specs) ? specs : []).map((spec) => spec.key));
  const registry = refs.current || {};

  for (const spec of Array.isArray(specs) ? specs : []) {
    const existing = registry[spec.key] || null;
    const seriesDefinition = STUDY_SERIES_TYPE[spec.seriesType] || LineSeries;
    const paneIndex = spec.paneIndex || 0;
    if (!existing || existing.paneIndex !== paneIndex || existing.seriesType !== spec.seriesType) {
      if (existing?.series) {
        chart.removeSeries(existing.series);
      }
      const series = chart.addSeries(seriesDefinition, spec.options, paneIndex);
      series.setData(spec.data);
      registry[spec.key] = {
        key: spec.key,
        paneIndex,
        seriesType: spec.seriesType,
        series,
      };
      continue;
    }

    existing.series.applyOptions({
      ...spec.options,
      visible: true,
    });
    existing.series.setData(spec.data);
  }

  for (const [key, entry] of Object.entries(registry)) {
    if (nextKeys.has(key)) {
      continue;
    }
    if (entry?.series) {
      chart.removeSeries(entry.series);
    }
    delete registry[key];
  }

  refs.current = registry;
}

function publishDebugState(payload) {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return;
  }
  const nextState = {
    ...(window.__researchChartDebug || {}),
    ...payload,
  };
  window.__researchChartDebug = nextState;
  const debugKey = String(payload?.rangePresetKey || nextState.rangePresetKey || "default");
  window.__researchChartDebugByKey = {
    ...(window.__researchChartDebugByKey || {}),
    [debugKey]: {
      ...(window.__researchChartDebugByKey?.[debugKey] || {}),
      ...payload,
    },
  };
}

function buildHoverHudSnapshot(candlePoint, volumeByTime, time) {
  if (!candlePoint) {
    return null;
  }
  return {
    time,
    open: candlePoint.open,
    high: candlePoint.high,
    low: candlePoint.low,
    close: candlePoint.close,
    volume: volumeByTime.get(time) || 0,
  };
}

function ChartHudOverlay({
  hoverStore,
  symbol,
  chartBars,
  tradeBySelectionId,
  activeTradeId,
  resolvedPricePrecision,
  statusItems = [],
  tradeThresholdDisplay = "none",
  showFocusTradeCard = true,
}) {
  const hoverSnapshot = React.useSyncExternalStore(
    hoverStore.subscribe,
    hoverStore.getSnapshot,
    hoverStore.getSnapshot,
  );
  const lastBar = chartBars[chartBars.length - 1];
  const fallbackHud = lastBar
    ? {
        time: toChartTime(lastBar),
        open: lastBar.o,
        high: lastBar.h,
        low: lastBar.l,
        close: lastBar.c,
        volume: lastBar.v,
      }
    : null;
  const hud = hoverSnapshot.hud || fallbackHud;
  const resolveTradeOverlay = (tradeId) => {
    const key = String(tradeId || "").trim();
    if (!key) {
      return null;
    }
    return tradeBySelectionId.get(key)
      || [...tradeBySelectionId.values()].find((overlay) => {
        const overlayId = String(overlay?.id || "").trim();
        const selectionId = String(overlay?.tradeSelectionId || "").trim();
        return overlayId === key || selectionId === key;
      })
      || null;
  };
  const hoveredTrade = resolveTradeOverlay(hoverSnapshot.hoverTradeId);
  const selectedTrade = resolveTradeOverlay(activeTradeId);
  const focusTrade = hoveredTrade || selectedTrade;
  const compactStatusItems = Array.isArray(statusItems)
    ? statusItems.filter((item) => item && item.value)
    : [];
  const focusTradeDirection = focusTrade?.dir === "short" ? "Short" : "Long";
  const focusTradeStrategy = getStrategyLabel(String(focusTrade?.strat || "").trim() || DEFAULT_RESEARCH_STRATEGY);
  const focusTradePnl = Number(focusTrade?.pnl);
  const focusTradeEntry = resolveOverlayEntryPrice(focusTrade);
  const focusTradeExit = resolveOverlayExitPrice(focusTrade);
  const focusTradeBarsHeld = resolveOverlayHoldBars(focusTrade);
  const focusTradeExpiry = formatOverlayExpiryDate(focusTrade);
  const focusTradeExitReason = formatTradeExitReason(focusTrade);
  const focusTradeSummaryParts = [
    Number.isFinite(focusTradeEntry) ? `Entry ${formatPrice(focusTradeEntry, resolvedPricePrecision)}` : null,
    Number.isFinite(focusTradeExit) ? `Exit ${formatPrice(focusTradeExit, resolvedPricePrecision)}` : "Open",
    Number.isFinite(focusTradeBarsHeld) ? `${focusTradeBarsHeld} bars` : null,
    focusTradeExpiry !== "—" ? focusTradeExpiry : null,
  ].filter(Boolean);
  const focusTradeSummary = focusTradeSummaryParts.join(" · ");
  const focusTradeReasonText = focusTradeExitReason !== "—" ? focusTradeExitReason : null;
  const focusTradeThresholdSummary = tradeThresholdDisplay === "none"
    ? ""
    : buildTradeThresholdSummary(focusTrade, resolvedPricePrecision);
  const isHoverPreview = Boolean(
    hoveredTrade
    && selectedTrade
    && hoveredTrade.tradeSelectionId !== selectedTrade.tradeSelectionId,
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        right: 8,
        zIndex: 4,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          minHeight: 34,
          padding: "6px 10px",
          borderRadius: 7,
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(226,232,240,0.92)",
          boxShadow: "0 4px 18px rgba(15,23,42,0.06)",
          color: TEXT,
          fontFamily: FONT_MONO,
          fontSize: 10,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
            flex: "1 1 auto",
            overflow: "hidden",
          }}
        >
          <span style={{ fontWeight: 700, color: "#0f172a", flexShrink: 0 }}>{symbol}</span>
          {hud && (
            <>
              <span style={{ flexShrink: 0 }}>O {formatPrice(hud.open, resolvedPricePrecision)}</span>
              <span style={{ flexShrink: 0 }}>H {formatPrice(hud.high, resolvedPricePrecision)}</span>
              <span style={{ flexShrink: 0 }}>L {formatPrice(hud.low, resolvedPricePrecision)}</span>
              <span style={{ flexShrink: 0 }}>C {formatPrice(hud.close, resolvedPricePrecision)}</span>
              <span style={{ flexShrink: 0 }}>V {formatVolume(hud.volume)}</span>
            </>
          )}
        </div>
        {compactStatusItems.length ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 12,
              minWidth: 0,
              flex: "0 1 auto",
              overflow: "hidden",
            }}
          >
            {compactStatusItems.map((item) => (
              <span
                key={item.key || item.label}
                title={item.title || `${item.label} ${item.value}`}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 4,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: MUTED,
                    flexShrink: 0,
                  }}
                >
                  {item.label}
                </span>
                <span
                  style={{
                    color: item.color || TEXT,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontWeight: 600,
                  }}
                >
                  {item.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {showFocusTradeCard && focusTrade ? (
        <div
          style={{
            position: "absolute",
            top: 42,
            right: 0,
            width: "min(38%, 320px)",
            minWidth: 210,
            padding: "8px 10px",
            borderRadius: 11,
            background: "rgba(248,250,252,0.96)",
            border: "1px solid rgba(226,232,240,0.94)",
            boxShadow: "0 10px 24px rgba(15,23,42,0.1)",
            backdropFilter: "blur(12px)",
            color: TEXT,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              {isHoverPreview ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "2px 5px",
                    borderRadius: 999,
                    background: "rgba(59,130,246,0.12)",
                    color: ACCENT,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    flexShrink: 0,
                  }}
                >
                  Preview
                </span>
              ) : null}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 6px",
                  borderRadius: 999,
                  background: withAlpha(focusTrade?.dir === "short" ? BEAR : BULL, 0.14),
                  color: focusTrade?.dir === "short" ? BEAR : BULL,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                {focusTradeDirection}
              </span>
              <span
                title={formatOverlayTradeLabel(focusTrade)}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#0f172a",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {focusTradeStrategy}
              </span>
            </div>
            <span
              style={{
                color: Number.isFinite(focusTradePnl) && focusTradePnl >= 0 ? "#0f766e" : "#b91c1c",
                fontSize: 12,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {formatSignedCurrency(focusTradePnl, 2)}
            </span>
          </div>
          <div
            title={focusTradeSummary}
            style={{
              marginTop: 7,
              fontSize: 10,
              fontWeight: 600,
              color: "#475569",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {focusTradeSummary}
          </div>
          {focusTradeThresholdSummary ? (
            <div
              title={focusTradeThresholdSummary}
              style={{
                marginTop: 4,
                fontSize: 10,
                fontWeight: 700,
                color: "#475569",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {focusTradeThresholdSummary}
            </div>
          ) : null}
          {focusTradeReasonText ? (
            <div
              title={focusTradeReasonText}
              style={{
                marginTop: 4,
                fontSize: 10,
                fontWeight: 700,
                color: "#64748b",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {focusTradeReasonText}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResearchSpotChart({
  isActive = true,
  bars,
  barRanges = [],
  defaultVisibleLogicalRange = null,
  tradeOverlays,
  tradeMarkerGroups,
  indicatorMarkerPayload = EMPTY_INDICATOR_MARKER_PAYLOAD,
  indicatorZones,
  indicatorWindows,
  studySpecs = [],
  studyVisibility = {},
  studyLowerPaneCount = 0,
  smcMarkers = [],
  tvStudies,
  strategy,
  rangePresetKey = "3M|D",
  baseSeriesModeKey = "D",
  allowFullIntervalSeries = false,
  chartType = DEFAULT_CHART_TYPE,
  rayalgoCandleColorMode = DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
  symbol = "SPY",
  emptyStateLabel = "Loading chart...",
  selectedTradeId = null,
  selectedTradeSourceChartId = null,
  hoveredTradeId = null,
  onTradeSelect = null,
  onTradeHover = null,
  chartId = "chart",
  linkEnabled = false,
  linkedViewportRequest = null,
  linkedViewportStore = null,
  onVisibleTimeBoundsChange = null,
  showSignals = true,
  showZones = true,
  autoFocusSelectedTrade = true,
  tradeThresholdDisplay = "none",
  hasOlderHistory = false,
  isLoadingOlderHistory = false,
  onRequestOlderHistory = null,
  onRuntimeHealthChange = null,
  statusItems = [],
  showFocusTradeCard = true,
  pricePrecision = 2,
}) {
  const hostRef = useRef(null);
  const overlayRef = useRef(null);
  const tradeActionOverlayRef = useRef(null);
  const tradeActionEntryLeaderRef = useRef(null);
  const tradeActionConnectorRef = useRef(null);
  const tradeActionExitLeaderRef = useRef(null);
  const tradeActionEntryBadgeRef = useRef(null);
  const tradeActionExitBadgeRef = useRef(null);
  const tradeSelectionPickerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const volumeCandlePrimitiveRef = useRef(null);
  const volumePanePrimitiveRef = useRef(null);
  const markerApiRef = useRef(null);
  const studySeriesRef = useRef({});
  const chartLifecycleHandlersRef = useRef({});
  const tradeBySelectionIdRef = useRef(new Map());
  const onRequestOlderHistoryRef = useRef(onRequestOlderHistory);
  const hasOlderHistoryRef = useRef(hasOlderHistory);
  const isLoadingOlderHistoryRef = useRef(isLoadingOlderHistory);
  const onVisibleTimeBoundsChangeRef = useRef(onVisibleTimeBoundsChange);
  const onRuntimeHealthChangeRef = useRef(onRuntimeHealthChange);
  const selectedTradeIdRef = useRef(selectedTradeId);
  const hoveredTradeIdRef = useRef(hoveredTradeId);
  const activeTradeSelectionIdRef = useRef(null);
  const renderCountRef = useRef(0);
  const visibleLogicalRangeRef = useRef(null);
  const visibleTimeBoundsRef = useRef(null);
  const lastStableUserVisibleRangeRef = useRef(null);
  const lastStableUserTimeBoundsRef = useRef(null);
  const programmaticVisibleRangeRef = useRef(null);
  const userRangeIntentRef = useRef({
    source: "preset",
    atMs: 0,
  });
  const rangeOwnerRef = useRef("preset");
  const rangeWriteSourceRef = useRef("preset");
  const pinnedToPresetRef = useRef(true);
  const lastRangePresetKeyRef = useRef(null);
  const lastBarCountRef = useRef(0);
  const lastDataDomainRef = useRef({
    startMs: null,
    endMs: null,
  });
  const lastPublishedViewportSignatureRef = useRef("");
  const lastAppliedLinkedViewportKeyRef = useRef("");
  const linkedViewportApplyTimerRef = useRef(null);
  const rangePresetKeyRef = useRef(rangePresetKey);
  const baseSeriesModeLimitsRef = useRef(
    resolveBaseSeriesModeLimits(baseSeriesModeKey, allowFullIntervalSeries),
  );
  const presentationFrameRef = useRef(null);
  const presentationIdleTimerRef = useRef(null);
  const pendingPresentationModeRef = useRef("light");
  const resizePresentationTimerRef = useRef(null);
  const lastObservedHostSizeRef = useRef({ width: 0, height: 0 });
  const visibleRangeEnforcementFrameRef = useRef(null);
  const baseSeriesRefreshTimerRef = useRef(null);
  const renderWindowFrameRef = useRef(null);
  const renderWindowIdleTimerRef = useRef(null);
  const pendingRenderWindowRef = useRef({
    range: null,
    force: false,
    owner: "preset",
    source: "preset",
  });
  const renderWindowRef = useRef(null);
  const renderWindowTransitionRef = useRef(null);
  const baseSeriesModeRef = useRef("empty");
  const baseSeriesSetDataCountRef = useRef(0);
  const baseSeriesWindowSwapCountRef = useRef(0);
  const activeBarCountRef = useRef(0);
  const activeBarCapRef = useRef(0);
  const overlaySyncCountRef = useRef(0);
  const tradeMarkerSetCountRef = useRef(0);
  const selectedTradeOverlaySyncCountRef = useRef(0);
  const lastOverlaySignatureRef = useRef("empty");
  const selectedTradeOverlayVisibleRef = useRef(false);
  const selectedTradeOverlaySignatureRef = useRef("hidden");
  const lastSelectionFocusTradeIdRef = useRef(null);
  const olderHistoryRequestKeyRef = useRef("");
  const olderHistoryEdgeBlockedRef = useRef(false);
  const runtimeHealthSignatureRef = useRef("");
  const dragStateRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
  });
  const suppressTradeSelectUntilRef = useRef(0);
  const selectionViewportLockUntilRef = useRef(0);
  const fullBaseDataCacheRef = useRef(createEmptyBaseDataCache());
  const renderWindowBaseDataCacheRef = useRef(createEmptyBaseDataCache());
  const overlayNodeMapRef = useRef(new Map());
  const overlayZoneNodeMapRef = useRef(new Map());
  const tradeThresholdNodeMapRef = useRef(new Map());
  const visibleMarkersSignatureRef = useRef("empty");
  const lastOverlayZoneSignatureRef = useRef("empty");
  const chartBarsRef = useRef([]);
  const chartBarRangesRef = useRef([]);
  const clampedDefaultVisibleLogicalRangeRef = useRef(null);
  const transientViewportRecoveryRef = useRef(false);
  const markerPayloadRef = useRef({
    tradeMarkers: createEmptyIndexedCollection(),
    indicatorMarkers: createEmptyIndexedCollection(),
    smcMarkers: createEmptyIndexedCollection(),
    showSignals: true,
    showSmc: false,
  });
  const overlayPayloadRef = useRef({
    indicatorZones: createEmptyIndexedCollection(),
    indicatorWindows: createEmptyIndexedCollection(),
    showZones: true,
  });
  const interactionRef = useRef({
    onTradeSelect: null,
    onTradeHover: null,
    selectedTradeId: null,
    tradeInteractionGroups: [],
    tradeTimeToIds: new Map(),
    indicatorTimeToIds: new Map(),
    volumeByTime: new Map(),
  });
  const hoverStoreRef = useRef(createHoverSnapshotStore());
  const [tradeSelectionPicker, setTradeSelectionPicker] = React.useState(null);
  const studySpecsRef = useRef(Array.isArray(studySpecs) ? studySpecs : []);
  const studyLayoutRef = useRef({ lowerPaneCount: 0 });
  const lastStudySyncRef = useRef({
    renderWindowSignature: "full:0",
    studySpecs: studySpecsRef.current,
    lowerPaneCount: 0,
    studyCount: 0,
  });
  renderCountRef.current += 1;

  const chartBars = Array.isArray(bars) ? bars : [];
  const chartBarRanges = Array.isArray(barRanges) ? barRanges : [];
  const hasBars = chartBars.length > 0;
  const showVolumeCandles = useMemo(
    () => isVolumeChartType(chartType),
    [chartType],
  );
  const chartTheme = useMemo(
    () => resolveChartVisualTheme(strategy),
    [strategy],
  );
  const usesTraditionalCandleColors = useMemo(
    () => String(strategy || "").trim().toLowerCase() !== "rayalgo"
      || usesTraditionalRayalgoCandleColors(rayalgoCandleColorMode),
    [rayalgoCandleColorMode, strategy],
  );
  const candleBullColor = usesTraditionalCandleColors ? BULL : chartTheme.shadeBull;
  const candleBearColor = usesTraditionalCandleColors ? BEAR : chartTheme.shadeBear;
  const volumeBullColor = useMemo(
    () => withAlpha(candleBullColor, 0.28),
    [candleBullColor],
  );
  const volumeBearColor = useMemo(
    () => withAlpha(candleBearColor, 0.28),
    [candleBearColor],
  );
  const resolvedPricePrecision = useMemo(
    () => clampPricePrecision(pricePrecision, 2),
    [pricePrecision],
  );
  const priceFormatter = useMemo(
    () => createCurrencyFormatter(resolvedPricePrecision),
    [resolvedPricePrecision],
  );
  const priceMinMove = useMemo(
    () => 1 / (10 ** resolvedPricePrecision),
    [resolvedPricePrecision],
  );
  const chartBarsSignature = useMemo(
    () => buildBarSignature(chartBars),
    [chartBars],
  );
  const chartBarRangeDomainKey = useMemo(() => {
    if (!chartBarRanges.length) {
      return "empty";
    }
    const firstStartMs = Number(chartBarRanges[0]?.startMs) || 0;
    const lastRange = chartBarRanges[chartBarRanges.length - 1] || null;
    const lastEndMs = Number(lastRange?.endMs ?? lastRange?.startMs) || 0;
    return [chartBarRanges.length, firstStartMs, lastEndMs].join(":");
  }, [chartBarRanges]);
  const dismissTradeSelectionPicker = React.useCallback(() => {
    setTradeSelectionPicker(null);
  }, []);
  const syncVisibleTimeBounds = React.useCallback((nextVisibleRange, nextBarRanges = chartBarRangesRef.current) => {
    visibleTimeBoundsRef.current = buildVisibleTimeBounds(nextVisibleRange, nextBarRanges);
  }, []);
  const rememberStableUserViewport = React.useCallback((nextVisibleRange, nextTimeBounds = visibleTimeBoundsRef.current) => {
    const stableRange = clampVisibleLogicalRange(nextVisibleRange, chartBarsRef.current.length);
    if (stableRange) {
      lastStableUserVisibleRangeRef.current = stableRange;
    }
    const startMs = Number(nextTimeBounds?.startMs);
    const endMs = Number(nextTimeBounds?.endMs);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      lastStableUserTimeBoundsRef.current = { startMs, endMs };
    }
  }, []);
  const shouldCaptureStableUserViewport = React.useCallback((source = rangeWriteSourceRef.current) => {
    const recentUserIntent = userRangeIntentRef.current;
    const recentUserIntentAgeMs = Math.max(0, getNowMs() - (Number(recentUserIntent?.atMs) || 0));
    if (recentUserIntentAgeMs > USER_RANGE_INTENT_MAX_AGE_MS) {
      return false;
    }
    const recentSource = String(recentUserIntent?.source || "").trim().toLowerCase();
    if (!isUserRangeSource(recentSource)) {
      return false;
    }
    const normalizedSource = String(source || "").trim().toLowerCase();
    if (!normalizedSource) {
      return true;
    }
    return normalizedSource === recentSource
      || normalizedSource === "chart-drag"
      || normalizedSource === "chart-wheel";
  }, []);
  const applyRangeState = React.useCallback((owner = rangeOwnerRef.current, source = rangeWriteSourceRef.current) => {
    const normalizedOwner = owner === "user" ? "user" : "preset";
    rangeOwnerRef.current = normalizedOwner;
    rangeWriteSourceRef.current = String(source || normalizedOwner);
    pinnedToPresetRef.current = normalizedOwner === "preset";
  }, []);
  const recordUserRangeIntent = React.useCallback((source = "user") => {
    userRangeIntentRef.current = {
      source: String(source || "user"),
      atMs: getNowMs(),
    };
  }, []);
  const clearUserRangeIntent = React.useCallback((source = "selection") => {
    userRangeIntentRef.current = {
      source: String(source || "selection"),
      atMs: 0,
    };
  }, []);
  const suppressTradeSelection = React.useCallback((durationMs = RANGE_INTERACTION_CLICK_SUPPRESS_MS) => {
    suppressTradeSelectUntilRef.current = Math.max(
      suppressTradeSelectUntilRef.current,
      getNowMs() + Math.max(0, Number(durationMs) || 0),
    );
  }, []);
  const beginUserRangeInteraction = React.useCallback((source = "user") => {
    const nextSource = String(source || "user");
    dismissTradeSelectionPicker();
    programmaticVisibleRangeRef.current = null;
    renderWindowTransitionRef.current = null;
    cancelAnimationFrameRefs([visibleRangeEnforcementFrameRef, renderWindowFrameRef]);
    clearTimeoutRefs([
      presentationIdleTimerRef,
      resizePresentationTimerRef,
      baseSeriesRefreshTimerRef,
      renderWindowIdleTimerRef,
    ]);
    resetPendingRenderWindowRef(pendingRenderWindowRef, rangeOwnerRef.current, rangeWriteSourceRef.current);
    applyRangeState("user", nextSource);
    recordUserRangeIntent(nextSource);
    suppressTradeSelection();
  }, [
    applyRangeState,
    dismissTradeSelectionPicker,
    recordUserRangeIntent,
    suppressTradeSelection,
  ]);
  const commitTradeSelection = React.useCallback((nextTradeId, options = {}) => {
    const onSelect = interactionRef.current.onTradeSelect;
    if (typeof onSelect !== "function") {
      return;
    }
    const normalizedTradeId = typeof nextTradeId === "string" && nextTradeId.trim()
      ? nextTradeId.trim()
      : null;
    dragStateRef.current.active = false;
    clearUserRangeIntent("selection");
    selectionViewportLockUntilRef.current = getNowMs() + SELECTION_VIEWPORT_LOCK_MS;
    setTradeSelectionPicker(null);
    onSelect(normalizedTradeId, {
      source: String(options?.source || "chart-marker"),
      sourceChartId: chartId,
    });
  }, [chartId, clearUserRangeIntent]);
  const publishTradeHover = React.useCallback((nextTradeId) => {
    const normalizedTradeId = normalizeInteractionTradeId(nextTradeId);
    if (hoveredTradeIdRef.current === normalizedTradeId) {
      return;
    }
    hoveredTradeIdRef.current = normalizedTradeId;
    const onHover = interactionRef.current.onTradeHover;
    if (typeof onHover === "function") {
      onHover(normalizedTradeId, {
        source: "chart-hover",
        sourceChartId: chartId,
      });
    }
  }, [chartId]);
  const resolveNearestTradeInteractionTarget = React.useCallback((point) => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const hostNode = hostRef.current;
    if (!chart || !candleSeries || !hostNode) {
      return null;
    }
    const paneSize = chart.paneSize?.(0);
    const targets = buildTradeInteractionTargets({
      chart,
      candleSeries,
      chartBars: chartBarsRef.current,
      interactionGroups: interactionRef.current.tradeInteractionGroups,
      viewportWidth: Number(paneSize?.width) || hostNode.clientWidth,
      viewportHeight: Number(paneSize?.height) || hostNode.clientHeight,
    });
    return findNearestTradeInteractionTarget(targets, point, selectedTradeIdRef.current);
  }, []);
  const clearTradeHoverPreview = React.useCallback((hud = hoverStoreRef.current.getSnapshot().hud || null, resetHud = false) => {
    if (resetHud) {
      hoverStoreRef.current.reset();
    } else {
      hoverStoreRef.current.setSnapshot({
        hud: hud || null,
        hoverTradeId: null,
      });
    }
    publishTradeHover(null);
    if (hostRef.current) {
      hostRef.current.style.cursor = "";
    }
  }, [publishTradeHover]);
  const buildRangeDebugPayload = React.useCallback((payload = {}) => ({
    ...payload,
    rangePresetKey: String(payload?.rangePresetKey || rangePresetKeyRef.current || "default"),
    rangeOwner: rangeOwnerRef.current,
    rangeWriteSource: rangeWriteSourceRef.current,
    programmaticRangePending: Boolean(programmaticVisibleRangeRef.current),
    visibleTimeBounds: visibleTimeBoundsRef.current,
    userRangeIntentSource: userRangeIntentRef.current.source,
  }), []);
  const reportChartRuntimeError = React.useCallback((context, error) => {
    if (import.meta.env.DEV) {
      console.error("[ResearchChart] runtime callback failed", {
        context,
        error,
      });
    }
    try {
      publishDebugState(buildRangeDebugPayload({
        chartRuntimeErrorContext: String(context || "unknown"),
        chartRuntimeErrorMessage: String(error?.message || error || "Unknown chart runtime error"),
      }));
    } catch {
      // Do not let debug publishing turn one callback failure into another.
    }
  }, [buildRangeDebugPayload]);
  const emitRuntimeHealthChange = React.useCallback((overrides = {}) => {
    const publishRuntimeHealthChange = onRuntimeHealthChangeRef.current;
    if (typeof publishRuntimeHealthChange !== "function") {
      return;
    }
    const loadedBarCount = Math.max(0, Number(overrides.loadedBarCount) || chartBarsRef.current.length || 0);
    const activeBarCount = Math.max(0, Number(overrides.activeBarCount) || activeBarCountRef.current || 0);
    const activeBarCap = Math.max(0, Number(overrides.activeBarCap) || activeBarCapRef.current || 0);
    const baseDataMode = String(overrides.baseDataMode || baseSeriesModeRef.current || "empty");
    const atActiveCap = activeBarCap > 0
      && activeBarCount >= activeBarCap
      && (baseSeriesModeUsesRenderWindowUtil(baseDataMode) || loadedBarCount > activeBarCount);
    const windowSwapChurn = baseSeriesModeUsesRenderWindowUtil(baseDataMode)
      && baseSeriesWindowSwapCountRef.current >= 12
      && loadedBarCount > activeBarCount;
    const runtime = {
      status: atActiveCap || windowSwapChurn ? "degraded" : "ok",
      reason: atActiveCap ? "active-bar-cap" : (windowSwapChurn ? "window-swap-churn" : null),
      message: atActiveCap
        ? "The spot chart is operating at its active render cap."
        : (windowSwapChurn ? "The spot chart is swapping render windows heavily." : null),
      loadedBarCount,
      activeBarCount,
      activeBarCap,
      baseDataMode,
      baseSeriesWindowSwapCount: baseSeriesWindowSwapCountRef.current,
      tradeMarkerSetCount: tradeMarkerSetCountRef.current,
      overlaySyncCount: overlaySyncCountRef.current,
      selectedTradeOverlaySyncCount: selectedTradeOverlaySyncCountRef.current,
    };
    const nextSignature = buildChartRuntimeSignature(runtime);
    if (nextSignature === runtimeHealthSignatureRef.current) {
      return;
    }
    runtimeHealthSignatureRef.current = nextSignature;
    publishRuntimeHealthChange(runtime);
  }, []);
  const setProgrammaticVisibleRange = React.useCallback((nextLocalRange, nextGlobalRange, options = {}) => {
    if (!nextLocalRange) {
      programmaticVisibleRangeRef.current = null;
      return false;
    }
    const chart = chartRef.current;
    if (!chart) {
      return false;
    }
    const owner = options?.owner === "user" || options?.owner === "preset"
      ? options.owner
      : rangeOwnerRef.current;
    const source = String(options?.source || rangeWriteSourceRef.current || owner);
    const barCount = chartBarsRef.current.length;
    const activeRenderWindow = options?.renderWindow === undefined
      ? renderWindowRef.current
      : options.renderWindow;
    const localBarCount = activeRenderWindow
      ? Math.max(0, Number(activeRenderWindow.end) - Number(activeRenderWindow.start) + 1)
      : barCount;
    const currentLocalRange = clampVisibleLogicalRange(
      chart.timeScale().getVisibleLogicalRange?.(),
      localBarCount,
    );
    if (logicalRangesMatch(currentLocalRange, nextLocalRange, PROGRAMMATIC_RANGE_SKIP_TOLERANCE)) {
      programmaticVisibleRangeRef.current = null;
      return false;
    }
    programmaticVisibleRangeRef.current = {
      range: nextLocalRange,
      globalRange: nextGlobalRange,
      owner,
      source,
      issuedAtMs: getNowMs(),
      renderWindow: activeRenderWindow ? { ...activeRenderWindow } : null,
      renderWindowSignature: buildRenderWindowSignature(activeRenderWindow, barCount),
    };
    chart.timeScale().setVisibleLogicalRange(nextLocalRange);
    return true;
  }, []);
  const resolveActiveVisibleGlobalRange = React.useCallback(() => {
    const barCount = chartBarsRef.current.length;
    if (!barCount) {
      return null;
    }
    const activeRenderWindow = renderWindowRef.current;
    const localBarCount = activeRenderWindow
      ? Math.max(0, Number(activeRenderWindow.end) - Number(activeRenderWindow.start) + 1)
      : barCount;
    const liveLocalRange = clampVisibleLogicalRange(
      chartRef.current?.timeScale?.().getVisibleLogicalRange?.(),
      localBarCount,
    );
    const liveGlobalRange = liveLocalRange
      ? localToGlobalLogicalRange(liveLocalRange, activeRenderWindow, barCount)
      : null;
    const nextGlobalRange = clampVisibleLogicalRange(
      liveGlobalRange
        || visibleLogicalRangeRef.current
        || clampedDefaultVisibleLogicalRangeRef.current,
      barCount,
    );
    if (nextGlobalRange) {
      visibleLogicalRangeRef.current = nextGlobalRange;
    }
    return nextGlobalRange;
  }, []);
  const emitVisibleTimeBoundsChange = React.useCallback((timeBounds = visibleTimeBoundsRef.current, options = {}) => {
    const publishVisibleTimeBoundsChange = onVisibleTimeBoundsChangeRef.current;
    if (typeof publishVisibleTimeBoundsChange !== "function") {
      return;
    }
    const source = String(options?.source || rangeWriteSourceRef.current || "");
    if (!isUserRangeSource(source)) {
      return;
    }
    const startMs = Number(timeBounds?.startMs);
    const endMs = Number(timeBounds?.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }
    const visibleRange = clampVisibleLogicalRange(
      visibleLogicalRangeRef.current,
      chartBarsRef.current.length,
    );
    const rightPaddingBars = resolveVisibleRangeRightPaddingBars(
      visibleRange,
      chartBarsRef.current.length,
    );
    const visibleBars = visibleRange
      ? Math.max(1, Math.round(Math.max(1, (Number(visibleRange.to) - Number(visibleRange.from) + 1)) - rightPaddingBars))
      : null;
    const nextSignature = `${String(chartId || "chart")}:${source}:${buildTimeBoundsSignature(timeBounds)}:${rightPaddingBars.toFixed(2)}:${Number(visibleBars) || 0}`;
    if (!options.force && nextSignature === lastPublishedViewportSignatureRef.current) {
      return;
    }
    lastPublishedViewportSignatureRef.current = nextSignature;
    publishVisibleTimeBoundsChange({
      chartId: String(chartId || "chart"),
      timeBounds: {
        startMs,
        endMs,
      },
      source,
      rightPaddingBars,
      visibleBars,
    });
  }, [chartId]);
  const maybeRequestOlderHistory = React.useCallback((visibleRange = visibleLogicalRangeRef.current) => {
    if (
      typeof onRequestOlderHistoryRef.current !== "function"
      || !hasOlderHistoryRef.current
      || isLoadingOlderHistoryRef.current
    ) {
      return;
    }
    const barCount = chartBarsRef.current.length;
    if (!barCount) {
      return;
    }
    const clampedRange = clampVisibleLogicalRange(visibleRange, barCount);
    const visibleStart = Number(clampedRange?.from);
    const visibleEnd = Number(clampedRange?.to);
    const visibleSpanBars = Math.max(1, Math.ceil(visibleEnd) - Math.floor(visibleStart) + 1);
    const prefetchTriggerBars = Math.max(
      OLDER_HISTORY_EDGE_TRIGGER_BARS,
      Math.ceil(visibleSpanBars * 0.35),
    );
    const releaseTriggerBars = prefetchTriggerBars + 16;
    if (Number.isFinite(visibleStart) && visibleStart > releaseTriggerBars) {
      olderHistoryEdgeBlockedRef.current = false;
      olderHistoryRequestKeyRef.current = "";
      return;
    }
    if (!Number.isFinite(visibleStart) || visibleStart > prefetchTriggerBars) {
      return;
    }
    const currentIntent = userRangeIntentRef.current;
    const currentIntentAgeMs = Math.max(0, getNowMs() - (Number(currentIntent?.atMs) || 0));
    const prefetchDecision = resolveOlderHistoryPrefetchDecision({
      visibleRange: clampedRange,
      barCount,
      oldestBarTime: Number(chartBarsRef.current[0]?.time) || 0,
      currentIntentSource: currentIntent?.source,
      currentIntentAgeMs,
      userRangeIntentMaxAgeMs: USER_RANGE_INTENT_MAX_AGE_MS,
      edgeTriggerBars: OLDER_HISTORY_EDGE_TRIGGER_BARS,
      blocked: olderHistoryEdgeBlockedRef.current,
      lastRequestKey: olderHistoryRequestKeyRef.current,
    });
    if (prefetchDecision.action === "release") {
      olderHistoryEdgeBlockedRef.current = false;
      olderHistoryRequestKeyRef.current = "";
      return;
    }
    if (prefetchDecision.action !== "request") {
      return;
    }
    const requestKey = prefetchDecision.requestKey;
    const oldestBarTime = prefetchDecision.oldestBarTime;
    olderHistoryRequestKeyRef.current = requestKey;
    olderHistoryEdgeBlockedRef.current = true;
    Promise.resolve(onRequestOlderHistoryRef.current({
      reason: "left-edge-pan",
      chartId,
      visibleRange: clampedRange,
      oldestBarTime,
    }))
      .then(() => {
        const nextState = resolveOlderHistoryRequestSettleState({
          requestKey,
          currentRequestKey: olderHistoryRequestKeyRef.current,
          didFail: false,
        });
        olderHistoryRequestKeyRef.current = nextState.requestKey;
        olderHistoryEdgeBlockedRef.current = nextState.blocked;
      })
      .catch(() => {
        const nextState = resolveOlderHistoryRequestSettleState({
          requestKey,
          currentRequestKey: olderHistoryRequestKeyRef.current,
          didFail: true,
        });
        olderHistoryRequestKeyRef.current = nextState.requestKey;
        olderHistoryEdgeBlockedRef.current = nextState.blocked;
      });
  }, [chartId]);
  const clampedDefaultVisibleLogicalRange = useMemo(
    () => clampVisibleLogicalRange(defaultVisibleLogicalRange, chartBars.length),
    [chartBars.length, defaultVisibleLogicalRange],
  );
  const clampedDefaultVisibleLogicalRangeKey = useMemo(
    () => buildLogicalRangeSignature(clampedDefaultVisibleLogicalRange),
    [clampedDefaultVisibleLogicalRange?.from, clampedDefaultVisibleLogicalRange?.to],
  );
  const chartMountSignature = useMemo(() => buildResearchSpotChartMountSignature({
    hasBars,
    barCount: chartBars.length,
    selectedTradeId,
    hoveredTradeId,
    defaultVisibleLogicalRange,
    rangePresetKey,
    linkedViewportRequest,
    onVisibleTimeBoundsChange,
    onRuntimeHealthChange,
    pricePrecision,
    studySpecs,
    studyLowerPaneCount,
  }), [
    defaultVisibleLogicalRange,
    hasBars,
    hoveredTradeId,
    linkedViewportRequest,
    onRuntimeHealthChange,
    onVisibleTimeBoundsChange,
    pricePrecision,
    rangePresetKey,
    selectedTradeId,
    chartBars.length,
    studyLowerPaneCount,
    studySpecs,
  ]);
  const filteredTradeOverlays = useMemo(
    () => (Array.isArray(tradeOverlays) ? tradeOverlays : []),
    [tradeOverlays],
  );
  const tradeBySelectionId = useMemo(() => {
    const nextMap = new Map();
    for (const overlay of filteredTradeOverlays) {
      const tradeSelectionId = String(overlay?.tradeSelectionId || "").trim();
      if (tradeSelectionId) {
        nextMap.set(tradeSelectionId, overlay);
      }
    }
    return nextMap;
  }, [filteredTradeOverlays]);
  const tradeSelectionPickerEntries = useMemo(() => {
    const tradeIds = Array.isArray(tradeSelectionPicker?.tradeIds) ? tradeSelectionPicker.tradeIds : [];
    return tradeIds.map((tradeId, index) => {
      const overlay = tradeBySelectionId.get(tradeId) || null;
      return {
        tradeId,
        overlay,
        label: overlay ? formatOverlayTradeLabel(overlay) : "Trade " + (index + 1),
        detail: overlay ? formatTradeOutcomeDetail(overlay, resolvedPricePrecision) : "",
      };
    });
  }, [resolvedPricePrecision, tradeBySelectionId, tradeSelectionPicker]);
  const activeTradeSelectionId = selectedTradeId || null;
  const resolvedStudyVisibility = useMemo(
    () => (studyVisibility && typeof studyVisibility === "object" ? studyVisibility : {}),
    [studyVisibility],
  );
  const filteredIndicatorWindows = useMemo(
    () => (Array.isArray(indicatorWindows) ? indicatorWindows : []),
    [indicatorWindows],
  );
  const filteredIndicatorZones = useMemo(
    () => (Array.isArray(indicatorZones) ? indicatorZones : []),
    [indicatorZones],
  );
  const tradeMarkerModel = useMemo(
    () => buildTradeMarkers(tradeMarkerGroups, activeTradeSelectionId, hoveredTradeId, {
      bullColor: chartTheme.bull,
      bearColor: chartTheme.bear,
      withAlpha,
    }),
    [activeTradeSelectionId, chartTheme.bear, chartTheme.bull, hoveredTradeId, tradeMarkerGroups],
  );
  const indicatorMarkerModel = useMemo(
    () => resolveIndicatorMarkers(indicatorMarkerPayload, selectedTradeId, {
      bearColor: chartTheme.bear,
      signalBuyColor: chartTheme.signalBuy,
      getStrategyOverlayColor,
      withAlpha,
    }),
    [chartTheme.bear, chartTheme.signalBuy, indicatorMarkerPayload, selectedTradeId],
  );
  studySpecsRef.current = Array.isArray(studySpecs) ? studySpecs : [];
  studyLayoutRef.current = {
    lowerPaneCount: Math.max(0, Number(studyLowerPaneCount) || 0),
  };

  useEffect(() => {
    tradeBySelectionIdRef.current = tradeBySelectionId;
    selectedTradeIdRef.current = selectedTradeId;
    hoveredTradeIdRef.current = hoveredTradeId;
    activeTradeSelectionIdRef.current = activeTradeSelectionId;
  }, [activeTradeSelectionId, hoveredTradeId, selectedTradeId, tradeBySelectionId]);

  useEffect(() => {
    const hoverSnapshot = hoverStoreRef.current.getSnapshot();
    const normalizedHoveredTradeId = normalizeInteractionTradeId(hoveredTradeId);
    if (String(hoverSnapshot?.hoverTradeId || "") === String(normalizedHoveredTradeId || "")) {
      return;
    }
    hoverStoreRef.current.setSnapshot({
      hud: hoverSnapshot?.hud || null,
      hoverTradeId: normalizedHoveredTradeId,
    });
  }, [hoveredTradeId]);

  useEffect(() => {
    if (!tradeSelectionPicker) {
      return undefined;
    }
    const handleGlobalPointerDown = (event) => {
      const pickerNode = tradeSelectionPickerRef.current;
      if (pickerNode && pickerNode.contains(event.target)) {
        return;
      }
      dismissTradeSelectionPicker();
    };
    const handleGlobalKeyDown = (event) => {
      if (event.key === "Escape") {
        dismissTradeSelectionPicker();
      }
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown);
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handleGlobalPointerDown);
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [dismissTradeSelectionPicker, tradeSelectionPicker]);

  useEffect(() => {
    dismissTradeSelectionPicker();
  }, [dismissTradeSelectionPicker, selectedTradeId]);

  useEffect(() => {
    onRequestOlderHistoryRef.current = onRequestOlderHistory;
    hasOlderHistoryRef.current = hasOlderHistory;
    isLoadingOlderHistoryRef.current = isLoadingOlderHistory;
  }, [hasOlderHistory, isLoadingOlderHistory, onRequestOlderHistory]);

  useEffect(() => {
    onVisibleTimeBoundsChangeRef.current = onVisibleTimeBoundsChange;
    onRuntimeHealthChangeRef.current = onRuntimeHealthChange;
  }, [onRuntimeHealthChange, onVisibleTimeBoundsChange]);

  useEffect(() => {
    clampedDefaultVisibleLogicalRangeRef.current = clampedDefaultVisibleLogicalRange;
  }, [clampedDefaultVisibleLogicalRange]);

  const syncVisibleMarkers = React.useCallback(() => {
    const chart = chartRef.current;
    const markerApi = markerApiRef.current;
    if (!chart || !markerApi) {
      return;
    }
    const markerPayload = markerPayloadRef.current;
    const hasTradeMarkers = Number(markerPayload?.tradeMarkers?.count) > 0;
    const hasIndicatorMarkers = Boolean(markerPayload?.showSignals) && Number(markerPayload?.indicatorMarkers?.count) > 0;
    const hasSmcMarkers = Boolean(markerPayload?.showSmc) && Number(markerPayload?.smcMarkers?.count) > 0;
    if (!hasTradeMarkers && !hasIndicatorMarkers && !hasSmcMarkers) {
      if (visibleMarkersSignatureRef.current !== "empty") {
        visibleMarkersSignatureRef.current = "empty";
        markerApi.setMarkers([]);
        tradeMarkerSetCountRef.current += 1;
        emitRuntimeHealthChange();
      }
      return;
    }
    const visibleBarRange = toVisibleBarIndexRange(
      resolveActiveVisibleGlobalRange(),
      chartBarsRef.current.length,
      24,
    );
    const nextMarkers = [
      ...collectIndexedItems(markerPayload.tradeMarkers, visibleBarRange, (marker) => marker?.id)
        .filter((marker) => markerFallsWithinRange(marker, visibleBarRange)),
      ...(markerPayload.showSignals
        ? collectIndexedItems(markerPayload.indicatorMarkers, visibleBarRange, (marker) => marker?.id)
          .filter((marker) => markerFallsWithinRange(marker, visibleBarRange))
        : []),
      ...(markerPayload.showSmc
        ? collectIndexedItems(markerPayload.smcMarkers, visibleBarRange, (marker) => marker?.id)
          .filter((marker) => markerFallsWithinRange(marker, visibleBarRange))
        : []),
    ];
    const nextSignature = buildMarkerSetSignature(nextMarkers);
    if (nextSignature === visibleMarkersSignatureRef.current) {
      return;
    }
    visibleMarkersSignatureRef.current = nextSignature;
    markerApi.setMarkers(nextMarkers);
    tradeMarkerSetCountRef.current += 1;
    emitRuntimeHealthChange();
  }, [emitRuntimeHealthChange, resolveActiveVisibleGlobalRange]);
  const syncOverlayRects = React.useCallback(() => {
    const chart = chartRef.current;
    const overlayHost = overlayRef.current;
    const chartBarsSnapshot = chartBarsRef.current;
    if (!overlayHost) {
      return;
    }
    const hasOverlayWindows = Boolean(overlayPayloadRef.current.showZones)
      && Number(overlayPayloadRef.current.indicatorWindows?.count) > 0
      && chartBarsSnapshot.length > 0;
    if (!chart || !hasOverlayWindows) {
      if (lastOverlaySignatureRef.current !== "empty" || overlayNodeMapRef.current.size) {
        syncOverlayRectNodes(overlayHost, overlayNodeMapRef.current, []);
        lastOverlaySignatureRef.current = "empty";
        overlaySyncCountRef.current += 1;
        emitRuntimeHealthChange();
      }
      return;
    }

    const visibleBarRange = toVisibleBarIndexRange(
      resolveActiveVisibleGlobalRange(),
      chartBarsSnapshot.length,
      24,
    );
    const paneBounds = resolvePanePlotBounds(chart, overlayHost);
    const freshestCandleRightEdge = paneBounds
      ? estimateZoneEndCoordinate(chart, chartBarsSnapshot, chartBarsSnapshot.length - 1)
      : null;
    const overlayBounds = paneBounds
      ? {
        ...paneBounds,
        right: Number.isFinite(freshestCandleRightEdge)
          ? Math.min(paneBounds.right, freshestCandleRightEdge)
          : paneBounds.right,
      }
      : null;
    const nextWindowRects = [];
    if (!overlayBounds || overlayBounds.right <= overlayBounds.left) {
      const nextSignature = buildOverlayRectSignature(nextWindowRects);
      if (nextSignature !== lastOverlaySignatureRef.current) {
        syncOverlayRectNodes(overlayHost, overlayNodeMapRef.current, nextWindowRects);
        lastOverlaySignatureRef.current = nextSignature;
        overlaySyncCountRef.current += 1;
        emitRuntimeHealthChange();
      }
      return;
    }
    const visibleWindows = collectIndexedItems(
      overlayPayloadRef.current.indicatorWindows,
      visibleBarRange,
      (indicatorWindow) => indicatorWindow?.id,
    );
    const dominantWindows = resolveDominantIndicatorWindows(
      visibleWindows,
      visibleBarRange,
      getOverlayMergeGapBars(visibleBarRange, overlayBounds.right - overlayBounds.left),
    );
    for (const indicatorWindow of dominantWindows) {
      if (indicatorWindow?.startBarIndex == null || indicatorWindow?.endBarIndex == null) {
        continue;
      }
      if (visibleBarRange && (
        indicatorWindow.endBarIndex < visibleBarRange.from
        || indicatorWindow.startBarIndex > visibleBarRange.to
      )) {
        continue;
      }
      const startX = estimateBarStartCoordinate(chart, chartBarsSnapshot, indicatorWindow.startBarIndex);
      const endX = resolveWindowEndCoordinate(chart, chartBarsSnapshot, indicatorWindow);
      const clampedRect = clampOverlayRectToBounds(startX, endX, overlayBounds);
      if (!clampedRect) {
        continue;
      }
      const shadeColor = indicatorWindow.direction === "short" ? chartTheme.shadeBear : chartTheme.shadeBull;
      const conviction = Math.max(0, Number(indicatorWindow?.conviction) || 0);
      const fillAlpha = Math.min(0.2, 0.08 + conviction * 0.1);
      nextWindowRects.push({
        id: indicatorWindow.id,
        left: clampedRect.left,
        width: clampedRect.width,
        background: withAlpha(shadeColor, fillAlpha),
        edge: withAlpha(shadeColor, 0.22),
      });
    }
    const nextSignature = buildOverlayRectSignature(nextWindowRects);
    if (nextSignature === lastOverlaySignatureRef.current) {
      return;
    }
    syncOverlayRectNodes(overlayHost, overlayNodeMapRef.current, nextWindowRects);
    lastOverlaySignatureRef.current = nextSignature;
    overlaySyncCountRef.current += 1;
    emitRuntimeHealthChange();
  }, [chartTheme.shadeBear, chartTheme.shadeBull, emitRuntimeHealthChange, resolveActiveVisibleGlobalRange]);
  const syncOverlayZones = React.useCallback(() => {
    const chart = chartRef.current;
    const overlayHost = overlayRef.current;
    const candleSeries = candleSeriesRef.current;
    const chartBarsSnapshot = chartBarsRef.current;
    if (!overlayHost) {
      return;
    }
    const hasOverlayZones = Boolean(overlayPayloadRef.current.showZones)
      && Number(overlayPayloadRef.current.indicatorZones?.count) > 0
      && chartBarsSnapshot.length > 0;
    if (!chart || !candleSeries || !hasOverlayZones) {
      if (lastOverlayZoneSignatureRef.current !== "empty" || overlayZoneNodeMapRef.current.size) {
        syncOverlayZoneNodes(overlayHost, overlayZoneNodeMapRef.current, [], FONT_MONO);
        lastOverlayZoneSignatureRef.current = "empty";
        overlaySyncCountRef.current += 1;
        emitRuntimeHealthChange();
      }
      return;
    }

    const visibleBarRange = toVisibleBarIndexRange(
      resolveActiveVisibleGlobalRange(),
      chartBarsSnapshot.length,
      24,
    );
    const paneBounds = resolvePanePlotBounds(chart, overlayHost);
    const freshestCandleRightEdge = paneBounds
      ? estimateZoneEndCoordinate(chart, chartBarsSnapshot, chartBarsSnapshot.length - 1)
      : null;
    const overlayBounds = paneBounds
      ? {
        ...paneBounds,
        right: Number.isFinite(freshestCandleRightEdge)
          ? Math.min(paneBounds.right, freshestCandleRightEdge)
          : paneBounds.right,
      }
      : null;
    const nextZoneRects = [];
    if (!overlayBounds || overlayBounds.right <= overlayBounds.left || !Number.isFinite(overlayBounds.height)) {
      const nextSignature = buildOverlayZoneSignature(nextZoneRects);
      if (nextSignature !== lastOverlayZoneSignatureRef.current) {
        syncOverlayZoneNodes(overlayHost, overlayZoneNodeMapRef.current, nextZoneRects, FONT_MONO);
        lastOverlayZoneSignatureRef.current = nextSignature;
        overlaySyncCountRef.current += 1;
        emitRuntimeHealthChange();
      }
      return;
    }

    const visibleZones = reduceIndicatorZoneOverlaps(collectIndexedItems(
      overlayPayloadRef.current.indicatorZones,
      visibleBarRange,
      (indicatorZone) => indicatorZone?.id,
    ));
    for (const indicatorZone of visibleZones) {
      if (
        indicatorZone?.startBarIndex == null
        || indicatorZone?.endBarIndex == null
        || !Number.isFinite(Number(indicatorZone?.top))
        || !Number.isFinite(Number(indicatorZone?.bottom))
      ) {
        continue;
      }
      if (visibleBarRange && (
        indicatorZone.endBarIndex < visibleBarRange.from
        || indicatorZone.startBarIndex > visibleBarRange.to
      )) {
        continue;
      }
      const startX = estimateBarStartCoordinate(chart, chartBarsSnapshot, indicatorZone.startBarIndex);
      const endX = estimateZoneEndCoordinate(chart, chartBarsSnapshot, indicatorZone.endBarIndex);
      const topY = candleSeries.priceToCoordinate(Math.max(Number(indicatorZone.top), Number(indicatorZone.bottom)));
      const bottomY = candleSeries.priceToCoordinate(Math.min(Number(indicatorZone.top), Number(indicatorZone.bottom)));
      const clampedRect = clampOverlayBoxToBounds(startX, endX, topY, bottomY, overlayBounds);
      if (!clampedRect) {
        continue;
      }
      const direction = indicatorZone.direction === "short" ? "short" : "long";
      const zonePalette = indicatorZone.zoneType === "fair_value_gap"
        ? (direction === "short" ? chartTheme.gapBear : chartTheme.gapBull)
        : (direction === "short" ? chartTheme.zoneBear : chartTheme.zoneBull);
      const anchorVolumeRatio = Math.max(0, Number(indicatorZone?.meta?.anchorVolumeRatio) || 0);
      const zoneImportance = indicatorZone.zoneType === "order_block"
        ? Math.max(0, Math.min(1, (anchorVolumeRatio - 1) / 2))
        : 0;
      const label = indicatorZone.zoneType === "order_block"
        ? (
          anchorVolumeRatio >= 1.15
            ? `OB ${anchorVolumeRatio.toFixed(1)}x`
            : "OB"
        )
        : (indicatorZone.label || "FVG");
      nextZoneRects.push({
        id: indicatorZone.id,
        ...clampedRect,
        label,
        background: zonePalette.background,
        borderColor: zonePalette.border,
        innerBorder: zonePalette.innerBorder,
        borderStyle: indicatorZone.zoneType === "fair_value_gap" ? "dashed" : "solid",
        borderWidth: indicatorZone.zoneType === "order_block" && zoneImportance >= 0.45 ? 2 : 1,
        labelColor: zonePalette.labelColor,
        labelBackground: zonePalette.labelBackground,
        labelBorder: indicatorZone.zoneType === "order_block" && zoneImportance >= 0.45
          ? zonePalette.border
          : "transparent",
      });
    }
    const nextSignature = buildOverlayZoneSignature(nextZoneRects);
    if (nextSignature === lastOverlayZoneSignatureRef.current) {
      return;
    }
    syncOverlayZoneNodes(overlayHost, overlayZoneNodeMapRef.current, nextZoneRects, FONT_MONO);
    lastOverlayZoneSignatureRef.current = nextSignature;
    overlaySyncCountRef.current += 1;
    emitRuntimeHealthChange();
  }, [
    chartTheme.gapBear,
    chartTheme.gapBull,
    chartTheme.zoneBear,
    chartTheme.zoneBull,
    emitRuntimeHealthChange,
    resolveActiveVisibleGlobalRange,
  ]);
  const syncSelectedTradeActionOverlay = React.useCallback(() => {
    const overlayHost = tradeActionOverlayRef.current;
    const entryLeaderNode = tradeActionEntryLeaderRef.current;
    const connectorNode = tradeActionConnectorRef.current;
    const exitLeaderNode = tradeActionExitLeaderRef.current;
    const entryBadgeNode = tradeActionEntryBadgeRef.current;
    const exitBadgeNode = tradeActionExitBadgeRef.current;
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const chartBarsSnapshot = chartBarsRef.current;
    const currentSelectedTradeId = selectedTradeIdRef.current;
    const currentActiveTradeSelectionId = activeTradeSelectionIdRef.current;
    const currentHoveredTradeId = hoveredTradeIdRef.current;
    const selectedOverlay = currentActiveTradeSelectionId
      ? tradeBySelectionIdRef.current.get(currentActiveTradeSelectionId) || null
      : null;
    const shouldShowThresholdLines = tradeThresholdDisplay === "lines" || tradeThresholdDisplay === "active-lines";
    const thresholdOverlayTradeId = normalizeInteractionTradeId(
      shouldShowThresholdLines
        ? (
          tradeThresholdDisplay === "active-lines"
            ? (currentActiveTradeSelectionId || currentHoveredTradeId)
            : (currentHoveredTradeId || currentActiveTradeSelectionId)
        )
        : null,
    );
    const thresholdOverlay = thresholdOverlayTradeId
      ? tradeBySelectionIdRef.current.get(thresholdOverlayTradeId) || null
      : null;

    const hideAll = () => {
      if (!selectedTradeOverlayVisibleRef.current && selectedTradeOverlaySignatureRef.current === "hidden") {
        return;
      }
      setTradeActionConnectorNode(entryLeaderNode, { visible: false });
      setTradeActionConnectorNode(connectorNode, { visible: false });
      setTradeActionConnectorNode(exitLeaderNode, { visible: false });
      setTradeActionBadgeNode(entryBadgeNode, { visible: false });
      setTradeActionBadgeNode(exitBadgeNode, { visible: false });
      syncTradeThresholdNodes(overlayHost, tradeThresholdNodeMapRef.current, []);
      selectedTradeOverlayVisibleRef.current = false;
      selectedTradeOverlaySignatureRef.current = "hidden";
      selectedTradeOverlaySyncCountRef.current += 1;
      emitRuntimeHealthChange();
      publishDebugState(buildRangeDebugPayload({
        selectedTradeId: currentSelectedTradeId,
        activeTradeSelectionId: currentActiveTradeSelectionId,
        selectedTradeOverlayTradeId: selectedOverlay?.tradeSelectionId || currentActiveTradeSelectionId || null,
        selectedTradeThresholdTradeId: thresholdOverlay?.tradeSelectionId || thresholdOverlayTradeId || null,
        selectedTradeOverlayVisible: false,
      }));
    };

    if (!overlayHost || !entryLeaderNode || !connectorNode || !exitLeaderNode || !entryBadgeNode || !exitBadgeNode) {
      return;
    }
    if (!chart || !candleSeries || !chartBarsSnapshot.length) {
      hideAll();
      return;
    }

    const paneBounds = resolvePanePlotBounds(chart, overlayHost);
    const viewportWidth = Number(paneBounds?.width) || overlayHost.clientWidth;
    const viewportHeight = Number(paneBounds?.height) || overlayHost.clientHeight;
    if (!paneBounds || !viewportWidth || !viewportHeight) {
      hideAll();
      return;
    }

    const activeRenderWindow = renderWindowRef.current;
    const localBarCount = activeRenderWindow
      ? Math.max(0, Number(activeRenderWindow.end) - Number(activeRenderWindow.start) + 1)
      : chartBarsSnapshot.length;
    const localVisibleRange = clampVisibleLogicalRange(
      chart.timeScale?.().getVisibleLogicalRange?.(),
      localBarCount,
    ) || clampVisibleLogicalRange(
      visibleLogicalRangeRef.current,
      localBarCount,
    );
    const globalVisibleRange = toVisibleBarIndexRange(
      resolveActiveVisibleGlobalRange(),
      chartBarsSnapshot.length,
      0,
    ) || {
      from: 0,
      to: Math.max(0, chartBarsSnapshot.length - 1),
    };
    const selectedOverlayUsesLocalIndices = Boolean(
      activeRenderWindow
        && selectedOverlay
        && Number.isInteger(selectedOverlay?.entryBarIndex)
        && selectedOverlay.entryBarIndex >= 0
        && selectedOverlay.entryBarIndex < localBarCount,
    );
    const selectedOverlayChartBars = selectedOverlayUsesLocalIndices
      ? chartBarsSnapshot.slice(activeRenderWindow.start, activeRenderWindow.end + 1)
      : chartBarsSnapshot;
    const visibleBarRange = toVisibleBarIndexRange(
      selectedOverlayUsesLocalIndices ? localVisibleRange : resolveActiveVisibleGlobalRange(),
      selectedOverlayChartBars.length,
      0,
    ) || {
      from: 0,
      to: Math.max(0, selectedOverlayChartBars.length - 1),
    };

    let entryAnchor = null;
    let exitAnchor = null;
    let entryBadge = null;
    let exitBadge = null;
    let entryLabel = "";
    let exitLabel = "";
    let entryVisible = false;
    let exitVisible = false;
    let tradePath = "";
    let tradePathVisible = false;
    let entryLeaderPath = "";
    let entryLeaderVisible = false;
    let exitLeaderPath = "";
    let exitLeaderVisible = false;
    let tradeOutcomeDetail = "";

    if (selectedOverlay) {
      const direction = selectedOverlay.dir === "short" ? "short" : "long";
      const entryBarIndex = Number.isInteger(selectedOverlay.entryBarIndex) ? selectedOverlay.entryBarIndex : null;
      const exitBarIndex = Number.isInteger(selectedOverlay.exitBarIndex) ? selectedOverlay.exitBarIndex : null;
      const entryBar = entryBarIndex != null
        ? selectedOverlayChartBars[entryBarIndex] || null
        : null;
      const exitBar = exitBarIndex != null
        ? selectedOverlayChartBars[exitBarIndex] || null
        : null;
      const entryPlacement = resolveTradeActionPlacement("entry", direction);
      const exitPlacement = resolveTradeActionPlacement("exit", direction);
      const entryX = resolveTradeActionX(
        chart,
        selectedOverlayChartBars,
        entryBarIndex,
        visibleBarRange,
      );
      const exitX = resolveTradeActionX(
        chart,
        selectedOverlayChartBars,
        exitBarIndex,
        visibleBarRange,
      );
      const entryPrice = resolveOverlayEntryPrice(selectedOverlay);
      const exitPrice = resolveOverlayExitPrice(selectedOverlay);
      const entryAnchorX = clampTradeActionX(entryX, viewportWidth, 8);
      const exitAnchorX = clampTradeActionX(exitX, viewportWidth, 8);
      const entryAnchorY = entryBar
        ? resolveTradeActionAnchorY(candleSeries, entryBar, entryPlacement, viewportHeight, entryPrice)
        : null;
      const exitAnchorY = exitBar
        ? resolveTradeActionAnchorY(candleSeries, exitBar, exitPlacement, viewportHeight, exitPrice)
        : null;
      const entryCandleBounds = entryBar
        ? resolveTradeActionCandleBounds(candleSeries, entryBar, viewportHeight)
        : null;
      const exitCandleBounds = exitBar
        ? resolveTradeActionCandleBounds(candleSeries, exitBar, viewportHeight)
        : null;
      entryLabel = formatTradeEntryBadgeLabel(selectedOverlay, resolvedPricePrecision);
      exitLabel = formatTradeExitBadgeLabel(selectedOverlay, resolvedPricePrecision);
      entryAnchor = Number.isFinite(entryAnchorX) && Number.isFinite(entryAnchorY)
        ? { x: entryAnchorX, y: entryAnchorY }
        : null;
      exitAnchor = Number.isFinite(exitAnchorX) && Number.isFinite(exitAnchorY)
        ? { x: exitAnchorX, y: exitAnchorY }
        : null;
      entryBadge = entryAnchor
        ? resolveTradeActionBadgeLayout({
          anchorX: entryAnchor.x,
          anchorY: entryAnchor.y,
          placement: entryPlacement,
          preferredSide: "left",
          candleBounds: entryCandleBounds,
          label: entryLabel,
          node: entryBadgeNode,
          viewportWidth,
          viewportHeight,
        })
        : null;
      exitBadge = exitAnchor
        ? resolveTradeActionBadgeLayout({
          anchorX: exitAnchor.x,
          anchorY: exitAnchor.y,
          placement: exitPlacement,
          preferredSide: "right",
          candleBounds: exitCandleBounds,
          label: exitLabel,
          node: exitBadgeNode,
          viewportWidth,
          viewportHeight,
        })
        : null;
      const resolvedBadgeLayouts = resolveTradeActionBadgePairLayouts({
        entryBadge,
        exitBadge,
        entryBarIndex,
        exitBarIndex,
        viewportWidth,
        viewportHeight,
      });
      entryBadge = resolvedBadgeLayouts.entryBadge;
      exitBadge = resolvedBadgeLayouts.exitBadge;
      entryVisible = Boolean(entryAnchor && entryBadge);
      exitVisible = Boolean(exitAnchor && exitBadge);
      entryLeaderPath = entryVisible
        ? buildTradeActionLeaderPath({ x: entryBadge.attachX, y: entryBadge.attachY }, entryAnchor)
        : "";
      exitLeaderPath = exitVisible
        ? buildTradeActionLeaderPath(exitAnchor, { x: exitBadge.attachX, y: exitBadge.attachY })
        : "";
      entryLeaderVisible = Boolean(entryLeaderPath);
      exitLeaderVisible = Boolean(exitLeaderPath);
      const hasChronologicalPath = Boolean(entryAnchor && exitAnchor)
        && (!Number.isInteger(entryBarIndex) || !Number.isInteger(exitBarIndex) || exitBarIndex >= entryBarIndex);
      tradePath = hasChronologicalPath
        ? buildTradeActionConnectorPath({
          entryAnchor,
          exitAnchor,
        })
        : "";
      tradePathVisible = Boolean(tradePath);
      tradeOutcomeDetail = formatTradeOutcomeDetail(selectedOverlay, resolvedPricePrecision);
    }

    const thresholdLines = [];
    if (shouldShowThresholdLines && thresholdOverlay) {
      const thresholdOverlayUsesLocalIndices = Boolean(
        activeRenderWindow
          && Number.isInteger(thresholdOverlay?.entryBarIndex)
          && thresholdOverlay.entryBarIndex >= 0
          && thresholdOverlay.entryBarIndex < localBarCount,
      );
      const thresholdChartBars = thresholdOverlayUsesLocalIndices
        ? chartBarsSnapshot.slice(activeRenderWindow.start, activeRenderWindow.end + 1)
        : chartBarsSnapshot;
      const pathLines = buildTradeThresholdLinesFromPath({
        overlay: thresholdOverlay,
        chart,
        chartBars: thresholdChartBars,
        paneBounds,
        candleSeries,
        viewportHeight,
        pricePrecision: resolvedPricePrecision,
      });
      if (pathLines.length) {
        thresholdLines.push(...pathLines);
      } else {
        const thresholdDescriptors = buildTradeThresholdLineDescriptors(thresholdOverlay, resolvedPricePrecision);
        const thresholdStartIndex = Number.isInteger(thresholdOverlay.entryBarIndex)
          ? Math.max(0, Math.min(thresholdChartBars.length - 1, thresholdOverlay.entryBarIndex))
          : null;
        const thresholdEndIndex = Number.isInteger(thresholdOverlay.exitBarIndex)
          ? Math.max(0, Math.min(thresholdChartBars.length - 1, thresholdOverlay.exitBarIndex))
          : thresholdStartIndex;
        if (thresholdStartIndex != null && thresholdEndIndex != null) {
          const startX = estimateBarStartCoordinate(chart, thresholdChartBars, thresholdStartIndex);
          const endX = resolveWindowEndCoordinate(chart, thresholdChartBars, { endBarIndex: thresholdEndIndex });
          const freshestEndX = estimateZoneEndCoordinate(chart, thresholdChartBars, thresholdChartBars.length - 1);
          const boundedEndX = Number.isFinite(endX) && Number.isFinite(freshestEndX)
            ? Math.min(endX, freshestEndX)
            : (Number.isFinite(endX) ? endX : freshestEndX);
          const clampedRect = clampOverlayRectToBounds(startX, boundedEndX, paneBounds);
          if (clampedRect) {
            for (const descriptor of thresholdDescriptors) {
              const y = candleSeries.priceToCoordinate(descriptor.value);
              if (!Number.isFinite(y) || y < 0 || y > viewportHeight) {
                continue;
              }
              const valueLabel = formatPrice(descriptor.value, resolvedPricePrecision);
              thresholdLines.push({
                id: (thresholdOverlay.tradeSelectionId || thresholdOverlay.id || "trade") + ":" + descriptor.id,
                left: clampedRect.left,
                top: y,
                width: clampedRect.width,
                label: descriptor.label + " " + valueLabel,
                title: formatOverlayTradeLabel(thresholdOverlay) + " · " + descriptor.label + " " + valueLabel,
                color: descriptor.color,
                style: descriptor.style,
                opacity: descriptor.id === "trail-arm" ? 0.72 : descriptor.id === "exit-trigger" ? 0.76 : 0.82,
              });
            }
          }
        }
      }
    }

    const thresholdSignature = buildTradeThresholdSignature(thresholdLines);
    const overlayVisible = tradePathVisible || entryLeaderVisible || exitLeaderVisible || entryVisible || exitVisible || thresholdLines.length > 0;
    const nextOverlaySignature = buildSelectedTradeOverlaySignature({
      visible: overlayVisible,
      entryAnchorX: entryAnchor?.x,
      entryAnchorY: entryAnchor?.y,
      entryBadgeLeft: entryBadge?.left,
      entryBadgeTop: entryBadge?.top,
      entryLabel,
      exitAnchorX: exitAnchor?.x,
      exitAnchorY: exitAnchor?.y,
      exitBadgeLeft: exitBadge?.left,
      exitBadgeTop: exitBadge?.top,
      exitLabel,
      tradePath,
      entryLeaderPath,
      exitLeaderPath,
      thresholdSignature,
    });
    const hiddenOverlayDebugPayload = {
      selectedTradeId: currentSelectedTradeId,
      activeTradeSelectionId: currentActiveTradeSelectionId,
      selectedTradeOverlayTradeId: selectedOverlay?.tradeSelectionId || currentActiveTradeSelectionId || null,
      selectedTradeThresholdTradeId: thresholdOverlay?.tradeSelectionId || thresholdOverlayTradeId || null,
      selectedTradeOverlayVisible: overlayVisible,
      selectedTradeOverlayEntryVisible: entryVisible,
      selectedTradeOverlayExitVisible: exitVisible,
      selectedTradeOverlayThresholdVisible: thresholdLines.length > 0,
      selectedTradeOverlayEntryBarIndex: Number.isInteger(selectedOverlay?.entryBarIndex) ? selectedOverlay.entryBarIndex : null,
      selectedTradeOverlayExitBarIndex: Number.isInteger(selectedOverlay?.exitBarIndex) ? selectedOverlay.exitBarIndex : null,
      selectedTradeOverlayVisibleBarRange: visibleBarRange,
      selectedTradeOverlayUsesLocalIndices: selectedOverlayUsesLocalIndices,
      selectedTradeOverlayGlobalVisibleBarRange: globalVisibleRange,
      selectedTradeOverlayEntryAnchor: entryAnchor,
      selectedTradeOverlayExitAnchor: exitAnchor,
      selectedTradeOverlayEntryPrice: resolveOverlayEntryPrice(selectedOverlay),
      selectedTradeOverlayExitPrice: resolveOverlayExitPrice(selectedOverlay),
    };
    if (nextOverlaySignature === selectedTradeOverlaySignatureRef.current) {
      if (!overlayVisible && (selectedOverlay || thresholdOverlay)) {
        publishDebugState(buildRangeDebugPayload(hiddenOverlayDebugPayload));
      }
      return;
    }

    const direction = selectedOverlay?.dir === "short" ? "short" : "long";
    const entryColor = direction === "short" ? "#dc2626" : "#059669";
    const exitPositive = Number(selectedOverlay?.pnl) >= 0;
    const exitColor = exitPositive ? "#059669" : "#dc2626";

    setTradeActionBadgeNode(entryBadgeNode, {
      visible: entryVisible,
      left: entryBadge?.left,
      top: entryBadge?.top,
      label: entryLabel,
      title: tradeOutcomeDetail
        ? `${formatOverlayTradeLabel(selectedOverlay)} · ${tradeOutcomeDetail}`
        : formatOverlayTradeLabel(selectedOverlay),
      color: "#f8fafc",
      background: withAlpha(entryColor, 0.94),
      border: withAlpha(entryColor, 0.78),
    });
    setTradeActionBadgeNode(exitBadgeNode, {
      visible: exitVisible,
      left: exitBadge?.left,
      top: exitBadge?.top,
      label: exitLabel,
      title: tradeOutcomeDetail,
      color: "#f8fafc",
      background: withAlpha(exitColor, 0.94),
      border: withAlpha(exitColor, 0.78),
    });
    setTradeActionConnectorNode(entryLeaderNode, {
      visible: entryLeaderVisible,
      path: entryLeaderPath,
      color: withAlpha(entryColor, 0.42),
    });
    setTradeActionConnectorNode(connectorNode, {
      visible: tradePathVisible,
      path: tradePath,
      color: exitVisible ? withAlpha(exitColor, 0.54) : withAlpha(entryColor, 0.54),
    });
    setTradeActionConnectorNode(exitLeaderNode, {
      visible: exitLeaderVisible,
      path: exitLeaderPath,
      color: withAlpha(exitColor, 0.42),
    });
    syncTradeThresholdNodes(overlayHost, tradeThresholdNodeMapRef.current, thresholdLines);
    selectedTradeOverlayVisibleRef.current = overlayVisible;
    selectedTradeOverlaySignatureRef.current = nextOverlaySignature;
    selectedTradeOverlaySyncCountRef.current += 1;
    emitRuntimeHealthChange();
    publishDebugState(buildRangeDebugPayload(hiddenOverlayDebugPayload));
  }, [
    buildRangeDebugPayload,
    emitRuntimeHealthChange,
    resolveActiveVisibleGlobalRange,
    resolvedPricePrecision,
    tradeThresholdDisplay,
  ]);
  const safeSyncSelectedTradeActionOverlay = React.useCallback(() => {
    try {
      syncSelectedTradeActionOverlay();
    } catch (error) {
      reportChartRuntimeError("selected-trade-overlay", error);
    }
  }, [reportChartRuntimeError, syncSelectedTradeActionOverlay]);
  const scheduleVisibleRangeClamp = React.useCallback((nextLocalRange, nextGlobalRange, options = {}) => {
    if (!nextLocalRange) {
      return;
    }
    const owner = options?.owner === "user" || options?.owner === "preset"
      ? options.owner
      : rangeOwnerRef.current;
    const source = String(options?.source || rangeWriteSourceRef.current || owner);
    if (visibleRangeEnforcementFrameRef.current != null) {
      cancelAnimationFrame(visibleRangeEnforcementFrameRef.current);
    }
    visibleRangeEnforcementFrameRef.current = requestAnimationFrame(() => {
      visibleRangeEnforcementFrameRef.current = null;
      const activeRenderWindow = renderWindowRef.current;
      setProgrammaticVisibleRange(nextLocalRange, nextGlobalRange, {
        owner,
        source,
        renderWindow: activeRenderWindow,
      });
    });
  }, [setProgrammaticVisibleRange]);

  const schedulePresentationSync = React.useCallback((options = {}) => {
    if (options?.defer) {
      const delayMs = Math.max(0, Number(options?.delayMs) || PRESENTATION_SYNC_DEFER_MS);
      const shouldReassertVisibleRange = Boolean(options?.reassertVisibleRange);
      if (presentationIdleTimerRef.current != null) {
        clearTimeout(presentationIdleTimerRef.current);
      }
      presentationIdleTimerRef.current = setTimeout(() => {
        presentationIdleTimerRef.current = null;
        pendingPresentationModeRef.current = "light";
        if (shouldReassertVisibleRange) {
          const barCount = chartBarsRef.current.length;
          const globalRange = clampVisibleLogicalRange(
            visibleLogicalRangeRef.current,
            barCount,
          );
          const localRange = renderWindowRef.current
            ? globalToLocalLogicalRange(globalRange, renderWindowRef.current, barCount)
            : globalRange;
          if (globalRange && localRange) {
            scheduleVisibleRangeClamp(localRange, globalRange, {
              owner: rangeOwnerRef.current,
              source: rangeWriteSourceRef.current,
            });
          }
        }
        schedulePresentationSync();
      }, delayMs);
      return;
    }
    const requestedMode = options?.skipHeavyOverlays ? "light" : "full";
    pendingPresentationModeRef.current = requestedMode === "full"
      ? "full"
      : (pendingPresentationModeRef.current === "full" ? "full" : "light");
    if (presentationIdleTimerRef.current != null) {
      clearTimeout(presentationIdleTimerRef.current);
      presentationIdleTimerRef.current = null;
    }
    if (presentationFrameRef.current != null) {
      return;
    }
    presentationFrameRef.current = requestAnimationFrame(() => {
      presentationFrameRef.current = null;
      const syncMode = pendingPresentationModeRef.current === "light" ? "light" : "full";
      pendingPresentationModeRef.current = "light";
      const markerPayload = markerPayloadRef.current;
      const hasMarkerWork = Number(markerPayload?.tradeMarkers?.count) > 0
        || (Boolean(markerPayload?.showSignals) && Number(markerPayload?.indicatorMarkers?.count) > 0)
        || (Boolean(markerPayload?.showSmc) && Number(markerPayload?.smcMarkers?.count) > 0)
        || visibleMarkersSignatureRef.current !== "empty";
      const hasOverlayRectWork = (
        Boolean(overlayPayloadRef.current.showZones) && Number(overlayPayloadRef.current.indicatorWindows?.count) > 0
      ) || lastOverlaySignatureRef.current !== "empty";
      const hasOverlayZoneWork = (
        Boolean(overlayPayloadRef.current.showZones) && Number(overlayPayloadRef.current.indicatorZones?.count) > 0
      ) || lastOverlayZoneSignatureRef.current !== "empty";
      const hasSelectedTradeOverlayWork = Boolean(activeTradeSelectionIdRef.current) || selectedTradeOverlayVisibleRef.current;
      if (hasMarkerWork) {
        syncVisibleMarkers();
      }
      if (hasOverlayRectWork) {
        syncOverlayRects();
      }
      if (hasOverlayZoneWork && syncMode === "full") {
        syncOverlayZones();
      }
      if (hasSelectedTradeOverlayWork) {
        safeSyncSelectedTradeActionOverlay();
      }
    });
  }, [safeSyncSelectedTradeActionOverlay, scheduleVisibleRangeClamp, syncOverlayRects, syncOverlayZones, syncVisibleMarkers]);

  const scheduleInteractionPresentationSync = React.useCallback((source = userRangeIntentRef.current?.source) => {
    const normalizedSource = String(source || "").trim().toLowerCase();
    if (isDeferredPresentationSource(normalizedSource)) {
      schedulePresentationSync({ skipHeavyOverlays: true });
      schedulePresentationSync({
        defer: true,
        delayMs: resolveDeferredPresentationDelayMs(normalizedSource, PRESENTATION_DELAY_CONFIG),
        reassertVisibleRange: shouldReassertVisibleRangeOnIdle(normalizedSource),
      });
      return;
    }
    schedulePresentationSync();
  }, [schedulePresentationSync]);
  const scheduleResizePresentationSync = React.useCallback(() => {
    const host = hostRef.current;
    const nextWidth = Math.round(Number(host?.clientWidth) || 0);
    const nextHeight = Math.round(Number(host?.clientHeight) || 0);
    if (!nextWidth || !nextHeight) {
      return;
    }
    const previousSize = lastObservedHostSizeRef.current;
    if (previousSize.width === nextWidth && previousSize.height === nextHeight) {
      return;
    }
    lastObservedHostSizeRef.current = {
      width: nextWidth,
      height: nextHeight,
    };
    const barCount = chartBarsRef.current.length;
    const preservedGlobalRange = clampVisibleLogicalRange(
      visibleLogicalRangeRef.current,
      barCount,
    ) || clampVisibleLogicalRange(
      lastStableUserVisibleRangeRef.current,
      barCount,
    ) || clampedDefaultVisibleLogicalRangeRef.current;
    chartRef.current?.resize(nextWidth, nextHeight);
    if (resizePresentationTimerRef.current != null) {
      clearTimeout(resizePresentationTimerRef.current);
    }
    resizePresentationTimerRef.current = setTimeout(() => {
      resizePresentationTimerRef.current = null;
      if (preservedGlobalRange) {
        const preservedLocalRange = renderWindowRef.current
          ? globalToLocalLogicalRange(preservedGlobalRange, renderWindowRef.current, chartBarsRef.current.length)
          : preservedGlobalRange;
        if (preservedLocalRange) {
          scheduleVisibleRangeClamp(preservedLocalRange, preservedGlobalRange, {
            owner: rangeOwnerRef.current,
            source: "resize",
          });
        }
      }
      schedulePresentationSync();
    }, RESIZE_PRESENTATION_SYNC_DEBOUNCE_MS);
  }, [schedulePresentationSync, scheduleVisibleRangeClamp]);

  const syncStudiesForRenderWindow = React.useCallback((targetRenderWindow = renderWindowRef.current, options = {}) => {
    const chart = chartRef.current;
    if (!chart) {
      return 0;
    }

    const currentStudySpecs = studySpecsRef.current;
    const lowerPaneCount = Math.max(0, Number(studyLayoutRef.current.lowerPaneCount) || 0);
    const renderWindowSignature = buildRenderWindowSignature(targetRenderWindow, chartBarsRef.current.length);
    const previousSync = lastStudySyncRef.current;
    const shouldForce = Boolean(options.force);

    if (!shouldForce
      && previousSync.renderWindowSignature === renderWindowSignature
      && previousSync.studySpecs === currentStudySpecs
      && previousSync.lowerPaneCount === lowerPaneCount) {
      return previousSync.studyCount;
    }

    const studySyncStart = import.meta.env.DEV ? performance.now() : 0;
    const renderedStudySpecs = targetRenderWindow
      ? sliceStudySpecs(currentStudySpecs, targetRenderWindow)
      : currentStudySpecs;
    syncStudySeriesSet(chart, studySeriesRef, renderedStudySpecs);
    const panes = chart.panes();
    if (panes[0]) {
      panes[0].setStretchFactor(lowerPaneCount > 0 ? 3 : 1);
    }
    for (let paneIndex = 1; paneIndex < panes.length; paneIndex += 1) {
      panes[paneIndex].setStretchFactor(paneIndex <= lowerPaneCount ? 1 : 0);
    }
    lastStudySyncRef.current = {
      renderWindowSignature,
      studySpecs: currentStudySpecs,
      lowerPaneCount,
      studyCount: renderedStudySpecs.length,
    };

    if (import.meta.env.DEV) {
      const durationMs = performance.now() - studySyncStart;
      if (durationMs >= 12) {
        console.debug("[ResearchChart] study sync", {
          durationMs,
          studies: renderedStudySpecs.length,
        });
      }
    }

    return renderedStudySpecs.length;
  }, []);

  const clearRenderWindowTransition = React.useCallback(() => {
    renderWindowTransitionRef.current = null;
  }, []);

  const applyRenderWindow = React.useCallback((targetGlobalRange = null, options = {}) => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const fullChartBars = chartBarsRef.current;
    const barCount = fullChartBars.length;
    if (!chart || !candleSeries || !volumeSeries || !barCount) {
      return null;
    }

    const nextRangeOwner = options.owner === "user" || options.owner === "preset"
      ? options.owner
      : rangeOwnerRef.current;
    const nextRangeSource = String(options.source || rangeWriteSourceRef.current || nextRangeOwner);
    applyRangeState(nextRangeOwner, nextRangeSource);

    const nextGlobalRange = clampVisibleLogicalRange(
      targetGlobalRange || visibleLogicalRangeRef.current,
      barCount,
    ) || {
      from: 0,
      to: Math.max(0, barCount - 1),
    };
    const currentBaseSeriesMode = baseSeriesModeRef.current;
    const nextBaseSeriesMode = resolveBaseSeriesMode(
      barCount,
      currentBaseSeriesMode,
      baseSeriesModeLimitsRef.current,
    );
    const shouldUseRenderWindow = baseSeriesModeUsesRenderWindowUtil(nextBaseSeriesMode);
    const nextRenderWindow = shouldUseRenderWindow
      ? buildRenderWindowSpec(nextGlobalRange, barCount, baseSeriesModeLimitsRef.current?.renderWindowMaxBars)
      : null;
    if (shouldUseRenderWindow && !nextRenderWindow) {
      return null;
    }

    const forceRefresh = Boolean(options.force);
    const currentRenderWindow = renderWindowRef.current;
    const previousRenderWindow = currentRenderWindow ? { ...currentRenderWindow } : null;
    const previousGlobalRange = clampVisibleLogicalRange(visibleLogicalRangeRef.current, barCount);
    const renderWindowChanged = shouldUseRenderWindow
      ? !renderWindowMatches(currentRenderWindow, nextRenderWindow)
      : currentBaseSeriesMode !== nextBaseSeriesMode;
    const shouldRebuildSeries = forceRefresh
      || currentBaseSeriesMode !== nextBaseSeriesMode
      || renderWindowChanged;
    if (shouldRebuildSeries) {
      let baseData = null;
      if (nextBaseSeriesMode === "full-series") {
        let fullBaseDataCache = fullBaseDataCacheRef.current;
        if (fullBaseDataCache.signature !== buildBarSignature(fullChartBars) || fullBaseDataCache.barCount !== barCount) {
          fullBaseDataCache = buildBaseDataCache(fullChartBars, fullBaseDataCache, {
            toChartTime,
            buildBarSignature,
            upVolumeColor: volumeBullColor,
            downVolumeColor: volumeBearColor,
          });
          fullBaseDataCacheRef.current = fullBaseDataCache;
        }
        baseData = sliceBaseDataCache(fullBaseDataCache, null);
      } else {
        if (nextBaseSeriesMode === "full-cache-window") {
          let fullBaseDataCache = fullBaseDataCacheRef.current;
          if (fullBaseDataCache.signature !== buildBarSignature(fullChartBars) || fullBaseDataCache.barCount !== barCount) {
            fullBaseDataCache = buildBaseDataCache(fullChartBars, fullBaseDataCache, {
              toChartTime,
              buildBarSignature,
              upVolumeColor: volumeBullColor,
              downVolumeColor: volumeBearColor,
            });
            fullBaseDataCacheRef.current = fullBaseDataCache;
          }
          baseData = sliceBaseDataCache(fullBaseDataCache, nextRenderWindow);
        } else {
          const renderedBars = fullChartBars.slice(nextRenderWindow.start, nextRenderWindow.end + 1);
          baseData = buildBaseDataCache(renderedBars, renderWindowBaseDataCacheRef.current, {
            toChartTime,
            buildBarSignature,
            upVolumeColor: volumeBullColor,
            downVolumeColor: volumeBearColor,
          });
          renderWindowBaseDataCacheRef.current = baseData;
        }
        if (currentRenderWindow && nextRenderWindow && !renderWindowMatches(currentRenderWindow, nextRenderWindow)) {
          baseSeriesWindowSwapCountRef.current += 1;
        }
      }
      interactionRef.current = {
        ...interactionRef.current,
        volumeByTime: baseData.volumeByTime,
      };
      candleSeries.setData(baseData.candleData);
      volumeSeries.setData(showVolumeCandles ? buildHiddenVolumeData(baseData.volumeData) : baseData.volumeData);
      volumeCandlePrimitiveRef.current?.setData(baseData.candleData, baseData.volumeByTime, {
        visible: showVolumeCandles,
        upColor: candleBullColor,
        downColor: candleBearColor,
      });
      volumePanePrimitiveRef.current?.setData(baseData.candleData, baseData.volumeByTime, {
        visible: showVolumeCandles,
        upColor: candleBullColor,
        downColor: candleBearColor,
        volumeUpColor: volumeBullColor,
        volumeDownColor: volumeBearColor,
      });
      baseSeriesSetDataCountRef.current += 1;
      renderWindowRef.current = shouldUseRenderWindow ? nextRenderWindow : null;
      baseSeriesModeRef.current = nextBaseSeriesMode;
      syncStudiesForRenderWindow(renderWindowRef.current, { force: true });
    }

    const activeRenderWindow = renderWindowRef.current || nextRenderWindow;
    const renderWindowTransitionChanged = currentBaseSeriesMode !== nextBaseSeriesMode
      || !renderWindowMatches(previousRenderWindow, activeRenderWindow);
    renderWindowTransitionRef.current = renderWindowTransitionChanged
      ? {
        previousRenderWindow,
        nextRenderWindow: activeRenderWindow ? { ...activeRenderWindow } : null,
        previousGlobalRange,
        nextGlobalRange,
        issuedAtMs: getNowMs(),
      }
      : null;
    activeBarCountRef.current = shouldUseRenderWindow
      ? Math.max(0, Number(activeRenderWindow?.size) || 0)
      : barCount;
    activeBarCapRef.current = resolveActiveBarCap(nextBaseSeriesMode, baseSeriesModeLimitsRef.current, barCount);
    const nextLocalRange = shouldUseRenderWindow
      ? globalToLocalLogicalRange(nextGlobalRange, activeRenderWindow, barCount)
      : nextGlobalRange;
    if (nextLocalRange) {
      setProgrammaticVisibleRange(nextLocalRange, nextGlobalRange, {
        owner: nextRangeOwner,
        source: nextRangeSource,
        renderWindow: activeRenderWindow,
      });
      visibleLogicalRangeRef.current = nextGlobalRange;
      syncVisibleTimeBounds(nextGlobalRange);
      if (nextRangeOwner === "user" && shouldCaptureStableUserViewport(nextRangeSource)) {
        rememberStableUserViewport(nextGlobalRange, visibleTimeBoundsRef.current);
      }
    } else {
      const fallbackGlobalRange = clampVisibleLogicalRange(previousGlobalRange, barCount)
        || clampVisibleLogicalRange(visibleLogicalRangeRef.current, barCount)
        || clampVisibleLogicalRange(lastStableUserVisibleRangeRef.current, barCount)
        || nextGlobalRange;
      const fallbackLocalRange = activeRenderWindow
        ? globalToLocalLogicalRange(fallbackGlobalRange, activeRenderWindow, barCount)
        : fallbackGlobalRange;
      if (fallbackLocalRange && fallbackGlobalRange) {
        setProgrammaticVisibleRange(fallbackLocalRange, fallbackGlobalRange, {
          owner: nextRangeOwner,
          source: nextRangeSource,
          renderWindow: activeRenderWindow,
        });
        visibleLogicalRangeRef.current = fallbackGlobalRange;
        syncVisibleTimeBounds(fallbackGlobalRange);
        if (nextRangeOwner === "user" && shouldCaptureStableUserViewport(nextRangeSource)) {
          rememberStableUserViewport(fallbackGlobalRange, visibleTimeBoundsRef.current);
        }
      } else if (nextRangeOwner === "user") {
        const preservedUserGlobalRange = clampVisibleLogicalRange(previousGlobalRange, barCount)
          || clampVisibleLogicalRange(visibleLogicalRangeRef.current, barCount)
          || clampVisibleLogicalRange(lastStableUserVisibleRangeRef.current, barCount);
        if (preservedUserGlobalRange) {
          visibleLogicalRangeRef.current = preservedUserGlobalRange;
          syncVisibleTimeBounds(preservedUserGlobalRange);
          if (shouldCaptureStableUserViewport(nextRangeSource)) {
            rememberStableUserViewport(preservedUserGlobalRange, visibleTimeBoundsRef.current);
          }
        }
        programmaticVisibleRangeRef.current = null;
      } else {
        chart.timeScale().fitContent();
        const fittedLocalRange = clampVisibleLogicalRange(
          chart.timeScale().getVisibleLogicalRange?.(),
          activeRenderWindow?.size || barCount,
        );
        visibleLogicalRangeRef.current = localToGlobalLogicalRange(
          fittedLocalRange,
          activeRenderWindow,
          barCount,
        );
        syncVisibleTimeBounds(visibleLogicalRangeRef.current);
        if (nextRangeOwner === "user" && shouldCaptureStableUserViewport(nextRangeSource)) {
          rememberStableUserViewport(visibleLogicalRangeRef.current, visibleTimeBoundsRef.current);
        }
        programmaticVisibleRangeRef.current = fittedLocalRange
          ? {
            range: fittedLocalRange,
            globalRange: visibleLogicalRangeRef.current,
            owner: nextRangeOwner,
            source: nextRangeSource,
            issuedAtMs: getNowMs(),
            renderWindow: activeRenderWindow ? { ...activeRenderWindow } : null,
            renderWindowSignature: buildRenderWindowSignature(activeRenderWindow, barCount),
          }
          : null;
      }
    }

    schedulePresentationSync({
      defer: isDeferredPresentationSource(nextRangeSource),
      delayMs: resolveDeferredPresentationDelayMs(nextRangeSource, PRESENTATION_DELAY_CONFIG),
      reassertVisibleRange: shouldReassertVisibleRangeOnIdle(nextRangeSource),
    });
    publishDebugState(buildRangeDebugPayload({
      barCount,
      activeBarCount: activeBarCountRef.current,
      activeBarCap: activeBarCapRef.current,
      baseDataMode: nextBaseSeriesMode,
      baseSeriesSetDataCount: baseSeriesSetDataCountRef.current,
      baseSeriesWindowSwapCount: baseSeriesWindowSwapCountRef.current,
      tradeMarkerSetCount: tradeMarkerSetCountRef.current,
      overlaySyncCount: overlaySyncCountRef.current,
      selectedTradeOverlaySyncCount: selectedTradeOverlaySyncCountRef.current,
      renderWindow: activeRenderWindow,
      visibleLogicalRange: visibleLogicalRangeRef.current,
      requestedGlobalRange: nextGlobalRange,
      rangePresetKey: rangePresetKeyRef.current,
    }));
    emitRuntimeHealthChange({
      loadedBarCount: barCount,
      activeBarCount: activeBarCountRef.current,
      activeBarCap: activeBarCapRef.current,
      baseDataMode: nextBaseSeriesMode,
    });
    return {
      renderWindow: activeRenderWindow,
      globalRange: visibleLogicalRangeRef.current,
    };
  }, [
    applyRangeState,
    buildRangeDebugPayload,
    emitRuntimeHealthChange,
    emitVisibleTimeBoundsChange,
    schedulePresentationSync,
    setProgrammaticVisibleRange,
    syncStudiesForRenderWindow,
    syncVisibleTimeBounds,
    chartTheme.volumeBear,
    chartTheme.volumeBull,
    shouldCaptureStableUserViewport,
  ]);

  useEffect(() => {
    if (!shouldAutoFocusSelectedTradeViewport({
      autoFocusSelectedTrade,
      selectedTradeId,
      chartId,
      selectedTradeSourceChartId,
    })) {
      lastSelectionFocusTradeIdRef.current = null;
      return;
    }
    const normalizedSelectedTradeId = typeof selectedTradeId === "string" && selectedTradeId.trim()
      ? selectedTradeId.trim()
      : null;
    if (!normalizedSelectedTradeId) {
      lastSelectionFocusTradeIdRef.current = null;
      return;
    }
    if (lastSelectionFocusTradeIdRef.current === normalizedSelectedTradeId) {
      return;
    }
    if (!chartRef.current || !chartBars.length) {
      return;
    }
    const selectedOverlay = tradeBySelectionId.get(normalizedSelectedTradeId) || null;
    if (!selectedOverlay) {
      return;
    }
    const entryBarIndex = Number.isInteger(selectedOverlay?.entryBarIndex)
      ? selectedOverlay.entryBarIndex
      : null;
    if (entryBarIndex == null) {
      return;
    }
    const exitBarIndex = Number.isInteger(selectedOverlay?.exitBarIndex)
      ? Math.max(entryBarIndex, selectedOverlay.exitBarIndex)
      : entryBarIndex;
    const currentVisibleRange = clampVisibleLogicalRange(
      resolveActiveVisibleGlobalRange() || clampedDefaultVisibleLogicalRangeRef.current,
      chartBars.length,
    );
    const tradeAlreadyVisible = currentVisibleRange
      && exitBarIndex >= Number(currentVisibleRange?.from)
      && entryBarIndex <= Number(currentVisibleRange?.to);
    lastSelectionFocusTradeIdRef.current = normalizedSelectedTradeId;
    if (tradeAlreadyVisible) {
      return;
    }
    const nextGlobalRange = buildSelectedTradeFocusRange({
      overlay: selectedOverlay,
      chartBarsLength: chartBars.length,
      currentVisibleRange,
    });
    if (!nextGlobalRange) {
      return;
    }
    selectionViewportLockUntilRef.current = getNowMs() + SELECTION_VIEWPORT_LOCK_MS;
    clearUserRangeIntent("selection");
    applyRenderWindow(nextGlobalRange, {
      force: false,
      owner: "user",
      source: "selection",
    });
  }, [
    autoFocusSelectedTrade,
    applyRenderWindow,
    chartId,
    chartBars.length,
    clearUserRangeIntent,
    resolveActiveVisibleGlobalRange,
    selectedTradeSourceChartId,
    selectedTradeId,
    tradeBySelectionId,
  ]);

  const scheduleRenderWindowRefresh = React.useCallback((targetGlobalRange = null, options = {}) => {
    const barCount = chartBarsRef.current.length;
    const nextGlobalRange = clampVisibleLogicalRange(
      targetGlobalRange || visibleLogicalRangeRef.current,
      barCount,
    );
    if (!nextGlobalRange && !options.force) {
      return;
    }
    pendingRenderWindowRef.current = {
      range: nextGlobalRange,
      force: pendingRenderWindowRef.current.force || Boolean(options.force),
      owner: options.owner === "user" || options.owner === "preset"
        ? options.owner
        : rangeOwnerRef.current,
      source: String(options.source || rangeWriteSourceRef.current || rangeOwnerRef.current),
    };
    const flushPendingRenderWindow = () => {
      renderWindowFrameRef.current = null;
      renderWindowIdleTimerRef.current = null;
      const pendingRequest = pendingRenderWindowRef.current;
      pendingRenderWindowRef.current = {
        range: null,
        force: false,
        owner: rangeOwnerRef.current,
        source: rangeWriteSourceRef.current,
      };
      applyRenderWindow(pendingRequest.range, {
        force: pendingRequest.force,
        owner: pendingRequest.owner,
        source: pendingRequest.source,
      });
    };
    const pendingSource = pendingRenderWindowRef.current.source;
    const currentRenderWindow = renderWindowRef.current;
    const targetEscapedRenderWindow = Boolean(
      currentRenderWindow
      && nextGlobalRange
      && (
        Math.floor(Number(nextGlobalRange.from)) < Number(currentRenderWindow.start)
        || Math.ceil(Number(nextGlobalRange.to)) > Number(currentRenderWindow.end)
      )
    );
    if (shouldDeferRenderWindowRefreshUntilIdle(pendingSource) && !targetEscapedRenderWindow) {
      if (renderWindowIdleTimerRef.current != null) {
        clearTimeout(renderWindowIdleTimerRef.current);
      }
      renderWindowIdleTimerRef.current = setTimeout(() => {
        if (renderWindowFrameRef.current != null) {
          return;
        }
        renderWindowFrameRef.current = requestAnimationFrame(flushPendingRenderWindow);
      }, resolveDeferredPresentationDelayMs(pendingSource, PRESENTATION_DELAY_CONFIG));
      return;
    }
    if (renderWindowFrameRef.current != null) {
      return;
    }
    renderWindowFrameRef.current = requestAnimationFrame(flushPendingRenderWindow);
  }, [applyRenderWindow]);

  const scheduleBaseSeriesRefreshAfterIdle = React.useCallback((source = "") => {
    if (baseSeriesRefreshTimerRef.current != null) {
      clearTimeout(baseSeriesRefreshTimerRef.current);
      baseSeriesRefreshTimerRef.current = null;
    }
    if (!shouldReassertVisibleRangeOnIdle(source)) {
      return;
    }
    const delayMs = resolveDeferredPresentationDelayMs(source, PRESENTATION_DELAY_CONFIG);
    baseSeriesRefreshTimerRef.current = setTimeout(() => {
      baseSeriesRefreshTimerRef.current = null;
      const currentRange = clampVisibleLogicalRange(
        visibleLogicalRangeRef.current,
        chartBarsRef.current.length,
      );
      if (!currentRange) {
        return;
      }
      scheduleRenderWindowRefresh(currentRange, {
        force: true,
        owner: rangeOwnerRef.current,
        source: rangeWriteSourceRef.current,
      });
    }, delayMs);
  }, [scheduleRenderWindowRefresh]);

  chartLifecycleHandlersRef.current = {
    applyRangeState,
    beginUserRangeInteraction,
    buildRangeDebugPayload,
    clearRenderWindowTransition,
    clearTradeHoverPreview,
    commitTradeSelection,
    dismissTradeSelectionPicker,
    emitRuntimeHealthChange,
    emitVisibleTimeBoundsChange,
    maybeRequestOlderHistory,
    publishTradeHover,
    recordUserRangeIntent,
    rememberStableUserViewport,
    resolveNearestTradeInteractionTarget,
    scheduleBaseSeriesRefreshAfterIdle,
    scheduleInteractionPresentationSync,
    schedulePresentationSync,
    scheduleRenderWindowRefresh,
    scheduleResizePresentationSync,
    scheduleVisibleRangeClamp,
    shouldCaptureStableUserViewport,
    syncStudiesForRenderWindow,
    syncVisibleTimeBounds,
  };

  useEffect(() => {
    interactionRef.current = {
      ...interactionRef.current,
      onTradeSelect,
      onTradeHover,
      selectedTradeId,
      tradeInteractionGroups: tradeMarkerModel.interactionGroups,
      tradeTimeToIds: tradeMarkerModel.timeToTradeIds,
      indicatorTimeToIds: indicatorMarkerModel.timeToTradeIds,
    };
  }, [
    indicatorMarkerModel.timeToTradeIds,
    onTradeHover,
    onTradeSelect,
    selectedTradeId,
    tradeMarkerModel.interactionGroups,
    tradeMarkerModel.timeToTradeIds,
  ]);

  useEffect(() => {
    markerPayloadRef.current = {
      tradeMarkers: buildIndexedCollection(
        tradeMarkerModel.markers,
        (marker) => ({ from: marker?.barIndex, to: marker?.barIndex }),
      ),
      indicatorMarkers: buildIndexedCollection(
        indicatorMarkerModel.markers,
        (marker) => ({ from: marker?.barIndex, to: marker?.barIndex }),
      ),
      smcMarkers: buildIndexedCollection(
        smcMarkers,
        (marker) => ({ from: marker?.barIndex, to: marker?.barIndex }),
      ),
      showSignals,
      showSmc: Boolean(resolvedStudyVisibility.smc),
    };
    schedulePresentationSync();
  }, [
    indicatorMarkerModel.markers,
    schedulePresentationSync,
    showSignals,
    smcMarkers,
    resolvedStudyVisibility.smc,
    tradeMarkerModel.markers,
  ]);

  useEffect(() => {
    overlayPayloadRef.current = {
      indicatorZones: buildIndexedCollection(
        filteredIndicatorZones,
        (indicatorZone) => ({
          from: indicatorZone?.startBarIndex,
          to: indicatorZone?.endBarIndex,
        }),
      ),
      indicatorWindows: buildIndexedCollection(
        filteredIndicatorWindows,
        (indicatorWindow) => ({
          from: indicatorWindow?.startBarIndex,
          to: indicatorWindow?.endBarIndex,
        }),
      ),
      showZones,
    };
    schedulePresentationSync();
  }, [filteredIndicatorWindows, filteredIndicatorZones, schedulePresentationSync, showZones]);

  useEffect(() => {
    if (!selectedTradeId && !selectedTradeOverlayVisibleRef.current) {
      return;
    }
    schedulePresentationSync();
    if (!selectedTradeId) {
      return undefined;
    }
    let cancelled = false;
    let frameId = null;
    let remainingAttempts = 12;
    const syncWhenReady = () => {
      if (cancelled) {
        return;
      }
      const chartReady = Boolean(chartRef.current && candleSeriesRef.current && tradeActionOverlayRef.current);
      if (chartReady) {
        safeSyncSelectedTradeActionOverlay();
        return;
      }
      if (remainingAttempts <= 0) {
        return;
      }
      remainingAttempts -= 1;
      frameId = requestAnimationFrame(syncWhenReady);
    };
    frameId = requestAnimationFrame(syncWhenReady);
    return () => {
      cancelled = true;
      if (frameId != null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [safeSyncSelectedTradeActionOverlay, schedulePresentationSync, selectedTradeId, tradeBySelectionId]);

  useEffect(() => {
    if (selectedTradeId) {
      return;
    }
    setTradeActionConnectorNode(tradeActionEntryLeaderRef.current, { visible: false });
    setTradeActionConnectorNode(tradeActionConnectorRef.current, { visible: false });
    setTradeActionConnectorNode(tradeActionExitLeaderRef.current, { visible: false });
    setTradeActionBadgeNode(tradeActionEntryBadgeRef.current, { visible: false });
    setTradeActionBadgeNode(tradeActionExitBadgeRef.current, { visible: false });
    syncTradeThresholdNodes(tradeActionOverlayRef.current, tradeThresholdNodeMapRef.current, []);
    selectedTradeOverlayVisibleRef.current = false;
    selectedTradeOverlaySignatureRef.current = "hidden";
    publishDebugState(buildRangeDebugPayload({
      selectedTradeId: null,
      activeTradeSelectionId: null,
      selectedTradeOverlayTradeId: null,
      selectedTradeOverlayVisible: false,
      selectedTradeOverlayEntryVisible: false,
      selectedTradeOverlayExitVisible: false,
    }));
  }, [buildRangeDebugPayload, selectedTradeId]);

  useEffect(() => {
    chartBarsRef.current = chartBars;
    chartBarRangesRef.current = chartBarRanges;
  }, [chartBarRanges, chartBars]);

  useEffect(() => {
    if (!hasBars) {
      resetBaseDataCacheRefs([fullBaseDataCacheRef, renderWindowBaseDataCacheRef], createEmptyBaseDataCache);
      renderWindowRef.current = null;
      renderWindowTransitionRef.current = null;
      baseSeriesModeRef.current = "empty";
      baseSeriesSetDataCountRef.current = 0;
      baseSeriesWindowSwapCountRef.current = 0;
      activeBarCountRef.current = 0;
      activeBarCapRef.current = 0;
      overlaySyncCountRef.current = 0;
      tradeMarkerSetCountRef.current = 0;
      selectedTradeOverlaySyncCountRef.current = 0;
      lastOverlaySignatureRef.current = "empty";
      selectedTradeOverlayVisibleRef.current = false;
      selectedTradeOverlaySignatureRef.current = "hidden";
      olderHistoryRequestKeyRef.current = "";
      olderHistoryEdgeBlockedRef.current = false;
      clearTimeoutRefs([
        presentationIdleTimerRef,
        resizePresentationTimerRef,
        baseSeriesRefreshTimerRef,
        renderWindowIdleTimerRef,
        linkedViewportApplyTimerRef,
      ]);
      cancelAnimationFrameRefs([
        presentationFrameRef,
        visibleRangeEnforcementFrameRef,
        renderWindowFrameRef,
      ]);
      transientViewportRecoveryRef.current = lastBarCountRef.current > 0
        && Boolean(lastStableUserVisibleRangeRef.current || lastStableUserTimeBoundsRef.current);
      resetPendingRenderWindowRef(pendingRenderWindowRef, rangeOwnerRef.current, rangeWriteSourceRef.current);
      pendingPresentationModeRef.current = "full";
      runtimeHealthSignatureRef.current = "";
      visibleTimeBoundsRef.current = null;
      interactionRef.current = {
        ...interactionRef.current,
        volumeByTime: new Map(),
      };
      visibleMarkersSignatureRef.current = "empty";
      lastPublishedViewportSignatureRef.current = "";
      lastAppliedLinkedViewportKeyRef.current = "";
      lastDataDomainRef.current = {
        startMs: null,
        endMs: null,
      };
      const publishRuntimeHealthChange = onRuntimeHealthChangeRef.current;
      if (typeof publishRuntimeHealthChange === "function") {
        publishRuntimeHealthChange({
          status: "idle",
          reason: null,
          message: null,
          loadedBarCount: 0,
          activeBarCount: 0,
          activeBarCap: 0,
          baseDataMode: "empty",
        });
      }
      return;
    }
    olderHistoryRequestKeyRef.current = "";
    olderHistoryEdgeBlockedRef.current = false;
    if (chartBars.length > FULL_BASE_DATA_CACHE_MAX_BARS && fullBaseDataCacheRef.current.barCount) {
      resetBaseDataCacheRefs([fullBaseDataCacheRef], createEmptyBaseDataCache);
    }
    if (chartBars.length <= FULL_BASE_DATA_CACHE_MAX_BARS && renderWindowBaseDataCacheRef.current.barCount) {
      resetBaseDataCacheRefs([renderWindowBaseDataCacheRef], createEmptyBaseDataCache);
    }
  }, [chartBars.length, hasBars]);

  useEffect(() => {
    rangePresetKeyRef.current = rangePresetKey;
  }, [rangePresetKey]);

  useEffect(() => {
    baseSeriesModeLimitsRef.current = resolveBaseSeriesModeLimits(baseSeriesModeKey, allowFullIntervalSeries);
  }, [allowFullIntervalSeries, baseSeriesModeKey]);

  useEffect(() => {
    if (!isActive || !hostRef.current || chartRef.current || !hasBars) {
      return undefined;
    }

    const hostWidth = Math.max(1, Math.round(Number(hostRef.current?.clientWidth) || 0));
    const hostHeight = Math.max(1, Math.round(Number(hostRef.current?.clientHeight) || 0));
    lastObservedHostSizeRef.current = {
      width: hostWidth,
      height: hostHeight,
    };

    const chart = createChart(hostRef.current, {
      width: hostWidth,
      height: hostHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: TEXT,
        fontFamily: "IBM Plex Mono, Fira Code, monospace",
        attributionLogo: true,
        panes: {
          separatorColor: GRID,
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      rightPriceScale: {
        borderColor: GRID,
      },
      timeScale: {
        borderColor: GRID,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: DEFAULT_RIGHT_VIEWPORT_OFFSET_BARS,
        fixLeftEdge: true,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        vertLine: { color: "#94a3b8", labelBackgroundColor: "#111827" },
        horzLine: { color: "#94a3b8", labelBackgroundColor: "#111827" },
      },
      localization: {
        priceFormatter,
      },
    });
    chartRef.current = chart;
    const getChartLifecycleHandlers = () => chartLifecycleHandlersRef.current;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: candleBullColor,
      downColor: candleBearColor,
      borderVisible: false,
      wickUpColor: candleBullColor,
      wickDownColor: candleBearColor,
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineColor: PRICE_LINE_COLOR,
      priceFormat: {
        type: "price",
        precision: resolvedPricePrecision,
        minMove: priceMinMove,
      },
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "",
      priceFormat: { type: "volume" },
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;
    markerApiRef.current = createSeriesMarkers(candleSeries, [], {
      autoScale: true,
      zOrder: "top",
    });
    const volumeCandlePrimitive = createVolumeCandlePrimitive({
      pane: "price",
      visible: showVolumeCandles,
      upColor: candleBullColor,
      downColor: candleBearColor,
      minDisplayWidthPx: 2.5,
      minBodyHeightPx: 2,
    });
    const volumePanePrimitive = createVolumeCandlePrimitive({
      pane: "volume",
      visible: showVolumeCandles,
      upColor: candleBullColor,
      downColor: candleBearColor,
      volumeUpColor: volumeBullColor,
      volumeDownColor: volumeBearColor,
      minDisplayWidthPx: 2.5,
    });
    candleSeries.attachPrimitive(volumeCandlePrimitive);
    volumeSeries.attachPrimitive(volumePanePrimitive);
    volumeCandlePrimitiveRef.current = volumeCandlePrimitive;
    volumePanePrimitiveRef.current = volumePanePrimitive;

    const handleClick = (param) => {
      const chartLifecycleHandlers = getChartLifecycleHandlers();
      const { onTradeSelect: onSelect, selectedTradeId: currentSelectedTradeId } = interactionRef.current;
      if (typeof onSelect !== "function") {
        return;
      }
      if (getNowMs() < suppressTradeSelectUntilRef.current) {
        return;
      }
      const nearestTarget = chartLifecycleHandlers.resolveNearestTradeInteractionTarget?.(param?.point);
      if (!nearestTarget) {
        chartLifecycleHandlers.dismissTradeSelectionPicker?.();
        chartLifecycleHandlers.clearTradeHoverPreview?.(hoverStoreRef.current.getSnapshot().hud || null, false);
        return;
      }
      const orderedTradeIds = orderInteractionTradeIds(
        nearestTarget.tradeIds,
        currentSelectedTradeId,
        nearestTarget.preferredTradeId,
      );
      if (!orderedTradeIds.length) {
        chartLifecycleHandlers.dismissTradeSelectionPicker?.();
        chartLifecycleHandlers.clearTradeHoverPreview?.(hoverStoreRef.current.getSnapshot().hud || null, false);
        return;
      }
      if (orderedTradeIds.length === 1) {
        chartLifecycleHandlers.commitTradeSelection?.(orderedTradeIds[0], {
          source: `chart-marker-${nearestTarget.kind}`,
        });
        return;
      }
      dragStateRef.current.active = false;
      const pickerHost = tradeActionOverlayRef.current || hostRef.current;
      setTradeSelectionPicker({
        tradeIds: orderedTradeIds,
        ...clampTradeSelectionPickerPosition(
          param?.point,
          {
            width: pickerHost?.clientWidth,
            height: pickerHost?.clientHeight,
          },
          orderedTradeIds.length,
        ),
      });
    };

    const handleCrosshairMove = (param) => {
      const chartLifecycleHandlers = getChartLifecycleHandlers();
      const candlePoint = param?.seriesData?.get?.(candleSeries);
      if (!candlePoint) {
        if (linkedViewportApplyTimerRef.current != null) {
          clearTimeout(linkedViewportApplyTimerRef.current);
          linkedViewportApplyTimerRef.current = null;
        }
        chartLifecycleHandlers.clearTradeHoverPreview?.(null, true);
        return;
      }
      const time = normalizeChartTime(param?.time);
      const hudSnapshot = buildHoverHudSnapshot(candlePoint, interactionRef.current.volumeByTime, time);
      const nearestTarget = chartLifecycleHandlers.resolveNearestTradeInteractionTarget?.(param?.point);
      if (nearestTarget?.preferredTradeId) {
        hoverStoreRef.current.setSnapshot({
          hud: hudSnapshot,
          hoverTradeId: nearestTarget.preferredTradeId,
        });
        chartLifecycleHandlers.publishTradeHover?.(nearestTarget.preferredTradeId);
        if (hostRef.current) {
          hostRef.current.style.cursor = "pointer";
        }
        return;
      }
      hoverStoreRef.current.setSnapshot({
        hud: hudSnapshot,
        hoverTradeId: null,
      });
      chartLifecycleHandlers.publishTradeHover?.(null);
      if (hostRef.current) {
        hostRef.current.style.cursor = "";
      }
    };

    const handleVisibleLogicalRangeChange = (nextRange) => {
      const chartLifecycleHandlers = getChartLifecycleHandlers();
      const currentRenderWindow = renderWindowRef.current;
      const barCount = chartBarsRef.current.length;
      const localBarCount = currentRenderWindow
        ? Math.max(0, Number(currentRenderWindow.end) - Number(currentRenderWindow.start) + 1)
        : barCount;
      const clampedLocalRange = clampVisibleLogicalRange(nextRange, localBarCount);
      const rawRangeWasClamped = Boolean(clampedLocalRange)
        && !logicalRangesMatch(nextRange, clampedLocalRange, USER_RANGE_CLAMP_TOLERANCE);
      const intendedGlobalRange = localToGlobalLogicalRange(
        nextRange,
        currentRenderWindow,
        barCount,
      );
      const fallbackGlobalRange = localToGlobalLogicalRange(
        clampedLocalRange || nextRange,
        currentRenderWindow,
        barCount,
      );
      const pendingProgrammaticRange = programmaticVisibleRangeRef.current;
      const nowMs = getNowMs();
      const programmaticRangeAgeMs = pendingProgrammaticRange
        ? Math.max(0, nowMs - (Number(pendingProgrammaticRange.issuedAtMs) || 0))
        : Number.POSITIVE_INFINITY;
      const recentRenderWindowTransition = renderWindowTransitionRef.current;
      const renderWindowTransitionAgeMs = recentRenderWindowTransition
        ? Math.max(0, nowMs - (Number(recentRenderWindowTransition.issuedAtMs) || 0))
        : Number.POSITIVE_INFINITY;
      const hasRecentRenderWindowTransition = renderWindowTransitionAgeMs <= RENDER_WINDOW_TRANSITION_MAX_AGE_MS;
      const previousWindowGlobalRange = hasRecentRenderWindowTransition
        ? (
          localToGlobalLogicalRange(
            nextRange,
            recentRenderWindowTransition?.previousRenderWindow || null,
            barCount,
          ) || localToGlobalLogicalRange(
            clampedLocalRange || nextRange,
            recentRenderWindowTransition?.previousRenderWindow || null,
            barCount,
          )
        )
        : null;
      const programmaticLocalMatch = logicalRangesMatch(
        nextRange,
        pendingProgrammaticRange?.range || null,
        1.1,
      );
      const programmaticGlobalMatch = logicalRangesMatch(
        intendedGlobalRange || fallbackGlobalRange,
        pendingProgrammaticRange?.globalRange || null,
        1.1,
      ) || logicalRangesMatch(
        previousWindowGlobalRange,
        pendingProgrammaticRange?.globalRange || null,
        1.1,
      );
      const isProgrammaticUpdate = programmaticLocalMatch || programmaticGlobalMatch;
      const staleRenderWindowCallback = hasRecentRenderWindowTransition
        && !isProgrammaticUpdate
        && logicalRangesMatch(
          previousWindowGlobalRange,
          recentRenderWindowTransition?.previousGlobalRange || null,
          1.1,
        );
      if (staleRenderWindowCallback) {
        chartLifecycleHandlers.scheduleInteractionPresentationSync?.(userRangeIntentRef.current?.source);
        return;
      }
      const globalRange = programmaticLocalMatch
        ? (pendingProgrammaticRange?.globalRange || intendedGlobalRange || fallbackGlobalRange)
        : (intendedGlobalRange || fallbackGlobalRange);
      if (!globalRange) {
        const currentUserIntent = userRangeIntentRef.current;
        const currentUserIntentAgeMs = Math.max(0, nowMs - (Number(currentUserIntent?.atMs) || 0));
        const hasRecentRecoverableUserIntent = currentUserIntentAgeMs <= USER_RANGE_INTENT_MAX_AGE_MS
          && isUserRangeSource(currentUserIntent?.source);
        const recoveryGlobalRange = (
          lastStableUserTimeBoundsRef.current
            ? resolveVisibleLogicalRangeFromTimeBounds(chartBarRangesRef.current, lastStableUserTimeBoundsRef.current)
            : null
        ) || clampVisibleLogicalRange(
          lastStableUserVisibleRangeRef.current,
          barCount,
        ) || clampVisibleLogicalRange(
          visibleLogicalRangeRef.current,
          barCount,
        ) || clampedDefaultVisibleLogicalRangeRef.current;
        if (hasRecentRecoverableUserIntent) {
          if (recoveryGlobalRange) {
            visibleLogicalRangeRef.current = recoveryGlobalRange;
            chartLifecycleHandlers.syncVisibleTimeBounds?.(recoveryGlobalRange);
          }
          chartLifecycleHandlers.scheduleInteractionPresentationSync?.(currentUserIntent.source);
          return;
        }
        const recoveryLocalRange = currentRenderWindow
          ? globalToLocalLogicalRange(recoveryGlobalRange, currentRenderWindow, barCount)
          : recoveryGlobalRange;
        if (recoveryGlobalRange && recoveryLocalRange) {
          chartLifecycleHandlers.scheduleVisibleRangeClamp?.(recoveryLocalRange, recoveryGlobalRange, {
            owner: rangeOwnerRef.current,
            source: "range-recovery",
          });
          visibleLogicalRangeRef.current = recoveryGlobalRange;
          chartLifecycleHandlers.syncVisibleTimeBounds?.(recoveryGlobalRange);
        } else {
          chartRef.current?.timeScale?.().fitContent?.();
        }
        chartLifecycleHandlers.scheduleInteractionPresentationSync?.(userRangeIntentRef.current?.source);
        return;
      }
      const nextBaseSeriesMode = resolveBaseSeriesMode(
        barCount,
        baseSeriesModeRef.current,
        baseSeriesModeLimitsRef.current,
      );
      if (isProgrammaticUpdate) {
        programmaticVisibleRangeRef.current = null;
        if (!hasRecentRenderWindowTransition) {
          chartLifecycleHandlers.clearRenderWindowTransition?.();
        }
      } else if (pendingProgrammaticRange && programmaticRangeAgeMs >= PROGRAMMATIC_RANGE_MAX_AGE_MS) {
        programmaticVisibleRangeRef.current = null;
        if (renderWindowTransitionAgeMs >= RENDER_WINDOW_TRANSITION_MAX_AGE_MS) {
          chartLifecycleHandlers.clearRenderWindowTransition?.();
        }
      } else if (renderWindowTransitionAgeMs >= RENDER_WINDOW_TRANSITION_MAX_AGE_MS) {
        chartLifecycleHandlers.clearRenderWindowTransition?.();
      }
      let recentUserIntent = userRangeIntentRef.current;
      let recentUserIntentAgeMs = Math.max(0, nowMs - (Number(recentUserIntent.atMs) || 0));
      let hasRecentUserIntent = recentUserIntentAgeMs <= USER_RANGE_INTENT_MAX_AGE_MS;
      const nextInteractionOwner = hasRecentUserIntent || rangeOwnerRef.current === "user"
        ? "user"
        : rangeOwnerRef.current;
      const nextInteractionSource = hasRecentUserIntent
        ? (recentUserIntent.source || "user")
        : rangeWriteSourceRef.current;
      const shouldSustainUserInteraction = shouldTreatVisibleRangeChangeAsActiveUserInteraction({
        isProgrammaticUpdate,
        interactionOwner: nextInteractionOwner,
        interactionSource: nextInteractionSource,
      });
      if (shouldSustainUserInteraction) {
        chartLifecycleHandlers.recordUserRangeIntent?.(nextInteractionSource);
        recentUserIntent = userRangeIntentRef.current;
        recentUserIntentAgeMs = 0;
        hasRecentUserIntent = true;
      }
      const deferPresentationSync = hasRecentUserIntent
        && isDeferredPresentationSource(recentUserIntent.source);
      const selectionViewportLockActive = !hasRecentUserIntent
        && !isProgrammaticUpdate
        && nowMs < selectionViewportLockUntilRef.current;
      const shouldRefreshWindow = baseSeriesModeUsesRenderWindow(nextBaseSeriesMode)
        && shouldRefreshRenderWindow(
          currentRenderWindow,
          globalRange,
          barCount,
          baseSeriesModeLimitsRef.current?.renderWindowMaxBars,
        );
      const shouldDeferImmediateClamp = shouldDeferVisibleRangeClampUntilIdle({
        isProgrammaticUpdate,
        interactionOwner: nextInteractionOwner,
        interactionSource: nextInteractionSource,
      });
      if (!isProgrammaticUpdate && hasRecentUserIntent) {
        chartLifecycleHandlers.applyRangeState?.("user", recentUserIntent.source || "user");
      }
      if (selectionViewportLockActive) {
        const preservedGlobalRange = clampVisibleLogicalRange(
          visibleLogicalRangeRef.current,
          barCount,
        ) || globalRange;
        const preservedLocalRange = currentRenderWindow
          ? globalToLocalLogicalRange(preservedGlobalRange, currentRenderWindow, barCount)
          : preservedGlobalRange;
        const shouldReassertSelectionRange = !logicalRangesMatch(
          globalRange,
          preservedGlobalRange,
          0.9,
        );
        selectionViewportLockUntilRef.current = 0;
        if (preservedGlobalRange && preservedLocalRange && shouldReassertSelectionRange) {
          chartLifecycleHandlers.scheduleVisibleRangeClamp?.(preservedLocalRange, preservedGlobalRange, {
            owner: rangeOwnerRef.current,
            source: "selection-lock",
          });
        }
        chartLifecycleHandlers.scheduleInteractionPresentationSync?.(recentUserIntent.source);
        return;
      }
      if (!isProgrammaticUpdate && rawRangeWasClamped && !shouldRefreshWindow && !shouldDeferImmediateClamp) {
        chartLifecycleHandlers.scheduleVisibleRangeClamp?.(clampedLocalRange, globalRange, {
          owner: nextInteractionOwner,
          source: nextInteractionSource,
        });
      }
      visibleLogicalRangeRef.current = globalRange;
      chartLifecycleHandlers.syncVisibleTimeBounds?.(globalRange);
      if (nextInteractionOwner === "user" && chartLifecycleHandlers.shouldCaptureStableUserViewport?.(nextInteractionSource)) {
        chartLifecycleHandlers.rememberStableUserViewport?.(globalRange, visibleTimeBoundsRef.current);
      }
      publishDebugState(chartLifecycleHandlers.buildRangeDebugPayload?.({
        barCount,
        activeBarCount: activeBarCountRef.current,
        activeBarCap: activeBarCapRef.current,
        baseDataMode: nextBaseSeriesMode,
        baseSeriesSetDataCount: baseSeriesSetDataCountRef.current,
        baseSeriesWindowSwapCount: baseSeriesWindowSwapCountRef.current,
        tradeMarkerSetCount: tradeMarkerSetCountRef.current,
        overlaySyncCount: overlaySyncCountRef.current,
        selectedTradeOverlaySyncCount: selectedTradeOverlaySyncCountRef.current,
        renderWindow: renderWindowRef.current,
        visibleLogicalRange: globalRange,
        rangePresetKey: rangePresetKeyRef.current,
        recentUserIntentAgeMs,
      }) || {
        barCount,
        activeBarCount: activeBarCountRef.current,
        activeBarCap: activeBarCapRef.current,
        baseDataMode: nextBaseSeriesMode,
        baseSeriesSetDataCount: baseSeriesSetDataCountRef.current,
        baseSeriesWindowSwapCount: baseSeriesWindowSwapCountRef.current,
        tradeMarkerSetCount: tradeMarkerSetCountRef.current,
        overlaySyncCount: overlaySyncCountRef.current,
        selectedTradeOverlaySyncCount: selectedTradeOverlaySyncCountRef.current,
        renderWindow: renderWindowRef.current,
        visibleLogicalRange: globalRange,
        rangePresetKey: rangePresetKeyRef.current,
        recentUserIntentAgeMs,
      });
      chartLifecycleHandlers.emitRuntimeHealthChange?.({
        loadedBarCount: barCount,
        activeBarCount: activeBarCountRef.current,
        activeBarCap: activeBarCapRef.current,
        baseDataMode: nextBaseSeriesMode,
      });
      if (isProgrammaticUpdate) {
        if (deferPresentationSync) {
          chartLifecycleHandlers.scheduleInteractionPresentationSync?.(recentUserIntent.source);
        } else {
          chartLifecycleHandlers.schedulePresentationSync?.();
        }
        return;
      }
      chartLifecycleHandlers.emitVisibleTimeBoundsChange?.(visibleTimeBoundsRef.current, {
        source: hasRecentUserIntent
          ? (recentUserIntent.source || rangeWriteSourceRef.current)
          : rangeWriteSourceRef.current,
      });
      if (shouldRefreshWindow) {
        chartLifecycleHandlers.scheduleRenderWindowRefresh?.(globalRange, {
          owner: nextInteractionOwner,
          source: nextInteractionSource,
        });
      }
      chartLifecycleHandlers.maybeRequestOlderHistory?.(globalRange);
      chartLifecycleHandlers.scheduleBaseSeriesRefreshAfterIdle?.(recentUserIntent.source);
      chartLifecycleHandlers.scheduleInteractionPresentationSync?.(userRangeIntentRef.current?.source);
    };
    const handleWheel = (event) => {
      if (event?.ctrlKey || event?.metaKey) {
        return;
      }
      getChartLifecycleHandlers().beginUserRangeInteraction?.("chart-wheel");
    };
    const handlePointerDown = (event) => {
      if (event?.button != null && event.button !== 0) {
        return;
      }
      dragStateRef.current = {
        active: true,
        startX: Number(event?.clientX) || 0,
        startY: Number(event?.clientY) || 0,
      };
    };
    const handlePointerMove = (event) => {
      if (!dragStateRef.current.active) {
        return;
      }
      const deltaX = Math.abs((Number(event?.clientX) || 0) - dragStateRef.current.startX);
      const deltaY = Math.abs((Number(event?.clientY) || 0) - dragStateRef.current.startY);
      if (deltaX >= RANGE_INTERACTION_DRAG_THRESHOLD_PX || deltaY >= RANGE_INTERACTION_DRAG_THRESHOLD_PX) {
        getChartLifecycleHandlers().beginUserRangeInteraction?.("chart-drag");
        dragStateRef.current.active = false;
      }
    };
    const resetPointerState = () => {
      dragStateRef.current.active = false;
    };
    const handlePointerLeave = () => {
      resetPointerState();
      getChartLifecycleHandlers().clearTradeHoverPreview?.(null, true);
    };

    chart.subscribeClick(handleClick);
    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
    const wheelListenerOptions = { passive: true, capture: true };
    const pointerListenerOptions = { capture: true };
    hostRef.current.addEventListener("wheel", handleWheel, wheelListenerOptions);
    hostRef.current.addEventListener("pointerdown", handlePointerDown, pointerListenerOptions);
    hostRef.current.addEventListener("pointermove", handlePointerMove, pointerListenerOptions);
    hostRef.current.addEventListener("pointerup", resetPointerState, pointerListenerOptions);
    hostRef.current.addEventListener("pointercancel", resetPointerState, pointerListenerOptions);
    hostRef.current.addEventListener("pointerleave", handlePointerLeave, pointerListenerOptions);
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
        getChartLifecycleHandlers().scheduleResizePresentationSync?.();
      })
      : null;
    if (resizeObserver && hostRef.current) {
      resizeObserver.observe(hostRef.current);
    }

    return () => {
      const chartLifecycleHandlers = getChartLifecycleHandlers();
      const visibleRange = localToGlobalLogicalRange(
        chart.timeScale().getVisibleLogicalRange?.(),
        renderWindowRef.current,
        chartBarsRef.current.length,
      );
      if (visibleRange) {
        visibleLogicalRangeRef.current = visibleRange;
        chartLifecycleHandlers.syncVisibleTimeBounds?.(visibleRange);
      }
      cancelAnimationFrameRefs([
        presentationFrameRef,
        visibleRangeEnforcementFrameRef,
        renderWindowFrameRef,
      ]);
      clearTimeoutRefs([
        presentationIdleTimerRef,
        resizePresentationTimerRef,
        baseSeriesRefreshTimerRef,
        renderWindowIdleTimerRef,
        linkedViewportApplyTimerRef,
      ]);
      chartLifecycleHandlers.clearTradeHoverPreview?.(null, true);
      chart.unsubscribeClick(handleClick);
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
      hostRef.current?.removeEventListener("wheel", handleWheel, true);
      hostRef.current?.removeEventListener("pointerdown", handlePointerDown, true);
      hostRef.current?.removeEventListener("pointermove", handlePointerMove, true);
      hostRef.current?.removeEventListener("pointerup", resetPointerState, true);
      hostRef.current?.removeEventListener("pointercancel", resetPointerState, true);
      hostRef.current?.removeEventListener("pointerleave", handlePointerLeave, true);
      resizeObserver?.disconnect();
      lastObservedHostSizeRef.current = { width: 0, height: 0 };
      syncOverlayRectNodes(overlayRef.current, overlayNodeMapRef.current, []);
      syncOverlayZoneNodes(overlayRef.current, overlayZoneNodeMapRef.current, [], FONT_MONO);
      if (markerApiRef.current) {
        visibleMarkersSignatureRef.current = "empty";
        markerApiRef.current.setMarkers([]);
      }
      for (const entry of Object.values(studySeriesRef.current || {})) {
        if (entry?.series) {
          chart.removeSeries(entry.series);
        }
      }
      studySeriesRef.current = {};
      if (volumeCandlePrimitiveRef.current) {
        candleSeries.detachPrimitive(volumeCandlePrimitiveRef.current);
        volumeCandlePrimitiveRef.current = null;
      }
      if (volumePanePrimitiveRef.current) {
        volumeSeries.detachPrimitive(volumePanePrimitiveRef.current);
        volumePanePrimitiveRef.current = null;
      }
      chart.removeSeries(volumeSeries);
      chart.removeSeries(candleSeries);
      chart.remove();
      markerApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      chartRef.current = null;
      transientViewportRecoveryRef.current = false;
      hoverStoreRef.current.reset();
      renderWindowRef.current = null;
      renderWindowTransitionRef.current = null;
      resetBaseDataCacheRefs([fullBaseDataCacheRef, renderWindowBaseDataCacheRef], createEmptyBaseDataCache);
      baseSeriesModeRef.current = "empty";
      baseSeriesSetDataCountRef.current = 0;
      baseSeriesWindowSwapCountRef.current = 0;
      activeBarCountRef.current = 0;
      activeBarCapRef.current = 0;
      overlaySyncCountRef.current = 0;
      tradeMarkerSetCountRef.current = 0;
      selectedTradeOverlaySyncCountRef.current = 0;
      lastOverlaySignatureRef.current = "empty";
      selectedTradeOverlayVisibleRef.current = false;
      selectedTradeOverlaySignatureRef.current = "hidden";
      olderHistoryRequestKeyRef.current = "";
      olderHistoryEdgeBlockedRef.current = false;
      clearTimeoutRefs([
        presentationIdleTimerRef,
        resizePresentationTimerRef,
        baseSeriesRefreshTimerRef,
        renderWindowIdleTimerRef,
        linkedViewportApplyTimerRef,
      ]);
      cancelAnimationFrameRefs([
        visibleRangeEnforcementFrameRef,
        renderWindowFrameRef,
      ]);
      runtimeHealthSignatureRef.current = "";
      resetPendingRenderWindowRef(pendingRenderWindowRef, rangeOwnerRef.current, rangeWriteSourceRef.current);
      programmaticVisibleRangeRef.current = null;
      lastPublishedViewportSignatureRef.current = "";
      lastAppliedLinkedViewportKeyRef.current = "";
      lastDataDomainRef.current = {
        startMs: null,
        endMs: null,
      };
      lastStudySyncRef.current = {
        renderWindowSignature: "full:0",
        studySpecs: studySpecsRef.current,
        lowerPaneCount: Math.max(0, Number(studyLayoutRef.current.lowerPaneCount) || 0),
        studyCount: 0,
      };
      const publishRuntimeHealthChange = onRuntimeHealthChangeRef.current;
      if (typeof publishRuntimeHealthChange === "function") {
        publishRuntimeHealthChange({
          status: "idle",
          reason: null,
          message: null,
          loadedBarCount: 0,
          activeBarCount: 0,
          activeBarCap: 0,
          baseDataMode: "empty",
        });
      }
    };
  }, [
    chartMountSignature,
    isActive,
  ]);

  const processLinkedViewportRequest = React.useCallback((request = null) => {
    if (!linkEnabled || !chartRef.current || !chartBars.length) {
      return;
    }
    const leaderChartId = String(request?.chartId || "").trim().toLowerCase();
    const requestToken = Number(request?.token);
    if (!leaderChartId || leaderChartId === String(chartId || "").trim().toLowerCase()) {
      return;
    }

    const requestTimeBounds = request?.timeBounds;
    const requestRightPaddingBars = Math.max(0, Number(request?.rightPaddingBars) || 0);
    const recentUserIntentAgeMs = Math.max(0, getNowMs() - (Number(userRangeIntentRef.current.atMs) || 0));
    const hasRecentLocalUserIntent = recentUserIntentAgeMs <= USER_RANGE_INTENT_MAX_AGE_MS
      && isUserRangeSource(userRangeIntentRef.current.source);
    if (hasRecentLocalUserIntent) {
      if (linkedViewportApplyTimerRef.current != null) {
        clearTimeout(linkedViewportApplyTimerRef.current);
        linkedViewportApplyTimerRef.current = null;
      }
      return;
    }
    const requestKey = [
      leaderChartId,
      requestToken,
      buildTimeBoundsSignature(requestTimeBounds),
      requestRightPaddingBars.toFixed(2),
      chartBarsSignature,
      clampedDefaultVisibleLogicalRangeKey,
    ].join(":");
    if (requestKey === lastAppliedLinkedViewportKeyRef.current) {
      return;
    }

    const overlapRatio = resolveTimeBoundsOverlapRatio(chartBarRanges, requestTimeBounds);
    const mappedVisibleRange = resolveVisibleLogicalRangeFromTimeBounds(chartBarRanges, requestTimeBounds);
    const paddedMappedVisibleRange = mappedVisibleRange
      ? clampVisibleLogicalRange({
        from: mappedVisibleRange.from,
        to: mappedVisibleRange.to + requestRightPaddingBars,
      }, chartBars.length)
      : null;
    const fallbackVisibleRange = clampVisibleLogicalRange(visibleLogicalRangeRef.current, chartBars.length)
      || clampedDefaultVisibleLogicalRange;
    const nextVisibleRange = paddedMappedVisibleRange && overlapRatio >= LINKED_VIEWPORT_MIN_OVERLAP_RATIO
      ? paddedMappedVisibleRange
      : fallbackVisibleRange;
    if (!nextVisibleRange) {
      return;
    }

    lastAppliedLinkedViewportKeyRef.current = requestKey;
    const nextLinkSource = `link:${leaderChartId}`;
    if (linkedViewportApplyTimerRef.current != null) {
      clearTimeout(linkedViewportApplyTimerRef.current);
      linkedViewportApplyTimerRef.current = null;
    }
    linkedViewportApplyTimerRef.current = setTimeout(() => {
      linkedViewportApplyTimerRef.current = null;
      const latestUserIntentAgeMs = Math.max(0, getNowMs() - (Number(userRangeIntentRef.current.atMs) || 0));
      const hasLatestLocalUserIntent = latestUserIntentAgeMs <= USER_RANGE_INTENT_MAX_AGE_MS
        && isUserRangeSource(userRangeIntentRef.current.source);
      if (hasLatestLocalUserIntent) {
        return;
      }
      const currentVisibleRange = clampVisibleLogicalRange(visibleLogicalRangeRef.current, chartBars.length);
      if (logicalRangesMatch(currentVisibleRange, nextVisibleRange, 0.9)) {
        return;
      }
      applyRenderWindow(nextVisibleRange, {
        force: false,
        owner: "user",
        source: nextLinkSource,
      });
    }, LINKED_VIEWPORT_SETTLE_MS);
  }, [
    applyRenderWindow,
    chartBars.length,
    chartBarsSignature,
    chartBarRanges,
    chartId,
    clampedDefaultVisibleLogicalRange,
    clampedDefaultVisibleLogicalRangeKey,
    linkEnabled,
  ]);
  useEffect(() => {
    if (linkedViewportStore?.subscribe && linkedViewportStore?.getSnapshot) {
      const handleStoreUpdate = () => {
        processLinkedViewportRequest(linkedViewportStore.getSnapshot());
      };
      handleStoreUpdate();
      return linkedViewportStore.subscribe(handleStoreUpdate);
    }
    return undefined;
  }, [linkedViewportStore, processLinkedViewportRequest]);

  useEffect(() => {
    if (linkedViewportStore?.subscribe && linkedViewportStore?.getSnapshot) {
      return;
    }
    processLinkedViewportRequest(linkedViewportRequest);
  }, [
    linkedViewportRequest,
    linkedViewportStore,
    processLinkedViewportRequest,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const volumeCandlePrimitive = volumeCandlePrimitiveRef.current;
    const volumePanePrimitive = volumePanePrimitiveRef.current;
    if (!chart || !candleSeries || !volumeSeries) {
      return;
    }
    chart.applyOptions({
      localization: {
        priceFormatter,
      },
    });
    candleSeries.applyOptions({
      upColor: showVolumeCandles ? "rgba(0,0,0,0)" : candleBullColor,
      downColor: showVolumeCandles ? "rgba(0,0,0,0)" : candleBearColor,
      wickVisible: !showVolumeCandles,
      wickUpColor: candleBullColor,
      wickDownColor: candleBearColor,
      priceLineColor: PRICE_LINE_COLOR,
      priceFormat: {
        type: "price",
        precision: resolvedPricePrecision,
        minMove: priceMinMove,
      },
    });
    volumeSeries.applyOptions({
      visible: true,
    });
      volumeCandlePrimitive?.applyOptions({
      visible: showVolumeCandles,
      upColor: candleBullColor,
      downColor: candleBearColor,
      minDisplayWidthPx: 2.5,
      minBodyHeightPx: 2,
    });
    volumePanePrimitive?.applyOptions({
      visible: showVolumeCandles,
      upColor: candleBullColor,
      downColor: candleBearColor,
      volumeUpColor: volumeBullColor,
      volumeDownColor: volumeBearColor,
      minDisplayWidthPx: 2.5,
    });
  }, [candleBearColor, candleBullColor, priceFormatter, priceMinMove, resolvedPricePrecision, showVolumeCandles, volumeBearColor, volumeBullColor]);

  useEffect(() => {
    if (!chartRef.current || !chartBars.length) {
      return;
    }
    syncStudiesForRenderWindow(renderWindowRef.current, { force: true });
  }, [chartBars.length, studySpecs, studyLowerPaneCount, syncStudiesForRenderWindow]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current || chartBars.length) {
      return;
    }
    candleSeriesRef.current.setData([]);
    volumeSeriesRef.current.setData([]);
    volumeCandlePrimitiveRef.current?.setData([], new Map(), {
      visible: showVolumeCandles,
      upColor: candleBullColor,
      downColor: candleBearColor,
    });
    volumePanePrimitiveRef.current?.setData([], new Map(), {
      visible: showVolumeCandles,
      upColor: candleBullColor,
      downColor: candleBearColor,
      volumeUpColor: volumeBullColor,
      volumeDownColor: volumeBearColor,
    });
  }, [candleBearColor, candleBullColor, chartBars.length, showVolumeCandles, volumeBearColor, volumeBullColor]);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current || !chartBars.length) {
      return;
    }
    const baseSetDataStart = import.meta.env.DEV ? performance.now() : 0;
    const rangePresetChanged = lastRangePresetKeyRef.current !== rangePresetKey;
    const currentRangeOwner = rangeOwnerRef.current;
    const currentRangeSource = rangeWriteSourceRef.current;
    const recentUserIntent = userRangeIntentRef.current;
    const recentUserIntentAgeMs = Math.max(0, getNowMs() - (Number(recentUserIntent.atMs) || 0));
    const hasRecentUserIntent = recentUserIntentAgeMs <= USER_RANGE_INTENT_MAX_AGE_MS
      && isUserRangeSource(recentUserIntent.source);
    const shouldRecoverStableUserViewport = Boolean(
      transientViewportRecoveryRef.current
      && !rangePresetChanged
      && (lastStableUserVisibleRangeRef.current || lastStableUserTimeBoundsRef.current),
    );
    const shouldPreserveUserRange = currentRangeOwner === "user" || hasRecentUserIntent;
    const previousBarCount = lastBarCountRef.current || 0;
    const previousDataDomain = lastDataDomainRef.current;
    const nextDataDomainStartMs = Number(chartBarRanges[0]?.startMs);
    const nextDataDomainEndMs = Number(chartBarRanges[chartBarRanges.length - 1]?.endMs);
    const hasPreviousDataDomain = Number.isFinite(previousDataDomain.startMs)
      && Number.isFinite(previousDataDomain.endMs);
    const extendedEarlier = hasPreviousDataDomain
      && Number.isFinite(nextDataDomainStartMs)
      && nextDataDomainStartMs < previousDataDomain.startMs;
    const extendedLater = hasPreviousDataDomain
      && Number.isFinite(nextDataDomainEndMs)
      && nextDataDomainEndMs > previousDataDomain.endMs;
    const datasetExtended = previousBarCount > 0
      && (extendedEarlier || extendedLater || chartBars.length > previousBarCount);
    const prependedBarCount = extendedEarlier && previousBarCount > 0
      ? Math.max(0, chartBars.length - previousBarCount)
      : 0;
    const stableRecoveredVisibleRange = shouldRecoverStableUserViewport
      ? clampVisibleLogicalRange(lastStableUserVisibleRangeRef.current, chartBars.length)
      : null;
    const preferredStableUserVisibleRange = shouldPreserveUserRange
      ? clampVisibleLogicalRange(lastStableUserVisibleRangeRef.current, chartBars.length)
      : null;
    const restoredVisibleRange = stableRecoveredVisibleRange
      || preferredStableUserVisibleRange
      || clampVisibleLogicalRange(visibleLogicalRangeRef.current, chartBars.length);
    const paddingSourceRange = stableRecoveredVisibleRange
      || preferredStableUserVisibleRange
      || visibleLogicalRangeRef.current;
    const preservedRightPaddingBars = shouldPreserveUserRange || shouldRecoverStableUserViewport
      ? resolveVisibleRangeRightPaddingBars(paddingSourceRange, chartBars.length)
      : 0;
    const preservedTimeBounds = shouldRecoverStableUserViewport
      ? (lastStableUserTimeBoundsRef.current || visibleTimeBoundsRef.current)
      : (shouldPreserveUserRange
        ? (lastStableUserTimeBoundsRef.current || visibleTimeBoundsRef.current)
        : (visibleTimeBoundsRef.current || lastStableUserTimeBoundsRef.current));
    const rawPreservedVisibleRange = shouldResolvePreservedViewportFromTimeBounds({
      hasPreservedTimeBounds: Boolean(preservedTimeBounds),
      shouldPreserveUserRange,
      shouldRecoverStableUserViewport,
    })
      ? resolveVisibleLogicalRangeFromTimeBounds(chartBarRanges, preservedTimeBounds)
      : null;
    const preservedVisibleRange = rawPreservedVisibleRange
      ? clampVisibleLogicalRange({
        from: rawPreservedVisibleRange.from,
        to: rawPreservedVisibleRange.to + preservedRightPaddingBars,
      }, chartBars.length)
      : null;
    let nextVisibleRange = null;
    let nextRangeOwner = shouldPreserveUserRange || shouldRecoverStableUserViewport
      ? "user"
      : currentRangeOwner;
    let nextRangeSource = shouldRecoverStableUserViewport
      ? "range-recovery"
      : (prependedBarCount > 0
        ? (shouldPreserveUserRange
          ? String(recentUserIntent.source || currentRangeSource || "user")
          : "data")
        : (shouldPreserveUserRange
          ? String(recentUserIntent.source || currentRangeSource || "user")
          : currentRangeSource));

    if (shouldApplyDefaultRangeOnPresetChange({
      rangePresetChanged,
      hasDefaultVisibleRange: Boolean(clampedDefaultVisibleLogicalRange),
      shouldPreserveUserRange,
      shouldRecoverStableUserViewport,
    })) {
      nextVisibleRange = clampedDefaultVisibleLogicalRange;
      nextRangeOwner = "preset";
      nextRangeSource = "preset";
    } else if (preservedVisibleRange) {
      nextVisibleRange = preservedVisibleRange;
    } else if (!rangePresetChanged && restoredVisibleRange) {
      nextVisibleRange = prependedBarCount > 0
        ? clampVisibleLogicalRange({
          from: restoredVisibleRange.from + prependedBarCount,
          to: restoredVisibleRange.to + prependedBarCount,
        }, chartBars.length)
        : restoredVisibleRange;
    }

      cancelAnimationFrameRefs([renderWindowFrameRef]);
      clearTimeoutRefs([renderWindowIdleTimerRef]);
      resetPendingRenderWindowRef(pendingRenderWindowRef, rangeOwnerRef.current, rangeWriteSourceRef.current);
    if (nextVisibleRange) {
      applyRenderWindow(nextVisibleRange, {
        force: true,
        owner: nextRangeOwner,
        source: nextRangeSource,
      });
    } else if (!shouldPreserveUserRange && !shouldRecoverStableUserViewport && clampedDefaultVisibleLogicalRange) {
      applyRenderWindow(clampedDefaultVisibleLogicalRange, {
        force: true,
        owner: "preset",
        source: "preset",
      });
    } else if (shouldPreserveUserRange || shouldRecoverStableUserViewport) {
      // Do not snap a user-owned viewport back to the tail/current window
      // just because the latest chartBars sync could not derive a new range.
    } else {
      applyRenderWindow({
        from: 0,
        to: Math.max(0, chartBars.length - 1),
      }, {
        force: true,
        owner: "preset",
        source: "preset",
      });
    }

    lastRangePresetKeyRef.current = rangePresetKey;
    lastBarCountRef.current = chartBars.length;
    transientViewportRecoveryRef.current = false;
    lastDataDomainRef.current = {
      startMs: Number.isFinite(nextDataDomainStartMs) ? nextDataDomainStartMs : null,
      endMs: Number.isFinite(nextDataDomainEndMs) ? nextDataDomainEndMs : null,
    };
    publishDebugState(buildRangeDebugPayload({
      barCount: chartBars.length,
      activeBarCount: activeBarCountRef.current,
      activeBarCap: activeBarCapRef.current,
      baseDataMode: baseSeriesModeRef.current,
      baseSeriesSetDataCount: baseSeriesSetDataCountRef.current,
      baseSeriesWindowSwapCount: baseSeriesWindowSwapCountRef.current,
      tradeMarkerSetCount: tradeMarkerSetCountRef.current,
      overlaySyncCount: overlaySyncCountRef.current,
      selectedTradeOverlaySyncCount: selectedTradeOverlaySyncCountRef.current,
      defaultVisibleLogicalRange: clampedDefaultVisibleLogicalRange,
      renderWindow: renderWindowRef.current,
      visibleLogicalRange: visibleLogicalRangeRef.current,
      rangePresetKey,
    }));
    emitRuntimeHealthChange({
      loadedBarCount: chartBars.length,
      activeBarCount: activeBarCountRef.current,
      activeBarCap: activeBarCapRef.current,
      baseDataMode: baseSeriesModeRef.current,
    });
    if (import.meta.env.DEV) {
      const durationMs = performance.now() - baseSetDataStart;
      if (durationMs >= 12) {
        console.debug("[ResearchChart] base series sync", {
          durationMs,
          renderedBars: renderWindowRef.current?.size || chartBars.length,
          bars: chartBars.length,
          rangePresetKey,
        });
      }
    }
  }, [
    chartBarRangeDomainKey,
    chartBars.length,
    chartBarsSignature,
    chartTheme.bear,
    chartTheme.bull,
    clampedDefaultVisibleLogicalRangeKey,
    applyRenderWindow,
    buildRangeDebugPayload,
    emitRuntimeHealthChange,
    rangePresetKey,
    showVolumeCandles,
  ]);

  useEffect(() => {
    publishDebugState(buildRangeDebugPayload({
      componentRenderCount: renderCountRef.current,
      selectedTradeId,
    }));
  });

  if (!hasBars) {
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          background: "#ffffff",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#c4c8ce",
          fontFamily: FONT_MONO,
          fontSize: 14,
        }}
      >
        {emptyStateLabel}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
        <ChartHudOverlay
          hoverStore={hoverStoreRef.current}
          symbol={symbol}
          chartBars={chartBars}
          tradeBySelectionId={tradeBySelectionId}
          activeTradeId={selectedTradeId}
          resolvedPricePrecision={resolvedPricePrecision}
          statusItems={statusItems}
          tradeThresholdDisplay={tradeThresholdDisplay}
          showFocusTradeCard={showFocusTradeCard}
        />
        <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
        <div
          ref={overlayRef}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 1,
            overflow: "hidden",
          }}
        />
        <div
          ref={tradeActionOverlayRef}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <svg
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
          >
            <path
              ref={tradeActionEntryLeaderRef}
              style={{ display: "none" }}
              fill="none"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              ref={tradeActionConnectorRef}
              style={{ display: "none" }}
              fill="none"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              ref={tradeActionExitLeaderRef}
              style={{ display: "none" }}
              fill="none"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div
            ref={tradeActionEntryBadgeRef}
            role="button"
            tabIndex={0}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!selectedTradeIdRef.current) {
                return;
              }
              commitTradeSelection(null, { source: "trade-badge" });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              if (!selectedTradeIdRef.current) {
                return;
              }
              commitTradeSelection(null, { source: "trade-badge" });
            }}
            style={{
              position: "absolute",
              display: "none",
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid transparent",
              boxShadow: "0 6px 18px rgba(15,23,42,0.16)",
              fontSize: 10,
              fontFamily: FONT_MONO,
              fontWeight: 800,
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
              lineHeight: 1,
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
          />
          <div
            ref={tradeActionExitBadgeRef}
            role="button"
            tabIndex={0}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!selectedTradeIdRef.current) {
                return;
              }
              commitTradeSelection(null, { source: "trade-badge" });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              if (!selectedTradeIdRef.current) {
                return;
              }
              commitTradeSelection(null, { source: "trade-badge" });
            }}
            style={{
              position: "absolute",
              display: "none",
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid transparent",
              boxShadow: "0 6px 18px rgba(15,23,42,0.16)",
              fontSize: 10,
              fontFamily: FONT_MONO,
              fontWeight: 800,
              letterSpacing: "0.01em",
              whiteSpace: "nowrap",
              lineHeight: 1,
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
          />
          {tradeSelectionPickerEntries.length ? (
            <div
              ref={tradeSelectionPickerRef}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              style={{
                position: "absolute",
                top: tradeSelectionPicker?.top ?? TRADE_SELECTION_PICKER_EDGE_PADDING_PX,
                left: tradeSelectionPicker?.left ?? TRADE_SELECTION_PICKER_EDGE_PADDING_PX,
                width: TRADE_SELECTION_PICKER_WIDTH_PX,
                maxHeight: tradeSelectionPicker?.maxHeight ?? 280,
                overflowY: "auto",
                pointerEvents: "auto",
                borderRadius: 16,
                border: "1px solid rgba(148,163,184,0.28)",
                background: "rgba(255,255,255,0.96)",
                boxShadow: "0 18px 40px rgba(15,23,42,0.22)",
                backdropFilter: "blur(14px)",
                padding: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "2px 2px 10px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: MUTED,
                    }}
                  >
                    Select Trade
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      color: TEXT,
                    }}
                  >
                    Multiple trades share this bar.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    dismissTradeSelectionPicker();
                  }}
                  style={{
                    appearance: "none",
                    border: "1px solid rgba(148,163,184,0.26)",
                    background: "rgba(248,250,252,0.9)",
                    color: TEXT,
                    borderRadius: 999,
                    padding: "6px 10px",
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  Close
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tradeSelectionPickerEntries.map((entry) => {
                  const isSelected = entry.tradeId === selectedTradeId;
                  return (
                    <button
                      key={entry.tradeId}
                      type="button"
                      onClick={() => {
                        commitTradeSelection(
                          isSelected ? null : entry.tradeId,
                          { source: "chart-collision-picker" },
                        );
                      }}
                      style={{
                        appearance: "none",
                        border: isSelected ? "1px solid rgba(37,99,235,0.34)" : "1px solid rgba(148,163,184,0.22)",
                        background: isSelected ? "rgba(219,234,254,0.72)" : "rgba(248,250,252,0.92)",
                        color: TEXT,
                        borderRadius: 12,
                        padding: "10px 12px",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.label}
                        </span>
                        <span
                          style={{
                            flexShrink: 0,
                            fontFamily: FONT_MONO,
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: isSelected ? SIGNAL_BUY : MUTED,
                          }}
                        >
                          {isSelected ? "Clear" : "Select"}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          lineHeight: 1.45,
                          color: MUTED,
                          minHeight: 14,
                        }}
                      >
                        {entry.detail || entry.tradeId}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default React.memo(ResearchSpotChart);

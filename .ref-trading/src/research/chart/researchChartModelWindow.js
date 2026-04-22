import { getBarTimeMs, parseMarketTimestamp } from "../market/time.js";
import { resolveRangeDays } from "./timeframeModel.js";

const TRADING_MINUTES_PER_DAY = 390;
const MIN_PADDING_TRADING_DAYS = 2;
const WINDOW_PADDING_MULTIPLIER = 1;
const WINDOW_SNAP_DIVISOR = 8;
const WINDOW_MIN_SNAP_BARS = 128;

function normalizeTimeBounds(timeBounds = null) {
  const startMs = Number(timeBounds?.startMs);
  const endMs = Number(timeBounds?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return { startMs, endMs };
}

function buildTimeBounds(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  const normalizedStartMs = Math.min(startMs, endMs);
  const normalizedEndMs = Math.max(startMs, endMs);
  return normalizedEndMs > normalizedStartMs
    ? { startMs: normalizedStartMs, endMs: normalizedEndMs }
    : null;
}

function boundsOverlap(left, right) {
  if (!left || !right) {
    return false;
  }
  return Math.min(left.endMs, right.endMs) > Math.max(left.startMs, right.startMs);
}

function boundsDistanceMs(left, right) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  if (boundsOverlap(left, right)) {
    return 0;
  }
  return left.startMs > right.endMs
    ? left.startMs - right.endMs
    : right.startMs - left.endMs;
}

function unionTimeBounds(left, right) {
  if (!left) {
    return right || null;
  }
  if (!right) {
    return left;
  }
  return {
    startMs: Math.min(left.startMs, right.startMs),
    endMs: Math.max(left.endMs, right.endMs),
  };
}

function lowerBoundBarIndex(bars, targetMs) {
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(targetMs)) {
    return null;
  }
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const barTimeMs = getBarTimeMs(bars[mid]);
    if (!Number.isFinite(barTimeMs) || barTimeMs < targetMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < bars.length ? low : null;
}

function upperBoundBarIndex(bars, targetMs) {
  if (!Array.isArray(bars) || !bars.length || !Number.isFinite(targetMs)) {
    return null;
  }
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const barTimeMs = getBarTimeMs(bars[mid]);
    if (!Number.isFinite(barTimeMs) || barTimeMs <= targetMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low > 0 ? low - 1 : null;
}

function estimateRawBarsPerTradingDay(tfMin = 1) {
  const normalizedTfMin = Math.max(1, Number(tfMin) || 1);
  return Math.max(1, Math.round(TRADING_MINUTES_PER_DAY / normalizedTfMin));
}

function resolveFocusTimeBounds(viewportBounds, selectedTradeBounds) {
  if (!selectedTradeBounds) {
    return {
      focusBounds: viewportBounds,
      priority: viewportBounds ? "viewport" : "tail",
    };
  }
  if (!viewportBounds) {
    return {
      focusBounds: selectedTradeBounds,
      priority: "selected-trade",
    };
  }
  const viewportDurationMs = Math.max(1, viewportBounds.endMs - viewportBounds.startMs);
  const distanceMs = boundsDistanceMs(viewportBounds, selectedTradeBounds);
  if (distanceMs <= viewportDurationMs) {
    return {
      focusBounds: unionTimeBounds(viewportBounds, selectedTradeBounds),
      priority: "viewport",
    };
  }
  return {
    focusBounds: selectedTradeBounds,
    priority: "selected-trade",
  };
}

export function resolveSelectedTradeTimeBounds(selectedTrade = null) {
  const entryMs = parseMarketTimestamp(selectedTrade?.ts);
  const rawExitMs = parseMarketTimestamp(selectedTrade?.et);
  const exitMs = Number.isFinite(rawExitMs) ? rawExitMs : entryMs;
  return buildTimeBounds(entryMs, exitMs);
}

export function shouldUseDailyBarsOnly({ effectiveTf = "D", dailyBars = [] } = {}) {
  const normalizedTf = String(effectiveTf || "").trim().toUpperCase();
  return (normalizedTf === "D" || normalizedTf === "W")
    && Array.isArray(dailyBars)
    && dailyBars.length > 0;
}

export function shouldPreferSyncResearchChartModel({ chartWindowMode = "default", modelBars = [] } = {}) {
  return String(chartWindowMode || "").trim().toLowerCase() === "all"
    && Array.isArray(modelBars)
    && modelBars.length >= 12000;
}

export function resolveResearchChartSourceSlice({
  bars = [],
  chartRange = "3M",
  chartWindowMode = "default",
  effectiveTf = "D",
  tfMin = 1,
  viewportTimeBounds = null,
  autoTimeBounds = null,
  selectedTrade = null,
} = {}) {
  const sourceBars = Array.isArray(bars) ? bars : [];
  if (!sourceBars.length) {
    return {
      startIndex: 0,
      endIndex: -1,
      windowed: false,
      reason: "empty",
    };
  }

  const normalizedWindowMode = String(chartWindowMode || "").trim().toLowerCase();

  if (normalizedWindowMode === "all") {
    return {
      startIndex: 0,
      endIndex: sourceBars.length - 1,
      windowed: false,
      reason: "all",
    };
  }

  const shouldFollowInteractiveFocus = normalizedWindowMode === "custom";
  const viewportBounds = shouldFollowInteractiveFocus
    ? normalizeTimeBounds(viewportTimeBounds || autoTimeBounds)
    : null;
  const selectedTradeBounds = shouldFollowInteractiveFocus && viewportBounds
    ? null
    : (shouldFollowInteractiveFocus ? resolveSelectedTradeTimeBounds(selectedTrade) : null);
  const { focusBounds, priority } = resolveFocusTimeBounds(viewportBounds, selectedTradeBounds);

  let visibleStartIndex = null;
  let visibleEndIndex = null;

  if (focusBounds) {
    visibleStartIndex = lowerBoundBarIndex(sourceBars, focusBounds.startMs);
    visibleEndIndex = upperBoundBarIndex(sourceBars, focusBounds.endMs);
  }

  if (!Number.isInteger(visibleStartIndex) || !Number.isInteger(visibleEndIndex) || visibleEndIndex < visibleStartIndex) {
    const rawBarsPerTradingDay = estimateRawBarsPerTradingDay(tfMin);
    const rangeDays = Math.max(1, resolveRangeDays(chartRange, 66));
    const estimatedVisibleBars = Math.max(rawBarsPerTradingDay, Math.ceil(rangeDays * rawBarsPerTradingDay));
    visibleEndIndex = sourceBars.length - 1;
    visibleStartIndex = Math.max(0, visibleEndIndex - estimatedVisibleBars + 1);
  }

  const visibleBarCount = Math.max(1, visibleEndIndex - visibleStartIndex + 1);
  const rawBarsPerTradingDay = estimateRawBarsPerTradingDay(tfMin);
  const paddingBars = Math.max(
    rawBarsPerTradingDay * MIN_PADDING_TRADING_DAYS,
    Math.ceil(visibleBarCount * WINDOW_PADDING_MULTIPLIER),
  );
  const snapBars = Math.max(
    WINDOW_MIN_SNAP_BARS,
    Math.ceil((visibleBarCount + (paddingBars * 2)) / WINDOW_SNAP_DIVISOR),
  );

  let startIndex = Math.max(0, visibleStartIndex - paddingBars);
  let endIndex = Math.min(sourceBars.length - 1, visibleEndIndex + paddingBars);

  startIndex = Math.floor(startIndex / snapBars) * snapBars;
  endIndex = Math.min(
    sourceBars.length - 1,
    (Math.ceil((endIndex + 1) / snapBars) * snapBars) - 1,
  );

  const windowed = startIndex > 0 || endIndex < sourceBars.length - 1;
  return {
    startIndex,
    endIndex,
    windowed,
    reason: windowed ? priority : "full",
  };
}

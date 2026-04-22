const MIN_VISIBLE_BAR_DOMAIN_OVERLAP = 0.001;
// Keep at least a small real-candle foothold when users pan into right whitespace.
const MIN_RIGHT_EDGE_VISIBLE_BARS = 2;

export function renderWindowMatches(left, right) {
  return Number(left?.start) === Number(right?.start)
    && Number(left?.end) === Number(right?.end);
}

export function buildRenderWindowSignature(renderWindow, barCount = 0) {
  if (!renderWindow) {
    return `full:${Math.max(0, Number(barCount) || 0)}`;
  }
  return `${Number(renderWindow.start) || 0}:${Number(renderWindow.end) || 0}`;
}

export function clampVisibleLogicalRange(range, barCount, maxRightWhitespaceBars = 0) {
  const safeBarCount = Math.max(0, Number(barCount) || 0);
  if (!range || !safeBarCount) {
    return null;
  }
  let from = Number(range?.from);
  let to = Number(range?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  if (from > to) {
    [from, to] = [to, from];
  }

  const min = -0.5;
  const actualDomainMax = safeBarCount - 0.5;
  const max = Math.max(0.5, actualDomainMax + Math.max(0, Number(maxRightWhitespaceBars) || 0));
  const maxSpan = Math.max(1, max - min);
  const span = Math.min(Math.max(1, to - from), maxSpan);
  const maxFrom = max - span;
  const minRightEdgeVisibleBars = Math.max(
    1,
    Math.min(
      safeBarCount,
      Math.min(Math.ceil(span), MIN_RIGHT_EDGE_VISIBLE_BARS),
    ),
  );
  const maxVisibleFrom = Math.min(
    maxFrom,
    actualDomainMax - minRightEdgeVisibleBars + MIN_VISIBLE_BAR_DOMAIN_OVERLAP,
  );
  const clampedFrom = Math.max(min, Math.min(from, maxVisibleFrom));
  const clampedTo = Math.min(max, clampedFrom + span);

  return {
    from: clampedFrom,
    to: clampedTo,
  };
}

export function toVisibleBarIndexRange(range, barCount, overscan = 0, maxRightWhitespaceBars = 0) {
  const safeBarCount = Math.max(0, Number(barCount) || 0);
  if (!safeBarCount) {
    return null;
  }
  const clampedRange = clampVisibleLogicalRange(range, safeBarCount, maxRightWhitespaceBars);
  if (!clampedRange) {
    return {
      from: 0,
      to: safeBarCount - 1,
    };
  }
  const safeOverscan = Math.max(0, Math.floor(Number(overscan) || 0));
  let fromIndex = Math.ceil(Number(clampedRange.from) - 0.5);
  let toIndex = Math.floor(Number(clampedRange.to) + 0.5);
  if (fromIndex > toIndex) {
    const fallbackIndex = Math.max(
      0,
      Math.min(safeBarCount - 1, Math.round((Number(clampedRange.from) + Number(clampedRange.to)) / 2)),
    );
    fromIndex = fallbackIndex;
    toIndex = fallbackIndex;
  }
  const boundedFrom = Math.max(0, Math.min(safeBarCount - 1, fromIndex));
  const boundedTo = Math.max(boundedFrom, Math.min(safeBarCount - 1, toIndex));
  return {
    from: Math.max(0, boundedFrom - safeOverscan),
    to: Math.min(safeBarCount - 1, boundedTo + safeOverscan),
  };
}

export function resolveVisibleRangeRightPaddingBars(range, barCount, maxRightWhitespaceBars = 0) {
  if (!barCount) {
    return 0;
  }
  const clampedRange = clampVisibleLogicalRange(range, barCount, maxRightWhitespaceBars);
  const visibleBarRange = toVisibleBarIndexRange(clampedRange, barCount, 0, maxRightWhitespaceBars);
  if (!clampedRange || !visibleBarRange) {
    return 0;
  }
  return Math.max(0, Number(clampedRange.to) - (Number(visibleBarRange.to) + 0.5));
}

export function buildRenderWindowSpec(
  range,
  barCount,
  {
    clampVisibleLogicalRangeFn,
    maxWindowBars = null,
    minBars = 0,
    minEdgeBars = 0,
    overscanMultiplier = 1,
  } = {},
) {
  if (!barCount) {
    return null;
  }
  const clampFn = typeof clampVisibleLogicalRangeFn === "function"
    ? clampVisibleLogicalRangeFn
    : ((value, count) => clampVisibleLogicalRange(value, count));
  const clampedRange = clampFn(range, barCount) || {
    from: 0,
    to: Math.max(0, barCount - 1),
  };
  const span = Math.max(1, Math.ceil(clampedRange.to) - Math.floor(clampedRange.from) + 1);
  const edgeBuffer = Math.max(Math.max(0, Number(minEdgeBars) || 0), Math.ceil(span * Math.max(0, Number(overscanMultiplier) || 0)));
  const resolvedMinBars = Math.max(1, Number(minBars) || 1);
  const cappedWindowBars = Number.isFinite(Number(maxWindowBars))
    ? Math.max(resolvedMinBars, Number(maxWindowBars))
    : barCount;
  const requestedWindowSize = Math.max(resolvedMinBars, span + edgeBuffer * 2);
  const windowSize = Math.min(
    barCount,
    Math.max(span, Math.min(requestedWindowSize, cappedWindowBars)),
  );
  const center = (clampedRange.from + clampedRange.to) / 2;
  const maxStart = Math.max(0, barCount - windowSize);
  const start = Math.max(0, Math.min(maxStart, Math.floor(center - windowSize / 2)));
  const end = Math.min(barCount - 1, start + windowSize - 1);
  return {
    start,
    end,
    size: end - start + 1,
    edgeBuffer,
    span,
  };
}

export function resolveBaseSeriesModeLimits(rangePresetKey = "", limitsByTf = {}, fallbackLimits = {}) {
  const normalizedKey = String(rangePresetKey || "").trim();
  const keyParts = normalizedKey.split("|").map((part) => part.trim()).filter(Boolean);
  const tf = keyParts.length >= 3
    ? keyParts[keyParts.length - 2]
    : (keyParts[keyParts.length - 1] || normalizedKey);
  return limitsByTf[tf] || fallbackLimits;
}

export function resolveBaseSeriesMode(
  barCount,
  currentMode = "empty",
  limits = null,
  {
    fullSeriesDirectMaxBars = 0,
    fullBaseDataCacheMaxBars = 0,
  } = {},
) {
  const safeBarCount = Math.max(0, Number(barCount) || 0);
  const startMaxBars = Math.max(1, Number(limits?.startMaxBars) || Number(fullSeriesDirectMaxBars) || 1);
  const retainMaxBars = Math.max(startMaxBars, Number(limits?.retainMaxBars) || startMaxBars);
  if (!safeBarCount) {
    return "empty";
  }
  if (currentMode === "full-series" && safeBarCount <= retainMaxBars) {
    return "full-series";
  }
  if (safeBarCount <= startMaxBars) {
    return "full-series";
  }
  if (safeBarCount <= Math.max(0, Number(fullBaseDataCacheMaxBars) || 0)) {
    return "full-cache-window";
  }
  return "window-cache";
}

export function baseSeriesModeUsesRenderWindow(mode) {
  return mode === "full-cache-window" || mode === "window-cache";
}

export function resolveActiveBarCap(mode, limits, barCount, minBars = 0) {
  if (!barCount) {
    return 0;
  }
  if (mode === "full-series") {
    return Math.max(1, Number(limits?.retainMaxBars) || barCount);
  }
  return Math.max(Math.max(1, Number(minBars) || 1), Number(limits?.renderWindowMaxBars) || Number(limits?.retainMaxBars) || barCount);
}

export function shouldRefreshRenderWindow(
  currentWindow,
  targetRange,
  barCount,
  {
    buildRenderWindowSpecFn,
    maxWindowBars = null,
    resizeThreshold = 1,
  } = {},
) {
  if (!currentWindow) {
    return true;
  }
  const buildSpec = typeof buildRenderWindowSpecFn === "function"
    ? buildRenderWindowSpecFn
    : ((range, count, windowBars) => buildRenderWindowSpec(range, count, { maxWindowBars: windowBars }));
  const desired = buildSpec(targetRange, barCount, maxWindowBars);
  if (!desired) {
    return false;
  }
  const currentSize = Math.max(1, Number(currentWindow.end) - Number(currentWindow.start) + 1);
  if (currentWindow.start < 0 || currentWindow.end >= barCount) {
    return true;
  }
  if (Number(targetRange?.from) < currentWindow.start + desired.edgeBuffer) {
    return true;
  }
  if (Number(targetRange?.to) > currentWindow.end - desired.edgeBuffer) {
    return true;
  }
  return currentSize > Math.ceil(desired.size * resizeThreshold)
    || currentSize < Math.floor(desired.size / resizeThreshold);
}

export function globalToLocalLogicalRange(range, renderWindow, barCount, clampVisibleLogicalRangeFn = clampVisibleLogicalRange) {
  if (!range || !renderWindow) {
    return null;
  }
  const localBarCount = Math.max(0, Number(renderWindow.end) - Number(renderWindow.start) + 1);
  return clampVisibleLogicalRangeFn({
    from: Number(range.from) - Number(renderWindow.start),
    to: Number(range.to) - Number(renderWindow.start),
  }, localBarCount || barCount);
}

export function localToGlobalLogicalRange(range, renderWindow, barCount, clampVisibleLogicalRangeFn = clampVisibleLogicalRange) {
  if (!range || !renderWindow) {
    return clampVisibleLogicalRangeFn(range, barCount);
  }
  return clampVisibleLogicalRangeFn({
    from: Number(range.from) + Number(renderWindow.start),
    to: Number(range.to) + Number(renderWindow.start),
  }, barCount);
}

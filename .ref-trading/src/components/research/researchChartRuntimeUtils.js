export function createEmptyBaseDataCache() {
  return {
    signature: "empty",
    firstTime: null,
    lastTime: null,
    barCount: 0,
    candleData: [],
    volumeData: [],
    volumeByTime: new Map(),
  };
}

export function buildBaseDataSlice(
  chartBars = [],
  toChartTime,
  {
    upVolumeColor = "rgba(34,197,94,0.28)",
    downVolumeColor = "rgba(239,68,68,0.28)",
  } = {},
) {
  const candleData = [];
  const volumeData = [];
  const volumeByTime = new Map();
  for (const bar of Array.isArray(chartBars) ? chartBars : []) {
    const time = typeof toChartTime === "function" ? toChartTime(bar) : null;
    const open = Number(bar?.o);
    const high = Number(bar?.h);
    const low = Number(bar?.l);
    const close = Number(bar?.c);
    if (
      time == null
      || !Number.isFinite(open)
      || !Number.isFinite(high)
      || !Number.isFinite(low)
      || !Number.isFinite(close)
    ) {
      continue;
    }
    candleData.push({
      time,
      open,
      high,
      low,
      close,
    });
    volumeData.push({
      time,
      value: Math.max(0, Number(bar.v) || 0),
      color: close >= open ? upVolumeColor : downVolumeColor,
    });
    volumeByTime.set(time, Number(bar.v) || 0);
  }
  return {
    candleData,
    volumeData,
    volumeByTime,
  };
}

export function buildBaseDataCache(
  chartBars = [],
  previousCache = null,
  {
    toChartTime,
    buildBarSignature,
    createEmptyBaseDataCacheFn = createEmptyBaseDataCache,
    upVolumeColor = "rgba(34,197,94,0.28)",
    downVolumeColor = "rgba(239,68,68,0.28)",
  } = {},
) {
  if (!Array.isArray(chartBars) || !chartBars.length) {
    return createEmptyBaseDataCacheFn();
  }

  const signature = typeof buildBarSignature === "function"
    ? buildBarSignature(chartBars)
    : String(chartBars.length);
  if (previousCache?.signature === signature) {
    return previousCache;
  }

  const firstTime = typeof toChartTime === "function" ? toChartTime(chartBars[0]) : null;
  const lastTime = typeof toChartTime === "function" ? toChartTime(chartBars[chartBars.length - 1]) : null;
  const previousBarCount = Number(previousCache?.barCount) || 0;
  const nextBarCount = chartBars.length;

  if (previousCache && previousBarCount > 0 && Number.isFinite(firstTime) && Number.isFinite(lastTime)) {
    const prependedCount = nextBarCount - previousBarCount;
    const previousFirstTime = Number(previousCache.firstTime);
    const previousLastTime = Number(previousCache.lastTime);

    const isPrependOnly = prependedCount > 0
      && previousLastTime === lastTime
      && typeof toChartTime === "function"
      && toChartTime(chartBars[prependedCount]) === previousFirstTime;
    if (isPrependOnly) {
      const prefix = buildBaseDataSlice(chartBars.slice(0, prependedCount), toChartTime, {
        upVolumeColor,
        downVolumeColor,
      });
      const volumeByTime = new Map(prefix.volumeByTime);
      for (const [time, volume] of previousCache.volumeByTime.entries()) {
        volumeByTime.set(time, volume);
      }
      return {
        signature,
        firstTime,
        lastTime,
        barCount: nextBarCount,
        candleData: [...prefix.candleData, ...previousCache.candleData],
        volumeData: [...prefix.volumeData, ...previousCache.volumeData],
        volumeByTime,
      };
    }

    const appendedCount = nextBarCount - previousBarCount;
    const isAppendOnly = appendedCount > 0
      && previousFirstTime === firstTime
      && typeof toChartTime === "function"
      && toChartTime(chartBars[Math.max(0, previousBarCount - 1)]) === previousLastTime;
    if (isAppendOnly) {
      const suffix = buildBaseDataSlice(chartBars.slice(previousBarCount), toChartTime, {
        upVolumeColor,
        downVolumeColor,
      });
      const volumeByTime = new Map(previousCache.volumeByTime);
      for (const [time, volume] of suffix.volumeByTime.entries()) {
        volumeByTime.set(time, volume);
      }
      return {
        signature,
        firstTime,
        lastTime,
        barCount: nextBarCount,
        candleData: [...previousCache.candleData, ...suffix.candleData],
        volumeData: [...previousCache.volumeData, ...suffix.volumeData],
        volumeByTime,
      };
    }
  }

  const rebuilt = buildBaseDataSlice(chartBars, toChartTime, {
    upVolumeColor,
    downVolumeColor,
  });
  return {
    signature,
    firstTime,
    lastTime,
    barCount: chartBars.length,
    candleData: rebuilt.candleData,
    volumeData: rebuilt.volumeData,
    volumeByTime: rebuilt.volumeByTime,
  };
}

export function sliceBaseDataCache(cache, renderWindow = null) {
  if (!renderWindow) {
    return {
      candleData: cache?.candleData || [],
      volumeData: cache?.volumeData || [],
      volumeByTime: cache?.volumeByTime || new Map(),
    };
  }
  const start = Math.max(0, Number(renderWindow.start) || 0);
  const end = Math.max(start, Number(renderWindow.end) || start);
  return {
    candleData: Array.isArray(cache?.candleData) ? cache.candleData.slice(start, end + 1) : [],
    volumeData: Array.isArray(cache?.volumeData) ? cache.volumeData.slice(start, end + 1) : [],
    volumeByTime: cache?.volumeByTime || new Map(),
  };
}

export function clearTimeoutRefs(refs = [], clearTimeoutFn = globalThis.clearTimeout) {
  for (const ref of refs) {
    if (!ref || ref.current == null) {
      continue;
    }
    clearTimeoutFn(ref.current);
    ref.current = null;
  }
}

export function cancelAnimationFrameRefs(refs = [], cancelAnimationFrameFn = globalThis.cancelAnimationFrame) {
  for (const ref of refs) {
    if (!ref || ref.current == null || typeof cancelAnimationFrameFn !== "function") {
      if (ref && ref.current != null && typeof cancelAnimationFrameFn !== "function") {
        ref.current = null;
      }
      continue;
    }
    cancelAnimationFrameFn(ref.current);
    ref.current = null;
  }
}

export function resetPendingRenderWindowRef(ref, owner = "preset", source = "preset") {
  if (!ref) {
    return;
  }
  ref.current = {
    range: null,
    force: false,
    owner,
    source,
  };
}

export function resetBaseDataCacheRefs(refs = [], createBaseDataCache = createEmptyBaseDataCache) {
  for (const ref of refs) {
    if (!ref) {
      continue;
    }
    ref.current = createBaseDataCache();
  }
}

export const AUTO_TIMEFRAME_BY_VISIBLE_DAYS = [
  { tf: "1m", maxDays: 1 },
  { tf: "2m", maxDays: 2 },
  { tf: "5m", maxDays: 5 },
  { tf: "15m", maxDays: 10 },
  { tf: "1h", maxDays: 22 },
  { tf: "4h", maxDays: 66 },
  { tf: "D", maxDays: 252 },
  { tf: "W", maxDays: Number.POSITIVE_INFINITY },
];

export const AUTO_TIMEFRAME_BY_RANGE = {
  "1D": "1m",
  "1W": "5m",
  "2W": "15m",
  "1M": "1h",
  "3M": "5m",
  "6M": "D",
  "1Y": "D",
  "2Y": "W",
};

export const CHART_RANGE_PRESET_OPTIONS = ["1D", "1W", "2W", "1M", "3M", "6M", "1Y", "2Y"];
export const RANGE_DAYS_BY_KEY = {
  "1D": 1,
  "1W": 5,
  "2W": 10,
  "1M": 22,
  "3M": 66,
  "6M": 125,
  "1Y": 252,
  "2Y": 999,
};

export const SIGNAL_OVERLAY_TIMEFRAME_OPTIONS = ["1m", "2m", "5m", "15m", "30m", "1h", "4h"];
export const SIGNAL_OVERLAY_FOLLOW_CHART = "follow_chart";
export const CHART_WINDOW_MODE_DEFAULT = "default";
export const CHART_WINDOW_MODE_CUSTOM = "custom";
export const CHART_WINDOW_MODE_ALL = "all";
export const CHART_WINDOW_MODE_FULL = "full";
export const DEFAULT_VISIBLE_RANGE_BY_TIMEFRAME = {
  auto: "3M",
  "1m": "1D",
  "2m": "1D",
  "5m": "3M",
  "15m": "2W",
  "30m": "1M",
  "1h": "3M",
  "4h": "6M",
  D: "1Y",
  W: "2Y",
};

const INTRADAY_TIMEFRAME_MINUTES = {
  "1m": 1,
  "2m": 2,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
};

const TRADING_MINUTES_PER_DAY = 390;
const AUTO_TIMEFRAME_HYSTERESIS_RATIO = 0.14;
const WINDOW_PRESET_MATCH_TOLERANCE_RATIO = 0.18;
const FULL_WINDOW_TOLERANCE_RATIO = 0.015;

function normalizeTf(value, fallback = "5m") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function normalizeChartWindowMode(value, fallback = CHART_WINDOW_MODE_DEFAULT) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === CHART_WINDOW_MODE_ALL) {
    return CHART_WINDOW_MODE_ALL;
  }
  if (normalized === CHART_WINDOW_MODE_CUSTOM) {
    return CHART_WINDOW_MODE_CUSTOM;
  }
  return fallback;
}

export function isAllCandlesWindowMode(value) {
  return normalizeChartWindowMode(value) === CHART_WINDOW_MODE_ALL;
}

export function resolveAutoTimeframeByRange(rangeKey, fallback = "D") {
  return AUTO_TIMEFRAME_BY_RANGE[String(rangeKey || "").trim()] || fallback;
}

export function resolveRangeDays(rangeKey, fallback = 66) {
  const rangeDays = Number(RANGE_DAYS_BY_KEY[String(rangeKey || "").trim()]);
  return Number.isFinite(rangeDays) ? rangeDays : fallback;
}

export function resolveDefaultVisibleRangeForTimeframe(tf, fallback = "3M") {
  const normalized = normalizeTf(tf, "");
  return DEFAULT_VISIBLE_RANGE_BY_TIMEFRAME[normalized] || fallback;
}

export function timeframeToMinutes(tf) {
  const normalized = normalizeTf(tf, "");
  return Number.isFinite(INTRADAY_TIMEFRAME_MINUTES[normalized])
    ? INTRADAY_TIMEFRAME_MINUTES[normalized]
    : null;
}

export function getSupportedSignalOverlayTimeframes(baseTfMin = 5) {
  const minimum = Math.max(1, Number(baseTfMin) || 5);
  return SIGNAL_OVERLAY_TIMEFRAME_OPTIONS.filter((tf) => {
    const minutes = timeframeToMinutes(tf);
    return Number.isFinite(minutes) && minutes >= minimum;
  });
}

export function resolveSignalOverlayTimeframe(selection, chartTf, baseTfMin = 5) {
  const supported = getSupportedSignalOverlayTimeframes(baseTfMin);
  if (!supported.length) {
    return null;
  }
  const normalizedSelection = normalizeTf(selection, SIGNAL_OVERLAY_FOLLOW_CHART);
  if (normalizedSelection === SIGNAL_OVERLAY_FOLLOW_CHART) {
    const normalizedChartTf = normalizeTf(chartTf, supported[supported.length - 1]);
    if (supported.includes(normalizedChartTf)) {
      return normalizedChartTf;
    }
    return supported[supported.length - 1];
  }
  if (supported.includes(normalizedSelection)) {
    return normalizedSelection;
  }
  return supported[supported.length - 1];
}

export function resolveOverlayTimeframeSelection(selection, chartTf, baseTfMin = 5) {
  const supported = getSupportedSignalOverlayTimeframes(baseTfMin);
  const requested = normalizeTf(selection, SIGNAL_OVERLAY_FOLLOW_CHART);
  if (!supported.length) {
    return {
      requested,
      effective: null,
      mode: requested === SIGNAL_OVERLAY_FOLLOW_CHART ? SIGNAL_OVERLAY_FOLLOW_CHART : "pinned",
      status: "unsupported",
      supported,
      isFollowingChart: requested === SIGNAL_OVERLAY_FOLLOW_CHART,
      isCoerced: false,
    };
  }

  if (requested === SIGNAL_OVERLAY_FOLLOW_CHART) {
    const effective = resolveSignalOverlayTimeframe(requested, chartTf, baseTfMin);
    return {
      requested,
      effective,
      mode: SIGNAL_OVERLAY_FOLLOW_CHART,
      status: effective ? "native" : "unsupported",
      supported,
      isFollowingChart: true,
      isCoerced: false,
    };
  }

  if (supported.includes(requested)) {
    return {
      requested,
      effective: requested,
      mode: "pinned",
      status: "native",
      supported,
      isFollowingChart: false,
      isCoerced: false,
    };
  }

  const requestedMinutes = timeframeToMinutes(requested);
  const effective = Number.isFinite(requestedMinutes)
    ? supported.reduce((best, candidate) => {
      const candidateMinutes = timeframeToMinutes(candidate);
      const bestMinutes = timeframeToMinutes(best);
      if (!Number.isFinite(candidateMinutes)) {
        return best;
      }
      if (!Number.isFinite(bestMinutes)) {
        return candidate;
      }
      const candidateDistance = Math.abs(candidateMinutes - requestedMinutes);
      const bestDistance = Math.abs(bestMinutes - requestedMinutes);
      if (candidateDistance !== bestDistance) {
        return candidateDistance < bestDistance ? candidate : best;
      }
      return candidateMinutes < bestMinutes ? candidate : best;
    }, supported[0])
    : supported[supported.length - 1];

  return {
    requested,
    effective,
    mode: "pinned",
    status: effective ? "coerced" : "unsupported",
    supported,
    isFollowingChart: false,
    isCoerced: Boolean(effective && effective !== requested),
  };
}

function resolveSupportedChartTimeframe(tf, baseTfMin = 5) {
  const normalizedTf = normalizeTf(tf, "D");
  const minutes = timeframeToMinutes(normalizedTf);
  if (!Number.isFinite(minutes)) {
    return normalizedTf;
  }
  const minimum = Math.max(1, Number(baseTfMin) || 5);
  if (minutes >= minimum) {
    return normalizedTf;
  }
  const supported = SIGNAL_OVERLAY_TIMEFRAME_OPTIONS.find((candidate) => timeframeToMinutes(candidate) >= minimum);
  return supported || "5m";
}

function resolveAutoCandidateByDays(visibleDays, baseTfMin = 5) {
  const safeVisibleDays = Math.max(0, Number(visibleDays) || 0);
  const candidateRule = AUTO_TIMEFRAME_BY_VISIBLE_DAYS.find((rule) => safeVisibleDays <= rule.maxDays)
    || AUTO_TIMEFRAME_BY_VISIBLE_DAYS[AUTO_TIMEFRAME_BY_VISIBLE_DAYS.length - 1];
  return resolveSupportedChartTimeframe(candidateRule.tf, baseTfMin);
}

export function deriveAutoTimeframeForVisibleTimeBounds({
  timeBounds = null,
  fallbackTf = "D",
  currentTf = null,
  baseTfMin = 5,
} = {}) {
  const startMs = Number(timeBounds?.startMs);
  const endMs = Number(timeBounds?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return resolveSupportedChartTimeframe(fallbackTf, baseTfMin);
  }

  const visibleDays = (endMs - startMs) / 86400000;
  const fallbackCandidate = resolveAutoCandidateByDays(visibleDays, baseTfMin);
  const normalizedCurrentTf = currentTf
    ? resolveSupportedChartTimeframe(currentTf, baseTfMin)
    : null;
  if (!normalizedCurrentTf || normalizedCurrentTf === fallbackCandidate) {
    return fallbackCandidate;
  }

  const currentRule = AUTO_TIMEFRAME_BY_VISIBLE_DAYS.find((rule) => rule.tf === normalizedCurrentTf) || null;
  const fallbackRule = AUTO_TIMEFRAME_BY_VISIBLE_DAYS.find((rule) => rule.tf === fallbackCandidate) || null;
  if (!currentRule || !fallbackRule) {
    return fallbackCandidate;
  }

  if (fallbackRule.maxDays > currentRule.maxDays) {
    if (visibleDays <= currentRule.maxDays * (1 + AUTO_TIMEFRAME_HYSTERESIS_RATIO)) {
      return normalizedCurrentTf;
    }
    return fallbackCandidate;
  }

  if (visibleDays >= fallbackRule.maxDays * (1 - AUTO_TIMEFRAME_HYSTERESIS_RATIO)) {
    return normalizedCurrentTf;
  }
  return fallbackCandidate;
}

function normalizeTimeBounds(timeBounds = null) {
  const startMs = Number(timeBounds?.startMs);
  const endMs = Number(timeBounds?.endMs);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return { startMs, endMs };
}

function resolveVisibleTradingDays({
  visibleBars = null,
  effectiveTf = "D",
  timeBounds = null,
} = {}) {
  const normalizedTf = normalizeTf(effectiveTf, "D");
  const barsCount = Math.max(0, Number(visibleBars) || 0);
  if (barsCount > 0) {
    if (normalizedTf === "D") {
      return barsCount;
    }
    if (normalizedTf === "W") {
      return barsCount * 5;
    }
    const tfMinutes = timeframeToMinutes(normalizedTf);
    if (Number.isFinite(tfMinutes) && tfMinutes > 0) {
      return (barsCount * tfMinutes) / TRADING_MINUTES_PER_DAY;
    }
  }
  const normalizedBounds = normalizeTimeBounds(timeBounds);
  if (!normalizedBounds) {
    return null;
  }
  return (normalizedBounds.endMs - normalizedBounds.startMs) / 86400000;
}

function formatCompactWindowSpan(visibleTradingDays) {
  const tradingDays = Math.max(0, Number(visibleTradingDays) || 0);
  if (!Number.isFinite(tradingDays) || tradingDays <= 0) {
    return "--";
  }
  const formatUnit = (value, unit) => {
    const rounded = value >= 10
      ? Math.round(value).toString()
      : value.toFixed(value >= 2 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
    return `${rounded}${unit}`;
  };
  if (tradingDays >= 252) {
    return formatUnit(tradingDays / 252, "Y");
  }
  if (tradingDays >= 22) {
    return formatUnit(tradingDays / 22, "M");
  }
  if (tradingDays >= 5) {
    return formatUnit(tradingDays / 5, "W");
  }
  if (tradingDays >= 1) {
    return formatUnit(tradingDays, "D");
  }
  return formatUnit(tradingDays * 6.5, "h");
}

function resolveNearestRangePreset(visibleTradingDays, toleranceRatio = WINDOW_PRESET_MATCH_TOLERANCE_RATIO) {
  const tradingDays = Math.max(0, Number(visibleTradingDays) || 0);
  if (!Number.isFinite(tradingDays) || tradingDays <= 0) {
    return null;
  }
  let bestMatch = null;
  for (const preset of CHART_RANGE_PRESET_OPTIONS) {
    const presetDays = resolveRangeDays(preset, 0);
    if (!Number.isFinite(presetDays) || presetDays <= 0) {
      continue;
    }
    const ratio = Math.abs(tradingDays - presetDays) / Math.max(presetDays, 1);
    if (!bestMatch || ratio < bestMatch.ratio) {
      bestMatch = { preset, ratio };
    }
  }
  return bestMatch && bestMatch.ratio <= toleranceRatio ? bestMatch.preset : null;
}

function doesVisibleBoundsCoverLoadedBounds(visibleBounds, loadedBounds, toleranceRatio = FULL_WINDOW_TOLERANCE_RATIO) {
  const normalizedVisible = normalizeTimeBounds(visibleBounds);
  const normalizedLoaded = normalizeTimeBounds(loadedBounds);
  if (!normalizedVisible || !normalizedLoaded) {
    return false;
  }
  const loadedSpanMs = Math.max(1, normalizedLoaded.endMs - normalizedLoaded.startMs);
  const toleranceMs = loadedSpanMs * toleranceRatio;
  return normalizedVisible.startMs <= normalizedLoaded.startMs + toleranceMs
    && normalizedVisible.endMs >= normalizedLoaded.endMs - toleranceMs;
}

export function resolveChartWindowDisplayState({
  timeBounds = null,
  visibleBars = null,
  effectiveTf = "D",
  chartRange = "1W",
  chartWindowMode = CHART_WINDOW_MODE_DEFAULT,
  loadedTimeBounds = null,
} = {}) {
  const normalizedMode = normalizeChartWindowMode(chartWindowMode);
  const normalizedRange = String(chartRange || "").trim() || "1W";
  const normalizedBounds = normalizeTimeBounds(timeBounds);
  if (normalizedMode === CHART_WINDOW_MODE_ALL || doesVisibleBoundsCoverLoadedBounds(normalizedBounds, loadedTimeBounds)) {
    return {
      label: "Full",
      menuValue: CHART_WINDOW_MODE_FULL,
      presetKey: null,
      isFull: true,
      isPresetMatch: false,
      hasViewportBounds: Boolean(normalizedBounds),
      visibleTradingDays: resolveVisibleTradingDays({ visibleBars, effectiveTf, timeBounds: normalizedBounds }),
    };
  }
  if (!normalizedBounds) {
    return {
      label: normalizedRange,
      menuValue: normalizedRange,
      presetKey: normalizedRange,
      isFull: false,
      isPresetMatch: true,
      hasViewportBounds: false,
      visibleTradingDays: null,
    };
  }

  const visibleTradingDays = resolveVisibleTradingDays({ visibleBars, effectiveTf, timeBounds: normalizedBounds });
  const presetKey = resolveNearestRangePreset(visibleTradingDays);
  return {
    label: presetKey || formatCompactWindowSpan(visibleTradingDays),
    menuValue: presetKey || "__custom__",
    presetKey,
    isFull: false,
    isPresetMatch: Boolean(presetKey),
    hasViewportBounds: true,
    visibleTradingDays,
  };
}

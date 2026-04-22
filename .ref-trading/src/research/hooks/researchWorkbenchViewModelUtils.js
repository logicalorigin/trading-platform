export function normalizeSpotChartPresetWindowMode(chartWindowMode = "default") {
  const normalized = String(chartWindowMode || "").trim().toLowerCase();
  return normalized === "all" ? "all" : "default";
}

export function shouldAutoExpandSpotHistory({
  hasOlderHistory = false,
  isHydrating = false,
  chartBarsLength = 0,
  defaultVisibleLogicalRange = null,
} = {}) {
  if (!hasOlderHistory || isHydrating) {
    return false;
  }

  const totalBars = Math.max(0, Number(chartBarsLength) || 0);
  if (totalBars <= 0) {
    return false;
  }

  const from = Number(defaultVisibleLogicalRange?.from);
  const to = Number(defaultVisibleLogicalRange?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return false;
  }

  const visibleBars = Math.max(1, Math.round(to - from));
  const hiddenBars = Math.max(0, totalBars - visibleBars);
  const minimumHiddenBars = Math.max(24, Math.round(visibleBars * 0.12));
  return hiddenBars < minimumHiddenBars;
}

export function resolveSpotChartModelWindowMode({
  chartWindowMode = "default",
  candleTf = "auto",
  hasViewportTimeBounds = false,
} = {}) {
  const normalized = String(chartWindowMode || "").trim().toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  if (normalized === "custom") {
    return "custom";
  }
  const normalizedTf = String(candleTf || "").trim().toLowerCase();
  if (normalizedTf && normalizedTf !== "auto" && hasViewportTimeBounds) {
    return "custom";
  }
  return "default";
}

export function buildSpotChartRangePresetKey({
  chartRange = "1W",
  chartWindowMode = "default",
  chartPresetVersion = 0,
} = {}) {
  return [
    String(chartRange || "").trim() || "1W",
    normalizeSpotChartPresetWindowMode(chartWindowMode),
    Math.max(0, Number(chartPresetVersion) || 0),
  ].join("|");
}

export function buildSpotChartBaseSeriesModeKey({
  effectiveTf = "D",
} = {}) {
  return String(effectiveTf || "").trim() || "D";
}

export function buildResearchSpotChartMountSignature({
  hasBars = false,
} = {}) {
  return hasBars ? "research-spot-chart:bars" : "research-spot-chart:empty";
}

export function shouldApplyDefaultRangeOnPresetChange({
  rangePresetChanged = false,
  hasDefaultVisibleRange = false,
  shouldPreserveUserRange = false,
  shouldRecoverStableUserViewport = false,
} = {}) {
  if (!rangePresetChanged || !hasDefaultVisibleRange) {
    return false;
  }
  return !shouldPreserveUserRange && !shouldRecoverStableUserViewport;
}

export function shouldResolvePreservedViewportFromTimeBounds({
  hasPreservedTimeBounds = false,
  shouldPreserveUserRange = false,
  shouldRecoverStableUserViewport = false,
} = {}) {
  if (!hasPreservedTimeBounds) {
    return false;
  }
  return shouldPreserveUserRange || shouldRecoverStableUserViewport;
}

export function shouldAutoFocusSelectedTradeViewport({
  autoFocusSelectedTrade = true,
  selectedTradeId = null,
  chartId = null,
  selectedTradeSourceChartId = null,
} = {}) {
  if (!autoFocusSelectedTrade) {
    return false;
  }
  const normalizedTradeId = typeof selectedTradeId === "string" ? selectedTradeId.trim() : "";
  if (!normalizedTradeId) {
    return false;
  }
  const normalizedChartId = typeof chartId === "string" ? chartId.trim().toLowerCase() : "";
  const normalizedSourceChartId = typeof selectedTradeSourceChartId === "string"
    ? selectedTradeSourceChartId.trim().toLowerCase()
    : "";
  if (normalizedChartId && normalizedSourceChartId && normalizedSourceChartId === normalizedChartId) {
    return false;
  }
  return true;
}

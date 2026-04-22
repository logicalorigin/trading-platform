export const DEFAULT_CHART_TYPE = "candles";
export const VOLUME_CHART_TYPE = "volume_candles";

export function normalizeChartType(value, fallback = DEFAULT_CHART_TYPE) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === VOLUME_CHART_TYPE ? VOLUME_CHART_TYPE : fallback;
}

export function isVolumeChartType(value) {
  return normalizeChartType(value) === VOLUME_CHART_TYPE;
}

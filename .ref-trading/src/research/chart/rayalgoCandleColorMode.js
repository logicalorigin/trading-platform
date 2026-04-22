export const DEFAULT_RAYALGO_CANDLE_COLOR_MODE = "rayalgo";

export function normalizeRayalgoCandleColorMode(
  value,
  fallback = DEFAULT_RAYALGO_CANDLE_COLOR_MODE,
) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "traditional" ? "traditional" : fallback;
}

export function usesTraditionalRayalgoCandleColors(value) {
  return normalizeRayalgoCandleColorMode(value) === "traditional";
}

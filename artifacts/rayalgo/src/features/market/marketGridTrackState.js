import { clampNumber } from "../../lib/formatters";

export const MARKET_GRID_TRACK_SESSION_KEY = "rayalgo:market-grid-track-sizes";
export const LEGACY_MARKET_GRID_CARD_SIZE_SESSION_KEY =
  "rayalgo:market-grid-card-size";
export const LEGACY_MARKET_GRID_CARD_SCALE_SESSION_KEY =
  "rayalgo:market-grid-card-scale";

export const buildEqualTrackWeights = (count) => {
  const safeCount = Math.max(1, count || 1);
  return Array.from({ length: safeCount }, () => 1 / safeCount);
};

export const normalizeMarketGridTrackWeights = (weights, count) => {
  if (!Array.isArray(weights) || weights.length !== count) {
    return buildEqualTrackWeights(count);
  }

  const sanitized = weights.map((value) =>
    Number.isFinite(value) && value > 0 ? value : 0,
  );
  const total = sanitized.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    return buildEqualTrackWeights(count);
  }

  return sanitized.map((value) => value / total);
};

export const normalizeMarketGridTrackLayoutState = (value, cols, rows) => ({
  cols: normalizeMarketGridTrackWeights(value?.cols, cols),
  rows: normalizeMarketGridTrackWeights(value?.rows, rows),
  rowHeights: Array.isArray(value?.rowHeights) ? value.rowHeights : null,
});

export const normalizeMarketGridTrackPixels = (
  values,
  count,
  fallbackPx,
  minPx,
) => {
  const safeCount = Math.max(1, count || 1);
  const safeFallback = Math.max(minPx, fallbackPx || minPx);
  if (!Array.isArray(values) || values.length !== safeCount) {
    return Array.from({ length: safeCount }, () => safeFallback);
  }
  return values.map((value) =>
    Number.isFinite(value) && value > 0
      ? Math.max(minPx, value)
      : safeFallback,
  );
};

export const readMarketGridTrackSession = () => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return {};
    }

    const raw = window.sessionStorage.getItem(MARKET_GRID_TRACK_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    }

    return {};
  } catch (error) {
    return {};
  }
};

export const writeMarketGridTrackSession = (nextState) => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(
      MARKET_GRID_TRACK_SESSION_KEY,
      JSON.stringify(nextState || {}),
    );
    window.sessionStorage.removeItem(LEGACY_MARKET_GRID_CARD_SIZE_SESSION_KEY);
    window.sessionStorage.removeItem(LEGACY_MARKET_GRID_CARD_SCALE_SESSION_KEY);
  } catch (error) {}
};

export const resizeMarketGridTrackWeights = (
  weights,
  dividerIndex,
  deltaPx,
  totalTrackPx,
  minTrackPx,
) => {
  if (
    !Array.isArray(weights) ||
    dividerIndex <= 0 ||
    dividerIndex >= weights.length ||
    !(totalTrackPx > 0)
  ) {
    return weights;
  }

  const currentTrackPx = weights.map((value) => value * totalTrackPx);
  const leftIndex = dividerIndex - 1;
  const rightIndex = dividerIndex;
  const pairTotal = currentTrackPx[leftIndex] + currentTrackPx[rightIndex];
  const safeMin = Math.max(24, Math.min(minTrackPx, pairTotal / 2 - 4));

  if (!(pairTotal > safeMin * 2)) {
    return weights;
  }

  const nextTrackPx = [...currentTrackPx];
  const unclampedLeft = currentTrackPx[leftIndex] + deltaPx;
  const nextLeft = clampNumber(unclampedLeft, safeMin, pairTotal - safeMin);
  const nextRight = pairTotal - nextLeft;

  nextTrackPx[leftIndex] = nextLeft;
  nextTrackPx[rightIndex] = nextRight;

  return normalizeMarketGridTrackWeights(
    nextTrackPx.map((value) => value / totalTrackPx),
    weights.length,
  );
};

export const resizeMarketGridRowPixels = (
  rowHeights,
  dividerIndex,
  deltaPx,
  minRowHeight,
) => {
  if (
    !Array.isArray(rowHeights) ||
    dividerIndex <= 0 ||
    dividerIndex >= rowHeights.length
  ) {
    return rowHeights;
  }

  const rowIndex = dividerIndex - 1;
  const nextRowIndex = dividerIndex;
  const pairTotal = rowHeights[rowIndex] + rowHeights[nextRowIndex];
  const safeMin = Math.max(24, Math.min(minRowHeight, pairTotal / 2 - 4));

  if (!(pairTotal > safeMin * 2)) {
    return rowHeights;
  }

  const nextRowHeights = [...rowHeights];
  const unclampedTop = rowHeights[rowIndex] + deltaPx;
  const nextTop = clampNumber(unclampedTop, safeMin, pairTotal - safeMin);
  const nextBottom = pairTotal - nextTop;

  nextRowHeights[rowIndex] = nextTop;
  nextRowHeights[nextRowIndex] = nextBottom;

  return nextRowHeights;
};

export const buildMarketGridResizeHandleKey = (
  mode,
  colGapIndex,
  rowGapIndex,
) =>
  [
    mode,
    Number.isFinite(colGapIndex) ? colGapIndex : "na",
    Number.isFinite(rowGapIndex) ? rowGapIndex : "na",
  ].join(":");

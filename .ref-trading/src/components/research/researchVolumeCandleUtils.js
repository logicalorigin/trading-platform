const DEFAULT_GAP_PX = 1;
const DEFAULT_MIN_WIDTH_PX = 2;
const DEFAULT_MIN_BODY_HEIGHT_PX = 1;
const DEFAULT_WICK_WIDTH_RATIO = 0.12;
const DEFAULT_MAX_WICK_WIDTH_PX = 1.2;
const DEFAULT_MIN_DISPLAY_WIDTH_PX = 2;

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePositiveVolumes(volumes = []) {
  return (Array.isArray(volumes) ? volumes : []).map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  });
}

export function computeVolumeWidths(
  volumes = [],
  {
    availableWidth = 0,
    gapPx = DEFAULT_GAP_PX,
    minWidthPx = DEFAULT_MIN_WIDTH_PX,
  } = {},
) {
  const normalizedVolumes = normalizePositiveVolumes(volumes);
  const barCount = normalizedVolumes.length;
  if (!barCount) {
    return [];
  }

  const safeGapPx = Math.max(0, Number(gapPx) || 0);
  const safeAvailableWidth = Math.max(0, Number(availableWidth) || 0);
  const totalGapWidth = Math.max(0, (barCount - 1) * safeGapPx);
  const usableWidth = Math.max(0, safeAvailableWidth - totalGapWidth);
  if (usableWidth <= 0) {
    return Array.from({ length: barCount }, () => 0);
  }

  const floorWidth = Math.max(1, Number(minWidthPx) || DEFAULT_MIN_WIDTH_PX);
  if ((floorWidth * barCount) >= usableWidth) {
    const fallbackWidth = usableWidth / barCount;
    return Array.from({ length: barCount }, () => fallbackWidth);
  }

  const totalVolume = normalizedVolumes.reduce((sum, value) => sum + value, 0);
  const rawWidths = totalVolume > 0
    ? normalizedVolumes.map((value) => Math.max(floorWidth, (value / totalVolume) * usableWidth))
    : Array.from({ length: barCount }, () => Math.max(floorWidth, usableWidth / barCount));
  const rawTotalWidth = rawWidths.reduce((sum, value) => sum + value, 0);

  if (!(rawTotalWidth > 0)) {
    return Array.from({ length: barCount }, () => usableWidth / barCount);
  }

  const scale = usableWidth / rawTotalWidth;
  return rawWidths.map((value) => value * scale);
}

export function computeXPositions(widths = [], leftPad = 0, gapPx = DEFAULT_GAP_PX) {
  const positions = [];
  const safeGapPx = Math.max(0, Number(gapPx) || 0);
  let cursorX = Number(leftPad) || 0;
  for (const width of (Array.isArray(widths) ? widths : [])) {
    positions.push(cursorX);
    cursorX += Math.max(0, Number(width) || 0) + safeGapPx;
  }
  return positions;
}

export function buildEquivolumeLayout(
  bars = [],
  {
    volumes = [],
    left = 0,
    right = 0,
    gapPx = DEFAULT_GAP_PX,
    minWidthPx = DEFAULT_MIN_WIDTH_PX,
  } = {},
) {
  const sourceBars = Array.isArray(bars) ? bars : [];
  if (!sourceBars.length) {
    return [];
  }

  const safeLeft = Number(left) || 0;
  const safeRight = Number(right) || safeLeft;
  const widths = computeVolumeWidths(volumes, {
    availableWidth: Math.max(0, safeRight - safeLeft),
    gapPx,
    minWidthPx,
  });
  const xPositions = computeXPositions(widths, safeLeft, gapPx);

  return sourceBars.map((bar, index) => {
    const width = Math.max(0, Number(widths[index]) || 0);
    const x = Number(xPositions[index]) || safeLeft;
    return {
      index,
      bar,
      x,
      width,
      centerX: x + (width / 2),
      volume: Number(volumes[index]) || 0,
    };
  });
}

export function resolveVolumeWickWidthPx(
  widthPx,
  {
    widthRatio = DEFAULT_WICK_WIDTH_RATIO,
    maxWidthPx = DEFAULT_MAX_WICK_WIDTH_PX,
  } = {},
) {
  const width = Math.max(1, Number(widthPx) || 1);
  return Math.max(1, Math.min(Number(maxWidthPx) || DEFAULT_MAX_WICK_WIDTH_PX, width * (Number(widthRatio) || DEFAULT_WICK_WIDTH_RATIO)));
}

export function resolveDisplayVolumeWidthPx(
  widthPx,
  {
    minDisplayWidthPx = DEFAULT_MIN_DISPLAY_WIDTH_PX,
  } = {},
) {
  const resolvedWidth = Math.max(0, Number(widthPx) || 0);
  const minWidth = Math.max(1, Number(minDisplayWidthPx) || DEFAULT_MIN_DISPLAY_WIDTH_PX);
  if (!(resolvedWidth > 0)) {
    return minWidth;
  }
  return Math.max(minWidth, resolvedWidth);
}

export function buildVolumeCandleGeometry({
  x,
  openY,
  highY,
  lowY,
  closeY,
  widthPx,
  minBodyHeightPx = DEFAULT_MIN_BODY_HEIGHT_PX,
} = {}) {
  const leftX = Number(x);
  const open = Number(openY);
  const high = Number(highY);
  const low = Number(lowY);
  const close = Number(closeY);
  const width = Math.max(1, Number(widthPx) || 1);

  if (
    !Number.isFinite(leftX)
    || !Number.isFinite(open)
    || !Number.isFinite(high)
    || !Number.isFinite(low)
    || !Number.isFinite(close)
  ) {
    return null;
  }

  const bodyTop = Math.min(open, close);
  const bodyBottom = Math.max(open, close);
  const bodyHeight = Math.max(Number(minBodyHeightPx) || DEFAULT_MIN_BODY_HEIGHT_PX, bodyBottom - bodyTop);

  return {
    wickX: leftX + (width / 2),
    wickTop: Math.min(high, low),
    wickBottom: Math.max(high, low),
    wickWidth: resolveVolumeWickWidthPx(width),
    bodyLeft: leftX,
    bodyTop,
    bodyWidth: width,
    bodyHeight,
  };
}

export function buildVolumeBarGeometry({
  x,
  widthPx,
  volumeY,
  paneBottomY,
} = {}) {
  const left = Number(x);
  const width = Math.max(0, Number(widthPx) || 0);
  const top = Number(volumeY);
  const bottom = Number(paneBottomY);

  if (!Number.isFinite(left) || !Number.isFinite(width) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return null;
  }

  const clampedTop = Math.min(top, bottom);
  return {
    left,
    top: clampedTop,
    width,
    height: Math.max(0, bottom - clampedTop),
  };
}

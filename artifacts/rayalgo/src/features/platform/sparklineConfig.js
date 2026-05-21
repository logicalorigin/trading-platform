export const SPARKLINE_RENDER_POINT_LIMIT = 40;
export const TABLE_SPARKLINE_WIDTH = 58;
export const TABLE_SPARKLINE_HEIGHT = 16;
export const TABLE_SPARKLINE_COMPACT_WIDTH = 44;
export const TABLE_SPARKLINE_COMPACT_HEIGHT = 12;

const hashSparklineSymbol = (symbol) =>
  String(symbol || "")
    .split("")
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 2147483647, 23);

const seededRandom = (seed) => {
  let state = Math.max(1, seed % 2147483647);
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
};

export const buildDetailedFallbackSparklineData = ({
  symbol,
  current,
  previous,
  pointCount = SPARKLINE_RENDER_POINT_LIMIT,
}) => {
  const end = Number(current);
  if (!Number.isFinite(end) || end <= 0) return [];

  const requestedCount = Math.max(2, Math.floor(Number(pointCount) || 0));
  const start =
    Number.isFinite(Number(previous)) && Number(previous) > 0
      ? Number(previous)
      : end * 0.9975;
  const span = Math.max(Math.abs(end - start), Math.abs(end) * 0.0015, 0.01);
  const random = seededRandom(hashSparklineSymbol(symbol));
  const rawNoise = [];
  let walk = 0;

  for (let index = 0; index < requestedCount; index += 1) {
    if (index === 0) {
      rawNoise.push(0);
      continue;
    }
    walk += (random() - 0.5) * span * 0.34;
    rawNoise.push(walk);
  }

  const terminalNoise = rawNoise[rawNoise.length - 1] || 0;

  return Array.from({ length: requestedCount }, (_, index) => {
    const t = index / (requestedCount - 1);
    const trend = start + (end - start) * t;
    const bridgeNoise = rawNoise[index] - terminalNoise * t;
    const edgeTaper = Math.sin(Math.PI * t);
    const value =
      index === 0
        ? start
        : index === requestedCount - 1
          ? end
          : trend + bridgeNoise * (0.45 + edgeTaper * 0.55);

    return {
      i: index,
      v: Math.max(0.01, value),
    };
  });
};

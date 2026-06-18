const normalizeGexCoverageTicker = (ticker) =>
  String(ticker || "")
    .trim()
    .toUpperCase();

export const resolveMarketChartGexProjectionEnabled = ({
  ticker,
  historicalDataEnabled,
}) => Boolean(normalizeGexCoverageTicker(ticker) && historicalDataEnabled);

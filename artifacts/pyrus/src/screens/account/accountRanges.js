export const ACCOUNT_RANGES = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "ALL"];

export const normalizeAccountRange = (value, fallback = "ALL") =>
  ACCOUNT_RANGES.includes(value) ? value : fallback;

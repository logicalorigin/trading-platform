export const ACCOUNT_HISTORY_RANGES = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "ALL",
] as const;

export type AccountRange = (typeof ACCOUNT_HISTORY_RANGES)[number];

export function normalizeAccountRange(raw: unknown): AccountRange {
  const value = typeof raw === "string" ? raw.toUpperCase() : "1M";
  return ACCOUNT_HISTORY_RANGES.includes(value as AccountRange)
    ? (value as AccountRange)
    : "1M";
}

export function accountRangeStart(
  range: AccountRange,
  now = new Date(),
): Date | null {
  const start = new Date(now.getTime());

  switch (range) {
    case "1D":
      start.setTime(now.getTime() - 24 * 60 * 60_000);
      return start;
    case "1W":
      start.setUTCDate(now.getUTCDate() - 7);
      return start;
    case "1M":
      start.setUTCMonth(now.getUTCMonth() - 1);
      return start;
    case "3M":
      start.setUTCMonth(now.getUTCMonth() - 3);
      return start;
    case "6M":
      start.setUTCMonth(now.getUTCMonth() - 6);
      return start;
    case "YTD":
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    case "1Y":
      start.setUTCFullYear(now.getUTCFullYear() - 1);
      return start;
    case "ALL":
      return null;
  }
}

export function accountSnapshotBucketSizeMs(range: AccountRange): number | null {
  switch (range) {
    case "1D":
    case "1W":
      return 60_000;
    case "1M":
      return 5 * 60_000;
    case "3M":
    case "YTD":
      return 30 * 60_000;
    case "6M":
      return 60 * 60_000;
    case "1Y":
      return 2 * 60 * 60_000;
    case "ALL":
      return 24 * 60 * 60_000;
  }
}

export function accountBenchmarkTimeframeForRange(
  range: AccountRange,
): "1m" | "1h" | "1d" {
  if (range === "1D") {
    return "1m";
  }
  return range === "1W" || range === "1M" ? "1h" : "1d";
}

export function accountBenchmarkLimitForRange(range: AccountRange): number {
  if (range === "1D") {
    return 1_500;
  }
  if (range === "1W") {
    return 300;
  }
  return 1_000;
}

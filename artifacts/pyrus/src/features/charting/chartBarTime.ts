/**
 * Resolve a bar timestamp value to epoch milliseconds, or null.
 *
 * Accepts a Date, a number (seconds or milliseconds — values >= 1e12 are treated
 * as already-ms), or a parseable date string.
 *
 * Extracted to a dependency-free leaf module so both chartApiBars.js and
 * chartHydrationRuntime.js can share it without creating an import cycle
 * (chartApiBars already imports from chartHydrationRuntime).
 */
export const resolveBarTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const timeMs = value.getTime();
    return Number.isFinite(timeMs) ? timeMs : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

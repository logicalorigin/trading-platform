// Pure, dependency-free helpers behind the account/algo stream freshness hooks.
// Extracted so the staleness math and the re-render gate can be unit-tested
// without a React renderer or a live stream.

/**
 * A stream is "fresh" when its most recent event arrived no longer than
 * `thresholdMs` ago. A null timestamp (no event yet) is never fresh.
 */
export const isStreamFresh = (
  lastEventAt: number | null,
  nowMs: number,
  thresholdMs: number,
): boolean => lastEventAt != null && nowMs - lastEventAt <= thresholdMs;

/**
 * Shallow field-by-field equality for a freshness snapshot. The hooks feed this
 * into setState (`prev => freshnessUnchanged(prev, next) ? prev : next`) so React
 * bails out of the re-render when nothing changed — i.e. the host re-renders only
 * when a freshness field actually flips, not on every staleness poll.
 */
export const freshnessUnchanged = <T extends Record<string, unknown>>(
  prev: T,
  next: T,
): boolean => {
  const keys = Object.keys(next) as Array<keyof T>;
  return keys.every((key) => prev[key] === next[key]);
};

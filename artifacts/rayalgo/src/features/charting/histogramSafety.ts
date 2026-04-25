// Lightweight Charts asserts histogram values fall within
// ±90_071_992_547_409.91 (~9e13). A handful of upstream feeds (cumulative
// session volume, malformed CPG payloads, stitched ticks) have surfaced
// values 10-100x larger that crash the entire chart surface. Cap well below
// the assertion limit (9e12 = 9 trillion shares — roughly 100,000x typical
// SPY daily volume) and use whitespace points (no `value`) for anything
// that fails the sanity check so the bar shows as a gap instead of taking
// the whole chart down.
export const HISTOGRAM_VALUE_DISPLAY_CAP = 9_000_000_000_000;

export const isHistogramValueSafe = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= HISTOGRAM_VALUE_DISPLAY_CAP;

export const sanitizeHistogramPoint = <T extends Record<string, unknown>>(
  point: T,
): Record<string, unknown> => {
  if (isHistogramValueSafe(point["value"])) {
    return point;
  }
  const { value: _value, color: _color, ...rest } = point;
  return rest;
};

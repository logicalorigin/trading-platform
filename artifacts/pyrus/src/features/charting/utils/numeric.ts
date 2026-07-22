/**
 * Coerce an unknown value to a finite number, or null.
 *
 * Numeric inputs pass through when finite. String inputs are parsed after
 * stripping currency/percent/whitespace separators (`$ , %` and spaces), so
 * values like "$1,234.50" or "12%" resolve to their numeric form.
 *
 * Consolidated from previously-duplicated copies in flowChartEvents.ts,
 * chartEvents.ts, chartPositionOverlays.ts, and useChartPositionOverlays.ts.
 */
export const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[$,%\s,]/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

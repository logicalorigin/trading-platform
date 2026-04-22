export function normalizeSymbol(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "AMEX:SPY";
  }
  return trimmed.includes(":")
    ? trimmed.toUpperCase()
    : `AMEX:${trimmed.toUpperCase()}`;
}

export const RESEARCH_REGIME_OPTIONS = ["bull", "range", "bear"];

export function normalizeAllowedRegimes(value = null, fallback = RESEARCH_REGIME_OPTIONS) {
  const base = Array.isArray(fallback) && fallback.length
    ? fallback
    : RESEARCH_REGIME_OPTIONS;
  const rawValues = Array.isArray(value)
    ? value
    : (typeof value === "string" ? [value] : []);
  const next = [];
  rawValues.forEach((entry) => {
    const normalized = String(entry || "").trim().toLowerCase();
    if (!RESEARCH_REGIME_OPTIONS.includes(normalized) || next.includes(normalized)) {
      return;
    }
    next.push(normalized);
  });
  return next.length ? next : [...base];
}

export function deriveAllowedRegimesFromLegacyRegimeFilter(value, fallback = RESEARCH_REGIME_OPTIONS) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "all") {
    return [...fallback];
  }
  if (normalized === "not_bear") {
    return ["bull", "range"];
  }
  const encodedRegimes = normalized
    .split(/[^a-z]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (encodedRegimes.length) {
    const normalizedEncodedRegimes = normalizeAllowedRegimes(encodedRegimes, []);
    if (normalizedEncodedRegimes.length) {
      return normalizedEncodedRegimes;
    }
  }
  if (RESEARCH_REGIME_OPTIONS.includes(normalized)) {
    return [normalized];
  }
  return [...fallback];
}

export function deriveLegacyRegimeFilterFromAllowedRegimes(value = null) {
  const allowedRegimes = normalizeAllowedRegimes(value);
  if (allowedRegimes.length === RESEARCH_REGIME_OPTIONS.length) {
    return "none";
  }
  if (allowedRegimes.length === 1) {
    return allowedRegimes[0];
  }
  return allowedRegimes.join("+");
}

export function regimePassesFilter(regime, allowedRegimes = null) {
  const normalizedRegime = String(regime || "").trim().toLowerCase();
  if (!RESEARCH_REGIME_OPTIONS.includes(normalizedRegime)) {
    return true;
  }
  return normalizeAllowedRegimes(allowedRegimes).includes(normalizedRegime);
}

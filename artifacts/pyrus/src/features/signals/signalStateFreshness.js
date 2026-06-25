const NON_CURRENT_SIGNAL_STATUSES = new Set([
  "idle",
  "stale",
  "error",
  "pending",
  "unavailable",
  "unknown",
]);

// A latched buy/sell stays displayed through an idle market or data gap;
// non-current status styles the signal, it does not hide it. Only data problems
// (error/unavailable) or not-yet-evaluated cells hide the direction.
const SIGNAL_DIRECTION_DISPLAY_STATUSES = new Set(["ok", "idle", "stale"]);

export const normalizeSignalDirection = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : "";
};

export const normalizeTrendSignalDirection = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bullish") return "buy";
  if (normalized === "bearish") return "sell";
  return "";
};

export const normalizeSignalStatus = (state) =>
  String(state?.status || "ok").trim().toLowerCase();

export const isSignalStateCurrent = (state) => {
  if (!state || state.active === false) return false;
  return !NON_CURRENT_SIGNAL_STATUSES.has(normalizeSignalStatus(state));
};

export const getCurrentSignalDirection = (state) => {
  // The matrix reflects each cell's LIVE trend (the continuously re-evaluated
  // stage direction the backend entry gate trades on via getTrendDirectionsForSymbol),
  // not the sparse, stale-latching last crossover. currentSignalDirection latches
  // the last discrete crossover (applyStoredSignalDirectionLatch) and can oppose
  // the live trend for long stretches, so it is only a fallback when no trend is
  // present. "Tradeable right now" stays distinguished by fresh/actionEligible.
  const direction =
    normalizeTrendSignalDirection(state?.trendDirection) ||
    normalizeTrendSignalDirection(state?.indicatorSnapshot?.trendDirection) ||
    normalizeSignalDirection(state?.currentSignalDirection);
  if (!direction || !state || state.active === false) return "";
  return SIGNAL_DIRECTION_DISPLAY_STATUSES.has(normalizeSignalStatus(state))
    ? direction
    : "";
};

export const hasCurrentSignalDirection = (state) =>
  Boolean(getCurrentSignalDirection(state));

export const isCurrentFreshSignalState = (state) =>
  Boolean(isSignalStateCurrent(state) && state?.fresh);

export const isProblemSignalState = (state) => {
  const status = normalizeSignalStatus(state);
  return Boolean(state?.lastError || status === "error" || status === "unavailable");
};

export const isStaleSignalState = (state) =>
  normalizeSignalStatus(state) === "stale";

export const isIdleSignalState = (state) =>
  normalizeSignalStatus(state) === "idle";

const NON_CURRENT_SIGNAL_STATUSES = new Set(["stale", "error", "unavailable", "unknown"]);

export const normalizeSignalDirection = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : "";
};

export const normalizeSignalStatus = (state) =>
  String(state?.status || "ok").trim().toLowerCase();

export const isSignalStateCurrent = (state) => {
  if (!state || state.active === false) return false;
  return !NON_CURRENT_SIGNAL_STATUSES.has(normalizeSignalStatus(state));
};

export const getCurrentSignalDirection = (state) => {
  const direction = normalizeSignalDirection(state?.currentSignalDirection);
  return direction && isSignalStateCurrent(state) ? direction : "";
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

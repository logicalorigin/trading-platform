export const SHELL_STATE_LABELS = Object.freeze({
  live: Object.freeze({
    label: "LIVE",
    tone: "positive",
    description: "Current live provider stream or fresh broker state.",
  }),
  delayed: Object.freeze({
    label: "DELAYED",
    tone: "warning",
    description: "Provider data is intentionally delayed or not realtime.",
  }),
  stale: Object.freeze({
    label: "STALE",
    tone: "warning",
    description: "Last known data exists, but freshness is outside tolerance.",
  }),
  simulated: Object.freeze({
    label: "SIMULATED",
    tone: "neutral",
    description: "Paper, replay, or locally simulated operating state.",
  }),
  shadow: Object.freeze({
    label: "SHADOW",
    tone: "neutral",
    description: "Shadow-mode state that cannot place live broker orders.",
  }),
  disconnected: Object.freeze({
    label: "DISCONNECTED",
    tone: "danger",
    description: "Required provider or broker connection is unavailable.",
  }),
  degraded: Object.freeze({
    label: "DEGRADED",
    tone: "warning",
    description: "Service is reachable, but some capabilities are impaired.",
  }),
  loading: Object.freeze({
    label: "LOADING",
    tone: "pending",
    description: "State is still being loaded or hydrated.",
  }),
});

const STATE_ALIASES = Object.freeze({
  connected: "live",
  current: "live",
  realtime: "live",
  real_time: "live",
  paper: "simulated",
  sim: "simulated",
  offline: "disconnected",
  closed: "disconnected",
  unavailable: "disconnected",
  pending: "loading",
  hydrating: "loading",
  fetching: "loading",
});

export const normalizeShellState = (value, fallback = "loading") => {
  const raw = String(value || "").trim().toLowerCase();
  const normalized = STATE_ALIASES[raw] || raw;
  if (Object.prototype.hasOwnProperty.call(SHELL_STATE_LABELS, normalized)) {
    return normalized;
  }
  return Object.prototype.hasOwnProperty.call(SHELL_STATE_LABELS, fallback)
    ? fallback
    : "loading";
};

export const buildShellStateLabel = (value, options = {}) => {
  const state = normalizeShellState(value, options.fallback);
  const meta = SHELL_STATE_LABELS[state];
  return {
    state,
    label: meta.label,
    tone: meta.tone,
    description: options.context
      ? `${options.context}: ${meta.description}`
      : meta.description,
  };
};

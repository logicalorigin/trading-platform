import { CSS_COLOR } from "./uiTokens.jsx";

/**
 * Shared request-health -> status tone mapping, per the design doctrine:
 * green = healthy/live, amber = stale/pending/degraded/rate-limited,
 * red = hard failure, dim = intentionally off / idle, muted = empty.
 *
 * Order matters: classifyRequestHealth returns the FIRST matching status,
 * most severe first, so a hard error outranks staleness which outranks
 * loading. "off" means the feature is intentionally disabled AND we could
 * verify that (a failed profile/status fetch is an error, not "off").
 */
const HEALTH_TONE = {
  error: CSS_COLOR.red,
  rateLimited: CSS_COLOR.amber,
  degraded: CSS_COLOR.amber,
  stale: CSS_COLOR.amber,
  loading: CSS_COLOR.textDim,
  off: CSS_COLOR.textDim,
  empty: CSS_COLOR.textMuted,
  healthy: CSS_COLOR.green,
};

const HEALTH_LABEL = {
  error: "ERROR",
  rateLimited: "RATE LIMITED",
  degraded: "DEGRADED",
  stale: "STALE",
  loading: "LOADING",
  off: "OFF",
  empty: "NO DATA",
  healthy: "LIVE",
};

export const classifyRequestHealth = ({
  error = false,
  rateLimited = false,
  degraded = false,
  stale = false,
  loading = false,
  off = false,
  empty = false,
} = {}) => {
  if (error) return "error";
  if (rateLimited) return "rateLimited";
  if (degraded) return "degraded";
  if (stale) return "stale";
  if (loading) return "loading";
  if (off) return "off";
  if (empty) return "empty";
  return "healthy";
};

export const requestHealthTone = (status) =>
  HEALTH_TONE[status] || CSS_COLOR.textMuted;

export const requestHealthLabel = (status) => HEALTH_LABEL[status] || "";

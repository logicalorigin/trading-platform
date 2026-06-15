import { collectDataIssuesFromRecord, combineDataIssues } from "./dataIssueModel.js";

// Plain-language text for backend resilience reason codes. Source of the codes:
// BACKEND_RESILIENCE_CATALOGUE.md (orders/options/bridge/db/stream reasons).
export const RESILIENCE_REASON_TEXT = {
  orders_backoff: "Orders are temporarily backed off after repeated broker errors.",
  orders_cached_stale: "Showing the last known orders; the live read is failing.",
  open_orders_timeout: "The broker open-orders read timed out; showing cached orders.",
  open_orders_error: "The broker open-orders read errored; showing cached orders.",
  options_backoff: "Option data upstream is backed off; values may be stale or incomplete.",
  options_degraded_empty: "Option data came back empty and is degraded.",
  option_chart_stale_fallback: "Showing a cached option chart; the live load failed.",
  list_stale_db_backoff: "Showing a cached list; the database is temporarily backed off.",
  write_backpressure_timeout: "The live stream fell behind and was dropped; reconnecting.",
  quotes_backoff: "Quotes are temporarily backed off after repeated errors.",
  ibkr_bridge_work_backoff: "The broker bridge is backed off after repeated failures.",
  ibkr_bridge_lane_backoff: "A broker bridge lane is backed off after repeated failures.",
  ibkr_bridge_lane_queue_full: "The broker bridge is saturated and shedding requests.",
  ibkr_bridge_lane_timeout: "A broker bridge request timed out while queued.",
  gex_dashboard_timeout: "The GEX dashboard timed out; showing the last result.",
  reconnecting: "The live connection dropped and is reconnecting.",
};

// Reasons that are transient / self-healing -> amber. Everything else -> red.
// (Decision Q2: amber for self-healing pressure, red for degradation served to the user.)
const TRANSIENT_RESILIENCE_REASONS = new Set([
  "reconnecting",
  "list_stale_db_backoff",
  "ibkr_bridge_work_backoff",
  "ibkr_bridge_lane_backoff",
  "ibkr_bridge_lane_queue_full",
  "ibkr_bridge_lane_timeout",
  "quotes_backoff",
]);

const normalizeReason = (reason) =>
  String(reason || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export const humanizeResilienceReason = (reason) => {
  const key = normalizeReason(reason);
  if (!key) return null;
  return RESILIENCE_REASON_TEXT[key] || key.replace(/_+/g, " ");
};

// Severity hint for a reason code, to pass as <ResilienceMarker severity={...} />.
// Widgets may override when they have better context.
export const resilienceSeverityForReason = (reason) =>
  TRANSIENT_RESILIENCE_REASONS.has(normalizeReason(reason)) ? "attention" : "warning";

// Build resilience issues for a widget from a backend record. Delegates to the
// shared collector (which already maps stale/degraded/fallback/unavailable and
// suppresses market-closed noise), then fills any empty summary with friendly
// reason text. Returns DataIssue[] sorted by the collector.
export const collectWidgetIssues = (record, options = {}) => {
  const issues = collectDataIssuesFromRecord(record, options);
  return issues.map((issue) => {
    if (issue.summary) return issue;
    const friendly = humanizeResilienceReason(issue.reason);
    return friendly ? { ...issue, summary: friendly } : issue;
  });
};

export { combineDataIssues };

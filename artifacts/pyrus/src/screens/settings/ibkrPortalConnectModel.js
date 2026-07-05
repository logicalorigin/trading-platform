// Interactive Brokers Client Portal (hosted gateway) connect panel model
// helpers. Backend surface: GET /api/broker-execution/ibkr-portal/readiness,
// POST /api/broker-execution/ibkr-portal/connect, GET
// /api/broker-execution/ibkr-portal/status, POST
// /api/broker-execution/ibkr-portal/disconnect. Connect opens loginPath (the
// proxied IBKR Client Portal Gateway login page) in a popup; the frontend
// polls status until it reports "connected" or the popup closes.

export function canManageIbkrPortalConnections(user) {
  return user?.role === "admin";
}

// Human-friendly copy for the readiness/status codes emitted by
// artifacts/api-server/src/services/ibkr-portal-session.ts
// (PortalConnectionStatus). Unmapped codes fall back to their raw value so a
// new status still renders.
export const IBKR_PORTAL_STATUS_LABELS = Object.freeze({
  unavailable: "runtime unavailable",
  disconnected: "not connected",
  gateway_starting: "gateway starting",
  needs_login: "login required",
  competing: "in use elsewhere",
  connected: "connected",
});

export function formatIbkrPortalStatus(status) {
  return IBKR_PORTAL_STATUS_LABELS[status] || status || "unknown";
}

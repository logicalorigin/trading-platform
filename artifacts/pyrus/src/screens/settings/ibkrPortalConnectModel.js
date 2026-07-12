// Interactive Brokers Client Portal (hosted gateway) connect panel model
// helpers. Backend surface: GET /api/broker-execution/ibkr-portal/readiness,
// POST /api/broker-execution/ibkr-portal/connect, GET
// /api/broker-execution/ibkr-portal/status, POST
// /api/broker-execution/ibkr-portal/disconnect. Connect opens its one-time
// loginPath inside the isolated in-app dialog; the frontend polls status until
// the server verifies the authenticated session or the dialog closes.

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

export function isTerminalIbkrPortalConnectStatus(readiness) {
  return (
    readiness?.status === "disconnected" && readiness?.gatewayRunning === false
  );
}

export const IBKR_PORTAL_LOGIN_TIMEOUT_MS = 5 * 60_000 + 30_000;

export function hasIbkrPortalLoginTimedOut(startedAt, now) {
  return now - startedAt > IBKR_PORTAL_LOGIN_TIMEOUT_MS;
}

export function restoreIbkrPortalFocus(target) {
  if (
    !target ||
    target.isConnected === false ||
    typeof target.focus !== "function"
  ) {
    return false;
  }
  target.focus();
  return true;
}

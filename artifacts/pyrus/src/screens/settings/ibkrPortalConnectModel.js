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

export function buildIbkrPortalProgressModel({
  readiness,
  connecting = false,
} = {}) {
  const status = readiness?.status || (connecting ? "gateway_starting" : "disconnected");
  const competing = status === "competing";
  const startingFromStaleReadiness = connecting && status === "disconnected";
  const connected = status === "connected" && readiness?.authenticated === true;
  const gatewayComplete =
    !startingFromStaleReadiness &&
    readiness?.gatewayRunning === true &&
    status !== "gateway_starting";
  const browserLoginComplete =
    readiness?.browserLoginComplete === true || connected;
  const loginStepComplete = browserLoginComplete && !competing;
  const currentStep = connected
    ? null
    : competing
      ? "login"
      : loginStepComplete
      ? "session"
      : gatewayComplete
        ? "login"
        : "gateway";
  const stepStatus = (id, complete) =>
    complete ? "complete" : currentStep === id ? "current" : "pending";
  const steps = [
    {
      id: "gateway",
      label: "Secure gateway",
      status: stepStatus("gateway", gatewayComplete || connected),
    },
    {
      id: "login",
      label: "IBKR login",
      status: stepStatus("login", loginStepComplete),
    },
    {
      id: "session",
      label: "Verify session & accounts",
      status: stepStatus("session", connected),
    },
  ];

  if (connected) {
    const accountCount = Array.isArray(readiness?.accounts)
      ? readiness.accounts.length
      : 0;
    const accountLabel = `${accountCount} account${accountCount === 1 ? "" : "s"} available`;
    return {
      connected,
      browserLoginComplete,
      showLoginViewer: false,
      title: "Connected to IBKR",
      detail: readiness?.selectedAccountId
        ? `${readiness.selectedAccountId} · ${accountLabel}`
        : accountLabel,
      steps,
    };
  }

  if (competing) {
    return {
      connected,
      browserLoginComplete,
      showLoginViewer: true,
      title: "IBKR session needs attention",
      detail:
        readiness?.message ||
        "Another live IBKR session is competing. Re-login to take over this session.",
      steps,
    };
  }

  if (loginStepComplete) {
    return {
      connected,
      browserLoginComplete,
      showLoginViewer: false,
      title: "Verifying your IBKR session",
      detail:
        "IBKR accepted your login. PYRUS is verifying the API session and loading accounts.",
      steps,
    };
  }

  if (gatewayComplete) {
    return {
      connected,
      browserLoginComplete,
      showLoginViewer: true,
      title: "Complete your IBKR login",
      detail:
        readiness?.message ||
        "Finish signing in and approving two-factor authentication in the secure viewer.",
      steps,
    };
  }

  return {
    connected,
    browserLoginComplete,
    showLoginViewer: true,
    title: "Starting IBKR Client Portal",
    detail:
      (!startingFromStaleReadiness && readiness?.message) ||
      "The isolated gateway can take up to about a minute on its first launch.",
    steps,
  };
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

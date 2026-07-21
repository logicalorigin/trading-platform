// Interactive Brokers Client Portal (hosted gateway) connect panel model
// helpers. Backend surface: GET /api/broker-execution/ibkr-portal/readiness,
// POST /api/broker-execution/ibkr-portal/connect, GET
// /api/broker-execution/ibkr-portal/status, POST
// /api/broker-execution/ibkr-portal/disconnect. Connect opens its one-time
// loginPath inside the isolated in-app dialog; the frontend polls status until
// the server verifies the authenticated session or the attempt ends.

export const IBKR_OFFICIAL_CLIENT_PORTAL_URL =
  "https://ndcdyn.interactivebrokers.com/sso/Login?RL=1&menu=A";
export const IBKR_OFFICIAL_CLIENT_SERVICES_URL =
  "https://www.interactivebrokers.com/en/support/individuals.php";

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
  const showVerificationRecovery =
    browserLoginComplete &&
    !connected &&
    !competing &&
    readiness?.apiSessionActivationFailed === true;
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
    const accountLabel = `${accountCount} trading account${accountCount === 1 ? "" : "s"} available`;
    return {
      connected,
      browserLoginComplete,
      showLoginViewer: false,
      showVerificationRecovery: false,
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
      showVerificationRecovery: false,
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
      showVerificationRecovery,
      title: "IBKR sign-in received",
      detail:
        readiness?.message ||
        "PYRUS is opening IBKR's API session and loading accounts; this connection is not active yet.",
      steps,
    };
  }

  if (gatewayComplete) {
    return {
      connected,
      browserLoginComplete,
      showLoginViewer: true,
      showVerificationRecovery: false,
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
    showVerificationRecovery: false,
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

export async function startIbkrPortalConnectWithRecovery({
  start,
  readStatus,
  wait = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 500);
    }),
}) {
  let originalError;
  try {
    return await start();
  } catch (error) {
    originalError = error;
  }
  let status;
  try {
    status = await readStatus();
  } catch {
    try {
      await wait();
      status = await readStatus();
    } catch {
      throw originalError;
    }
  }
  if (status?.status === "needs_login" && status.gatewayRunning === true) {
    try {
      return await start();
    } catch {
      // Preserve the first POST failure after the single bounded retry.
    }
  }
  throw originalError;
}

export const IBKR_PORTAL_LOGIN_TIMEOUT_MS = 6 * 60_000 + 30_000;

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

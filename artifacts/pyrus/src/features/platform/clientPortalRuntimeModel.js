const hasExecutionTarget = (readiness) =>
  Boolean(
    readiness?.selectedAccountId ||
      readiness?.executionTargets?.some((target) => target?.selected) ||
      readiness?.accounts?.length,
  );

export const isClientPortalTradingReady = (readiness) =>
  Boolean(
    readiness?.status === "connected" &&
      readiness?.gatewayRunning === true &&
      readiness?.authenticated === true &&
      readiness?.established === true &&
      readiness?.isPaper === false &&
      hasExecutionTarget(readiness),
  );

export const resolveClientPortalTradingReadiness = (readiness) => {
  if (!readiness || readiness.status === "unavailable") {
    return {
      ready: false,
      reason: "ibkr_client_portal_unavailable",
      message: "IBKR Client Portal is unavailable for order routing.",
    };
  }
  if (readiness.status === "competing") {
    return {
      ready: false,
      reason: "ibkr_client_portal_competing_session",
      message:
        "Another session is competing for the IBKR Client Portal connection.",
    };
  }
  if (readiness.status === "gateway_starting") {
    return {
      ready: false,
      reason: "ibkr_client_portal_starting",
      message: "IBKR Client Portal is starting.",
    };
  }
  if (
    readiness.status === "disconnected" ||
    readiness.status === "needs_login"
  ) {
    return {
      ready: false,
      reason: "ibkr_client_portal_login_required",
      message: "Sign in through IBKR Client Portal before trading.",
    };
  }
  if (
    readiness.status !== "connected" ||
    readiness.gatewayRunning !== true ||
    readiness.authenticated !== true ||
    readiness.established !== true
  ) {
    return {
      ready: false,
      reason: "ibkr_client_portal_not_authenticated",
      message:
        "IBKR Client Portal is not yet authenticated for order routing.",
    };
  }
  if (readiness.isPaper !== false) {
    return {
      ready: false,
      reason: "ibkr_client_portal_live_account_required",
      message:
        "IBKR Client Portal must verify a real account before live order routing.",
    };
  }
  if (!hasExecutionTarget(readiness)) {
    return {
      ready: false,
      reason: "ibkr_client_portal_account_unavailable",
      message: "IBKR Client Portal has no verified execution target.",
    };
  }
  return {
    ready: true,
    reason: null,
    message: "IBKR Client Portal is authenticated and ready for live trading.",
  };
};

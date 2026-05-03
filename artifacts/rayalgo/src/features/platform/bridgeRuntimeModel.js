import { T } from "../../lib/uiTokens";
import { getIbkrStreamStateMeta } from "./IbkrConnectionStatus";

export const bridgeRuntimeTone = (session) => {
  if (!session?.configured?.ibkr) return { label: "offline", color: T.red };
  const bridge = session?.ibkrBridge;
  if (bridge?.competing) {
    return { label: "competing", color: T.red };
  }
  const streamMeta = getIbkrStreamStateMeta(
    bridge?.streamState,
    bridge?.streamStateReason,
  );
  if (streamMeta?.status === "reconnect_needed") {
    return {
      label: streamMeta.label,
      color: streamMeta.color,
      pulse: streamMeta.pulse,
    };
  }
  if (bridge?.connected === false) {
    return {
      label: bridge?.lastError || bridge?.lastRecoveryError ? "error" : "offline",
      color: T.red,
    };
  }
  if (
    bridge?.healthFresh === false &&
    (bridge?.connected || bridge?.authenticated || bridge?.bridgeReachable)
  ) {
    return { label: "stale", color: T.amber };
  }
  if (bridge?.connected && !bridge?.authenticated) {
    return { label: "login required", color: T.amber };
  }
  if (bridge?.authenticated && bridge?.accountsLoaded === false) {
    return { label: "checking", color: T.amber };
  }
  if (
    bridge?.authenticated &&
    (bridge?.configuredLiveMarketDataMode === false ||
      bridge?.liveMarketDataAvailable === false)
  ) {
    return { label: "delayed", color: T.amber };
  }
  if (streamMeta) {
    return {
      label: streamMeta.label,
      color: streamMeta.color,
      pulse: streamMeta.pulse,
    };
  }
  if (bridge?.strictReady === true) {
    return { label: "live", color: T.green };
  }
  if (bridge?.authenticated && bridge?.streamFresh === false) {
    return { label: "stale", color: T.amber, pulse: true };
  }
  if (bridge?.authenticated) return { label: "waiting", color: T.amber };
  if (bridge?.lastError) return { label: "error", color: T.red };
  return { label: "configured", color: T.textDim };
};

const bridgeTransportLabel = () => "IB Gateway";

export const bridgeRuntimeMessage = (session) => {
  if (!session?.configured?.ibkr) {
    return "Interactive Brokers is not configured in this workspace.";
  }

  const bridge = session?.ibkrBridge;
  const marketDataMode = bridge?.marketDataMode || null;
  const streamState = bridge?.streamState;
  if (streamState === "reconnect_needed") {
    if (
      bridge?.strictReason === "gateway_socket_disconnected" ||
      bridge?.streamStateReason === "gateway_socket_disconnected" ||
      bridge?.socketConnected === false ||
      bridge?.connected === false
    ) {
      const target = bridge?.connectionTarget ? ` at ${bridge.connectionTarget}` : "";
      return `Bridge tunnel is reachable, but IB Gateway/TWS is disconnected${target}. Start or unlock Gateway, then reconnect.`;
    }
    return "Reconnect IBKR to attach the current Gateway tunnel.";
  }
  if (bridge?.connected === false) {
    if (bridge?.lastRecoveryError) {
      return bridge.lastRecoveryError;
    }
    if (bridge?.lastError) {
      return bridge.lastError;
    }
    return `${bridgeTransportLabel(session)} is not connected to the broker session.`;
  }
  if (bridge?.healthFresh === false && streamState !== "reconnect_needed") {
    return "IB Gateway health is pending; waiting for the next successful check.";
  }

  if (bridge?.authenticated) {
    const accountMeta = bridge.selectedAccountId
      ? ` account ${bridge.selectedAccountId}`
      : "";
    const transportMeta = bridgeTransportLabel(session);
    if (bridge?.accountsLoaded === false) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; checking account and stream readiness.`;
    }
    if (
      bridge?.configuredLiveMarketDataMode === false ||
      bridge?.liveMarketDataAvailable === false
    ) {
      const modeMeta = marketDataMode ? ` (${marketDataMode})` : "";
      return `IBKR bridge authenticated via ${transportMeta}${accountMeta}, but market data is delayed${modeMeta}.`;
    }
    if (
      streamState === "quiet" &&
      bridge?.streamStateReason === "no_active_quote_consumers"
    ) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; waiting for a live quote subscription.`;
    }
    if (
      streamState === "quiet" &&
      bridge?.streamStateReason === "market_session_quiet"
    ) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; market session is closed.`;
    }
    if (streamState === "live" || bridge?.strictReady === true) {
      return `IBKR live stream is active via ${transportMeta}${accountMeta}.`;
    }
    if (streamState === "quiet") {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; stream is quiet for an unspecified reason.`;
    }
    if (streamState === "reconnecting") {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; quote stream is reconnecting.`;
    }
    if (streamState === "reconnect_needed") {
      if (
        bridge?.strictReason === "gateway_socket_disconnected" ||
        bridge?.streamStateReason === "gateway_socket_disconnected" ||
        bridge?.socketConnected === false ||
        bridge?.connected === false
      ) {
        const target = bridge?.connectionTarget
          ? ` at ${bridge.connectionTarget}`
          : "";
        return `Bridge tunnel is reachable, but IB Gateway/TWS is disconnected${target}. Start or unlock Gateway, then reconnect.`;
      }
      return "Reconnect IBKR to attach the current Gateway tunnel.";
    }
    if (streamState === "stale" || bridge?.streamFresh === false) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; stream is waiting for the next live event.`;
    }
    return `IBKR bridge authenticated via ${transportMeta}${accountMeta}; waiting for strict stream proof.`;
  }

  if (bridge?.connected) {
    return `${bridgeTransportLabel(session)} is reachable, but the broker session still needs login/authorization.`;
  }

  if (bridge?.lastRecoveryError) {
    return bridge.lastRecoveryError;
  }

  if (bridge?.lastError) {
    return bridge.lastError;
  }

  return "IBKR connectivity is configured, but the local bridge has not authenticated yet.";
};

export const resolveGatewayTradingReadiness = (session) => {
  if (!session?.configured?.ibkr) {
    return {
      ready: false,
      reason: "ibkr_not_configured",
      message: "Interactive Brokers is not configured for order routing.",
    };
  }

  const bridge = session?.ibkrBridge;
  if (!bridge) {
    return {
      ready: false,
      reason: "bridge_health_unavailable",
      message: "IB Gateway trading is unavailable until Gateway health is verified.",
    };
  }

  if (bridge.competing === true) {
    return {
      ready: false,
      reason: "gateway_competing_session",
      message: "IB Gateway is connected, but another session is competing for the broker connection.",
    };
  }

  if (bridge.healthFresh === false) {
    return {
      ready: false,
      reason: "health_stale",
      message: "IB Gateway trading is unavailable until Gateway health is current.",
    };
  }

  if (bridge.connected !== true) {
    return {
      ready: false,
      reason: "gateway_socket_disconnected",
      message: "IB Gateway is disconnected. Reconnect Gateway before trading.",
    };
  }

  if (bridge.authenticated !== true) {
    return {
      ready: false,
      reason: "gateway_login_required",
      message: "IB Gateway is connected, but the broker session is not authenticated.",
    };
  }

  const accountsLoaded =
    bridge.accountsLoaded === true ||
    (Array.isArray(bridge.accounts) && bridge.accounts.length > 0) ||
    Boolean(bridge.selectedAccountId);
  if (!accountsLoaded) {
    return {
      ready: false,
      reason: "accounts_unavailable",
      message: "IB Gateway is connected, but no broker accounts are loaded yet.",
    };
  }

  return {
    ready: true,
    reason: null,
    message: "IB Gateway is connected and ready for trading.",
  };
};

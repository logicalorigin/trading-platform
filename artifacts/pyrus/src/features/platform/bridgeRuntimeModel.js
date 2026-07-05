import { getIbkrStreamStateMeta } from "./IbkrConnectionStatus";
import { CSS_COLOR } from "../../lib/uiTokens.jsx";

const STREAM_LIFECYCLE_ONLY_STATES = new Set(["checking", "reconnecting"]);
const GATEWAY_DISCONNECT_REASONS = new Set([
  "bridge_unreachable",
  "gateway_socket_disconnected",
  "gateway_server_disconnected",
  "gateway_login_required",
]);

const hasGatewayConnectionProof = (bridge) =>
  Boolean(
    bridge?.healthFresh === true &&
      bridge?.connected === true &&
      bridge?.authenticated === true &&
      bridge?.accountsLoaded !== false &&
      bridge?.configuredLiveMarketDataMode !== false &&
      bridge?.brokerServerConnected !== false &&
      (bridge?.bridgeReachable === true || bridge?.socketConnected === true),
  );

export const hasGatewayLiveDataProof = (bridge) => {
  const streamState = bridge?.streamState;
  return Boolean(
    bridge?.connected === true &&
      bridge?.authenticated === true &&
      bridge?.accountsLoaded !== false &&
      bridge?.configuredLiveMarketDataMode !== false &&
      bridge?.brokerServerConnected !== false &&
      (bridge?.strictReady === true ||
        (bridge?.streamFresh === true && streamState === "live")),
  );
};

const isGatewayDisconnectReason = (value) =>
  GATEWAY_DISCONNECT_REASONS.has(String(value || ""));

const isStreamLifecycleOnlyState = (bridge, streamMeta) =>
  Boolean(
    streamMeta &&
      STREAM_LIFECYCLE_ONLY_STATES.has(streamMeta.status) &&
      hasGatewayConnectionProof(bridge) &&
      !isGatewayDisconnectReason(bridge?.strictReason) &&
      !isGatewayDisconnectReason(bridge?.streamStateReason),
  );

export const bridgeRuntimeTone = (session) => {
  // Status color semantics: green=healthy, accent=in progress, amber=attention, red=error.
  const runtimeIbkr = session?.runtime?.ibkr;
  if (!session?.configured?.ibkr) {
    if (runtimeIbkr?.desktopAgentOnline && !runtimeIbkr?.runtimeOverrideActive) {
      if (runtimeIbkr?.desktopAgentUpgradeRequired) {
        return { label: "helper update", color: CSS_COLOR.amber, pulse: true };
      }
      return { label: "reconnect", color: CSS_COLOR.amber, pulse: true };
    }
    // Not configured is a neutral absence, not an error — match the chip
    // (getIbkrConnectionTone) which uses the dim tone for the unconfigured state.
    return { label: "offline", color: CSS_COLOR.textDim };
  }
  const bridge = session?.ibkrBridge;
  if (bridge?.competing) {
    return { label: "competing", color: CSS_COLOR.red };
  }
  const streamMeta = getIbkrStreamStateMeta(
    bridge?.streamState,
    bridge?.streamStateReason,
  );
  if (bridge?.connected === false) {
    if (
      streamMeta?.status === "reconnecting" &&
      isGatewayDisconnectReason(bridge?.streamStateReason || bridge?.strictReason)
    ) {
      return {
        label: streamMeta.label,
        color: streamMeta.color,
        pulse: streamMeta.pulse,
      };
    }
    return {
      label: bridge?.lastError || bridge?.lastRecoveryError ? "error" : "offline",
      color: CSS_COLOR.red,
    };
  }
  if (bridge?.brokerServerConnected === false) {
    return { label: "server disconnected", color: CSS_COLOR.amber, pulse: true };
  }
  if (
    bridge?.healthFresh === false &&
    (bridge?.connected || bridge?.authenticated || bridge?.bridgeReachable) &&
    !hasGatewayLiveDataProof(bridge)
  ) {
    return { label: "health pending", color: CSS_COLOR.amber };
  }
  if (bridge?.connected && !bridge?.authenticated) {
    return { label: "login required", color: CSS_COLOR.amber };
  }
  if (bridge?.authenticated && bridge?.accountsLoaded === false) {
    return { label: "checking", color: CSS_COLOR.accent };
  }
  if (
    bridge?.authenticated &&
    (bridge?.configuredLiveMarketDataMode === false ||
      bridge?.liveMarketDataAvailable === false)
  ) {
    return { label: "delayed", color: CSS_COLOR.amber };
  }
  if (
    streamMeta?.status === "no-subscribers" &&
    bridge?.authenticated &&
    bridge?.healthFresh === true &&
    bridge?.bridgeReachable === true &&
    bridge?.socketConnected === true &&
    bridge?.accountsLoaded !== false
  ) {
    return { label: "online", color: CSS_COLOR.green };
  }
  if (isStreamLifecycleOnlyState(bridge, streamMeta)) {
    return { label: "online", color: CSS_COLOR.green };
  }
  if (streamMeta) {
    return {
      label: streamMeta.label,
      color: streamMeta.color,
      pulse: streamMeta.pulse,
    };
  }
  if (bridge?.strictReady === true) {
    return { label: "online", color: CSS_COLOR.green };
  }
  if (bridge?.authenticated && bridge?.streamFresh === false) {
    return { label: "quote stale", color: CSS_COLOR.amber, pulse: true };
  }
  if (bridge?.authenticated) return { label: "waiting", color: CSS_COLOR.accent };
  if (bridge?.lastError) return { label: "error", color: CSS_COLOR.red };
  return { label: "configured", color: CSS_COLOR.textDim };
};

const bridgeTransportLabel = () => "IB Gateway";

export const bridgeRuntimeMessage = (session) => {
  if (!session?.configured?.ibkr) {
    const runtimeIbkr = session?.runtime?.ibkr;
    if (runtimeIbkr?.desktopAgentOnline && !runtimeIbkr?.runtimeOverrideActive) {
      if (runtimeIbkr?.desktopAgentUpgradeRequired) {
        if (
          runtimeIbkr?.desktopAgentKnownBad ||
          runtimeIbkr?.desktopAgentCompatibility === "known_bad"
        ) {
          return "Windows desktop helper is online, but it is a blocked helper version. Launch IBKR to repair the helper before reconnecting Gateway.";
        }
        return "Windows desktop helper is online but must update before reconnecting IB Gateway.";
      }
      return "Windows desktop helper is online. Reconnect IBKR to attach the current Gateway tunnel.";
    }
    return "Interactive Brokers is not configured in this workspace.";
  }

  const bridge = session?.ibkrBridge;
  const marketDataMode = bridge?.marketDataMode || null;
  const streamState = bridge?.streamState;
  if (streamState === "reconnect_needed") {
    if (
      bridge?.strictReason === "gateway_server_disconnected" ||
      bridge?.streamStateReason === "gateway_server_disconnected" ||
      bridge?.brokerServerConnected === false
    ) {
      const target = bridge?.connectionTarget ? ` at ${bridge.connectionTarget}` : "";
      return `Gateway API socket is open${target}, but Gateway is disconnected from IBKR servers. Reconnect Gateway to IBKR.`;
    }
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
  if (bridge?.brokerServerConnected === false) {
    const target = bridge?.connectionTarget ? ` at ${bridge.connectionTarget}` : "";
    return `Gateway API socket is open${target}, but Gateway is disconnected from IBKR servers. Reconnect Gateway to IBKR.`;
  }
  if (
    bridge?.healthFresh === false &&
    streamState !== "reconnect_needed" &&
    !hasGatewayLiveDataProof(bridge)
  ) {
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
      return `IBKR broker session authenticated via ${transportMeta}${accountMeta}, but market data is delayed${modeMeta}.`;
    }
    if (
      streamState === "quiet" &&
      bridge?.streamStateReason === "no_active_quote_consumers"
    ) {
      return `IBKR Gateway is connected via ${transportMeta}${accountMeta}; live quote stream is standing by.`;
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
        bridge?.strictReason === "gateway_server_disconnected" ||
        bridge?.streamStateReason === "gateway_server_disconnected" ||
        bridge?.brokerServerConnected === false
      ) {
        const target = bridge?.connectionTarget
          ? ` at ${bridge.connectionTarget}`
          : "";
        return `Gateway API socket is open${target}, but Gateway is disconnected from IBKR servers. Reconnect Gateway to IBKR.`;
      }
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
    return `IBKR broker session authenticated via ${transportMeta}${accountMeta}; waiting for strict stream proof.`;
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

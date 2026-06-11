import React from "react";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleOff,
  PlugZap,
} from "lucide-react";
import { CSS_COLOR, cssColorAlpha, cssColorMix, dim, FONT_WEIGHTS, fs, RADII, sp, T, textSize } from "../../lib/uiTokens.jsx";
import { ActionButton } from "../../components/ui/ActionButton.jsx";
import {
  STREAM_STATE_LABEL,
  canonicalizeStreamState,
  streamStateBackgroundVar,
  streamStateTokenVar,
} from "./streamSemantics";
import { AppTooltip } from "@/components/ui/tooltip";
import { FailurePointContent } from "../../components/platform/FailurePointTooltip.jsx";
import { buildIbkrConnectionFailurePoint } from "./failurePointModel.js";
import {
  advanceWaveMotion,
  initWaveMotionState,
  WAVE_MOTION_DWELL_MS,
} from "./ibkrWaveMotionModel.js";

const EMPTY_ACCOUNTS = [];

export const formatIbkrPingMs = (value) => {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }
  return `${Math.max(0, Math.round(value))}ms`;
};

export const formatIbkrPingMsParts = (value) => {
  if (!Number.isFinite(value)) {
    return { value: "--", unit: "" };
  }
  if (value >= 1000) {
    return {
      value: `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}`,
      unit: "s",
    };
  }
  return {
    value: `${Math.max(0, Math.round(value))}`,
    unit: "ms",
  };
};

const formatRelativeTimeShort = (value) => {
  if (!value) {
    return "--";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "--";
  }

  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 5_000) return "now";
  if (elapsedMs < 60_000) return `${Math.round(elapsedMs / 1000)}s ago`;
  if (elapsedMs < 3_600_000) return `${Math.round(elapsedMs / 60_000)}m ago`;
  return `${Math.round(elapsedMs / 3_600_000)}h ago`;
};

const formatCount = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)).toLocaleString() : "--";

const firstBoolean = (...values) =>
  values.find((value) => typeof value === "boolean");

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const isLiveMarketDataMode = (value) => String(value || "").toLowerCase() === "live";
const NO_ACTIVE_QUOTE_CONSUMERS_REASON = "no_active_quote_consumers";
const MARKET_SESSION_QUIET_REASON = "market_session_quiet";

const isQuoteStandbyState = (proof) =>
  proof?.streamState === "quiet" &&
  proof?.streamStateReason === NO_ACTIVE_QUOTE_CONSUMERS_REASON;

const GATEWAY_DISCONNECT_REASONS = new Set([
  "bridge_unreachable",
  "gateway_socket_disconnected",
  "gateway_server_disconnected",
  "gateway_login_required",
]);

const STREAM_LIFECYCLE_ONLY_STATES = new Set(["checking", "reconnecting"]);
const CURRENT_UPTIME_STREAM_STATES = new Set([
  "healthy",
  "quiet",
  "capacity-limited",
]);
export const IBKR_RECONNECT_ACTION_STATUSES = new Set([
  "misconfigured",
  "offline",
  "stale",
  "login-required",
  "reconnecting",
]);

const hasGatewayConnectionProof = (proof) =>
  Boolean(
    proof?.healthFresh === true &&
      proof?.authenticated === true &&
      proof?.accountsLoaded !== false &&
      proof?.configuredLiveMarketDataMode !== false &&
      proof?.brokerServerConnected !== false &&
      (proof?.bridgeReachable === true || proof?.socketConnected === true),
  );

const isGatewayDisconnectReason = (value) =>
  GATEWAY_DISCONNECT_REASONS.has(String(value || ""));

const isStreamLifecycleOnlyState = (proof, streamMeta) =>
  Boolean(
    streamMeta &&
      STREAM_LIFECYCLE_ONLY_STATES.has(streamMeta.status) &&
      hasGatewayConnectionProof(proof) &&
      !isGatewayDisconnectReason(proof?.strictReason) &&
      !isGatewayDisconnectReason(proof?.streamStateReason),
  );

const hasCurrentUptimeStreamEvidence = (proof) => {
  const streamState = canonicalizeStreamState(proof?.streamState, "offline");
  return Boolean(
    proof?.strictReady === true ||
      proof?.streamFresh === true ||
      CURRENT_UPTIME_STREAM_STATES.has(streamState),
  );
};

// Status color semantics: green=healthy, accent=in progress, amber=attention, red=error.

const resolveConnectionProof = (connection, runtime) => {
  const accountCount = firstValue(
    runtime?.accountCount,
    Array.isArray(connection?.accounts) ? connection.accounts.length : null,
  );
  const marketDataMode = firstValue(
    connection?.marketDataMode,
    runtime?.marketDataMode,
  );
  const liveMarketDataAvailable = firstBoolean(
    connection?.liveMarketDataAvailable,
    runtime?.liveMarketDataAvailable,
  );
  const configuredLiveMarketDataMode = firstBoolean(
    connection?.configuredLiveMarketDataMode,
    runtime?.configuredLiveMarketDataMode,
    isLiveMarketDataMode(marketDataMode)
      ? true
      : liveMarketDataAvailable === false
        ? false
        : undefined,
  );
  const accountsLoaded = firstBoolean(
    connection?.accountsLoaded,
    runtime?.accountsLoaded,
    Number.isFinite(accountCount) ? accountCount > 0 : undefined,
  );
  const healthFresh = firstBoolean(
    connection?.healthFresh,
    runtime?.healthFresh,
  );
  const bridgeReachable = firstBoolean(
    connection?.bridgeReachable,
    runtime?.bridgeReachable,
    runtime?.reachable,
    connection?.reachable,
  );
  const socketConnected = firstBoolean(
    connection?.socketConnected,
    runtime?.socketConnected,
    runtime?.connected,
    connection?.reachable,
  );
  const brokerServerConnected = firstBoolean(
    connection?.brokerServerConnected,
    runtime?.brokerServerConnected,
    socketConnected === true ? true : undefined,
  );
  const authenticated = firstBoolean(
    connection?.authenticated,
    runtime?.authenticated,
  );
  const streamFresh = firstBoolean(connection?.streamFresh, runtime?.streamFresh);
  const streamState = firstValue(connection?.streamState, runtime?.streamState);
  const streamStateReason = firstValue(
    connection?.streamStateReason,
    runtime?.streamStateReason,
  );
  const strictReady = firstBoolean(connection?.strictReady, runtime?.strictReady);
  const computedStrictReady = Boolean(
    healthFresh === true &&
      bridgeReachable === true &&
      socketConnected === true &&
      brokerServerConnected !== false &&
      authenticated === true &&
      accountsLoaded === true &&
      configuredLiveMarketDataMode === true &&
      streamFresh === true,
  );

  return {
    accountCount,
    marketDataMode,
    liveMarketDataAvailable,
    healthFresh,
    healthAgeMs: firstValue(connection?.healthAgeMs, runtime?.healthAgeMs),
    bridgeReachable,
    socketConnected,
    brokerServerConnected,
    authenticated,
    accountsLoaded,
    configuredLiveMarketDataMode,
    streamFresh,
    streamState,
    streamStateReason,
    lastStreamEventAgeMs: firstValue(
      connection?.lastStreamEventAgeMs,
      runtime?.lastStreamEventAgeMs,
    ),
    strictReady: strictReady ?? computedStrictReady,
    strictReason: firstValue(connection?.strictReason, runtime?.strictReason),
  };
};

export const maskIbkrAccountId = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (text.includes("...") || text.includes("*")) {
    return text;
  }
  if (text.length <= 4) {
    return `${text.slice(0, 1)}***`;
  }
  return `${text.slice(0, 2)}...${text.slice(-4)}`;
};

const fallbackConnection = (session, key) => {
  const bridge = session?.ibkrBridge;
  const configured = Boolean(session?.configured?.ibkr);
  const active = configured && key === "tws";

  return {
    transport: "tws",
    role: "market_data",
    configured: active,
    reachable: active ? Boolean(bridge?.connected) : false,
    authenticated: active ? Boolean(bridge?.authenticated) : false,
    competing: active ? Boolean(bridge?.competing) : false,
    target: active ? bridge?.connectionTarget || null : null,
    mode: active ? bridge?.sessionMode || session?.environment || null : null,
    clientId: active ? bridge?.clientId ?? null : null,
    selectedAccountId: active ? bridge?.selectedAccountId || null : null,
    accounts: active ? bridge?.accounts || EMPTY_ACCOUNTS : EMPTY_ACCOUNTS,
    lastPingMs: null,
    lastPingAt: null,
    lastTickleAt: active ? bridge?.lastTickleAt || null : null,
    lastError: active ? bridge?.lastError || bridge?.lastRecoveryError || null : null,
    marketDataMode: active ? bridge?.marketDataMode || null : null,
    liveMarketDataAvailable: active ? bridge?.liveMarketDataAvailable ?? null : null,
    healthFresh: active ? bridge?.healthFresh ?? false : false,
    healthAgeMs: active ? bridge?.healthAgeMs ?? null : null,
    stale: active ? bridge?.stale ?? bridge?.healthFresh === false : true,
    bridgeReachable: active ? bridge?.bridgeReachable ?? bridge?.healthFresh === true : false,
    socketConnected: active ? bridge?.socketConnected ?? Boolean(bridge?.connected) : false,
    brokerServerConnected: active
      ? bridge?.brokerServerConnected ?? Boolean(bridge?.connected)
      : false,
    serverConnectivity: active ? bridge?.serverConnectivity || null : "unknown",
    lastServerConnectivityAt: active
      ? bridge?.lastServerConnectivityAt || null
      : null,
    lastServerConnectivityError: active
      ? bridge?.lastServerConnectivityError || null
      : null,
    accountsLoaded: active ? bridge?.accountsLoaded ?? Boolean(bridge?.accounts?.length) : false,
    configuredLiveMarketDataMode: active
      ? bridge?.configuredLiveMarketDataMode ?? isLiveMarketDataMode(bridge?.marketDataMode)
      : false,
    streamFresh: active ? bridge?.streamFresh ?? false : false,
    streamState: active ? bridge?.streamState || null : "offline",
    streamStateReason: active
      ? bridge?.streamStateReason || null
      : "bridge_not_configured",
    lastStreamEventAgeMs: active ? bridge?.lastStreamEventAgeMs ?? null : null,
    strictReady: active ? bridge?.strictReady ?? false : false,
    strictReason: active ? bridge?.strictReason ?? null : "bridge_not_configured",
  };
};

export const getIbkrConnection = (session, key) =>
  session?.ibkrBridge?.connections?.[key] || fallbackConnection(session, key);

export const hasIbkrGatewayCurrentUptimeProof = ({
  connection,
  runtime,
} = {}) => hasCurrentUptimeStreamEvidence(resolveConnectionProof(connection, runtime));

export const isIbkrGatewayBridgeAttached = ({
  connection,
  runtime,
} = {}) => {
  const configured = firstBoolean(
    connection?.configured,
    runtime?.configured,
    runtime?.bridgeUrlConfigured,
  );
  const bridgeUrlConfigured = runtime?.bridgeUrlConfigured;
  const competing = firstBoolean(connection?.competing, runtime?.competing);
  const proof = resolveConnectionProof(connection, runtime);
  const reachableOrSocket = Boolean(
    proof.bridgeReachable === true ||
      proof.socketConnected === true ||
      connection?.reachable === true ||
      runtime?.reachable === true ||
      runtime?.connected === true,
  );
  const hasDisconnectReason = Boolean(
    isGatewayDisconnectReason(proof.strictReason) ||
      isGatewayDisconnectReason(proof.streamStateReason),
  );

  return Boolean(
    configured &&
      bridgeUrlConfigured !== false &&
      !competing &&
      proof.authenticated === true &&
      proof.accountsLoaded !== false &&
      proof.brokerServerConnected !== false &&
      reachableOrSocket &&
      !hasDisconnectReason &&
      (proof.healthFresh !== false || hasCurrentUptimeStreamEvidence(proof)),
  );
};

export const getIbkrStreamStateMeta = (streamState, streamStateReason) => {
  if (!streamState) {
    return null;
  }

  const state =
    streamState === "quiet" && streamStateReason === NO_ACTIVE_QUOTE_CONSUMERS_REASON
      ? "no-subscribers"
      : streamState === "quiet" && streamStateReason === MARKET_SESSION_QUIET_REASON
        ? "market-closed"
        : canonicalizeStreamState(streamState, "offline");
  const tokenColor = streamStateTokenVar(state);
  const tokenBackground = streamStateBackgroundVar(state);

  if (
    streamState === "quiet" &&
    streamStateReason === NO_ACTIVE_QUOTE_CONSUMERS_REASON
  ) {
    return {
      label: "standby",
      status: state,
      healthLabel: "Standing By",
      detail:
        "Gateway is connected; the stock quote stream will start when a live panel requests it",
      color: tokenColor,
      background: tokenBackground,
      Icon: Activity,
      wave: "slow",
      badge: STREAM_STATE_LABEL[state],
    };
  }

  if (
    streamState === "quiet" &&
    streamStateReason === MARKET_SESSION_QUIET_REASON
  ) {
    return {
      label: "market closed",
      status: state,
      healthLabel: "Market Closed",
      detail: "Gateway is ready; the equity market session is closed",
      color: tokenColor,
      background: tokenBackground,
      Icon: CircleOff,
      wave: "slow",
      badge: STREAM_STATE_LABEL[state],
    };
  }

  if (streamState === "reconnect_needed") {
    return {
      label:
        streamStateReason === "gateway_server_disconnected"
          ? "server disconnected"
          : "reconnect",
      status: state,
      healthLabel:
        streamStateReason === "gateway_server_disconnected"
          ? "Server Disconnected"
          : "Reconnect Needed",
      detail:
        streamStateReason === "gateway_server_disconnected"
          ? "Gateway API socket is open, but Gateway is disconnected from IBKR servers"
          : streamStateReason === "gateway_socket_disconnected"
            ? "Bridge tunnel is reachable, but IB Gateway/TWS is disconnected"
            : "Reconnect IBKR to attach the current Gateway tunnel",
      color: tokenColor,
      background: tokenBackground,
      Icon: PlugZap,
      wave: "flat",
      badge: STREAM_STATE_LABEL[state],
      pulse: true,
    };
  }

  switch (state) {
    case "healthy":
      return {
        label: "online",
        status: state,
        healthLabel: "Ready",
        detail: "Gateway is authenticated and live stream events are current",
        color: tokenColor,
        background: tokenBackground,
        Icon: CircleCheck,
        wave: "fast",
        badge: STREAM_STATE_LABEL[state],
      };
    case "quiet":
      return {
        label: "quiet stream",
        status: state,
        healthLabel: "Quiet Stream",
        detail: "Gateway is authenticated; stream is quiet for an unspecified reason",
        color: tokenColor,
        background: tokenBackground,
        Icon: Activity,
        wave: "slow",
        badge: STREAM_STATE_LABEL[state],
      };
    case "stale":
      return {
        label: "quote stale",
        status: state,
        healthLabel: "Quote Stream Stale",
        detail: "Gateway is authenticated but quote stream events are stale",
        color: tokenColor,
        background: tokenBackground,
        Icon: Activity,
        wave: "flat",
        badge: STREAM_STATE_LABEL[state],
        pulse: true,
      };
    case "capacity-limited":
      return {
        label: "line limited",
        status: state,
        healthLabel: "Line Limited",
        detail:
          "Gateway is connected; live market data requests are waiting for available IBKR lines",
        color: tokenColor,
        background: tokenBackground,
        Icon: CircleAlert,
        wave: "slow",
        badge: STREAM_STATE_LABEL[state],
        pulse: true,
      };
    case "reconnecting":
      return {
        label: "reconnecting",
        status: state,
        healthLabel: "Reconnecting",
        detail: "Gateway is authenticated and the quote stream is reconnecting",
        color: tokenColor,
        background: tokenBackground,
        Icon: PlugZap,
        wave: "slow",
        badge: STREAM_STATE_LABEL[state],
        pulse: true,
      };
    case "delayed":
      return {
        label: "delayed",
        status: state,
        healthLabel: "Delayed",
        detail: "Gateway is authenticated but live market data is not available",
        color: tokenColor,
        background: tokenBackground,
        Icon: Activity,
        wave: "flat",
        badge: STREAM_STATE_LABEL[state],
      };
    case "login-required":
      return {
        label: "login",
        status: state,
        healthLabel: "Login Required",
        detail: "Bridge is reachable but Gateway is not authenticated",
        color: tokenColor,
        background: tokenBackground,
        Icon: PlugZap,
        wave: "medium",
        badge: STREAM_STATE_LABEL[state],
      };
    case "checking":
      return {
        label: "checking",
        status: state,
        healthLabel: "Checking",
        detail: "Gateway is authenticated; waiting for account and stream proof",
        color: tokenColor,
        background: tokenBackground,
        Icon: Activity,
        wave: "flat",
        badge: STREAM_STATE_LABEL[state],
      };
    case "offline":
      return {
        label: "offline",
        status: state,
        healthLabel: "Offline",
        detail: "Gateway bridge is not reachable",
        color: tokenColor,
        background: tokenBackground,
        Icon: CircleOff,
        wave: "flat",
        badge: STREAM_STATE_LABEL[state],
      };
    default:
      return {
        label:
          streamStateReason === "gateway_server_disconnected"
            ? "server disconnected"
            : "reconnect",
        status: "reconnecting",
        healthLabel:
          streamStateReason === "gateway_server_disconnected"
            ? "Server Disconnected"
            : "Reconnect Needed",
        detail:
          streamStateReason === "gateway_server_disconnected"
            ? "Gateway API socket is open, but Gateway is disconnected from IBKR servers"
            : streamStateReason === "gateway_socket_disconnected"
              ? "Bridge tunnel is reachable, but IB Gateway/TWS is disconnected"
              : "Reconnect IBKR to attach the current Gateway tunnel",
        color: streamStateTokenVar("reconnecting"),
        background: streamStateBackgroundVar("reconnecting"),
        Icon: PlugZap,
        wave: "flat",
        badge: STREAM_STATE_LABEL.reconnecting,
        pulse: true,
      };
  }
};

export const getIbkrConnectionTone = (connection) => {
  if (!connection?.configured) {
    return {
      label: "offline",
      color: CSS_COLOR.textDim,
      Icon: CircleOff,
      wave: "flat",
    };
  }

  const proof = resolveConnectionProof(connection);

  if (connection.competing) {
    return {
      label: "compete",
      color: CSS_COLOR.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  const streamMeta = getIbkrStreamStateMeta(
    proof.streamState,
    proof.streamStateReason,
  );
  if (isStreamLifecycleOnlyState(proof, streamMeta)) {
    return {
      label: "online",
      color: CSS_COLOR.green,
      Icon: CircleCheck,
      wave: "fast",
    };
  }
  if (streamMeta?.status === "reconnecting") {
    return {
      label: streamMeta.label,
      color: streamMeta.color,
      Icon: streamMeta.Icon,
      wave: streamMeta.wave,
      pulse: streamMeta.pulse,
    };
  }

  const streamHasCurrentEvidence = hasCurrentUptimeStreamEvidence(proof);

  if (
    proof.healthFresh === false &&
    (connection.authenticated || connection.reachable) &&
    !streamHasCurrentEvidence
  ) {
    return {
      label: "health pending",
      color: CSS_COLOR.amber,
      Icon: CircleAlert,
      wave: "flat",
    };
  }

  if (
    connection.lastError &&
    !connection.reachable &&
    proof.socketConnected !== true &&
    proof.authenticated !== true
  ) {
    return {
      label: "error",
      color: CSS_COLOR.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  if (
    connection.reachable === false &&
    proof.socketConnected !== true &&
    proof.authenticated !== true
  ) {
    return {
      label: "offline",
      color: CSS_COLOR.red,
      Icon: CircleOff,
      wave: "flat",
    };
  }

  if (proof.authenticated === true || connection.authenticated) {
    const delayed =
      proof.configuredLiveMarketDataMode === false ||
      proof.liveMarketDataAvailable === false;
    const ready = proof.strictReady === true;

    if (proof.accountsLoaded === false) {
      return {
        label: "checking",
        color: CSS_COLOR.accent,
        Icon: Activity,
        wave: "flat",
      };
    }

    if (delayed) {
      return {
        label: "delayed",
        color: CSS_COLOR.amber,
        Icon: Activity,
        wave: "flat",
      };
    }

    if (
      streamMeta?.status === "no-subscribers" &&
      proof.healthFresh === true &&
      proof.bridgeReachable === true &&
      proof.socketConnected === true &&
      proof.authenticated === true &&
      proof.accountsLoaded === true
    ) {
      return {
        label: "online",
        color: CSS_COLOR.green,
        Icon: CircleCheck,
        wave: "fast",
      };
    }

    if (streamMeta) {
      if (isStreamLifecycleOnlyState(proof, streamMeta)) {
        return {
          label: "online",
          color: CSS_COLOR.green,
          Icon: CircleCheck,
          wave: "fast",
        };
      }
      return {
        label: streamMeta.label,
        color: streamMeta.color,
        Icon: streamMeta.Icon,
        wave: streamMeta.wave,
        pulse: streamMeta.pulse,
      };
    }

    const streamStale = proof.streamFresh === false || proof.strictReady === false;

    return {
      label:
        ready
          ? "online"
          : streamStale
            ? "quote stale"
            : "checking",
      color: ready
        ? CSS_COLOR.green
        : streamStale
          ? CSS_COLOR.amber
          : CSS_COLOR.accent,
      Icon: ready ? CircleCheck : Activity,
      wave: ready ? "fast" : "flat",
    };
  }

  if (
    connection.reachable ||
    proof.bridgeReachable === true ||
    proof.socketConnected === true
  ) {
    return {
      label: "login",
      color: CSS_COLOR.amber,
      Icon: PlugZap,
      wave: "medium",
    };
  }

  if (connection.lastError) {
    return {
      label: "error",
      color: CSS_COLOR.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  return {
    label: "ready",
    color: CSS_COLOR.textDim,
    Icon: PlugZap,
    wave: "flat",
  };
};

export const isIbkrWaveActive = (connection) => {
  if (!connection?.configured || connection?.competing) {
    return false;
  }

  const proof = resolveConnectionProof(connection);
  const streamState = canonicalizeStreamState(proof.streamState, "offline");
  const connected = isIbkrGatewayBridgeAttached({ connection });

  return Boolean(
    proof.strictReady === true ||
      (connected &&
        (streamState === "healthy" ||
          streamState === "quiet" ||
          isQuoteStandbyState(proof) ||
          isStreamLifecycleOnlyState(
            proof,
            getIbkrStreamStateMeta(proof.streamState, proof.streamStateReason),
          ))),
  );
};

export const resolveIbkrGatewayHealth = ({
  connection,
  runtime,
} = {}) => {
  const configured = firstBoolean(
    connection?.configured,
    runtime?.configured,
    runtime?.bridgeUrlConfigured,
  );
  const bridgeUrlConfigured = runtime?.bridgeUrlConfigured;
  const bridgeReachable = firstBoolean(
    runtime?.bridgeReachable,
    runtime?.reachable,
    connection?.bridgeReachable,
  );
  const socketConnected = firstBoolean(
    connection?.socketConnected,
    runtime?.socketConnected,
    runtime?.connected,
    connection?.reachable,
  );
  const authenticated = firstBoolean(
    connection?.authenticated,
    runtime?.authenticated,
  );
  const brokerServerConnected = firstBoolean(
    connection?.brokerServerConnected,
    runtime?.brokerServerConnected,
    socketConnected === true ? true : undefined,
  );
  const competing = firstBoolean(connection?.competing, runtime?.competing);
  const liveMarketDataAvailable = firstBoolean(
    connection?.liveMarketDataAvailable,
    runtime?.liveMarketDataAvailable,
  );
  const proof = resolveConnectionProof(connection, runtime);
  const streamHasCurrentEvidence = hasCurrentUptimeStreamEvidence(proof);

  if (!configured || bridgeUrlConfigured === false) {
    return {
      status: "misconfigured",
      label: "Misconfigured",
      color: CSS_COLOR.amber,
      detail: "Bridge URL or Gateway transport is not configured",
    };
  }

  if (competing) {
    return {
      status: "competing",
      label: "Competing",
      color: CSS_COLOR.red,
      detail: "Another client is competing for the configured session",
    };
  }

  if (
    proof.healthFresh === false &&
    (proof.bridgeReachable || proof.socketConnected || authenticated) &&
    !streamHasCurrentEvidence
  ) {
    return {
      status: "stale",
      label: "Health Pending",
      color: CSS_COLOR.amber,
      detail: "Gateway health is pending; waiting for the next successful check",
    };
  }

  if (
    (bridgeReachable === false &&
      socketConnected !== true &&
      authenticated !== true) ||
    (bridgeReachable !== true && socketConnected === false)
  ) {
    return {
      status: "offline",
      label: "Offline",
      color: CSS_COLOR.red,
      detail: "Gateway bridge is not reachable",
    };
  }

  if (bridgeReachable === true && socketConnected === false) {
    const streamMeta = getIbkrStreamStateMeta(
      proof.streamState,
      proof.streamStateReason,
    );
    return {
      status: streamMeta?.status || "reconnecting",
      label: streamMeta?.healthLabel || "Reconnect Needed",
      color: streamMeta?.color || CSS_COLOR.amber,
      detail:
        proof.strictReason === "gateway_socket_disconnected" ||
        proof.streamStateReason === "gateway_socket_disconnected"
          ? "Bridge tunnel is reachable, but IB Gateway/TWS is disconnected"
          : streamMeta?.detail || "Reconnect IBKR to attach the current Gateway tunnel",
    };
  }

  if (bridgeReachable === true && brokerServerConnected === false) {
    const streamMeta = getIbkrStreamStateMeta(
      proof.streamState,
      proof.streamStateReason,
    );
    return {
      status: "reconnecting",
      label: streamMeta?.healthLabel || "Server Disconnected",
      color: streamMeta?.color || CSS_COLOR.amber,
      detail:
        streamMeta?.detail ||
        "Gateway API socket is open, but Gateway is disconnected from IBKR servers",
    };
  }

  if (!authenticated) {
    return {
      status: "login-required",
      label: "Login Required",
      color: streamStateTokenVar("login-required"),
      detail: "Bridge is reachable but Gateway is not authenticated",
    };
  }

  if (proof.accountsLoaded === false) {
    return {
      status: "checking",
      label: "Checking",
      color: streamStateTokenVar("checking"),
      detail: "Gateway is authenticated; waiting for account and stream proof",
    };
  }

  if (
    proof.configuredLiveMarketDataMode === false ||
    liveMarketDataAvailable === false
  ) {
    return {
      status: "delayed",
      label: "Delayed",
      color: streamStateTokenVar("delayed"),
      detail: "Gateway is authenticated but live market data is not available",
    };
  }

  const streamMeta = getIbkrStreamStateMeta(
    proof.streamState,
    proof.streamStateReason,
  );
  if (isStreamLifecycleOnlyState(proof, streamMeta)) {
    return {
      status: "healthy",
      label: "Ready",
      color: streamStateTokenVar("healthy"),
      detail:
        streamMeta.status === "reconnecting"
          ? "Gateway is authenticated; quote stream is reconnecting"
          : "Gateway is authenticated; quote stream is starting",
    };
  }
  if (streamMeta && streamMeta.status !== "login-required" && streamMeta.status !== "offline") {
    return {
      status: streamMeta.status,
      label: streamMeta.healthLabel,
      color: streamMeta.color,
      detail: streamMeta.detail,
    };
  }

  if (proof.strictReady !== true) {
    return {
      status: "stale",
      label: "Quote Stream Stale",
      color: streamStateTokenVar("stale"),
      detail: "Gateway is authenticated but fresh stream events are not confirmed",
    };
  }

  return {
    status: "healthy",
    label: "Ready",
    color: streamStateTokenVar("healthy"),
    detail: "Gateway is authenticated and live data is available",
  };
};

export const shouldShowIbkrReconnectAction = (health) =>
  Boolean(health?.status && IBKR_RECONNECT_ACTION_STATUSES.has(health.status));

const resolveWaveDuration = (connection, tone = {}) => {
  const ping = connection?.lastPingMs;
  if (!isIbkrWaveActive(connection)) {
    return null;
  }
  if (!Number.isFinite(ping)) {
    if (tone.wave === "fast") return "0.95s";
    if (tone.wave === "medium") return "1.45s";
    return "2.15s";
  }
  if (tone.wave === "fast" || ping <= 180) return "0.9s";
  if (tone.wave === "medium" || ping <= 650) return "1.45s";
  return "2.15s";
};

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(Boolean(query.matches));
    update();

    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return prefersReducedMotion;
};

// Holds the wave's animation inputs steady through sub-second ping / stream-state flaps
// so the main-thread SMIL `<animate>` does not restart ("skip"). Drives the pure
// `advanceWaveMotion` state machine; a change only commits after it survives the dwell.
const useStableWaveMotion = (animated, duration) => {
  const [state, setState] = React.useState(() =>
    initWaveMotionState({ animated, duration }),
  );

  React.useEffect(() => {
    // Fold the latest inputs in now (may open a pending change), then re-evaluate once
    // the dwell has elapsed so a sustained change actually commits.
    setState((prev) => advanceWaveMotion(prev, { animated, duration }, Date.now()));
    const timer = setTimeout(() => {
      setState((prev) => advanceWaveMotion(prev, { animated, duration }, Date.now()));
    }, WAVE_MOTION_DWELL_MS + 32);
    return () => clearTimeout(timer);
  }, [animated, duration]);

  return state.committed;
};

const buildSineWavePoints = (phase = 0) => {
  const pointCount = 33;
  const startX = 1;
  const width = 30;
  const centerY = 6;
  const amplitude = 2.65;
  const cycles = 2;

  return Array.from({ length: pointCount }, (_, index) => {
    const progress = index / (pointCount - 1);
    const x = startX + progress * width;
    const y =
      centerY +
      Math.sin(progress * Math.PI * 2 * cycles + phase) * amplitude;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
};

const SINE_WAVE_PHASES = [
  buildSineWavePoints(0),
  buildSineWavePoints(Math.PI / 2),
  buildSineWavePoints(Math.PI),
  buildSineWavePoints((Math.PI * 3) / 2),
  buildSineWavePoints(Math.PI * 2),
];
const SINE_WAVE_VALUES = SINE_WAVE_PHASES.join(";");

const WAVE_DURATION_BY_SPEED = {
  fast: "0.9s",
  medium: "1.45s",
  slow: "2.15s",
};

const normalizeWaveSpeed = (value) => {
  const speed = String(value || "").toLowerCase();
  return WAVE_DURATION_BY_SPEED[speed] ? speed : null;
};

export const resolveIbkrStatusWaveProfile = ({ status, wave } = {}) => {
  const explicitSpeed = normalizeWaveSpeed(wave);
  if (explicitSpeed) {
    return {
      state: canonicalizeStreamState(status, "healthy"),
      wave: explicitSpeed,
      duration: WAVE_DURATION_BY_SPEED[explicitSpeed],
      active: true,
    };
  }
  if (wave === "flat") {
    return {
      state: canonicalizeStreamState(status, "offline"),
      wave: "flat",
      duration: null,
      active: false,
    };
  }

  const state = canonicalizeStreamState(status, "offline");
  switch (state) {
    case "healthy":
      return { state, wave: "fast", duration: WAVE_DURATION_BY_SPEED.fast, active: true };
    case "quiet":
    case "no-subscribers":
    case "market-closed":
      return { state, wave: "slow", duration: WAVE_DURATION_BY_SPEED.slow, active: true };
    case "checking":
    case "capacity-limited":
    case "reconnecting":
    case "login-required":
      return { state, wave: "slow", duration: WAVE_DURATION_BY_SPEED.slow, active: true };
    case "delayed":
    case "stale":
    case "offline":
    default:
      return { state, wave: "flat", duration: null, active: false };
  }
};

export const getIbkrGatewayBadges = ({
  connection,
  runtime,
  latencyStats,
  health,
} = {}) => {
  const status = health || resolveIbkrGatewayHealth({ connection, runtime });
  const badges = [];
  const pushStreamBadge = (state) => {
    const canonicalState = canonicalizeStreamState(state, "offline");
    badges.push({
      label: STREAM_STATE_LABEL[canonicalState],
      color: streamStateTokenVar(canonicalState),
      background: streamStateBackgroundVar(canonicalState),
    });
  };

  if (
    [
      "healthy",
      "ready",
      "no-subscribers",
      "quote_standby",
      "idle",
      "market-closed",
      "market_closed",
      "quiet",
      "checking",
      "delayed",
      "stale",
      "stale_stream",
      "capacity-limited",
      "capacity_limited",
      "reconnecting",
      "reconnect_needed",
      "login-required",
      "login_required",
      "offline",
    ].includes(status.status)
  ) {
    pushStreamBadge(status.status);
  } else if (status.status === "competing") {
    badges.push({
      label: "COMPETE",
      color: CSS_COLOR.red,
      background: CSS_COLOR.redBg,
    });
  }

  const gapCount =
    latencyStats?.stream?.recentDataGapCount ??
    latencyStats?.stream?.recentGapCount ??
    latencyStats?.stream?.dataGapCount ??
    latencyStats?.stream?.streamGapCount;
  if (Number.isFinite(gapCount) && gapCount > 0) {
    const gapState = gapCount > 3 ? "offline" : "stale";
    badges.push({
      label: `GAPS ${Math.round(gapCount)}`,
      color: streamStateTokenVar(gapState),
      background: streamStateBackgroundVar(gapState),
    });
  }

  return badges.slice(0, 2);
};

export const buildIbkrGatewayTitle = ({
  label = "IB Gateway",
  connection,
  tone,
  runtime,
  latencyStats,
  health,
} = {}) => {
  const resolvedHealth =
    health || resolveIbkrGatewayHealth({ connection, runtime });
  const resolvedTone = tone || getIbkrConnectionTone(connection);
  const proof = resolveConnectionProof(connection, runtime);
  const role = String(connection?.role || "").replace(/_/g, " ");
  const accountCount = firstValue(
    runtime?.accountCount,
    Array.isArray(connection?.accounts) ? connection.accounts.length : null,
  );
  const selectedAccount = maskIbkrAccountId(
    firstValue(connection?.selectedAccountId, runtime?.selectedAccountId),
  );
  const stream = latencyStats?.stream;
  const details = [
    `${label}: ${resolvedHealth.label}`,
    `state ${resolvedTone.label}`,
    `role ${role || "--"}`,
    `target ${firstValue(connection?.target, runtime?.connectionTarget) || "--"}`,
    `ping ${formatIbkrPingMs(connection?.lastPingMs)}`,
    `heartbeat ${formatRelativeTimeShort(connection?.lastTickleAt)}`,
  ];

  const mode = firstValue(connection?.mode, runtime?.sessionMode);
  const clientId = firstValue(connection?.clientId, runtime?.clientId);
  const marketDataMode = firstValue(
    connection?.marketDataMode,
    runtime?.marketDataMode,
  );
  const liveMarketDataAvailable = firstBoolean(
    connection?.liveMarketDataAvailable,
    runtime?.liveMarketDataAvailable,
  );

  if (mode) details.push(`mode ${mode}`);
  if (clientId != null) details.push(`client ${clientId}`);
  if (accountCount != null) details.push(`accounts ${accountCount}`);
  if (selectedAccount) {
    details.push(`account ${selectedAccount}`);
  }
  if (marketDataMode) details.push(`market data ${marketDataMode}`);
  if (liveMarketDataAvailable != null) {
    details.push(`live data ${liveMarketDataAvailable ? "yes" : "no"}`);
  }
  if (proof.healthFresh != null) {
    details.push(`health ${proof.healthFresh ? "current" : "pending"}`);
  }
  if (proof.streamFresh != null) {
    details.push(`stream ${proof.streamFresh ? "current" : "pending"}`);
  }
  if (proof.streamState) {
    details.push(`stream state ${proof.streamState}`);
  }
  if (proof.streamStateReason) {
    details.push(`stream reason ${proof.streamStateReason}`);
  }
  if (proof.lastStreamEventAgeMs != null) {
    details.push(`stream age ${formatIbkrPingMs(proof.lastStreamEventAgeMs)}`);
  }
  if (proof.strictReason) {
    details.push(`reason ${proof.strictReason}`);
  }

  if (latencyStats) {
    details.push(`total p95 ${formatIbkrPingMs(latencyStats.totalMs?.p95)}`);
    details.push(
      `bridge p95 ${formatIbkrPingMs(latencyStats.bridgeToApiMs?.p95)}`,
    );
    details.push(
      `react p95 ${formatIbkrPingMs(latencyStats.apiToReactMs?.p95)}`,
    );
  }

  if (stream) {
    const dataGapCount = stream.dataGapCount ?? stream.streamGapCount;
    const maxDataGapMs = stream.maxDataGapMs ?? stream.maxGapMs;
    details.push(`stream consumers ${formatCount(stream.activeConsumerCount)}`);
    details.push(`symbols ${formatCount(stream.unionSymbolCount)}`);
    details.push(`events ${formatCount(stream.eventCount)}`);
    details.push(`reconnects ${formatCount(stream.reconnectCount)}`);
    details.push(`data gaps ${formatCount(dataGapCount)}`);
    details.push(`max data gap ${formatIbkrPingMs(maxDataGapMs)}`);
    details.push(`last event ${formatIbkrPingMs(stream.lastEventAgeMs)} ago`);
  }

  const error = firstValue(
    connection?.lastError,
    runtime?.lastError,
    runtime?.healthError,
  );
  if (error) details.push(error);

  return details.join(" | ");
};

const IbkrStatusWaveImpl = ({
  status,
  tone = {},
  color,
  wave,
  active,
  duration,
  width = 34,
  height = 12,
  decorative = true,
  ariaLabel,
  dataTestId,
  style,
}) => {
  const profile = resolveIbkrStatusWaveProfile({ status, wave });
  const prefersReducedMotion = usePrefersReducedMotion();
  const resolvedDuration = duration ?? profile.duration;
  const requestedAnimated =
    Boolean(active ?? profile.active) && Boolean(resolvedDuration) && !prefersReducedMotion;
  // Stabilize the SMIL inputs so transient ping/stream flaps don't restart the wave.
  const stableMotion = useStableWaveMotion(requestedAnimated, resolvedDuration);
  const animated = stableMotion.animated;
  const animationDuration = stableMotion.duration;
  const resolvedColor = color || tone.color || CSS_COLOR.textMuted;

  return (
    <span
      aria-hidden={decorative ? "true" : undefined}
      aria-label={!decorative ? ariaLabel : undefined}
      role={!decorative && ariaLabel ? "img" : undefined}
      data-ibkr-wave
      data-ibkr-wave-motion={animated ? "animated" : "static"}
      data-ibkr-wave-state={profile.state}
      data-testid={dataTestId}
      style={{
        display: "inline-block",
        width: dim(width),
        height: dim(height),
        flexShrink: 0,
        opacity: animated ? 1 : 0.68,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 32 12"
        width="100%"
        height="100%"
        focusable="false"
        style={{ display: "block", overflow: "visible" }}
      >
        {animated ? (
          <>
            <polyline
              points={SINE_WAVE_PHASES[0]}
              fill="none"
              stroke={resolvedColor}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.25"
              opacity="0.2"
              vectorEffect="non-scaling-stroke"
            >
              <animate
                attributeName="points"
                dur={animationDuration}
                repeatCount="indefinite"
                values={SINE_WAVE_VALUES}
              />
            </polyline>
            <polyline
              points={SINE_WAVE_PHASES[0]}
              fill="none"
              stroke={resolvedColor}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.45"
              opacity="0.95"
              vectorEffect="non-scaling-stroke"
            >
              <animate
                attributeName="points"
                dur={animationDuration}
                repeatCount="indefinite"
                values={SINE_WAVE_VALUES}
              />
            </polyline>
          </>
        ) : (
          <polyline
            points={SINE_WAVE_PHASES[0]}
            fill="none"
            stroke={resolvedColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.25"
            opacity="0.38"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </span>
  );
};

const shallowStyleEqual = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
};

// Isolate the wave: the header re-renders every second off marketClockNow, and
// IbkrPingWavelength rebuilds a fresh {...tone, color} object each tick, so a plain
// memo wouldn't help. Compare only the props that change the rendered wave —
// state, duration, and color — so a parent re-render can no longer reconcile (or
// restart the SMIL animation in) this subtree. (Wave-stutter fix, robustness step.)
const waveRenderPropsEqual = (prev, next) =>
  prev.status === next.status &&
  prev.wave === next.wave &&
  prev.active === next.active &&
  prev.duration === next.duration &&
  prev.color === next.color &&
  (prev.tone?.color ?? null) === (next.tone?.color ?? null) &&
  prev.width === next.width &&
  prev.height === next.height &&
  prev.decorative === next.decorative &&
  prev.ariaLabel === next.ariaLabel &&
  prev.dataTestId === next.dataTestId &&
  shallowStyleEqual(prev.style, next.style);

export const IbkrStatusWave = React.memo(IbkrStatusWaveImpl, waveRenderPropsEqual);
IbkrStatusWave.displayName = "IbkrStatusWave";

export const IbkrPingWavelength = ({ connection, tone = {} }) => {
  const duration = resolveWaveDuration(connection, tone);
  const active = Boolean(duration);
  const color = active
    ? streamStateTokenVar("healthy")
    : tone.color || CSS_COLOR.textMuted;

  return (
    <IbkrStatusWave
      status={active ? "healthy" : "offline"}
      tone={{ ...tone, color }}
      wave={tone.wave}
      active={active}
      duration={duration}
    />
  );
};

export const IbkrConnectionLane = ({
  label,
  connection,
  compact = false,
  onReconnect,
  reconnectLabel = "Reconnect",
  reconnectDisabled = false,
  reconnectBusy = false,
}) => {
  const tone = getIbkrConnectionTone(connection);
  const health = resolveIbkrGatewayHealth({ connection });
  const proof = resolveConnectionProof(connection);
  const failurePoint = buildIbkrConnectionFailurePoint({
    label,
    connection,
    proof,
    tone,
  });
  const showReconnectAction = Boolean(
    onReconnect && shouldShowIbkrReconnectAction(health),
  );
  const Icon = tone.Icon;

  return (
    <AppTooltip content={<FailurePointContent point={failurePoint} compact />}><div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(10),
        padding: sp("8px 14px"),
        minHeight: dim(40),
        minWidth: compact ? dim(140) : dim(200),
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: dim(28),
          height: dim(28),
          borderRadius: dim(RADII.pill),
          background: cssColorMix(tone.color, 8),
          flexShrink: 0,
        }}
      >
        <Icon size={dim(15)} strokeWidth={2.2} color={tone.color} />
      </span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: sp(1),
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            color: CSS_COLOR.textMuted,
            fontSize: textSize("caption"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: tone.color,
            fontSize: textSize("paragraphMuted"),
            fontWeight: FONT_WEIGHTS.medium,
            fontFamily: T.sans,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}
        >
          {tone.label}
        </span>
      </span>
      <IbkrPingWavelength connection={connection} tone={tone} />
      {!compact ? (
        <span
          style={{
            color: CSS_COLOR.textSec,
            fontSize: textSize("body"),
            fontFamily: T.sans,
            fontWeight: FONT_WEIGHTS.medium,
            textAlign: "right",
            minWidth: dim(44),
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatIbkrPingMs(connection?.lastPingMs)}
        </span>
      ) : null}
      {showReconnectAction ? (
        <ActionButton
          dataTestId="ibkr-connection-reconnect"
          size="xs"
          variant="secondary"
          pending={reconnectBusy}
          pendingLabel="Opening"
          disabled={reconnectDisabled}
          onClick={onReconnect}
          style={{
            minHeight: dim(24),
            padding: sp("3px 8px"),
            borderRadius: dim(RADII.sm),
            border: `1px solid ${cssColorAlpha(health.color, "55")}`,
            background: cssColorAlpha(health.color, "12"),
            color: health.color,
            flexShrink: 0,
          }}
        >
          {reconnectLabel}
        </ActionButton>
      ) : null}
    </div></AppTooltip>
  );
};

export const IbkrConnectionStatusPair = ({
  session,
  compact = false,
}) => {
  const tws = getIbkrConnection(session, "tws");

  return (
    <div
      style={{
        display: "grid",
        gap: sp(5),
        minWidth: 0,
      }}
    >
      <IbkrConnectionLane label="IB Gateway" connection={tws} compact={compact} />
    </div>
  );
};

import React from "react";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleOff,
  PlugZap,
} from "lucide-react";
import {
  CSS_COLOR,
  cssColorAlpha,
  dim,
  fs,
} from "../../lib/uiTokens.jsx";
import {
  STREAM_STATE_LABEL,
  canonicalizeStreamState,
  streamStateBackgroundVar,
  streamStateTokenVar,
} from "./streamSemantics";
import {
  advanceWaveMotion,
  initWaveMotionState,
  WAVE_MOTION_DWELL_MS,
} from "./ibkrWaveMotionModel.js";
const firstBoolean = (...values) =>
  values.find((value) => typeof value === "boolean");

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const isLiveMarketDataMode = (value) => String(value || "").toLowerCase() === "live";
const NO_ACTIVE_QUOTE_CONSUMERS_REASON = "no_active_quote_consumers";
const MARKET_SESSION_QUIET_REASON = "market_session_quiet";

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

const isBridgeHealthProbeFailure = (runtime) => {
  const code = String(runtime?.healthErrorCode || "");
  return code.startsWith("ibkr_bridge_health");
};

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
  // Backend connectivity verdict, decoupled from the freshness clocks. When present
  // and true, the bridge socket/auth/server are confirmed up (with a recent liveness
  // round-trip), so the connection is genuinely reachable even if the quote/health
  // freshness windows lapsed under load. Absent => fall back to the legacy logic.
  const connectivityUp = firstBoolean(
    connection?.connectivityUp,
    runtime?.connectivityUp,
  );
  const connectivityReason = firstValue(
    connection?.connectivityReason,
    runtime?.connectivityReason,
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
    connectivityUp,
    connectivityReason,
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

export const isIbkrGatewayBridgeAttached = ({
  connection,
  runtime,
} = {}) => {
  const configured = firstBoolean(
    connection?.configured,
    runtime?.configured,
  );
  const competing = firstBoolean(connection?.competing, runtime?.competing);
  const proof = resolveConnectionProof(connection, runtime);
  if (
    proof.connectivityUp === true &&
    configured &&
    !competing
  ) {
    return true;
  }
  const reachableOrSocket = Boolean(
    proof.bridgeReachable === true ||
      proof.socketConnected === true ||
      connection?.reachable === true ||
      runtime?.reachable === true ||
      runtime?.connected === true,
  );
  const hasDisconnectReason = Boolean(
    !isBridgeHealthProbeFailure(runtime) &&
      (isGatewayDisconnectReason(proof.strictReason) ||
        isGatewayDisconnectReason(proof.streamStateReason)),
  );

  return Boolean(
    configured &&
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
            ? "Client Portal is reachable, but the broker session is disconnected"
            : "Reconnect IBKR through Client Portal",
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
              ? "Client Portal is reachable, but the broker session is disconnected"
              : "Reconnect IBKR through Client Portal",
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
      label: "competing",
      color: CSS_COLOR.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  // Backend confirms the bridge connection is up (socket/auth/server + liveness),
  // decoupled from the freshness clocks. Recognize it BEFORE the freshness-based
  // downgrades below ("health pending"/"quote stale"), which under a stale cache would
  // otherwise show a false "not connected". Only the delayed-market-data state is kept.
  if (proof.connectivityUp === true) {
    const connectivityDelayed =
      proof.configuredLiveMarketDataMode === false ||
      proof.liveMarketDataAvailable === false;
    return connectivityDelayed
      ? { label: "delayed", color: CSS_COLOR.amber, Icon: Activity, wave: "flat" }
      : { label: "online", color: CSS_COLOR.green, Icon: CircleCheck, wave: "fast" };
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
      label: "login required",
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

export const resolveIbkrGatewayHealth = ({
  connection,
  runtime,
} = {}) => {
  const configured = firstBoolean(
    connection?.configured,
    runtime?.configured,
  );
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
  const activeClientPortalContext = configured === true;
  const hasDisconnectReason = Boolean(
    !isBridgeHealthProbeFailure(runtime) &&
      (isGatewayDisconnectReason(proof.strictReason) ||
        isGatewayDisconnectReason(proof.streamStateReason)),
  );

  if (!configured) {
    return {
      status: "misconfigured",
      label: "Misconfigured",
      color: CSS_COLOR.amber,
      detail: "IBKR Client Portal is not configured",
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

  // Backend confirms the bridge connection is up (socket/auth/server + liveness),
  // decoupled from the freshness clocks. Recognize it here BEFORE the freshness/
  // reachability downgrades below — under a stale cache socketConnected/bridgeReachable
  // can read false while the connection is genuinely up, which would otherwise leak an
  // "Offline"/"Health Pending"/"Quote Stream Stale" false-negative. Preserve only the
  // delayed-market-data distinction.
  if (proof.connectivityUp === true) {
    if (
      proof.configuredLiveMarketDataMode === false ||
      liveMarketDataAvailable === false
    ) {
      return {
        status: "delayed",
        label: "Delayed",
        color: streamStateTokenVar("delayed"),
        detail: "Gateway is connected but live market data is not available",
      };
    }
    return {
      status: "healthy",
      label: "Connected",
      color: streamStateTokenVar("healthy"),
      detail: "Gateway socket, login, and server connection are confirmed up",
    };
  }

  if (
    proof.healthFresh === false &&
    (proof.bridgeReachable ||
      proof.socketConnected ||
      authenticated ||
      activeClientPortalContext) &&
    !hasDisconnectReason &&
    !streamHasCurrentEvidence
  ) {
    return {
      status: "stale",
      label: "Health Pending",
      color: CSS_COLOR.amber,
      detail: activeClientPortalContext
        ? "Client Portal is active; waiting for current session health"
        : "Client Portal health is pending; waiting for the next successful check",
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
      detail: "Client Portal gateway is not reachable",
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
          ? "Client Portal is reachable, but the broker session is disconnected"
          : streamMeta?.detail || "Reconnect IBKR through Client Portal",
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
      detail: "Client Portal is reachable but the broker session is not authenticated",
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

// Compare only the inputs that change the rendered wave so parent re-renders do
// not restart the SMIL animation in this subtree.
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

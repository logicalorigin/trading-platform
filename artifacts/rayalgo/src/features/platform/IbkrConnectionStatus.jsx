import React from "react";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  CircleOff,
  PlugZap,
  RadioTower,
} from "lucide-react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  STREAM_STATE_LABEL,
  canonicalizeStreamState,
  streamStateBackgroundVar,
  streamStateTokenVar,
} from "./streamSemantics";
import { AppTooltip } from "@/components/ui/tooltip";


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
      label: "no quote subscribers",
      status: state,
      healthLabel: "No Quote Subscribers",
      detail:
        "Gateway is connected; no UI panel is subscribed to the stock quote stream",
      color: tokenColor,
      background: tokenBackground,
      Icon: RadioTower,
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
      Icon: RadioTower,
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
        Icon: RadioTower,
        wave: "slow",
        badge: STREAM_STATE_LABEL[state],
      };
    case "stale":
      return {
        label: "stale",
        status: state,
        healthLabel: "Stale Stream",
        detail: "Gateway is authenticated but stream events are stale",
        color: tokenColor,
        background: tokenBackground,
        Icon: Activity,
        wave: "flat",
        badge: STREAM_STATE_LABEL[state],
        pulse: true,
      };
    case "capacity-limited":
      return {
        label: "capacity limited",
        status: state,
        healthLabel: "Capacity Limited",
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
      color: T.textDim,
      Icon: CircleOff,
      wave: "flat",
    };
  }

  const proof = resolveConnectionProof(connection);

  if (connection.competing) {
    return {
      label: "compete",
      color: T.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  const streamMeta = getIbkrStreamStateMeta(
    proof.streamState,
    proof.streamStateReason,
  );
  if (streamMeta?.status === "reconnecting") {
    return {
      label: streamMeta.label,
      color: streamMeta.color,
      Icon: streamMeta.Icon,
      wave: streamMeta.wave,
      pulse: streamMeta.pulse,
    };
  }

  const streamHasCurrentEvidence =
    proof.streamFresh === true ||
    ["healthy", "quiet", "capacity-limited"].includes(
      canonicalizeStreamState(proof.streamState, "offline"),
    );

  if (
    proof.healthFresh === false &&
    (connection.authenticated || connection.reachable) &&
    !streamHasCurrentEvidence
  ) {
    return {
      label: "stale",
      color: T.amber,
      Icon: CircleAlert,
      wave: "flat",
    };
  }

  if (connection.lastError && !connection.reachable) {
    return {
      label: "error",
      color: T.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  if (connection.reachable === false) {
    return {
      label: "offline",
      color: T.red,
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
        color: T.accent,
        Icon: Activity,
        wave: "flat",
      };
    }

    if (delayed) {
      return {
        label: "delayed",
        color: T.amber,
        Icon: Activity,
        wave: "flat",
      };
    }

    if (streamMeta) {
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
            ? "stale"
            : "checking",
      color: ready ? T.green : streamStale ? T.amber : T.accent,
      Icon: ready ? CircleCheck : Activity,
      wave: ready ? "fast" : "flat",
    };
  }

  if (connection.reachable) {
    return {
      label: "login",
      color: T.amber,
      Icon: PlugZap,
      wave: "medium",
    };
  }

  if (connection.lastError) {
    return {
      label: "error",
      color: T.red,
      Icon: CircleAlert,
      wave: "slow",
    };
  }

  return {
    label: "ready",
    color: T.textDim,
    Icon: RadioTower,
    wave: "flat",
  };
};

export const isIbkrWaveActive = (connection) => {
  if (!connection?.configured || connection?.competing) {
    return false;
  }

  const proof = resolveConnectionProof(connection);
  const streamState = canonicalizeStreamState(proof.streamState, "offline");
  const connected = Boolean(
    proof.healthFresh === true &&
      proof.authenticated === true &&
      proof.brokerServerConnected !== false &&
      (proof.bridgeReachable === true ||
        proof.socketConnected === true ||
        connection.reachable === true) &&
      proof.accountsLoaded !== false,
  );

  return Boolean(
    proof.strictReady === true ||
      (connected &&
        (streamState === "healthy" ||
          streamState === "quiet" ||
          isQuoteStandbyState(proof))),
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
  const streamState = canonicalizeStreamState(proof.streamState, "offline");
  const streamHasCurrentEvidence =
    proof.streamFresh === true ||
    streamState === "healthy" ||
    streamState === "quiet" ||
    streamState === "capacity-limited";

  if (!configured || bridgeUrlConfigured === false) {
    return {
      status: "misconfigured",
      label: "Misconfigured",
      color: T.amber,
      detail: "Bridge URL or Gateway transport is not configured",
    };
  }

  if (competing) {
    return {
      status: "competing",
      label: "Competing",
      color: T.red,
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
      label: "Stale",
      color: T.amber,
      detail: "Gateway health is pending; waiting for the next successful check",
    };
  }

  if (
    bridgeReachable === false ||
    (bridgeReachable !== true && socketConnected === false)
  ) {
    return {
      status: "offline",
      label: "Offline",
      color: T.red,
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
      color: streamMeta?.color || T.amber,
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
      color: streamMeta?.color || T.amber,
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
      label: "Stale Stream",
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

const resolveWaveDuration = (connection, tone) => {
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
    badges.push({ label: "COMPETE", color: T.red, background: T.redBg });
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

export const IbkrPingWavelength = ({ connection, tone }) => {
  const duration = resolveWaveDuration(connection, tone);
  const prefersReducedMotion = usePrefersReducedMotion();
  const active = Boolean(duration) && !prefersReducedMotion;
  const color = active ? streamStateTokenVar("healthy") : tone.color || T.textMuted;
  const staticPoints = active ? SINE_WAVE_PHASES[0] : buildSineWavePoints(0);

  return (
    <span
      aria-hidden="true"
      data-ibkr-wave
      style={{
        display: "inline-block",
        width: dim(34),
        height: dim(12),
        flexShrink: 0,
        opacity: active ? 1 : 0.68,
      }}
    >
      <svg
        viewBox="0 0 32 12"
        width="100%"
        height="100%"
        focusable="false"
        style={{ display: "block", overflow: "visible" }}
      >
        {active ? (
          <>
            <polyline
              points={SINE_WAVE_PHASES[0]}
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.25"
              opacity="0.2"
              vectorEffect="non-scaling-stroke"
            >
              <animate
                attributeName="points"
                dur={duration}
                repeatCount="indefinite"
                values={SINE_WAVE_VALUES}
              />
            </polyline>
            <polyline
              points={SINE_WAVE_PHASES[0]}
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.45"
              opacity="0.95"
              vectorEffect="non-scaling-stroke"
            >
              <animate
                attributeName="points"
                dur={duration}
                repeatCount="indefinite"
                values={SINE_WAVE_VALUES}
              />
            </polyline>
          </>
        ) : (
          <polyline
            points={staticPoints}
            fill="none"
            stroke={color}
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

export const IbkrConnectionLane = ({
  label,
  connection,
  compact = false,
}) => {
  const tone = getIbkrConnectionTone(connection);
  const Icon = tone.Icon;

  return (
    <AppTooltip content={buildIbkrGatewayTitle({ label, connection, tone })}><div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sp(7),
        padding: sp("4px 10px"),
        minWidth: compact ? dim(112) : dim(150),
        background: `${tone.color}10`,
        borderRadius: dim(999),
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={dim(13)} strokeWidth={2.2} color={tone.color} />
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: sp(5),
          minWidth: 0,
          color: T.text,
          fontSize: fs(10),
          fontWeight: 500,
          fontFamily: T.sans,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {label}
        <span
          style={{
            color: tone.color,
            fontSize: fs(9),
            fontWeight: 500,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {tone.label}
        </span>
      </span>
      <IbkrPingWavelength connection={connection} tone={tone} />
      {!compact ? (
        <span
          style={{
            color: T.textDim,
            fontSize: fs(9),
            fontFamily: T.sans,
            fontWeight: 500,
            textAlign: "right",
            minWidth: dim(34),
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatIbkrPingMs(connection?.lastPingMs)}
        </span>
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

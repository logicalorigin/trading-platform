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
  if (
    streamState === "quiet" &&
    streamStateReason === NO_ACTIVE_QUOTE_CONSUMERS_REASON
  ) {
    return {
      label: "no quote subscribers",
      status: "quote_standby",
      healthLabel: "No Quote Subscribers",
      detail:
        "Gateway is connected; no UI panel is subscribed to the stock quote stream",
      color: T.green,
      background: T.greenBg,
      Icon: RadioTower,
      wave: "slow",
      badge: "NO SUBS",
    };
  }

  if (
    streamState === "quiet" &&
    streamStateReason === MARKET_SESSION_QUIET_REASON
  ) {
    return {
      label: "market closed",
      status: "market_closed",
      healthLabel: "Market Closed",
      detail: "Gateway is ready; the equity market session is closed",
      color: T.green,
      background: T.greenBg,
      Icon: RadioTower,
      wave: "slow",
      badge: "CLOSED",
    };
  }

  switch (streamState) {
    case "live":
      return {
        label: "online",
        status: "ready",
        healthLabel: "Ready",
        detail: "Gateway is authenticated and live stream events are current",
        color: T.green,
        background: T.greenBg,
        Icon: CircleCheck,
        wave: "fast",
        badge: "LIVE",
      };
    case "quiet":
      return {
        label: "quiet stream",
        status: "quiet",
        healthLabel: "Quiet Stream",
        detail: "Gateway is authenticated; stream is quiet for an unspecified reason",
        color: T.green,
        background: T.greenBg,
        Icon: RadioTower,
        wave: "slow",
        badge: "QUIET STREAM",
      };
    case "stale":
      return {
        label: "stale",
        status: "stale_stream",
        healthLabel: "Stale Stream",
        detail: "Gateway is authenticated but stream events are stale",
        color: T.amber,
        background: T.amberBg,
        Icon: Activity,
        wave: "flat",
        badge: "STALE",
        pulse: true,
      };
    case "capacity_limited":
      return {
        label: "capacity limited",
        status: "capacity_limited",
        healthLabel: "Capacity Limited",
        detail:
          "Gateway is connected; live market data requests are waiting for available IBKR lines",
        color: T.amber,
        background: T.amberBg,
        Icon: CircleAlert,
        wave: "slow",
        badge: "CAPACITY",
        pulse: true,
      };
    case "reconnecting":
      return {
        label: "reconnecting",
        status: "reconnecting",
        healthLabel: "Reconnecting",
        detail: "Gateway is authenticated and the quote stream is reconnecting",
        color: T.amber,
        background: T.amberBg,
        Icon: PlugZap,
        wave: "slow",
        badge: "RETRY",
        pulse: true,
      };
    case "reconnect_needed":
      return {
        label:
          streamStateReason === "gateway_server_disconnected"
            ? "server disconnected"
            : "reconnect",
        status: "reconnect_needed",
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
        color: T.amber,
        background: T.amberBg,
        Icon: PlugZap,
        wave: "flat",
        badge: "RECONNECT",
        pulse: true,
      };
    case "delayed":
      return {
        label: "delayed",
        status: "delayed",
        healthLabel: "Delayed",
        detail: "Gateway is authenticated but live market data is not available",
        color: T.amber,
        background: T.amberBg,
        Icon: Activity,
        wave: "flat",
        badge: "DELAYED",
      };
    case "login_required":
      return {
        label: "login",
        status: "login_required",
        healthLabel: "Login Required",
        detail: "Bridge is reachable but Gateway is not authenticated",
        color: T.amber,
        background: T.amberBg,
        Icon: PlugZap,
        wave: "medium",
        badge: "LOGIN",
      };
    case "checking":
      return {
        label: "checking",
        status: "checking",
        healthLabel: "Checking",
        detail: "Gateway is authenticated; waiting for account and stream proof",
        color: T.accent,
        background: `${T.accent}14`,
        Icon: Activity,
        wave: "flat",
        badge: "CHECKING",
      };
    case "offline":
      return {
        label: "offline",
        status: "offline",
        healthLabel: "Offline",
        detail: "Gateway bridge is not reachable",
        color: T.red,
        background: T.redBg,
        Icon: CircleOff,
        wave: "flat",
        badge: "OFFLINE",
      };
    default:
      return null;
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
  if (streamMeta?.status === "reconnect_needed") {
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
    proof.streamState === "live" ||
    proof.streamState === "quiet" ||
    proof.streamState === "capacity_limited";

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
        (proof.streamState === "live" ||
          proof.streamState === "quiet" ||
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
  const streamHasCurrentEvidence =
    proof.streamFresh === true ||
    proof.streamState === "live" ||
    proof.streamState === "quiet" ||
    proof.streamState === "capacity_limited";

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
      status: streamMeta?.status || "reconnect_needed",
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
      status: "reconnect_needed",
      label: streamMeta?.healthLabel || "Server Disconnected",
      color: streamMeta?.color || T.amber,
      detail:
        streamMeta?.detail ||
        "Gateway API socket is open, but Gateway is disconnected from IBKR servers",
    };
  }

  if (!authenticated) {
    return {
      status: "login_required",
      label: "Login Required",
      color: T.amber,
      detail: "Bridge is reachable but Gateway is not authenticated",
    };
  }

  if (proof.accountsLoaded === false) {
    return {
      status: "checking",
      label: "Checking",
      color: T.accent,
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
      color: T.amber,
      detail: "Gateway is authenticated but live market data is not available",
    };
  }

  const streamMeta = getIbkrStreamStateMeta(
    proof.streamState,
    proof.streamStateReason,
  );
  if (streamMeta && streamMeta.status !== "login_required" && streamMeta.status !== "offline") {
    return {
      status: streamMeta.status,
      label: streamMeta.healthLabel,
      color: streamMeta.color,
      detail: streamMeta.detail,
    };
  }

  if (proof.strictReady !== true) {
    return {
      status: "stale_stream",
      label: "Stale Stream",
      color: T.amber,
      detail: "Gateway is authenticated but fresh stream events are not confirmed",
    };
  }

  return {
    status: "ready",
    label: "Ready",
    color: T.green,
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

  if (status.status === "ready") {
    badges.push({ label: "LIVE", color: T.green, background: T.greenBg });
  } else if (status.status === "quote_standby" || status.status === "idle") {
    badges.push({ label: "NO SUBS", color: T.green, background: T.greenBg });
  } else if (status.status === "market_closed") {
    badges.push({ label: "CLOSED", color: T.textSec, background: T.bg2 });
  } else if (status.status === "quiet") {
    badges.push({ label: "QUIET STREAM", color: T.textSec, background: T.bg2 });
  } else if (status.status === "checking") {
    badges.push({
      label: "CHECKING",
      color: T.accent,
      background: `${T.accent}14`,
    });
  } else if (status.status === "delayed") {
    badges.push({ label: "DELAYED", color: T.amber, background: T.amberBg });
  } else if (status.status === "stale" || status.status === "stale_stream") {
    badges.push({ label: "STALE", color: T.amber, background: T.amberBg });
  } else if (status.status === "capacity_limited") {
    badges.push({ label: "CAPACITY", color: T.amber, background: T.amberBg });
  } else if (status.status === "reconnecting") {
    badges.push({ label: "RETRY", color: T.amber, background: T.amberBg });
  } else if (status.status === "reconnect_needed") {
    badges.push({ label: "RECONNECT", color: T.amber, background: T.amberBg });
  } else if (status.status === "login_required") {
    badges.push({ label: "LOGIN", color: T.amber, background: T.amberBg });
  } else if (status.status === "competing") {
    badges.push({ label: "COMPETE", color: T.red, background: T.redBg });
  }

  const gapCount = latencyStats?.stream?.streamGapCount;
  if (Number.isFinite(gapCount) && gapCount > 0) {
    badges.push({
      label: `GAPS ${Math.round(gapCount)}`,
      color: gapCount > 3 ? T.red : T.amber,
      background: gapCount > 3 ? T.redBg : T.amberBg,
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
    details.push(`stream consumers ${formatCount(stream.activeConsumerCount)}`);
    details.push(`symbols ${formatCount(stream.unionSymbolCount)}`);
    details.push(`events ${formatCount(stream.eventCount)}`);
    details.push(`reconnects ${formatCount(stream.reconnectCount)}`);
    details.push(`gaps ${formatCount(stream.streamGapCount)}`);
    details.push(`max gap ${formatIbkrPingMs(stream.maxGapMs)}`);
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
  const color = active ? T.green : tone.color || T.textMuted;
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
        display: "grid",
        gridTemplateColumns: compact ? "auto 1fr auto" : "auto 1fr auto auto",
        alignItems: "center",
        gap: sp(6),
        minWidth: compact ? dim(112) : dim(150),
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
          fontSize: fs(9),
          fontWeight: 400,
          fontFamily: T.sans,
          letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span
          style={{
            color: tone.color,
            fontSize: fs(8),
            fontWeight: 400,
          }}
        >
          {tone.label.toUpperCase()}
        </span>
      </span>
      <IbkrPingWavelength connection={connection} tone={tone} />
      {!compact ? (
        <span
          style={{
            color: T.textDim,
            fontSize: fs(8),
            fontFamily: T.mono,
            textAlign: "right",
            minWidth: dim(34),
            whiteSpace: "nowrap",
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

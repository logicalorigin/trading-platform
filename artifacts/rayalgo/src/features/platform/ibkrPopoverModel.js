import { MISSING_VALUE, T } from "../../lib/uiTokens";
import {
  formatIbkrPingMs,
  getIbkrGatewayBadges,
  maskIbkrAccountId,
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus.jsx";

const headerDetailValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const formatHeaderCount = (value) =>
  Number.isFinite(value)
    ? Math.max(0, Math.round(value)).toLocaleString()
    : MISSING_VALUE;

const formatHeaderBool = (value, truthy = "yes", falsy = "no") =>
  typeof value === "boolean" ? (value ? truthy : falsy) : MISSING_VALUE;

const normalizeHeaderText = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  return text;
};

const buildIssueLabel = (summary, detail) => {
  const summaryText = normalizeHeaderText(summary) || "Gateway is not ready";
  const detailText = normalizeHeaderText(detail);

  if (!detailText || summaryText === detailText || summaryText.includes(detailText)) {
    return summaryText;
  }

  if (detailText.includes(summaryText)) {
    return detailText;
  }

  return `${summaryText}: ${detailText}`;
};

const GOVERNOR_FAILURE_LANES = ["health", "account", "quotes", "orders", "options"];

const getGovernorLastFailure = (governor) => {
  if (!governor || typeof governor !== "object") {
    return null;
  }

  for (const lane of GOVERNOR_FAILURE_LANES) {
    const failure = normalizeHeaderText(governor[lane]?.lastFailure);
    if (failure) {
      return failure;
    }
  }

  return null;
};

const NO_ACTIVE_QUOTE_CONSUMERS_REASON = "no_active_quote_consumers";
const MARKET_SESSION_QUIET_REASON = "market_session_quiet";
const HEALTHY_STATUS_KEYS = new Set([
  "ready",
  "quote_standby",
  "idle",
  "market_closed",
  "quiet",
]);

export const buildHeaderIbkrPopoverModel = ({
  connection,
  latencyStats,
  runtimeDiagnostics,
  runtimeError,
}) => {
  const runtime = runtimeDiagnostics?.ibkr;
  const detailConnection = runtime
    ? {
        configured: runtime.configured,
        reachable: runtime.connected,
        authenticated: runtime.authenticated,
        competing: runtime.competing,
        selectedAccountId: runtime.selectedAccountId,
        accounts: Number.isFinite(runtime.accountCount)
          ? Array.from({ length: runtime.accountCount })
          : [],
        target: runtime.connectionTarget,
        mode: runtime.sessionMode,
        clientId: runtime.clientId,
        marketDataMode: runtime.marketDataMode,
        liveMarketDataAvailable: runtime.liveMarketDataAvailable,
        healthFresh: runtime.healthFresh,
        healthAgeMs: runtime.healthAgeMs,
        bridgeReachable: runtime.bridgeReachable,
        socketConnected: runtime.socketConnected,
        accountsLoaded: runtime.accountsLoaded,
        configuredLiveMarketDataMode: runtime.configuredLiveMarketDataMode,
        streamFresh: runtime.streamFresh,
        streamState: runtime.streamState,
        streamStateReason: runtime.streamStateReason,
        lastStreamEventAgeMs: runtime.lastStreamEventAgeMs,
        strictReady: runtime.strictReady,
        strictReason: runtime.strictReason,
        lastError: runtime.lastError || runtime.healthError,
      }
    : connection;
  let health = resolveIbkrGatewayHealth({
    connection: detailConnection,
    runtime,
  });
  const stream = latencyStats?.stream || {};
  const accountCount = headerDetailValue(
    runtime?.accountCount,
    Array.isArray(connection?.accounts) ? connection.accounts.length : null,
  );
  const selectedAccount = maskIbkrAccountId(
    headerDetailValue(runtime?.selectedAccountId, connection?.selectedAccountId),
  );
  const target = headerDetailValue(runtime?.connectionTarget, connection?.target);
  const clientId = headerDetailValue(runtime?.clientId, connection?.clientId);
  const sessionMode = headerDetailValue(runtime?.sessionMode, connection?.mode);
  const marketDataMode = headerDetailValue(
    runtime?.marketDataMode,
    connection?.marketDataMode,
  );
  const liveMarketDataAvailable = headerDetailValue(
    runtime?.liveMarketDataAvailable,
    connection?.liveMarketDataAvailable,
  );
  const healthFresh = headerDetailValue(runtime?.healthFresh, connection?.healthFresh);
  const streamFresh = headerDetailValue(runtime?.streamFresh, connection?.streamFresh);
  const streamState = headerDetailValue(runtime?.streamState, connection?.streamState);
  const streamStateReason = headerDetailValue(
    runtime?.streamStateReason,
    connection?.streamStateReason,
  );
  const strictReady = headerDetailValue(runtime?.strictReady, connection?.strictReady);
  const strictReason = headerDetailValue(runtime?.strictReason, connection?.strictReason);
  const gatewaySocket = headerDetailValue(runtime?.connected, connection?.reachable);
  const authenticated = headerDetailValue(
    runtime?.authenticated,
    connection?.authenticated,
  );
  const competing = headerDetailValue(runtime?.competing, connection?.competing);
  const orderDiagnostics = runtime?.orderCapability
    ? runtime.orderCapability.diagnosticsMutateOrders
      ? "mutating"
      : "read-only"
    : MISSING_VALUE;
  const governorLastFailure = getGovernorLastFailure(runtime?.governor);
  const healthErrorText = normalizeHeaderText(runtime?.healthError);
  const healthBackoff =
    /backoff|backed off/i.test(
      `${runtime?.healthErrorCode || ""} ${healthErrorText || ""}`,
    );
  const bridgeNotReachable =
    runtime?.reachable === false ||
    runtime?.bridgeReachable === false ||
    runtime?.connected === false;
  const actionableBridgeError =
    governorLastFailure && (bridgeNotReachable || healthBackoff || healthFresh === false)
      ? governorLastFailure
      : null;
  const lastError = headerDetailValue(
    runtime?.lastError,
    actionableBridgeError,
    runtime?.healthError,
    connection?.lastError,
  );
  const diagnosticsErrorText = normalizeHeaderText(runtimeError);
  const runtimeState = diagnosticsErrorText
    ? runtimeDiagnostics
      ? "stale"
      : "unavailable"
    : runtimeDiagnostics
      ? "fresh"
      : "loading";
  const gatewayConnected = gatewaySocket === true;
  const authenticatedReady = authenticated === true;
  const bridgeReachable = runtime?.reachable;
  const streamConsumerCount = stream.activeConsumerCount;
  const streamSymbolCount = stream.unionSymbolCount;
  const streamGapCount = stream.streamGapCount;
  const streamActive =
    Number.isFinite(streamConsumerCount) && streamConsumerCount > 0;
  const streamFreshByCounters =
    streamActive &&
    Number.isFinite(stream.lastEventAgeMs) &&
    stream.lastEventAgeMs <= 10_000;
  const streamQuoteStandby =
    streamState === "quiet" &&
    streamStateReason === NO_ACTIVE_QUOTE_CONSUMERS_REASON &&
    !streamActive;
  const streamMarketClosed =
    streamState === "quiet" && streamStateReason === MARKET_SESSION_QUIET_REASON;
  const streamQuiet =
    streamState === "quiet" && !streamQuoteStandby && !streamMarketClosed;
  const streamCapacityLimited = streamState === "capacity_limited";
  const streamReconnecting = streamState === "reconnecting";
  const streamReconnectNeeded = streamState === "reconnect_needed";
  const streamStale =
    streamState === "stale" ||
    streamCapacityLimited ||
    (!streamState && streamFresh === false) ||
    (streamActive &&
      Number.isFinite(stream.lastEventAgeMs) &&
      stream.lastEventAgeMs > 10_000);
  const streamConfirmedFresh =
    streamState === "live" ||
    strictReady === true ||
    streamFresh === true ||
    streamFreshByCounters;
  const streamLiveActive =
    streamState === "live" ||
    streamFreshByCounters ||
    (streamActive && streamFresh === true);
  if (health.status === "quote_standby" && streamLiveActive) {
    health = {
      status: "ready",
      label: "Ready",
      color: T.green,
      detail: "Gateway is authenticated and live stream events are fresh",
    };
  }
  const badges = getIbkrGatewayBadges({
    connection: detailConnection,
    runtime,
    latencyStats,
    health,
  });
  const totalLatencyP95 = latencyStats?.totalMs?.p95;
  const liveDataLabel =
    liveMarketDataAvailable === true
      ? "Live"
      : liveMarketDataAvailable === false
        ? "Delayed"
        : marketDataMode || "Unknown";

  const healthyStatus = HEALTHY_STATUS_KEYS.has(health.status);
  let issue = {
    key: healthyStatus ? health.status : "ready",
    label: health.status === "ready" ? "Gateway ready for live data." : health.detail,
    tone: healthyStatus ? T.textSec : health.color,
    iconKey: healthyStatus ? "activity" : "alert",
    autoOpenDetails: false,
  };

  if (!healthyStatus) {
    issue = {
      key: health.status,
      label: buildIssueLabel(health.detail, lastError),
      tone: health.color,
      iconKey: "alert",
      autoOpenDetails: health.status === "misconfigured",
    };
  } else if (Number.isFinite(streamGapCount) && streamGapCount > 0) {
    issue = {
      key: "stream-gaps",
      label: `${Math.round(streamGapCount)} stream gap${
        Math.round(streamGapCount) === 1 ? "" : "s"
      } detected. Open Diagnostics for the full stream trace.`,
      tone: T.amber,
      iconKey: "alert",
      autoOpenDetails: false,
    };
  } else if (runtime?.legacyIbkrEnvPresent) {
    issue = {
      key: "legacy-env",
      label: "Legacy IBKR env vars are present; review details or Diagnostics.",
      tone: T.amber,
      iconKey: "alert",
      autoOpenDetails: true,
    };
  }

  const tiles = [
    {
      label: "Gateway",
      value:
        gatewaySocket == null
          ? runtimeState
          : gatewayConnected
            ? "Connected"
            : "Offline",
      tone: gatewayConnected ? T.green : gatewaySocket === false ? T.red : T.textDim,
      iconKey: "radioTower",
    },
    {
      label: "Auth",
      value:
        authenticated == null
          ? MISSING_VALUE
          : authenticatedReady
            ? "Yes"
            : "No",
      tone: authenticatedReady ? T.green : authenticated === false ? T.amber : T.textDim,
      iconKey: "shieldCheck",
    },
    {
      label: "Data",
      value:
        liveMarketDataAvailable === false
          ? "Delayed"
          : streamLiveActive || strictReady === true
            ? "Live"
            : streamQuiet
              ? "Quiet stream"
              : streamReconnecting
                ? "Reconnecting"
                : streamReconnectNeeded
                  ? "Reconnect"
                  : streamStale
                    ? "Stale stream"
                    : liveDataLabel,
      tone:
        liveMarketDataAvailable === false ||
        streamStale ||
        streamReconnecting ||
        streamReconnectNeeded
          ? T.amber
          : streamState === "live" || strictReady === true
            ? T.green
            : T.textDim,
      iconKey: "activity",
    },
    {
      label: "Stream",
      value:
        Number.isFinite(streamGapCount) && streamGapCount > 0
          ? `${Math.round(streamGapCount)} gaps`
          : streamLiveActive
            ? `${formatHeaderCount(streamConsumerCount)} / ${formatHeaderCount(
                streamSymbolCount,
              )}`
          : streamQuoteStandby
            ? "No quote subscribers"
          : streamMarketClosed
            ? "Market closed"
          : streamQuiet
            ? "Quiet stream"
          : streamReconnecting
            ? "Reconnecting"
          : streamReconnectNeeded
            ? "Reconnect"
          : streamStale && Number.isFinite(stream.lastEventAgeMs)
            ? "Silent"
          : "No live stream",
      detail:
        streamStale && Number.isFinite(stream.lastEventAgeMs)
          ? `${formatIbkrPingMs(stream.lastEventAgeMs)} since event`
          : Number.isFinite(totalLatencyP95)
            ? `p95 ${formatIbkrPingMs(totalLatencyP95)}`
            : null,
      tone:
        Number.isFinite(streamGapCount) && streamGapCount > 0
          ? T.amber
          : streamStale || streamReconnecting || streamReconnectNeeded
            ? T.amber
          : streamConfirmedFresh
            ? T.green
            : T.textDim,
      iconKey: "gauge",
    },
  ];

  const accountValue = selectedAccount
    ? `${selectedAccount}${accountCount != null ? ` / ${accountCount}` : ""}`
    : accountCount != null
      ? accountCount
      : MISSING_VALUE;
  const lastErrorRow = normalizeHeaderText(lastError);
  const healthStatusRow =
    actionableBridgeError && healthErrorText && healthErrorText !== actionableBridgeError
      ? healthErrorText
      : null;

  const detailGroups = [
    {
      title: "Connection",
      rows: [
        {
          label: "Bridge HTTP",
          value:
            bridgeReachable == null
              ? runtimeState
              : bridgeReachable
                ? "reachable"
                : "offline",
          tone: bridgeReachable ? T.green : bridgeReachable === false ? T.red : T.textDim,
        },
        {
          label: "Diagnostics",
          value: runtimeState,
          tone: diagnosticsErrorText
            ? T.amber
            : runtimeDiagnostics
              ? T.green
              : T.textDim,
        },
        ...(lastErrorRow
          ? [
              {
                label: "Last error",
                value: lastErrorRow,
                tone: T.red,
                wrap: true,
              },
            ]
          : []),
        ...(healthStatusRow
          ? [
              {
                label: "Health status",
                value: healthStatusRow,
                tone: T.amber,
                wrap: true,
              },
            ]
          : []),
        {
          label: "Health fresh",
          value: formatHeaderBool(healthFresh),
          tone: healthFresh ? T.green : healthFresh === false ? T.amber : T.textDim,
        },
        {
          label: "Strict ready",
          value: formatHeaderBool(strictReady),
          tone: strictReady ? T.green : strictReady === false ? T.amber : T.textDim,
        },
        ...(strictReason
          ? [
              {
                label: "Ready reason",
                value: strictReason,
                tone: T.amber,
              },
            ]
          : []),
        {
          label: "Gateway",
          value: formatHeaderBool(gatewaySocket, "connected", "disconnected"),
          tone: gatewayConnected ? T.green : gatewaySocket === false ? T.red : T.textDim,
        },
        {
          label: "Auth",
          value: formatHeaderBool(authenticated),
          tone: authenticatedReady ? T.green : authenticated === false ? T.amber : T.textDim,
        },
        {
          label: "Competing",
          value: formatHeaderBool(competing),
          tone: competing ? T.red : competing === false ? T.green : T.textDim,
        },
        { label: "Target", value: target },
        { label: "Client ID", value: clientId },
        { label: "Mode", value: sessionMode },
        { label: "Account", value: accountValue },
        { label: "Market data", value: marketDataMode },
        {
          label: "Live data",
          value: formatHeaderBool(liveMarketDataAvailable),
          tone:
            liveMarketDataAvailable === true
              ? T.green
              : liveMarketDataAvailable === false
                ? T.amber
                : T.textDim,
        },
        {
          label: "Orders",
          value: orderDiagnostics,
          tone: orderDiagnostics === "read-only" ? T.green : T.textSec,
        },
        {
          label: "Bridge token",
          value: formatHeaderBool(
            runtime?.bridgeTokenConfigured,
            "configured",
            "missing",
          ),
          tone:
            runtime?.bridgeTokenConfigured === true
              ? T.green
              : runtime?.bridgeTokenConfigured === false
                ? T.amber
                : T.textDim,
        },
        {
          label: "Legacy env",
          value:
            runtime?.legacyIbkrEnvPresent == null
              ? MISSING_VALUE
              : runtime.legacyIbkrEnvPresent
                ? "present"
                : "clear",
          tone:
            runtime?.legacyIbkrEnvPresent
              ? T.amber
              : runtime?.legacyIbkrEnvPresent === false
                ? T.green
                : T.textDim,
        },
      ],
    },
    {
      title: "Stream",
      rows: [
        { label: "Ping", value: formatIbkrPingMs(connection?.lastPingMs) },
        { label: "Consumers", value: formatHeaderCount(streamConsumerCount) },
        { label: "Symbols", value: formatHeaderCount(streamSymbolCount) },
        { label: "Events", value: formatHeaderCount(stream.eventCount) },
        {
          label: "Stream state",
          value: streamQuoteStandby
            ? "no quote-stream subscribers"
            : streamMarketClosed
              ? "market closed"
              : streamLiveActive
                ? "live"
                : streamState || MISSING_VALUE,
          tone:
            streamState === "live"
              ? T.green
              : streamState === "stale" ||
                  streamState === "capacity_limited" ||
                  streamState === "reconnecting" ||
                  streamState === "reconnect_needed"
                ? T.amber
                : T.textDim,
        },
        ...(streamStateReason
          ? [
              {
                label: "State reason",
                value: streamStateReason,
                tone: T.textSec,
              },
            ]
          : []),
        {
          label: "Fresh",
          value: formatHeaderBool(streamFresh),
          tone: streamFresh ? T.green : streamFresh === false ? T.amber : T.textDim,
        },
        {
          label: "Strict age",
          value: Number.isFinite(runtime?.lastStreamEventAgeMs)
            ? `${formatIbkrPingMs(runtime.lastStreamEventAgeMs)} ago`
            : MISSING_VALUE,
          tone:
            Number.isFinite(runtime?.lastStreamEventAgeMs) &&
            runtime.lastStreamEventAgeMs <= 10_000
              ? T.green
              : T.textDim,
        },
        {
          label: "Last event",
          value: Number.isFinite(stream.lastEventAgeMs)
            ? `${formatIbkrPingMs(stream.lastEventAgeMs)} ago`
            : MISSING_VALUE,
        },
        { label: "Reconnects", value: formatHeaderCount(stream.reconnectCount) },
        {
          label: "Gaps",
          value: formatHeaderCount(streamGapCount),
          tone: Number.isFinite(streamGapCount)
            ? streamGapCount > 0
              ? T.amber
              : T.green
            : T.textDim,
        },
        {
          label: "Max gap",
          value: formatIbkrPingMs(stream.maxGapMs),
          tone: stream.maxGapMs > 5_000 ? T.amber : T.textSec,
        },
        {
          label: "Bridge p95",
          value: formatIbkrPingMs(latencyStats?.bridgeToApiMs?.p95),
        },
        {
          label: "React p95",
          value: formatIbkrPingMs(latencyStats?.apiToReactMs?.p95),
        },
      ],
    },
  ];

  return {
    health,
    badges,
    issue,
    tiles,
    detailGroups,
    autoOpenDetails: issue.autoOpenDetails,
  };
};

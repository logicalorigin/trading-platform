import { MISSING_VALUE, T } from "../../lib/uiTokens.jsx";
import {
  formatIbkrPingMs,
  getIbkrGatewayBadges,
  maskIbkrAccountId,
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus.jsx";
import {
  normalizeAdmissionDiagnostics,
  selectRuntimeAdmissionDiagnostics,
} from "./runtimeControlModel.js";
import { canonicalizeStreamState, streamStateTokenVar } from "./streamSemantics";

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
  "healthy",
  "quote_standby",
  "no-subscribers",
  "idle",
  "market_closed",
  "market-closed",
  "quiet",
]);

const CONNECTION_PRIORITY_ISSUES = new Set([
  "misconfigured",
  "competing",
  "offline",
  "login-required",
  "checking",
  "legacy-env",
]);

const STREAM_PRIORITY_ISSUES = new Set([
  "capacity-limited",
  "delayed",
  "market-closed",
  "no-subscribers",
  "quote-stream-reconnecting",
  "quiet",
  "stale",
  "stream-gaps",
]);

const POLYGON_STATUS_META = {
  ok: { label: "OK", tone: T.green },
  degraded: { label: "Degraded", tone: T.amber },
  unconfigured: { label: "Not configured", tone: T.textDim },
  unknown: { label: "No checks yet", tone: T.textSec },
};

const formatHeaderTimeAgo = (value) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 1_000) return "now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / 3_600_000)}h ago`;
};

const buildLineUsageRows = (admission, lineUsageSnapshot) => {
  const normalized = normalizeAdmissionDiagnostics(admission, lineUsageSnapshot);
  return {
    available: normalized.available,
    summary: normalized.summary,
    activeLineCount: normalized.activeLineCount,
    requestedLineCount: normalized.requestedLineCount,
    pendingLineCount: normalized.pendingLineCount,
    requestedSummary: normalized.requestedSummary,
    demandSummary: normalized.demandSummary,
    bridgeSummary: normalized.bridgeSummary,
    warnings: normalized.warnings,
    rows: normalized.rows,
    bridge: normalized.bridge,
    drift: normalized.drift,
    warmup: normalized.warmup,
    allocation: normalized.allocation,
    pressure: normalized.pressure,
  };
};

const buildCompactLineUsage = (lineUsage) => {
  if (!lineUsage?.available) {
    return null;
  }

  const totalRow =
    lineUsage.rows?.find((row) => row.id === "total") ||
    lineUsage.rows?.find((row) => Number.isFinite(row.used));
  const source = totalRow || lineUsage.bridge;
  const used = Number.isFinite(source?.used) ? Math.max(0, source.used) : null;
  const allocation = lineUsage.allocation || {};
  const capSource =
    allocation.targetFillLines ??
    source?.effectiveCap ??
    source?.cap;
  const cap = Number.isFinite(capSource) ? Math.max(0, capSource) : null;
  const freeSource =
    allocation.remainingToTargetLineCount ??
    source?.free ??
    (cap != null && used != null ? cap - used : null);
  const free = Number.isFinite(freeSource) ? Math.max(0, freeSource) : null;
  const percent =
    cap && used != null
      ? Math.max(0, Math.min(100, (used / cap) * 100))
      : 0;
  const state =
    lineUsage.bridge?.streamState ||
    source?.streamState ||
    (free != null && free <= 0 ? "capacity-limited" : "healthy");

  return {
    used,
    cap,
    free,
    percent,
    summary:
      Number.isFinite(used) && Number.isFinite(cap)
        ? `${formatHeaderCount(used)} / ${formatHeaderCount(cap)}`
        : lineUsage.summary,
    tone: source?.tone || streamStateTokenVar(state),
  };
};

const buildProviderRows = ({ health, liveDataLabel, runtimeDiagnostics }) => {
  const polygon = runtimeDiagnostics?.providers?.polygon;
  const polygonMeta =
    POLYGON_STATUS_META[polygon?.status] || POLYGON_STATUS_META.unknown;
  const polygonFreshness =
    formatHeaderTimeAgo(polygon?.lastSuccessAt) ||
    formatHeaderTimeAgo(polygon?.lastFailureAt);
  const polygonDetail =
    polygon?.lastError && polygon?.status === "degraded"
      ? polygon.lastError
      : polygonFreshness
        ? `last ${polygonFreshness}`
        : polygon?.baseUrl || MISSING_VALUE;

  return [
    {
      label: "IBKR",
      value: health.label,
      detail: liveDataLabel,
      tone: health.color,
    },
    {
      label: "Polygon",
      value: polygonMeta.label,
      detail: polygonDetail,
      tone: polygonMeta.tone,
      wrap: polygon?.status === "degraded",
    },
  ];
};

const getIssueSeverity = (issue) => {
  if (!issue || issue.key === "healthy" || issue.iconKey !== "alert") {
    return "healthy";
  }
  if (
    issue.key === "stream-gaps" ||
    issue.key === "quote-stream-reconnecting" ||
    issue.key === "legacy-env"
  ) {
    return "warning";
  }
  return "error";
};

const getPriorityDetailGroup = ({ issue, healthStatus, streamStateReason }) => {
  if (!issue || issue.severity === "healthy") {
    return null;
  }
  if (
    issue.key === "reconnecting" &&
    /^gateway_/.test(String(streamStateReason || ""))
  ) {
    return "connection";
  }
  if (CONNECTION_PRIORITY_ISSUES.has(issue.key) || CONNECTION_PRIORITY_ISSUES.has(healthStatus)) {
    return "connection";
  }
  if (STREAM_PRIORITY_ISSUES.has(issue.key) || STREAM_PRIORITY_ISSUES.has(healthStatus)) {
    return "stream";
  }
  if (issue.key === "reconnecting") {
    return "stream";
  }
  return null;
};

export const buildHeaderIbkrPopoverModel = ({
  connection,
  latencyStats,
  runtimeDiagnostics,
  runtimeError,
  lineUsage: normalizedLineUsage,
  lineUsageSnapshot,
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
        brokerServerConnected: runtime.brokerServerConnected,
        serverConnectivity: runtime.serverConnectivity,
        lastServerConnectivityAt: runtime.lastServerConnectivityAt,
        lastServerConnectivityError: runtime.lastServerConnectivityError,
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
  const gatewaySocket = headerDetailValue(
    runtime?.socketConnected,
    connection?.socketConnected,
    connection?.reachable,
    runtime?.connected,
  );
  const brokerServerConnected = headerDetailValue(
    runtime?.brokerServerConnected,
    connection?.brokerServerConnected,
    gatewaySocket === true ? true : undefined,
  );
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
  const bridgeReachable = headerDetailValue(
    runtime?.bridgeReachable,
    runtime?.reachable,
    connection?.bridgeReachable,
  );
  const bridgeNotReachable = bridgeReachable === false;
  const actionableBridgeError =
    governorLastFailure && (bridgeNotReachable || healthBackoff)
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
  const gatewayConnected =
    gatewaySocket === true && brokerServerConnected !== false;
  const authenticatedReady = authenticated === true;
  const streamConsumerCount = stream.activeConsumerCount;
  const streamSymbolCount = stream.unionSymbolCount;
  const streamGapCount = stream.dataGapCount ?? stream.streamGapCount;
  const recentStreamGapCount =
    stream.recentDataGapCount ?? stream.recentGapCount ?? streamGapCount;
  const streamFreshAgeMs =
    stream.transportFreshnessAgeMs ??
    stream.freshnessAgeMs ??
    stream.lastEventAgeMs;
  const streamActive =
    Number.isFinite(streamConsumerCount) && streamConsumerCount > 0;
  const streamFreshByCounters =
    streamActive &&
    Number.isFinite(streamFreshAgeMs) &&
    streamFreshAgeMs <= 10_000;
  const canonicalStreamState = canonicalizeStreamState(streamState, "offline");
  const streamQuoteStandby =
    canonicalStreamState === "quiet" &&
    streamStateReason === NO_ACTIVE_QUOTE_CONSUMERS_REASON &&
    !streamActive;
  const streamMarketClosed =
    canonicalStreamState === "quiet" && streamStateReason === MARKET_SESSION_QUIET_REASON;
  const streamQuiet =
    canonicalStreamState === "quiet" && !streamQuoteStandby && !streamMarketClosed;
  const streamCapacityLimited = canonicalStreamState === "capacity-limited";
  const streamReconnecting = canonicalStreamState === "reconnecting";
  const streamChecking = canonicalStreamState === "checking";
  const streamStale =
    canonicalStreamState === "stale" ||
    streamCapacityLimited ||
    (!streamState && streamFresh === false) ||
    (streamActive &&
      Number.isFinite(streamFreshAgeMs) &&
      streamFreshAgeMs > 10_000);
  const streamConfirmedFresh =
    canonicalStreamState === "healthy" ||
    strictReady === true ||
    streamFresh === true ||
    streamFreshByCounters;
  const streamLiveActive =
    canonicalStreamState === "healthy" ||
    streamFreshByCounters ||
    (streamActive && streamFresh === true);
  const streamCountAvailable =
    Number.isFinite(streamConsumerCount) &&
    Number.isFinite(streamSymbolCount) &&
    (streamConsumerCount > 0 || streamSymbolCount > 0);
  const streamLiveValue = streamCountAvailable
    ? `${formatHeaderCount(streamConsumerCount)} / ${formatHeaderCount(
        streamSymbolCount,
      )}`
    : "Live";
  if (canonicalizeStreamState(health.status, "offline") === "no-subscribers" && streamLiveActive) {
    health = {
      status: "healthy",
      label: "Ready",
      color: streamStateTokenVar("healthy"),
      detail: "Gateway is authenticated and live stream events are current",
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
  const providerRows = buildProviderRows({
    health,
    liveDataLabel,
    runtimeDiagnostics,
  });
  const lineUsage =
    normalizedLineUsage ||
    buildLineUsageRows(
      selectRuntimeAdmissionDiagnostics({ runtimeDiagnostics, lineUsageSnapshot }),
      lineUsageSnapshot,
    );
  const compactLineUsage = buildCompactLineUsage(lineUsage);

  const healthyStatus = HEALTHY_STATUS_KEYS.has(health.status);
  let issue = {
    key: healthyStatus ? health.status : "healthy",
    label: canonicalizeStreamState(health.status, "offline") === "healthy"
      ? "Gateway ready for live data."
      : health.detail,
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
  } else if (Number.isFinite(recentStreamGapCount) && recentStreamGapCount > 0) {
    issue = {
      key: "stream-gaps",
      label: `${Math.round(recentStreamGapCount)} quote data gap${
        Math.round(recentStreamGapCount) === 1 ? "" : "s"
      } detected recently. Open Diagnostics for the full stream trace.`,
      tone: T.amber,
      iconKey: "alert",
      autoOpenDetails: false,
    };
  } else if (streamReconnecting && streamActive && streamFresh !== true) {
    issue = {
      key: "quote-stream-reconnecting",
      label: "Gateway is connected, but the quote stream is reconnecting and has not delivered fresh quotes.",
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
  issue = {
    ...issue,
    severity: getIssueSeverity(issue),
  };
  const priorityDetailGroup = getPriorityDetailGroup({
    issue,
    healthStatus: health.status,
    streamStateReason,
  });

  const tiles = [
    {
      label: "Gateway",
      value:
        gatewaySocket == null
          ? runtimeState
          : brokerServerConnected === false
            ? "Server offline"
          : gatewayConnected
            ? "Connected"
            : "Offline",
      tone:
        gatewayConnected
          ? T.green
          : gatewaySocket === false
            ? T.red
            : brokerServerConnected === false
              ? T.amber
              : T.textDim,
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
          : liveMarketDataAvailable === true ||
              marketDataMode === "live" ||
              strictReady === true
            ? "Live mode"
            : liveDataLabel,
      tone:
        liveMarketDataAvailable === false
          ? streamStateTokenVar("delayed")
          : liveMarketDataAvailable === true ||
              marketDataMode === "live" ||
              strictReady === true
            ? streamStateTokenVar("healthy")
            : T.textDim,
      iconKey: "activity",
    },
    {
      label: "Stream",
      value:
        Number.isFinite(streamGapCount) && streamGapCount > 0
          ? `${Math.round(streamGapCount)} gaps`
          : streamLiveActive
            ? streamLiveValue
          : streamQuoteStandby
            ? "Standby"
          : streamMarketClosed
            ? "Market closed"
          : streamQuiet
            ? "Quiet stream"
          : streamChecking
            ? "Starting"
          : streamReconnecting
            ? "Reconnecting"
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
          ? streamStateTokenVar("stale")
          : streamStale || streamReconnecting
            ? streamStateTokenVar("stale")
          : streamChecking
            ? streamStateTokenVar("checking")
          : streamConfirmedFresh
            ? streamStateTokenVar("healthy")
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
          label: "Health current",
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
          label: "IBKR server",
          value: formatHeaderBool(
            brokerServerConnected,
            "connected",
            "disconnected",
          ),
          tone:
            brokerServerConnected
              ? T.green
              : brokerServerConnected === false
                ? T.amber
                : T.textDim,
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
        ...providerRows
          .filter((row) => row.label === "Polygon")
          .map((row) => ({
            label: row.label,
            value: row.detail ? `${row.value} · ${row.detail}` : row.value,
            tone: row.tone,
            wrap: row.wrap,
          })),
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
            ? "standby"
            : streamMarketClosed
              ? "market closed"
              : streamLiveActive
                ? "live"
                : canonicalStreamState || MISSING_VALUE,
          tone: streamStateTokenVar(canonicalStreamState),
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
          label: "Current",
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
          label: "Last quote event",
          value: Number.isFinite(stream.lastEventAgeMs)
            ? `${formatIbkrPingMs(stream.lastEventAgeMs)} ago`
            : MISSING_VALUE,
        },
        { label: "Reconnects", value: formatHeaderCount(stream.reconnectCount) },
        {
          label: "Data gaps",
          value: formatHeaderCount(streamGapCount),
          tone: Number.isFinite(streamGapCount)
            ? recentStreamGapCount > 0
              ? T.amber
              : T.green
            : T.textDim,
        },
        {
          label: "Max data gap",
          value: formatIbkrPingMs(stream.maxDataGapMs ?? stream.maxGapMs),
          tone:
            (stream.maxDataGapMs ?? stream.maxGapMs) > 5_000
              ? T.amber
              : T.textSec,
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
    providerRows,
    lineUsage,
    compactLineUsage,
    detailGroups,
    priorityDetailGroup,
    autoOpenDetails: issue.autoOpenDetails,
  };
};

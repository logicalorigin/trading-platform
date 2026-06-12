import { CSS_COLOR, MISSING_VALUE, T } from "../../lib/uiTokens.jsx";
import {
  formatIbkrPingMs,
  getIbkrGatewayBadges,
  maskIbkrAccountId,
  resolveIbkrGatewayHealth,
} from "./IbkrConnectionStatus.jsx";
import {
  normalizeMassiveRuntimeDiagnostics,
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

const MASSIVE_STATUS_META = {
  ok: { label: "OK", tone: CSS_COLOR.green },
  degraded: { label: "Degraded", tone: CSS_COLOR.amber },
  unconfigured: { label: "Not configured", tone: CSS_COLOR.textDim },
  unknown: { label: "No checks yet", tone: CSS_COLOR.textSec },
};

const resolveStockProviderLabel = (provider) => {
  const identity = String(provider?.provider || provider?.identity || "").toLowerCase();
  const baseUrl = String(provider?.baseUrl || "").toLowerCase();
  return identity === "massive" || baseUrl.includes("massive.com") ? "Massive" : "Massive";
};

const getProviderStatusIconKey = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "ok":
    case "healthy":
      return "check";
    case "degraded":
      return "alert";
    case "unconfigured":
      return "unplug";
    default:
      return "activity";
  }
};

const formatMassiveEndpointLabel = (request, fallback = MISSING_VALUE) => {
  if (!request || typeof request !== "object") {
    return fallback;
  }
  const source = request.endpointFamily || request.purpose || request.endpoint || "";
  const label = String(source).replace(/[-_]+/g, " ").trim();
  return label || fallback;
};

const pushMassiveChip = (chips, chip) => {
  if (chip?.label && chip.label !== MISSING_VALUE) {
    chips.push(chip);
  }
};

const buildMassiveProviderDetail = (massive, fallback) => {
  if (!massive?.configured) {
    return fallback;
  }
  if (massive.websocket?.lastError) {
    return massive.websocket.lastError;
  }
  if (massive.rest?.lastError && massive.rest.status === "degraded") {
    return massive.rest.lastError;
  }
  const channels = massive.websocket?.activeChannels || [];
  const restEndpoint = formatMassiveEndpointLabel(
    massive.rest?.lastRequest,
    massive.rest?.lastRequestSummary,
  );
  if (channels.length > 0) {
    const symbolCount = Number.isFinite(massive.websocket.subscribedSymbolCount)
      ? ` · ${formatHeaderCount(massive.websocket.subscribedSymbolCount)} symbols`
      : "";
    const age = Number.isFinite(massive.websocket.lastMessageAgeMs)
      ? ` · ${formatIbkrPingMs(massive.websocket.lastMessageAgeMs)} ago`
      : "";
    const rest = restEndpoint && restEndpoint !== MISSING_VALUE
      ? `REST ${restEndpoint} · `
      : "";
    return `${rest}WS ${channels.join(", ")}${symbolCount}${age}`;
  }
  if (massive.rest?.lastRequestSummary && massive.rest.lastRequestSummary !== MISSING_VALUE) {
    const duration = Number.isFinite(massive.rest.lastDurationMs)
      ? ` · ${formatIbkrPingMs(massive.rest.lastDurationMs)}`
      : "";
    return `REST ${massive.rest.lastRequestSummary}${duration}`;
  }
  if (massive.websocket?.channelSummary && massive.websocket.channelSummary !== MISSING_VALUE) {
    return `WS ${massive.websocket.channelSummary}`;
  }
  return fallback && fallback !== MISSING_VALUE
    ? fallback
    : massive.baseUrlHost || fallback;
};

const buildMassiveProviderSummary = (massive) => {
  if (!massive?.configured) {
    return null;
  }
  const restRequest = massive.rest?.lastRequest || null;
  const restEndpoint = formatMassiveEndpointLabel(restRequest, massive.rest?.label || "REST idle");
  const restSummary =
    massive.rest?.lastRequestSummary && massive.rest.lastRequestSummary !== MISSING_VALUE
      ? massive.rest.lastRequestSummary
      : massive.rest?.label || "REST idle";
  const restChips = [];
  pushMassiveChip(restChips, restRequest?.symbol
    ? {
        iconKey: "hash",
        label: restRequest.symbol,
        title: "Symbol",
      }
    : Number.isFinite(restRequest?.symbolCount)
      ? {
          iconKey: "hash",
          label: `${formatHeaderCount(restRequest.symbolCount)} sym`,
          title: "Symbols in request",
        }
      : null);
  pushMassiveChip(restChips, Number.isFinite(restRequest?.resultCount)
    ? {
        iconKey: "database",
        label: `${formatHeaderCount(restRequest.resultCount)} rows`,
        title: "Rows returned",
      }
    : null);
  pushMassiveChip(restChips, Number.isFinite(massive.rest?.lastDurationMs)
    ? {
        iconKey: "timer",
        label: formatIbkrPingMs(massive.rest.lastDurationMs),
        title: "REST duration",
      }
    : null);
  pushMassiveChip(restChips, massive.rest?.lastRequestAt
    ? {
        iconKey: "clock",
        label: formatHeaderTimeAgo(massive.rest.lastRequestAt),
        title: "Last REST observation",
      }
    : null);

  const wsChannels = massive.websocket?.activeChannels?.length
    ? massive.websocket.activeChannels.join(", ")
    : massive.websocket?.availableChannels?.length
      ? `${massive.websocket.availableChannels.join(", ")} idle`
      : "standby";
  const activeChannelSet = new Set(massive.websocket?.activeChannels || []);
  const channelChips = [
    ...(massive.websocket?.activeChannels || []),
    ...(massive.websocket?.availableChannels || []).filter((channel) => !activeChannelSet.has(channel)),
  ].map((channel) => ({
    label: channel,
    active: activeChannelSet.has(channel),
    title: activeChannelSet.has(channel)
      ? `Subscribed ${channel} WebSocket channel`
      : `Available ${channel} WebSocket channel`,
  }));
  const wsChips = [];
  pushMassiveChip(wsChips, massive.websocket?.mode
    ? {
        iconKey: "wifi",
        label: massive.websocket.mode,
        title: "WebSocket mode",
      }
    : null);
  pushMassiveChip(wsChips, Number.isFinite(massive.websocket?.subscribedSymbolCount)
    ? {
        iconKey: "hash",
        label: `${formatHeaderCount(massive.websocket.subscribedSymbolCount)} sym`,
        title: "Subscribed symbols",
      }
    : null);
  pushMassiveChip(wsChips, Number.isFinite(massive.websocket?.eventCount)
    ? {
        iconKey: "activity",
        label: `${formatHeaderCount(massive.websocket.eventCount)} ev`,
        title: "Stream events",
      }
    : null);
  pushMassiveChip(wsChips, Number.isFinite(massive.websocket?.lastMessageAgeMs)
    ? {
        iconKey: "clock",
        label: `${formatIbkrPingMs(massive.websocket.lastMessageAgeMs)} ago`,
        title: "Last WebSocket message",
      }
    : null);
  pushMassiveChip(wsChips, Number.isFinite(massive.websocket?.reconnectCount) && massive.websocket.reconnectCount > 0
    ? {
        iconKey: "alert",
        label: `${formatHeaderCount(massive.websocket.reconnectCount)} reconnects`,
        tone: CSS_COLOR.amber,
        title: "WebSocket reconnects",
      }
    : null);

  return [
    {
      id: "rest",
      label: "REST",
      iconKey: "database",
      statusIconKey: getProviderStatusIconKey(massive.rest?.status),
      value: restEndpoint,
      detail: restSummary !== restEndpoint ? restSummary : null,
      tone: massive.rest?.tone || massive.tone,
      chips: restChips,
    },
    {
      id: "websocket",
      label: "WebSocket",
      iconKey: "websocket",
      statusIconKey: getProviderStatusIconKey(massive.websocket?.status),
      value: wsChannels,
      detail: massive.websocket?.lastError || null,
      tone: massive.websocket?.tone || massive.tone,
      channels: channelChips,
      chips: wsChips,
    },
  ];
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
    foregroundPendingLineCount: normalized.foregroundPendingLineCount,
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
  const targetFillLines = Number.isFinite(allocation.targetFillLines)
    ? Math.max(0, allocation.targetFillLines)
    : null;
  const remainingToTargetLineCount = Number.isFinite(
    allocation.remainingToTargetLineCount,
  )
    ? Math.max(0, allocation.remainingToTargetLineCount)
    : null;
  const capSource =
    source?.effectiveCap ??
    source?.cap ??
    lineUsage.bridge?.cap ??
    allocation.bridgeLineBudget ??
    targetFillLines;
  const cap = Number.isFinite(capSource) ? Math.max(0, capSource) : null;
  const computedFree = cap != null && used != null ? cap - used : null;
  const freeSource =
    source?.free ??
    computedFree ??
    remainingToTargetLineCount;
  const free = Number.isFinite(freeSource) ? Math.max(0, freeSource) : null;
  const reserveLineCount =
    Number.isFinite(cap) &&
    Number.isFinite(targetFillLines) &&
    cap > targetFillLines
      ? cap - targetFillLines
      : null;
  const tradeOptionsChainReserveLineCount = Number.isFinite(
    allocation.tradeOptionsChainReserveLineCount,
  )
    ? Math.max(0, allocation.tradeOptionsChainReserveLineCount)
    : null;
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
    targetFillLines,
    remainingToTargetLineCount,
    reserveLineCount,
    tradeOptionsChainReserveLineCount,
    summary:
      Number.isFinite(used) && Number.isFinite(cap)
        ? `${formatHeaderCount(used)} of ${formatHeaderCount(cap)}`
        : lineUsage.summary,
    tone: source?.tone || streamStateTokenVar(state),
  };
};

const buildProviderRows = ({
  health,
  liveDataLabel,
  runtimeDiagnostics,
  lineUsageSnapshot,
}) => {
  const massive = normalizeMassiveRuntimeDiagnostics(
    runtimeDiagnostics,
    lineUsageSnapshot,
  );
  const hasMassiveProvider =
    massive.configured || massive.providerIdentity === "massive";
  const stockProviderLabel = hasMassiveProvider ? "Massive" : null;
  const massiveMeta =
    MASSIVE_STATUS_META[massive?.status] || MASSIVE_STATUS_META.unknown;
  const massiveFreshness =
    formatHeaderTimeAgo(massive?.lastSuccessAt) ||
    formatHeaderTimeAgo(massive?.lastFailureAt);
  const massiveDetail =
    massive?.lastError && massive?.status === "degraded"
      ? massive.lastError
      : massiveFreshness
        ? `last ${massiveFreshness}`
        : massive?.baseUrl || MISSING_VALUE;

  const rows = [
    {
      label: "IBKR",
      value: health.label,
      detail: liveDataLabel,
      tone: health.color,
    },
  ];

  if (!stockProviderLabel) {
    return rows;
  }

  rows.push(
    {
      label: stockProviderLabel,
      value: stockProviderLabel === "Massive" ? massive.label : massiveMeta.label,
      detail:
        stockProviderLabel === "Massive"
          ? buildMassiveProviderDetail(massive, massiveDetail)
          : massiveDetail,
      tone: stockProviderLabel === "Massive" ? massive.tone : massiveMeta.tone,
      iconKey: stockProviderLabel === "Massive" ? "network" : null,
      statusIconKey:
        stockProviderLabel === "Massive"
          ? getProviderStatusIconKey(massive.status)
          : getProviderStatusIconKey(massive?.status),
      host:
        stockProviderLabel === "Massive"
          ? massive.baseUrlHost
          : null,
      summary:
        stockProviderLabel === "Massive"
          ? buildMassiveProviderSummary(massive)
          : null,
      wrap:
        stockProviderLabel === "Massive"
          ? massive.status === "degraded"
          : massive?.status === "degraded",
    },
  );

  return rows;
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

const buildHeaderIbkrDetailConnection = ({ connection, runtime }) =>
  runtime
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

const buildHeaderIbkrIssue = ({
  connection,
  health,
  runtime,
  runtimeError,
  recentStreamGapCount,
  streamActive = false,
  streamFresh,
  streamReconnecting = false,
}) => {
  const healthyStatus = HEALTHY_STATUS_KEYS.has(health.status);
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
  let issue = {
    key: healthyStatus ? health.status : "healthy",
    label: canonicalizeStreamState(health.status, "offline") === "healthy"
      ? "Gateway ready for live data."
      : health.detail,
    tone: healthyStatus ? CSS_COLOR.textSec : health.color,
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
      tone: CSS_COLOR.amber,
      iconKey: "alert",
      autoOpenDetails: false,
    };
  } else if (streamReconnecting && streamActive && streamFresh !== true) {
    issue = {
      key: "quote-stream-reconnecting",
      label: "Gateway is connected, but the quote stream is reconnecting and has not delivered fresh quotes.",
      tone: CSS_COLOR.amber,
      iconKey: "alert",
      autoOpenDetails: false,
    };
  } else if (runtime?.legacyIbkrEnvPresent) {
    issue = {
      key: "legacy-env",
      label: "Legacy IBKR env vars are present; review details or Diagnostics.",
      tone: CSS_COLOR.amber,
      iconKey: "alert",
      autoOpenDetails: true,
    };
  } else if (diagnosticsErrorText && !runtime) {
    issue = {
      key: "diagnostics-unavailable",
      label: diagnosticsErrorText,
      tone: CSS_COLOR.amber,
      iconKey: "alert",
      autoOpenDetails: false,
    };
  }

  return {
    ...issue,
    severity: getIssueSeverity(issue),
  };
};

export const buildHeaderIbkrTriggerModel = ({
  connection,
  runtimeDiagnostics,
  runtimeError,
  lineUsageSnapshot = null,
}) => {
  const runtime = runtimeDiagnostics?.ibkr;
  const detailConnection = buildHeaderIbkrDetailConnection({
    connection,
    runtime,
  });
  const health = resolveIbkrGatewayHealth({
    connection: detailConnection,
    runtime,
  });
  const issue = buildHeaderIbkrIssue({
    connection,
    health,
    runtime,
    runtimeError,
  });
  const streamStateReason = headerDetailValue(
    runtime?.streamStateReason,
    connection?.streamStateReason,
  );
  const lineUsage = lineUsageSnapshot
    ? buildLineUsageRows(
        selectRuntimeAdmissionDiagnostics({ runtimeDiagnostics, lineUsageSnapshot }),
        lineUsageSnapshot,
      )
    : null;
  const compactLineUsage = buildCompactLineUsage(lineUsage);

  return {
    health,
    badges: [],
    issue,
    tiles: [],
    providerRows: [],
    lineUsage,
    compactLineUsage,
    // Massive provider status comes from runtimeDiagnostics (polled every ~5s
    // regardless of popover state), not from line usage. Keep it populated in the
    // trigger model so the always-visible footer shows live provider status
    // instead of "No checks yet" while the popover is closed.
    massive: normalizeMassiveRuntimeDiagnostics(runtimeDiagnostics),
    detailGroups: [],
    priorityDetailGroup: getPriorityDetailGroup({
      issue,
      healthStatus: health.status,
      streamStateReason,
    }),
    autoOpenDetails: issue.autoOpenDetails,
  };
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
  const detailConnection = buildHeaderIbkrDetailConnection({
    connection,
    runtime,
  });
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
    lineUsageSnapshot,
  });
  const lineUsage =
    normalizedLineUsage ||
    buildLineUsageRows(
      selectRuntimeAdmissionDiagnostics({ runtimeDiagnostics, lineUsageSnapshot }),
      lineUsageSnapshot,
    );
  const compactLineUsage = buildCompactLineUsage(lineUsage);
  const massive = normalizeMassiveRuntimeDiagnostics(
    runtimeDiagnostics,
    lineUsageSnapshot,
  );

  const issue = buildHeaderIbkrIssue({
    connection,
    health,
    runtime,
    runtimeError,
    recentStreamGapCount,
    streamActive,
    streamFresh,
    streamReconnecting,
  });
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
          ? CSS_COLOR.green
          : gatewaySocket === false
            ? CSS_COLOR.red
            : brokerServerConnected === false
              ? CSS_COLOR.amber
              : CSS_COLOR.textDim,
      iconKey: "gateway",
    },
    {
      label: "Auth",
      value:
        authenticated == null
          ? MISSING_VALUE
          : authenticatedReady
            ? "Yes"
            : "No",
      tone: authenticatedReady ? CSS_COLOR.green : authenticated === false ? CSS_COLOR.amber : CSS_COLOR.textDim,
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
            : CSS_COLOR.textDim,
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
            : CSS_COLOR.textDim,
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
          tone: bridgeReachable ? CSS_COLOR.green : bridgeReachable === false ? CSS_COLOR.red : CSS_COLOR.textDim,
        },
        {
          label: "Diagnostics",
          value: runtimeState,
          tone: diagnosticsErrorText
            ? CSS_COLOR.amber
            : runtimeDiagnostics
              ? CSS_COLOR.green
              : CSS_COLOR.textDim,
        },
        ...(lastErrorRow
          ? [
              {
                label: "Last error",
                value: lastErrorRow,
                tone: CSS_COLOR.red,
                wrap: true,
              },
            ]
          : []),
        ...(healthStatusRow
          ? [
              {
                label: "Health status",
                value: healthStatusRow,
                tone: CSS_COLOR.amber,
                wrap: true,
              },
            ]
          : []),
        {
          label: "Health current",
          value: formatHeaderBool(healthFresh),
          tone: healthFresh ? CSS_COLOR.green : healthFresh === false ? CSS_COLOR.amber : CSS_COLOR.textDim,
        },
        {
          label: "Strict ready",
          value: formatHeaderBool(strictReady),
          tone: strictReady ? CSS_COLOR.green : strictReady === false ? CSS_COLOR.amber : CSS_COLOR.textDim,
        },
        ...(strictReason
          ? [
              {
                label: "Ready reason",
                value: strictReason,
                tone: CSS_COLOR.amber,
              },
            ]
          : []),
        {
          label: "Gateway",
          value: formatHeaderBool(gatewaySocket, "connected", "disconnected"),
          tone: gatewayConnected ? CSS_COLOR.green : gatewaySocket === false ? CSS_COLOR.red : CSS_COLOR.textDim,
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
              ? CSS_COLOR.green
              : brokerServerConnected === false
                ? CSS_COLOR.amber
                : CSS_COLOR.textDim,
        },
        {
          label: "Auth",
          value: formatHeaderBool(authenticated),
          tone: authenticatedReady ? CSS_COLOR.green : authenticated === false ? CSS_COLOR.amber : CSS_COLOR.textDim,
        },
        {
          label: "Competing",
          value: formatHeaderBool(competing),
          tone: competing ? CSS_COLOR.red : competing === false ? CSS_COLOR.green : CSS_COLOR.textDim,
        },
        { label: "Target", value: target },
        { label: "Client ID", value: clientId },
        { label: "Mode", value: sessionMode },
        { label: "Account", value: accountValue },
        { label: "Market data", value: marketDataMode },
        ...providerRows
          .filter((row) => row.label !== "IBKR")
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
              ? CSS_COLOR.green
              : liveMarketDataAvailable === false
                ? CSS_COLOR.amber
                : CSS_COLOR.textDim,
        },
        {
          label: "Orders",
          value: orderDiagnostics,
          tone: orderDiagnostics === "read-only" ? CSS_COLOR.green : CSS_COLOR.textSec,
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
              ? CSS_COLOR.green
              : runtime?.bridgeTokenConfigured === false
                ? CSS_COLOR.amber
                : CSS_COLOR.textDim,
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
              ? CSS_COLOR.amber
              : runtime?.legacyIbkrEnvPresent === false
                ? CSS_COLOR.green
                : CSS_COLOR.textDim,
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
                tone: CSS_COLOR.textSec,
              },
            ]
          : []),
        {
          label: "Current",
          value: formatHeaderBool(streamFresh),
          tone: streamFresh ? CSS_COLOR.green : streamFresh === false ? CSS_COLOR.amber : CSS_COLOR.textDim,
        },
        {
          label: "Strict age",
          value: Number.isFinite(runtime?.lastStreamEventAgeMs)
            ? `${formatIbkrPingMs(runtime.lastStreamEventAgeMs)} ago`
            : MISSING_VALUE,
          tone:
            Number.isFinite(runtime?.lastStreamEventAgeMs) &&
            runtime.lastStreamEventAgeMs <= 10_000
              ? CSS_COLOR.green
              : CSS_COLOR.textDim,
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
              ? CSS_COLOR.amber
              : CSS_COLOR.green
            : CSS_COLOR.textDim,
        },
        {
          label: "Max data gap",
          value: formatIbkrPingMs(stream.maxDataGapMs ?? stream.maxGapMs),
          tone:
            (stream.maxDataGapMs ?? stream.maxGapMs) > 5_000
              ? CSS_COLOR.amber
              : CSS_COLOR.textSec,
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

  if (massive.configured || massive.providerIdentity === "massive") {
    detailGroups.splice(1, 0, {
      title: "Massive",
      rows: [
        {
          label: "Status",
          value: massive.label,
          tone: massive.tone,
        },
        {
          label: "Mode",
          value: massive.websocket.mode || (massive.stocksRealtimeConfigured ? "real-time" : "delayed"),
        },
        {
          label: "REST",
          value:
            massive.rest.lastRequestSummary && massive.rest.lastRequestSummary !== MISSING_VALUE
              ? massive.rest.lastRequestSummary
              : massive.rest.label,
          tone: massive.rest.tone,
          wrap: true,
        },
        {
          label: "REST result",
          value: massive.rest.lastRequest
            ? `${formatHeaderCount(massive.rest.lastRequest.resultCount)} rows · ${formatIbkrPingMs(massive.rest.lastDurationMs)}`
            : MISSING_VALUE,
        },
        {
          label: "WebSocket",
          value: massive.websocket.channelSummary,
          tone: massive.websocket.tone,
        },
        {
          label: "WS symbols",
          value: formatHeaderCount(massive.websocket.subscribedSymbolCount),
        },
        {
          label: "WS events",
          value: formatHeaderCount(massive.websocket.eventCount),
        },
        {
          label: "WS last",
          value: Number.isFinite(massive.websocket.lastMessageAgeMs)
            ? `${formatIbkrPingMs(massive.websocket.lastMessageAgeMs)} ago`
            : MISSING_VALUE,
        },
        ...(massive.rest.lastError || massive.websocket.lastError
          ? [
              {
                label: "Last error",
                value: massive.rest.lastError || massive.websocket.lastError,
                tone: CSS_COLOR.red,
                wrap: true,
              },
            ]
          : []),
      ],
    });
  }

  return {
    health,
    badges,
    issue,
    tiles,
    providerRows,
    lineUsage,
    compactLineUsage,
    massive,
    detailGroups,
    priorityDetailGroup,
    autoOpenDetails: issue.autoOpenDetails,
  };
};

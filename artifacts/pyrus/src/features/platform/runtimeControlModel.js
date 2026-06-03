import { MISSING_VALUE } from "../../lib/uiTokens.jsx";
import { streamStateTokenVar } from "./streamSemantics";

export const RUNTIME_CONTROL_SCHEMA_VERSION = 1;
export const DEFAULT_ACCOUNT_MONITOR_LINE_CAP = 30;

const POOL_ORDER = [
  ["automation", "Algo & Execution"],
  ["account-monitor", "Account"],
  ["visible", "Visible Options"],
  ["flow-scanner", "Flow Scanner"],
];

const NON_BLOCKING_FLOW_SCANNER_RADAR_REASONS = new Set([
  "radar-quote-batch-fallback",
  "radar-quote-batch-fallback-empty",
]);

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
};

const recordOrEmpty = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const arrayOrEmpty = (value) => (Array.isArray(value) ? value : []);

const hostFromUrl = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  try {
    return new URL(text).host || null;
  } catch {
    return null;
  }
};

const formatRuntimeDuration = (durationMs) => {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  if (ms < 60_000) {
    return `${Math.ceil(ms / 1_000)}s`;
  }
  return `${Math.ceil(ms / 60_000)}m`;
};

const formatRuntimeQuantity = (count, singular, plural = `${singular}s`) => {
  const rounded = Math.round(count);
  return `${rounded} ${rounded === 1 ? singular : plural}`;
};

const formatScannerReason = (reason) => {
  if (!reason) {
    return null;
  }
  if (reason === "line-cap-exhausted") {
    return "no scanner lines available";
  }
  if (reason === "resource-pressure") {
    return "resource pressure";
  }
  if (reason === "live-warmup") {
    return "live data warming";
  }
  if (reason === "market-session-quiet") {
    return "market session quiet";
  }
  if (reason === "transport-unavailable") {
    return "transport unavailable";
  }
  if (reason === "market-data-not-live") {
    return "market data not live";
  }
  if (reason === "market-data-frozen") {
    return "market data frozen";
  }
  if (reason === "market-data-delayed-frozen") {
    return "delayed frozen market data";
  }
  return String(reason).replace(/[-_]+/g, " ");
};

const formatFlowSnapshotCount = (snapshotCount) =>
  formatRuntimeQuantity(snapshotCount, "cached flow snapshot");

const formatFlowScannerCoverageDetail = (coverage) => {
  if (!coverage || typeof coverage !== "object") {
    return null;
  }
  const scanned = firstFiniteNumber(
    coverage.cycleScannedSymbols,
    coverage.scannedSymbols,
  );
  const total = firstFiniteNumber(
    coverage.activeTargetSize,
    coverage.selectedSymbols,
    coverage.targetSize,
    coverage.totalSymbols,
  );
  if (!Number.isFinite(scanned) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  const age = formatRuntimeDuration(coverage.lastScanAgeMs);
  return `${Math.round(scanned)} of ${Math.round(total)} covered${age ? `, last ${age} ago` : ""}`;
};

const resolveFlowScannerCoverage = (scanner) => {
  if (!scanner || typeof scanner !== "object") {
    return null;
  }
  const coverage = recordOrEmpty(scanner.coverage);
  const radar = recordOrEmpty(scanner.radar);
  const plannedHorizon = recordOrEmpty(scanner.plannedHorizon);
  return {
    coverageHealth:
      coverage.coverageHealth || scanner.coverageHealth || radar.coverageHealth || null,
    cycleScannedSymbols: firstFiniteNumber(
      coverage.cycleScannedSymbols,
      coverage.scannedSymbols,
      radar.cycleScannedSymbols,
      radar.scannedSymbols,
    ),
    activeTargetSize: firstFiniteNumber(
      coverage.activeTargetSize,
      coverage.selectedSymbols,
      coverage.targetSize,
      coverage.totalSymbols,
      radar.selectedSymbols,
      scanner.radarSelectedSymbols,
      plannedHorizon.symbolCount,
    ),
    lastScanAgeMs: firstFiniteNumber(
      coverage.lastScanAgeMs,
      radar.lastScanAgeMs,
      scanner.lastScanAgeMs,
    ),
  };
};

const formatScannerSymbolList = (symbols) => {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return null;
  }
  const normalized = symbols.map((symbol) => String(symbol).trim()).filter(Boolean);
  if (!normalized.length) {
    return null;
  }
  const visible = normalized.slice(0, 3);
  const remaining = normalized.length - visible.length;
  return `${visible.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`;
};

const normalizeProviderStatus = (status) => {
  const normalized = String(status || "").toLowerCase();
  if (["ok", "healthy", "ready"].includes(normalized)) return "ok";
  if (["degraded", "error", "failed"].includes(normalized)) return "degraded";
  if (["unconfigured", "missing"].includes(normalized)) return "unconfigured";
  if (["idle", "unknown"].includes(normalized)) return normalized;
  return "unknown";
};

const providerStatusLabel = (status) => {
  switch (normalizeProviderStatus(status)) {
    case "ok":
      return "OK";
    case "degraded":
      return "Degraded";
    case "unconfigured":
      return "Not configured";
    case "idle":
      return "Idle";
    default:
      return "No checks yet";
  }
};

const providerStatusTone = (status) => {
  switch (normalizeProviderStatus(status)) {
    case "ok":
      return streamStateTokenVar("healthy");
    case "degraded":
      return streamStateTokenVar("stale");
    case "unconfigured":
      return streamStateTokenVar("offline");
    default:
      return streamStateTokenVar("quiet");
  }
};

const formatMassiveRestRequestSummary = (request) => {
  if (!request || typeof request !== "object") {
    return MISSING_VALUE;
  }
  const purpose = String(request.purpose || request.endpointFamily || "request")
    .replace(/[-_]+/g, " ");
  const symbol = request.symbol ? ` ${request.symbol}` : "";
  const timeframe = request.timeframe ? ` ${request.timeframe}` : "";
  const resultCount = firstFiniteNumber(request.resultCount);
  const rows = Number.isFinite(resultCount) ? ` · ${Math.round(resultCount)} rows` : "";
  return `${purpose}${symbol}${timeframe}${rows}`.trim();
};

const fallbackMassiveWebSocketFromLineUsage = (lineUsageSnapshot) => {
  const stockAggregates = recordOrEmpty(lineUsageSnapshot?.streams?.stockAggregates);
  const delayedWebSocket = recordOrEmpty(stockAggregates.massiveDelayedWebSocket);
  const providerIdentity = String(
    delayedWebSocket.providerIdentity ||
      stockAggregates.provider ||
      stockAggregates.activeProvider ||
      "",
  ).toLowerCase();
  const massiveActive = providerIdentity.includes("massive");

  if (!massiveActive) {
    return {};
  }

  const subscribedChannels = arrayOrEmpty(delayedWebSocket.subscribedChannels);
  const availableChannels = arrayOrEmpty(delayedWebSocket.availableChannels);
  const connected = delayedWebSocket.connected === true;
  const configured =
    delayedWebSocket.configured === true ||
    stockAggregates.provider === "massive-websocket" ||
    stockAggregates.activeProvider === "massive-websocket";

  return {
    status: connected ? "ok" : configured ? "idle" : "unknown",
    mode: delayedWebSocket.mode || null,
    activeChannels: subscribedChannels,
    availableChannels,
    subscribedSymbolCount: firstFiniteNumber(
      delayedWebSocket.subscribedSymbolCount,
      stockAggregates.unionSymbolCount,
    ),
    activeConsumerCount: firstFiniteNumber(
      delayedWebSocket.activeConsumerCount,
      stockAggregates.activeConsumerCount,
    ),
    eventCount: firstFiniteNumber(delayedWebSocket.eventCount, stockAggregates.eventCount),
    lastMessageAgeMs: firstFiniteNumber(
      delayedWebSocket.lastMessageAgeMs,
      stockAggregates.lastAggregateAgeMs,
    ),
    reconnectCount: firstFiniteNumber(delayedWebSocket.reconnectCount, 0),
    lastError: delayedWebSocket.lastError || stockAggregates.lastError || null,
    lastErrorAt: delayedWebSocket.lastErrorAt || stockAggregates.lastErrorAt || null,
    feeds: [
      {
        id: "stock-aggregates",
        label: "Stock minute aggregates",
        configured,
        mode: delayedWebSocket.mode || null,
        socketHost: delayedWebSocket.socketHost || null,
        availableChannels,
        subscribedChannels,
        subscribedSymbolCount: firstFiniteNumber(
          delayedWebSocket.subscribedSymbolCount,
          stockAggregates.unionSymbolCount,
        ),
        subscriptionCount: firstFiniteNumber(delayedWebSocket.subscriptionCount),
        activeConsumerCount: firstFiniteNumber(
          delayedWebSocket.activeConsumerCount,
          stockAggregates.activeConsumerCount,
        ),
        connected,
        authState: delayedWebSocket.authState || null,
        eventCount: firstFiniteNumber(delayedWebSocket.eventCount, stockAggregates.eventCount),
        lastMessageAgeMs: firstFiniteNumber(
          delayedWebSocket.lastMessageAgeMs,
          stockAggregates.lastAggregateAgeMs,
        ),
        reconnectCount: firstFiniteNumber(delayedWebSocket.reconnectCount, 0),
        lastError: delayedWebSocket.lastError || null,
        lastErrorAt: delayedWebSocket.lastErrorAt || null,
      },
    ],
  };
};

export const normalizeMassiveRuntimeDiagnostics = (
  runtimeDiagnostics,
  lineUsageSnapshot = null,
) => {
  const massive = recordOrEmpty(runtimeDiagnostics?.providers?.massive);
  const rest = {
    status: massive.status,
    lastSuccessAt: massive.lastSuccessAt,
    lastFailureAt: massive.lastFailureAt,
    lastError: massive.lastError,
    ...recordOrEmpty(massive.rest),
  };
  const fallbackWebSocket = fallbackMassiveWebSocketFromLineUsage(lineUsageSnapshot);
  const websocket = {
    ...fallbackWebSocket,
    ...recordOrEmpty(massive.websocket),
  };
  const restStatus = normalizeProviderStatus(rest.status);
  const websocketStatus = normalizeProviderStatus(websocket.status);
  const fallbackConfigured = Boolean(Object.keys(fallbackWebSocket).length);
  const status =
    restStatus === "degraded" || websocketStatus === "degraded"
      ? "degraded"
      : restStatus === "ok" || websocketStatus === "ok"
        ? "ok"
        : massive.configured === false && !fallbackConfigured
          ? "unconfigured"
          : restStatus === "idle" || websocketStatus === "idle"
            ? "idle"
            : "unknown";
  const activeChannels = arrayOrEmpty(websocket.activeChannels)
    .map((channel) => String(channel).trim())
    .filter(Boolean);
  const availableChannels = arrayOrEmpty(websocket.availableChannels)
    .map((channel) => String(channel).trim())
    .filter(Boolean);
  const subscribedSymbolCount = firstFiniteNumber(websocket.subscribedSymbolCount);
  const lastRequest = recordOrEmpty(rest.lastRequest);
  const lastRestDurationMs = firstFiniteNumber(lastRequest.durationMs);

  return {
    configured: massive.configured === true || fallbackConfigured,
    providerIdentity: massive.providerIdentity || (fallbackConfigured ? "massive" : null),
    baseUrlHost: massive.baseUrlHost || hostFromUrl(massive.baseUrl),
    lastSuccessAt: rest.lastSuccessAt || null,
    lastFailureAt: rest.lastFailureAt || null,
    lastError: rest.lastError || null,
    stocksRealtimeConfigured:
      massive.stocksRealtimeConfigured === true ||
      (fallbackConfigured && websocket.mode === "real-time"),
    status,
    label: providerStatusLabel(status),
    tone: providerStatusTone(status),
    rest: {
      status: restStatus,
      label: providerStatusLabel(restStatus),
      tone: providerStatusTone(restStatus),
      lastRequest: Object.keys(lastRequest).length ? lastRequest : null,
      lastRequestSummary: Object.keys(lastRequest).length
        ? formatMassiveRestRequestSummary(lastRequest)
        : MISSING_VALUE,
      lastRequestAt: lastRequest.observedAt || null,
      lastDurationMs: lastRestDurationMs,
      recentRequests: arrayOrEmpty(rest.recentRequests),
      lastSuccessAt: rest.lastSuccessAt || null,
      lastFailureAt: rest.lastFailureAt || null,
      lastError: rest.lastError || null,
    },
    websocket: {
      status: websocketStatus,
      label: providerStatusLabel(websocketStatus),
      tone: providerStatusTone(websocketStatus),
      mode: websocket.mode || null,
      activeChannels,
      availableChannels,
      channelSummary:
        activeChannels.length > 0
          ? activeChannels.join(", ")
          : availableChannels.length > 0
            ? `${availableChannels.join(", ")} idle`
            : MISSING_VALUE,
      subscribedSymbolCount,
      activeConsumerCount: firstFiniteNumber(websocket.activeConsumerCount),
      eventCount: firstFiniteNumber(websocket.eventCount),
      lastMessageAgeMs: firstFiniteNumber(websocket.lastMessageAgeMs),
      reconnectCount: firstFiniteNumber(websocket.reconnectCount),
      lastError: websocket.lastError || null,
      feeds: arrayOrEmpty(websocket.feeds),
    },
  };
};

const formatFlowScannerRuntimeDetail = (admission, used) => {
  const scanner = admission?.optionsFlowScanner;
  if (!scanner || typeof scanner !== "object") {
    return null;
  }
  if (scanner.enabled === false) {
    return "disabled";
  }
  if (scanner.started === false) {
    return "not started";
  }
  const marketDataMode = String(scanner.marketDataMode || "").toLowerCase();
  const phase = scanner.activeScanPhase || scanner.deepScanner?.lastScanPhase;
  const scannerCoverage = resolveFlowScannerCoverage(scanner);
  if (marketDataMode === "frozen") {
    return "paused: market data frozen";
  }
  if (marketDataMode === "delayed_frozen") {
    return "paused: delayed frozen market data";
  }
  if (Number.isFinite(used) && used === 0) {
    const activeCount = Number(scanner.deepScanner?.activeCount);
    if (Number.isFinite(activeCount) && activeCount > 0) {
      return `${formatRuntimeQuantity(activeCount, "option-chain scan")} active; quotes warming`;
    }
    const queuedCount = Number(scanner.deepScanner?.queuedCount);
    if (Number.isFinite(queuedCount) && queuedCount > 0) {
      return `${formatRuntimeQuantity(queuedCount, "scan")} queued`;
    }
    if (scanner.deepScanner?.draining) {
      return "deep scan starting";
    }
    const snapshotCount = Number(scanner.deepScanner?.snapshotCount);
    const snapshotDetail =
      Number.isFinite(snapshotCount) && snapshotCount > 0
        ? formatFlowSnapshotCount(snapshotCount)
        : null;
    const radarDegradedReason =
      scanner.radarDegradedReason ||
      scanner.radar?.degradedReason ||
      scanner.coverage?.degradedReason;
    const blockedReason =
      scanner.backgroundBlockedReason ||
      scanner.sessionBlockReason ||
      (NON_BLOCKING_FLOW_SCANNER_RADAR_REASONS.has(radarDegradedReason)
        ? null
        : radarDegradedReason);
    if (blockedReason === "live-warmup") {
      const remaining = formatRuntimeDuration(scanner.backgroundHoldRemainingMs);
      return `warming live data${remaining ? ` (${remaining})` : ""}; foreground scans allowed`;
    }
    if (blockedReason === "line-cap-exhausted") {
      return "paused: no scanner lines available";
    }
    if (
      blockedReason === "market-data-frozen" ||
      blockedReason === "market-data-delayed-frozen"
    ) {
      return `paused: ${formatScannerReason(blockedReason)}`;
    }
    if (blockedReason === "resource-pressure") {
      return "degraded: resource pressure";
    }
    if (blockedReason === "market-session-quiet") {
      const coverageDetail = formatFlowScannerCoverageDetail(scannerCoverage);
      return coverageDetail
        ? `market session quiet; ${coverageDetail}`
        : snapshotDetail
          ? `market session quiet; ${snapshotDetail}`
          : "market session quiet";
    }
    if (blockedReason) {
      return `paused: ${formatScannerReason(blockedReason)}`;
    }
    const skipReason = scanner.lastSkippedReason;
    if (skipReason) {
      if (skipReason === "line-cap-exhausted") {
        return "paused: no scanner lines available";
      }
      return `skipped: ${formatScannerReason(skipReason)}`;
    }
    const failedSymbols = formatScannerSymbolList(
      scanner.deepScanner?.lastFailedSymbols,
    );
    if (failedSymbols) {
      return `last scan failed: ${failedSymbols}`;
    }
    const coverageDetail = formatFlowScannerCoverageDetail(scannerCoverage);
    if (scannerCoverage?.coverageHealth === "lagging") {
      return coverageDetail
        ? `coverage lagging: ${coverageDetail}`
        : "coverage lagging";
    }
    if (snapshotDetail) {
      return snapshotDetail;
    }
    if (scanner.deepScanner?.lastRunAt || scanner.lastBatch?.length) {
      if (scanner.delayedMarketData) {
        return `degraded: delayed options data; ${phase || "seed"} rotation`;
      }
      if (coverageDetail) {
        return `rotating; ${coverageDetail}`;
      }
      return "rotating; awaiting next batch";
    }
    return "awaiting scanner work";
  }
  if (scanner.delayedMarketData) {
    return `degraded: delayed options data; ${phase || "rotating"}`;
  }
  if (phase) {
    return `${phase} rotation`;
  }
  return null;
};

const normalizeBridgeLineUsage = (lineUsageSnapshot, admission) => {
  const bridge =
    lineUsageSnapshot?.bridge && typeof lineUsageSnapshot.bridge === "object"
      ? lineUsageSnapshot.bridge
      : {};
  const subscriptions =
    bridge.diagnostics?.subscriptions &&
    typeof bridge.diagnostics.subscriptions === "object"
      ? bridge.diagnostics.subscriptions
      : {};
  const used = firstFiniteNumber(
    bridge.activeLineCount,
    subscriptions.activeQuoteSubscriptions,
  );
  const cap = firstFiniteNumber(
    bridge.lineBudget,
    subscriptions.marketDataLineBudget,
    admission?.budget?.bridgeLineBudget,
  );
  const free = firstFiniteNumber(
    bridge.remainingLineCount,
    subscriptions.marketDataLineBudgetRemaining,
    Number.isFinite(used) && Number.isFinite(cap) ? cap - used : null,
  );
  const pressure =
    typeof bridge.diagnostics?.pressure === "string"
      ? bridge.diagnostics.pressure
      : "unknown";
  const degraded = pressure === "degraded" || pressure === "backoff" || pressure === "stalled";
  const available = Number.isFinite(used) || Number.isFinite(cap);
  const streamState = lineUsageState(used, cap, degraded);
  return {
    available,
    used,
    cap,
    free: Number.isFinite(free) ? Math.max(0, free) : null,
    pressure,
    summary: available ? `${formatRuntimeCount(used)} of ${formatRuntimeCount(cap)}` : MISSING_VALUE,
    activeEquity: firstFiniteNumber(subscriptions.activeEquitySubscriptions),
    activeOptions: firstFiniteNumber(subscriptions.activeOptionSubscriptions),
    prewarm: firstFiniteNumber(subscriptions.prewarmSymbolCount),
    streamState,
    tone: streamStateTokenVar(streamState),
  };
};

const normalizeLineDrift = (lineUsageSnapshot) => {
  const reconciliation =
    lineUsageSnapshot?.drift?.reconciliation &&
    typeof lineUsageSnapshot.drift.reconciliation === "object"
      ? lineUsageSnapshot.drift.reconciliation
      : {};
  const status = typeof reconciliation.status === "string"
    ? reconciliation.status
    : "unknown";
  const labels = {
    matched: "matched",
    api_active_bridge_missing: "pending bridge",
    api_released_bridge_active: "line drift",
    mixed: "mixed drift",
    unknown: "unknown",
  };
  const state =
    status === "matched"
      ? "healthy"
      : status === "unknown"
        ? "no-subscribers"
        : "capacity-limited";
  return {
    ...reconciliation,
    status,
    label: labels[status] || status.replace(/_/g, " "),
    admissionVsBridgeLineDelta: firstFiniteNumber(
      lineUsageSnapshot?.drift?.admissionVsBridgeLineDelta,
    ),
    state,
    tone: streamStateTokenVar(state),
  };
};

const normalizeWarmupCoverage = (lineUsageSnapshot) => {
  const hasWarmup = Boolean(
    lineUsageSnapshot?.warmup && typeof lineUsageSnapshot.warmup === "object",
  );
  const warmup =
    hasWarmup
      ? lineUsageSnapshot.warmup
      : {};
  const state = typeof warmup.state === "string" ? warmup.state : "unknown";
  const targetLineCount = firstFiniteNumber(warmup.targetLineCount, 0);
  const activeBridgeLineCount = firstFiniteNumber(warmup.activeBridgeLineCount, 0);
  const pendingLineCount = firstFiniteNumber(warmup.pendingLineCount, 0);
  const accountTargetLineCount = firstFiniteNumber(warmup.accountTargetLineCount, 0);
  const accountPendingLineCount = firstFiniteNumber(warmup.accountPendingLineCount, 0);
  const visibleTargetLineCount = firstFiniteNumber(warmup.visibleTargetLineCount, 0);
  const visiblePendingLineCount = firstFiniteNumber(warmup.visiblePendingLineCount, 0);
  const available =
    hasWarmup &&
    (state !== "unknown" ||
      Number.isFinite(targetLineCount) ||
      Number.isFinite(pendingLineCount));
  const streamState =
    state === "covered"
      ? "healthy"
      : state === "pending"
        ? "capacity-limited"
        : "no-subscribers";
  const label =
    state === "covered"
      ? "covered"
      : state === "pending"
        ? "pending bridge"
        : state === "idle"
          ? "idle"
          : "unknown";

  return {
    ...warmup,
    available,
    state,
    label,
    targetLineCount,
    activeBridgeLineCount,
    pendingLineCount,
    accountTargetLineCount,
    accountPendingLineCount,
    visibleTargetLineCount,
    visiblePendingLineCount,
    coverageRatio: firstFiniteNumber(warmup.coverageRatio),
    targetSymbolCount: firstFiniteNumber(warmup.targetSymbolCount, 0),
    summary: available
      ? `${formatRuntimeCount(activeBridgeLineCount)} / ${formatRuntimeCount(targetLineCount)} covered`
      : MISSING_VALUE,
    pendingSummary: available
      ? `${formatRuntimeCount(pendingLineCount)} pending`
      : MISSING_VALUE,
    streamState,
    tone: streamStateTokenVar(streamState),
  };
};

const normalizeLinePressure = (admission) => {
  const pressure =
    admission?.pressure && typeof admission.pressure === "object"
      ? admission.pressure
      : {};
  const activeLineCount = firstFiniteNumber(
    pressure.activeLineCount,
    admission?.activeLineCount,
  );
  const usableLineCount = firstFiniteNumber(
    pressure.usableLineCount,
    admission?.budget?.usableLines,
    admission?.budget?.maxLines,
  );
  const usableRemainingLineCount = firstFiniteNumber(
    pressure.usableRemainingLineCount,
    admission?.usableRemainingLineCount,
  );
  const utilizationPercent = firstFiniteNumber(
    pressure.utilizationPercent,
    lineUsageUtilizationPercent(activeLineCount, usableLineCount),
  );
  const utilizationLevel =
    typeof pressure.utilizationLevel === "string"
      ? pressure.utilizationLevel
      : lineUsageUtilizationLevel(
          activeLineCount,
          usableLineCount,
          usableRemainingLineCount,
        );
  return {
    state: typeof pressure.state === "string" ? pressure.state : "unknown",
    utilizationLevel,
    utilizationPercent,
    policy: typeof pressure.policy === "string" ? pressure.policy : "unknown",
    budgetSource:
      typeof pressure.budgetSource === "string"
        ? pressure.budgetSource
        : admission?.budget?.budgetSource || "unknown",
    scannerStaticLineCap: firstFiniteNumber(
      pressure.scannerStaticLineCap,
      admission?.budget?.flowScannerLineCap,
    ),
    scannerEffectiveLineCap: firstFiniteNumber(
      pressure.scannerEffectiveLineCap,
      admission?.poolUsage?.["flow-scanner"]?.effectiveMaxLines,
    ),
    scannerDynamicLineCap: firstFiniteNumber(pressure.scannerDynamicLineCap),
    optionBudgetLineCount: firstFiniteNumber(pressure.optionBudgetLineCount),
    nonScannerOptionLineCount: firstFiniteNumber(pressure.nonScannerOptionLineCount),
    optionReserveLineCount: firstFiniteNumber(pressure.optionReserveLineCount),
    usableRemainingLineCount,
  };
};

const resolveScannerSchedulableLineCap = (admission, allocation = null) =>
  firstFiniteNumber(
    allocation?.scannerSchedulableLineCap ?? undefined,
    admission?.optionsFlowScanner?.lineUtilization?.schedulablePoolCap,
  );

const normalizeLineAllocation = (admission, lineUsageSnapshot = null) => {
  const allocation =
    lineUsageSnapshot?.allocation && typeof lineUsageSnapshot.allocation === "object"
      ? lineUsageSnapshot.allocation
      : {};
  const lineAllocation =
    admission?.lineAllocation && typeof admission.lineAllocation === "object"
      ? admission.lineAllocation
      : {};
  const policy =
    lineUsageSnapshot?.policy && typeof lineUsageSnapshot.policy === "object"
      ? lineUsageSnapshot.policy
      : {};
  const pressure =
    admission?.pressure && typeof admission.pressure === "object"
      ? admission.pressure
      : {};
  const scannerSchedulableLineCap = resolveScannerSchedulableLineCap(
    admission,
    allocation,
  );
  const activeLineCount = firstFiniteNumber(
    allocation.activeLineCount,
    admission?.activeLineCount,
  );
  const targetFillLines = firstFiniteNumber(
    allocation.targetFillLines,
    policy.targetFillLines,
    admission?.budget?.targetFillLines,
    admission?.budget?.maxLines,
  );
  const remainingToTargetLineCount = firstFiniteNumber(
    allocation.remainingToTargetLineCount,
    Number.isFinite(activeLineCount) && Number.isFinite(targetFillLines)
      ? targetFillLines - activeLineCount
      : null,
  );
  const scannerActiveLineCount = firstFiniteNumber(
    allocation.scannerActiveLineCount,
    pressure.scannerActiveLineCount,
    admission?.flowScannerLineCount,
  );
  const scannerSchedulableRemainingLineCount =
    Number.isFinite(scannerSchedulableLineCap) &&
    Number.isFinite(scannerActiveLineCount)
      ? Math.max(0, scannerSchedulableLineCap - scannerActiveLineCount)
      : null;

  return {
    activeLineCount,
    targetFillLines,
    remainingToTargetLineCount:
      Number.isFinite(remainingToTargetLineCount)
        ? Math.max(0, remainingToTargetLineCount)
        : null,
    protectedLineCount: firstFiniteNumber(
      allocation.protectedLineCount,
      lineAllocation.protectedLineCount,
      pressure.protectedLineCount,
    ),
    portfolioPolicy:
      typeof allocation.portfolioPolicy === "string"
        ? allocation.portfolioPolicy
        : typeof admission?.portfolio?.policy === "string"
          ? admission.portfolio.policy
          : null,
    pinnedLineCount: firstFiniteNumber(
      allocation.pinnedLineCount,
      admission?.portfolio?.pinned?.activeLineCount,
    ),
    priorityLineCount: firstFiniteNumber(
      allocation.priorityLineCount,
      admission?.portfolio?.priority?.activeLineCount,
    ),
    scannerRotatingLineCount: firstFiniteNumber(
      allocation.scannerRotatingLineCount,
      admission?.portfolio?.scannerRotating?.activeLineCount,
    ),
    shadowAccountLineCount: firstFiniteNumber(
      allocation.shadowAccountLineCount,
      admission?.shadowAccount?.activeLineCount,
      admission?.ownerClasses?.shadowAccount?.activeLineCount,
      admission?.ownerClasses?.summaries?.["shadow-account"]?.activeLineCount,
    ),
    shadowAccountCacheFallbackLineCount: firstFiniteNumber(
      allocation.shadowAccountCacheFallbackLineCount,
      admission?.shadowAccount?.activeFallbackProviderLineCounts?.cache,
      admission?.ownerClasses?.shadowAccount?.activeFallbackProviderLineCounts?.cache,
      admission?.ownerClasses?.summaries?.["shadow-account"]?.activeFallbackProviderLineCounts?.cache,
    ),
    shadowAccountMassiveFallbackLineCount: firstFiniteNumber(
      allocation.shadowAccountMassiveFallbackLineCount,
      admission?.shadowAccount?.activeFallbackProviderLineCounts?.massive,
      admission?.ownerClasses?.shadowAccount?.activeFallbackProviderLineCounts?.massive,
      admission?.ownerClasses?.summaries?.["shadow-account"]?.activeFallbackProviderLineCounts?.massive,
    ),
    rotatingReclaimableLineCount: firstFiniteNumber(
      allocation.rotatingReclaimableLineCount,
      admission?.portfolio?.rotatingReclaimableLineCount,
    ),
    visibleLineCount: firstFiniteNumber(
      allocation.visibleLineCount,
      pressure.visibleLineCount,
    ),
    scannerActiveLineCount,
    scannerEffectiveLineCap: firstFiniteNumber(
      scannerSchedulableLineCap ?? undefined,
      allocation.scannerEffectiveLineCap,
      pressure.scannerEffectiveLineCap,
    ),
    scannerDynamicLineCap: firstFiniteNumber(
      allocation.scannerDynamicLineCap,
      pressure.scannerDynamicLineCap,
    ),
    optionBudgetLineCount: firstFiniteNumber(
      allocation.optionBudgetLineCount,
      pressure.optionBudgetLineCount,
    ),
    nonScannerOptionLineCount: firstFiniteNumber(
      allocation.nonScannerOptionLineCount,
      pressure.nonScannerOptionLineCount,
    ),
    optionReserveLineCount: firstFiniteNumber(
      allocation.optionReserveLineCount,
      pressure.optionReserveLineCount,
    ),
    scannerSchedulableLineCap,
    scannerRemainingLineCount: firstFiniteNumber(
      scannerSchedulableRemainingLineCount ?? undefined,
      allocation.scannerRemainingLineCount,
      pressure.scannerRemainingLineCount,
    ),
    bridgeActiveLineCount: firstFiniteNumber(
      allocation.bridgeActiveLineCount,
      lineUsageSnapshot?.bridge?.activeLineCount,
    ),
    bridgeLineBudget: firstFiniteNumber(
      allocation.bridgeLineBudget,
      lineUsageSnapshot?.bridge?.lineBudget,
    ),
  };
};

const normalizeSignalOptionsLineUsage = (admission, lineUsageSnapshot = null) => {
  const signalOptions =
    (lineUsageSnapshot?.signalOptions &&
    typeof lineUsageSnapshot.signalOptions === "object"
      ? lineUsageSnapshot.signalOptions
      : null) ||
    (admission?.signalOptions && typeof admission.signalOptions === "object"
      ? admission.signalOptions
      : null) ||
    (admission?.ownerClasses?.signalOptions &&
    typeof admission.ownerClasses.signalOptions === "object"
      ? admission.ownerClasses.signalOptions
      : null) ||
    (admission?.ownerClasses?.summaries?.["signal-options"] &&
    typeof admission.ownerClasses.summaries["signal-options"] === "object"
      ? admission.ownerClasses.summaries["signal-options"]
      : {});
  const automationPool =
    admission?.poolUsage?.automation &&
    typeof admission.poolUsage.automation === "object"
      ? admission.poolUsage.automation
      : {};
  const executionPool =
    admission?.poolUsage?.execution &&
    typeof admission.poolUsage.execution === "object"
      ? admission.poolUsage.execution
      : {};
  const used = firstFiniteNumber(signalOptions.activeLineCount, 0);
  const cap = firstFiniteNumber(
    signalOptions.effectiveMaxLines,
    signalOptions.maxLines,
    admission?.budget?.automationExecutionLineCap,
    automationPool.effectiveMaxLines,
    executionPool.effectiveMaxLines,
    automationPool.maxLines,
    executionPool.maxLines,
    admission?.budget?.automationLineCap,
  );
  const free =
    Number.isFinite(used) && Number.isFinite(cap)
      ? Math.max(0, cap - used)
      : null;
  const rejectedCount = firstFiniteNumber(signalOptions.recentRejectedCount, 0);
  const cacheFallbackCount = firstFiniteNumber(
    signalOptions.recentCacheFallbackCount,
    0,
  );
  const detail =
    rejectedCount > 0
      ? `${formatRuntimeCount(rejectedCount)} recent rejected`
      : cacheFallbackCount > 0
        ? `${formatRuntimeCount(cacheFallbackCount)} cache fallback`
        : "Algo & Execution";
  const streamState = lineUsageState(used, cap, rejectedCount > 0);

  return {
    ...signalOptions,
    used,
    activeLineCount: used,
    cap,
    effectiveCap: cap,
    free,
    leaseCount: firstFiniteNumber(signalOptions.leaseCount, 0),
    ownerCount: firstFiniteNumber(signalOptions.ownerCount, 0),
    requestedLineCount: firstFiniteNumber(
      signalOptions.recentRequestedLineCount,
      used,
    ),
    rejectedCount,
    cacheFallbackCount,
    detail,
    streamState,
    tone: streamStateTokenVar(streamState),
  };
};

const normalizeShadowAccountLineUsage = (admission, lineUsageSnapshot = null) => {
  const shadowAccount =
    (lineUsageSnapshot?.shadowAccount &&
    typeof lineUsageSnapshot.shadowAccount === "object"
      ? lineUsageSnapshot.shadowAccount
      : null) ||
    (admission?.shadowAccount && typeof admission.shadowAccount === "object"
      ? admission.shadowAccount
      : null) ||
    (admission?.ownerClasses?.shadowAccount &&
    typeof admission.ownerClasses.shadowAccount === "object"
      ? admission.ownerClasses.shadowAccount
      : null) ||
    (admission?.ownerClasses?.summaries?.["shadow-account"] &&
    typeof admission.ownerClasses.summaries["shadow-account"] === "object"
      ? admission.ownerClasses.summaries["shadow-account"]
      : {});
  const providerLineCounts =
    shadowAccount.activeFallbackProviderLineCounts &&
    typeof shadowAccount.activeFallbackProviderLineCounts === "object"
      ? shadowAccount.activeFallbackProviderLineCounts
      : {};
  const used = firstFiniteNumber(shadowAccount.activeLineCount, 0);
  const cacheFallbackLineCount = firstFiniteNumber(providerLineCounts.cache, 0);
  const massiveFallbackLineCount = firstFiniteNumber(providerLineCounts.massive, 0);
  const rejectedCount = firstFiniteNumber(shadowAccount.recentRejectedCount, 0);
  const detail =
    rejectedCount > 0
      ? `${formatRuntimeCount(rejectedCount)} recent rejected`
      : used > 0
        ? cacheFallbackLineCount > 0
          ? `IBKR live · ${formatRuntimeCount(cacheFallbackLineCount)} cache fallback policy`
          : massiveFallbackLineCount > 0
            ? `IBKR live · ${formatRuntimeCount(massiveFallbackLineCount)} Massive fallback policy`
            : "IBKR live"
        : "idle";
  const streamState =
    rejectedCount > 0 ? "capacity-limited" : used > 0 ? "healthy" : "no-subscribers";

  return {
    ...shadowAccount,
    used,
    activeLineCount: used,
    cacheFallbackLineCount,
    massiveFallbackLineCount,
    leaseCount: firstFiniteNumber(shadowAccount.leaseCount, 0),
    ownerCount: firstFiniteNumber(shadowAccount.ownerCount, 0),
    requestedLineCount: firstFiniteNumber(
      shadowAccount.recentRequestedLineCount,
      used,
    ),
    rejectedCount,
    detail,
    streamState,
    tone: streamStateTokenVar(streamState),
  };
};

export const isOptionsFlowScannerRuntimeActive = (admission) => {
  const flowScannerLineCount = firstFiniteNumber(
    admission?.poolUsage?.["flow-scanner"]?.activeLineCount,
    admission?.flowScannerLineCount,
    admission?.flowScannerActivity?.scannerActiveLineCount,
  );
  if (flowScannerLineCount > 0) {
    return true;
  }

  const scanner = admission?.optionsFlowScanner;
  if (!scanner || typeof scanner !== "object") {
    return false;
  }
  if (scanner.enabled === false || scanner.started === false) {
    return false;
  }

  const plannedHorizonCount = firstFiniteNumber(
    scanner.plannedHorizon?.symbolCount,
    scanner.coverage?.activeTargetSize,
    scanner.coverage?.selectedSymbols,
  );
  const scannedCoverageCount = firstFiniteNumber(
    scanner.coverage?.cycleScannedSymbols,
    scanner.coverage?.scannedSymbols,
    scanner.radar?.scannedSymbols,
  );
  const activeScanPhase = String(
    scanner.activeScanPhase ||
      scanner.scannerPhase ||
      scanner.coverage?.scannerPhase ||
      "",
  ).trim();

  return Boolean(
    plannedHorizonCount > 0 ||
      scannedCoverageCount > 0 ||
      activeScanPhase ||
      scanner.started ||
      scanner.scannerAlwaysOn ||
      scanner.deepScanner?.draining ||
      scanner.deepScanner?.activeCount > 0 ||
      scanner.deepScanner?.queuedCount > 0 ||
      scanner.deepScanner?.drainingCount > 0 ||
      scanner.deepScanner?.lastRunAt ||
      scanner.radar?.currentBatch?.length ||
      scanner.coverage?.currentBatch?.length ||
      scanner.lastBatch?.length,
  );
};

export const formatRuntimeCount = (value) =>
  Number.isFinite(value)
    ? Math.max(0, Math.round(value)).toLocaleString()
    : MISSING_VALUE;

export const lineUsageState = (used, cap, degraded = false) => {
  if (degraded) return "capacity-limited";
  if (!Number.isFinite(used) || !Number.isFinite(cap)) {
    return "no-subscribers";
  }
  if (cap <= 0) return used > 0 ? "capacity-limited" : "no-subscribers";
  const ratio = used / cap;
  if (ratio >= 0.85) return "capacity-limited";
  return "healthy";
};

export const lineUsageTone = (used, cap, degraded = false) =>
  streamStateTokenVar(lineUsageState(used, cap, degraded));

export const lineUsageUtilizationLevel = (used, cap, remaining = null) => {
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) {
    return "unknown";
  }
  const ratio = used / cap;
  const free = Number(remaining);
  if (
    ratio >= 0.95 ||
    (ratio >= 0.85 && Number.isFinite(free) && free <= 5)
  ) {
    return "protected";
  }
  if (ratio >= 0.85) return "constrained";
  if (ratio >= 0.65) return "watch";
  return "normal";
};

const lineUsageUtilizationPercent = (used, cap) => {
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) {
    return null;
  }
  return Math.round((used / cap) * 1_000) / 10;
};

export const hasAccountMonitorAdmission = (admission) =>
  Boolean(
    admission &&
      typeof admission === "object" &&
      (admission.accountMonitorLineCount != null ||
        admission.budget?.accountMonitorLineCap != null ||
        admission.poolUsage?.["account-monitor"]),
  );

export const sumAdmissionActions = (admission, actions) => {
  const counters = admission?.counters || {};
  return Object.values(counters).reduce((total, counter) => {
    if (!counter || typeof counter !== "object") return total;
    return (
      total +
      actions.reduce((sum, action) => {
        const value = Number(counter[action]);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0)
    );
  }, 0);
};

export const normalizeAdmissionDiagnostics = (admission, lineUsageSnapshot = null) => {
  if (!admission || typeof admission !== "object") {
    const bridge = normalizeBridgeLineUsage(lineUsageSnapshot, null);
    const drift = normalizeLineDrift(lineUsageSnapshot);
    const warmup = normalizeWarmupCoverage(lineUsageSnapshot);
    const allocation = normalizeLineAllocation(null, lineUsageSnapshot);
    const signalOptions = normalizeSignalOptionsLineUsage(null, lineUsageSnapshot);
    const shadowAccount = normalizeShadowAccountLineUsage(null, lineUsageSnapshot);
    return {
      schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
      available: false,
      summary: bridge.available ? bridge.summary : MISSING_VALUE,
      demandSummary: MISSING_VALUE,
      bridgeSummary: bridge.summary,
      warnings: 0,
      rows: [],
      pools: {},
      accountMonitor: {
        used: 0,
        cap: null,
        free: null,
        dynamic: false,
        needed: 0,
        covered: 0,
        deferred: 0,
      },
      flowScanner: { used: null, cap: null, free: null },
      signalOptions,
      shadowAccount,
      total: { used: null, cap: null, free: null },
      bridge,
      drift,
      warmup,
      allocation,
      pressure: { state: "unknown", policy: "unknown", budgetSource: "unknown" },
      legacyNormalized: false,
    };
  }

  const budget = admission.budget || {};
  const poolUsage = admission.poolUsage || {};
  const legacyAdmission = !hasAccountMonitorAdmission(admission);
  const warnings = sumAdmissionActions(admission, ["rejected", "demoted"]);
  const pressure = normalizeLinePressure(admission);
  const bridge = normalizeBridgeLineUsage(lineUsageSnapshot, admission);
  const drift = normalizeLineDrift(lineUsageSnapshot);
  const warmup = normalizeWarmupCoverage(lineUsageSnapshot);
  const allocation = normalizeLineAllocation(admission, lineUsageSnapshot);
  const signalOptions = normalizeSignalOptionsLineUsage(admission, lineUsageSnapshot);
  const shadowAccount = normalizeShadowAccountLineUsage(admission, lineUsageSnapshot);
  const pools = {};
  const rows = POOL_ORDER.map(([id, fallbackLabel]) => {
    const pool = poolUsage[id] || {};
    const accountDetails =
      admission.accountMonitor && typeof admission.accountMonitor === "object"
        ? admission.accountMonitor
        : {};
    const dynamicPool = Boolean(pool.dynamic);
    const rawUsed =
      id === "account-monitor"
        ? firstFiniteNumber(pool.activeLineCount, admission.accountMonitorLineCount, 0)
        : id === "flow-scanner"
          ? firstFiniteNumber(pool.activeLineCount, admission.flowScannerLineCount)
          : id === "automation"
            ? firstFiniteNumber(
                admission.automationExecutionLineCount,
                pool.activeLineCount,
                admission.automationLineCount,
              )
            : firstFiniteNumber(pool.activeLineCount);
    const activeLineCount =
      id === "automation"
        ? rawUsed
        : firstFiniteNumber(pool.activeLineCount, rawUsed);
    const rawCap =
      id === "account-monitor"
        ? firstFiniteNumber(
            pool.effectiveMaxLines,
            pool.maxLines,
            budget.accountMonitorLineCap,
            DEFAULT_ACCOUNT_MONITOR_LINE_CAP,
          )
        : id === "flow-scanner"
          ? firstFiniteNumber(pool.maxLines, budget.flowScannerLineCap)
          : id === "automation"
            ? firstFiniteNumber(
                pool.effectiveMaxLines,
                pool.maxLines,
                budget.automationExecutionLineCap,
                budget.automationLineCap,
              )
            : firstFiniteNumber(pool.maxLines);
    const legacyVisibleAdjusted =
      id === "visible" &&
      legacyAdmission &&
      Number.isFinite(rawCap) &&
      rawCap > 100;
    const cap = legacyVisibleAdjusted
      ? Math.max(0, rawCap - DEFAULT_ACCOUNT_MONITOR_LINE_CAP)
      : rawCap;
    const effectiveCap =
      id === "flow-scanner"
        ? firstFiniteNumber(
            resolveScannerSchedulableLineCap(admission, allocation) ?? undefined,
            pool.effectiveMaxLines,
            pressure.scannerEffectiveLineCap ?? undefined,
          )
        : firstFiniteNumber(pool.effectiveMaxLines, cap);
    const free =
      id === "flow-scanner" &&
      Number.isFinite(effectiveCap) &&
      Number.isFinite(rawUsed)
        ? Math.max(0, effectiveCap - rawUsed)
        : legacyVisibleAdjusted || !Number.isFinite(Number(pool.remainingLineCount))
        ? Number.isFinite(effectiveCap ?? cap) && Number.isFinite(rawUsed)
          ? Math.max(0, (effectiveCap ?? cap) - rawUsed)
          : null
        : Number(pool.remainingLineCount);
    const streamState = lineUsageState(
      rawUsed,
      effectiveCap ?? cap,
      warnings > 0 && id === "flow-scanner",
    );
    const row = {
      id,
      label: fallbackLabel,
      used: rawUsed,
      needed:
        id === "account-monitor"
          ? firstFiniteNumber(accountDetails.neededLineCount, rawUsed, 0)
          : rawUsed,
      covered:
        id === "account-monitor"
          ? firstFiniteNumber(accountDetails.coveredLineCount, rawUsed, 0)
          : rawUsed,
      deferred:
        id === "account-monitor"
          ? firstFiniteNumber(
              accountDetails.deferredLineCount,
              accountDetails.recentRejectedCount,
              0,
            )
          : 0,
      cap,
      effectiveCap,
      free,
      activeLineCount,
      detail:
        id === "account-monitor"
          ? `${formatRuntimeCount(firstFiniteNumber(accountDetails.coveredLineCount, rawUsed, 0))} covered of ${formatRuntimeCount(firstFiniteNumber(accountDetails.neededLineCount, rawUsed, 0))} needed`
          : id === "flow-scanner"
          ? formatFlowScannerRuntimeDetail(admission, rawUsed)
          : id === "automation"
            ? `${formatRuntimeCount(firstFiniteNumber(admission.executionLineCount, 0))} execution · ${formatRuntimeCount(firstFiniteNumber(admission.automationLineCount, 0))} algo`
          : null,
      dynamic: dynamicPool,
      strict: Boolean(pool.strict),
      source: pool.id ? "diagnostics" : id === "account-monitor" && legacyAdmission ? "legacy-default" : "missing",
      legacyNormalized: legacyVisibleAdjusted || (id === "account-monitor" && legacyAdmission),
      streamState,
      tone: streamStateTokenVar(streamState),
    };
    pools[id] = row;
    return row;
  });

  const total = {
    id: "total",
    label: "Total app",
    used: firstFiniteNumber(admission.activeLineCount),
    cap: firstFiniteNumber(budget.maxLines),
    free:
      Number.isFinite(Number(admission.activeLineCount)) &&
      Number.isFinite(Number(budget.maxLines))
        ? Math.max(0, Number(budget.maxLines) - Number(admission.activeLineCount))
        : null,
    strict: false,
    source: "diagnostics",
    legacyNormalized: false,
    streamState: lineUsageState(admission.activeLineCount, budget.maxLines, warnings > 0),
    tone: lineUsageTone(admission.activeLineCount, budget.maxLines, warnings > 0),
  };
  rows.push(total);
  const demandSummary = `${formatRuntimeCount(total.used)} of ${formatRuntimeCount(total.cap)}`;
  const requestedLineCount = total.used;
  const activeLineCount = total.used;
  const pendingLineCount =
    Number.isFinite(requestedLineCount) && Number.isFinite(bridge.used)
      ? Math.max(0, requestedLineCount - bridge.used)
      : Number.isFinite(warmup.pendingLineCount)
        ? Math.max(0, warmup.pendingLineCount)
        : 0;
  const foregroundPendingLineCount =
    warmup.available && Number.isFinite(warmup.pendingLineCount)
      ? Math.max(0, warmup.pendingLineCount)
      : pendingLineCount;

  return {
    schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
    available: true,
    summary: demandSummary,
    activeLineCount,
    requestedLineCount,
    pendingLineCount,
    foregroundPendingLineCount,
    requestedSummary: demandSummary,
    demandSummary,
    bridgeSummary: bridge.summary,
    warnings,
    rows,
    pools,
    accountMonitor: pools["account-monitor"],
    flowScanner: pools["flow-scanner"],
    signalOptions,
    shadowAccount,
    total,
    bridge,
    drift,
    warmup,
    allocation,
    pressure,
    legacyNormalized: legacyAdmission,
  };
};

export const selectRuntimeAdmissionDiagnostics = ({
  runtimeDiagnostics,
  lineUsageSnapshot,
} = {}) => {
  const runtimeAdmission =
    runtimeDiagnostics?.ibkr?.streams?.marketDataAdmission ||
    runtimeDiagnostics?.streams?.marketDataAdmission ||
    null;
  const fallbackAdmission = lineUsageSnapshot?.admission || null;
  if (hasAccountMonitorAdmission(fallbackAdmission)) {
    if (runtimeAdmission?.optionsFlowScanner && !fallbackAdmission.optionsFlowScanner) {
      return {
        ...fallbackAdmission,
        optionsFlowScanner: runtimeAdmission.optionsFlowScanner,
      };
    }
    return fallbackAdmission;
  }
  if (hasAccountMonitorAdmission(runtimeAdmission) || !fallbackAdmission) {
    return runtimeAdmission;
  }
  return fallbackAdmission;
};

export const buildRuntimeControlSnapshot = ({
  runtimeDiagnostics,
  lineUsageSnapshot,
  brokerStreamFreshness,
  flowScannerControl,
  workSchedule,
  memoryPressure,
  workloadStats,
  hydrationStats,
} = {}) => {
  const admission = selectRuntimeAdmissionDiagnostics({
    runtimeDiagnostics,
    lineUsageSnapshot,
  });
  const freshness = brokerStreamFreshness || {};
  const accountFresh = Boolean(freshness.accountFresh);
  const orderFresh = Boolean(freshness.orderFresh);
  const lineUsage = normalizeAdmissionDiagnostics(admission, lineUsageSnapshot);
  const backendFlowScannerActive = isOptionsFlowScannerRuntimeActive(admission);
  const clientFlowScannerActive = Boolean(flowScannerControl?.ownerActive);
  const massive = normalizeMassiveRuntimeDiagnostics(
    runtimeDiagnostics,
    lineUsageSnapshot,
  );
  return {
    schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
    lineUsage,
    massive,
    bridgeGovernor:
      runtimeDiagnostics?.ibkr?.governor ||
      lineUsageSnapshot?.governor ||
      null,
    streams: {
      account: {
        kind: "account",
        fresh: accountFresh,
        lastEventAt: freshness.accountLastEventAt ?? null,
        requiredForTrading: true,
      },
      order: {
        kind: "order",
        fresh: orderFresh,
        lastEventAt: freshness.orderLastEventAt ?? null,
        requiredForTrading: true,
      },
      tradingFresh: accountFresh && orderFresh,
    },
    flowScanner: {
      enabled: Boolean(flowScannerControl?.enabled),
      ownerActive: clientFlowScannerActive,
      backendActive: backendFlowScannerActive,
      active: clientFlowScannerActive || backendFlowScannerActive,
      activeWhenVisible: true,
      cadenceMs: flowScannerControl?.config?.intervalMs ?? null,
      mode: flowScannerControl?.config?.mode ?? null,
      scope: flowScannerControl?.config?.scope ?? null,
      lineUsage: lineUsage.flowScanner,
    },
    workSchedule: workSchedule || null,
    memoryPressure: memoryPressure || null,
    workloadStats: workloadStats || null,
    hydrationStats: hydrationStats || null,
  };
};

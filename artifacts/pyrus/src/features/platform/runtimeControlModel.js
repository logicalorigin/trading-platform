import { MISSING_VALUE } from "../../lib/uiTokens.jsx";
import { streamStateTokenVar } from "./streamSemantics";

const RUNTIME_CONTROL_SCHEMA_VERSION = 1;

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

const firstUsefulTimestamp = (...values) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const timestamp = Date.parse(text);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return null;
};

const formatScannerReason = (reason) => {
  if (!reason) {
    return null;
  }
  if (
    reason === "line-cap-exhausted" ||
    reason === "massive-scanner-budget-exhausted"
  ) {
    return "Massive scanner budget unavailable";
  }
  if (reason === "scanner-refill-needed") {
    return "scanner refill needed";
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
  if (reason === "massive-not-configured") {
    return "Massive options not configured";
  }
  if (reason === "massive-not-connected") {
    return "Massive options unavailable";
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

// Non-fatal reasons the flow scanner is idle-gated on: it is waiting/warming,
// not live. With 0 active lines these must NOT paint the LINE lane green — a
// scanner "waiting: scanner refill needed" is amber (pending) or idle, never
// healthy. `market-session-quiet` is genuinely idle; the others are pending.
const FLOW_SCANNER_NON_FATAL_IDLE_GATE_REASONS = new Set([
  "scanner-refill-needed",
  "live-warmup",
  "market-session-quiet",
]);

const resolveFlowScannerIdleGateReason = (admission) => {
  const scanner = admission?.optionsFlowScanner;
  if (!scanner || typeof scanner !== "object") {
    return null;
  }
  const candidates = [
    scanner.lineUtilization?.shortfallReason,
    scanner.backgroundBlockedReason,
    scanner.sessionBlockReason,
    scanner.coverage?.degradedReason,
    scanner.lastSkippedReason,
  ];
  for (const reason of candidates) {
    if (FLOW_SCANNER_NON_FATAL_IDLE_GATE_REASONS.has(reason)) {
      return reason;
    }
  }
  return null;
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
  const plannedHorizon = recordOrEmpty(scanner.plannedHorizon);
  return {
    coverageHealth:
      coverage.coverageHealth || scanner.coverageHealth || null,
    cycleScannedSymbols: firstFiniteNumber(
      coverage.cycleScannedSymbols,
      coverage.scannedSymbols,
    ),
    activeTargetSize: firstFiniteNumber(
      coverage.activeTargetSize,
      coverage.selectedSymbols,
      coverage.targetSize,
      coverage.totalSymbols,
      plannedHorizon.symbolCount,
    ),
    lastScanAgeMs: firstFiniteNumber(
      coverage.lastScanAgeMs,
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
  const httpStatus = firstFiniteNumber(request.httpStatus);
  const failureKind = String(request.errorKind || "")
    .replace(/[-_]+/g, " ")
    .trim();
  const outcome =
    request.status === "error"
      ? ` · ${failureKind || "failed"}${Number.isFinite(httpStatus) ? ` (${Math.round(httpStatus)})` : ""}`
      : Number.isFinite(resultCount)
        ? ` · ${Math.round(resultCount)} rows`
        : "";
  return `${purpose}${symbol}${timeframe}${outcome}`.trim();
};

const normalizeMassiveRuntimeDiagnostics = (runtimeDiagnostics) => {
  const runtimeMassive = recordOrEmpty(runtimeDiagnostics?.providers?.massive);
  const massive = { ...runtimeMassive };
  const observedAt = firstUsefulTimestamp(runtimeDiagnostics?.timestamp);
  const rest = {
    status: massive.status,
    lastSuccessAt: massive.lastSuccessAt,
    lastFailureAt: massive.lastFailureAt,
    lastError: massive.lastError,
    ...recordOrEmpty(runtimeMassive.rest),
  };
  const websocket = {
    ...recordOrEmpty(runtimeMassive.websocket),
  };
  const restStatus = normalizeProviderStatus(rest.status);
  const websocketStatus = normalizeProviderStatus(websocket.status);
  const status =
    restStatus === "degraded" || websocketStatus === "degraded"
      ? "degraded"
      : restStatus === "ok" || websocketStatus === "ok"
        ? "ok"
        : massive.configured === false
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
  const lastRestHttpStatus = firstFiniteNumber(lastRequest.httpStatus);

  return {
    configured: massive.configured === true,
    providerIdentity: massive.providerIdentity || null,
    baseUrlHost: massive.baseUrlHost || hostFromUrl(massive.baseUrl),
    lastSuccessAt: rest.lastSuccessAt || null,
    lastFailureAt: rest.lastFailureAt || null,
    lastError: rest.lastError || null,
    stocksRealtimeConfigured:
      massive.stocksRealtimeConfigured === true ||
      websocket.mode === "real-time",
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
      lastHttpStatus: lastRestHttpStatus,
      lastErrorKind: lastRequest.errorKind || null,
      lastDiagnosticHint: lastRequest.diagnosticHint || null,
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
      lastMessageAt: firstUsefulTimestamp(websocket.lastMessageAt),
      lastMessageAgeMs: firstFiniteNumber(websocket.lastMessageAgeMs),
      observedAt,
      reconnectCount: firstFiniteNumber(websocket.reconnectCount),
      lastError: websocket.lastError || null,
      feeds: arrayOrEmpty(websocket.feeds).map((feed) => {
        const record = recordOrEmpty(feed);
        return {
          ...record,
          subscribedSymbolCount: firstFiniteNumber(record.subscribedSymbolCount),
          activeConsumerCount: firstFiniteNumber(record.activeConsumerCount),
          eventCount: firstFiniteNumber(record.eventCount),
          lastMessageAt: firstUsefulTimestamp(record.lastMessageAt),
          lastMessageAgeMs: firstFiniteNumber(record.lastMessageAgeMs),
          reconnectCount: firstFiniteNumber(record.reconnectCount),
        };
      }),
    },
    observedAt,
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
    const shortfallReason = scanner.lineUtilization?.shortfallReason;
    if (shortfallReason) {
      const shortfallLabel = formatScannerReason(shortfallReason);
      return `waiting: ${shortfallLabel}`;
    }
    const snapshotCount = Number(scanner.deepScanner?.snapshotCount);
    const snapshotDetail =
      Number.isFinite(snapshotCount) && snapshotCount > 0
        ? formatFlowSnapshotCount(snapshotCount)
        : null;
    const blockedReason =
      scanner.backgroundBlockedReason ||
      scanner.sessionBlockReason ||
      scanner.coverage?.degradedReason;
    if (blockedReason === "live-warmup") {
      const remaining = formatRuntimeDuration(scanner.backgroundHoldRemainingMs);
      return `warming live data${remaining ? ` (${remaining})` : ""}; foreground scans allowed`;
    }
    if (blockedReason === "line-cap-exhausted") {
      return "paused: Massive scanner budget unavailable";
    }
    if (
      blockedReason === "market-data-frozen" ||
      blockedReason === "market-data-delayed-frozen"
    ) {
      return `paused: ${formatScannerReason(blockedReason)}`;
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
        return "paused: Massive scanner budget unavailable";
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

const isOptionsFlowScannerRuntimeActive = (admission) => {
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
      scanner.coverage?.currentBatch?.length ||
      scanner.lastBatch?.length,
  );
};

const selectRuntimeAdmissionDiagnostics = ({
  runtimeDiagnostics,
} = {}) => {
  const runtimeAdmission =
    runtimeDiagnostics?.ibkr?.streams?.marketDataAdmission ||
    runtimeDiagnostics?.streams?.marketDataAdmission ||
    null;
  return runtimeAdmission;
};

export const buildRuntimeControlSnapshot = ({
  runtimeDiagnostics,
  brokerStreamFreshness,
  flowScannerControl,
  workSchedule,
  memoryPressure,
  workloadStats,
  hydrationStats,
} = {}) => {
  const admission = selectRuntimeAdmissionDiagnostics({
    runtimeDiagnostics,
  });
  const freshness = brokerStreamFreshness || {};
  const accountFresh = Boolean(freshness.accountFresh);
  const orderFresh = Boolean(freshness.orderFresh);
  const backendFlowScannerActive = isOptionsFlowScannerRuntimeActive(admission);
  const clientFlowScannerActive = Boolean(flowScannerControl?.ownerActive);
  const massive = normalizeMassiveRuntimeDiagnostics(runtimeDiagnostics);
  return {
    schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
    massive,
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
      // Structured session-quiet signal so consumers can distinguish "blocked
      // because the market session is quiet" from "enabled but stuck".
      sessionBlockedReason:
        admission?.optionsFlowScanner?.backgroundBlockedReason ===
          "market-session-quiet" ||
        admission?.optionsFlowScanner?.sessionBlockReason ===
          "market-session-quiet"
          ? "market-session-quiet"
          : null,
    },
    workSchedule: workSchedule || null,
    memoryPressure: memoryPressure || null,
    workloadStats: workloadStats || null,
    hydrationStats: hydrationStats || null,
  };
};

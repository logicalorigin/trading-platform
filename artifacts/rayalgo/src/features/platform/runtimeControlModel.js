import { MISSING_VALUE } from "../../lib/uiTokens.jsx";
import { streamStateTokenVar } from "./streamSemantics";

export const RUNTIME_CONTROL_SCHEMA_VERSION = 1;
export const DEFAULT_ACCOUNT_MONITOR_LINE_CAP = 20;

const POOL_ORDER = [
  ["account-monitor", "Account monitor"],
  ["flow-scanner", "Flow scanner"],
  ["visible", "Visible"],
  ["execution", "Execution"],
  ["automation", "Automation"],
  ["convenience", "Convenience"],
];

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
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
  if (Number.isFinite(used) && used === 0) {
    const activeCount = Number(scanner.deepScanner?.activeCount);
    if (Number.isFinite(activeCount) && activeCount > 0) {
      return `${Math.round(activeCount)} option chain${Math.round(activeCount) === 1 ? "" : "s"} scanning; quotes next`;
    }
    const queuedCount = Number(scanner.deepScanner?.queuedCount);
    if (Number.isFinite(queuedCount) && queuedCount > 0) {
      return `${Math.round(queuedCount)} scan${Math.round(queuedCount) === 1 ? "" : "s"} queued`;
    }
    const snapshotCount = Number(scanner.deepScanner?.snapshotCount);
    if (Number.isFinite(snapshotCount) && snapshotCount > 0) {
      return `${Math.round(snapshotCount)} flow snapshot${Math.round(snapshotCount) === 1 ? "" : "s"} loaded; refreshing`;
    }
    const skipReason = scanner.lastSkippedReason;
    if (skipReason) {
      if (skipReason === "line-cap-exhausted") {
        return "paused: no scanner line capacity";
      }
      return `skipped: ${skipReason}`;
    }
    const blockedReason = scanner.backgroundBlockedReason;
    if (blockedReason === "live-warmup") {
      const remaining = formatRuntimeDuration(scanner.backgroundHoldRemainingMs);
      return `warming live watchlist${remaining ? ` (${remaining})` : ""}; foreground scans allowed`;
    }
    if (blockedReason === "options-lane-backoff") {
      return "paused: options lane backoff";
    }
    if (blockedReason === "options-lane-queued") {
      return "paused: options lane queued";
    }
    if (blockedReason === "line-cap-exhausted") {
      return "paused: no scanner line capacity";
    }
    if (scanner.deepScanner?.draining) {
      return "deep scan starting";
    }
    if (scanner.deepScanner?.lastRunAt || scanner.lastBatch?.length) {
      return "last scan complete; no active quote leases";
    }
    return "no active quote leases";
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
    summary: available ? `${formatRuntimeCount(used)} / ${formatRuntimeCount(cap)}` : MISSING_VALUE,
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
    api_released_bridge_active: "bridge stale",
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
  return {
    state: typeof pressure.state === "string" ? pressure.state : "unknown",
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
    usableRemainingLineCount: firstFiniteNumber(
      pressure.usableRemainingLineCount,
      admission?.usableRemainingLineCount,
    ),
  };
};

const normalizeLineAllocation = (admission, lineUsageSnapshot = null) => {
  const allocation =
    lineUsageSnapshot?.allocation && typeof lineUsageSnapshot.allocation === "object"
      ? lineUsageSnapshot.allocation
      : {};
  const policy =
    lineUsageSnapshot?.policy && typeof lineUsageSnapshot.policy === "object"
      ? lineUsageSnapshot.policy
      : {};
  const pressure =
    admission?.pressure && typeof admission.pressure === "object"
      ? admission.pressure
      : {};
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

  return {
    activeLineCount,
    targetFillLines,
    remainingToTargetLineCount:
      Number.isFinite(remainingToTargetLineCount)
        ? Math.max(0, remainingToTargetLineCount)
        : null,
    protectedLineCount: firstFiniteNumber(
      allocation.protectedLineCount,
      pressure.protectedLineCount,
    ),
    visibleLineCount: firstFiniteNumber(
      allocation.visibleLineCount,
      pressure.visibleLineCount,
    ),
    scannerActiveLineCount: firstFiniteNumber(
      allocation.scannerActiveLineCount,
      pressure.scannerActiveLineCount,
      admission?.flowScannerLineCount,
    ),
    scannerEffectiveLineCap: firstFiniteNumber(
      allocation.scannerEffectiveLineCap,
      pressure.scannerEffectiveLineCap,
    ),
    scannerRemainingLineCount: firstFiniteNumber(
      allocation.scannerRemainingLineCount,
      pressure.scannerRemainingLineCount,
    ),
    convenienceLineCount: firstFiniteNumber(
      allocation.convenienceLineCount,
      admission?.convenienceLineCount,
      admission?.poolUsage?.convenience?.activeLineCount,
      0,
    ),
    fillerLineCount: firstFiniteNumber(
      allocation.fillerLineCount,
      admission?.fillerLineCount,
      0,
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

export const isOptionsFlowScannerRuntimeActive = (admission) => {
  const scanner = admission?.optionsFlowScanner;
  if (!scanner || typeof scanner !== "object") {
    return false;
  }
  if (scanner.enabled === false || scanner.started === false) {
    return false;
  }

  return Boolean(
    scanner.started ||
      scanner.scannerAlwaysOn ||
      scanner.deepScanner?.draining ||
      scanner.deepScanner?.queuedCount > 0 ||
      scanner.deepScanner?.lastRunAt ||
      scanner.lastBatch?.length,
  );
};

export const formatRuntimeCount = (value) =>
  Number.isFinite(value)
    ? Math.max(0, Math.round(value)).toLocaleString()
    : MISSING_VALUE;

export const lineUsageState = (used, cap, degraded = false) => {
  if (degraded) return "capacity-limited";
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) {
    return "no-subscribers";
  }
  const ratio = used / cap;
  if (ratio >= 0.75) return "capacity-limited";
  return "healthy";
};

export const lineUsageTone = (used, cap, degraded = false) =>
  streamStateTokenVar(lineUsageState(used, cap, degraded));

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
    return {
      schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
      available: false,
      summary: bridge.available ? bridge.summary : MISSING_VALUE,
      demandSummary: MISSING_VALUE,
      bridgeSummary: bridge.summary,
      warnings: 0,
      rows: [],
      pools: {},
      accountMonitor: { used: 0, cap: DEFAULT_ACCOUNT_MONITOR_LINE_CAP, free: DEFAULT_ACCOUNT_MONITOR_LINE_CAP },
      flowScanner: { used: null, cap: null, free: null },
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
  const pools = {};
  const rows = POOL_ORDER.map(([id, fallbackLabel]) => {
    const pool = poolUsage[id] || {};
    const rawUsed =
      id === "account-monitor"
        ? firstFiniteNumber(pool.activeLineCount, admission.accountMonitorLineCount, 0)
        : id === "flow-scanner"
          ? firstFiniteNumber(pool.activeLineCount, admission.flowScannerLineCount)
          : id === "automation"
            ? firstFiniteNumber(pool.activeLineCount, admission.automationLineCount)
          : firstFiniteNumber(pool.activeLineCount);
    const rawCap =
      id === "account-monitor"
        ? firstFiniteNumber(
            pool.maxLines,
            budget.accountMonitorLineCap,
            DEFAULT_ACCOUNT_MONITOR_LINE_CAP,
          )
        : id === "flow-scanner"
          ? firstFiniteNumber(pool.maxLines, budget.flowScannerLineCap)
          : id === "automation"
            ? firstFiniteNumber(pool.maxLines, budget.automationLineCap)
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
        ? firstFiniteNumber(pool.effectiveMaxLines, pressure.scannerEffectiveLineCap)
        : firstFiniteNumber(pool.effectiveMaxLines, cap);
    const free =
      legacyVisibleAdjusted || !Number.isFinite(Number(pool.remainingLineCount))
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
      label: pool.label || fallbackLabel,
      used: rawUsed,
      cap,
      effectiveCap,
      free,
      detail:
        id === "flow-scanner"
          ? formatFlowScannerRuntimeDetail(admission, rawUsed)
          : null,
      strict: id === "account-monitor" ? true : Boolean(pool.strict),
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
  const demandSummary = `${formatRuntimeCount(total.used)} / ${formatRuntimeCount(total.cap)}`;
  const requestedLineCount = total.used;
  const activeLineCount = total.used;
  const pendingLineCount =
    Number.isFinite(requestedLineCount) && Number.isFinite(bridge.used)
      ? Math.max(0, requestedLineCount - bridge.used)
      : Number.isFinite(warmup.pendingLineCount)
        ? Math.max(0, warmup.pendingLineCount)
        : 0;

  return {
    schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
    available: true,
    summary: demandSummary,
    activeLineCount,
    requestedLineCount,
    pendingLineCount,
    requestedSummary: demandSummary,
    demandSummary,
    bridgeSummary: bridge.summary,
    warnings,
    rows,
    pools,
    accountMonitor: pools["account-monitor"],
    flowScanner: pools["flow-scanner"],
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
  return {
    schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
    lineUsage,
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

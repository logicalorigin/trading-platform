import { MISSING_VALUE } from "../../lib/uiTokens.jsx";
import { streamStateTokenVar } from "./streamSemantics";

export const RUNTIME_CONTROL_SCHEMA_VERSION = 1;
export const DEFAULT_ACCOUNT_MONITOR_LINE_CAP = 30;

const POOL_ORDER = [
  ["automation", "Algo & Execution"],
  ["account-monitor", "Account"],
  ["visible", "Visible Page"],
  ["watchlist", "Watchlist Quotes"],
  ["flow-scanner", "Flow Scanner"],
  ["convenience", "Filler"],
];

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
};

const recordOrEmpty = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

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
      const rounded = Math.round(activeCount);
      return `${rounded} option-chain scan${rounded === 1 ? "" : "s"} active; quotes warming`;
    }
    const queuedCount = Number(scanner.deepScanner?.queuedCount);
    if (Number.isFinite(queuedCount) && queuedCount > 0) {
      return `${Math.round(queuedCount)} scan${Math.round(queuedCount) === 1 ? "" : "s"} queued`;
    }
    const snapshotCount = Number(scanner.deepScanner?.snapshotCount);
    if (Number.isFinite(snapshotCount) && snapshotCount > 0) {
      return `${Math.round(snapshotCount)} flow snapshot${Math.round(snapshotCount) === 1 ? "" : "s"} loaded; refreshing`;
    }
    const blockedReason = scanner.backgroundBlockedReason;
    if (blockedReason === "live-warmup") {
      const remaining = formatRuntimeDuration(scanner.backgroundHoldRemainingMs);
      return `warming live watchlist${remaining ? ` (${remaining})` : ""}; foreground scans allowed`;
    }
    if (blockedReason === "line-cap-exhausted") {
      return "paused: no scanner lines available";
    }
    if (blockedReason === "resource-pressure") {
      return "degraded: resource pressure";
    }
    if (blockedReason) {
      return `paused: ${blockedReason}`;
    }
    const skipReason = scanner.lastSkippedReason;
    if (skipReason) {
      if (skipReason === "line-cap-exhausted") {
        return "paused: no scanner lines available";
      }
      return `skipped: ${skipReason}`;
    }
    if (scanner.deepScanner?.draining) {
      return "deep scan starting";
    }
    if (scanner.deepScanner?.lastRunAt || scanner.lastBatch?.length) {
      return "rotating; awaiting next batch";
    }
    return "awaiting scanner work";
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
  const watchlistTargetLineCount = firstFiniteNumber(warmup.watchlistTargetLineCount, 0);
  const watchlistPendingLineCount = firstFiniteNumber(warmup.watchlistPendingLineCount, 0);
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
    watchlistTargetLineCount,
    watchlistPendingLineCount,
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
    watchlistLineCount: firstFiniteNumber(
      pressure.watchlistLineCount,
      admission?.watchlistLineCount,
    ),
    watchlistStaticLineCap: firstFiniteNumber(
      pressure.watchlistStaticLineCap,
      admission?.budget?.watchlistLineCap,
    ),
    watchlistRemainingLineCount: firstFiniteNumber(
      pressure.watchlistRemainingLineCount,
      admission?.watchlistRemainingLineCount,
    ),
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
    elasticLineCount: firstFiniteNumber(
      allocation.elasticLineCount,
      lineAllocation.elasticLineCount,
      admission?.elasticLineCount,
      admission?.convenienceLineCount,
      0,
    ),
    reclaimableElasticLineCount: firstFiniteNumber(
      allocation.reclaimableElasticLineCount,
      lineAllocation.reclaimableElasticLineCount,
      admission?.reclaimableElasticLineCount,
      0,
    ),
    sharedElasticLineCount: firstFiniteNumber(
      allocation.sharedElasticLineCount,
      lineAllocation.sharedElasticLineCount,
      0,
    ),
    reclaimableFillerLineCount: firstFiniteNumber(
      allocation.reclaimableFillerLineCount,
      lineAllocation.reclaimableFillerLineCount,
      admission?.reclaimableFillerLineCount,
      0,
    ),
    elasticTargetLineCapacity: firstFiniteNumber(
      allocation.elasticTargetLineCapacity,
      lineAllocation.elasticTargetLineCapacity,
    ),
    elasticRemainingLineCount: firstFiniteNumber(
      allocation.elasticRemainingLineCount,
      lineAllocation.elasticRemainingLineCount,
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
    scannerSchedulableLineCap,
    scannerRemainingLineCount: firstFiniteNumber(
      scannerSchedulableRemainingLineCount ?? undefined,
      allocation.scannerRemainingLineCount,
      pressure.scannerRemainingLineCount,
    ),
    watchlistLineCount: firstFiniteNumber(
      allocation.watchlistLineCount,
      pressure.watchlistLineCount,
      admission?.watchlistLineCount,
      admission?.poolUsage?.watchlist?.activeLineCount,
      0,
    ),
    watchlistLineCap: firstFiniteNumber(
      allocation.watchlistLineCap,
      pressure.watchlistStaticLineCap,
      admission?.budget?.watchlistLineCap,
      admission?.poolUsage?.watchlist?.maxLines,
    ),
    watchlistRemainingLineCount: firstFiniteNumber(
      allocation.watchlistRemainingLineCount,
      pressure.watchlistRemainingLineCount,
      admission?.watchlistRemainingLineCount,
      admission?.poolUsage?.watchlist?.remainingLineCount,
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
  if (!Number.isFinite(used) || !Number.isFinite(cap)) {
    return "no-subscribers";
  }
  if (cap <= 0) return used > 0 ? "capacity-limited" : "no-subscribers";
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
    const signalOptions = normalizeSignalOptionsLineUsage(null, lineUsageSnapshot);
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
      watchlist: { used: null, cap: null, free: null },
      flowScanner: { used: null, cap: null, free: null },
      signalOptions,
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
  const watchlistPrewarm = recordOrEmpty(lineUsageSnapshot?.watchlistPrewarm);
  const ownerClassSummaries = recordOrEmpty(admission.ownerClasses?.summaries);
  const watchlistPrewarmOwnerClass = recordOrEmpty(
    ownerClassSummaries["watchlist-prewarm"],
  );
  const watchlistPrewarmActiveLineCount = firstFiniteNumber(
    watchlistPrewarm.primaryActiveSymbolCount,
    watchlistPrewarmOwnerClass.activeLineCount,
  );
  const watchlistPrewarmActiveLineCountOrUndefined = Number.isFinite(
    watchlistPrewarmActiveLineCount,
  )
    ? watchlistPrewarmActiveLineCount
    : undefined;
  const watchlistPrewarmPrimaryLineCap = firstFiniteNumber(
    watchlistPrewarm.primarySymbolLimit,
  );
  const watchlistPrewarmLineCap =
    Number.isFinite(watchlistPrewarmActiveLineCount) &&
    watchlistPrewarmActiveLineCount > 0
      ? firstFiniteNumber(
          Number.isFinite(watchlistPrewarmPrimaryLineCap) &&
            watchlistPrewarmPrimaryLineCap > 0
            ? watchlistPrewarmPrimaryLineCap
            : undefined,
          budget.visibleLineCap,
          admission.visibleLineCap,
        )
      : watchlistPrewarmPrimaryLineCap;
  const watchlistPrewarmLineCapOrUndefined = Number.isFinite(
    watchlistPrewarmLineCap,
  )
    ? watchlistPrewarmLineCap
    : undefined;
  const pools = {};
  const rows = POOL_ORDER.map(([id, fallbackLabel]) => {
    const pool = poolUsage[id] || {};
    const accountDetails =
      admission.accountMonitor && typeof admission.accountMonitor === "object"
        ? admission.accountMonitor
        : {};
    const elasticPool = Boolean(pool.elastic || id === "convenience");
    const dynamicPool = Boolean(pool.dynamic);
    const rawUsed =
      id === "account-monitor"
        ? firstFiniteNumber(pool.activeLineCount, admission.accountMonitorLineCount, 0)
        : id === "flow-scanner"
          ? firstFiniteNumber(pool.activeLineCount, admission.flowScannerLineCount)
          : id === "watchlist"
            ? firstFiniteNumber(
                watchlistPrewarmActiveLineCountOrUndefined,
                pool.activeLineCount,
                admission.watchlistLineCount,
                allocation.watchlistLineCount,
              )
          : id === "automation"
            ? firstFiniteNumber(
                admission.automationExecutionLineCount,
                pool.activeLineCount,
                admission.automationLineCount,
              )
            : id === "convenience"
              ? firstFiniteNumber(
                  pool.reclaimableLineCount,
                  pool.chargedLineCount,
                  allocation.reclaimableElasticLineCount,
                  pool.activeLineCount,
                )
              : firstFiniteNumber(pool.activeLineCount);
    const activeLineCount =
      id === "automation" || id === "watchlist"
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
          : id === "watchlist"
            ? firstFiniteNumber(
                watchlistPrewarmLineCapOrUndefined,
                pool.maxLines,
                budget.watchlistLineCap,
                allocation.watchlistLineCap,
              )
          : id === "automation"
            ? firstFiniteNumber(
                pool.effectiveMaxLines,
                pool.maxLines,
                budget.automationExecutionLineCap,
                budget.automationLineCap,
              )
            : id === "convenience"
              ? firstFiniteNumber(
                  pool.effectiveMaxLines,
                  allocation.elasticTargetLineCapacity,
                  pool.maxLines,
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
        : id === "convenience"
          ? firstFiniteNumber(
              pool.effectiveMaxLines,
              allocation.elasticTargetLineCapacity,
              cap,
            )
        : id === "watchlist"
          ? cap
        : firstFiniteNumber(pool.effectiveMaxLines, cap);
    const free =
      id === "watchlist" &&
      Number.isFinite(effectiveCap) &&
      Number.isFinite(rawUsed)
        ? Math.max(0, effectiveCap - rawUsed)
        : id === "flow-scanner" &&
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
      elastic: elasticPool,
      reclaimableLineCount: firstFiniteNumber(
        pool.reclaimableLineCount,
        allocation.reclaimableElasticLineCount,
      ),
      sharedLineCount: firstFiniteNumber(
        pool.sharedLineCount,
        allocation.sharedElasticLineCount,
      ),
      detail:
        id === "account-monitor"
          ? `${formatRuntimeCount(firstFiniteNumber(accountDetails.coveredLineCount, rawUsed, 0))} covered of ${formatRuntimeCount(firstFiniteNumber(accountDetails.neededLineCount, rawUsed, 0))} needed`
          : id === "watchlist"
          ? `${formatRuntimeCount(activeLineCount)} active of ${formatRuntimeCount(effectiveCap ?? cap)} reserved`
          : id === "flow-scanner"
          ? formatFlowScannerRuntimeDetail(admission, rawUsed)
          : id === "automation"
            ? `${formatRuntimeCount(firstFiniteNumber(admission.executionLineCount, 0))} execution · ${formatRuntimeCount(firstFiniteNumber(admission.automationLineCount, 0))} algo`
          : id === "convenience"
            ? `${formatRuntimeCount(activeLineCount)} active of ${formatRuntimeCount(rawUsed)} reclaimable`
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
    watchlist: pools.watchlist,
    flowScanner: pools["flow-scanner"],
    signalOptions,
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

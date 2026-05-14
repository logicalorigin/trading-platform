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
  const skipReason = scanner.lastSkippedReason;
  if (skipReason) {
    return `skipped: ${skipReason}`;
  }
  if (Number.isFinite(used) && used === 0) {
    if (scanner.deepScanner?.draining) {
      return "deep scan queued";
    }
    if (scanner.deepScanner?.lastRunAt || scanner.lastBatch?.length) {
      return "last scan complete; no active quote leases";
    }
    return "no active quote leases";
  }
  return null;
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

export const normalizeAdmissionDiagnostics = (admission) => {
  if (!admission || typeof admission !== "object") {
    return {
      schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
      available: false,
      summary: MISSING_VALUE,
      warnings: 0,
      rows: [],
      pools: {},
      accountMonitor: { used: 0, cap: DEFAULT_ACCOUNT_MONITOR_LINE_CAP, free: DEFAULT_ACCOUNT_MONITOR_LINE_CAP },
      flowScanner: { used: null, cap: null, free: null },
      total: { used: null, cap: null, free: null },
      legacyNormalized: false,
    };
  }

  const budget = admission.budget || {};
  const poolUsage = admission.poolUsage || {};
  const legacyAdmission = !hasAccountMonitorAdmission(admission);
  const warnings = sumAdmissionActions(admission, ["rejected", "demoted"]);
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
    const free =
      legacyVisibleAdjusted || !Number.isFinite(Number(pool.remainingLineCount))
        ? Number.isFinite(cap) && Number.isFinite(rawUsed)
          ? Math.max(0, cap - rawUsed)
          : null
        : Number(pool.remainingLineCount);
    const streamState = lineUsageState(rawUsed, cap, warnings > 0 && id === "flow-scanner");
    const row = {
      id,
      label: pool.label || fallbackLabel,
      used: rawUsed,
      cap,
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

  return {
    schemaVersion: RUNTIME_CONTROL_SCHEMA_VERSION,
    available: true,
    summary: `${formatRuntimeCount(total.used)} / ${formatRuntimeCount(total.cap)}`,
    warnings,
    rows,
    pools,
    accountMonitor: pools["account-monitor"],
    flowScanner: pools["flow-scanner"],
    total,
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
  const lineUsage = normalizeAdmissionDiagnostics(admission);
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

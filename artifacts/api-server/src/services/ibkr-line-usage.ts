import {
  IbkrBridgeClient,
  type BridgeLaneDiagnosticsSnapshot,
} from "../providers/ibkr/bridge-client";
import { normalizeSymbol } from "../lib/values";
import {
  getBridgeGovernorConfigSnapshot,
  getBridgeGovernorSnapshot,
} from "./bridge-governor";
import { getBridgeOptionQuoteStreamDiagnostics } from "./bridge-option-quote-stream";
import { getBridgeQuoteStreamDiagnostics } from "./bridge-quote-stream";
import {
  getMarketDataAdmissionDiagnostics,
  setMarketDataAdmissionBridgeLineBudget,
  type MarketDataLease,
} from "./market-data-admission";
import { getIbkrHistoricalAdmissionSnapshot } from "./ibkr-historical-admission";
import { ensureIbkrLaneRuntimeOverridesLoaded } from "./ibkr-lanes";
import {
  getOptionsFlowScannerDiagnostics,
} from "./platform";
import { getStockAggregateStreamDiagnostics } from "./stock-aggregate-stream";

type CachedBridgeLaneDiagnostics = {
  fetchedAt: number;
  value: BridgeLaneDiagnosticsSnapshot | null;
  error: string | null;
};

type BridgeLaneDiagnosticsClient = Pick<IbkrBridgeClient, "getLaneDiagnostics">;
type DriftGroup = {
  owner: string | null;
  intent: string | null;
  pool: string | null;
  assetClass: string | null;
  lineCount: number;
  leaseCount: number;
  lineSample: string[];
};

const BRIDGE_LANE_USAGE_CACHE_MS = 2_000;
const DEFAULT_BRIDGE_LANE_USAGE_TIMEOUT_MS = 1_500;
const PERSISTENT_BRIDGE_ONLY_OBSERVATION_COUNT = 2;
const PERSISTENT_BRIDGE_ONLY_GRACE_MS = 10_000;
let cachedBridgeLaneDiagnostics: CachedBridgeLaneDiagnostics | null = null;
let bridgeLaneDiagnosticsPromise: Promise<CachedBridgeLaneDiagnostics> | null = null;
let bridgeLaneDiagnosticsStartedAt = 0;
let bridgeLaneDiagnosticsRequestId = 0;
const bridgeOnlyLineObservations = new Map<
  string,
  {
    lineId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    observedCount: number;
  }
>();
let bridgeLaneDiagnosticsClientFactory: () => BridgeLaneDiagnosticsClient = () =>
  new IbkrBridgeClient();

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bridgeLaneUsageTimeoutMs(): number {
  return readPositiveIntegerEnv(
    "IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS",
    DEFAULT_BRIDGE_LANE_USAGE_TIMEOUT_MS,
  );
}

function bridgeLaneUsageStaleInFlightMs(): number {
  return Math.max(30_000, bridgeLaneUsageTimeoutMs() * 4);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "IBKR bridge line usage is unavailable.";
}

function timedOutBridgeLaneDiagnostics(
  timeoutMs: number,
): CachedBridgeLaneDiagnostics {
  const cached = cachedBridgeLaneDiagnostics;
  return {
    fetchedAt: Date.now(),
    value: cached?.value ?? null,
    error: cached?.value
      ? `IBKR bridge lane diagnostics timed out after ${timeoutMs}ms; using cached bridge lanes.`
      : `IBKR bridge lane diagnostics timed out after ${timeoutMs}ms.`,
  };
}

function resolveBridgeLaneDiagnosticsWithin(
  promise: Promise<CachedBridgeLaneDiagnostics>,
  timeoutMs: number,
): Promise<CachedBridgeLaneDiagnostics> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(timedOutBridgeLaneDiagnostics(timeoutMs));
    }, timeoutMs);
    timeout.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        resolve({
          fetchedAt: Date.now(),
          value: cachedBridgeLaneDiagnostics?.value ?? null,
          error: getErrorMessage(error),
        });
      },
    );
  });
}

function startBridgeLaneDiagnosticsRequest(
  now: number,
): Promise<CachedBridgeLaneDiagnostics> {
  const requestId = ++bridgeLaneDiagnosticsRequestId;
  bridgeLaneDiagnosticsStartedAt = now;
  const request = bridgeLaneDiagnosticsClientFactory()
    .getLaneDiagnostics()
    .then((value) => ({
      fetchedAt: Date.now(),
      value,
      error: null,
    }))
    .catch((error) => ({
      fetchedAt: Date.now(),
      value: null,
      error: getErrorMessage(error),
    }))
    .then((snapshot) => {
      if (bridgeLaneDiagnosticsRequestId === requestId) {
        cachedBridgeLaneDiagnostics = snapshot;
      }
      return snapshot;
    })
    .finally(() => {
      if (bridgeLaneDiagnosticsRequestId === requestId) {
        bridgeLaneDiagnosticsPromise = null;
      }
    });
  bridgeLaneDiagnosticsPromise = request;
  return request;
}

async function getCachedBridgeLaneDiagnostics(): Promise<CachedBridgeLaneDiagnostics> {
  const now = Date.now();
  const timeoutMs = bridgeLaneUsageTimeoutMs();
  if (
    cachedBridgeLaneDiagnostics &&
    now - cachedBridgeLaneDiagnostics.fetchedAt < BRIDGE_LANE_USAGE_CACHE_MS
  ) {
    return cachedBridgeLaneDiagnostics;
  }
  if (
    !bridgeLaneDiagnosticsPromise ||
    now - bridgeLaneDiagnosticsStartedAt > bridgeLaneUsageStaleInFlightMs()
  ) {
    startBridgeLaneDiagnosticsRequest(now);
  }
  const pending = bridgeLaneDiagnosticsPromise;
  if (!pending) {
    return timedOutBridgeLaneDiagnostics(timeoutMs);
  }

  return resolveBridgeLaneDiagnosticsWithin(
    pending,
    timeoutMs,
  );
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function lineDriftSample(values: Set<string>): string[] {
  return Array.from(values).sort().slice(0, 20);
}

function lineAssetClass(lineId: string): string | null {
  if (lineId.startsWith("equity:")) {
    return "equity";
  }
  if (lineId.startsWith("option:")) {
    return "option";
  }
  return null;
}

function isSnapshotOnlyAdmissionLease(lease: MarketDataLease): boolean {
  return lease.intent === "flow-scanner-live" && lease.assetClass === "option";
}

function buildAdmissionLineIdSets(
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>,
): {
  all: Set<string>;
  comparable: Set<string>;
  snapshotOnly: Set<string>;
} {
  const all = new Set<string>();
  const comparable = new Set<string>();
  const snapshotOnly = new Set<string>();
  admission.leases.forEach((lease) => {
    lease.lineIds.forEach((lineId) => {
      all.add(lineId);
      if (isSnapshotOnlyAdmissionLease(lease)) {
        snapshotOnly.add(lineId);
      } else {
        comparable.add(lineId);
      }
    });
  });
  comparable.forEach((lineId) => snapshotOnly.delete(lineId));
  return { all, comparable, snapshotOnly };
}

function buildBridgeLineIds(subscriptions: Record<string, unknown>): Set<string> {
  const result = new Set<string>();
  readStringArray(subscriptions.activeEquitySymbols).forEach((symbol) => {
    const normalized = normalizeSymbol(symbol);
    if (normalized) {
      result.add(`equity:${normalized}`);
    }
  });
  readStringArray(subscriptions.activeOptionProviderContractIds).forEach(
    (providerContractId) => {
      const normalized = providerContractId.trim();
      if (normalized) {
        result.add(`option:${normalized}`);
      }
    },
  );
  return result;
}

function classifyLineDrift(input: {
  apiOnlyCount: number;
  bridgeOnlyCount: number;
  bridgeDiagnosticsAvailable: boolean;
}):
  | "matched"
  | "api_released_bridge_active"
  | "api_active_bridge_missing"
  | "mixed"
  | "unknown" {
  if (!input.bridgeDiagnosticsAvailable) {
    return "unknown";
  }
  if (input.apiOnlyCount > 0 && input.bridgeOnlyCount > 0) {
    return "mixed";
  }
  if (input.bridgeOnlyCount > 0) {
    return "api_released_bridge_active";
  }
  if (input.apiOnlyCount > 0) {
    return "api_active_bridge_missing";
  }
  return "matched";
}

function buildApiOnlyLineGroups(input: {
  lineIds: Set<string>;
  leases: MarketDataLease[];
}): DriftGroup[] {
  const groups = new Map<
    string,
    DriftGroup & { lines: Set<string>; leases: Set<string> }
  >();
  input.leases.forEach((lease) => {
    const matchingLineIds = lease.lineIds.filter((lineId) =>
      input.lineIds.has(lineId),
    );
    if (matchingLineIds.length === 0) {
      return;
    }
    const key = `${lease.owner}\u0000${lease.intent}\u0000${lease.pool}`;
    const group =
      groups.get(key) ??
      {
        owner: lease.owner,
        intent: lease.intent,
        pool: lease.pool,
        assetClass: null,
        lineCount: 0,
        leaseCount: 0,
        lineSample: [],
        lines: new Set<string>(),
        leases: new Set<string>(),
      };
    matchingLineIds.forEach((lineId) => group.lines.add(lineId));
    group.leases.add(lease.id);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      owner: group.owner,
      intent: group.intent,
      pool: group.pool,
      assetClass: group.assetClass,
      lineCount: group.lines.size,
      leaseCount: group.leases.size,
      lineSample: lineDriftSample(group.lines),
    }))
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        String(left.owner).localeCompare(String(right.owner)),
    )
    .slice(0, 20);
}

function buildBridgeOnlyLineGroups(lineIds: Set<string>): DriftGroup[] {
  const groups = new Map<string, Set<string>>();
  lineIds.forEach((lineId) => {
    const assetClass = lineAssetClass(lineId) ?? "unknown";
    const group = groups.get(assetClass) ?? new Set<string>();
    group.add(lineId);
    groups.set(assetClass, group);
  });

  return Array.from(groups.entries())
    .map(([assetClass, lines]) => ({
      owner: null,
      intent: null,
      pool: null,
      assetClass,
      lineCount: lines.size,
      leaseCount: 0,
      lineSample: lineDriftSample(lines),
    }))
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        String(left.assetClass).localeCompare(String(right.assetClass)),
    );
}

function updateBridgeOnlyLineObservations(lineIds: Set<string>) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  Array.from(bridgeOnlyLineObservations.keys()).forEach((lineId) => {
    if (!lineIds.has(lineId)) {
      bridgeOnlyLineObservations.delete(lineId);
    }
  });
  lineIds.forEach((lineId) => {
    const existing = bridgeOnlyLineObservations.get(lineId);
    bridgeOnlyLineObservations.set(lineId, {
      lineId,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      observedCount: (existing?.observedCount ?? 0) + 1,
    });
  });
  return Array.from(bridgeOnlyLineObservations.values())
    .filter(
      (entry) =>
        lineIds.has(entry.lineId) &&
        entry.observedCount >= PERSISTENT_BRIDGE_ONLY_OBSERVATION_COUNT &&
        nowMs - Date.parse(entry.firstSeenAt) >= PERSISTENT_BRIDGE_ONLY_GRACE_MS,
    )
    .sort((left, right) => left.lineId.localeCompare(right.lineId));
}

function buildLineDriftReconciliation(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  subscriptions: Record<string, unknown>;
  bridgeDiagnosticsAvailable: boolean;
}) {
  const apiLineSets = buildAdmissionLineIdSets(input.admission);
  const apiLineIds = apiLineSets.comparable;
  const bridgeLineIds = input.bridgeDiagnosticsAvailable
    ? buildBridgeLineIds(input.subscriptions)
    : new Set<string>();
  const apiOnlyLineIds = new Set(
    Array.from(apiLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const bridgeOnlyLineIds = new Set(
    Array.from(bridgeLineIds).filter((lineId) => !apiLineIds.has(lineId)),
  );
  const matchedLineIds = new Set(
    Array.from(apiLineIds).filter((lineId) => bridgeLineIds.has(lineId)),
  );
  const persistentBridgeOnlyLines = input.bridgeDiagnosticsAvailable
    ? updateBridgeOnlyLineObservations(bridgeOnlyLineIds)
    : [];

  return {
    status: classifyLineDrift({
      apiOnlyCount: apiOnlyLineIds.size,
      bridgeOnlyCount: bridgeOnlyLineIds.size,
      bridgeDiagnosticsAvailable: input.bridgeDiagnosticsAvailable,
    }),
    apiLineCount: apiLineIds.size,
    totalApiLineCount: apiLineSets.all.size,
    snapshotOnlyApiLineCount: apiLineSets.snapshotOnly.size,
    bridgeLineCount: bridgeLineIds.size,
    matchedLineCount: matchedLineIds.size,
    apiOnlyLineCount: apiOnlyLineIds.size,
    bridgeOnlyLineCount: bridgeOnlyLineIds.size,
    snapshotOnlyApiLineSample: lineDriftSample(apiLineSets.snapshotOnly),
    apiOnlyLineSample: lineDriftSample(apiOnlyLineIds),
    bridgeOnlyLineSample: lineDriftSample(bridgeOnlyLineIds),
    snapshotOnlyApiGroups: buildApiOnlyLineGroups({
      lineIds: apiLineSets.snapshotOnly,
      leases: input.admission.leases,
    }),
    apiOnlyGroups: buildApiOnlyLineGroups({
      lineIds: apiOnlyLineIds,
      leases: input.admission.leases,
    }),
    bridgeOnlyGroups: buildBridgeOnlyLineGroups(bridgeOnlyLineIds),
    persistentBridgeOnlyGraceMs: PERSISTENT_BRIDGE_ONLY_GRACE_MS,
    persistentBridgeOnlyLineCount: persistentBridgeOnlyLines.length,
    persistentBridgeOnlyLineSample: persistentBridgeOnlyLines
      .map((entry) => entry.lineId)
      .slice(0, 20),
    persistentBridgeOnlyLines: persistentBridgeOnlyLines.slice(0, 20),
  };
}

function liveSurfaceForLease(
  lease: MarketDataLease,
): "account" | "visible" | null {
  if (lease.intent === "account-monitor-live") {
    return "account";
  }
  if (lease.intent === "visible-live") {
    return "visible";
  }
  return null;
}

function lineSymbol(lineId: string): string {
  if (lineId.startsWith("equity:")) {
    return lineId.slice("equity:".length);
  }
  if (lineId.startsWith("option:")) {
    return lineId.slice("option:".length);
  }
  return lineId;
}

function buildWarmupCoverage(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  subscriptions: Record<string, unknown>;
  bridgeDiagnosticsAvailable: boolean;
}) {
  const bridgeLineIds = input.bridgeDiagnosticsAvailable
    ? buildBridgeLineIds(input.subscriptions)
    : new Set<string>();
  const targetLineIds = new Set<string>();
  const accountLineIds = new Set<string>();
  const visibleLineIds = new Set<string>();
  const targetSymbols = new Set<string>();

  input.admission.leases.forEach((lease) => {
    const surface = liveSurfaceForLease(lease);
    if (!surface) {
      return;
    }
    lease.lineIds.forEach((lineId) => {
      targetLineIds.add(lineId);
      if (surface === "account") {
        accountLineIds.add(lineId);
      } else {
        visibleLineIds.add(lineId);
      }
      targetSymbols.add(lineSymbol(lineId));
    });
  });

  const pendingLineIds = new Set(
    Array.from(targetLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const activeLineIds = new Set(
    Array.from(targetLineIds).filter((lineId) => bridgeLineIds.has(lineId)),
  );
  const accountPendingLineIds = new Set(
    Array.from(accountLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const visiblePendingLineIds = new Set(
    Array.from(visibleLineIds).filter((lineId) => !bridgeLineIds.has(lineId)),
  );
  const coverageRatio =
    targetLineIds.size > 0 ? activeLineIds.size / targetLineIds.size : null;

  return {
    state: !input.bridgeDiagnosticsAvailable
      ? "unknown"
      : targetLineIds.size === 0
        ? "idle"
        : pendingLineIds.size > 0
          ? "pending"
          : "covered",
    targetLineCount: targetLineIds.size,
    activeBridgeLineCount: activeLineIds.size,
    pendingLineCount: pendingLineIds.size,
    accountTargetLineCount: accountLineIds.size,
    accountPendingLineCount: accountPendingLineIds.size,
    visibleTargetLineCount: visibleLineIds.size,
    visiblePendingLineCount: visiblePendingLineIds.size,
    coverageRatio,
    targetSymbolCount: targetSymbols.size,
    pendingLineSample: lineDriftSample(pendingLineIds),
    accountPendingLineSample: lineDriftSample(accountPendingLineIds),
    visiblePendingLineSample: lineDriftSample(visiblePendingLineIds),
  };
}

function buildLineUsagePolicy(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  bridgeLineBudget: number | null;
}) {
  const budget = input.admission.budget;
  return {
    policy: input.admission.pressure.policy,
    maxLines: budget.maxLines,
    reserveLines: budget.reserveLines,
    usableLines: budget.usableLines,
    targetFillLines: budget.targetFillLines,
    configuredMaxLines: budget.configuredMaxLines,
    bridgeLineBudget: input.bridgeLineBudget ?? budget.bridgeLineBudget,
    bridgeLineBudgetObservedAt: budget.bridgeLineBudgetObservedAt,
    budgetSource: budget.budgetSource,
    executionLineCap: budget.poolLineCaps.execution,
    accountMonitorLineCap: budget.accountMonitorLineCap,
    accountMonitorDynamic: true,
    automationLineCap: budget.automationLineCap,
    scannerStaticLineCap: budget.flowScannerLineCap,
    scannerDynamicLineCap: input.admission.pressure.scannerDynamicLineCap,
    optionReserveLineCount: input.admission.pressure.optionReserveLineCount,
    nonScannerOptionLineCount: input.admission.pressure.nonScannerOptionLineCount,
  };
}

function buildLineAllocation(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  bridgeActiveLineCount: number | null;
  bridgeLineBudget: number | null;
}) {
  const admission = input.admission;
  const pressure = admission.pressure;
  const lineAllocation = admission.lineAllocation;
  const portfolio = admission.portfolio;
  const scannerLineUtilization = (
    admission as ReturnType<typeof getMarketDataAdmissionDiagnostics> & {
      optionsFlowScanner?: ReturnType<typeof getOptionsFlowScannerDiagnostics>;
    }
  ).optionsFlowScanner?.lineUtilization;
  const targetFillLines = readNumber(admission.budget.targetFillLines);
  const activeLineCount = readNumber(admission.activeLineCount);
  const scannerSchedulableLineCap = readNumber(
    scannerLineUtilization?.schedulablePoolCap,
  );
  const scannerActiveLineCount = readNumber(pressure.scannerActiveLineCount);
  const scannerSchedulableRemainingLineCount =
    scannerSchedulableLineCap === null || scannerActiveLineCount === null
      ? null
      : Math.max(0, scannerSchedulableLineCap - scannerActiveLineCount);
  const remainingToTargetLineCount =
    targetFillLines === null || activeLineCount === null
      ? null
      : Math.max(0, targetFillLines - activeLineCount);

  return {
    activeLineCount,
    activeEquityLineCount: readNumber(admission.activeEquityLineCount),
    routineEquityLineCount: readNumber(admission.routineEquityLineCount),
    optionSupportEquityLineCount: readNumber(
      admission.optionSupportEquityLineCount,
    ),
    manualDepthEquityLineCount: readNumber(admission.manualDepthEquityLineCount),
    targetFillLines,
    remainingToTargetLineCount,
    utilizationLevel:
      typeof pressure.utilizationLevel === "string"
        ? pressure.utilizationLevel
        : null,
    utilizationPercent: readNumber(pressure.utilizationPercent),
    usableRemainingLineCount: readNumber(admission.usableRemainingLineCount),
    protectedLineCount: readNumber(
      lineAllocation.protectedLineCount,
      pressure.protectedLineCount,
    ),
    visibleLineCount: readNumber(pressure.visibleLineCount),
    scannerActiveLineCount,
    scannerEffectiveLineCap: readNumber(pressure.scannerEffectiveLineCap),
    scannerSchedulableLineCap,
    scannerRemainingLineCount: readNumber(pressure.scannerRemainingLineCount),
    scannerSchedulableRemainingLineCount,
    scannerConstrainedByActiveDemand: Boolean(
      pressure.scannerConstrainedByActiveDemand,
    ),
    scannerDynamicLineCap: readNumber(pressure.scannerDynamicLineCap),
    optionBudgetLineCount: readNumber(pressure.optionBudgetLineCount),
    nonScannerOptionLineCount: readNumber(pressure.nonScannerOptionLineCount),
    optionReserveLineCount: readNumber(pressure.optionReserveLineCount),
    bridgeActiveLineCount: input.bridgeActiveLineCount,
    bridgeLineBudget: input.bridgeLineBudget,
    portfolioPolicy:
      typeof portfolio?.policy === "string" ? portfolio.policy : null,
    pinnedLineCount: readNumber(portfolio?.pinned?.activeLineCount),
    priorityLineCount: readNumber(portfolio?.priority?.activeLineCount),
    scannerRotatingLineCount: readNumber(
      portfolio?.scannerRotating?.activeLineCount,
    ),
    rotatingReclaimableLineCount: readNumber(
      portfolio?.rotatingReclaimableLineCount,
    ),
  };
}

function buildLineUtilizationAudit(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics> & {
    optionsFlowScanner: ReturnType<typeof getOptionsFlowScannerDiagnostics>;
  };
  allocation: ReturnType<typeof buildLineAllocation>;
  bridgeActiveLineCount: number | null;
  bridgeLineBudget: number | null;
  driftReconciliation: ReturnType<typeof buildLineDriftReconciliation>;
}) {
  const admission = input.admission;
  const scannerUtilization = admission.optionsFlowScanner.lineUtilization;
  const idleToTargetLineCount = readNumber(
    input.allocation.remainingToTargetLineCount,
  );
  const bridgeRemainingLineCount =
    input.bridgeLineBudget === null || input.bridgeActiveLineCount === null
      ? null
      : Math.max(0, input.bridgeLineBudget - input.bridgeActiveLineCount);
  const scannerUnusedPoolLineCount = readNumber(
    scannerUtilization.unusedPoolLines,
  );
  const scannerActiveLineCount = readNumber(admission.flowScannerLineCount) ?? 0;
  const deepScanner = admission.optionsFlowScanner.deepScanner;
  const scannerWorkActive =
    scannerActiveLineCount > 0 ||
    Boolean(deepScanner.draining) ||
    deepScanner.activeCount > 0 ||
    deepScanner.queuedCount > 0;
  const scannerReclaimableLineCount =
    readNumber(admission.portfolio?.rotatingReclaimableLineCount) ?? 0;
  const scannerPressureLevel =
    admission.optionsFlowScanner.scannerPressure?.level ??
    admission.optionsFlowScanner.resourcePressure?.level ??
    "normal";
  const scannerThrottledHighPressure =
    (Boolean(admission.optionsFlowScanner.scannerPressure?.throttled) ||
      scannerPressureLevel === "high" ||
      scannerPressureLevel === "critical") &&
    Number(admission.optionsFlowScanner.lineUtilization?.effectiveConcurrency) <= 1 &&
    scannerWorkActive;
  const admissionVsBridgeLineDelta =
    input.driftReconciliation.status === "unknown"
      ? input.bridgeActiveLineCount === null
        ? null
        : admission.activeLineCount - input.bridgeActiveLineCount
      : input.driftReconciliation.apiLineCount -
        input.driftReconciliation.bridgeLineCount;
  const topLimitingReason =
    admission.optionsFlowScanner.backgroundBlockedReason === "resource-pressure"
      ? "critical-scanner-shed"
      : scannerThrottledHighPressure
        ? "scanner-throttled-high-pressure"
        : idleToTargetLineCount === 0 && scannerReclaimableLineCount > 0
          ? "scanner-filling-unused-capacity"
          : idleToTargetLineCount === 0
            ? "target-filled"
      : bridgeRemainingLineCount === 0
        ? "bridge-budget-full"
        : input.driftReconciliation.status === "unknown"
          ? "bridge-diagnostics-unavailable"
          : scannerWorkActive
            ? "scanner-active"
          : admission.optionsFlowScanner.backgroundBlockedReason
            ? `scanner-${admission.optionsFlowScanner.backgroundBlockedReason}`
            : input.driftReconciliation.status !== "matched"
                ? "line-drift"
                : "active-demand-satisfied";

  return {
    targetLineCount: admission.budget.targetFillLines,
    admissionActiveLineCount: admission.activeLineCount,
    idleToTargetLineCount,
    bridgeActiveLineCount: input.bridgeActiveLineCount,
    bridgeLineBudget: input.bridgeLineBudget,
    bridgeRemainingLineCount,
    admissionVsBridgeLineDelta,
    driftStatus: input.driftReconciliation.status,
    topLimitingReason,
    scanner: {
      activeLineCount: scannerActiveLineCount,
      staticLineCap: admission.budget.flowScannerLineCap,
      effectiveLineCap: scannerUtilization.effectivePoolCap,
      configuredConcurrency: scannerUtilization.configuredConcurrency,
      effectiveConcurrency: scannerUtilization.effectiveConcurrency,
      scannerLineBudget: scannerUtilization.scannerLineBudget,
      maxDeepScanLines: scannerUtilization.maxDeepScanLines,
      unusedPoolLineCount: scannerUnusedPoolLineCount,
      backgroundBlockedReason:
        admission.optionsFlowScanner.backgroundBlockedReason,
      scannerFillMode: admission.optionsFlowScanner.scannerFillMode,
      limitingReason: admission.optionsFlowScanner.limitingReason,
      activeDeepScanCount: deepScanner.activeCount,
      queuedDeepScanCount: deepScanner.queuedCount,
      draining: deepScanner.draining,
      recentRotatedCount:
        admission.flowScannerActivity?.recentRotatedCount ?? 0,
      recentRejectedCount:
        admission.flowScannerActivity?.recentRejectedCount ?? 0,
      reclaimableLineCount: scannerReclaimableLineCount,
    },
  };
}

function buildAccountMonitorLineUsage(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  warmup: ReturnType<typeof buildWarmupCoverage>;
}) {
  const admissionAccount = input.admission.accountMonitor;
  return {
    dynamic: Boolean(admissionAccount.dynamic),
    lineCap: admissionAccount.lineCap,
    neededLineCount: admissionAccount.neededLineCount,
    coveredLineCount: admissionAccount.coveredLineCount,
    deferredLineCount: admissionAccount.deferredLineCount,
    availableExpansionLineCount: admissionAccount.availableExpansionLineCount,
    activeLineCount: admissionAccount.activeLineCount,
    remainingLineCount: admissionAccount.remainingLineCount,
    leaseCount: admissionAccount.leaseCount,
    ownerCount: admissionAccount.ownerCount,
    activeLineSample: admissionAccount.activeLineSample,
    activeSymbolSample: admissionAccount.activeSymbolSample,
    recentRejectedCount: admissionAccount.recentRejectedCount,
    recentRejectedLineSample: admissionAccount.recentRejectedLineSample,
    pendingLineCount: input.warmup.accountPendingLineCount,
    pendingLineSample: input.warmup.accountPendingLineSample,
    targetLineCount: input.warmup.accountTargetLineCount,
  };
}

export async function getIbkrLineUsageSnapshot() {
  ensureIbkrLaneRuntimeOverridesLoaded();
  const bridge = await getCachedBridgeLaneDiagnostics();
  const subscriptions =
    bridge.value && typeof bridge.value.subscriptions === "object"
      ? (bridge.value.subscriptions as Record<string, unknown>)
      : {};
  const bridgeActiveLines = readNumber(subscriptions.activeQuoteSubscriptions);
  const bridgeLineBudget = readNumber(subscriptions.marketDataLineBudget);
  if (bridgeLineBudget !== null) {
    setMarketDataAdmissionBridgeLineBudget(bridgeLineBudget, bridge.fetchedAt);
  }
  const admission = {
    ...getMarketDataAdmissionDiagnostics(),
    optionsFlowScanner: getOptionsFlowScannerDiagnostics(),
  };
  const quoteStreams = getBridgeQuoteStreamDiagnostics();
  const optionQuoteStreams = getBridgeOptionQuoteStreamDiagnostics();
  const stockAggregates = getStockAggregateStreamDiagnostics();
  const warmup = buildWarmupCoverage({
    admission,
    subscriptions,
    bridgeDiagnosticsAvailable: Boolean(bridge.value),
  });
  const driftReconciliation = buildLineDriftReconciliation({
    admission,
    subscriptions,
    bridgeDiagnosticsAvailable: Boolean(bridge.value),
  });
  const allocation = buildLineAllocation({
    admission,
    bridgeActiveLineCount: bridgeActiveLines,
    bridgeLineBudget,
  });
  const lineUtilizationAudit = buildLineUtilizationAudit({
    admission,
    allocation,
    bridgeActiveLineCount: bridgeActiveLines,
    bridgeLineBudget,
    driftReconciliation,
  });

  return {
    updatedAt: new Date().toISOString(),
    admission,
    historicalWork: {
      admission: getIbkrHistoricalAdmissionSnapshot(),
      bridge:
        bridge.value &&
        typeof bridge.value.scheduler === "object" &&
        bridge.value.scheduler &&
        "historical" in bridge.value.scheduler
          ? (bridge.value.scheduler as Record<string, unknown>).historical ?? null
          : null,
    },
    policy: buildLineUsagePolicy({
      admission,
      bridgeLineBudget,
    }),
    allocation,
    lineUtilizationAudit,
    bridge: {
      diagnostics: bridge.value,
      error: bridge.error,
      activeLineCount: bridgeActiveLines,
      lineBudget: bridgeLineBudget,
      remainingLineCount:
        bridgeLineBudget === null || bridgeActiveLines === null
          ? null
          : Math.max(0, bridgeLineBudget - bridgeActiveLines),
    },
    governor: getBridgeGovernorSnapshot(),
    governorConfig: getBridgeGovernorConfigSnapshot(),
    streams: {
      quoteStreams,
      optionQuoteStreams,
      stockAggregates,
    },
    warmup,
    accountMonitor: buildAccountMonitorLineUsage({ admission, warmup }),
    ownerClasses: admission.ownerClasses,
    signalOptions: admission.signalOptions,
    drift: {
      admissionVsBridgeLineDelta:
        driftReconciliation.status === "unknown" || bridgeActiveLines === null
          ? null
          : driftReconciliation.apiLineCount - driftReconciliation.bridgeLineCount,
      reconciliation: driftReconciliation,
    },
  };
}

export function __setIbkrLineUsageBridgeClientFactoryForTests(
  factory: (() => BridgeLaneDiagnosticsClient) | null,
): void {
  bridgeLaneDiagnosticsClientFactory = factory ?? (() => new IbkrBridgeClient());
  __resetIbkrLineUsageForTests();
}

export function __resetIbkrLineUsageForTests(): void {
  cachedBridgeLaneDiagnostics = null;
  bridgeLaneDiagnosticsPromise = null;
  bridgeLaneDiagnosticsStartedAt = 0;
  bridgeLaneDiagnosticsRequestId += 1;
  bridgeOnlyLineObservations.clear();
}

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
import { ensureIbkrLaneRuntimeOverridesLoaded } from "./ibkr-lanes";
import { getOptionsFlowScannerDiagnostics } from "./platform";
import { getStockAggregateStreamDiagnostics } from "./stock-aggregate-stream";

type CachedBridgeLaneDiagnostics = {
  fetchedAt: number;
  value: BridgeLaneDiagnosticsSnapshot | null;
  error: string | null;
};

type BridgeLaneDiagnosticsClient = Pick<IbkrBridgeClient, "getLaneDiagnostics">;

const BRIDGE_LANE_USAGE_CACHE_MS = 2_000;
const DEFAULT_BRIDGE_LANE_USAGE_TIMEOUT_MS = 1_500;
let cachedBridgeLaneDiagnostics: CachedBridgeLaneDiagnostics | null = null;
let bridgeLaneDiagnosticsPromise: Promise<CachedBridgeLaneDiagnostics> | null = null;
let bridgeLaneDiagnosticsStartedAt = 0;
let bridgeLaneDiagnosticsRequestId = 0;
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

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function lineDriftSample(values: Set<string>): string[] {
  return Array.from(values).sort().slice(0, 20);
}

function buildAdmissionLineIds(
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>,
): Set<string> {
  const result = new Set<string>();
  admission.leases.forEach((lease) => {
    lease.lineIds.forEach((lineId) => result.add(lineId));
  });
  return result;
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

function buildLineDriftReconciliation(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  subscriptions: Record<string, unknown>;
  bridgeDiagnosticsAvailable: boolean;
}) {
  const apiLineIds = buildAdmissionLineIds(input.admission);
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

  return {
    status: classifyLineDrift({
      apiOnlyCount: apiOnlyLineIds.size,
      bridgeOnlyCount: bridgeOnlyLineIds.size,
      bridgeDiagnosticsAvailable: input.bridgeDiagnosticsAvailable,
    }),
    apiLineCount: apiLineIds.size,
    bridgeLineCount: bridgeLineIds.size,
    matchedLineCount: matchedLineIds.size,
    apiOnlyLineCount: apiOnlyLineIds.size,
    bridgeOnlyLineCount: bridgeOnlyLineIds.size,
    apiOnlyLineSample: lineDriftSample(apiOnlyLineIds),
    bridgeOnlyLineSample: lineDriftSample(bridgeOnlyLineIds),
  };
}

function liveSurfaceForLease(lease: MarketDataLease): "account" | "visible" | null {
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
    automationLineCap: budget.automationLineCap,
    scannerStaticLineCap: budget.flowScannerLineCap,
  };
}

function buildLineAllocation(input: {
  admission: ReturnType<typeof getMarketDataAdmissionDiagnostics>;
  bridgeActiveLineCount: number | null;
  bridgeLineBudget: number | null;
}) {
  const admission = input.admission;
  const pressure = admission.pressure;
  const targetFillLines = readNumber(admission.budget.targetFillLines);
  const activeLineCount = readNumber(admission.activeLineCount);
  const remainingToTargetLineCount =
    targetFillLines === null || activeLineCount === null
      ? null
      : Math.max(0, targetFillLines - activeLineCount);

  return {
    activeLineCount,
    targetFillLines,
    remainingToTargetLineCount,
    usableRemainingLineCount: readNumber(admission.usableRemainingLineCount),
    protectedLineCount: readNumber(pressure.protectedLineCount),
    visibleLineCount: readNumber(pressure.visibleLineCount),
    scannerActiveLineCount: readNumber(pressure.scannerActiveLineCount),
    scannerEffectiveLineCap: readNumber(pressure.scannerEffectiveLineCap),
    scannerRemainingLineCount: readNumber(pressure.scannerRemainingLineCount),
    scannerConstrainedByActiveDemand: Boolean(
      pressure.scannerConstrainedByActiveDemand,
    ),
    convenienceLineCount: readNumber(admission.convenienceLineCount),
    fillerLineCount: readNumber(admission.fillerLineCount),
    bridgeActiveLineCount: input.bridgeActiveLineCount,
    bridgeLineBudget: input.bridgeLineBudget,
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

  return {
    updatedAt: new Date().toISOString(),
    admission,
    policy: buildLineUsagePolicy({
      admission,
      bridgeLineBudget,
    }),
    allocation: buildLineAllocation({
      admission,
      bridgeActiveLineCount: bridgeActiveLines,
      bridgeLineBudget,
    }),
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
    warmup: buildWarmupCoverage({
      admission,
      subscriptions,
      bridgeDiagnosticsAvailable: Boolean(bridge.value),
    }),
    drift: {
      admissionVsBridgeLineDelta:
        bridgeActiveLines === null
          ? null
          : admission.activeLineCount - bridgeActiveLines,
      reconciliation: buildLineDriftReconciliation({
        admission,
        subscriptions,
        bridgeDiagnosticsAvailable: Boolean(bridge.value),
      }),
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
}

import { normalizeSymbol } from "../lib/values";
import { readPositiveIntegerEnv } from "../lib/env";

export type MarketDataIntent =
  | "execution-live"
  | "account-monitor-live"
  | "visible-live"
  | "automation-live"
  | "flow-scanner-live"
  | "delayed-ok"
  | "historical";

export type MarketDataFallbackProvider =
  | "massive"
  | "cache"
  | "ibkr"
  | "none";

const MARKET_DATA_FALLBACK_PROVIDERS: MarketDataFallbackProvider[] = [
  "massive",
  "cache",
  "ibkr",
  "none",
];

export type MarketDataLineAssetClass = "equity" | "option";
export type MarketDataLineRole =
  | "stock"
  | "option-contract"
  | "option-underlier-support"
  | "manual-depth";

export type MarketDataPoolId =
  | "execution"
  | "account-monitor"
  | "visible"
  | "automation"
  | "flow-scanner";

export type MarketDataIbkrPressureState =
  | "capacity_limited"
  | "backpressure";

export type MarketDataOwnerClass =
  | "execution"
  | "account-monitor"
  | "visible"
  | "automation"
  | "signal-options"
  | "shadow-account"
  | "flow-scanner"
  | "flow-scanner-benchmark"
  | "historical"
  | "retired-shadow-equity-forward"
  | "unknown";

export type MarketDataLineRequest = {
  symbol?: string | null;
  providerContractId?: string | null;
  assetClass: MarketDataLineAssetClass;
  role?: MarketDataLineRole | null;
  requiresGreeks?: boolean;
  underlying?: string | null;
  priorityOffset?: number;
};

export type MarketDataLease = {
  id: string;
  owner: string;
  ownerClass: MarketDataOwnerClass;
  intent: MarketDataIntent;
  pool: MarketDataPoolId;
  priority: number;
  assetClass: MarketDataLineAssetClass;
  instrumentKey: string;
  symbol: string | null;
  providerContractId: string | null;
  role: MarketDataLineRole;
  lineIds: string[];
  lineRoles: Record<string, MarketDataLineRole>;
  lineCost: number;
  fallbackProvider: MarketDataFallbackProvider;
  acquiredAt: string;
  expiresAt: string | null;
};

type AdmissionEvent = {
  at: string;
  action: "admitted" | "rejected" | "demoted" | "released" | "expired" | "fallback";
  owner: string;
  ownerClass: MarketDataOwnerClass;
  intent: MarketDataIntent;
  pool?: MarketDataPoolId | null;
  instrumentKey?: string | null;
  lineCost?: number;
  reason?: string | null;
  fallbackProvider?: MarketDataFallbackProvider | null;
};

export type MarketDataLeaseChangeEvent = AdmissionEvent & {
  lease: MarketDataLease;
};

type AdmissionCounters = {
  admitted: number;
  rejected: number;
  demoted: number;
  released: number;
  expired: number;
  fallback: number;
};

export type MarketDataAdmissionResult = {
  admitted: MarketDataLease[];
  rejected: Array<{
    request: MarketDataLineRequest;
    reason: "invalid" | "budget" | "automation-cap" | "pool-cap";
    fallbackProvider: MarketDataFallbackProvider;
  }>;
  demoted: MarketDataLease[];
  budget: {
    maxLines: number;
    reserveLines: number;
    usableLines: number;
    configuredMaxLines: number;
    targetFillLines: number;
    bridgeLineBudget: number | null;
    bridgeLineBudgetObservedAt: string | null;
    budgetSource: "app-config" | "bridge-diagnostics";
    automationExecutionLineCap: number;
    executionLineCap: number;
    automationLineCap: number;
    accountMonitorLineCap: number;
    visibleLineCap: number;
    visibleOptionChainStrikesAroundMoney: number;
    visibleOptionChainDefaultLineCount: number;
    visibleOptionQuoteContractLineCap: number;
    visibleOptionQuoteLineReserve: number;
    flowScannerLineCap: number;
    poolLineCaps: Record<MarketDataPoolId, number>;
    pools: Array<{
      id: MarketDataPoolId;
      label: string;
      maxLines: number;
      strict: boolean;
      intents: MarketDataIntent[];
    }>;
  };
};

const INTENT_PRIORITY: Record<MarketDataIntent, number> = {
  "account-monitor-live": 100,
  "execution-live": 90,
  "automation-live": 90,
  "visible-live": 80,
  "flow-scanner-live": 55,
  "delayed-ok": 10,
  historical: 5,
};

const INTENT_POOL: Record<MarketDataIntent, MarketDataPoolId> = {
  "execution-live": "execution",
  "account-monitor-live": "account-monitor",
  "visible-live": "visible",
  "automation-live": "automation",
  "flow-scanner-live": "flow-scanner",
  "delayed-ok": "visible",
  historical: "visible",
};

const POOL_LABELS: Record<MarketDataPoolId, string> = {
  execution: "Execution",
  "account-monitor": "Account monitor",
  visible: "Trade Options Chain",
  automation: "Automation",
  "flow-scanner": "Flow scanner",
};

const POOL_INTENTS: Record<MarketDataPoolId, MarketDataIntent[]> = {
  execution: ["execution-live"],
  "account-monitor": ["account-monitor-live"],
  visible: ["visible-live", "delayed-ok", "historical"],
  automation: ["automation-live"],
  "flow-scanner": ["flow-scanner-live"],
};

const STRICT_POOL_IDS = new Set<MarketDataPoolId>([
  "execution",
  "account-monitor",
  "visible",
  "automation",
  "flow-scanner",
]);

const MAX_RECENT_EVENTS = 100;
const DEFAULT_MAX_LINES = 200;
const DEFAULT_FLOW_SCANNER_CONTRACT_BUDGET = 200;
const DEFAULT_RESERVE_LINES = 0;
const MARKET_DATA_ADMISSION_SCHEMA_VERSION = 1;
const DEFAULT_VISIBLE_OPTION_CHAIN_STRIKES_AROUND_MONEY = 5;
const DEFAULT_VISIBLE_OPTION_CHAIN_STRIKE_COUNT =
  DEFAULT_VISIBLE_OPTION_CHAIN_STRIKES_AROUND_MONEY * 2 + 1;
const DEFAULT_VISIBLE_OPTION_CHAIN_LINE_COUNT =
  DEFAULT_VISIBLE_OPTION_CHAIN_STRIKE_COUNT * 2 + 1;
const DEFAULT_VISIBLE_OPTION_QUOTE_CONTRACT_LIMIT = 40;
const DEFAULT_VISIBLE_OPTION_QUOTE_LINE_RESERVE =
  DEFAULT_VISIBLE_OPTION_QUOTE_CONTRACT_LIMIT + 1;
const BRIDGE_LINE_BUDGET_TTL_MS = 30_000;
const IBKR_PRESSURE_SCANNER_REMAINING_RATIO = 0.5;
const IBKR_PRESSURE_SCANNER_DAMPING_WINDOW_MS = 60_000;
const TARGET_FILL_LINES_ENV = "IBKR_MARKET_DATA_TARGET_FILL_LINES";
const MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT = 20;
const OPERATOR_POOL_IDS: MarketDataPoolId[] = [
  "execution",
  "account-monitor",
  "visible",
  "automation",
  "flow-scanner",
];

const POOL_ENV_KEYS: Record<MarketDataPoolId, string> = {
  execution: "IBKR_MARKET_DATA_EXECUTION_LINES",
  "account-monitor": "IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES",
  visible: "IBKR_MARKET_DATA_VISIBLE_LINES",
  automation: "IBKR_MARKET_DATA_AUTOMATION_LINES",
  "flow-scanner": "OPTIONS_FLOW_SCANNER_LINE_BUDGET",
};

const OWNER_CLASS_LABELS: Record<MarketDataOwnerClass, string> = {
  execution: "Execution",
  "account-monitor": "Account monitor",
  visible: "Trade Options Chain",
  automation: "Automation",
  "signal-options": "Signal automation",
  "shadow-account": "Shadow account",
  "flow-scanner": "Flow scanner",
  "flow-scanner-benchmark": "Flow scanner benchmark",
  historical: "Historical",
  "retired-shadow-equity-forward": "Retired shadow equity forward",
  unknown: "Unknown",
};

const RETIRED_OWNER_CLASSES = new Set<MarketDataOwnerClass>([
  "retired-shadow-equity-forward",
]);

function isMarketDataPoolId(value: unknown): value is MarketDataPoolId {
  return (
    value === "execution" ||
    value === "account-monitor" ||
    value === "visible" ||
    value === "automation" ||
    value === "flow-scanner"
  );
}

function normalizeMarketDataPoolId(
  value: unknown,
  fallback: MarketDataPoolId,
): MarketDataPoolId {
  return isMarketDataPoolId(value) ? value : fallback;
}

function normalizeMarketDataLineRole(
  value: unknown,
  fallback: MarketDataLineRole,
): MarketDataLineRole {
  return value === "stock" ||
    value === "option-contract" ||
    value === "option-underlier-support" ||
    value === "manual-depth"
    ? value
    : fallback;
}

const leases = new Map<string, MarketDataLease>();
const countersByIntent = new Map<MarketDataIntent, AdmissionCounters>();
const recentEvents: AdmissionEvent[] = [];
const leaseChangeListeners = new Set<
  (event: MarketDataLeaseChangeEvent) => void
>();
let nextLeaseId = 1;
let runtimeBridgeLineBudget:
  | {
      value: number;
      observedAt: number;
    }
  | null = null;
let runtimeFlowScannerLineCap: number | null = null;
let lastIbkrPressureEvent:
  | {
      policy: "broker-pressure-observed" | "scanner-shed-damping";
      state: MarketDataIbkrPressureState;
      reason: string;
      source: string;
      observedAt: number;
      dampingExpiresAt: number;
      scannerLineCountBefore: number;
      scannerLineTarget: number;
      scannerLineCountAfter: number;
      demotedLeaseCount: number;
    }
  | null = null;

function classifyMarketDataOwner(input: {
  owner: string;
  intent: MarketDataIntent;
  pool: MarketDataPoolId;
}): MarketDataOwnerClass {
  const owner = input.owner.trim().toLowerCase();
  if (owner.startsWith("shadow-equity-forward")) {
    return "retired-shadow-equity-forward";
  }
  if (owner.startsWith("shadow-") || owner.startsWith("shadow:")) {
    return "shadow-account";
  }
  if (owner.startsWith("flow-scanner-benchmark")) {
    return "flow-scanner-benchmark";
  }
  if (
    owner.startsWith("signal-options-") ||
    owner.startsWith("signal-options:")
  ) {
    return "signal-options";
  }
  if (owner.startsWith("flow-scanner")) {
    return "flow-scanner";
  }
  if (
    owner.startsWith("watchlist-prewarm-filler") ||
    owner.startsWith("watchlist-prewarm")
  ) {
    return "visible";
  }
  if (input.intent === "execution-live") {
    return "execution";
  }
  if (input.intent === "account-monitor-live") {
    return "account-monitor";
  }
  if (input.intent === "visible-live") {
    return "visible";
  }
  if (input.intent === "automation-live") {
    return "automation";
  }
  if (input.intent === "flow-scanner-live") {
    return "flow-scanner";
  }
  if (input.intent === "historical") {
    return "historical";
  }
  return "unknown";
}

function marketDataOwnerPriorityAdjustment(
  ownerClass: MarketDataOwnerClass,
): number {
  if (ownerClass === "flow-scanner-benchmark") {
    return -5;
  }
  return 0;
}

function resolveMarketDataLeasePriority(input: {
  intent: MarketDataIntent;
  ownerClass: MarketDataOwnerClass;
}): number {
  if (input.ownerClass === "signal-options") {
    return (
      INTENT_PRIORITY["automation-live"] +
      marketDataOwnerPriorityAdjustment(input.ownerClass)
    );
  }
  return (
    INTENT_PRIORITY[input.intent] +
    marketDataOwnerPriorityAdjustment(input.ownerClass)
  );
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readOptionalNonNegativeIntegerEnv(name: string): number | null {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeOptionalRuntimeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function resolveAutomationExecutionLineCap(usableLines: number): number {
  const executionOverride = readOptionalNonNegativeIntegerEnv(
    POOL_ENV_KEYS.execution,
  );
  const automationOverride = readOptionalNonNegativeIntegerEnv(
    POOL_ENV_KEYS.automation,
  );
  const configured =
    executionOverride !== null && automationOverride !== null
      ? Math.max(executionOverride, automationOverride)
      : executionOverride ?? automationOverride ?? usableLines;
  return Math.min(
    usableLines,
    Math.max(0, configured),
  );
}

function buildDefaultPoolLineCaps(
  usableLines: number,
): Record<MarketDataPoolId, number> {
  const automationExecutionLineCap = resolveAutomationExecutionLineCap(usableLines);
  const flowScannerLineCap = resolveConfiguredFlowScannerLineCap();
  return {
    execution: automationExecutionLineCap,
    "account-monitor": usableLines,
    visible: usableLines,
    automation: automationExecutionLineCap,
    "flow-scanner": flowScannerLineCap,
  };
}

function resolveConfiguredFlowScannerLineCap(): number {
  const envOverride = readOptionalNonNegativeIntegerEnv(
    POOL_ENV_KEYS["flow-scanner"],
  );
  const configuredLineCap = envOverride ?? runtimeFlowScannerLineCap;
  return configuredLineCap === null
    ? DEFAULT_FLOW_SCANNER_CONTRACT_BUDGET
    : Math.max(0, configuredLineCap);
}

function normalizePoolLineCaps(
  usableLines: number,
): Record<MarketDataPoolId, number> {
  const caps = buildDefaultPoolLineCaps(usableLines);
  (Object.keys(caps) as MarketDataPoolId[]).forEach((pool) => {
    const value = readOptionalNonNegativeIntegerEnv(POOL_ENV_KEYS[pool]);
    if (value !== null) {
      caps[pool] = value;
    }
  });

  (Object.keys(caps) as MarketDataPoolId[]).forEach((pool) => {
    caps[pool] =
      pool === "flow-scanner" ? caps[pool] : Math.min(caps[pool], usableLines);
  });
  return caps;
}

export function setMarketDataAdmissionRuntimeDefaults(input: {
  flowScannerLineBudget?: number | null;
  flowScannerConcurrency?: number | null;
}): void {
  const lineBudget = normalizeOptionalRuntimeInteger(input.flowScannerLineBudget);
  const concurrency = normalizeOptionalRuntimeInteger(input.flowScannerConcurrency);
  runtimeFlowScannerLineCap =
    lineBudget === null || concurrency === null
      ? null
      : concurrency <= 0
        ? 0
        : lineBudget;
  rebalanceFlowScannerLeasesAboveEffectiveCap("scanner_runtime_cap_changed");
}

export function setMarketDataAdmissionBridgeLineBudget(
  value: number | null | undefined,
  observedAt = Date.now(),
): void {
  runtimeBridgeLineBudget =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? { value: Math.floor(value), observedAt }
      : null;
}

function normalizeRuntimeTimestamp(value: number | Date | null | undefined): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : Date.now();
  }
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function normalizePressureText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function shedFlowScannerLeasesForIbkrPressure(reason: string): {
  demoted: MarketDataLease[];
  scannerLineCountBefore: number;
  scannerLineTarget: number;
  scannerLineCountAfter: number;
} {
  const scannerLineCountBefore =
    activeChargeableLineIdsForStrictPoolScope("flow-scanner").size;
  const scannerLineTarget = Math.ceil(
    scannerLineCountBefore * IBKR_PRESSURE_SCANNER_REMAINING_RATIO,
  );
  const demoted: MarketDataLease[] = [];
  let scannerLineIds = activeChargeableLineIdsForStrictPoolScope("flow-scanner");
  if (scannerLineIds.size <= scannerLineTarget) {
    return {
      demoted,
      scannerLineCountBefore,
      scannerLineTarget,
      scannerLineCountAfter: scannerLineIds.size,
    };
  }

  const candidates = Array.from(leases.values())
    .filter((lease) => lease.pool === "flow-scanner")
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    );

  for (const candidate of candidates) {
    if (scannerLineIds.size <= scannerLineTarget) {
      break;
    }
    if (!candidate.lineIds.some((lineId) => scannerLineIds.has(lineId))) {
      continue;
    }
    releaseLease(candidate, "demoted", reason);
    demoted.push(candidate);
    scannerLineIds = activeChargeableLineIdsForStrictPoolScope("flow-scanner");
  }

  return {
    demoted,
    scannerLineCountBefore,
    scannerLineTarget,
    scannerLineCountAfter: scannerLineIds.size,
  };
}

export function recordMarketDataAdmissionIbkrPressure(input: {
  state: MarketDataIbkrPressureState;
  reason?: string | null;
  source?: string | null;
  observedAt?: number | Date | null;
}): MarketDataLease[] {
  const observedAt = normalizeRuntimeTimestamp(input.observedAt);
  const reason = normalizePressureText(input.reason, "ibkr_market_data_pressure");
  const source = normalizePressureText(input.source, "ibkr");
  const scannerLineCountBefore =
    activeChargeableLineIdsForStrictPoolScope("flow-scanner").size;
  lastIbkrPressureEvent = {
    policy: "broker-pressure-observed",
    state: input.state,
    reason,
    source,
    observedAt,
    dampingExpiresAt: observedAt + IBKR_PRESSURE_SCANNER_DAMPING_WINDOW_MS,
    scannerLineCountBefore,
    scannerLineTarget: scannerLineCountBefore,
    scannerLineCountAfter: scannerLineCountBefore,
    demotedLeaseCount: 0,
  };
  return [];
}

function getActiveIbkrPressureDampingEvent(now = Date.now()) {
  if (!lastIbkrPressureEvent) return null;
  return lastIbkrPressureEvent.policy === "scanner-shed-damping" &&
    lastIbkrPressureEvent.dampingExpiresAt > now
    ? lastIbkrPressureEvent
    : null;
}

function resolveRuntimeBridgeLineBudget(now = Date.now()):
  | {
      value: number;
      observedAt: number;
    }
  | null {
  if (!runtimeBridgeLineBudget) {
    return null;
  }
  if (now - runtimeBridgeLineBudget.observedAt > BRIDGE_LINE_BUDGET_TTL_MS) {
    runtimeBridgeLineBudget = null;
    return null;
  }
  return runtimeBridgeLineBudget;
}

export function getMarketDataAdmissionBudget() {
  const configuredMaxLines = readPositiveIntegerEnv(
    "IBKR_MARKET_DATA_APP_MAX_LINES",
    DEFAULT_MAX_LINES,
  );
  const bridgeLineBudget = resolveRuntimeBridgeLineBudget();
  const maxLines =
    bridgeLineBudget === null
      ? configuredMaxLines
      : Math.min(configuredMaxLines, bridgeLineBudget.value);
  const reserveLines = Math.min(
    maxLines - 1,
    readNonNegativeIntegerEnv(
      "IBKR_MARKET_DATA_RESERVE_LINES",
      DEFAULT_RESERVE_LINES,
    ),
  );
  const usableLines = Math.max(1, maxLines - reserveLines);
  const targetFillLines = Math.min(
    usableLines,
    readPositiveIntegerEnv(TARGET_FILL_LINES_ENV, usableLines),
  );
  const poolLineCaps = normalizePoolLineCaps(usableLines);
  const automationExecutionLineCap = resolveAutomationExecutionLineCap(usableLines);
  const executionLineCap = automationExecutionLineCap;
  const automationLineCap = poolLineCaps.automation;
  const accountMonitorLineCap = poolLineCaps["account-monitor"];
  const visibleLineCap = poolLineCaps.visible;
  const flowScannerLineCap = poolLineCaps["flow-scanner"];
  const budgetSource: "app-config" | "bridge-diagnostics" =
    bridgeLineBudget && bridgeLineBudget.value < configuredMaxLines
      ? "bridge-diagnostics"
      : "app-config";

  return {
    maxLines,
    reserveLines,
    usableLines,
    configuredMaxLines,
    targetFillLines,
    bridgeLineBudget: bridgeLineBudget?.value ?? null,
    bridgeLineBudgetObservedAt: bridgeLineBudget
      ? new Date(bridgeLineBudget.observedAt).toISOString()
      : null,
    budgetSource,
    automationExecutionLineCap,
    executionLineCap,
    automationLineCap,
    accountMonitorLineCap,
    visibleLineCap,
    visibleOptionChainStrikesAroundMoney:
      DEFAULT_VISIBLE_OPTION_CHAIN_STRIKES_AROUND_MONEY,
    visibleOptionChainDefaultLineCount:
      DEFAULT_VISIBLE_OPTION_CHAIN_LINE_COUNT,
    visibleOptionQuoteContractLineCap:
      DEFAULT_VISIBLE_OPTION_QUOTE_CONTRACT_LIMIT,
    visibleOptionQuoteLineReserve:
      DEFAULT_VISIBLE_OPTION_QUOTE_LINE_RESERVE,
    flowScannerLineCap,
    poolLineCaps,
    pools: OPERATOR_POOL_IDS.map((pool) => ({
      id: pool,
      label: POOL_LABELS[pool],
      maxLines: poolLineCaps[pool],
      strict: STRICT_POOL_IDS.has(pool),
      intents: POOL_INTENTS[pool],
    })),
  };
}

function emptyCounters(): AdmissionCounters {
  return {
    admitted: 0,
    rejected: 0,
    demoted: 0,
    released: 0,
    expired: 0,
    fallback: 0,
  };
}

function getCounters(intent: MarketDataIntent): AdmissionCounters {
  const existing = countersByIntent.get(intent);
  if (existing) {
    return existing;
  }
  const created = emptyCounters();
  countersByIntent.set(intent, created);
  return created;
}

function recordEvent(
  event: Omit<AdmissionEvent, "at" | "ownerClass"> & {
    ownerClass?: MarketDataOwnerClass;
  },
): AdmissionEvent {
  const ownerClass =
    event.ownerClass ??
    classifyMarketDataOwner({
      owner: event.owner,
      intent: event.intent,
      pool: event.pool ?? INTENT_POOL[event.intent],
    });
  const recorded = {
    at: new Date().toISOString(),
    ...event,
    ownerClass,
  };
  recentEvents.push(recorded);
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
  }

  const counters = getCounters(event.intent);
  counters[event.action] += 1;
  return recorded;
}

function cloneLease(lease: MarketDataLease): MarketDataLease {
  return {
    ...lease,
    lineIds: [...lease.lineIds],
    lineRoles: { ...lease.lineRoles },
  };
}

function notifyLeaseChange(event: MarketDataLeaseChangeEvent): void {
  leaseChangeListeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Lease observers are maintenance hooks; they must not affect admission.
    }
  });
}

export function subscribeMarketDataLeaseChanges(
  listener: (event: MarketDataLeaseChangeEvent) => void,
): () => void {
  leaseChangeListeners.add(listener);
  return () => {
    leaseChangeListeners.delete(listener);
  };
}

function normalizeProviderContractId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function lineId(assetClass: MarketDataLineAssetClass, value: string): string {
  return `${assetClass}:${value}`;
}

function normalizeRequest(input: MarketDataLineRequest): {
  assetClass: MarketDataLineAssetClass;
  instrumentKey: string;
  symbol: string | null;
  providerContractId: string | null;
  role: MarketDataLineRole;
  lineIds: string[];
  lineRoles: Record<string, MarketDataLineRole>;
  priorityOffset: number;
} | null {
  const priorityOffset =
    typeof input.priorityOffset === "number" && Number.isFinite(input.priorityOffset)
      ? Math.max(-10, Math.min(10, Math.trunc(input.priorityOffset)))
      : 0;
  if (input.assetClass === "equity") {
    const symbol = normalizeSymbol(input.symbol ?? "");
    if (!symbol) {
      return null;
    }
    const role = normalizeMarketDataLineRole(input.role, "stock");
    const equityLineId = lineId("equity", symbol);
    const providerContractId = normalizeProviderContractId(
      input.providerContractId,
    );
    return {
      assetClass: "equity",
      instrumentKey: equityLineId,
      symbol,
      providerContractId: providerContractId || null,
      role,
      lineIds: [equityLineId],
      lineRoles: { [equityLineId]: role },
      priorityOffset,
    };
  }

  const providerContractId = normalizeProviderContractId(input.providerContractId);
  if (!providerContractId) {
    return null;
  }
  const optionLineId = lineId("option", providerContractId);
  const lineIds = [optionLineId];
  const lineRoles: Record<string, MarketDataLineRole> = {
    [optionLineId]: "option-contract",
  };
  const underlying = normalizeSymbol(input.underlying ?? input.symbol ?? "");
  if (input.requiresGreeks && underlying) {
    const underlyingLineId = lineId("equity", underlying);
    lineIds.push(underlyingLineId);
    lineRoles[underlyingLineId] = "option-underlier-support";
  }

  return {
    assetClass: "option",
    instrumentKey: optionLineId,
    symbol: underlying || null,
    providerContractId,
    role: "option-contract",
    lineIds,
    lineRoles,
    priorityOffset,
  };
}

// Memoize the expiry parse per lease. activeLeaseValues() re-filters every call
// and runs multiple times per admission/diagnostics build over ~200 leases, so
// a naive Date.parse(expiresAt) per check dominated CPU. The WeakMap re-parses
// only when a lease's expiresAt string changes (renewal) and is GC'd with the
// lease, so it needs no manual invalidation.
const leaseExpiryParseCache = new WeakMap<
  MarketDataLease,
  { str: string; ms: number }
>();

function isLeaseExpiredAt(lease: MarketDataLease, now = Date.now()): boolean {
  if (!lease.expiresAt) {
    return false;
  }
  let cached = leaseExpiryParseCache.get(lease);
  if (!cached || cached.str !== lease.expiresAt) {
    cached = { str: lease.expiresAt, ms: Date.parse(lease.expiresAt) };
    leaseExpiryParseCache.set(lease, cached);
  }
  return Number.isFinite(cached.ms) && cached.ms <= now;
}

function activeLeaseValues(now = Date.now()): MarketDataLease[] {
  return Array.from(leases.values()).filter(
    (lease) => !isLeaseExpiredAt(lease, now),
  );
}

function activeLineIds(
  options: {
    intent?: MarketDataIntent;
    pool?: MarketDataPoolId;
    excludePool?: MarketDataPoolId;
    excludeOwner?: string;
  } = {},
): Set<string> {
  const result = new Set<string>();
  activeLeaseValues().forEach((lease) => {
    if (options.excludeOwner && lease.owner === options.excludeOwner) {
      return;
    }
    if (options.intent && lease.intent !== options.intent) {
      return;
    }
    if (options.pool && lease.pool !== options.pool) {
      return;
    }
    if (options.excludePool && lease.pool === options.excludePool) {
      return;
    }
    lease.lineIds.forEach((id) => result.add(id));
  });
  return result;
}

function activeEquityLineRoleDiagnostics() {
  const rolesByLine = new Map<string, Set<MarketDataLineRole>>();
  activeLeaseValues().forEach((lease) => {
    lease.lineIds.forEach((id) => {
      if (!id.startsWith("equity:")) {
        return;
      }
      const role = lease.lineRoles[id] ?? lease.role ?? "stock";
      const roles = rolesByLine.get(id) ?? new Set<MarketDataLineRole>();
      roles.add(role);
      rolesByLine.set(id, roles);
    });
  });

  const routine = new Set<string>();
  const optionSupport = new Set<string>();
  const manualDepth = new Set<string>();
  rolesByLine.forEach((roles, lineIdValue) => {
    if (roles.has("stock")) {
      routine.add(lineIdValue);
    }
    if (roles.has("option-underlier-support")) {
      optionSupport.add(lineIdValue);
    }
    if (roles.has("manual-depth")) {
      manualDepth.add(lineIdValue);
    }
  });

  return {
    routineEquityLineCount: routine.size,
    optionSupportEquityLineCount: optionSupport.size,
    manualDepthEquityLineCount: manualDepth.size,
    routineEquityLineSample: sampleDiagnosticLineIds(routine),
    optionSupportEquityLineSample: sampleDiagnosticLineIds(optionSupport),
    manualDepthEquityLineSample: sampleDiagnosticLineIds(manualDepth),
  };
}

function activeLineIdsForPools(pools: readonly MarketDataPoolId[]): Set<string> {
  const poolSet = new Set(pools);
  const result = new Set<string>();
  activeLeaseValues().forEach((lease) => {
    if (!poolSet.has(lease.pool)) {
      return;
    }
    lease.lineIds.forEach((id) => result.add(id));
  });
  return result;
}

function activeNonFlowScannerLineIds(): Set<string> {
  const result = new Set<string>();
  activeLeaseValues().forEach((lease) => {
    if (lease.pool === "flow-scanner") {
      return;
    }
    lease.lineIds.forEach((id) => result.add(id));
  });
  return result;
}

function activeBrokerBudgetLineIds(): Set<string> {
  return activeLineIds({ excludePool: "flow-scanner" });
}

function isAutomationExecutionPool(pool: MarketDataPoolId): boolean {
  return pool === "execution" || pool === "automation";
}

function activeLineIdsForStrictPoolScope(pool: MarketDataPoolId): Set<string> {
  return isAutomationExecutionPool(pool)
    ? activeLineIdsForPools(["execution", "automation"])
    : activeLineIds({ pool });
}

function activeChargeableLineIdsForStrictPoolScope(
  pool: MarketDataPoolId,
): Set<string> {
  if (pool !== "flow-scanner") {
    return activeLineIdsForStrictPoolScope(pool);
  }
  const nonScannerLineIds = activeNonFlowScannerLineIds();
  return new Set(
    Array.from(activeLineIds({ pool: "flow-scanner" })).filter(
      (id) => !nonScannerLineIds.has(id),
    ),
  );
}

function chargeableNewLineIdsForPool(
  pool: MarketDataPoolId,
  lineIds: readonly string[],
): string[] {
  const poolLineIds = activeChargeableLineIdsForStrictPoolScope(pool);
  if (pool !== "flow-scanner") {
    return lineIds.filter((id) => !poolLineIds.has(id));
  }
  const nonScannerLineIds = activeNonFlowScannerLineIds();
  return lineIds.filter(
    (id) => !poolLineIds.has(id) && !nonScannerLineIds.has(id),
  );
}

function sampleDiagnosticLineIds(values: Set<string>): string[] {
  return Array.from(values).sort().slice(0, MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT);
}

function lineLabel(lineId: string): string {
  if (lineId.startsWith("equity:")) {
    return lineId.slice("equity:".length);
  }
  if (lineId.startsWith("option:")) {
    return lineId.slice("option:".length);
  }
  return lineId;
}

function buildLineAllocationDiagnostics(budget = getMarketDataAdmissionBudget()) {
  const protectedLineIds = new Set<string>();
  const dynamicLineIds = new Set<string>();
  const executionLineIds = new Set<string>();
  const automationLineIds = new Set<string>();
  const accountLineIds = new Set<string>();
  const visibleLineIds = new Set<string>();
  const scannerLineIds = new Set<string>();
  const nonScannerLineIds = new Set<string>();

  activeLeaseValues().forEach((lease) => {
    lease.lineIds.forEach((id) => {
      if (lease.pool === "execution") {
        protectedLineIds.add(id);
        executionLineIds.add(id);
        nonScannerLineIds.add(id);
      } else if (lease.pool === "automation") {
        protectedLineIds.add(id);
        automationLineIds.add(id);
        nonScannerLineIds.add(id);
      } else if (lease.pool === "account-monitor") {
        dynamicLineIds.add(id);
        accountLineIds.add(id);
        nonScannerLineIds.add(id);
      } else if (lease.pool === "visible") {
        dynamicLineIds.add(id);
        visibleLineIds.add(id);
        nonScannerLineIds.add(id);
      } else if (lease.pool === "flow-scanner") {
        scannerLineIds.add(id);
      }
    });
  });

  const activeLineIds = new Set([
    ...protectedLineIds,
    ...dynamicLineIds,
  ]);
  const flowScannerDynamic = buildFlowScannerDynamicLineCap(budget);
  const scannerSharedLineIds = new Set(
    Array.from(scannerLineIds).filter((id) => nonScannerLineIds.has(id)),
  );
  const scannerChargedLineIds = new Set(
    Array.from(scannerLineIds).filter((id) => !nonScannerLineIds.has(id)),
  );

  return {
    policy: "options-flow-rotation-allocation",
    targetFillLines: budget.targetFillLines,
    protectedLineCount: protectedLineIds.size,
    automationExecutionLineCount: protectedLineIds.size,
    executionLineCount: executionLineIds.size,
    automationLineCount: automationLineIds.size,
    dynamicLineCount: dynamicLineIds.size,
    accountLineCount: accountLineIds.size,
    visibleLineCount: visibleLineIds.size,
    scannerLineCount: scannerLineIds.size,
    scannerChargedLineCount: scannerChargedLineIds.size,
    scannerSharedLineCount: scannerSharedLineIds.size,
    scannerStaticLineCap: flowScannerDynamic.scannerStaticLineCap,
    scannerDynamicLineCap: flowScannerDynamic.dynamicScannerLineCap,
    scannerEffectiveLineCap: flowScannerDynamic.scannerEffectiveLineCap,
    scannerRemainingLineCount: flowScannerDynamic.scannerRemainingLineCount,
    optionBudgetLineCount: flowScannerDynamic.optionBudgetLineCount,
    nonScannerOptionLineCount: flowScannerDynamic.nonScannerOptionLineCount,
    tradeOptionsChainReserveLineCount:
      flowScannerDynamic.tradeOptionsChainReserveLineCount,
    optionReserveLineCount: flowScannerDynamic.optionReserveLineCount,
    protectedPriorityLineCount:
      flowScannerDynamic.protectedPriorityLineCount,
    activeLineCount: activeLineIds.size,
    remainingToTargetLineCount: Math.max(
      0,
      budget.targetFillLines - activeLineIds.size,
    ),
    dynamicLineSample: sampleDiagnosticLineIds(dynamicLineIds),
    automationExecutionLineSample: sampleDiagnosticLineIds(protectedLineIds),
    executionLineSample: sampleDiagnosticLineIds(executionLineIds),
    automationLineSample: sampleDiagnosticLineIds(automationLineIds),
    accountLineSample: sampleDiagnosticLineIds(accountLineIds),
    visibleLineSample: sampleDiagnosticLineIds(visibleLineIds),
    scannerLineSample: sampleDiagnosticLineIds(scannerLineIds),
    scannerChargedLineSample: sampleDiagnosticLineIds(scannerChargedLineIds),
    scannerSharedLineSample: sampleDiagnosticLineIds(scannerSharedLineIds),
  };
}

function buildAccountMonitorDiagnostics(budget = getMarketDataAdmissionBudget()) {
  const accountLeases = activeLeaseValues().filter(
    (lease) => lease.intent === "account-monitor-live",
  );
  const accountLineIds = new Set<string>();
  const activeSymbols = new Set<string>();
  accountLeases.forEach((lease) => {
    lease.lineIds.forEach((id) => {
      accountLineIds.add(id);
      activeSymbols.add(lineLabel(id));
    });
  });
  const recentRejectedLineIds = new Set(
    recentEvents
      .filter(
        (event) =>
          event.intent === "account-monitor-live" &&
          event.action === "rejected" &&
          event.instrumentKey,
      )
      .map((event) => String(event.instrumentKey)),
  );
  const recentDemotedLineIds = new Set(
    recentEvents
      .filter(
        (event) =>
          event.intent === "account-monitor-live" &&
          event.action === "demoted" &&
          event.instrumentKey,
      )
      .map((event) => String(event.instrumentKey)),
  );
  const neededLineCount = accountLineIds.size + recentRejectedLineIds.size;
  const deferredLineCount = recentRejectedLineIds.size;
  const remainingLineCount = Math.max(
    0,
    budget.accountMonitorLineCap - accountLineIds.size,
  );

  return {
    dynamic: false,
    lineCap: budget.accountMonitorLineCap,
    neededLineCount,
    coveredLineCount: accountLineIds.size,
    deferredLineCount,
    activeLineCount: accountLineIds.size,
    remainingLineCount,
    availableExpansionLineCount: remainingLineCount,
    leaseCount: accountLeases.length,
    ownerCount: new Set(accountLeases.map((lease) => lease.owner)).size,
    activeLineSample: sampleDiagnosticLineIds(accountLineIds),
    activeSymbolSample: Array.from(activeSymbols)
      .sort()
      .slice(0, MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT),
    recentRejectedCount: recentRejectedLineIds.size,
    recentRejectedLineSample: sampleDiagnosticLineIds(recentRejectedLineIds),
    recentDemotedLineCount: recentDemotedLineIds.size,
    recentDemotedLineSample: sampleDiagnosticLineIds(recentDemotedLineIds),
  };
}

function buildFlowScannerActivityDiagnostics() {
  const scannerEvents = recentEvents.filter(
    (event) =>
      event.pool === "flow-scanner" || event.intent === "flow-scanner-live",
  );
  const admittedEvents = scannerEvents.filter(
    (event) => event.action === "admitted",
  );
  const rejectedEvents = scannerEvents.filter(
    (event) => event.action === "rejected",
  );
  const rotatedEvents = scannerEvents.filter(
    (event) =>
      event.action === "demoted" && event.reason === "flow_scanner_rotated",
  );
  const rotatedOwners = new Set(
    rotatedEvents.map((event) => event.owner).filter(Boolean),
  );
  const rejectedLineIds = new Set(
    rejectedEvents
      .map((event) => event.instrumentKey)
      .filter((value): value is string => Boolean(value)),
  );

  return {
    recentAdmittedCount: admittedEvents.length,
    recentAdmittedLineCount: admittedEvents.reduce(
      (total, event) => total + Math.max(0, event.lineCost ?? 0),
      0,
    ),
    recentRejectedCount: rejectedEvents.length,
    recentRejectedLineCount: rejectedEvents.reduce(
      (total, event) => total + Math.max(0, event.lineCost ?? 0),
      0,
    ),
    recentRejectedLineSample: sampleDiagnosticLineIds(rejectedLineIds),
    recentRotatedCount: rotatedEvents.length,
    recentRotatedLineCount: rotatedEvents.reduce(
      (total, event) => total + Math.max(0, event.lineCost ?? 0),
      0,
    ),
    recentRotatedOwnerSample: Array.from(rotatedOwners)
      .sort()
      .slice(0, MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT),
  };
}

function buildFlowScannerTickerSlotDiagnostics() {
  const byUnderlying = new Map<string, MarketDataLease[]>();
  activeLeaseValues().forEach((lease) => {
    if (
      lease.intent !== "flow-scanner-live" ||
      lease.pool !== "flow-scanner" ||
      lease.assetClass !== "option"
    ) {
      return;
    }
    const underlying = normalizeSymbol(lease.symbol ?? "");
    if (!underlying) {
      return;
    }
    const group = byUnderlying.get(underlying) ?? [];
    group.push(lease);
    byUnderlying.set(underlying, group);
  });
  const duplicateUnderlyings = Array.from(byUnderlying.entries())
    .filter(([, leasesForUnderlying]) => leasesForUnderlying.length > 1)
    .map(([underlying, leasesForUnderlying]) => ({
      underlying,
      leaseCount: leasesForUnderlying.length,
      providerContractIds: leasesForUnderlying
        .map((lease) => lease.providerContractId)
        .filter((value): value is string => Boolean(value))
        .sort()
        .slice(0, MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT),
    }))
    .sort((left, right) => left.underlying.localeCompare(right.underlying));

  return {
    perTickerLiveContractLimit: 1,
    activeTickerSlotCount: byUnderlying.size,
    activeUnderlyingSample: Array.from(byUnderlying.keys())
      .sort()
      .slice(0, MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT),
    duplicateActiveUnderlyingCount: duplicateUnderlyings.length,
    duplicateActiveUnderlyings: duplicateUnderlyings.slice(
      0,
      MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT,
    ),
  };
}

function emptyOwnerClassSummary(ownerClass: MarketDataOwnerClass) {
  return {
    id: ownerClass,
    label: OWNER_CLASS_LABELS[ownerClass],
    activeLineCount: 0,
    leaseCount: 0,
    ownerCount: 0,
    activeOwnerSample: [] as string[],
    activeLineSample: [] as string[],
    recentRequestedLineCount: 0,
    recentAdmittedCount: 0,
    recentRejectedCount: 0,
    recentDemotedCount: 0,
    recentReleasedCount: 0,
    recentExpiredCount: 0,
    recentFallbackCount: 0,
    recentCacheFallbackCount: 0,
    recentRejectedLineSample: [] as string[],
    activeFallbackProviderLineCounts: Object.fromEntries(
      MARKET_DATA_FALLBACK_PROVIDERS.map((provider) => [provider, 0]),
    ) as Record<MarketDataFallbackProvider, number>,
    activeFallbackProviderLeaseCounts: Object.fromEntries(
      MARKET_DATA_FALLBACK_PROVIDERS.map((provider) => [provider, 0]),
    ) as Record<MarketDataFallbackProvider, number>,
  };
}

function emptyFallbackProviderLineSets(): Record<
  MarketDataFallbackProvider,
  Set<string>
> {
  return {
    massive: new Set<string>(),
    cache: new Set<string>(),
    ibkr: new Set<string>(),
    none: new Set<string>(),
  };
}

function emptyFallbackProviderCounts(): Record<MarketDataFallbackProvider, number> {
  return {
    massive: 0,
    cache: 0,
    ibkr: 0,
    none: 0,
  };
}

function buildOwnerClassDiagnostics() {
  const groups = new Map<
    MarketDataOwnerClass,
    ReturnType<typeof emptyOwnerClassSummary> & {
      lineIds: Set<string>;
      owners: Set<string>;
      rejectedLineIds: Set<string>;
      fallbackProviderLineIds: Record<MarketDataFallbackProvider, Set<string>>;
      fallbackProviderLeaseCounts: Record<MarketDataFallbackProvider, number>;
    }
  >();

  const ensureGroup = (ownerClass: MarketDataOwnerClass) => {
    const existing = groups.get(ownerClass);
    if (existing) {
      return existing;
    }
    const created = {
      ...emptyOwnerClassSummary(ownerClass),
      lineIds: new Set<string>(),
      owners: new Set<string>(),
      rejectedLineIds: new Set<string>(),
      fallbackProviderLineIds: emptyFallbackProviderLineSets(),
      fallbackProviderLeaseCounts: emptyFallbackProviderCounts(),
    };
    groups.set(ownerClass, created);
    return created;
  };

  activeLeaseValues().forEach((lease) => {
    const group = ensureGroup(lease.ownerClass);
    group.leaseCount += 1;
    group.owners.add(lease.owner);
    group.fallbackProviderLeaseCounts[lease.fallbackProvider] += 1;
    lease.lineIds.forEach((lineId) => {
      group.lineIds.add(lineId);
      group.fallbackProviderLineIds[lease.fallbackProvider].add(lineId);
    });
  });

  recentEvents.forEach((event) => {
    const group = ensureGroup(event.ownerClass);
    if (event.action === "admitted" || event.action === "rejected") {
      group.recentRequestedLineCount += Math.max(0, event.lineCost ?? 0);
    }
    if (event.action === "admitted") {
      group.recentAdmittedCount += 1;
    } else if (event.action === "rejected") {
      group.recentRejectedCount += 1;
      if (event.instrumentKey) {
        group.rejectedLineIds.add(event.instrumentKey);
      }
    } else if (event.action === "demoted") {
      group.recentDemotedCount += 1;
    } else if (event.action === "released") {
      group.recentReleasedCount += 1;
    } else if (event.action === "expired") {
      group.recentExpiredCount += 1;
    } else if (event.action === "fallback") {
      group.recentFallbackCount += 1;
    }
    if (
      event.fallbackProvider === "cache" &&
      (event.action === "admitted" ||
        event.action === "rejected" ||
        event.action === "fallback")
    ) {
      group.recentCacheFallbackCount += 1;
    }
  });

  const summaries = Object.fromEntries(
    Array.from(groups.entries()).map(([ownerClass, group]) => {
      const {
        lineIds,
        owners,
        rejectedLineIds,
        fallbackProviderLineIds,
        fallbackProviderLeaseCounts,
        ...counts
      } = group;
      return [
        ownerClass,
        {
          ...emptyOwnerClassSummary(ownerClass),
          ...counts,
          activeLineCount: lineIds.size,
          ownerCount: owners.size,
          activeOwnerSample: Array.from(owners).sort().slice(0, 20),
          activeLineSample: sampleDiagnosticLineIds(lineIds),
          recentRejectedLineSample: sampleDiagnosticLineIds(rejectedLineIds),
          activeFallbackProviderLineCounts: Object.fromEntries(
            MARKET_DATA_FALLBACK_PROVIDERS.map((provider) => [
              provider,
              fallbackProviderLineIds[provider].size,
            ]),
          ) as Record<MarketDataFallbackProvider, number>,
          activeFallbackProviderLeaseCounts: { ...fallbackProviderLeaseCounts },
        },
      ];
    }),
  ) as Record<MarketDataOwnerClass, ReturnType<typeof emptyOwnerClassSummary>>;

  const unknownOwners = summaries.unknown?.activeOwnerSample ?? [];
  const retiredOwners = Array.from(RETIRED_OWNER_CLASSES).flatMap(
    (ownerClass) => summaries[ownerClass]?.activeOwnerSample ?? [],
  );
  const warnings = [
    ...(unknownOwners.length
      ? [
          {
            code: "unknown-owner-class",
            severity: "warning" as const,
            ownerClass: "unknown" as const,
            message:
              "Active market data leases have an unknown owner class.",
            ownerSample: unknownOwners,
          },
        ]
      : []),
    ...(retiredOwners.length
      ? [
          {
            code: "retired-owner-active",
            severity: "warning" as const,
            ownerClass: "retired-shadow-equity-forward" as const,
            message:
              "Retired shadow equity forward owners are still holding market data leases.",
            ownerSample: retiredOwners,
          },
        ]
      : []),
  ];

  return {
    summaries,
    signalOptions:
      summaries["signal-options"] ?? emptyOwnerClassSummary("signal-options"),
    shadowAccount:
      summaries["shadow-account"] ?? emptyOwnerClassSummary("shadow-account"),
    unknownOwnerCount: unknownOwners.length,
    retiredOwnerCount: retiredOwners.length,
    warnings,
  };
}

function buildLineOwnershipDiagnostics() {
  const groups = new Map<
    string,
    {
      lineId: string;
      assetClass: MarketDataLineAssetClass;
      owners: Set<string>;
      ownerClasses: Set<MarketDataOwnerClass>;
      intents: Set<MarketDataIntent>;
      pools: Set<MarketDataPoolId>;
      roles: Set<MarketDataLineRole>;
      leaseCount: number;
      highestPriority: number;
      highestPriorityOwner: string | null;
      highestPriorityOwnerClass: MarketDataOwnerClass | null;
    }
  >();

  activeLeaseValues().forEach((lease) => {
    lease.lineIds.forEach((id) => {
      const assetClass: MarketDataLineAssetClass = id.startsWith("option:")
        ? "option"
        : "equity";
      const group =
        groups.get(id) ??
        {
          lineId: id,
          assetClass,
          owners: new Set<string>(),
          ownerClasses: new Set<MarketDataOwnerClass>(),
          intents: new Set<MarketDataIntent>(),
          pools: new Set<MarketDataPoolId>(),
          roles: new Set<MarketDataLineRole>(),
          leaseCount: 0,
          highestPriority: Number.NEGATIVE_INFINITY,
          highestPriorityOwner: null,
          highestPriorityOwnerClass: null,
        };
      group.owners.add(lease.owner);
      group.ownerClasses.add(lease.ownerClass);
      group.intents.add(lease.intent);
      group.pools.add(lease.pool);
      group.roles.add(lease.lineRoles[id] ?? lease.role ?? "stock");
      group.leaseCount += 1;
      if (lease.priority > group.highestPriority) {
        group.highestPriority = lease.priority;
        group.highestPriorityOwner = lease.owner;
        group.highestPriorityOwnerClass = lease.ownerClass;
      }
      groups.set(id, group);
    });
  });

  const lines = Array.from(groups.values()).map((group) => {
    const owners = Array.from(group.owners).sort();
    const ownerClasses = Array.from(group.ownerClasses).sort();
    const pools = Array.from(group.pools).sort();
    const sharedWithScanner =
      group.pools.has("flow-scanner") && group.pools.size > 1;
    return {
      lineId: group.lineId,
      assetClass: group.assetClass,
      owners,
      ownerClasses,
      intents: Array.from(group.intents).sort(),
      pools,
      roles: Array.from(group.roles).sort(),
      leaseCount: group.leaseCount,
      ownerCount: owners.length,
      highestPriority:
        group.highestPriority === Number.NEGATIVE_INFINITY
          ? null
          : group.highestPriority,
      chargedOwner: group.highestPriorityOwner,
      chargedOwnerClass: group.highestPriorityOwnerClass,
      shared: owners.length > 1,
      sharedWithScanner,
      scannerOwned: group.pools.has("flow-scanner"),
      scannerCharged: group.pools.has("flow-scanner") && !sharedWithScanner,
    };
  });
  const duplicateLines = lines.filter((line) => line.ownerCount > 1);
  const scannerOverlapLines = lines.filter((line) => line.sharedWithScanner);

  return {
    lineCount: lines.length,
    duplicateLineCount: duplicateLines.length,
    scannerOverlapLineCount: scannerOverlapLines.length,
    duplicateLines: duplicateLines.slice(0, MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT),
    scannerOverlapLines: scannerOverlapLines.slice(
      0,
      MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT,
    ),
    lines: lines
      .sort(
        (left, right) =>
          Number(right.shared) - Number(left.shared) ||
          (right.highestPriority ?? 0) - (left.highestPriority ?? 0) ||
          left.lineId.localeCompare(right.lineId),
      )
      .slice(0, MARKET_DATA_DIAGNOSTIC_SAMPLE_LIMIT),
  };
}

type MarketDataPortfolioClass =
  | "pinned"
  | "priority"
  | "scanner-rotating"
  | "historical";

function portfolioClassForLease(lease: MarketDataLease): MarketDataPortfolioClass {
  if (lease.intent === "historical") {
    return "historical";
  }
  if (
    lease.intent === "execution-live" ||
    lease.intent === "account-monitor-live" ||
    (lease.intent === "automation-live" &&
      lease.owner.toLowerCase().startsWith("signal-options-position-mark:"))
  ) {
    return "pinned";
  }
  if (lease.intent === "flow-scanner-live") {
    return "scanner-rotating";
  }
  return "priority";
}

function buildPortfolioDiagnostics() {
  const groups = new Map<
    MarketDataPortfolioClass,
    { lineIds: Set<string>; leaseCount: number; ownerSet: Set<string> }
  >();
  const ensure = (portfolioClass: MarketDataPortfolioClass) => {
    const existing = groups.get(portfolioClass);
    if (existing) return existing;
    const created = {
      lineIds: new Set<string>(),
      leaseCount: 0,
      ownerSet: new Set<string>(),
    };
    groups.set(portfolioClass, created);
    return created;
  };

  activeLeaseValues().forEach((lease) => {
    const group = ensure(portfolioClassForLease(lease));
    group.leaseCount += 1;
    group.ownerSet.add(lease.owner);
    lease.lineIds.forEach((lineIdValue) => group.lineIds.add(lineIdValue));
  });

  const summarize = (portfolioClass: MarketDataPortfolioClass) => {
    const group = ensure(portfolioClass);
    return {
      id: portfolioClass,
      activeLineCount: group.lineIds.size,
      leaseCount: group.leaseCount,
      ownerCount: group.ownerSet.size,
      activeLineSample: sampleDiagnosticLineIds(group.lineIds),
      activeOwnerSample: Array.from(group.ownerSet).sort().slice(0, 20),
    };
  };

  const pinned = summarize("pinned");
  const priority = summarize("priority");
  const scannerRotating = summarize("scanner-rotating");
  const historical = summarize("historical");
  return {
    policy: "saturating-priority-portfolio",
    target: "fill-bridge-budget-with-preemptible-scanner",
    pinned,
    priority,
    scannerRotating,
    historical,
    rotatingReclaimableLineCount: scannerRotating.activeLineCount,
    activeLineCount:
      pinned.activeLineCount +
      priority.activeLineCount +
      scannerRotating.activeLineCount +
      historical.activeLineCount,
  };
}

function releaseLease(lease: MarketDataLease, action: AdmissionEvent["action"], reason: string): void {
  leases.delete(lease.id);
  const event = recordEvent({
    action,
    owner: lease.owner,
    ownerClass: lease.ownerClass,
    intent: lease.intent,
    pool: lease.pool,
    instrumentKey: lease.instrumentKey,
    lineCost: lease.lineCost,
    reason,
    fallbackProvider: lease.fallbackProvider,
  });
  notifyLeaseChange({
    ...event,
    lease: cloneLease(lease),
  });
}

export function releaseMarketDataLeases(owner: string, reason = "released"): void {
  Array.from(leases.values())
    .filter((lease) => lease.owner === owner)
    .forEach((lease) => releaseLease(lease, "released", reason));
}

export function releaseMarketDataLeaseIds(
  leaseIds: string[],
  reason = "released",
): void {
  leaseIds.forEach((leaseId) => {
    const lease = leases.get(leaseId);
    if (lease) {
      releaseLease(lease, "released", reason);
    }
  });
}

export function expireMarketDataLeases(now = Date.now()): void {
  Array.from(leases.values()).forEach((lease) => {
    if (isLeaseExpiredAt(lease, now)) {
      releaseLease(lease, "expired", "ttl");
    }
  });
}

function demotionRankForRequest(
  lease: MarketDataLease,
  intent: MarketDataIntent,
): number | null {
  if (intent === "execution-live" && lease.pool === "flow-scanner") {
    return 1;
  }
  if (intent === "execution-live" && lease.pool === "visible") {
    return 2;
  }
  if (intent === "account-monitor-live") {
    if (lease.pool === "flow-scanner") return 1;
    if (lease.pool === "visible") return 2;
    if (lease.pool === "automation") return 3;
    if (lease.pool === "execution") return 3;
  }
  if (intent === "automation-live") {
    if (lease.pool === "flow-scanner") return 1;
    if (lease.pool === "visible") return 2;
  }
  if (intent === "visible-live") {
    if (lease.pool === "flow-scanner") return 1;
  }
  return null;
}

function demoteLowerPriorityLeases(input: {
  owner: string;
  priority: number;
  neededLineCount: number;
  intent: MarketDataIntent;
}): MarketDataLease[] {
  const budget = getMarketDataAdmissionBudget();
  const demoted: MarketDataLease[] = [];
  const candidates = Array.from(leases.values())
    .map((lease) => ({
      lease,
      rank: demotionRankForRequest(lease, input.intent),
    }))
    .filter(
      (entry): entry is { lease: MarketDataLease; rank: number } =>
        entry.rank !== null &&
        entry.lease.owner !== input.owner &&
        entry.lease.priority < input.priority,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.lease.priority - right.lease.priority ||
        Date.parse(left.lease.acquiredAt) -
          Date.parse(right.lease.acquiredAt),
    );

  for (const { lease: candidate } of candidates) {
    if (
      activeBrokerBudgetLineIds().size + input.neededLineCount <=
      budget.usableLines
    ) {
      break;
    }
    releaseLease(candidate, "demoted", `preempted_by_${input.intent}`);
    demoted.push(candidate);
  }

  return demoted;
}

function demoteLowerPriorityPoolLeases(input: {
  owner: string;
  pool: MarketDataPoolId;
  priority: number;
  lineIds: string[];
}): MarketDataLease[] {
  const demoted: MarketDataLease[] = [];
  let poolLineIds = activeChargeableLineIdsForStrictPoolScope(input.pool);
  let newPoolLineIds = chargeableNewLineIdsForPool(input.pool, input.lineIds);
  let poolCap = getMarketDataPoolEffectiveLineCap(input.pool);
  if (poolLineIds.size + newPoolLineIds.length <= poolCap) {
    return demoted;
  }

  const poolScope = isAutomationExecutionPool(input.pool)
    ? new Set<MarketDataPoolId>(["execution", "automation"])
    : new Set<MarketDataPoolId>([input.pool]);
  const candidates = Array.from(leases.values())
    .filter(
      (lease) =>
        poolScope.has(lease.pool) &&
        lease.owner !== input.owner &&
        lease.priority < input.priority,
    )
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    );

  for (const candidate of candidates) {
    if (poolLineIds.size + newPoolLineIds.length <= poolCap) {
      break;
    }
    releaseLease(candidate, "demoted", `pool_cap_preempted_by_${input.pool}`);
    demoted.push(candidate);
    poolLineIds = activeChargeableLineIdsForStrictPoolScope(input.pool);
    newPoolLineIds = chargeableNewLineIdsForPool(input.pool, input.lineIds);
    poolCap = getMarketDataPoolEffectiveLineCap(input.pool);
  }

  return demoted;
}

function rebalanceFlowScannerLeasesAboveEffectiveCap(
  reason: string,
): MarketDataLease[] {
  const demoted: MarketDataLease[] = [];
  let scannerLineIds = activeChargeableLineIdsForStrictPoolScope("flow-scanner");
  let scannerLineCap = getMarketDataPoolEffectiveLineCap("flow-scanner");
  if (scannerLineIds.size <= scannerLineCap) {
    return demoted;
  }

  const candidates = Array.from(leases.values())
    .filter((lease) => lease.pool === "flow-scanner")
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    );

  for (const candidate of candidates) {
    if (scannerLineIds.size <= scannerLineCap) {
      break;
    }
    releaseLease(candidate, "demoted", reason);
    demoted.push(candidate);
    scannerLineIds = activeChargeableLineIdsForStrictPoolScope("flow-scanner");
    scannerLineCap = getMarketDataPoolEffectiveLineCap("flow-scanner");
  }

  return demoted;
}

function rotateFlowScannerLeasesForRequest(input: {
  owner: string;
  priority: number;
  lineIds: string[];
}): MarketDataLease[] {
  const rotated: MarketDataLease[] = [];
  let scannerLineIds = activeChargeableLineIdsForStrictPoolScope("flow-scanner");
  let newScannerLineIds = chargeableNewLineIdsForPool("flow-scanner", input.lineIds);
  let scannerLineCap = getMarketDataPoolEffectiveLineCap("flow-scanner");
  if (scannerLineIds.size + newScannerLineIds.length <= scannerLineCap) {
    return rotated;
  }

  const candidates = Array.from(leases.values())
    .filter(
      (lease) =>
        lease.pool === "flow-scanner" &&
        lease.owner !== input.owner &&
        lease.ownerClass === "flow-scanner" &&
        lease.priority === input.priority,
    )
    .sort(
      (left, right) =>
        Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    );

  for (const candidate of candidates) {
    if (scannerLineIds.size + newScannerLineIds.length <= scannerLineCap) {
      break;
    }
    releaseLease(candidate, "demoted", "flow_scanner_rotated");
    rotated.push(candidate);
    scannerLineIds = activeChargeableLineIdsForStrictPoolScope("flow-scanner");
    newScannerLineIds = chargeableNewLineIdsForPool("flow-scanner", input.lineIds);
    scannerLineCap = getMarketDataPoolEffectiveLineCap("flow-scanner");
  }

  return rotated;
}

function releaseFlowScannerUnderlyingConflicts(input: {
  owner: string;
  symbol: string | null;
}): MarketDataLease[] {
  const symbol = normalizeSymbol(input.symbol ?? "");
  if (!symbol) {
    return [];
  }
  const rotated: MarketDataLease[] = [];
  Array.from(leases.values())
    .filter(
      (lease) =>
        lease.owner === input.owner &&
        lease.intent === "flow-scanner-live" &&
        lease.pool === "flow-scanner" &&
        lease.assetClass === "option" &&
        normalizeSymbol(lease.symbol ?? "") === symbol,
    )
    .sort(
      (left, right) =>
        Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    )
    .forEach((lease) => {
      releaseLease(lease, "demoted", "flow_scanner_underlying_rotated");
      rotated.push(lease);
    });
  return rotated;
}

function buildFlowScannerDynamicLineCap(
  budget = getMarketDataAdmissionBudget(),
) {
  const scannerLineIds = activeLineIds({ pool: "flow-scanner" });
  const nonScannerLineIds = new Set<string>();
  const nonScannerOptionLineIds = new Set<string>();
  const tradeOptionsChainLineIds = new Set<string>();
  activeLeaseValues().forEach((lease) => {
    if (lease.pool === "flow-scanner") {
      return;
    }
    lease.lineIds.forEach((lineIdValue) => {
      nonScannerLineIds.add(lineIdValue);
      if (lease.pool === "visible") {
        tradeOptionsChainLineIds.add(lineIdValue);
      }
      if (lineIdValue.startsWith("option:")) {
        nonScannerOptionLineIds.add(lineIdValue);
      }
    });
  });
  const scannerSharedLineIds = new Set(
    Array.from(scannerLineIds).filter((id) => nonScannerLineIds.has(id)),
  );
  const scannerChargedLineIds = new Set(
    Array.from(scannerLineIds).filter((id) => !nonScannerLineIds.has(id)),
  );
  const optionBudgetLineCount = budget.flowScannerLineCap;
  const tradeOptionsChainReserveLineCount =
    tradeOptionsChainLineIds.size;
  const protectedPriorityLineCount = nonScannerLineIds.size;
  const optionReserveLineCount = protectedPriorityLineCount;
  const dynamicScannerLineCap = Math.max(0, budget.flowScannerLineCap);
  const effectiveScannerLineCap = dynamicScannerLineCap;
  const ibkrPressureCap =
    getActiveIbkrPressureDampingEvent()?.scannerLineTarget ?? null;
  const dampedScannerLineCap =
    ibkrPressureCap === null
      ? effectiveScannerLineCap
      : Math.max(0, Math.min(effectiveScannerLineCap, ibkrPressureCap));
  return {
    optionBudgetLineCount,
    nonScannerOptionLineCount: nonScannerOptionLineIds.size,
    tradeOptionsChainReserveLineCount,
    optionReserveLineCount,
    protectedPriorityLineCount,
    dynamicScannerLineCap,
    scannerStaticLineCap: budget.flowScannerLineCap,
    scannerEffectiveLineCap: dampedScannerLineCap,
    scannerPressureLineCap: ibkrPressureCap,
    scannerPressureDampingActive: ibkrPressureCap !== null,
    scannerActiveLineCount: scannerLineIds.size,
    scannerChargedLineCount: scannerChargedLineIds.size,
    scannerSharedLineCount: scannerSharedLineIds.size,
    scannerRemainingLineCount: Math.max(
      0,
      effectiveScannerLineCap - scannerChargedLineIds.size,
    ),
    nonScannerOptionLineSample: sampleDiagnosticLineIds(
      nonScannerOptionLineIds,
    ),
    scannerChargedLineSample: sampleDiagnosticLineIds(scannerChargedLineIds),
    scannerSharedLineSample: sampleDiagnosticLineIds(scannerSharedLineIds),
  };
}

export function getMarketDataPoolEffectiveLineCap(
  pool: MarketDataPoolId,
  budget = getMarketDataAdmissionBudget(),
): number {
  const staticCap = budget.poolLineCaps[pool];
  if (isAutomationExecutionPool(pool)) {
    return budget.automationExecutionLineCap;
  }
  if (pool === "flow-scanner") {
    return buildFlowScannerDynamicLineCap(budget).scannerEffectiveLineCap;
  }
  return staticCap;
}

function marketDataLineUtilizationLevel(input: {
  utilization: number;
  usableRemainingLineCount: number;
  constrainedByActiveDemand: boolean;
}): "normal" | "watch" | "constrained" | "protected" {
  if (
    input.usableRemainingLineCount <= 0 ||
    input.utilization >= 0.95 ||
    (input.utilization >= 0.85 && input.usableRemainingLineCount <= 5)
  ) {
    return "protected";
  }
  if (input.utilization >= 0.85 || input.constrainedByActiveDemand) {
    return "constrained";
  }
  if (input.utilization >= 0.65) {
    return "watch";
  }
  return "normal";
}

export function getMarketDataLinePressureSnapshot() {
  const budget = getMarketDataAdmissionBudget();
  const brokerBudgetLines = activeBrokerBudgetLineIds();
  const flowScannerLines = activeLineIds({ pool: "flow-scanner" });
  const flowScannerChargedLines =
    activeChargeableLineIdsForStrictPoolScope("flow-scanner");
  const visibleLines = activeLineIds({ pool: "visible" });
  const executionLines = activeLineIds({ intent: "execution-live" });
  const automationExecutionLines = activeLineIdsForPools([
    "execution",
    "automation",
  ]);
  const accountMonitorLines = activeLineIds({ intent: "account-monitor-live" });
  const automationLines = activeLineIds({ intent: "automation-live" });
  const usableRemainingLineCount = Math.max(
    0,
    budget.usableLines - brokerBudgetLines.size,
  );
  const utilization =
    budget.usableLines > 0 ? brokerBudgetLines.size / budget.usableLines : 1;
  const scannerStaticLineCap = budget.flowScannerLineCap;
  const scannerConfiguredLineCap = resolveConfiguredFlowScannerLineCap();
  const flowScannerDynamic = buildFlowScannerDynamicLineCap(budget);
  const scannerEffectiveLineCap = getMarketDataPoolEffectiveLineCap(
    "flow-scanner",
    budget,
  );
  const activeIbkrPressureEvent = getActiveIbkrPressureDampingEvent();
  const constrainedByActiveDemand = false;
  const utilizationLevel = marketDataLineUtilizationLevel({
    utilization,
    usableRemainingLineCount,
    constrainedByActiveDemand,
  });
  const state = utilizationLevel === "watch" ? "normal" : utilizationLevel;

  return {
    state,
    utilizationLevel,
    policy: "options-flow-rotation-allocation",
    budgetSource: budget.budgetSource,
    configuredMaxLines: budget.configuredMaxLines,
    bridgeLineBudget: budget.bridgeLineBudget,
    activeLineCount: brokerBudgetLines.size,
    grossActiveLineCount: brokerBudgetLines.size,
    usableLineCount: budget.usableLines,
    usableRemainingLineCount,
    utilization,
    utilizationPercent: Math.round(utilization * 1_000) / 10,
    visibleLineCount: visibleLines.size,
    visibleLineCap: budget.visibleLineCap,
    visibleRemainingLineCount: Math.max(
      0,
      getMarketDataPoolEffectiveLineCap("visible", budget) - visibleLines.size,
    ),
    protectedLineCount: automationExecutionLines.size,
    automationExecutionLineCount: automationExecutionLines.size,
    automationExecutionLineCap: budget.automationExecutionLineCap,
    automationExecutionRemainingLineCount: Math.max(
      0,
      budget.automationExecutionLineCap - automationExecutionLines.size,
    ),
    executionLineCount: executionLines.size,
    accountMonitorLineCount: accountMonitorLines.size,
    accountMonitorLineCap: budget.accountMonitorLineCap,
    accountMonitorDynamic: false,
    automationLineCount: automationLines.size,
    scannerConfiguredLineCap,
    scannerStaticLineCap,
    scannerEffectiveLineCap,
    scannerPressureLineCap: flowScannerDynamic.scannerPressureLineCap,
    scannerPressureDampingActive:
      flowScannerDynamic.scannerPressureDampingActive,
    scannerDynamicLineCap: flowScannerDynamic.dynamicScannerLineCap,
    optionBudgetLineCount: flowScannerDynamic.optionBudgetLineCount,
    nonScannerOptionLineCount: flowScannerDynamic.nonScannerOptionLineCount,
    tradeOptionsChainReserveLineCount:
      flowScannerDynamic.tradeOptionsChainReserveLineCount,
    optionReserveLineCount: flowScannerDynamic.optionReserveLineCount,
    protectedPriorityLineCount:
      flowScannerDynamic.protectedPriorityLineCount,
    nonScannerOptionLineSample: flowScannerDynamic.nonScannerOptionLineSample,
    flowScannerContractCount: flowScannerLines.size,
    scannerActiveLineCount: flowScannerLines.size,
    scannerChargedLineCount: flowScannerChargedLines.size,
    scannerSharedLineCount: flowScannerDynamic.scannerSharedLineCount,
    scannerChargedLineSample: flowScannerDynamic.scannerChargedLineSample,
    scannerSharedLineSample: flowScannerDynamic.scannerSharedLineSample,
    scannerRemainingLineCount: Math.max(
      0,
      scannerEffectiveLineCap - flowScannerChargedLines.size,
    ),
    scannerConstrainedByActiveDemand: constrainedByActiveDemand,
    ibkrPressure: lastIbkrPressureEvent
      ? {
          ...lastIbkrPressureEvent,
          observedAt: new Date(lastIbkrPressureEvent.observedAt).toISOString(),
          dampingExpiresAt: new Date(
            lastIbkrPressureEvent.dampingExpiresAt,
          ).toISOString(),
          dampingActive:
            activeIbkrPressureEvent === lastIbkrPressureEvent,
        }
      : null,
  };
}

function sameInstrumentSet(
  left: Array<Pick<MarketDataLease, "instrumentKey">>,
  right: Array<Pick<MarketDataLease, "instrumentKey">>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightKeys = new Set(right.map((item) => item.instrumentKey));
  return left.every((item) => rightKeys.has(item.instrumentKey));
}

export function admitMarketDataLeases(input: {
  owner: string;
  intent: MarketDataIntent;
  pool?: MarketDataPoolId;
  requests: MarketDataLineRequest[];
  ttlMs?: number | null;
  fallbackProvider?: MarketDataFallbackProvider;
  replaceOwnerExisting?: boolean;
}): MarketDataAdmissionResult {
  expireMarketDataLeases();
  const fallbackProvider = input.fallbackProvider ?? "massive";
  const budget = getMarketDataAdmissionBudget();
  const pool = normalizeMarketDataPoolId(input.pool, INTENT_POOL[input.intent]);
  const ownerClass = classifyMarketDataOwner({
    owner: input.owner,
    intent: input.intent,
    pool,
  });
  const basePriority = resolveMarketDataLeasePriority({
    intent: input.intent,
    ownerClass,
  });
  const admitted: MarketDataLease[] = [];
  const rejected: MarketDataAdmissionResult["rejected"] = [];
  const demoted: MarketDataLease[] = [];
  const expiresAt =
    typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs) && input.ttlMs > 0
      ? new Date(Date.now() + input.ttlMs).toISOString()
      : null;
  const normalizedRequests = input.requests
    .map((request) => normalizeRequest(request))
    .filter((request): request is NonNullable<ReturnType<typeof normalizeRequest>> =>
      Boolean(request),
    );

  if (
    input.replaceOwnerExisting !== false &&
    normalizedRequests.length > 0 &&
    normalizedRequests.length === input.requests.length
  ) {
    const existingOwnerLeases = Array.from(leases.values()).filter(
      (lease) =>
        lease.owner === input.owner &&
        lease.intent === input.intent &&
        lease.pool === pool &&
        lease.fallbackProvider === fallbackProvider,
    );
    if (sameInstrumentSet(existingOwnerLeases, normalizedRequests)) {
      const currentLineCount = activeBrokerBudgetLineIds().size;
      const currentPoolLineCount = activeLineIdsForStrictPoolScope(pool).size;
      const poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      const refreshWouldPreserveOverCap =
        currentLineCount > budget.usableLines ||
        (STRICT_POOL_IDS.has(pool) && currentPoolLineCount > poolCap);
      if (!refreshWouldPreserveOverCap) {
        const normalizedByInstrument = new Map(
          normalizedRequests.map((request) => [request.instrumentKey, request]),
        );
        const refreshedLeases = existingOwnerLeases.map((lease) => {
          const normalized = normalizedByInstrument.get(lease.instrumentKey);
          return {
            ...lease,
            ownerClass,
            priority: basePriority + (normalized?.priorityOffset ?? 0),
            providerContractId:
              normalized?.providerContractId ?? lease.providerContractId,
            role: normalized?.role ?? lease.role,
            lineIds: normalized?.lineIds ?? lease.lineIds,
            lineRoles: normalized?.lineRoles ?? lease.lineRoles,
            expiresAt,
          };
        });
        refreshedLeases.forEach((lease) => leases.set(lease.id, lease));
        return {
          admitted: refreshedLeases,
          rejected,
          demoted,
          budget,
        };
      }
    }

    releaseMarketDataLeases(input.owner, "owner_replaced");
  }

  input.requests.forEach((request) => {
    const normalized = normalizeRequest(request);
    if (!normalized) {
      rejected.push({ request, reason: "invalid", fallbackProvider });
      recordEvent({
        action: "rejected",
        owner: input.owner,
        intent: input.intent,
        pool,
        reason: "invalid",
        fallbackProvider,
      });
      return;
    }

    if (
      pool === "flow-scanner" &&
      normalized.assetClass === "option" &&
      normalizedRequests.length === 1
    ) {
      demoted.push(
        ...releaseFlowScannerUnderlyingConflicts({
          owner: input.owner,
          symbol: normalized.symbol,
        }),
      );
    }

    let currentLines = activeLineIds();
    const newLineIds = normalized.lineIds.filter((id) => !currentLines.has(id));
    let neededLineCount = newLineIds.length;
    const priority = basePriority + normalized.priorityOffset;

    if (pool === "flow-scanner" && getMarketDataPoolEffectiveLineCap(pool, budget) <= 0) {
      rejected.push({ request, reason: "pool-cap", fallbackProvider });
      recordEvent({
        action: "rejected",
        owner: input.owner,
        intent: input.intent,
        pool,
        instrumentKey: normalized.instrumentKey,
        lineCost: normalized.lineIds.length,
        reason: "pool-cap",
        fallbackProvider,
      });
      return;
    }

    if (STRICT_POOL_IDS.has(pool) && neededLineCount > 0) {
      let poolLines = activeChargeableLineIdsForStrictPoolScope(pool);
      let newPoolLineIds = chargeableNewLineIdsForPool(pool, normalized.lineIds);
      let poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      if (poolLines.size + newPoolLineIds.length > poolCap) {
        demoted.push(
          ...demoteLowerPriorityPoolLeases({
            owner: input.owner,
            pool,
            priority,
            lineIds: normalized.lineIds,
          }),
        );
        poolLines = activeChargeableLineIdsForStrictPoolScope(pool);
        newPoolLineIds = chargeableNewLineIdsForPool(pool, normalized.lineIds);
        poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      }
      if (
        pool === "flow-scanner" &&
        poolLines.size + newPoolLineIds.length > poolCap
      ) {
        demoted.push(
          ...demoteLowerPriorityLeases({
            owner: input.owner,
            priority,
            neededLineCount: newPoolLineIds.length,
            intent: input.intent,
          }),
        );
        poolLines = activeChargeableLineIdsForStrictPoolScope(pool);
        newPoolLineIds = chargeableNewLineIdsForPool(pool, normalized.lineIds);
        poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      }
      if (
        pool === "flow-scanner" &&
        poolLines.size + newPoolLineIds.length > poolCap
      ) {
        demoted.push(
          ...rotateFlowScannerLeasesForRequest({
            owner: input.owner,
            priority,
            lineIds: normalized.lineIds,
          }),
        );
        poolLines = activeChargeableLineIdsForStrictPoolScope(pool);
        newPoolLineIds = chargeableNewLineIdsForPool(pool, normalized.lineIds);
        poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      }
      if (poolLines.size + newPoolLineIds.length > poolCap) {
        const reason = isAutomationExecutionPool(pool)
          ? "automation-cap"
          : "pool-cap";
        rejected.push({ request, reason, fallbackProvider });
        recordEvent({
          action: "rejected",
          owner: input.owner,
          intent: input.intent,
          pool,
          instrumentKey: normalized.instrumentKey,
          lineCost: normalized.lineIds.length,
          reason,
          fallbackProvider,
        });
        return;
      }
    }

    const currentBrokerLines = activeBrokerBudgetLineIds();
    const brokerNeededLineCount =
      pool === "flow-scanner"
        ? 0
        : normalized.lineIds.filter((id) => !currentBrokerLines.has(id)).length;
    if (
      pool !== "flow-scanner" &&
      currentBrokerLines.size + brokerNeededLineCount > budget.usableLines
    ) {
      demoted.push(
        ...demoteLowerPriorityLeases({
          owner: input.owner,
          priority,
          neededLineCount: brokerNeededLineCount,
          intent: input.intent,
        }),
      );
      const linesAfterDemotion = activeBrokerBudgetLineIds();
      const neededLinesAfterDemotion = normalized.lineIds.filter(
        (id) => !linesAfterDemotion.has(id),
      ).length;
      if (
        linesAfterDemotion.size + neededLinesAfterDemotion >
        budget.usableLines
      ) {
        rejected.push({ request, reason: "budget", fallbackProvider });
        recordEvent({
          action: "rejected",
          owner: input.owner,
          intent: input.intent,
          pool,
          instrumentKey: normalized.instrumentKey,
          lineCost: normalized.lineIds.length,
          reason: "budget",
          fallbackProvider,
        });
        return;
      }
    }
    currentLines = activeLineIds();
    neededLineCount =
      pool === "flow-scanner"
        ? normalized.lineIds.filter((id) => !currentLines.has(id)).length
        : normalized.lineIds.filter((id) => !activeBrokerBudgetLineIds().has(id))
            .length;

    const lease: MarketDataLease = {
      id: String(nextLeaseId++),
      owner: input.owner,
      ownerClass,
      intent: input.intent,
      pool,
      priority,
      assetClass: normalized.assetClass,
      instrumentKey: normalized.instrumentKey,
      symbol: normalized.symbol,
      providerContractId: normalized.providerContractId,
      role: normalized.role,
      lineIds: normalized.lineIds,
      lineRoles: normalized.lineRoles,
      lineCost: neededLineCount,
      fallbackProvider,
      acquiredAt: new Date().toISOString(),
      expiresAt,
    };
    leases.set(lease.id, lease);
    admitted.push(lease);
    const event = recordEvent({
      action: "admitted",
      owner: lease.owner,
      intent: lease.intent,
      pool: lease.pool,
      instrumentKey: lease.instrumentKey,
      lineCost: lease.lineCost,
      fallbackProvider: lease.fallbackProvider,
    });
    notifyLeaseChange({
      ...event,
      lease: cloneLease(lease),
    });
  });

  if (pool !== "flow-scanner") {
    demoted.push(
      ...rebalanceFlowScannerLeasesAboveEffectiveCap(
        `protected_demand_rebalanced_by_${pool}`,
      ),
    );
  }

  return {
    admitted,
    rejected,
    demoted,
    budget,
  };
}

export function recordMarketDataFallback(input: {
  owner: string;
  intent: MarketDataIntent;
  fallbackProvider: MarketDataFallbackProvider;
  reason: string;
  instrumentKey?: string | null;
}): void {
  recordEvent({
    action: "fallback",
    owner: input.owner,
    intent: input.intent,
    pool: INTENT_POOL[input.intent],
    instrumentKey: input.instrumentKey ?? null,
    reason: input.reason,
    fallbackProvider: input.fallbackProvider,
  });
}

export function isMarketDataLeaseActive(input: {
  owner: string;
  assetClass: MarketDataLineAssetClass;
  symbol?: string | null;
  providerContractId?: string | null;
}): boolean {
  expireMarketDataLeases();
  const normalized = normalizeRequest({
    assetClass: input.assetClass,
    symbol: input.symbol,
    providerContractId: input.providerContractId,
  });
  if (!normalized) {
    return false;
  }

  return Array.from(leases.values()).some(
    (lease) =>
      lease.owner === input.owner &&
      lease.instrumentKey === normalized.instrumentKey,
  );
}

export function getMarketDataLeasesSnapshot(): MarketDataLease[] {
  expireMarketDataLeases();
  return Array.from(leases.values()).map((lease) => ({
    ...lease,
    lineIds: [...lease.lineIds],
    lineRoles: { ...lease.lineRoles },
  }));
}

export function getMarketDataAdmissionDiagnostics() {
  const budget = getMarketDataAdmissionBudget();
  const pressure = getMarketDataLinePressureSnapshot();
  const lineAllocation = buildLineAllocationDiagnostics(budget);
  const accountMonitor = buildAccountMonitorDiagnostics(budget);
  const ownerClasses = buildOwnerClassDiagnostics();
  const lineOwnership = buildLineOwnershipDiagnostics();
  const portfolio = buildPortfolioDiagnostics();
  const flowScannerActivity = buildFlowScannerActivityDiagnostics();
  const flowScannerTickerSlots = buildFlowScannerTickerSlotDiagnostics();
  const equityRoleDiagnostics = activeEquityLineRoleDiagnostics();
  const uniqueLines = activeLineIds();
  const brokerBudgetLines = activeBrokerBudgetLineIds();
  const equityLines = Array.from(brokerBudgetLines).filter((id) =>
    id.startsWith("equity:"),
  );
  const optionLines = Array.from(brokerBudgetLines).filter((id) =>
    id.startsWith("option:"),
  );
  const executionLines = activeLineIds({ intent: "execution-live" });
  const automationLines = activeLineIds({ intent: "automation-live" });
  const automationExecutionLines = activeLineIdsForPools([
    "execution",
    "automation",
  ]);
  const accountMonitorLines = activeLineIds({ intent: "account-monitor-live" });
  const visibleLines = activeLineIds({ pool: "visible" });
  const flowScannerLines = activeLineIds({ intent: "flow-scanner-live" });
  const flowScannerChargedLines =
    activeChargeableLineIdsForStrictPoolScope("flow-scanner");
  const intentUsage = Object.fromEntries(
    (Object.keys(INTENT_PRIORITY) as MarketDataIntent[]).map((intent) => [
      intent,
      activeLineIds({ intent }).size,
    ]),
  ) as Record<MarketDataIntent, number>;
  const counters = Object.fromEntries(
    (Object.keys(INTENT_PRIORITY) as MarketDataIntent[]).map((intent) => [
      intent,
      { ...getCounters(intent) },
    ]),
  ) as Record<MarketDataIntent, AdmissionCounters>;
  const poolUsage = Object.fromEntries(
    OPERATOR_POOL_IDS.map((pool) => {
      const lines = activeLineIds({ pool });
      const scopedLines = activeLineIdsForStrictPoolScope(pool);
      const chargedLines =
        pool === "flow-scanner"
          ? activeChargeableLineIdsForStrictPoolScope(pool)
          : lines;
      const maxLines = isAutomationExecutionPool(pool)
        ? budget.automationExecutionLineCap
        : budget.poolLineCaps[pool];
      const dynamic = pool === "flow-scanner";
      const effectiveMaxLines = getMarketDataPoolEffectiveLineCap(pool, budget);
      const effectiveActiveLineCount = isAutomationExecutionPool(pool)
        ? scopedLines.size
        : chargedLines.size;
      const usage = {
        id: pool,
        label: POOL_LABELS[pool],
        activeLineCount: lines.size,
        maxLines,
        effectiveMaxLines,
        remainingLineCount: Math.max(
          0,
          effectiveMaxLines - effectiveActiveLineCount,
        ),
        strict: STRICT_POOL_IDS.has(pool),
        dynamic,
        intents: POOL_INTENTS[pool],
        chargedLineCount: chargedLines.size,
      };
      return [pool, usage];
    }),
  ) as Partial<Record<
    MarketDataPoolId,
    {
      id: MarketDataPoolId;
      label: string;
      activeLineCount: number;
      maxLines: number;
      effectiveMaxLines: number;
      remainingLineCount: number;
      strict: boolean;
      dynamic: boolean;
      intents: MarketDataIntent[];
      chargedLineCount: number;
    }
  >>;
  const poolUsageRanking = OPERATOR_POOL_IDS.map((pool) => {
    const usage = poolUsage[pool]!;
    const usageRatio =
      usage.effectiveMaxLines > 0
        ? usage.chargedLineCount / usage.effectiveMaxLines
        : usage.chargedLineCount > 0
          ? 1
          : 0;
    return {
      rank: 0,
      id: usage.id,
      label: usage.label,
      activeLineCount: usage.activeLineCount,
      chargedLineCount: usage.chargedLineCount,
      effectiveMaxLines: usage.effectiveMaxLines,
      remainingLineCount: usage.remainingLineCount,
      usageRatio,
      usagePercent: Math.round(usageRatio * 1_000) / 10,
      dynamic: usage.dynamic,
      recentIbkrPressureShed:
        usage.id === "flow-scanner" &&
        getActiveIbkrPressureDampingEvent() !== null,
    };
  })
    .sort(
      (left, right) =>
        right.chargedLineCount - left.chargedLineCount ||
        right.usageRatio - left.usageRatio ||
        left.label.localeCompare(right.label),
    )
    .map((usage, index) => ({ ...usage, rank: index + 1 }));

  return {
    schemaVersion: MARKET_DATA_ADMISSION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    budget,
    pressure,
    lineAllocation,
    lineOwnership,
    portfolio,
    activeLineCount: brokerBudgetLines.size,
    grossActiveLineCount: brokerBudgetLines.size,
    totalLeaseLineCount: uniqueLines.size,
    reserveLineCount: Math.max(0, budget.maxLines - brokerBudgetLines.size),
    usableRemainingLineCount: Math.max(
      0,
      budget.usableLines - brokerBudgetLines.size,
    ),
    activeEquityLineCount: equityLines.length,
    ...equityRoleDiagnostics,
    activeOptionLineCount: optionLines.length,
    automationExecutionLineCount: automationExecutionLines.size,
    automationExecutionRemainingLineCount: Math.max(
      0,
      budget.automationExecutionLineCap - automationExecutionLines.size,
    ),
    executionLineCount: executionLines.size,
    automationLineCount: automationLines.size,
    automationRemainingLineCount: Math.max(
      0,
      budget.automationExecutionLineCap - automationExecutionLines.size,
    ),
    accountMonitorLineCount: accountMonitorLines.size,
    accountMonitorRemainingLineCount: accountMonitor.remainingLineCount,
    accountMonitor,
    ownerClasses,
    signalOptions: ownerClasses.signalOptions,
    shadowAccount: ownerClasses.shadowAccount,
    visibleLineCount: visibleLines.size,
    visibleRemainingLineCount: Math.max(
      0,
      getMarketDataPoolEffectiveLineCap("visible", budget) - visibleLines.size,
    ),
    flowScannerLineCount: flowScannerLines.size,
    flowScannerContractCount: flowScannerLines.size,
    flowScannerChargedLineCount: flowScannerChargedLines.size,
    flowScannerSharedLineCount: Math.max(
      0,
      flowScannerLines.size - flowScannerChargedLines.size,
    ),
    flowScannerActivity,
    flowScannerTickerSlots,
    flowScannerRemainingLineCount: Math.max(
      0,
      getMarketDataPoolEffectiveLineCap("flow-scanner", budget) -
        flowScannerLines.size,
    ),
    poolUsage,
    poolUsageRanking,
    activeDataLineGroups: OPERATOR_POOL_IDS.map((pool) => poolUsage[pool]).filter(
      Boolean,
    ),
    leaseCount: activeLeaseValues().length,
    intentUsage,
    counters,
    leases: activeLeaseValues(),
    recentEvents: [...recentEvents],
  };
}

export function __resetMarketDataAdmissionForTests(): void {
  leases.clear();
  countersByIntent.clear();
  recentEvents.length = 0;
  nextLeaseId = 1;
  runtimeBridgeLineBudget = null;
  runtimeFlowScannerLineCap = null;
  lastIbkrPressureEvent = null;
}

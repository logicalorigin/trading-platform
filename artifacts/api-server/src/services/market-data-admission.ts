import { normalizeSymbol } from "../lib/values";

export type MarketDataIntent =
  | "execution-live"
  | "account-monitor-live"
  | "visible-live"
  | "automation-live"
  | "flow-scanner-live"
  | "delayed-ok"
  | "historical";

export type MarketDataFallbackProvider =
  | "polygon"
  | "massive"
  | "cache"
  | "ibkr"
  | "none";

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

export type MarketDataOwnerClass =
  | "execution"
  | "account-monitor"
  | "visible"
  | "automation"
  | "signal-options"
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
  "execution-live": 100,
  "account-monitor-live": 90,
  "visible-live": 80,
  "automation-live": 60,
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
  visible: "Visible",
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
const DEFAULT_RESERVE_LINES = 0;
const MARKET_DATA_ADMISSION_SCHEMA_VERSION = 1;
const DEFAULT_AUTOMATION_EXECUTION_LINES = 30;
const DEFAULT_ACCOUNT_MONITOR_LINES = 30;
const DEFAULT_VISIBLE_LINES = 120;
const DEFAULT_VISIBLE_OPTION_CHAIN_STRIKES_AROUND_MONEY = 5;
const DEFAULT_VISIBLE_OPTION_CHAIN_STRIKE_COUNT =
  DEFAULT_VISIBLE_OPTION_CHAIN_STRIKES_AROUND_MONEY * 2 + 1;
const DEFAULT_VISIBLE_OPTION_CHAIN_LINE_COUNT =
  DEFAULT_VISIBLE_OPTION_CHAIN_STRIKE_COUNT * 2 + 1;
const DEFAULT_VISIBLE_OPTION_QUOTE_CONTRACT_LIMIT = 40;
const DEFAULT_VISIBLE_OPTION_QUOTE_LINE_RESERVE =
  DEFAULT_VISIBLE_OPTION_QUOTE_CONTRACT_LIMIT + 1;
const DEFAULT_VISIBLE_OPTION_SCANNER_RESERVE_LINES =
  DEFAULT_VISIBLE_OPTION_CHAIN_LINE_COUNT;
const DEFAULT_FLOW_SCANNER_LINES = 80;
const DEFAULT_FLOW_SCANNER_CONCURRENCY = 2;
const MAX_FLOW_SCANNER_CONCURRENCY = 2;
const DEFAULT_FLOW_SCANNER_POOL_MAX_LINES = DEFAULT_MAX_LINES;
const DEFAULT_FLOW_SCANNER_OPTION_RESERVE_LINES = 10;
const DEFAULT_FLOW_SCANNER_OPTION_RESERVE_RATIO = 0.15;
const BRIDGE_LINE_BUDGET_TTL_MS = 30_000;
const OPTIONS_FLOW_SCANNER_LINE_BUDGET_ENV = "OPTIONS_FLOW_SCANNER_LINE_BUDGET";
const OPTIONS_FLOW_SCANNER_CONCURRENCY_ENV = "OPTIONS_FLOW_SCANNER_CONCURRENCY";
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
  "flow-scanner": "IBKR_MARKET_DATA_FLOW_SCANNER_LINES",
};

const OWNER_CLASS_LABELS: Record<MarketDataOwnerClass, string> = {
  execution: "Execution",
  "account-monitor": "Account monitor",
  visible: "Visible",
  automation: "Automation",
  "signal-options": "Signal automation",
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
let runtimeFlowScannerLineBudget: number | null = null;
let runtimeFlowScannerConcurrency: number | null = null;
let runtimeBridgeLineBudget:
  | {
      value: number;
      observedAt: number;
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
  if (ownerClass === "signal-options") {
    return 3;
  }
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

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalNonNegativeIntegerEnv(name: string): number | null {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
      : executionOverride ?? automationOverride ?? DEFAULT_AUTOMATION_EXECUTION_LINES;
  return Math.min(usableLines, Math.max(0, configured));
}

function resolveDefaultFlowScannerLineCap(): number {
  const perScanLineBudget = Math.max(
    0,
    runtimeFlowScannerLineBudget ??
      readPositiveIntegerEnv(
        OPTIONS_FLOW_SCANNER_LINE_BUDGET_ENV,
        DEFAULT_FLOW_SCANNER_LINES,
      ),
  );
  const scannerConcurrency = Math.max(
    1,
    Math.min(
      MAX_FLOW_SCANNER_CONCURRENCY,
      runtimeFlowScannerConcurrency ??
        readPositiveIntegerEnv(
          OPTIONS_FLOW_SCANNER_CONCURRENCY_ENV,
          DEFAULT_FLOW_SCANNER_CONCURRENCY,
        ),
    ),
  );
  return Math.min(
    DEFAULT_FLOW_SCANNER_POOL_MAX_LINES,
    perScanLineBudget * scannerConcurrency,
  );
}

function resolveDefaultVisibleLineCap(input: {
  usableLines: number;
}): number {
  const visibleFloor = Math.min(
    input.usableLines,
    DEFAULT_VISIBLE_OPTION_SCANNER_RESERVE_LINES,
  );
  return Math.min(
    input.usableLines,
    Math.max(visibleFloor, DEFAULT_VISIBLE_LINES),
  );
}

function buildDefaultPoolLineCaps(
  usableLines: number,
): Record<MarketDataPoolId, number> {
  const automationExecutionLineCap = resolveAutomationExecutionLineCap(usableLines);
  const accountMonitorLineCap = Math.min(usableLines, DEFAULT_ACCOUNT_MONITOR_LINES);
  const flowScannerLineCap = Math.min(usableLines, resolveDefaultFlowScannerLineCap());
  const visibleLineCap = resolveDefaultVisibleLineCap({
    usableLines,
  });
  return {
    execution: automationExecutionLineCap,
    "account-monitor": accountMonitorLineCap,
    visible: visibleLineCap,
    automation: automationExecutionLineCap,
    "flow-scanner": flowScannerLineCap,
  };
}

function normalizePoolLineCaps(
  usableLines: number,
): Record<MarketDataPoolId, number> {
  const caps = buildDefaultPoolLineCaps(usableLines);
  const envOverrides = new Set<MarketDataPoolId>();
  (Object.keys(caps) as MarketDataPoolId[]).forEach((pool) => {
    if (pool === "execution" || pool === "automation") {
      return;
    }
    const value = readOptionalNonNegativeIntegerEnv(POOL_ENV_KEYS[pool]);
    if (value !== null) {
      caps[pool] = value;
      envOverrides.add(pool);
    }
  });

  (Object.keys(caps) as MarketDataPoolId[]).forEach((pool) => {
    caps[pool] = Math.min(caps[pool], usableLines);
  });

  if (!envOverrides.has("visible")) {
    caps.visible = envOverrides.has("flow-scanner")
      ? Math.min(
          usableLines,
          Math.max(
            DEFAULT_VISIBLE_OPTION_SCANNER_RESERVE_LINES,
            usableLines - caps["flow-scanner"],
          ),
        )
      : resolveDefaultVisibleLineCap({
          usableLines,
        });
  }

  const total = () =>
    Math.max(caps.execution, caps.automation) +
    caps["account-monitor"] +
    caps.visible +
    caps["flow-scanner"];
  const remainingLines = () => Math.max(0, usableLines - total());
  if (remainingLines() > 0 && !envOverrides.has("visible")) {
    caps.visible = Math.min(
      usableLines,
      caps.visible + remainingLines(),
    );
  }
  return caps;
}

export function setMarketDataAdmissionRuntimeDefaults(input: {
  flowScannerLineBudget?: number | null;
  flowScannerConcurrency?: number | null;
}): void {
  const flowScannerLineBudget = input.flowScannerLineBudget;
  runtimeFlowScannerLineBudget =
    typeof flowScannerLineBudget === "number" &&
    Number.isFinite(flowScannerLineBudget) &&
    flowScannerLineBudget > 0
      ? Math.floor(flowScannerLineBudget)
      : null;
  const flowScannerConcurrency = input.flowScannerConcurrency;
  runtimeFlowScannerConcurrency =
    typeof flowScannerConcurrency === "number" &&
    Number.isFinite(flowScannerConcurrency) &&
    flowScannerConcurrency > 0
      ? Math.min(MAX_FLOW_SCANNER_CONCURRENCY, Math.floor(flowScannerConcurrency))
      : null;
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
    return {
      assetClass: "equity",
      instrumentKey: equityLineId,
      symbol,
      providerContractId: null,
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

function activeLineIds(
  options: {
    intent?: MarketDataIntent;
    pool?: MarketDataPoolId;
    excludePool?: MarketDataPoolId;
    excludeOwner?: string;
  } = {},
): Set<string> {
  expireMarketDataLeases();
  const result = new Set<string>();
  leases.forEach((lease) => {
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
  leases.forEach((lease) => {
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
  expireMarketDataLeases();
  const poolSet = new Set(pools);
  const result = new Set<string>();
  leases.forEach((lease) => {
    if (!poolSet.has(lease.pool)) {
      return;
    }
    lease.lineIds.forEach((id) => result.add(id));
  });
  return result;
}

function isAutomationExecutionPool(pool: MarketDataPoolId): boolean {
  return pool === "execution" || pool === "automation";
}

function activeLineIdsForStrictPoolScope(pool: MarketDataPoolId): Set<string> {
  return isAutomationExecutionPool(pool)
    ? activeLineIdsForPools(["execution", "automation"])
    : activeLineIds({ pool });
}

function activeLineIdsForOwnerPrefix(ownerPrefix: string): Set<string> {
  expireMarketDataLeases();
  const result = new Set<string>();
  leases.forEach((lease) => {
    if (!lease.owner.startsWith(ownerPrefix)) {
      return;
    }
    lease.lineIds.forEach((id) => result.add(id));
  });
  return result;
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

  leases.forEach((lease) => {
    lease.lineIds.forEach((id) => {
      if (lease.pool === "execution") {
        protectedLineIds.add(id);
        executionLineIds.add(id);
      } else if (lease.pool === "automation") {
        protectedLineIds.add(id);
        automationLineIds.add(id);
      } else {
        dynamicLineIds.add(id);
        if (lease.pool === "account-monitor") {
          accountLineIds.add(id);
        } else if (lease.pool === "visible") {
          visibleLineIds.add(id);
        } else if (lease.pool === "flow-scanner") {
          scannerLineIds.add(id);
        }
      }
    });
  });

  const activeLineIds = new Set([
    ...protectedLineIds,
    ...dynamicLineIds,
  ]);
  const flowScannerDynamic = buildFlowScannerDynamicLineCap(budget);

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
    scannerStaticLineCap: flowScannerDynamic.scannerStaticLineCap,
    scannerDynamicLineCap: flowScannerDynamic.dynamicScannerLineCap,
    scannerEffectiveLineCap: flowScannerDynamic.scannerEffectiveLineCap,
    scannerRemainingLineCount: flowScannerDynamic.scannerRemainingLineCount,
    optionBudgetLineCount: flowScannerDynamic.optionBudgetLineCount,
    nonScannerOptionLineCount: flowScannerDynamic.nonScannerOptionLineCount,
    optionReserveLineCount: flowScannerDynamic.optionReserveLineCount,
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
  };
}

function buildAccountMonitorDiagnostics(budget = getMarketDataAdmissionBudget()) {
  const accountLeases = Array.from(leases.values()).filter(
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
  };
}

function buildOwnerClassDiagnostics() {
  const groups = new Map<
    MarketDataOwnerClass,
    ReturnType<typeof emptyOwnerClassSummary> & {
      lineIds: Set<string>;
      owners: Set<string>;
      rejectedLineIds: Set<string>;
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
    };
    groups.set(ownerClass, created);
    return created;
  };

  leases.forEach((lease) => {
    const group = ensureGroup(lease.ownerClass);
    group.leaseCount += 1;
    group.owners.add(lease.owner);
    lease.lineIds.forEach((lineId) => group.lineIds.add(lineId));
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
      const { lineIds, owners, rejectedLineIds, ...counts } = group;
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
    unknownOwnerCount: unknownOwners.length,
    retiredOwnerCount: retiredOwners.length,
    warnings,
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
    if (!lease.expiresAt) {
      return;
    }
    if (Date.parse(lease.expiresAt) <= now) {
      releaseLease(lease, "expired", "ttl");
    }
  });
}

function demotionRankForRequest(
  lease: MarketDataLease,
  intent: MarketDataIntent,
): number | null {
  if (intent === "execution-live" && lease.pool === "automation") {
    return 1;
  }
  if (intent === "execution-live" && lease.pool === "flow-scanner") {
    return 2;
  }
  if (intent === "execution-live" && lease.pool === "visible") {
    return 3;
  }
  if (intent === "account-monitor-live") {
    if (lease.pool === "flow-scanner") return 1;
    if (lease.pool === "visible") return 2;
  }
  if (intent === "automation-live") {
    if (lease.pool === "flow-scanner") return 1;
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
    if (activeLineIds().size + input.neededLineCount <= budget.usableLines) {
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
  let poolLineIds = activeLineIdsForStrictPoolScope(input.pool);
  let newPoolLineIds = input.lineIds.filter((id) => !poolLineIds.has(id));
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
    poolLineIds = activeLineIdsForStrictPoolScope(input.pool);
    newPoolLineIds = input.lineIds.filter((id) => !poolLineIds.has(id));
    poolCap = getMarketDataPoolEffectiveLineCap(input.pool);
  }

  return demoted;
}

function demoteAutomationLeasesForExecutionBundle(input: {
  owner: string;
  lineIds: string[];
  cap: number;
}): MarketDataLease[] {
  const demoted: MarketDataLease[] = [];
  let bundleLineIds = activeLineIdsForStrictPoolScope("execution");
  let newBundleLineIds = input.lineIds.filter((id) => !bundleLineIds.has(id));
  if (bundleLineIds.size + newBundleLineIds.length <= input.cap) {
    return demoted;
  }

  const candidates = Array.from(leases.values())
    .filter((lease) => lease.pool === "automation" && lease.owner !== input.owner)
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    );

  for (const candidate of candidates) {
    if (bundleLineIds.size + newBundleLineIds.length <= input.cap) {
      break;
    }
    releaseLease(candidate, "demoted", "execution_reclaimed_algo_bundle");
    demoted.push(candidate);
    bundleLineIds = activeLineIdsForStrictPoolScope("execution");
    newBundleLineIds = input.lineIds.filter((id) => !bundleLineIds.has(id));
  }

  return demoted;
}

function rebalanceFlowScannerLeasesAboveEffectiveCap(
  reason: string,
): MarketDataLease[] {
  const demoted: MarketDataLease[] = [];
  let scannerLineIds = activeLineIds({ pool: "flow-scanner" });
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
    scannerLineIds = activeLineIds({ pool: "flow-scanner" });
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
  let scannerLineIds = activeLineIds({ pool: "flow-scanner" });
  let newScannerLineIds = input.lineIds.filter((id) => !scannerLineIds.has(id));
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
    scannerLineIds = activeLineIds({ pool: "flow-scanner" });
    newScannerLineIds = input.lineIds.filter((id) => !scannerLineIds.has(id));
    scannerLineCap = getMarketDataPoolEffectiveLineCap("flow-scanner");
  }

  return rotated;
}

function buildFlowScannerDynamicLineCap(
  budget = getMarketDataAdmissionBudget(),
) {
  const scannerLineIds = activeLineIds({ pool: "flow-scanner" });
  const nonScannerOptionLineIds = new Set<string>();
  const nonScannerOptionDemandLineIds = new Set<string>();
  leases.forEach((lease) => {
    if (lease.pool === "flow-scanner") {
      return;
    }
    lease.lineIds.forEach((lineIdValue) => {
      if (lease.assetClass === "option") {
        nonScannerOptionDemandLineIds.add(lineIdValue);
      }
      if (lineIdValue.startsWith("option:")) {
        nonScannerOptionLineIds.add(lineIdValue);
      }
    });
  });
  const optionBudgetLineCount = budget.usableLines;
  const explicitFlowScannerLineCap =
    readOptionalNonNegativeIntegerEnv(POOL_ENV_KEYS["flow-scanner"]) !== null;
  const optionReserveLineCount = explicitFlowScannerLineCap
    ? 0
    : Math.min(
        optionBudgetLineCount,
        budget.visibleLineCap,
        Math.max(
          DEFAULT_VISIBLE_OPTION_SCANNER_RESERVE_LINES,
          DEFAULT_FLOW_SCANNER_OPTION_RESERVE_LINES,
          Math.ceil(
            optionBudgetLineCount * DEFAULT_FLOW_SCANNER_OPTION_RESERVE_RATIO,
          ),
        ),
      );
  const protectedVisibleOptionLineCount = Math.max(
    nonScannerOptionDemandLineIds.size,
    optionReserveLineCount,
  );
  const dynamicScannerLineCap = Math.max(
    0,
    optionBudgetLineCount - protectedVisibleOptionLineCount,
  );
  const effectiveScannerLineCap = Math.max(
    0,
    Math.min(budget.flowScannerLineCap, dynamicScannerLineCap),
  );
  return {
    optionBudgetLineCount,
    nonScannerOptionLineCount: nonScannerOptionLineIds.size,
    optionReserveLineCount,
    dynamicScannerLineCap,
    scannerStaticLineCap: budget.flowScannerLineCap,
    scannerEffectiveLineCap: effectiveScannerLineCap,
    scannerActiveLineCount: scannerLineIds.size,
    scannerRemainingLineCount: Math.max(
      0,
      effectiveScannerLineCap - scannerLineIds.size,
    ),
    nonScannerOptionLineSample: sampleDiagnosticLineIds(
      nonScannerOptionLineIds,
    ),
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

export function getMarketDataLinePressureSnapshot() {
  const budget = getMarketDataAdmissionBudget();
  const activeLines = activeLineIds();
  const flowScannerLines = activeLineIds({ pool: "flow-scanner" });
  const visibleLines = activeLineIds({ pool: "visible" });
  const executionLines = activeLineIds({ intent: "execution-live" });
  const automationExecutionLines = activeLineIdsForPools([
    "execution",
    "automation",
  ]);
  const accountMonitorLines = activeLineIds({ intent: "account-monitor-live" });
  const automationLines = activeLineIds({ intent: "automation-live" });
  const usableRemainingLineCount = Math.max(0, budget.usableLines - activeLines.size);
  const utilization =
    budget.usableLines > 0 ? activeLines.size / budget.usableLines : 1;
  const scannerStaticLineCap = budget.flowScannerLineCap;
  const flowScannerDynamic = buildFlowScannerDynamicLineCap(budget);
  const scannerEffectiveLineCap = getMarketDataPoolEffectiveLineCap(
    "flow-scanner",
    budget,
  );
  const constrainedByActiveDemand = false;
  const state =
    usableRemainingLineCount <= 0
      ? "protected"
      : utilization >= 0.75 || constrainedByActiveDemand
        ? "constrained"
        : "normal";

  return {
    state,
    policy: "options-flow-rotation-allocation",
    budgetSource: budget.budgetSource,
    configuredMaxLines: budget.configuredMaxLines,
    bridgeLineBudget: budget.bridgeLineBudget,
    activeLineCount: activeLines.size,
    usableLineCount: budget.usableLines,
    usableRemainingLineCount,
    utilization,
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
    scannerStaticLineCap,
    scannerEffectiveLineCap,
    scannerDynamicLineCap: flowScannerDynamic.dynamicScannerLineCap,
    optionBudgetLineCount: flowScannerDynamic.optionBudgetLineCount,
    nonScannerOptionLineCount: flowScannerDynamic.nonScannerOptionLineCount,
    optionReserveLineCount: flowScannerDynamic.optionReserveLineCount,
    nonScannerOptionLineSample: flowScannerDynamic.nonScannerOptionLineSample,
    scannerActiveLineCount: flowScannerLines.size,
    scannerRemainingLineCount: Math.max(
      0,
      scannerEffectiveLineCap - flowScannerLines.size,
    ),
    scannerConstrainedByActiveDemand: constrainedByActiveDemand,
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
  const fallbackProvider = input.fallbackProvider ?? "polygon";
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
      const currentLineCount = activeLineIds().size;
      const currentPoolLineCount = activeLineIdsForStrictPoolScope(pool).size;
      const poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      const refreshWouldPreserveOverCap =
        currentLineCount > budget.usableLines ||
        (STRICT_POOL_IDS.has(pool) && currentPoolLineCount > poolCap);
      if (!refreshWouldPreserveOverCap) {
        const normalizedByInstrument = new Map(
          normalizedRequests.map((request) => [request.instrumentKey, request]),
        );
        const refreshedLeases = existingOwnerLeases.map((lease) => ({
          ...lease,
          ownerClass,
          priority:
            basePriority +
            (normalizedByInstrument.get(lease.instrumentKey)?.priorityOffset ?? 0),
          expiresAt,
        }));
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

    let currentLines = activeLineIds();
    const newLineIds = normalized.lineIds.filter((id) => !currentLines.has(id));
    let neededLineCount = newLineIds.length;
    const priority = basePriority + normalized.priorityOffset;

    if (STRICT_POOL_IDS.has(pool) && neededLineCount > 0) {
      let poolLines = activeLineIdsForStrictPoolScope(pool);
      let newPoolLineIds = normalized.lineIds.filter((id) => !poolLines.has(id));
      let poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      if (
        pool === "execution" &&
        poolLines.size + newPoolLineIds.length > poolCap
      ) {
        demoted.push(
          ...demoteAutomationLeasesForExecutionBundle({
            owner: input.owner,
            lineIds: normalized.lineIds,
            cap: poolCap,
          }),
        );
        poolLines = activeLineIdsForStrictPoolScope(pool);
        newPoolLineIds = normalized.lineIds.filter((id) => !poolLines.has(id));
        poolCap = getMarketDataPoolEffectiveLineCap(pool, budget);
      }
      if (poolLines.size + newPoolLineIds.length > poolCap) {
        demoted.push(
          ...demoteLowerPriorityPoolLeases({
            owner: input.owner,
            pool,
            priority,
            lineIds: normalized.lineIds,
          }),
        );
        poolLines = activeLineIdsForStrictPoolScope(pool);
        newPoolLineIds = normalized.lineIds.filter((id) => !poolLines.has(id));
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
        poolLines = activeLineIdsForStrictPoolScope(pool);
        newPoolLineIds = normalized.lineIds.filter((id) => !poolLines.has(id));
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
        poolLines = activeLineIdsForStrictPoolScope(pool);
        newPoolLineIds = normalized.lineIds.filter((id) => !poolLines.has(id));
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

    currentLines = activeLineIds();
    neededLineCount = normalized.lineIds.filter(
      (id) => !currentLines.has(id),
    ).length;
    if (currentLines.size + neededLineCount > budget.usableLines) {
      demoted.push(
        ...demoteLowerPriorityLeases({
          owner: input.owner,
          priority,
          neededLineCount,
          intent: input.intent,
        }),
      );
      const linesAfterDemotion = activeLineIds();
      neededLineCount = normalized.lineIds.filter(
        (id) => !linesAfterDemotion.has(id),
      ).length;
      if (linesAfterDemotion.size + neededLineCount > budget.usableLines) {
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
  expireMarketDataLeases();
  const budget = getMarketDataAdmissionBudget();
  const pressure = getMarketDataLinePressureSnapshot();
  const lineAllocation = buildLineAllocationDiagnostics(budget);
  const accountMonitor = buildAccountMonitorDiagnostics(budget);
  const ownerClasses = buildOwnerClassDiagnostics();
  const flowScannerActivity = buildFlowScannerActivityDiagnostics();
  const equityRoleDiagnostics = activeEquityLineRoleDiagnostics();
  const uniqueLines = activeLineIds();
  const equityLines = Array.from(uniqueLines).filter((id) =>
    id.startsWith("equity:"),
  );
  const optionLines = Array.from(uniqueLines).filter((id) =>
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
      const maxLines = isAutomationExecutionPool(pool)
        ? budget.automationExecutionLineCap
        : budget.poolLineCaps[pool];
      const dynamic = pool === "flow-scanner";
      const effectiveMaxLines = getMarketDataPoolEffectiveLineCap(pool, budget);
      const effectiveActiveLineCount = isAutomationExecutionPool(pool)
        ? scopedLines.size
        : lines.size;
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
        chargedLineCount: lines.size,
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

  return {
    schemaVersion: MARKET_DATA_ADMISSION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    budget,
    pressure,
    lineAllocation,
    activeLineCount: uniqueLines.size,
    reserveLineCount: Math.max(0, budget.maxLines - uniqueLines.size),
    usableRemainingLineCount: Math.max(0, budget.usableLines - uniqueLines.size),
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
    visibleLineCount: visibleLines.size,
    visibleRemainingLineCount: Math.max(
      0,
      getMarketDataPoolEffectiveLineCap("visible", budget) - visibleLines.size,
    ),
    flowScannerLineCount: flowScannerLines.size,
    flowScannerActivity,
    flowScannerRemainingLineCount: Math.max(
      0,
      getMarketDataPoolEffectiveLineCap("flow-scanner", budget) -
        flowScannerLines.size,
    ),
    poolUsage,
    activeDataLineGroups: OPERATOR_POOL_IDS.map((pool) => poolUsage[pool]).filter(
      Boolean,
    ),
    leaseCount: leases.size,
    intentUsage,
    counters,
    leases: Array.from(leases.values()),
    recentEvents: [...recentEvents],
  };
}

export function __resetMarketDataAdmissionForTests(): void {
  leases.clear();
  countersByIntent.clear();
  recentEvents.length = 0;
  nextLeaseId = 1;
  runtimeFlowScannerLineBudget = null;
  runtimeFlowScannerConcurrency = null;
  runtimeBridgeLineBudget = null;
}

import { normalizeSymbol } from "../lib/values";

export type MarketDataIntent =
  | "execution-live"
  | "visible-live"
  | "automation-live"
  | "flow-scanner-live"
  | "convenience-live"
  | "delayed-ok"
  | "historical";

export type MarketDataFallbackProvider = "polygon" | "cache" | "ibkr" | "none";

export type MarketDataLineAssetClass = "equity" | "option";

export type MarketDataPoolId =
  | "execution"
  | "visible"
  | "automation"
  | "flow-scanner"
  | "convenience";

export type MarketDataLineRequest = {
  symbol?: string | null;
  providerContractId?: string | null;
  assetClass: MarketDataLineAssetClass;
  requiresGreeks?: boolean;
  underlying?: string | null;
};

export type MarketDataLease = {
  id: string;
  owner: string;
  intent: MarketDataIntent;
  pool: MarketDataPoolId;
  priority: number;
  assetClass: MarketDataLineAssetClass;
  instrumentKey: string;
  symbol: string | null;
  providerContractId: string | null;
  lineIds: string[];
  lineCost: number;
  fallbackProvider: MarketDataFallbackProvider;
  acquiredAt: string;
  expiresAt: string | null;
};

type AdmissionEvent = {
  at: string;
  action: "admitted" | "rejected" | "demoted" | "released" | "expired" | "fallback";
  owner: string;
  intent: MarketDataIntent;
  pool?: MarketDataPoolId | null;
  instrumentKey?: string | null;
  lineCost?: number;
  reason?: string | null;
  fallbackProvider?: MarketDataFallbackProvider | null;
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
    automationLineCap: number;
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
  "visible-live": 80,
  "automation-live": 60,
  "flow-scanner-live": 55,
  "convenience-live": 20,
  "delayed-ok": 10,
  historical: 5,
};

const INTENT_POOL: Record<MarketDataIntent, MarketDataPoolId> = {
  "execution-live": "execution",
  "visible-live": "visible",
  "automation-live": "automation",
  "flow-scanner-live": "flow-scanner",
  "convenience-live": "convenience",
  "delayed-ok": "convenience",
  historical: "convenience",
};

const POOL_LABELS: Record<MarketDataPoolId, string> = {
  execution: "Execution",
  visible: "Visible",
  automation: "Automation",
  "flow-scanner": "Flow scanner",
  convenience: "Convenience",
};

const POOL_INTENTS: Record<MarketDataPoolId, MarketDataIntent[]> = {
  execution: ["execution-live"],
  visible: ["visible-live"],
  automation: ["automation-live"],
  "flow-scanner": ["flow-scanner-live"],
  convenience: ["convenience-live", "delayed-ok", "historical"],
};

const STRICT_POOL_IDS = new Set<MarketDataPoolId>([
  "execution",
  "automation",
  "flow-scanner",
]);

const MAX_RECENT_EVENTS = 100;
const DEFAULT_MAX_LINES = 200;
const DEFAULT_RESERVE_LINES = 15;
const DEFAULT_POOL_LINE_CAPS: Record<MarketDataPoolId, number> = {
  execution: 12,
  visible: 108,
  automation: 25,
  // Keep the admission pool aligned with OPTIONS_FLOW_SCANNER_LINE_BUDGET.
  "flow-scanner": 40,
  convenience: 0,
};

const POOL_ENV_KEYS: Record<MarketDataPoolId, string> = {
  execution: "IBKR_MARKET_DATA_EXECUTION_LINES",
  visible: "IBKR_MARKET_DATA_VISIBLE_LINES",
  automation: "IBKR_MARKET_DATA_AUTOMATION_LINES",
  "flow-scanner": "IBKR_MARKET_DATA_FLOW_SCANNER_LINES",
  convenience: "IBKR_MARKET_DATA_CONVENIENCE_LINES",
};

const leases = new Map<string, MarketDataLease>();
const countersByIntent = new Map<MarketDataIntent, AdmissionCounters>();
const recentEvents: AdmissionEvent[] = [];
let nextLeaseId = 1;

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePoolLineCaps(
  usableLines: number,
): Record<MarketDataPoolId, number> {
  const caps = Object.fromEntries(
    (Object.keys(DEFAULT_POOL_LINE_CAPS) as MarketDataPoolId[]).map((pool) => [
      pool,
      readNonNegativeIntegerEnv(
        POOL_ENV_KEYS[pool],
        DEFAULT_POOL_LINE_CAPS[pool],
      ),
    ]),
  ) as Record<MarketDataPoolId, number>;
  const total = Object.values(caps).reduce((sum, value) => sum + value, 0);
  if (total <= usableLines) {
    caps.convenience += usableLines - total;
    return caps;
  }

  let overflow = total - usableLines;
  const reductionOrder: MarketDataPoolId[] = [
    "convenience",
    "automation",
    "visible",
    "flow-scanner",
    "execution",
  ];
  reductionOrder.forEach((pool) => {
    if (overflow <= 0) {
      return;
    }
    const reduction = Math.min(caps[pool], overflow);
    caps[pool] -= reduction;
    overflow -= reduction;
  });
  return caps;
}

export function getMarketDataAdmissionBudget() {
  const maxLines = readPositiveIntegerEnv(
    "IBKR_MARKET_DATA_APP_MAX_LINES",
    DEFAULT_MAX_LINES,
  );
  const reserveLines = Math.min(
    maxLines - 1,
    readNonNegativeIntegerEnv(
      "IBKR_MARKET_DATA_RESERVE_LINES",
      DEFAULT_RESERVE_LINES,
    ),
  );
  const usableLines = Math.max(1, maxLines - reserveLines);
  const poolLineCaps = normalizePoolLineCaps(usableLines);
  const automationLineCap = poolLineCaps.automation;
  const flowScannerLineCap = poolLineCaps["flow-scanner"];

  return {
    maxLines,
    reserveLines,
    usableLines,
    automationLineCap,
    flowScannerLineCap,
    poolLineCaps,
    pools: (Object.keys(poolLineCaps) as MarketDataPoolId[]).map((pool) => ({
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

function recordEvent(event: Omit<AdmissionEvent, "at">): void {
  recentEvents.push({
    at: new Date().toISOString(),
    ...event,
  });
  if (recentEvents.length > MAX_RECENT_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_EVENTS);
  }

  const counters = getCounters(event.intent);
  counters[event.action] += 1;
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
  lineIds: string[];
} | null {
  if (input.assetClass === "equity") {
    const symbol = normalizeSymbol(input.symbol ?? "");
    if (!symbol) {
      return null;
    }
    return {
      assetClass: "equity",
      instrumentKey: lineId("equity", symbol),
      symbol,
      providerContractId: null,
      lineIds: [lineId("equity", symbol)],
    };
  }

  const providerContractId = normalizeProviderContractId(input.providerContractId);
  if (!providerContractId) {
    return null;
  }
  const optionLineId = lineId("option", providerContractId);
  const lineIds = [optionLineId];
  const underlying = normalizeSymbol(input.underlying ?? input.symbol ?? "");
  if (input.requiresGreeks && underlying) {
    lineIds.push(lineId("equity", underlying));
  }

  return {
    assetClass: "option",
    instrumentKey: optionLineId,
    symbol: underlying || null,
    providerContractId,
    lineIds,
  };
}

function activeLineIds(
  options: {
    intent?: MarketDataIntent;
    pool?: MarketDataPoolId;
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
    lease.lineIds.forEach((id) => result.add(id));
  });
  return result;
}

function releaseLease(lease: MarketDataLease, action: AdmissionEvent["action"], reason: string): void {
  leases.delete(lease.id);
  recordEvent({
    action,
    owner: lease.owner,
    intent: lease.intent,
    pool: lease.pool,
    instrumentKey: lease.instrumentKey,
    lineCost: lease.lineCost,
    reason,
    fallbackProvider: lease.fallbackProvider,
  });
}

export function releaseMarketDataLeases(owner: string, reason = "released"): void {
  Array.from(leases.values())
    .filter((lease) => lease.owner === owner)
    .forEach((lease) => releaseLease(lease, "released", reason));
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

function demoteLowerPriorityLeases(input: {
  owner: string;
  priority: number;
  neededLineCount: number;
  intent: MarketDataIntent;
}): MarketDataLease[] {
  const budget = getMarketDataAdmissionBudget();
  const demoted: MarketDataLease[] = [];
  const candidates = Array.from(leases.values())
    .filter((lease) => lease.owner !== input.owner && lease.priority < input.priority)
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt),
    );

  for (const candidate of candidates) {
    if (activeLineIds().size + input.neededLineCount <= budget.usableLines) {
      break;
    }
    releaseLease(candidate, "demoted", `preempted_by_${input.intent}`);
    demoted.push(candidate);
  }

  return demoted;
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
  if (input.replaceOwnerExisting !== false) {
    releaseMarketDataLeases(input.owner, "owner_replaced");
  }

  const budget = getMarketDataAdmissionBudget();
  const priority = INTENT_PRIORITY[input.intent];
  const pool = input.pool ?? INTENT_POOL[input.intent];
  const admitted: MarketDataLease[] = [];
  const rejected: MarketDataAdmissionResult["rejected"] = [];
  const demoted: MarketDataLease[] = [];
  const expiresAt =
    typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs) && input.ttlMs > 0
      ? new Date(Date.now() + input.ttlMs).toISOString()
      : null;

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

    const currentLines = activeLineIds();
    const newLineIds = normalized.lineIds.filter((id) => !currentLines.has(id));
    let neededLineCount = newLineIds.length;

    if (STRICT_POOL_IDS.has(pool) && neededLineCount > 0) {
      const poolLines = activeLineIds({ pool });
      const newPoolLineIds = normalized.lineIds.filter((id) => !poolLines.has(id));
      const poolCap = budget.poolLineCaps[pool];
      if (poolLines.size + newPoolLineIds.length > poolCap) {
        const reason = pool === "automation" ? "automation-cap" : "pool-cap";
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
      intent: input.intent,
      pool,
      priority,
      assetClass: normalized.assetClass,
      instrumentKey: normalized.instrumentKey,
      symbol: normalized.symbol,
      providerContractId: normalized.providerContractId,
      lineIds: normalized.lineIds,
      lineCost: neededLineCount,
      fallbackProvider,
      acquiredAt: new Date().toISOString(),
      expiresAt,
    };
    leases.set(lease.id, lease);
    admitted.push(lease);
    recordEvent({
      action: "admitted",
      owner: lease.owner,
      intent: lease.intent,
      pool: lease.pool,
      instrumentKey: lease.instrumentKey,
      lineCost: lease.lineCost,
      fallbackProvider: lease.fallbackProvider,
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

export function getMarketDataAdmissionDiagnostics() {
  expireMarketDataLeases();
  const budget = getMarketDataAdmissionBudget();
  const uniqueLines = activeLineIds();
  const equityLines = Array.from(uniqueLines).filter((id) =>
    id.startsWith("equity:"),
  );
  const optionLines = Array.from(uniqueLines).filter((id) =>
    id.startsWith("option:"),
  );
  const automationLines = activeLineIds({ intent: "automation-live" });
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
    (Object.keys(budget.poolLineCaps) as MarketDataPoolId[]).map((pool) => {
      const lines = activeLineIds({ pool });
      const maxLines = budget.poolLineCaps[pool];
      return [
        pool,
        {
          id: pool,
          label: POOL_LABELS[pool],
          activeLineCount: lines.size,
          maxLines,
          remainingLineCount: Math.max(0, maxLines - lines.size),
          strict: STRICT_POOL_IDS.has(pool),
          intents: POOL_INTENTS[pool],
        },
      ];
    }),
  ) as Record<
    MarketDataPoolId,
    {
      id: MarketDataPoolId;
      label: string;
      activeLineCount: number;
      maxLines: number;
      remainingLineCount: number;
      strict: boolean;
      intents: MarketDataIntent[];
    }
  >;

  return {
    budget,
    activeLineCount: uniqueLines.size,
    reserveLineCount: Math.max(0, budget.maxLines - uniqueLines.size),
    usableRemainingLineCount: Math.max(0, budget.usableLines - uniqueLines.size),
    activeEquityLineCount: equityLines.length,
    activeOptionLineCount: optionLines.length,
    automationLineCount: automationLines.size,
    automationRemainingLineCount: Math.max(
      0,
      budget.automationLineCap - automationLines.size,
    ),
    flowScannerLineCount: flowScannerLines.size,
    flowScannerRemainingLineCount: Math.max(
      0,
      budget.flowScannerLineCap - flowScannerLines.size,
    ),
    poolUsage,
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
}

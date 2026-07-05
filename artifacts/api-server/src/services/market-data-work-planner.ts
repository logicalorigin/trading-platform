import {
  resolveUsEquityMarketStatus,
  type UsEquityMarketStatus,
} from "@workspace/market-calendar";
import type {
  MarketDataIntent,
  MarketDataLease,
  MarketDataPoolId,
} from "./market-data-admission";

type ScannerDiagnostics = {
  enabled?: boolean;
  started?: boolean;
  backgroundBlockedReason?: string | null;
  limitingReason?: string | null;
  marketDataMode?: string | null;
  resourcePressure?: { level?: string | null } | null;
  scannerPressure?: {
    level?: string | null;
    throttled?: boolean | null;
    hardBlocked?: boolean | null;
  } | null;
  lineUtilization?: {
    effectiveConcurrency?: number | null;
    configuredConcurrency?: number | null;
    effectivePoolCap?: number | null;
    schedulablePoolCap?: number | null;
    maxDeepScanLines?: number | null;
    scannerLineBudget?: number | null;
    unusedPoolLines?: number | null;
  } | null;
  deepScanner?: {
    queuedCount?: number | null;
    drainingCount?: number | null;
    activeCount?: number | null;
    activeSymbols?: string[];
    draining?: boolean | null;
    lastBatch?: string[];
    lastSkippedReason?: string | null;
  } | null;
  coverage?: {
    activeTargetSize?: number | null;
    selectedSymbols?: number | null;
    currentBatch?: string[];
    batchSize?: number | null;
    intervalMs?: number | null;
    estimatedCycleMs?: number | null;
    coverageHealth?: string | null;
    scannerPhase?: string | null;
    degradedReason?: string | null;
    promotedSymbols?: string[];
  } | null;
  plannedHorizon?: {
    symbolCount?: number | null;
    symbols?: string[];
    batchSize?: number | null;
    intervalMs?: number | null;
    estimatedCycleMs?: number | null;
    coverageHealth?: string | null;
  } | null;
  lastBatch?: string[];
  promotedSymbols?: string[];
};

type IngestDiagnostics = {
  configured?: boolean;
  providerConfigured?: boolean;
  queueDepth?: Record<string, number>;
  oldestQueuedAgeMs?: number | null;
  runningCount?: number;
  expiredLeaseCount?: number;
  claimableQueuedJobCount?: number;
  claimableQueuedJobsByKind?: Record<string, number>;
  workerLikelyInactive?: boolean;
  workerInactiveReason?: string | null;
  blockedGexJobCount?: number;
  oldestBlockedGexAgeMs?: number | null;
  blockedGexJobs?: Array<{
    symbol?: string;
    dedupeBucket?: string;
    missingKind?: string;
    prerequisiteStatus?: string;
    ageMs?: number;
  }>;
  recentCompletedJobs?: Array<{
    kind?: string;
    symbol?: string;
    updatedAt?: Date | string;
  }>;
};

type DriftDiagnostics = {
  status?: string;
  apiOnlyLineCount?: number;
  bridgeOnlyLineCount?: number;
  apiOnlyLineSample?: string[];
  bridgeOnlyLineSample?: string[];
  persistentApiOnlyLineCount?: number;
  persistentApiOnlyLineSample?: string[];
  persistentApiOnlyLines?: Array<{ lineId: string }>;
  persistentBridgeOnlyLineCount?: number;
  persistentBridgeOnlyLineSample?: string[];
  persistentBridgeOnlyLines?: Array<{ lineId: string }>;
};

type StockAggregateDiagnostics = {
  provider?: string | null;
  activeProvider?: string | null;
  activeConsumerCount?: number | null;
  unionSymbolCount?: number | null;
  quoteSubscriptionActive?: boolean | null;
};

type AdmissionDiagnostics = {
  generatedAt?: string;
  activeLineCount?: number;
  activeEquityLineCount?: number;
  activeOptionLineCount?: number;
  flowScannerLineCount?: number;
  leaseCount?: number;
  budget?: {
    targetFillLines?: number;
    usableLines?: number;
    flowScannerLineCap?: number;
    bridgeLineBudget?: number | null;
    budgetSource?: string;
  };
  pressure?: {
    utilizationLevel?: string | null;
    utilizationPercent?: number | null;
    scannerEffectiveLineCap?: number | null;
  };
  poolUsage?: Partial<
    Record<
      MarketDataPoolId,
      {
        activeLineCount?: number;
        effectiveMaxLines?: number;
        remainingLineCount?: number;
      }
    >
  >;
  leases: MarketDataLease[];
};

export type MarketDataWorkPlanLine = {
  owner: string;
  ownerClass: string | null;
  intent: MarketDataIntent | string;
  pool: MarketDataPoolId | string | null;
  provider: "ibkr" | "massive";
  assetClass: "equity" | "option";
  state: "live" | "planned";
  priority: number | null;
  lineCount: number;
  leaseCount: number;
  symbolCount: number;
  symbols: string[];
  lineSample: string[];
  freshnessTargetMs: number | null;
  reason: string;
};

export type MarketDataWorkPlanProviderJob = {
  owner: "rust-market-data-worker" | "market-data-provider";
  provider: "massive";
  intent:
    | "persisted-forward-refresh"
    | "stock-aggregate-fallback"
    | "diagnostics";
  kind: string;
  status:
    | "queued"
    | "running"
    | "failed"
    | "blocked"
    | "completed_recent"
    | "idle"
    | "not_configured"
    | "not_collected"
    | "active";
  priority: number | null;
  jobCount: number;
  symbolCount: number;
  symbols: string[];
  oldestAgeMs: number | null;
  reason: string;
};

export type MarketDataWorkPlanLifecycleAction = {
  state: "releasing" | "unexpected" | "stale" | "evicting";
  owner: string | null;
  provider: "ibkr" | "massive";
  lineCount: number;
  lineSample: string[];
  reason: string;
};

export type MarketDataWorkPlan = {
  schemaVersion: 1;
  generation: string;
  generatedAt: string;
  marketSession: {
    exchange: "XNYS";
    sessionKey: UsEquityMarketStatus["session"]["key"];
    sessionLabel: string;
    regularTrading: boolean;
    equityTrading: boolean;
    tradingDay: boolean;
    earlyClose: boolean;
    holidayName: string | null;
    quietReason: "market_session_quiet" | null;
    nextOpenAt: string | null;
    nextCloseAt: string | null;
  };
  providerPolicy: {
    ibkr: string[];
    massive: string[];
    rustWorker: string[];
  };
  summary: {
    ibkrLiveLineCount: number;
    ibkrEquityLineCount: number;
    ibkrOptionLineCount: number;
    ibkrEquitySymbolCount: number;
    ibkrOptionSymbolCount: number;
    massiveOptionLineCount: number;
    massiveOptionSymbolCount: number;
    persistQueuedJobCount: number;
    persistRunningJobCount: number;
    persistClaimableQueuedJobCount: number;
    persistWorkerInactive: boolean;
    persistBlockedJobCount: number;
    releaseLineCount: number;
    evictLineCount: number;
    scannerPlannedHorizonCount: number;
    scannerEffectiveConcurrency: number | null;
    scannerMaxDeepScanLines: number | null;
    bridgeLineBudget: number | null;
    bridgeActiveLineCount: number | null;
    memoryAction: string;
  };
  ibkrEquityLive: MarketDataWorkPlanLine[];
  ibkrOptionLive: MarketDataWorkPlanLine[];
  massiveOptionLive: MarketDataWorkPlanLine[];
  massiveSnapshot: MarketDataWorkPlanProviderJob[];
  massiveAggregateFallback: MarketDataWorkPlanProviderJob[];
  persistJobs: MarketDataWorkPlanProviderJob[];
  release: MarketDataWorkPlanLifecycleAction[];
  evict: MarketDataWorkPlanLifecycleAction[];
  memoryAction: {
    level: string;
    action: "normal" | "throttle-scanner" | "shed-background-scanner";
    reason: string;
  };
  scanner: {
    enabled: boolean | null;
    started: boolean | null;
    state: string;
    limitingReason: string | null;
    marketDataMode: string | null;
    marketSessionKey: UsEquityMarketStatus["session"]["key"] | null;
    sessionEligible: boolean;
    sessionBlockedReason: "market_session_quiet" | null;
    requestedHorizonCount: number;
    requestedHorizonSymbols: string[];
    plannedHorizonCount: number;
    plannedHorizonSymbols: string[];
    batchSize: number | null;
    intervalMs: number | null;
    estimatedCycleMs: number | null;
    coverageHealth: string | null;
    effectiveConcurrency: number | null;
    maxDeepScanLines: number | null;
    activeDeepScanCount: number | null;
    queuedDeepScanCount: number | null;
  };
};

export type BuildMarketDataWorkPlanInput = {
  generatedAt?: string;
  admission: AdmissionDiagnostics;
  optionsFlowScanner?: ScannerDiagnostics | null;
  ingest?: IngestDiagnostics | null;
  bridge?: {
    diagnosticsAvailable?: boolean;
    activeLineCount?: number | null;
    lineBudget?: number | null;
  } | null;
  drift?: DriftDiagnostics | null;
  stockAggregates?: StockAggregateDiagnostics | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function sample(values: Iterable<string>, limit = 20): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort().slice(0, limit);
}

function lineSymbol(lineId: string): string | null {
  if (lineId.startsWith("equity:")) {
    return lineId.slice("equity:".length) || null;
  }
  return null;
}

function freshnessTargetMs(intent: string): number | null {
  if (intent === "execution-live") return 500;
  if (intent === "account-monitor-live") return 1_000;
  if (intent === "visible-live") return 2_000;
  if (intent === "automation-live") return 5_000;
  if (intent === "flow-scanner-live") return 60_000;
  return null;
}

function liveLineReason(intent: string): string {
  if (intent === "execution-live") return "execution and order decisions require live market data";
  if (intent === "account-monitor-live") return "account and position surfaces require live Massive marks";
  if (intent === "visible-live") return "visible operator surfaces are eligible for live Massive market data";
  if (intent === "automation-live") return "automation signals require Massive marks before execution";
  if (intent === "flow-scanner-live") return "options-flow scanner is using Massive-backed option data";
  return "active API admission owns this live market-data line";
}

function linePlansForAsset(
  leases: MarketDataLease[],
  assetClass: "equity" | "option",
  input: {
    provider?: MarketDataWorkPlanLine["provider"];
    includeLease?: (lease: MarketDataLease) => boolean;
    includeLine?: (lease: MarketDataLease, lineId: string) => boolean;
  } = {},
): MarketDataWorkPlanLine[] {
  const prefix = `${assetClass}:`;
  const provider = input.provider ?? "ibkr";
  const groups = new Map<
    string,
    {
      owner: string;
      ownerClass: string | null;
      intent: string;
      pool: string | null;
      priority: number | null;
      lines: Set<string>;
      leases: Set<string>;
      symbols: Set<string>;
    }
  >();

  leases.forEach((lease) => {
    if (input.includeLease && !input.includeLease(lease)) {
      return;
    }
    const matchingLines = lease.lineIds.filter(
      (lineId) =>
        lineId.startsWith(prefix) &&
        (!input.includeLine || input.includeLine(lease, lineId)),
    );
    if (!matchingLines.length) {
      return;
    }
    const key = [
      lease.owner,
      lease.ownerClass,
      lease.intent,
      lease.pool,
      assetClass,
    ].join("\u0000");
    const group =
      groups.get(key) ??
      {
        owner: lease.owner,
        ownerClass: lease.ownerClass,
        intent: lease.intent,
        pool: lease.pool,
        priority: null,
        lines: new Set<string>(),
        leases: new Set<string>(),
        symbols: new Set<string>(),
      };
    group.priority =
      group.priority === null
        ? lease.priority
        : Math.max(group.priority, lease.priority);
    matchingLines.forEach((lineId) => {
      group.lines.add(lineId);
      const symbol = assetClass === "equity" ? lineSymbol(lineId) : lease.symbol;
      if (symbol) {
        group.symbols.add(symbol);
      }
    });
    group.leases.add(lease.id);
    groups.set(key, group);
  });

  return Array.from(groups.values())
    .map((group) => ({
      owner: group.owner,
      ownerClass: group.ownerClass,
      intent: group.intent,
      pool: group.pool,
      provider,
      assetClass,
      state: "live" as const,
      priority: group.priority,
      lineCount: group.lines.size,
      leaseCount: group.leases.size,
      symbolCount: group.symbols.size,
      symbols: sample(group.symbols),
      lineSample: sample(group.lines),
      freshnessTargetMs: freshnessTargetMs(group.intent),
      reason: liveLineReason(group.intent),
    }))
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        (right.priority ?? 0) - (left.priority ?? 0) ||
        left.owner.localeCompare(right.owner),
    );
}

function countQueuedJobs(ingest: IngestDiagnostics | null | undefined, status: string): number {
  const value = ingest?.queueDepth?.[status];
  return isFiniteNumber(value) ? value : 0;
}

function buildPersistJobs(
  ingest: IngestDiagnostics | null | undefined,
): MarketDataWorkPlanProviderJob[] {
  if (!ingest) {
    return [
      {
        owner: "rust-market-data-worker",
        provider: "massive",
        intent: "diagnostics",
        kind: "market_data_ingest_jobs",
        status: "not_collected",
        priority: null,
        jobCount: 0,
        symbolCount: 0,
        symbols: [],
        oldestAgeMs: null,
        reason: "ingest diagnostics were not collected for this snapshot",
      },
    ];
  }

  if (!ingest.configured) {
    return [
      {
        owner: "rust-market-data-worker",
        provider: "massive",
        intent: "diagnostics",
        kind: "market_data_ingest_jobs",
        status: ingest.providerConfigured ? "not_configured" : "not_configured",
        priority: null,
        jobCount: 0,
        symbolCount: 0,
        symbols: [],
        oldestAgeMs: null,
        reason: ingest.providerConfigured
          ? "database is not configured for persisted market-data worker jobs"
          : "provider credentials are not configured for persisted market-data worker jobs",
      },
    ];
  }

  const rows: MarketDataWorkPlanProviderJob[] = [];
  if (ingest.workerLikelyInactive) {
    rows.push({
      owner: "rust-market-data-worker",
      provider: "massive",
      intent: "persisted-forward-refresh",
      kind: "market_data_worker",
      status: "blocked",
      priority: 1,
      jobCount: readNumber(ingest.claimableQueuedJobCount) ?? 0,
      symbolCount: 0,
      symbols: [],
      oldestAgeMs: ingest.oldestQueuedAgeMs ?? null,
      reason:
        ingest.workerInactiveReason ===
        "claimable_jobs_waiting_without_running_worker"
          ? "claimable persisted refresh jobs are ready, but no market-data-worker job is running"
          : "persisted refresh worker appears inactive",
    });
  }

  (["queued", "running", "failed"] as const).forEach((status) => {
    const jobCount = countQueuedJobs(ingest, status);
    if (jobCount <= 0) {
      return;
    }
    rows.push({
      owner: "rust-market-data-worker",
      provider: "massive",
      intent: "persisted-forward-refresh",
      kind: "market_data_ingest_jobs",
      status,
      priority: status === "running" ? 1 : status === "queued" ? 2 : 5,
      jobCount,
      symbolCount: 0,
      symbols: [],
      oldestAgeMs: status === "queued" ? (ingest.oldestQueuedAgeMs ?? null) : null,
      reason:
        status === "failed"
          ? "worker jobs need retry or operator review"
          : "worker owns persisted stock, option-chain, and GEX snapshots",
    });
  });

  if ((ingest.blockedGexJobCount ?? 0) > 0) {
    rows.push({
      owner: "rust-market-data-worker",
      provider: "massive",
      intent: "persisted-forward-refresh",
      kind: "gex_snapshot",
      status: "blocked",
      priority: 3,
      jobCount: ingest.blockedGexJobCount ?? 0,
      symbolCount: new Set((ingest.blockedGexJobs ?? []).map((job) => job.symbol).filter(Boolean)).size,
      symbols: sample((ingest.blockedGexJobs ?? []).flatMap((job) => job.symbol ?? [])),
      oldestAgeMs: ingest.oldestBlockedGexAgeMs ?? null,
      reason: "GEX jobs are waiting on stock and option-chain prerequisites",
    });
  }

  const recentByKind = new Map<string, Set<string>>();
  (ingest.recentCompletedJobs ?? []).forEach((job) => {
    const kind = String(job.kind || "").trim();
    const symbol = String(job.symbol || "").trim();
    if (!kind || !symbol) {
      return;
    }
    const symbols = recentByKind.get(kind) ?? new Set<string>();
    symbols.add(symbol);
    recentByKind.set(kind, symbols);
  });
  recentByKind.forEach((symbols, kind) => {
    rows.push({
      owner: "rust-market-data-worker",
      provider: "massive",
      intent: "persisted-forward-refresh",
      kind,
      status: "completed_recent",
      priority: null,
      jobCount: symbols.size,
      symbolCount: symbols.size,
      symbols: sample(symbols),
      oldestAgeMs: null,
      reason: "recently completed persisted refresh work",
    });
  });

  if (!rows.length) {
    rows.push({
      owner: "rust-market-data-worker",
      provider: "massive",
      intent: "persisted-forward-refresh",
      kind: "market_data_ingest_jobs",
      status: "idle",
      priority: null,
      jobCount: 0,
      symbolCount: 0,
      symbols: [],
      oldestAgeMs: null,
      reason: "no queued, running, failed, or blocked persisted refresh jobs",
    });
  }
  return rows;
}

function buildAggregateFallbackJob(
  stockAggregates: StockAggregateDiagnostics | null | undefined,
): MarketDataWorkPlanProviderJob[] {
  if (!stockAggregates) {
    return [];
  }
  const provider = String(stockAggregates.activeProvider ?? stockAggregates.provider ?? "");
  if (!provider || !provider.includes("massive")) {
    return [];
  }
  return [
    {
      owner: "market-data-provider",
      provider: "massive",
      intent: "stock-aggregate-fallback",
      kind: "stock_minute_aggregates",
      status: stockAggregates.quoteSubscriptionActive ? "active" : "idle",
      priority: 6,
      jobCount: readNumber(stockAggregates.activeConsumerCount) ?? 0,
      symbolCount: readNumber(stockAggregates.unionSymbolCount) ?? 0,
      symbols: [],
      oldestAgeMs: null,
      reason: "stock aggregate stream is using Massive instead of IBKR-derived aggregates",
    },
  ];
}

function actionRowsFromDrift(
  drift: DriftDiagnostics | null | undefined,
): {
  release: MarketDataWorkPlanLifecycleAction[];
  staleApi: MarketDataWorkPlanLifecycleAction[];
} {
  const persistentBridgeLines =
    drift?.persistentBridgeOnlyLines?.map((entry) => entry.lineId) ??
    drift?.persistentBridgeOnlyLineSample ??
    [];
  const bridgeOnlySample = persistentBridgeLines.length
    ? persistentBridgeLines
    : drift?.bridgeOnlyLineSample ?? [];
  const persistentApiLines =
    drift?.persistentApiOnlyLines?.map((entry) => entry.lineId) ??
    drift?.persistentApiOnlyLineSample ??
    [];

  const release: MarketDataWorkPlanLifecycleAction[] =
    (drift?.bridgeOnlyLineCount ?? 0) > 0
      ? [
          {
            state: persistentBridgeLines.length ? "unexpected" : "releasing",
            owner: null,
            provider: "ibkr",
            lineCount: persistentBridgeLines.length || (drift?.bridgeOnlyLineCount ?? 0),
            lineSample: sample(bridgeOnlySample),
            reason: persistentBridgeLines.length
              ? "bridge has lines that remain unowned by API admission"
              : "bridge has lines that API admission has already released",
          },
        ]
      : [];
  const staleApi: MarketDataWorkPlanLifecycleAction[] =
    (drift?.persistentApiOnlyLineCount ?? 0) > 0 || persistentApiLines.length > 0
      ? [
          {
            state: "stale",
            owner: null,
            provider: "ibkr",
            lineCount: persistentApiLines.length || (drift?.persistentApiOnlyLineCount ?? 0),
            lineSample: sample(persistentApiLines),
            reason: "API admission still owns lines that the bridge has not made live",
          },
        ]
      : [];
  return { release, staleApi };
}

function buildScannerPlan(
  scanner: ScannerDiagnostics | null | undefined,
  marketSession: MarketDataWorkPlan["marketSession"],
) {
  const coverage = scanner?.coverage ?? null;
  const horizon = scanner?.plannedHorizon ?? null;
  const deep = scanner?.deepScanner ?? null;
  const lineUtilization = scanner?.lineUtilization ?? null;
  const horizonSymbols = sample(
    horizon?.symbols ??
      coverage?.currentBatch ??
      scanner?.lastBatch ??
      deep?.lastBatch ??
      scanner?.promotedSymbols ??
      coverage?.promotedSymbols ??
      [],
  );
  const plannedHorizonCount =
    readNumber(horizon?.symbolCount) ??
    readNumber(coverage?.activeTargetSize) ??
    readNumber(coverage?.selectedSymbols) ??
    horizonSymbols.length;
  const sessionBlockedReason = flowScannerSessionBlockedReason(marketSession);
  let state = "planned";
  if (sessionBlockedReason) {
    state = "session_quiet";
  } else if (scanner?.backgroundBlockedReason) {
    state = "blocked";
  } else if (deep?.draining || (deep?.activeCount ?? 0) > 0) {
    state = "active";
  } else if ((deep?.queuedCount ?? 0) > 0) {
    state = "queued";
  }
  const activeDeepScanCount = readNumber(deep?.activeCount) ?? 0;
  const explicitQueuedDeepScanCount = readNumber(deep?.queuedCount) ?? 0;
  const drainingDeepScanCount =
    readNumber(deep?.drainingCount) ?? (deep?.draining ? activeDeepScanCount : 0);
  const pendingDrainingDeepScanCount = Math.max(
    0,
    drainingDeepScanCount - activeDeepScanCount,
  );
  const queuedDeepScanCount =
    explicitQueuedDeepScanCount + pendingDrainingDeepScanCount;
  return {
    enabled: typeof scanner?.enabled === "boolean" ? scanner.enabled : null,
    started: typeof scanner?.started === "boolean" ? scanner.started : null,
    state,
    limitingReason:
      sessionBlockedReason ??
      scanner?.limitingReason ??
      scanner?.backgroundBlockedReason ??
      deep?.lastSkippedReason ??
      coverage?.degradedReason ??
      null,
    marketDataMode: scanner?.marketDataMode ?? null,
    marketSessionKey: marketSession.sessionKey,
    sessionEligible: sessionBlockedReason === null,
    sessionBlockedReason,
    requestedHorizonCount: plannedHorizonCount,
    requestedHorizonSymbols: horizonSymbols,
    plannedHorizonCount: sessionBlockedReason ? 0 : plannedHorizonCount,
    plannedHorizonSymbols: sessionBlockedReason ? [] : horizonSymbols,
    batchSize: readNumber(horizon?.batchSize) ?? readNumber(coverage?.batchSize),
    intervalMs: readNumber(horizon?.intervalMs) ?? readNumber(coverage?.intervalMs),
    estimatedCycleMs:
      readNumber(horizon?.estimatedCycleMs) ??
      readNumber(coverage?.estimatedCycleMs),
    coverageHealth: horizon?.coverageHealth ?? coverage?.coverageHealth ?? null,
    effectiveConcurrency: readNumber(lineUtilization?.effectiveConcurrency),
    maxDeepScanLines: readNumber(lineUtilization?.maxDeepScanLines),
    activeDeepScanCount,
    queuedDeepScanCount,
    scheduledDeepScanCount: activeDeepScanCount + queuedDeepScanCount,
  };
}

function buildMemoryAction(scanner: ScannerDiagnostics | null | undefined): MarketDataWorkPlan["memoryAction"] {
  const level =
    scanner?.scannerPressure?.level ??
    scanner?.resourcePressure?.level ??
    "normal";
  return {
    level: String(level),
    action: "normal",
    reason: "resource pressure allows normal market-data planning",
  };
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildMarketSessionPlan(status: UsEquityMarketStatus): MarketDataWorkPlan["marketSession"] {
  const equityTrading = status.session.open;
  return {
    exchange: "XNYS",
    sessionKey: status.session.key,
    sessionLabel: status.session.label,
    regularTrading: status.session.key === "rth",
    equityTrading,
    tradingDay: Boolean(status.calendarDay?.tradingDay),
    earlyClose: Boolean(status.calendarDay?.earlyClose),
    holidayName: status.calendarDay?.holiday ?? null,
    quietReason: equityTrading ? null : "market_session_quiet",
    nextOpenAt: status.nextOpenAt ?? null,
    nextCloseAt: status.nextCloseAt ?? null,
  };
}

function flowScannerSessionBlockedReason(
  _marketSession: MarketDataWorkPlan["marketSession"],
): "market_session_quiet" | null {
  // The options-flow scanner runs in ALL sessions (full-rate, 24/7). Time-of-day gates
  // only trade execution, not market-data discovery — so the scanner is never
  // session-blocked and its live option lines are not evicted off-hours.
  return null;
}

export function buildMarketDataWorkPlan(
  input: BuildMarketDataWorkPlanInput,
): MarketDataWorkPlan {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const marketSession = buildMarketSessionPlan(
    resolveUsEquityMarketStatus(new Date(generatedAt)),
  );
  const leases = input.admission.leases ?? [];
  const ibkrEquityLive = linePlansForAsset(leases, "equity", {
    includeLine: (lease, lineId) =>
      lease.lineRoles?.[lineId] !== "option-underlier-support",
  });
  const ibkrOptionLive = linePlansForAsset(leases, "option", {
    provider: "ibkr",
    includeLease: () => false,
  });
  const massiveOptionLive = linePlansForAsset(leases, "option", {
    provider: "massive",
  });
  const persistJobs = buildPersistJobs(input.ingest);
  const massiveAggregateFallback = buildAggregateFallbackJob(input.stockAggregates);
  const massiveSnapshot = persistJobs.filter(
    (job) =>
      job.intent === "persisted-forward-refresh" &&
      job.status !== "idle" &&
      job.status !== "completed_recent",
  );
  const { release, staleApi } = actionRowsFromDrift(input.drift);
  const memoryAction = buildMemoryAction(input.optionsFlowScanner ?? null);
  const scanner = buildScannerPlan(
    input.optionsFlowScanner ?? null,
    marketSession,
  );
  const evict: MarketDataWorkPlanLifecycleAction[] = [...staleApi];
  const flowScannerLines = sample(
    leases
      .filter((lease) => lease.intent === "flow-scanner-live")
      .flatMap((lease) => lease.lineIds),
  );
  const shouldEvictFlowScannerForSession =
    flowScannerSessionBlockedReason(marketSession) !== null &&
    (input.admission.flowScannerLineCount ?? 0) > 0;
  if (shouldEvictFlowScannerForSession) {
    evict.push({
      state: "evicting",
      owner: "flow-scanner",
      provider: "massive",
      lineCount: input.admission.flowScannerLineCount ?? 0,
      lineSample: flowScannerLines,
      reason: "NYSE is outside regular trading hours; Massive flow scanner live option quotes are deferred",
    });
  }
  if (
    memoryAction.action !== "normal" &&
    (input.admission.flowScannerLineCount ?? 0) > 0 &&
    !shouldEvictFlowScannerForSession
  ) {
    evict.push({
      state: "evicting",
      owner: "flow-scanner",
      provider: "massive",
      lineCount: input.admission.flowScannerLineCount ?? 0,
      lineSample: flowScannerLines,
      reason: memoryAction.reason,
    });
  }

  const ibkrEquitySymbols = new Set(
    ibkrEquityLive.flatMap((entry) => entry.symbols),
  );
  const ibkrOptionSymbols = new Set(
    ibkrOptionLive.flatMap((entry) => entry.symbols),
  );
  const massiveOptionSymbols = new Set(
    massiveOptionLive.flatMap((entry) => entry.symbols),
  );
  const signature = JSON.stringify({
    admissionGeneratedAt: input.admission.generatedAt,
    activeLineCount: input.admission.activeLineCount,
    leaseCount: input.admission.leaseCount,
    scannerState: scanner.state,
    scannerHorizon: scanner.plannedHorizonCount,
    marketSession: marketSession.sessionKey,
    queueDepth: input.ingest?.queueDepth ?? null,
    claimableQueuedJobs: input.ingest?.claimableQueuedJobsByKind ?? null,
    workerLikelyInactive: input.ingest?.workerLikelyInactive ?? null,
    driftStatus: input.drift?.status ?? null,
  });

  return {
    schemaVersion: 1,
    generation: `market-data-work-plan-${hashString(signature)}`,
    generatedAt,
    marketSession,
    providerPolicy: {
      ibkr: [
        "broker account, order, execution, and broker contract-resolution workflows",
        "no option market-data ownership; Massive owns option quotes, chains, bars, flow, and Greeks",
      ],
      massive: [
        "websocket-only stock quotes, aggregate bars, and historical research across open equity sessions",
        "option chains, quotes, Greeks, option bars, flow scanner snapshots, and GEX source snapshots",
      ],
      rustWorker: [
        "persisted option_chain_snapshot and gex_snapshot jobs only",
        "forward refresh drain, supersede, and durable GEX materialization",
      ],
    },
    summary: {
      ibkrLiveLineCount:
        ibkrEquityLive.reduce((total, entry) => total + entry.lineCount, 0) +
        ibkrOptionLive.reduce((total, entry) => total + entry.lineCount, 0),
      ibkrEquityLineCount: ibkrEquityLive.reduce(
        (total, entry) => total + entry.lineCount,
        0,
      ),
      ibkrOptionLineCount: ibkrOptionLive.reduce(
        (total, entry) => total + entry.lineCount,
        0,
      ),
      ibkrEquitySymbolCount: ibkrEquitySymbols.size,
      ibkrOptionSymbolCount: ibkrOptionSymbols.size,
      massiveOptionLineCount: massiveOptionLive.reduce(
        (total, entry) => total + entry.lineCount,
        0,
      ),
      massiveOptionSymbolCount: massiveOptionSymbols.size,
      persistQueuedJobCount: countQueuedJobs(input.ingest, "queued"),
      persistRunningJobCount: Math.max(
        countQueuedJobs(input.ingest, "running"),
        readNumber(input.ingest?.runningCount) ?? 0,
      ),
      persistClaimableQueuedJobCount:
        readNumber(input.ingest?.claimableQueuedJobCount) ?? 0,
      persistWorkerInactive: Boolean(input.ingest?.workerLikelyInactive),
      persistBlockedJobCount: input.ingest?.blockedGexJobCount ?? 0,
      releaseLineCount: release.reduce((total, entry) => total + entry.lineCount, 0),
      evictLineCount: evict.reduce((total, entry) => total + entry.lineCount, 0),
      scannerPlannedHorizonCount: scanner.plannedHorizonCount,
      scannerEffectiveConcurrency: scanner.effectiveConcurrency,
      scannerMaxDeepScanLines: scanner.maxDeepScanLines,
      bridgeLineBudget:
        input.bridge?.lineBudget ??
        input.admission.budget?.bridgeLineBudget ??
        null,
      bridgeActiveLineCount: input.bridge?.activeLineCount ?? null,
      memoryAction: memoryAction.action,
    },
    ibkrEquityLive,
    ibkrOptionLive,
    massiveOptionLive,
    massiveSnapshot,
    massiveAggregateFallback,
    persistJobs,
    release,
    evict,
    memoryAction,
    scanner,
  };
}

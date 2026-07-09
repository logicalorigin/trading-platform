import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  flowUniverseRankingsTable,
  universeCatalogListingsTable,
  universeSourceMembershipsTable,
} from "@workspace/db/schema";
import { normalizeSymbol } from "../lib/values";
import { isApiResourcePressureHardBlock } from "./resource-pressure";

export type FlowUniversePlannerPrioritySource =
  | "account"
  | "runtime"
  | "watchlists"
  | "built-in";

export type FlowUniversePlannerPoolId = "priority" | "hot" | "core" | "broad";

export type FlowUniversePlannerCandidate = {
  symbol: string;
  market: string;
  sourceIds?: readonly string[];
  price?: number | null;
  dollarVolume?: number | null;
  liquidityRank?: number | null;
  flowScore?: number | null;
  previousSessionFlowScore?: number | null;
  selected?: boolean | null;
  selectedAt?: Date | null;
  lastScannedAt?: Date | null;
  lastFlowAt?: Date | null;
  cooldownUntil?: Date | null;
};

export type FlowUniversePlannerInput = {
  candidates: readonly FlowUniversePlannerCandidate[];
  prioritySymbolGroups?: Partial<
    Record<FlowUniversePlannerPrioritySource, readonly string[]>
  >;
  targetSize: number;
  batchSize: number;
  lineBudget: number;
  perScanLineBudget: number;
  effectiveConcurrency: number;
  hotLookbackMs?: number;
  generatedAt?: Date;
};

export type FlowUniversePlannerPoolDiagnostics = {
  totalSymbols: number;
  eligibleSymbols: number;
  selectedSymbols: number;
  skippedCooldownSymbols: number;
  oldestScannedAt: Date | null;
  newestScannedAt: Date | null;
};

export type FlowUniverseScanPlan = {
  generatedAt: Date;
  nextScanBatch: string[];
  prioritySymbols: string[];
  hotSymbols: string[];
  coreSymbols: string[];
  broadSymbols: string[];
  verificationSymbols: string[];
  prioritySymbolsBySource: Record<FlowUniversePlannerPrioritySource, string[]>;
  selectedPoolCounts: Record<FlowUniversePlannerPoolId, number>;
  pools: Record<FlowUniversePlannerPoolId, FlowUniversePlannerPoolDiagnostics>;
  skipped: {
    unverifiedPrioritySymbols: string[];
    cooldownSymbols: string[];
    lineBudgetSymbols: string[];
    lineBudgetSymbolCount: number;
  };
  diagnostics: {
    candidateSymbols: number;
    selectableSymbols: number;
    targetSize: number;
    batchSize: number;
    lineBudget: number;
    perScanLineBudget: number;
    effectiveConcurrency: number;
    allowedSymbols: number;
    limitingReason: "none" | "line-budget" | "batch-size" | "no-budget";
  };
};

type FlowUniversePlannerOptions = {
  db: {
    select: typeof import("@workspace/db").db.select;
  };
  markets: readonly string[];
  minPrice: number;
  minDollarVolume: number;
  refreshMs: number;
  maxCandidateRows?: number;
  now?: () => Date;
};

type FlowUniversePlannerRuntimeInput = Omit<
  FlowUniversePlannerInput,
  "candidates" | "generatedAt"
>;

const SOURCE_ID_SP500 = "sp500";
const SOURCE_ID_LISTED = new Set(["nasdaq_listed", "other_listed"]);
const DEFAULT_HOT_LOOKBACK_MS = 60 * 60_000;
const PLANNER_PRIORITY_ORDER: FlowUniversePlannerPrioritySource[] = [
  "account",
  "runtime",
  "watchlists",
  "built-in",
];

function uniqueSymbols(symbols: readonly string[]): string[] {
  return [
    ...new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  ];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function epochMs(value: Date | null | undefined): number | null {
  if (!(value instanceof Date)) return null;
  const time = value.getTime();
  return Number.isFinite(time) ? time : null;
}

function sortedByOldestScan(
  candidates: readonly FlowUniversePlannerCandidate[],
): FlowUniversePlannerCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftScan = epochMs(left.lastScannedAt);
    const rightScan = epochMs(right.lastScannedAt);
    if (leftScan === null && rightScan !== null) return -1;
    if (leftScan !== null && rightScan === null) return 1;
    if (leftScan !== null && rightScan !== null && leftScan !== rightScan) {
      return leftScan - rightScan;
    }
    const leftRank = left.liquidityRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.liquidityRank ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return normalizeSymbol(left.symbol).localeCompare(normalizeSymbol(right.symbol));
  });
}

function sortedByHeat(
  candidates: readonly FlowUniversePlannerCandidate[],
): FlowUniversePlannerCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftScore =
      (left.flowScore ?? 0) * 10_000 +
      (left.previousSessionFlowScore ?? 0) * 1_000 +
      (epochMs(left.lastFlowAt) ?? 0) / 1_000_000 +
      (left.selected ? 100 : 0);
    const rightScore =
      (right.flowScore ?? 0) * 10_000 +
      (right.previousSessionFlowScore ?? 0) * 1_000 +
      (epochMs(right.lastFlowAt) ?? 0) / 1_000_000 +
      (right.selected ? 100 : 0);
    return rightScore - leftScore || normalizeSymbol(left.symbol).localeCompare(
      normalizeSymbol(right.symbol),
    );
  });
}

function hasSource(
  candidate: FlowUniversePlannerCandidate,
  sourceId: string,
): boolean {
  return Boolean(candidate.sourceIds?.includes(sourceId));
}

function hasListedSource(candidate: FlowUniversePlannerCandidate): boolean {
  return Boolean(candidate.sourceIds?.some((sourceId) => SOURCE_ID_LISTED.has(sourceId)));
}

function isHotCandidate(
  candidate: FlowUniversePlannerCandidate,
  now: Date,
  hotLookbackMs: number,
): boolean {
  if ((candidate.flowScore ?? 0) > 0 || (candidate.previousSessionFlowScore ?? 0) > 0) {
    return true;
  }
  const lastFlowAt = epochMs(candidate.lastFlowAt);
  return lastFlowAt !== null && now.getTime() - lastFlowAt <= hotLookbackMs;
}

function poolDiagnostics(
  candidates: readonly FlowUniversePlannerCandidate[],
  selectedSymbols: readonly string[],
  now: Date,
): FlowUniversePlannerPoolDiagnostics {
  const selected = new Set(selectedSymbols.map(normalizeSymbol));
  const scanTimes = candidates
    .map((candidate) => candidate.lastScannedAt)
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime())
    .filter(Number.isFinite);
  return {
    totalSymbols: candidates.length,
    eligibleSymbols: candidates.filter(
      (candidate) => !candidate.cooldownUntil || candidate.cooldownUntil <= now,
    ).length,
    selectedSymbols: candidates.filter((candidate) =>
      selected.has(normalizeSymbol(candidate.symbol)),
    ).length,
    skippedCooldownSymbols: candidates.filter(
      (candidate) => candidate.cooldownUntil && candidate.cooldownUntil > now,
    ).length,
    oldestScannedAt: scanTimes.length ? new Date(Math.min(...scanTimes)) : null,
    newestScannedAt: scanTimes.length ? new Date(Math.max(...scanTimes)) : null,
  };
}

function allowedSymbolsForBudget(input: FlowUniversePlannerInput): {
  allowedSymbols: number;
  limitingReason: FlowUniverseScanPlan["diagnostics"]["limitingReason"];
} {
  const targetSize = Math.max(0, Math.floor(input.targetSize || 0));
  const batchSize = Math.max(0, Math.floor(input.batchSize || 0));
  const lineBudget = Math.max(0, Math.floor(input.lineBudget || 0));
  const perScanLineBudget = Math.max(1, Math.floor(input.perScanLineBudget || 1));
  const effectiveConcurrency = Math.max(0, Math.floor(input.effectiveConcurrency || 0));
  if (targetSize <= 0 || batchSize <= 0 || lineBudget <= 0 || effectiveConcurrency <= 0) {
    return { allowedSymbols: 0, limitingReason: "no-budget" };
  }
  const lineBudgetSymbols = Math.max(0, Math.floor(lineBudget / perScanLineBudget));
  const allowedSymbols = Math.max(
    0,
    Math.min(targetSize, batchSize, lineBudgetSymbols),
  );
  if (allowedSymbols <= 0) {
    return { allowedSymbols: 0, limitingReason: "no-budget" };
  }
  if (allowedSymbols < batchSize) {
    return { allowedSymbols, limitingReason: "line-budget" };
  }
  if (allowedSymbols < targetSize) {
    return { allowedSymbols, limitingReason: "batch-size" };
  }
  return { allowedSymbols, limitingReason: "none" };
}

function appendCandidateSymbols(
  target: string[],
  source: readonly FlowUniversePlannerCandidate[],
  seen: Set<string>,
  now: Date,
  cooldownSymbols: Set<string>,
): void {
  for (const candidate of source) {
    const symbol = normalizeSymbol(candidate.symbol);
    if (!symbol || seen.has(symbol)) continue;
    if (candidate.cooldownUntil && candidate.cooldownUntil > now) {
      cooldownSymbols.add(symbol);
      continue;
    }
    target.push(symbol);
    seen.add(symbol);
  }
}

export function buildFlowUniverseScanPlan(
  input: FlowUniversePlannerInput,
): FlowUniverseScanPlan {
  const generatedAt = input.generatedAt ?? new Date();
  const candidateBySymbol = new Map<string, FlowUniversePlannerCandidate>();
  for (const candidate of input.candidates) {
    const symbol = normalizeSymbol(candidate.symbol);
    if (!symbol || candidateBySymbol.has(symbol)) continue;
    candidateBySymbol.set(symbol, { ...candidate, symbol });
  }

  const prioritySymbolsBySource = Object.fromEntries(
    PLANNER_PRIORITY_ORDER.map((source) => [
      source,
      uniqueSymbols(input.prioritySymbolGroups?.[source] ?? []),
    ]),
  ) as Record<FlowUniversePlannerPrioritySource, string[]>;
  const priorityInputSymbols = uniqueSymbols(
    PLANNER_PRIORITY_ORDER.flatMap((source) => prioritySymbolsBySource[source]),
  );
  const unverifiedPrioritySymbols = priorityInputSymbols.filter(
    (symbol) => !candidateBySymbol.has(symbol),
  );
  const priorityCandidates = priorityInputSymbols
    .map((symbol) => candidateBySymbol.get(symbol))
    .filter((candidate): candidate is FlowUniversePlannerCandidate => Boolean(candidate));
  const hotCandidates = sortedByHeat(
    [...candidateBySymbol.values()].filter((candidate) =>
      isHotCandidate(
        candidate,
        generatedAt,
        input.hotLookbackMs ?? DEFAULT_HOT_LOOKBACK_MS,
      ),
    ),
  );
  const coreCandidates = sortedByOldestScan(
    [...candidateBySymbol.values()].filter((candidate) =>
      hasSource(candidate, SOURCE_ID_SP500),
    ),
  );
  const broadCandidates = sortedByOldestScan(
    [...candidateBySymbol.values()].filter(
      (candidate) =>
        !hasSource(candidate, SOURCE_ID_SP500) && hasListedSource(candidate),
    ),
  );

  const orderedSymbols: string[] = [];
  const seen = new Set<string>();
  const cooldownSymbols = new Set<string>();
  appendCandidateSymbols(
    orderedSymbols,
    priorityCandidates,
    seen,
    generatedAt,
    cooldownSymbols,
  );
  appendCandidateSymbols(orderedSymbols, hotCandidates, seen, generatedAt, cooldownSymbols);
  appendCandidateSymbols(orderedSymbols, coreCandidates, seen, generatedAt, cooldownSymbols);
  appendCandidateSymbols(orderedSymbols, broadCandidates, seen, generatedAt, cooldownSymbols);
  const uncategorizedCandidates = sortedByOldestScan(
    [...candidateBySymbol.values()].filter((candidate) => {
      const symbol = normalizeSymbol(candidate.symbol);
      return symbol && !seen.has(symbol);
    }),
  );
  appendCandidateSymbols(
    orderedSymbols,
    uncategorizedCandidates,
    seen,
    generatedAt,
    cooldownSymbols,
  );

  const { allowedSymbols, limitingReason } = allowedSymbolsForBudget(input);
  const nextScanBatch = orderedSymbols.slice(0, allowedSymbols);
  const lineBudgetSymbols = orderedSymbols.slice(allowedSymbols);
  const selectedSet = new Set(nextScanBatch);
  const selectedPoolCounts = {
    priority: priorityCandidates.filter((candidate) =>
      selectedSet.has(normalizeSymbol(candidate.symbol)),
    ).length,
    hot: hotCandidates.filter((candidate) =>
      selectedSet.has(normalizeSymbol(candidate.symbol)),
    ).length,
    core: coreCandidates.filter((candidate) =>
      selectedSet.has(normalizeSymbol(candidate.symbol)),
    ).length,
    broad: broadCandidates.filter((candidate) =>
      selectedSet.has(normalizeSymbol(candidate.symbol)),
    ).length,
  };

  return {
    generatedAt,
    nextScanBatch,
    prioritySymbols: priorityCandidates.map((candidate) =>
      normalizeSymbol(candidate.symbol),
    ),
    hotSymbols: hotCandidates.map((candidate) => normalizeSymbol(candidate.symbol)),
    coreSymbols: coreCandidates.map((candidate) => normalizeSymbol(candidate.symbol)),
    broadSymbols: broadCandidates.map((candidate) => normalizeSymbol(candidate.symbol)),
    verificationSymbols: unverifiedPrioritySymbols,
    prioritySymbolsBySource: Object.fromEntries(
      PLANNER_PRIORITY_ORDER.map((source) => [
        source,
        prioritySymbolsBySource[source].filter((symbol) =>
          candidateBySymbol.has(symbol),
        ),
      ]),
    ) as Record<FlowUniversePlannerPrioritySource, string[]>,
    selectedPoolCounts,
    pools: {
      priority: poolDiagnostics(priorityCandidates, nextScanBatch, generatedAt),
      hot: poolDiagnostics(hotCandidates, nextScanBatch, generatedAt),
      core: poolDiagnostics(coreCandidates, nextScanBatch, generatedAt),
      broad: poolDiagnostics(broadCandidates, nextScanBatch, generatedAt),
    },
    skipped: {
      unverifiedPrioritySymbols,
      cooldownSymbols: Array.from(cooldownSymbols).sort(),
      lineBudgetSymbols: lineBudgetSymbols.slice(0, 50),
      lineBudgetSymbolCount: lineBudgetSymbols.length,
    },
    diagnostics: {
      candidateSymbols: candidateBySymbol.size,
      selectableSymbols: orderedSymbols.length,
      targetSize: Math.max(0, Math.floor(input.targetSize || 0)),
      batchSize: Math.max(0, Math.floor(input.batchSize || 0)),
      lineBudget: Math.max(0, Math.floor(input.lineBudget || 0)),
      perScanLineBudget: Math.max(1, Math.floor(input.perScanLineBudget || 1)),
      effectiveConcurrency: Math.max(0, Math.floor(input.effectiveConcurrency || 0)),
      allowedSymbols,
      limitingReason,
    },
  };
}

function optionableUniverseContractMetaSql() {
  return sql`(
    coalesce(${universeCatalogListingsTable.contractMeta}->>'derivativeSecTypes', '') ~* '(^|,)\\s*OPT\\s*(,|$)'
    or ${universeCatalogListingsTable.contractMeta}->>'optionabilityStatus' = 'verified'
    or ${universeCatalogListingsTable.contractMeta}->'optionability'->>'status' = 'verified'
  )`;
}

function optionableFlowUniverseRankingMetadataSql() {
  return sql`(
    ${flowUniverseRankingsTable.metadata}->>'optionabilityStatus' = 'verified'
    or ${flowUniverseRankingsTable.metadata}->'optionability'->>'status' = 'verified'
  )`;
}

function catalogOptionabilityVerifiedFilter() {
  return sql`(${optionableUniverseContractMetaSql()} or ${optionableFlowUniverseRankingMetadataSql()})`;
}

function catalogEligibilityFilters(options: FlowUniversePlannerOptions) {
  return [
    eq(universeCatalogListingsTable.active, true),
    eq(universeCatalogListingsTable.ibkrHydrationStatus, "hydrated"),
    inArray(
      universeCatalogListingsTable.market,
      [...options.markets] as Array<
        "stocks" | "etf" | "indices" | "futures" | "fx" | "crypto" | "otc"
      >,
    ),
    sql`${universeCatalogListingsTable.providerContractId} ~ '^[0-9]+$'`,
    sql`coalesce(${universeCatalogListingsTable.primaryExchange}, '') <> 'OTC'`,
    catalogOptionabilityVerifiedFilter(),
  ];
}

async function loadPlannerCandidates(
  options: FlowUniversePlannerOptions,
): Promise<FlowUniversePlannerCandidate[]> {
  const rows = await options.db
    .select({
      symbol: universeCatalogListingsTable.normalizedTicker,
      market: universeCatalogListingsTable.market,
      sourceId: universeSourceMembershipsTable.sourceId,
      price: flowUniverseRankingsTable.price,
      dollarVolume: flowUniverseRankingsTable.dollarVolume,
      liquidityRank: flowUniverseRankingsTable.liquidityRank,
      flowScore: flowUniverseRankingsTable.flowScore,
      previousSessionFlowScore: flowUniverseRankingsTable.previousSessionFlowScore,
      selected: flowUniverseRankingsTable.selected,
      selectedAt: flowUniverseRankingsTable.selectedAt,
      lastScannedAt: flowUniverseRankingsTable.lastScannedAt,
      lastFlowAt: flowUniverseRankingsTable.lastFlowAt,
      cooldownUntil: flowUniverseRankingsTable.cooldownUntil,
    })
    .from(universeCatalogListingsTable)
    .leftJoin(
      flowUniverseRankingsTable,
      eq(
        flowUniverseRankingsTable.symbol,
        universeCatalogListingsTable.normalizedTicker,
      ),
    )
    .leftJoin(
      universeSourceMembershipsTable,
      and(
        eq(
          universeSourceMembershipsTable.normalizedTicker,
          universeCatalogListingsTable.normalizedTicker,
        ),
        eq(universeSourceMembershipsTable.active, true),
      ),
    )
    .where(and(...catalogEligibilityFilters(options)))
    .orderBy(
      sql`${flowUniverseRankingsTable.lastScannedAt} asc nulls first`,
      desc(flowUniverseRankingsTable.previousSessionFlowScore),
      desc(flowUniverseRankingsTable.flowScore),
      desc(flowUniverseRankingsTable.dollarVolume),
      universeCatalogListingsTable.normalizedTicker,
    )
    .limit(options.maxCandidateRows ?? 12_000);

  const bySymbol = new Map<string, FlowUniversePlannerCandidate>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    const existing = bySymbol.get(symbol);
    if (existing) {
      if (row.sourceId && !existing.sourceIds?.includes(row.sourceId)) {
        existing.sourceIds = [...(existing.sourceIds ?? []), row.sourceId];
      }
      continue;
    }
    bySymbol.set(symbol, {
      symbol,
      market: row.market,
      sourceIds: row.sourceId ? [row.sourceId] : [],
      price: toNumber(row.price),
      dollarVolume: toNumber(row.dollarVolume),
      liquidityRank: row.liquidityRank ?? null,
      flowScore: toNumber(row.flowScore),
      previousSessionFlowScore: toNumber(row.previousSessionFlowScore),
      selected: row.selected ?? false,
      selectedAt: row.selectedAt ?? null,
      lastScannedAt: row.lastScannedAt ?? null,
      lastFlowAt: row.lastFlowAt ?? null,
      cooldownUntil: row.cooldownUntil ?? null,
    });
  }
  return [...bySymbol.values()];
}

export function createFlowUniversePlanner(options: FlowUniversePlannerOptions) {
  const now = options.now ?? (() => new Date());
  let runtimeOptions = { ...options, markets: [...options.markets] };
  let candidates: FlowUniversePlannerCandidate[] = [];
  let refreshPromise: Promise<void> | null = null;
  let lastRefreshAt: Date | null = null;
  let lastError: string | null = null;
  let lastPlan = buildFlowUniverseScanPlan({
    candidates,
    targetSize: 0,
    batchSize: 0,
    lineBudget: 0,
    perScanLineBudget: 1,
    effectiveConcurrency: 0,
    generatedAt: now(),
  });

  async function refresh(): Promise<void> {
    if (isApiResourcePressureHardBlock()) {
      lastRefreshAt = now();
      lastError = "Flow universe planner refresh skipped under resource pressure.";
      return;
    }
    try {
      candidates = await loadPlannerCandidates(runtimeOptions);
      lastRefreshAt = now();
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  function ensureRefresh(): void {
    const current = now();
    if (
      refreshPromise ||
      (lastRefreshAt &&
        current.getTime() - lastRefreshAt.getTime() < runtimeOptions.refreshMs)
    ) {
      return;
    }
    refreshPromise = refresh().finally(() => {
      refreshPromise = null;
    });
  }

  function getPlan(input: FlowUniversePlannerRuntimeInput): FlowUniverseScanPlan {
    ensureRefresh();
    lastPlan = buildFlowUniverseScanPlan({
      ...input,
      candidates,
      generatedAt: now(),
    });
    return {
      ...lastPlan,
      diagnostics: {
        ...lastPlan.diagnostics,
        lastRefreshAt: lastRefreshAt?.toISOString() ?? null,
        refreshing: Boolean(refreshPromise),
        lastError,
      } as FlowUniverseScanPlan["diagnostics"] & Record<string, unknown>,
    };
  }

  function updateConfig(input: Partial<FlowUniversePlannerOptions>): void {
    runtimeOptions = {
      ...runtimeOptions,
      ...input,
      markets: input.markets ? [...input.markets] : runtimeOptions.markets,
    };
    lastRefreshAt = null;
    ensureRefresh();
  }

  function reset(): void {
    candidates = [];
    lastRefreshAt = null;
    lastError = null;
    lastPlan = buildFlowUniverseScanPlan({
      candidates,
      targetSize: 0,
      batchSize: 0,
      lineBudget: 0,
      perScanLineBudget: 1,
      effectiveConcurrency: 0,
      generatedAt: now(),
    });
  }

  return {
    getPlan,
    updateConfig,
    reset,
  };
}

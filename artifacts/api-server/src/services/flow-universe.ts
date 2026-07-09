import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  flowUniverseRankingsTable,
  universeCatalogListingsTable,
} from "@workspace/db/schema";
import { isTransientPostgresError } from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";
import { isApiResourcePressureHardBlock } from "./resource-pressure";

export type FlowUniverseMode = "watchlist" | "market" | "hybrid";
export type FlowUniverseCoverage = {
  mode: FlowUniverseMode;
  targetSize: number;
  activeTargetSize: number;
  selectedSymbols: number;
  selectedShortfall: number;
  rankedAt: Date | null;
  lastRefreshAt: Date | null;
  lastGoodAt: Date | null;
  stale: boolean;
  fallbackUsed: boolean;
  cooldownCount: number;
  verifiedSymbols: number;
  needsVerificationSymbols: number;
  rejectedSymbols: number;
  verificationBacklogSymbols: number;
  scannedSymbols: number;
  cycleScannedSymbols: number;
  lastScannedAt: Record<string, number>;
  oldestScanAt: number | null;
  newestScanAt: number | null;
  batchSize?: number;
  intervalMs?: number;
  lineBudget?: number;
  concurrency?: number;
  estimatedCycleMs?: number | null;
  currentBatch: string[];
  deepActiveSymbols?: string[];
  deepLastBatch?: string[];
  scannerPhase?: "deep" | "idle" | "blocked";
  coverageHealth?: "healthy" | "lagging" | "quiet" | "blocked";
  marketSessionQuiet?: boolean;
  lastScanAgeMs?: number | null;
  coverageTargetMs?: number;
  lastScanAt: Date | null;
  degradedReason: string | null;
  planner?: Record<string, unknown>;
};

export type FlowUniverseObservation = {
  symbol: string;
  scannedAt?: Date;
  events?: Array<{ premium?: number; unusualScore?: number; isUnusual?: boolean }>;
  failed?: boolean;
  reason?: string | null;
  optionabilityVerified?: boolean;
};

export type FlowUniverseLiquiditySnapshot = {
  symbol: string;
  price: number | null;
  volume: number | null;
  source?: string | null;
};

type FlowUniverseManagerOptions = {
  db: {
    select: typeof import("@workspace/db").db.select;
    update: typeof import("@workspace/db").db.update;
    insert: typeof import("@workspace/db").db.insert;
  };
  mode: FlowUniverseMode;
  targetSize: number;
  refreshMs: number;
  markets: readonly string[];
  minPrice: number;
  minDollarVolume: number;
  fallbackSymbols: readonly string[];
  fetchLiquiditySnapshots?: (
    symbols: readonly string[],
  ) => Promise<FlowUniverseLiquiditySnapshot[]>;
  now?: () => Date;
};

export type FlowUniverseRuntimeConfig = Pick<
  FlowUniverseManagerOptions,
  | "mode"
  | "targetSize"
  | "refreshMs"
  | "markets"
  | "minPrice"
  | "minDollarVolume"
>;

type RankingCandidate = {
  symbol: string;
  market: string;
  price: number | null;
  volume: number | null;
  dollarVolume: number | null;
  liquidityRank: number | null;
  flowScore: number;
  previousSessionFlowScore: number;
  rankedAt: Date | null;
  selected: boolean;
  selectedAt: Date | null;
  lastScannedAt: Date | null;
  cooldownUntil: Date | null;
};

const COOLDOWN_FAILURE_THRESHOLD = 2;
const COOLDOWN_MS = 15 * 60_000;
// Census S11: coalesce per-symbol ranking upserts into multi-row statements.
const OBSERVATION_FLUSH_MAX_ROWS = 250;
const OBSERVATION_FLUSH_DELAY_MS = 500;
const OPTIONABLE_DERIVATIVE_SEC_TYPE_RE = /(^|,)\s*OPT\s*(,|$)/i;

type PendingRankingObservation = {
  symbol: string;
  observedAt: Date;
  hasEvents: boolean;
  failed: boolean;
  flowScore: number;
  reason: string | null;
  optionabilityMetadata: Record<string, unknown> | null;
};

function uniqueSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))];
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

function readErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") {
    return record.code;
  }
  return readErrorCode(record.cause);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message} ${readErrorMessage(error.cause)}`.trim();
  }
  return typeof error === "string" ? error : "";
}

export function isOptionableUniverseContractMeta(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const optionability = record["optionability"];
  const optionabilityRecord =
    optionability && typeof optionability === "object" && !Array.isArray(optionability)
      ? (optionability as Record<string, unknown>)
      : null;
  if (
    record["optionabilityStatus"] === "verified" ||
    optionabilityRecord?.["status"] === "verified"
  ) {
    return true;
  }
  const raw = record["derivativeSecTypes"];
  if (Array.isArray(raw)) {
    return raw.some(
      (entry) =>
        typeof entry === "string" &&
        OPTIONABLE_DERIVATIVE_SEC_TYPE_RE.test(entry),
    );
  }
  return (
    typeof raw === "string" && OPTIONABLE_DERIVATIVE_SEC_TYPE_RE.test(raw)
  );
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

function rejectedUniverseContractMetaSql() {
  return sql`(
    ${universeCatalogListingsTable.contractMeta}->>'optionabilityStatus' = 'rejected'
    or ${universeCatalogListingsTable.contractMeta}->'optionability'->>'status' = 'rejected'
  )`;
}

function rejectedFlowUniverseRankingMetadataSql() {
  return sql`(
    ${flowUniverseRankingsTable.metadata}->>'optionabilityStatus' = 'rejected'
    or ${flowUniverseRankingsTable.metadata}->'optionability'->>'status' = 'rejected'
  )`;
}

function isMissingFlowUniverseRankingsTableError(error: unknown): boolean {
  if (readErrorCode(error) === "42P01") {
    return true;
  }
  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes("flow_universe_rankings") &&
    (message.includes("does not exist") || message.includes("missing"))
  );
}

function isTransientFlowUniverseDegradedReason(reason: string | null): boolean {
  return Boolean(
    reason &&
      (reason.includes("database unavailable") ||
        reason.includes("persistence unavailable")),
  );
}

function shouldSkipFlowUniverseDbRefreshForPressure(): boolean {
  return isApiResourcePressureHardBlock();
}

function scoreObservation(events: FlowUniverseObservation["events"]): number {
  if (!events?.length) {
    return 0;
  }
  return events.reduce((total, event) => {
    const premium = Math.max(0, event.premium ?? 0);
    const premiumScore = Math.log10(premium + 1);
    const unusualScore = Math.max(0, event.unusualScore ?? 0);
    return total + premiumScore * (event.isUnusual ? 2 : 1) + unusualScore;
  }, 0);
}

async function mapConcurrent<T, TResult>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function isRegularTradingHours(now = new Date()): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 13 * 60 + 30 && minutes < 20 * 60;
}

export function getFlowScannerIntervalMs(input: {
  baseIntervalMs: number;
  alwaysOn?: boolean;
  now?: Date;
}): number {
  // Scanner runs at full rate in ALL sessions (time-of-day gates only execution, not
  // market-data discovery) — no off-hours cadence slowdown.
  return Math.max(1_000, input.baseIntervalMs);
}

export function rankFlowUniverseCandidates(input: {
  candidates: readonly RankingCandidate[];
  pinnedSymbols?: readonly string[];
  fallbackSymbols?: readonly string[];
  targetSize: number;
  minPrice?: number;
  minDollarVolume?: number;
  now?: Date;
}): string[] {
  const now = input.now ?? new Date();
  const targetSize = Math.max(1, Math.floor(input.targetSize));
  const minPrice = Math.max(0, input.minPrice ?? 0);
  const minDollarVolume = Math.max(0, input.minDollarVolume ?? 0);
  const pinned = uniqueSymbols(input.pinnedSymbols ?? []);
  const candidateBySymbol = new Map(
    input.candidates.map((candidate) => [normalizeSymbol(candidate.symbol), candidate]),
  );
  const selected: string[] = [];
  const seen = new Set<string>();

  const appendSymbol = (symbolInput: string): boolean => {
    if (selected.length >= targetSize) {
      return false;
    }
    const symbol = normalizeSymbol(symbolInput);
    if (!symbol || seen.has(symbol)) {
      return false;
    }
    const candidate = candidateBySymbol.get(symbol);
    if (candidate?.cooldownUntil && candidate.cooldownUntil > now) {
      return false;
    }
    selected.push(symbol);
    seen.add(symbol);
    return true;
  };

  for (const symbol of pinned) {
    appendSymbol(symbol);
  }

  const sorted = [...input.candidates]
    .map((candidate) => ({ ...candidate, symbol: normalizeSymbol(candidate.symbol) }))
    .filter((candidate) => {
      if (!candidate.symbol || seen.has(candidate.symbol)) return false;
      return !candidate.cooldownUntil || candidate.cooldownUntil <= now;
    })
    .sort((left, right) => {
      const leftScore =
        left.flowScore * 10_000 +
        left.previousSessionFlowScore * 1_000 +
        (left.selected ? 100 : 0) +
        (left.dollarVolume ?? 0) / 1_000_000 +
        Math.max(0, 10_000 - (left.liquidityRank ?? 10_000)) / 10_000;
      const rightScore =
        right.flowScore * 10_000 +
        right.previousSessionFlowScore * 1_000 +
        (right.selected ? 100 : 0) +
        (right.dollarVolume ?? 0) / 1_000_000 +
        Math.max(0, 10_000 - (right.liquidityRank ?? 10_000)) / 10_000;
      return rightScore - leftScore || left.symbol.localeCompare(right.symbol);
    });

  const hasFlowEvidence = (candidate: RankingCandidate): boolean =>
    candidate.flowScore > 0 ||
    candidate.previousSessionFlowScore > 0;
  const hasLiquidityEvidence = (candidate: RankingCandidate): boolean =>
    ((candidate.price ?? 0) >= minPrice &&
      (candidate.dollarVolume ?? 0) >= minDollarVolume &&
      ((candidate.dollarVolume ?? 0) > 0 || (candidate.liquidityRank ?? 0) > 0));

  for (const candidate of sorted.filter(hasFlowEvidence)) {
    if (selected.length >= targetSize) break;
    appendSymbol(candidate.symbol);
  }

  for (const candidate of sorted.filter(
    (candidate) => !hasFlowEvidence(candidate) && hasLiquidityEvidence(candidate),
  )) {
    if (selected.length >= targetSize) break;
    appendSymbol(candidate.symbol);
  }

  for (const symbol of uniqueSymbols(input.fallbackSymbols ?? [])) {
    if (selected.length >= targetSize) break;
    appendSymbol(symbol);
  }

  for (const candidate of sorted.filter(
    (candidate) => !hasFlowEvidence(candidate) && !hasLiquidityEvidence(candidate),
  )) {
    if (selected.length >= targetSize) break;
    appendSymbol(candidate.symbol);
  }

  return selected.slice(0, targetSize);
}

export function createFlowUniverseManager(options: FlowUniverseManagerOptions) {
  const now = options.now ?? (() => new Date());
  let runtimeOptions = {
    ...options,
    fallbackSymbols: uniqueSymbols(options.fallbackSymbols),
    markets: [...options.markets],
  };
  let lastGoodSymbols: string[] = [];
  let selectedSymbols: string[] = [];
  let verifiedSymbolSet = new Set<string>();
  let verifiedSymbols = 0;
  let needsVerificationSymbols = 0;
  let rejectedSymbols = 0;
  let refreshPromise: Promise<string[]> | null = null;
  let lastRefreshAt: Date | null = null;
  let lastGoodAt: Date | null = null;
  let rankedAt: Date | null = null;
  let degradedReason: string | null = null;
  let cooldownCount = 0;
  let scannedAtBySymbol = new Map<string, Date>();
  let currentBatch: string[] = [];
  let lastScanAt: Date | null = null;
  let pendingObservations: PendingRankingObservation[] = [];
  let pendingObservationFlush: {
    promise: Promise<void>;
    resolve: () => void;
  } | null = null;
  let observationFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let observationFlushChain: Promise<void> = Promise.resolve();

  function shortfallReason(
    selectedCount: number,
    targetSize = runtimeOptions.targetSize,
  ) {
    return selectedCount < targetSize
      ? `Universe fill short: ${selectedCount}/${targetSize}`
      : null;
  }

  function catalogEligibilityFilters() {
    return [
      eq(universeCatalogListingsTable.active, true),
      eq(universeCatalogListingsTable.ibkrHydrationStatus, "hydrated"),
      inArray(
        universeCatalogListingsTable.market,
        [...runtimeOptions.markets] as Array<
          "stocks" | "etf" | "indices" | "futures" | "fx" | "crypto" | "otc"
        >,
      ),
      sql`${universeCatalogListingsTable.providerContractId} ~ '^[0-9]+$'`,
      sql`coalesce(${universeCatalogListingsTable.primaryExchange}, '') <> 'OTC'`,
    ];
  }

  function catalogOptionabilityVerifiedFilter() {
    return sql`(${optionableUniverseContractMetaSql()} or ${optionableFlowUniverseRankingMetadataSql()})`;
  }

  function catalogOptionabilityRejectedFilter() {
    return sql`(${rejectedUniverseContractMetaSql()} or ${rejectedFlowUniverseRankingMetadataSql()})`;
  }

  async function refreshVerificationCounts(): Promise<void> {
    const statusExpression = sql<"verified" | "rejected" | "needs_verification">`
      case
        when ${catalogOptionabilityVerifiedFilter()} then 'verified'
        when ${catalogOptionabilityRejectedFilter()} then 'rejected'
        else 'needs_verification'
      end
    `;
    const rows = await runtimeOptions.db
      .select({
        status: statusExpression,
        value: count(),
      })
      .from(universeCatalogListingsTable)
      .leftJoin(
        flowUniverseRankingsTable,
        eq(
          flowUniverseRankingsTable.symbol,
          universeCatalogListingsTable.normalizedTicker,
        ),
      )
      .where(and(...catalogEligibilityFilters()))
      .groupBy(statusExpression);

    let verifiedCount = 0;
    let needsVerificationCount = 0;
    let rejectedCount = 0;
    for (const row of rows) {
      if (row.status === "verified") {
        verifiedCount = Number(row.value) || 0;
      } else if (row.status === "rejected") {
        rejectedCount = Number(row.value) || 0;
      } else if (row.status === "needs_verification") {
        needsVerificationCount = Number(row.value) || 0;
      }
    }
    verifiedSymbols = verifiedCount;
    needsVerificationSymbols = needsVerificationCount;
    rejectedSymbols = rejectedCount;
  }

  async function loadVerifiedSymbols(
    symbols: readonly string[],
  ): Promise<Set<string>> {
    const normalizedSymbols = uniqueSymbols(symbols)
      .map(normalizeSymbol)
      .filter(Boolean);
    const verified = new Set<string>();
    for (let index = 0; index < normalizedSymbols.length; index += 500) {
      const chunk = normalizedSymbols.slice(index, index + 500);
      const rows = await runtimeOptions.db
        .select({
          symbol: universeCatalogListingsTable.normalizedTicker,
        })
        .from(universeCatalogListingsTable)
        .leftJoin(
          flowUniverseRankingsTable,
          eq(
            flowUniverseRankingsTable.symbol,
            universeCatalogListingsTable.normalizedTicker,
          ),
        )
        .where(
          and(
            ...catalogEligibilityFilters(),
            inArray(universeCatalogListingsTable.normalizedTicker, chunk),
            catalogOptionabilityVerifiedFilter(),
          ),
        );
      for (const row of rows) {
        const symbol = normalizeSymbol(row.symbol);
        if (symbol) {
          verified.add(symbol);
          verifiedSymbolSet.add(symbol);
        }
      }
    }
    verifiedSymbols = Math.max(verifiedSymbols, verifiedSymbolSet.size);
    return verified;
  }

  async function loadCatalogCandidates(): Promise<RankingCandidate[]> {
    const rows = await runtimeOptions.db
      .select({
        symbol: universeCatalogListingsTable.normalizedTicker,
        market: universeCatalogListingsTable.market,
      })
      .from(universeCatalogListingsTable)
      .where(
        and(
          eq(universeCatalogListingsTable.active, true),
          eq(universeCatalogListingsTable.ibkrHydrationStatus, "hydrated"),
          inArray(
            universeCatalogListingsTable.market,
            [...runtimeOptions.markets] as Array<
              "stocks" | "etf" | "indices" | "futures" | "fx" | "crypto" | "otc"
            >,
          ),
          sql`${universeCatalogListingsTable.providerContractId} ~ '^[0-9]+$'`,
          sql`coalesce(${universeCatalogListingsTable.primaryExchange}, '') <> 'OTC'`,
          optionableUniverseContractMetaSql(),
        ),
      )
      .orderBy(asc(universeCatalogListingsTable.normalizedTicker))
      .limit(
        Math.max(runtimeOptions.targetSize * 4, runtimeOptions.targetSize + 100),
      );

    const candidates = rows.map((row) => ({
      symbol: row.symbol,
      market: row.market,
      price: null,
      volume: null,
      dollarVolume: null,
      liquidityRank: null,
      flowScore: 0,
      previousSessionFlowScore: 0,
      rankedAt: null,
      selected: false,
      selectedAt: null,
      lastScannedAt: null,
      cooldownUntil: null,
    }));
    verifiedSymbolSet = new Set(
      candidates.map((candidate) => normalizeSymbol(candidate.symbol)),
    );
    verifiedSymbols = verifiedSymbolSet.size;
    needsVerificationSymbols = 0;
    rejectedSymbols = 0;
    return candidates;
  }

  async function loadCandidates(): Promise<RankingCandidate[]> {
    try {
      const rows = await runtimeOptions.db
        .select({
          symbol: universeCatalogListingsTable.normalizedTicker,
          market: universeCatalogListingsTable.market,
          price: flowUniverseRankingsTable.price,
          volume: flowUniverseRankingsTable.volume,
          dollarVolume: flowUniverseRankingsTable.dollarVolume,
          liquidityRank: flowUniverseRankingsTable.liquidityRank,
          flowScore: flowUniverseRankingsTable.flowScore,
          previousSessionFlowScore:
            flowUniverseRankingsTable.previousSessionFlowScore,
          rankedAt: flowUniverseRankingsTable.rankedAt,
          selected: flowUniverseRankingsTable.selected,
          selectedAt: flowUniverseRankingsTable.selectedAt,
          lastScannedAt: flowUniverseRankingsTable.lastScannedAt,
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
        .where(
          and(
            ...catalogEligibilityFilters(),
            catalogOptionabilityVerifiedFilter(),
          ),
        )
        .orderBy(
          desc(flowUniverseRankingsTable.previousSessionFlowScore),
          desc(flowUniverseRankingsTable.flowScore),
          desc(flowUniverseRankingsTable.dollarVolume),
        )
        .limit(
          Math.max(runtimeOptions.targetSize * 4, runtimeOptions.targetSize + 100),
        );

      const strictCandidates = rows.map((row) => ({
        symbol: row.symbol,
        market: row.market,
        price: toNumber(row.price),
        volume: toNumber(row.volume),
        dollarVolume: toNumber(row.dollarVolume),
        liquidityRank: row.liquidityRank ?? null,
        flowScore: toNumber(row.flowScore) ?? 0,
        previousSessionFlowScore: toNumber(row.previousSessionFlowScore) ?? 0,
        rankedAt: row.rankedAt ?? null,
        selected: Boolean(row.selected),
        selectedAt: row.selectedAt ?? null,
        lastScannedAt: row.lastScannedAt ?? null,
        cooldownUntil: row.cooldownUntil ?? null,
      }));
      verifiedSymbolSet = new Set(
        strictCandidates.map((candidate) => normalizeSymbol(candidate.symbol)),
      );
      verifiedSymbols = verifiedSymbolSet.size;
      await refreshVerificationCounts().catch(() => undefined);
      return strictCandidates;
    } catch (error) {
      if (isMissingFlowUniverseRankingsTableError(error)) {
        return loadCatalogCandidates();
      }
      throw error;
    }
  }

  async function refreshLiquidityRankings(
    candidates: readonly RankingCandidate[],
    refreshedAt: Date,
  ): Promise<boolean> {
    if (!runtimeOptions.fetchLiquiditySnapshots || !candidates.length) {
      return false;
    }

    const symbols = uniqueSymbols(candidates.map((candidate) => candidate.symbol));
    const chunks: string[][] = [];
    for (let index = 0; index < symbols.length; index += 100) {
      chunks.push(symbols.slice(index, index + 100));
    }

    const snapshots = (
      await mapConcurrent(chunks, 2, (chunk) =>
        runtimeOptions.fetchLiquiditySnapshots!(chunk),
      )
    ).flat();
    const rankedBySymbol = new Map<
      string,
      {
        symbol: string;
        price: number;
        volume: number;
        dollarVolume: number;
        source: string;
      }
    >();
    snapshots
      .map((snapshot) => {
        const symbol = normalizeSymbol(snapshot.symbol);
        const price =
          Number.isFinite(snapshot.price ?? Number.NaN) && (snapshot.price ?? 0) > 0
            ? (snapshot.price as number)
            : null;
        const volume =
          Number.isFinite(snapshot.volume ?? Number.NaN) && (snapshot.volume ?? 0) > 0
            ? (snapshot.volume as number)
            : null;
        const dollarVolume = price && volume ? price * volume : null;
        const source =
          typeof snapshot.source === "string" && snapshot.source.trim()
            ? snapshot.source.trim().toLowerCase()
            : "unknown";
        return { symbol, price, volume, dollarVolume, source };
      })
      .filter(
        (snapshot) =>
          snapshot.symbol &&
          snapshot.price !== null &&
          snapshot.volume !== null &&
          snapshot.dollarVolume !== null,
      )
      .forEach((snapshot) => {
        const existing = rankedBySymbol.get(snapshot.symbol);
        if (
          !existing ||
          (snapshot.dollarVolume ?? 0) > existing.dollarVolume
        ) {
          rankedBySymbol.set(snapshot.symbol, {
            symbol: snapshot.symbol,
            price: snapshot.price as number,
            volume: snapshot.volume as number,
            dollarVolume: snapshot.dollarVolume as number,
            source: snapshot.source,
          });
        }
      });

    const ranked = [...rankedBySymbol.values()]
      .sort((left, right) => (right.dollarVolume ?? 0) - (left.dollarVolume ?? 0));

    if (!ranked.length) {
      return false;
    }

    try {
      await runtimeOptions.db
        .insert(flowUniverseRankingsTable)
        .values(
          ranked.map((snapshot, index) => ({
            symbol: snapshot.symbol,
            market: "stocks",
            price: snapshot.price?.toString() ?? null,
            volume: snapshot.volume?.toString() ?? null,
            dollarVolume: snapshot.dollarVolume?.toString() ?? null,
            liquidityRank: index + 1,
            eligible:
              (snapshot.price ?? 0) >= runtimeOptions.minPrice &&
              (snapshot.dollarVolume ?? 0) >= runtimeOptions.minDollarVolume,
            reason:
              (snapshot.price ?? 0) < runtimeOptions.minPrice
                ? "below_min_price"
                : (snapshot.dollarVolume ?? 0) < runtimeOptions.minDollarVolume
                  ? "below_min_dollar_volume"
                  : null,
            source: snapshot.source,
            rankedAt: refreshedAt,
            updatedAt: refreshedAt,
          })),
        )
        .onConflictDoUpdate({
          target: flowUniverseRankingsTable.symbol,
          set: {
            price: sql`excluded.price`,
            volume: sql`excluded.volume`,
            dollarVolume: sql`excluded.dollar_volume`,
            liquidityRank: sql`excluded.liquidity_rank`,
            eligible: sql`excluded.eligible`,
            reason: sql`excluded.reason`,
            source: sql`excluded.source`,
            rankedAt: refreshedAt,
            updatedAt: refreshedAt,
          },
        });
    } catch (error) {
      if (
        isMissingFlowUniverseRankingsTableError(error) ||
        isTransientPostgresError(error)
      ) {
        degradedReason = isTransientPostgresError(error)
          ? "Flow universe liquidity ranking persistence unavailable."
          : degradedReason;
        return false;
      }
      throw error;
    }

    return true;
  }

  async function persistSelection(
    symbols: readonly string[],
    selectedAt: Date,
  ): Promise<string | null> {
    const uniqueSelection = uniqueSymbols(symbols);
    if (!uniqueSelection.length) return null;
    try {
      await runtimeOptions.db
        .update(flowUniverseRankingsTable)
        .set({ selected: false, updatedAt: selectedAt })
        .where(eq(flowUniverseRankingsTable.selected, true));
      await runtimeOptions.db
        .insert(flowUniverseRankingsTable)
        .values(
          uniqueSelection.map((symbol, index) => ({
            symbol,
            market: "stocks",
            eligible: true,
            source: "massive",
            metadata: {
              selectionSource: "flow_universe",
              selectedAt: selectedAt.toISOString(),
            },
            selected: true,
            selectedAt,
            liquidityRank: index + 1,
            rankedAt: selectedAt,
            updatedAt: selectedAt,
          })),
        )
        .onConflictDoUpdate({
          target: flowUniverseRankingsTable.symbol,
          set: {
            eligible: true,
            selected: true,
            source: sql`excluded.source`,
            liquidityRank: sql`excluded.liquidity_rank`,
            metadata: sql`coalesce(${flowUniverseRankingsTable.metadata}, '{}'::jsonb) || excluded.metadata`,
            selectedAt,
            rankedAt: selectedAt,
            updatedAt: selectedAt,
          },
        });
    } catch (error) {
      if (
        isMissingFlowUniverseRankingsTableError(error) ||
        isTransientPostgresError(error)
      ) {
        return isTransientPostgresError(error)
          ? "Flow universe selection persistence unavailable."
          : null;
      }
      throw error;
    }
    return null;
  }

  async function refresh(input: { pinnedSymbols?: readonly string[] } = {}) {
    if (shouldSkipFlowUniverseDbRefreshForPressure()) {
      const refreshedAt = now();
      selectedSymbols = lastGoodSymbols.length ? lastGoodSymbols : selectedSymbols;
      lastRefreshAt = refreshedAt;
      degradedReason =
        shortfallReason(selectedSymbols.length) ??
        "Flow universe refresh skipped under resource pressure.";
      return selectedSymbols;
    }
    if (runtimeOptions.mode === "watchlist") {
      await loadCandidates().catch(() => []);
      const requestedSymbols = uniqueSymbols(
        input.pinnedSymbols?.length
          ? input.pinnedSymbols
          : runtimeOptions.fallbackSymbols,
      );
      await loadVerifiedSymbols(requestedSymbols).catch(() => new Set<string>());
      selectedSymbols = requestedSymbols.filter((symbol) =>
        verifiedSymbolSet.has(normalizeSymbol(symbol)),
      );
      degradedReason = shortfallReason(selectedSymbols.length);
      return selectedSymbols;
    }

    try {
      const refreshedAt = now();
      let candidates = await loadCandidates();
      if (await refreshLiquidityRankings(candidates, refreshedAt)) {
        candidates = await loadCandidates();
      }
      const selectionNow = now();
      const pinnedSymbols =
        runtimeOptions.mode === "hybrid"
          ? input.pinnedSymbols ?? runtimeOptions.fallbackSymbols
          : [];
      if (pinnedSymbols.length) {
        await loadVerifiedSymbols(pinnedSymbols).catch(() => new Set<string>());
      }
      const selected = rankFlowUniverseCandidates({
        candidates,
        pinnedSymbols: uniqueSymbols(pinnedSymbols).filter((symbol) =>
          verifiedSymbolSet.has(normalizeSymbol(symbol)),
        ),
        fallbackSymbols: [],
        targetSize: runtimeOptions.targetSize,
        minPrice: runtimeOptions.minPrice,
        minDollarVolume: runtimeOptions.minDollarVolume,
        now: selectionNow,
      });

      if (!selected.length) {
        throw new Error("No eligible Massive-optionable symbols found for flow universe.");
      }

      const persistenceDegradedReason = await persistSelection(selected, refreshedAt);
      selectedSymbols = selected;
      lastGoodSymbols = selected;
      lastRefreshAt = refreshedAt;
      lastGoodAt = refreshedAt;
      rankedAt =
        candidates
          .map((candidate) => candidate.rankedAt)
          .filter((value): value is Date => value instanceof Date)
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? refreshedAt;
      cooldownCount = candidates.filter(
        (candidate) => candidate.cooldownUntil && candidate.cooldownUntil > refreshedAt,
      ).length;
      degradedReason =
        shortfallReason(selected.length) ?? persistenceDegradedReason;
      return selectedSymbols;
    } catch (error) {
      const refreshedAt = now();
      selectedSymbols = lastGoodSymbols.length ? lastGoodSymbols : [];
      lastGoodSymbols = selectedSymbols;
      lastRefreshAt = refreshedAt;
      lastGoodAt = refreshedAt;
      rankedAt = refreshedAt;
      cooldownCount = 0;

      const refreshError =
        error instanceof Error ? error.message : "Flow universe refresh failed.";
      const rootDegradedReason =
        isTransientPostgresError(error)
          ? "Flow universe database unavailable; using last verified universe."
          : `Flow universe refresh failed; using last verified universe: ${refreshError}`;
      const fillShortfallReason = shortfallReason(selectedSymbols.length);
      degradedReason = fillShortfallReason
        ? `${rootDegradedReason} ${fillShortfallReason}.`
        : rootDegradedReason;
      return selectedSymbols;
    }
  }

  function getSymbols(input: { pinnedSymbols?: readonly string[] } = {}): string[] {
    const current = now();
    if (
      !refreshPromise &&
      (!lastRefreshAt ||
        current.getTime() - lastRefreshAt.getTime() >= runtimeOptions.refreshMs)
    ) {
      refreshPromise = refresh(input).finally(() => {
        refreshPromise = null;
      });
    }
    return selectedSymbols.length
      ? selectedSymbols
      : [];
  }

  function filterVerifiedSymbols(symbols: readonly string[]): string[] {
    return uniqueSymbols(symbols).filter((symbol) =>
      verifiedSymbolSet.has(normalizeSymbol(symbol)),
    );
  }

  function noteBatch(symbols: readonly string[]): void {
    currentBatch = uniqueSymbols(symbols);
  }

  // Census S11: recordObservation used to issue one single-row EWMA upsert per symbol
  // (~500 per 15s scan batch); observations now queue and flush as multi-row upserts.
  async function recordObservation(input: FlowUniverseObservation): Promise<void> {
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol) return;
    const observedAt = input.scannedAt ?? now();
    scannedAtBySymbol.set(symbol, observedAt);
    lastScanAt = observedAt;
    const failed = Boolean(input.failed);
    pendingObservations.push({
      symbol,
      observedAt,
      hasEvents: Boolean(input.events?.length),
      failed,
      flowScore: scoreObservation(input.events),
      reason: input.reason ?? null,
      optionabilityMetadata:
        !failed && input.optionabilityVerified !== false
          ? {
              optionability: {
                status: "verified",
                source: "scanner_scan",
                verifiedAt: observedAt.toISOString(),
              },
            }
          : null,
    });
    if (!pendingObservationFlush) {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      pendingObservationFlush = { promise, resolve };
      observationFlushTimer = setTimeout(
        startObservationFlush,
        OBSERVATION_FLUSH_DELAY_MS,
      );
      observationFlushTimer.unref();
    }
    const flush = pendingObservationFlush;
    if (pendingObservations.length >= OBSERVATION_FLUSH_MAX_ROWS) {
      startObservationFlush();
    }
    return flush.promise;
  }

  function startObservationFlush(): void {
    const flush = pendingObservationFlush;
    if (!flush) return;
    pendingObservationFlush = null;
    if (observationFlushTimer) {
      clearTimeout(observationFlushTimer);
      observationFlushTimer = null;
    }
    const rows = pendingObservations;
    pendingObservations = [];
    // Chain flushes so EWMA updates apply in observation order.
    observationFlushChain = observationFlushChain
      .then(() => flushObservationRows(rows))
      .finally(() => flush.resolve());
  }

  async function flushObservationRows(
    rows: readonly PendingRankingObservation[],
  ): Promise<void> {
    if (shouldSkipFlowUniverseDbRefreshForPressure()) {
      return;
    }
    // A multi-row ON CONFLICT DO UPDATE cannot touch the same row twice, so a
    // repeated symbol starts a new statement; statements run sequentially.
    const chunks: PendingRankingObservation[][] = [];
    let chunk: PendingRankingObservation[] = [];
    let chunkSymbols = new Set<string>();
    for (const row of rows) {
      if (
        chunk.length >= OBSERVATION_FLUSH_MAX_ROWS ||
        chunkSymbols.has(row.symbol)
      ) {
        chunks.push(chunk);
        chunk = [];
        chunkSymbols = new Set();
      }
      chunk.push(row);
      chunkSymbols.add(row.symbol);
    }
    if (chunk.length) {
      chunks.push(chunk);
    }
    for (const chunkRows of chunks) {
      try {
        await runtimeOptions.db
          .insert(flowUniverseRankingsTable)
          .values(
            chunkRows.map((row) => ({
              symbol: row.symbol,
              market: "stocks",
              source: "massive",
              lastScannedAt: row.observedAt,
              lastFlowAt: row.hasEvents ? row.observedAt : null,
              flowScore: row.flowScore.toString(),
              failureCount: row.failed ? 1 : 0,
              cooldownUntil: null,
              reason: row.reason,
              metadata: row.optionabilityMetadata,
              updatedAt: row.observedAt,
            })),
          )
          .onConflictDoUpdate({
            target: flowUniverseRankingsTable.symbol,
            set: {
              lastScannedAt: sql`excluded.last_scanned_at`,
              // excluded.last_flow_at is non-null only when the row had events.
              lastFlowAt: sql`coalesce(excluded.last_flow_at, ${flowUniverseRankingsTable.lastFlowAt})`,
              flowScore: sql`case when excluded.last_flow_at is not null then ${flowUniverseRankingsTable.flowScore} * 0.80 + excluded.flow_score else ${flowUniverseRankingsTable.flowScore} * 0.95 end`,
              // excluded.failure_count is 1 for failed observations, 0 otherwise.
              failureCount: sql`case when excluded.failure_count > 0 then ${flowUniverseRankingsTable.failureCount} + 1 else 0 end`,
              cooldownUntil: sql`case when excluded.failure_count > 0 then case when ${flowUniverseRankingsTable.failureCount} + 1 >= ${COOLDOWN_FAILURE_THRESHOLD} then excluded.last_scanned_at + ${sql.raw(String(COOLDOWN_MS))} * interval '1 millisecond' else ${flowUniverseRankingsTable.cooldownUntil} end else null end`,
              reason: sql`excluded.reason`,
              metadata: sql`case when excluded.metadata is not null then coalesce(${flowUniverseRankingsTable.metadata}, '{}'::jsonb) || excluded.metadata else ${flowUniverseRankingsTable.metadata} end`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        if (isTransientFlowUniverseDegradedReason(degradedReason)) {
          degradedReason = shortfallReason(selectedSymbols.length);
        }
        for (const row of chunkRows) {
          if (row.optionabilityMetadata) {
            verifiedSymbolSet.add(row.symbol);
          }
        }
        verifiedSymbols = verifiedSymbolSet.size;
      } catch {
        // The scanner must keep running even before the DB schema is pushed.
      }
    }
  }

  function getCoverage(input: { scanWindowMs?: number } = {}): FlowUniverseCoverage {
    const current = now();
    const scanWindowMs =
      typeof input.scanWindowMs === "number" &&
      Number.isFinite(input.scanWindowMs) &&
      input.scanWindowMs > 0
        ? input.scanWindowMs
        : null;
    const scanCutoffMs =
      scanWindowMs === null ? null : current.getTime() - scanWindowMs;
    const selectedSet = new Set(selectedSymbols.map((symbol) => normalizeSymbol(symbol)));
    const lastScannedAt = Object.fromEntries(
      Array.from(scannedAtBySymbol.entries())
        .filter(([symbol, scannedAt]) => {
          if (selectedSet.size > 0 && !selectedSet.has(symbol)) {
            return false;
          }
          return scanCutoffMs === null || scannedAt.getTime() >= scanCutoffMs;
        })
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([symbol, scannedAt]) => [symbol, scannedAt.getTime()]),
    );
    const scanTimes = Object.values(lastScannedAt).filter((value) =>
      Number.isFinite(value),
    );
    const oldestScanAt = scanTimes.length ? Math.min(...scanTimes) : null;
    const newestScanAt = scanTimes.length ? Math.max(...scanTimes) : null;
    return {
      mode: runtimeOptions.mode,
      targetSize: runtimeOptions.targetSize,
      activeTargetSize: selectedSymbols.length,
      selectedSymbols: selectedSymbols.length,
      selectedShortfall: Math.max(0, runtimeOptions.targetSize - selectedSymbols.length),
      rankedAt,
      lastRefreshAt,
      lastGoodAt,
      stale: Boolean(
        lastRefreshAt &&
          current.getTime() - lastRefreshAt.getTime() > runtimeOptions.refreshMs * 2,
      ),
      fallbackUsed: Boolean(degradedReason),
      cooldownCount,
      verifiedSymbols,
      needsVerificationSymbols,
      rejectedSymbols,
      verificationBacklogSymbols: needsVerificationSymbols + rejectedSymbols,
      scannedSymbols: scanTimes.length,
      cycleScannedSymbols: scanTimes.length,
      lastScannedAt,
      oldestScanAt,
      newestScanAt,
      currentBatch,
      lastScanAt,
      degradedReason,
    };
  }

  function getConfig(): FlowUniverseRuntimeConfig {
    return {
      mode: runtimeOptions.mode,
      targetSize: runtimeOptions.targetSize,
      refreshMs: runtimeOptions.refreshMs,
      markets: [...runtimeOptions.markets],
      minPrice: runtimeOptions.minPrice,
      minDollarVolume: runtimeOptions.minDollarVolume,
    };
  }

  function updateConfig(input: Partial<FlowUniverseRuntimeConfig>): void {
    runtimeOptions = {
      ...runtimeOptions,
      ...input,
      markets: input.markets ? [...input.markets] : runtimeOptions.markets,
      fallbackSymbols: runtimeOptions.fallbackSymbols,
    };
    reset();
  }

  function reset(): void {
    selectedSymbols = [];
    lastGoodSymbols = selectedSymbols;
    verifiedSymbolSet = new Set();
    verifiedSymbols = 0;
    needsVerificationSymbols = 0;
    rejectedSymbols = 0;
    refreshPromise = null;
    lastRefreshAt = null;
    lastGoodAt = null;
    rankedAt = null;
    degradedReason = null;
    cooldownCount = 0;
    scannedAtBySymbol = new Map();
    currentBatch = [];
    lastScanAt = null;
  }

  return {
    getConfig,
    getCoverage,
    getSymbols,
    filterVerifiedSymbols,
    noteBatch,
    recordObservation,
    refresh,
    reset,
    updateConfig,
  };
}

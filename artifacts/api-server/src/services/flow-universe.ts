import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  flowUniverseRankingsTable,
  universeCatalogListingsTable,
} from "@workspace/db/schema";
import { isTransientPostgresError } from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";

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
  scannedSymbols: number;
  cycleScannedSymbols: number;
  currentBatch: string[];
  lastScanAt: Date | null;
  degradedReason: string | null;
  radarSelectedSymbols?: number;
  radarEstimatedCycleMs?: number | null;
  radarBatchSize?: number;
  radarIntervalMs?: number;
  promotedSymbols?: string[];
};

export type FlowUniverseObservation = {
  symbol: string;
  scannedAt?: Date;
  events?: Array<{ premium?: number; unusualScore?: number; isUnusual?: boolean }>;
  failed?: boolean;
  reason?: string | null;
};

export type FlowUniverseLiquiditySnapshot = {
  symbol: string;
  price: number | null;
  volume: number | null;
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
  fetchFallbackSymbols?: () => Promise<readonly string[]>;
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

const DEFAULT_REFRESH_MS = 15 * 60_000;
const COOLDOWN_FAILURE_THRESHOLD = 2;
const COOLDOWN_MS = 15 * 60_000;
const OUTSIDE_RTH_INTERVAL_MULTIPLIER = 4;
const OPTIONABLE_DERIVATIVE_SEC_TYPE_RE = /(^|,)\s*OPT\s*(,|$)/i;

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
  const raw = (value as Record<string, unknown>)["derivativeSecTypes"];
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
  return sql`coalesce(${universeCatalogListingsTable.contractMeta}->>'derivativeSecTypes', '') ~* '(^|,)\\s*OPT\\s*(,|$)'`;
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
  const base = Math.max(1_000, input.baseIntervalMs);
  if (!input.alwaysOn || isRegularTradingHours(input.now ?? new Date())) {
    return base;
  }
  return base * OUTSIDE_RTH_INTERVAL_MULTIPLIER;
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

  for (const symbol of uniqueSymbols(input.fallbackSymbols ?? [])) {
    if (selected.length >= targetSize) break;
    appendSymbol(symbol);
  }

  for (const candidate of sorted.filter(
    (candidate) => !hasFlowEvidence(candidate) && hasLiquidityEvidence(candidate),
  )) {
    if (selected.length >= targetSize) break;
    appendSymbol(candidate.symbol);
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
  let lastGoodSymbols = uniqueSymbols(runtimeOptions.fallbackSymbols);
  let selectedSymbols = lastGoodSymbols;
  let refreshPromise: Promise<string[]> | null = null;
  let lastRefreshAt: Date | null = null;
  let lastGoodAt: Date | null = null;
  let rankedAt: Date | null = null;
  let degradedReason: string | null = null;
  let cooldownCount = 0;
  let scannedSymbols = new Set<string>();
  let currentBatch: string[] = [];
  let lastScanAt: Date | null = null;

  function shortfallReason(selectedCount: number, targetSize = runtimeOptions.targetSize) {
    return selectedCount < targetSize
      ? `Universe fill short: ${selectedCount}/${targetSize}`
      : null;
  }

  async function loadFallbackFillSymbols(): Promise<{
    symbols: string[];
    error: string | null;
  }> {
    if (!runtimeOptions.fetchFallbackSymbols) {
      return {
        symbols: uniqueSymbols(runtimeOptions.fallbackSymbols),
        error: null,
      };
    }

    try {
      return {
        symbols: uniqueSymbols([
          ...(await runtimeOptions.fetchFallbackSymbols()),
          ...runtimeOptions.fallbackSymbols,
        ]),
        error: null,
      };
    } catch (error) {
      return {
        symbols: uniqueSymbols(runtimeOptions.fallbackSymbols),
        error:
          error instanceof Error
            ? error.message
            : "Flow universe fallback symbol fetch failed.",
      };
    }
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
            [...runtimeOptions.markets] as Array<"stocks" | "etf" | "indices" | "futures" | "fx" | "crypto" | "otc">,
          ),
          sql`${universeCatalogListingsTable.providerContractId} ~ '^[0-9]+$'`,
          sql`coalesce(${universeCatalogListingsTable.primaryExchange}, '') <> 'OTC'`,
          optionableUniverseContractMetaSql(),
        ),
      )
      .orderBy(asc(universeCatalogListingsTable.normalizedTicker))
      .limit(Math.max(runtimeOptions.targetSize * 4, runtimeOptions.targetSize + 100));

    return rows.map((row) => ({
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
            eq(universeCatalogListingsTable.active, true),
            eq(universeCatalogListingsTable.ibkrHydrationStatus, "hydrated"),
            inArray(
              universeCatalogListingsTable.market,
              [...runtimeOptions.markets] as Array<"stocks" | "etf" | "indices" | "futures" | "fx" | "crypto" | "otc">,
            ),
            sql`${universeCatalogListingsTable.providerContractId} ~ '^[0-9]+$'`,
            sql`coalesce(${universeCatalogListingsTable.primaryExchange}, '') <> 'OTC'`,
            optionableUniverseContractMetaSql(),
            sql`(${flowUniverseRankingsTable.price} is null or ${flowUniverseRankingsTable.price} >= ${runtimeOptions.minPrice.toString()})`,
            sql`(${flowUniverseRankingsTable.dollarVolume} is null or ${flowUniverseRankingsTable.dollarVolume} >= ${runtimeOptions.minDollarVolume.toString()})`,
          ),
        )
        .orderBy(
          desc(flowUniverseRankingsTable.previousSessionFlowScore),
          desc(flowUniverseRankingsTable.flowScore),
          desc(flowUniverseRankingsTable.dollarVolume),
        )
        .limit(Math.max(runtimeOptions.targetSize * 4, runtimeOptions.targetSize + 100));

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
      await mapConcurrent(chunks, 2, (chunk) => runtimeOptions.fetchLiquiditySnapshots!(chunk))
    ).flat();
    const rankedBySymbol = new Map<
      string,
      {
        symbol: string;
        price: number;
        volume: number;
        dollarVolume: number;
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
        return { symbol, price, volume, dollarVolume };
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
            source: "polygon",
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
            source: "ibkr",
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
    if (runtimeOptions.mode === "watchlist") {
      selectedSymbols = uniqueSymbols(
        input.pinnedSymbols?.length
          ? input.pinnedSymbols
          : runtimeOptions.fallbackSymbols,
      );
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
      const eligibleCandidateSymbols = new Set(
        [
          ...uniqueSymbols(pinnedSymbols),
          ...candidates
            .filter(
              (candidate) =>
                !candidate.cooldownUntil || candidate.cooldownUntil <= selectionNow,
            )
            .map((candidate) => normalizeSymbol(candidate.symbol))
            .filter(Boolean),
        ],
      );
      let fallbackFillSymbols = runtimeOptions.fallbackSymbols;
      let fallbackFillError: string | null = null;
      if (
        eligibleCandidateSymbols.size < runtimeOptions.targetSize &&
        runtimeOptions.fetchFallbackSymbols
      ) {
        const fallback = await loadFallbackFillSymbols();
        fallbackFillSymbols = fallback.symbols;
        fallbackFillError = fallback.error;
      }
      const selected = rankFlowUniverseCandidates({
        candidates,
        pinnedSymbols,
        fallbackSymbols: fallbackFillSymbols,
        targetSize: runtimeOptions.targetSize,
        minPrice: runtimeOptions.minPrice,
        minDollarVolume: runtimeOptions.minDollarVolume,
        now: selectionNow,
      });

      if (!selected.length) {
        throw new Error("No eligible IBKR-optionable symbols found for flow universe.");
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
        shortfallReason(selected.length) ??
        (fallbackFillError
          ? `Fallback universe fill skipped: ${fallbackFillError}`
          : persistenceDegradedReason);
      return selectedSymbols;
    } catch (error) {
      const refreshedAt = now();
      const fallback = await loadFallbackFillSymbols();
      const selected = rankFlowUniverseCandidates({
        candidates: [],
        pinnedSymbols:
          runtimeOptions.mode === "hybrid"
            ? input.pinnedSymbols ?? runtimeOptions.fallbackSymbols
            : [],
        fallbackSymbols: fallback.symbols,
        targetSize: runtimeOptions.targetSize,
        minPrice: runtimeOptions.minPrice,
        minDollarVolume: runtimeOptions.minDollarVolume,
        now: refreshedAt,
      });

      selectedSymbols = selected.length
        ? selected
        : lastGoodSymbols.length
          ? lastGoodSymbols
          : uniqueSymbols(runtimeOptions.fallbackSymbols);
      lastGoodSymbols = selectedSymbols;
      lastRefreshAt = refreshedAt;
      lastGoodAt = refreshedAt;
      rankedAt = refreshedAt;
      cooldownCount = 0;

      const refreshError =
        error instanceof Error ? error.message : "Flow universe refresh failed.";
      degradedReason =
        fallback.error
          ? `Flow universe refresh failed; provider fallback also failed: ${fallback.error}`
          : isTransientPostgresError(error)
            ? "Flow universe database unavailable; using provider fallback universe."
            : `Flow universe refresh failed; using provider fallback universe: ${refreshError}`;
      degradedReason =
        shortfallReason(selectedSymbols.length) ?? degradedReason;
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
      : uniqueSymbols(runtimeOptions.fallbackSymbols);
  }

  function noteBatch(symbols: readonly string[]): void {
    currentBatch = uniqueSymbols(symbols);
  }

  async function recordObservation(input: FlowUniverseObservation): Promise<void> {
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol) return;
    const observedAt = input.scannedAt ?? now();
    scannedSymbols.add(symbol);
    lastScanAt = observedAt;
    const flowScore = scoreObservation(input.events);
    const hasEvents = Boolean(input.events?.length);
    const failed = Boolean(input.failed);
    try {
      await runtimeOptions.db
        .insert(flowUniverseRankingsTable)
        .values({
          symbol,
          market: "stocks",
          source: "ibkr",
          lastScannedAt: observedAt,
          lastFlowAt: hasEvents ? observedAt : null,
          flowScore: flowScore.toString(),
          failureCount: failed ? 1 : 0,
          cooldownUntil: null,
          reason: input.reason ?? null,
          updatedAt: observedAt,
        })
        .onConflictDoUpdate({
          target: flowUniverseRankingsTable.symbol,
          set: {
            lastScannedAt: observedAt,
            lastFlowAt: hasEvents ? observedAt : sql`${flowUniverseRankingsTable.lastFlowAt}`,
            flowScore: hasEvents
              ? sql`${flowUniverseRankingsTable.flowScore} * 0.80 + ${flowScore.toString()}`
              : sql`${flowUniverseRankingsTable.flowScore} * 0.95`,
            failureCount: failed
              ? sql`${flowUniverseRankingsTable.failureCount} + 1`
              : 0,
            cooldownUntil: failed
              ? sql`case when ${flowUniverseRankingsTable.failureCount} + 1 >= ${COOLDOWN_FAILURE_THRESHOLD} then ${new Date(observedAt.getTime() + COOLDOWN_MS)} else ${flowUniverseRankingsTable.cooldownUntil} end`
              : null,
            reason: input.reason ?? null,
            updatedAt: observedAt,
          },
        });
    } catch {
      // The scanner must keep running even before the DB schema is pushed.
    }
  }

  function getCoverage(): FlowUniverseCoverage {
    const current = now();
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
      scannedSymbols: scannedSymbols.size,
      cycleScannedSymbols: scannedSymbols.size,
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
    selectedSymbols = uniqueSymbols(runtimeOptions.fallbackSymbols);
    lastGoodSymbols = selectedSymbols;
    refreshPromise = null;
    lastRefreshAt = null;
    lastGoodAt = null;
    rankedAt = null;
    degradedReason = null;
    cooldownCount = 0;
    scannedSymbols = new Set();
    currentBatch = [];
    lastScanAt = null;
  }

  return {
    getConfig,
    getCoverage,
    getSymbols,
    noteBatch,
    recordObservation,
    refresh,
    reset,
    updateConfig,
  };
}

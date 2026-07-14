import { pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  universeCatalogListingsTable,
  universeCatalogSyncStatesTable,
  universeSourceMembershipsTable,
} from "@workspace/db/schema";
import { type UniverseMarket } from "../../artifacts/api-server/src/providers/massive/market-data";
import { hydrateUniverseCatalogListingWithIbkr } from "../../artifacts/api-server/src/services/platform";
import {
  loadWatchlistUniversePrioritySymbols,
  normalizeUniversePrioritySymbol,
  uniqueUniversePrioritySymbols,
} from "./universe-priority";

const DEFAULT_MARKETS: UniverseMarket[] = ["stocks", "etf", "otc"];
const UNIVERSE_MARKETS: readonly UniverseMarket[] = [
  "stocks",
  "etf",
  "indices",
  "futures",
  "fx",
  "crypto",
  "otc",
];
const DEFAULT_PREVIEW_LIMIT = 100;
const DEFAULT_EXECUTE_LIMIT = 1_000_000;
const MAX_BATCH_SIZE = 250;
const MAX_DIAGNOSTIC_LENGTH = 400;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const DEFAULT_PRIORITY_LANES = [
  "symbols",
  "watchlists",
  "nasdaq_listed",
  "other_listed",
] as const;
const SOURCE_PRIORITY_LANES = new Set(["nasdaq_listed", "other_listed"]);
const BROAD_SOURCE_IDS = ["nasdaq_listed", "other_listed"] as const;

type HydrationMode = "priority" | "broad" | "priority-then-broad";
type PriorityLane = (typeof DEFAULT_PRIORITY_LANES)[number];
type HydrationPhase = "priority" | "broad";
type HydrationArgs = {
  execute: boolean;
  activeOnly: boolean;
  resume: boolean;
  reset: boolean;
  force: boolean;
  mode: HydrationMode;
  priorityLanes: PriorityLane[];
  explicitSymbols: string[];
  batchSize: number;
  maxRowsPerMarket: number;
  markets: UniverseMarket[];
};
type HydrationRow = {
  listingKey: string;
  symbol: string;
  source: string;
};
type HydrationProgress = {
  processedThisMarket: number;
  phaseProcessedRows: number;
  totalProcessedRows: number;
  lastProcessedListingKey: string | null;
};
type SymbolListingRow = {
  listingKey: string;
  symbol: string;
  ibkrHydrationStatus: string;
  providerContractId: string | null;
  tradeProvider: string | null;
  locale: string | null;
  primaryExchange: string | null;
  normalizedExchangeMic: string | null;
  exchangeDisplay: string | null;
};

const PRIORITY_EXCHANGE_SCORE: Record<string, number> = {
  XNAS: 800,
  XNYS: 780,
  ARCX: 760,
  XASE: 740,
  BATS: 720,
  XNMS: 700,
  XNCM: 680,
};

const USAGE =
  "Usage: pnpm --filter @workspace/scripts run universe:hydrate:ibkr -- [--execute] [--markets=stocks,etf,otc] [--mode=priority|broad|priority-then-broad] [--priority=LANES] [--symbols=SYMBOLS] [--active=true|false] [--resume=true|false] [--reset=true|false] [--force=true|false] [--batch=1..250] [--limit=POSITIVE_INTEGER]";

function parseBooleanValue(
  name: string,
  raw: string | undefined,
  defaultValue: boolean,
): boolean {
  if (raw === undefined) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

function parsePositiveInteger(
  name: string,
  raw: string | undefined,
  defaultValue: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (raw === undefined) return defaultValue;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`--${name} must be a canonical positive integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`--${name} is outside the supported range.`);
  }
  return parsed;
}

function parseCsv(name: string, raw: string): string[] {
  const values = raw.split(",").map((value) => value.trim());
  if (!values.length || values.some((value) => !value)) {
    throw new Error(`--${name} must contain non-empty comma-separated values.`);
  }
  return values;
}

function parseMode(raw = "priority-then-broad"): HydrationMode {
  raw = raw.trim();
  if (raw === "priority" || raw === "broad" || raw === "priority-then-broad") {
    return raw;
  }
  throw new Error(
    `Invalid --mode=${raw}; expected priority, broad, or priority-then-broad.`,
  );
}

function parsePriorityLanes(raw: string | undefined): PriorityLane[] {
  if (raw === undefined) return [...DEFAULT_PRIORITY_LANES];
  const lanes = parseCsv("priority", raw);
  const invalid = lanes.filter(
    (lane) => !DEFAULT_PRIORITY_LANES.includes(lane as PriorityLane),
  );
  if (invalid.length) {
    throw new Error(`Invalid priority lanes: ${invalid.join(", ")}`);
  }
  return [...new Set(lanes)] as PriorityLane[];
}

function parseHydrationArgs(args = process.argv.slice(2)): HydrationArgs {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  try {
    const parsed = parseArgs({
      args: normalizedArgs,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        execute: { type: "boolean" },
        active: { type: "string" },
        resume: { type: "string" },
        reset: { type: "string" },
        force: { type: "string" },
        mode: { type: "string" },
        priority: { type: "string" },
        "priority-lanes": { type: "string" },
        symbols: { type: "string" },
        batch: { type: "string" },
        limit: { type: "string" },
        markets: { type: "string" },
      },
    });
    const optionCounts = new Map<string, number>();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      optionCounts.set(token.name, (optionCounts.get(token.name) ?? 0) + 1);
    }
    if ([...optionCounts.values()].some((count) => count > 1)) {
      throw new Error("Duplicate options are not allowed.");
    }
    if (
      parsed.values.priority !== undefined &&
      parsed.values["priority-lanes"] !== undefined
    ) {
      throw new Error("Use only one of --priority or --priority-lanes.");
    }

    const execute = parsed.values.execute ?? false;
    const rawMarkets = parsed.values.markets;
    const markets = rawMarkets
      ? parseCsv("markets", rawMarkets).map((market) => market.toLowerCase())
      : [...DEFAULT_MARKETS];
    const invalidMarkets = markets.filter(
      (market) => !UNIVERSE_MARKETS.includes(market as UniverseMarket),
    );
    if (invalidMarkets.length) {
      throw new Error(`Invalid markets: ${invalidMarkets.join(", ")}`);
    }

    const rawSymbols = parsed.values.symbols;
    const symbolValues =
      rawSymbols === undefined ? [] : parseCsv("symbols", rawSymbols);
    const explicitSymbols = uniqueUniversePrioritySymbols(symbolValues);
    const mode = parseMode(parsed.values.mode);
    const rawPriority =
      parsed.values.priority ?? parsed.values["priority-lanes"];
    const priorityLanes =
      mode === "broad" ? [] : parsePriorityLanes(rawPriority);
    if (
      mode === "broad" &&
      (rawPriority !== undefined || rawSymbols !== undefined)
    ) {
      throw new Error("Broad mode cannot use priority lanes or symbols.");
    }
    if (rawSymbols !== undefined && !priorityLanes.includes("symbols")) {
      throw new Error("--symbols requires the symbols priority lane.");
    }

    return {
      execute,
      activeOnly: parseBooleanValue("active", parsed.values.active, true),
      resume: parseBooleanValue("resume", parsed.values.resume, true),
      reset: parseBooleanValue("reset", parsed.values.reset, false),
      force: parseBooleanValue("force", parsed.values.force, false),
      mode,
      priorityLanes,
      explicitSymbols,
      batchSize: parsePositiveInteger(
        "batch",
        parsed.values.batch,
        50,
        MAX_BATCH_SIZE,
      ),
      maxRowsPerMarket: parsePositiveInteger(
        "limit",
        parsed.values.limit,
        execute ? DEFAULT_EXECUTE_LIMIT : DEFAULT_PREVIEW_LIMIT,
      ),
      markets: [...new Set(markets)] as UniverseMarket[],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${USAGE}\n${detail}`);
  }
}

function safeOutput(value: unknown, fallback: string): string {
  const withoutCredentials = String(value ?? "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/\s+/gu, " ");
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || fallback;
  if (diagnostic.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function safeDiagnostic(error: unknown): string {
  return safeOutput(
    error instanceof Error ? error.message : error,
    "Unknown hydration error",
  );
}

function safeHydrationRowForOutput(row: HydrationRow): HydrationRow {
  return {
    listingKey: safeOutput(row.listingKey, "-"),
    symbol: safeOutput(row.symbol, "-"),
    source: safeOutput(row.source, "-"),
  };
}

function buildScopeKey(
  market: UniverseMarket,
  activeOnly: boolean,
  phase: HydrationPhase,
) {
  const suffix = activeOnly ? "active" : "all";
  return phase === "broad"
    ? `ibkr-hydration:${market}:${suffix}`
    : `ibkr-priority-hydration:${market}:${suffix}`;
}

async function readSyncState(scopeKey: string) {
  const [state] = await db
    .select()
    .from(universeCatalogSyncStatesTable)
    .where(eq(universeCatalogSyncStatesTable.scopeKey, scopeKey))
    .limit(1);
  return state ?? null;
}

async function writeSyncState(input: {
  scopeKey: string;
  market: UniverseMarket;
  activeOnly: boolean;
  lastProcessedListingKey: string | null;
  rowsSynced: number;
  startedAt: Date;
  finishedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const now = new Date();
  await db
    .insert(universeCatalogSyncStatesTable)
    .values({
      scopeKey: input.scopeKey,
      phase: "ibkr_hydration",
      market: input.market,
      activeOnly: input.activeOnly,
      cursor: null,
      lastProcessedListingKey: input.lastProcessedListingKey,
      pagesSynced: 0,
      rowsSynced: input.rowsSynced,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      lastSuccessAt: input.lastSuccessAt,
      lastError: input.lastError,
      metadata: input.metadata ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: universeCatalogSyncStatesTable.scopeKey,
      set: {
        phase: "ibkr_hydration",
        market: input.market,
        activeOnly: input.activeOnly,
        cursor: null,
        lastProcessedListingKey: input.lastProcessedListingKey,
        rowsSynced: input.rowsSynced,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        lastSuccessAt: input.lastSuccessAt,
        lastError: input.lastError,
        metadata: input.metadata ?? null,
        updatedAt: now,
      },
    });
}

function listingHydrationFilters(input: {
  market: UniverseMarket;
  activeOnly: boolean;
  force: boolean;
  excludeListingKeys?: readonly string[];
}) {
  const filters = [eq(universeCatalogListingsTable.market, input.market)];
  if (input.activeOnly) {
    filters.push(eq(universeCatalogListingsTable.active, true));
  }
  if (!input.force) {
    filters.push(
      ne(universeCatalogListingsTable.ibkrHydrationStatus, "hydrated"),
    );
  }
  const exclusionFilter = listingKeyExclusionFilter(input.excludeListingKeys);
  if (exclusionFilter) filters.push(exclusionFilter);
  return filters;
}

function listingKeyExclusionFilter(listingKeys?: readonly string[]) {
  if (!listingKeys?.length) return null;
  return sql`${universeCatalogListingsTable.listingKey} <> all(${sql.param([...listingKeys])}::text[])`;
}

function prioritySymbolFilter(symbols: readonly string[]) {
  return sql`${universeCatalogListingsTable.normalizedTicker} = any(${sql.param([...symbols])}::text[])`;
}

function appendRows(
  target: HydrationRow[],
  rows: readonly HydrationRow[],
  seen: Set<string>,
  limit: number,
) {
  for (const row of rows) {
    if (target.length >= limit) break;
    if (!row.listingKey || seen.has(row.listingKey)) continue;
    seen.add(row.listingKey);
    target.push(row);
  }
}

async function loadRowsForSymbols(input: {
  symbols: readonly string[];
  market: UniverseMarket;
  activeOnly: boolean;
  force: boolean;
  source: string;
  excludeListingKeys?: readonly string[];
}): Promise<HydrationRow[]> {
  const symbols = uniqueUniversePrioritySymbols(input.symbols);
  if (!symbols.length) return [];
  const filters = [
    eq(universeCatalogListingsTable.market, input.market),
    prioritySymbolFilter(symbols),
  ];
  if (input.activeOnly) {
    filters.push(eq(universeCatalogListingsTable.active, true));
  }
  const exclusionFilter = listingKeyExclusionFilter(input.excludeListingKeys);
  if (exclusionFilter) filters.push(exclusionFilter);
  const rows = await db
    .select({
      listingKey: universeCatalogListingsTable.listingKey,
      symbol: universeCatalogListingsTable.normalizedTicker,
      ibkrHydrationStatus: universeCatalogListingsTable.ibkrHydrationStatus,
      providerContractId: universeCatalogListingsTable.providerContractId,
      tradeProvider: universeCatalogListingsTable.tradeProvider,
      locale: universeCatalogListingsTable.locale,
      primaryExchange: universeCatalogListingsTable.primaryExchange,
      normalizedExchangeMic: universeCatalogListingsTable.normalizedExchangeMic,
      exchangeDisplay: universeCatalogListingsTable.exchangeDisplay,
    })
    .from(universeCatalogListingsTable)
    .where(and(...filters));
  const order = new Map(symbols.map((symbol, index) => [symbol, index]));
  const bestRows = new Map<string, SymbolListingRow>();
  for (const row of rows) {
    const symbol = normalizeUniversePrioritySymbol(row.symbol);
    if (!symbol) continue;
    const mapped = {
      ...row,
      symbol,
    };
    const existing = bestRows.get(symbol);
    if (
      !existing ||
      scorePrioritySymbolListing(mapped) >
        scorePrioritySymbolListing(existing) ||
      (scorePrioritySymbolListing(mapped) ===
        scorePrioritySymbolListing(existing) &&
        mapped.listingKey.localeCompare(existing.listingKey) < 0)
    ) {
      bestRows.set(symbol, mapped);
    }
  }

  return [...bestRows.values()]
    .filter(
      (row) =>
        input.force ||
        !(
          row.ibkrHydrationStatus === "hydrated" ||
          (row.tradeProvider === "ibkr" && Boolean(row.providerContractId))
        ),
    )
    .map((row) => ({
      listingKey: row.listingKey,
      symbol: row.symbol,
      source: input.source,
    }))
    .sort(
      (left, right) =>
        (order.get(left.symbol) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.symbol) ?? Number.MAX_SAFE_INTEGER) ||
        left.listingKey.localeCompare(right.listingKey),
    );
}

function scorePrioritySymbolListing(row: SymbolListingRow): number {
  const exchange = normalizePriorityExchange(
    row.normalizedExchangeMic ?? row.primaryExchange ?? row.exchangeDisplay,
  );
  let score = 0;
  if ((row.locale ?? "").trim().toLowerCase() === "us") score += 10_000;
  score += PRIORITY_EXCHANGE_SCORE[exchange] ?? 0;
  if (row.tradeProvider === "ibkr" && row.providerContractId) score += 100;
  if (row.primaryExchange || row.normalizedExchangeMic || row.exchangeDisplay) {
    score += 10;
  }
  return score;
}

function normalizePriorityExchange(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9./_-]/g, "");
}

async function loadRowsForSource(input: {
  sourceId: string;
  market: UniverseMarket;
  activeOnly: boolean;
  force: boolean;
  limit: number;
  excludeListingKeys?: readonly string[];
}): Promise<HydrationRow[]> {
  const rows = await db
    .select({
      listingKey: universeCatalogListingsTable.listingKey,
      symbol: universeCatalogListingsTable.normalizedTicker,
    })
    .from(universeCatalogListingsTable)
    .innerJoin(
      universeSourceMembershipsTable,
      eq(
        universeSourceMembershipsTable.listingKey,
        universeCatalogListingsTable.listingKey,
      ),
    )
    .where(
      and(
        ...listingHydrationFilters(input),
        eq(universeSourceMembershipsTable.active, true),
        eq(universeSourceMembershipsTable.sourceId, input.sourceId),
      ),
    )
    .orderBy(
      sql`case ${universeCatalogListingsTable.ibkrHydrationStatus}
        when 'pending' then 0
        when 'failed' then 1
        when 'ambiguous' then 2
        when 'not_found' then 3
        else 4
      end`,
      asc(universeCatalogListingsTable.normalizedTicker),
      asc(universeCatalogListingsTable.listingKey),
    )
    .limit(input.limit);

  return rows.map((row) => ({
    listingKey: row.listingKey,
    symbol: normalizeUniversePrioritySymbol(row.symbol),
    source: input.sourceId,
  }));
}

async function loadPriorityRows(input: {
  market: UniverseMarket;
  activeOnly: boolean;
  force: boolean;
  priorityLanes: readonly PriorityLane[];
  explicitSymbols: readonly string[];
  watchlistSymbols: readonly string[];
  limit: number;
  excludeListingKeys?: readonly string[];
}): Promise<HydrationRow[]> {
  const rows: HydrationRow[] = [];
  const seen = new Set<string>();

  for (const lane of input.priorityLanes) {
    const remaining = Math.max(0, input.limit - rows.length);
    if (remaining <= 0) break;
    if (lane === "symbols") {
      appendRows(
        rows,
        await loadRowsForSymbols({
          symbols: input.explicitSymbols,
          market: input.market,
          activeOnly: input.activeOnly,
          force: input.force,
          source: "symbols",
          excludeListingKeys: input.excludeListingKeys,
        }),
        seen,
        input.limit,
      );
      continue;
    }
    if (lane === "watchlists") {
      appendRows(
        rows,
        await loadRowsForSymbols({
          symbols: input.watchlistSymbols,
          market: input.market,
          activeOnly: input.activeOnly,
          force: input.force,
          source: "watchlists",
          excludeListingKeys: input.excludeListingKeys,
        }),
        seen,
        input.limit,
      );
      continue;
    }
    if (SOURCE_PRIORITY_LANES.has(lane)) {
      appendRows(
        rows,
        await loadRowsForSource({
          sourceId: lane,
          market: input.market,
          activeOnly: input.activeOnly,
          force: input.force,
          limit: remaining,
          excludeListingKeys: input.excludeListingKeys,
        }),
        seen,
        input.limit,
      );
    }
  }

  return rows.slice(0, input.limit);
}

async function loadBroadRows(input: {
  market: UniverseMarket;
  activeOnly: boolean;
  force: boolean;
  lastProcessedListingKey: string | null;
  limit: number;
}): Promise<HydrationRow[]> {
  const filters = listingHydrationFilters(input);
  if (input.lastProcessedListingKey) {
    filters.push(
      gt(
        universeCatalogListingsTable.listingKey,
        input.lastProcessedListingKey,
      ),
    );
  }

  const rows = await db
    .select({
      listingKey: universeCatalogListingsTable.listingKey,
      symbol: universeCatalogListingsTable.normalizedTicker,
    })
    .from(universeCatalogListingsTable)
    .innerJoin(
      universeSourceMembershipsTable,
      eq(
        universeSourceMembershipsTable.listingKey,
        universeCatalogListingsTable.listingKey,
      ),
    )
    .where(
      and(
        ...filters,
        eq(universeSourceMembershipsTable.active, true),
        inArray(universeSourceMembershipsTable.sourceId, [...BROAD_SOURCE_IDS]),
      ),
    )
    .groupBy(
      universeCatalogListingsTable.listingKey,
      universeCatalogListingsTable.normalizedTicker,
    )
    .orderBy(asc(universeCatalogListingsTable.listingKey))
    .limit(input.limit);

  return rows.map((row) => ({
    listingKey: row.listingKey,
    symbol: normalizeUniversePrioritySymbol(row.symbol),
    source: "broad",
  }));
}

async function hydrateAndCheckpointRow<Result, Checkpoint>(input: {
  row: HydrationRow;
  phase: HydrationPhase;
  progress: HydrationProgress;
  hydrate: () => Promise<Result>;
  checkpoint: (
    progress: HydrationProgress,
    result: Result,
  ) => Promise<Checkpoint>;
}): Promise<{
  progress: HydrationProgress;
  result: Result;
  checkpoint: Checkpoint;
}> {
  const result = await input.hydrate();
  const progress = {
    processedThisMarket: input.progress.processedThisMarket + 1,
    phaseProcessedRows: input.progress.phaseProcessedRows + 1,
    totalProcessedRows: input.progress.totalProcessedRows + 1,
    lastProcessedListingKey:
      input.phase === "broad"
        ? input.row.listingKey
        : input.progress.lastProcessedListingKey,
  };
  const checkpoint = await input.checkpoint(progress, result);
  return { progress, result, checkpoint };
}

async function main() {
  const {
    execute,
    activeOnly,
    resume,
    reset,
    force,
    mode,
    priorityLanes,
    explicitSymbols,
    batchSize,
    maxRowsPerMarket,
    markets,
  } = parseHydrationArgs();
  const dryRun = !execute;
  const watchlistSymbols = priorityLanes.includes("watchlists")
    ? await loadWatchlistUniversePrioritySymbols()
    : [];
  const summaries: Array<{
    market: UniverseMarket;
    phase: HydrationPhase;
    selected: number;
    processed: number;
    scopeKey: string;
    complete: boolean;
    limitReached: boolean;
    sample: HydrationRow[];
  }> = [];

  for (const market of markets) {
    let processedThisMarket = 0;
    const phases: HydrationPhase[] =
      mode === "priority"
        ? ["priority"]
        : mode === "broad"
          ? ["broad"]
          : ["priority", "broad"];

    for (const phase of phases) {
      if (processedThisMarket >= maxRowsPerMarket) break;
      const scopeKey = buildScopeKey(market, activeOnly, phase);
      const existingState =
        !reset && resume ? await readSyncState(scopeKey) : null;
      if (phase === "broad" && resume && !reset && existingState?.finishedAt) {
        console.log(
          `${market}: broad IBKR hydration already complete, skipping (use --reset=true)`,
        );
        continue;
      }

      let lastProcessedListingKey =
        phase === "broad" && !reset
          ? (existingState?.lastProcessedListingKey ?? null)
          : null;
      let totalProcessedRows = reset ? 0 : (existingState?.rowsSynced ?? 0);
      const startedAt =
        reset || !existingState?.startedAt
          ? new Date()
          : new Date(existingState.startedAt);
      let lastSuccessAt = existingState?.lastSuccessAt
        ? new Date(existingState.lastSuccessAt)
        : null;
      let phaseSelectedRows = 0;
      let phaseProcessedRows = 0;
      let phaseComplete = false;
      let phaseLimitReached = false;
      const phaseSample: HydrationRow[] = [];
      // ponytail: priority ordering has no stable cursor, so it keeps the
      // current catalog's attempted keys in one array parameter. If this lane
      // grows beyond the current US-catalog scale, move the set to run-scoped
      // database state. Broad mode already uses its durable listing-key cursor.
      const attemptedListingKeys = new Set<string>();

      console.log(
        `hydrating ${market} catalog rows with IBKR mappings (${phase}) from ${
          lastProcessedListingKey
            ? safeOutput(lastProcessedListingKey, "-")
            : "start"
        }...`,
      );

      if (!dryRun) {
        await writeSyncState({
          scopeKey,
          market,
          activeOnly,
          lastProcessedListingKey,
          rowsSynced: totalProcessedRows,
          startedAt,
          finishedAt: null,
          lastSuccessAt,
          lastError: null,
          metadata: {
            batchSize,
            maxRowsPerMarket,
            force,
            dryRun,
            mode,
            phase,
            priorityLanes,
            explicitSymbolCount: explicitSymbols.length,
            watchlistSymbolCount: watchlistSymbols.length,
          },
        });
      }

      try {
        while (processedThisMarket < maxRowsPerMarket) {
          const remaining = Math.min(
            batchSize,
            maxRowsPerMarket - processedThisMarket,
          );
          const rows =
            phase === "priority"
              ? await loadPriorityRows({
                  market,
                  activeOnly,
                  force,
                  priorityLanes,
                  explicitSymbols,
                  watchlistSymbols,
                  limit: remaining,
                  excludeListingKeys: [...attemptedListingKeys],
                })
              : await loadBroadRows({
                  market,
                  activeOnly,
                  force,
                  lastProcessedListingKey,
                  limit: remaining,
                });

          if (!rows.length) {
            phaseComplete = true;
            break;
          }

          phaseSelectedRows += rows.length;
          phaseSample.push(
            ...rows
              .slice(0, Math.max(0, 20 - phaseSample.length))
              .map(safeHydrationRowForOutput),
          );

          for (const row of rows) {
            const outputRow = safeHydrationRowForOutput(row);
            if (dryRun) {
              processedThisMarket += 1;
              phaseProcessedRows += 1;
              totalProcessedRows += 1;
              if (phase === "priority") {
                attemptedListingKeys.add(row.listingKey);
              }
              if (phase === "broad") {
                lastProcessedListingKey = row.listingKey;
              }
              console.log(
                `${market}: dry-run ${processedThisMarket} selected (${outputRow.listingKey} ${outputRow.symbol} via ${outputRow.source})`,
              );
            } else {
              const completed = await hydrateAndCheckpointRow({
                row,
                phase,
                progress: {
                  processedThisMarket,
                  phaseProcessedRows,
                  totalProcessedRows,
                  lastProcessedListingKey,
                },
                hydrate: () =>
                  hydrateUniverseCatalogListingWithIbkr({
                    listingKey: row.listingKey,
                    force,
                  }),
                checkpoint: async (progress, result) => {
                  const checkpointAt = new Date();
                  await writeSyncState({
                    scopeKey,
                    market,
                    activeOnly,
                    lastProcessedListingKey: progress.lastProcessedListingKey,
                    rowsSynced: progress.totalProcessedRows,
                    startedAt,
                    finishedAt: null,
                    lastSuccessAt: checkpointAt,
                    lastError: null,
                    metadata: {
                      batchSize,
                      maxRowsPerMarket,
                      force,
                      dryRun,
                      mode,
                      phase,
                      priorityLanes,
                      explicitSymbolCount: explicitSymbols.length,
                      watchlistSymbolCount: watchlistSymbols.length,
                      lastStatus: result.status,
                      lastProviderContractId: result.providerContractId,
                      lastSource: row.source,
                    },
                  });
                  return checkpointAt;
                },
              });
              ({
                processedThisMarket,
                phaseProcessedRows,
                totalProcessedRows,
                lastProcessedListingKey,
              } = completed.progress);
              lastSuccessAt = completed.checkpoint;
              if (phase === "priority") {
                attemptedListingKeys.add(row.listingKey);
              }
              console.log(
                `${market}: ${processedThisMarket} hydrated (${outputRow.listingKey} ${outputRow.symbol} via ${outputRow.source} -> ${completed.result.status}${
                  completed.result.providerContractId
                    ? ` ${safeOutput(completed.result.providerContractId, "-")}`
                    : ""
                })`,
              );
            }

            if (processedThisMarket >= maxRowsPerMarket) {
              phaseLimitReached = true;
              break;
            }
          }
        }

        phaseLimitReached =
          phaseLimitReached || processedThisMarket >= maxRowsPerMarket;
        if (!dryRun) {
          const completedAt = new Date();
          await writeSyncState({
            scopeKey,
            market,
            activeOnly,
            lastProcessedListingKey,
            rowsSynced: totalProcessedRows,
            startedAt,
            finishedAt:
              phaseComplete && !phaseLimitReached ? completedAt : null,
            lastSuccessAt: completedAt,
            lastError: null,
            metadata: {
              batchSize,
              maxRowsPerMarket,
              force,
              dryRun,
              mode,
              phase,
              priorityLanes,
              explicitSymbolCount: explicitSymbols.length,
              watchlistSymbolCount: watchlistSymbols.length,
              processedThisRun: phaseProcessedRows,
              selectedThisRun: phaseSelectedRows,
              complete: phaseComplete && !phaseLimitReached,
              limitReached: phaseLimitReached,
            },
          });
          lastSuccessAt = completedAt;
        }
        console.log(
          phaseLimitReached
            ? `${market}: ${phase} IBKR hydration paused at per-run limit (${phaseProcessedRows} rows processed this phase)`
            : `${market}: ${phase} IBKR hydration ${phaseComplete ? "complete" : "paused"} (${phaseProcessedRows} rows processed this phase)`,
        );
        summaries.push({
          market,
          phase,
          selected: phaseSelectedRows,
          processed: phaseProcessedRows,
          scopeKey,
          complete: phaseComplete && !phaseLimitReached,
          limitReached: phaseLimitReached,
          sample: phaseSample,
        });
      } catch (error) {
        const message = safeDiagnostic(error);
        if (!dryRun) {
          try {
            await writeSyncState({
              scopeKey,
              market,
              activeOnly,
              lastProcessedListingKey,
              rowsSynced: totalProcessedRows,
              startedAt,
              finishedAt: null,
              lastSuccessAt,
              lastError: message,
              metadata: {
                batchSize,
                maxRowsPerMarket,
                force,
                dryRun,
                mode,
                phase,
                failed: true,
              },
            });
          } catch (checkpointError) {
            console.error(
              `Failed to record hydration failure: ${safeDiagnostic(checkpointError)}`,
            );
          }
        }
        throw error;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        mode,
        markets,
        maxRowsPerMarket,
        batchSize,
        force,
        priorityLanes,
        explicitSymbolCount: explicitSymbols.length,
        watchlistSymbolCount: watchlistSymbols.length,
        summaries,
      },
      null,
      2,
    ),
  );
}

export const __hydrateUniverseCatalogIbkrInternalsForTests = {
  hydrateAndCheckpointRow,
  listingHydrationFilters,
  parseHydrationArgs,
  prioritySymbolFilter,
  safeDiagnostic,
};

async function runCli(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(safeDiagnostic(error));
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch (error) {
      console.error(`Failed to close database pool: ${safeDiagnostic(error)}`);
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCli();
}

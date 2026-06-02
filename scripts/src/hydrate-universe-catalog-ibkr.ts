import { and, asc, eq, gt, inArray, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
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
  parseUniversePrioritySymbolList,
  uniqueUniversePrioritySymbols,
} from "./universe-priority";

const DEFAULT_MARKETS: UniverseMarket[] = ["stocks", "etf", "otc"];
const DEFAULT_PRIORITY_LANES = [
  "symbols",
  "watchlists",
  "sp500",
  "nasdaq_listed",
  "other_listed",
] as const;
const SOURCE_PRIORITY_LANES = new Set([
  "sp500",
  "nasdaq_listed",
  "other_listed",
]);
const BROAD_SOURCE_IDS = ["sp500", "nasdaq_listed", "other_listed"] as const;

type HydrationMode = "priority" | "broad" | "priority-then-broad";
type PriorityLane = (typeof DEFAULT_PRIORITY_LANES)[number];
type HydrationPhase = "priority" | "broad";
type HydrationRow = {
  listingKey: string;
  symbol: string;
  source: string;
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

function parseArg(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseBooleanArg(name: string, defaultValue: boolean) {
  const raw = parseArg(name);
  if (raw === null) return defaultValue;
  return raw !== "false";
}

function parseMarkets(): UniverseMarket[] {
  const raw = parseArg("markets");
  if (!raw) return DEFAULT_MARKETS;

  const requested = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as UniverseMarket[];
  return requested.length ? requested : DEFAULT_MARKETS;
}

function parseMode(): HydrationMode {
  const raw = (parseArg("mode") ?? "priority-then-broad").trim();
  if (raw === "priority" || raw === "broad" || raw === "priority-then-broad") {
    return raw;
  }
  throw new Error(
    `Invalid --mode=${raw}; expected priority, broad, or priority-then-broad.`,
  );
}

function parsePriorityLanes(): PriorityLane[] {
  const raw = parseArg("priority") ?? parseArg("priority-lanes");
  if (!raw) return [...DEFAULT_PRIORITY_LANES];
  const lanes = raw
    .split(",")
    .map((lane) => lane.trim())
    .filter(Boolean);
  const invalid = lanes.filter(
    (lane) => !DEFAULT_PRIORITY_LANES.includes(lane as PriorityLane),
  );
  if (invalid.length) {
    throw new Error(`Invalid priority lanes: ${invalid.join(", ")}`);
  }
  return lanes.length ? (lanes as PriorityLane[]) : [...DEFAULT_PRIORITY_LANES];
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
  if (input.excludeListingKeys?.length) {
    filters.push(
      notInArray(universeCatalogListingsTable.listingKey, [
        ...input.excludeListingKeys,
      ]),
    );
  }
  return filters;
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
    inArray(universeCatalogListingsTable.normalizedTicker, symbols),
  ];
  if (input.activeOnly) {
    filters.push(eq(universeCatalogListingsTable.active, true));
  }
  if (input.excludeListingKeys?.length) {
    filters.push(
      notInArray(universeCatalogListingsTable.listingKey, [
        ...input.excludeListingKeys,
      ]),
    );
  }
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
  const exchange = normalizeUniversePrioritySymbol(
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
  excludeListingKeys?: readonly string[];
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
        inArray(universeSourceMembershipsTable.sourceId, [
          ...BROAD_SOURCE_IDS,
        ]),
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

async function main() {
  const activeOnly = parseBooleanArg("active", true);
  const resume = parseBooleanArg("resume", true);
  const reset = parseBooleanArg("reset", false);
  const force = parseBooleanArg("force", false);
  const dryRun = parseBooleanArg("dry-run", false);
  const mode = parseMode();
  const priorityLanes = parsePriorityLanes();
  const explicitSymbols = parseUniversePrioritySymbolList(parseArg("symbols"));
  const batchSize = Math.max(
    1,
    Math.min(Number(parseArg("batch") ?? "50"), 250),
  );
  const maxRowsPerMarket = Math.max(1, Number(parseArg("limit") ?? "1000000"));
  const markets = parseMarkets();
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
      let phaseSelectedRows = 0;
      let phaseProcessedRows = 0;
      let phaseComplete = false;
      let phaseLimitReached = false;
      const phaseSample: HydrationRow[] = [];
      const attemptedListingKeys = new Set<string>();

      console.log(
        `hydrating ${market} catalog rows with IBKR mappings (${phase}) from ${
          lastProcessedListingKey ? lastProcessedListingKey : "start"
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
          lastSuccessAt: existingState?.lastSuccessAt
            ? new Date(existingState.lastSuccessAt)
            : null,
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
                  excludeListingKeys: [...attemptedListingKeys],
                });

          if (!rows.length) {
            phaseComplete = true;
            break;
          }

          phaseSelectedRows += rows.length;
          phaseSample.push(
            ...rows.slice(0, Math.max(0, 20 - phaseSample.length)),
          );

          for (const row of rows) {
            processedThisMarket += 1;
            phaseProcessedRows += 1;
            totalProcessedRows += 1;
            attemptedListingKeys.add(row.listingKey);
            if (phase === "broad") {
              lastProcessedListingKey = row.listingKey;
            }

            if (dryRun) {
              console.log(
                `${market}: dry-run ${processedThisMarket} selected (${row.listingKey} ${row.symbol} via ${row.source})`,
              );
            } else {
              const result = await hydrateUniverseCatalogListingWithIbkr({
                listingKey: row.listingKey,
                force,
              });
              await writeSyncState({
                scopeKey,
                market,
                activeOnly,
                lastProcessedListingKey,
                rowsSynced: totalProcessedRows,
                startedAt,
                finishedAt: null,
                lastSuccessAt: new Date(),
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
              console.log(
                `${market}: ${processedThisMarket} hydrated (${row.listingKey} ${row.symbol} via ${row.source} -> ${result.status}${
                  result.providerContractId
                    ? ` ${result.providerContractId}`
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
          await writeSyncState({
            scopeKey,
            market,
            activeOnly,
            lastProcessedListingKey,
            rowsSynced: totalProcessedRows,
            startedAt,
            finishedAt: phaseComplete && !phaseLimitReached ? new Date() : null,
            lastSuccessAt: new Date(),
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
        const message = error instanceof Error ? error.message : String(error);
        if (!dryRun) {
          await writeSyncState({
            scopeKey,
            market,
            activeOnly,
            lastProcessedListingKey,
            rowsSynced: totalProcessedRows,
            startedAt,
            finishedAt: null,
            lastSuccessAt: existingState?.lastSuccessAt
              ? new Date(existingState.lastSuccessAt)
              : null,
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

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

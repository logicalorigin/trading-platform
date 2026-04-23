import { and, asc, eq, gt, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  universeCatalogListingsTable,
  universeCatalogSyncStatesTable,
} from "@workspace/db/schema";
import { type UniverseMarket } from "../../artifacts/api-server/src/providers/polygon/market-data";
import { hydrateUniverseCatalogListingWithIbkr } from "../../artifacts/api-server/src/services/platform";

const DEFAULT_MARKETS: UniverseMarket[] = ["stocks", "etf", "otc"];

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

function buildScopeKey(market: UniverseMarket, activeOnly: boolean) {
  return `ibkr-hydration:${market}:${activeOnly ? "active" : "all"}`;
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

async function main() {
  const activeOnly = parseBooleanArg("active", true);
  const resume = parseBooleanArg("resume", true);
  const reset = parseBooleanArg("reset", false);
  const force = parseBooleanArg("force", false);
  const batchSize = Math.max(1, Math.min(Number(parseArg("batch") ?? "50"), 250));
  const maxRows = Math.max(1, Number(parseArg("limit") ?? "1000000"));
  const markets = parseMarkets();

  for (const market of markets) {
    const scopeKey = buildScopeKey(market, activeOnly);
    const existingState = !reset && resume ? await readSyncState(scopeKey) : null;
    if (resume && !reset && existingState?.finishedAt) {
      console.log(`${market}: IBKR hydration already complete, skipping (use --reset=true)`);
      continue;
    }

    let lastProcessedListingKey = reset
      ? null
      : existingState?.lastProcessedListingKey ?? null;
    let processedRows = reset ? 0 : existingState?.rowsSynced ?? 0;
    const startedAt =
      reset || !existingState?.startedAt ? new Date() : new Date(existingState.startedAt);

    console.log(
      `hydrating ${market} catalog rows with IBKR mappings from ${
        lastProcessedListingKey ? lastProcessedListingKey : "start"
      }...`,
    );

    await writeSyncState({
      scopeKey,
      market,
      activeOnly,
      lastProcessedListingKey,
      rowsSynced: processedRows,
      startedAt,
      finishedAt: null,
      lastSuccessAt: existingState?.lastSuccessAt ? new Date(existingState.lastSuccessAt) : null,
      lastError: null,
      metadata: {
        batchSize,
        maxRows,
        force,
      },
    });

    try {
      while (processedRows < maxRows) {
        const filters = [eq(universeCatalogListingsTable.market, market)];
        if (activeOnly) {
          filters.push(eq(universeCatalogListingsTable.active, true));
        }
        if (!force) {
          filters.push(ne(universeCatalogListingsTable.ibkrHydrationStatus, "hydrated"));
        }
        if (lastProcessedListingKey) {
          filters.push(gt(universeCatalogListingsTable.listingKey, lastProcessedListingKey));
        }

        const rows = await db
          .select({
            listingKey: universeCatalogListingsTable.listingKey,
          })
          .from(universeCatalogListingsTable)
          .where(and(...filters))
          .orderBy(asc(universeCatalogListingsTable.listingKey))
          .limit(Math.min(batchSize, maxRows - processedRows));

        if (!rows.length) {
          break;
        }

        for (const row of rows) {
          const result = await hydrateUniverseCatalogListingWithIbkr({
            listingKey: row.listingKey,
            force,
          });
          processedRows += 1;
          lastProcessedListingKey = row.listingKey;
          await writeSyncState({
            scopeKey,
            market,
            activeOnly,
            lastProcessedListingKey,
            rowsSynced: processedRows,
            startedAt,
            finishedAt: null,
            lastSuccessAt: new Date(),
            lastError: null,
            metadata: {
              batchSize,
              maxRows,
              force,
              lastStatus: result.status,
              lastProviderContractId: result.providerContractId,
            },
          });
          console.log(
            `${market}: ${processedRows} hydrated (${row.listingKey} -> ${result.status}${
              result.providerContractId ? ` ${result.providerContractId}` : ""
            })`,
          );
          if (processedRows >= maxRows) {
            break;
          }
        }
      }

      await writeSyncState({
        scopeKey,
        market,
        activeOnly,
        lastProcessedListingKey,
        rowsSynced: processedRows,
        startedAt,
        finishedAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        metadata: {
          batchSize,
          maxRows,
          force,
          complete: true,
        },
      });
      console.log(`${market}: IBKR hydration complete (${processedRows} rows processed)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeSyncState({
        scopeKey,
        market,
        activeOnly,
        lastProcessedListingKey,
        rowsSynced: processedRows,
        startedAt,
        finishedAt: null,
        lastSuccessAt: existingState?.lastSuccessAt ? new Date(existingState.lastSuccessAt) : null,
        lastError: message,
        metadata: {
          batchSize,
          maxRows,
          force,
          failed: true,
        },
      });
      throw error;
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

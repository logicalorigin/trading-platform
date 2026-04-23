import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { universeCatalogSyncStatesTable } from "@workspace/db/schema";
import { getPolygonRuntimeConfig } from "../../artifacts/api-server/src/lib/runtime";
import {
  PolygonMarketDataClient,
  type UniverseMarket,
  type UniverseTicker,
} from "../../artifacts/api-server/src/providers/polygon/market-data";
import { upsertUniverseCatalogRows } from "../../artifacts/api-server/src/services/platform";

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

function buildListingKey(ticker: UniverseTicker) {
  return [ticker.ticker, ticker.market, ticker.normalizedExchangeMic ?? ""].join("|");
}

function buildScopeKey(market: UniverseMarket, activeOnly: boolean) {
  return `catalog:${market}:${activeOnly ? "active" : "all"}`;
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
  cursor: string | null;
  lastProcessedListingKey: string | null;
  pagesSynced: number;
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
      phase: "catalog",
      market: input.market,
      activeOnly: input.activeOnly,
      cursor: input.cursor,
      lastProcessedListingKey: input.lastProcessedListingKey,
      pagesSynced: input.pagesSynced,
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
        phase: "catalog",
        market: input.market,
        activeOnly: input.activeOnly,
        cursor: input.cursor,
        lastProcessedListingKey: input.lastProcessedListingKey,
        pagesSynced: input.pagesSynced,
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
  const config = getPolygonRuntimeConfig();
  if (!config) {
    throw new Error("Polygon runtime configuration is required to sync the universe catalog.");
  }

  const pageLimit = Math.max(1, Math.min(Number(parseArg("limit") ?? "1000"), 1000));
  const maxPages = Math.max(1, Number(parseArg("max-pages") ?? "1000000"));
  const activeOnly = parseBooleanArg("active", true);
  const resume = parseBooleanArg("resume", true);
  const reset = parseBooleanArg("reset", false);
  const markets = parseMarkets();
  const client = new PolygonMarketDataClient(config);

  for (const market of markets) {
    const scopeKey = buildScopeKey(market, activeOnly);
    const existingState = !reset && resume ? await readSyncState(scopeKey) : null;
    if (resume && !reset && existingState?.finishedAt && !existingState.cursor) {
      console.log(`${market}: already complete, skipping (use --reset=true to rerun)`);
      continue;
    }

    let cursorUrl = existingState?.cursor ?? null;
    let pageCount = reset ? 0 : existingState?.pagesSynced ?? 0;
    let rowCount = reset ? 0 : existingState?.rowsSynced ?? 0;
    let lastProcessedListingKey = reset
      ? null
      : existingState?.lastProcessedListingKey ?? null;
    const startedAt =
      reset || !existingState?.startedAt ? new Date() : new Date(existingState.startedAt);

    console.log(
      `syncing ${market} (${activeOnly ? "active only" : "all listings"}) from ${
        cursorUrl ? "saved cursor" : "start"
      }...`,
    );

    await writeSyncState({
      scopeKey,
      market,
      activeOnly,
      cursor: cursorUrl,
      lastProcessedListingKey,
      pagesSynced: pageCount,
      rowsSynced: rowCount,
      startedAt,
      finishedAt: null,
      lastSuccessAt: existingState?.lastSuccessAt ? new Date(existingState.lastSuccessAt) : null,
      lastError: null,
      metadata: {
        pageLimit,
        maxPages,
        resumed: Boolean(existingState && !reset),
      },
    });

    try {
      let processedPagesThisRun = 0;
      do {
        const page = await client.listUniverseTickersPage({
          market,
          active: activeOnly,
          limit: pageLimit,
          cursorUrl,
        });
        if (!page.results.length) {
          cursorUrl = null;
          break;
        }

        await upsertUniverseCatalogRows(page.results);
        rowCount += page.results.length;
        pageCount += 1;
        processedPagesThisRun += 1;
        cursorUrl = page.nextUrl;
        lastProcessedListingKey = buildListingKey(page.results.at(-1) as UniverseTicker);
        const syncedAt = new Date();
        await writeSyncState({
          scopeKey,
          market,
          activeOnly,
          cursor: cursorUrl,
          lastProcessedListingKey,
          pagesSynced: pageCount,
          rowsSynced: rowCount,
          startedAt,
          finishedAt: null,
          lastSuccessAt: syncedAt,
          lastError: null,
          metadata: {
            pageLimit,
            processedPagesThisRun,
            lastPageCount: page.results.length,
            nextCursorPresent: Boolean(cursorUrl),
          },
        });
        console.log(
          `${market}: page ${pageCount} synced (${page.results.length} rows, total ${rowCount})`,
        );
      } while (cursorUrl && processedPagesThisRun < maxPages);

      const finishedAt = cursorUrl ? null : new Date();
      await writeSyncState({
        scopeKey,
        market,
        activeOnly,
        cursor: cursorUrl,
        lastProcessedListingKey,
        pagesSynced: pageCount,
        rowsSynced: rowCount,
        startedAt,
        finishedAt,
        lastSuccessAt: new Date(),
        lastError: null,
        metadata: {
          pageLimit,
          maxPages,
          complete: !cursorUrl,
        },
      });
      console.log(
        `${market}: ${cursorUrl ? "paused" : "complete"} (${rowCount} rows across ${pageCount} pages)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeSyncState({
        scopeKey,
        market,
        activeOnly,
        cursor: cursorUrl,
        lastProcessedListingKey,
        pagesSynced: pageCount,
        rowsSynced: rowCount,
        startedAt,
        finishedAt: null,
        lastSuccessAt: existingState?.lastSuccessAt ? new Date(existingState.lastSuccessAt) : null,
        lastError: message,
        metadata: {
          pageLimit,
          maxPages,
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

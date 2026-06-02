import { inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  universeCatalogListingsTable,
  universeSourceMembershipsTable,
} from "@workspace/db/schema";
import {
  DEFAULT_SP500_CONSTITUENTS_URL,
  fetchSp500ConstituentsCsv,
  parseSp500ConstituentsCsv,
  sp500ConstituentToUniverseTicker,
  type Sp500ConstituentRecord,
} from "../../artifacts/api-server/src/services/sp500-constituents";
import type {
  UniverseMarket,
  UniverseTicker,
} from "../../artifacts/api-server/src/providers/massive/market-data";

type CliOptions = {
  url: string;
  minCount: number;
  maxCount: number;
  limit: number | null;
  dryRun: boolean;
};

const SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE = 1_000;

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseBooleanArg(name: string, fallback: boolean): boolean {
  const raw = parseArg(name);
  if (raw === null) return fallback;
  return raw !== "false";
}

function parsePositiveIntegerArg(name: string, fallback: number): number {
  const raw = parseArg(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseLimitArg(): number | null {
  const raw = parseArg("limit");
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function parseOptions(): CliOptions {
  return {
    url:
      parseArg("url") ??
      process.env["SP500_CONSTITUENTS_URL"] ??
      DEFAULT_SP500_CONSTITUENTS_URL,
    minCount: parsePositiveIntegerArg("min-count", 490),
    maxCount: parsePositiveIntegerArg("max-count", 520),
    limit: parseLimitArg(),
    dryRun: parseBooleanArg("dry-run", false),
  };
}

function fallbackListingKeyForTicker(ticker: UniverseTicker): string {
  return [
    ticker.ticker,
    ticker.market,
    ticker.normalizedExchangeMic ?? "",
  ].join("|");
}

async function readExistingListingKeys(symbols: readonly string[]) {
  const result = new Map<string, string>();
  const uniqueSymbols = [...new Set(symbols)].filter(Boolean);
  for (let index = 0; index < uniqueSymbols.length; index += 500) {
    const chunk = uniqueSymbols.slice(index, index + 500);
    const rows = await db
      .select({
        normalizedTicker: universeCatalogListingsTable.normalizedTicker,
        listingKey: universeCatalogListingsTable.listingKey,
      })
      .from(universeCatalogListingsTable)
      .where(inArray(universeCatalogListingsTable.normalizedTicker, chunk));
    for (const row of rows) {
      if (!result.has(row.normalizedTicker)) {
        result.set(row.normalizedTicker, row.listingKey);
      }
    }
  }
  return result;
}

async function upsertSp500Memberships(
  records: readonly Sp500ConstituentRecord[],
  listingKeysBySymbol: ReadonlyMap<string, string>,
) {
  if (!records.length) return;
  const now = new Date();
  for (
    let index = 0;
    index < records.length;
    index += SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE
  ) {
    const chunk = records.slice(
      index,
      index + SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE,
    );
    await db
      .insert(universeSourceMembershipsTable)
      .values(
        chunk.map((record) => ({
          sourceId: "sp500",
          sourceSymbol: record.rawSymbol,
          normalizedTicker: record.symbol,
          listingKey: listingKeysBySymbol.get(record.symbol) ?? null,
          market: "stocks" as UniverseMarket,
          active: true,
          lastSeenAt: now,
          lastMissingAt: null,
          metadata: {
            security: record.security,
            gicsSector: record.gicsSector,
            gicsSubIndustry: record.gicsSubIndustry,
            headquartersLocation: record.headquartersLocation,
            dateAdded: record.dateAdded,
            cik: record.cik,
            founded: record.founded,
          },
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          universeSourceMembershipsTable.sourceId,
          universeSourceMembershipsTable.sourceSymbol,
        ],
        set: {
          normalizedTicker: sql`excluded.normalized_ticker`,
          listingKey: sql`excluded.listing_key`,
          market: sql`excluded.market`,
          active: true,
          lastSeenAt: now,
          lastMissingAt: null,
          metadata: sql`coalesce(${universeSourceMembershipsTable.metadata}, '{}'::jsonb) || excluded.metadata`,
          updatedAt: now,
        },
      });
  }
}

async function main() {
  const options = parseOptions();
  const csv = await fetchSp500ConstituentsCsv(options.url);
  const parsed = parseSp500ConstituentsCsv(csv);
  const records = parsed.records.slice(
    0,
    options.limit ?? parsed.records.length,
  );

  if (
    options.limit === null &&
    (records.length < options.minCount || records.length > options.maxCount)
  ) {
    throw new Error(
      `S&P 500 constituents count ${records.length} outside expected range ${options.minCount}-${options.maxCount}.`,
    );
  }

  let existingListingKeys = new Map<string, string>();
  let missingTickers: UniverseTicker[] = records.map(
    sp500ConstituentToUniverseTicker,
  );
  if (!options.dryRun) {
    const { upsertUniverseCatalogRows } = await import(
      "../../artifacts/api-server/src/services/platform"
    );
    existingListingKeys = await readExistingListingKeys(
      records.map((record) => record.symbol),
    );
    missingTickers = records
      .filter((record) => !existingListingKeys.has(record.symbol))
      .map(sp500ConstituentToUniverseTicker);
    if (missingTickers.length) {
      await upsertUniverseCatalogRows(missingTickers);
      existingListingKeys = await readExistingListingKeys(
        records.map((record) => record.symbol),
      );
    }
    const resolvedListingKeys = new Map(existingListingKeys);
    for (const ticker of missingTickers) {
      if (!resolvedListingKeys.has(ticker.ticker)) {
        resolvedListingKeys.set(
          ticker.ticker,
          fallbackListingKeyForTicker(ticker),
        );
      }
    }
    await upsertSp500Memberships(records, resolvedListingKeys);
  }

  console.log(
    JSON.stringify(
      {
        source: "sp500",
        url: options.url,
        dryRun: options.dryRun,
        parsedRecords: parsed.records.length,
        selectedRows: records.length,
        skippedRecords: parsed.skippedCount,
        existingCatalogMatches: existingListingKeys.size,
        fallbackCatalogRows: options.dryRun ? 0 : missingTickers.length,
        sampleSymbols: records.slice(0, 10).map((record) => record.symbol),
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

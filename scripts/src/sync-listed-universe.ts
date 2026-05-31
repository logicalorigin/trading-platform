import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { universeSourceMembershipsTable } from "@workspace/db/schema";
import {
  fetchNasdaqListedDirectory,
  fetchOtherListedDirectory,
  nasdaqListedRecordToUniverseTicker,
  otherListedRecordToUniverseTicker,
  parseNasdaqListedDirectory,
  parseOtherListedDirectory,
} from "../../artifacts/api-server/src/services/nasdaq-symbol-directory";
import type {
  UniverseMarket,
  UniverseTicker,
} from "../../artifacts/api-server/src/providers/polygon/market-data";

type CliOptions = {
  nasdaqUrl?: string;
  otherUrl?: string;
  includeEtfs: boolean;
  includeTestIssues: boolean;
  includeNonCommonStock: boolean;
  normalFinancialStatusOnly: boolean;
  sources: Set<"nasdaq" | "other">;
  limit: number | null;
  dryRun: boolean;
};

type SourceRow = {
  sourceId: "nasdaq_listed" | "other_listed";
  sourceSymbol: string;
  ticker: UniverseTicker;
  metadata: Record<string, unknown>;
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

function parsePositiveIntegerArg(
  name: string,
  fallback: number | null,
): number | null {
  const raw = parseArg(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseSources(): Set<"nasdaq" | "other"> {
  const raw = parseArg("sources");
  if (!raw) return new Set(["nasdaq", "other"]);
  const values = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(
      (value): value is "nasdaq" | "other" =>
        value === "nasdaq" || value === "other",
    );
  return values.length ? new Set(values) : new Set(["nasdaq", "other"]);
}

function parseOptions(): CliOptions {
  return {
    nasdaqUrl: parseArg("nasdaq-url") ?? undefined,
    otherUrl: parseArg("other-url") ?? undefined,
    includeEtfs: parseBooleanArg("include-etfs", true),
    includeTestIssues: parseBooleanArg("include-test-issues", false),
    includeNonCommonStock: parseBooleanArg("include-non-common-stock", false),
    normalFinancialStatusOnly: parseBooleanArg(
      "normal-financial-status-only",
      true,
    ),
    sources: parseSources(),
    limit: parsePositiveIntegerArg("limit", null),
    dryRun: parseBooleanArg("dry-run", false),
  };
}

function listingKeyForTicker(ticker: UniverseTicker): string {
  return [
    ticker.ticker,
    ticker.market,
    ticker.normalizedExchangeMic ?? "",
  ].join("|");
}

async function upsertSourceMemberships(rows: readonly SourceRow[]) {
  if (!rows.length) return;
  const now = new Date();
  for (
    let index = 0;
    index < rows.length;
    index += SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE
  ) {
    const chunk = rows.slice(
      index,
      index + SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE,
    );
    await db
      .insert(universeSourceMembershipsTable)
      .values(
        chunk.map((row) => ({
          sourceId: row.sourceId,
          sourceSymbol: row.sourceSymbol,
          normalizedTicker: row.ticker.ticker,
          listingKey: listingKeyForTicker(row.ticker),
          market: row.ticker.market as UniverseMarket,
          active: true,
          lastSeenAt: now,
          lastMissingAt: null,
          metadata: row.metadata,
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

async function buildRows(options: CliOptions): Promise<{
  rows: SourceRow[];
  sourceSummaries: Record<string, unknown>;
}> {
  const sourceSummaries: Record<string, unknown> = {};
  const rows: SourceRow[] = [];

  if (options.sources.has("nasdaq")) {
    const text = await fetchNasdaqListedDirectory(options.nasdaqUrl);
    const parsed = parseNasdaqListedDirectory(text, {
      includeEtfs: options.includeEtfs,
      includeTestIssues: options.includeTestIssues,
      includeNonCommonStock: options.includeNonCommonStock,
      normalFinancialStatusOnly: options.normalFinancialStatusOnly,
    });
    const sourceRows = parsed.records
      .slice(0, options.limit ?? parsed.records.length)
      .map((record) => ({
        sourceId: "nasdaq_listed" as const,
        sourceSymbol: record.rawSymbol,
        ticker: nasdaqListedRecordToUniverseTicker(record),
        metadata: {
          fileCreationTime: parsed.fileCreationTime,
          marketCategory: record.marketCategory,
          financialStatus: record.financialStatus,
          roundLotSize: record.roundLotSize,
          etf: record.etf,
          nextShares: record.nextShares,
        },
      }));
    rows.push(...sourceRows);
    sourceSummaries.nasdaq = {
      fileCreationTime: parsed.fileCreationTime,
      parsedRecords: parsed.records.length,
      skippedRecords: parsed.skippedCount,
      selectedRows: sourceRows.length,
    };
  }

  if (options.sources.has("other")) {
    const text = await fetchOtherListedDirectory(options.otherUrl);
    const parsed = parseOtherListedDirectory(text, {
      includeEtfs: options.includeEtfs,
      includeTestIssues: options.includeTestIssues,
      includeNonCommonStock: options.includeNonCommonStock,
      normalFinancialStatusOnly: options.normalFinancialStatusOnly,
    });
    const sourceRows = parsed.records
      .slice(0, options.limit ?? parsed.records.length)
      .map((record) => ({
        sourceId: "other_listed" as const,
        sourceSymbol: record.rawSymbol,
        ticker: otherListedRecordToUniverseTicker(record),
        metadata: {
          fileCreationTime: parsed.fileCreationTime,
          exchangeCode: record.exchangeCode,
          cqsSymbol: record.cqsSymbol,
          roundLotSize: record.roundLotSize,
          etf: record.etf,
          nasdaqSymbol: record.nasdaqSymbol,
        },
      }));
    rows.push(...sourceRows);
    sourceSummaries.other = {
      fileCreationTime: parsed.fileCreationTime,
      parsedRecords: parsed.records.length,
      skippedRecords: parsed.skippedCount,
      selectedRows: sourceRows.length,
    };
  }

  return { rows, sourceSummaries };
}

async function main() {
  const options = parseOptions();
  const { rows, sourceSummaries } = await buildRows(options);

  if (!options.dryRun) {
    const { upsertUniverseCatalogRows } = await import(
      "../../artifacts/api-server/src/services/platform"
    );
    await upsertUniverseCatalogRows(rows.map((row) => row.ticker));
    await upsertSourceMemberships(rows);
  }

  console.log(
    JSON.stringify(
      {
        source: "listed_universe",
        dryRun: options.dryRun,
        includeEtfs: options.includeEtfs,
        includeTestIssues: options.includeTestIssues,
        includeNonCommonStock: options.includeNonCommonStock,
        rows: rows.length,
        upsertedRows: options.dryRun ? 0 : rows.length,
        sampleListingKeys: rows
          .slice(0, 10)
          .map((row) => listingKeyForTicker(row.ticker)),
        sourceSummaries,
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

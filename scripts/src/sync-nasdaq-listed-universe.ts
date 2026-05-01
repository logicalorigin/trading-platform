import {
  fetchNasdaqListedDirectory,
  nasdaqListedRecordToUniverseTicker,
  parseNasdaqListedDirectory,
} from "../../artifacts/api-server/src/services/nasdaq-symbol-directory";
import type { UniverseTicker } from "../../artifacts/api-server/src/providers/polygon/market-data";

type CliOptions = {
  url?: string;
  includeEtfs: boolean;
  includeTestIssues: boolean;
  includeNonCommonStock: boolean;
  normalFinancialStatusOnly: boolean;
  limit: number | null;
  dryRun: boolean;
  hydrateIbkr: boolean;
  hydrateLimit: number;
  hydrateForce: boolean;
};

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

function parsePositiveIntegerArg(name: string, fallback: number | null): number | null {
  const raw = parseArg(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseOptions(): CliOptions {
  return {
    url: parseArg("url") ?? undefined,
    includeEtfs: parseBooleanArg("include-etfs", false),
    includeTestIssues: parseBooleanArg("include-test-issues", false),
    includeNonCommonStock: parseBooleanArg("include-non-common-stock", false),
    normalFinancialStatusOnly: parseBooleanArg(
      "normal-financial-status-only",
      true,
    ),
    limit: parsePositiveIntegerArg("limit", null),
    dryRun: parseBooleanArg("dry-run", false),
    hydrateIbkr: parseBooleanArg("hydrate-ibkr", false),
    hydrateLimit: parsePositiveIntegerArg("hydrate-limit", 250) ?? 250,
    hydrateForce: parseBooleanArg("hydrate-force", false),
  };
}

function listingKeyForTicker(ticker: UniverseTicker): string {
  return [ticker.ticker, ticker.market, ticker.normalizedExchangeMic ?? ""].join("|");
}

async function main() {
  const options = parseOptions();
  const text = await fetchNasdaqListedDirectory(options.url);
  const parsed = parseNasdaqListedDirectory(text, {
    includeEtfs: options.includeEtfs,
    includeTestIssues: options.includeTestIssues,
    includeNonCommonStock: options.includeNonCommonStock,
    normalFinancialStatusOnly: options.normalFinancialStatusOnly,
  });
  const rows = parsed.records
    .map(nasdaqListedRecordToUniverseTicker)
    .slice(0, options.limit ?? parsed.records.length);
  const listingKeys = rows.map(listingKeyForTicker);

  const hydrationResults: Array<{ status: string }> = [];
  if (!options.dryRun) {
    const {
      hydrateUniverseCatalogListingWithIbkr,
      upsertUniverseCatalogRows,
    } = await import("../../artifacts/api-server/src/services/platform");
    await upsertUniverseCatalogRows(rows);

    if (options.hydrateIbkr) {
      for (const listingKey of listingKeys.slice(0, options.hydrateLimit)) {
        hydrationResults.push(
          await hydrateUniverseCatalogListingWithIbkr({
            listingKey,
            force: options.hydrateForce,
          }),
        );
      }
    }
  }

  const hydratedCount = hydrationResults.filter(
    (result) => result.status === "hydrated",
  ).length;

  console.log(
    JSON.stringify(
      {
        source: "nasdaqtrader",
        dryRun: options.dryRun,
        fileCreationTime: parsed.fileCreationTime,
        parsedRecords: parsed.records.length,
        skippedRecords: parsed.skippedCount,
        upsertedRows: options.dryRun ? 0 : rows.length,
        hydrateRequested: options.hydrateIbkr,
        hydrateAttempted: hydrationResults.length,
        hydratedCount,
        unresolvedCount: hydrationResults.length - hydratedCount,
        sampleListingKeys: listingKeys.slice(0, 10),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

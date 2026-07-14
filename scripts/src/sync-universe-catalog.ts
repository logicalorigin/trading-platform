import { pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { eq } from "drizzle-orm";
import {
  closeDatabaseConnections,
  db,
  sharedAdvisoryLockHolder,
} from "@workspace/db";
import { universeCatalogSyncStatesTable } from "@workspace/db/schema";
import { getMassiveRuntimeConfig } from "../../artifacts/api-server/src/lib/runtime";
import {
  MassiveMarketDataClient,
  type UniverseMarket,
  type UniverseTicker,
} from "../../artifacts/api-server/src/providers/massive/market-data";
import { upsertUniverseCatalogRows } from "../../artifacts/api-server/src/services/platform";

const DEFAULT_MARKETS: UniverseMarket[] = ["stocks", "etf", "otc"];
// Shares the listed-universe lock because both commands write the catalog.
const UNIVERSE_CATALOG_SYNC_ADVISORY_LOCK_KEY = 1_930_514_024;
const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_DIAGNOSTIC_LENGTH = 400;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const UNIVERSE_MARKETS: readonly UniverseMarket[] = [
  "stocks",
  "etf",
  "indices",
  "futures",
  "fx",
  "crypto",
  "otc",
];
const USAGE =
  "Usage: pnpm --filter @workspace/scripts run universe:sync -- [--execute] [--markets=stocks,etf,otc] [--active=true|false] [--resume=true|false] [--reset=true|false] [--limit=1..1000] [--max-pages=POSITIVE_INTEGER] [--help]";

type CliOptions = {
  execute: boolean;
  activeOnly: boolean;
  resume: boolean;
  reset: boolean;
  markets: UniverseMarket[];
  pageLimit: number;
  maxPages: number;
  help: boolean;
};

type SyncState = {
  cursor: string | null;
  lastProcessedListingKey: string | null;
  pagesSynced: number;
  rowsSynced: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastSuccessAt: Date | null;
};

type SyncStateWrite = {
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
};

type UniversePage = {
  count: number;
  results: UniverseTicker[];
  nextUrl: string | null;
};

type RunDependencies = {
  acquireLock: () => Promise<(() => Promise<void>) | null>;
  listPage: (input: {
    market: UniverseMarket;
    active: boolean;
    limit: number;
    cursorUrl: string | null;
    signal: AbortSignal;
  }) => Promise<UniversePage>;
  now: () => Date;
  readState: (scopeKey: string) => Promise<SyncState | null>;
  sanitizeCursor: (cursor: string | null) => string | null;
  upsertRows: (rows: UniverseTicker[]) => Promise<void>;
  writeState: (input: SyncStateWrite) => Promise<void>;
};

type SyncSummary = {
  market: UniverseMarket;
  complete: boolean;
  pages: number;
  rows: number;
  sampleListingKeys: string[];
};

function parseBooleanValue(
  name: string,
  raw: string | undefined,
  fallback: boolean,
) {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

function parsePositiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  maximum: number,
) {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`--${name} must be a canonical positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new Error(`--${name} is outside the supported range.`);
  }
  return value;
}

function parseOptions(args = process.argv.slice(2)): CliOptions {
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
        markets: { type: "string" },
        limit: { type: "string" },
        "max-pages": { type: "string" },
        help: { type: "boolean", short: "h" },
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

    const help = parsed.values.help ?? false;
    if (help && parsed.tokens.length !== 1) {
      throw new Error("--help cannot be combined with other options.");
    }
    const execute = parsed.values.execute ?? false;
    if (
      !execute &&
      (parsed.values.resume !== undefined || parsed.values.reset !== undefined)
    ) {
      throw new Error("--resume and --reset require --execute.");
    }
    const rawMarkets = parsed.values.markets;
    const markets =
      rawMarkets === undefined
        ? [...DEFAULT_MARKETS]
        : rawMarkets.split(",").map((market) => market.trim().toLowerCase());
    if (!markets.length || markets.some((market) => !market)) {
      throw new Error("--markets must contain non-empty values.");
    }
    const invalidMarkets = markets.filter(
      (market) => !UNIVERSE_MARKETS.includes(market as UniverseMarket),
    );
    if (invalidMarkets.length) {
      throw new Error(`Invalid markets: ${invalidMarkets.join(", ")}.`);
    }

    return {
      execute,
      activeOnly: parseBooleanValue("active", parsed.values.active, true),
      resume: parseBooleanValue("resume", parsed.values.resume, true),
      reset: parseBooleanValue("reset", parsed.values.reset, false),
      markets: [...new Set(markets)] as UniverseMarket[],
      pageLimit: parsePositiveInteger(
        "limit",
        parsed.values.limit,
        execute ? 1_000 : 100,
        1_000,
      ),
      maxPages: parsePositiveInteger(
        "max-pages",
        parsed.values["max-pages"],
        execute ? 1_000_000 : 1,
        1_000_000,
      ),
      help,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${USAGE}\n${detail}`);
  }
}

function buildListingKey(ticker: UniverseTicker) {
  return [
    ticker.ticker,
    ticker.market,
    ticker.normalizedExchangeMic ?? "",
  ].join("|");
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

async function writeSyncState(input: SyncStateWrite) {
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

function sanitizeCursorUrl(
  cursor: string | null,
  baseUrl: string,
): string | null {
  if (!cursor) return null;
  const base = new URL(baseUrl);
  const url = new URL(cursor, base);
  if (url.origin !== base.origin) {
    throw new Error("Provider cursor changed origin.");
  }
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:api[-_]?key|access[-_]?token|token)$/iu.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

function safeOutput(value: unknown, fallback: string): string {
  const cleaned = stripVTControlCharacters(String(value ?? ""))
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(
      /([?&](?:api[-_]?key|access[-_]?token|token)=)[^&#\s]*/giu,
      "$1[redacted]",
    )
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || fallback;
  return diagnostic.length <= MAX_DIAGNOSTIC_LENGTH
    ? diagnostic
    : `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function safeDiagnostic(error: unknown): string {
  return safeOutput(
    error instanceof Error ? error.message : error,
    "Unknown universe-catalog sync error",
  );
}

function safeListingKey(ticker: UniverseTicker): string {
  return safeOutput(buildListingKey(ticker), "-");
}

function assertCompletePage(page: UniversePage): void {
  if (
    !Number.isSafeInteger(page.count) ||
    page.count < 0 ||
    page.count !== page.results.length
  ) {
    throw new Error("Provider returned an incomplete catalog page.");
  }
  if (page.nextUrl && page.results.length === 0) {
    throw new Error("Provider returned a contradictory empty catalog page.");
  }
}

async function runSync(
  options: CliOptions,
  dependencies: RunDependencies,
): Promise<SyncSummary[]> {
  const summaries: SyncSummary[] = [];
  let release: (() => Promise<void>) | null = null;
  let failed = false;

  if (options.execute) {
    release = await dependencies.acquireLock();
    if (!release) {
      throw new Error("A universe-catalog sync is already running.");
    }
  }

  try {
    for (const market of options.markets) {
      if (!options.execute) {
        const page = await dependencies.listPage({
          market,
          active: options.activeOnly,
          limit: options.pageLimit,
          cursorUrl: null,
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        assertCompletePage(page);
        summaries.push({
          market,
          complete: !page.nextUrl,
          pages: 1,
          rows: page.results.length,
          sampleListingKeys: page.results.slice(0, 10).map(safeListingKey),
        });
        continue;
      }

      const scopeKey = buildScopeKey(market, options.activeOnly);
      const existingState =
        !options.reset && options.resume
          ? await dependencies.readState(scopeKey)
          : null;
      if (
        options.resume &&
        !options.reset &&
        existingState?.finishedAt &&
        !existingState.cursor
      ) {
        summaries.push({
          market,
          complete: true,
          pages: existingState.pagesSynced,
          rows: existingState.rowsSynced,
          sampleListingKeys: [],
        });
        continue;
      }

      let cursorUrl = dependencies.sanitizeCursor(
        existingState?.cursor ?? null,
      );
      let pageCount = options.reset ? 0 : (existingState?.pagesSynced ?? 0);
      let rowCount = options.reset ? 0 : (existingState?.rowsSynced ?? 0);
      let lastProcessedListingKey = options.reset
        ? null
        : (existingState?.lastProcessedListingKey ?? null);
      let lastSuccessAt =
        !options.reset && existingState?.lastSuccessAt
          ? new Date(existingState.lastSuccessAt)
          : null;
      const startedAt =
        !options.reset && existingState?.startedAt
          ? new Date(existingState.startedAt)
          : dependencies.now();
      const sampleListingKeys: string[] = [];

      await dependencies.writeState({
        scopeKey,
        market,
        activeOnly: options.activeOnly,
        cursor: cursorUrl,
        lastProcessedListingKey,
        pagesSynced: pageCount,
        rowsSynced: rowCount,
        startedAt,
        finishedAt: null,
        lastSuccessAt,
        lastError: null,
        metadata: {
          pageLimit: options.pageLimit,
          maxPages: options.maxPages,
          resumed: Boolean(existingState && !options.reset),
        },
      });

      try {
        let processedPagesThisRun = 0;
        do {
          const page = await dependencies.listPage({
            market,
            active: options.activeOnly,
            limit: options.pageLimit,
            cursorUrl,
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          });
          assertCompletePage(page);
          const nextCursor = dependencies.sanitizeCursor(page.nextUrl);
          if (!page.results.length) {
            cursorUrl = null;
            break;
          }

          await dependencies.upsertRows(page.results);
          rowCount += page.results.length;
          pageCount += 1;
          processedPagesThisRun += 1;
          cursorUrl = nextCursor;
          lastProcessedListingKey = buildListingKey(
            page.results.at(-1) as UniverseTicker,
          );
          lastSuccessAt = dependencies.now();
          for (const row of page.results) {
            if (sampleListingKeys.length === 10) break;
            sampleListingKeys.push(safeListingKey(row));
          }
          await dependencies.writeState({
            scopeKey,
            market,
            activeOnly: options.activeOnly,
            cursor: cursorUrl,
            lastProcessedListingKey,
            pagesSynced: pageCount,
            rowsSynced: rowCount,
            startedAt,
            finishedAt: null,
            lastSuccessAt,
            lastError: null,
            metadata: {
              pageLimit: options.pageLimit,
              processedPagesThisRun,
              lastPageCount: page.results.length,
              nextCursorPresent: Boolean(cursorUrl),
            },
          });
        } while (cursorUrl && processedPagesThisRun < options.maxPages);

        const completedAt = dependencies.now();
        await dependencies.writeState({
          scopeKey,
          market,
          activeOnly: options.activeOnly,
          cursor: cursorUrl,
          lastProcessedListingKey,
          pagesSynced: pageCount,
          rowsSynced: rowCount,
          startedAt,
          finishedAt: cursorUrl ? null : completedAt,
          lastSuccessAt: completedAt,
          lastError: null,
          metadata: {
            pageLimit: options.pageLimit,
            maxPages: options.maxPages,
            complete: !cursorUrl,
          },
        });
      } catch (error) {
        try {
          await dependencies.writeState({
            scopeKey,
            market,
            activeOnly: options.activeOnly,
            cursor: cursorUrl,
            lastProcessedListingKey,
            pagesSynced: pageCount,
            rowsSynced: rowCount,
            startedAt,
            finishedAt: null,
            lastSuccessAt,
            lastError: safeDiagnostic(error),
            metadata: {
              pageLimit: options.pageLimit,
              maxPages: options.maxPages,
              failed: true,
            },
          });
        } catch {
          // Preserve the provider/database failure that caused this checkpoint.
        }
        throw error;
      }

      summaries.push({
        market,
        complete: !cursorUrl,
        pages: pageCount,
        rows: rowCount,
        sampleListingKeys,
      });
    }
    return summaries;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (release) {
      try {
        await release();
      } catch (error) {
        if (!failed) throw error;
      }
    }
  }
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(args);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const config = getMassiveRuntimeConfig();
  if (!config) {
    throw new Error(
      "Massive runtime configuration is required to sync the universe catalog.",
    );
  }
  const client = new MassiveMarketDataClient(config);
  const summaries = await runSync(options, {
    acquireLock: () =>
      sharedAdvisoryLockHolder.acquire(UNIVERSE_CATALOG_SYNC_ADVISORY_LOCK_KEY),
    listPage: (input) => client.listUniverseTickersPage(input),
    now: () => new Date(),
    readState: readSyncState,
    sanitizeCursor: (cursor) => sanitizeCursorUrl(cursor, config.baseUrl),
    upsertRows: upsertUniverseCatalogRows,
    writeState: writeSyncState,
  });
  console.log(JSON.stringify({ execute: options.execute, summaries }, null, 2));
}

export const __syncUniverseCatalogInternalsForTests = {
  parseOptions,
  runSync,
  sanitizeCursorUrl,
};

async function runCli(): Promise<void> {
  let failed = false;
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    failed = true;
    console.error(safeDiagnostic(error));
    exitCode = 1;
  }
  try {
    await closeDatabaseConnections();
  } catch (error) {
    console.error(
      failed
        ? "Database cleanup also failed."
        : `Database cleanup failed: ${safeDiagnostic(error)}`,
    );
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCli();
}

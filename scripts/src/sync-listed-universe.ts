import { pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { hasOpaqueOperatorCredential } from "./operator-diagnostic";
import {
  closeDatabaseConnections,
  db,
  sharedAdvisoryLockHolder,
  type AdvisoryLockLease,
  type WorkspaceDatabase,
} from "@workspace/db";
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
} from "../../artifacts/api-server/src/providers/massive/market-data";
import {
  assertUniverseCatalogWriterFence,
  claimUniverseCatalogWriterFence,
  requireUniverseCatalogWriterFenceToken,
  UNIVERSE_CATALOG_WRITER_ADVISORY_LOCK_KEY,
} from "../../artifacts/api-server/src/services/universe-catalog-writer-fence";

type DirectorySource = "nasdaq" | "other";
type SourceId = "nasdaq_listed" | "other_listed";
type CliOptions = {
  nasdaqUrl?: string;
  otherUrl?: string;
  includeEtfs: boolean;
  includeTestIssues: boolean;
  includeNonCommonStock: boolean;
  normalFinancialStatusOnly: boolean;
  sources: Set<DirectorySource>;
  limit: number | null;
  execute: boolean;
  help: boolean;
};

type SourceRow = {
  sourceId: SourceId;
  sourceSymbol: string;
  ticker: UniverseTicker;
  metadata: Record<string, unknown>;
};

type SourceSummary = {
  fileCreationTime: string | null;
  parsedRecords: number;
  sourceRecords: number;
  skippedRecords: number;
  invalidRecords: number;
  selectedRows: number;
};

type BuiltRows = {
  rows: SourceRow[];
  sourceSummaries: Partial<Record<DirectorySource, SourceSummary>>;
  activeSourceSymbols: Map<SourceId, Set<string>>;
};

type MembershipSyncInput = {
  rows: readonly SourceRow[];
  activeSourceSymbols: ReadonlyMap<SourceId, ReadonlySet<string>>;
  reconcileSourceIds: readonly SourceId[];
  writerFenceToken: string;
  database?: WorkspaceDatabase;
  now?: Date;
  signal?: AbortSignal;
};

type MembershipSyncResult = {
  upsertedRows: number;
  deactivatedRows: number;
  deactivatedBySource: Partial<Record<SourceId, number>>;
};

type SyncResult = {
  built: BuiltRows;
  catalogRowsUpserted: number;
  membershipRowsUpserted: number;
  deactivatedRows: number;
  deactivatedBySource: Partial<Record<SourceId, number>>;
  reconciledSourceIds: SourceId[];
};

type RunDependencies = {
  acquireLock: () => Promise<AdvisoryLockLease | null>;
  claimWriterFence: (fenceToken: string) => Promise<void>;
  buildRows: (options: CliOptions, signal?: AbortSignal) => Promise<BuiltRows>;
  upsertCatalog: (
    rows: UniverseTicker[],
    writerFenceToken: string,
    signal: AbortSignal,
  ) => Promise<void>;
  syncMemberships: (
    input: MembershipSyncInput,
  ) => Promise<MembershipSyncResult>;
};

type DirectoryFetchers = {
  fetchNasdaq: (url?: string) => Promise<string>;
  fetchOther: (url?: string) => Promise<string>;
};

const SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE = 1_000;
const MAX_DIAGNOSTIC_LENGTH = 400;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const FILE_CREATION_TIME_PATTERN =
  /^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{4}(?:[01]\d|2[0-3]):[0-5]\d$/u;
const USAGE =
  "Usage: pnpm --filter @workspace/scripts run universe:sync:listings -- [--execute] [--sources=nasdaq,other] [--nasdaq-url=HTTP_URL] [--other-url=HTTP_URL] [--include-etfs=true|false] [--include-test-issues=true|false] [--include-non-common-stock=true|false] [--normal-financial-status-only=true|false] [--limit=POSITIVE_INTEGER] [--help]";
const ALL_RECORDS_OPTIONS = {
  includeEtfs: true,
  includeTestIssues: true,
  includeNonCommonStock: true,
  normalFinancialStatusOnly: false,
} as const;
// ponytail: transport timeout and byte ceilings belong in the shared directory
// fetchers; add them there when that pending service review unit is owned.
const DEFAULT_FETCHERS: DirectoryFetchers = {
  fetchNasdaq: fetchNasdaqListedDirectory,
  fetchOther: fetchOtherListedDirectory,
};

function parseBooleanValue(
  name: string,
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

function parsePositiveInteger(
  name: string,
  raw: string | undefined,
): number | null {
  if (raw === undefined) return null;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`--${name} must be a canonical positive integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} is outside the supported range.`);
  }
  return parsed;
}

function parseSources(raw: string | undefined): Set<DirectorySource> {
  if (raw === undefined) return new Set(["nasdaq", "other"]);
  const values = raw.split(",").map((value) => value.trim().toLowerCase());
  if (!values.length || values.some((value) => !value)) {
    throw new Error("--sources must contain non-empty comma-separated values.");
  }
  const invalid = values.filter(
    (value) => value !== "nasdaq" && value !== "other",
  );
  if (invalid.length) {
    throw new Error(`Invalid sources: ${invalid.join(", ")}`);
  }
  return new Set(values as DirectorySource[]);
}

function parseHttpUrl(
  name: string,
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim() !== raw) {
    throw new Error(`--${name} must not have surrounding whitespace.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`--${name} must be a valid HTTP(S) URL.`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname
  ) {
    throw new Error(`--${name} must be a valid HTTP(S) URL.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`--${name} must not contain credentials.`);
  }
  return parsed.href;
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
        help: { type: "boolean", short: "h" },
        "nasdaq-url": { type: "string" },
        "other-url": { type: "string" },
        "include-etfs": { type: "string" },
        "include-test-issues": { type: "string" },
        "include-non-common-stock": { type: "string" },
        "normal-financial-status-only": { type: "string" },
        sources: { type: "string" },
        limit: { type: "string" },
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

    return {
      nasdaqUrl: parseHttpUrl("nasdaq-url", parsed.values["nasdaq-url"]),
      otherUrl: parseHttpUrl("other-url", parsed.values["other-url"]),
      includeEtfs: parseBooleanValue(
        "include-etfs",
        parsed.values["include-etfs"],
        true,
      ),
      includeTestIssues: parseBooleanValue(
        "include-test-issues",
        parsed.values["include-test-issues"],
        false,
      ),
      includeNonCommonStock: parseBooleanValue(
        "include-non-common-stock",
        parsed.values["include-non-common-stock"],
        false,
      ),
      normalFinancialStatusOnly: parseBooleanValue(
        "normal-financial-status-only",
        parsed.values["normal-financial-status-only"],
        true,
      ),
      sources: parseSources(parsed.values.sources),
      limit: parsePositiveInteger("limit", parsed.values.limit),
      execute: parsed.values.execute ?? false,
      help,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${USAGE}\n${detail}`);
  }
}

function listingKeyForTicker(ticker: UniverseTicker): string {
  return [
    ticker.ticker,
    ticker.market,
    ticker.normalizedExchangeMic ?? "",
  ].join("|");
}

function invalidRecordCount(
  records: readonly { rawSymbol: string }[],
  skippedCount: number,
): number {
  return (
    skippedCount +
    records.length -
    new Set(records.map((record) => record.rawSymbol)).size
  );
}

async function buildRows(
  options: CliOptions,
  fetchers: DirectoryFetchers = DEFAULT_FETCHERS,
  signal?: AbortSignal,
): Promise<BuiltRows> {
  signal?.throwIfAborted();
  const sourceSummaries: BuiltRows["sourceSummaries"] = {};
  const activeSourceSymbols: BuiltRows["activeSourceSymbols"] = new Map();
  const rows: SourceRow[] = [];
  const parseOptions = {
    includeEtfs: options.includeEtfs,
    includeTestIssues: options.includeTestIssues,
    includeNonCommonStock: options.includeNonCommonStock,
    normalFinancialStatusOnly: options.normalFinancialStatusOnly,
  };

  if (options.sources.has("nasdaq")) {
    signal?.throwIfAborted();
    const text = await fetchers.fetchNasdaq(options.nasdaqUrl);
    signal?.throwIfAborted();
    const parsed = parseNasdaqListedDirectory(text, parseOptions);
    const source = parseNasdaqListedDirectory(text, ALL_RECORDS_OPTIONS);
    const symbols = new Set(parsed.records.map((record) => record.rawSymbol));
    const sourceRows = parsed.records
      .slice(0, options.limit ?? parsed.records.length)
      .map((record) => ({
        sourceId: "nasdaq_listed" as const,
        sourceSymbol: record.rawSymbol,
        ticker: nasdaqListedRecordToUniverseTicker(record),
        metadata: {
          fileCreationTime: source.fileCreationTime,
          marketCategory: record.marketCategory,
          financialStatus: record.financialStatus,
          roundLotSize: record.roundLotSize,
          etf: record.etf,
          nextShares: record.nextShares,
        },
      }));
    rows.push(...sourceRows);
    activeSourceSymbols.set("nasdaq_listed", symbols);
    sourceSummaries.nasdaq = {
      fileCreationTime: source.fileCreationTime,
      parsedRecords: parsed.records.length,
      sourceRecords: source.records.length,
      skippedRecords: parsed.skippedCount,
      invalidRecords: invalidRecordCount(source.records, source.skippedCount),
      selectedRows: sourceRows.length,
    };
  }

  if (options.sources.has("other")) {
    signal?.throwIfAborted();
    const text = await fetchers.fetchOther(options.otherUrl);
    signal?.throwIfAborted();
    const parsed = parseOtherListedDirectory(text, parseOptions);
    const source = parseOtherListedDirectory(text, ALL_RECORDS_OPTIONS);
    const symbols = new Set(parsed.records.map((record) => record.rawSymbol));
    const sourceRows = parsed.records
      .slice(0, options.limit ?? parsed.records.length)
      .map((record) => ({
        sourceId: "other_listed" as const,
        sourceSymbol: record.rawSymbol,
        ticker: otherListedRecordToUniverseTicker(record),
        metadata: {
          fileCreationTime: source.fileCreationTime,
          exchangeCode: record.exchangeCode,
          cqsSymbol: record.cqsSymbol,
          roundLotSize: record.roundLotSize,
          etf: record.etf,
          nasdaqSymbol: record.nasdaqSymbol,
        },
      }));
    rows.push(...sourceRows);
    activeSourceSymbols.set("other_listed", symbols);
    sourceSummaries.other = {
      fileCreationTime: source.fileCreationTime,
      parsedRecords: parsed.records.length,
      sourceRecords: source.records.length,
      skippedRecords: parsed.skippedCount,
      invalidRecords: invalidRecordCount(source.records, source.skippedCount),
      selectedRows: sourceRows.length,
    };
  }

  return { rows, sourceSummaries, activeSourceSymbols };
}

function sourceId(source: DirectorySource): SourceId {
  return source === "nasdaq" ? "nasdaq_listed" : "other_listed";
}

function assertAuthoritativeSourceEvidence(
  built: BuiltRows,
  selectedSources: ReadonlySet<DirectorySource>,
): void {
  for (const selectedSource of selectedSources) {
    const summary = built.sourceSummaries[selectedSource];
    const symbols = built.activeSourceSymbols.get(sourceId(selectedSource));
    if (
      !summary?.fileCreationTime ||
      !FILE_CREATION_TIME_PATTERN.test(summary.fileCreationTime)
    ) {
      throw new Error(
        `The ${selectedSource} directory is not authoritative: its completion trailer is missing or invalid.`,
      );
    }
    if (!summary.sourceRecords) {
      throw new Error(
        `The ${selectedSource} directory is not authoritative: it contains no source records.`,
      );
    }
    if (!summary.parsedRecords || !symbols?.size) {
      throw new Error(
        `The ${selectedSource} directory is not authoritative: its filters selected no membership records.`,
      );
    }
    if (
      summary.invalidRecords !== 0 ||
      symbols.size !== summary.parsedRecords
    ) {
      throw new Error(
        `The ${selectedSource} directory is not authoritative: it contains invalid, malformed, or duplicate records.`,
      );
    }
  }
}

async function syncSourceMemberships(
  input: MembershipSyncInput,
): Promise<MembershipSyncResult> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const reconcileSourceIds = [...new Set(input.reconcileSourceIds)];
  for (const id of reconcileSourceIds) {
    if (!input.activeSourceSymbols.get(id)?.size) {
      throw new Error(`Cannot reconcile ${id} without source evidence.`);
    }
  }
  input.signal?.throwIfAborted();

  // ponytail: the shared catalog writer owns its own transaction; keep this
  // membership phase atomic until that writer accepts an injected transaction.
  return database.transaction(async (tx) => {
    await assertUniverseCatalogWriterFence({
      fenceToken: input.writerFenceToken,
      transaction: tx,
    });
    input.signal?.throwIfAborted();
    let upsertedRows = 0;
    for (
      let index = 0;
      index < input.rows.length;
      index += SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE
    ) {
      input.signal?.throwIfAborted();
      const chunk = input.rows.slice(
        index,
        index + SOURCE_MEMBERSHIP_UPSERT_CHUNK_SIZE,
      );
      await tx
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
      input.signal?.throwIfAborted();
      upsertedRows += chunk.length;
    }

    let deactivatedRows = 0;
    const deactivatedBySource: MembershipSyncResult["deactivatedBySource"] = {};
    for (const id of reconcileSourceIds) {
      input.signal?.throwIfAborted();
      const symbols = [...input.activeSourceSymbols.get(id)!];
      const deactivated = await tx
        .update(universeSourceMembershipsTable)
        .set({
          active: false,
          lastMissingAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(universeSourceMembershipsTable.sourceId, id),
            eq(universeSourceMembershipsTable.active, true),
            sql`${universeSourceMembershipsTable.sourceSymbol} <> all(${sql.param(symbols)}::text[])`,
          ),
        )
        .returning({
          sourceSymbol: universeSourceMembershipsTable.sourceSymbol,
        });
      input.signal?.throwIfAborted();
      deactivatedBySource[id] = deactivated.length;
      deactivatedRows += deactivated.length;
    }
    input.signal?.throwIfAborted();
    return { upsertedRows, deactivatedRows, deactivatedBySource };
  });
}

const DEFAULT_RUN_DEPENDENCIES: RunDependencies = {
  acquireLock: () =>
    sharedAdvisoryLockHolder.acquire(UNIVERSE_CATALOG_WRITER_ADVISORY_LOCK_KEY),
  claimWriterFence: (fenceToken) =>
    claimUniverseCatalogWriterFence({ fenceToken }),
  buildRows: (options, signal) => buildRows(options, DEFAULT_FETCHERS, signal),
  upsertCatalog: async (rows, writerFenceToken, signal) => {
    const { upsertUniverseCatalogRows } = await import(
      "../../artifacts/api-server/src/services/platform"
    );
    await upsertUniverseCatalogRows(rows, { writerFenceToken, signal });
  },
  syncMemberships: syncSourceMemberships,
};

function emptySyncResult(built: BuiltRows): SyncResult {
  return {
    built,
    catalogRowsUpserted: 0,
    membershipRowsUpserted: 0,
    deactivatedRows: 0,
    deactivatedBySource: {},
    reconciledSourceIds: [],
  };
}

async function runSync(
  options: CliOptions,
  dependencies: RunDependencies = DEFAULT_RUN_DEPENDENCIES,
): Promise<SyncResult> {
  if (!options.execute) {
    return emptySyncResult(await dependencies.buildRows(options));
  }

  const lease = await dependencies.acquireLock();
  if (!lease) {
    throw new Error("A listed-universe sync is already running.");
  }
  let failed = false;
  try {
    lease.signal.throwIfAborted();
    const writerFenceToken = requireUniverseCatalogWriterFenceToken(lease);
    await dependencies.claimWriterFence(writerFenceToken);
    lease.signal.throwIfAborted();
    const built = await dependencies.buildRows(options, lease.signal);
    lease.signal.throwIfAborted();
    assertAuthoritativeSourceEvidence(built, options.sources);
    lease.signal.throwIfAborted();
    await dependencies.upsertCatalog(
      built.rows.map((row) => row.ticker),
      writerFenceToken,
      lease.signal,
    );
    lease.signal.throwIfAborted();
    const reconciledSourceIds =
      options.limit === null ? [...options.sources].map(sourceId) : [];
    const membership = await dependencies.syncMemberships({
      rows: built.rows,
      activeSourceSymbols: built.activeSourceSymbols,
      reconcileSourceIds: reconciledSourceIds,
      writerFenceToken,
      signal: lease.signal,
    });
    lease.signal.throwIfAborted();
    return {
      built,
      catalogRowsUpserted: built.rows.length,
      membershipRowsUpserted: membership.upsertedRows,
      deactivatedRows: membership.deactivatedRows,
      deactivatedBySource: membership.deactivatedBySource,
      reconciledSourceIds,
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await lease();
    } catch (error) {
      if (!failed) throw error;
    }
  }
}

function safeOutput(value: unknown, fallback: string): string {
  const withoutCredentials = String(value ?? "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(
      /([?&](?:api[-_]?key|access[-_]?token|token)=)[^&#\s]*/giu,
      "$1[redacted]",
    )
    .replace(/\s+/gu, " ");
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic =
    cleaned && !hasOpaqueOperatorCredential(cleaned) ? cleaned : fallback;
  if (diagnostic.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function safeDiagnostic(error: unknown): string {
  return safeOutput(
    error instanceof Error ? error.message : error,
    "Unknown listed-universe sync error",
  );
}

function safeSourceSummaries(
  summaries: BuiltRows["sourceSummaries"],
): BuiltRows["sourceSummaries"] {
  return Object.fromEntries(
    Object.entries(summaries).map(([source, summary]) => [
      source,
      {
        ...summary,
        fileCreationTime:
          summary.fileCreationTime === null
            ? null
            : safeOutput(summary.fileCreationTime, "-"),
      },
    ]),
  );
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(args);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const result = await runSync(options);
  const { rows, sourceSummaries } = result.built;

  console.log(
    JSON.stringify(
      {
        source: "listed_universe",
        execute: options.execute,
        dryRun: !options.execute,
        includeEtfs: options.includeEtfs,
        includeTestIssues: options.includeTestIssues,
        includeNonCommonStock: options.includeNonCommonStock,
        normalFinancialStatusOnly: options.normalFinancialStatusOnly,
        rows: rows.length,
        upsertedRows: result.catalogRowsUpserted,
        catalogRowsUpserted: result.catalogRowsUpserted,
        membershipRowsUpserted: result.membershipRowsUpserted,
        deactivatedRows: result.deactivatedRows,
        deactivatedBySource: result.deactivatedBySource,
        reconciledSourceIds: result.reconciledSourceIds,
        reconciliation: !options.execute
          ? "preview"
          : options.limit === null
            ? "complete"
            : "skipped_limit",
        sampleListingKeys: rows
          .slice(0, 10)
          .map((row) => safeOutput(listingKeyForTicker(row.ticker), "-")),
        sourceSummaries: safeSourceSummaries(sourceSummaries),
      },
      null,
      2,
    ),
  );
}

export const __syncListedUniverseInternalsForTests = {
  USAGE,
  assertAuthoritativeSourceEvidence,
  buildRows,
  parseOptions,
  runSync,
  safeDiagnostic,
  syncSourceMemberships,
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

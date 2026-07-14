import { pool } from "@workspace/db";
import {
  barCacheTable,
  flowSummariesTable,
  gexSnapshotsTable,
  marketDataIngestJobsTable,
  optionChainLatestTable,
  providerRequestLogTable,
  quoteCacheTable,
} from "@workspace/db/schema";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

type IndexSpec = {
  name: string;
  columns: string[];
  unique: boolean;
};

type TableSpec = {
  name: string;
  columns: string[];
  indexes: IndexSpec[];
  reloptions: string[];
};
// ponytail: complete column-name presence is the current column-contract
// ceiling; if type/default/nullability drift is observed, derive and compare
// those signatures from Drizzle and the PostgreSQL catalog here.

const BAR_CACHE_RELOPTIONS = [
  "autovacuum_vacuum_scale_factor=0.02",
  "autovacuum_vacuum_threshold=1000",
  "autovacuum_analyze_scale_factor=0.02",
  "autovacuum_analyze_threshold=1000",
  "autovacuum_vacuum_cost_limit=2000",
];

function tableSpec(table: PgTable, reloptions: string[] = []): TableSpec {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: config.columns.map((column) => column.name),
    indexes: config.indexes.map((index) => {
      const name = index.config.name;
      if (!name) {
        throw new Error(`Audited table ${config.name} has an unnamed index`);
      }
      const columns = index.config.columns.map((column) => {
        const columnName =
          "name" in column && typeof column.name === "string"
            ? column.name
            : null;
        if (!columnName) {
          // ponytail: audited market-data indexes are named simple-column
          // indexes today; extend this signature model before adding an
          // expression index to the audited table set.
          throw new Error(
            `Audited index ${name} on ${config.name} is not a simple-column index`,
          );
        }
        return columnName;
      });
      return { name, columns, unique: index.config.unique };
    }),
    reloptions,
  };
}

const TABLES: TableSpec[] = [
  tableSpec(quoteCacheTable),
  tableSpec(barCacheTable, BAR_CACHE_RELOPTIONS),
  tableSpec(optionChainLatestTable),
  tableSpec(marketDataIngestJobsTable),
  tableSpec(providerRequestLogTable),
  tableSpec(gexSnapshotsTable),
  tableSpec(flowSummariesTable),
];
const TABLE_NAMES = TABLES.map((spec) => spec.name);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsDir = path.join(repoRoot, "lib/db/migrations");
const USAGE = "Usage: pnpm run db:market-data:audit";
const MAX_DIAGNOSTIC_LENGTH = 400;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function parseAuditArgs(args = process.argv.slice(2)): void {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.length > 0) throw new Error(USAGE);
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutCredentials = (raw || "Unknown database error")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/\s+/gu, " ");
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown database error";
  if (diagnostic.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

type AuditRow = {
  table: string;
  exists: boolean;
  missingColumns: string[];
  missingIndexes: string[];
  mismatchedIndexes: string[];
  missingReloptions: string[];
};

type ExistingIndex = {
  columns: string[];
  unique: boolean;
};

type CatalogSnapshot = {
  tables: Set<string>;
  columnsByTable: Map<string, Set<string>>;
  indexesByTable: Map<string, Map<string, ExistingIndex>>;
  reloptionsByTable: Map<string, Set<string>>;
};

async function loadExistingTables(): Promise<Set<string>> {
  const result = await pool.query<{ table_name: string }>(
    `select table_name
      from information_schema.tables
     where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name = any($1::text[])`,
    [TABLE_NAMES],
  );
  return new Set(result.rows.map((row) => row.table_name));
}

async function loadExistingColumns(): Promise<Map<string, Set<string>>> {
  const result = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])`,
    [TABLE_NAMES],
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const columns = byTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    byTable.set(row.table_name, columns);
  }
  return byTable;
}

async function loadExistingIndexes(): Promise<
  Map<string, Map<string, ExistingIndex>>
> {
  const result = await pool.query<{
    table_name: string;
    index_name: string;
    is_unique: boolean;
    column_names: string[];
  }>(
    `select table_class.relname as table_name,
            index_class.relname as index_name,
            idx.indisunique as is_unique,
            array_agg(attribute.attname::text order by key_column.ordinality) as column_names
       from pg_index idx
       join pg_class table_class on table_class.oid = idx.indrelid
       join pg_class index_class on index_class.oid = idx.indexrelid
       join pg_namespace namespace on namespace.oid = table_class.relnamespace
       cross join lateral unnest(idx.indkey)
         with ordinality as key_column(attnum, ordinality)
       join pg_attribute attribute
         on attribute.attrelid = idx.indrelid
        and attribute.attnum = key_column.attnum
      where namespace.nspname = 'public'
        and table_class.relname = any($1::text[])
        and key_column.ordinality <= idx.indnkeyatts
        and idx.indisvalid
        and idx.indisready
      group by table_class.relname, index_class.relname, idx.indisunique`,
    [TABLE_NAMES],
  );
  const byTable = new Map<string, Map<string, ExistingIndex>>();
  for (const row of result.rows) {
    const indexes = byTable.get(row.table_name) ?? new Map();
    indexes.set(row.index_name, {
      columns: row.column_names,
      unique: row.is_unique,
    });
    byTable.set(row.table_name, indexes);
  }
  return byTable;
}

async function loadExistingReloptions(): Promise<Map<string, Set<string>>> {
  const result = await pool.query<{ table_name: string; reloption: string }>(
    `select c.relname as table_name, unnest(c.reloptions) as reloption
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname = any($1::text[])`,
    [TABLE_NAMES],
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const reloptions = byTable.get(row.table_name) ?? new Set<string>();
    reloptions.add(row.reloption);
    byTable.set(row.table_name, reloptions);
  }
  return byTable;
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function buildAuditRows(
  specs: TableSpec[],
  catalog: CatalogSnapshot,
): AuditRow[] {
  return specs.map((spec) => {
    const columns = catalog.columnsByTable.get(spec.name) ?? new Set<string>();
    const indexes = catalog.indexesByTable.get(spec.name) ?? new Map();
    const reloptions =
      catalog.reloptionsByTable.get(spec.name) ?? new Set<string>();
    const missingIndexes = spec.indexes.filter(
      (index) => !indexes.has(index.name),
    );
    const mismatchedIndexes = spec.indexes.filter((index) => {
      const existing = indexes.get(index.name);
      return (
        existing !== undefined &&
        (existing.unique !== index.unique ||
          !sameStrings(existing.columns, index.columns))
      );
    });
    return {
      table: spec.name,
      exists: catalog.tables.has(spec.name),
      missingColumns: spec.columns.filter((column) => !columns.has(column)),
      missingIndexes: missingIndexes.map((index) => index.name),
      mismatchedIndexes: mismatchedIndexes.map((index) => index.name),
      missingReloptions: spec.reloptions.filter(
        (reloption) => !reloptions.has(reloption),
      ),
    };
  });
}

async function audit(): Promise<AuditRow[]> {
  // Catalog inspection is deliberately sequential and table-scoped so this
  // read-only utility never claims four of the shared database's pool slots.
  const tables = await loadExistingTables();
  const columnsByTable = await loadExistingColumns();
  const indexesByTable = await loadExistingIndexes();
  const reloptionsByTable = await loadExistingReloptions();
  return buildAuditRows(TABLES, {
    tables,
    columnsByTable,
    indexesByTable,
    reloptionsByTable,
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function executableSql(sqlSource: string): string {
  // ponytail: this proves a literal creation path, not ordered replay across
  // manually phased files. When migrations gain a canonical runner, replace
  // this textual guard with replay against a disposable PostgreSQL instance.
  return sqlSource
    .replace(/\$([a-z_][a-z0-9_]*)\$[\s\S]*?\$\1\$/giu, " ")
    .replace(/\$\$[\s\S]*?\$\$/gu, " ")
    .replace(/'(?:''|\\.|[^'])*'/gu, " ")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/--[^\n]*/gu, " ")
    .toLowerCase();
}

function qualifiedTablePattern(tableName: string): string {
  const name = escapeRegExp(tableName);
  return `(?:(?:"?public"?)\\s*\\.\\s*)?"?${name}"?`;
}

function createTableBody(sql: string, tableName: string): string | null {
  return (
    new RegExp(
      `\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${qualifiedTablePattern(tableName)}\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    ).exec(sql)?.[1] ?? null
  );
}

function tableBodyHasColumn(body: string, columnName: string): boolean {
  return new RegExp(`(?:^|,)\\s*"?${escapeRegExp(columnName)}"?\\s`).test(body);
}

function migrationHasColumn(
  sql: string,
  tableName: string,
  tableBody: string,
  columnName: string,
): boolean {
  return (
    tableBodyHasColumn(tableBody, columnName) ||
    new RegExp(
      `\\balter\\s+table\\s+(?:if\\s+exists\\s+)?${qualifiedTablePattern(tableName)}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?"?${escapeRegExp(columnName)}"?\\s`,
    ).test(sql)
  );
}

function migrationIndex(
  sql: string,
  tableName: string,
  indexName: string,
): ExistingIndex | null {
  const match = new RegExp(
    `\\bcreate\\s+(unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?"?${escapeRegExp(indexName)}"?\\s+on\\s+(?:only\\s+)?${qualifiedTablePattern(tableName)}\\s*\\(([\\s\\S]*?)\\)\\s*;`,
  ).exec(sql);
  if (!match) return null;
  const columns = (match[2] ?? "").split(",").map((part) => {
    const column = part.trim().match(/^"?([a-z_][a-z0-9_]*)"?(?:\s|$)/)?.[1];
    return column ?? null;
  });
  if (columns.some((column) => column === null)) return null;
  return { columns: columns as string[], unique: Boolean(match[1]) };
}

function reloptionsForTable(
  sql: string,
  tableName: string,
): Set<string> | null {
  const matcher = new RegExp(
    `\\balter\\s+table\\s+(?:if\\s+exists\\s+)?${qualifiedTablePattern(tableName)}\\s+set\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    "g",
  );
  const options = new Set<string>();
  let found = false;
  for (const match of sql.matchAll(matcher)) {
    found = true;
    for (const option of (match[1] ?? "").split(",")) {
      options.add(option.replace(/\s+/g, ""));
    }
  }
  return found ? options : null;
}

function auditMigrationSql(sqlSource: string, specs = TABLES): string[] {
  const sql = executableSql(sqlSource);
  const failures: string[] = [];
  for (const spec of specs) {
    const tableBody = createTableBody(sql, spec.name);
    if (tableBody === null) {
      failures.push(`migration missing table ${spec.name}`);
    } else {
      for (const column of spec.columns) {
        if (!migrationHasColumn(sql, spec.name, tableBody, column)) {
          failures.push(`migration missing column ${column} on ${spec.name}`);
        }
      }
    }

    for (const expected of spec.indexes) {
      const existing = migrationIndex(sql, spec.name, expected.name);
      if (
        existing === null ||
        existing.unique !== expected.unique ||
        !sameStrings(existing.columns, expected.columns)
      ) {
        failures.push(
          `migration missing index ${expected.name} on ${spec.name}`,
        );
      }
    }

    if (spec.reloptions.length > 0) {
      const reloptions = reloptionsForTable(sql, spec.name);
      if (reloptions === null) {
        failures.push(`migration missing reloptions ALTER for ${spec.name}`);
      } else {
        for (const reloption of spec.reloptions) {
          if (!reloptions.has(reloption.replace(/\s+/g, ""))) {
            failures.push(
              `migration missing reloption ${reloption} on ${spec.name}`,
            );
          }
        }
      }
    }
  }
  return failures;
}

function auditMigrationFile(): string[] {
  if (!fs.existsSync(migrationsDir)) {
    return [`missing migrations dir: ${migrationsDir}`];
  }
  // Scan ALL migrations: indexes are added in dated migrations over time, not
  // only the 20260529 baseline.
  const sql = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) =>
      executableSql(
        fs.readFileSync(path.join(migrationsDir, entry.name), "utf8"),
      ),
    )
    .join("\n");
  return auditMigrationSql(sql);
}

async function main(): Promise<void> {
  parseAuditArgs();
  const rows = await audit();
  const migrationFailures = auditMigrationFile();
  console.table(
    rows.map((row) => ({
      table: row.table,
      exists: row.exists,
      missingColumns: row.missingColumns.join(", ") || "-",
      missingIndexes: row.missingIndexes.join(", ") || "-",
      mismatchedIndexes: row.mismatchedIndexes.join(", ") || "-",
      missingReloptions: row.missingReloptions.join(", ") || "-",
    })),
  );

  const failures = rows.filter(
    (row) =>
      !row.exists ||
      row.missingColumns.length > 0 ||
      row.missingIndexes.length > 0 ||
      row.mismatchedIndexes.length > 0 ||
      row.missingReloptions.length > 0,
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
  if (migrationFailures.length > 0) {
    migrationFailures.forEach((failure) => console.error(failure));
    process.exitCode = 1;
  }
}

export const __marketDataSchemaAuditInternalsForTests = {
  MAX_DIAGNOSTIC_LENGTH,
  TABLES,
  audit,
  auditMigrationFile,
  auditMigrationSql,
  buildAuditRows,
  executableSql,
  parseAuditArgs,
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

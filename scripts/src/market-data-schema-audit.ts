import { pool } from "@workspace/db";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TableSpec = {
  name: string;
  columns: string[];
  indexes: string[];
  // Expected per-table storage parameters, each as a `name=value` string
  // matching the exact form pg_class.reloptions returns. Optional: only tables
  // with intentional autovacuum/storage overrides declare them.
  reloptions?: string[];
};

const TABLES: TableSpec[] = [
  {
    name: "quote_cache",
    columns: [
      "id",
      "instrument_id",
      "symbol",
      "bid",
      "ask",
      "last",
      "source",
      "as_of",
      "created_at",
      "updated_at",
    ],
    indexes: [
      "quote_cache_instrument_idx",
      "quote_cache_symbol_idx",
      "quote_cache_as_of_idx",
    ],
  },
  {
    name: "bar_cache",
    columns: [
      "id",
      "instrument_id",
      "symbol",
      "timeframe",
      "starts_at",
      "open",
      "high",
      "low",
      "close",
      "volume",
      "source",
    ],
    indexes: [
      "bar_cache_instrument_timeframe_source_starts_at_idx",
      // Covering index for the hot loadStoredMarketBars read; see
      // db-pool-saturation-index-fix.md. Regression guard: if this is ever
      // dropped, /bars falls back to the 6s-timeout plan. The single-column
      // bar_cache_instrument_idx (subsumed by the unique index) and
      // bar_cache_symbol_timeframe_idx (subsumed by this covering index) were
      // dropped in prod to cut write-amplification on this hot append table;
      // confirmed absent via pg_indexes 2026-06-24.
      "bar_cache_symbol_timeframe_source_starts_at_idx",
      "bar_cache_starts_at_idx",
    ],
    // Per-table autovacuum tuning; see 20260624_bar_cache_autovacuum_tuning.sql.
    // Regression guard: if these are dropped, bar_cache reverts to the global
    // scale_factor=0.2 and re-bloats the working set on the fixed shared DB.
    reloptions: [
      "autovacuum_vacuum_scale_factor=0.02",
      "autovacuum_vacuum_threshold=1000",
      "autovacuum_analyze_scale_factor=0.02",
      "autovacuum_analyze_threshold=1000",
      "autovacuum_vacuum_cost_limit=2000",
    ],
  },
  {
    name: "market_data_ingest_jobs",
    columns: [
      "id",
      "kind",
      "symbol",
      "priority",
      "status",
      "attempt_count",
      "max_attempts",
      "lease_owner",
      "lease_expires_at",
      "last_heartbeat_at",
      "next_run_at",
      "dedupe_key",
      "payload",
      "last_error",
    ],
    indexes: [
      "market_data_ingest_jobs_dedupe_key_idx",
      "market_data_ingest_jobs_status_priority_idx",
      "market_data_ingest_jobs_symbol_kind_idx",
      "market_data_ingest_jobs_lease_expires_idx",
    ],
  },
  {
    name: "provider_request_log",
    columns: [
      "id",
      "provider",
      "endpoint_family",
      "symbol",
      "request_key",
      "status",
      "http_status",
      "duration_ms",
      "row_count",
      "page_count",
      "retry_count",
      "rate_limit_reset_at",
      "error_code",
      "error_message",
      "metadata",
    ],
    indexes: [
      "provider_request_log_provider_created_idx",
      "provider_request_log_family_created_idx",
      "provider_request_log_symbol_created_idx",
    ],
  },
  {
    name: "gex_snapshots",
    columns: [
      "id",
      "symbol",
      "computed_at",
      "spot",
      "net_gex",
      "option_count",
      "usable_option_count",
      "source_status",
      "source_message",
      "payload",
    ],
    indexes: [
      "gex_snapshots_symbol_computed_at_idx",
      "gex_snapshots_symbol_latest_idx",
    ],
  },
  {
    name: "flow_summaries",
    columns: [
      "id",
      "symbol",
      "window_start",
      "window_end",
      "event_count",
      "bullish_premium",
      "bearish_premium",
      "neutral_premium",
      "net_delta",
      "source_status",
      "payload",
    ],
    indexes: [
      "flow_summaries_symbol_window_idx",
      "flow_summaries_symbol_latest_idx",
    ],
  },
];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const migrationsDir = path.join(repoRoot, "lib/db/migrations");

type AuditRow = {
  table: string;
  exists: boolean;
  missingColumns: string[];
  missingIndexes: string[];
  missingReloptions: string[];
};

async function loadExistingTables(): Promise<Set<string>> {
  const result = await pool.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'`,
  );
  return new Set(result.rows.map((row) => row.table_name));
}

async function loadExistingColumns(): Promise<Map<string, Set<string>>> {
  const result = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'`,
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const columns = byTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    byTable.set(row.table_name, columns);
  }
  return byTable;
}

async function loadExistingIndexes(): Promise<Map<string, Set<string>>> {
  const result = await pool.query<{ tablename: string; indexname: string }>(
    `select tablename, indexname
       from pg_indexes
      where schemaname = 'public'`,
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const indexes = byTable.get(row.tablename) ?? new Set<string>();
    indexes.add(row.indexname);
    byTable.set(row.tablename, indexes);
  }
  return byTable;
}

async function loadExistingReloptions(): Promise<Map<string, Set<string>>> {
  const result = await pool.query<{ table_name: string; reloption: string }>(
    `select c.relname as table_name, unnest(c.reloptions) as reloption
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'`,
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const reloptions = byTable.get(row.table_name) ?? new Set<string>();
    reloptions.add(row.reloption);
    byTable.set(row.table_name, reloptions);
  }
  return byTable;
}

async function audit(): Promise<AuditRow[]> {
  const [tables, columnsByTable, indexesByTable, reloptionsByTable] =
    await Promise.all([
      loadExistingTables(),
      loadExistingColumns(),
      loadExistingIndexes(),
      loadExistingReloptions(),
    ]);

  return TABLES.map((spec) => {
    const columns = columnsByTable.get(spec.name) ?? new Set<string>();
    const indexes = indexesByTable.get(spec.name) ?? new Set<string>();
    const reloptions = reloptionsByTable.get(spec.name) ?? new Set<string>();
    return {
      table: spec.name,
      exists: tables.has(spec.name),
      missingColumns: spec.columns.filter((column) => !columns.has(column)),
      missingIndexes: spec.indexes.filter((index) => !indexes.has(index)),
      missingReloptions: (spec.reloptions ?? []).filter(
        (reloption) => !reloptions.has(reloption),
      ),
    };
  });
}

function auditMigrationFile(): string[] {
  if (!fs.existsSync(migrationsDir)) {
    return [`missing migrations dir: ${migrationsDir}`];
  }
  // Scan ALL migrations: indexes are added in dated migrations over time, not
  // only the 20260529 baseline. Match "if not exists <name>" (not
  // "index if not exists <name>") so both `CREATE INDEX IF NOT EXISTS` and
  // `CREATE INDEX CONCURRENTLY IF NOT EXISTS` satisfy the check.
  const sql = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => fs.readFileSync(path.join(migrationsDir, file), "utf8"))
    .join("\n")
    .toLowerCase();
  // reloptions are written `key = value` in migrations but returned `key=value`
  // by pg_class; compare with whitespace stripped so either form satisfies.
  const sqlNoSpace = sql.replace(/\s+/g, "");
  const failures: string[] = [];
  for (const spec of TABLES) {
    if (!sql.includes(`create table if not exists ${spec.name}`)) {
      failures.push(`migration missing table ${spec.name}`);
    }
    for (const indexName of spec.indexes) {
      if (!sql.includes(`if not exists ${indexName}`)) {
        failures.push(`migration missing index ${indexName}`);
      }
    }
    if (spec.reloptions && spec.reloptions.length > 0) {
      if (!sqlNoSpace.includes(`altertable${spec.name}set(`)) {
        failures.push(`migration missing reloptions ALTER for ${spec.name}`);
      }
      for (const reloption of spec.reloptions) {
        if (!sqlNoSpace.includes(reloption.replace(/\s+/g, ""))) {
          failures.push(
            `migration missing reloption ${reloption} on ${spec.name}`,
          );
        }
      }
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const rows = await audit();
  const migrationFailures = auditMigrationFile();
  console.table(
    rows.map((row) => ({
      table: row.table,
      exists: row.exists,
      missingColumns: row.missingColumns.join(", ") || "-",
      missingIndexes: row.missingIndexes.join(", ") || "-",
      missingReloptions: row.missingReloptions.join(", ") || "-",
    })),
  );

  const failures = rows.filter(
    (row) =>
      !row.exists ||
      row.missingColumns.length > 0 ||
      row.missingIndexes.length > 0 ||
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

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

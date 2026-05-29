import { pool } from "@workspace/db";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TableSpec = {
  name: string;
  columns: string[];
  indexes: string[];
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
      "bar_cache_instrument_idx",
      "bar_cache_symbol_timeframe_idx",
      "bar_cache_starts_at_idx",
    ],
  },
  {
    name: "option_chain_snapshots",
    columns: [
      "id",
      "underlying_instrument_id",
      "option_contract_id",
      "bid",
      "ask",
      "mark",
      "implied_volatility",
      "delta",
      "gamma",
      "open_interest",
      "volume",
      "source",
      "as_of",
    ],
    indexes: [
      "option_chain_snapshots_underlying_idx",
      "option_chain_snapshots_contract_idx",
      "option_chain_snapshots_as_of_idx",
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
const migrationPath = path.join(
  repoRoot,
  "lib/db/migrations/20260529_market_data_ingest.sql",
);

type AuditRow = {
  table: string;
  exists: boolean;
  missingColumns: string[];
  missingIndexes: string[];
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

async function audit(): Promise<AuditRow[]> {
  const [tables, columnsByTable, indexesByTable] = await Promise.all([
    loadExistingTables(),
    loadExistingColumns(),
    loadExistingIndexes(),
  ]);

  return TABLES.map((spec) => {
    const columns = columnsByTable.get(spec.name) ?? new Set<string>();
    const indexes = indexesByTable.get(spec.name) ?? new Set<string>();
    return {
      table: spec.name,
      exists: tables.has(spec.name),
      missingColumns: spec.columns.filter((column) => !columns.has(column)),
      missingIndexes: spec.indexes.filter((index) => !indexes.has(index)),
    };
  });
}

function auditMigrationFile(): string[] {
  if (!fs.existsSync(migrationPath)) {
    return [`missing migration file: ${migrationPath}`];
  }
  const sql = fs.readFileSync(migrationPath, "utf8").toLowerCase();
  const failures: string[] = [];
  for (const spec of TABLES) {
    if (!sql.includes(`create table if not exists ${spec.name}`)) {
      failures.push(`migration missing table ${spec.name}`);
    }
    for (const indexName of spec.indexes) {
      if (!sql.includes(`index if not exists ${indexName}`)) {
        failures.push(`migration missing index ${indexName}`);
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
    })),
  );

  const failures = rows.filter(
    (row) =>
      !row.exists ||
      row.missingColumns.length > 0 ||
      row.missingIndexes.length > 0,
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

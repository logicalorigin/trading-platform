import { pool } from "@workspace/db";

type TableSizeRow = {
  table_name: string;
  estimated_rows: string;
  estimated_dead_rows: string;
  total_bytes: string;
  table_bytes: string;
  index_bytes: string;
  oldest_at: Date | null;
  newest_at: Date | null;
};

const args = new Set(process.argv.slice(2));
const command = process.argv[2] ?? "audit";
const execute = args.has("--execute");

const CLEANUP_TRUNCATE_TABLES = [
  "flow_events",
  "flow_event_hydration_sessions",
  "diagnostic_snapshots",
] as const;

const UNTOUCHED_ESSENTIAL_TABLES = [
  "broker_accounts",
  "broker_orders",
  "execution_fills",
  "flex_nav_history",
  "flex_trades",
  "flex_cash_activity",
  "flex_dividends",
  "order_requests",
  "watchlists",
] as const;

function bytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString() : "-";
}

async function loadDatabaseSize(): Promise<number> {
  const result = await pool.query<{ database_bytes: string }>(
    "select pg_database_size(current_database())::text as database_bytes",
  );
  return bytes(result.rows[0]?.database_bytes ?? "0");
}

async function loadTableSizes(limit = 40): Promise<TableSizeRow[]> {
  const result = await pool.query<TableSizeRow>(
    `select c.relname as table_name,
            coalesce(s.n_live_tup, 0)::text as estimated_rows,
            coalesce(s.n_dead_tup, 0)::text as estimated_dead_rows,
            pg_total_relation_size(c.oid)::text as total_bytes,
            pg_relation_size(c.oid)::text as table_bytes,
            pg_indexes_size(c.oid)::text as index_bytes,
            case c.relname
              when 'flow_events' then (select min(occurred_at) from flow_events)
              when 'flow_event_hydration_sessions' then (select min(window_to) from flow_event_hydration_sessions)
              when 'diagnostic_snapshots' then (select min(observed_at) from diagnostic_snapshots)
              when 'bar_cache' then (select min(starts_at) from bar_cache)
              else null
            end as oldest_at,
            case c.relname
              when 'flow_events' then (select max(occurred_at) from flow_events)
              when 'flow_event_hydration_sessions' then (select max(window_to) from flow_event_hydration_sessions)
              when 'diagnostic_snapshots' then (select max(observed_at) from diagnostic_snapshots)
              when 'bar_cache' then (select max(starts_at) from bar_cache)
              else null
            end as newest_at
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public'
        and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc
      limit $1`,
    [limit],
  );
  return result.rows;
}

async function printAudit(): Promise<TableSizeRow[]> {
  const [databaseBytes, rows] = await Promise.all([
    loadDatabaseSize(),
    loadTableSizes(),
  ]);
  console.log(`database_size=${formatBytes(databaseBytes)}`);
  console.table(
    rows.map((row) => ({
      table: row.table_name,
      rows: Number(row.estimated_rows),
      deadRows: Number(row.estimated_dead_rows),
      total: formatBytes(bytes(row.total_bytes)),
      tableSize: formatBytes(bytes(row.table_bytes)),
      indexes: formatBytes(bytes(row.index_bytes)),
      oldest: formatDate(row.oldest_at),
      newest: formatDate(row.newest_at),
    })),
  );
  return rows;
}

async function cleanup(): Promise<void> {
  const rows = await printAudit();
  const reclaimableBytes = rows
    .filter((row) =>
      CLEANUP_TRUNCATE_TABLES.includes(
        row.table_name as (typeof CLEANUP_TRUNCATE_TABLES)[number],
      ),
    )
    .reduce((total, row) => total + bytes(row.total_bytes), 0);

  console.log(`cleanup_tables=${CLEANUP_TRUNCATE_TABLES.join(",")}`);
  console.log(`estimated_reclaimable=${formatBytes(reclaimableBytes)}`);
  console.log(`untouched_essential_tables=${UNTOUCHED_ESSENTIAL_TABLES.join(",")}`);

  if (!execute) {
    console.log("dry_run=true");
    console.log("Pass --execute to truncate rehydratable storage tables.");
    return;
  }

  console.log("dry_run=false");
  await pool.query(`truncate table ${CLEANUP_TRUNCATE_TABLES.join(", ")}`);
  for (const table of CLEANUP_TRUNCATE_TABLES) {
    await pool.query(`vacuum analyze ${table}`);
  }
  console.log("cleanup_complete=true");
  await printAudit();
}

async function main(): Promise<void> {
  if (command === "audit") {
    await printAudit();
    return;
  }
  if (command === "cleanup") {
    await cleanup();
    return;
  }
  throw new Error("Usage: pnpm db:storage:audit | pnpm db:storage:cleanup [-- --execute]");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

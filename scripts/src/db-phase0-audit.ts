import { pool } from "@workspace/db";

type TableRole =
  | "cache"
  | "catalog"
  | "diagnostic"
  | "job-queue"
  | "ledger"
  | "snapshot"
  | "state";

type TableSpec = {
  name: string;
  role: TableRole;
  timeColumn?: string;
  note: string;
};

type TableMetricRow = {
  table_name: string;
  estimated_rows: string;
  estimated_dead_rows: string;
  total_bytes: string;
  table_bytes: string;
  index_bytes: string;
  last_vacuum: Date | null;
  last_autovacuum: Date | null;
  last_analyze: Date | null;
  last_autoanalyze: Date | null;
  reloptions: string[] | null;
};

type IndexMetricRow = {
  table_name: string;
  index_name: string;
  index_bytes: string;
  idx_scan: string;
};

type ColumnRow = {
  table_name: string;
  column_name: string;
};

type TimeRange = {
  oldest: Date | string | null;
  newest: Date | string | null;
  error?: string;
};

type ExtensionRow = {
  name: string;
  installed: boolean;
  available: boolean;
  default_version: string | null;
  installed_version: string | null;
};

type Finding = {
  severity: "info" | "watch" | "risk";
  table: string;
  issue: string;
  detail: string;
};

const FOCUS_TABLES: TableSpec[] = [
  {
    name: "bar_cache",
    role: "cache",
    timeColumn: "starts_at",
    note: "Largest market-data cache; retention/partitioning should be source-aware.",
  },
  {
    name: "quote_cache",
    role: "cache",
    timeColumn: "as_of",
    note: "Latest quote cache; usually safe to bound by freshness once readers are checked.",
  },
  {
    name: "option_chain_snapshots",
    role: "cache",
    timeColumn: "as_of",
    note: "Legacy append table; live latest-chain path now uses option_chain_latest.",
  },
  {
    name: "option_chain_latest",
    role: "cache",
    timeColumn: "as_of",
    note: "Current latest option-chain cache; do not remove producer writes.",
  },
  {
    name: "option_contracts",
    role: "catalog",
    timeColumn: "created_at",
    note: "Option catalog; cleanup depends on expiry and reader coverage.",
  },
  {
    name: "instruments",
    role: "catalog",
    timeColumn: "created_at",
    note: "Instrument catalog; generally compact rather than truncate.",
  },
  {
    name: "market_data_ingest_jobs",
    role: "job-queue",
    timeColumn: "created_at",
    note: "Job rows can be prerequisites for later jobs; prune by state machine rules only.",
  },
  {
    name: "provider_request_log",
    role: "diagnostic",
    timeColumn: "created_at",
    note: "Provider audit trail; retention can usually be age-based after observability needs are set.",
  },
  {
    name: "gex_snapshots",
    role: "snapshot",
    timeColumn: "computed_at",
    note: "Derived GEX snapshots; empty bloat is a maintenance candidate.",
  },
  {
    name: "flow_summaries",
    role: "snapshot",
    timeColumn: "window_end",
    note: "Derived flow rollups; retention should follow UI/backtest window needs.",
  },
  {
    name: "flow_events",
    role: "ledger",
    timeColumn: "occurred_at",
    note: "Raw flow events; truncation is only safe if all readers can rehydrate.",
  },
  {
    name: "flow_event_hydration_sessions",
    role: "diagnostic",
    timeColumn: "window_to",
    note: "Hydration bookkeeping; likely bounded, but keep enough to prevent repeated work.",
  },
  {
    name: "flow_universe_rankings",
    role: "state",
    timeColumn: "ranked_at",
    note: "Current universe/ranking state; prefer upsert/compaction over history deletes.",
  },
  {
    name: "execution_events",
    role: "ledger",
    timeColumn: "occurred_at",
    note: "Load-bearing execution/idempotency ledger; no flat age pruning.",
  },
  {
    name: "automation_diagnostics",
    role: "diagnostic",
    timeColumn: "occurred_at",
    note: "High-volume diagnostics split from execution_events; needs complete writer coverage.",
  },
  {
    name: "signal_monitor_symbol_states",
    role: "state",
    timeColumn: "last_evaluated_at",
    note: "Standing state table; cleanup should preserve one current row per profile/symbol/timeframe.",
  },
  {
    name: "signal_monitor_events",
    role: "ledger",
    timeColumn: "signal_at",
    note: "Signal event history feeds state reconstruction/breadth seeds; no flat age pruning.",
  },
  {
    name: "signal_monitor_breadth_snapshots",
    role: "snapshot",
    timeColumn: "captured_at",
    note: "Breadth history; likely safe to bound once chart windows are confirmed.",
  },
  {
    name: "diagnostic_snapshots",
    role: "diagnostic",
    timeColumn: "observed_at",
    note: "Operational diagnostics; age-based retention is a likely safe target.",
  },
  {
    name: "historical_bars",
    role: "cache",
    timeColumn: "starts_at",
    note: "Backtest/cache bars; empty bloat is a maintenance candidate.",
  },
  {
    name: "mtf_pattern_occurrences",
    role: "diagnostic",
    timeColumn: "occurred_at",
    note: "Optional backtest drill-down rows; empty bloat is a maintenance candidate.",
  },
  {
    name: "position_lots",
    role: "ledger",
    timeColumn: "as_of",
    note: "Real account lots reader exists; do not classify as dead without checking live usage.",
  },
  {
    name: "balance_snapshots",
    role: "snapshot",
    timeColumn: "as_of",
    note: "Account balance history; retention depends on account reporting needs.",
  },
  {
    name: "shadow_position_marks",
    role: "snapshot",
    timeColumn: "as_of",
    note: "Shadow mark history; schema uses as_of, not marked_at.",
  },
  {
    name: "shadow_orders",
    role: "ledger",
    timeColumn: "placed_at",
    note: "Shadow trading order ledger; do not prune without archive/audit policy.",
  },
  {
    name: "shadow_fills",
    role: "ledger",
    timeColumn: "occurred_at",
    note: "Shadow trading fill ledger; do not prune without archive/audit policy.",
  },
  {
    name: "shadow_positions",
    role: "state",
    timeColumn: "as_of",
    note: "Shadow position state; cleanup must respect open/closed position readers.",
  },
];

const EXTENSIONS = ["pg_cron", "pg_partman", "pg_stat_statements"];

function parseLimit(): number {
  const args = process.argv.slice(2);
  const index = args.indexOf("--limit");
  if (index === -1) {
    return 30;
  }
  const raw = args[index + 1];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error("Usage: pnpm db:phase0:audit [-- --limit 1..200]");
  }
  return parsed;
}

function bytes(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
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

function formatDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "-";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function quoteIdent(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "-";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function otherRelationBytes(row: TableMetricRow): number {
  return Math.max(
    0,
    bytes(row.total_bytes) - bytes(row.table_bytes) - bytes(row.index_bytes),
  );
}

async function loadDatabaseSize(): Promise<number> {
  const result = await pool.query<{ database_bytes: string }>(
    "select pg_database_size(current_database())::text as database_bytes",
  );
  return bytes(result.rows[0]?.database_bytes);
}

async function loadTableMetrics(): Promise<Map<string, TableMetricRow>> {
  const result = await pool.query<TableMetricRow>(
    `select c.relname as table_name,
            coalesce(s.n_live_tup, 0)::text as estimated_rows,
            coalesce(s.n_dead_tup, 0)::text as estimated_dead_rows,
            pg_total_relation_size(c.oid)::text as total_bytes,
            pg_relation_size(c.oid)::text as table_bytes,
            pg_indexes_size(c.oid)::text as index_bytes,
            s.last_vacuum,
            s.last_autovacuum,
            s.last_analyze,
            s.last_autoanalyze,
            c.reloptions
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public'
        and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc`,
  );
  return new Map(result.rows.map((row) => [row.table_name, row]));
}

async function loadColumns(): Promise<Map<string, Set<string>>> {
  const result = await pool.query<ColumnRow>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'`,
  );
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  return columnsByTable;
}

async function loadIndexMetrics(): Promise<IndexMetricRow[]> {
  const result = await pool.query<IndexMetricRow>(
    `select table_class.relname as table_name,
            index_class.relname as index_name,
            pg_relation_size(index_class.oid)::text as index_bytes,
            coalesce(stats.idx_scan, 0)::text as idx_scan
       from pg_index idx
       join pg_class table_class on table_class.oid = idx.indrelid
       join pg_class index_class on index_class.oid = idx.indexrelid
       join pg_namespace namespace on namespace.oid = table_class.relnamespace
       left join pg_stat_user_indexes stats on stats.indexrelid = index_class.oid
      where namespace.nspname = 'public'
      order by pg_relation_size(index_class.oid) desc`,
  );
  return result.rows;
}

async function loadExtensions(): Promise<ExtensionRow[]> {
  const result = await pool.query<ExtensionRow>(
    `select available.name,
            installed.extname is not null as installed,
            available.installed_version is not null
              or available.default_version is not null as available,
            available.default_version,
            installed.extversion as installed_version
       from pg_available_extensions available
       left join pg_extension installed on installed.extname = available.name
      where available.name = any($1::text[])
      order by available.name`,
    [EXTENSIONS],
  );
  return result.rows;
}

async function loadTimeRange(
  tableName: string,
  timeColumn: string,
): Promise<TimeRange> {
  try {
    const result = await pool.query<{ oldest: Date | string | null; newest: Date | string | null }>(
      `select min(${quoteIdent(timeColumn)}) as oldest,
              max(${quoteIdent(timeColumn)}) as newest
         from public.${quoteIdent(tableName)}`,
    );
    return {
      oldest: result.rows[0]?.oldest ?? null,
      newest: result.rows[0]?.newest ?? null,
    };
  } catch (error) {
    return {
      oldest: null,
      newest: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadTimeRanges(
  metricsByTable: Map<string, TableMetricRow>,
  columnsByTable: Map<string, Set<string>>,
): Promise<Map<string, TimeRange>> {
  const ranges = new Map<string, TimeRange>();
  for (const spec of FOCUS_TABLES) {
    if (!spec.timeColumn || !metricsByTable.has(spec.name)) {
      continue;
    }
    const columns = columnsByTable.get(spec.name);
    if (!columns?.has(spec.timeColumn)) {
      ranges.set(spec.name, {
        oldest: null,
        newest: null,
        error: `missing column ${spec.timeColumn}`,
      });
      continue;
    }
    ranges.set(spec.name, await loadTimeRange(spec.name, spec.timeColumn));
  }
  return ranges;
}

function buildFindings(
  metricsByTable: Map<string, TableMetricRow>,
  rangesByTable: Map<string, TimeRange>,
): Finding[] {
  const findings: Finding[] = [];
  const focusTables = new Set(FOCUS_TABLES.map((spec) => spec.name));
  for (const [table, row] of metricsByTable) {
    const liveRows = bytes(row.estimated_rows);
    const deadRows = bytes(row.estimated_dead_rows);
    const total = bytes(row.total_bytes);
    const indexTotal = bytes(row.index_bytes);
    const otherTotal = otherRelationBytes(row);
    const range = rangesByTable.get(table);
    const hasObservedTimeRange = Boolean(
      range && !range.error && (range.oldest || range.newest),
    );

    if (liveRows === 0 && total >= 50 * 1024 * 1024) {
      if (hasObservedTimeRange) {
        findings.push({
          severity: "watch",
          table,
          issue: "row_stats_stale_or_unanalyzed",
          detail: `${formatBytes(total)} allocated; row estimate is 0 but time range is ${formatDate(range?.oldest)} to ${formatDate(range?.newest)}`,
        });
      } else if (focusTables.has(table)) {
        findings.push({
          severity: "risk",
          table,
          issue: "estimated_empty_but_large",
          detail: `${formatBytes(total)} still allocated with estimated 0 live rows and no observed time range`,
        });
      } else {
        findings.push({
          severity: "watch",
          table,
          issue: "estimated_empty_large_unverified",
          detail: `${formatBytes(total)} still allocated with estimated 0 live rows; add this table to focus specs before cleanup decisions`,
        });
      }
    }

    if (total >= 50 * 1024 * 1024 && indexTotal / Math.max(total, 1) >= 0.65) {
      findings.push({
        severity: "watch",
        table,
        issue: "index_heavy",
        detail: `${formatBytes(indexTotal)} of ${formatBytes(total)} is indexes`,
      });
    }

    if (total >= 50 * 1024 * 1024 && otherTotal / Math.max(total, 1) >= 0.5) {
      findings.push({
        severity: "watch",
        table,
        issue: "toast_or_aux_heavy",
        detail: `${formatBytes(otherTotal)} of ${formatBytes(total)} is TOAST/auxiliary storage`,
      });
    }

    if (deadRows >= 1_000 && deadRows / Math.max(liveRows, 1) >= 0.1) {
      findings.push({
        severity: "watch",
        table,
        issue: "dead_rows_high",
        detail: `estimated ${deadRows.toLocaleString()} dead rows vs ${liveRows.toLocaleString()} live rows`,
      });
    }
  }

  for (const spec of FOCUS_TABLES) {
    const range = rangesByTable.get(spec.name);
    if (range?.error) {
      findings.push({
        severity: "watch",
        table: spec.name,
        issue: "time_range_probe_failed",
        detail: range.error,
      });
    }
    if (spec.role === "ledger") {
      findings.push({
        severity: "info",
        table: spec.name,
        issue: "load_bearing",
        detail: spec.note,
      });
    }
  }

  return findings.sort((left, right) => {
    const order = { risk: 0, watch: 1, info: 2 } as const;
    return order[left.severity] - order[right.severity];
  });
}

function printFocusTables(
  metricsByTable: Map<string, TableMetricRow>,
  rangesByTable: Map<string, TimeRange>,
): void {
  console.log("\nfocus_tables");
  console.table(
    FOCUS_TABLES.map((spec) => {
      const row = metricsByTable.get(spec.name);
      const range = rangesByTable.get(spec.name);
      return {
        table: spec.name,
        role: spec.role,
        rowsEst: row ? Number(row.estimated_rows) : "missing",
        deadEst: row ? Number(row.estimated_dead_rows) : "missing",
        total: row ? formatBytes(bytes(row.total_bytes)) : "-",
        indexes: row ? formatBytes(bytes(row.index_bytes)) : "-",
        toastOther: row ? formatBytes(otherRelationBytes(row)) : "-",
        idxPct: row ? pct(bytes(row.index_bytes), bytes(row.total_bytes)) : "-",
        timeColumn: spec.timeColumn ?? "-",
        oldest: formatDate(range?.oldest),
        newest: formatDate(range?.newest),
      };
    }),
  );
}

function printTopTables(
  metricsByTable: Map<string, TableMetricRow>,
  limit: number,
): void {
  const rows = [...metricsByTable.values()]
    .sort((left, right) => bytes(right.total_bytes) - bytes(left.total_bytes))
    .slice(0, limit);

  console.log(`\ntop_tables_by_size limit=${limit}`);
  console.table(
    rows.map((row) => ({
      table: row.table_name,
      rowsEst: Number(row.estimated_rows),
      deadEst: Number(row.estimated_dead_rows),
      total: formatBytes(bytes(row.total_bytes)),
      tableSize: formatBytes(bytes(row.table_bytes)),
      indexes: formatBytes(bytes(row.index_bytes)),
      toastOther: formatBytes(otherRelationBytes(row)),
      lastVacuum: formatDate(row.last_vacuum ?? row.last_autovacuum),
      lastAnalyze: formatDate(row.last_analyze ?? row.last_autoanalyze),
      reloptions: row.reloptions?.join(",") || "-",
    })),
  );
}

function printTopIndexes(indexRows: IndexMetricRow[], limit: number): void {
  console.log(`\ntop_indexes_by_size limit=${limit}`);
  console.table(
    indexRows.slice(0, limit).map((row) => ({
      table: row.table_name,
      index: row.index_name,
      size: formatBytes(bytes(row.index_bytes)),
      idxScan: Number(row.idx_scan),
    })),
  );
}

function printExtensions(rows: ExtensionRow[]): void {
  console.log("\nextensions");
  console.table(
    EXTENSIONS.map((name) => {
      const row = rows.find((candidate) => candidate.name === name);
      return {
        extension: name,
        installed: row?.installed ?? false,
        available: row?.available ?? false,
        installedVersion: row?.installed_version ?? "-",
        defaultVersion: row?.default_version ?? "-",
      };
    }),
  );
}

function printFindings(findings: Finding[]): void {
  console.log("\nfindings");
  if (findings.length === 0) {
    console.log("none");
    return;
  }
  console.table(findings);
}

async function main(): Promise<void> {
  const limit = parseLimit();
  const [databaseBytes, metricsByTable, columnsByTable, indexRows, extensions] =
    await Promise.all([
      loadDatabaseSize(),
      loadTableMetrics(),
      loadColumns(),
      loadIndexMetrics(),
      loadExtensions(),
    ]);
  const rangesByTable = await loadTimeRanges(metricsByTable, columnsByTable);
  const findings = buildFindings(metricsByTable, rangesByTable);
  const missingFocusTables = FOCUS_TABLES.filter(
    (spec) => !metricsByTable.has(spec.name),
  );
  const failedRangeTables = [...rangesByTable.entries()].filter(
    ([, range]) => Boolean(range.error),
  );

  console.log("DB Phase 0 audit (read-only)");
  console.log("row_counts=postgres_estimates_not_count_star");
  console.log(`database_size=${formatBytes(databaseBytes)}`);
  console.log(`public_tables=${metricsByTable.size}`);
  console.log(`missing_focus_tables=${missingFocusTables.length}`);
  console.log(`time_range_probe_errors=${failedRangeTables.length}`);

  printFocusTables(metricsByTable, rangesByTable);
  printTopTables(metricsByTable, limit);
  printTopIndexes(indexRows, Math.min(limit, 30));
  printExtensions(extensions);
  printFindings(findings);

  if (missingFocusTables.length > 0 || failedRangeTables.length > 0) {
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

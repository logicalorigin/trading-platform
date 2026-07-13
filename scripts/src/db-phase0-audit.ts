import { pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { pool } from "@workspace/db";
import { isStatementTimeoutError } from "@workspace/db/transient-postgres-error";

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

type LeadingIndexColumnRow = {
  table_name: string;
  column_name: string;
};

type TimeRange = {
  oldest: Date | string | null;
  newest: Date | string | null;
  error?: string;
  skipped?: string;
};

type TimeRangeProbeMode = "indexed" | "full-scan";

type TimeRangeProbePlan =
  | { mode: TimeRangeProbeMode }
  | { mode: "failed" | "skipped"; detail: string };

type AuditArgs = {
  limit: number;
  fullScanRanges: boolean;
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

const USAGE =
  "Usage: pnpm run db:phase0:audit -- [--limit 1..200] [--full-scan-ranges]";
const DEFAULT_LIMIT = 30;
const DEFAULT_FULL_SCAN_MAX_BYTES = 50 * 1024 * 1024;
const MAX_DIAGNOSTIC_LENGTH = 400;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

// ponytail: keep this maintenance focus local until roadmap Task 12 provides a
// shared table-family lifecycle registry; top-table metrics still cover every
// public table outside this curated set.
const FOCUS_TABLES: TableSpec[] = [
  {
    name: "bar_cache",
    role: "cache",
    timeColumn: "starts_at",
    note: "Largest market-data cache; current retention is timeframe-aware and partitioning remains a later decision.",
  },
  {
    name: "quote_cache",
    role: "cache",
    timeColumn: "as_of",
    note: "Latest quote cache; usually safe to bound by freshness once readers are checked.",
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
    timeColumn: "expiration_date",
    note: "Option catalog; expiry is the relevant cleanup boundary and reader coverage must be proven first.",
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
    note: "Load-bearing execution/idempotency ledger; only allowlisted diagnostic categories have bounded retention.",
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
    note: "Standing state table; implemented retention removes only inactive cells beyond its configured window.",
  },
  {
    name: "signal_monitor_events",
    role: "ledger",
    timeColumn: "signal_at",
    note: "Signal history feeds reconstruction and breadth; retention preserves the latest trusted event per cell.",
  },
  {
    name: "signal_monitor_breadth_snapshots",
    role: "snapshot",
    timeColumn: "captured_at",
    note: "Breadth history has implemented age-based retention aligned with its chart window.",
  },
  {
    name: "diagnostic_snapshots",
    role: "diagnostic",
    timeColumn: "observed_at",
    note: "Operational diagnostics are self-pruned by their collector.",
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
    note: "Account balance history has implemented age-based retention for reporting windows.",
  },
  {
    name: "shadow_balance_snapshots",
    role: "snapshot",
    timeColumn: "as_of",
    note: "Live shadow balances have source-aware retention; replay and backtest sources are excluded.",
  },
  {
    name: "shadow_position_marks",
    role: "snapshot",
    timeColumn: "as_of",
    note: "Implemented retention removes old marks only for positions already closed beyond the cutoff.",
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

function parseAuditArgs(args = process.argv.slice(2)): AuditArgs {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  try {
    const parsed = parseArgs({
      args: normalizedArgs,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        limit: { type: "string" },
        "full-scan-ranges": { type: "boolean" },
      },
    });
    for (const name of ["limit", "full-scan-ranges"] as const) {
      const occurrences = parsed.tokens.filter(
        (token) => token.kind === "option" && token.name === name,
      ).length;
      if (occurrences > 1) {
        throw new Error(USAGE);
      }
    }

    const rawLimit = parsed.values.limit;
    if (rawLimit !== undefined && !/^[1-9]\d{0,2}$/u.test(rawLimit)) {
      throw new Error(USAGE);
    }
    const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error(USAGE);
    }
    return {
      limit,
      fullScanRanges: parsed.values["full-scan-ranges"] ?? false,
    };
  } catch {
    throw new Error(USAGE);
  }
}

function bytes(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function safeOutput(value: unknown, maxLength = MAX_DIAGNOSTIC_LENGTH): string {
  const withoutCredentials = String(value ?? "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/\s+/gu, " ");
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(0, maxLength - 1))}…`;
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (isStatementTimeoutError(error)) {
    return safeOutput(
      "Statement timeout during the audit. Inspect database load or locks before rerunning; use --full-scan-ranges only in a controlled maintenance window when an exact unindexed range is required.",
    );
  }
  return (
    safeOutput(raw || "Unknown database error") || "Unknown database error"
  );
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
    return Number.isFinite(value.getTime())
      ? value.toISOString()
      : "invalid-date";
  }
  return safeOutput(value);
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

async function loadLeadingIndexColumns(): Promise<Map<string, Set<string>>> {
  const result = await pool.query<LeadingIndexColumnRow>(
    `select table_class.relname as table_name,
            attribute.attname as column_name
       from pg_index idx
       join pg_class table_class on table_class.oid = idx.indrelid
       join pg_class index_class on index_class.oid = idx.indexrelid
       join pg_am access_method on access_method.oid = index_class.relam
       join pg_namespace namespace on namespace.oid = table_class.relnamespace
       cross join lateral unnest(idx.indkey)
         with ordinality as key_column(attnum, ordinality)
       join pg_attribute attribute
         on attribute.attrelid = idx.indrelid
        and attribute.attnum = key_column.attnum
      where namespace.nspname = 'public'
        and key_column.ordinality = 1
        and access_method.amname = 'btree'
        and idx.indisvalid
        and idx.indisready
        and idx.indpred is null
        and idx.indexprs is null`,
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

function planTimeRangeProbe(
  spec: TableSpec,
  metric: TableMetricRow,
  columns: Set<string>,
  leadingIndexColumns: Set<string>,
  fullScanRanges: boolean,
): TimeRangeProbePlan {
  const timeColumn = spec.timeColumn;
  if (!timeColumn) {
    return { mode: "skipped", detail: "no time column is configured" };
  }
  if (!columns.has(timeColumn)) {
    return {
      mode: "failed",
      detail: `configured time column is missing: ${timeColumn}`,
    };
  }
  if (leadingIndexColumns.has(timeColumn)) {
    return { mode: "indexed" };
  }
  if (
    fullScanRanges ||
    bytes(metric.table_bytes) <= DEFAULT_FULL_SCAN_MAX_BYTES
  ) {
    return { mode: "full-scan" };
  }
  return {
    mode: "skipped",
    detail: `${formatBytes(bytes(metric.table_bytes))} table heap has no complete leading btree index on ${timeColumn}; exact range skipped to avoid an implicit full scan. Rerun with --full-scan-ranges only in a controlled maintenance window.`,
  };
}

async function loadTimeRange(
  tableName: string,
  timeColumn: string,
  mode: TimeRangeProbeMode,
  query: (sql: string) => Promise<{
    rows: Array<{
      oldest: Date | string | null;
      newest: Date | string | null;
    }>;
  }> = (sql) => pool.query(sql),
): Promise<TimeRange> {
  try {
    const column = quoteIdent(timeColumn);
    const table = `public.${quoteIdent(tableName)}`;
    const sql =
      mode === "indexed"
        ? `select (select ${column}
                     from ${table}
                    where ${column} is not null
                    order by ${column} asc
                    limit 1) as oldest,
                  (select ${column}
                     from ${table}
                    where ${column} is not null
                    order by ${column} desc
                    limit 1) as newest`
        : `select min(${column}) as oldest,
                  max(${column}) as newest
             from ${table}`;
    const result = await query(sql);
    return {
      oldest: result.rows[0]?.oldest ?? null,
      newest: result.rows[0]?.newest ?? null,
    };
  } catch (error) {
    return {
      oldest: null,
      newest: null,
      error: safeDiagnostic(error),
    };
  }
}

async function loadTimeRanges(
  metricsByTable: Map<string, TableMetricRow>,
  columnsByTable: Map<string, Set<string>>,
  leadingIndexColumnsByTable: Map<string, Set<string>>,
  fullScanRanges: boolean,
): Promise<Map<string, TimeRange>> {
  const ranges = new Map<string, TimeRange>();
  for (const spec of FOCUS_TABLES) {
    const metric = metricsByTable.get(spec.name);
    if (!spec.timeColumn || !metric) {
      continue;
    }
    const plan = planTimeRangeProbe(
      spec,
      metric,
      columnsByTable.get(spec.name) ?? new Set(),
      leadingIndexColumnsByTable.get(spec.name) ?? new Set(),
      fullScanRanges,
    );
    if (plan.mode === "failed") {
      ranges.set(spec.name, {
        oldest: null,
        newest: null,
        error: plan.detail,
      });
      continue;
    }
    if (plan.mode === "skipped") {
      ranges.set(spec.name, {
        oldest: null,
        newest: null,
        skipped: plan.detail,
      });
      continue;
    }
    ranges.set(
      spec.name,
      await loadTimeRange(spec.name, spec.timeColumn, plan.mode),
    );
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

    if (liveRows === 0 && total >= DEFAULT_FULL_SCAN_MAX_BYTES) {
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

    if (
      total >= DEFAULT_FULL_SCAN_MAX_BYTES &&
      indexTotal / Math.max(total, 1) >= 0.65
    ) {
      findings.push({
        severity: "watch",
        table,
        issue: "index_heavy",
        detail: `${formatBytes(indexTotal)} of ${formatBytes(total)} is indexes`,
      });
    }

    if (
      total >= DEFAULT_FULL_SCAN_MAX_BYTES &&
      otherTotal / Math.max(total, 1) >= 0.5
    ) {
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
    if (range?.skipped) {
      findings.push({
        severity: "watch",
        table: spec.name,
        issue: "time_range_probe_skipped_unindexed",
        detail: range.skipped,
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

function failedTimeRangeTables(
  rangesByTable: Map<string, TimeRange>,
): Array<[string, TimeRange]> {
  return [...rangesByTable.entries()].filter(([, range]) =>
    Boolean(range.error),
  );
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
        rangeProbe: range?.error
          ? "failed"
          : range?.skipped
            ? "skipped"
            : range
              ? "observed"
              : "-",
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
      table: safeOutput(row.table_name),
      rowsEst: Number(row.estimated_rows),
      deadEst: Number(row.estimated_dead_rows),
      total: formatBytes(bytes(row.total_bytes)),
      tableSize: formatBytes(bytes(row.table_bytes)),
      indexes: formatBytes(bytes(row.index_bytes)),
      toastOther: formatBytes(otherRelationBytes(row)),
      lastVacuum: formatDate(row.last_vacuum ?? row.last_autovacuum),
      lastAnalyze: formatDate(row.last_analyze ?? row.last_autoanalyze),
      reloptions: row.reloptions
        ? safeOutput(row.reloptions.join(",")) || "-"
        : "-",
    })),
  );
}

function printTopIndexes(indexRows: IndexMetricRow[], limit: number): void {
  console.log(`\ntop_indexes_by_size limit=${limit}`);
  console.table(
    indexRows.slice(0, limit).map((row) => ({
      table: safeOutput(row.table_name),
      index: safeOutput(row.index_name),
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
        installedVersion: row?.installed_version
          ? safeOutput(row.installed_version)
          : "-",
        defaultVersion: row?.default_version
          ? safeOutput(row.default_version)
          : "-",
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
  console.table(
    findings.map((finding) => ({
      ...finding,
      table: safeOutput(finding.table),
      issue: safeOutput(finding.issue),
      detail: safeOutput(finding.detail),
    })),
  );
}

async function main(): Promise<void> {
  const { limit, fullScanRanges } = parseAuditArgs();
  // Keep this standalone audit at two concurrent reads even when callers have
  // not opted into the small script pool profile. Catalog inspection should
  // not compete with the live API for six connections at once.
  const [databaseBytes, metricsByTable] = await Promise.all([
    loadDatabaseSize(),
    loadTableMetrics(),
  ]);
  const [columnsByTable, leadingIndexColumnsByTable] = await Promise.all([
    loadColumns(),
    loadLeadingIndexColumns(),
  ]);
  const [indexRows, extensions] = await Promise.all([
    loadIndexMetrics(),
    loadExtensions(),
  ]);
  const rangesByTable = await loadTimeRanges(
    metricsByTable,
    columnsByTable,
    leadingIndexColumnsByTable,
    fullScanRanges,
  );
  const findings = buildFindings(metricsByTable, rangesByTable);
  const missingFocusTables = FOCUS_TABLES.filter(
    (spec) => !metricsByTable.has(spec.name),
  );
  const failedRangeTables = failedTimeRangeTables(rangesByTable);
  const skippedRangeTables = [...rangesByTable.values()].filter((range) =>
    Boolean(range.skipped),
  );

  console.log("DB Phase 0 audit (read-only)");
  console.log("row_counts=postgres_estimates_not_count_star");
  console.log(`full_scan_ranges=${fullScanRanges}`);
  console.log(`database_size=${formatBytes(databaseBytes)}`);
  console.log(`public_tables=${metricsByTable.size}`);
  console.log(`missing_focus_tables=${missingFocusTables.length}`);
  console.log(`time_range_probe_errors=${failedRangeTables.length}`);
  console.log(`time_range_probes_skipped=${skippedRangeTables.length}`);

  printFocusTables(metricsByTable, rangesByTable);
  printTopTables(metricsByTable, limit);
  printTopIndexes(indexRows, Math.min(limit, 30));
  printExtensions(extensions);
  printFindings(findings);

  if (missingFocusTables.length > 0 || failedRangeTables.length > 0) {
    process.exitCode = 1;
  }
}

export const __dbPhase0AuditInternalsForTests = {
  DEFAULT_FULL_SCAN_MAX_BYTES,
  FOCUS_TABLES,
  MAX_DIAGNOSTIC_LENGTH,
  buildFindings,
  failedTimeRangeTables,
  loadLeadingIndexColumns,
  loadTimeRange,
  parseAuditArgs,
  planTimeRangeProbe,
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

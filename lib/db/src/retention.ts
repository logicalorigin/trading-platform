import { inArray, sql, type SQL } from "drizzle-orm";

import { db } from "./index";
import {
  balanceSnapshotsTable,
  barCacheTable,
  diagnosticEventsTable,
  diagnosticSnapshotsTable,
  executionEventsTable,
  shadowBalanceSnapshotsTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
  signalMonitorBreadthSnapshotsTable,
  signalMonitorEventsTable,
  signalMonitorSymbolStatesTable,
} from "./schema";

/**
 * Snapshot/diagnostic retention for the TS-owned append-style tables
 * (DB maintenance roadmap Phase 2, Task 7). Each function is dry-run by default,
 * deletes in bounded batches to cap lock/WAL pressure, and documents the exact
 * reader requirement it preserves. These run against the shared `db` proxy, so
 * the PGlite test harness exercises the real SQL.
 *
 * `shadow_balance_snapshots` retention is source-aware: it only touches live
 * wall-clock sources and never the simulation sources whose `as_of` is simulated
 * time and which are managed by their own range-scoped cleanup paths.
 *
 * Diagnostic history is owned here too: collector ticks only write current
 * observations, while the durable scheduler performs bounded 24h pruning.
 * See docs/plans/db-maintenance-roadmap-2026-06-25.md.
 */

/**
 * Snapshot sources whose `as_of` is SIMULATED time, not wall-clock — written by
 * replay/backtest runs and cleaned up by their own range-scoped delete paths
 * (`resetSignalOptionsReplayRowsForRange`, `resetWatchlistBacktestRowsForRange`,
 * `backfillSignalOptionsReplayEquitySnapshotsFromRun` in shadow-account.ts).
 * Age-based retention must NEVER touch these. Mirrors the source constants and
 * compact `watchlist_bt:*` range source in shadow-account.ts.
 * ponytail: keep this lower-layer allowlist local until the API writer imports
 * shared source identifiers from @workspace/db; the PGlite contract guards drift.
 */
const SIMULATION_SHADOW_BALANCE_SOURCES = [
  "signal_options_replay",
  "signal_options_replay_mark",
  "watchlist_backtest",
  "watchlist_backtest_mark",
  "signal_options_backfill",
] as const;

/** Outcome of one table's retention sweep. */
export type RetentionResult = {
  table: string;
  /** Rows strictly older than this are eligible (ISO 8601). */
  cutoff: string;
  /** Rows observed matching before delete; a capped/failed sweep is a lower bound. */
  candidates: number;
  /** Rows actually deleted (0 when dryRun). */
  deleted: number;
  /** True when this run stopped at a per-run delete cap. */
  hitCap: boolean;
  /** Wall-clock time spent in this table sweep. */
  durationMs: number;
  dryRun: boolean;
  /**
   * Set when this table's sweep threw (e.g. a statement timeout under load):
   * any completed paged/batched progress remains reported; failures before
   * progress still report zero. The OTHER tables' sweeps continue to run. A
   * chain that aborted on first error once silently disabled every later table's
   * retention for days — failures must stay isolated and visible.
   */
  error?: string;
};

export type RetentionOptions = {
  /** Age threshold in days; rows older than `now - retentionDays` are eligible. */
  retentionDays: number;
  /** Clock injection for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
  /** Max rows deleted per statement, to bound lock/WAL pressure. */
  batchSize?: number;
  /** When true (the default), count candidates but delete nothing. */
  dryRun?: boolean;
};

export const DEFAULT_RETENTION_BATCH_SIZE = 5_000;

function resolve(opts: RetentionOptions): {
  dryRun: boolean;
  batchSize: number;
  cutoff: Date;
} {
  const now = opts.now ?? new Date();
  return {
    dryRun: opts.dryRun ?? true,
    batchSize: opts.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE,
    cutoff: new Date(now.getTime() - opts.retentionDays * 86_400_000),
  };
}

/**
 * Count the deletable set, then (unless dry-run) delete it in bounded batches
 * until none remain. The predicate is stable as rows disappear, so the loop
 * converges; the preserved rows (latest-per-key, open positions) never match it.
 */
async function sweep(input: {
  table: string;
  cutoff: Date;
  dryRun: boolean;
  /** `select count(*)::int as n ...` over the deletable set. */
  count: SQL;
  /** `delete ... limit <batch> returning id` over the deletable set. */
  deleteBatch: SQL;
}): Promise<RetentionResult> {
  const startedAt = Date.now();
  const counted = await db.execute<{ n: number }>(input.count);
  const candidates = Number(counted.rows[0]?.n ?? 0);

  let deleted = 0;
  let drainError: string | undefined;
  if (!input.dryRun && candidates > 0) {
    for (;;) {
      // A mid-drain failure (e.g. statement timeout under load) must not
      // erase the progress report: batches already deleted are committed, so
      // return the real count with the error instead of throwing it away.
      let removed;
      try {
        removed = await db.execute<{ id: string }>(input.deleteBatch);
      } catch (error) {
        drainError =
          error instanceof Error ? error.message : String(error);
        break;
      }
      if (removed.rows.length === 0) break;
      deleted += removed.rows.length;
    }
  }

  return {
    table: input.table,
    cutoff: input.cutoff.toISOString(),
    candidates,
    deleted,
    hitCap: false,
    durationMs: Math.max(0, Date.now() - startedAt),
    dryRun: input.dryRun,
    ...(drainError ? { error: drainError } : {}),
  };
}

type RetentionScanCursor = { at: Date; key: string };
type RetentionScanPage = {
  scanned: number | string;
  eligible: number | string;
  affected: number | string;
  cursorAt: Date | string | null;
  cursorId: string | null;
};

/**
 * Bound a complex retention predicate by applying it only after an age-indexed
 * page is materialized. Candidate CTIDs are selected and consumed in the same
 * statement, while the keyset cursor can advance through pages with no deletes.
 */
async function scanBoundedRetentionPages(input: {
  table: SQL;
  ageColumn: SQL;
  cutoff: Date;
  candidateColumns: SQL;
  /** Stable tie-breaker within one age timestamp; defaults to the table id. */
  cursorColumn?: SQL;
  eligible: SQL;
  dryRun: boolean;
  batchSize: number;
  maxRows?: number;
}): Promise<{ candidates: number; deleted: number; error?: string }> {
  let cursor: RetentionScanCursor | null = null;
  const cursorColumn = input.cursorColumn ?? sql`id`;
  let candidates = 0;
  let deleted = 0;
  for (;;) {
    if (
      !input.dryRun &&
      input.maxRows !== undefined &&
      deleted >= input.maxRows
    ) {
      break;
    }
    const affectedLimit = input.dryRun
      ? input.batchSize
      : Math.min(input.batchSize, (input.maxRows ?? Infinity) - deleted);
    const afterCursor: SQL = cursor
      ? sql`and (${input.ageColumn}, ${cursorColumn}) > (${cursor.at}, ${cursor.key})`
      : sql``;
    const targetLimit = input.dryRun ? sql`` : sql`limit ${affectedLimit}`;
    const processed = input.dryRun
      ? sql`select 1 from targets`
      : sql`delete from ${input.table} as target using targets where target.ctid = targets.ctid returning 1`;
    try {
      const result: { rows: RetentionScanPage[] } =
        await db.execute<RetentionScanPage>(sql`
        with candidates as materialized (
          select ctid, ${cursorColumn}::text as retention_key,
                 ${input.ageColumn} as retention_at
                 ${input.candidateColumns}
          from ${input.table}
          where ${input.ageColumn} < ${input.cutoff} ${afterCursor}
          order by ${input.ageColumn}, ${cursorColumn}
          limit ${input.batchSize}
        ),
        eligible as materialized (
          select candidate.ctid
          from candidates candidate
          where ${input.eligible}
        ),
        targets as materialized (select ctid from eligible ${targetLimit}),
        processed as (${processed})
        select (select count(*)::int from candidates) as scanned,
               (select count(*)::int from eligible) as eligible,
               (select count(*)::int from processed) as affected,
               (select retention_at from candidates order by retention_at desc, retention_key desc limit 1) as "cursorAt",
               (select retention_key from candidates order by retention_at desc, retention_key desc limit 1) as "cursorId"
        `);
      const row: RetentionScanPage | undefined = result.rows[0];
      const scanned = Number(row?.scanned ?? 0);
      const affected = Number(row?.affected ?? 0);
      candidates += Number(row?.eligible ?? 0);
      if (!input.dryRun) deleted += affected;
      if (scanned < input.batchSize) break;

      const rawCursorAt: Date | string | null | undefined = row?.cursorAt;
      const cursorAt: Date =
        rawCursorAt instanceof Date
          ? rawCursorAt
          : new Date(String(rawCursorAt ?? ""));
      const cursorId = row?.cursorId;
      if (!Number.isFinite(cursorAt.getTime()) || !cursorId) {
        throw new Error("Retention scan page did not return a valid cursor");
      }
      // ponytail: the cursor is intentionally per-sweep; an old row inserted
      // behind it by a concurrent backfill is harmless and drains next sweep.
      cursor = { at: cursorAt, key: cursorId };
    } catch (error) {
      return {
        candidates,
        deleted,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { candidates, deleted };
}

/** Diagnostic history is intentionally short-lived operational telemetry. */
export const DIAGNOSTIC_RETENTION_DAYS = 1;
/** One day of snapshots is ~69k rows at the 15s collector cadence. */
export const DEFAULT_DIAGNOSTIC_RETENTION_MAX_ROWS_PER_RUN = 100_000;

export type DiagnosticRetentionOptions = RetentionOptions & {
  /** Max rows deleted this run; a backlog drains over successive sweeps. */
  maxRowsPerRun?: number;
};

async function pruneDiagnosticHistory(input: {
  table: SQL;
  tableName: "diagnostic_events" | "diagnostic_snapshots";
  ageColumn: SQL;
  opts: DiagnosticRetentionOptions;
}): Promise<RetentionResult> {
  const startedAt = Date.now();
  const { dryRun, batchSize, cutoff } = resolve(input.opts);
  const maxRowsPerRun =
    input.opts.maxRowsPerRun ?? DEFAULT_DIAGNOSTIC_RETENTION_MAX_ROWS_PER_RUN;
  const scan = await scanBoundedRetentionPages({
    table: input.table,
    ageColumn: input.ageColumn,
    cutoff,
    candidateColumns: sql``,
    eligible: sql`true`,
    dryRun,
    batchSize,
    maxRows: maxRowsPerRun,
  });
  return {
    table: input.tableName,
    cutoff: cutoff.toISOString(),
    candidates: scan.candidates,
    deleted: scan.deleted,
    hitCap: !dryRun && maxRowsPerRun > 0 && scan.deleted === maxRowsPerRun,
    durationMs: Math.max(0, Date.now() - startedAt),
    dryRun,
    ...(scan.error ? { error: scan.error } : {}),
  };
}

export async function pruneDiagnosticSnapshots(
  opts: DiagnosticRetentionOptions,
): Promise<RetentionResult> {
  const t = diagnosticSnapshotsTable;
  return pruneDiagnosticHistory({
    table: sql`${t}`,
    tableName: "diagnostic_snapshots",
    ageColumn: sql`${t.observedAt}`,
    opts,
  });
}

export async function pruneDiagnosticEvents(
  opts: DiagnosticRetentionOptions,
): Promise<RetentionResult> {
  const t = diagnosticEventsTable;
  return pruneDiagnosticHistory({
    table: sql`${t}`,
    tableName: "diagnostic_events",
    ageColumn: sql`${t.lastSeenAt}`,
    opts,
  });
}

/**
 * `signal_monitor_breadth_snapshots` is a forward cache for breadth sparklines:
 * `listSignalMonitorBreadthHistory` queries a bounded `captured_at` window and
 * falls back to event-log reconstruction when snapshots don't cover it. No
 * reader depends on a single latest row surviving, so a flat age delete is safe.
 */
export async function pruneSignalMonitorBreadthSnapshots(
  opts: RetentionOptions,
): Promise<RetentionResult> {
  const { dryRun, batchSize, cutoff } = resolve(opts);
  const t = signalMonitorBreadthSnapshotsTable;
  const deletable = sql`${t.capturedAt} < ${cutoff}`;
  return sweep({
    table: "signal_monitor_breadth_snapshots",
    cutoff,
    dryRun,
    count: sql`select count(*)::int as n from ${t} where ${deletable}`,
    deleteBatch: sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${batchSize})) returning ${t.id}`,
  });
}

/**
 * `balance_snapshots` is regenerable from the IBKR account summary, but the
 * newest row per account is the live fallback when the bridge is down
 * (`getPersistedBackedAccounts`) and backs Flex coverage health. Equity-history
 * reads need older rows too, so keep `retentionDays` of history and ALWAYS
 * preserve the newest row per account, regardless of age.
 */
export async function pruneBalanceSnapshots(
  opts: RetentionOptions,
): Promise<RetentionResult> {
  const { dryRun, batchSize, cutoff } = resolve(opts);
  const t = balanceSnapshotsTable;
  const latestPerAccount = sql`select distinct on (${t.accountId}) ${t.id} from ${t} order by ${t.accountId}, ${t.asOf} desc, ${t.createdAt} desc`;
  const deletable = sql`${t.asOf} < ${cutoff} and ${t.id} not in (${latestPerAccount})`;
  return sweep({
    table: "balance_snapshots",
    cutoff,
    dryRun,
    count: sql`select count(*)::int as n from ${t} where ${deletable}`,
    deleteBatch: sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${batchSize})) returning ${t.id}`,
  });
}

/**
 * `shadow_position_marks` is the largest snapshot table. OPEN positions need
 * their full mark history because peak/high-water reads compute
 * `max(mark)` since `openedAt` (`readShadowPositionPeakMarkPrice`), so only
 * marks of positions that have been CLOSED for at least `retentionDays` are
 * eligible, and the newest mark per position is always preserved (latest
 * baseline / automation reads).
 */
export async function pruneClosedShadowPositionMarks(
  opts: RetentionOptions,
): Promise<RetentionResult> {
  const { dryRun, batchSize, cutoff } = resolve(opts);
  const m = shadowPositionMarksTable;
  const p = shadowPositionsTable;
  const latestPerPosition = sql`select distinct on (${m.positionId}) ${m.id} from ${m} order by ${m.positionId}, ${m.asOf} desc, ${m.createdAt} desc`;
  const closedLongEnough = sql`select ${p.id} from ${p} where ${p.closedAt} is not null and ${p.closedAt} < ${cutoff}`;
  const deletable = sql`${m.asOf} < ${cutoff} and ${m.positionId} in (${closedLongEnough}) and ${m.id} not in (${latestPerPosition})`;
  return sweep({
    table: "shadow_position_marks",
    cutoff,
    dryRun,
    count: sql`select count(*)::int as n from ${m} where ${deletable}`,
    deleteBatch: sql`delete from ${m} where ctid = any(array(select ctid from ${m} where ${deletable} limit ${batchSize})) returning ${m.id}`,
  });
}

/**
 * `shadow_balance_snapshots` mixes live valuation/ledger rows (wall-clock
 * `as_of`) with replay/backtest rows (simulated `as_of`). Retention prunes ONLY
 * live (non-simulation) sources, keying on age, and always preserves the newest
 * row per `(account_id, source)` — which is what `getShadowAccountEquityHistory`
 * reconstructs per source. Simulation sources are excluded entirely, so this is
 * disjoint from the range-scoped replay/backtest cleanup paths and cannot
 * corrupt an in-flight or historical-dated simulation run.
 */
export async function pruneShadowBalanceSnapshots(
  opts: RetentionOptions,
): Promise<RetentionResult> {
  const { dryRun, batchSize, cutoff } = resolve(opts);
  const t = shadowBalanceSnapshotsTable;
  const simulation = sql`(${inArray(t.source, [...SIMULATION_SHADOW_BALANCE_SOURCES])} or ${t.source} like 'signal_options_replay:%' or ${t.source} like 'watchlist_backtest:%' or ${t.source} like 'watchlist_bt:%')`;
  const latestPerAccountSource = sql`select distinct on (${t.accountId}, ${t.source}) ${t.id} from ${t} order by ${t.accountId}, ${t.source}, ${t.asOf} desc, ${t.createdAt} desc`;
  const deletable = sql`${t.asOf} < ${cutoff} and not ${simulation} and ${t.id} not in (${latestPerAccountSource})`;
  return sweep({
    table: "shadow_balance_snapshots",
    cutoff,
    dryRun,
    count: sql`select count(*)::int as n from ${t} where ${deletable}`,
    deleteBatch: sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${batchSize})) returning ${t.id}`,
  });
}

/**
 * `signal_monitor_events` is the append-only crossover-event log and grows with
 * every signal across the whole universe (~4x faster at the 2000-symbol cap).
 * Two readers constrain deletion: the signal-quality KPI calibration reads
 * TRUSTED events (direction buy/sell with a close) inside its 90-day rolling
 * window — the default 120-day retention always covers it — and the
 * latest-trusted-event lookup (`listLatestTrustedSignalMonitorEventsForProfile`,
 * DISTINCT ON (symbol, timeframe) per profile) needs the newest trusted event
 * per cell to survive REGARDLESS of age, or a thinly-signaled symbol loses its
 * canonical signal identity. Untrusted rows have no latest-per-cell reader.
 */
export async function pruneSignalMonitorEvents(
  opts: RetentionOptions,
): Promise<RetentionResult> {
  const startedAt = Date.now();
  const { dryRun, batchSize, cutoff } = resolve(opts);
  const t = signalMonitorEventsTable;
  const scan = await scanBoundedRetentionPages({
    table: sql`${t}`,
    ageColumn: sql`${t.signalAt}`,
    cutoff,
    candidateColumns: sql`, profile_id, symbol, timeframe, direction, close, created_at`,
    eligible: sql`
      (candidate.direction in ('buy', 'sell') and candidate.close is not null) is not true
      or exists (
        select 1
        from ${t} newer
        where newer.profile_id = candidate.profile_id
          and newer.symbol = candidate.symbol
          and newer.timeframe = candidate.timeframe
          and newer.direction in ('buy', 'sell')
          and newer.close is not null
          and newer.signal_at >= candidate.retention_at
          and (newer.signal_at, newer.created_at) >
              (candidate.retention_at, candidate.created_at)
      )`,
    dryRun,
    batchSize,
  });
  return {
    table: "signal_monitor_events",
    cutoff: cutoff.toISOString(),
    candidates: scan.candidates,
    deleted: scan.deleted,
    hitCap: false,
    durationMs: Math.max(0, Date.now() - startedAt),
    dryRun,
    ...(scan.error ? { error: scan.error } : {}),
  };
}

/**
 * `signal_monitor_symbol_states` rows are deactivated (`active = false`) when a
 * symbol leaves the resolved universe; every state reader filters
 * `active = true`, so inactive rows exist only to restore a prior signal latch
 * if the symbol re-enters. A latch that old is meaningless (freshness is
 * measured in bars), so inactive rows untouched for `retentionDays` are safe to
 * drop. Active rows are NEVER eligible, regardless of age.
 */
export async function pruneInactiveSignalMonitorSymbolStates(
  opts: RetentionOptions,
): Promise<RetentionResult> {
  const { dryRun, batchSize, cutoff } = resolve(opts);
  const t = signalMonitorSymbolStatesTable;
  const deletable = sql`${t.active} = false and ${t.updatedAt} < ${cutoff}`;
  return sweep({
    table: "signal_monitor_symbol_states",
    cutoff,
    dryRun,
    count: sql`select count(*)::int as n from ${t} where ${deletable}`,
    deleteBatch: sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${batchSize})) returning ${t.id}`,
  });
}

/** Daily-and-coarser timeframes: tiny in volume, kept far longer than intraday. */
export const BAR_CACHE_LONG_TIMEFRAMES = ["1d", "1w", "1M", "1mo"] as const;
/** Cap rows deleted per scheduled sweep so one run can't pin the shared DB. */
export const DEFAULT_BAR_CACHE_MAX_ROWS_PER_RUN = 1_000_000;
export type BarCacheRetentionOptions = {
  /** Sub-daily bars older than `now - intradayRetentionDays` are eligible. */
  intradayRetentionDays: number;
  /** Daily+ bars older than `now - dailyRetentionDays` are eligible. */
  dailyRetentionDays: number;
  now?: Date;
  batchSize?: number;
  dryRun?: boolean;
  /** Max rows deleted this run; the backlog drains over successive sweeps. */
  maxRowsPerRun?: number;
};

/**
 * `bar_cache` is the signal-monitor's working bar store. The ONLY production
 * reader is signal-monitor.ts (`loadStoredMarketBars*`), whose deepest lookback
 * is ~10 days (`SIGNAL_MONITOR_MARKET_CLOSE_LOOKBACK_DAYS`); backtesting does NOT
 * read it. Left unbounded it grew to ~18M rows / 8GB (3.7yr of mostly-intraday
 * bars written once and never re-read), starving the shared DB's 128MB cache and
 * inflating every upsert (4 indexes + WAL) — the structural half of the 12-slot
 * pool saturation. Retention is timeframe-aware: sub-daily bars (the bulk) are
 * pruned to `intradayRetentionDays`; daily-and-coarser bars are tiny and kept to
 * `dailyRetentionDays`, so long-horizon signals/charts are never starved.
 *
 * Unlike the snapshot sweeps this does NOT reuse `sweep()`: it walks bounded
 * `(starts_at, natural-key)` pages using `bar_cache_starts_at_idx`, then applies the
 * timeframe predicate to only that materialized page. The old `... WHERE
 * complex_predicate LIMIT 50000` probe could still scan the whole table when no
 * row matched. `maxRowsPerRun` continues to bound delete WAL/locks while the
 * historical backlog drains over successive runs.
 */
export async function pruneBarCache(
  opts: BarCacheRetentionOptions,
): Promise<RetentionResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? true;
  const batchSize = opts.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE;
  const maxRowsPerRun = opts.maxRowsPerRun ?? DEFAULT_BAR_CACHE_MAX_ROWS_PER_RUN;
  const intradayCutoff = new Date(
    now.getTime() - opts.intradayRetentionDays * 86_400_000,
  );
  const dailyCutoff = new Date(
    now.getTime() - opts.dailyRetentionDays * 86_400_000,
  );
  const t = barCacheTable;
  const latestCutoff =
    intradayCutoff > dailyCutoff ? intradayCutoff : dailyCutoff;
  const longTimeframes = sql.join(
    BAR_CACHE_LONG_TIMEFRAMES.map((timeframe) => sql`${timeframe}`),
    sql`, `,
  );
  const scan = await scanBoundedRetentionPages({
    table: sql`${t}`,
    ageColumn: sql`${t.startsAt}`,
    // ponytail: this compact text key is unique with starts_at by the verified
    // bar natural key; promote it to a typed row cursor only if delimiters ever
    // become valid in symbol/timeframe/source values.
    cursorColumn: sql`${t.symbol} || chr(31) || ${t.timeframe} || chr(31) || ${t.source}`,
    cutoff: latestCutoff,
    candidateColumns: sql`, timeframe`,
    eligible: sql`
      (candidate.timeframe in (${longTimeframes}) and candidate.retention_at < ${dailyCutoff})
      or (candidate.timeframe not in (${longTimeframes}) and candidate.retention_at < ${intradayCutoff})`,
    dryRun,
    batchSize,
    maxRows: maxRowsPerRun,
  });

  return {
    table: "bar_cache",
    cutoff: intradayCutoff.toISOString(),
    candidates: scan.candidates,
    deleted: scan.deleted,
    hitCap: !dryRun && maxRowsPerRun > 0 && scan.deleted === maxRowsPerRun,
    durationMs: Math.max(0, Date.now() - startedAt),
    dryRun,
    ...(scan.error ? { error: scan.error } : {}),
  };
}

/**
 * `execution_events` diagnostic-class types that are ephemeral debugging noise
 * (candidate-skip firehose ~853k rows/7d, per-tick shadow marks, gateway-blocked
 * coalesced status, transient scan-status). This is an EXPLICIT ALLOWLIST: only
 * these exact types are ever eligible, so every trade/lifecycle type
 * (signal_options_shadow_entry / _shadow_exit / _shadow_execution /
 * _candidate_created / _manual_deviation, overnight_spot live/entry/order rows)
 * is structurally NEVER pruned regardless of age. Add a type here only if it is
 * pure diagnostics; when in doubt, leave it out.
 */
export const EXECUTION_EVENTS_DIAGNOSTIC_TYPES = [
  "signal_options_candidate_skipped",
  "signal_options_shadow_mark",
  "signal_options_gateway_blocked",
  "signal_options_scan_running",
  "signal_options_scan_long_running",
  "signal_options_scan_stale",
  "signal_options_signal_scan_degraded",
  "overnight_spot_signal_blocked",
] as const;

/** Cap rows deleted per scheduled sweep so the first ~1M-row drain can't pin the
 * shared DB — the backlog drains over successive sweeps like the bar_cache pruner. */
export const DEFAULT_EXECUTION_EVENTS_DIAGNOSTIC_MAX_ROWS_PER_RUN = 1_000_000;
/** Bounded candidate probe (a full count(*) over the deletable set can trip the
 * 15s statement_timeout on a bloated table). */
const EXECUTION_EVENTS_DIAGNOSTIC_PROBE_CAP = 50_000;

export type ExecutionEventsDiagnosticRetentionOptions = {
  /** Diagnostic rows older than `now - retentionHours` are eligible. */
  retentionHours: number;
  now?: Date;
  batchSize?: number;
  dryRun?: boolean;
  /** Max rows deleted this run; the backlog drains over successive sweeps. */
  maxRowsPerRun?: number;
};

/**
 * `execution_events` diagnostic retention. The candidate-skip firehose alone hit
 * ~853k rows / 1.6GB over 7 days; coalescing at the writer caps the forward rate,
 * and this sweep drains the historical backlog and holds diagnostic types to a
 * short window (default 48h). Trade/lifecycle types are excluded by construction
 * (allowlist above), so trade history is kept forever. Mirrors `pruneBarCache`:
 * bounded probe instead of a full count, `maxRowsPerRun` cap + `hitCap` so the
 * background-lane scheduler switches to its backlog cadence while ~1M rows drain.
 */
export async function pruneExecutionEventsDiagnostics(
  opts: ExecutionEventsDiagnosticRetentionOptions,
): Promise<RetentionResult> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? true;
  const batchSize = opts.batchSize ?? DEFAULT_RETENTION_BATCH_SIZE;
  const maxRowsPerRun =
    opts.maxRowsPerRun ?? DEFAULT_EXECUTION_EVENTS_DIAGNOSTIC_MAX_ROWS_PER_RUN;
  const cutoff = new Date(now.getTime() - opts.retentionHours * 3_600_000);
  const t = executionEventsTable;
  const types = [...EXECUTION_EVENTS_DIAGNOSTIC_TYPES];
  const deletable = sql`${inArray(t.eventType, types)} and ${t.occurredAt} < ${cutoff}`;

  const probed = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from (select 1 from ${t} where ${deletable} limit ${EXECUTION_EVENTS_DIAGNOSTIC_PROBE_CAP}) s`,
  );
  const candidates = Number(probed.rows[0]?.n ?? 0);

  let deleted = 0;
  let drainError: string | undefined;
  if (!dryRun && candidates > 0) {
    while (deleted < maxRowsPerRun) {
      const limit = Math.min(batchSize, maxRowsPerRun - deleted);
      const deleteBatch = sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${limit})) returning ${t.id}`;
      // A mid-drain failure must not zero the progress report: completed
      // batches are committed, so keep the real count (and hitCap math) and
      // surface the error on the result instead of throwing it away.
      let removed;
      try {
        removed = await db.execute<{ id: string }>(deleteBatch);
      } catch (error) {
        drainError = error instanceof Error ? error.message : String(error);
        break;
      }
      if (removed.rows.length === 0) break;
      deleted += removed.rows.length;
    }
  }

  return {
    table: "execution_events",
    cutoff: cutoff.toISOString(),
    candidates,
    deleted,
    hitCap: !dryRun && maxRowsPerRun > 0 && deleted === maxRowsPerRun,
    durationMs: Math.max(0, Date.now() - startedAt),
    dryRun,
    ...(drainError ? { error: drainError } : {}),
  };
}

/**
 * Per-table retention windows (days) + batch size, the single source of truth
 * shared by the CLI and the api-server scheduler. Defaults are the conservative,
 * forward-looking values chosen for Task 7.
 */
export type SnapshotRetentionConfig = {
  signalBreadthSnapshotDays: number;
  balanceSnapshotDays: number;
  shadowBalanceSnapshotDays: number;
  shadowPositionMarkDays: number;
  signalMonitorEventDays: number;
  signalMonitorInactiveStateDays: number;
  barCacheIntradayDays: number;
  barCacheDailyDays: number;
  barCacheMaxRowsPerRun: number;
  executionEventsDiagnosticHours: number;
  executionEventsDiagnosticMaxRowsPerRun: number;
  batchSize: number;
};

function envInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min = 1,
  max = 100_000,
): number {
  const raw = env[name];
  if (!raw) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function resolveSnapshotRetentionConfig(
  env: NodeJS.ProcessEnv = process.env,
): SnapshotRetentionConfig {
  return {
    signalBreadthSnapshotDays: envInt(env, "SIGNAL_BREADTH_SNAPSHOT_RETENTION_DAYS", 90),
    balanceSnapshotDays: envInt(env, "BALANCE_SNAPSHOT_RETENTION_DAYS", 180),
    shadowBalanceSnapshotDays: envInt(env, "SHADOW_BALANCE_SNAPSHOT_RETENTION_DAYS", 180),
    shadowPositionMarkDays: envInt(env, "SHADOW_POSITION_MARK_RETENTION_DAYS", 180),
    // Must stay above the signal-quality KPI 90-day rolling window.
    signalMonitorEventDays: envInt(env, "SIGNAL_MONITOR_EVENT_RETENTION_DAYS", 120),
    signalMonitorInactiveStateDays: envInt(
      env,
      "SIGNAL_MONITOR_INACTIVE_STATE_RETENTION_DAYS",
      90,
    ),
    // Sub-daily bars: kept ~6x the signal-monitor's ~10d lookback; daily+ bars
    // are tiny, kept long so long-horizon signals/charts are never starved.
    barCacheIntradayDays: envInt(env, "BAR_CACHE_INTRADAY_RETENTION_DAYS", 60),
    barCacheDailyDays: envInt(env, "BAR_CACHE_DAILY_RETENTION_DAYS", 400),
    barCacheMaxRowsPerRun: envInt(
      env,
      "BAR_CACHE_RETENTION_MAX_ROWS_PER_RUN",
      DEFAULT_BAR_CACHE_MAX_ROWS_PER_RUN,
      1,
      50_000_000,
    ),
    // Skip/mark/gateway/scan diagnostics are same-day-only debugging data
    // (owner decision, WO-EE-FIREHOSE); trade history is kept forever via the
    // allowlist. 48h default; min 1h so a misconfig can't disable retention.
    executionEventsDiagnosticHours: envInt(
      env,
      "EXECUTION_EVENTS_DIAGNOSTIC_RETENTION_HOURS",
      48,
      1,
      100_000,
    ),
    executionEventsDiagnosticMaxRowsPerRun: envInt(
      env,
      "EXECUTION_EVENTS_DIAGNOSTIC_RETENTION_MAX_ROWS_PER_RUN",
      DEFAULT_EXECUTION_EVENTS_DIAGNOSTIC_MAX_ROWS_PER_RUN,
      1,
      50_000_000,
    ),
    batchSize: envInt(env, "SNAPSHOT_RETENTION_BATCH_SIZE", DEFAULT_RETENTION_BATCH_SIZE),
  };
}

/**
 * Run all Task 7 retention sweeps with one config. Dry-run by default.
 */
// One table's failure must never abort the other tables' sweeps: a thrown
// statement timeout in an early sweep once cancelled the whole chain on every
// scheduled run, silently disabling bar_cache and execution_events retention
// for days (observed 2026-07-11: zero snapshot-retention-sweep events since
// the scheduler landed). Failures land in the result as `error` so the
// scheduler still emits per-table evidence.
async function settleRetentionSweep(
  table: string,
  cutoff: Date,
  dryRun: boolean,
  run: () => Promise<RetentionResult>,
): Promise<RetentionResult> {
  const startedAt = Date.now();
  try {
    return await run();
  } catch (error) {
    return {
      table,
      cutoff: cutoff.toISOString(),
      candidates: 0,
      deleted: 0,
      hitCap: false,
      durationMs: Math.max(0, Date.now() - startedAt),
      dryRun,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAllSnapshotRetention(opts?: {
  config?: SnapshotRetentionConfig;
  now?: Date;
  dryRun?: boolean;
}): Promise<RetentionResult[]> {
  const config = opts?.config ?? resolveSnapshotRetentionConfig();
  const now = opts?.now ?? new Date();
  const dryRun = opts?.dryRun ?? true;
  // Chain-start clock for every sweep (success AND error paths) so reported
  // cutoffs are consistent across the chain rather than drifting by the
  // duration of preceding sweeps.
  const common = { now, batchSize: config.batchSize, dryRun: opts?.dryRun };
  const cutoffFor = (days: number) =>
    new Date(now.getTime() - days * 24 * 3_600_000);
  const results: RetentionResult[] = [];
  const sweeps: Array<{
    table: string;
    cutoff: Date;
    run: () => Promise<RetentionResult>;
  }> = [
    {
      table: "signal_monitor_breadth_snapshots",
      cutoff: cutoffFor(config.signalBreadthSnapshotDays),
      run: () =>
        pruneSignalMonitorBreadthSnapshots({
          ...common,
          retentionDays: config.signalBreadthSnapshotDays,
        }),
    },
    {
      table: "diagnostic_snapshots",
      cutoff: cutoffFor(DIAGNOSTIC_RETENTION_DAYS),
      run: () =>
        pruneDiagnosticSnapshots({
          ...common,
          retentionDays: DIAGNOSTIC_RETENTION_DAYS,
        }),
    },
    {
      table: "diagnostic_events",
      cutoff: cutoffFor(DIAGNOSTIC_RETENTION_DAYS),
      run: () =>
        pruneDiagnosticEvents({
          ...common,
          retentionDays: DIAGNOSTIC_RETENTION_DAYS,
        }),
    },
    {
      table: "balance_snapshots",
      cutoff: cutoffFor(config.balanceSnapshotDays),
      run: () =>
        pruneBalanceSnapshots({
          ...common,
          retentionDays: config.balanceSnapshotDays,
        }),
    },
    {
      table: "shadow_balance_snapshots",
      cutoff: cutoffFor(config.shadowBalanceSnapshotDays),
      run: () =>
        pruneShadowBalanceSnapshots({
          ...common,
          retentionDays: config.shadowBalanceSnapshotDays,
        }),
    },
    {
      table: "shadow_position_marks",
      cutoff: cutoffFor(config.shadowPositionMarkDays),
      run: () =>
        pruneClosedShadowPositionMarks({
          ...common,
          retentionDays: config.shadowPositionMarkDays,
        }),
    },
    {
      table: "signal_monitor_events",
      cutoff: cutoffFor(config.signalMonitorEventDays),
      run: () =>
        pruneSignalMonitorEvents({
          ...common,
          retentionDays: config.signalMonitorEventDays,
        }),
    },
    {
      table: "signal_monitor_symbol_states",
      cutoff: cutoffFor(config.signalMonitorInactiveStateDays),
      run: () =>
        pruneInactiveSignalMonitorSymbolStates({
          ...common,
          retentionDays: config.signalMonitorInactiveStateDays,
        }),
    },
    {
      table: "bar_cache",
      cutoff: cutoffFor(config.barCacheIntradayDays),
      run: () =>
        pruneBarCache({
          now,
          batchSize: config.batchSize,
          dryRun: opts?.dryRun,
          intradayRetentionDays: config.barCacheIntradayDays,
          dailyRetentionDays: config.barCacheDailyDays,
          maxRowsPerRun: config.barCacheMaxRowsPerRun,
        }),
    },
    {
      table: "execution_events",
      cutoff: new Date(
        now.getTime() - config.executionEventsDiagnosticHours * 3_600_000,
      ),
      run: () =>
        pruneExecutionEventsDiagnostics({
          now,
          batchSize: config.batchSize,
          dryRun: opts?.dryRun,
          retentionHours: config.executionEventsDiagnosticHours,
          maxRowsPerRun: config.executionEventsDiagnosticMaxRowsPerRun,
        }),
    },
  ];
  for (const entry of sweeps) {
    results.push(
      await settleRetentionSweep(entry.table, entry.cutoff, dryRun, entry.run),
    );
  }
  return results;
}

import { inArray, notInArray, sql, type SQL } from "drizzle-orm";

import { db } from "./index";
import {
  balanceSnapshotsTable,
  barCacheTable,
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
 * Out of scope here on purpose: `diagnostic_snapshots` (already self-pruned to
 * 24h by the diagnostics collector). See docs/plans/db-maintenance-roadmap-2026-06-25.md.
 */

/**
 * Snapshot sources whose `as_of` is SIMULATED time, not wall-clock — written by
 * replay/backtest runs and cleaned up by their own range-scoped delete paths
 * (`resetSignalOptionsReplayRowsForRange`, `resetWatchlistBacktestRowsForRange`,
 * `backfillSignalOptionsReplayEquitySnapshotsFromRun` in shadow-account.ts).
 * Age-based retention must NEVER touch these. Mirrors the source constants in
 * artifacts/api-server/src/services/shadow-account.ts; keep in sync if new
 * simulation sources are added there.
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
  /** Rows matching the deletable predicate, measured before any delete. */
  candidates: number;
  /** Rows actually deleted (0 when dryRun). */
  deleted: number;
  /** True when this run stopped at a per-run delete cap. */
  hitCap: boolean;
  /** Wall-clock time spent in this table sweep. */
  durationMs: number;
  dryRun: boolean;
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
  if (!input.dryRun && candidates > 0) {
    for (;;) {
      const removed = await db.execute<{ id: string }>(input.deleteBatch);
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
  };
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
  const simulation = sql`(${inArray(t.source, [...SIMULATION_SHADOW_BALANCE_SOURCES])} or ${t.source} like 'signal_options_replay:%' or ${t.source} like 'watchlist_backtest:%')`;
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
  const { dryRun, batchSize, cutoff } = resolve(opts);
  const t = signalMonitorEventsTable;
  const trusted = sql`${inArray(t.direction, ["buy", "sell"])} and ${t.close} is not null`;
  const latestTrustedPerCell = sql`select distinct on (${t.profileId}, ${t.symbol}, ${t.timeframe}) ${t.id} from ${t} where ${trusted} order by ${t.profileId}, ${t.symbol}, ${t.timeframe}, ${t.signalAt} desc, ${t.createdAt} desc`;
  const deletable = sql`${t.signalAt} < ${cutoff} and ${t.id} not in (${latestTrustedPerCell})`;
  return sweep({
    table: "signal_monitor_events",
    cutoff,
    dryRun,
    count: sql`select count(*)::int as n from ${t} where ${deletable}`,
    deleteBatch: sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${batchSize})) returning ${t.id}`,
  });
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
/** Report "at least N" eligible rows via a bounded probe (a full count(*) on
 * this ~18M-row table trips the 15s statement_timeout). */
const BAR_CACHE_CANDIDATE_PROBE_CAP = 50_000;

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
 * Unlike the snapshot sweeps this does NOT reuse `sweep()`: it skips the upfront
 * exact count (a full `count(*)` here trips the 15s statement_timeout) in favour
 * of a bounded candidate probe, and caps `maxRowsPerRun` so a single scheduled
 * sweep does bounded IO while the historical backlog drains over successive runs.
 * The deletable predicate is stable as rows disappear, so successive runs
 * converge; the newest bars (which every reader needs) never match it.
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
  const long = [...BAR_CACHE_LONG_TIMEFRAMES];
  const deletable = sql`((${inArray(t.timeframe, long)} and ${t.startsAt} < ${dailyCutoff}) or (${notInArray(t.timeframe, long)} and ${t.startsAt} < ${intradayCutoff}))`;

  const probed = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from (select 1 from ${t} where ${deletable} limit ${BAR_CACHE_CANDIDATE_PROBE_CAP}) s`,
  );
  const candidates = Number(probed.rows[0]?.n ?? 0);

  let deleted = 0;
  if (!dryRun && candidates > 0) {
    while (deleted < maxRowsPerRun) {
      const limit = Math.min(batchSize, maxRowsPerRun - deleted);
      const deleteBatch = sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${limit})) returning ${t.id}`;
      const removed = await db.execute<{ id: string }>(deleteBatch);
      if (removed.rows.length === 0) break;
      deleted += removed.rows.length;
    }
  }

  return {
    table: "bar_cache",
    cutoff: intradayCutoff.toISOString(),
    candidates,
    deleted,
    hitCap: !dryRun && maxRowsPerRun > 0 && deleted === maxRowsPerRun,
    durationMs: Math.max(0, Date.now() - startedAt),
    dryRun,
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
  if (!dryRun && candidates > 0) {
    while (deleted < maxRowsPerRun) {
      const limit = Math.min(batchSize, maxRowsPerRun - deleted);
      const deleteBatch = sql`delete from ${t} where ctid = any(array(select ctid from ${t} where ${deletable} limit ${limit})) returning ${t.id}`;
      const removed = await db.execute<{ id: string }>(deleteBatch);
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
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
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
 * `diagnostic_snapshots` is owned by the diagnostics collector.
 */
export async function runAllSnapshotRetention(opts?: {
  config?: SnapshotRetentionConfig;
  now?: Date;
  dryRun?: boolean;
}): Promise<RetentionResult[]> {
  const config = opts?.config ?? resolveSnapshotRetentionConfig();
  const common = { now: opts?.now, batchSize: config.batchSize, dryRun: opts?.dryRun };
  return [
    await pruneSignalMonitorBreadthSnapshots({
      ...common,
      retentionDays: config.signalBreadthSnapshotDays,
    }),
    await pruneBalanceSnapshots({
      ...common,
      retentionDays: config.balanceSnapshotDays,
    }),
    await pruneShadowBalanceSnapshots({
      ...common,
      retentionDays: config.shadowBalanceSnapshotDays,
    }),
    await pruneClosedShadowPositionMarks({
      ...common,
      retentionDays: config.shadowPositionMarkDays,
    }),
    await pruneSignalMonitorEvents({
      ...common,
      retentionDays: config.signalMonitorEventDays,
    }),
    await pruneInactiveSignalMonitorSymbolStates({
      ...common,
      retentionDays: config.signalMonitorInactiveStateDays,
    }),
    await pruneBarCache({
      now: opts?.now,
      batchSize: config.batchSize,
      dryRun: opts?.dryRun,
      intradayRetentionDays: config.barCacheIntradayDays,
      dailyRetentionDays: config.barCacheDailyDays,
      maxRowsPerRun: config.barCacheMaxRowsPerRun,
    }),
    await pruneExecutionEventsDiagnostics({
      now: opts?.now,
      batchSize: config.batchSize,
      dryRun: opts?.dryRun,
      retentionHours: config.executionEventsDiagnosticHours,
      maxRowsPerRun: config.executionEventsDiagnosticMaxRowsPerRun,
    }),
  ];
}

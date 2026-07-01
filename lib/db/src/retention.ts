import { inArray, sql, type SQL } from "drizzle-orm";

import { db } from "./index";
import {
  balanceSnapshotsTable,
  shadowBalanceSnapshotsTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
  signalMonitorBreadthSnapshotsTable,
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
    deleteBatch: sql`delete from ${t} where ${t.id} in (select ${t.id} from ${t} where ${deletable} limit ${batchSize}) returning ${t.id}`,
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
    deleteBatch: sql`delete from ${t} where ${t.id} in (select ${t.id} from ${t} where ${deletable} limit ${batchSize}) returning ${t.id}`,
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
    deleteBatch: sql`delete from ${m} where ${m.id} in (select ${m.id} from ${m} where ${deletable} limit ${batchSize}) returning ${m.id}`,
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
    deleteBatch: sql`delete from ${t} where ${t.id} in (select ${t.id} from ${t} where ${deletable} limit ${batchSize}) returning ${t.id}`,
  });
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
  ];
}

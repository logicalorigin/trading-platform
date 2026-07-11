import {
  resolveSnapshotRetentionConfig,
  runAllSnapshotRetention,
} from "@workspace/db";
import * as dbExports from "@workspace/db";

import { logger } from "../lib/logger";
import { appendRuntimeFlightRecorderEvent } from "./runtime-flight-recorder";

// Periodic driver for the Task 7 snapshot/diagnostic retention (DB maintenance
// roadmap Phase 2). The retention functions live in @workspace/db/retention and
// are reader-preserving + dry-run-tested; this just executes them on a cadence so
// the forward-looking windows actually bound table growth as data ages.
//
// Env: SNAPSHOT_RETENTION_ENABLED=false to disable; SNAPSHOT_RETENTION_INITIAL_DELAY_MS
// for startup delay; SNAPSHOT_RETENTION_INTERVAL_MS for the normal cadence;
// SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS for capped backlog drain retries.
// Window/batch vars are read by resolveSnapshotRetentionConfig.

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h, matching the market-data worker cadence
const DEFAULT_INITIAL_DELAY_MS = 5 * 60 * 1000; // let startup settle before the first sweep
const DEFAULT_BACKLOG_INTERVAL_MS = 10 * 60 * 1000;
const MIN_INTERVAL_MS = 60_000;
type DbLaneRunner = <T>(lane: "background", fn: () => T) => T;
const runInDbLane = (
  dbExports as typeof dbExports & { runInDbLane: DbLaneRunner }
).runInDbLane;

type TimerHandle = ReturnType<typeof setTimeout>;
type TimerStarter = (
  callback: () => void | Promise<void>,
  delayMs: number,
) => TimerHandle;
type TimerClearer = (timer: TimerHandle) => void;
type RetentionSweepResult = {
  table: string;
  cutoff: string;
  candidates: number;
  deleted: number;
  hitCap: boolean;
  durationMs: number;
  dryRun: boolean;
  error?: string;
};
type RetentionRunner = () => Promise<RetentionSweepResult[]>;
type EventRecorder = (event: string, detail: Record<string, unknown>) => void;

export type SnapshotRetentionSchedulerTestDeps = {
  env?: NodeJS.ProcessEnv;
  setTimeout?: TimerStarter;
  clearTimeout?: TimerClearer;
  runInLane?: DbLaneRunner;
  runRetention?: RetentionRunner;
  recordEvent?: EventRecorder;
};

export type SnapshotRetentionSchedulerHandle = {
  stop: () => void;
};

function resolveMs(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
): number {
  const raw = env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= min
    ? Math.floor(parsed)
    : fallback;
}

function resolveIntervalMs(env: NodeJS.ProcessEnv): number {
  return resolveMs(
    env,
    "SNAPSHOT_RETENTION_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
    MIN_INTERVAL_MS,
  );
}

function resolveInitialDelayMs(env: NodeJS.ProcessEnv): number {
  return resolveMs(
    env,
    "SNAPSHOT_RETENTION_INITIAL_DELAY_MS",
    DEFAULT_INITIAL_DELAY_MS,
    0,
  );
}

function resolveBacklogIntervalMs(env: NodeJS.ProcessEnv): number {
  return resolveMs(
    env,
    "SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS",
    DEFAULT_BACKLOG_INTERVAL_MS,
    MIN_INTERVAL_MS,
  );
}

async function defaultRunRetention(): Promise<RetentionSweepResult[]> {
  const config = resolveSnapshotRetentionConfig();
  return (await runAllSnapshotRetention({
    config,
    dryRun: false,
  })) as RetentionSweepResult[];
}

function emitSweepEvent(
  recordEvent: EventRecorder,
  result: RetentionSweepResult,
): void {
  recordEvent("snapshot-retention-sweep", {
    table: result.table,
    deleted: result.deleted,
    hitCap: result.hitCap,
    durationMs: result.durationMs,
    // Per-table failures are isolated in runAllSnapshotRetention and land
    // here instead of aborting the chain — keep them queryable in the
    // flight recorder, not just in ephemeral process logs.
    error: result.error ?? null,
  });
}

function anySweepHitCap(results: RetentionSweepResult[]): boolean {
  return results.some((result) => result.hitCap);
}

let running = false;

async function runOnce(
  deps: Pick<
    SnapshotRetentionSchedulerTestDeps,
    "runInLane" | "runRetention" | "recordEvent"
  > = {},
): Promise<boolean> {
  const runInLane = deps.runInLane ?? runInDbLane;
  const runRetention = deps.runRetention ?? defaultRunRetention;
  const recordEvent = deps.recordEvent ?? appendRuntimeFlightRecorderEvent;

  return runInLane("background", async () => {
    if (running) {
      logger.warn("Snapshot retention sweep already running; skipping overlap");
      return false;
    }
    running = true;
    try {
      const results = await runRetention();
      for (const result of results) {
        emitSweepEvent(recordEvent, result);
        logger.info(
          {
            table: result.table,
            cutoff: result.cutoff,
            candidates: result.candidates,
            deleted: result.deleted,
            hitCap: result.hitCap,
            durationMs: result.durationMs,
          },
          "Snapshot retention sweep",
        );
      }
      return anySweepHitCap(results);
    } catch (err) {
      logger.warn({ err }, "Snapshot retention sweep failed");
      return false;
    } finally {
      running = false;
    }
  });
}

function startScheduler(
  deps: SnapshotRetentionSchedulerTestDeps = {},
): SnapshotRetentionSchedulerHandle {
  const env = deps.env ?? process.env;
  const setTimer = deps.setTimeout ?? setTimeout;
  const clearTimer = deps.clearTimeout ?? clearTimeout;

  if (env.SNAPSHOT_RETENTION_ENABLED === "false") {
    logger.info(
      "Snapshot retention scheduler disabled (SNAPSHOT_RETENTION_ENABLED=false)",
    );
    return { stop: () => {} };
  }

  const intervalMs = resolveIntervalMs(env);
  const initialDelayMs = resolveInitialDelayMs(env);
  const backlogIntervalMs = resolveBacklogIntervalMs(env);
  let stopped = false;
  let timer: TimerHandle | null = null;

  const schedule = (delayMs: number) => {
    timer = setTimer(async () => {
      timer = null;
      const hitCap = await runOnce(deps);
      if (!stopped) {
        schedule(hitCap ? backlogIntervalMs : intervalMs);
      }
    }, delayMs);
    timer.unref?.();
  };

  schedule(initialDelayMs);

  logger.info(
    { intervalMs, initialDelayMs, backlogIntervalMs },
    "Snapshot retention scheduler started",
  );

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}

export function startSnapshotRetentionScheduler(): void {
  startScheduler();
}

export function __startSnapshotRetentionSchedulerForTests(
  deps: SnapshotRetentionSchedulerTestDeps = {},
): SnapshotRetentionSchedulerHandle {
  return startScheduler(deps);
}

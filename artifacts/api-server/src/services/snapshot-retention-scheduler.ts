import { readFileSync } from "node:fs";
import path from "node:path";

import {
  resolveSnapshotRetentionConfig,
  runAllSnapshotRetention,
} from "@workspace/db";
import * as dbExports from "@workspace/db";

import { logger } from "../lib/logger";
import {
  appendRuntimeFlightRecorderEvent,
  atomicWriteFlightRecorderJson,
  flightRecorderDateKey,
  readFlightRecorderJsonlReverse,
  recorderDir,
} from "./runtime-flight-recorder";

// Periodic driver for the Task 7 snapshot/diagnostic retention (DB maintenance
// roadmap Phase 2). The retention functions live in @workspace/db/retention and
// are reader-preserving + dry-run-tested; this just executes them on a cadence so
// the forward-looking windows actually bound table growth as data ages.
//
// Env: SNAPSHOT_RETENTION_ENABLED=false to disable; SNAPSHOT_RETENTION_INITIAL_DELAY_MS
// for startup delay when no durable completion evidence exists;
// SNAPSHOT_RETENTION_INTERVAL_MS for the normal cadence;
// SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS for capped backlog drain retries.
// Window/batch vars are read by resolveSnapshotRetentionConfig.

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h, matching the market-data worker cadence
const DEFAULT_INITIAL_DELAY_MS = 5 * 60 * 1000; // let startup settle before the first sweep
const DEFAULT_BACKLOG_INTERVAL_MS = 10 * 60 * 1000;
const MIN_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_STATE_SCHEMA_VERSION = 1;
const SCHEDULE_STATE_FILE = "snapshot-retention-state.json";
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
export type SnapshotRetentionScheduleState = {
  completedAt: string;
  hitCap: boolean;
};
type ScheduleStateReader = () => SnapshotRetentionScheduleState | null;
type ScheduleStateWriter = (state: SnapshotRetentionScheduleState) => void;
type Clock = () => number;

export type SnapshotRetentionSchedulerTestDeps = {
  env?: NodeJS.ProcessEnv;
  setTimeout?: TimerStarter;
  clearTimeout?: TimerClearer;
  runInLane?: DbLaneRunner;
  runRetention?: RetentionRunner;
  recordEvent?: EventRecorder;
  readScheduleState?: ScheduleStateReader;
  writeScheduleState?: ScheduleStateWriter;
  now?: Clock;
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

function scheduleStatePath(dir = recorderDir()): string {
  return path.join(dir, SCHEDULE_STATE_FILE);
}

function parseScheduleState(
  value: unknown,
): SnapshotRetentionScheduleState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const completedAt = record["completedAt"];
  const hitCap = record["hitCap"];
  if (
    typeof completedAt !== "string" ||
    !Number.isFinite(Date.parse(completedAt)) ||
    typeof hitCap !== "boolean"
  ) {
    return null;
  }
  return { completedAt, hitCap };
}

function readPersistedScheduleState(
  dir: string,
): SnapshotRetentionScheduleState | null {
  try {
    const value = JSON.parse(
      readFileSync(scheduleStatePath(dir), "utf8"),
    ) as unknown;
    if (
      !value ||
      typeof value !== "object" ||
      (value as Record<string, unknown>)["schemaVersion"] !==
        SCHEDULE_STATE_SCHEMA_VERSION
    ) {
      return null;
    }
    return parseScheduleState(value);
  } catch {
    return null;
  }
}

function readLegacyScheduleState(
  dir: string,
  nowMs: number,
): SnapshotRetentionScheduleState | null {
  for (const dayOffset of [0, 1]) {
    const date = new Date(nowMs - dayOffset * DAY_MS).toISOString();
    let state: SnapshotRetentionScheduleState | null = null;
    for (const event of readFlightRecorderJsonlReverse(
      path.join(dir, `api-events-${flightRecorderDateKey(date)}.jsonl`),
    )) {
      if (!state) {
        const completedAt = event["time"];
        if (
          event["event"] !== "snapshot-retention-sweep" ||
          event["table"] !== "execution_events" ||
          typeof completedAt !== "string" ||
          !Number.isFinite(Date.parse(completedAt))
        ) {
          continue;
        }
        state = { completedAt, hitCap: event["hitCap"] === true };
        continue;
      }
      // Sweep events are emitted synchronously as one contiguous cycle. Walk
      // only that cycle so migration stops early and preserves backlog
      // cadence when an earlier table hit its deletion cap.
      if (
        event["event"] !== "snapshot-retention-sweep" ||
        event["table"] === "execution_events"
      ) {
        return state;
      }
      state.hitCap ||= event["hitCap"] === true;
    }
    if (state) return state;
  }
  return null;
}

function writeScheduleState(
  state: SnapshotRetentionScheduleState,
  dir = recorderDir(),
): void {
  atomicWriteFlightRecorderJson(scheduleStatePath(dir), {
    schemaVersion: SCHEDULE_STATE_SCHEMA_VERSION,
    ...state,
  });
}

function loadScheduleState(
  dir = recorderDir(),
  nowMs = Date.now(),
): SnapshotRetentionScheduleState | null {
  const persisted = readPersistedScheduleState(dir);
  if (persisted) return persisted;

  const legacy = readLegacyScheduleState(dir, nowMs);
  if (!legacy) return null;
  try {
    writeScheduleState(legacy, dir);
  } catch (err) {
    logger.warn({ err }, "Failed to migrate snapshot retention schedule state");
  }
  return legacy;
}

function firstScheduleDelayMs(input: {
  state: SnapshotRetentionScheduleState | null;
  nowMs: number;
  initialDelayMs: number;
  intervalMs: number;
  backlogIntervalMs: number;
}): number {
  if (!input.state) return input.initialDelayMs;
  const completedAtMs = Date.parse(input.state.completedAt);
  if (!Number.isFinite(completedAtMs)) return input.initialDelayMs;
  const cadenceMs = input.state.hitCap
    ? input.backlogIntervalMs
    : input.intervalMs;
  const elapsedMs = Math.max(0, input.nowMs - completedAtMs);
  return Math.max(0, cadenceMs - elapsedMs);
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
    | "runInLane"
    | "runRetention"
    | "recordEvent"
    | "writeScheduleState"
    | "now"
  > = {},
): Promise<boolean> {
  const runInLane = deps.runInLane ?? runInDbLane;
  const runRetention = deps.runRetention ?? defaultRunRetention;
  const recordEvent = deps.recordEvent ?? appendRuntimeFlightRecorderEvent;
  const persistScheduleState = deps.writeScheduleState ?? writeScheduleState;
  const now = deps.now ?? Date.now;

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
        if (result.error) {
          // Per-table failures are isolated upstream; without this branch a
          // failed sweep would log a normal-looking info line with zeroed
          // counts and never surface at warn level anywhere.
          logger.warn(
            {
              table: result.table,
              cutoff: result.cutoff,
              deleted: result.deleted,
              durationMs: result.durationMs,
              error: result.error,
            },
            "Snapshot retention sweep failed",
          );
          continue;
        }
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
      const hitCap = anySweepHitCap(results);
      try {
        persistScheduleState({
          completedAt: new Date(now()).toISOString(),
          hitCap,
        });
      } catch (err) {
        // Retention already succeeded. A recorder failure must not change its
        // cadence or turn the maintenance run into an operational failure.
        logger.warn(
          { err },
          "Failed to persist snapshot retention schedule state",
        );
      }
      return hitCap;
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
  const now = deps.now ?? Date.now;
  const startedAtMs = now();
  let scheduleState: SnapshotRetentionScheduleState | null = null;
  try {
    scheduleState = (
      deps.readScheduleState ??
      (() => loadScheduleState(recorderDir(), startedAtMs))
    )();
  } catch (err) {
    logger.warn({ err }, "Failed to read snapshot retention schedule state");
  }
  const firstDelayMs = firstScheduleDelayMs({
    state: scheduleState,
    nowMs: startedAtMs,
    initialDelayMs,
    intervalMs,
    backlogIntervalMs,
  });
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

  schedule(firstDelayMs);

  logger.info(
    {
      intervalMs,
      initialDelayMs,
      backlogIntervalMs,
      firstDelayMs,
      lastCompletedAt: scheduleState?.completedAt ?? null,
      lastCycleHitCap: scheduleState?.hitCap ?? null,
    },
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

export const __snapshotRetentionSchedulerInternalsForTests = {
  loadScheduleState,
};

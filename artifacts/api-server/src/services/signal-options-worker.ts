import { sharedAdvisoryLockHolder } from "@workspace/db";
import { logger } from "../lib/logger";
import { runShadowOptionMaintenance } from "./shadow-account";
import {
  getSignalOptionsWorkerSnapshot,
  registerSignalOptionsWorkerSnapshotGetter,
} from "./signal-options-worker-state";

const WORKER_WAKEUP_MS = 5_000;
export const SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY = 1_930_514_022;
const ADVISORY_LOCK_KEY = SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY;

type ReleaseLock = () => Promise<void>;
type WorkerLogger = Pick<typeof logger, "info" | "warn">;

type WorkerDependencies = {
  runMaintenance: (input: { source: "worker" }) => Promise<unknown>;
  acquireTickLock: () => Promise<ReleaseLock | null>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => Date;
  logger: WorkerLogger;
};

export type SignalOptionsWorkerOptions = Partial<WorkerDependencies> & {
  wakeupMs?: number;
};

type MaintenanceRuntime = {
  runCount: number;
  totalClosedCount: number;
  lastRunAt: string | null;
  lastError: string | null;
  lastClosedCount: number;
  lastSkippedCount: number;
  lastDueCount: number;
  lastOrphanCount: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeMaintenanceResult(result: unknown) {
  const record = asRecord(result);
  return {
    closedCount: numeric(record["closedCount"]) ?? 0,
    skippedCount: numeric(record["skippedCount"]) ?? 0,
    dueCount: numeric(record["dueCount"]) ?? 0,
    orphanCount: numeric(record["orphanCount"]) ?? 0,
  };
}

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? Math.min(max, Math.max(min, Math.round(resolved)))
    : fallback;
}

// Session-level advisory lock held on a dedicated connection OUTSIDE the shared
// 12-connection pool. The lock no longer pins a pooled connection idle for the
// duration of the maintenance run; maintenance uses the shared pool normally.
async function acquirePostgresAdvisoryLock(): Promise<ReleaseLock | null> {
  return sharedAdvisoryLockHolder.acquire(ADVISORY_LOCK_KEY);
}

function defaultDependencies(
  options: SignalOptionsWorkerOptions,
): WorkerDependencies {
  return {
    runMaintenance: options.runMaintenance ?? runShadowOptionMaintenance,
    acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
    setTimer: options.setTimer ?? setTimeout,
    clearTimer: options.clearTimer ?? clearTimeout,
    now: options.now ?? (() => new Date()),
    logger: options.logger ?? logger,
  };
}

export function createSignalOptionsWorker(
  options: SignalOptionsWorkerOptions = {},
) {
  const dependencies = defaultDependencies(options);
  const wakeupMs = positiveInteger(
    options.wakeupMs,
    WORKER_WAKEUP_MS,
    250,
    3_600_000,
  );
  const maintenanceRuntime: MaintenanceRuntime = {
    runCount: 0,
    totalClosedCount: 0,
    lastRunAt: null,
    lastError: null,
    lastClosedCount: 0,
    lastSkippedCount: 0,
    lastDueCount: 0,
    lastOrphanCount: 0,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let tickRunning = false;
  let postTickWakeRequested = false;

  const runOnce = async () => {
    if (tickRunning) {
      return;
    }

    tickRunning = true;
    let releaseLock: ReleaseLock | null = null;

    try {
      releaseLock = await dependencies.acquireTickLock();
      if (!releaseLock) {
        return;
      }

      try {
        const maintenance = summarizeMaintenanceResult(
          await dependencies.runMaintenance({ source: "worker" }),
        );
        maintenanceRuntime.runCount += 1;
        maintenanceRuntime.totalClosedCount += maintenance.closedCount;
        maintenanceRuntime.lastRunAt = dependencies.now().toISOString();
        maintenanceRuntime.lastError = null;
        maintenanceRuntime.lastClosedCount = maintenance.closedCount;
        maintenanceRuntime.lastSkippedCount = maintenance.skippedCount;
        maintenanceRuntime.lastDueCount = maintenance.dueCount;
        maintenanceRuntime.lastOrphanCount = maintenance.orphanCount;
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Signal-options shadow maintenance failed.";
        maintenanceRuntime.lastRunAt = dependencies.now().toISOString();
        maintenanceRuntime.lastError = message;
        dependencies.logger.warn(
          { err: error },
          "Signal-options shadow maintenance failed",
        );
      }
    } catch (error) {
      dependencies.logger.warn(
        { err: error },
        "Signal-options maintenance worker tick failed",
      );
    } finally {
      if (releaseLock) {
        try {
          await releaseLock();
        } catch (error) {
          dependencies.logger.warn(
            { err: error },
            "Signal-options worker advisory lock release failed",
          );
        }
      }
      tickRunning = false;
    }
  };

  const schedule = (delayMs = wakeupMs) => {
    if (!started || timer) {
      return;
    }

    timer = dependencies.setTimer(() => {
      timer = null;
      void runOnce().finally(scheduleAfterRun);
    }, Math.max(0, delayMs));
    timer.unref?.();
  };

  const scheduleAfterRun = () => {
    if (postTickWakeRequested) {
      postTickWakeRequested = false;
      schedule(0);
      return;
    }
    schedule(wakeupMs);
  };

  const requestRunSoon = () => {
    if (!started) {
      return;
    }
    if (tickRunning) {
      postTickWakeRequested = true;
      return;
    }
    if (timer) {
      dependencies.clearTimer(timer);
      timer = null;
    }
    schedule(0);
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      void runOnce().finally(scheduleAfterRun);
      dependencies.logger.info("Signal-options maintenance worker started");
    },
    stop() {
      started = false;
      if (timer) {
        dependencies.clearTimer(timer);
        timer = null;
      }
    },
    requestRunSoon,
    runOnce,
    getRuntimeSnapshot() {
      return {
        started,
        scanEnabled: false,
        tickRunning,
        deploymentCount: 0,
        activeDeploymentCount: 0,
        maintenance: { ...maintenanceRuntime },
        deployments: [],
      };
    },
  };
}

const defaultWorker = createSignalOptionsWorker();
registerSignalOptionsWorkerSnapshotGetter(defaultWorker.getRuntimeSnapshot);

export function startSignalOptionsWorker(): void {
  defaultWorker.start();
}

export function stopSignalOptionsWorker(): void {
  defaultWorker.stop();
}

export { getSignalOptionsWorkerSnapshot };

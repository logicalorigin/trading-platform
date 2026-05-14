import { pool, type AlgoDeployment } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import {
  listEnabledSignalOptionsDeployments,
  runSignalOptionsShadowScan,
} from "./signal-options-automation";
import {
  getSignalOptionsWorkerSnapshot,
  registerSignalOptionsWorkerSnapshotGetter,
} from "./signal-options-worker-state";

const WORKER_WAKEUP_MS = 5_000;
const ADVISORY_LOCK_KEY = 1_930_514_022;
const FAILED_DEPLOYMENT_RETRY_MS = 60_000;

type ReleaseLock = () => Promise<void>;
type WorkerLogger = Pick<typeof logger, "debug" | "info" | "warn">;

type WorkerDependencies = {
  listDeployments: () => Promise<AlgoDeployment[]>;
  scanDeployment: (input: {
    deploymentId: string;
    forceEvaluate: boolean;
    source: "worker";
  }) => Promise<unknown>;
  acquireTickLock: () => Promise<ReleaseLock | null>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => Date;
  logger: WorkerLogger;
};

export type SignalOptionsWorkerOptions = Partial<WorkerDependencies> & {
  wakeupMs?: number;
};

type DeploymentRuntime = {
  signature: string;
  lastCheckedAtMs: number;
  failedUntilMs: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  scanCount: number;
  totalFailureCount: number;
  failureCount: number;
  lastFailureAt: string | null;
  lastSignalCount: number;
  lastFreshSignalCount: number;
  lastStaleSignalCount: number;
  lastUnavailableSignalCount: number;
  lastLatestSignalBarAt: string | null;
  lastOldestSignalBarAt: string | null;
  lastCandidateCount: number;
  lastBlockedCandidateCount: number;
};

const activeDeploymentIds = new Set<string>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function summarizeScanResult(result: unknown) {
  const record = asRecord(result);
  const signals = asArray(record["signals"]).map(asRecord);
  const candidates = asArray(record["candidates"]).map(asRecord);
  const signalBarTimes = signals
    .map((signal) => timestampMs(signal["latestBarAt"]))
    .filter((value): value is number => value !== null);
  const latestSignalBarAt =
    signalBarTimes.length > 0 ? Math.max(...signalBarTimes) : null;
  const oldestSignalBarAt =
    signalBarTimes.length > 0 ? Math.min(...signalBarTimes) : null;

  return {
    signalCount: signals.length,
    freshSignalCount: signals.filter((signal) => signal["fresh"] === true).length,
    staleSignalCount: signals.filter(
      (signal) => String(signal["status"] ?? "").toLowerCase() === "stale",
    ).length,
    unavailableSignalCount: signals.filter(
      (signal) =>
        String(signal["status"] ?? "").toLowerCase() === "unavailable" ||
        timestampMs(signal["latestBarAt"]) === null,
    ).length,
    latestSignalBarAt:
      latestSignalBarAt === null
        ? null
        : new Date(latestSignalBarAt).toISOString(),
    oldestSignalBarAt:
      oldestSignalBarAt === null
        ? null
        : new Date(oldestSignalBarAt).toISOString(),
    candidateCount: candidates.length,
    blockedCandidateCount: candidates.filter((candidate) => {
      const actionStatus = String(candidate["actionStatus"] ?? "");
      const status = String(candidate["status"] ?? "");
      return actionStatus === "blocked" || status === "skipped";
    }).length,
  };
}

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? Math.min(max, Math.max(min, Math.round(resolved)))
    : fallback;
}

function deploymentSignature(deployment: AlgoDeployment): string {
  const config = asRecord(deployment.config);
  return JSON.stringify({
    enabled: deployment.enabled,
    mode: deployment.mode,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    signalOptions: config.signalOptions ?? {},
    parameters: config.parameters ?? {},
  });
}

function resolvePollIntervalSeconds(deployment: AlgoDeployment): number {
  const config = asRecord(deployment.config);
  const signalOptions = asRecord(config.signalOptions);
  const worker = asRecord(signalOptions.worker);
  return positiveInteger(worker.pollIntervalSeconds, 60, 15, 3600);
}

async function acquirePostgresAdvisoryLock(): Promise<ReleaseLock | null> {
  const client = await pool.connect();
  let locked = false;

  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [ADVISORY_LOCK_KEY],
    );
    locked = result.rows[0]?.locked === true;

    if (!locked) {
      client.release();
      return null;
    }

    return async () => {
      try {
        await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
      } finally {
        client.release();
      }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

function defaultDependencies(
  options: SignalOptionsWorkerOptions,
): WorkerDependencies {
  return {
    listDeployments:
      options.listDeployments ?? listEnabledSignalOptionsDeployments,
    scanDeployment: options.scanDeployment ?? runSignalOptionsShadowScan,
    acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
    setTimer: options.setTimer ?? setTimeout,
    clearTimer: options.clearTimer ?? clearTimeout,
    now: options.now ?? (() => new Date()),
    logger: options.logger ?? logger,
  };
}

async function runDeployment(input: {
  deployment: AlgoDeployment;
  runtime: DeploymentRuntime;
  dependencies: WorkerDependencies;
}) {
  const { deployment, runtime, dependencies } = input;
  if (activeDeploymentIds.has(deployment.id)) {
    dependencies.logger.debug?.(
      { deploymentId: deployment.id },
      "Signal-options deployment scan already running",
    );
    return;
  }

  activeDeploymentIds.add(deployment.id);
  try {
    const scanResult = await dependencies.scanDeployment({
      deploymentId: deployment.id,
      forceEvaluate: false,
      source: "worker",
    });
    const scanSummary = summarizeScanResult(scanResult);
    runtime.scanCount += 1;
    runtime.lastSuccessAt = dependencies.now().toISOString();
    runtime.lastError = null;
    runtime.failedUntilMs = 0;
    runtime.failureCount = 0;
    runtime.lastSignalCount = scanSummary.signalCount;
    runtime.lastFreshSignalCount = scanSummary.freshSignalCount;
    runtime.lastStaleSignalCount = scanSummary.staleSignalCount;
    runtime.lastUnavailableSignalCount = scanSummary.unavailableSignalCount;
    runtime.lastLatestSignalBarAt = scanSummary.latestSignalBarAt;
    runtime.lastOldestSignalBarAt = scanSummary.oldestSignalBarAt;
    runtime.lastCandidateCount = scanSummary.candidateCount;
    runtime.lastBlockedCandidateCount = scanSummary.blockedCandidateCount;
  } catch (error) {
    const failedAt = dependencies.now();
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Signal-options shadow worker scan failed.";
    runtime.totalFailureCount += 1;
    runtime.failureCount += 1;
    runtime.lastFailureAt = failedAt.toISOString();
    runtime.lastError = message;
    runtime.failedUntilMs = failedAt.getTime() + FAILED_DEPLOYMENT_RETRY_MS;
    dependencies.logger.warn(
      { err: error, deploymentId: deployment.id },
      "Signal-options shadow worker scan failed",
    );
  } finally {
    activeDeploymentIds.delete(deployment.id);
  }
}

export function createSignalOptionsWorker(
  options: SignalOptionsWorkerOptions = {},
) {
  const dependencies = defaultDependencies(options);
  const transientDbBackoff = createTransientPostgresBackoff();
  const wakeupMs = positiveInteger(
    options.wakeupMs,
    WORKER_WAKEUP_MS,
    250,
    3_600_000,
  );
  const deploymentRuntime = new Map<string, DeploymentRuntime>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let tickRunning = false;

  const runOnce = async () => {
    if (tickRunning) {
      return;
    }

    tickRunning = true;
    let releaseLock: ReleaseLock | null = null;

    try {
      const backoffCheckMs = dependencies.now().getTime();
      if (transientDbBackoff.isActive(backoffCheckMs)) {
        return;
      }

      releaseLock = await dependencies.acquireTickLock();
      if (!releaseLock) {
        return;
      }

      const now = dependencies.now();
      const nowMs = now.getTime();
      const deployments = await dependencies.listDeployments();
      const enabledIds = new Set(deployments.map((deployment) => deployment.id));

      Array.from(deploymentRuntime.keys()).forEach((deploymentId) => {
        if (!enabledIds.has(deploymentId)) {
          deploymentRuntime.delete(deploymentId);
        }
      });

      for (const deployment of deployments) {
        const signature = deploymentSignature(deployment);
        let runtime = deploymentRuntime.get(deployment.id);
        const signatureChanged = runtime?.signature !== signature;

        if (!runtime || signatureChanged) {
          runtime = {
            signature,
            lastCheckedAtMs: 0,
            failedUntilMs: 0,
            lastSuccessAt: null,
            lastError: null,
            scanCount: 0,
            totalFailureCount: 0,
            failureCount: 0,
            lastFailureAt: null,
            lastSignalCount: 0,
            lastFreshSignalCount: 0,
            lastStaleSignalCount: 0,
            lastUnavailableSignalCount: 0,
            lastLatestSignalBarAt: null,
            lastOldestSignalBarAt: null,
            lastCandidateCount: 0,
            lastBlockedCandidateCount: 0,
          };
          deploymentRuntime.set(deployment.id, runtime);
        }

        if (runtime.failedUntilMs > nowMs) {
          continue;
        }

        const pollIntervalMs = resolvePollIntervalSeconds(deployment) * 1000;
        if (
          !signatureChanged &&
          runtime.lastCheckedAtMs > 0 &&
          nowMs - runtime.lastCheckedAtMs < pollIntervalMs
        ) {
          continue;
        }

        runtime.lastCheckedAtMs = nowMs;
        await runDeployment({ deployment, runtime, dependencies });
      }
      transientDbBackoff.clear();
    } catch (error) {
      if (isTransientPostgresError(error)) {
        transientDbBackoff.markFailure({
          error,
          logger: dependencies.logger,
          message:
            "Signal-options database unavailable; pausing worker ticks",
          nowMs: dependencies.now().getTime(),
        });
        return;
      }
      dependencies.logger.warn(
        { err: error },
        "Signal-options shadow worker tick failed",
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

  const schedule = () => {
    if (!started || timer) {
      return;
    }

    timer = dependencies.setTimer(() => {
      timer = null;
      void runOnce().finally(schedule);
    }, wakeupMs);
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      void runOnce().finally(schedule);
      dependencies.logger.info("Signal-options shadow worker started");
    },
    stop() {
      started = false;
      if (timer) {
        dependencies.clearTimer(timer);
        timer = null;
      }
    },
    runOnce,
    getRuntimeSnapshot() {
      const deployments = Array.from(deploymentRuntime.entries()).map(
        ([deploymentId, runtime]) => ({
          deploymentId,
          lastCheckedAtMs: runtime.lastCheckedAtMs,
          failedUntilMs: runtime.failedUntilMs,
          lastSuccessAt: runtime.lastSuccessAt,
          lastError: runtime.lastError,
          scanCount: runtime.scanCount,
          totalFailureCount: runtime.totalFailureCount,
          failureCount: runtime.failureCount,
          lastFailureAt: runtime.lastFailureAt,
          lastSignalCount: runtime.lastSignalCount,
          lastFreshSignalCount: runtime.lastFreshSignalCount,
          lastStaleSignalCount: runtime.lastStaleSignalCount,
          lastUnavailableSignalCount: runtime.lastUnavailableSignalCount,
          lastLatestSignalBarAt: runtime.lastLatestSignalBarAt,
          lastOldestSignalBarAt: runtime.lastOldestSignalBarAt,
          lastCandidateCount: runtime.lastCandidateCount,
          lastBlockedCandidateCount: runtime.lastBlockedCandidateCount,
        }),
      );
      return {
        started,
        tickRunning,
        deploymentCount: deploymentRuntime.size,
        activeDeploymentCount: activeDeploymentIds.size,
        deployments,
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

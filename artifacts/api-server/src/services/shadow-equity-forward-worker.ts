import { pool, type AlgoDeployment } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  listEnabledShadowEquityForwardDeployments,
  resolveShadowEquityForwardPollIntervalSeconds,
  runShadowEquityForwardScanSafely,
} from "./shadow-equity-forward-test";

const WORKER_WAKEUP_MS = 5_000;
const ADVISORY_LOCK_KEY = 1_930_514_023;
const FAILED_DEPLOYMENT_RETRY_MS = 60_000;

type ReleaseLock = () => Promise<void>;
type WorkerLogger = Pick<typeof logger, "debug" | "info" | "warn">;

type WorkerDependencies = {
  listDeployments: () => Promise<AlgoDeployment[]>;
  scanDeployment: (input: {
    deploymentId: string;
    source: "worker";
  }) => Promise<unknown>;
  acquireTickLock: () => Promise<ReleaseLock | null>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => Date;
  logger: WorkerLogger;
};

export type ShadowEquityForwardWorkerOptions = Partial<WorkerDependencies> & {
  wakeupMs?: number;
};

type DeploymentRuntime = {
  signature: string;
  lastCheckedAtMs: number;
  failedUntilMs: number;
};

let activeWorker: ReturnType<typeof createShadowEquityForwardWorker> | null = null;
const activeDeploymentIds = new Set<string>();

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? Math.min(max, Math.max(min, Math.round(resolved)))
    : fallback;
}

function deploymentSignature(deployment: AlgoDeployment): string {
  return JSON.stringify({
    enabled: deployment.enabled,
    mode: deployment.mode,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    config: deployment.config ?? {},
  });
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
  options: ShadowEquityForwardWorkerOptions,
): WorkerDependencies {
  return {
    listDeployments:
      options.listDeployments ?? listEnabledShadowEquityForwardDeployments,
    scanDeployment: options.scanDeployment ?? runShadowEquityForwardScanSafely,
    acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
    setTimer: options.setTimer ?? setTimeout,
    clearTimer: options.clearTimer ?? clearTimeout,
    now: options.now ?? (() => new Date()),
    logger: options.logger ?? logger,
  };
}

async function runDeployment(input: {
  deployment: AlgoDeployment;
  dependencies: WorkerDependencies;
}) {
  const { deployment, dependencies } = input;
  if (activeDeploymentIds.has(deployment.id)) {
    dependencies.logger.debug?.(
      { deploymentId: deployment.id },
      "Shadow equity forward-test scan already running",
    );
    return;
  }

  activeDeploymentIds.add(deployment.id);
  try {
    await dependencies.scanDeployment({
      deploymentId: deployment.id,
      source: "worker",
    });
  } finally {
    activeDeploymentIds.delete(deployment.id);
  }
}

export function createShadowEquityForwardWorker(
  options: ShadowEquityForwardWorkerOptions = {},
) {
  const dependencies = defaultDependencies(options);
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
          };
          deploymentRuntime.set(deployment.id, runtime);
        }

        const pollIntervalMs =
          resolveShadowEquityForwardPollIntervalSeconds(deployment) * 1000;
        if (runtime.failedUntilMs > nowMs) {
          continue;
        }
        if (
          !signatureChanged &&
          runtime.lastCheckedAtMs > 0 &&
          nowMs - runtime.lastCheckedAtMs < pollIntervalMs
        ) {
          continue;
        }

        runtime.lastCheckedAtMs = nowMs;
        try {
          await runDeployment({ deployment, dependencies });
          runtime.failedUntilMs = 0;
        } catch (error) {
          runtime.failedUntilMs = nowMs + FAILED_DEPLOYMENT_RETRY_MS;
          dependencies.logger.warn(
            { err: error, deploymentId: deployment.id },
            "Shadow equity forward-test worker scan failed",
          );
        }
      }
    } catch (error) {
      dependencies.logger.warn(
        { err: error },
        "Shadow equity forward-test worker tick failed",
      );
    } finally {
      if (releaseLock) {
        try {
          await releaseLock();
        } catch (error) {
          dependencies.logger.warn(
            { err: error },
            "Shadow equity forward-test worker advisory lock release failed",
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
    timer.unref?.();
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      dependencies.logger.info?.("Shadow equity forward-test worker started");
      schedule();
    },
    stop() {
      started = false;
      if (timer) {
        dependencies.clearTimer(timer);
        timer = null;
      }
    },
    runOnce,
  };
}

export function startShadowEquityForwardWorker() {
  if (activeWorker) {
    return activeWorker;
  }
  activeWorker = createShadowEquityForwardWorker();
  activeWorker.start();
  return activeWorker;
}

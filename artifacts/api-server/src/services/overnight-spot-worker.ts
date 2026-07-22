import {
  safeDatabaseDiagnosticValue,
  sharedAdvisoryLockHolder,
  type AdvisoryLockLease,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { resolveEquityExecutionProfile } from "./overnight-spot-automation";
import {
  listEnabledOvernightSpotDeployments,
  runOvernightSpotSignalScan,
  type OvernightSpotSignalScanResult,
  type OvernightSpotWorkerDeployment,
} from "./overnight-spot-execution";
import { getApiResourcePressureSnapshot } from "./resource-pressure";
import type { ApiResourcePressureSnapshot } from "./resource-pressure";
import {
  subscribeAlgoCockpitChanges,
  type AlgoCockpitChange,
} from "./algo-cockpit-events";
import {
  registerOvernightSpotWorkerSnapshotGetter,
  type OvernightSpotWorkerSnapshot,
} from "./overnight-spot-worker-state";
import {
  resolveUsEquityMarketStatus,
  type UsEquityMarketSessionKey,
} from "@workspace/market-calendar";

const WORKER_WAKEUP_MS = 5_000;
const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const FAILED_DEPLOYMENT_RETRY_MS = 60_000;
const DEFAULT_WORKER_SCAN_TIMEOUT_MS = 45_000;
const WORKER_SCAN_TIMEOUT_MIN_MS = 5_000;
const WORKER_SCAN_TIMEOUT_MAX_MS = 300_000;
const EXECUTION_STYLE_SESSION_RETRY_MS = 60_000;
export const OVERNIGHT_SPOT_WORKER_ADVISORY_LOCK_KEY = 1_930_514_023;

function safeWorkerError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : null;
  return safeDatabaseDiagnosticValue(message?.trim() || null) ?? fallback;
}

type WorkerLogger = Pick<typeof logger, "debug" | "info" | "warn">;

type WorkerDependencies = {
  listDeployments: () => Promise<OvernightSpotWorkerDeployment[]>;
  scanDeployment: (input: {
    deploymentId: string;
    runActions: true;
    recordSignals: true;
    marketSessionKey: UsEquityMarketSessionKey;
    signal?: AbortSignal;
  }) => Promise<OvernightSpotSignalScanResult>;
  getResourcePressure: () => ApiResourcePressureSnapshot;
  getMarketSessionKey: (now: Date) => UsEquityMarketSessionKey;
  acquireTickLock: () => Promise<AdvisoryLockLease | null>;
  setTimer: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => Date;
  logger: WorkerLogger;
  scanTimeoutMs: number | null;
  subscribeCockpitChanges: (
    listener: (change: AlgoCockpitChange) => void,
  ) => () => void;
};

export type OvernightSpotWorkerOptions = Partial<WorkerDependencies> & {
  wakeupMs?: number;
};

type DeploymentRuntime = {
  signature: string;
  pollIntervalMs: number;
  nextScanDueAtMs: number | null;
  failedUntilMs: number;
  currentScanStartedAtMs: number | null;
  lastCheckedAtMs: number | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastSkippedAtMs: number | null;
  lastSkipReason: string | null;
  scanCount: number;
  failureCount: number;
  skippedScanCount: number;
  lastScanDurationMs: number | null;
  lastCandidateCount: number;
  lastExecutedCount: number;
  lastBlockedCount: number;
  lastSkippedCount: number;
  lastFailedCount: number;
  timedOut: boolean;
  unsettledAfterTimeout: boolean;
};

const activeDeploymentIds = new Set<string>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? Math.min(max, Math.max(min, Math.round(resolved)))
    : fallback;
}

function resolveWorkerScanTimeoutMs(value: unknown): number | null {
  if (value === null || value === false) {
    return null;
  }
  const configured =
    value === undefined
      ? process.env["OVERNIGHT_SPOT_WORKER_SCAN_TIMEOUT_MS"]
      : value;
  if (configured === null || configured === "" || configured === "0") {
    return null;
  }
  return positiveInteger(
    configured,
    DEFAULT_WORKER_SCAN_TIMEOUT_MS,
    WORKER_SCAN_TIMEOUT_MIN_MS,
    WORKER_SCAN_TIMEOUT_MAX_MS,
  );
}

function deploymentSignature(deployment: OvernightSpotWorkerDeployment) {
  const config = asRecord(deployment.config);
  return JSON.stringify({
    enabled: deployment.enabled,
    mode: deployment.mode,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    equityExecution: config.equityExecution ?? {},
    overnightSpot: config.overnightSpot ?? {},
    parameters: config.parameters ?? {},
  });
}

function resolvePollIntervalSeconds(
  deployment: OvernightSpotWorkerDeployment,
): number {
  const config = asRecord(deployment.config);
  const overnightSpot = asRecord(config.overnightSpot);
  const worker = asRecord(overnightSpot.worker);
  return positiveInteger(
    worker.pollIntervalSeconds,
    DEFAULT_POLL_INTERVAL_SECONDS,
    15,
    3_600,
  );
}

function createDeploymentRuntime(signature: string): DeploymentRuntime {
  return {
    signature,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_SECONDS * 1000,
    nextScanDueAtMs: null,
    failedUntilMs: 0,
    currentScanStartedAtMs: null,
    lastCheckedAtMs: null,
    lastSuccessAt: null,
    lastError: null,
    lastSkippedAtMs: null,
    lastSkipReason: null,
    scanCount: 0,
    failureCount: 0,
    skippedScanCount: 0,
    lastScanDurationMs: null,
    lastCandidateCount: 0,
    lastExecutedCount: 0,
    lastBlockedCount: 0,
    lastSkippedCount: 0,
    lastFailedCount: 0,
    timedOut: false,
    unsettledAfterTimeout: false,
  };
}

class OvernightSpotWorkerScanTimeoutError extends Error {
  readonly scanPromise: Promise<OvernightSpotSignalScanResult>;
  readonly timeoutMs: number;

  constructor(input: {
    deploymentId: string;
    scanPromise: Promise<OvernightSpotSignalScanResult>;
    timeoutMs: number;
  }) {
    super(
      `Overnight spot worker scan timed out for ${input.deploymentId} after ${input.timeoutMs}ms.`,
    );
    this.name = "OvernightSpotWorkerScanTimeoutError";
    this.scanPromise = input.scanPromise;
    this.timeoutMs = input.timeoutMs;
  }
}

function isWorkerScanTimeoutError(
  error: unknown,
): error is OvernightSpotWorkerScanTimeoutError {
  return error instanceof OvernightSpotWorkerScanTimeoutError;
}

// Session-level advisory lock held on a dedicated connection OUTSIDE the shared
// 12-connection pool. The lock no longer pins a pooled connection idle for the
// duration of the scan run; scans use the shared pool normally.
async function acquirePostgresAdvisoryLock(): Promise<AdvisoryLockLease | null> {
  return sharedAdvisoryLockHolder.acquire(OVERNIGHT_SPOT_WORKER_ADVISORY_LOCK_KEY);
}

function defaultDependencies(
  options: OvernightSpotWorkerOptions,
): WorkerDependencies {
  return {
    listDeployments:
      options.listDeployments ?? listEnabledOvernightSpotDeployments,
    scanDeployment:
      options.scanDeployment ??
      ((input) => runOvernightSpotSignalScan(input)),
    getResourcePressure:
      options.getResourcePressure ?? getApiResourcePressureSnapshot,
    getMarketSessionKey:
      options.getMarketSessionKey ??
      ((now) => resolveUsEquityMarketStatus(now).session.key),
    acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
    setTimer: options.setTimer ?? setTimeout,
    clearTimer: options.clearTimer ?? clearTimeout,
    now: options.now ?? (() => new Date()),
    logger: options.logger ?? logger,
    scanTimeoutMs: resolveWorkerScanTimeoutMs(options.scanTimeoutMs),
    subscribeCockpitChanges:
      options.subscribeCockpitChanges ?? subscribeAlgoCockpitChanges,
  };
}

async function runDeploymentScanWithTimeout(input: {
  deployment: OvernightSpotWorkerDeployment;
  dependencies: WorkerDependencies;
  marketSessionKey: UsEquityMarketSessionKey;
  signal: AbortSignal;
}) {
  const { deployment, dependencies } = input;
  input.signal.throwIfAborted();
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const scanPromise = dependencies.scanDeployment({
    deploymentId: deployment.id,
    runActions: true,
    recordSignals: true,
    marketSessionKey: input.marketSessionKey,
    signal,
  });
  if (dependencies.scanTimeoutMs === null) {
    const result = await scanPromise;
    input.signal.throwIfAborted();
    return result;
  }
  const timeoutMs = dependencies.scanTimeoutMs;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = dependencies.setTimer(() => {
      const error = new OvernightSpotWorkerScanTimeoutError({
        deploymentId: deployment.id,
        scanPromise,
        timeoutMs,
      });
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timeout.unref?.();
  });

  try {
    const result = await Promise.race([scanPromise, timeoutPromise]);
    input.signal.throwIfAborted();
    return result;
  } finally {
    if (timeout) {
      dependencies.clearTimer(timeout);
    }
  }
}

async function runDeployment(input: {
  deployment: OvernightSpotWorkerDeployment;
  runtime: DeploymentRuntime;
  dependencies: WorkerDependencies;
  marketSessionKey: UsEquityMarketSessionKey;
  signal: AbortSignal;
}) {
  const { deployment, runtime, dependencies } = input;
  input.signal.throwIfAborted();
  if (activeDeploymentIds.has(deployment.id)) {
    return;
  }

  const scanStartedAtMs = dependencies.now().getTime();
  let leaveActiveUntilSettled = false;
  let timedOutScanPromise: Promise<OvernightSpotSignalScanResult> | null = null;
  activeDeploymentIds.add(deployment.id);
  runtime.currentScanStartedAtMs = scanStartedAtMs;
  runtime.timedOut = false;
  runtime.unsettledAfterTimeout = false;
  try {
    const result = await runDeploymentScanWithTimeout({
      deployment,
      dependencies,
      marketSessionKey: input.marketSessionKey,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    runtime.scanCount += 1;
    runtime.failureCount = 0;
    runtime.lastSuccessAt = dependencies.now().toISOString();
    runtime.lastError = null;
    runtime.lastCandidateCount = result.candidateCount;
    runtime.lastExecutedCount = result.executedCount;
    runtime.lastBlockedCount = result.blockedCount;
    runtime.lastSkippedCount = result.skippedCount;
    runtime.lastFailedCount = result.failedCount;
  } catch (error) {
    input.signal.throwIfAborted();
    if (isWorkerScanTimeoutError(error)) {
      leaveActiveUntilSettled = true;
      timedOutScanPromise = error.scanPromise;
      runtime.timedOut = true;
      runtime.unsettledAfterTimeout = true;
    }
    const message = safeWorkerError(error, "Overnight spot worker scan failed.");
    const failedAt = dependencies.now();
    runtime.failureCount += 1;
    runtime.lastError = message;
    runtime.failedUntilMs = failedAt.getTime() + FAILED_DEPLOYMENT_RETRY_MS;
    dependencies.logger.warn(
      { error: message, deploymentId: deployment.id },
      "Overnight spot worker scan failed",
    );
  } finally {
    const scanEndedAtMs = dependencies.now().getTime();
    runtime.lastScanDurationMs = Math.max(0, scanEndedAtMs - scanStartedAtMs);
    runtime.lastCheckedAtMs = scanEndedAtMs;
    runtime.nextScanDueAtMs = scanEndedAtMs + runtime.pollIntervalMs;
    if (leaveActiveUntilSettled && timedOutScanPromise) {
      // ponytail: fail closed by retaining the lease until the protected scan
      // settles; durable effect fencing is required before releasing earlier.
      await timedOutScanPromise.catch(() => {});
    }
    runtime.currentScanStartedAtMs = null;
    runtime.unsettledAfterTimeout = false;
    activeDeploymentIds.delete(deployment.id);
  }
}

function markSkipped(input: {
  runtime: DeploymentRuntime;
  reason: string;
  nowMs: number;
}) {
  input.runtime.lastSkippedAtMs = input.nowMs;
  input.runtime.lastSkipReason = input.reason;
  input.runtime.skippedScanCount += 1;
}

function pauseDeploymentForUnavailableSession(input: {
  runtime: DeploymentRuntime;
  nowMs: number;
}) {
  markSkipped({
    runtime: input.runtime,
    reason: "execution_style_session_unavailable",
    nowMs: input.nowMs,
  });
  input.runtime.lastCheckedAtMs = input.nowMs;
  input.runtime.currentScanStartedAtMs = null;
  input.runtime.timedOut = false;
  input.runtime.unsettledAfterTimeout = false;
  input.runtime.nextScanDueAtMs =
    input.nowMs + EXECUTION_STYLE_SESSION_RETRY_MS;
}

function dateString(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function createOvernightSpotWorker(
  options: OvernightSpotWorkerOptions = {},
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
  let wakeRequested = false;
  let cockpitUnsubscribe: (() => void) | null = null;

  const runOnce = async () => {
    if (tickRunning) {
      return;
    }
    tickRunning = true;
    let releaseLock: AdvisoryLockLease | null = null;
    try {
      releaseLock = await dependencies.acquireTickLock();
      if (!releaseLock) {
        return;
      }
      const signal = releaseLock.signal;
      signal.throwIfAborted();

      const nowMs = dependencies.now().getTime();
      const deployments = await dependencies.listDeployments();
      signal.throwIfAborted();
      const enabledIds = new Set(deployments.map((deployment) => deployment.id));
      Array.from(deploymentRuntime.keys()).forEach((deploymentId) => {
        if (!enabledIds.has(deploymentId)) {
          deploymentRuntime.delete(deploymentId);
        }
      });

      const marketSessionKey = dependencies.getMarketSessionKey(
        new Date(nowMs),
      );
      const activeStyle =
        marketSessionKey === "rth"
          ? "day"
          : marketSessionKey === "overnight"
            ? "overnight"
            : null;
      for (const deployment of deployments) {
        const signature = deploymentSignature(deployment);
        let runtime = deploymentRuntime.get(deployment.id);
        const signatureChanged = runtime?.signature !== signature;
        if (!runtime || signatureChanged) {
          runtime = createDeploymentRuntime(signature);
          deploymentRuntime.set(deployment.id, runtime);
        }

        if (runtime.failedUntilMs > nowMs) {
          continue;
        }

        runtime.pollIntervalMs = resolvePollIntervalSeconds(deployment) * 1000;
        runtime.nextScanDueAtMs ??= nowMs;
        if (
          !signatureChanged &&
          runtime.lastCheckedAtMs !== null &&
          nowMs < runtime.nextScanDueAtMs
        ) {
          continue;
        }

        const selectedStyles = resolveEquityExecutionProfile({
          config: deployment.config,
          providerAccountId: deployment.providerAccountId,
        }).styles;
        if (!activeStyle || !selectedStyles.includes(activeStyle)) {
          pauseDeploymentForUnavailableSession({ runtime, nowMs });
          continue;
        }

        // Scans always include entry work, even under resource pressure
        // (entry-skip gate removed per owner directive 2026-07-07).
        runtime.nextScanDueAtMs = null;
        await runDeployment({
          deployment,
          runtime,
          dependencies,
          marketSessionKey,
          signal,
        });
        signal.throwIfAborted();
      }
    } catch (error) {
      if (releaseLock?.signal.aborted) {
        return;
      }
      dependencies.logger.warn(
        { error: safeWorkerError(error, "Overnight spot worker tick failed.") },
        "Overnight spot worker tick failed",
      );
    } finally {
      if (releaseLock) {
        try {
          await releaseLock();
        } catch (error) {
          dependencies.logger.warn(
            {
              error: safeWorkerError(
                error,
                "Overnight spot worker advisory lock release failed.",
              ),
            },
            "Overnight spot worker advisory lock release failed",
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
    const delayMs = wakeRequested ? 0 : wakeupMs;
    wakeRequested = false;
    schedule(delayMs);
  };

  const requestRunSoon = () => {
    if (!started) {
      return;
    }
    wakeRequested = true;
    const requestedAtMs = dependencies.now().getTime();
    deploymentRuntime.forEach((runtime) => {
      runtime.nextScanDueAtMs = requestedAtMs;
    });
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
      cockpitUnsubscribe = dependencies.subscribeCockpitChanges((change) => {
        if (change.reason === "signal_monitor_event_created" && !tickRunning) {
          requestRunSoon();
        }
      });
      void runOnce().finally(scheduleAfterRun);
      dependencies.logger.info("Overnight spot worker started");
    },
    stop() {
      started = false;
      cockpitUnsubscribe?.();
      cockpitUnsubscribe = null;
      if (timer) {
        dependencies.clearTimer(timer);
        timer = null;
      }
    },
    requestRunSoon,
    runOnce,
    getRuntimeSnapshot(): OvernightSpotWorkerSnapshot {
      const snapshotNowMs = dependencies.now().getTime();
      return {
        started,
        tickRunning,
        deploymentCount: deploymentRuntime.size,
        deployments: Array.from(deploymentRuntime.entries()).map(
          ([deploymentId, runtime]) => ({
            deploymentId,
            lastCheckedAt: dateString(runtime.lastCheckedAtMs),
            lastSuccessAt: runtime.lastSuccessAt,
            lastError: runtime.lastError,
            lastSkippedAt: dateString(runtime.lastSkippedAtMs),
            lastSkipReason: runtime.lastSkipReason,
            scanCount: runtime.scanCount,
            failureCount: runtime.failureCount,
            skippedScanCount: runtime.skippedScanCount,
            lastScanDurationMs: runtime.lastScanDurationMs,
            lastCandidateCount: runtime.lastCandidateCount,
            lastExecutedCount: runtime.lastExecutedCount,
            lastBlockedCount: runtime.lastBlockedCount,
            lastSkippedCount: runtime.lastSkippedCount,
            lastFailedCount: runtime.lastFailedCount,
            timedOut: runtime.timedOut,
            unsettledAfterTimeout: runtime.unsettledAfterTimeout,
            nextScanDueAt: dateString(runtime.nextScanDueAtMs),
            nextScanDueInMs:
              runtime.nextScanDueAtMs === null
                ? null
                : Math.max(0, runtime.nextScanDueAtMs - snapshotNowMs),
          }),
        ),
      };
    },
  };
}

let singletonWorker: ReturnType<typeof createOvernightSpotWorker> | null = null;

export function startOvernightSpotWorker(
  options: OvernightSpotWorkerOptions = {},
) {
  if (!singletonWorker) {
    singletonWorker = createOvernightSpotWorker(options);
    registerOvernightSpotWorkerSnapshotGetter(
      singletonWorker.getRuntimeSnapshot,
    );
  }
  singletonWorker.start();
  return singletonWorker;
}

export function requestOvernightSpotWorkerScanSoon() {
  singletonWorker?.requestRunSoon();
}

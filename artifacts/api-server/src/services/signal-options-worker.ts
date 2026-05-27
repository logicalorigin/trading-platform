import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
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
import { runShadowOptionMaintenance } from "./shadow-account";
import {
  getSignalOptionsWorkerSnapshot,
  registerSignalOptionsWorkerSnapshotGetter,
} from "./signal-options-worker-state";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureSnapshot,
} from "./resource-pressure";

const WORKER_WAKEUP_MS = 5_000;
export const SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY = 1_930_514_022;
const ADVISORY_LOCK_KEY = SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY;
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
  runMaintenance: (input: { source: "worker" }) => Promise<unknown>;
  getResourcePressure: () => ApiResourcePressureSnapshot;
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
  lastSkippedAtMs: number | null;
  lastSkipReason: string | null;
  skippedScanCount: number;
  pressurePaused: boolean;
  pressurePauseStartedAtMs: number | null;
  currentScanStartedAtMs: number | null;
  lastScanDurationMs: number | null;
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
  lastSignalScanAt: string | null;
  lastSignalSourcePolicy: string | null;
  lastHeavyWorkDeferred: boolean;
  lastActiveScanPhase: string | null;
  lastResourcePressureLevel: string | null;
  lastCandidateCount: number;
  lastBlockedCandidateCount: number;
  lastBatchSymbols: string[];
  lastBatchSize: number;
  lastBatchUniverseCount: number;
  lastBatchStartIndex: number | null;
  lastBatchNextIndex: number | null;
  lastBatchCapacity: number | null;
  lastBatchFullUniverse: boolean;
  pollIntervalMs: number;
  nextScanDueAtMs: number | null;
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

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeScanBatch(value: unknown) {
  const batch = asRecord(value);
  const symbols = asArray(batch["symbols"])
    .map((symbol) => String(symbol ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (!symbols.length && !Object.keys(batch).length) {
    return null;
  }

  return {
    symbols,
    universeCount: numeric(batch["universeCount"]) ?? symbols.length,
    batchSize: numeric(batch["batchSize"]) ?? symbols.length,
    startIndex: numeric(batch["startIndex"]),
    nextIndex: numeric(batch["nextIndex"]),
    capacity: numeric(batch["capacity"]),
    fullUniverse: batch["fullUniverse"] === true,
  };
}

function summarizeScanResult(result: unknown) {
  const record = asRecord(result);
  const summary = asRecord(record["summary"]);
  const summarySignalCount = numeric(summary["signalCount"]);
  if (summarySignalCount !== null) {
    return {
      signalCount: summarySignalCount,
      freshSignalCount: numeric(summary["freshSignalCount"]) ?? 0,
      staleSignalCount: numeric(summary["staleSignalCount"]) ?? 0,
      unavailableSignalCount: numeric(summary["unavailableSignalCount"]) ?? 0,
      latestSignalBarAt:
        typeof summary["latestSignalBarAt"] === "string"
          ? summary["latestSignalBarAt"]
          : null,
      oldestSignalBarAt:
        typeof summary["oldestSignalBarAt"] === "string"
          ? summary["oldestSignalBarAt"]
          : null,
      candidateCount: numeric(summary["candidateCount"]) ?? 0,
      blockedCandidateCount: numeric(summary["blockedCandidateCount"]) ?? 0,
      lastSignalScanAt:
        typeof summary["lastSignalScanAt"] === "string"
          ? summary["lastSignalScanAt"]
          : null,
      signalSourcePolicy:
        typeof summary["signalSourcePolicy"] === "string"
          ? summary["signalSourcePolicy"]
          : null,
      heavyWorkDeferred: summary["heavyWorkDeferred"] === true,
      activeScanPhase:
        typeof summary["activeScanPhase"] === "string"
          ? summary["activeScanPhase"]
          : null,
      resourcePressureLevel:
        typeof summary["resourcePressureLevel"] === "string"
          ? summary["resourcePressureLevel"]
          : null,
      batch: summarizeScanBatch(summary["batch"]),
    };
  }

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
    lastSignalScanAt: null,
    signalSourcePolicy: null,
    heavyWorkDeferred: false,
    activeScanPhase: null,
    resourcePressureLevel: null,
    batch: null,
  };
}

function summarizeMaintenanceResult(result: unknown) {
  const record = asRecord(result);
  return {
    closedCount: Number(record["closedCount"]) || 0,
    skippedCount: Number(record["skippedCount"]) || 0,
    dueCount: Number(record["dueCount"]) || 0,
    orphanCount: Number(record["orphanCount"]) || 0,
  };
}

function isScanAlreadyRunningResult(result: unknown): boolean {
  const record = asRecord(result);
  return (
    record["status"] === "already_running" ||
    record["reason"] === "signal_options_scan_running"
  );
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

function createDeploymentRuntime(signature: string): DeploymentRuntime {
  return {
    signature,
    lastCheckedAtMs: 0,
    failedUntilMs: 0,
    lastSuccessAt: null,
    lastError: null,
    lastSkippedAtMs: null,
    lastSkipReason: null,
    skippedScanCount: 0,
    pressurePaused: false,
    pressurePauseStartedAtMs: null,
    currentScanStartedAtMs: null,
    lastScanDurationMs: null,
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
    lastSignalScanAt: null,
    lastSignalSourcePolicy: null,
    lastHeavyWorkDeferred: false,
    lastActiveScanPhase: null,
    lastResourcePressureLevel: null,
    lastCandidateCount: 0,
    lastBlockedCandidateCount: 0,
    lastBatchSymbols: [],
    lastBatchSize: 0,
    lastBatchUniverseCount: 0,
    lastBatchStartIndex: null,
    lastBatchNextIndex: null,
    lastBatchCapacity: null,
    lastBatchFullUniverse: false,
    pollIntervalMs: 60_000,
    nextScanDueAtMs: null,
  };
}

function markDeploymentSkippedForResourcePressure(
  runtime: DeploymentRuntime,
  skippedAtMs: number,
) {
  runtime.lastSkippedAtMs = skippedAtMs;
  runtime.lastSkipReason = "resource_pressure";
  runtime.skippedScanCount += 1;
  runtime.pressurePaused = true;
  runtime.pressurePauseStartedAtMs ??= skippedAtMs;
}

function shouldSkipDeploymentForResourcePressure(input: {
  deployment: AlgoDeployment;
  pressure: ApiResourcePressureSnapshot;
}) {
  if (
    !input.pressure.caps.signalOptions.maintenanceOnly &&
    !input.pressure.caps.signalOptions.skipDeploymentScans
  ) {
    return false;
  }
  const profile = resolveSignalOptionsExecutionProfile(input.deployment.config);
  return profile.infrastructureHaltControls.resourcePressureScanBlockEnabled !== false;
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
    runMaintenance: options.runMaintenance ?? runShadowOptionMaintenance,
    getResourcePressure:
      options.getResourcePressure ?? getApiResourcePressureSnapshot,
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

  const scanStartedAtMs = dependencies.now().getTime();
  activeDeploymentIds.add(deployment.id);
  runtime.currentScanStartedAtMs = scanStartedAtMs;
  try {
    const scanResult = await dependencies.scanDeployment({
      deploymentId: deployment.id,
      forceEvaluate: false,
      source: "worker",
    });
    if (isScanAlreadyRunningResult(scanResult)) {
      const skippedAt = dependencies.now();
      runtime.lastSkippedAtMs = skippedAt.getTime();
      runtime.lastSkipReason = "scan_running";
      runtime.skippedScanCount += 1;
      runtime.lastError = null;
      runtime.failedUntilMs = 0;
      return;
    }
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
    runtime.lastSignalScanAt = scanSummary.lastSignalScanAt;
    runtime.lastSignalSourcePolicy = scanSummary.signalSourcePolicy;
    runtime.lastHeavyWorkDeferred = scanSummary.heavyWorkDeferred;
    runtime.lastActiveScanPhase = scanSummary.activeScanPhase;
    runtime.lastResourcePressureLevel = scanSummary.resourcePressureLevel;
    runtime.lastCandidateCount = scanSummary.candidateCount;
    runtime.lastBlockedCandidateCount = scanSummary.blockedCandidateCount;
    runtime.lastBatchSymbols = scanSummary.batch?.symbols ?? [];
    runtime.lastBatchSize = scanSummary.batch?.batchSize ?? 0;
    runtime.lastBatchUniverseCount = scanSummary.batch?.universeCount ?? 0;
    runtime.lastBatchStartIndex = scanSummary.batch?.startIndex ?? null;
    runtime.lastBatchNextIndex = scanSummary.batch?.nextIndex ?? null;
    runtime.lastBatchCapacity = scanSummary.batch?.capacity ?? null;
    runtime.lastBatchFullUniverse = scanSummary.batch?.fullUniverse === true;
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
    const scanEndedAtMs = dependencies.now().getTime();
    runtime.lastScanDurationMs = Math.max(0, scanEndedAtMs - scanStartedAtMs);
    runtime.lastCheckedAtMs = scanEndedAtMs;
    runtime.nextScanDueAtMs = scanEndedAtMs + runtime.pollIntervalMs;
    runtime.pressurePaused = false;
    runtime.pressurePauseStartedAtMs = null;
    runtime.currentScanStartedAtMs = null;
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

      Array.from(deploymentRuntime.keys()).forEach((deploymentId) => {
        if (!enabledIds.has(deploymentId)) {
          deploymentRuntime.delete(deploymentId);
        }
      });

      const pressure = dependencies.getResourcePressure();
      const pressureBlocksScans =
        pressure.caps.signalOptions.maintenanceOnly ||
        pressure.caps.signalOptions.skipDeploymentScans;

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

        const pollIntervalMs = resolvePollIntervalSeconds(deployment) * 1000;
        runtime.pollIntervalMs = pollIntervalMs;
        runtime.nextScanDueAtMs =
          runtime.lastCheckedAtMs > 0
            ? runtime.lastCheckedAtMs + pollIntervalMs
            : nowMs;
        if (
          !signatureChanged &&
          runtime.lastCheckedAtMs > 0 &&
          nowMs - runtime.lastCheckedAtMs < pollIntervalMs
        ) {
          continue;
        }

        if (shouldSkipDeploymentForResourcePressure({ deployment, pressure })) {
          markDeploymentSkippedForResourcePressure(runtime, nowMs);
          dependencies.logger.debug?.(
            { deploymentId: deployment.id, pressureLevel: pressure.level },
            "Signal-options worker skipped deployment scan under resource pressure",
          );
          continue;
        }
        if (pressureBlocksScans) {
          dependencies.logger.debug?.(
            { deploymentId: deployment.id, pressureLevel: pressure.level },
            "Signal-options worker resource-pressure scan block overridden",
          );
        }

        runtime.lastCheckedAtMs = nowMs;
        runtime.nextScanDueAtMs = null;
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
      const snapshotNowMs = dependencies.now().getTime();
      const deployments = Array.from(deploymentRuntime.entries()).map(
        ([deploymentId, runtime]) => ({
          deploymentId,
          lastCheckedAtMs: runtime.lastCheckedAtMs,
          failedUntilMs: runtime.failedUntilMs,
          lastSuccessAt: runtime.lastSuccessAt,
          lastError: runtime.lastError,
          lastSkippedAt:
            runtime.lastSkippedAtMs === null
              ? null
              : new Date(runtime.lastSkippedAtMs).toISOString(),
          lastSkipReason: runtime.lastSkipReason,
          skippedScanCount: runtime.skippedScanCount,
          pressurePaused: runtime.pressurePaused,
          pressurePauseStartedAt:
            runtime.pressurePauseStartedAtMs === null
              ? null
              : new Date(runtime.pressurePauseStartedAtMs).toISOString(),
          pressurePauseAgeMs:
            runtime.pressurePauseStartedAtMs === null
              ? null
              : Math.max(0, snapshotNowMs - runtime.pressurePauseStartedAtMs),
          currentScanStartedAt:
            runtime.currentScanStartedAtMs === null
              ? null
              : new Date(runtime.currentScanStartedAtMs).toISOString(),
          currentScanAgeMs:
            runtime.currentScanStartedAtMs === null
              ? null
              : Math.max(0, snapshotNowMs - runtime.currentScanStartedAtMs),
          lastScanDurationMs: runtime.lastScanDurationMs,
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
          lastSignalScanAt: runtime.lastSignalScanAt,
          lastSignalSourcePolicy: runtime.lastSignalSourcePolicy,
          lastHeavyWorkDeferred: runtime.lastHeavyWorkDeferred,
          lastActiveScanPhase: runtime.lastActiveScanPhase,
          lastResourcePressureLevel: runtime.lastResourcePressureLevel,
          lastCandidateCount: runtime.lastCandidateCount,
          lastBlockedCandidateCount: runtime.lastBlockedCandidateCount,
          lastBatchSymbols: runtime.lastBatchSymbols,
          lastBatchSize: runtime.lastBatchSize,
          lastBatchUniverseCount: runtime.lastBatchUniverseCount,
          lastBatchStartIndex: runtime.lastBatchStartIndex,
          lastBatchNextIndex: runtime.lastBatchNextIndex,
          lastBatchCapacity: runtime.lastBatchCapacity,
          lastBatchFullUniverse: runtime.lastBatchFullUniverse,
          pollIntervalMs: runtime.pollIntervalMs,
          nextScanDueAt:
            runtime.nextScanDueAtMs === null
              ? null
              : new Date(runtime.nextScanDueAtMs).toISOString(),
          nextScanDueInMs:
            runtime.nextScanDueAtMs === null
              ? null
              : Math.max(0, runtime.nextScanDueAtMs - snapshotNowMs),
        }),
      );
      return {
        started,
        tickRunning,
        deploymentCount: deploymentRuntime.size,
        activeDeploymentCount: activeDeploymentIds.size,
        maintenance: { ...maintenanceRuntime },
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

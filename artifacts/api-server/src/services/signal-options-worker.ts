import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { sharedAdvisoryLockHolder, type AlgoDeployment } from "@workspace/db";
import { logger } from "../lib/logger";
import { subscribeAlgoCockpitChanges } from "./algo-cockpit-events";
import {
  listEnabledSignalOptionsDeployments,
  runSignalOptionsShadowScan,
} from "./signal-options-automation";
import { runShadowOptionMaintenance } from "./shadow-account";
import {
  getSignalOptionsWorkerSnapshot,
  registerSignalOptionsWorkerSnapshotGetter,
} from "./signal-options-worker-state";

const WORKER_WAKEUP_MS = 5_000;
export const SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY = 1_930_514_022;
const ADVISORY_LOCK_KEY = SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY;
const FAILED_DEPLOYMENT_RETRY_MS = 60_000;
// Per-scan action-work budget/limit. Deliberately small so one worker tick never
// hogs the pool, but env-overridable so the throughput can be raised (e.g. once
// demand-reduction frees pool headroom) without a rebuild — 4 items/scan is a
// heavy throttle against the ~2000-symbol universe, tracked as a tuning lever.
const SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS = positiveInteger(
  process.env["SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS"],
  60_000,
  1_000,
  600_000,
);
const SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT = positiveInteger(
  process.env["SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT"],
  4,
  1,
  1_000,
);
const DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS = 120_000;
const DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS = 300_000;
const DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_POSITION_MS = 3_000;
const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MIN_MS = 1_000;
const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS = 3_600_000;
const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_REASON = "worker_scan_timeout";
const SIGNAL_OPTIONS_ACTIVE_POSITION_POLL_MS = 5_000;

type ReleaseLock = () => Promise<void>;
type WorkerLogger = Pick<typeof logger, "debug" | "info" | "warn">;
type SignalOptionsWorkerScanOutcome =
  | "success"
  | "failed"
  | "timed_out"
  | "timed_out_unsettled"
  | "scan_running"
  | "resource_pressure"
  | null;

type WorkerDependencies = {
  listDeployments: () => Promise<AlgoDeployment[]>;
  scanDeployment: (input: {
    deploymentId: string;
    forceEvaluate: boolean;
    preferStoredMonitorState: true;
    source: "worker";
    actionWorkBudgetMs: number;
    actionWorkItemLimit: number;
    skipEntryWork?: boolean;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  runMaintenance: (input: { source: "worker" }) => Promise<unknown>;
  acquireTickLock: () => Promise<ReleaseLock | null>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => Date;
  logger: WorkerLogger;
  scanTimeoutMs?: number | null | false;
  subscribeCockpitChanges: typeof subscribeAlgoCockpitChanges;
};

export type SignalOptionsWorkerOptions = Partial<WorkerDependencies> & {
  wakeupMs?: number;
  scanTimeoutMs?: number | null;
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
  currentScanStartedAtMs: number | null;
  lastScanDurationMs: number | null;
  timedOut: boolean;
  timeoutReason: string | null;
  unsettledAfterTimeout: boolean;
  lastScanOutcome: SignalOptionsWorkerScanOutcome;
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
  lastCandidateCount: number;
  lastBlockedCandidateCount: number;
  lastActivePositionCount: number;
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
      activePositionCount: numeric(summary["activePositionCount"]) ?? 0,
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
    activePositionCount: asArray(record["activePositions"]).length,
    lastSignalScanAt: null,
    signalSourcePolicy: null,
    heavyWorkDeferred: false,
    activeScanPhase: null,
    batch: null,
  };
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

function resolveDefaultWorkerScanTimeoutMs(activePositionCount: unknown) {
  const count = Math.max(0, Math.floor(numeric(activePositionCount) ?? 0));
  return Math.min(
    DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS,
    Math.max(
      DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS,
      DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS +
        count * DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_POSITION_MS,
    ),
  );
}

export function resolveWorkerScanTimeoutMs(
  value: unknown,
  activePositionCount = 0,
  envValue = process.env["SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS"],
): number | null {
  if (value === null || value === false) {
    return null;
  }
  const configured = value === undefined ? envValue : value;
  if (configured === undefined) {
    return resolveDefaultWorkerScanTimeoutMs(activePositionCount);
  }
  if (configured === null || configured === "" || configured === "0") {
    return null;
  }
  return positiveInteger(
    configured,
    DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS,
    SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MIN_MS,
    SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS,
  );
}

class SignalOptionsWorkerScanTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly scanPromise: Promise<unknown>;

  constructor(input: {
    deploymentId: string;
    timeoutMs: number;
    scanPromise: Promise<unknown>;
  }) {
    super(
      `Signal-options worker scan timed out for ${input.deploymentId} after ${input.timeoutMs}ms.`,
    );
    this.name = "SignalOptionsWorkerScanTimeoutError";
    this.timeoutMs = input.timeoutMs;
    this.scanPromise = input.scanPromise;
  }
}

function isWorkerScanTimeoutError(
  error: unknown,
): error is SignalOptionsWorkerScanTimeoutError {
  return error instanceof SignalOptionsWorkerScanTimeoutError;
}

function deploymentSignature(deployment: AlgoDeployment): string {
  const config = asRecord(deployment.config);
  return JSON.stringify({
    enabled: deployment.enabled,
    mode: deployment.mode,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    signalOptions: config["signalOptions"] ?? {},
    parameters: config["parameters"] ?? {},
  });
}

function resolvePollIntervalSeconds(deployment: AlgoDeployment): number {
  const config = asRecord(deployment.config);
  const signalOptions = asRecord(config["signalOptions"]);
  const worker = asRecord(signalOptions["worker"]);
  const configured = positiveInteger(worker["pollIntervalSeconds"], 60, 15, 3600);
  const profile = resolveSignalOptionsExecutionProfile(config);
  const wireRunnerPoll =
    profile.exitPolicy.wireGreekTrail.enabled === true
      ? profile.exitPolicy.wireGreekTrail.runnerPollIntervalSeconds
      : configured;
  return Math.min(configured, positiveInteger(wireRunnerPoll, configured, 15, 3600));
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
    currentScanStartedAtMs: null,
    lastScanDurationMs: null,
    timedOut: false,
    timeoutReason: null,
    unsettledAfterTimeout: false,
    lastScanOutcome: null,
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
    lastCandidateCount: 0,
    lastBlockedCandidateCount: 0,
    lastActivePositionCount: 0,
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

async function acquirePostgresAdvisoryLock(): Promise<ReleaseLock | null> {
  return sharedAdvisoryLockHolder.acquire(ADVISORY_LOCK_KEY);
}

function defaultDependencies(
  options: SignalOptionsWorkerOptions,
): WorkerDependencies {
  return {
    listDeployments:
      options.listDeployments ?? listEnabledSignalOptionsDeployments,
    scanDeployment: options.scanDeployment ?? runSignalOptionsShadowScan,
    runMaintenance: options.runMaintenance ?? runShadowOptionMaintenance,
    acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
    setTimer: options.setTimer ?? setTimeout,
    clearTimer: options.clearTimer ?? clearTimeout,
    now: options.now ?? (() => new Date()),
    logger: options.logger ?? logger,
    scanTimeoutMs: options.scanTimeoutMs,
    subscribeCockpitChanges:
      options.subscribeCockpitChanges ?? subscribeAlgoCockpitChanges,
  };
}

async function runDeploymentScanWithTimeout(input: {
  deployment: AlgoDeployment;
  dependencies: WorkerDependencies;
  activePositionCount: number;
  skipEntryWork?: boolean;
}): Promise<unknown> {
  const { deployment, dependencies } = input;
  const controller = new AbortController();
  const scanPromise = dependencies.scanDeployment({
    deploymentId: deployment.id,
    forceEvaluate: false,
    preferStoredMonitorState: true,
    source: "worker",
    actionWorkBudgetMs: SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS,
    actionWorkItemLimit: SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT,
    skipEntryWork: input.skipEntryWork === true,
    signal: controller.signal,
  });
  scanPromise.catch(() => {});

  const timeoutMs = resolveWorkerScanTimeoutMs(
    dependencies.scanTimeoutMs,
    input.activePositionCount,
  );
  if (timeoutMs === null) {
    return scanPromise;
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = dependencies.setTimer(() => {
      const error = new SignalOptionsWorkerScanTimeoutError({
        deploymentId: deployment.id,
        timeoutMs,
        scanPromise,
      });
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    timeout.unref?.();
  });

  try {
    return await Promise.race([scanPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      dependencies.clearTimer(timeout);
    }
  }
}

async function runDeployment(input: {
  deployment: AlgoDeployment;
  runtime: DeploymentRuntime;
  dependencies: WorkerDependencies;
  skipEntryWork?: boolean;
}) {
  const { deployment, runtime, dependencies } = input;
  if (activeDeploymentIds.has(deployment.id)) {
    runtime.lastScanOutcome =
      runtime.unsettledAfterTimeout ? "timed_out_unsettled" : "scan_running";
    dependencies.logger.debug?.(
      { deploymentId: deployment.id },
      "Signal-options deployment scan already running",
    );
    return;
  }

  const scanStartedAtMs = dependencies.now().getTime();
  let resumeActionWorkNextTick = false;
  let leaveActiveUntilSettled = false;
  let timedOutScanPromise: Promise<unknown> | null = null;
  activeDeploymentIds.add(deployment.id);
  runtime.currentScanStartedAtMs = scanStartedAtMs;
  runtime.timedOut = false;
  runtime.timeoutReason = null;
  runtime.unsettledAfterTimeout = false;
  try {
    const scanResult = await runDeploymentScanWithTimeout({
      deployment,
      dependencies,
      activePositionCount: runtime.lastActivePositionCount,
      skipEntryWork: input.skipEntryWork === true,
    });
    if (isScanAlreadyRunningResult(scanResult)) {
      const skippedAt = dependencies.now();
      runtime.lastSkippedAtMs = skippedAt.getTime();
      runtime.lastSkipReason = "scan_running";
      runtime.skippedScanCount += 1;
      runtime.lastError = null;
      runtime.failedUntilMs = 0;
      runtime.lastScanOutcome = "scan_running";
      return;
    }
    const scanSummary = summarizeScanResult(scanResult);
    runtime.scanCount += 1;
    runtime.lastSuccessAt = dependencies.now().toISOString();
    runtime.lastError = null;
    runtime.failedUntilMs = 0;
    runtime.failureCount = 0;
    runtime.timedOut = false;
    runtime.timeoutReason = null;
    runtime.unsettledAfterTimeout = false;
    runtime.lastScanOutcome = "success";
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
    resumeActionWorkNextTick =
      scanSummary.heavyWorkDeferred && scanSummary.activeScanPhase === "action_scan";
    runtime.lastCandidateCount = scanSummary.candidateCount;
    runtime.lastBlockedCandidateCount = scanSummary.blockedCandidateCount;
    runtime.lastActivePositionCount = scanSummary.activePositionCount;
    runtime.lastBatchSymbols = scanSummary.batch?.symbols ?? [];
    runtime.lastBatchSize = scanSummary.batch?.batchSize ?? 0;
    runtime.lastBatchUniverseCount = scanSummary.batch?.universeCount ?? 0;
    runtime.lastBatchStartIndex = scanSummary.batch?.startIndex ?? null;
    runtime.lastBatchNextIndex = scanSummary.batch?.nextIndex ?? null;
    runtime.lastBatchCapacity = scanSummary.batch?.capacity ?? null;
    runtime.lastBatchFullUniverse = scanSummary.batch?.fullUniverse === true;
  } catch (error) {
    const failedAt = dependencies.now();
    const timedOut = isWorkerScanTimeoutError(error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Signal-options shadow worker scan failed.";
    if (timedOut) {
      leaveActiveUntilSettled = true;
      timedOutScanPromise = error.scanPromise;
      runtime.timedOut = true;
      runtime.timeoutReason = SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_REASON;
      runtime.unsettledAfterTimeout = true;
      runtime.lastScanOutcome = "timed_out_unsettled";
    } else {
      runtime.lastScanOutcome = "failed";
    }
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
    const deferFastPositionPoll =
      runtime.lastHeavyWorkDeferred && runtime.lastActiveScanPhase === "deferred";
    const nextIntervalMs =
      runtime.lastActivePositionCount > 0 && !deferFastPositionPoll
        ? Math.min(runtime.pollIntervalMs, SIGNAL_OPTIONS_ACTIVE_POSITION_POLL_MS)
        : runtime.pollIntervalMs;
    runtime.nextScanDueAtMs = resumeActionWorkNextTick
      ? scanEndedAtMs
      : scanEndedAtMs + nextIntervalMs;
    if (leaveActiveUntilSettled && timedOutScanPromise) {
      timedOutScanPromise
        .finally(() => {
          if (runtime.unsettledAfterTimeout) {
            runtime.unsettledAfterTimeout = false;
            runtime.lastScanOutcome = "timed_out";
            runtime.currentScanStartedAtMs = null;
          }
          activeDeploymentIds.delete(deployment.id);
        })
        .catch(() => {});
    } else {
      runtime.currentScanStartedAtMs = null;
      activeDeploymentIds.delete(deployment.id);
    }
  }
}

function dateString(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
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
  let postTickWakeRequestedAtMs: number | null = null;
  let cockpitUnsubscribe: (() => void) | null = null;

  const forceDeploymentsDue = (requestedAtMs: number) => {
    deploymentRuntime.forEach((runtime) => {
      runtime.nextScanDueAtMs = requestedAtMs;
    });
  };

  const runMaintenanceOnce = async () => {
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
  };

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

      const nowMs = dependencies.now().getTime();
      const deployments = await dependencies.listDeployments();
      const enabledIds = new Set(deployments.map((deployment) => deployment.id));

      await runMaintenanceOnce();

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
          runtime = createDeploymentRuntime(signature);
          deploymentRuntime.set(deployment.id, runtime);
        }

        if (runtime.failedUntilMs > nowMs) {
          continue;
        }

        const pollIntervalMs = resolvePollIntervalSeconds(deployment) * 1000;
        runtime.pollIntervalMs = pollIntervalMs;
        runtime.nextScanDueAtMs ??=
          runtime.lastCheckedAtMs > 0
            ? runtime.lastCheckedAtMs + pollIntervalMs
            : nowMs;
        if (
          !signatureChanged &&
          runtime.lastCheckedAtMs > 0 &&
          nowMs < runtime.nextScanDueAtMs
        ) {
          continue;
        }

        runtime.lastCheckedAtMs = nowMs;
        runtime.nextScanDueAtMs = null;
        await runDeployment({
          deployment,
          runtime,
          dependencies,
          // Entries never pause under pressure per owner directive 2026-07-07;
          // pressure recovery = demand fixes, not trading stops.
          skipEntryWork: false,
        });
      }
    } catch (error) {
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
    const wakeAtMs = postTickWakeRequestedAtMs;
    postTickWakeRequestedAtMs = null;
    if (wakeAtMs !== null) {
      forceDeploymentsDue(wakeAtMs);
      schedule(0);
      return;
    }
    schedule(wakeupMs);
  };

  const requestRunSoon = () => {
    if (!started) {
      return;
    }
    const requestedAtMs = dependencies.now().getTime();
    if (tickRunning) {
      postTickWakeRequestedAtMs = requestedAtMs;
      return;
    }
    forceDeploymentsDue(requestedAtMs);
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
        if (
          change.reason === "signal_monitor_event_created" ||
          (change.reason === "signal_monitor_state_refreshed" && !tickRunning)
        ) {
          requestRunSoon();
        }
      });
      void runOnce().finally(scheduleAfterRun);
      dependencies.logger.info("Signal-options shadow worker started");
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
    getRuntimeSnapshot() {
      const snapshotNowMs = dependencies.now().getTime();
      const deployments = Array.from(deploymentRuntime.entries()).map(
        ([deploymentId, runtime]) => ({
          deploymentId,
          lastCheckedAtMs: runtime.lastCheckedAtMs,
          failedUntilMs: runtime.failedUntilMs,
          lastSuccessAt: runtime.lastSuccessAt,
          lastError: runtime.lastError,
          lastSkippedAt: dateString(runtime.lastSkippedAtMs),
          lastSkipReason: runtime.lastSkipReason,
          skippedScanCount: runtime.skippedScanCount,
          currentScanStartedAt: dateString(runtime.currentScanStartedAtMs),
          currentScanAgeMs:
            runtime.currentScanStartedAtMs === null
              ? null
              : Math.max(0, snapshotNowMs - runtime.currentScanStartedAtMs),
          lastScanDurationMs: runtime.lastScanDurationMs,
          timedOut: runtime.timedOut,
          timeoutReason: runtime.timeoutReason,
          unsettledAfterTimeout: runtime.unsettledAfterTimeout,
          lastScanOutcome: runtime.lastScanOutcome,
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
          lastCandidateCount: runtime.lastCandidateCount,
          lastBlockedCandidateCount: runtime.lastBlockedCandidateCount,
          lastActivePositionCount: runtime.lastActivePositionCount,
          lastBatchSymbols: runtime.lastBatchSymbols,
          lastBatchSize: runtime.lastBatchSize,
          lastBatchUniverseCount: runtime.lastBatchUniverseCount,
          lastBatchStartIndex: runtime.lastBatchStartIndex,
          lastBatchNextIndex: runtime.lastBatchNextIndex,
          lastBatchCapacity: runtime.lastBatchCapacity,
          lastBatchFullUniverse: runtime.lastBatchFullUniverse,
          pollIntervalMs: runtime.pollIntervalMs,
          nextScanDueAt: dateString(runtime.nextScanDueAtMs),
          nextScanDueInMs:
            runtime.nextScanDueAtMs === null
              ? null
              : Math.max(0, runtime.nextScanDueAtMs - snapshotNowMs),
        }),
      );

      return {
        started,
        scanEnabled: true,
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

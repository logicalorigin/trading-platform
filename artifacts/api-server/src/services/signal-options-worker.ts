import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import {
  attachPostgresClientErrorHandler,
  pool,
  type AlgoDeployment,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import {
  evaluateSignalMonitorProfileSymbols,
  getSignalMonitorProfileRow,
} from "./signal-monitor";
import {
  listEnabledSignalOptionsDeployments,
  runSignalOptionsShadowScan,
} from "./signal-options-automation";
import { runShadowOptionMaintenance } from "./shadow-account";
import {
  isStockAggregateStreamingAvailable,
  subscribeMutableStockMinuteAggregates,
  type StockMinuteAggregateMessage,
  type StockMinuteAggregateSubscription,
} from "./stock-aggregate-stream";
import {
  getSignalOptionsWorkerSnapshot,
  registerSignalOptionsWorkerSnapshotGetter,
} from "./signal-options-worker-state";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureSnapshot,
} from "./resource-pressure";
import { subscribeAlgoCockpitChanges } from "./algo-cockpit-events";

const WORKER_WAKEUP_MS = 5_000;
export const SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY = 1_930_514_022;
const ADVISORY_LOCK_KEY = SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY;
const FAILED_DEPLOYMENT_RETRY_MS = 60_000;
const SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS = 60_000;
const SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT = 4;
const DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS = 120_000;
const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MIN_MS = 1_000;
const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS = 3_600_000;
const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_REASON = "worker_scan_timeout";
const SIGNAL_OPTIONS_ACTIVE_POSITION_POLL_MS = 5_000;
const SIGNAL_OPTIONS_STREAM_SIGNAL_EVALUATION_DEBOUNCE_MS = 250;
const SIGNAL_OPTIONS_STREAM_SIGNAL_EVALUATION_MIN_INTERVAL_MS = 2_000;
const SIGNAL_OPTIONS_STREAM_SIGNAL_EVALUATION_MAX_BATCH = 24;

type ReleaseLock = () => Promise<void>;
type WorkerLogger = Pick<typeof logger, "debug" | "info" | "warn">;
type SignalOptionsWorkerScanOutcome =
  | "success"
  | "failed"
  | "timed_out"
  | "timed_out_unsettled"
  | "scan_running"
  | null;

type WorkerDependencies = {
  listDeployments: () => Promise<AlgoDeployment[]>;
  scanDeployment: (input: {
    deploymentId: string;
    forceEvaluate: boolean;
    preferStoredMonitorState?: boolean;
    source: "worker";
    actionWorkBudgetMs: number;
    actionWorkItemLimit: number;
    signal?: AbortSignal;
  }) => Promise<unknown>;
  runMaintenance: (input: { source: "worker" }) => Promise<unknown>;
  getResourcePressure: () => ApiResourcePressureSnapshot;
  acquireTickLock: () => Promise<ReleaseLock | null>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => Date;
  logger: WorkerLogger;
  scanTimeoutMs: number | null;
  subscribeCockpitChanges: typeof subscribeAlgoCockpitChanges;
  isAggregateStreamingAvailable: () => boolean;
  subscribeAggregates: typeof subscribeMutableStockMinuteAggregates;
  evaluateStreamSignalSymbols: (input: {
    mode: AlgoDeployment["mode"];
    symbols: string[];
    signal?: AbortSignal;
  }) => Promise<unknown>;
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
  pressurePaused: boolean;
  pressurePauseStartedAtMs: number | null;
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
  lastResourcePressureLevel: string | null;
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
    activePositionCount: asArray(record["activePositions"]).length,
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

function resolveWorkerScanTimeoutMs(value: unknown): number | null {
  if (value === null || value === false) {
    return null;
  }
  const configured =
    value === undefined
      ? process.env.SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS
      : value;
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

  constructor(input: { deploymentId: string; timeoutMs: number; scanPromise: Promise<unknown> }) {
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
    signalOptions: config.signalOptions ?? {},
    parameters: config.parameters ?? {},
  });
}

function resolvePollIntervalSeconds(deployment: AlgoDeployment): number {
  const config = asRecord(deployment.config);
  const signalOptions = asRecord(config.signalOptions);
  const worker = asRecord(signalOptions.worker);
  const configured = positiveInteger(worker.pollIntervalSeconds, 60, 15, 3600);
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
    pressurePaused: false,
    pressurePauseStartedAtMs: null,
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
    lastResourcePressureLevel: null,
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

async function evaluateSignalOptionsStreamSignalSymbols(input: {
  mode: AlgoDeployment["mode"];
  symbols: string[];
  signal?: AbortSignal;
}) {
  const symbols = Array.from(
    new Set(input.symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  );
  if (!symbols.length) {
    return null;
  }
  const profile = await getSignalMonitorProfileRow({
    environment: input.mode,
    ensureWatchlist: true,
  });

  return evaluateSignalMonitorProfileSymbols({
    profile,
    mode: "incremental",
    symbols,
    maxSymbolsOverride: symbols.length,
    pressureCapMode: "bypass-soft",
    evaluationConcurrencyOverride: Math.min(6, symbols.length),
    barSourcePolicy: "mixed",
    signal: input.signal,
  });
}

async function acquirePostgresAdvisoryLock(): Promise<ReleaseLock | null> {
  const client = await pool.connect();
  let clientError: Error | null = null;
  let transactionOpen = false;
  const detachClientErrorHandler = attachPostgresClientErrorHandler(client, {
    context: "signal-options-worker-advisory-lock",
    onError: (error) => {
      clientError = error;
    },
  });
  const releaseClient = (releaseError?: unknown) => {
    detachClientErrorHandler();
    const error =
      clientError ?? (releaseError instanceof Error ? releaseError : undefined);
    if (error) {
      client.release(error);
      return;
    }
    client.release();
  };
  let locked = false;

  try {
    await client.query("begin");
    transactionOpen = true;
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock($1) as locked",
      [ADVISORY_LOCK_KEY],
    );
    locked = result.rows[0]?.locked === true;

    if (!locked) {
      await client.query("rollback");
      transactionOpen = false;
      releaseClient();
      return null;
    }

    return async () => {
      let releaseError: unknown;
      try {
        if (!clientError && transactionOpen) {
          await client.query("commit");
          transactionOpen = false;
        }
      } catch (error) {
        releaseError = error;
      } finally {
        if (transactionOpen) {
          await client.query("rollback").catch(() => {});
          transactionOpen = false;
        }
        releaseClient(releaseError);
      }
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("rollback").catch(() => {});
    }
    releaseClient(error);
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
    scanTimeoutMs: resolveWorkerScanTimeoutMs(options.scanTimeoutMs),
    subscribeCockpitChanges:
      options.subscribeCockpitChanges ?? subscribeAlgoCockpitChanges,
    isAggregateStreamingAvailable:
      options.isAggregateStreamingAvailable ?? isStockAggregateStreamingAvailable,
    subscribeAggregates:
      options.subscribeAggregates ?? subscribeMutableStockMinuteAggregates,
    evaluateStreamSignalSymbols:
      options.evaluateStreamSignalSymbols ??
      evaluateSignalOptionsStreamSignalSymbols,
  };
}

async function runDeploymentScanWithTimeout(input: {
  deployment: AlgoDeployment;
  dependencies: WorkerDependencies;
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
    signal: controller.signal,
  });
  const timeoutMs = dependencies.scanTimeoutMs;
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
    runtime.lastResourcePressureLevel = scanSummary.resourcePressureLevel;
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
    runtime.pressurePaused = false;
    runtime.pressurePauseStartedAtMs = null;
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
  let postTickWakeRequestedAtMs: number | null = null;
  let cockpitUnsubscribe: (() => void) | null = null;
  let streamSubscription: StockMinuteAggregateSubscription | null = null;
  let streamEvaluationTimer: ReturnType<typeof setTimeout> | null = null;
  let streamEvaluationRunning = false;
  const streamSignalSymbols = new Set<string>();
  const streamSignalModes = new Set<AlgoDeployment["mode"]>();
  const pendingStreamSignalEvaluations = new Set<string>();
  const lastStreamSignalEvaluatedAtMs = new Map<string, number>();

  const forceDeploymentsDue = (requestedAtMs: number) => {
    deploymentRuntime.forEach((runtime) => {
      runtime.nextScanDueAtMs = requestedAtMs;
    });
  };

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
      syncStreamSignalEvaluator(deployments);
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

  const streamEvaluationKey = (
    mode: AlgoDeployment["mode"],
    symbol: string,
  ) => `${mode}:${symbol}`;

  const streamEvaluationParts = (key: string) => {
    const separator = key.indexOf(":");
    return {
      mode: key.slice(0, separator) as AlgoDeployment["mode"],
      symbol: key.slice(separator + 1),
    };
  };

  const scheduleStreamSignalEvaluation = (
    delayMs = SIGNAL_OPTIONS_STREAM_SIGNAL_EVALUATION_DEBOUNCE_MS,
  ) => {
    if (!started || streamEvaluationTimer) {
      return;
    }
    streamEvaluationTimer = dependencies.setTimer(() => {
      streamEvaluationTimer = null;
      void drainStreamSignalEvaluations();
    }, Math.max(0, delayMs));
    streamEvaluationTimer.unref?.();
  };

  const queueStreamSignalEvaluation = (message: StockMinuteAggregateMessage) => {
    const symbol = normalizeSymbol(message.symbol);
    if (!symbol || !streamSignalSymbols.has(symbol)) {
      return;
    }
    streamSignalModes.forEach((mode) => {
      pendingStreamSignalEvaluations.add(streamEvaluationKey(mode, symbol));
    });
    scheduleStreamSignalEvaluation();
  };

  const drainStreamSignalEvaluations = async () => {
    if (streamEvaluationRunning || !started) {
      scheduleStreamSignalEvaluation();
      return;
    }
    streamEvaluationRunning = true;
    let nextDelayMs: number | null = null;
    const nowMs = dependencies.now().getTime();
    const dueKeys: string[] = [];

    try {
      for (const key of pendingStreamSignalEvaluations) {
        const lastEvaluatedAtMs = lastStreamSignalEvaluatedAtMs.get(key) ?? 0;
        const waitMs =
          lastEvaluatedAtMs +
          SIGNAL_OPTIONS_STREAM_SIGNAL_EVALUATION_MIN_INTERVAL_MS -
          nowMs;
        if (waitMs > 0) {
          nextDelayMs =
            nextDelayMs === null ? waitMs : Math.min(nextDelayMs, waitMs);
          continue;
        }
        dueKeys.push(key);
        if (dueKeys.length >= SIGNAL_OPTIONS_STREAM_SIGNAL_EVALUATION_MAX_BATCH) {
          break;
        }
      }

      if (!dueKeys.length) {
        return;
      }

      dueKeys.forEach((key) => {
        pendingStreamSignalEvaluations.delete(key);
      });

      const symbolsByMode = new Map<AlgoDeployment["mode"], string[]>();
      dueKeys.forEach((key) => {
        const { mode, symbol } = streamEvaluationParts(key);
        if (!symbol) return;
        const symbols = symbolsByMode.get(mode) ?? [];
        symbols.push(symbol);
        symbolsByMode.set(mode, symbols);
      });

      await Promise.all(
        Array.from(symbolsByMode.entries()).map(([mode, symbols]) =>
          dependencies.evaluateStreamSignalSymbols({
            mode,
            symbols,
          }),
        ),
      );
      const completedAtMs = dependencies.now().getTime();
      dueKeys.forEach((key) => {
        lastStreamSignalEvaluatedAtMs.set(key, completedAtMs);
      });
    } catch (error) {
      dependencies.logger.warn(
        { err: error },
        "Signal-options stream signal evaluation failed",
      );
    } finally {
      streamEvaluationRunning = false;
      if (pendingStreamSignalEvaluations.size > 0) {
        scheduleStreamSignalEvaluation(
          nextDelayMs ??
            SIGNAL_OPTIONS_STREAM_SIGNAL_EVALUATION_DEBOUNCE_MS,
        );
      }
    }
  };

  const clearStreamSignalEvaluator = () => {
    streamSubscription?.unsubscribe();
    streamSubscription = null;
    streamSignalSymbols.clear();
    streamSignalModes.clear();
    pendingStreamSignalEvaluations.clear();
    if (streamEvaluationTimer) {
      dependencies.clearTimer(streamEvaluationTimer);
      streamEvaluationTimer = null;
    }
  };

  const syncStreamSignalEvaluator = (deployments: AlgoDeployment[]) => {
    if (!started || !dependencies.isAggregateStreamingAvailable()) {
      clearStreamSignalEvaluator();
      return;
    }

    const nextSymbols = Array.from(
      new Set(
        deployments.flatMap((deployment) =>
          deployment.symbolUniverse.map((symbol) => normalizeSymbol(symbol)),
        ),
      ),
    ).filter(Boolean);
    const nextModes = new Set(
      deployments.map((deployment) => deployment.mode),
    );
    if (!nextSymbols.length || nextModes.size === 0) {
      clearStreamSignalEvaluator();
      return;
    }

    streamSignalSymbols.clear();
    nextSymbols.forEach((symbol) => streamSignalSymbols.add(symbol));
    streamSignalModes.clear();
    nextModes.forEach((mode) => streamSignalModes.add(mode));

    if (streamSubscription) {
      streamSubscription.setSymbols(nextSymbols);
      return;
    }
    streamSubscription = dependencies.subscribeAggregates(
      nextSymbols,
      queueStreamSignalEvaluation,
    );
  };

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      cockpitUnsubscribe = dependencies.subscribeCockpitChanges((change) => {
        if (change.reason === "signal_monitor_event_created") {
          requestRunSoon();
          return;
        }
        if (change.reason === "signal_monitor_state_refreshed" && !tickRunning) {
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
      clearStreamSignalEvaluator();
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
          lastResourcePressureLevel: runtime.lastResourcePressureLevel,
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

export function requestSignalOptionsWorkerScanSoon(): void {
  defaultWorker.requestRunSoon();
}
export { getSignalOptionsWorkerSnapshot };

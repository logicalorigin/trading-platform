import { HttpError } from "@workspace/ibkr-contracts";
import {
  getBridgeLaneOverrides,
  setBridgeLaneOverrideSection,
} from "./lane-overrides";

export type BridgeWorkLane =
  | "control"
  | "account"
  | "market-subscriptions"
  | "historical"
  | "options-meta"
  | "option-quotes";

export type BridgePressureState = "normal" | "degraded" | "backoff" | "stalled";

export type BridgeSchedulerLaneConfig = {
  concurrency: number;
  timeoutMs: number;
  queueCap: number;
  backoffMs: number;
  failureThreshold: number;
};

export type BridgeSchedulerConfigSource = "default" | "env" | "override";

export type BridgeSchedulerConfigSnapshot = Record<
  BridgeWorkLane,
  BridgeSchedulerLaneConfig & {
    defaults: BridgeSchedulerLaneConfig;
    overrides: Partial<BridgeSchedulerLaneConfig>;
    sources: Record<keyof BridgeSchedulerLaneConfig, BridgeSchedulerConfigSource>;
  }
>;

type LaneState = {
  active: number;
  queued: number;
  maxQueued: number;
  oldestQueuedAt: number | null;
  backoffUntil: number | null;
  failureCount: number;
  orphaned: number;
  completed: number;
  timedOut: number;
  rejected: number;
  lastFailure: string | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
};

type QueuedWork = {
  resolve: () => void;
  queuedAt: number;
};

export type BridgeSchedulerDiagnostics = Record<
  BridgeWorkLane,
  LaneState & {
    timeoutMs: number;
    queueCap: number;
    concurrency: number;
    backoffRemainingMs: number;
    queueAgeMs: number | null;
    pressure: BridgePressureState;
  }
>;

export const BRIDGE_SCHEDULER_DEFAULT_CONFIG: Record<
  BridgeWorkLane,
  BridgeSchedulerLaneConfig
> = {
  control: {
    concurrency: 1,
    timeoutMs: 2_000,
    queueCap: 1,
    backoffMs: 5_000,
    failureThreshold: 3,
  },
  account: {
    concurrency: 1,
    timeoutMs: 4_000,
    queueCap: 2,
    backoffMs: 10_000,
    failureThreshold: 2,
  },
  "market-subscriptions": {
    concurrency: 1,
    timeoutMs: 6_000,
    queueCap: 4,
    backoffMs: 8_000,
    failureThreshold: 3,
  },
  historical: {
    concurrency: 1,
    timeoutMs: 12_000,
    queueCap: 8,
    backoffMs: 15_000,
    failureThreshold: 3,
  },
  "options-meta": {
    concurrency: 1,
    timeoutMs: 20_000,
    queueCap: 4,
    backoffMs: 60_000,
    failureThreshold: 1,
  },
  "option-quotes": {
    concurrency: 1,
    timeoutMs: 8_000,
    queueCap: 6,
    backoffMs: 10_000,
    failureThreshold: 3,
  },
};

const state: Record<BridgeWorkLane, LaneState> = {
  control: emptyState(),
  account: emptyState(),
  "market-subscriptions": emptyState(),
  historical: emptyState(),
  "options-meta": emptyState(),
  "option-quotes": emptyState(),
};

const queues: Record<BridgeWorkLane, QueuedWork[]> = {
  control: [],
  account: [],
  "market-subscriptions": [],
  historical: [],
  "options-meta": [],
  "option-quotes": [],
};

function emptyState(): LaneState {
  return {
    active: 0,
    queued: 0,
    maxQueued: 0,
    oldestQueuedAt: null,
    backoffUntil: null,
    failureCount: 0,
    orphaned: 0,
    completed: 0,
    timedOut: 0,
    rejected: 0,
    lastFailure: null,
    lastFailureAt: null,
    lastSuccessAt: null,
  };
}

function readPositiveIntegerEnv(
  name: string,
  fallback: number,
): { value: number; source: BridgeSchedulerConfigSource } {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0
    ? { value, source: "env" }
    : { value: fallback, source: "default" };
}

function configSnapshotFor(
  lane: BridgeWorkLane,
): BridgeSchedulerConfigSnapshot[BridgeWorkLane] {
  const defaults = BRIDGE_SCHEDULER_DEFAULT_CONFIG[lane];
  const envPrefix = `IBKR_BRIDGE_${lane.replace(/-/g, "_").toUpperCase()}`;
  const concurrency = readPositiveIntegerEnv(
    `${envPrefix}_CONCURRENCY`,
    defaults.concurrency,
  );
  const timeoutMs = readPositiveIntegerEnv(
    `${envPrefix}_TIMEOUT_MS`,
    defaults.timeoutMs,
  );
  const queueCap = readPositiveIntegerEnv(
    `${envPrefix}_QUEUE_CAP`,
    defaults.queueCap,
  );
  const backoffMs = readPositiveIntegerEnv(
    `${envPrefix}_BACKOFF_MS`,
    defaults.backoffMs,
  );
  const failureThreshold = readPositiveIntegerEnv(
    `${envPrefix}_FAILURE_THRESHOLD`,
    defaults.failureThreshold,
  );
  const overrides = getBridgeLaneOverrides().scheduler?.[lane] ?? {};
  const values = {
    concurrency: overrides.concurrency ?? concurrency.value,
    timeoutMs: overrides.timeoutMs ?? timeoutMs.value,
    queueCap: overrides.queueCap ?? queueCap.value,
    backoffMs: overrides.backoffMs ?? backoffMs.value,
    failureThreshold: overrides.failureThreshold ?? failureThreshold.value,
  };

  return {
    ...values,
    defaults,
    overrides,
    sources: {
      concurrency:
        overrides.concurrency === undefined ? concurrency.source : "override",
      timeoutMs: overrides.timeoutMs === undefined ? timeoutMs.source : "override",
      queueCap: overrides.queueCap === undefined ? queueCap.source : "override",
      backoffMs: overrides.backoffMs === undefined ? backoffMs.source : "override",
      failureThreshold:
        overrides.failureThreshold === undefined
          ? failureThreshold.source
          : "override",
    },
  };
}

function configFor(lane: BridgeWorkLane): BridgeSchedulerLaneConfig {
  const snapshot = configSnapshotFor(lane);
  return {
    concurrency: snapshot.concurrency,
    timeoutMs: snapshot.timeoutMs,
    queueCap: snapshot.queueCap,
    backoffMs: snapshot.backoffMs,
    failureThreshold: snapshot.failureThreshold,
  };
}

function isBridgeSchedulerConfigKey(
  key: string,
): key is keyof BridgeSchedulerLaneConfig {
  return (
    key === "concurrency" ||
    key === "timeoutMs" ||
    key === "queueCap" ||
    key === "backoffMs" ||
    key === "failureThreshold"
  );
}

function normalizeOverrideValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

export function getBridgeSchedulerConfigSnapshot(): BridgeSchedulerConfigSnapshot {
  return Object.fromEntries(
    (Object.keys(BRIDGE_SCHEDULER_DEFAULT_CONFIG) as BridgeWorkLane[]).map(
      (lane) => [lane, configSnapshotFor(lane)],
    ),
  ) as BridgeSchedulerConfigSnapshot;
}

export function getBridgeSchedulerOverrides(): Partial<
  Record<BridgeWorkLane, Partial<BridgeSchedulerLaneConfig>>
> {
  return { ...(getBridgeLaneOverrides().scheduler ?? {}) } as Partial<
    Record<BridgeWorkLane, Partial<BridgeSchedulerLaneConfig>>
  >;
}

export function setBridgeSchedulerOverrides(
  overrides: Partial<Record<BridgeWorkLane, Partial<BridgeSchedulerLaneConfig>>>,
): void {
  const current = { ...(getBridgeLaneOverrides().scheduler ?? {}) };
  (Object.keys(overrides) as BridgeWorkLane[]).forEach((lane) => {
    if (!BRIDGE_SCHEDULER_DEFAULT_CONFIG[lane]) {
      return;
    }
    const next = { ...(current[lane] ?? {}) };
    Object.entries(overrides[lane] ?? {}).forEach(([key, value]) => {
      if (!isBridgeSchedulerConfigKey(key)) {
        return;
      }
      const normalized = normalizeOverrideValue(value);
      if (normalized === null) {
        delete next[key];
      } else {
        next[key] = normalized;
      }
    });
    if (Object.keys(next).length === 0) {
      delete current[lane];
    } else {
      current[lane] = next;
    }
  });
  setBridgeLaneOverrideSection(
    "scheduler",
    Object.keys(current).length > 0 ? current : undefined,
  );
}

export function resetBridgeSchedulerOverrides(lanes?: BridgeWorkLane[]): void {
  if (!lanes || lanes.length === 0) {
    setBridgeLaneOverrideSection("scheduler", undefined);
    return;
  }

  const current = { ...(getBridgeLaneOverrides().scheduler ?? {}) };
  lanes.forEach((lane) => {
    delete current[lane];
  });
  setBridgeLaneOverrideSection(
    "scheduler",
    Object.keys(current).length > 0 ? current : undefined,
  );
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "IBKR bridge lane work failed.";
}

function laneError(
  lane: BridgeWorkLane,
  statusCode: number,
  code: string,
  message: string,
): HttpError {
  return new HttpError(statusCode, message, {
    code,
    detail: `IBKR bridge lane ${lane} ${message.toLowerCase()}`,
  });
}

function isBackedOff(lane: BridgeWorkLane): boolean {
  const current = state[lane];
  const until = current.backoffUntil;
  if (!until) {
    return false;
  }
  if (until <= Date.now()) {
    current.backoffUntil = null;
    current.failureCount = 0;
    return false;
  }
  return true;
}

function refreshQueueState(lane: BridgeWorkLane): void {
  const currentQueue = queues[lane];
  state[lane].queued = currentQueue.length;
  state[lane].oldestQueuedAt = currentQueue[0]?.queuedAt ?? null;
  state[lane].maxQueued = Math.max(state[lane].maxQueued, currentQueue.length);
}

function releaseLane(lane: BridgeWorkLane): void {
  const current = state[lane];
  current.active = Math.max(0, current.active - 1);
  const next = queues[lane].shift();
  refreshQueueState(lane);
  next?.resolve();
}

async function acquireLane(lane: BridgeWorkLane): Promise<void> {
  if (isBackedOff(lane)) {
    state[lane].rejected += 1;
    throw laneError(
      lane,
      503,
      "ibkr_bridge_lane_backoff",
      "Lane is backed off.",
    );
  }

  const config = configFor(lane);
  const current = state[lane];
  if (current.active < config.concurrency) {
    current.active += 1;
    return;
  }

  if (queues[lane].length >= config.queueCap) {
    current.rejected += 1;
    throw laneError(
      lane,
      429,
      "ibkr_bridge_lane_queue_full",
      "Lane queue is full.",
    );
  }

  await new Promise<void>((resolve) => {
    queues[lane].push({ resolve, queuedAt: Date.now() });
    refreshQueueState(lane);
  });

  if (isBackedOff(lane)) {
    current.rejected += 1;
    throw laneError(
      lane,
      503,
      "ibkr_bridge_lane_backoff",
      "Lane is backed off.",
    );
  }

  current.active += 1;
}

function recordLaneFailure(lane: BridgeWorkLane, error: unknown): void {
  const current = state[lane];
  const config = configFor(lane);
  current.failureCount += 1;
  current.lastFailure = describeError(error);
  current.lastFailureAt = Date.now();
  if (current.failureCount >= config.failureThreshold) {
    current.backoffUntil = current.lastFailureAt + config.backoffMs;
  }
}

function recordLaneSuccess(lane: BridgeWorkLane): void {
  const current = state[lane];
  current.completed += 1;
  current.failureCount = 0;
  current.backoffUntil = null;
  current.lastSuccessAt = Date.now();
}

export async function runBridgeLane<T>(
  lane: BridgeWorkLane,
  work: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  await acquireLane(lane);
  const config = configFor(lane);
  const timeoutMs = Math.max(1, options.timeoutMs ?? config.timeoutMs);
  const controller = new AbortController();
  let settled = false;
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();

  const operation = work(controller.signal)
    .then((value) => {
      settled = true;
      return value;
    })
    .catch((error) => {
      settled = true;
      throw error;
    });

  try {
    const result = await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () =>
            reject(
              laneError(
                lane,
                504,
                "ibkr_bridge_lane_timeout",
                `Lane timed out after ${timeoutMs}ms.`,
              ),
            ),
          { once: true },
        );
      }),
    ]);
    recordLaneSuccess(lane);
    return result;
  } catch (error) {
    if (didTimeout) {
      state[lane].timedOut += 1;
      if (!settled) {
        state[lane].orphaned += 1;
        operation.catch(() => {});
      }
    }
    recordLaneFailure(lane, error);
    throw error;
  } finally {
    clearTimeout(timeout);
    releaseLane(lane);
  }
}

export function getBridgePressureState(): BridgePressureState {
  const diagnostics = getBridgeSchedulerDiagnostics();
  const laneStates = Object.values(diagnostics);
  if (laneStates.some((lane) => lane.pressure === "stalled")) {
    return "stalled";
  }
  if (laneStates.some((lane) => lane.pressure === "backoff")) {
    return "backoff";
  }
  if (laneStates.some((lane) => lane.pressure === "degraded")) {
    return "degraded";
  }
  return "normal";
}

export function getBridgeSchedulerDiagnostics(): BridgeSchedulerDiagnostics {
  const now = Date.now();
  return Object.fromEntries(
    (Object.keys(state) as BridgeWorkLane[]).map((lane) => {
      const current = state[lane];
      const config = configFor(lane);
      const backoffRemainingMs = Math.max(0, (current.backoffUntil ?? 0) - now);
      const queueAgeMs =
        current.oldestQueuedAt === null
          ? null
          : Math.max(0, now - current.oldestQueuedAt);
      const unresolvedFailure =
        current.lastFailureAt !== null &&
        (current.lastSuccessAt === null ||
          current.lastFailureAt > current.lastSuccessAt);
      const unresolvedTimeout =
        unresolvedFailure &&
        current.lastFailure?.toLowerCase().includes("timed out");
      const queueStalled =
        queueAgeMs !== null && queueAgeMs > Math.max(config.timeoutMs, 10_000);
      const pressure: BridgePressureState =
        backoffRemainingMs > 0
          ? "backoff"
          : unresolvedTimeout || queueStalled
            ? "stalled"
            : current.queued > 0
              ? "degraded"
              : "normal";

      return [
        lane,
        {
          ...current,
          timeoutMs: config.timeoutMs,
          queueCap: config.queueCap,
          concurrency: config.concurrency,
          backoffRemainingMs,
          queueAgeMs,
          pressure,
        },
      ];
    }),
  ) as BridgeSchedulerDiagnostics;
}

export function __resetBridgeSchedulerForTests(): void {
  (Object.keys(state) as BridgeWorkLane[]).forEach((lane) => {
    Object.assign(state[lane], emptyState());
    queues[lane].splice(0);
    refreshQueueState(lane);
  });
}

import { AsyncLocalStorage } from "node:async_hooks";

import { parseOptionalPositiveInteger } from "./positive-integer";

export type DbLane = "interactive" | "bulk" | "background";

export type DbLaneAdmissionDiagnostics = {
  queued: number;
  inFlight: number;
  admittedTotal: number;
  /** Optional only so legacy injected diagnostic sources remain source-compatible. */
  rejectedTotal?: number;
  /** Optional only so legacy injected diagnostic sources remain source-compatible. */
  canceledTotal?: number;
  maxWaitMs: number;
  recentWaitMsP95: number;
};

export type DbAdmissionDiagnostics = Record<DbLane, DbLaneAdmissionDiagnostics>;

export type DbAdmissionLaneConfig = {
  maxInFlight?: number | null;
  shedAfterMs?: number | null;
};

export type DbAdmissionSchedulerConfig = {
  maxInFlight: number;
  agingMs?: number;
  acquireTimeoutMs?: number | null;
  lanes?: Partial<Record<DbLane, DbAdmissionLaneConfig>>;
  now?: () => number;
};

export type ReleasableDbClient = {
  release: (...args: unknown[]) => unknown;
};

export type DbAdmissionAcquireOptions = {
  signal?: AbortSignal;
};

export type DbAdmissionTimeoutKind = "acquire" | "shed";

export class DbAdmissionTimeoutError extends Error {
  readonly code = "DB_ADMISSION_TIMEOUT";
  readonly retryAfterSeconds: number;

  constructor(
    readonly lane: DbLane,
    readonly timeoutMs: number,
    readonly kind: DbAdmissionTimeoutKind,
  ) {
    super(
      kind === "shed"
        ? `${lane} database admission queue timeout exceeded`
        : "timeout exceeded when trying to connect",
    );
    this.name = "DbAdmissionTimeoutError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(timeoutMs / 1_000));
  }
}

export type DbAdmissionScheduler<TClient extends ReleasableDbClient> = {
  acquire: (
    lane?: DbLane,
    options?: DbAdmissionAcquireOptions,
  ) => Promise<TClient>;
  getDiagnostics: () => DbAdmissionDiagnostics;
};

const LANES: readonly DbLane[] = ["interactive", "bulk", "background"];
const DEFAULT_AGING_MS = 5_000;
const DEFAULT_BULK_MAX = 6;
const DEFAULT_BACKGROUND_MAX = 2;
const WAIT_SAMPLE_COUNT = 256;

type LaneState<TClient extends ReleasableDbClient> = {
  maxInFlight: number | null;
  shedAfterMs: number | null;
  queue: QueueEntry<TClient>[];
  queueHead: number;
  queued: number;
  inFlight: number;
  opening: number;
  admittedTotal: number;
  rejectedTotal: number;
  canceledTotal: number;
  maxWaitMs: number;
  recentWaits: Float64Array;
  recentWaitCursor: number;
  recentWaitCount: number;
};

type QueueEntry<TClient extends ReleasableDbClient> = {
  lane: DbLane;
  enqueuedAtMs: number;
  sequence: number;
  resolve: (client: TClient) => void;
  reject: (error: unknown) => void;
  queued: boolean;
  settled: boolean;
  acquireTimeout: ReturnType<typeof setTimeout> | null;
  shedTimeout: ReturnType<typeof setTimeout> | null;
  signal: AbortSignal | null;
  abortListener: (() => void) | null;
};

const dbLaneStorage = new AsyncLocalStorage<DbLane>();

/**
 * Runs `fn` with a database admission lane. ALS follows ordinary async chains,
 * but work later drained from queues/timers runs outside the enqueuer's context;
 * those drain loops must tag themselves at the execution point.
 */
export function runInDbLane<T>(lane: DbLane, fn: () => T): T {
  return dbLaneStorage.run(lane, fn);
}

export function currentDbLane(): DbLane {
  return dbLaneStorage.getStore() ?? "interactive";
}

const readOptionalPositiveInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
): number | undefined => {
  return parseOptionalPositiveInteger(env[name]);
};

const readPositiveInteger = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number => readOptionalPositiveInteger(env, name) ?? fallback;

export function resolveDbAdmissionSchedulerConfig(
  maxInFlight: number,
  env: NodeJS.ProcessEnv = process.env,
): DbAdmissionSchedulerConfig {
  return {
    maxInFlight,
    agingMs: readPositiveInteger(
      env,
      "PYRUS_DB_LANE_AGING_MS",
      DEFAULT_AGING_MS,
    ),
    lanes: {
      interactive: { maxInFlight: null, shedAfterMs: null },
      bulk: {
        maxInFlight: readPositiveInteger(
          env,
          "PYRUS_DB_LANE_BULK_MAX",
          DEFAULT_BULK_MAX,
        ),
        shedAfterMs: null,
      },
      background: {
        maxInFlight: readPositiveInteger(
          env,
          "PYRUS_DB_LANE_BACKGROUND_MAX",
          DEFAULT_BACKGROUND_MAX,
        ),
        shedAfterMs: null,
      },
    },
  };
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeOptionalPositiveInteger(
  value: number | null | undefined,
): number | null {
  return typeof value === "number"
    ? (parseOptionalPositiveInteger(String(value)) ?? null)
    : null;
}

function configuredLane<TClient extends ReleasableDbClient>(
  config: DbAdmissionSchedulerConfig,
  lane: DbLane,
): LaneState<TClient> {
  const laneConfig = config.lanes?.[lane];
  const defaultMax =
    lane === "background" ? DEFAULT_BACKGROUND_MAX : DEFAULT_BULK_MAX;
  const configuredMax = laneConfig?.maxInFlight;
  const maxInFlight =
    lane === "interactive"
      ? null
      : configuredMax === null
        ? null
        : normalizePositiveInteger(configuredMax, defaultMax);

  return {
    maxInFlight,
    shedAfterMs: normalizeOptionalPositiveInteger(laneConfig?.shedAfterMs),
    queue: [],
    queueHead: 0,
    queued: 0,
    inFlight: 0,
    opening: 0,
    admittedTotal: 0,
    rejectedTotal: 0,
    canceledTotal: 0,
    maxWaitMs: 0,
    recentWaits: new Float64Array(WAIT_SAMPLE_COUNT),
    recentWaitCursor: 0,
    recentWaitCount: 0,
  };
}

function emptyDbAdmissionDiagnostics(): DbAdmissionDiagnostics {
  return {
    interactive: {
      queued: 0,
      inFlight: 0,
      admittedTotal: 0,
      rejectedTotal: 0,
      canceledTotal: 0,
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
    bulk: {
      queued: 0,
      inFlight: 0,
      admittedTotal: 0,
      rejectedTotal: 0,
      canceledTotal: 0,
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
    background: {
      queued: 0,
      inFlight: 0,
      admittedTotal: 0,
      rejectedTotal: 0,
      canceledTotal: 0,
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
  };
}

let diagnosticsSource: (() => DbAdmissionDiagnostics) | null = null;

export function setDbAdmissionDiagnosticsSource(
  source: (() => DbAdmissionDiagnostics) | null,
): void {
  diagnosticsSource = source;
}

export function getDbAdmissionDiagnostics(): DbAdmissionDiagnostics {
  return diagnosticsSource
    ? diagnosticsSource()
    : emptyDbAdmissionDiagnostics();
}

export function createDbAdmissionScheduler<TClient extends ReleasableDbClient>(
  config: DbAdmissionSchedulerConfig,
  acquireUnderlying: () => Promise<TClient> | TClient,
): DbAdmissionScheduler<TClient> {
  const maxInFlight = normalizePositiveInteger(config.maxInFlight, 1);
  const agingMs = normalizePositiveInteger(config.agingMs, DEFAULT_AGING_MS);
  const acquireTimeoutMs = normalizeOptionalPositiveInteger(
    config.acquireTimeoutMs,
  );
  const now = config.now ?? Date.now;
  const states: Record<DbLane, LaneState<TClient>> = {
    interactive: configuredLane(config, "interactive"),
    bulk: configuredLane(config, "bulk"),
    background: configuredLane(config, "background"),
  };
  let sequence = 0;
  let totalInFlight = 0;
  let totalOpening = 0;
  let draining = false;

  const queuedCount = (state: LaneState<TClient>) => state.queued;

  const compactQueue = (state: LaneState<TClient>) => {
    if (state.queueHead < 64 || state.queueHead * 2 < state.queue.length) {
      return;
    }
    state.queue = state.queue.slice(state.queueHead);
    state.queueHead = 0;
  };

  const discardQueueTombstones = (state: LaneState<TClient>) => {
    while (
      state.queueHead < state.queue.length &&
      !state.queue[state.queueHead].queued
    ) {
      state.queueHead += 1;
    }
    compactQueue(state);
  };

  const clearAcquireTimeout = (entry: QueueEntry<TClient>) => {
    if (entry.acquireTimeout === null) return;
    clearTimeout(entry.acquireTimeout);
    entry.acquireTimeout = null;
  };

  const clearShedTimeout = (entry: QueueEntry<TClient>) => {
    if (entry.shedTimeout === null) return;
    clearTimeout(entry.shedTimeout);
    entry.shedTimeout = null;
  };

  const detachAbortListener = (entry: QueueEntry<TClient>) => {
    if (entry.signal === null || entry.abortListener === null) return;
    entry.signal.removeEventListener("abort", entry.abortListener);
    entry.abortListener = null;
    entry.signal = null;
  };

  const cleanupEntry = (entry: QueueEntry<TClient>) => {
    clearAcquireTimeout(entry);
    clearShedTimeout(entry);
    detachAbortListener(entry);
  };

  const releaseAbandonedClient = (client: TClient) => {
    try {
      const released = client.release();
      void Promise.resolve(released).catch(() => {});
    } catch {
      // The rejected caller is already gone; keep admission draining.
    }
  };

  const removeQueuedEntry = (entry: QueueEntry<TClient>) => {
    if (entry.queued) {
      entry.queued = false;
      const state = states[entry.lane];
      state.queued -= 1;
      discardQueueTombstones(state);
    }
  };

  const rejectEntry = (
    entry: QueueEntry<TClient>,
    error: unknown,
    outcome: "rejected" | "canceled",
  ) => {
    if (entry.settled) return;
    entry.settled = true;
    cleanupEntry(entry);
    removeQueuedEntry(entry);
    const state = states[entry.lane];
    if (outcome === "canceled") {
      state.canceledTotal += 1;
    } else {
      state.rejectedTotal += 1;
    }
    entry.reject(error);
    drain();
  };

  const timeoutEntry = (
    entry: QueueEntry<TClient>,
    timeoutMs: number,
    kind: DbAdmissionTimeoutKind,
  ) => {
    rejectEntry(
      entry,
      new DbAdmissionTimeoutError(entry.lane, timeoutMs, kind),
      "rejected",
    );
  };

  const abortReason = (signal: AbortSignal): unknown => {
    if (signal.reason !== undefined) return signal.reason;
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    return error;
  };

  const headEntry = (lane: DbLane): QueueEntry<TClient> | null => {
    const state = states[lane];
    discardQueueTombstones(state);
    return state.queueHead < state.queue.length
      ? state.queue[state.queueHead]
      : null;
  };

  const laneHasCapacity = (lane: DbLane) => {
    const state = states[lane];
    return (
      state.maxInFlight === null ||
      state.inFlight + state.opening < state.maxInFlight
    );
  };

  const poolHasCapacity = () => totalInFlight + totalOpening < maxInFlight;

  const compareEntries = (
    left: QueueEntry<TClient>,
    right: QueueEntry<TClient>,
  ) =>
    left.enqueuedAtMs === right.enqueuedAtMs
      ? left.sequence - right.sequence
      : left.enqueuedAtMs - right.enqueuedAtMs;

  const pickNext = (): QueueEntry<TClient> | null => {
    if (!poolHasCapacity()) return null;

    const currentTime = now();
    let oldestAged: QueueEntry<TClient> | null = null;

    for (const lane of LANES) {
      const entry = headEntry(lane);
      if (!entry || !laneHasCapacity(lane)) continue;
      if (currentTime - entry.enqueuedAtMs < agingMs) continue;
      if (!oldestAged || compareEntries(entry, oldestAged) < 0) {
        oldestAged = entry;
      }
    }

    if (oldestAged) return oldestAged;

    for (const lane of LANES) {
      const entry = headEntry(lane);
      if (entry && laneHasCapacity(lane)) {
        return entry;
      }
    }

    return null;
  };

  const dequeue = (entry: QueueEntry<TClient>) => {
    const state = states[entry.lane];
    const head = state.queue[state.queueHead];
    if (head !== entry) {
      throw new Error("db admission queue invariant violated");
    }
    entry.queued = false;
    state.queued -= 1;
    clearShedTimeout(entry);
    state.queueHead += 1;
    compactQueue(state);
  };

  const recordWait = (state: LaneState<TClient>, waitMs: number) => {
    const roundedWait = Math.max(0, Math.round(waitMs));
    state.maxWaitMs = Math.max(state.maxWaitMs, roundedWait);
    state.recentWaits[state.recentWaitCursor] = roundedWait;
    state.recentWaitCursor = (state.recentWaitCursor + 1) % WAIT_SAMPLE_COUNT;
    state.recentWaitCount = Math.min(
      state.recentWaitCount + 1,
      WAIT_SAMPLE_COUNT,
    );
  };

  const releaseSlot = (lane: DbLane) => {
    const state = states[lane];
    if (state.inFlight > 0) {
      state.inFlight -= 1;
    }
    if (totalInFlight > 0) {
      totalInFlight -= 1;
    }
    drain();
  };

  const wrapRelease = (lane: DbLane, client: TClient): TClient => {
    const originalRelease = client.release.bind(client);
    let released = false;
    let slotOwned = false;
    const wrappedRelease = ((...args: unknown[]) => {
      if (released) return undefined;
      released = true;
      try {
        return originalRelease(...args);
      } finally {
        if (slotOwned) {
          releaseSlot(lane);
        }
      }
    }) as TClient["release"];
    try {
      client.release = wrappedRelease;
      if (client.release !== wrappedRelease || released) {
        throw new Error("db admission client release is not writable");
      }
    } catch (error) {
      if (!released) {
        released = true;
        try {
          const abandoned = originalRelease();
          void Promise.resolve(abandoned).catch(() => {});
        } catch {
          // The rejected caller is already gone; keep admission draining.
        }
      }
      throw error;
    }
    slotOwned = true;
    return client;
  };

  const startAcquire = (entry: QueueEntry<TClient>) => {
    const state = states[entry.lane];
    state.opening += 1;
    totalOpening += 1;

    Promise.resolve()
      .then(acquireUnderlying)
      .then(
        (client) => {
          state.opening -= 1;
          totalOpening -= 1;
          cleanupEntry(entry);
          if (entry.settled) {
            releaseAbandonedClient(client);
            drain();
            return;
          }
          let wrappedClient: TClient;
          try {
            wrappedClient = wrapRelease(entry.lane, client);
          } catch (error) {
            rejectEntry(entry, error, "rejected");
            return;
          }
          state.inFlight += 1;
          totalInFlight += 1;
          state.admittedTotal += 1;
          recordWait(state, now() - entry.enqueuedAtMs);
          entry.settled = true;
          entry.resolve(wrappedClient);
          drain();
        },
        (error) => {
          state.opening -= 1;
          totalOpening -= 1;
          if (!entry.settled) {
            rejectEntry(entry, error, "rejected");
          } else {
            cleanupEntry(entry);
            drain();
          }
        },
      );
  };

  function drain(): void {
    if (draining) return;
    draining = true;
    try {
      while (poolHasCapacity()) {
        const entry = pickNext();
        if (!entry) return;
        dequeue(entry);
        startAcquire(entry);
      }
    } finally {
      draining = false;
    }
  }

  const recentWaitMsP95 = (state: LaneState<TClient>) => {
    const count = state.recentWaitCount;
    if (count === 0) return 0;
    const waits: number[] = [];
    for (let index = 0; index < count; index += 1) {
      waits.push(state.recentWaits[index]);
    }
    waits.sort((left, right) => left - right);
    return waits[Math.max(0, Math.ceil(count * 0.95) - 1)] ?? 0;
  };

  const getDiagnostics = (): DbAdmissionDiagnostics => ({
    interactive: {
      queued: queuedCount(states.interactive),
      inFlight: states.interactive.inFlight,
      admittedTotal: states.interactive.admittedTotal,
      rejectedTotal: states.interactive.rejectedTotal,
      canceledTotal: states.interactive.canceledTotal,
      maxWaitMs: states.interactive.maxWaitMs,
      recentWaitMsP95: recentWaitMsP95(states.interactive),
    },
    bulk: {
      queued: queuedCount(states.bulk),
      inFlight: states.bulk.inFlight,
      admittedTotal: states.bulk.admittedTotal,
      rejectedTotal: states.bulk.rejectedTotal,
      canceledTotal: states.bulk.canceledTotal,
      maxWaitMs: states.bulk.maxWaitMs,
      recentWaitMsP95: recentWaitMsP95(states.bulk),
    },
    background: {
      queued: queuedCount(states.background),
      inFlight: states.background.inFlight,
      admittedTotal: states.background.admittedTotal,
      rejectedTotal: states.background.rejectedTotal,
      canceledTotal: states.background.canceledTotal,
      maxWaitMs: states.background.maxWaitMs,
      recentWaitMsP95: recentWaitMsP95(states.background),
    },
  });

  return {
    acquire(
      lane: DbLane = currentDbLane(),
      options: DbAdmissionAcquireOptions = {},
    ) {
      if (options.signal?.aborted) {
        states[lane].canceledTotal += 1;
        return Promise.reject(abortReason(options.signal));
      }

      return new Promise<TClient>((resolve, reject) => {
        const entry: QueueEntry<TClient> = {
          lane,
          enqueuedAtMs: now(),
          sequence,
          resolve,
          reject,
          queued: true,
          settled: false,
          acquireTimeout: null,
          shedTimeout: null,
          signal: options.signal ?? null,
          abortListener: null,
        };
        states[lane].queue.push(entry);
        states[lane].queued += 1;
        sequence += 1;

        if (entry.signal !== null) {
          entry.abortListener = () => {
            rejectEntry(entry, abortReason(entry.signal!), "canceled");
          };
          entry.signal.addEventListener("abort", entry.abortListener, {
            once: true,
          });
          if (entry.signal.aborted) {
            rejectEntry(entry, abortReason(entry.signal), "canceled");
            return;
          }
        }

        if (acquireTimeoutMs !== null) {
          entry.acquireTimeout = setTimeout(
            () => timeoutEntry(entry, acquireTimeoutMs, "acquire"),
            acquireTimeoutMs,
          );
          entry.acquireTimeout.unref?.();
        }
        const shedAfterMs = states[lane].shedAfterMs;
        if (shedAfterMs !== null) {
          entry.shedTimeout = setTimeout(
            () => timeoutEntry(entry, shedAfterMs, "shed"),
            shedAfterMs,
          );
          entry.shedTimeout.unref?.();
        }
        drain();
      });
    },
    getDiagnostics,
  };
}

import { AsyncLocalStorage } from "node:async_hooks";

export type DbLane = "interactive" | "bulk" | "background";

export type DbLaneAdmissionDiagnostics = {
  queued: number;
  inFlight: number;
  admittedTotal: number;
  maxWaitMs: number;
  recentWaitMsP95: number;
};

export type DbAdmissionDiagnostics = Record<
  DbLane,
  DbLaneAdmissionDiagnostics
>;

export type DbAdmissionLaneConfig = {
  maxInFlight?: number | null;
  shedAfterMs?: number | null;
};

export type DbAdmissionSchedulerConfig = {
  maxInFlight: number;
  agingMs?: number;
  lanes?: Partial<Record<DbLane, DbAdmissionLaneConfig>>;
  now?: () => number;
};

export type ReleasableDbClient = {
  release: (...args: unknown[]) => unknown;
};

export type DbAdmissionScheduler<TClient extends ReleasableDbClient> = {
  acquire: (lane?: DbLane) => Promise<TClient>;
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
  inFlight: number;
  opening: number;
  admittedTotal: number;
  maxWaitMs: number;
  recentWaits: Int32Array;
  recentWaitCursor: number;
  recentWaitCount: number;
};

type QueueEntry<TClient extends ReleasableDbClient> = {
  lane: DbLane;
  enqueuedAtMs: number;
  sequence: number;
  resolve: (client: TClient) => void;
  reject: (error: unknown) => void;
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
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
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
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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
    shedAfterMs:
      laneConfig?.shedAfterMs === undefined ? null : laneConfig.shedAfterMs,
    queue: [],
    queueHead: 0,
    inFlight: 0,
    opening: 0,
    admittedTotal: 0,
    maxWaitMs: 0,
    recentWaits: new Int32Array(WAIT_SAMPLE_COUNT),
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
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
    bulk: {
      queued: 0,
      inFlight: 0,
      admittedTotal: 0,
      maxWaitMs: 0,
      recentWaitMsP95: 0,
    },
    background: {
      queued: 0,
      inFlight: 0,
      admittedTotal: 0,
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
  return diagnosticsSource ? diagnosticsSource() : emptyDbAdmissionDiagnostics();
}

export function createDbAdmissionScheduler<TClient extends ReleasableDbClient>(
  config: DbAdmissionSchedulerConfig,
  acquireUnderlying: () => Promise<TClient> | TClient,
): DbAdmissionScheduler<TClient> {
  const maxInFlight = normalizePositiveInteger(config.maxInFlight, 1);
  const agingMs = normalizePositiveInteger(config.agingMs, DEFAULT_AGING_MS);
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

  const queuedCount = (state: LaneState<TClient>) =>
    state.queue.length - state.queueHead;

  const compactQueue = (state: LaneState<TClient>) => {
    if (state.queueHead < 64 || state.queueHead * 2 < state.queue.length) {
      return;
    }
    state.queue = state.queue.slice(state.queueHead);
    state.queueHead = 0;
  };

  const headEntry = (lane: DbLane): QueueEntry<TClient> | null => {
    const state = states[lane];
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
    state.queueHead += 1;
    compactQueue(state);
  };

  const recordWait = (state: LaneState<TClient>, waitMs: number) => {
    const roundedWait = Math.max(0, Math.round(waitMs));
    state.maxWaitMs = Math.max(state.maxWaitMs, roundedWait);
    state.recentWaits[state.recentWaitCursor] = roundedWait;
    state.recentWaitCursor =
      (state.recentWaitCursor + 1) % WAIT_SAMPLE_COUNT;
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
    client.release = ((...args: unknown[]) => {
      if (released) return undefined;
      released = true;
      try {
        return originalRelease(...args);
      } finally {
        releaseSlot(lane);
      }
    }) as TClient["release"];
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
          state.inFlight += 1;
          totalInFlight += 1;
          state.admittedTotal += 1;
          recordWait(state, now() - entry.enqueuedAtMs);
          entry.resolve(wrapRelease(entry.lane, client));
          drain();
        },
        (error) => {
          state.opening -= 1;
          totalOpening -= 1;
          entry.reject(error);
          drain();
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
      maxWaitMs: states.interactive.maxWaitMs,
      recentWaitMsP95: recentWaitMsP95(states.interactive),
    },
    bulk: {
      queued: queuedCount(states.bulk),
      inFlight: states.bulk.inFlight,
      admittedTotal: states.bulk.admittedTotal,
      maxWaitMs: states.bulk.maxWaitMs,
      recentWaitMsP95: recentWaitMsP95(states.bulk),
    },
    background: {
      queued: queuedCount(states.background),
      inFlight: states.background.inFlight,
      admittedTotal: states.background.admittedTotal,
      maxWaitMs: states.background.maxWaitMs,
      recentWaitMsP95: recentWaitMsP95(states.background),
    },
  });

  return {
    acquire(lane: DbLane = currentDbLane()) {
      return new Promise<TClient>((resolve, reject) => {
        states[lane].queue.push({
          lane,
          enqueuedAtMs: now(),
          sequence,
          resolve,
          reject,
        });
        sequence += 1;
        drain();
      });
    },
    getDiagnostics,
  };
}

import { eq } from "drizzle-orm";
import {
  db,
  pool,
  signalMonitorProfilesTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import {
  evaluateSignalMonitorSymbolFromCompletedBars,
  listEnabledSignalMonitorProfiles,
  loadSignalMonitorCompletedBars,
  resolveSignalMonitorProfileUniverse,
  resolveSignalMonitorTimeframe,
  updateSignalMonitorProfileEvaluationMetadata,
  type SignalMonitorProfileRow,
  type SignalMonitorTimeframe,
} from "./signal-monitor";

const WORKER_WAKEUP_MS = 5_000;
const ADVISORY_LOCK_KEY = 1_930_514_021;
const FAILED_KEY_RETRY_MS = 60_000;

type ReleaseLock = () => Promise<void>;
type WorkerLogger = Pick<typeof logger, "debug" | "info" | "warn">;

type WorkerDependencies = {
  listProfiles: () => Promise<SignalMonitorProfileRow[]>;
  resolveUniverse: typeof resolveSignalMonitorProfileUniverse;
  loadCompletedBars: typeof loadSignalMonitorCompletedBars;
  evaluateSymbolFromCompletedBars: typeof evaluateSignalMonitorSymbolFromCompletedBars;
  updateProfileEvaluationMetadata:
    typeof updateSignalMonitorProfileEvaluationMetadata;
  updateProfileLastError: (profileId: string, message: string | null) => Promise<void>;
  acquireTickLock: () => Promise<ReleaseLock | null>;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  now: () => Date;
  logger: WorkerLogger;
};

export type TradeMonitorWorkerOptions = Partial<WorkerDependencies> & {
  wakeupMs?: number;
};

type ProfileRuntime = {
  signature: string;
  lastCheckedAtMs: number;
  evaluatedKeys: Set<string>;
  failedKeys: Map<string, number>;
};

const activeProfileIds = new Set<string>();

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? Math.min(max, Math.max(min, Math.round(resolved)))
    : fallback;
}

function profileSignature(profile: SignalMonitorProfileRow): string {
  return JSON.stringify({
    enabled: profile.enabled,
    watchlistId: profile.watchlistId ?? null,
    timeframe: profile.timeframe,
    rayReplicaSettings: profile.rayReplicaSettings ?? {},
    freshWindowBars: profile.freshWindowBars,
    pollIntervalSeconds: profile.pollIntervalSeconds,
    maxSymbols: profile.maxSymbols,
    evaluationConcurrency: profile.evaluationConcurrency,
  });
}

function evaluatedKey(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  latestBarAt: Date;
}) {
  return [
    input.profileId,
    input.symbol,
    input.timeframe,
    input.latestBarAt.toISOString(),
  ].join(":");
}

async function updateProfileLastError(
  profileId: string,
  message: string | null,
): Promise<void> {
  await db
    .update(signalMonitorProfilesTable)
    .set({
      lastError: message,
      updatedAt: new Date(),
    })
    .where(eq(signalMonitorProfilesTable.id, profileId));
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
  options: TradeMonitorWorkerOptions,
): WorkerDependencies {
  return {
    listProfiles: options.listProfiles ?? listEnabledSignalMonitorProfiles,
    resolveUniverse: options.resolveUniverse ?? resolveSignalMonitorProfileUniverse,
    loadCompletedBars: options.loadCompletedBars ?? loadSignalMonitorCompletedBars,
    evaluateSymbolFromCompletedBars:
      options.evaluateSymbolFromCompletedBars ??
      evaluateSignalMonitorSymbolFromCompletedBars,
    updateProfileEvaluationMetadata:
      options.updateProfileEvaluationMetadata ??
      updateSignalMonitorProfileEvaluationMetadata,
    updateProfileLastError: options.updateProfileLastError ?? updateProfileLastError,
    acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
    setTimer: options.setTimer ?? setTimeout,
    clearTimer: options.clearTimer ?? clearTimeout,
    now: options.now ?? (() => new Date()),
    logger: options.logger ?? logger,
  };
}

async function runInBatches<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    const batch = values.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(mapper))));
  }
  return results;
}

async function runProfile(input: {
  profile: SignalMonitorProfileRow;
  runtime: ProfileRuntime;
  dependencies: WorkerDependencies;
}) {
  const { profile, runtime, dependencies } = input;
  if (activeProfileIds.has(profile.id)) {
    dependencies.logger.debug?.(
      { profileId: profile.id },
      "Signal monitor profile evaluation already running",
    );
    return;
  }

  activeProfileIds.add(profile.id);
  try {
    const evaluatedAt = dependencies.now();
    const evaluatedAtMs = evaluatedAt.getTime();
    const timeframe = resolveSignalMonitorTimeframe(profile.timeframe);
    const universe = await dependencies.resolveUniverse(profile, {
      ensureWatchlist: false,
    });
    const concurrency = positiveInteger(profile.evaluationConcurrency, 3, 1, 10);
    const latestBars = await runInBatches(
      universe.symbols,
      concurrency,
      async (symbol) => ({
        symbol,
        completedBars: await dependencies.loadCompletedBars({
          symbol,
          timeframe,
          evaluatedAt,
        }),
      }),
    );
    const keysToRecord = new Map<string, string>();
    const currentKeys = new Set<string>();
    const symbolsToEvaluate: Array<{
      symbol: string;
      completedBars: Awaited<ReturnType<typeof loadSignalMonitorCompletedBars>>;
    }> = [];

    latestBars.forEach(({ symbol, completedBars }) => {
      if (!completedBars.latestBarAt) {
        return;
      }

      const key = evaluatedKey({
        profileId: profile.id,
        symbol,
        timeframe,
        latestBarAt: completedBars.latestBarAt,
      });
      keysToRecord.set(symbol, key);
      currentKeys.add(key);
      if (runtime.evaluatedKeys.has(key)) {
        return;
      }
      const retryAfterMs = runtime.failedKeys.get(key) ?? 0;
      if (retryAfterMs > evaluatedAtMs) {
        return;
      }
      symbolsToEvaluate.push({ symbol, completedBars });
    });

    Array.from(runtime.failedKeys.keys()).forEach((key) => {
      if (!currentKeys.has(key)) {
        runtime.failedKeys.delete(key);
      }
    });

    if (!symbolsToEvaluate.length) {
      return;
    }

    const evaluatedStates = await runInBatches(
      symbolsToEvaluate,
      concurrency,
      (entry) =>
        dependencies.evaluateSymbolFromCompletedBars({
          profile: universe.profile,
          symbol: entry.symbol,
          timeframe,
          mode: "incremental",
          evaluatedAt,
          completedBars: entry.completedBars.bars,
        }),
    );
    await dependencies.updateProfileEvaluationMetadata({
      profile: universe.profile,
      evaluatedAt,
      states: evaluatedStates,
    });
    evaluatedStates.forEach((state) => {
      const key = keysToRecord.get(state.symbol);
      if (key) {
        if (state.status === "error") {
          runtime.failedKeys.set(key, evaluatedAtMs + FAILED_KEY_RETRY_MS);
          return;
        }
        runtime.failedKeys.delete(key);
        runtime.evaluatedKeys.add(key);
      }
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Signal monitor worker failed.";
    await dependencies.updateProfileLastError(profile.id, message);
    dependencies.logger.warn(
      { err: error, profileId: profile.id },
      "Signal monitor profile worker tick failed",
    );
  } finally {
    activeProfileIds.delete(profile.id);
  }
}

export function createTradeMonitorWorker(
  options: TradeMonitorWorkerOptions = {},
) {
  const dependencies = defaultDependencies(options);
  const transientDbBackoff = createTransientPostgresBackoff();
  const wakeupMs = positiveInteger(
    options.wakeupMs,
    WORKER_WAKEUP_MS,
    250,
    3_600_000,
  );
  const profileRuntime = new Map<string, ProfileRuntime>();
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
      const profiles = await dependencies.listProfiles();
      const enabledIds = new Set(profiles.map((profile) => profile.id));

      Array.from(profileRuntime.keys()).forEach((profileId) => {
        if (!enabledIds.has(profileId)) {
          profileRuntime.delete(profileId);
        }
      });

      for (const profile of profiles) {
        const signature = profileSignature(profile);
        let runtime = profileRuntime.get(profile.id);
        const signatureChanged = runtime?.signature !== signature;

        if (!runtime || signatureChanged) {
          runtime = {
            signature,
            lastCheckedAtMs: 0,
            evaluatedKeys: new Set(),
            failedKeys: new Map(),
          };
          profileRuntime.set(profile.id, runtime);
        }

        const pollIntervalMs =
          positiveInteger(profile.pollIntervalSeconds, 60, 15, 3600) * 1000;
        if (
          !signatureChanged &&
          runtime.lastCheckedAtMs > 0 &&
          nowMs - runtime.lastCheckedAtMs < pollIntervalMs
        ) {
          continue;
        }

        runtime.lastCheckedAtMs = nowMs;
        await runProfile({ profile, runtime, dependencies });
      }
      transientDbBackoff.clear();
    } catch (error) {
      if (isTransientPostgresError(error)) {
        transientDbBackoff.markFailure({
          error,
          logger: dependencies.logger,
          message: "Signal monitor database unavailable; pausing worker ticks",
          nowMs: dependencies.now().getTime(),
        });
        return;
      }
      dependencies.logger.warn(
        { err: error },
        "Signal monitor worker tick failed",
      );
    } finally {
      if (releaseLock) {
        try {
          await releaseLock();
        } catch (error) {
          dependencies.logger.warn(
            { err: error },
            "Signal monitor worker advisory lock release failed",
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
      dependencies.logger.info("Signal monitor worker started");
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
      return {
        started,
        tickRunning,
        profileCount: profileRuntime.size,
        activeProfileCount: activeProfileIds.size,
      };
    },
  };
}

const defaultWorker = createTradeMonitorWorker();

export function startTradeMonitorWorker(): void {
  defaultWorker.start();
}

export function stopTradeMonitorWorker(): void {
  defaultWorker.stop();
}

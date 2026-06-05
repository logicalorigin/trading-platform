import { eq } from "drizzle-orm";
import {
  attachPostgresClientErrorHandler,
  db,
  pool,
  signalMonitorProfilesTable,
  type SignalMonitorSymbolState,
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
  cappedSignalMonitorEvaluationProfile,
  getSignalMonitorTimeframeMs,
  resolveSignalMonitorEvaluationBatch,
  resolveSignalMonitorProfileUniverse,
  resolveSignalMonitorTimeframe,
  updateSignalMonitorProfileEvaluationMetadata,
  type SignalMonitorProfileRow,
  type SignalMonitorTimeframe,
} from "./signal-monitor";
import {
  hasRecentStockAggregateSourceActivity,
  isBackgroundStockAggregateStreamingEnabled,
  isStockAggregateStreamingAvailable,
  subscribeMutableStockMinuteAggregates,
  type StockMinuteAggregateMessage,
  type StockMinuteAggregateSubscription,
} from "./stock-aggregate-stream";
import { requestSignalOptionsWorkerScanSoon } from "./signal-options-worker";

const WORKER_WAKEUP_MS = 5_000;
const ADVISORY_LOCK_KEY = 1_930_514_021;
const FAILED_KEY_RETRY_MS = 60_000;
const STREAM_EVALUATION_FLUSH_MS = 100;

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
  isStockAggregateStreamingAvailable: () => boolean;
  hasRecentStockAggregateSourceActivity: (input: {
    symbols: string[];
    now: Date;
    maxAgeMs: number;
  }) => boolean;
  acquireTickLock: () => Promise<ReleaseLock | null>;
  subscribeStockMinuteAggregates: typeof subscribeMutableStockMinuteAggregates;
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
  evaluationCursor: number;
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
    pyrusSignalsSettings: profile.pyrusSignalsSettings ?? {},
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

function streamFreshnessWindowMs(input: {
  profile: SignalMonitorProfileRow;
  timeframe: SignalMonitorTimeframe;
}): number {
  const pollIntervalMs =
    positiveInteger(input.profile.pollIntervalSeconds, 60, 15, 3600) * 1000;
  return Math.max(
    60_000,
    pollIntervalMs * 2,
    getSignalMonitorTimeframeMs(input.timeframe) * 2,
  );
}

function shouldRememberEvaluatedKey(state: SignalMonitorSymbolState): boolean {
  return state.status === "ok" && Boolean(state.currentSignalAt);
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
  let clientError: Error | null = null;
  let transactionOpen = false;
  const detachClientErrorHandler = attachPostgresClientErrorHandler(client, {
    context: "signal-monitor-worker-advisory-lock",
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
    isStockAggregateStreamingAvailable:
      options.isStockAggregateStreamingAvailable ??
      (() =>
        process.env["SIGNAL_MONITOR_STREAM_FIRST_WORKER"] !== "0" &&
        isBackgroundStockAggregateStreamingEnabled() &&
        isStockAggregateStreamingAvailable()),
    hasRecentStockAggregateSourceActivity:
      options.hasRecentStockAggregateSourceActivity ??
      ((input) => hasRecentStockAggregateSourceActivity(input)),
    acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
    subscribeStockMinuteAggregates:
      options.subscribeStockMinuteAggregates ?? subscribeMutableStockMinuteAggregates,
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
  onUniverseResolved?: (profileId: string, symbols: string[]) => void;
}) {
  const { profile, runtime, dependencies, onUniverseResolved } = input;
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
    const evaluationSettings = cappedSignalMonitorEvaluationProfile(profile);
    const evaluationProfile = evaluationSettings.profile;
    const timeframe = resolveSignalMonitorTimeframe(evaluationProfile.timeframe);
    const universe = await dependencies.resolveUniverse(evaluationProfile, {
      ensureWatchlist: false,
    });
    const universeSymbols = universe.symbols;
    onUniverseResolved?.(profile.id, universeSymbols);
    const resolvedBatch = resolveSignalMonitorEvaluationBatch({
      sourceSymbols: universeSymbols,
      maxSymbols: evaluationProfile.maxSymbols,
      cursor: runtime.evaluationCursor,
    });
    runtime.evaluationCursor = resolvedBatch.nextCursor;
    const streamingAvailable = dependencies.isStockAggregateStreamingAvailable();
    const streamFresh = streamingAvailable
      ? dependencies.hasRecentStockAggregateSourceActivity({
          symbols: universeSymbols,
          now: evaluatedAt,
          maxAgeMs: streamFreshnessWindowMs({
            profile: evaluationProfile,
            timeframe,
          }),
        })
      : false;
    if (streamFresh) {
      if (profile.lastError) {
        await dependencies.updateProfileLastError(profile.id, null);
      }
      return;
    }
    if (streamingAvailable) {
      dependencies.logger.debug?.(
        { profileId: profile.id, timeframe },
        "Signal monitor stream is configured but source activity is stale; running history fallback",
      );
    }

    const concurrency = positiveInteger(
      evaluationProfile.evaluationConcurrency,
      2,
      1,
      10,
    );
    const latestBars = await runInBatches(
      resolvedBatch.symbols,
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
        if (shouldRememberEvaluatedKey(state)) {
          runtime.evaluatedKeys.add(key);
        }
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

function streamSignalBarStart(input: {
  message: StockMinuteAggregateMessage;
  timeframe: SignalMonitorTimeframe;
}): Date | null {
  if (input.timeframe === "1d") {
    return null;
  }
  const timeframeMs = getSignalMonitorTimeframeMs(input.timeframe);
  const minuteStartMs = Math.floor(input.message.startMs / 60_000) * 60_000;
  return new Date(Math.floor(minuteStartMs / timeframeMs) * timeframeMs);
}

async function runStreamProfileSymbolUnlocked(input: {
  profile: SignalMonitorProfileRow;
  runtime: ProfileRuntime;
  message: StockMinuteAggregateMessage;
  dependencies: WorkerDependencies;
  activeStreamEvaluationKeys: Set<string>;
}) {
  const {
    profile,
    runtime,
    message,
    dependencies,
    activeStreamEvaluationKeys,
  } = input;
  const evaluationSettings = cappedSignalMonitorEvaluationProfile(profile);
  const evaluationProfile = evaluationSettings.profile;
  const timeframe = resolveSignalMonitorTimeframe(evaluationProfile.timeframe);
  const expectedLatestBarAt = streamSignalBarStart({ message, timeframe });
  if (!expectedLatestBarAt) {
    return;
  }

  const symbol = message.symbol;
  const evaluatedAt = dependencies.now();
  const expectedKey = evaluatedKey({
    profileId: profile.id,
    symbol,
    timeframe,
    latestBarAt: new Date(message.startMs),
  });
  const expectedRetryAfterMs = runtime.failedKeys.get(expectedKey) ?? 0;
  if (expectedRetryAfterMs > evaluatedAt.getTime()) {
    return;
  }
  if (activeStreamEvaluationKeys.has(expectedKey)) {
    return;
  }

  activeStreamEvaluationKeys.add(expectedKey);
  try {
    const completedBars = await dependencies.loadCompletedBars({
      symbol,
      timeframe,
      evaluatedAt,
      retryStale: true,
      includeProvisionalLiveEdge: true,
    });
    if (
      !completedBars.latestBarAt ||
      completedBars.latestBarAt.getTime() < expectedLatestBarAt.getTime()
    ) {
      return;
    }

    const key = evaluatedKey({
      profileId: profile.id,
      symbol,
      timeframe,
      latestBarAt: completedBars.latestBarAt,
    });
    if (runtime.evaluatedKeys.has(key)) {
      return;
    }
    const retryAfterMs = runtime.failedKeys.get(key) ?? 0;
    if (retryAfterMs > evaluatedAt.getTime()) {
      return;
    }

    const state = await dependencies.evaluateSymbolFromCompletedBars({
      profile: evaluationProfile,
      symbol,
      timeframe,
      mode: "incremental",
      evaluatedAt,
      completedBars: completedBars.bars,
    });
    await dependencies.updateProfileEvaluationMetadata({
      profile: evaluationProfile,
      evaluatedAt,
      states: [state],
    });
    if (state.status === "error") {
      runtime.failedKeys.set(key, evaluatedAt.getTime() + FAILED_KEY_RETRY_MS);
      return;
    }
    runtime.failedKeys.delete(key);
    if (shouldRememberEvaluatedKey(state)) {
      runtime.evaluatedKeys.add(key);
    }
    if (
      state.status === "ok" &&
      state.fresh === true &&
      state.currentSignalDirection &&
      state.currentSignalAt
    ) {
      requestSignalOptionsWorkerScanSoon();
    }
  } catch (error) {
    const messageText =
      error instanceof Error && error.message
        ? error.message
        : "Signal monitor stream evaluation failed.";
    await dependencies.updateProfileLastError(profile.id, messageText);
    dependencies.logger.warn(
      { err: error, profileId: profile.id, symbol },
      "Signal monitor stream evaluation failed",
    );
  } finally {
    activeStreamEvaluationKeys.delete(expectedKey);
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
  const profileSymbols = new Map<string, Set<string>>();
  const latestProfilesById = new Map<string, SignalMonitorProfileRow>();
  const activeStreamEvaluationKeys = new Set<string>();
  const pendingStreamMessagesByProfile = new Map<
    string,
    Map<string, StockMinuteAggregateMessage>
  >();
  let streamSubscription: StockMinuteAggregateSubscription | null = null;
  let streamSignature = "";
  let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let streamFlushRunning = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let tickRunning = false;

  const refreshStreamSubscription = () => {
    const symbols = Array.from(
      new Set(
        Array.from(profileSymbols.values()).flatMap((profileSet) =>
          Array.from(profileSet),
        ),
      ),
    ).sort();
    const signature = symbols.join(",");
    if (!symbols.length) {
      streamSubscription?.unsubscribe();
      streamSubscription = null;
      streamSignature = "";
      return;
    }
    if (!streamSubscription) {
      streamSubscription = dependencies.subscribeStockMinuteAggregates(
        symbols,
        (message) => {
          handleStreamAggregate(message);
        },
      );
      streamSignature = signature;
      return;
    }
    if (signature !== streamSignature) {
      streamSubscription.setSymbols(symbols);
      streamSignature = signature;
    }
  };

  const rememberProfileSymbols = (profileId: string, symbols: string[]) => {
    profileSymbols.set(profileId, new Set(symbols));
    refreshStreamSubscription();
  };

  const requeueStreamBatch = (
    batch: Map<string, StockMinuteAggregateMessage[]>,
  ) => {
    batch.forEach((messages, profileId) => {
      const pending =
        pendingStreamMessagesByProfile.get(profileId) ?? new Map();
      messages.forEach((message) => {
        pending.set(message.symbol, message);
      });
      pendingStreamMessagesByProfile.set(profileId, pending);
    });
  };

  const drainStreamBatch = () => {
    const batch = new Map<string, StockMinuteAggregateMessage[]>();
    pendingStreamMessagesByProfile.forEach((messages, profileId) => {
      batch.set(profileId, Array.from(messages.values()));
    });
    pendingStreamMessagesByProfile.clear();
    return batch;
  };

  const flushStreamEvaluations = async () => {
    if (streamFlushRunning) {
      return;
    }
    streamFlushRunning = true;
    const batch = drainStreamBatch();
    let releaseLock: ReleaseLock | null = null;

    try {
      if (!batch.size) {
        return;
      }

      releaseLock = await dependencies.acquireTickLock();
      if (!releaseLock) {
        requeueStreamBatch(batch);
        scheduleStreamFlush(500);
        return;
      }

      for (const [profileId, messages] of batch.entries()) {
        const profile = latestProfilesById.get(profileId);
        const runtime = profileRuntime.get(profileId);
        if (!profile || !runtime) {
          continue;
        }
        const concurrency = positiveInteger(
          profile.evaluationConcurrency,
          2,
          1,
          10,
        );
        await runInBatches(messages, concurrency, (message) =>
          runStreamProfileSymbolUnlocked({
            profile,
            runtime,
            message,
            dependencies,
            activeStreamEvaluationKeys,
          }),
        );
      }
    } catch (error) {
      requeueStreamBatch(batch);
      dependencies.logger.warn(
        { err: error },
        "Signal monitor stream batch evaluation failed",
      );
      scheduleStreamFlush(1_000);
    } finally {
      if (releaseLock) {
        try {
          await releaseLock();
        } catch (error) {
          dependencies.logger.warn(
            { err: error },
            "Signal monitor stream advisory lock release failed",
          );
        }
      }
      streamFlushRunning = false;
      if (pendingStreamMessagesByProfile.size > 0) {
        scheduleStreamFlush(0);
      }
    }
  };

  const scheduleStreamFlush = (delayMs = STREAM_EVALUATION_FLUSH_MS) => {
    if (streamFlushTimer || streamFlushRunning) {
      return;
    }
    streamFlushTimer = dependencies.setTimer(() => {
      streamFlushTimer = null;
      void flushStreamEvaluations();
    }, Math.max(0, delayMs));
    streamFlushTimer.unref?.();
  };

  const handleStreamAggregate = (message: StockMinuteAggregateMessage) => {
    const symbol = message.symbol;
    const profileIds = Array.from(profileSymbols.entries())
      .filter(([, symbols]) => symbols.has(symbol))
      .map(([profileId]) => profileId);

    for (const profileId of profileIds) {
      const profile = latestProfilesById.get(profileId);
      const runtime = profileRuntime.get(profileId);
      if (!profile || !runtime) {
        continue;
      }
      const timeframe = resolveSignalMonitorTimeframe(profile.timeframe);
      if (!streamSignalBarStart({ message, timeframe })) {
        continue;
      }
      const pending =
        pendingStreamMessagesByProfile.get(profileId) ?? new Map();
      pending.set(symbol, message);
      pendingStreamMessagesByProfile.set(profileId, pending);
    }
    scheduleStreamFlush();
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
      const profiles = await dependencies.listProfiles();
      const enabledIds = new Set(profiles.map((profile) => profile.id));
      latestProfilesById.clear();
      profiles.forEach((profile) => {
        latestProfilesById.set(profile.id, profile);
      });

      Array.from(profileRuntime.keys()).forEach((profileId) => {
        if (!enabledIds.has(profileId)) {
          profileRuntime.delete(profileId);
          profileSymbols.delete(profileId);
        }
      });
      refreshStreamSubscription();

      for (const profile of profiles) {
        const signature = profileSignature(profile);
        let runtime = profileRuntime.get(profile.id);
        const signatureChanged = runtime?.signature !== signature;

        if (!runtime || signatureChanged) {
          runtime = {
            signature,
            lastCheckedAtMs: 0,
            evaluationCursor: 0,
            evaluatedKeys: new Set(),
            failedKeys: new Map(),
          };
          profileRuntime.set(profile.id, runtime);
        }

        const pollIntervalMs =
          positiveInteger(profile.pollIntervalSeconds, 60, 15, 3600) * 1000;
        const rotationInProgress = (runtime.evaluationCursor ?? 0) > 0;
        if (
          !signatureChanged &&
          !rotationInProgress &&
          runtime.lastCheckedAtMs > 0 &&
          nowMs - runtime.lastCheckedAtMs < pollIntervalMs
        ) {
          continue;
        }

        runtime.lastCheckedAtMs = nowMs;
        await runProfile({
          profile,
          runtime,
          dependencies,
          onUniverseResolved: rememberProfileSymbols,
        });
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
      if (streamFlushTimer) {
        dependencies.clearTimer(streamFlushTimer);
        streamFlushTimer = null;
      }
      pendingStreamMessagesByProfile.clear();
      streamSubscription?.unsubscribe();
      streamSubscription = null;
      streamSignature = "";
    },
    runOnce,
    getRuntimeSnapshot() {
      return {
        started,
        tickRunning,
        profileCount: profileRuntime.size,
        activeProfileCount: activeProfileIds.size,
        pendingStreamProfileCount: pendingStreamMessagesByProfile.size,
        streamFlushRunning,
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

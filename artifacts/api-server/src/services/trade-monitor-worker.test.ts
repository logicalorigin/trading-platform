import assert from "node:assert/strict";
import test from "node:test";
import type { SignalMonitorSymbolState } from "@workspace/db";
import type { SignalMonitorProfileRow } from "./signal-monitor";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["SIGNAL_MONITOR_STREAM_FIRST_WORKER"] = "0";

const workerModule = await import("./trade-monitor-worker");
const signalMonitorModule = await import("./signal-monitor");

const { createTradeMonitorWorker } = workerModule;
const { isSignalMonitorBarComplete } = signalMonitorModule;

const baseDate = new Date("2026-04-24T14:30:00.000Z");

function profile(
  patch: Partial<SignalMonitorProfileRow> = {},
): SignalMonitorProfileRow {
  return {
    id: "profile-1",
    environment: "paper",
    enabled: true,
    watchlistId: "watchlist-1",
    timeframe: "1m",
    pyrusSignalsSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 15,
    maxSymbols: 50,
    evaluationConcurrency: 3,
    lastEvaluatedAt: null,
    lastError: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...patch,
  };
}

function symbolState(
  patch: Partial<SignalMonitorSymbolState> = {},
): SignalMonitorSymbolState {
  return {
    id: "state-1",
    profileId: "profile-1",
    symbol: "AAPL",
    timeframe: "1m",
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    barsSinceSignal: null,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: baseDate,
    lastError: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...patch,
  };
}

function createNoopLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
  };
}

function streamAggregate(symbol: string, startIso: string) {
  const startMs = Date.parse(startIso);
  return {
    eventType: "AM",
    symbol,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1_000,
    accumulatedVolume: null,
    vwap: null,
    sessionVwap: null,
    officialOpen: null,
    averageTradeSize: null,
    startMs,
    endMs: startMs + 59_999,
    delayed: false,
    source: "massive-websocket",
  };
}

function signalMonitorTestUniverse(
  inputProfile: SignalMonitorProfileRow,
  symbols: string[],
) {
  return {
    mode: "selected_watchlist" as const,
    configuredMaxSymbols: inputProfile.maxSymbols,
    resolvedSymbols: symbols.length,
    pinnedSymbols: symbols.length,
    expansionSymbols: 0,
    shortfall: Math.max(0, inputProfile.maxSymbols - symbols.length),
    source: "selected_watchlist" as const,
    fallbackUsed: false,
    degradedReason: null,
    rankedAt: null,
  };
}

test("signal monitor completed-bar rules exclude active bars", () => {
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-24T14:30:00.000Z"),
      dataUpdatedAt: new Date("2026-04-24T14:31:00.000Z"),
      timeframe: "1m",
      evaluatedAt: new Date("2026-04-24T14:30:59.999Z"),
    }),
    false,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-24T14:30:00.000Z"),
      dataUpdatedAt: new Date("2026-04-24T14:31:00.000Z"),
      timeframe: "1m",
      evaluatedAt: new Date("2026-04-24T14:31:00.000Z"),
    }),
    true,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-24T04:00:00.000Z"),
      timeframe: "1d",
      evaluatedAt: new Date("2026-04-24T20:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-24T00:00:00.000Z"),
      timeframe: "1d",
      evaluatedAt: new Date("2026-04-24T20:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-24T04:00:00.000Z"),
      timeframe: "1d",
      evaluatedAt: new Date("2026-04-25T01:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-23T00:00:00.000Z"),
      timeframe: "1d",
      evaluatedAt: new Date("2026-04-24T20:00:00.000Z"),
    }),
    true,
  );
});

test("trade monitor worker start is idempotent and stop clears the scheduled wakeup", async () => {
  let listCalls = 0;
  let clearCalls = 0;
  const worker = createTradeMonitorWorker({
    listProfiles: async () => {
      listCalls += 1;
      return [];
    },
    acquireTickLock: async () => async () => {},
    setTimer: (() => 1) as never,
    clearTimer: (() => {
      clearCalls += 1;
    }) as never,
    logger: createNoopLogger(),
  });

  worker.start();
  worker.start();
  await new Promise((resolve) => setImmediate(resolve));
  worker.stop();

  assert.equal(listCalls, 1);
  assert.equal(clearCalls, 1);
});

test("trade monitor worker skips a tick when the advisory lock is unavailable", async () => {
  let listCalls = 0;
  const worker = createTradeMonitorWorker({
    listProfiles: async () => {
      listCalls += 1;
      return [profile()];
    },
    acquireTickLock: async () => null,
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  assert.equal(listCalls, 0);
});

test("trade monitor worker backs off transient database lock failures", async () => {
  let now = new Date("2026-04-24T14:33:00.000Z");
  let lockCalls = 0;
  const warnings: string[] = [];
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile()],
    acquireTickLock: async () => {
      lockCalls += 1;
      throw new Error("timeout exceeded when trying to connect");
    },
    now: () => now,
    logger: {
      debug: () => {},
      info: () => {},
      warn: (...args: unknown[]) => {
        warnings.push(String(args[1]));
      },
    },
  });

  await worker.runOnce();
  now = new Date("2026-04-24T14:33:30.000Z");
  await worker.runOnce();
  now = new Date("2026-04-24T14:34:01.000Z");
  await worker.runOnce();

  assert.equal(lockCalls, 2);
  assert.deepEqual(warnings, [
    "Signal monitor database unavailable; pausing worker ticks",
    "Signal monitor database unavailable; pausing worker ticks",
  ]);
});

test("trade monitor worker prevents concurrent evaluation of the same profile", async () => {
  let evaluateCalls = 0;
  let releaseEvaluation = () => {};
  const blockEvaluation = new Promise<void>((resolve) => {
    releaseEvaluation = resolve;
  });
  const options = {
    listProfiles: async () => [profile()],
    resolveUniverse: async (inputProfile: SignalMonitorProfileRow) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      await blockEvaluation;
      return symbolState({ symbol: input.symbol });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    now: () => new Date("2026-04-24T14:33:00.000Z"),
    logger: createNoopLogger(),
  };
  const firstWorker = createTradeMonitorWorker(options);
  const secondWorker = createTradeMonitorWorker(options);

  const firstRun = firstWorker.runOnce();
  await new Promise((resolve) => setImmediate(resolve));
  await secondWorker.runOnce();
  releaseEvaluation();
  await firstRun;

  assert.equal(evaluateCalls, 1);
});

test("trade monitor worker skips unchanged signal-bearing completed bars and reevaluates after config changes", async () => {
  let evaluateCalls = 0;
  let currentProfile = profile();
  let now = new Date("2026-04-24T14:33:00.000Z");
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [currentProfile],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({
        symbol: input.symbol,
        currentSignalDirection: "buy",
        currentSignalAt: new Date("2026-04-24T14:30:00.000Z"),
        barsSinceSignal: 0,
        fresh: true,
        lastEvaluatedAt: now,
      });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  now = new Date("2026-04-24T14:34:00.000Z");
  await worker.runOnce();
  currentProfile = profile({
    timeframe: "5m",
    updatedAt: new Date("2026-04-24T14:34:30.000Z"),
  });
  now = new Date("2026-04-24T14:35:00.000Z");
  await worker.runOnce();

  assert.equal(evaluateCalls, 2);
});

test("trade monitor worker rechecks unchanged no-signal bars after the poll interval", async () => {
  let evaluateCalls = 0;
  let now = new Date("2026-04-24T14:33:00.000Z");
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile({ pollIntervalSeconds: 15 })],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({
        symbol: input.symbol,
        currentSignalDirection: null,
        currentSignalAt: null,
        barsSinceSignal: null,
        fresh: false,
        lastEvaluatedAt: now,
      });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  now = new Date("2026-04-24T14:33:10.000Z");
  await worker.runOnce();
  now = new Date("2026-04-24T14:33:16.000Z");
  await worker.runOnce();

  assert.equal(evaluateCalls, 2);
});

test("trade monitor worker does not run REST-backed profile polls while stock streaming source activity is fresh", async () => {
  let loadCalls = 0;
  let evaluateCalls = 0;
  let subscribedSymbols: string[] = [];
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile({ pollIntervalSeconds: 15 })],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL", "MSFT"],
      watchlistSymbols: ["AAPL", "MSFT"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL", "MSFT"]),
    }),
    loadCompletedBars: async () => {
      loadCalls += 1;
      return {
        bars: [],
        latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
      };
    },
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({ symbol: input.symbol });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    isStockAggregateStreamingAvailable: () => true,
    hasRecentStockAggregateSourceActivity: () => true,
    acquireTickLock: async () => async () => {},
    subscribeStockMinuteAggregates: (symbols) => {
      subscribedSymbols = symbols;
      return {
        setSymbols(nextSymbols: string[]) {
          subscribedSymbols = nextSymbols;
        },
        unsubscribe() {
          subscribedSymbols = [];
        },
      };
    },
    now: () => new Date("2026-04-24T14:33:00.000Z"),
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  assert.deepEqual(subscribedSymbols, ["AAPL", "MSFT"]);
  assert.equal(loadCalls, 0);
  assert.equal(evaluateCalls, 0);
});

test("trade monitor worker falls back to history when stock streaming source activity is stale", async () => {
  let loadCalls = 0;
  let evaluateCalls = 0;
  let subscribedSymbols: string[] = [];
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile({ pollIntervalSeconds: 15 })],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL", "MSFT"],
      watchlistSymbols: ["AAPL", "MSFT"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL", "MSFT"]),
    }),
    loadCompletedBars: async () => {
      loadCalls += 1;
      return {
        bars: [],
        latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
      };
    },
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({ symbol: input.symbol });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    isStockAggregateStreamingAvailable: () => true,
    hasRecentStockAggregateSourceActivity: () => false,
    acquireTickLock: async () => async () => {},
    subscribeStockMinuteAggregates: (symbols) => {
      subscribedSymbols = symbols;
      return {
        setSymbols(nextSymbols: string[]) {
          subscribedSymbols = nextSymbols;
        },
        unsubscribe() {
          subscribedSymbols = [];
        },
      };
    },
    now: () => new Date("2026-04-24T14:33:00.000Z"),
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  assert.deepEqual(subscribedSymbols, ["AAPL", "MSFT"]);
  assert.equal(loadCalls, 2);
  assert.equal(evaluateCalls, 2);
});

test("trade monitor worker evaluates a streamed aggregate without waiting for the next poll", async () => {
  let evaluateCalls = 0;
  let currentLatestBarAt = new Date("2026-04-24T14:30:00.000Z");
  let subscribedSymbols: string[] = [];
  let streamCallback: ((message: any) => void) | null = null;
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile({ pollIntervalSeconds: 3600 })],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: currentLatestBarAt,
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({
        symbol: input.symbol,
        latestBarAt: currentLatestBarAt,
      });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    subscribeStockMinuteAggregates: (symbols, onAggregate) => {
      subscribedSymbols = symbols;
      streamCallback = onAggregate;
      return {
        setSymbols(nextSymbols: string[]) {
          subscribedSymbols = nextSymbols;
        },
        unsubscribe() {
          subscribedSymbols = [];
        },
      };
    },
    now: () => new Date("2026-04-24T14:33:00.000Z"),
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  assert.deepEqual(subscribedSymbols, ["AAPL"]);
  assert.equal(evaluateCalls, 1);
  assert.ok(streamCallback);

  currentLatestBarAt = new Date("2026-04-24T14:31:00.000Z");
  (streamCallback as (message: any) => void)(
    streamAggregate("AAPL", "2026-04-24T14:31:00.000Z"),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(evaluateCalls, 2);

  await worker.runOnce();
  assert.equal(evaluateCalls, 2);
});

test("trade monitor worker evaluates 5m streamed aggregates before the 5m bar closes", async () => {
  let evaluateCalls = 0;
  let currentLatestBarAt = new Date("2026-04-24T14:30:00.000Z");
  let now = new Date("2026-04-24T14:31:30.000Z");
  let streamCallback: ((message: any) => void) | null = null;
  const loadInputs: Array<{
    timeframe?: string;
    includeProvisionalLiveEdge?: boolean;
  }> = [];
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [
      profile({ timeframe: "5m", pollIntervalSeconds: 3600 }),
    ],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async (input) => {
      loadInputs.push(input);
      return {
        bars: [],
        latestBarAt: currentLatestBarAt,
      };
    },
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({
        symbol: input.symbol,
        timeframe: "5m",
        latestBarAt: currentLatestBarAt,
      });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    subscribeStockMinuteAggregates: (_symbols, onAggregate) => {
      streamCallback = onAggregate;
      return {
        setSymbols() {},
        unsubscribe() {},
      };
    },
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  assert.equal(evaluateCalls, 1);
  assert.ok(streamCallback);

  currentLatestBarAt = new Date("2026-04-24T14:31:30.000Z");
  now = new Date("2026-04-24T14:31:31.000Z");
  (streamCallback as (message: any) => void)(
    streamAggregate("AAPL", "2026-04-24T14:31:00.000Z"),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(evaluateCalls, 2);
  assert.equal(loadInputs.at(-1)?.timeframe, "5m");
  assert.equal(loadInputs.at(-1)?.includeProvisionalLiveEdge, true);
});

test("trade monitor worker batches simultaneous streamed aggregates behind one lock", async () => {
  const evaluatedSymbols: string[] = [];
  let currentLatestBarAt = new Date("2026-04-24T14:30:00.000Z");
  let lockCalls = 0;
  let streamCallback: ((message: any) => void) | null = null;
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile({ pollIntervalSeconds: 3600 })],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL", "MSFT"],
      watchlistSymbols: ["AAPL", "MSFT"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL", "MSFT"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: currentLatestBarAt,
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluatedSymbols.push(input.symbol);
      return symbolState({
        symbol: input.symbol,
        latestBarAt: currentLatestBarAt,
      });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => {
      lockCalls += 1;
      return async () => {};
    },
    subscribeStockMinuteAggregates: (_symbols, onAggregate) => {
      streamCallback = onAggregate;
      return {
        setSymbols() {},
        unsubscribe() {},
      };
    },
    now: () => new Date("2026-04-24T14:33:00.000Z"),
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  assert.ok(streamCallback);
  evaluatedSymbols.length = 0;
  lockCalls = 0;
  currentLatestBarAt = new Date("2026-04-24T14:31:00.000Z");

  (streamCallback as (message: any) => void)(
    streamAggregate("AAPL", "2026-04-24T14:31:00.000Z"),
  );
  (streamCallback as (message: any) => void)(
    streamAggregate("MSFT", "2026-04-24T14:31:00.000Z"),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.deepEqual(evaluatedSymbols.sort(), ["AAPL", "MSFT"]);
  assert.equal(lockCalls, 1);
});

test("trade monitor worker rotates across all watchlist symbols under the per-pass cap", async () => {
  const evaluatedSymbols: string[] = [];
  let now = new Date("2026-04-24T14:33:00.000Z");
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile({ maxSymbols: 2 })],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL", "MSFT"],
      watchlistSymbols: ["AAPL", "MSFT", "NVDA", "TSLA"],
      skippedSymbols: ["NVDA", "TSLA"],
      truncated: true,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL", "MSFT"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluatedSymbols.push(input.symbol);
      return symbolState({ symbol: input.symbol, lastEvaluatedAt: now });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  now = new Date("2026-04-24T14:33:05.000Z");
  await worker.runOnce();

  assert.deepEqual(evaluatedSymbols, ["AAPL", "MSFT", "NVDA", "TSLA"]);
});

test("trade monitor worker retries errored same-bar evaluations after a cooldown", async () => {
  let evaluateCalls = 0;
  let now = new Date("2026-04-24T14:33:00.000Z");
  let nextStatus = "error";
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile()],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({
        symbol: input.symbol,
        status: nextStatus,
        currentSignalDirection: nextStatus === "ok" ? "buy" : null,
        currentSignalAt:
          nextStatus === "ok"
            ? new Date("2026-04-24T14:30:00.000Z")
            : null,
        barsSinceSignal: nextStatus === "ok" ? 0 : null,
        fresh: nextStatus === "ok",
        lastError: nextStatus === "error" ? "temporary history failure" : null,
      });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  nextStatus = "ok";
  now = new Date("2026-04-24T14:33:30.000Z");
  await worker.runOnce();
  now = new Date("2026-04-24T14:34:01.000Z");
  await worker.runOnce();
  now = new Date("2026-04-24T14:35:00.000Z");
  await worker.runOnce();

  assert.equal(evaluateCalls, 2);
});

test("trade monitor worker retries stale same-bar evaluations on the next poll", async () => {
  let evaluateCalls = 0;
  let now = new Date("2026-04-24T14:33:00.000Z");
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile({ pollIntervalSeconds: 15 })],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({
        symbol: input.symbol,
        status: "stale",
        latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
        lastError: "Latest signal monitor bar is delayed.",
      });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    now: () => now,
    logger: createNoopLogger(),
  });

  await worker.runOnce();
  now = new Date("2026-04-24T14:33:10.000Z");
  await worker.runOnce();
  now = new Date("2026-04-24T14:33:16.000Z");
  await worker.runOnce();

  assert.equal(evaluateCalls, 2);
});

test("trade monitor worker ignores symbols without a latest completed bar", async () => {
  let evaluateCalls = 0;
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile()],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      watchlistSymbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
      universe: signalMonitorTestUniverse(inputProfile, ["AAPL"]),
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: null,
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
      return symbolState({ symbol: input.symbol });
    },
    updateProfileEvaluationMetadata: async (input: {
      profile: SignalMonitorProfileRow;
    }) => input.profile,
    updateProfileLastError: async () => {},
    acquireTickLock: async () => async () => {},
    now: () => new Date("2026-04-24T14:33:00.000Z"),
    logger: createNoopLogger(),
  });

  await worker.runOnce();

  assert.equal(evaluateCalls, 0);
});

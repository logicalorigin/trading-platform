import assert from "node:assert/strict";
import test from "node:test";
import type { SignalMonitorSymbolState } from "@workspace/db";
import type { SignalMonitorProfileRow } from "./signal-monitor";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

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
    rayReplicaSettings: {},
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

test("signal monitor completed-bar rules exclude active bars", () => {
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-24T14:30:00.000Z"),
      timeframe: "1m",
      evaluatedAt: new Date("2026-04-24T14:31:01.999Z"),
    }),
    false,
  );
  assert.equal(
    isSignalMonitorBarComplete({
      timestamp: new Date("2026-04-24T14:30:00.000Z"),
      timeframe: "1m",
      evaluatedAt: new Date("2026-04-24T14:31:02.000Z"),
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
      skippedSymbols: [],
      truncated: false,
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

test("trade monitor worker skips unchanged completed bars and reevaluates after config changes", async () => {
  let evaluateCalls = 0;
  let currentProfile = profile();
  let now = new Date("2026-04-24T14:33:00.000Z");
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [currentProfile],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
    }),
    loadCompletedBars: async () => ({
      bars: [],
      latestBarAt: new Date("2026-04-24T14:30:00.000Z"),
    }),
    evaluateSymbolFromCompletedBars: async (input: { symbol: string }) => {
      evaluateCalls += 1;
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

test("trade monitor worker retries errored same-bar evaluations after a cooldown", async () => {
  let evaluateCalls = 0;
  let now = new Date("2026-04-24T14:33:00.000Z");
  let nextStatus = "error";
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile()],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
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

test("trade monitor worker ignores symbols without a latest completed bar", async () => {
  let evaluateCalls = 0;
  const worker = createTradeMonitorWorker({
    listProfiles: async () => [profile()],
    resolveUniverse: async (inputProfile) => ({
      profile: inputProfile,
      symbols: ["AAPL"],
      skippedSymbols: [],
      truncated: false,
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

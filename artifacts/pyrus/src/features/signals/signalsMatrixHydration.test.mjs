import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalsHydrationManifest,
  buildSignalsMatrixHydrationPlan,
  buildSignalsPriorityHydrationSymbols,
  prioritizeSignalMatrixTimeframes,
} from "./signalsMatrixHydration.js";

const hydratedState = (symbol, timeframe) => ({
  symbol,
  timeframe,
  active: true,
  latestBarAt: "2026-06-05T14:30:00.000Z",
  lastEvaluatedAt: "2026-06-05T14:31:00.000Z",
  status: "ok",
});

test("Signals matrix hydration scope stays anchored to the supplied universe", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["MSFT", "AAPL"],
    prioritySymbols: ["TSLA", "AAPL"],
    timeframes: ["1m", "5m"],
    chunkSize: 1,
    priorityChunkSize: 1,
  });

  assert.deepEqual(plan.symbols, ["MSFT", "AAPL"]);
  assert.equal(plan.totalCellCount, 4);
  assert.deepEqual(plan.priorityMissingSymbols, ["AAPL"]);
  assert.deepEqual(plan.requestSymbols, ["AAPL"]);
});

test("Signals matrix hydration falls back to manifest order after priority is covered", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["MSFT", "AAPL", "NVDA"],
    prioritySymbols: ["AAPL"],
    currentStates: [hydratedState("AAPL", "1m"), hydratedState("AAPL", "5m")],
    timeframes: ["1m", "5m"],
    chunkSize: 1,
    priorityChunkSize: 1,
  });

  assert.deepEqual(plan.symbols, ["MSFT", "AAPL", "NVDA"]);
  assert.deepEqual(plan.priorityMissingSymbols, []);
  assert.deepEqual(plan.requestSymbols, ["MSFT"]);
  assert.deepEqual(plan.requestCells, [
    { symbol: "MSFT", timeframe: "1m" },
    { symbol: "MSFT", timeframe: "5m" },
  ]);
  assert.deepEqual(plan.timeframeHydration, [
    { timeframe: "1m", hydrated: 1, aged: 0, missing: 2, requested: 1, total: 3 },
    { timeframe: "5m", hydrated: 1, aged: 0, missing: 2, requested: 1, total: 3 },
  ]);
});

test("Signals matrix hydration treats aged bars as hydrated and unavailable diagnostics as missing", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["AAPL", "MSFT"],
    currentStates: [
      hydratedState("AAPL", "1m"),
      {
        ...hydratedState("AAPL", "5m"),
        status: "stale",
      },
      {
        symbol: "MSFT",
        timeframe: "1m",
        active: true,
        status: "unavailable",
        latestBarAt: null,
        currentSignalAt: null,
        lastEvaluatedAt: "2026-06-05T14:31:00.000Z",
        lastError: "No broker history bars were available for this symbol.",
      },
    ],
    timeframes: ["1m", "5m"],
  });

  assert.equal(plan.hydratedCellCount, 2);
  assert.equal(plan.missingCellCount, 2);
  assert.deepEqual(plan.timeframeHydration, [
    { timeframe: "1m", hydrated: 1, aged: 0, missing: 1, requested: 1, total: 2 },
    { timeframe: "5m", hydrated: 1, aged: 1, missing: 1, requested: 1, total: 2 },
  ]);
});

test("Signals matrix hydration treats idle cells as covered, not awaiting data", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["SPY"],
    currentStates: [
      {
        ...hydratedState("SPY", "5m"),
        status: "idle",
      },
    ],
    timeframes: ["5m"],
  });

  assert.equal(plan.hydratedCellCount, 1);
  assert.equal(plan.missingCellCount, 0);
  assert.deepEqual(plan.timeframeHydration, [
    { timeframe: "5m", hydrated: 1, aged: 0, missing: 0, requested: 0, total: 1 },
  ]);
});

test("Signals matrix hydration can refresh stale cells for active algo surfaces", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["MRVL"],
    currentStates: [
      {
        ...hydratedState("MRVL", "2m"),
        status: "stale",
      },
      {
        ...hydratedState("MRVL", "5m"),
        status: "ok",
      },
      {
        ...hydratedState("MRVL", "15m"),
        status: "stale",
      },
    ],
    timeframes: ["2m", "5m", "15m"],
    refreshStale: true,
  });

  assert.deepEqual(plan.requestCells, [
    { symbol: "MRVL", timeframe: "2m" },
    { symbol: "MRVL", timeframe: "15m" },
  ]);
  assert.deepEqual(plan.requestTimeframes, ["2m", "15m"]);
});

test("Signals matrix hydration can prioritize the execution timeframe", () => {
  assert.deepEqual(
    prioritizeSignalMatrixTimeframes(["2m", "5m", "15m"], ["5m"]),
    ["5m", "2m", "15m"],
  );
  assert.deepEqual(
    prioritizeSignalMatrixTimeframes(["2m", "5m", "15m"], ["2m"]),
    ["2m", "5m", "15m"],
  );
});

test("Signals matrix hydration preserves explicit priority order without reordering scope", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["MSFT", "AAPL", "NVDA"],
    prioritySymbols: ["NVDA", "AAPL"],
    timeframes: ["1m", "5m"],
    chunkSize: 1,
    priorityChunkSize: 1,
  });

  assert.deepEqual(plan.symbols, ["MSFT", "AAPL", "NVDA"]);
  assert.deepEqual(plan.priorityMissingSymbols, ["NVDA", "AAPL"]);
  assert.deepEqual(plan.requestSymbols, ["NVDA"]);
});

test("Signals hydration manifest keeps prior symbols when a later source shrinks", () => {
  const manifest = buildSignalsHydrationManifest({
    currentSymbols: ["SPY", "NVDA", "AAPL"],
    nextSymbols: ["AAPL", "MSFT"],
  });

  assert.deepEqual(manifest, ["SPY", "NVDA", "AAPL", "MSFT"]);
});

test("Signals hydration manifest resets for a new scope", () => {
  const manifest = buildSignalsHydrationManifest({
    currentSymbols: ["SPY", "NVDA", "AAPL"],
    nextSymbols: ["MSFT", "AAPL"],
    reset: true,
  });

  assert.deepEqual(manifest, ["MSFT", "AAPL"]);
});

test("Signals priority hydration follows current rows within the broad universe", () => {
  const symbols = buildSignalsPriorityHydrationSymbols({
    selectedSymbol: "arm",
    expandedSymbol: "spy",
    candidateSymbols: ["OUST", "ARM", "BLUESTARC", "QQQ"],
    scopeSymbols: ["OUST", "ARM", "SPY", "QQQ"],
  });

  assert.deepEqual(symbols, ["ARM", "SPY", "OUST", "QQQ"]);
});

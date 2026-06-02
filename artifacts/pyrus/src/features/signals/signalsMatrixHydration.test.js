import assert from "node:assert/strict";
import test from "node:test";
import {
  SIGNALS_MATRIX_HYDRATION_CHUNK_SIZE,
  SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE,
  buildSignalsMatrixHydrationPlan,
} from "./signalsMatrixHydration.js";

const state = (symbol, timeframe, patch = {}) => ({
  id: `${symbol}-${timeframe}`,
  symbol,
  timeframe,
  status: patch.status || "ok",
  latestBarAt: patch.latestBarAt ?? "2026-05-31T14:30:00.000Z",
  lastEvaluatedAt: patch.lastEvaluatedAt ?? "2026-05-31T14:31:00.000Z",
  lastError: patch.lastError ?? null,
});

test("signals matrix hydration requests all missing interval states by default", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["spy", "AAPL", "MSFT", "NVDA", "SPY"],
    currentStates: [
      state("SPY", "1m"),
      state("SPY", "2m"),
      state("SPY", "5m"),
      state("SPY", "15m"),
      state("SPY", "1h"),
      state("AAPL", "1m"),
    ],
  });

  assert.equal(plan.chunkSize, SIGNALS_MATRIX_HYDRATION_CHUNK_SIZE);
  assert.equal(plan.priorityChunkSize, SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE);
  assert.deepEqual(plan.hydratedSymbols, ["SPY"]);
  assert.deepEqual(plan.missingSymbols, ["AAPL", "MSFT", "NVDA"]);
  assert.deepEqual(plan.priorityMissingSymbols, []);
  assert.deepEqual(plan.requestSymbols, ["AAPL", "MSFT", "NVDA"]);
});

test("signals matrix hydration only chunks when explicitly requested", () => {
  const symbols = Array.from({ length: 8 }, (_, index) => `SYM${index + 1}`);
  const plan = buildSignalsMatrixHydrationPlan({
    symbols,
    currentStates: [],
    chunkSize: 3,
  });

  assert.equal(plan.chunkSize, 3);
  assert.equal(plan.priorityChunkSize, null);
  assert.deepEqual(plan.missingSymbols, symbols);
  assert.deepEqual(plan.requestSymbols, ["SYM1", "SYM2", "SYM3"]);
});

test("signals matrix hydration treats completed error cells as hydrated for the current pass", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["AMD"],
    currentStates: [
      state("AMD", "1m", { status: "error", latestBarAt: null, lastError: "provider unavailable" }),
      state("AMD", "2m"),
      state("AMD", "5m"),
      state("AMD", "15m"),
      state("AMD", "1h"),
    ],
    chunkSize: 2,
  });

  assert.deepEqual(plan.hydratedSymbols, ["AMD"]);
  assert.deepEqual(plan.missingSymbols, []);
  assert.deepEqual(plan.priorityMissingSymbols, []);
  assert.deepEqual(plan.requestSymbols, []);
});

test("signals matrix hydration prioritizes visible rows without dropping background rows", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: [
      "AAPL",
      "MSFT",
      "NVDA",
      "PLTR",
      "IONQ",
      "TSLA",
      "META",
      "AMZN",
      "GOOGL",
      "AMD",
      "AVGO",
      "QQQ",
      "SPY",
      "SMH",
    ],
    prioritySymbols: [
      "pltr",
      "MSFT",
      "NVDA",
      "IONQ",
      "TSLA",
      "META",
      "AMZN",
      "GOOGL",
      "AMD",
      "AVGO",
      "QQQ",
      "SPY",
      "SMH",
    ],
    currentStates: [],
  });

  assert.equal(plan.priorityChunkSize, SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE);
  assert.deepEqual(plan.symbols, [
    "PLTR",
    "MSFT",
    "NVDA",
    "IONQ",
    "TSLA",
    "META",
    "AMZN",
    "GOOGL",
    "AMD",
    "AVGO",
    "QQQ",
    "SPY",
    "SMH",
    "AAPL",
  ]);
  assert.deepEqual(plan.priorityMissingSymbols, [
    "PLTR",
    "MSFT",
    "NVDA",
    "IONQ",
    "TSLA",
    "META",
    "AMZN",
    "GOOGL",
    "AMD",
    "AVGO",
    "QQQ",
    "SPY",
    "SMH",
  ]);
  assert.deepEqual(plan.missingSymbols, [
    "PLTR",
    "MSFT",
    "NVDA",
    "IONQ",
    "TSLA",
    "META",
    "AMZN",
    "GOOGL",
    "AMD",
    "AVGO",
    "QQQ",
    "SPY",
    "SMH",
    "AAPL",
  ]);
  assert.deepEqual(plan.requestSymbols, [
    "PLTR",
    "MSFT",
    "NVDA",
    "IONQ",
    "TSLA",
    "META",
    "AMZN",
    "GOOGL",
    "AMD",
    "AVGO",
    "QQQ",
    "SPY",
    "SMH",
    "AAPL",
  ]);
});

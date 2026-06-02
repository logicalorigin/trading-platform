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

test("signals matrix hydration requests missing timeframe intent by default", () => {
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
  assert.equal(
    plan.priorityChunkSize,
    SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE,
  );
  assert.deepEqual(plan.hydratedSymbols, ["SPY"]);
  assert.deepEqual(plan.missingSymbols, ["AAPL", "MSFT", "NVDA"]);
  assert.equal(plan.totalCellCount, 20);
  assert.equal(plan.hydratedCellCount, 6);
  assert.equal(plan.missingCellCount, 14);
  assert.deepEqual(plan.hydratedTimeframesBySymbol.AAPL, ["1m"]);
  assert.deepEqual(plan.missingTimeframesBySymbol.AAPL, ["2m", "5m", "15m", "1h"]);
  assert.deepEqual(plan.priorityMissingSymbols, []);
  assert.deepEqual(plan.requestSymbols, ["AAPL", "MSFT", "NVDA"]);
  assert.deepEqual(plan.requestTimeframes, ["2m", "5m", "15m", "1h", "1m"]);
  assert.equal(plan.requestCells.length, 14);
  assert.deepEqual(
    plan.requestCells.filter((cell) => cell.symbol === "AAPL"),
    [
      { symbol: "AAPL", timeframe: "2m" },
      { symbol: "AAPL", timeframe: "5m" },
      { symbol: "AAPL", timeframe: "15m" },
      { symbol: "AAPL", timeframe: "1h" },
    ],
  );
});

test("signals matrix hydration honors an explicit background chunk size", () => {
  const symbols = Array.from({ length: 8 }, (_, index) => `SYM${index + 1}`);
  const plan = buildSignalsMatrixHydrationPlan({
    symbols,
    currentStates: [],
    chunkSize: 3,
  });

  assert.equal(plan.chunkSize, 3);
  assert.equal(
    plan.priorityChunkSize,
    SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE,
  );
  assert.deepEqual(plan.missingSymbols, symbols);
  assert.deepEqual(plan.requestSymbols, ["SYM1", "SYM2", "SYM3"]);
  assert.deepEqual(plan.requestTimeframes, ["1m", "2m", "5m", "15m", "1h"]);
  assert.equal(plan.missingCellCount, 40);
  assert.equal(plan.requestCells.length, 15);
});

test("signals matrix hydration keeps error cells missing so they can retry", () => {
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

  assert.deepEqual(plan.hydratedSymbols, []);
  assert.deepEqual(plan.missingSymbols, ["AMD"]);
  assert.equal(plan.hydratedCellCount, 4);
  assert.equal(plan.missingCellCount, 1);
  assert.deepEqual(plan.missingTimeframesBySymbol.AMD, ["1m"]);
  assert.deepEqual(plan.priorityMissingSymbols, []);
  assert.deepEqual(plan.requestSymbols, ["AMD"]);
  assert.deepEqual(plan.requestTimeframes, ["1m"]);
  assert.deepEqual(plan.requestCells, [{ symbol: "AMD", timeframe: "1m" }]);
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

  assert.equal(
    plan.priorityChunkSize,
    SIGNALS_MATRIX_HYDRATION_PRIORITY_CHUNK_SIZE,
  );
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
  assert.deepEqual(
    plan.requestSymbols,
    [
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
    ],
  );
  assert.deepEqual(plan.requestTimeframes, ["1m", "2m", "5m", "15m", "1h"]);
  assert.equal(plan.requestCells.length, 65);
  assert.equal(plan.missingCellCount, 70);
});

test("signals matrix hydration honors an explicit priority chunk size", () => {
  const prioritySymbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"];
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: [...prioritySymbols, "TSLA"],
    prioritySymbols,
    currentStates: [],
    chunkSize: 2,
    priorityChunkSize: 3,
  });

  assert.equal(plan.chunkSize, 2);
  assert.equal(plan.priorityChunkSize, 3);
  assert.deepEqual(plan.priorityMissingSymbols, prioritySymbols);
  assert.deepEqual(plan.requestSymbols, ["SPY", "QQQ", "AAPL"]);
  assert.deepEqual(plan.requestTimeframes, ["1m", "2m", "5m", "15m", "1h"]);
  assert.equal(plan.requestCells.length, 15);
});

test("signals matrix hydration finishes priority rows before background rows", () => {
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["AAPL", "SPY", "QQQ"],
    prioritySymbols: ["SPY", "QQQ"],
    currentStates: [state("SPY", "1m"), state("QQQ", "1m")],
  });

  assert.deepEqual(plan.missingSymbols, ["SPY", "QQQ", "AAPL"]);
  assert.deepEqual(plan.priorityMissingSymbols, ["SPY", "QQQ"]);
  assert.deepEqual(plan.requestSymbols, ["SPY", "QQQ"]);
  assert.deepEqual(plan.requestTimeframes, ["2m", "5m", "15m", "1h"]);
  assert.equal(plan.requestCells.length, 8);
});

test("signals matrix hydration resumes background rows after priority rows complete", () => {
  const priorityStates = ["1m", "2m", "5m", "15m", "1h"].flatMap(
    (timeframe) => [state("SPY", timeframe), state("QQQ", timeframe)],
  );
  const plan = buildSignalsMatrixHydrationPlan({
    symbols: ["AAPL", "SPY", "QQQ"],
    prioritySymbols: ["SPY", "QQQ"],
    currentStates: priorityStates,
  });

  assert.deepEqual(plan.hydratedSymbols, ["SPY", "QQQ"]);
  assert.deepEqual(plan.missingSymbols, ["AAPL"]);
  assert.deepEqual(plan.priorityMissingSymbols, []);
  assert.deepEqual(plan.requestSymbols, ["AAPL"]);
  assert.deepEqual(plan.requestTimeframes, ["1m", "2m", "5m", "15m", "1h"]);
});

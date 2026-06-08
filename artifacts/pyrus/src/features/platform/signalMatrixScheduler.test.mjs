import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMatrixExactRequestPlan,
  buildSignalMatrixRequestPlan,
  buildSignalMatrixStoredStateBootstrapRequest,
  resolveSignalMatrixActiveScreenRequestTaskLimit,
  resolveSignalMatrixExactCellLimit,
} from "./signalMatrixScheduler.js";

const sixTimeframes = ["1m", "2m", "5m", "15m", "1h", "1d"];
const symbols = Array.from({ length: 30 }, (_value, index) => `T${index + 1}`);

test("active signal matrix requests are bounded by pressure", () => {
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("normal"), 480);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("watch"), 240);
  assert.equal(resolveSignalMatrixActiveScreenRequestTaskLimit("high"), 120);
  assert.equal(resolveSignalMatrixExactCellLimit("normal"), 480);
  assert.equal(resolveSignalMatrixExactCellLimit("watch"), 240);
  assert.equal(resolveSignalMatrixExactCellLimit("high"), 120);
});

test("matrix request planning chunks the supplied scope", () => {
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    currentStates: [],
    timeframes: sixTimeframes,
    pressureLevel: "high",
    backgroundReady: true,
    requestTaskLimit: resolveSignalMatrixActiveScreenRequestTaskLimit("high"),
    requestExactCellLimit: resolveSignalMatrixExactCellLimit("high"),
  });

  assert.equal(plan.requestCells.length, 120);
  assert.equal(plan.coverage.requestTaskLimit, 120);
  assert.equal(plan.coverage.queuedTaskCount, 60);
});

test("exact matrix request planning preserves supplied cells", () => {
  const plan = buildSignalMatrixExactRequestPlan({
    symbols: ["AAPL", "MSFT", "NVDA"],
    prioritySymbols: ["MSFT", "AAPL"],
    cells: [
      { symbol: "msft", timeframe: "1m" },
      { symbol: "MSFT", timeframe: "1m" },
      { symbol: "AAPL", timeframe: "5m" },
      { symbol: "NVDA", timeframe: "1d" },
      { symbol: "TSLA", timeframe: "1m" },
      { symbol: "AAPL", timeframe: "bad" },
    ],
    timeframes: sixTimeframes,
    requestSymbolLimit: 2,
  });

  assert.deepEqual(plan.requestCells, [
    { symbol: "MSFT", timeframe: "1m" },
    { symbol: "AAPL", timeframe: "5m" },
  ]);
  assert.deepEqual(plan.requestSymbols, ["MSFT", "AAPL"]);
  assert.deepEqual(plan.timeframes, ["1m", "5m"]);
  assert.equal(plan.coverage.exactCellRequest, true);
  assert.equal(plan.coverage.requestTaskCount, 2);
  assert.equal(plan.coverage.queuedTaskCount, 1);
});

test("exact matrix request planning respects cell limits", () => {
  const cells = symbols.flatMap((symbol) =>
    sixTimeframes.map((timeframe) => ({ symbol, timeframe })),
  );
  const plan = buildSignalMatrixExactRequestPlan({
    symbols,
    prioritySymbols: symbols,
    cells,
    timeframes: sixTimeframes,
    requestExactCellLimit: resolveSignalMatrixExactCellLimit("high"),
  });

  assert.equal(plan.requestCells.length, 120);
  assert.equal(plan.coverage.requestTaskCount, 120);
  assert.equal(plan.coverage.queuedTaskCount, 60);
});

test("stored-state bootstrap plans broad coverage without exact cells", () => {
  const plan = buildSignalMatrixStoredStateBootstrapRequest({
    symbols,
    currentStates: [],
    timeframes: sixTimeframes,
  });

  assert.deepEqual(plan.symbols, symbols);
  assert.deepEqual(plan.timeframes, sixTimeframes);
  assert.equal(plan.coverage.storedStateBootstrap, true);
  assert.equal(plan.coverage.requestTaskCount, symbols.length * sixTimeframes.length);
  assert.equal(plan.coverage.missingTaskCount, symbols.length * sixTimeframes.length);
});

test("stored-state bootstrap key is stable across symbol ordering changes", () => {
  const plan = buildSignalMatrixStoredStateBootstrapRequest({
    symbols: ["MSFT", "AAPL", "NVDA"],
    currentStates: [],
    timeframes: sixTimeframes,
  });

  assert.ok(plan);
  const reorderedPlan = buildSignalMatrixStoredStateBootstrapRequest({
    symbols: ["NVDA", "MSFT", "AAPL"],
    currentStates: [],
    timeframes: sixTimeframes,
    lastBootstrapKey: plan.key,
  });

  assert.equal(reorderedPlan, null);
});

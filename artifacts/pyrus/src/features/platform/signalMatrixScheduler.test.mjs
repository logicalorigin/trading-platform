import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalMatrixRequestPlan,
  buildSignalMatrixStoredStateBootstrapRequest,
  resolveSignalMatrixStaVisiblePageExactCellLimit,
  resolveSignalMatrixStaVisiblePageRequestTaskLimit,
} from "./signalMatrixScheduler.js";

const sixTimeframes = ["1m", "2m", "5m", "15m", "1h", "1d"];
const symbols = Array.from({ length: 30 }, (_value, index) => `T${index + 1}`);

test("STA visible-page matrix request uses bounded task and exact-cell limits", () => {
  assert.equal(resolveSignalMatrixStaVisiblePageRequestTaskLimit("normal"), 6);
  assert.equal(resolveSignalMatrixStaVisiblePageRequestTaskLimit("watch"), 6);
  assert.equal(resolveSignalMatrixStaVisiblePageRequestTaskLimit("high"), 3);
  assert.equal(resolveSignalMatrixStaVisiblePageExactCellLimit("normal"), 6);
  assert.equal(resolveSignalMatrixStaVisiblePageExactCellLimit("watch"), 6);
  assert.equal(resolveSignalMatrixStaVisiblePageExactCellLimit("high"), 3);
});

test("matrix request planning respects the STA visible-page task cap", () => {
  const requestTaskLimit = resolveSignalMatrixStaVisiblePageRequestTaskLimit("watch");
  const plan = buildSignalMatrixRequestPlan({
    symbols,
    prioritySymbols: symbols,
    currentStates: [],
    timeframes: sixTimeframes,
    pressureLevel: "watch",
    backgroundReady: true,
    requestTaskLimit,
    requestExactCellLimit: resolveSignalMatrixStaVisiblePageExactCellLimit("watch"),
  });

  assert.equal(plan.requestCells.length, requestTaskLimit);
  assert.equal(plan.coverage.requestTaskLimit, requestTaskLimit);
  assert.ok(plan.coverage.queuedTaskCount > 0);
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

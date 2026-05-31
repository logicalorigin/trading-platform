import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBacktestExecutionMode,
  shouldRankWalkForwardCandidatesWithSharedCore,
  shouldRunOptionsBacktest,
} from "./backtest-execution";

test("resolveBacktestExecutionMode normalizes supported execution modes", () => {
  assert.equal(resolveBacktestExecutionMode({}), "spot");
  assert.equal(resolveBacktestExecutionMode({ executionMode: "spot" }), "spot");
  assert.equal(resolveBacktestExecutionMode({ executionMode: "options" }), "options");
  assert.equal(
    resolveBacktestExecutionMode({ executionMode: "signal_options" }),
    "signal_options",
  );
  assert.equal(resolveBacktestExecutionMode({ executionMode: "unsupported" }), "spot");
});

test("shouldRunOptionsBacktest only routes Pyrus Signals option modes to the worker", () => {
  assert.equal(
    shouldRunOptionsBacktest({
      strategyId: "pyrus_signals",
      parameters: { executionMode: "options" },
    }),
    true,
  );
  assert.equal(
    shouldRunOptionsBacktest({
      strategyId: "pyrus_signals",
      parameters: { executionMode: "signal_options" },
    }),
    true,
  );
  assert.equal(
    shouldRunOptionsBacktest({
      strategyId: "pyrus_signals",
      parameters: { executionMode: "spot" },
    }),
    false,
  );
  assert.equal(
    shouldRunOptionsBacktest({
      strategyId: "sma_crossover",
      parameters: { executionMode: "options" },
    }),
    false,
  );
});

test("walk-forward candidate ranking remains limited to spot execution", () => {
  assert.equal(
    shouldRankWalkForwardCandidatesWithSharedCore({
      sweepMode: "walk_forward",
      windowsCount: 2,
      parameters: {},
    }),
    true,
  );
  assert.equal(
    shouldRankWalkForwardCandidatesWithSharedCore({
      sweepMode: "walk_forward",
      windowsCount: 2,
      parameters: { executionMode: "options" },
    }),
    false,
  );
  assert.equal(
    shouldRankWalkForwardCandidatesWithSharedCore({
      sweepMode: "walk_forward",
      windowsCount: 2,
      parameters: { executionMode: "signal_options" },
    }),
    false,
  );
  assert.equal(
    shouldRankWalkForwardCandidatesWithSharedCore({
      sweepMode: "grid",
      windowsCount: 2,
      parameters: {},
    }),
    false,
  );
  assert.equal(
    shouldRankWalkForwardCandidatesWithSharedCore({
      sweepMode: "walk_forward",
      windowsCount: 0,
      parameters: {},
    }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { shouldPollBacktestRun } from "./backtestPolling";

test("polls only while a backtest run can still change", () => {
  for (const status of [
    undefined,
    "queued",
    "preparing_data",
    "running",
    "aggregating",
    "cancel_requested",
  ] as const) {
    assert.equal(shouldPollBacktestRun(status), true, status);
  }

  for (const status of ["completed", "failed", "canceled"] as const) {
    assert.equal(shouldPollBacktestRun(status), false, status);
  }
});

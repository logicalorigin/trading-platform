import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldPollBacktestCollection,
  shouldPollBacktestRun,
} from "./backtestPolling";

test("polls only while a backtest run can still change", () => {
  for (const status of [
    undefined,
    "queued",
    "preparing_data",
    "running",
    "aggregating",
    "cancel_requested",
    "provider_waiting",
  ] as const) {
    assert.equal(shouldPollBacktestRun(status), true, status);
  }

  for (const status of ["completed", "failed", "canceled"] as const) {
    assert.equal(shouldPollBacktestRun(status), false, status);
  }
});

test("polls collections only before data arrives or while an item can change", () => {
  assert.equal(shouldPollBacktestCollection(undefined), true);
  assert.equal(shouldPollBacktestCollection([]), false);
  assert.equal(
    shouldPollBacktestCollection([
      { status: "completed" },
      { status: "failed" },
      { status: "canceled" },
    ]),
    false,
  );
  assert.equal(
    shouldPollBacktestCollection([
      { status: "completed" },
      { status: "cancel_requested" },
    ]),
    true,
  );
});

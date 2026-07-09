import assert from "node:assert/strict";
import { after, test } from "node:test";

import { pool } from "@workspace/db";

import { __backtestingInternalsForTests } from "./backtesting";

after(async () => {
  await pool.end();
});

test("loads one point series when latest and best are the same run", async () => {
  const calls: string[] = [];
  const loadPoints = async (runId: string) => {
    calls.push(runId);
    return [];
  };

  const result = await __backtestingInternalsForTests.loadPreviewSeries(
    "run-1",
    "run-1",
    loadPoints,
  );

  assert.deepEqual(calls, ["run-1"]);
  assert.strictEqual(result.latestSeries, result.bestSeries);
});

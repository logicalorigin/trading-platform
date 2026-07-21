import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { HttpError } from "../lib/errors";
import {
  __resetWorkGovernorForTests,
  getWorkGovernorSnapshot,
  recordWorkFailure,
  runGovernedWork,
  setWorkGovernorTimingListener,
  type WorkGovernorTiming,
} from "./work-governor";

const previousAccountConcurrency =
  process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"];

afterEach(() => {
  setWorkGovernorTimingListener(null);
  __resetWorkGovernorForTests();
  if (previousAccountConcurrency === undefined) {
    delete process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"];
  } else {
    process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"] =
      previousAccountConcurrency;
  }
});

test("governed work separates queue wait from execution time", async () => {
  process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"] = "1";
  const samples: WorkGovernorTiming[] = [];
  setWorkGovernorTimingListener((sample) => samples.push(sample));

  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = runGovernedWork(
    "account",
    async () => {
      markFirstStarted();
      await firstBlocked;
    },
    { operation: "accounts" },
  );
  await firstStarted;

  const second = runGovernedWork(
    "account",
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "done";
    },
    { operation: "positions" },
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(getWorkGovernorSnapshot().account.queued, 1);

  releaseFirst();
  assert.equal(await second, "done");
  await first;

  const sample = samples.find(
    (candidate) => candidate.operation === "positions",
  );
  assert.ok(sample);
  assert.equal(sample.category, "account");
  assert.equal(sample.outcome, "success");
  assert.equal(sample.queued, true);
  assert.ok(sample.queueWaitMs > 0);
  assert.ok(sample.executionDurationMs > 0);
  assert.ok(sample.totalDurationMs >= sample.queueWaitMs);
});

test("canceling queued work records no execution and releases queue state", async () => {
  process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"] = "1";
  const samples: WorkGovernorTiming[] = [];
  setWorkGovernorTimingListener((sample) => samples.push(sample));

  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const first = runGovernedWork("account", async () => {
    markFirstStarted();
    await firstBlocked;
  });
  await firstStarted;

  const controller = new AbortController();
  const canceled = runGovernedWork("account", async () => "unexpected", {
    operation: "positions",
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort(new Error("test cancellation"));
  await assert.rejects(canceled, /test cancellation/);

  const sample = samples.find(
    (candidate) => candidate.operation === "positions",
  );
  assert.ok(sample);
  assert.equal(sample.outcome, "canceled");
  assert.equal(sample.queued, true);
  assert.equal(sample.executionDurationMs, 0);
  assert.equal(getWorkGovernorSnapshot().account.queued, 0);

  releaseFirst();
  await first;
  assert.equal(getWorkGovernorSnapshot().account.active, 0);
});

test("governor snapshots retain an error code, not raw upstream text", () => {
  const sensitiveMessage = "customer-specific upstream failure detail";
  recordWorkFailure(
    "account",
    new HttpError(502, sensitiveMessage, {
      code: "upstream_request_failed",
    }),
  );

  const snapshot = getWorkGovernorSnapshot();
  assert.equal(snapshot.account.lastFailure, "upstream_request_failed");
  assert.equal(JSON.stringify(snapshot).includes(sensitiveMessage), false);
});

test("governor timing adds less than five milliseconds per no-op", async () => {
  const iterations = 200;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await runGovernedWork("account", async () => undefined);
  }
  const averageDurationMs = (performance.now() - startedAt) / iterations;
  assert.ok(averageDurationMs < 5, `average ${averageDurationMs}ms`);
});

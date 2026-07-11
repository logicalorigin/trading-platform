import assert from "node:assert/strict";
import test from "node:test";

import {
  __startSnapshotRetentionSchedulerForTests,
  type SnapshotRetentionSchedulerTestDeps,
} from "./snapshot-retention-scheduler";

type RetentionResult = Awaited<
  ReturnType<NonNullable<SnapshotRetentionSchedulerTestDeps["runRetention"]>>
>[number];

type TimerCallback = () => void | Promise<void>;
type FakeTimer = {
  callback: TimerCallback;
  delayMs: number;
  cleared: boolean;
  unrefCalled: boolean;
  unref: () => void;
};

function createFakeTimers() {
  const scheduled: FakeTimer[] = [];
  const setTimeoutForTests: SnapshotRetentionSchedulerTestDeps["setTimeout"] = (
    callback: TimerCallback,
    delayMs: number,
  ) => {
    const timer: FakeTimer = {
      callback,
      delayMs,
      cleared: false,
      unrefCalled: false,
      unref: () => {
        timer.unrefCalled = true;
      },
    };
    scheduled.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  };
  const clearTimeoutForTests: SnapshotRetentionSchedulerTestDeps["clearTimeout"] = (
    timer,
  ) => {
    (timer as unknown as FakeTimer).cleared = true;
  };
  const runNext = async () => {
    const timer = scheduled.shift();
    assert.ok(timer, "expected a scheduled timer");
    if (!timer.cleared) {
      await timer.callback();
    }
  };
  return {
    scheduled,
    setTimeoutForTests,
    clearTimeoutForTests,
    runNext,
    delays: () => scheduled.map((timer) => timer.delayMs),
  };
}

function result(overrides: Partial<RetentionResult>): RetentionResult {
  return {
    table: "bar_cache",
    cutoff: "2026-07-09T00:00:00.000Z",
    candidates: 50_000,
    deleted: 0,
    dryRun: false,
    hitCap: false,
    durationMs: 0,
    ...overrides,
  };
}

test("retention scheduler uses backlog cadence after a capped sweep", async () => {
  const timers = createFakeTimers();
  const lanes: string[] = [];
  const events: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const runs = [
    [
      result({
        table: "balance_snapshots",
        candidates: 3,
        deleted: 3,
        durationMs: 7,
      }),
      result({
        deleted: 1_000_000,
        hitCap: true,
        durationMs: 42,
      }),
    ],
    [result({ deleted: 12, hitCap: false, durationMs: 9 })],
  ];

  const handle = __startSnapshotRetentionSchedulerForTests({
    env: {
      SNAPSHOT_RETENTION_INITIAL_DELAY_MS: "5",
      SNAPSHOT_RETENTION_INTERVAL_MS: "120000",
      SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS: "60000",
    },
    setTimeout: timers.setTimeoutForTests,
    clearTimeout: timers.clearTimeoutForTests,
    runInLane: (lane, fn) => {
      lanes.push(lane);
      return fn();
    },
    runRetention: async () => runs.shift() ?? [],
    recordEvent: (event, detail) => {
      events.push({ event, detail });
    },
  });

  assert.deepEqual(timers.delays(), [5]);
  assert.equal(timers.scheduled[0]?.unrefCalled, true);

  await timers.runNext();
  assert.deepEqual(timers.delays(), [60_000]);

  await timers.runNext();
  assert.deepEqual(timers.delays(), [120_000]);

  assert.deepEqual(lanes, ["background", "background"]);
  assert.deepEqual(events, [
    {
      event: "snapshot-retention-sweep",
      detail: {
        table: "balance_snapshots",
        deleted: 3,
        hitCap: false,
        durationMs: 7,
        error: null,
      },
    },
    {
      event: "snapshot-retention-sweep",
      detail: {
        table: "bar_cache",
        deleted: 1_000_000,
        hitCap: true,
        durationMs: 42,
        error: null,
      },
    },
    {
      event: "snapshot-retention-sweep",
      detail: {
        table: "bar_cache",
        deleted: 12,
        hitCap: false,
        durationMs: 9,
        error: null,
      },
    },
  ]);

  handle.stop();
});

test("retention scheduler keeps normal cadence after an under-cap sweep", async () => {
  const timers = createFakeTimers();
  const handle = __startSnapshotRetentionSchedulerForTests({
    env: {
      SNAPSHOT_RETENTION_INITIAL_DELAY_MS: "25",
      SNAPSHOT_RETENTION_INTERVAL_MS: "180000",
      SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS: "60000",
    },
    setTimeout: timers.setTimeoutForTests,
    clearTimeout: timers.clearTimeoutForTests,
    runRetention: async () => [result({ deleted: 99, hitCap: false })],
  });

  assert.deepEqual(timers.delays(), [25]);

  await timers.runNext();
  assert.deepEqual(timers.delays(), [180_000]);

  handle.stop();
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  __snapshotRetentionSchedulerInternalsForTests,
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
    readScheduleState: () => null,
    writeScheduleState: () => {},
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
    readScheduleState: () => null,
    writeScheduleState: () => {},
  });

  assert.deepEqual(timers.delays(), [25]);

  await timers.runNext();
  assert.deepEqual(timers.delays(), [180_000]);

  handle.stop();
});

test("retention scheduler resumes the persisted cadence across API restarts", () => {
  const timers = createFakeTimers();
  const nowMs = Date.parse("2026-07-13T18:00:00.000Z");
  const handle = __startSnapshotRetentionSchedulerForTests({
    env: {
      SNAPSHOT_RETENTION_INITIAL_DELAY_MS: "90000",
      SNAPSHOT_RETENTION_INTERVAL_MS: "600000",
      SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS: "120000",
    },
    setTimeout: timers.setTimeoutForTests,
    clearTimeout: timers.clearTimeoutForTests,
    now: () => nowMs,
    readScheduleState: () => ({
      completedAt: "2026-07-13T17:59:00.000Z",
      hitCap: false,
    }),
    writeScheduleState: () => {},
  });

  assert.deepEqual(timers.delays(), [540_000]);
  handle.stop();
});

test("retention scheduler resumes the shorter backlog cadence after a capped cycle", () => {
  const timers = createFakeTimers();
  const nowMs = Date.parse("2026-07-13T18:00:00.000Z");
  const handle = __startSnapshotRetentionSchedulerForTests({
    env: {
      SNAPSHOT_RETENTION_INITIAL_DELAY_MS: "90000",
      SNAPSHOT_RETENTION_INTERVAL_MS: "600000",
      SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS: "120000",
    },
    setTimeout: timers.setTimeoutForTests,
    clearTimeout: timers.clearTimeoutForTests,
    now: () => nowMs,
    readScheduleState: () => ({
      completedAt: "2026-07-13T17:58:30.000Z",
      hitCap: true,
    }),
    writeScheduleState: () => {},
  });

  assert.deepEqual(timers.delays(), [30_000]);
  handle.stop();
});

test("retention scheduler does not reset an already-due cycle to the cold-start delay", () => {
  const timers = createFakeTimers();
  const nowMs = Date.parse("2026-07-13T18:00:00.000Z");
  const handle = __startSnapshotRetentionSchedulerForTests({
    env: {
      SNAPSHOT_RETENTION_INITIAL_DELAY_MS: "90000",
      SNAPSHOT_RETENTION_INTERVAL_MS: "600000",
      SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS: "120000",
    },
    setTimeout: timers.setTimeoutForTests,
    clearTimeout: timers.clearTimeoutForTests,
    now: () => nowMs,
    readScheduleState: () => ({
      completedAt: "2026-07-13T17:45:00.000Z",
      hitCap: false,
    }),
    writeScheduleState: () => {},
  });

  assert.deepEqual(timers.delays(), [0]);
  handle.stop();
});

test("retention scheduler persists completion before scheduling the next cycle", async () => {
  const timers = createFakeTimers();
  const states: Array<{ completedAt: string; hitCap: boolean }> = [];
  const nowMs = Date.parse("2026-07-13T18:00:00.000Z");
  const handle = __startSnapshotRetentionSchedulerForTests({
    env: {
      SNAPSHOT_RETENTION_INITIAL_DELAY_MS: "5",
      SNAPSHOT_RETENTION_INTERVAL_MS: "180000",
      SNAPSHOT_RETENTION_BACKLOG_INTERVAL_MS: "60000",
    },
    setTimeout: timers.setTimeoutForTests,
    clearTimeout: timers.clearTimeoutForTests,
    now: () => nowMs,
    runRetention: async () => [result({ hitCap: true })],
    readScheduleState: () => null,
    writeScheduleState: (state) => {
      states.push(state);
    },
  });

  await timers.runNext();

  assert.deepEqual(states, [
    { completedAt: "2026-07-13T18:00:00.000Z", hitCap: true },
  ]);
  assert.deepEqual(timers.delays(), [60_000]);
  handle.stop();
});

test("retention schedule state migrates the latest completed legacy flight-recorder cycle", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pyrus-retention-schedule-"));
  const nowMs = Date.parse("2026-07-13T18:00:00.000Z");
  const eventsFile = path.join(dir, "api-events-2026-07-13.jsonl");
  const previousEventsFile = path.join(dir, "api-events-2026-07-12.jsonl");

  try {
    writeFileSync(
      previousEventsFile,
      `${JSON.stringify({
        time: "2026-07-12T23:32:12.947Z",
        event: "snapshot-retention-sweep",
        table: "execution_events",
        hitCap: false,
      })}\n`,
    );
    writeFileSync(
      eventsFile,
      [
        JSON.stringify({ event: "unrelated" }),
        JSON.stringify({
          time: "2026-07-13T17:09:42.720Z",
          event: "snapshot-retention-sweep",
          table: "bar_cache",
          hitCap: true,
        }),
        JSON.stringify({
          time: "2026-07-13T17:09:42.728Z",
          event: "snapshot-retention-sweep",
          table: "execution_events",
          hitCap: false,
        }),
        ...Array.from({ length: 1_100 }, (_, index) =>
          JSON.stringify({
            event: "unrelated-after",
            index,
            value: "x".repeat(1_024),
          }),
        ),
        "",
      ].join("\n"),
    );

    const expected = {
      completedAt: "2026-07-13T17:09:42.728Z",
      hitCap: true,
    };
    assert.deepEqual(
      __snapshotRetentionSchedulerInternalsForTests.loadScheduleState(dir, nowMs),
      expected,
    );

    rmSync(eventsFile, { force: true });
    rmSync(previousEventsFile, { force: true });
    assert.deepEqual(
      __snapshotRetentionSchedulerInternalsForTests.loadScheduleState(dir, nowMs),
      expected,
      "the migrated cycle should survive after the legacy event log is gone",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

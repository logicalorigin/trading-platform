import assert from "node:assert/strict";
import { after, test } from "node:test";

import { pool } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";
import { __signalMonitorInternalsForTests as internals } from "./signal-monitor";

const profile = (id: string) =>
  ({
    id,
    environment: "shadow",
    enabled: true,
    watchlistId: null,
    timeframe: "15m",
    pyrusSignalsSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 60,
    maxSymbols: 500,
    evaluationConcurrency: 1,
  }) as never;

const state = (profileId: string, evaluatedAt: Date, latestBarClose: number) =>
  ({
    id: `${profileId}:AAPL:5m`,
    profileId,
    symbol: "AAPL",
    timeframe: "5m",
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    latestBarAt: evaluatedAt,
    latestBarClose,
    barsSinceSignal: null,
    fresh: false,
    status: "ok",
    active: true,
    lastEvaluatedAt: evaluatedAt,
    lastError: null,
    indicatorSnapshot: null,
    canonicalSignalEvent: null,
  }) as never;

after(async () => {
  await pool.end();
});

test("pending persistence keeps the newest evaluation when an older result arrives later", async () => {
  internals.resetSignalMonitorMatrixStreamForTests();
  const testInternals = internals as unknown as {
    setSignalMonitorPersistWorkerForTests(
      worker:
        | ((input: {
            evaluatedAt: Date;
          }) => Promise<"success" | "retryable-failure" | "terminal-failure">)
        | null,
    ): void;
    schedulePersistSignalMonitorMatrixStatesForTests(input: {
      profile: ReturnType<typeof profile>;
      states: unknown[];
      evaluatedAt: Date;
    }): void;
  };
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const attempts: string[] = [];
  testInternals.setSignalMonitorPersistWorkerForTests(
    async ({ evaluatedAt }) => {
      attempts.push(evaluatedAt.toISOString());
      if (attempts.length === 1) {
        markFirstStarted();
        await firstBlocked;
      }
      return "success";
    },
  );
  const profileId = "00000000-0000-4000-8000-0000000000e1";
  const schedule = (evaluatedAt: Date, close: number) =>
    testInternals.schedulePersistSignalMonitorMatrixStatesForTests({
      profile: profile(profileId),
      states: [state(profileId, evaluatedAt, close)],
      evaluatedAt,
    });

  try {
    schedule(new Date("2026-06-09T15:00:00.000Z"), 100);
    await firstStarted;
    schedule(new Date("2026-06-09T15:10:00.000Z"), 110);
    schedule(new Date("2026-06-09T15:05:00.000Z"), 105);
    releaseFirst();
    await internals.waitForSignalMonitorPersistIdleForTests();
    assert.deepEqual(attempts, [
      "2026-06-09T15:00:00.000Z",
      "2026-06-09T15:10:00.000Z",
    ]);
  } finally {
    releaseFirst();
    testInternals.setSignalMonitorPersistWorkerForTests(null);
    internals.resetSignalMonitorMatrixStreamForTests();
  }
});

test("equal-time stale persistence cannot overwrite the committed evaluation", async () => {
  await withTestDb(async ({ db }) => {
    internals.resetSignalMonitorMatrixStreamForTests();
    const profileId = "00000000-0000-4000-8000-0000000000e2";
    const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
    await db.execute(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${profileId}, 'shadow', true, 3)
    `);
    await db.execute(sql`
      INSERT INTO signal_monitor_symbol_states
        (profile_id, symbol, timeframe, latest_bar_at, latest_bar_close,
         last_evaluated_at, status, active)
      VALUES
        (${profileId}, 'AAPL', '5m', ${evaluatedAt}, 200,
         ${evaluatedAt}, 'ok', true)
    `);

    internals.schedulePersistSignalMonitorMatrixStatesForTests({
      profile: profile(profileId),
      states: [state(profileId, evaluatedAt, 100)],
      evaluatedAt,
    });
    await internals.waitForSignalMonitorPersistIdleForTests();

    const persisted = await db.execute(sql`
      SELECT latest_bar_close
      FROM signal_monitor_symbol_states
      WHERE profile_id = ${profileId}
        AND symbol = 'AAPL'
        AND timeframe = '5m'
    `);
    assert.equal(Number(persisted.rows[0]?.latest_bar_close), 200);
    internals.resetSignalMonitorMatrixStreamForTests();
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import { sql } from "drizzle-orm";

import {
  __signalMonitorInternalsForTests,
  listSignalMonitorBreadthHistory,
  recordSignalMonitorBreadthSnapshot,
} from "./signal-monitor";
import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";

// Importing the services opens the real @workspace/db pool at module load, so
// run with --test-force-exit:
//   pnpm --filter @workspace/api-server exec tsx --test --test-force-exit \
//     src/services/signal-monitor-breadth-history.test.ts

const PROFILE_ID = "00000000-0000-0000-0000-0000000000bb";

__signalMonitorInternalsForTests.setSignalMonitorQuietMarketSessionNowForTests(
  false,
);

const alignBucketIso = (iso: string, bucketMinutes: number) => {
  const bucketMs = Math.max(1, bucketMinutes) * 60_000;
  return new Date(
    Math.floor(new Date(iso).getTime() / bucketMs) * bucketMs,
  ).toISOString();
};

test("breadth history uses available snapshots instead of incomplete event replay", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_events
        (id, profile_id, event_key, environment, symbol, timeframe, direction, signal_at, payload)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 'breadth-history-incomplete-a', 'shadow', 'AAA', '5m', 'buy', '2026-06-18T15:00:00.000Z'::timestamptz, '{}'::jsonb)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_breadth_snapshots
        (id, environment, timeframe, captured_at, buy, sell, total)
      VALUES
        (gen_random_uuid(), 'shadow', 'all', '2026-06-25T15:00:00.000Z'::timestamptz, 3, 1, 4),
        (gen_random_uuid(), 'shadow', '5m', '2026-06-25T15:00:00.000Z'::timestamptz, 3, 1, 4),
        (gen_random_uuid(), 'shadow', 'all', '2026-06-25T15:05:00.000Z'::timestamptz, 4, 0, 4),
        (gen_random_uuid(), 'shadow', '5m', '2026-06-25T15:05:00.000Z'::timestamptz, 4, 0, 4)
    `);

    const now = new Date("2026-06-26T16:00:00.000Z");
    const week = await listSignalMonitorBreadthHistory({
      environment: "shadow",
      range: "week",
      now,
    });
    const month = await listSignalMonitorBreadthHistory({
      environment: "shadow",
      range: "month",
      now,
    });

    assert.equal(week.range, "week");
    assert.equal(month.range, "month");
    assert.ok(week.points.length > 0);
    assert.ok(month.points.length > 0);
    const earliestSnapshotAt = "2026-06-25T15:00:00.000Z";
    const expectedWeekFirstBucket = alignBucketIso(
      earliestSnapshotAt,
      week.bucketMinutes,
    );
    const expectedMonthFirstBucket = alignBucketIso(
      earliestSnapshotAt,
      month.bucketMinutes,
    );
    assert.equal(
      week.points[0]?.at.toISOString(),
      expectedWeekFirstBucket,
      "week range starts at the first bucket containing a real snapshot",
    );
    assert.equal(
      month.points[0]?.at.toISOString(),
      expectedMonthFirstBucket,
      "month range starts at the first bucket containing a real snapshot",
    );
    assert.equal(
      week.points.some(
        (point) => point.at.getTime() < new Date(expectedWeekFirstBucket).getTime(),
      ),
      false,
      "week range emits no fabricated leading buckets before the first snapshot bucket",
    );
    assert.equal(
      month.points.some(
        (point) => point.at.getTime() < new Date(expectedMonthFirstBucket).getTime(),
      ),
      false,
      "month range emits no fabricated leading buckets before the first snapshot bucket",
    );
    assert.equal(week.points.some((point) => point.total === 1), false);
    assert.equal(month.points.some((point) => point.total === 1), false);
  });
});

test("breadth history accepts all range contracts and keeps day exact when snapshots cover it", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_breadth_snapshots
        (id, environment, timeframe, captured_at, buy, sell, total)
      VALUES
        (gen_random_uuid(), 'shadow', 'all', '2026-06-25T04:05:00.000Z'::timestamptz, 7, 2, 9),
        (gen_random_uuid(), 'shadow', '5m', '2026-06-25T04:05:00.000Z'::timestamptz, 7, 2, 9)
    `);

    const now = new Date("2026-06-25T16:00:00.000Z");
    const hour = await listSignalMonitorBreadthHistory({
      environment: "shadow",
      range: "hour",
      now,
    });
    const day = await listSignalMonitorBreadthHistory({
      environment: "shadow",
      range: "day",
      now,
    });
    const week = await listSignalMonitorBreadthHistory({
      environment: "shadow",
      range: "week",
      now,
    });
    const month = await listSignalMonitorBreadthHistory({
      environment: "shadow",
      range: "month",
      now,
    });

    assert.deepEqual(
      [hour.range, day.range, week.range, month.range],
      ["hour", "day", "week", "month"],
    );
    assert.deepEqual(
      day.points[0] ? [day.points[0].buy, day.points[0].sell, day.points[0].total] : null,
      [7, 2, 9],
    );
  });
});

test("breadth history snapshot reduction keeps the latest snapshot per bucket", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled)
      VALUES (${PROFILE_ID}, 'shadow', true)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_breadth_snapshots
        (id, environment, timeframe, captured_at, buy, sell, total)
      VALUES
        (gen_random_uuid(), 'shadow', 'all', '2026-06-25T14:00:00.000Z'::timestamptz, 1, 8, 9),
        (gen_random_uuid(), 'shadow', 'all', '2026-06-25T14:05:00.000Z'::timestamptz, 7, 2, 9),
        (gen_random_uuid(), 'shadow', '5m', '2026-06-25T14:00:00.000Z'::timestamptz, 1, 8, 9),
        (gen_random_uuid(), 'shadow', '5m', '2026-06-25T14:05:00.000Z'::timestamptz, 7, 2, 9)
    `);
    const raw = await exec(sql`
      SELECT count(*) AS count
      FROM signal_monitor_breadth_snapshots
      WHERE environment = 'shadow'
    `);

    const history = await listSignalMonitorBreadthHistory({
      environment: "shadow",
      range: "day",
      now: new Date("2026-06-25T16:00:00.000Z"),
    });

    assert.equal(Number(raw.rows[0]?.count), 4);
    assert.deepEqual(
      history.points[0]
        ? [history.points[0].buy, history.points[0].sell, history.points[0].total]
        : null,
      [7, 2, 9],
    );
    assert.deepEqual(
      history.timeframes[0]?.points[0]
        ? [
            history.timeframes[0].points[0].buy,
            history.timeframes[0].points[0].sell,
            history.timeframes[0].points[0].total,
          ]
        : null,
      [7, 2, 9],
    );
  });
});

test("recorded breadth snapshots include aged directional state rows", async () => {
  await withTestDb(async ({ db }) => {
    const exec = (q: ReturnType<typeof sql>) => db.execute(q);
    await exec(sql`
      INSERT INTO signal_monitor_profiles (id, environment, enabled, fresh_window_bars)
      VALUES (${PROFILE_ID}, 'shadow', true, 3)
    `);
    await exec(sql`
      INSERT INTO signal_monitor_symbol_states
        (id, profile_id, symbol, timeframe, active, status, current_signal_direction,
         current_signal_at, bars_since_signal, fresh)
      VALUES
        (gen_random_uuid(), ${PROFILE_ID}, 'AAA', '5m', true, 'ok', 'buy',
          '2026-06-25T15:00:00.000Z'::timestamptz, 99, false),
        (gen_random_uuid(), ${PROFILE_ID}, 'BBB', '5m', true, 'ok', 'sell',
          '2026-06-25T15:05:00.000Z'::timestamptz, 42, false)
    `);

    const inserted = await recordSignalMonitorBreadthSnapshot(
      new Date("2026-06-25T16:00:00.000Z"),
    );
    const rows = await exec(sql`
      SELECT timeframe, buy, sell, total
      FROM signal_monitor_breadth_snapshots
      WHERE environment = 'shadow'
      ORDER BY timeframe
    `);

    assert.equal(inserted, 2);
    assert.deepEqual(
      rows.rows.map((row) => [row.timeframe, Number(row.buy), Number(row.sell), Number(row.total)]),
      [
        ["5m", 1, 1, 2],
        ["all", 1, 1, 2],
      ],
    );
  });
});

test("state-anchor-backfill metadata cannot make aged signals actionable", () => {
  const {
    buildSignalOptionsSignalSnapshot,
    candidateFromSignalSnapshot,
    isSignalOptionsActionableSignalState,
  } = __signalOptionsAutomationInternalsForTests;
  const agedState = {
    id: "state-aged-dia",
    profileId: PROFILE_ID,
    symbol: "DIA",
    timeframe: "5m",
    status: "ok",
    currentSignalDirection: "sell",
    currentSignalAt: "2026-06-25T15:00:00.000Z",
    currentSignalPrice: 100,
    latestBarAt: "2026-06-25T15:45:00.000Z",
    barsSinceSignal: 9,
    fresh: false,
  } as never;

  assert.equal(isSignalOptionsActionableSignalState(agedState), false);
  const snapshot = buildSignalOptionsSignalSnapshot({
    state: agedState,
    signalAt: "2026-06-25T15:00:00.000Z",
    signalKey: `${PROFILE_ID}:DIA:5m:sell:2026-06-25T15:00:00.000Z`,
    source: "state-anchor-backfill",
    eventId: "event-backfilled-dia",
    freshWindowBars: 8,
  });

  assert.equal(snapshot.source, "state-anchor-backfill");
  assert.equal(snapshot.fresh, false);
  assert.equal(snapshot.actionEligible, false);
  assert.equal(snapshot.actionBlocker, "signal_too_old");
  assert.equal(
    candidateFromSignalSnapshot({
      deployment: { id: "deployment-test", name: "Signal Options Test" },
      signal: snapshot,
    } as never),
    null,
  );
});

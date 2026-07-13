import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

import {
  db,
  pruneExecutionEventsDiagnostics,
  pruneShadowBalanceSnapshots,
  resolveSnapshotRetentionConfig,
} from "./index";
import {
  executionEventsTable,
  shadowAccountsTable,
  shadowBalanceSnapshotsTable,
} from "./schema";
import { withTestDb } from "./testing";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const SHADOW_ACCOUNT_ID = "00000000-0000-4000-8000-000000000099";

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

test("retention config rejects coerced and non-positive integers", () => {
  const config = resolveSnapshotRetentionConfig({
    SIGNAL_BREADTH_SNAPSHOT_RETENTION_DAYS: "1e2",
    BALANCE_SNAPSHOT_RETENTION_DAYS: "0x10",
    SHADOW_BALANCE_SNAPSHOT_RETENTION_DAYS: "2.5",
    SHADOW_POSITION_MARK_RETENTION_DAYS: "0",
    SNAPSHOT_RETENTION_BATCH_SIZE: "-10",
  });

  assert.equal(config.signalBreadthSnapshotDays, 90);
  assert.equal(config.balanceSnapshotDays, 180);
  assert.equal(config.shadowBalanceSnapshotDays, 180);
  assert.equal(config.shadowPositionMarkDays, 180);
  assert.equal(config.batchSize, 5_000);
});

test("shadow snapshot retention preserves range-keyed watchlist backtests", async () => {
  await withTestDb(async () => {
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Retention contract",
      startingBalance: "1000",
      cash: "1000",
    });

    const insertSnapshot = async (source: string, asOf: Date) => {
      await db.insert(shadowBalanceSnapshotsTable).values({
        accountId: SHADOW_ACCOUNT_ID,
        cash: "1",
        buyingPower: "1",
        netLiquidation: "1",
        source,
        asOf,
      });
    };
    await insertSnapshot("mark", daysAgo(300));
    await insertSnapshot("mark", daysAgo(10));

    // This is the current source emitted by watchlistBacktestSnapshotSource()
    // and owned by its range-scoped `watchlist_bt:%` cleanup path.
    const backtestSource = "watchlist_bt:20260101:20260131";
    await insertSnapshot(backtestSource, daysAgo(300));
    await insertSnapshot(backtestSource, daysAgo(250));

    const preview = await pruneShadowBalanceSnapshots({
      retentionDays: 180,
      now: NOW,
    });
    assert.equal(preview.candidates, 1, "only the old live mark is eligible");

    const executed = await pruneShadowBalanceSnapshots({
      retentionDays: 180,
      now: NOW,
      dryRun: false,
    });
    assert.equal(executed.deleted, 1);

    const backtestRows = await db
      .select()
      .from(shadowBalanceSnapshotsTable)
      .where(eq(shadowBalanceSnapshotsTable.source, backtestSource));
    assert.equal(backtestRows.length, 2);
  });
});

test("execution-event retention reports a delete failure", async () => {
  await withTestDb(async (testDb) => {
    await db.insert(executionEventsTable).values({
      eventType: "signal_options_candidate_skipped",
      summary: "eligible diagnostic",
      payload: {},
      occurredAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    await testDb.client.exec(`
      create function reject_execution_event_delete() returns trigger
      language plpgsql as $$
      begin
        raise exception 'forced retention delete failure';
      end;
      $$;
      create trigger reject_execution_event_delete
      before delete on execution_events
      for each row execute function reject_execution_event_delete();
    `);

    const executed = await pruneExecutionEventsDiagnostics({
      retentionHours: 48,
      now: NOW,
      dryRun: false,
    });

    assert.equal(executed.deleted, 0);
    assert.ok(executed.error, "the caught delete failure is surfaced");
  });
});

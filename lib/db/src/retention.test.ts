import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  shadowAccountsTable,
  shadowBalanceSnapshotsTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
  signalMonitorBreadthSnapshotsTable,
  signalMonitorEventsTable,
  signalMonitorProfilesTable,
  signalMonitorSymbolStatesTable,
} from "./index";
import {
  pruneBalanceSnapshots,
  pruneClosedShadowPositionMarks,
  pruneInactiveSignalMonitorSymbolStates,
  pruneShadowBalanceSnapshots,
  pruneSignalMonitorBreadthSnapshots,
  pruneSignalMonitorEvents,
  resolveSnapshotRetentionConfig,
  runAllSnapshotRetention,
} from "./retention";
import { createTestDb, type TestDatabase } from "./testing";

// Task 7 retention behaviour, exercised against real PGlite so the preservation
// SQL (latest-per-key, open-position protection) is verified, not asserted.
//
//   pnpm --filter @workspace/db exec tsx --test --test-force-exit src/retention.test.ts

const NOW = new Date("2026-06-25T00:00:00.000Z");
const RETENTION_DAYS = 180; // cutoff = NOW - 180d
const SHADOW_ACCOUNT_ID = "shadow-test";

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

let testDb: TestDatabase;
before(async () => {
  testDb = await createTestDb();
});
after(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.client.exec(
    "truncate table balance_snapshots, broker_accounts, broker_connections, shadow_balance_snapshots, shadow_position_marks, shadow_positions, shadow_accounts, signal_monitor_breadth_snapshots, signal_monitor_events, signal_monitor_symbol_states, signal_monitor_profiles restart identity cascade",
  );
});

async function seedTwoBrokerAccounts(): Promise<{ a: string; b: string }> {
  const [conn] = await db
    .insert(brokerConnectionsTable)
    .values({ name: "test", connectionType: "broker", mode: "live" })
    .returning({ id: brokerConnectionsTable.id });
  const [a] = await db
    .insert(brokerAccountsTable)
    .values({
      connectionId: conn!.id,
      providerAccountId: "A",
      displayName: "A",
      mode: "live",
    })
    .returning({ id: brokerAccountsTable.id });
  const [b] = await db
    .insert(brokerAccountsTable)
    .values({
      connectionId: conn!.id,
      providerAccountId: "B",
      displayName: "B",
      mode: "live",
    })
    .returning({ id: brokerAccountsTable.id });
  return { a: a!.id, b: b!.id };
}

async function insertBalance(accountId: string, asOf: Date): Promise<void> {
  await db.insert(balanceSnapshotsTable).values({
    accountId,
    cash: "1",
    buyingPower: "1",
    netLiquidation: "1",
    asOf,
  });
}

test("balance_snapshots: prunes old non-latest rows, always keeps newest per account", async () => {
  const { a, b } = await seedTwoBrokerAccounts();
  // Account A: two old rows + one recent. Latest (recent) survives by age anyway.
  await insertBalance(a, daysAgo(200));
  await insertBalance(a, daysAgo(190));
  await insertBalance(a, daysAgo(10));
  // Account B: BOTH rows are older than the cutoff. The newest (200d) must still
  // survive purely because it is the latest for the account.
  await insertBalance(b, daysAgo(300));
  await insertBalance(b, daysAgo(200));

  const dry = await pruneBalanceSnapshots({ retentionDays: RETENTION_DAYS, now: NOW });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.candidates, 3); // A: 200d,190d  B: 300d
  assert.equal(dry.deleted, 0);
  assert.equal((await db.select().from(balanceSnapshotsTable)).length, 5);

  const run = await pruneBalanceSnapshots({
    retentionDays: RETENTION_DAYS,
    now: NOW,
    dryRun: false,
  });
  assert.equal(run.deleted, 3);

  const aRows = await db
    .select()
    .from(balanceSnapshotsTable)
    .where(eq(balanceSnapshotsTable.accountId, a));
  assert.equal(aRows.length, 1);
  assert.equal(aRows[0]!.asOf.getTime(), daysAgo(10).getTime());

  const bRows = await db
    .select()
    .from(balanceSnapshotsTable)
    .where(eq(balanceSnapshotsTable.accountId, b));
  assert.equal(bRows.length, 1);
  assert.equal(bRows[0]!.asOf.getTime(), daysAgo(200).getTime());
});

async function seedShadowAccount(): Promise<void> {
  await db.insert(shadowAccountsTable).values({
    id: SHADOW_ACCOUNT_ID,
    displayName: "Shadow",
    startingBalance: "1000",
    cash: "1000",
  });
}

async function insertPosition(opts: {
  key: string;
  openedAt: Date;
  closedAt: Date | null;
  status: string;
}): Promise<string> {
  const [row] = await db
    .insert(shadowPositionsTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      positionKey: opts.key,
      symbol: "AAPL",
      assetClass: "option",
      quantity: "1",
      averageCost: "1",
      openedAt: opts.openedAt,
      closedAt: opts.closedAt,
      status: opts.status,
    })
    .returning({ id: shadowPositionsTable.id });
  return row!.id;
}

async function insertMark(positionId: string, asOf: Date): Promise<void> {
  await db.insert(shadowPositionMarksTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    positionId,
    mark: "1",
    marketValue: "1",
    unrealizedPnl: "0",
    asOf,
  });
}

test("shadow_position_marks: keeps open-position history, prunes long-closed positions to latest", async () => {
  await seedShadowAccount();

  // OPEN position with old marks: peak read needs full history -> keep ALL.
  const open = await insertPosition({
    key: "k-open",
    openedAt: daysAgo(300),
    closedAt: null,
    status: "open",
  });
  await insertMark(open, daysAgo(250));
  await insertMark(open, daysAgo(200));

  // CLOSED long ago: prune old marks but keep the latest mark.
  const closedOld = await insertPosition({
    key: "k-closed-old",
    openedAt: daysAgo(400),
    closedAt: daysAgo(250),
    status: "closed",
  });
  await insertMark(closedOld, daysAgo(300));
  await insertMark(closedOld, daysAgo(280));
  await insertMark(closedOld, daysAgo(260));

  // CLOSED recently (within window): not eligible -> keep ALL marks.
  const closedRecent = await insertPosition({
    key: "k-closed-recent",
    openedAt: daysAgo(220),
    closedAt: daysAgo(10),
    status: "closed",
  });
  await insertMark(closedRecent, daysAgo(200));
  await insertMark(closedRecent, daysAgo(150));

  const dry = await pruneClosedShadowPositionMarks({
    retentionDays: RETENTION_DAYS,
    now: NOW,
  });
  assert.equal(dry.candidates, 2); // closedOld: 300d, 280d (260d is latest)
  assert.equal(dry.deleted, 0);

  const run = await pruneClosedShadowPositionMarks({
    retentionDays: RETENTION_DAYS,
    now: NOW,
    dryRun: false,
  });
  assert.equal(run.deleted, 2);

  const openMarks = await db
    .select()
    .from(shadowPositionMarksTable)
    .where(eq(shadowPositionMarksTable.positionId, open));
  assert.equal(openMarks.length, 2);

  const closedOldMarks = await db
    .select()
    .from(shadowPositionMarksTable)
    .where(eq(shadowPositionMarksTable.positionId, closedOld));
  assert.equal(closedOldMarks.length, 1);
  assert.equal(closedOldMarks[0]!.asOf.getTime(), daysAgo(260).getTime());

  const closedRecentMarks = await db
    .select()
    .from(shadowPositionMarksTable)
    .where(eq(shadowPositionMarksTable.positionId, closedRecent));
  assert.equal(closedRecentMarks.length, 2);
});

test("signal_monitor_breadth_snapshots: flat age delete keeps recent rows", async () => {
  await db.insert(signalMonitorBreadthSnapshotsTable).values([
    { environment: "live", timeframe: "1d", capturedAt: daysAgo(200), buy: 1, sell: 1, total: 2 },
    { environment: "shadow", timeframe: "1d", capturedAt: daysAgo(200), buy: 1, sell: 1, total: 2 },
    { environment: "live", timeframe: "1d", capturedAt: daysAgo(10), buy: 1, sell: 1, total: 2 },
  ]);

  const dry = await pruneSignalMonitorBreadthSnapshots({
    retentionDays: RETENTION_DAYS,
    now: NOW,
  });
  assert.equal(dry.candidates, 2);
  assert.equal(dry.deleted, 0);

  const run = await pruneSignalMonitorBreadthSnapshots({
    retentionDays: RETENTION_DAYS,
    now: NOW,
    dryRun: false,
  });
  assert.equal(run.deleted, 2);

  const remaining = await db.select().from(signalMonitorBreadthSnapshotsTable);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]!.capturedAt.getTime(), daysAgo(10).getTime());
});

async function insertShadowBalance(opts: {
  source: string;
  asOf: Date;
}): Promise<void> {
  await db.insert(shadowBalanceSnapshotsTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    cash: "1",
    buyingPower: "1",
    netLiquidation: "1",
    source: opts.source,
    asOf: opts.asOf,
  });
}

test("shadow_balance_snapshots: prunes old live rows per source, never simulation rows", async () => {
  await seedShadowAccount();

  // Live source 'mark': old + recent -> keep recent (latest).
  await insertShadowBalance({ source: "mark", asOf: daysAgo(200) });
  await insertShadowBalance({ source: "mark", asOf: daysAgo(10) });
  // Live source 'ledger': both old -> keep newest (still latest for the source).
  await insertShadowBalance({ source: "ledger", asOf: daysAgo(300) });
  await insertShadowBalance({ source: "ledger", asOf: daysAgo(200) });
  // Simulation sources with simulated (old) as_of -> MUST be preserved.
  await insertShadowBalance({ source: "signal_options_replay", asOf: daysAgo(300) });
  await insertShadowBalance({ source: "watchlist_backtest", asOf: daysAgo(250) });

  const dry = await pruneShadowBalanceSnapshots({
    retentionDays: RETENTION_DAYS,
    now: NOW,
  });
  assert.equal(dry.candidates, 2); // mark 200d + ledger 300d
  assert.equal(dry.deleted, 0);

  const run = await pruneShadowBalanceSnapshots({
    retentionDays: RETENTION_DAYS,
    now: NOW,
    dryRun: false,
  });
  assert.equal(run.deleted, 2);

  const bySource = async (source: string) =>
    (
      await db
        .select()
        .from(shadowBalanceSnapshotsTable)
        .where(eq(shadowBalanceSnapshotsTable.source, source))
    ).length;
  assert.equal(await bySource("mark"), 1);
  assert.equal(await bySource("ledger"), 1);
  assert.equal(await bySource("signal_options_replay"), 1); // untouched
  assert.equal(await bySource("watchlist_backtest"), 1); // untouched
});

async function seedSignalMonitorProfile(): Promise<string> {
  const [profile] = await db
    .insert(signalMonitorProfilesTable)
    .values({ environment: "shadow" })
    .returning({ id: signalMonitorProfilesTable.id });
  return profile!.id;
}

async function insertSignalEvent(opts: {
  profileId: string;
  symbol: string;
  signalAt: Date;
  close?: string | null;
}): Promise<void> {
  await db.insert(signalMonitorEventsTable).values({
    profileId: opts.profileId,
    eventKey: `${opts.symbol}:5m:buy:${opts.signalAt.toISOString()}`,
    environment: "shadow",
    symbol: opts.symbol,
    timeframe: "5m",
    direction: "buy",
    signalAt: opts.signalAt,
    close: opts.close === undefined ? "100" : opts.close,
  });
}

test("signal_monitor_events: prunes old rows, always keeps newest trusted event per cell", async () => {
  const profileId = await seedSignalMonitorProfile();
  // AAPL/5m: two old trusted + one recent trusted. The old rows are prunable
  // because the recent row is the cell's latest trusted event.
  await insertSignalEvent({ profileId, symbol: "AAPL", signalAt: daysAgo(200) });
  await insertSignalEvent({ profileId, symbol: "AAPL", signalAt: daysAgo(150) });
  await insertSignalEvent({ profileId, symbol: "AAPL", signalAt: daysAgo(10) });
  // TSLA/5m: ONLY ancient events. The newest TRUSTED one (300d) must survive as
  // the cell's canonical signal identity; the newer untrusted row (250d, no
  // close) has no latest-per-cell reader and is pruned.
  await insertSignalEvent({ profileId, symbol: "TSLA", signalAt: daysAgo(300) });
  await insertSignalEvent({
    profileId,
    symbol: "TSLA",
    signalAt: daysAgo(250),
    close: null,
  });

  const run = await pruneSignalMonitorEvents({
    retentionDays: 120,
    now: NOW,
    dryRun: false,
  });
  assert.equal(run.deleted, 3);
  const rows = await db.select().from(signalMonitorEventsTable);
  assert.deepEqual(
    rows
      .map(
        (row) =>
          `${row.symbol}:${Math.round(
            (NOW.getTime() - row.signalAt.getTime()) / 86_400_000,
          )}`,
      )
      .sort(),
    ["AAPL:10", "TSLA:300"],
  );
});

test("signal_monitor_symbol_states: prunes stale inactive rows, never active rows", async () => {
  const profileId = await seedSignalMonitorProfile();
  const insertState = async (
    symbol: string,
    active: boolean,
    updatedAt: Date,
  ) => {
    await db.insert(signalMonitorSymbolStatesTable).values({
      profileId,
      symbol,
      timeframe: "5m",
      active,
      updatedAt,
    });
  };
  await insertState("AAPL", true, daysAgo(400)); // active: kept regardless of age
  await insertState("TSLA", false, daysAgo(200)); // stale inactive: pruned
  await insertState("NVDA", false, daysAgo(10)); // recent inactive: kept

  const run = await pruneInactiveSignalMonitorSymbolStates({
    retentionDays: 90,
    now: NOW,
    dryRun: false,
  });
  assert.equal(run.deleted, 1);
  const rows = await db.select().from(signalMonitorSymbolStatesTable);
  assert.deepEqual(rows.map((row) => row.symbol).sort(), ["AAPL", "NVDA"]);
});

test("resolveSnapshotRetentionConfig applies defaults and env overrides", () => {
  const defaults = resolveSnapshotRetentionConfig({});
  assert.deepEqual(defaults, {
    signalBreadthSnapshotDays: 90,
    balanceSnapshotDays: 180,
    shadowBalanceSnapshotDays: 180,
    shadowPositionMarkDays: 180,
    signalMonitorEventDays: 120,
    signalMonitorInactiveStateDays: 90,
    batchSize: 5_000,
  });

  const overridden = resolveSnapshotRetentionConfig({
    SIGNAL_BREADTH_SNAPSHOT_RETENTION_DAYS: "30",
    BALANCE_SNAPSHOT_RETENTION_DAYS: "365",
    SNAPSHOT_RETENTION_BATCH_SIZE: "1000",
    SHADOW_POSITION_MARK_RETENTION_DAYS: "not-a-number",
  });
  assert.equal(overridden.signalBreadthSnapshotDays, 30);
  assert.equal(overridden.balanceSnapshotDays, 365);
  assert.equal(overridden.batchSize, 1_000);
  assert.equal(overridden.shadowPositionMarkDays, 180); // invalid -> default
});

test("runAllSnapshotRetention runs all configured sweeps, dry-run by default", async () => {
  const results = await runAllSnapshotRetention({ now: NOW });
  assert.deepEqual(
    results.map((r) => r.table).sort(),
    [
      "balance_snapshots",
      "shadow_balance_snapshots",
      "shadow_position_marks",
      "signal_monitor_breadth_snapshots",
      "signal_monitor_events",
      "signal_monitor_symbol_states",
    ],
  );
  assert.ok(results.every((r) => r.dryRun === true && r.deleted === 0));
});

test("batched delete converges across multiple iterations", async () => {
  const { a } = await seedTwoBrokerAccounts();
  for (let i = 0; i < 12; i++) {
    await insertBalance(a, daysAgo(300 - i)); // all far older than cutoff
  }
  await insertBalance(a, daysAgo(1)); // latest, must survive

  const run = await pruneBalanceSnapshots({
    retentionDays: RETENTION_DAYS,
    now: NOW,
    dryRun: false,
    batchSize: 5, // force several batches
  });
  assert.equal(run.deleted, 12);
  const rows = await db.select().from(balanceSnapshotsTable);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.asOf.getTime(), daysAgo(1).getTime());
});

import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";

import {
  db,
  shadowAccountsTable,
  shadowBalanceSnapshotsTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
} from "@workspace/db";
import { createTestDb } from "@workspace/db/testing";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  getShadowAccountEquityHistory,
  refreshShadowPositionMarks,
} from "./shadow-account";
import { runWithShadowAccountId } from "./shadow-account-context";

async function seedAccount(accountId: string, startingBalance = "100000") {
  await db.insert(shadowAccountsTable).values({
    id: accountId,
    displayName: "EQH test",
    currency: "USD",
    startingBalance,
    cash: startingBalance,
    status: "active",
  });
}

type SeedSnapshot = {
  asOf: Date;
  source: string;
  netLiquidation: number;
  cash?: number;
  realizedPnl?: number;
  fees?: number;
};

async function seedSnapshots(accountId: string, rows: SeedSnapshot[]) {
  if (!rows.length) return;
  await db.insert(shadowBalanceSnapshotsTable).values(
    rows.map((row) => ({
      accountId,
      currency: "USD",
      cash: String(row.cash ?? 100000),
      buyingPower: String(row.cash ?? 100000),
      netLiquidation: String(row.netLiquidation),
      realizedPnl: String(row.realizedPnl ?? 0),
      unrealizedPnl: "0",
      fees: String(row.fees ?? 0),
      source: row.source,
      asOf: row.asOf,
    })),
  );
}

// --- Deliverable 1: bucket-first bounded projected reads -------------------

test("shadowEquityHistoryReadPolicy scales bucket size with span at a fixed candidate count", () => {
  const day = internals.shadowEquityHistoryReadPolicy(86_400_000);
  const year = internals.shadowEquityHistoryReadPolicy(365 * 86_400_000);
  assert.equal(day.candidates, 3);
  assert.equal(year.candidates, 3);
  assert.ok(day.bucketMs >= 60_000, "min 1-minute bucket floor");
  assert.ok(year.bucketMs > day.bucketMs, "longer span => coarser buckets");
  // total sampled rows track the budget: buckets*(candidates+1) ~= budget
  const yearBuckets = (365 * 86_400_000) / year.bucketMs;
  assert.ok(
    yearBuckets * (year.candidates + 1) <= 1_400,
    `bucket count must keep the read bounded, got ${yearBuckets}`,
  );
  // a sub-minute span is floored, never sub-minute buckets
  assert.equal(internals.shadowEquityHistoryReadPolicy(1_000).bucketMs, 60_000);
});

test("bucket-first reader bounds a dense day far below the raw row count", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-bound";
    await seedAccount(accountId);
    const end = new Date("2026-07-09T20:00:00.000Z");
    const start = new Date(end.getTime() - 24 * 3_600_000);
    const total = 2_880; // one every 30s across the day
    const rows: SeedSnapshot[] = [];
    for (let i = 0; i < total; i++) {
      rows.push({
        asOf: new Date(start.getTime() + i * 30_000),
        source: "mark",
        netLiquidation: 100_000 + i,
      });
    }
    await seedSnapshots(accountId, rows);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );
    console.log("EQH_1D_BOUND", sampled.length, "of", total);
    assert.ok(
      sampled.length < total / 2,
      `expected a bounded read, got ${sampled.length} of ${total}`,
    );
    // sorted ascending by asOf
    for (let i = 1; i < sampled.length; i++) {
      assert.ok(sampled[i - 1]!.asOf.getTime() <= sampled[i]!.asOf.getTime());
    }
    // newest and oldest raw rows are both retained
    const asOfMs = sampled.map((r) => r.asOf.getTime());
    assert.equal(Math.min(...asOfMs), start.getTime());
    assert.equal(Math.max(...asOfMs), new Date(end.getTime() - 30_000).getTime());
  } finally {
    await t.cleanup();
  }
});

test("bucket-first reader is a faithful superset over a small mixed-source fixture", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-superset";
    await seedAccount(accountId);
    const base = new Date("2026-07-09T14:30:00.000Z");
    const fixture: SeedSnapshot[] = [
      { asOf: new Date(base.getTime() + 0), source: "mark", netLiquidation: 100_100 },
      { asOf: new Date(base.getTime() + 60_000), source: "automation_mark", netLiquidation: 100_150 },
      { asOf: new Date(base.getTime() + 120_000), source: "automation", netLiquidation: 100_200 },
      { asOf: new Date(base.getTime() + 180_000), source: "signal_options_replay", netLiquidation: 55_000 },
      { asOf: new Date(base.getTime() + 240_000), source: "watchlist_backtest_mark", netLiquidation: 42_000 },
      { asOf: new Date(base.getTime() + 300_000), source: "mark", netLiquidation: 100_250 },
    ];
    await seedSnapshots(accountId, fixture);
    const start = new Date(base.getTime() - 60_000);
    const end = new Date(base.getTime() + 360_000);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );
    // At fixture scale nothing is sampled away, so feeding this set to the
    // unchanged pipeline is identical to feeding the full-scan result.
    assert.equal(sampled.length, fixture.length);
    const sampledNlv = new Set(sampled.map((r) => Number(r.netLiquidation)));
    for (const row of fixture) {
      assert.ok(
        sampledNlv.has(row.netLiquidation),
        `missing ${row.source} row nlv=${row.netLiquidation}`,
      );
    }
  } finally {
    await t.cleanup();
  }
});

test("adversarial: an older valid row survives more-than-candidates newer invalid rows in a bucket", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-adv";
    await seedAccount(accountId, "100000");
    // One coarse bucket (span/buckets is large): the oldest row is a valid
    // ledger row (cash==starting, realized==0, fees==0 => passes the live-ledger
    // filter with no fills); it is buried under 8 newer wrong-source /
    // ledger-mismatched rows — many more than candidates (3).
    const base = new Date("2026-07-09T14:30:00.000Z");
    const validOld: SeedSnapshot = {
      asOf: base,
      source: "mark",
      netLiquidation: 100_000,
      cash: 100_000,
      realizedPnl: 0,
      fees: 0,
    };
    const invalidNewer: SeedSnapshot[] = [];
    for (let i = 1; i <= 8; i++) {
      invalidNewer.push({
        asOf: new Date(base.getTime() + i * 1_000),
        // wrong source AND mismatched ledger cash so the pipeline would drop them
        source: "watchlist_backtest_mark",
        netLiquidation: 5_000 + i,
        cash: 999 + i,
        realizedPnl: 123,
        fees: 7,
      });
    }
    await seedSnapshots(accountId, [validOld, ...invalidNewer]);
    const start = new Date(base.getTime() - 3_600_000);
    const end = new Date(base.getTime() + 3_600_000);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );
    const keptOldValid = sampled.some(
      (r) => r.asOf.getTime() === base.getTime() && Number(r.netLiquidation) === 100_000,
    );
    assert.ok(
      keptOldValid,
      "older valid (oldest-in-bucket / first-of-day) row must be preserved by the bounded read",
    );
  } finally {
    await t.cleanup();
  }
});

test("getShadowAccountEquityHistory produces ledger points through the bounded reader", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-e2e";
    await seedAccount(accountId, "100000");
    const now = Date.now();
    const rows: SeedSnapshot[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push({
        asOf: new Date(now - (30 - i) * 60_000),
        source: "mark",
        netLiquidation: 100_000 + i * 10,
        cash: 100_000, // matches starting balance (no fills) => valid ledger rows
        realizedPnl: 0,
        fees: 0,
      });
    }
    await seedSnapshots(accountId, rows);

    const history = await runWithShadowAccountId(accountId, () =>
      getShadowAccountEquityHistory({ range: "1D" }),
    );
    assert.ok(history.points.length > 1, "expected ledger points");
    const nlvs = history.points.map((p) => p.netLiquidation);
    assert.ok(nlvs.some((v) => v >= 100_000), "points reflect seeded netLiquidation");
  } finally {
    await t.cleanup();
  }
});

// --- Deliverable 3: write-side coalescing (unchanged quotes -> zero writes) --

test("mark refresh writes nothing when quotes are unchanged (zero marks, zero snapshots)", async () => {
  const t = await createTestDb();
  const accountId = "eqh-coalesce";
  const positionId = "00000000-0000-4000-8000-0000000000c3";
  internals.setResolveEquityMarkForTests(() => ({
    price: 130,
    bid: null,
    ask: null,
    source: "quote",
    asOf: new Date("2026-07-09T14:30:00.000Z"),
  }));
  try {
    await seedAccount(accountId, "50000");
    await db.insert(shadowPositionsTable).values({
      id: positionId,
      accountId,
      positionKey: "equity:AAPL",
      symbol: "AAPL",
      assetClass: "equity",
      positionType: "stock",
      quantity: "10",
      averageCost: "100",
      mark: "100",
      marketValue: "1000",
      unrealizedPnl: "0",
      status: "open",
    });

    const first = await runWithShadowAccountId(accountId, () =>
      refreshShadowPositionMarks(),
    );
    const marksAfterFirst = await t.db
      .select()
      .from(shadowPositionMarksTable)
      .where(eq(shadowPositionMarksTable.positionId, positionId));
    const snapsAfterFirst = await t.db
      .select()
      .from(shadowBalanceSnapshotsTable)
      .where(eq(shadowBalanceSnapshotsTable.accountId, accountId));
    assert.equal(first.updatedCount, 1);
    assert.equal(marksAfterFirst.length, 1);
    assert.equal(snapsAfterFirst.length, 1);

    // Same quote again: content is unchanged -> coalesced to zero writes.
    const second = await runWithShadowAccountId(accountId, () =>
      refreshShadowPositionMarks(),
    );
    const marksAfterSecond = await t.db
      .select()
      .from(shadowPositionMarksTable)
      .where(eq(shadowPositionMarksTable.positionId, positionId));
    const snapsAfterSecond = await t.db
      .select()
      .from(shadowBalanceSnapshotsTable)
      .where(eq(shadowBalanceSnapshotsTable.accountId, accountId));
    assert.equal(second.updatedCount, 0, "unchanged quote must not update marks");
    assert.equal(marksAfterSecond.length, 1, "no new shadow_position_marks row");
    assert.equal(snapsAfterSecond.length, 1, "no new shadow_balance_snapshots row");
  } finally {
    internals.setResolveEquityMarkForTests(null);
    await t.cleanup();
  }
});

// --- Deliverable 2: read paths do not trigger writes ------------------------
// (fast-path / chart-read structure guards live in shadow-account-read-cache.test.ts;
// this is the behavioral cooldown proof.)

test("cooldown gate prevents a second reader kick from refreshing within the window", async () => {
  const t = await createTestDb();
  const accountId = "eqh-cooldown";
  const positionId = "00000000-0000-4000-8000-0000000000d4";
  let price = 120;
  internals.setResolveEquityMarkForTests(() => ({
    price,
    bid: null,
    ask: null,
    source: "quote",
    asOf: new Date("2026-07-09T15:00:00.000Z"),
  }));
  try {
    await seedAccount(accountId, "50000");
    await db.insert(shadowPositionsTable).values({
      id: positionId,
      accountId,
      positionKey: "equity:MSFT",
      symbol: "MSFT",
      assetClass: "equity",
      positionType: "stock",
      quantity: "5",
      averageCost: "100",
      mark: "100",
      marketValue: "500",
      unrealizedPnl: "0",
      status: "open",
    });

    // First kick runs a real refresh (writes one mark).
    await runWithShadowAccountId(accountId, () =>
      internals.kickShadowPositionMarkRefresh(),
    );
    const afterFirst = await t.db
      .select()
      .from(shadowPositionMarksTable)
      .where(eq(shadowPositionMarksTable.positionId, positionId));
    assert.equal(afterFirst.length, 1);

    // Move the price so a real refresh WOULD write again, then kick immediately:
    // within the cooldown window the kick must be a no-op (no new mark).
    price = 140;
    const second = await runWithShadowAccountId(accountId, () =>
      internals.kickShadowPositionMarkRefresh(),
    );
    const afterSecond = await t.db
      .select()
      .from(shadowPositionMarksTable)
      .where(eq(shadowPositionMarksTable.positionId, positionId));
    assert.equal(second.updatedCount, 0, "second kick must be a cooldown no-op");
    assert.equal(afterSecond.length, 1, "cooldown must suppress the write");
  } finally {
    internals.setResolveEquityMarkForTests(null);
    await t.cleanup();
  }
});

// --- Deliverable 4: account-prefixed cache read matches the write -----------

test("summary day-P&L read hits the account-prefixed 1D equity-history cache", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-cachekey";
    await seedAccount(accountId, "100000");
    await seedSnapshots(accountId, [
      {
        asOf: new Date(Date.now() - 3_600_000),
        source: "mark",
        netLiquidation: 100_500,
        cash: 100_000,
        realizedPnl: 0,
        fees: 0,
      },
    ]);

    await runWithShadowAccountId(accountId, async () => {
      // Populate the base 1D history cache (written under the account-prefixed key).
      await getShadowAccountEquityHistory({ range: "1D" });
      // The summary path reads it back; before the fix this read used the raw
      // (unprefixed) key and always missed.
      const metrics = internals.readFreshCachedShadowEquityHistoryReturnMetrics({
        source: null,
      });
      assert.notEqual(
        metrics,
        undefined,
        "return-metrics read must hit the prefixed 1D cache entry",
      );
    });
  } finally {
    await t.cleanup();
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { and, asc, eq, gte, lt } from "drizzle-orm";

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
  createdAt?: Date;
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
      createdAt: row.createdAt,
    })),
  );
}

// --- Deliverable 1: bucket-first bounded projected reads -------------------

test("shadowEquityHistoryReadPolicy scales bucket size with span at a fixed candidate count", () => {
  const day = internals.shadowEquityHistoryReadPolicy(86_400_000);
  const year = internals.shadowEquityHistoryReadPolicy(365 * 86_400_000);
  const all = internals.shadowEquityHistoryReadPolicy(5 * 365 * 86_400_000);
  assert.equal(day.candidatesPerBucket, 3);
  assert.equal(year.candidatesPerBucket, 3);
  assert.equal(all.candidatesPerBucket, 3);
  assert.equal(day.bucketMs, 60_000, "1D remains minute-dense");
  assert.ok(year.bucketMs > day.bucketMs, "longer span => coarser buckets");
  assert.ok(
    all.bucketMs > year.bucketMs,
    "ALL derives a coarser bucket from its span",
  );
  // total sampled rows track the budget: buckets*(candidates+1) ~= budget
  const yearBuckets = (365 * 86_400_000) / year.bucketMs;
  assert.ok(
    yearBuckets * (year.candidatesPerBucket + 1) <= 1_400,
    `bucket count must keep the read bounded, got ${yearBuckets}`,
  );
  // a sub-minute span is floored, never sub-minute buckets
  assert.equal(internals.shadowEquityHistoryReadPolicy(1_000).bucketMs, 60_000);
});

test("default shadow history never splices replay snapshots into the live ledger", () => {
  const createdAt = new Date("2026-07-16T20:00:01.000Z");
  const row = (source: string, asOf: string, netLiquidation: number) => ({
    source,
    asOf: new Date(asOf),
    createdAt,
    cash: "100000",
    realizedPnl: "0",
    fees: "0",
    netLiquidation: String(netLiquidation),
  });
  const live = row("mark", "2026-07-16T20:00:00.000Z", 101000);
  const replay = row(
    "signal_options_replay",
    "2026-07-16T19:59:00.000Z",
    50000,
  );
  const replayMark = row(
    "signal_options_replay_mark",
    "2026-07-16T19:59:30.000Z",
    51000,
  );

  const result = internals.buildDefaultShadowEquityHistoryRows(
    [replay, replayMark, live],
    {
      account: { startingBalance: "100000" },
      fills: [],
    },
  );

  assert.deepEqual(result, [live]);
});

test("bucket-first reader bounds a dense span below the raw row count", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-bound";
    await seedAccount(accountId);
    const end = new Date("2026-07-09T20:00:00.000Z");
    const start = new Date(end.getTime() - 2 * 3_600_000);
    const total = 720; // one every 10s across two dense hours
    const rows: SeedSnapshot[] = [];
    for (let i = 0; i < total; i++) {
      rows.push({
        asOf: new Date(start.getTime() + i * 10_000),
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
      sampled.length < total,
      `expected a bounded read, got ${sampled.length} of ${total}`,
    );
    assert.ok(
      sampled.length <= 2 * 60 * 4 + 1,
      "at most newest-3 + oldest per minute",
    );
    // sorted ascending by asOf
    for (let i = 1; i < sampled.length; i++) {
      assert.ok(sampled[i - 1]!.asOf.getTime() <= sampled[i]!.asOf.getTime());
    }
    // newest and oldest raw rows are both retained
    const asOfMs = sampled.map((r) => r.asOf.getTime());
    assert.equal(Math.min(...asOfMs), start.getTime());
    assert.equal(
      Math.max(...asOfMs),
      new Date(end.getTime() - 10_000).getTime(),
    );
  } finally {
    await t.cleanup();
  }
});

test("bucket-first reader keeps the requested range end-exclusive", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-end-bound";
    await seedAccount(accountId);
    const start = new Date("2026-07-09T14:30:00.000Z");
    const end = new Date("2026-07-09T14:35:00.000Z");
    await seedSnapshots(accountId, [
      { asOf: start, source: "mark", netLiquidation: 100_000 },
      {
        asOf: new Date(end.getTime() - 1),
        source: "mark",
        netLiquidation: 100_001,
      },
      { asOf: end, source: "mark", netLiquidation: 100_002 },
      {
        asOf: new Date(end.getTime() + 1),
        source: "mark",
        netLiquidation: 100_003,
      },
    ]);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );

    assert.deepEqual(
      sampled.map((row) => row.asOf.getTime()),
      [start.getTime(), end.getTime() - 1],
    );
  } finally {
    await t.cleanup();
  }
});

test("bucket-first reader always includes authoritative correction anchors", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-correction-anchor";
    await seedAccount(accountId);
    const start = new Date("2026-07-16T19:59:00.000Z");
    const end = new Date("2026-07-16T20:01:00.000Z");
    await seedSnapshots(accountId, [
      ...Array.from({ length: 6 }, (_, index) => ({
        asOf: new Date(start.getTime() + index * 10_000),
        source: "mark",
        netLiquidation: 100_000 + index,
      })),
      {
        asOf: new Date(start.getTime() + 15_000),
        source: "ledger_correction_history",
        netLiquidation: 101_000,
      },
    ]);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );

    assert.ok(
      sampled.some((row) => row.source === "ledger_correction_history"),
    );
  } finally {
    await t.cleanup();
  }
});

test("bucket-first reader keeps each UTC day's terminal across coarse multi-day buckets", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-daily-terminal";
    await seedAccount(accountId);
    const start = new Date("2025-07-01T00:00:00.000Z");
    const terminalAt = new Date("2025-07-01T20:00:00.000Z");
    const end = new Date("2026-07-01T00:00:00.000Z");
    await seedSnapshots(accountId, [
      {
        asOf: new Date("2025-07-01T00:01:00.000Z"),
        source: "mark",
        netLiquidation: 100_000,
      },
      {
        asOf: terminalAt,
        source: "mark",
        netLiquidation: 101_000,
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        asOf: new Date(`2025-07-02T01:0${index}:00.000Z`),
        source: "automation_mark",
        netLiquidation: 102_000 + index,
      })),
    ]);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );

    assert.ok(
      sampled.some((row) => row.asOf.getTime() === terminalAt.getTime()),
      "the prior day's closing NAV must not disappear inside a coarse 1Y bucket",
    );
  } finally {
    await t.cleanup();
  }
});

test("bucket-first reader keeps live ledger-correction checkpoints", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-live-correction-anchor";
    await seedAccount(accountId);
    const start = new Date("2025-07-01T00:00:00.000Z");
    const correctionAt = new Date("2025-07-01T02:49:24.000Z");
    const end = new Date("2026-07-01T00:00:00.000Z");
    await seedSnapshots(accountId, [
      {
        asOf: new Date("2025-07-01T00:01:00.000Z"),
        source: "mark",
        netLiquidation: 99_000,
      },
      {
        asOf: correctionAt,
        source: "ledger_correction",
        netLiquidation: 100_000,
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        asOf: new Date(`2025-07-01T20:0${index}:00.000Z`),
        source: "automation_mark",
        netLiquidation: 101_000 + index,
      })),
    ]);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );

    assert.ok(
      sampled.some((row) => row.asOf.getTime() === correctionAt.getTime()),
      "a live correction can be the only valid prior-close baseline",
    );
  } finally {
    await t.cleanup();
  }
});

test("returned history preserves a correction anchor through timestamp and display-bucket compaction", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-correction-compaction";
    await seedAccount(accountId);
    const anchorAt = new Date("2026-07-16T20:02:00.000Z");
    await seedSnapshots(accountId, [
      {
        asOf: new Date("2026-07-16T14:30:00.000Z"),
        source: "mark",
        netLiquidation: 100_000,
      },
      {
        asOf: anchorAt,
        source: "ledger_correction",
        netLiquidation: 101_000,
        createdAt: new Date("2026-07-16T20:02:01.000Z"),
      },
      {
        asOf: anchorAt,
        source: "mark",
        netLiquidation: 99_000,
        createdAt: new Date("2026-07-16T20:02:02.000Z"),
      },
      {
        asOf: new Date("2026-07-16T20:04:00.000Z"),
        source: "mark",
        netLiquidation: 102_000,
      },
    ]);

    const history = await runWithShadowAccountId(accountId, () =>
      getShadowAccountEquityHistory({ range: "1Y" }),
    );

    assert.ok(
      history.points.some(
        (point) =>
          point.timestamp.getTime() === anchorAt.getTime() &&
          point.netLiquidation === 101_000,
      ),
      "the authoritative anchor must survive same-timestamp and later same-bucket marks",
    );
  } finally {
    await t.cleanup();
  }
});

test("bucket-first reader matches the source-eligible broad pipeline", async () => {
  const t = await createTestDb();
  try {
    const accountId = "eqh-superset";
    await seedAccount(accountId);
    const base = new Date("2026-07-09T14:30:00.000Z");
    const fixture: SeedSnapshot[] = [
      {
        asOf: new Date(base.getTime() + 0),
        source: "mark",
        netLiquidation: 100_100,
      },
      {
        asOf: new Date(base.getTime() + 60_000),
        source: "automation_mark",
        netLiquidation: 100_150,
      },
      {
        asOf: new Date(base.getTime() + 120_000),
        source: "automation",
        netLiquidation: 100_200,
      },
      {
        asOf: new Date(base.getTime() + 180_000),
        source: "signal_options_replay",
        netLiquidation: 55_000,
      },
      {
        asOf: new Date(base.getTime() + 240_000),
        source: "watchlist_backtest:1D",
        netLiquidation: 42_000,
      },
      {
        asOf: new Date(base.getTime() + 300_000),
        source: "watchlist_backtest_mark",
        netLiquidation: 42_050,
      },
      {
        asOf: new Date(base.getTime() + 360_000),
        source: "mark",
        netLiquidation: 100_250,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        asOf: new Date(base.getTime() + 365_000 + index * 5_000),
        source: "mark",
        netLiquidation: 9_000 + index,
        cash: 999,
        realizedPnl: 123,
        fees: 7,
      })),
    ];
    await seedSnapshots(accountId, fixture);
    const start = new Date(base.getTime() - 60_000);
    const end = new Date(base.getTime() + 480_000);

    const sampled = await runWithShadowAccountId(accountId, () =>
      internals.readShadowEquityHistorySnapshotRowsBucketed({
        accountId,
        start,
        end,
      }),
    );
    // Test-only copy of the replaced broad read. Apply the same source
    // eligibility that now runs inside each bounded SQL probe, then compare the
    // unchanged selection/live-ledger/compaction/display-bucketing pipeline.
    const broad = await t.db
      .select()
      .from(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, accountId),
          gte(shadowBalanceSnapshotsTable.asOf, start),
          lt(shadowBalanceSnapshotsTable.asOf, end),
        ),
      )
      .orderBy(
        asc(shadowBalanceSnapshotsTable.asOf),
        asc(shadowBalanceSnapshotsTable.createdAt),
        asc(shadowBalanceSnapshotsTable.id),
      );
    assert.ok(
      sampled.length < broad.length,
      "fixture must exercise bounded sampling",
    );

    type ComparisonSource =
      | null
      | "automation"
      | "signal_options_replay"
      | "watchlist_backtest";
    type PipelineRow = Pick<
      (typeof broad)[number],
      | "id"
      | "asOf"
      | "source"
      | "cash"
      | "realizedPnl"
      | "fees"
      | "netLiquidation"
      | "createdAt"
    >;
    const sourceEligibleRows = (
      rows: PipelineRow[],
      source: ComparisonSource,
    ) => {
      const replaySource = (row: PipelineRow) =>
        row.source === "signal_options_replay" ||
        row.source === "signal_options_replay_mark";
      const watchlistSource = (row: PipelineRow) =>
        row.source === "watchlist_backtest_mark" ||
        row.source.startsWith("watchlist_backtest:") ||
        row.source.startsWith("watchlist_bt:");
      if (source === "signal_options_replay") {
        return rows.filter(replaySource);
      }
      if (source === "watchlist_backtest") {
        return rows.filter(watchlistSource);
      }
      return rows.filter((row) => !replaySource(row) && !watchlistSource(row));
    };
    const pipelineOutput = (rows: PipelineRow[], source: ComparisonSource) => {
      const selection = internals.selectShadowEquityHistoryRows(
        sourceEligibleRows(rows, source),
        {
          source,
        },
      );
      const ledgerRows =
        source === "signal_options_replay" || source === "watchlist_backtest"
          ? selection.rows
          : source
            ? internals.filterShadowEquityHistoryRowsToLiveLedger(
                selection.rows,
                {
                  account: { startingBalance: "100000" },
                  fills: [],
                },
              )
            : internals.buildDefaultShadowEquityHistoryRows(selection.rows, {
                account: { startingBalance: "100000" },
                fills: [],
              });
      const compacted = internals.compactShadowEquityHistoryRows(ledgerRows);
      return internals
        .bucketShadowEquityHistoryRows(compacted, 60_000)
        .map((row) => ({
          asOf: row.asOf.toISOString(),
          source: row.source,
          cash: row.cash,
          realizedPnl: row.realizedPnl,
          fees: row.fees,
          netLiquidation: row.netLiquidation,
        }));
    };

    for (const source of [
      null,
      "automation",
      "signal_options_replay",
      "watchlist_backtest",
    ] as const) {
      const boundedRows =
        source == null
          ? sampled
          : await runWithShadowAccountId(accountId, () =>
              internals.readShadowEquityHistorySnapshotRowsBucketed({
                accountId,
                start,
                end,
                source,
              }),
            );
      assert.deepEqual(
        pipelineOutput(boundedRows, source),
        pipelineOutput(broad, source),
        `bounded and broad outputs differ for ${source ?? "ledger"}`,
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
      (r) =>
        r.asOf.getTime() === base.getTime() &&
        Number(r.netLiquidation) === 100_000,
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
    assert.ok(
      nlvs.some((v) => v >= 100_000),
      "points reflect seeded netLiquidation",
    );
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
      openedAt: new Date("2026-07-09T14:00:00.000Z"),
      asOf: new Date("2026-07-09T14:00:00.000Z"),
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
    assert.equal(
      second.updatedCount,
      0,
      "unchanged quote must not update marks",
    );
    assert.equal(
      marksAfterSecond.length,
      1,
      "no new shadow_position_marks row",
    );
    assert.equal(
      snapsAfterSecond.length,
      1,
      "no new shadow_balance_snapshots row",
    );
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
      openedAt: new Date("2026-07-09T14:00:00.000Z"),
      asOf: new Date("2026-07-09T14:00:00.000Z"),
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
    assert.equal(
      second.updatedCount,
      0,
      "second kick must be a cooldown no-op",
    );
    assert.equal(afterSecond.length, 1, "cooldown must suppress the write");
  } finally {
    internals.setResolveEquityMarkForTests(null);
    await t.cleanup();
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { eq } from "drizzle-orm";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  getShadowAccountPositionsAtDate,
  recordShadowAutomationEvent,
  SHADOW_ACCOUNT_ID,
} from "./shadow-account";

const source = readFileSync(
  new URL("./shadow-account.ts", import.meta.url),
  "utf8",
);

test("snapshot totals read one latest mark per requested position", () => {
  const start = source.indexOf("async function latestShadowPositionMarksAt");
  const end = source.indexOf(
    "async function computeShadowSnapshotTotalsAt",
    start,
  );
  assert.notEqual(start, -1, "Missing latestShadowPositionMarksAt");
  assert.notEqual(end, -1, "Missing latestShadowPositionMarksAt end marker");
  const body = source.slice(start, end);

  assert.match(
    body,
    /from unnest\(\$2::uuid\[\], \$3::timestamptz\[\]\) as requested\(position_id, opened_at\)/,
  );
  assert.match(body, /join lateral \(/);
  assert.match(body, /as_of >= requested\.opened_at/);
  assert.match(body, /order by as_of desc, created_at desc, id desc/);
  assert.match(body, /limit 1/);
  assert.doesNotMatch(
    body,
    /\.select\(\)\s*\.from\(shadowPositionMarksTable\)/,
  );
});

test("position peak marks use lateral top-one probes instead of grouped scans", () => {
  const start = source.indexOf(
    "async function readShadowPositionPeakMarkPrices",
  );
  const end = source.indexOf("function signalOptionsShadowQuotePayload", start);
  assert.notEqual(start, -1, "Missing readShadowPositionPeakMarkPrices");
  assert.notEqual(
    end,
    -1,
    "Missing readShadowPositionPeakMarkPrices end marker",
  );
  const body = source.slice(start, end);

  assert.match(
    body,
    /from unnest\(\$1::uuid\[\], \$2::timestamptz\[\]\) as requested\(position_id, opened_at\)/,
  );
  assert.match(body, /left join lateral \(/);
  assert.match(body, /as_of >= requested\.opened_at/);
  assert.match(body, /order by mark desc/);
  assert.match(body, /limit 1/);
  assert.doesNotMatch(body, /max\(\$\{shadowPositionMarksTable\.mark\}\)/);
  assert.doesNotMatch(
    body,
    /\.groupBy\(shadowPositionMarksTable\.positionId\)/,
  );
});

test("shadow position mark refresh batches mark writes", () => {
  const refreshStart = source.indexOf(
    "export async function refreshShadowPositionMarks",
  );
  const refreshEnd = source.indexOf(
    "async function ensureFreshShadowState",
    refreshStart,
  );
  assert.notEqual(refreshStart, -1, "Missing refreshShadowPositionMarks");
  assert.notEqual(
    refreshEnd,
    -1,
    "Missing refreshShadowPositionMarks end marker",
  );
  const refreshBody = source.slice(refreshStart, refreshEnd);

  assert.match(
    refreshBody,
    /const markWrites: ShadowPositionMarkRefreshWrite\[\] = \[\]/,
  );
  assert.match(
    refreshBody,
    /const appliedMarkWrites = await writeShadowPositionMarkBatch\(\s*markWrites,\s*executableBidPeakWrites,\s*\)/,
  );
  assert.match(refreshBody, /const updatedCount = appliedMarkWrites\.length/);
  assert.doesNotMatch(refreshBody, /\.update\(shadowPositionsTable\)/);
  assert.doesNotMatch(refreshBody, /db\.insert\(shadowPositionMarksTable\)/);

  const batchStart = source.indexOf(
    "async function writeShadowPositionMarkBatch",
  );
  const batchEnd = source.indexOf(
    "export async function refreshShadowPositionMarks",
    batchStart,
  );
  assert.notEqual(batchStart, -1, "Missing writeShadowPositionMarkBatch");
  assert.notEqual(
    batchEnd,
    -1,
    "Missing writeShadowPositionMarkBatch end marker",
  );
  const batchBody = source.slice(batchStart, batchEnd);

  assert.match(batchBody, /\.insert\(shadowPositionMarksTable\)\.values\(/);
  assert.match(batchBody, /update shadow_positions as p/);
  assert.match(batchBody, /from unnest\(/);
  assert.match(batchBody, /array\[\$\{positionIds\}\]::uuid\[\]/);
  assert.match(batchBody, /p\.opened_at = batched\.opened_at/);
  assert.match(batchBody, /p\.as_of <= batched\.as_of/);
  assert.match(batchBody, /returning p\.id/);
  assert.match(batchBody, /executable_bid_peak = greatest\(/);
  assert.match(batchBody, /p\.opened_at = checkpoint\.opened_at/);
});

test("mark batches cannot cross a reopen or regress the lifecycle clock", async () => {
  await withTestDb(async () => {
    const positionId = "00000000-0000-4000-8000-000000000477";
    const openedAt = new Date("2026-07-16T14:30:00.000Z");
    const reopenedAt = new Date("2026-07-16T15:00:00.000Z");
    const advancedAt = new Date("2026-07-16T15:30:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [capturedPosition] = await db
      .insert(shadowPositionsTable)
      .values({
        id: positionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:CRM",
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "1",
        mark: "1",
        marketValue: "1",
        unrealizedPnl: "0",
        openedAt,
        asOf: openedAt,
        status: "open",
      })
      .returning();
    assert.ok(capturedPosition);
    await db
      .update(shadowPositionsTable)
      .set({
        openedAt: reopenedAt,
        asOf: reopenedAt,
        mark: "5",
        marketValue: "5",
        unrealizedPnl: "4",
      })
      .where(eq(shadowPositionsTable.id, positionId));
    const [reopenedPosition] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, positionId));
    assert.ok(reopenedPosition);

    const crossLifecycleWrites =
      await internals.writeShadowPositionMarkBatchForTests([
        {
          position: capturedPosition,
          contract: null,
          optionQuote: null,
          optionPricing: null,
          markPrice: 2,
          mark: "2",
          marketValue: "2",
          unrealizedPnl: "1",
          source: "quote",
          asOf: new Date("2026-07-16T15:15:00.000Z"),
          updatedAt: new Date("2026-07-16T15:15:00.000Z"),
        },
      ]);
    assert.equal(crossLifecycleWrites.length, 0);
    await db
      .update(shadowPositionsTable)
      .set({
        asOf: advancedAt,
        mark: "5",
        marketValue: "5",
        unrealizedPnl: "4",
      })
      .where(eq(shadowPositionsTable.id, positionId));
    const outOfOrderWrites =
      await internals.writeShadowPositionMarkBatchForTests([
        {
          position: reopenedPosition,
          contract: null,
          optionQuote: null,
          optionPricing: null,
          markPrice: 4,
          mark: "4",
          marketValue: "4",
          unrealizedPnl: "3",
          source: "quote",
          asOf: new Date("2026-07-16T15:20:00.000Z"),
          updatedAt: new Date("2026-07-16T15:20:00.000Z"),
        },
      ]);
    assert.equal(outOfOrderWrites.length, 0);

    const [current] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, positionId));
    assert.equal(current?.openedAt.getTime(), reopenedAt.getTime());
    assert.equal(current?.asOf.getTime(), advancedAt.getTime());
    assert.equal(current?.mark, "5.000000");
    assert.equal(
      (
        await db
          .select()
          .from(shadowPositionMarksTable)
          .where(eq(shadowPositionMarksTable.positionId, positionId))
      ).length,
      0,
    );
  });
});

test("equal-time mark writes cannot diverge from the canonical latest mark", async () => {
  await withTestDb(async () => {
    const positionId = "00000000-0000-4000-8000-000000000521";
    const openedAt = new Date("2026-07-16T14:30:00.000Z");
    const markedAt = new Date("2026-07-16T15:00:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        id: positionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:CRM",
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "1",
        mark: "2",
        marketValue: "2",
        unrealizedPnl: "1",
        openedAt,
        asOf: markedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);
    await db.insert(shadowPositionMarksTable).values({
      id: "00000000-0000-4000-8000-000000000522",
      accountId: SHADOW_ACCOUNT_ID,
      positionId,
      mark: "2",
      marketValue: "2",
      unrealizedPnl: "1",
      source: "automation",
      asOf: markedAt,
      createdAt: new Date("2099-01-01T00:00:00.000Z"),
      updatedAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const applied = await internals.writeShadowPositionMarkBatchForTests([
      {
        position,
        contract: null,
        optionQuote: null,
        optionPricing: null,
        markPrice: 3,
        mark: "3",
        marketValue: "3",
        unrealizedPnl: "2",
        source: "quote",
        asOf: markedAt,
        updatedAt: new Date(),
      },
    ]);
    const [current] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, positionId));
    const canonical = (
      await internals.latestShadowPositionMarksAtForTests(
        [position],
        new Date("2026-07-16T15:01:00.000Z"),
      )
    ).get(positionId);

    assert.equal(applied.length, 0);
    assert.equal(current?.mark, canonical?.mark);
    assert.equal(current?.marketValue, canonical?.marketValue);
  });
});

test("latest marks do not leak from an earlier lifecycle", async () => {
  await withTestDb(async () => {
    const positionId = "00000000-0000-4000-8000-000000000478";
    const openedAt = new Date("2026-07-16T15:00:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        id: positionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:CRM",
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "2",
        mark: "2",
        marketValue: "2",
        unrealizedPnl: "0",
        openedAt,
        asOf: openedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);
    await db.insert(shadowPositionMarksTable).values({
      accountId: SHADOW_ACCOUNT_ID,
      positionId,
      mark: "9",
      marketValue: "9",
      unrealizedPnl: "8",
      source: "quote",
      asOf: new Date("2026-07-16T14:45:00.000Z"),
    });

    const marks = await internals.latestShadowPositionMarksAtForTests(
      [position],
      new Date("2026-07-16T16:00:00.000Z"),
    );
    assert.equal(marks.has(positionId), false);
  });
});

test("day-change baseline marks are lifecycle-bounded and totally ordered", () => {
  const start = source.indexOf(
    "async function readLatestShadowPositionBaselineMarks",
  );
  const end = source.indexOf(
    "\nfunction shadowPositionNeedsDayChangeQuote",
    start,
  );
  assert.notEqual(start, -1, "Missing readLatestShadowPositionBaselineMarks");
  assert.notEqual(end, -1, "Missing baseline-mark reader boundary");
  const body = source.slice(start, end);

  assert.match(
    body,
    /from unnest\(\$2::uuid\[\], \$3::timestamptz\[\]\) as requested\(position_id, opened_at\)/,
  );
  assert.match(body, /as_of >= requested\.opened_at/);
  assert.match(body, /order by as_of desc, created_at desc, id desc/);
});

test("reopened positions ignore day-change marks from their prior lifecycle", async () => {
  await withTestDb(async () => {
    const positionId = "00000000-0000-4000-8000-000000000517";
    const openedAt = new Date("2026-07-16T15:00:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        id: positionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:CRM",
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "100",
        mark: "100",
        marketValue: "100",
        unrealizedPnl: "0",
        openedAt,
        asOf: new Date("2026-07-16T15:30:00.000Z"),
        status: "open",
      })
      .returning();
    assert.ok(position);
    await db.insert(shadowPositionMarksTable).values({
      accountId: SHADOW_ACCOUNT_ID,
      positionId,
      mark: "500",
      marketValue: "500",
      unrealizedPnl: "400",
      source: "quote",
      asOf: new Date("2026-07-15T20:00:00.000Z"),
    });

    const changes = await internals.readShadowPositionDayChangesForTests(
      [position],
      new Date("2026-07-16T16:00:00.000Z"),
      null,
      { fetchMissingOptionQuotes: false },
    );

    assert.deepEqual(changes.get(positionId), {
      dayChange: 0,
      dayChangePercent: 0,
    });
  });
});

test("day-change baseline timestamp ties choose the highest mark id", async () => {
  await withTestDb(async () => {
    const positionId = "00000000-0000-4000-8000-000000000518";
    const lowerId = "00000000-0000-4000-8000-000000000519";
    const higherId = "00000000-0000-4000-8000-000000000520";
    const openedAt = new Date("2026-07-15T14:00:00.000Z");
    const tiedAt = new Date("2026-07-16T03:00:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        id: positionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:CRM",
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "100",
        mark: "100",
        marketValue: "100",
        unrealizedPnl: "0",
        openedAt,
        asOf: tiedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);
    await db.insert(shadowPositionMarksTable).values([
      {
        id: lowerId,
        accountId: SHADOW_ACCOUNT_ID,
        positionId,
        mark: "7",
        marketValue: "700",
        unrealizedPnl: "600",
        source: "quote",
        asOf: tiedAt,
        createdAt: tiedAt,
      },
      {
        id: higherId,
        accountId: SHADOW_ACCOUNT_ID,
        positionId,
        mark: "8",
        marketValue: "800",
        unrealizedPnl: "700",
        source: "quote",
        asOf: tiedAt,
        createdAt: tiedAt,
      },
    ]);

    const marks = await internals.readLatestShadowPositionBaselineMarksForTests(
      [position],
      new Date("2026-07-16T04:00:00.000Z"),
    );

    assert.equal(marks[0]?.id, higherId);
  });
});

test("batched peak marks do not leak from an earlier lifecycle", async () => {
  await withTestDb(async () => {
    const positionId = "00000000-0000-4000-8000-000000000479";
    const openedAt = new Date("2026-07-16T15:00:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        id: positionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:CRM",
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "2",
        mark: "2",
        marketValue: "2",
        unrealizedPnl: "0",
        openedAt,
        asOf: openedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);
    await db.insert(shadowPositionMarksTable).values({
      accountId: SHADOW_ACCOUNT_ID,
      positionId,
      mark: "9",
      marketValue: "9",
      unrealizedPnl: "8",
      source: "quote",
      asOf: new Date("2026-07-16T14:45:00.000Z"),
    });

    const peaks = await internals.readShadowPositionPeakMarkPricesForTests([
      position,
    ]);
    assert.equal(peaks.get(positionId), 2);
  });
});

test("latest mark timestamp ties use the mark id as a total-order tiebreak", async () => {
  await withTestDb(async () => {
    const positionId = "00000000-0000-4000-8000-000000000480";
    const openedAt = new Date("2026-07-16T15:00:00.000Z");
    const tiedAt = new Date("2026-07-16T15:30:00.000Z");
    const lowerId = "00000000-0000-4000-8000-000000000481";
    const higherId = "00000000-0000-4000-8000-000000000482";
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        id: positionId,
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: "equity:CRM",
        symbol: "CRM",
        assetClass: "equity",
        positionType: "stock",
        quantity: "1",
        averageCost: "2",
        mark: "2",
        marketValue: "2",
        unrealizedPnl: "0",
        openedAt,
        asOf: openedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);
    await db.insert(shadowPositionMarksTable).values([
      {
        id: higherId,
        accountId: SHADOW_ACCOUNT_ID,
        positionId,
        mark: "8",
        marketValue: "8",
        unrealizedPnl: "6",
        source: "quote",
        asOf: tiedAt,
        createdAt: tiedAt,
        updatedAt: tiedAt,
      },
      {
        id: lowerId,
        accountId: SHADOW_ACCOUNT_ID,
        positionId,
        mark: "7",
        marketValue: "7",
        unrealizedPnl: "5",
        source: "quote",
        asOf: tiedAt,
        createdAt: tiedAt,
        updatedAt: tiedAt,
      },
    ]);

    const marks = await internals.latestShadowPositionMarksAtForTests(
      [position],
      new Date("2026-07-16T16:00:00.000Z"),
    );
    assert.equal(marks.get(positionId)?.id, higherId);
  });
});

test("historical snapshot marks use the lifecycle reconstructed from fills", async () => {
  await withTestDb(async () => {
    const orderId = "00000000-0000-4000-8000-000000000483";
    const positionId = "00000000-0000-4000-8000-000000000484";
    const openedAt = new Date("2026-07-16T14:30:00.000Z");
    const markedAt = new Date("2026-07-16T14:45:00.000Z");
    const valuationAt = new Date("2026-07-16T14:50:00.000Z");
    const laterReopenAt = new Date("2026-07-17T14:00:00.000Z");
    internals.invalidateShadowFreshStateCache();
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(shadowOrdersTable).values({
      id: orderId,
      accountId: SHADOW_ACCOUNT_ID,
      source: "manual",
      symbol: "CRM",
      assetClass: "equity",
      side: "buy",
      quantity: "1",
      filledQuantity: "1",
      placedAt: openedAt,
      filledAt: openedAt,
      status: "filled",
    });
    await db.insert(shadowFillsTable).values({
      accountId: SHADOW_ACCOUNT_ID,
      orderId,
      symbol: "CRM",
      assetClass: "equity",
      side: "buy",
      quantity: "1",
      price: "1",
      grossAmount: "1",
      cashDelta: "-1",
      occurredAt: openedAt,
    });
    await db.insert(shadowPositionsTable).values({
      id: positionId,
      accountId: SHADOW_ACCOUNT_ID,
      positionKey: "equity:CRM",
      symbol: "CRM",
      assetClass: "equity",
      positionType: "stock",
      quantity: "1",
      averageCost: "1",
      mark: "1",
      marketValue: "1",
      unrealizedPnl: "0",
      openedAt: laterReopenAt,
      asOf: laterReopenAt,
      status: "open",
    });
    await db.insert(shadowPositionMarksTable).values({
      accountId: SHADOW_ACCOUNT_ID,
      positionId,
      mark: "3",
      marketValue: "3",
      unrealizedPnl: "2",
      source: "quote",
      asOf: markedAt,
    });

    const totals = await internals.computeShadowSnapshotTotalsAtForTests(
      null,
      valuationAt,
    );
    assert.equal(totals.marketValue, 3);
    assert.equal(totals.unrealizedPnl, 2);
    assert.equal(totals.netLiquidation, 25_002);
    const positionsAtDate = await getShadowAccountPositionsAtDate({
      date: "2026-07-16",
    });
    assert.equal(positionsAtDate.positions[0]?.mark, 3);
    internals.invalidateShadowFreshStateCache();
  });
});

test("historical snapshot folds preserve committed equal-time fill causality", async () => {
  await withTestDb(async () => {
    const occurredAt = new Date("2026-07-16T14:30:00.000Z");
    const buyOrderId = "00000000-0000-4000-8000-000000000487";
    const sellOrderId = "00000000-0000-4000-8000-000000000488";
    const buyFillId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const sellFillId = "00000000-0000-4000-8000-000000000489";
    internals.invalidateShadowFreshStateCache();
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    await db.insert(shadowOrdersTable).values([
      {
        id: buyOrderId,
        accountId: SHADOW_ACCOUNT_ID,
        source: "manual",
        symbol: "CRM",
        assetClass: "equity",
        side: "buy",
        quantity: "1",
        filledQuantity: "1",
        placedAt: occurredAt,
        filledAt: occurredAt,
        status: "filled",
      },
      {
        id: sellOrderId,
        accountId: SHADOW_ACCOUNT_ID,
        source: "manual",
        symbol: "CRM",
        assetClass: "equity",
        side: "sell",
        quantity: "1",
        filledQuantity: "1",
        placedAt: occurredAt,
        filledAt: occurredAt,
        status: "filled",
      },
    ]);
    await db.insert(shadowFillsTable).values({
      id: buyFillId,
      accountId: SHADOW_ACCOUNT_ID,
      orderId: buyOrderId,
      symbol: "CRM",
      assetClass: "equity",
      side: "buy",
      quantity: "1",
      price: "1",
      grossAmount: "1",
      cashDelta: "-1",
      occurredAt,
      createdAt: new Date("2026-07-16T14:30:01.000Z"),
    });
    await db.insert(shadowFillsTable).values({
      id: sellFillId,
      accountId: SHADOW_ACCOUNT_ID,
      orderId: sellOrderId,
      symbol: "CRM",
      assetClass: "equity",
      side: "sell",
      quantity: "1",
      price: "1",
      grossAmount: "1",
      cashDelta: "1",
      occurredAt,
      createdAt: new Date("2026-07-16T14:30:02.000Z"),
    });

    const totals = await internals.computeShadowSnapshotTotalsAtForTests(
      null,
      occurredAt,
    );

    assert.equal(totals.cash, 25_000);
    assert.equal(totals.marketValue, 0);
    assert.equal(totals.netLiquidation, 25_000);
    const positionsAtDate = await getShadowAccountPositionsAtDate({
      date: "2026-07-16",
    });
    assert.deepEqual(positionsAtDate.positions, []);
    internals.invalidateShadowFreshStateCache();
  });
});

test("shadow automation event reads keep literal predicates for partial indexes", () => {
  assert.match(
    source,
    /SIGNAL_OPTIONS_SHADOW_ENTRY_EXIT_EVENT_PREDICATE\s*=\s*sql`\$\{executionEventsTable\.eventType\} IN \('signal_options_shadow_entry', 'signal_options_shadow_exit'\)`/,
  );
  assert.match(
    source,
    /SIGNAL_OPTIONS_SHADOW_MARK_EVENT_PREDICATE\s*=\s*sql`\$\{executionEventsTable\.eventType\} = 'signal_options_shadow_mark'`/,
  );

  const repairStart = source.indexOf(
    "shadowAutomationMirrorRepairInFlight = (async () => {",
  );
  const repairEnd = source.indexOf("const missing = candidates", repairStart);
  assert.notEqual(repairStart, -1, "Missing mirror repair query");
  assert.notEqual(repairEnd, -1, "Missing mirror repair query end marker");
  const repairBody = source.slice(repairStart, repairEnd);
  assert.match(repairBody, /SIGNAL_OPTIONS_SHADOW_ENTRY_EXIT_EVENT_PREDICATE/);
  assert.doesNotMatch(repairBody, /inArray\(executionEventsTable\.eventType/);

  const marksStart = source.indexOf(
    "async function latestShadowAutomationManagementEvents",
  );
  const marksEnd = source.indexOf("const byPositionKey", marksStart);
  assert.notEqual(marksStart, -1, "Missing latest mark-event query");
  assert.notEqual(marksEnd, -1, "Missing latest mark-event query end marker");
  const marksBody = source.slice(marksStart, marksEnd);
  assert.match(marksBody, /SIGNAL_OPTIONS_SHADOW_MARK_EVENT_PREDICATE/);
  assert.doesNotMatch(marksBody, /eq\(executionEventsTable\.eventType/);
});

test("shadow automation management reads only the latest mark per requested contract", () => {
  const marksStart = source.indexOf(
    "async function latestShadowAutomationManagementEvents",
  );
  const marksEnd = source.indexOf(
    "function buildShadowAutomationContext",
    marksStart,
  );
  assert.notEqual(marksStart, -1, "Missing latest mark-event query");
  assert.notEqual(marksEnd, -1, "Missing latest mark-event query end marker");
  const marksBody = source.slice(marksStart, marksEnd);

  assert.match(
    marksBody,
    /FROM \(VALUES \$\{requestedContractsSql\}\) AS requested/i,
  );
  assert.match(marksBody, /JOIN LATERAL \(/i);
  assert.match(
    marksBody,
    /SELECT id[\s\S]*ORDER BY occurred_at DESC[\s\S]*LIMIT 1/i,
  );
  assert.match(marksBody, /inArray\(executionEventsTable\.id, eventIds\)/);
  assert.match(
    marksBody,
    /execution_events\.deployment_id = requested\.deployment_id::uuid/i,
  );
  assert.match(
    marksBody,
    /execution_events\.occurred_at >= requested\.opened_at::timestamptz/i,
  );
  assert.match(
    marksBody,
    /execution_events\.occurred_at <= CURRENT_TIMESTAMP/i,
  );
  assert.match(
    marksBody,
    /execution_events\.payload->'position'->>'openedAt'\s*=\s*requested\.opened_at/i,
  );
  assert.doesNotMatch(
    marksBody,
    /execution_events\.payload->'position'->>'openedAt'\)\:\:timestamptz/i,
  );
  assert.match(marksBody, /requested\.lifecycle_position_id/i);
  assert.match(marksBody, /requested\.lifecycle_candidate_id/i);
  assert.match(
    marksBody,
    /ORDER BY occurred_at DESC, created_at DESC, id DESC/i,
  );
  assert.doesNotMatch(marksBody, /\.limit\(1000\)/);
});

test("shadow automation management reads ignore newer historical marks", async () => {
  await withTestDb(async () => {
    const strategyId = "00000000-0000-4000-8000-000000000471";
    const deploymentId = "00000000-0000-4000-8000-000000000472";
    const liveEventId = "00000000-0000-4000-8000-000000000473";
    const historicalEventId = "00000000-0000-4000-8000-000000000474";
    const openedAt = new Date("2026-07-16T14:30:00.000Z");
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-management-history",
    };
    const positionKey = "option:CRM:2026-07-17:250:call:crm-management-history";
    await db.insert(algoStrategiesTable).values({
      id: strategyId,
      name: "Management history isolation",
      mode: "shadow",
      enabled: true,
      symbolUniverse: ["CRM"],
      config: {},
    });
    await db.insert(algoDeploymentsTable).values({
      id: deploymentId,
      strategyId,
      name: "Management history isolation",
      mode: "shadow",
      enabled: true,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbolUniverse: ["CRM"],
      config: {},
    });
    const mark = (
      id: string,
      occurredAt: string,
      metadata: Record<string, unknown>,
    ) => ({
      id,
      deploymentId,
      symbol: "CRM",
      eventType: "signal_options_shadow_mark",
      summary: "CRM management mark",
      occurredAt: new Date(occurredAt),
      payload: {
        metadata: { deploymentId, positionKey, ...metadata },
        selectedContract: contract,
        position: {
          id: `${deploymentId}:CRM`,
          candidateId: "candidate-management",
          openedAt: openedAt.toISOString(),
          selectedContract: contract,
        },
      },
    });
    await db.insert(executionEventsTable).values([
      mark(liveEventId, "2026-07-16T15:00:00.000Z", {
        runMode: "live_shadow_mark",
        runSource: "shadow_mark",
      }),
      mark(historicalEventId, "2026-07-16T15:30:00.000Z", {
        runMode: "historical_backfill",
        runSource: "signal_options_backfill",
      }),
    ]);
    const position = {
      id: "00000000-0000-4000-8000-000000000475",
      positionKey,
      symbol: "CRM",
      optionContract: contract,
      openedAt,
    } as never;
    const sourceOrder = {
      source: "automation",
      payload: { metadata: { deploymentId, positionKey } },
    } as never;

    const result =
      await internals.latestShadowAutomationManagementEventsForTests(
        [position],
        new Map([[positionKey, sourceOrder]]),
        {
          deploymentIdByPositionKey: new Map([[positionKey, deploymentId]]),
        },
      );

    assert.equal(result.get(positionKey)?.id, liveEventId);
  });
});

test("recording a future automation mark cannot mutate live stop state", async () => {
  await withTestDb(async () => {
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-future-mark",
    };
    const positionKey = "option:CRM:2026-07-17:250:call:crm-future-mark";
    const openedAt = new Date("2026-07-16T14:30:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        accountId: SHADOW_ACCOUNT_ID,
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        positionType: "option",
        quantity: "1",
        averageCost: "1",
        mark: "1",
        executableBidPeak: "1",
        executableBidPeakAsOf: openedAt,
        marketValue: "100",
        optionContract: contract,
        openedAt,
        asOf: openedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);
    const future = new Date(Date.now() + 60 * 60_000);

    const recorded = await recordShadowAutomationEvent({
      id: "00000000-0000-4000-8000-000000000476",
      deploymentId: null,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_mark" as const,
      summary: "future historical mark",
      payload: {
        metadata: {
          positionKey,
          runMode: "historical_backfill",
          runSource: "signal_options_backfill",
        },
        selectedContract: contract,
        position: {
          id: "future-mark:CRM",
          openedAt: openedAt.toISOString(),
          lastMarkPrice: 9,
          peakPrice: 9,
          lastStop: { peakEvidenceSource: "executable_bid" },
          selectedContract: contract,
        },
      },
      occurredAt: future,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.equal(recorded, null);
    const [unchanged] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, position.id));
    assert.equal(unchanged?.mark, "1.000000");
    assert.equal(unchanged?.executableBidPeak, "1.000000");
    assert.equal(
      (
        await db
          .select()
          .from(shadowPositionMarksTable)
          .where(eq(shadowPositionMarksTable.positionId, position.id))
      ).length,
      0,
    );
  });
});

test("automation marks cannot cross a reopen or regress the lifecycle clock", async () => {
  await withTestDb(async () => {
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-stale-mark",
    };
    const positionKey = "option:CRM:2026-07-17:250:call:crm-stale-mark";
    const priorOpenedAt = new Date("2026-07-16T14:30:00.000Z");
    const reopenedAt = new Date("2026-07-16T15:00:00.000Z");
    const advancedAt = new Date("2026-07-16T15:30:00.000Z");
    await db.insert(shadowAccountsTable).values({
      id: SHADOW_ACCOUNT_ID,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25000",
    });
    const [position] = await db
      .insert(shadowPositionsTable)
      .values({
        accountId: SHADOW_ACCOUNT_ID,
        positionKey,
        symbol: "CRM",
        assetClass: "option",
        positionType: "option",
        quantity: "1",
        averageCost: "1",
        mark: "5",
        executableBidPeak: "5",
        executableBidPeakAsOf: advancedAt,
        marketValue: "500",
        unrealizedPnl: "400",
        optionContract: contract,
        openedAt: reopenedAt,
        asOf: advancedAt,
        status: "open",
      })
      .returning();
    assert.ok(position);
    const markEvent = (input: {
      id: string;
      lifecycleOpenedAt: Date;
      occurredAt: Date;
    }) => ({
      id: input.id,
      deploymentId: null,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_mark" as const,
      summary: "delayed CRM mark",
      payload: {
        metadata: { positionKey },
        selectedContract: contract,
        position: {
          id: "deployment-1:CRM",
          openedAt: input.lifecycleOpenedAt.toISOString(),
          lastMarkPrice: 9,
          peakPrice: 9,
          lastStop: { peakEvidenceSource: "executable_bid" },
          selectedContract: contract,
        },
      },
      occurredAt: input.occurredAt,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    });

    const priorLifecycle = await recordShadowAutomationEvent(
      markEvent({
        id: "00000000-0000-4000-8000-000000000485",
        lifecycleOpenedAt: priorOpenedAt,
        occurredAt: new Date("2026-07-16T14:45:00.000Z"),
      }),
    );
    const outOfOrder = await recordShadowAutomationEvent(
      markEvent({
        id: "00000000-0000-4000-8000-000000000486",
        lifecycleOpenedAt: reopenedAt,
        occurredAt: new Date("2026-07-16T15:20:00.000Z"),
      }),
    );

    assert.equal(priorLifecycle, null);
    assert.equal(outOfOrder, null);
    const [unchanged] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, position.id));
    assert.equal(unchanged?.openedAt.getTime(), reopenedAt.getTime());
    assert.equal(unchanged?.asOf.getTime(), advancedAt.getTime());
    assert.equal(unchanged?.mark, "5.000000");
    assert.equal(unchanged?.executableBidPeak, "5.000000");
    assert.equal(
      (
        await db
          .select()
          .from(shadowPositionMarksTable)
          .where(eq(shadowPositionMarksTable.positionId, position.id))
      ).length,
      0,
    );
  });
});

test("automation entries persist the payload lifecycle clock when a stale creator wins", async () => {
  await withTestDb(async () => {
    const lifecycleOpenedAt = new Date("2026-07-16T14:30:00.000Z");
    const winningOccurredAt = new Date("2026-07-16T14:30:01.000Z");
    const contract = {
      ticker: "O:CRM260717C00250000",
      underlying: "CRM",
      expirationDate: "2026-07-17",
      strike: 250,
      right: "call",
      multiplier: 100,
      providerContractId: "crm-stale-entry-winner",
    };
    const positionKey = "option:CRM:2026-07-17:250:call:crm-stale-entry-winner";
    const lifecyclePosition = {
      id: "deployment-stale-entry:CRM",
      candidateId: "candidate-stale-entry",
      positionKey,
      openedAt: lifecycleOpenedAt.toISOString(),
      quantity: 1,
      selectedContract: contract,
    };
    const entry = await recordShadowAutomationEvent({
      id: "00000000-0000-4000-8000-000000000523",
      deploymentId: null,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_entry",
      summary: "later stale creator won",
      payload: {
        metadata: { positionKey },
        selectedContract: contract,
        orderPlan: { quantity: 1, simulatedFillPrice: 1 },
        position: lifecyclePosition,
      },
      occurredAt: winningOccurredAt,
      createdAt: winningOccurredAt,
      updatedAt: winningOccurredAt,
    });
    assert.ok(entry && typeof entry !== "string");
    assert.equal(entry.placedAt.getTime(), lifecycleOpenedAt.getTime());

    const [opened] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.positionKey, positionKey));
    assert.ok(opened);
    assert.equal(opened.openedAt.getTime(), lifecycleOpenedAt.getTime());

    const marked = await recordShadowAutomationEvent({
      id: "00000000-0000-4000-8000-000000000524",
      deploymentId: null,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_mark",
      summary: "canonical lifecycle mark",
      payload: {
        metadata: { positionKey },
        selectedContract: contract,
        position: { ...lifecyclePosition, lastMarkPrice: 1.25 },
      },
      occurredAt: new Date("2026-07-16T14:31:00.000Z"),
      createdAt: new Date("2026-07-16T14:31:00.000Z"),
      updatedAt: new Date("2026-07-16T14:31:00.000Z"),
    });
    assert.equal(marked, opened.id);

    const exited = await recordShadowAutomationEvent({
      id: "00000000-0000-4000-8000-000000000525",
      deploymentId: null,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "CRM",
      eventType: "signal_options_shadow_exit",
      summary: "canonical lifecycle exit",
      payload: {
        metadata: { positionKey },
        selectedContract: contract,
        exitPrice: 1.5,
        exitQuantity: 1,
        position: lifecyclePosition,
      },
      occurredAt: new Date("2026-07-16T14:32:00.000Z"),
      createdAt: new Date("2026-07-16T14:32:00.000Z"),
      updatedAt: new Date("2026-07-16T14:32:00.000Z"),
    });
    assert.ok(exited);
    const [closed] = await db
      .select()
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, opened.id));
    assert.equal(closed?.status, "closed");
  });
});

test("shadow automation mirror repair excludes mirrored events before decoding payloads", () => {
  const repairStart = source.indexOf(
    "shadowAutomationMirrorRepairInFlight = (async () => {",
  );
  const repairEnd = source.indexOf("for (const event of missing)", repairStart);
  assert.notEqual(repairStart, -1, "Missing mirror repair query");
  assert.notEqual(repairEnd, -1, "Missing mirror repair loop");
  const repairBody = source.slice(repairStart, repairEnd);

  assert.match(repairBody, /\.leftJoin\(\s*shadowOrdersTable,/);
  assert.match(repairBody, /isNull\(shadowOrdersTable\.sourceEventId\)/);
  assert.doesNotMatch(
    repairBody,
    /const mirrored = eventIds\.length/,
    "already-mirrored history must not be loaded and decoded in Node",
  );
});

test("shadow automation mirror repair excludes historical rows before its bounded selection", () => {
  const repairStart = source.indexOf(
    "shadowAutomationMirrorRepairInFlight = (async () => {",
  );
  const repairEnd = source.indexOf("const missing = candidates", repairStart);
  assert.notEqual(repairStart, -1, "Missing mirror repair query");
  assert.notEqual(repairEnd, -1, "Missing mirror repair query end marker");
  const repairBody = source.slice(repairStart, repairEnd);
  const historicalFilter = repairBody.indexOf(
    "signalOptionsHistoricalLifecycleEventSql(",
  );
  const boundedSelection = repairBody.indexOf(".limit(forwardLimit)");

  assert.notEqual(historicalFilter, -1);
  assert.notEqual(boundedSelection, -1);
  assert.ok(historicalFilter < boundedSelection);
});

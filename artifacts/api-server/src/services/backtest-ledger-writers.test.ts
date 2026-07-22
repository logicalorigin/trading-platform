import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import {
  algoDeploymentsTable,
  algoStrategiesTable,
  backtestRunExecutionsTable,
  backtestRunPointsTable,
  backtestRunsTable,
  db,
  executionEventsTable,
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
  type ExecutionEvent,
} from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  __shadowOptionMaintenanceInternalsForTests,
  __shadowWatchlistBacktestInternalsForTests,
  completeSignalOptionsReplayBacktestRun,
  failSignalOptionsReplayBacktestRun,
  fingerprintShadowAccountFoldInputsForTests,
  recordShadowAutomationEvent,
  runShadowWatchlistBacktest,
  SHADOW_ACCOUNT_ID,
  SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
  SIGNAL_OPTIONS_REPLAY_SOURCE,
  startSignalOptionsReplayBacktestRun,
} from "./shadow-account";
import {
  __signalOptionsAutomationInternalsForTests,
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  SIGNAL_OPTIONS_MARK_EVENT,
} from "./signal-options-automation";

const originalBacktestLedgerMode = process.env.PYRUS_BACKTEST_LEDGER;
const DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000221";
const WINDOW_START = new Date("2026-07-08T13:30:00.000Z");
const WINDOW_END = new Date("2026-07-08T20:00:00.000Z");

let testDb: TestDatabase;

before(async () => {
  testDb = await createTestDb();
});

after(async () => {
  if (originalBacktestLedgerMode === undefined) {
    delete process.env.PYRUS_BACKTEST_LEDGER;
  } else {
    process.env.PYRUS_BACKTEST_LEDGER = originalBacktestLedgerMode;
  }
  await testDb.cleanup();
});

beforeEach(async () => {
  process.env.PYRUS_BACKTEST_LEDGER = "own";
  await testDb.client.exec(`
    truncate table
      algo_deployments,
      algo_strategies,
      backtest_run_points,
      backtest_run_executions,
      backtest_runs,
      execution_events,
      shadow_position_marks,
      shadow_positions,
      shadow_fills,
      shadow_orders,
      shadow_balance_snapshots,
      shadow_accounts
    restart identity cascade
  `);
  await seedShadowAccount();
});

async function seedShadowAccount() {
  await db.insert(shadowAccountsTable).values({
    id: SHADOW_ACCOUNT_ID,
    displayName: "Shadow",
    startingBalance: "25000",
    cash: "25000",
  });
}

async function seedLiveFoldInput() {
  const [order] = await db
    .insert(shadowOrdersTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      source: "manual",
      symbol: "MSFT",
      assetClass: "equity",
      side: "buy",
      quantity: "1",
      filledQuantity: "1",
      averageFillPrice: "50",
      payload: {},
    })
    .returning({ id: shadowOrdersTable.id });
  await db.insert(shadowFillsTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    orderId: order!.id,
    symbol: "MSFT",
    assetClass: "equity",
    side: "buy",
    quantity: "1",
    price: "50",
    grossAmount: "50",
    fees: "1",
    realizedPnl: "0",
    cashDelta: "-51",
    occurredAt: new Date("2026-07-08T14:00:00.000Z"),
  });
}

test("a delayed older automation mark cannot rewind the materialized position", async () => {
  const contract = {
    ticker: "AAPL20260717C100",
    underlying: "AAPL",
    expirationDate: "2026-07-17",
    strike: 100,
    right: "call",
    multiplier: 100,
    providerContractId: "option-mark-causality",
  };
  const positionKey = "option:AAPL:2026-07-17:100:call:option-mark-causality";
  const [position] = await db
    .insert(shadowPositionsTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      positionKey,
      symbol: "AAPL",
      assetClass: "option",
      positionType: "option",
      quantity: "1",
      averageCost: "1",
      mark: "1",
      executableBidPeak: "1",
      executableBidPeakAsOf: new Date("2026-07-08T13:30:00.000Z"),
      marketValue: "100",
      optionContract: contract,
      openedAt: new Date("2026-07-08T13:30:00.000Z"),
      asOf: new Date("2026-07-08T13:30:00.000Z"),
      status: "open",
    })
    .returning();
  assert.ok(position);
  const markEvent = (input: {
    id: string;
    mark: number;
    peak: number;
    occurredAt: string;
    createdAt: string;
  }) =>
    ({
      id: input.id,
      deploymentId: DEPLOYMENT_ID,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_MARK_EVENT,
      summary: "AAPL automation mark",
      payload: {
        metadata: {
          deploymentId: DEPLOYMENT_ID,
          positionKey,
          runMode: "historical_backfill",
          runSource: "signal_options_backfill",
        },
        selectedContract: contract,
        position: {
          id: `${DEPLOYMENT_ID}:AAPL`,
          symbol: "AAPL",
          openedAt: "2026-07-08T13:30:00.000Z",
          peakPrice: input.peak,
          lastStop: { peakEvidenceSource: "executable_bid" },
          lastMarkPrice: input.mark,
          selectedContract: contract,
        },
      },
      occurredAt: new Date(input.occurredAt),
      createdAt: new Date(input.createdAt),
      updatedAt: new Date(input.createdAt),
    }) as ExecutionEvent;
  const newer = markEvent({
    id: "00000000-0000-4000-8000-000000000102",
    mark: 2,
    peak: 3,
    occurredAt: "2026-07-08T15:00:00.000Z",
    createdAt: "2026-07-08T15:00:01.000Z",
  });
  const delayedOlder = markEvent({
    id: "00000000-0000-4000-8000-000000000101",
    mark: 0.5,
    peak: 2,
    occurredAt: "2026-07-08T14:00:00.000Z",
    createdAt: "2026-07-08T16:00:00.000Z",
  });

  assert.equal(await recordShadowAutomationEvent(newer), position.id);
  assert.equal(await recordShadowAutomationEvent(delayedOlder), position.id);

  const [materialized] = await db
    .select()
    .from(shadowPositionsTable)
    .where(eq(shadowPositionsTable.id, position.id));
  assert.equal(materialized?.mark, "2.000000");
  assert.equal(materialized?.executableBidPeak, "3.000000");
  assert.equal(
    materialized?.executableBidPeakAsOf?.toISOString(),
    "2026-07-08T15:00:00.000Z",
  );
  assert.equal(materialized?.asOf.toISOString(), "2026-07-08T15:00:00.000Z");
  const marks = await db
    .select()
    .from(shadowPositionMarksTable)
    .where(eq(shadowPositionMarksTable.positionId, position.id));
  assert.equal(marks.length, 2);
});

test("a delayed older automation entry cannot reopen a newer closed lifecycle", async () => {
  const contract = {
    ticker: "AAPL20260717C100",
    underlying: "AAPL",
    expirationDate: "2026-07-17",
    strike: 100,
    right: "call",
    multiplier: 100,
    providerContractId: "option-fill-causality",
  };
  const positionKey = "option:AAPL:2026-07-17:100:call:option-fill-causality";
  const newerOpenedAt = new Date("2026-07-16T14:00:00.000Z");
  const newerClosedAt = new Date("2026-07-16T15:00:00.000Z");
  const [position] = await db
    .insert(shadowPositionsTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      positionKey,
      symbol: "AAPL",
      assetClass: "option",
      positionType: "option",
      quantity: "0",
      averageCost: "1.6",
      mark: "1.8",
      marketValue: "0",
      unrealizedPnl: "0",
      realizedPnl: "20",
      fees: "1",
      optionContract: contract,
      openedAt: newerOpenedAt,
      closedAt: newerClosedAt,
      asOf: newerClosedAt,
      status: "closed",
    })
    .returning();
  assert.ok(position);

  const delayedOlderEntry = {
    id: "00000000-0000-4000-8000-000000000103",
    deploymentId: DEPLOYMENT_ID,
    algoRunId: null,
    providerAccountId: SHADOW_ACCOUNT_ID,
    symbol: "AAPL",
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    summary: "AAPL delayed historical entry",
    payload: {
      metadata: {
        deploymentId: DEPLOYMENT_ID,
        positionKey,
        runMode: "historical_backfill",
        runSource: "signal_options_backfill",
      },
      selectedContract: contract,
      orderPlan: { quantity: 1, simulatedFillPrice: 1.5 },
      position: {
        id: `${DEPLOYMENT_ID}:AAPL:older`,
        symbol: "AAPL",
        openedAt: "2026-07-01T14:00:00.000Z",
        entryPrice: 1.5,
        quantity: 1,
        selectedContract: contract,
      },
    },
    occurredAt: new Date("2026-07-01T14:00:00.000Z"),
    createdAt: new Date("2026-07-16T16:00:00.000Z"),
    updatedAt: new Date("2026-07-16T16:00:00.000Z"),
  } as ExecutionEvent;

  await recordShadowAutomationEvent(delayedOlderEntry);

  const [materialized] = await db
    .select()
    .from(shadowPositionsTable)
    .where(eq(shadowPositionsTable.id, position.id));
  assert.equal(materialized?.status, "closed");
  assert.equal(materialized?.quantity, "0.000000");
  assert.equal(
    materialized?.openedAt?.toISOString(),
    newerOpenedAt.toISOString(),
  );
  assert.equal(
    materialized?.closedAt?.toISOString(),
    newerClosedAt.toISOString(),
  );
  assert.equal(materialized?.asOf.toISOString(), newerClosedAt.toISOString());

  const [order] = await db
    .select({ id: shadowOrdersTable.id })
    .from(shadowOrdersTable)
    .where(eq(shadowOrdersTable.sourceEventId, delayedOlderEntry.id));
  assert.ok(order);
  const fills = await db
    .select({ id: shadowFillsTable.id })
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.orderId, order.id));
  assert.equal(fills.length, 1);
});

test("a new lifecycle resets its executable peak while a scale-in preserves it", async () => {
  const contract = {
    ticker: "AAPL20260717C105",
    underlying: "AAPL",
    expirationDate: "2026-07-17",
    strike: 105,
    right: "call",
    multiplier: 100,
    providerContractId: "option-peak-reopen",
  };
  const positionKey = "option:AAPL:2026-07-17:105:call:option-peak-reopen";
  await db.insert(shadowPositionsTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    positionKey,
    symbol: "AAPL",
    assetClass: "option",
    positionType: "option",
    quantity: "0",
    averageCost: "1",
    mark: "1",
    executableBidPeak: "9",
    executableBidPeakAsOf: new Date("2026-07-15T15:00:00.000Z"),
    marketValue: "0",
    optionContract: contract,
    openedAt: new Date("2026-07-15T14:00:00.000Z"),
    closedAt: new Date("2026-07-15T15:00:00.000Z"),
    asOf: new Date("2026-07-15T15:00:00.000Z"),
    status: "closed",
  });
  const entryEvent = (input: {
    id: string;
    occurredAt: string;
    price: number;
  }) =>
    ({
      id: input.id,
      deploymentId: DEPLOYMENT_ID,
      algoRunId: null,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      summary: "AAPL automation entry",
      payload: {
        metadata: {
          deploymentId: DEPLOYMENT_ID,
          positionKey,
          runMode: "historical_backfill",
          runSource: "signal_options_backfill",
        },
        selectedContract: contract,
        orderPlan: { quantity: 1, simulatedFillPrice: input.price },
        position: {
          id: `${DEPLOYMENT_ID}:AAPL:${input.id}`,
          symbol: "AAPL",
          openedAt: input.occurredAt,
          entryPrice: input.price,
          quantity: 1,
          selectedContract: contract,
        },
      },
      occurredAt: new Date(input.occurredAt),
      createdAt: new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt),
    }) as ExecutionEvent;

  await recordShadowAutomationEvent(
    entryEvent({
      id: "00000000-0000-4000-8000-000000000112",
      occurredAt: "2026-07-16T14:00:00.000Z",
      price: 1.5,
    }),
  );
  const [reopened] = await db
    .select()
    .from(shadowPositionsTable)
    .where(eq(shadowPositionsTable.positionKey, positionKey));
  assert.equal(reopened?.executableBidPeak, "1.500000");
  assert.equal(
    reopened?.executableBidPeakAsOf?.toISOString(),
    "2026-07-16T14:00:00.000Z",
  );

  await recordShadowAutomationEvent(
    entryEvent({
      id: "00000000-0000-4000-8000-000000000113",
      occurredAt: "2026-07-16T14:01:00.000Z",
      price: 2,
    }),
  );
  const [scaledIn] = await db
    .select()
    .from(shadowPositionsTable)
    .where(eq(shadowPositionsTable.positionKey, positionKey));
  assert.equal(scaledIn?.quantity, "2.000000");
  assert.equal(scaledIn?.executableBidPeak, "1.500000");
  assert.equal(
    scaledIn?.executableBidPeakAsOf?.toISOString(),
    "2026-07-16T14:00:00.000Z",
  );
});

test("production closed reconciliation recognizes a legacy final exit without openedAt", async () => {
  const contract = {
    ticker: "AAPL20260717C100",
    underlying: "AAPL",
    expirationDate: "2026-07-17",
    strike: 100,
    right: "call",
    multiplier: 100,
    providerContractId: "option-legacy-final-exit",
  };
  const positionKey =
    "option:AAPL:2026-07-17:100:call:option-legacy-final-exit";
  const openedAt = new Date("2026-07-08T14:00:00.000Z");
  const closedAt = new Date("2026-07-08T15:00:00.000Z");
  const entryEventId = "00000000-0000-4000-8000-000000000104";
  const legacyExitId = "00000000-0000-4000-8000-000000000105";
  const strategyId = "00000000-0000-4000-8000-000000000108";
  const ledgerPositionId = `${DEPLOYMENT_ID}:AAPL`;
  const candidateId = "candidate-legacy-final";

  await db.insert(algoStrategiesTable).values({
    id: strategyId,
    name: "Legacy final reconciliation",
    mode: "shadow",
    enabled: true,
    symbolUniverse: ["AAPL"],
    config: {},
  });
  await db.insert(algoDeploymentsTable).values({
    id: DEPLOYMENT_ID,
    strategyId,
    name: "Legacy final reconciliation",
    mode: "shadow",
    enabled: true,
    providerAccountId: SHADOW_ACCOUNT_ID,
    symbolUniverse: ["AAPL"],
    config: { signalOptions: {} },
  });
  await db.insert(executionEventsTable).values([
    {
      id: entryEventId,
      deploymentId: DEPLOYMENT_ID,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      summary: "AAPL entry",
      occurredAt: openedAt,
      payload: {
        candidate: { id: candidateId },
        position: {
          id: ledgerPositionId,
          candidateId,
          openedAt: openedAt.toISOString(),
        },
      },
    },
    {
      id: legacyExitId,
      deploymentId: DEPLOYMENT_ID,
      providerAccountId: SHADOW_ACCOUNT_ID,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_EXIT_EVENT,
      summary: "AAPL legacy final exit",
      occurredAt: closedAt,
      payload: {
        pnl: 20,
        candidateId,
        candidate: { id: candidateId },
        position: { id: ledgerPositionId, candidateId },
      },
    },
  ]);
  await db.insert(shadowOrdersTable).values({
    id: "00000000-0000-4000-8000-000000000106",
    accountId: SHADOW_ACCOUNT_ID,
    source: "automation",
    sourceEventId: entryEventId,
    symbol: "AAPL",
    assetClass: "option",
    positionType: "option",
    side: "buy",
    status: "filled",
    quantity: "1",
    filledQuantity: "1",
    averageFillPrice: "1.5",
    optionContract: contract,
    payload: { metadata: { deploymentId: DEPLOYMENT_ID, positionKey } },
    placedAt: openedAt,
    filledAt: openedAt,
  });
  const [sellOrder] = await db
    .insert(shadowOrdersTable)
    .values({
      id: "00000000-0000-4000-8000-000000000107",
      accountId: SHADOW_ACCOUNT_ID,
      source: "automation",
      sourceEventId: legacyExitId,
      symbol: "AAPL",
      assetClass: "option",
      positionType: "option",
      side: "sell",
      status: "filled",
      quantity: "1",
      filledQuantity: "1",
      averageFillPrice: "1.7",
      optionContract: contract,
      payload: { metadata: { deploymentId: DEPLOYMENT_ID, positionKey } },
      placedAt: closedAt,
      filledAt: closedAt,
    })
    .returning({ id: shadowOrdersTable.id });
  assert.ok(sellOrder);
  await db.insert(shadowFillsTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    orderId: sellOrder.id,
    sourceEventId: legacyExitId,
    symbol: "AAPL",
    assetClass: "option",
    positionType: "option",
    side: "sell",
    quantity: "1",
    price: "1.7",
    grossAmount: "170",
    fees: "0.67",
    realizedPnl: "19.33",
    cashDelta: "169.33",
    optionContract: contract,
    occurredAt: closedAt,
  });
  const [position] = await db
    .insert(shadowPositionsTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      positionKey,
      symbol: "AAPL",
      assetClass: "option",
      positionType: "option",
      quantity: "0",
      averageCost: "1.5",
      mark: "1.7",
      marketValue: "0",
      unrealizedPnl: "0",
      realizedPnl: "19.33",
      fees: "1.34",
      optionContract: contract,
      openedAt,
      closedAt,
      asOf: closedAt,
      status: "closed",
    })
    .returning();
  assert.ok(position);
  const summary = {
    checkedCount: 0,
    dueCount: 0,
    closedCount: 0,
    skippedCount: 0,
    orphanCount: 0,
    forceClosedCount: 0,
    reconciledCount: 0,
    errors: [],
  };

  await __shadowOptionMaintenanceInternalsForTests.reconcileClosedRowsForTests({
    now: new Date("2026-07-08T16:00:00.000Z"),
    deploymentIds: new Set([DEPLOYMENT_ID]),
    summary,
    closedRows: [position],
  });

  const exits = await db
    .select({ id: executionEventsTable.id })
    .from(executionEventsTable)
    .where(eq(executionEventsTable.eventType, SIGNAL_OPTIONS_EXIT_EVENT));
  assert.deepEqual(exits, [{ id: legacyExitId }]);
  assert.equal(summary.reconciledCount, 0);
  assert.deepEqual(summary.errors, []);
});

async function shadowWriteCounts(database = testDb) {
  const result = await database.client.query<{
    accounts: number;
    orders: number;
    fills: number;
    positions: number;
    marks: number;
    balances: number;
    events: number;
  }>(`
    select
      (select count(*)::int from shadow_accounts) as accounts,
      (select count(*)::int from shadow_orders) as orders,
      (select count(*)::int from shadow_fills) as fills,
      (select count(*)::int from shadow_positions) as positions,
      (select count(*)::int from shadow_position_marks) as marks,
      (select count(*)::int from shadow_balance_snapshots) as balances,
      (select count(*)::int from execution_events) as events
  `);
  return result.rows[0]!;
}

function watchlistRunInput(runId: string) {
  return {
    runId,
    marketDate: "2026-07-08",
    marketDateFrom: "2026-07-08",
    marketDateTo: "2026-07-08",
    rangeKey: "2026-07-08:2026-07-08",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    timeframe: "5m" as const,
    riskOverlay: null,
    sizingOverlay: {
      label: "P10x10",
      maxPositionFraction: 0.1,
      maxOpenPositions: 10,
      cashOnly: true as const,
    },
    selectionOverlay: {
      label: "FIFO",
      mode: "first_signal" as const,
      minScoreEdge: 0,
    },
    entryGateOverlay: null,
    regimeOverlay: null,
    symbolUniverse: ["AAPL"],
    startingNetLiquidation: 25_000,
    metrics: { entries: 2, exits: 1, realizedPnl: 19 },
    fills: [
      {
        symbol: "AAPL",
        side: "buy" as const,
        quantity: 2,
        price: 100,
        fees: 1,
        grossAmount: 200,
        cashDelta: -201,
        realizedPnl: 0,
        positionKey: `watchlist_backtest:2026-07-08:AAPL:${runId}`,
        placedAt: new Date("2026-07-08T14:31:00.000Z"),
        signalAt: new Date("2026-07-08T14:30:00.000Z"),
        signalPrice: 99,
        signalClose: 100,
        signalScore: 4.2,
        signalScoreDetails: { momentum: 4.2 },
        watchlists: [{ id: "wl-1", name: "Core" }],
        fillSource: "next_bar_open",
        regime: null,
      },
      {
        symbol: "AAPL",
        side: "sell" as const,
        quantity: 2,
        price: 110,
        fees: 1,
        grossAmount: 220,
        cashDelta: 219,
        realizedPnl: 19,
        positionKey: `watchlist_backtest:2026-07-08:AAPL:${runId}`,
        placedAt: new Date("2026-07-08T15:01:00.000Z"),
        signalAt: new Date("2026-07-08T15:00:00.000Z"),
        signalPrice: 109,
        signalClose: 110,
        signalScore: 3.1,
        signalScoreDetails: { momentum: 3.1 },
        watchlists: [{ id: "wl-1", name: "Core" }],
        fillSource: "next_bar_open",
        regime: null,
      },
      {
        symbol: "AAPL",
        side: "buy" as const,
        quantity: 1,
        price: 105,
        fees: 1,
        grossAmount: 105,
        cashDelta: -106,
        realizedPnl: 0,
        positionKey: `watchlist_backtest:2026-07-08:AAPL:${runId}`,
        placedAt: new Date("2026-07-08T16:01:00.000Z"),
        signalAt: new Date("2026-07-08T16:00:00.000Z"),
        signalPrice: 104,
        signalClose: 105,
        signalScore: 2.9,
        signalScoreDetails: { momentum: 2.9 },
        watchlists: [{ id: "wl-1", name: "Core" }],
        fillSource: "next_bar_open",
        regime: null,
      },
    ],
    snapshots: [
      {
        asOf: new Date("2026-07-08T14:31:00.000Z"),
        cash: 24_799,
        netLiquidation: 24_999,
        realizedPnl: 0,
        unrealizedPnl: 0,
        fees: 1,
      },
      {
        asOf: new Date("2026-07-08T15:01:00.000Z"),
        cash: 25_018,
        netLiquidation: 25_018,
        realizedPnl: 19,
        unrealizedPnl: 0,
        fees: 2,
      },
      {
        asOf: new Date("2026-07-08T16:01:00.000Z"),
        cash: 24_912,
        netLiquidation: 25_017,
        realizedPnl: 19,
        unrealizedPnl: 0,
        fees: 3,
      },
    ],
  };
}

test("own-mode watchlist runs write only the backtest family and accumulate by range", async () => {
  await seedLiveFoldInput();
  const beforeCounts = await shadowWriteCounts();
  const beforeFingerprint = await fingerprintShadowAccountFoldInputsForTests();
  const firstRunId = "00000000-0000-4000-8000-000000000231";
  const secondRunId = "00000000-0000-4000-8000-000000000232";

  await __shadowWatchlistBacktestInternalsForTests.writeWatchlistBacktestRunToOwnLedgerForTests(
    watchlistRunInput(firstRunId),
  );
  assert.deepEqual(await shadowWriteCounts(), beforeCounts);
  assert.equal(
    await fingerprintShadowAccountFoldInputsForTests(),
    beforeFingerprint,
  );

  await __shadowWatchlistBacktestInternalsForTests.writeWatchlistBacktestRunToOwnLedgerForTests(
    watchlistRunInput(secondRunId),
  );

  const runs = await db
    .select()
    .from(backtestRunsTable)
    .where(eq(backtestRunsTable.kind, "watchlist_backtest"))
    .orderBy(asc(backtestRunsTable.createdAt));
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((run) => run.id).sort(), [firstRunId, secondRunId]);
  for (const run of runs) {
    assert.equal(run.studyId, null);
    assert.equal(run.sourceRunKey, run.id);
    assert.equal(run.sourceAccountId, SHADOW_ACCOUNT_ID);
    assert.equal(run.rangeKey, "2026-07-08:2026-07-08");
    assert.equal(run.marketDateFrom, "2026-07-08");
    assert.equal(run.marketDateTo, "2026-07-08");
    assert.equal(run.status, "completed");
    assert.equal(run.fidelity, "full");
  }

  const executions = await db
    .select()
    .from(backtestRunExecutionsTable)
    .orderBy(
      asc(backtestRunExecutionsTable.runId),
      asc(backtestRunExecutionsTable.occurredAt),
    );
  assert.equal(executions.length, 6);
  assert.ok(executions.every((row) => row.sourceOrderId && row.sourceFillId));
  assert.deepEqual(
    executions.slice(0, 3).map((row) => row.side),
    ["buy", "sell", "buy"],
  );
  assert.equal(executions[0]?.signalScore, "4.200000");
  assert.equal(executions[1]?.positionStatus, "closed");
  assert.equal(
    executions[2]?.positionOpenedAt?.toISOString(),
    "2026-07-08T16:01:00.000Z",
  );

  const points = await db
    .select()
    .from(backtestRunPointsTable)
    .orderBy(
      asc(backtestRunPointsTable.runId),
      asc(backtestRunPointsTable.occurredAt),
    );
  assert.equal(points.length, 6);
  assert.deepEqual(
    points.slice(0, 3).map((point) => Number(point.equity)),
    [24_999, 25_018, 25_017],
  );
  assert.deepEqual(await shadowWriteCounts(), beforeCounts);
  assert.equal(
    await fingerprintShadowAccountFoldInputsForTests(),
    beforeFingerprint,
  );
});

test("own-mode replay events fork before execution_events and shadow mirror writers", async () => {
  await seedLiveFoldInput();
  const beforeCounts = await shadowWriteCounts();
  const beforeFingerprint = await fingerprintShadowAccountFoldInputsForTests();
  const sourceRunKey = "replay-2026-07-08-a";
  const runId = await startSignalOptionsReplayBacktestRun({
    sourceRunKey,
    marketDate: "2026-07-08",
    marketDateFrom: "2026-07-08",
    marketDateTo: "2026-07-08",
    rangeKey: "2026-07-08:2026-07-08",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    deploymentId: DEPLOYMENT_ID,
    deploymentName: "Replay deployment",
    providerAccountId: SHADOW_ACCOUNT_ID,
    timeframe: "5m",
    symbolUniverse: ["AAPL"],
    parameters: { profilePatch: { riskCaps: { maxContracts: 2 } } },
    portfolioRules: { maxContracts: 2 },
    executionProfile: { fillPolicy: "historical" },
  });
  const deployment = {
    id: DEPLOYMENT_ID,
    name: "Replay deployment",
    mode: "shadow",
    providerAccountId: SHADOW_ACCOUNT_ID,
  } as never;
  const positionKey = `${SIGNAL_OPTIONS_REPLAY_SOURCE}:2026-07-08:${DEPLOYMENT_ID}:candidate-1`;
  const selectedContract = {
    ticker: "O:AAPL260717C00100000",
    underlying: "AAPL",
    expirationDate: "2026-07-17",
    strike: 100,
    right: "call",
    multiplier: 100,
    providerContractId: "option-123",
  };
  const basePosition = {
    id: positionKey,
    candidateId: "candidate-1",
    symbol: "AAPL",
    direction: "buy",
    timeframe: "5m",
    openedAt: "2026-07-08T14:31:00.000Z",
    entryPrice: 1.5,
    quantity: 2,
    lastMarkPrice: 1.5,
    selectedContract,
  };
  const metadata = {
    sourceType: SIGNAL_OPTIONS_REPLAY_SOURCE,
    runId: sourceRunKey,
    marketDate: "2026-07-08",
    positionMarketDate: "2026-07-08",
    deploymentId: DEPLOYMENT_ID,
    positionKey,
  };
  const replay = {
    source: SIGNAL_OPTIONS_REPLAY_SOURCE,
    runId: sourceRunKey,
    marketDate: "2026-07-08",
    deploymentId: DEPLOYMENT_ID,
  };

  await __signalOptionsAutomationInternalsForTests.insertSignalOptionsEventForTests(
    {
      deployment,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
      summary: "AAPL replay entry",
      occurredAt: new Date("2026-07-08T14:31:00.000Z"),
      ledgerSource: SIGNAL_OPTIONS_REPLAY_SOURCE,
      ledgerMarkSource: SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
      backtestRunId: runId,
      payload: {
        metadata,
        replay,
        signalKey: "signal-1",
        candidate: {
          id: "candidate-1",
          direction: "buy",
          timeframe: "5m",
          signalAt: "2026-07-08T14:30:00.000Z",
          signalPrice: 100,
        },
        selectedContract,
        orderPlan: { quantity: 2, simulatedFillPrice: 1.5, premiumAtRisk: 300 },
        position: basePosition,
        backfillEventKey: "replay-entry-1",
      },
    },
  );
  await __signalOptionsAutomationInternalsForTests.insertSignalOptionsEventForTests(
    {
      deployment,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_MARK_EVENT,
      summary: "AAPL replay mark",
      occurredAt: new Date("2026-07-08T14:36:00.000Z"),
      ledgerSource: SIGNAL_OPTIONS_REPLAY_SOURCE,
      ledgerMarkSource: SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
      backtestRunId: runId,
      payload: {
        metadata,
        replay,
        selectedContract,
        position: { ...basePosition, lastMarkPrice: 1.8 },
        quote: { mark: 1.8 },
        backfillEventKey: "replay-mark-1",
      },
    },
  );
  await __signalOptionsAutomationInternalsForTests.insertSignalOptionsEventForTests(
    {
      deployment,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_EXIT_EVENT,
      summary: "AAPL replay partial exit",
      occurredAt: new Date("2026-07-08T14:40:00.000Z"),
      ledgerSource: SIGNAL_OPTIONS_REPLAY_SOURCE,
      ledgerMarkSource: SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
      backtestRunId: runId,
      payload: {
        metadata,
        replay,
        signalKey: "signal-1",
        reason: "scale_out",
        exitPrice: 1.8,
        pnl: 30,
        selectedContract,
        position: { ...basePosition, quantity: 1, lastMarkPrice: 1.8 },
        backfillEventKey: "replay-exit-partial-1",
      },
    },
  );
  await __signalOptionsAutomationInternalsForTests.insertSignalOptionsEventForTests(
    {
      deployment,
      symbol: "AAPL",
      eventType: SIGNAL_OPTIONS_EXIT_EVENT,
      summary: "AAPL replay final exit",
      occurredAt: new Date("2026-07-08T14:41:00.000Z"),
      ledgerSource: SIGNAL_OPTIONS_REPLAY_SOURCE,
      ledgerMarkSource: SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
      backtestRunId: runId,
      payload: {
        metadata,
        replay,
        signalKey: "signal-1",
        reason: "target",
        exitPrice: 2,
        exitMarkPrice: 1.9,
        pnl: 50,
        selectedContract,
        position: { ...basePosition, quantity: 5, lastMarkPrice: 2 },
        backfillEventKey: "replay-exit-final-1",
      },
    },
  );
  await completeSignalOptionsReplayBacktestRun(runId, {
    entriesOpened: 1,
    exitsClosed: 2,
    marksRecorded: 1,
    realizedPnl: 80,
  });

  const [run] = await db
    .select()
    .from(backtestRunsTable)
    .where(eq(backtestRunsTable.id, runId));
  assert.equal(run?.kind, "signal_options_replay");
  assert.equal(run?.studyId, null);
  assert.equal(run?.sourceRunKey, sourceRunKey);
  assert.equal(run?.rangeKey, "2026-07-08:2026-07-08");
  assert.equal(run?.status, "completed");

  const executions = await db
    .select()
    .from(backtestRunExecutionsTable)
    .where(eq(backtestRunExecutionsTable.runId, runId))
    .orderBy(asc(backtestRunExecutionsTable.occurredAt));
  assert.equal(executions.length, 8);
  const eventExecutions = executions.filter((row) =>
    [
      SIGNAL_OPTIONS_ENTRY_EVENT,
      SIGNAL_OPTIONS_MARK_EVENT,
      SIGNAL_OPTIONS_EXIT_EVENT,
    ].includes(row.eventType),
  );
  assert.deepEqual(
    eventExecutions.map((row) => row.eventType),
    [
      SIGNAL_OPTIONS_ENTRY_EVENT,
      SIGNAL_OPTIONS_MARK_EVENT,
      SIGNAL_OPTIONS_EXIT_EVENT,
      SIGNAL_OPTIONS_EXIT_EVENT,
    ],
  );
  assert.equal(eventExecutions[0]?.candidateId, "candidate-1");
  assert.equal(eventExecutions[0]?.optionTicker, selectedContract.ticker);
  assert.equal(eventExecutions[1]?.mark, "1.800000");
  assert.equal(eventExecutions[2]?.reason, "scale_out");
  assert.equal(eventExecutions[2]?.realizedPnl, "30.000000");
  assert.equal(eventExecutions[3]?.reason, "target");
  assert.equal(eventExecutions[3]?.price, "2.000000");
  assert.equal(eventExecutions[3]?.mark, "1.900000");
  assert.equal(eventExecutions[3]?.realizedPnl, "50.000000");
  const mirrorExecutions = executions.filter((row) =>
    row.eventType.startsWith("signal_options_replay_"),
  );
  assert.equal(mirrorExecutions.length, 4);
  assert.equal(mirrorExecutions[0]?.orderType, "limit");
  assert.equal(mirrorExecutions[0]?.limitPrice, "1.500000");
  assert.equal(mirrorExecutions[2]?.realizedPnl, "29.330000");
  assert.equal(mirrorExecutions[3]?.quantity, "1.000000");
  assert.equal(mirrorExecutions[3]?.filledQuantity, "1.000000");
  assert.equal(mirrorExecutions[3]?.averageFillPrice, "2.000000");
  assert.equal(mirrorExecutions[3]?.mark, "2.000000");
  assert.equal(mirrorExecutions[3]?.realizedPnl, "49.330000");

  const points = await db
    .select()
    .from(backtestRunPointsTable)
    .where(eq(backtestRunPointsTable.runId, runId))
    .orderBy(asc(backtestRunPointsTable.occurredAt));
  assert.equal(points.length, 4);
  assert.equal(points.at(-1)?.realizedPnl, "78.660000");
  assert.equal(points.at(-1)?.fees, "2.690000");
  assert.deepEqual(await shadowWriteCounts(), beforeCounts);
  assert.equal(
    await fingerprintShadowAccountFoldInputsForTests(),
    beforeFingerprint,
  );
});

test("replay terminal writes fail when the run row no longer exists", async () => {
  const missingRunId = "00000000-0000-4000-8000-000000000999";
  await assert.rejects(
    completeSignalOptionsReplayBacktestRun(missingRunId, {}),
    /could not be completed/iu,
  );
  await assert.rejects(
    failSignalOptionsReplayBacktestRun(
      missingRunId,
      new Error("synthetic replay failure"),
    ),
    /could not be failed/iu,
  );
});

test("own mode fails softly at run start when a backtest ledger table or column is absent", async () => {
  for (const missingDdl of [
    "alter table backtest_run_executions drop column market_value",
    "drop table backtest_run_executions cascade",
  ]) {
    const missingDb = await createTestDb();
    try {
      await missingDb.client.exec(missingDdl);
      await db.insert(shadowAccountsTable).values({
        id: SHADOW_ACCOUNT_ID,
        displayName: "Shadow",
        startingBalance: "25000",
        cash: "25000",
      });
      const beforeCounts = await shadowWriteCounts(missingDb);
      const beforeFingerprint =
        await fingerprintShadowAccountFoldInputsForTests();

      await assert.rejects(
        runShadowWatchlistBacktest({
          marketDate: "2026-07-08",
          persist: true,
        }),
        (error: unknown) => {
          assert.equal(
            (error as Error).message,
            "backtest ledger migration not applied",
          );
          assert.equal(
            (error as { code?: string }).code,
            "backtest_ledger_migration_not_applied",
          );
          return true;
        },
      );
      const runs = await missingDb.client.query<{ count: number }>(
        "select count(*)::int as count from backtest_runs",
      );
      assert.equal(runs.rows[0]?.count, 0);
      assert.deepEqual(await shadowWriteCounts(missingDb), beforeCounts);
      assert.equal(
        await fingerprintShadowAccountFoldInputsForTests(),
        beforeFingerprint,
      );
    } finally {
      await missingDb.cleanup();
    }
  }
});

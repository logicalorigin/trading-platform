import assert from "node:assert/strict";
import test from "node:test";

import {
  db,
  shadowAccountsTable,
  shadowBalanceSnapshotsTable,
  shadowFillsTable,
  shadowOrdersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import { __shadowWatchlistBacktestInternalsForTests } from "./shadow-account";
import { subscribeShadowAccountChanges } from "./shadow-account-events";

const OLD_ORDER_ID = "00000000-0000-4000-8000-000000000301";
const OLD_FILL_ID = "00000000-0000-4000-8000-000000000302";
const MARKET_DATE = "2026-07-17";
const WINDOW_START = new Date("2026-07-17T13:30:00.000Z");
const WINDOW_END = new Date("2026-07-17T20:00:00.000Z");

async function readSharedLedgerRows() {
  return {
    accounts: await db.select().from(shadowAccountsTable),
    orders: await db.select().from(shadowOrdersTable),
    fills: await db.select().from(shadowFillsTable),
    snapshots: await db.select().from(shadowBalanceSnapshotsTable),
  };
}

function replacementInput(side: "buy" | "sell") {
  return {
    runId: "00000000-0000-4000-8000-000000000399",
    marketDateFrom: MARKET_DATE,
    marketDateTo: MARKET_DATE,
    rangeKey: `${MARKET_DATE}:${MARKET_DATE}`,
    windowStart: WINDOW_START,
    cleanupEnd: WINDOW_END,
    replaceAll: true,
    fills: [
      {
        symbol: "MSFT",
        side,
        quantity: 1,
        price: 10,
        fees: 1,
        grossAmount: 10,
        cashDelta: -11,
        realizedPnl: 0,
        positionKey: "watchlist-backtest:replacement:MSFT",
        placedAt: new Date("2026-07-17T14:00:00.000Z"),
        signalAt: new Date("2026-07-17T13:59:00.000Z"),
        signalPrice: 10,
        signalClose: 10,
        watchlists: [{ id: "watchlist", name: "Watchlist" }],
        fillSource: "test",
      },
    ],
    snapshots: [],
  };
}

test("shared-ledger watchlist replacement rolls back deletion and notifies only after commit", async () => {
  await withTestDb(async () => {
    const previousLedgerMode = process.env.PYRUS_BACKTEST_LEDGER;
    delete process.env.PYRUS_BACKTEST_LEDGER;
    try {
      await db.insert(shadowAccountsTable).values({
        id: "shadow",
        displayName: "Shadow",
        startingBalance: "1000",
        cash: "990",
        realizedPnl: "2",
        fees: "1",
      });
      await db.insert(shadowOrdersTable).values({
        id: OLD_ORDER_ID,
        accountId: "shadow",
        source: "watchlist_backtest",
        clientOrderId: "old-watchlist-backtest-order",
        symbol: "AAPL",
        assetClass: "equity",
        side: "buy",
        type: "market",
        timeInForce: "day",
        status: "filled",
        quantity: "1",
        filledQuantity: "1",
        averageFillPrice: "10",
        fees: "1",
        payload: {
          metadata: {
            source: "watchlist_backtest",
            rangeKey: `${MARKET_DATE}:${MARKET_DATE}`,
            marketDate: MARKET_DATE,
            positionKey: "watchlist-backtest:old:AAPL",
          },
        },
        placedAt: new Date("2026-07-17T14:00:00.000Z"),
        filledAt: new Date("2026-07-17T14:00:00.000Z"),
      });
      await db.insert(shadowFillsTable).values({
        id: OLD_FILL_ID,
        accountId: "shadow",
        orderId: OLD_ORDER_ID,
        symbol: "AAPL",
        assetClass: "equity",
        side: "buy",
        quantity: "1",
        price: "10",
        grossAmount: "10",
        fees: "1",
        realizedPnl: "2",
        cashDelta: "-11",
        occurredAt: new Date("2026-07-17T14:00:00.000Z"),
      });
      await db.insert(shadowBalanceSnapshotsTable).values({
        accountId: "shadow",
        cash: "990",
        buyingPower: "990",
        netLiquidation: "1000",
        realizedPnl: "2",
        unrealizedPnl: "8",
        fees: "1",
        source: "watchlist_bt:20260717:20260717",
        asOf: new Date("2026-07-17T20:00:00.000Z"),
      });

      const before = await readSharedLedgerRows();
      const changes: unknown[] = [];
      const unsubscribe = subscribeShadowAccountChanges(
        (change) => changes.push(change),
        "shadow",
      );
      try {
        await assert.rejects(() =>
          __shadowWatchlistBacktestInternalsForTests.insertWatchlistBacktestFillsForTests(
            {
              ...replacementInput("buy"),
              fills: [
                {
                  ...replacementInput("buy").fills[0]!,
                  side: "invalid" as never,
                },
              ],
            },
          ),
        );
        assert.deepEqual(await readSharedLedgerRows(), before);
        assert.equal(changes.length, 0);

        await __shadowWatchlistBacktestInternalsForTests.insertWatchlistBacktestFillsForTests(
          replacementInput("buy"),
        );
        const after = await readSharedLedgerRows();
        assert.equal(after.orders.length, 1);
        assert.equal(after.orders[0]?.symbol, "MSFT");
        assert.equal(after.fills.length, 1);
        assert.equal(after.fills[0]?.symbol, "MSFT");
        assert.equal(after.snapshots.length, 0);
        assert.equal(changes.length, 1);
      } finally {
        unsubscribe();
      }
    } finally {
      if (previousLedgerMode === undefined) {
        delete process.env.PYRUS_BACKTEST_LEDGER;
      } else {
        process.env.PYRUS_BACKTEST_LEDGER = previousLedgerMode;
      }
    }
  });
});

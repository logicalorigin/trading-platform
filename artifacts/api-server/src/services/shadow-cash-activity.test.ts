import assert from "node:assert/strict";
import test from "node:test";

import {
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";

import {
  __shadowWatchlistBacktestInternalsForTests as internals,
  getShadowAccountCashActivity,
} from "./shadow-account";
import { runWithShadowAccountId } from "./shadow-account-context";

const uuid = (prefix: string, value: number) =>
  `${prefix}0000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

test("shadow cash activity filters before its 200-row display cap and totals every source-matched YTD fee", async () => {
  await withTestDb(async ({ db }) => {
    const accountId = "shadow-cash-activity-test";
    const year = new Date().getUTCFullYear();
    const orders = [];
    const fills = [];

    for (let index = 0; index < 405; index += 1) {
      const automation = index >= 200;
      const automationIndex = index - 200;
      const futureDated = automationIndex === 204;
      const orderId = uuid("0", index + 1);
      const occurredAt = futureDated
        ? new Date(Date.now() + 86_400_000)
        : new Date(
            Date.UTC(year, 0, automation ? 2 : 3, 12, 0, index % 60, index),
          );
      orders.push({
        id: orderId,
        accountId,
        source: automation ? "automation" : "manual",
        symbol: "AAPL",
        assetClass: "equity",
        positionType: "stock",
        side: "buy" as const,
        quantity: "1",
        filledQuantity: "1",
        fees: futureDated ? "100" : automation ? "1" : "9",
        payload:
          automationIndex === 202
            ? { metadata: { source: "\u00a0signal_options_replay\t" } }
            : automationIndex === 203
              ? { forwardTest: true }
              : {},
        placedAt: occurredAt,
        filledAt: occurredAt,
      });
      fills.push({
        id: uuid("1", index + 1),
        accountId,
        orderId,
        symbol: "AAPL",
        assetClass: "equity",
        positionType: "stock",
        side: "buy" as const,
        quantity: "1",
        price: "10",
        grossAmount: "10",
        fees: futureDated ? "100" : automation ? "1" : "9",
        realizedPnl: "0",
        cashDelta: futureDated ? "-110" : automation ? "-11" : "-19",
        occurredAt,
      });
    }

    await db.insert(shadowAccountsTable).values({
      id: accountId,
      displayName: "Shadow cash activity test",
      currency: "USD",
      startingBalance: "25000",
      cash: "25000",
      status: "active",
    });
    await db.insert(shadowOrdersTable).values(orders);
    await db.insert(shadowFillsTable).values(fills);
    internals.invalidateShadowFreshStateCache();

    try {
      const result = await runWithShadowAccountId(accountId, () =>
        getShadowAccountCashActivity({ source: "automation" }),
      );
      const tradeActivities = result.activities.filter(
        (activity) => activity.type === "Trade",
      );

      assert.equal(tradeActivities.length, 200);
      assert.equal(result.feesYtd, 202);
      assert.ok(
        tradeActivities.every(
          (activity) =>
            "sourceType" in activity && activity.sourceType === "automation",
        ),
      );
      assert.ok(
        tradeActivities.every((activity) => activity.id !== uuid("1", 405)),
      );
    } finally {
      internals.invalidateShadowFreshStateCache();
    }
  });
});

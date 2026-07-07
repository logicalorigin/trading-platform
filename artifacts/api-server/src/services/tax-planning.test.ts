import assert from "node:assert/strict";
import test from "node:test";

import { db } from "@workspace/db";
import {
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
  usersTable,
} from "@workspace/db/schema";
import { withTestDb } from "@workspace/db/testing";
import { runAsAppUser } from "./app-user-context";
import {
  assertTaxPreflightForOrderSubmission,
  createTaxOrderPreflight,
  getAccountTaxOverview,
  listAccountTaxEvents,
  listAccountTaxLots,
  listAccountWashWindows,
} from "./tax-planning";
import type { TaxOrderLike } from "./tax-planning-model";

async function createUser(email: string): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      displayName: null,
      passwordHash: "scrypt:v1:test-only",
      role: "member",
    })
    .returning({ id: usersTable.id });
  assert.ok(user);
  return user.id;
}

const baseOrder = (overrides: Partial<TaxOrderLike> = {}): TaxOrderLike => ({
  accountId: "U1234567",
  mode: "live",
  symbol: "AAPL",
  assetClass: "equity",
  side: "buy",
  type: "limit",
  quantity: 10,
  limitPrice: 210,
  stopPrice: null,
  timeInForce: "day",
  optionContract: null,
  route: "ibkr",
  intent: null,
  ...overrides,
});

test("tax preflight token validates the exact provider-account order", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-valid@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder();
      const preflight = await createTaxOrderPreflight({ order });

      assert.equal(preflight.action, "allow");
      assert.ok(typeof preflight.preflightToken === "string");

      const accepted = await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
      });

      assert.equal(accepted?.preflightToken, preflight.preflightToken);
    });
  });
});

test("tax preflight rejects a token when the submitted order changes", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-mismatch@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder();
      const preflight = await createTaxOrderPreflight({ order });

      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order: baseOrder({ quantity: 11 }),
          taxPreflightToken: preflight.preflightToken,
        }),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "tax_preflight_order_mismatch");
          return true;
        },
      );
    });
  });
});

test("tax preflight accepts the same order facts across broker route labels", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-broker-agnostic@example.com");
    await runAsAppUser(appUserId, async () => {
      const preflight = await createTaxOrderPreflight({
        order: baseOrder({ route: "ibkr" }),
      });

      const accepted = await assertTaxPreflightForOrderSubmission({
        order: baseOrder({ route: "schwab" }),
        taxPreflightToken: preflight.preflightToken,
      });

      assert.equal(accepted?.preflightToken, preflight.preflightToken);
    });
  });
});

test("tax preflight requires returned acknowledgements for sell orders", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-preflight-ack@example.com");
    await runAsAppUser(appUserId, async () => {
      const order = baseOrder({ side: "sell" });
      const preflight = await createTaxOrderPreflight({ order });

      assert.equal(preflight.action, "warn_ack_required");
      await assert.rejects(
        assertTaxPreflightForOrderSubmission({
          order,
          taxPreflightToken: preflight.preflightToken,
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "tax_preflight_acknowledgement_required",
          );
          return true;
        },
      );

      const accepted = await assertTaxPreflightForOrderSubmission({
        order,
        taxPreflightToken: preflight.preflightToken,
        taxAcknowledgements: preflight.requiredAcknowledgements,
      });

      assert.equal(accepted?.preflightToken, preflight.preflightToken);
    });
  });
});

test("shadow account tax view summarizes simulated trading history", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("tax-shadow-history@example.com");
    const shadowAccountId = "shadow-tax-history";
    await db.insert(shadowAccountsTable).values({
      id: shadowAccountId,
      appUserId,
      displayName: "Shadow",
      startingBalance: "25000",
      cash: "25100",
      realizedPnl: "95",
      fees: "2",
      status: "active",
    });
    const [gainOrder] = await db
      .insert(shadowOrdersTable)
      .values({
        accountId: shadowAccountId,
        source: "manual",
        symbol: "AAPL",
        assetClass: "equity",
        side: "sell",
        type: "market",
        timeInForce: "day",
        status: "filled",
        quantity: "5",
        filledQuantity: "5",
        averageFillPrice: "210",
        fees: "1",
        placedAt: new Date("2026-07-02T14:30:00.000Z"),
        filledAt: new Date("2026-07-02T14:30:00.000Z"),
      })
      .returning({ id: shadowOrdersTable.id });
    const [lossOrder] = await db
      .insert(shadowOrdersTable)
      .values({
        accountId: shadowAccountId,
        source: "manual",
        symbol: "MSFT",
        assetClass: "equity",
        side: "sell",
        type: "market",
        timeInForce: "day",
        status: "filled",
        quantity: "2",
        filledQuantity: "2",
        averageFillPrice: "300",
        fees: "1",
        placedAt: new Date("2026-07-03T14:30:00.000Z"),
        filledAt: new Date("2026-07-03T14:30:00.000Z"),
      })
      .returning({ id: shadowOrdersTable.id });
    assert.ok(gainOrder);
    assert.ok(lossOrder);
    await db.insert(shadowFillsTable).values([
      {
        accountId: shadowAccountId,
        orderId: gainOrder.id,
        symbol: "AAPL",
        assetClass: "equity",
        side: "sell",
        quantity: "5",
        price: "210",
        grossAmount: "1050",
        fees: "1",
        realizedPnl: "125",
        cashDelta: "1049",
        occurredAt: new Date("2026-07-02T14:30:00.000Z"),
      },
      {
        accountId: shadowAccountId,
        orderId: lossOrder.id,
        symbol: "MSFT",
        assetClass: "equity",
        side: "sell",
        quantity: "2",
        price: "300",
        grossAmount: "600",
        fees: "1",
        realizedPnl: "-30",
        cashDelta: "599",
        occurredAt: new Date("2026-07-03T14:30:00.000Z"),
      },
    ]);

    await runAsAppUser(appUserId, async () => {
      const overview = await getAccountTaxOverview("shadow");
      assert.equal(overview.accountScope, "shadow_simulation");
      assert.equal(overview.shadowExcluded, false);
      assert.equal(overview.scope.shadowIncluded, true);
      assert.equal(overview.estimates.shadow.eventCount, 2);
      assert.equal(overview.estimates.shadow.realizedPnl, 95);
      assert.equal(overview.washSales.status, "unknown");

      const events = await listAccountTaxEvents("shadow");
      assert.equal(events.events.length, 2);
      assert.equal(events.events[0]?.sourceType, "shadow_ledger");
      assert.equal(events.events[0]?.amount, 125);

      const lots = await listAccountTaxLots("shadow");
      assert.equal(lots.lots.length, 2);
      assert.equal(lots.basisConfidence, "shadow_simulation");

      const wash = await listAccountWashWindows("shadow");
      assert.equal(wash.washWindows.length, 1);
      assert.equal(wash.riskSummary.status, "unknown");
    });
  });
});

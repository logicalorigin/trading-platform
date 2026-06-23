import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  db,
  shadowAccountsTable,
  shadowFillsTable,
  shadowOrdersTable,
} from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";

import {
  recomputeShadowAccountFromLedger,
  SHADOW_ACCOUNT_ID,
} from "./shadow-account";

// Verifies the set-based recompute (SELECT DISTINCT order ids + SQL SUM over the
// analytics-qualifying fills) produces the SAME account totals as the prior
// load-all-fills + JS-fold-with-money() path: same qualifying-fill set (filter
// stays in JS), and SQL SUM over numeric(20,6) == the JS float reduce at money()'s
// 6-decimal rounding. Both run against the same PGlite instance via the harness.

const START = 25_000;

let testDb: TestDatabase;
before(async () => {
  testDb = await createTestDb();
});
after(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.client.exec(
    "truncate table shadow_fills, shadow_orders, shadow_accounts restart identity cascade",
  );
  await db.insert(shadowAccountsTable).values({
    id: SHADOW_ACCOUNT_ID,
    displayName: "Shadow",
    startingBalance: String(START),
    cash: "0", // recompute overwrites this
  });
});

async function seedOrder(opts: {
  source?: string;
  payload?: Record<string, unknown>;
}): Promise<string> {
  const [order] = await db
    .insert(shadowOrdersTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      source: opts.source ?? "manual",
      symbol: "AAPL",
      assetClass: "equity",
      side: "buy",
      quantity: "1",
      filledQuantity: "1",
      payload: opts.payload ?? {},
    })
    .returning({ id: shadowOrdersTable.id });
  return order!.id;
}

async function seedFill(
  orderId: string,
  vals: { cashDelta: string; realizedPnl: string; fees: string },
): Promise<void> {
  await db.insert(shadowFillsTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    orderId,
    symbol: "AAPL",
    assetClass: "equity",
    side: "buy",
    quantity: "1",
    price: "100",
    grossAmount: "100",
    cashDelta: vals.cashDelta,
    realizedPnl: vals.realizedPnl,
    fees: vals.fees,
  });
}

async function readAccount() {
  const [account] = await db
    .select()
    .from(shadowAccountsTable)
    .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID));
  return account!;
}

test("recompute sums only analytics-qualifying fills (excludes forward-test orders)", async () => {
  const qualifying = await seedOrder({ source: "manual" });
  const forwardTest = await seedOrder({
    source: "manual",
    payload: { forwardTest: true },
  });

  await seedFill(qualifying, { cashDelta: "-100.50", realizedPnl: "12.25", fees: "1.00" });
  await seedFill(qualifying, { cashDelta: "250.75", realizedPnl: "-5.50", fees: "0.50" });
  await seedFill(qualifying, { cashDelta: "10.101010", realizedPnl: "0.404040", fees: "0.10" });
  // Forward-test fills must NOT count.
  await seedFill(forwardTest, { cashDelta: "99999", realizedPnl: "88888", fees: "7777" });

  await db.transaction(async (tx) => {
    await recomputeShadowAccountFromLedger(tx, new Date());
  });

  const account = await readAccount();
  // Reference = exactly what the prior JS fold over qualifying fills produced.
  const expCash = Number((START + (-100.5 + 250.75 + 10.10101)).toFixed(6));
  const expRealized = Number((12.25 + -5.5 + 0.40404).toFixed(6));
  const expFees = Number((1.0 + 0.5 + 0.1).toFixed(6));
  assert.equal(Number(account.cash), expCash);
  assert.equal(Number(account.realizedPnl), expRealized);
  assert.equal(Number(account.fees), expFees);
});

test("empty ledger -> startingBalance, zero pnl/fees", async () => {
  await db.transaction(async (tx) => {
    await recomputeShadowAccountFromLedger(tx, new Date());
  });
  const account = await readAccount();
  assert.equal(Number(account.cash), START);
  assert.equal(Number(account.realizedPnl), 0);
  assert.equal(Number(account.fees), 0);
});

test("a NULL-free realizedPnl set and all-qualifying ledger sums every fill", async () => {
  const order = await seedOrder({ source: "manual" });
  let cash = 0;
  let pnl = 0;
  let fees = 0;
  for (let i = 0; i < 25; i += 1) {
    const cd = (i * 0.07 - 1.13).toFixed(6);
    const rp = (i * 0.03 - 0.5).toFixed(6);
    const fe = (0.01 * i).toFixed(6);
    await seedFill(order, { cashDelta: cd, realizedPnl: rp, fees: fe });
    cash += Number(cd);
    pnl += Number(rp);
    fees += Number(fe);
  }
  await db.transaction(async (tx) => {
    await recomputeShadowAccountFromLedger(tx, new Date());
  });
  const account = await readAccount();
  assert.equal(Number(account.cash), Number((START + cash).toFixed(6)));
  assert.equal(Number(account.realizedPnl), Number(pnl.toFixed(6)));
  assert.equal(Number(account.fees), Number(fees.toFixed(6)));
});

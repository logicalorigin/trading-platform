import assert from "node:assert/strict";
import test from "node:test";

import type { AlgoOptionBrokerOrder } from "./algo-option-broker-adapter";
import { createAlgoSnapTradeOptionAdapter } from "./algo-option-snaptrade-adapter";

const context = {
  appUserId: "user-1",
  accountId: "account-1",
  deploymentId: "deployment-1",
  targetId: "target-1",
};

const order: AlgoOptionBrokerOrder = {
  contract: {
    symbol: "SPY260821C00600000",
    underlying: "SPY",
    expiration: "2026-08-21",
    strike: 600,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
  },
  side: "buy",
  positionEffect: "open",
  orderType: "limit",
  timeInForce: "day",
  quantity: 2,
  limitPrice: 2.5,
  clientOrderId: "11111111-1111-4111-8111-111111111111",
  taxPreflightToken: "tax-proof",
};

test("SnapTrade adapter maps capital and option order services but requires a brokerage proof", async () => {
  let impactInput: unknown;
  let submitInput: unknown;
  const adapter = createAlgoSnapTradeOptionAdapter({
    now: () => new Date("2026-07-22T16:00:00.000Z"),
    readPortfolio: async () =>
      ({
        syncedAt: "2026-07-22T15:59:59.000Z",
        totals: { netLiquidation: 10_000, buyingPower: 4_000 },
      }) as never,
    checkImpact: async (input) => {
      impactInput = input;
      return {
        provider: "snaptrade",
        checkedAt: "2026-07-22T16:00:00.000Z",
        account: { id: "account-1" },
        order: {},
        impact: {
          estimatedCashChange: -500,
          cashChangeDirection: "DEBIT",
          estimatedFeeTotal: 0,
        },
      } as never;
    },
    submitOrder: async (input) => {
      submitInput = input;
      return {
        provider: "snaptrade",
        submittedAt: "2026-07-22T16:00:01.000Z",
        account: { id: "account-1" },
        order: {
          brokerageOrderId: "snap-order-1",
          status: "PENDING",
        },
      } as never;
    },
  });

  assert.equal(adapter.activationReleased, false);
  assert.ok(
    adapter.technicalBlockers.includes(
      "algo.provider.snaptrade_brokerage_option_fixture_required",
    ),
  );
  assert.deepEqual(await adapter.readCapital(context), {
    accountId: "account-1",
    netLiquidation: 10_000,
    buyingPower: 4_000,
    observedAt: new Date("2026-07-22T15:59:59.000Z"),
  });
  assert.deepEqual(await adapter.reviewOrder({ ...context, order }), {
    provider: "snaptrade",
    accountId: "account-1",
    checkedAt: new Date("2026-07-22T16:00:00.000Z"),
    accepted: true,
    warnings: [],
    estimatedPremium: 500,
  });
  assert.deepEqual(impactInput, {
    appUserId: "user-1",
    accountId: "account-1",
    input: {
      contractSymbol: "SPY260821C00600000",
      multiplier: 100,
      sharesPerContract: 100,
      underlyingSymbol: "SPY",
      expiration: "2026-08-21",
      strike: 600,
      optionType: "Call",
      action: "BUY_TO_OPEN",
      orderType: "Limit",
      timeInForce: "Day",
      units: 2,
      price: 2.5,
    },
    now: new Date("2026-07-22T16:00:00.000Z"),
  });

  assert.deepEqual(await adapter.submitEntry({ ...context, order }), {
    provider: "snaptrade",
    accountId: "account-1",
    brokerOrderId: "snap-order-1",
    clientOrderId: order.clientOrderId,
    status: "PENDING",
    submittedAt: new Date("2026-07-22T16:00:01.000Z"),
    reconciliationRequired: false,
  });
  assert.deepEqual(submitInput, {
    appUserId: "user-1",
    accountId: "account-1",
    input: {
      ...(impactInput as { input: Record<string, unknown> }).input,
      confirm: true,
      taxPreflightToken: "tax-proof",
    },
    now: new Date("2026-07-22T16:00:00.000Z"),
  });
});

test("SnapTrade adapter exposes normalized aggregate fills and refuses unsafe lanes", async () => {
  const adapter = createAlgoSnapTradeOptionAdapter({
    now: () => new Date("2026-07-22T16:00:00.000Z"),
    listOrders: async () =>
      ({
        provider: "snaptrade",
        checkedAt: "2026-07-22T16:00:00.000Z",
        account: { id: "account-1" },
        orders: [
          {
            brokerageOrderId: "snap-order-1",
            optionTicker: "SPY260821C00600000",
            status: "FILLED",
            totalQuantity: 2,
            filledQuantity: 2,
            executionPrice: 2.45,
            limitPrice: 2.5,
            timeUpdated: "2026-07-22T15:59:59.000Z",
            timeExecuted: "2026-07-22T15:59:58.000Z",
          },
        ],
      }) as never,
  });

  assert.deepEqual(await adapter.listFills(context), [
    {
      provider: "snaptrade",
      accountId: "account-1",
      brokerOrderId: "snap-order-1",
      fillId: "snap-order-1:aggregate",
      contractSymbol: "SPY260821C00600000",
      quantity: 2,
      price: 2.45,
      executedAt: new Date("2026-07-22T15:59:58.000Z"),
    },
  ]);

  for (const call of [
    () => adapter.readRisk(context),
    () =>
      adapter.submitOwnedPositionExit({
        ...context,
        order: { ...order, side: "sell", positionEffect: "close" },
        ownedPosition: {
          deploymentId: "deployment-1",
          targetId: "target-1",
          positionId: "position-1",
          targetExecutionId: "execution-1",
          providerPositionId: "provider-position-1",
        },
      }),
    () =>
      adapter.reconcile({
        ...context,
        executionId: "execution-1",
        action: "entry",
      }),
  ]) {
    await assert.rejects(call(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_provider_operation_unavailable");
      return true;
    });
  }
});

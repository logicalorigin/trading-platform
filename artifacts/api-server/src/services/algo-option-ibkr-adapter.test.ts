import assert from "node:assert/strict";
import test from "node:test";

import type { AlgoOptionBrokerOrder } from "./algo-option-broker-adapter";
import { createAlgoIbkrOptionAdapter } from "./algo-option-ibkr-adapter";

const context = {
  appUserId: "user-1",
  accountId: "local-account-1",
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
    providerContractId: "756733",
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

test("IBKR adapter binds the owned local target to its provider account and stays unreleased", async () => {
  let previewInput: unknown;
  let submitInput: unknown;
  const adapter = createAlgoIbkrOptionAdapter({
    now: () => new Date("2026-07-22T16:00:00.000Z"),
    resolveAccount: async () => ({ providerAccountId: "U1234567", mode: "live" }),
    readAccounts: async () => [
      {
        id: "ibkr:U1234567",
        providerAccountId: "U1234567",
        provider: "ibkr",
        mode: "live",
        displayName: "IBKR ...4567",
        currency: "USD",
        buyingPower: 4_000,
        cash: 3_000,
        netLiquidation: 10_000,
        updatedAt: new Date("2026-07-22T15:59:59.000Z"),
      },
    ],
    previewOrder: async (input) => {
      previewInput = input;
      return {
        accountId: "U1234567",
        clientOrderId: order.clientOrderId,
        whatIf: {
          amount: "-500",
          total: "-500",
          warnings: [],
          error: null,
        },
      } as never;
    },
    submitOrder: async (input) => {
      submitInput = input;
      return {
        id: "ibkr-order-1",
        clientOrderId: order.clientOrderId,
        status: "submitted",
        updatedAt: new Date("2026-07-22T16:00:01.000Z"),
        reconciliationRequired: false,
      } as never;
    },
  });

  assert.equal(adapter.activationReleased, false);
  assert.ok(
    adapter.technicalBlockers.includes("ibkr.automated_live_orders_disabled"),
  );
  assert.deepEqual(await adapter.readCapital(context), {
    accountId: "local-account-1",
    netLiquidation: 10_000,
    buyingPower: 4_000,
    observedAt: new Date("2026-07-22T15:59:59.000Z"),
  });
  assert.deepEqual(await adapter.reviewOrder({ ...context, order }), {
    provider: "ibkr",
    accountId: "local-account-1",
    checkedAt: new Date("2026-07-22T16:00:00.000Z"),
    accepted: true,
    warnings: [],
    estimatedPremium: 500,
  });
  const expectedOrder = {
    accountId: "U1234567",
    mode: "live",
    clientOrderId: order.clientOrderId,
    symbol: "SPY",
    assetClass: "option",
    side: "buy",
    type: "limit",
    quantity: 2,
    limitPrice: 2.5,
    stopPrice: null,
    timeInForce: "day",
    optionContract: {
      ticker: "SPY260821C00600000",
      underlying: "SPY",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 600,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "756733",
      brokerContractId: null,
      standardDeliverableVerified: true,
    },
    optionAction: "buy_to_open",
    positionEffect: "open",
    strategyIntent: "long_option",
    tradingSession: "regular",
    includeOvernight: false,
    taxPreflightToken: "tax-proof",
  };
  assert.deepEqual(previewInput, {
    appUserId: "user-1",
    order: expectedOrder,
  });

  assert.deepEqual(await adapter.submitEntry({ ...context, order }), {
    provider: "ibkr",
    accountId: "local-account-1",
    brokerOrderId: "ibkr-order-1",
    clientOrderId: order.clientOrderId,
    status: "submitted",
    submittedAt: new Date("2026-07-22T16:00:01.000Z"),
    reconciliationRequired: false,
  });
  assert.deepEqual(submitInput, {
    appUserId: "user-1",
    order: { ...expectedOrder, confirm: true, source: "automation" },
  });
});

test("IBKR adapter normalizes executions and refuses missing risk/exit/reconciliation lanes", async () => {
  const adapter = createAlgoIbkrOptionAdapter({
    resolveAccount: async () => ({ providerAccountId: "U1234567", mode: "live" }),
    listExecutions: async () => [
      {
        id: "fill-1",
        accountId: "U1234567",
        symbol: "SPY",
        assetClass: "option",
        side: "buy",
        quantity: 2,
        price: 2.45,
        netAmount: null,
        commission: null,
        exchange: "SMART",
        executedAt: new Date("2026-07-22T15:59:58.000Z"),
        orderDescription: null,
        contractDescription: null,
        providerContractId: "756733",
        orderRef: "ibkr-order-1",
      },
    ],
  });

  assert.deepEqual(await adapter.listFills(context), [
    {
      provider: "ibkr",
      accountId: "local-account-1",
      brokerOrderId: "ibkr-order-1",
      fillId: "fill-1",
      contractSymbol: "SPY",
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
          providerPositionId: "756733",
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

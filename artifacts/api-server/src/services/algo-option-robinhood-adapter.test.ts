import assert from "node:assert/strict";
import test from "node:test";

import type { AlgoTargetExecution } from "@workspace/db";

import type { AlgoOptionBrokerOrder } from "./algo-option-broker-adapter";
import { createAlgoRobinhoodOptionAdapter } from "./algo-option-robinhood-adapter";

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

test("Robinhood adapter normalizes review and submit with the released activation state", async () => {
  let reviewedInput: unknown;
  let submittedInput: unknown;
  const adapter = createAlgoRobinhoodOptionAdapter({
    now: () => new Date("2026-07-22T16:00:00.000Z"),
    reviewOrder: async (input) => {
      reviewedInput = input;
      return {
        provider: "robinhood",
        checkedAt: "2026-07-22T16:00:00.000Z",
        account: { id: "account-1", mode: "live" },
        order: {},
        review: {
          alerts: [],
          orderChecks: null,
          marketDataDisclosure: null,
          quote: null,
          estimate: {
            premium: 500,
            totalFee: 0,
            collateralAmount: null,
            collateralDirection: null,
            collateralInfinite: false,
          },
        },
      } as never;
    },
    placeOrder: async (input) => {
      submittedInput = input;
      return {
        provider: "robinhood",
        submittedAt: "2026-07-22T16:00:01.000Z",
        account: { id: "account-1", mode: "live" },
        order: {
          brokerageOrderId: "rh-order-1",
          state: "queued",
          refId: order.clientOrderId,
        },
        alerts: [],
      } as never;
    },
  });

  assert.equal(adapter.activationReleased, true);
  assert.deepEqual(adapter.technicalBlockers, []);
  assert.deepEqual(await adapter.reviewOrder({ ...context, order }), {
    provider: "robinhood",
    accountId: "account-1",
    checkedAt: new Date("2026-07-22T16:00:00.000Z"),
    accepted: true,
    warnings: [],
    estimatedPremium: 500,
  });
  assert.deepEqual(reviewedInput, {
    appUserId: "user-1",
    accountId: "account-1",
    input: {
      contractSymbol: "SPY260821C00600000",
      multiplier: 100,
      sharesPerContract: 100,
      chainSymbol: "SPY",
      underlyingType: "equity",
      expiration: "2026-08-21",
      strike: 600,
      optionType: "Call",
      side: "Buy",
      positionEffect: "Open",
      orderType: "Limit",
      timeInForce: "Day",
      marketHours: "regular_hours",
      quantity: 2,
      limitPrice: 2.5,
      stopPrice: null,
    },
    now: new Date("2026-07-22T16:00:00.000Z"),
  });

  assert.deepEqual(await adapter.submitEntry({ ...context, order }), {
    provider: "robinhood",
    accountId: "account-1",
    brokerOrderId: "rh-order-1",
    clientOrderId: order.clientOrderId,
    status: "queued",
    submittedAt: new Date("2026-07-22T16:00:01.000Z"),
    reconciliationRequired: false,
  });
  assert.deepEqual(submittedInput, {
    appUserId: "user-1",
    accountId: "account-1",
    input: {
      ...(reviewedInput as { input: Record<string, unknown> }).input,
      confirm: true,
      refId: order.clientOrderId,
      taxPreflightToken: "tax-proof",
    },
    now: new Date("2026-07-22T16:00:00.000Z"),
  });
});

test("Robinhood adapter normalizes durable exit and reconciliation states", async () => {
  const execution = {
    id: "execution-1",
    clientOrderId: order.clientOrderId,
    brokerOrderId: "rh-order-2",
    brokerOrderState: "partially_filled",
    status: "submitted",
    requestedQuantity: "2.000000",
    filledQuantity: "1.000000",
    updatedAt: new Date("2026-07-22T16:00:02.000Z"),
  } as AlgoTargetExecution;
  let exitInput: unknown;
  const adapter = createAlgoRobinhoodOptionAdapter({
    now: () => new Date("2026-07-22T16:00:02.000Z"),
    executeExit: async (input) => {
      exitInput = input;
      return execution;
    },
    reconcileEntry: async () => execution,
  });
  const exitOrder: AlgoOptionBrokerOrder = {
    ...order,
    side: "sell",
    positionEffect: "close",
  };
  const ownedPosition = {
    deploymentId: "deployment-1",
    targetId: "target-1",
    positionId: "position-1",
    targetExecutionId: "execution-1",
    providerPositionId: "provider-position-1",
  };

  const submitted = await adapter.submitOwnedPositionExit({
    ...context,
    order: exitOrder,
    ownedPosition,
  });
  assert.equal(submitted.status, "partially_filled");
  assert.equal(submitted.reconciliationRequired, false);
  assert.deepEqual(exitInput, {
    appUserId: "user-1",
    accountId: "account-1",
    algoContext: {
      deploymentId: "deployment-1",
      targetId: "target-1",
      positionId: "position-1",
      targetExecutionId: "execution-1",
    },
    order: {
      contractSymbol: "SPY260821C00600000",
      multiplier: 100,
      sharesPerContract: 100,
      chainSymbol: "SPY",
      underlyingType: "equity",
      expiration: "2026-08-21",
      strike: 600,
      optionType: "Call",
      side: "Sell",
      positionEffect: "Close",
      orderType: "Limit",
      timeInForce: "Day",
      marketHours: "regular_hours",
      quantity: 2,
      limitPrice: 2.5,
      stopPrice: null,
    },
  });

  assert.deepEqual(
    await adapter.reconcile({
      ...context,
      executionId: "execution-1",
      action: "entry",
    }),
    {
      provider: "robinhood",
      accountId: "account-1",
      executionId: "execution-1",
      state: "partially_filled",
      checkedAt: new Date("2026-07-22T16:00:02.000Z"),
    },
  );
});

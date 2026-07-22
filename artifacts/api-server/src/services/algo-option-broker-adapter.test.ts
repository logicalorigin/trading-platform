import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlgoOptionBrokerDispatcher,
  getAlgoOptionProviderBuildReadiness,
  type AlgoOptionBrokerAdapter,
  type AlgoOptionBrokerOrder,
} from "./algo-option-broker-adapter";

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
  quantity: 1,
  limitPrice: 2.5,
  clientOrderId: "11111111-1111-4111-8111-111111111111",
  taxPreflightToken: "tax-proof",
};

function completeAdapter(
  overrides: Partial<AlgoOptionBrokerAdapter> = {},
): AlgoOptionBrokerAdapter {
  return {
    provider: "robinhood",
    activationReleased: false,
    technicalBlockers: [],
    readCapital: async ({ accountId }) => ({
      accountId,
      netLiquidation: 10_000,
      buyingPower: 4_000,
      observedAt: new Date("2026-07-22T16:00:00.000Z"),
    }),
    readRisk: async ({ accountId }) => ({
      accountId,
      dailyRealizedPnl: 0,
      openSymbols: [],
      observedAt: new Date("2026-07-22T16:00:00.000Z"),
    }),
    reviewOrder: async ({ accountId }) => ({
      provider: "robinhood",
      accountId,
      checkedAt: new Date("2026-07-22T16:00:00.000Z"),
      accepted: true,
      warnings: [],
      estimatedPremium: 250,
    }),
    submitEntry: async ({ accountId, order: submittedOrder }) => ({
      provider: "robinhood",
      accountId,
      brokerOrderId: "order-1",
      clientOrderId: submittedOrder.clientOrderId,
      status: "submitted",
      submittedAt: new Date("2026-07-22T16:00:01.000Z"),
      reconciliationRequired: false,
    }),
    submitOwnedPositionExit: async ({ accountId, order: exitOrder }) => ({
      provider: "robinhood",
      accountId,
      brokerOrderId: "order-2",
      clientOrderId: exitOrder.clientOrderId,
      status: "submitted",
      submittedAt: new Date("2026-07-22T16:00:01.000Z"),
      reconciliationRequired: false,
    }),
    cancelOrder: async ({ accountId, brokerOrderId }) => ({
      provider: "robinhood",
      accountId,
      brokerOrderId,
      accepted: true,
      checkedAt: new Date("2026-07-22T16:00:02.000Z"),
      reconciliationRequired: false,
    }),
    listOrders: async () => [],
    listFills: async () => [],
    reconcile: async ({ accountId, executionId }) => ({
      provider: "robinhood",
      accountId,
      executionId,
      state: "pending",
      checkedAt: new Date("2026-07-22T16:00:03.000Z"),
    }),
    ...overrides,
  };
}

test("dispatcher rejects incomplete and duplicate provider adapters", () => {
  assert.throws(
    () =>
      createAlgoOptionBrokerDispatcher([
        { ...completeAdapter(), listFills: undefined } as unknown as AlgoOptionBrokerAdapter,
      ]),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_provider_adapter_incomplete");
      return true;
    },
  );

  assert.throws(
    () =>
      createAlgoOptionBrokerDispatcher([
        completeAdapter(),
        completeAdapter(),
      ]),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_provider_adapter_duplicate");
      return true;
    },
  );
});

test("dispatcher requires persisted target authority and a released provider gate", async () => {
  let submissions = 0;
  const adapter = completeAdapter({
    submitEntry: async ({ accountId, order: submittedOrder }) => {
      submissions += 1;
      return {
        provider: "robinhood",
        accountId,
        brokerOrderId: "order-1",
        clientOrderId: submittedOrder.clientOrderId,
        status: "submitted",
        submittedAt: new Date("2026-07-22T16:00:01.000Z"),
        reconciliationRequired: false,
      };
    },
  });
  const dispatcher = createAlgoOptionBrokerDispatcher([adapter]);
  const input = {
    provider: "robinhood" as const,
    appUserId: "user-1",
    accountId: "account-1",
    deploymentId: "deployment-1",
    targetId: "target-1",
    order,
  };

  await assert.rejects(
    dispatcher.submitEntry(input),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_provider_activation_not_released");
      return true;
    },
  );

  const releasedWithoutAuthority = createAlgoOptionBrokerDispatcher([
    { ...adapter, activationReleased: true },
  ]);
  await assert.rejects(
    releasedWithoutAuthority.submitEntry(input),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "algo_provider_mutation_authority_unavailable",
      );
      return true;
    },
  );
  assert.equal(submissions, 0);

  const staged = createAlgoOptionBrokerDispatcher(
    [{ ...adapter, activationReleased: true }],
    {
      authorizeMutation: async () => {
        throw Object.assign(new Error("staged"), {
          code: "algo_target_execution_disabled",
        });
      },
    },
  );
  await assert.rejects(staged.submitEntry(input), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "algo_target_execution_disabled");
    return true;
  });

  let authorizations = 0;
  const released = createAlgoOptionBrokerDispatcher(
    [{ ...adapter, activationReleased: true }],
    {
      authorizeMutation: async (authorityInput) => {
        authorizations += 1;
        assert.equal(authorityInput.action, "entry");
        assert.equal(authorityInput.targetId, "target-1");
      },
    },
  );
  const result = await released.submitEntry(input);
  assert.equal(result.brokerOrderId, "order-1");
  assert.equal(authorizations, 1);
  assert.equal(submissions, 1);
});

test("dispatcher surfaces technical blockers and never calls a blocked adapter", async () => {
  let submissions = 0;
  let reviews = 0;
  const dispatcher = createAlgoOptionBrokerDispatcher([
    completeAdapter({
      activationReleased: true,
      technicalBlockers: ["algo.provider.owned_exit_context_missing"],
      reviewOrder: async () => {
        reviews += 1;
        throw new Error("must not be called");
      },
      submitEntry: async () => {
        submissions += 1;
        throw new Error("must not be called");
      },
    }),
  ]);

  assert.deepEqual(dispatcher.describe("robinhood"), {
    provider: "robinhood",
    adapterComplete: true,
    technicalReady: false,
    technicalBlockers: ["algo.provider.owned_exit_context_missing"],
    activationReleased: true,
  });
  await assert.rejects(
    dispatcher.submitEntry({
      provider: "robinhood",
      appUserId: "user-1",
      accountId: "account-1",
      deploymentId: "deployment-1",
      targetId: "target-1",
      order,
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_provider_adapter_blocked");
      return true;
    },
  );
  await assert.rejects(
    dispatcher.reviewOrder({
      provider: "robinhood",
      appUserId: "user-1",
      accountId: "account-1",
      deploymentId: "deployment-1",
      targetId: "target-1",
      order,
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_provider_adapter_blocked");
      return true;
    },
  );
  assert.equal(submissions, 0);
  assert.equal(reviews, 0);
});

test("provider build-readiness releases Robinhood while keeping staged providers closed", () => {
  assert.deepEqual(getAlgoOptionProviderBuildReadiness("robinhood"), {
    provider: "robinhood",
    adapterImplemented: true,
    technicalReady: true,
    technicalBlockers: [],
    activationReleased: true,
  });
  for (const provider of ["schwab", "snaptrade", "ibkr"] as const) {
    const readiness = getAlgoOptionProviderBuildReadiness(provider);
    assert.equal(readiness.adapterImplemented, true);
    assert.equal(readiness.technicalReady, false);
    assert.ok(readiness.technicalBlockers.length > 0);
    assert.equal(readiness.activationReleased, false);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import type { AlgoOptionBrokerOrder } from "./algo-option-broker-adapter";
import { createAlgoSchwabOptionAdapter } from "./algo-option-schwab-adapter";

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

test("Schwab adapter wires existing option services but remains technically blocked", async () => {
  let previewInput: unknown;
  let submitInput: unknown;
  const adapter = createAlgoSchwabOptionAdapter({
    now: () => new Date("2026-07-22T16:00:00.000Z"),
    previewOrder: async (input) => {
      previewInput = input;
      return {
        provider: "schwab",
        checkedAt: "2026-07-22T16:00:00.000Z",
        account: { id: "account-1" },
        preview: {},
      } as never;
    },
    submitOrder: async (input) => {
      submitInput = input;
      return {
        provider: "schwab",
        submittedAt: "2026-07-22T16:00:01.000Z",
        account: { id: "account-1" },
        orderId: "schwab-order-1",
        status: "submitted",
      } as never;
    },
  });

  assert.equal(adapter.activationReleased, false);
  assert.ok(adapter.technicalBlockers.includes("schwab.order_tooling_unverified"));
  assert.ok(
    adapter.technicalBlockers.includes(
      "algo.provider.deterministic_client_order_id_unavailable",
    ),
  );
  assert.deepEqual(await adapter.reviewOrder({ ...context, order }), {
    provider: "schwab",
    accountId: "account-1",
    checkedAt: new Date("2026-07-22T16:00:00.000Z"),
    accepted: false,
    warnings: ["schwab_preview_normalization_pending"],
    estimatedPremium: null,
  });
  assert.deepEqual(previewInput, {
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
      instruction: "BuyToOpen",
      orderType: "Limit",
      duration: "Day",
      session: "Normal",
      quantity: 2,
      limitPrice: 2.5,
    },
    now: new Date("2026-07-22T16:00:00.000Z"),
  });

  assert.deepEqual(await adapter.submitEntry({ ...context, order }), {
    provider: "schwab",
    accountId: "account-1",
    brokerOrderId: "schwab-order-1",
    clientOrderId: order.clientOrderId,
    status: "submitted",
    submittedAt: new Date("2026-07-22T16:00:01.000Z"),
    reconciliationRequired: false,
  });
  assert.deepEqual(submitInput, {
    appUserId: "user-1",
    accountId: "account-1",
    input: {
      ...(previewInput as { input: Record<string, unknown> }).input,
      confirm: true,
      taxPreflightToken: "tax-proof",
    },
    now: new Date("2026-07-22T16:00:00.000Z"),
  });
});

test("Schwab adapter refuses unavailable risk, owned-exit, fill, and reconciliation lanes", async () => {
  const adapter = createAlgoSchwabOptionAdapter();
  const calls = [
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
    () => adapter.listFills(context),
    () =>
      adapter.reconcile({
        ...context,
        executionId: "execution-1",
        action: "entry",
      }),
  ];

  for (const call of calls) {
    await assert.rejects(call(), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "algo_provider_operation_unavailable");
      return true;
    });
  }
});

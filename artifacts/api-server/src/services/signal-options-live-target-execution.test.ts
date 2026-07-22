import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import {
  buildSignalOptionsLiveEntryRequest,
  dispatchSignalOptionsLiveEntryTargets,
  SIGNAL_OPTIONS_LIVE_PLATFORM_POLICY,
} from "./signal-options-live-target-execution";

const deployment = {
  id: "00000000-0000-4000-8000-000000000001",
  appUserId: "00000000-0000-4000-8000-000000000002",
  mode: "live" as const,
  enabled: true,
  isDraft: false,
  archivedAt: null,
};

const sourceEventId = "00000000-0000-4000-8000-000000000003";

const plan = {
  deployment,
  sourceEventId,
  selectedContract: {
    providerContractId: "O:AAPL260821C00210000",
    underlying: "AAPL",
    expirationDate: "2026-08-21",
    strike: 210,
    right: "call",
    multiplier: 100,
    sharesPerContract: 100,
  },
  orderPlan: {
    entryLimitPrice: 2.5,
    quantity: 10,
  },
  profile: {
    riskCaps: {
      maxContracts: 6,
      maxPremiumPerEntry: 1_000,
    },
  },
};

test("live entry request derives user risk limits from the saved deployment profile", () => {
  const request = buildSignalOptionsLiveEntryRequest({
    ...plan,
    targetId: "00000000-0000-4000-8000-000000000004",
  });

  assert.deepEqual(request.order, {
    contractSymbol: "O:AAPL260821C00210000",
    multiplier: 100,
    sharesPerContract: 100,
    chainSymbol: "AAPL",
    underlyingType: "equity",
    expiration: "2026-08-21",
    strike: 210,
    optionType: "Call",
    side: "Buy",
    positionEffect: "Open",
    orderType: "Limit",
    timeInForce: "Day",
    marketHours: "regular_hours",
    quantity: 10,
    limitPrice: 2.5,
    stopPrice: null,
  });
  assert.deepEqual(request.platformCaps, {
    maxContracts: 6,
    maxPremium: 1_000,
    ...SIGNAL_OPTIONS_LIVE_PLATFORM_POLICY,
  });
  assert.equal(request.strategyPositionKey, `signal-options:${sourceEventId}`);
});

test("live entry request rejects incomplete contract facts before target dispatch", () => {
  assert.throws(
    () =>
      buildSignalOptionsLiveEntryRequest({
        ...plan,
        targetId: "00000000-0000-4000-8000-000000000004",
        selectedContract: {
          ...plan.selectedContract,
          providerContractId: null,
        },
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === "signal_options_live_order_invalid",
  );
});

test("target fanout isolates failures and never calls an unreleased provider", async () => {
  const calls: string[] = [];
  const result = await dispatchSignalOptionsLiveEntryTargets(plan, {
    listTargets: async () => [
      {
        targetId: "00000000-0000-4000-8000-000000000004",
        accountId: "00000000-0000-4000-8000-000000000014",
        provider: "robinhood",
      },
      {
        targetId: "00000000-0000-4000-8000-000000000005",
        accountId: "00000000-0000-4000-8000-000000000015",
        provider: "robinhood",
      },
      {
        targetId: "00000000-0000-4000-8000-000000000006",
        accountId: "00000000-0000-4000-8000-000000000016",
        provider: "schwab",
      },
    ],
    describeProvider: (provider) => ({
      technicalReady: provider === "robinhood",
      activationReleased: provider === "robinhood",
      technicalBlockers:
        provider === "robinhood" ? [] : ["schwab.order_tooling_unverified"],
    }),
    executeRobinhoodEntry: async (request) => {
      calls.push(request.targetId);
      if (request.targetId.endsWith("4")) {
        throw new HttpError(409, "Account is blocked.", {
          code: "algo_target_account_execution_blocked",
          expose: true,
        });
      }
      return {
        id: "00000000-0000-4000-8000-000000000099",
        status: "submitted",
        brokerOrderId: "rh-order-1",
      } as never;
    },
  });

  assert.deepEqual(calls, [
    "00000000-0000-4000-8000-000000000004",
    "00000000-0000-4000-8000-000000000005",
  ]);
  assert.deepEqual(
    result.results.map(({ provider, status, code }) => ({
      provider,
      status,
      code,
    })),
    [
      {
        provider: "robinhood",
        status: "failed",
        code: "algo_target_account_execution_blocked",
      },
      { provider: "robinhood", status: "submitted", code: null },
      {
        provider: "schwab",
        status: "blocked",
        code: "algo_provider_adapter_blocked",
      },
    ],
  );
  assert.equal(result.submitted, 1);
});

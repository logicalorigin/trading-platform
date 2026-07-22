import assert from "node:assert/strict";
import test from "node:test";

import { sizeAlgoOptionLiveEntry } from "./algo-option-live-sizing";

const now = new Date("2026-07-21T20:00:00.000Z");

function sizingInput(
  overrides: Partial<Parameters<typeof sizeAlgoOptionLiveEntry>[0]> = {},
) {
  return {
    requestedQuantity: 10,
    limitPrice: 2.5,
    multiplier: 100,
    strategyMaxContracts: 8,
    strategyMaxPremium: 1_500,
    targetAllowance: { unit: "percent" as const, value: 20 },
    targetPremiumAtRisk: 300,
    targetPremiumReserved: 0,
    totalAlgoAllowance: { unit: "percent" as const, value: 50 },
    accountPremiumAtRisk: 350,
    accountPremiumReserved: 0,
    platformMaxContracts: 6,
    platformMaxPremium: 1_000,
    netLiquidation: 10_000,
    buyingPower: 4_000,
    balanceObservedAt: new Date("2026-07-21T19:59:45.000Z"),
    now,
    maxBalanceAgeMs: 45_000,
    ...overrides,
  };
}

test("live option sizing uses the tightest cap and only sizes down", () => {
  const result = sizeAlgoOptionLiveEntry(sizingInput());

  assert.deepEqual(result, {
    quantity: 2,
    requestedQuantity: 10,
    premiumPerContract: 250,
    requestedPremium: 2_500,
    allowedPremium: 500,
    spendingBase: 4_000,
    targetPremiumLimit: 800,
    targetPremiumRemaining: 500,
    accountPremiumLimit: 2_000,
    accountPremiumRemaining: 1_650,
    sizedDown: true,
  });

  assert.equal(
    sizeAlgoOptionLiveEntry(
      sizingInput({
        requestedQuantity: 1,
        targetPremiumAtRisk: 0,
      }),
    ).quantity,
    1,
  );
});

test("live option sizing fails closed on stale capital", () => {
  assert.throws(
    () =>
      sizeAlgoOptionLiveEntry(
        sizingInput({
          balanceObservedAt: new Date("2026-07-21T19:59:14.999Z"),
        }),
      ),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      assert.equal((error as { code?: string }).code, "algo_capital_base_stale");
      return true;
    },
  );
});

test("live option sizing fails when no whole contract fits", () => {
  assert.throws(
    () =>
      sizeAlgoOptionLiveEntry(
        sizingInput({
          targetAllowance: { unit: "percent", value: 5 },
          targetPremiumAtRisk: 199,
        }),
      ),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      assert.equal((error as { code?: string }).code, "algo_entry_cap_exhausted");
      return true;
    },
  );
});

test("live option sizing rejects invalid financial inputs", () => {
  for (const overrides of [
    { requestedQuantity: 0 },
    { requestedQuantity: 1.5 },
    { limitPrice: Number.NaN },
    { multiplier: 10 },
    { targetAllowance: { unit: "percent" as const, value: 101 } },
    { accountPremiumAtRisk: -1 },
    { buyingPower: -1 },
    { maxBalanceAgeMs: 0 },
  ]) {
    assert.throws(
      () => sizeAlgoOptionLiveEntry(sizingInput(overrides)),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 422);
        assert.equal((error as { code?: string }).code, "algo_live_sizing_invalid");
        return true;
      },
    );
  }
});

test("live option sizing supports USD allowances without converting units", () => {
  const result = sizeAlgoOptionLiveEntry(
    sizingInput({
      targetAllowance: { unit: "usd", value: 900 },
      targetPremiumAtRisk: 200,
      targetPremiumReserved: 100,
      totalAlgoAllowance: { unit: "usd", value: 1_000 },
      accountPremiumAtRisk: 600,
      accountPremiumReserved: 150,
      strategyMaxPremium: 5_000,
      platformMaxPremium: 5_000,
    }),
  );

  assert.equal(result.targetPremiumLimit, 900);
  assert.equal(result.targetPremiumRemaining, 600);
  assert.equal(result.accountPremiumLimit, 1_000);
  assert.equal(result.accountPremiumRemaining, 250);
  assert.equal(result.allowedPremium, 250);
  assert.equal(result.quantity, 1);
});

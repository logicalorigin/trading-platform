import assert from "node:assert/strict";
import test from "node:test";

import {
  AlgoAllowancePolicyError,
  parseAlgoAllowanceSetting,
  resolveAlgoAllowancePool,
} from "./algo-allowance-policy";

const now = new Date("2026-07-22T15:00:00.000Z");

function poolInput(
  overrides: Partial<Parameters<typeof resolveAlgoAllowancePool>[0]> = {},
) {
  return {
    targetAllowance: { unit: "usd" as const, value: 1_000 },
    totalAlgoAllowance: { unit: "usd" as const, value: 2_000 },
    targetExposureUsd: 300,
    targetReservationUsd: 100,
    accountExposureUsd: 600,
    accountReservationUsd: 200,
    netLiquidation: 10_000,
    buyingPower: 4_000,
    capitalObservedAt: new Date("2026-07-22T14:59:45.000Z"),
    now,
    maxCapitalAgeMs: 45_000,
    ...overrides,
  };
}

test("allowance settings preserve explicit USD and percentage units", () => {
  assert.deepEqual(
    parseAlgoAllowanceSetting({ unit: "usd", value: 12_500.25 }),
    { unit: "usd", value: 12_500.25 },
  );
  assert.deepEqual(
    parseAlgoAllowanceSetting({ unit: "percent", value: 37.5 }),
    { unit: "percent", value: 37.5 },
  );
});

test("allowance settings reject unknown shape and unsafe values", () => {
  for (const value of [
    null,
    { unit: "shares", value: 1 },
    { unit: "usd", value: 0 },
    { unit: "usd", value: 10_000_001 },
    { unit: "percent", value: 100.01 },
    { unit: "percent", value: Number.NaN },
    { unit: "usd", value: 1_000, hiddenCap: 2_000 },
  ]) {
    assert.throws(
      () => parseAlgoAllowanceSetting(value),
      (error: unknown) => {
        assert.ok(error instanceof AlgoAllowancePolicyError);
        assert.equal(error.code, "algo_allowance_invalid");
        return true;
      },
    );
  }
});

test("USD target allowance and shared account total resolve independently", () => {
  assert.deepEqual(resolveAlgoAllowancePool(poolInput()), {
    spendingBaseUsd: 4_000,
    capitalObservedAt: new Date("2026-07-22T14:59:45.000Z"),
    target: {
      configured: { unit: "usd", value: 1_000 },
      limitUsd: 1_000,
      usedUsd: 400,
      remainingUsd: 600,
    },
    account: {
      configured: { unit: "usd", value: 2_000 },
      limitUsd: 2_000,
      usedUsd: 800,
      remainingUsd: 1_200,
    },
    effectiveRemainingUsd: 600,
  });
});

test("percentage allowances use the stricter fresh account capital base", () => {
  const result = resolveAlgoAllowancePool(
    poolInput({
      targetAllowance: { unit: "percent", value: 25 },
      totalAlgoAllowance: { unit: "percent", value: 60 },
    }),
  );

  assert.equal(result.spendingBaseUsd, 4_000);
  assert.equal(result.target.limitUsd, 1_000);
  assert.equal(result.account.limitUsd, 2_400);
  assert.equal(result.target.remainingUsd, 600);
  assert.equal(result.account.remainingUsd, 1_600);
  assert.equal(result.effectiveRemainingUsd, 600);
});

test("elastic targets may exceed the account total but cannot consume past it", () => {
  const result = resolveAlgoAllowancePool(
    poolInput({
      targetAllowance: { unit: "usd", value: 8_000 },
      totalAlgoAllowance: { unit: "usd", value: 1_000 },
      targetExposureUsd: 200,
      targetReservationUsd: 100,
      accountExposureUsd: 700,
      accountReservationUsd: 250,
    }),
  );

  assert.equal(result.target.remainingUsd, 7_700);
  assert.equal(result.account.remainingUsd, 50);
  assert.equal(result.effectiveRemainingUsd, 50);
});

test("allowance resolution fails closed on stale or inconsistent capital facts", () => {
  for (const [overrides, code] of [
    [
      { capitalObservedAt: new Date("2026-07-22T14:59:14.999Z") },
      "algo_allowance_capital_stale",
    ],
    [{ buyingPower: -1 }, "algo_allowance_capital_invalid"],
    [
      {
        targetExposureUsd: 500,
        targetReservationUsd: 200,
        accountExposureUsd: 400,
        accountReservationUsd: 100,
      },
      "algo_allowance_exposure_inconsistent",
    ],
  ] as const) {
    assert.throws(
      () => resolveAlgoAllowancePool(poolInput(overrides)),
      (error: unknown) => {
        assert.ok(error instanceof AlgoAllowancePolicyError);
        assert.equal(error.code, code);
        return true;
      },
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import { applySignalOptionsTradingAllowance } from "./signal-options-automation";

test("resolver: trading-allowance fields default to off / cost / 10k", () => {
  const profile = resolveSignalOptionsExecutionProfile({});
  assert.equal(profile.riskHaltControls.tradingAllowanceEnabled, false);
  assert.equal(profile.riskCaps.tradingAllowance, 10_000);
  assert.equal(profile.riskCaps.allowanceBasis, "cost");
});

test("resolver: tradingAllowance clamps to [100, 10_000_000]", () => {
  assert.equal(
    resolveSignalOptionsExecutionProfile({ riskCaps: { tradingAllowance: 5 } })
      .riskCaps.tradingAllowance,
    100,
  );
  assert.equal(
    resolveSignalOptionsExecutionProfile({
      riskCaps: { tradingAllowance: 99_999_999 },
    }).riskCaps.tradingAllowance,
    10_000_000,
  );
});

test("resolver: allowanceBasis validates the enum (invalid -> cost)", () => {
  assert.equal(
    resolveSignalOptionsExecutionProfile({ riskCaps: { allowanceBasis: "mark" } })
      .riskCaps.allowanceBasis,
    "mark",
  );
  assert.equal(
    resolveSignalOptionsExecutionProfile({
      riskCaps: { allowanceBasis: "nonsense" },
    }).riskCaps.allowanceBasis,
    "cost",
  );
});

test("resolver: enable toggle resolves from nested + root", () => {
  assert.equal(
    resolveSignalOptionsExecutionProfile({
      riskHaltControls: { tradingAllowanceEnabled: true },
    }).riskHaltControls.tradingAllowanceEnabled,
    true,
  );
});

test("allowance helper: no-op when disabled", () => {
  const result = applySignalOptionsTradingAllowance({
    enabled: false,
    simulatedFillPrice: 2,
    requestedQuantity: 3,
    availableBudget: 50,
    contractMultiplier: 100,
  });
  assert.equal(result.quantity, 3);
  assert.equal(result.exhausted, false);
  assert.equal(result.sizedDown, false);
});

test("allowance helper: unbounded budget returns the requested size", () => {
  const result = applySignalOptionsTradingAllowance({
    enabled: true,
    simulatedFillPrice: 2,
    requestedQuantity: 3,
    availableBudget: Number.POSITIVE_INFINITY,
    contractMultiplier: 100,
  });
  assert.equal(result.quantity, 3);
  assert.equal(result.sizedDown, false);
});

test("allowance helper: sizes down to floor(available / (fillPrice*100))", () => {
  // contract cost = 2 * 100 = 200; available 500 -> floor = 2 of requested 3
  const result = applySignalOptionsTradingAllowance({
    enabled: true,
    simulatedFillPrice: 2,
    requestedQuantity: 3,
    availableBudget: 500,
    contractMultiplier: 100,
  });
  assert.equal(result.quantity, 2);
  assert.equal(result.premiumAtRisk, 400);
  assert.equal(result.sizedDown, true);
  assert.equal(result.exhausted, false);
});

test("allowance helper: 1-contract minimum is honored", () => {
  // cost 200; available 250 -> affords exactly 1 contract
  const result = applySignalOptionsTradingAllowance({
    enabled: true,
    simulatedFillPrice: 2,
    requestedQuantity: 3,
    availableBudget: 250,
    contractMultiplier: 100,
  });
  assert.equal(result.quantity, 1);
  assert.equal(result.sizedDown, true);
  assert.equal(result.exhausted, false);
});

test("allowance helper: exhausted when it can't fund one contract", () => {
  const result = applySignalOptionsTradingAllowance({
    enabled: true,
    simulatedFillPrice: 2,
    requestedQuantity: 3,
    availableBudget: 150,
    contractMultiplier: 100,
  });
  assert.equal(result.quantity, 0);
  assert.equal(result.exhausted, true);
});

test("allowance helper: full size when budget covers the request exactly", () => {
  const result = applySignalOptionsTradingAllowance({
    enabled: true,
    simulatedFillPrice: 2,
    requestedQuantity: 3,
    availableBudget: 600,
    contractMultiplier: 100,
  });
  assert.equal(result.quantity, 3);
  assert.equal(result.sizedDown, false);
});

test("allowance helper uses the explicit premium multiplier", () => {
  const result = applySignalOptionsTradingAllowance({
    enabled: true,
    simulatedFillPrice: 2,
    requestedQuantity: 3,
    availableBudget: 50,
    contractMultiplier: 10,
  });
  assert.equal(result.quantity, 2);
  assert.equal(result.premiumAtRisk, 40);
  assert.equal(result.sizedDown, true);
});

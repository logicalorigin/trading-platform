import assert from "node:assert/strict";
import { test } from "node:test";
import { computeShadowOrderFees } from "./shadow-account";

test("computeShadowOrderFees applies IBKR Pro Fixed option fees", () => {
  assert.equal(
    computeShadowOrderFees({
      assetClass: "option",
      quantity: 3,
      price: 1.25,
      multiplier: 100,
    }),
    2.02,
  );
});

test("computeShadowOrderFees applies stock min and cap", () => {
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 10,
      price: 100,
    }),
    1,
  );
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 100_000,
      price: 1,
    }),
    500,
  );
  assert.equal(
    computeShadowOrderFees({
      assetClass: "equity",
      quantity: 100_000,
      price: 0.02,
    }),
    20,
  );
});

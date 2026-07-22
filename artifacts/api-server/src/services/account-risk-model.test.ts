import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateGreeksByUnderlying,
  sumNullableValues,
} from "./account-risk-model";

test("risk totals require a complete numeric population", () => {
  assert.equal(sumNullableValues([1, 2, 3]), 6);
  assert.equal(sumNullableValues([1, null, 3]), null);
  assert.equal(sumNullableValues([1, undefined, 3]), null);
  assert.equal(sumNullableValues([]), null);
});

test("per-underlying Greek totals require every position contribution", () => {
  const [summary] = aggregateGreeksByUnderlying([
    {
      underlying: "AAPL",
      exposure: 100,
      isOption: false,
      greek: {
        delta: 1,
        betaWeightedDelta: 1.2,
        gamma: 0,
        theta: 0,
        vega: 0,
      },
    },
    {
      underlying: "AAPL",
      exposure: 50,
      isOption: true,
      greek: {
        delta: null,
        betaWeightedDelta: null,
        gamma: null,
        theta: null,
        vega: null,
      },
    },
  ]);

  assert.deepEqual(summary, {
    underlying: "AAPL",
    exposure: 150,
    delta: null,
    betaWeightedDelta: null,
    gamma: null,
    theta: null,
    vega: null,
    positionCount: 2,
    optionPositionCount: 1,
  });
});

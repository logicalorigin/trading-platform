import assert from "node:assert/strict";
import test from "node:test";

import { __tradeStrategyGreeksPanelInternalsForTests } from "./TradeStrategyGreeksPanel.jsx";

const { resolveTradeStrategyGreeksState } =
  __tradeStrategyGreeksPanelInternalsForTests;

test("Trade strategy presets remain available when the selected strike has not resolved", () => {
  assert.deepEqual(
    resolveTradeStrategyGreeksState({
      chainRows: [
        {
          k: 195,
          cDelta: 0.51,
          pDelta: -0.49,
        },
      ],
      strike: 200,
      cp: "C",
    }),
    {
      kind: "unavailable",
      availableCount: 0,
      values: {
        delta: null,
        gamma: null,
        theta: null,
        vega: null,
      },
      multiplier: null,
      strategyAvailability: {
        C: true,
        P: true,
      },
    },
  );
});

test("Trade Greeks expose partial values instead of collapsing the whole panel", () => {
  assert.deepEqual(
    resolveTradeStrategyGreeksState({
      chainRows: [
        {
          k: 200,
          cDelta: 0.52,
          cGamma: 0.04,
          cTheta: null,
          cVega: 0.13,
          pDelta: -0.48,
        },
      ],
      strike: 200,
      cp: "C",
    }),
    {
      kind: "partial",
      availableCount: 3,
      values: {
        delta: 0.52,
        gamma: 0.04,
        theta: null,
        vega: 0.13,
      },
      multiplier: null,
      strategyAvailability: {
        C: true,
        P: true,
      },
    },
  );
});

test("Trade Greeks report a complete selected-contract snapshot", () => {
  assert.deepEqual(
    resolveTradeStrategyGreeksState({
      chainRows: [
        {
          k: 200,
          pDelta: -0.48,
          pGamma: 0.04,
          pTheta: -0.08,
          pVega: 0.13,
          pContract: { multiplier: 10 },
        },
      ],
      strike: 200,
      cp: "P",
    }),
    {
      kind: "ready",
      availableCount: 4,
      values: {
        delta: -0.48,
        gamma: 0.04,
        theta: -0.08,
        vega: 0.13,
      },
      multiplier: 10,
      strategyAvailability: {
        C: false,
        P: true,
      },
    },
  );
});

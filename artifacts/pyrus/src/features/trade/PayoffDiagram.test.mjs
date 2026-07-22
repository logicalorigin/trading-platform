import assert from "node:assert/strict";
import test from "node:test";

import { __payoffDiagramInternalsForTests } from "./PayoffDiagram.jsx";

const { resolvePayoffDiagramModel } = __payoffDiagramInternalsForTests;

test("option payoff limits use theoretical outcomes instead of the visible chart window", () => {
  assert.deepEqual(
    resolvePayoffDiagramModel({
      optType: "C",
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      currentPrice: 102,
      side: "BUY",
    }),
    {
      kind: "ready",
      isCall: true,
      isLong: true,
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      currentPrice: 102,
      referencePrice: 102,
      breakeven: 105,
      maxProfit: null,
      maxProfitUnlimited: true,
      maxLoss: -1000,
      maxLossUnlimited: false,
    },
  );
  assert.deepEqual(
    resolvePayoffDiagramModel({
      optType: "P",
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      side: "BUY",
    }),
    {
      kind: "ready",
      isCall: false,
      isLong: true,
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      currentPrice: null,
      referencePrice: 100,
      breakeven: 95,
      maxProfit: 19000,
      maxProfitUnlimited: false,
      maxLoss: -1000,
      maxLossUnlimited: false,
    },
  );
  assert.deepEqual(
    resolvePayoffDiagramModel({
      optType: "C",
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      side: "SELL",
    }),
    {
      kind: "ready",
      isCall: true,
      isLong: false,
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      currentPrice: null,
      referencePrice: 100,
      breakeven: 105,
      maxProfit: 1000,
      maxProfitUnlimited: false,
      maxLoss: null,
      maxLossUnlimited: true,
    },
  );
  assert.deepEqual(
    resolvePayoffDiagramModel({
      optType: "P",
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      side: "SELL",
    }),
    {
      kind: "ready",
      isCall: false,
      isLong: false,
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 100,
      currentPrice: null,
      referencePrice: 100,
      breakeven: 95,
      maxProfit: 1000,
      maxProfitUnlimited: false,
      maxLoss: -19000,
      maxLossUnlimited: false,
    },
  );
});

test("payoff chart refuses incomplete option economics", () => {
  assert.deepEqual(
    resolvePayoffDiagramModel({
      optType: "C",
      strike: 100,
      premium: Number.NaN,
      qty: 2,
      multiplier: 100,
      side: "BUY",
    }),
    { kind: "unavailable" },
  );
  assert.deepEqual(
    resolvePayoffDiagramModel({
      optType: "P",
      strike: 100,
      premium: 5,
      qty: 0,
      multiplier: 100,
      side: "SELL",
    }),
    { kind: "unavailable" },
  );
  assert.deepEqual(
    resolvePayoffDiagramModel({
      optType: "C",
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: null,
      side: "BUY",
    }),
    { kind: "unavailable" },
  );
});

test("payoff economics use the selected contract multiplier", () => {
  assert.equal(
    resolvePayoffDiagramModel({
      optType: "C",
      strike: 100,
      premium: 5,
      qty: 2,
      multiplier: 10,
      side: "BUY",
    }).maxLoss,
    -100,
  );
});

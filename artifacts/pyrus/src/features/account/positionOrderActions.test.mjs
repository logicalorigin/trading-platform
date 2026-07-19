import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_BLOTTER_CANCELLATION_AVAILABLE,
  ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON,
  buildCloseOrderRequest,
  buildStopOrderRequest,
  positionExitSide,
} from "./positionOrderActions.js";

test("generic broker blotters fail closed when lifecycle ownership is unknown", () => {
  assert.equal(ORDER_BLOTTER_CANCELLATION_AVAILABLE, false);
  assert.match(
    ORDER_BLOTTER_CANCELLATION_UNAVAILABLE_REASON,
    /cannot verify that the broker order belongs to PYRUS's prepared lifecycle/,
  );
});

test("positionExitSide exits long positions by selling and short positions by buying", () => {
  assert.equal(positionExitSide({ quantity: 3 }), "sell");
  assert.equal(positionExitSide({ quantity: -2 }), "buy");
  assert.equal(positionExitSide({ quantity: 0 }), "sell");
});

test("buildCloseOrderRequest creates a market day exit order for an option position", () => {
  const request = buildCloseOrderRequest({
    accountId: "acct-123",
    environment: "shadow",
    position: {
      symbol: "AAPL",
      assetClass: "option",
      quantity: 2,
      optionContract: {
        ticker: "AAPL",
        underlying: "AAPL",
        expirationDate: "2026-01-16",
        strike: 200,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "AAPL260116C00200000",
      },
    },
  });

  assert.deepEqual(request, {
    accountId: "acct-123",
    mode: "shadow",
    symbol: "AAPL",
    assetClass: "option",
    side: "sell",
    type: "market",
    quantity: 2,
    timeInForce: "day",
    optionContract: {
      ticker: "AAPL",
      underlying: "AAPL",
      expirationDate: "2026-01-16",
      strike: 200,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "AAPL260116C00200000",
    },
  });
});

test("buildStopOrderRequest creates a GTC stop exit order for a short equity position", () => {
  const request = buildStopOrderRequest({
    accountId: "acct-456",
    environment: "live",
    position: {
      symbol: "MSFT",
      assetClass: "stock",
      quantity: -4,
    },
    stopPrice: 421.25,
  });

  assert.deepEqual(request, {
    accountId: "acct-456",
    mode: "live",
    symbol: "MSFT",
    assetClass: "stock",
    side: "buy",
    type: "stop",
    quantity: 4,
    stopPrice: 421.25,
    timeInForce: "gtc",
    optionContract: null,
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";
import { orderGroupKey, positionGroupKey } from "./account-trade-model";

function optionPosition(providerContractId: string): BrokerPositionSnapshot {
  return {
    id: `position-${providerContractId}`,
    accountId: "account-1",
    symbol: "AAPL",
    assetClass: "option",
    providerSecurityType: "OPT",
    quantity: 1,
    averagePrice: 2,
    marketPrice: 3,
    marketValue: 300,
    unrealizedPnl: 100,
    unrealizedPnlPercent: 50,
    optionContract: {
      ticker: providerContractId,
      underlying: "AAPL",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 200,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId,
    },
  };
}

test("option grouping preserves authoritative provider contract identity", () => {
  const first = optionPosition("111");
  const second = optionPosition("222");
  const matchingOrder: BrokerOrderSnapshot = {
    id: "order-1",
    accountId: first.accountId,
    providerContractId: "111",
    mode: "live",
    symbol: "AAPL",
    assetClass: "option",
    side: "sell",
    type: "stop",
    timeInForce: "day",
    status: "submitted",
    quantity: 1,
    filledQuantity: 0,
    limitPrice: null,
    stopPrice: 2.5,
    placedAt: new Date("2026-07-21T12:00:00.000Z"),
    updatedAt: new Date("2026-07-21T12:00:00.000Z"),
    optionContract: first.optionContract,
  };

  assert.notEqual(positionGroupKey(first), positionGroupKey(second));
  assert.equal(positionGroupKey(first), orderGroupKey(matchingOrder));
});

test("native Robinhood option grouping fails closed without contract identity", () => {
  const first = {
    ...optionPosition("first"),
    id: "robinhood-position-1",
    providerSecurityType: "ROBINHOOD_OPTION",
    optionContract: {
      ...optionPosition("first").optionContract!,
      providerContractId: null,
      brokerContractId: null,
    },
  };
  const second = {
    ...first,
    id: "robinhood-position-2",
  };
  const order: BrokerOrderSnapshot = {
    id: "robinhood-order-without-contract-id",
    accountId: first.accountId,
    providerContractId: null,
    mode: "live",
    symbol: "AAPL",
    assetClass: "option",
    side: "sell",
    type: "stop",
    timeInForce: "day",
    status: "submitted",
    quantity: 1,
    filledQuantity: 0,
    limitPrice: null,
    stopPrice: 2.5,
    placedAt: new Date("2026-07-21T12:00:00.000Z"),
    updatedAt: new Date("2026-07-21T12:00:00.000Z"),
    optionContract: first.optionContract,
  };

  assert.notEqual(positionGroupKey(first), positionGroupKey(second));
  assert.notEqual(positionGroupKey(first), orderGroupKey(order));
});

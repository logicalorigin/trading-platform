import assert from "node:assert/strict";
import test from "node:test";
import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  PlaceOrderInput,
} from "../providers/ibkr/client";
import {
  buildSellCallCoverageSnapshot,
  validateSellCallOrderIntent,
} from "./option-order-intent";

const expirationDate = new Date("2026-06-19T00:00:00.000Z");
const optionContract = {
  ticker: "SPY   260619C00500000",
  underlying: "SPY",
  expirationDate,
  strike: 500,
  right: "call" as const,
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: "12345",
};

function order(patch: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    accountId: "DU123",
    mode: "paper",
    symbol: "SPY",
    assetClass: "option",
    side: "sell",
    type: "limit",
    quantity: 1,
    limitPrice: 1.25,
    stopPrice: null,
    timeInForce: "day",
    optionContract,
    ...patch,
  };
}

function position(
  patch: Partial<BrokerPositionSnapshot> = {},
): BrokerPositionSnapshot {
  return {
    id: "position-1",
    accountId: "DU123",
    symbol: "SPY",
    assetClass: "option",
    quantity: 1,
    averagePrice: 1,
    marketPrice: 1.25,
    marketValue: 125,
    unrealizedPnl: 25,
    unrealizedPnlPercent: 25,
    optionContract,
    ...patch,
  };
}

function brokerOrder(
  patch: Partial<BrokerOrderSnapshot> = {},
): BrokerOrderSnapshot {
  return {
    id: "order-1",
    accountId: "DU123",
    mode: "paper",
    symbol: "SPY",
    assetClass: "option",
    side: "sell",
    type: "limit",
    timeInForce: "day",
    status: "submitted",
    quantity: 1,
    filledQuantity: 0,
    limitPrice: 1.5,
    stopPrice: null,
    placedAt: new Date("2026-05-06T15:00:00.000Z"),
    updatedAt: new Date("2026-05-06T15:00:00.000Z"),
    optionContract,
    ...patch,
  };
}

function assertRejectsWithCode(
  fn: () => unknown,
  code: string,
) {
  assert.throws(fn, (error) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

test("allows implicit sell-to-close when the account is long enough calls", () => {
  assert.doesNotThrow(() =>
    validateSellCallOrderIntent({
      order: order({ quantity: 2 }),
      positions: [position({ quantity: 2 })],
      orders: [],
    }),
  );
});

test("rejects sell-to-close above the matching long-call quantity", () => {
  assertRejectsWithCode(
    () =>
      validateSellCallOrderIntent({
        order: order({
          quantity: 2,
          positionEffect: "close",
          strategyIntent: "sell_to_close",
        }),
        positions: [position({ quantity: 1 })],
        orders: [],
      }),
    "ibkr_sell_to_close_quantity_exceeds_position",
  );
});

test("allows covered calls when unreserved underlying shares cover the sale", () => {
  assert.doesNotThrow(() =>
    validateSellCallOrderIntent({
      order: order({
        quantity: 2,
        positionEffect: "open",
        strategyIntent: "covered_call",
      }),
      positions: [
        position({
          id: "shares",
          assetClass: "equity",
          quantity: 250,
          optionContract: null,
        }),
      ],
      orders: [],
    }),
  );
});

test("reserves shares for existing short calls and pending sell-call orders", () => {
  const coverage = buildSellCallCoverageSnapshot({
    order: order({ quantity: 1 }),
    positions: [
      position({
        id: "shares",
        assetClass: "equity",
        quantity: 300,
        optionContract: null,
      }),
      position({
        id: "short-call",
        quantity: -1,
      }),
    ],
    orders: [
      brokerOrder({
        quantity: 1,
        filledQuantity: 0,
        optionContract: {
          ...optionContract,
          providerContractId: "67890",
          strike: 510,
        },
      }),
    ],
  });

  assert.equal(coverage.longUnderlyingShares, 300);
  assert.equal(coverage.reservedShares, 200);
  assert.equal(coverage.coveredCallCapacity, 1);

  assertRejectsWithCode(
    () =>
      validateSellCallOrderIntent({
        order: order({
          quantity: 2,
          positionEffect: "open",
          strategyIntent: "covered_call",
        }),
        positions: [
          position({
            id: "shares",
            assetClass: "equity",
            quantity: 300,
            optionContract: null,
          }),
          position({
            id: "short-call",
            quantity: -1,
          }),
        ],
        orders: [
          brokerOrder({
            quantity: 1,
            filledQuantity: 0,
            optionContract: {
              ...optionContract,
              providerContractId: "67890",
              strike: 510,
            },
          }),
        ],
      }),
    "ibkr_covered_call_insufficient_shares",
  );
});

test("pending sell-to-close orders consume matching long-call availability", () => {
  const coverage = buildSellCallCoverageSnapshot({
    order: order({ quantity: 1 }),
    positions: [position({ quantity: 1 })],
    orders: [brokerOrder({ quantity: 1, filledQuantity: 0 })],
  });

  assert.equal(coverage.matchingLongCallContracts, 1);
  assert.equal(coverage.pendingMatchingSellCallContracts, 1);
  assert.equal(coverage.availableMatchingLongCallContracts, 0);
  assert.equal(coverage.pendingShortOpeningSellCallContracts, 0);
  assert.equal(coverage.reservedShares, 0);

  assertRejectsWithCode(
    () =>
      validateSellCallOrderIntent({
        order: order({
          quantity: 1,
          positionEffect: "close",
          strategyIntent: "sell_to_close",
        }),
        positions: [position({ quantity: 1 })],
        orders: [brokerOrder({ quantity: 1, filledQuantity: 0 })],
      }),
    "ibkr_sell_to_close_quantity_exceeds_position",
  );
});

test("pending underlying share sales reduce covered-call capacity", () => {
  const coverage = buildSellCallCoverageSnapshot({
    order: order({ quantity: 1 }),
    positions: [
      position({
        id: "shares",
        assetClass: "equity",
        quantity: 100,
        optionContract: null,
      }),
    ],
    orders: [
      brokerOrder({
        id: "share-sale",
        assetClass: "equity",
        symbol: "SPY",
        quantity: 100,
        optionContract: null,
      }),
    ],
  });

  assert.equal(coverage.pendingUnderlyingSellShares, 100);
  assert.equal(coverage.reservedShares, 100);
  assert.equal(coverage.coveredCallCapacity, 0);

  assertRejectsWithCode(
    () =>
      validateSellCallOrderIntent({
        order: order({
          quantity: 1,
          positionEffect: "open",
          strategyIntent: "covered_call",
        }),
        positions: [
          position({
            id: "shares",
            assetClass: "equity",
            quantity: 100,
            optionContract: null,
          }),
        ],
        orders: [
          brokerOrder({
            id: "share-sale",
            assetClass: "equity",
            symbol: "SPY",
            quantity: 100,
            optionContract: null,
          }),
        ],
      }),
    "ibkr_covered_call_insufficient_shares",
  );
});

test("rejects explicit uncovered short-call intent", () => {
  assertRejectsWithCode(
    () =>
      validateSellCallOrderIntent({
        order: order({
          positionEffect: "open",
          strategyIntent: "uncovered_short_call",
        }),
        positions: [],
        orders: [],
      }),
    "ibkr_uncovered_short_call_disabled",
  );
});

test("rejects ambiguous call sales that would open a short call", () => {
  assertRejectsWithCode(
    () =>
      validateSellCallOrderIntent({
        order: order({ quantity: 1 }),
        positions: [],
        orders: [],
      }),
    "ibkr_call_sell_requires_explicit_open_or_close_intent",
  );
});

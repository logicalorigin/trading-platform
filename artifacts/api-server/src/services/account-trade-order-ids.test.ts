import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrokerExecutionSnapshot,
  BrokerOrderSnapshot,
} from "../providers/ibkr/client";
import { __accountOrderInternalsForTests as internals } from "./account";

const execution = (input: {
  id: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  executedAt: string;
}): BrokerExecutionSnapshot => ({
  id: input.id,
  accountId: "U123",
  symbol: "AAPL",
  assetClass: "equity",
  side: input.side,
  quantity: input.quantity,
  price: input.price,
  netAmount: null,
  commission: null,
  exchange: null,
  executedAt: new Date(input.executedAt),
  orderDescription: null,
  contractDescription: null,
  providerContractId: null,
  optionContract: null,
  orderRef: null,
});

test("live execution round trips expose every represented synthetic Account Orders id in first-seen order", () => {
  const trades = internals.buildLiveExecutionActivityTrades(
    [
      execution({
        id: "entry-1",
        side: "buy",
        quantity: 1,
        price: 100,
        executedAt: "2026-07-16T14:00:00.000Z",
      }),
      execution({
        id: "entry-2",
        side: "buy",
        quantity: 1,
        price: 101,
        executedAt: "2026-07-16T14:01:00.000Z",
      }),
      execution({
        id: "exit-1",
        side: "sell",
        quantity: 2,
        price: 105,
        executedAt: "2026-07-16T15:00:00.000Z",
      }),
    ],
    "USD",
  );

  assert.deepEqual(
    trades.find((trade) => trade.id === "exit-1")?.orderIds,
    ["execution:entry-1", "execution:entry-2", "execution:exit-1"],
  );
  assert.equal(trades.find((trade) => trade.id === "exit-1")?.side, "buy");
});

test("live execution short round trips preserve opening direction and return sign", () => {
  const [trade] = internals.buildLiveExecutionActivityTrades(
    [
      execution({
        id: "short-entry",
        side: "sell",
        quantity: 1,
        price: 110,
        executedAt: "2026-07-16T14:00:00.000Z",
      }),
      execution({
        id: "short-exit",
        side: "buy",
        quantity: 1,
        price: 100,
        executedAt: "2026-07-16T15:00:00.000Z",
      }),
    ],
    "USD",
  );

  assert.equal(trade?.side, "sell");
  assert.equal(trade?.realizedPnl, 10);
  assert.ok(Math.abs((trade?.realizedPnlPercent ?? 0) - 100 / 11) < 1e-9);
});

test("unpaired live execution activity exposes its exact synthetic Account Orders id", () => {
  const [trade] = internals.buildLiveExecutionActivityTrades(
    [
      execution({
        id: "activity-1",
        side: "buy",
        quantity: 1,
        price: 100,
        executedAt: "2026-07-16T14:00:00.000Z",
      }),
    ],
    "USD",
  );

  assert.deepEqual(trade?.orderIds, ["execution:activity-1"]);
  assert.equal(trade?.side, "unknown");
});

test("partially represented executions retain a truthful residual activity row", () => {
  const trades = internals.buildLiveExecutionActivityTrades(
    [
      execution({
        id: "open-two",
        side: "buy",
        quantity: 2,
        price: 100,
        executedAt: "2026-07-16T14:00:00.000Z",
      }),
      execution({
        id: "close-one",
        side: "sell",
        quantity: 1,
        price: 110,
        executedAt: "2026-07-16T15:00:00.000Z",
      }),
    ],
    "USD",
  );

  const residual = trades.find((trade) => trade.id === "open-two:residual");
  assert.equal(trades.length, 2);
  assert.equal(residual?.quantity, 1);
  assert.equal(residual?.side, "unknown");
});

test("reversal executions retain the unmatched opening remainder", () => {
  const trades = internals.buildLiveExecutionActivityTrades(
    [
      execution({
        id: "long-one",
        side: "buy",
        quantity: 1,
        price: 100,
        executedAt: "2026-07-16T14:00:00.000Z",
      }),
      execution({
        id: "reverse-two",
        side: "sell",
        quantity: 2,
        price: 110,
        executedAt: "2026-07-16T15:00:00.000Z",
      }),
    ],
    "USD",
  );

  const residual = trades.find((trade) => trade.id === "reverse-two:residual");
  assert.equal(trades.length, 2);
  assert.equal(residual?.quantity, 1);
  assert.equal(residual?.side, "unknown");
  assert.deepEqual(residual?.orderIds, ["execution:reverse-two"]);
});

test("execution closing actions deduplicate provider trades by opening direction", () => {
  const existingTrade = {
    id: "flex-close",
    source: "FLEX",
    accountId: "U123",
    symbol: "AAPL",
    side: "buy",
    assetClass: "Stocks",
    positionType: "stock",
    quantity: 1,
    openDate: null,
    closeDate: new Date("2026-07-16T15:00:00.000Z"),
    avgOpen: null,
    avgClose: 110,
    realizedPnl: 8,
    realizedPnlPercent: null,
    holdDurationMinutes: null,
    commissions: 2,
    currency: "USD",
  } as never;
  const merged = internals.mergeLiveExecutionActivityTrades(
    [existingTrade],
    [
      execution({
        id: "execution-close",
        side: "sell",
        quantity: 1,
        price: 110,
        executedAt: "2026-07-16T15:00:00.000Z",
      }),
    ],
    {},
    "USD",
  );

  assert.deepEqual(merged.map((trade) => trade.id), ["flex-close"]);
});

test("live option execution P&L stays unknown for an invalid unverified multiplier", () => {
  const optionExecution = (
    id: string,
    side: "buy" | "sell",
    price: number,
  ): BrokerExecutionSnapshot => ({
    ...execution({
      id,
      side,
      quantity: 1,
      price,
      executedAt:
        side === "buy"
          ? "2026-07-16T14:00:00.000Z"
          : "2026-07-16T15:00:00.000Z",
    }),
    symbol: "ADJ",
    assetClass: "option",
    contractDescription: "private-adjusted-contract",
    optionContract: {
      ticker: "private-adjusted-contract",
      underlying: "ADJ",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 10,
      right: "call",
      multiplier: 0,
      sharesPerContract: 0,
      providerContractId: "adjusted-contract",
    },
    providerContractId: "adjusted-contract",
  });

  const [trade] = internals.buildLiveExecutionActivityTrades(
    [optionExecution("option-open", "buy", 2), optionExecution("option-close", "sell", 3)],
    "USD",
  );

  assert.equal(trade?.realizedPnl, null);
});

test("an OCC-shaped execution description does not prove standard deliverable economics", () => {
  const optionExecution = (
    id: string,
    side: "buy" | "sell",
    price: number,
  ): BrokerExecutionSnapshot => ({
    ...execution({
      id,
      side,
      quantity: 1,
      price,
      executedAt:
        side === "buy"
          ? "2026-07-16T14:00:00.000Z"
          : "2026-07-16T15:00:00.000Z",
    }),
    symbol: "AAPL",
    assetClass: "option",
    contractDescription: "AAPL  260821C00200000",
  });

  const [trade] = internals.buildLiveExecutionActivityTrades(
    [optionExecution("occ-open", "buy", 2), optionExecution("occ-close", "sell", 3)],
    "USD",
  );

  assert.equal(trade?.realizedPnl, null);
  assert.equal(trade?.optionContract, null);
});

test("provider-verified standard deliverables can supply absent execution economics", () => {
  const optionExecution = (
    id: string,
    side: "buy" | "sell",
    price: number,
  ): BrokerExecutionSnapshot => ({
    ...execution({
      id,
      side,
      quantity: 1,
      price,
      executedAt:
        side === "buy"
          ? "2026-07-16T14:00:00.000Z"
          : "2026-07-16T15:00:00.000Z",
    }),
    symbol: "AAPL",
    assetClass: "option",
    optionContract: {
      ticker: "AAPL260821C00200000",
      underlying: "AAPL",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 200,
      right: "call",
      multiplier: undefined as never,
      sharesPerContract: undefined as never,
      standardDeliverableVerified: true,
    },
  });

  const [trade] = internals.buildLiveExecutionActivityTrades(
    [
      optionExecution("verified-open", "buy", 2),
      optionExecution("verified-close", "sell", 3),
    ],
    "USD",
  );

  assert.equal(trade?.realizedPnl, 100);
});

test("live order activity exposes the broker order row id", () => {
  const order: BrokerOrderSnapshot = {
    id: "broker-order-1",
    accountId: "U123",
    mode: "live",
    symbol: "AAPL",
    assetClass: "equity",
    side: "sell",
    type: "limit",
    timeInForce: "day",
    status: "filled",
    quantity: 1,
    filledQuantity: 1,
    limitPrice: 105,
    stopPrice: null,
    placedAt: new Date("2026-07-16T14:00:00.000Z"),
    updatedAt: new Date("2026-07-16T15:00:00.000Z"),
    optionContract: null,
  };

  const [trade] = internals.mergeLiveOrderActivityTrades(
    [],
    [order],
    {},
    "USD",
  );

  assert.deepEqual(trade?.orderIds, ["broker-order-1"]);
  assert.equal(trade?.side, "unknown");
});

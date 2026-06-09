import assert from "node:assert/strict";
import test from "node:test";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

const {
  buildShadowAnalysisRoundTrips,
  shadowRoundTripToClosedTrade,
  shadowTradeEventToActivityTrade,
  shadowTradeMatchesClosedTradeInput,
} = internals;

const event = (input: {
  id: string;
  side: "buy" | "sell";
  price: number;
  realizedPnl?: number;
  occurredAt: string;
  positionKey: string;
  positionType?: "stock" | "etf" | "option";
}) => ({
  id: input.id,
  orderId: `order:${input.id}`,
  accountId: "shadow",
  symbol: "AAPL",
  side: input.side,
  assetClass: input.positionType === "option" ? "option" : "equity",
  positionType: input.positionType ?? "option",
  positionKey: input.positionKey,
  quantity: 1,
  price: input.price,
  grossAmount: input.price * 100,
  fees: 0,
  realizedPnl: input.realizedPnl ?? 0,
  cashDelta: 0,
  occurredAt: input.occurredAt,
  occurredAtDate: new Date(input.occurredAt),
  sourceType: "automation",
  strategyLabel: "Signal Options",
  candidateId: null,
  deploymentId: null,
  deploymentName: null,
  sourceEventId: null,
  metadata: {},
});

test("shadow closed-trade activity rows expose canonical position type and filter by it", () => {
  const trade = shadowTradeEventToActivityTrade(
    event({
      id: "option-fill",
      side: "sell",
      price: 5,
      realizedPnl: 20,
      occurredAt: "2026-06-09T15:00:00.000Z",
      positionKey: "option:AAPL:2026-06-12:290:call:1",
    }) as never,
  );

  assert.equal(trade.assetClass, "Options");
  assert.equal(trade.positionType, "option");
  assert.equal(
    shadowTradeMatchesClosedTradeInput(trade as never, {
      assetClassFilter: "option",
    }),
    true,
  );
  assert.equal(
    shadowTradeMatchesClosedTradeInput(trade as never, {
      assetClassFilter: "equity",
    }),
    false,
  );
});

test("shadow closed-trade round trips are keyed by contract identity, not just asset class and symbol", () => {
  const contractA = "option:AAPL:2026-06-12:290:call:1";
  const contractB = "option:AAPL:2026-06-19:300:call:2";
  const { roundTrips } = buildShadowAnalysisRoundTrips([
    event({
      id: "buy-a",
      side: "buy",
      price: 4,
      occurredAt: "2026-06-09T14:00:00.000Z",
      positionKey: contractA,
    }) as never,
    event({
      id: "buy-b",
      side: "buy",
      price: 8,
      occurredAt: "2026-06-09T14:01:00.000Z",
      positionKey: contractB,
    }) as never,
    event({
      id: "sell-b",
      side: "sell",
      price: 9,
      realizedPnl: 100,
      occurredAt: "2026-06-09T14:02:00.000Z",
      positionKey: contractB,
    }) as never,
    event({
      id: "sell-a",
      side: "sell",
      price: 5,
      realizedPnl: 100,
      occurredAt: "2026-06-09T14:03:00.000Z",
      positionKey: contractA,
    }) as never,
  ] as never);

  const sellB = roundTrips.find((trade) => trade.id === "sell-b");
  const sellA = roundTrips.find((trade) => trade.id === "sell-a");
  assert.equal(sellB?.avgOpen, 8);
  assert.equal(sellB?.positionKey, contractB);
  assert.equal(sellA?.avgOpen, 4);
  assert.equal(sellA?.positionKey, contractA);

  const trade = shadowRoundTripToClosedTrade(sellB as never);
  assert.equal(trade.assetClass, "Options");
  assert.equal(trade.positionType, "option");
});

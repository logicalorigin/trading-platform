import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSellCallTicketCoverage,
  resolveSellCallTicketIntent,
} from "./optionSellCallIntent.js";

const tradeOrderTicketSource = readFileSync(
  new URL("./TradeOrderTicket.jsx", import.meta.url),
  "utf8",
);

const selectedContract = {
  ticker: "SPY   260619C00500000",
  underlying: "SPY",
  expirationDate: "2026-06-19",
  strike: 500,
  right: "call",
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: "12345",
};

const position = (patch = {}) => ({
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
  optionContract: selectedContract,
  ...patch,
});

const order = (patch = {}) => ({
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
  placedAt: "2026-05-06T15:00:00.000Z",
  updatedAt: "2026-05-06T15:00:00.000Z",
  optionContract: selectedContract,
  ...patch,
});

test("TradeOrderTicket passes computed shadow quantity into sell-call intent", () => {
  assert.match(
    tradeOrderTicketSource,
    /shadowMatchingQuantity:\s*matchingShadowQuantity/,
  );
  assert.doesNotMatch(tradeOrderTicketSource, /\n\s*shadowMatchingQuantity,\n/);
  assert.match(tradeOrderTicketSource, /const date = parseExpirationValue\(value\)/);
});

test("resolves real sell calls against matching long option positions first", () => {
  const intent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 1,
    positions: [position({ quantity: 2 })],
    orders: [],
    brokerPositionContextReady: true,
    brokerOrderContextReady: true,
  });

  assert.equal(intent.allowed, true);
  assert.equal(intent.actionLabel, "SELL TO CLOSE");
  assert.equal(intent.positionEffect, "close");
  assert.equal(intent.strategyIntent, "sell_to_close");
  assert.equal(intent.coverage.matchingLongCallContracts, 2);
});

test("keeps buy-side option tickets out of sell-call intent metadata", () => {
  const intent = resolveSellCallTicketIntent({
    side: "BUY",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 1,
  });

  assert.equal(intent.applies, false);
  assert.equal(intent.actionLabel, "BUY TO OPEN");
  assert.equal(intent.positionEffect, undefined);
  assert.equal(intent.strategyIntent, undefined);
});

test("waits for open-order context before allowing real sell-to-close", () => {
  const intent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 1,
    positions: [position({ quantity: 1 })],
    orders: [],
    brokerPositionContextReady: true,
    brokerOrderContextReady: false,
  });

  assert.equal(intent.allowed, false);
  assert.equal(intent.contextPending, true);
  assert.equal(intent.intentLabel, "CHECKING OPEN ORDERS");
});

test("resolves covered calls when share coverage is available", () => {
  const intent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 2,
    positions: [
      position({
        id: "shares",
        assetClass: "equity",
        quantity: 250,
        optionContract: null,
      }),
    ],
    orders: [],
    brokerPositionContextReady: true,
    brokerOrderContextReady: true,
  });

  assert.equal(intent.allowed, true);
  assert.equal(intent.actionLabel, "SELL COVERED CALL");
  assert.equal(intent.positionEffect, "open");
  assert.equal(intent.strategyIntent, "covered_call");
  assert.equal(intent.coverage.coveredCallCapacity, 2);
});

test("pending sell-call orders reduce covered-call capacity", () => {
  const coverage = buildSellCallTicketCoverage({
    selectedContract,
    symbol: "SPY",
    positions: [
      position({
        id: "shares",
        assetClass: "equity",
        quantity: 300,
        optionContract: null,
      }),
    ],
    orders: [
      order({
        quantity: 2,
        filledQuantity: 0,
        optionContract: {
          ...selectedContract,
          providerContractId: "67890",
          strike: 510,
        },
      }),
    ],
  });

  assert.equal(coverage.pendingSellCallContracts, 2);
  assert.equal(coverage.reservedShares, 200);
  assert.equal(coverage.coveredCallCapacity, 1);

  const intent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 2,
    positions: [
      position({
        id: "shares",
        assetClass: "equity",
        quantity: 300,
        optionContract: null,
      }),
    ],
    orders: [
      order({
        quantity: 2,
        filledQuantity: 0,
        optionContract: {
          ...selectedContract,
          providerContractId: "67890",
          strike: 510,
        },
      }),
    ],
    brokerPositionContextReady: true,
    brokerOrderContextReady: true,
  });

  assert.equal(intent.allowed, false);
  assert.equal(intent.strategyIntent, "uncovered_short_call");
});

test("pending sell-to-close orders consume matching long-call availability", () => {
  const intent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 1,
    positions: [position({ quantity: 1 })],
    orders: [order({ quantity: 1, filledQuantity: 0 })],
    brokerPositionContextReady: true,
    brokerOrderContextReady: true,
  });

  assert.equal(intent.allowed, false);
  assert.equal(intent.coverage.matchingLongCallContracts, 1);
  assert.equal(intent.coverage.pendingMatchingSellCallContracts, 1);
  assert.equal(intent.coverage.availableMatchingLongCallContracts, 0);
  assert.equal(intent.coverage.pendingShortOpeningSellCallContracts, 0);
});

test("invalid option expirations do not roll into matching sell-call coverage", () => {
  const coverage = buildSellCallTicketCoverage({
    selectedContract: {
      ...selectedContract,
      expirationDate: "2026-02-31",
      providerContractId: null,
    },
    symbol: "SPY",
    positions: [
      position({
        optionContract: {
          ...selectedContract,
          expirationDate: "2026-03-03",
          providerContractId: null,
        },
      }),
    ],
    orders: [],
  });

  assert.equal(coverage.matchingLongCallContracts, 0);
  assert.equal(coverage.availableMatchingLongCallContracts, 0);
});

test("pending underlying share sales reduce covered-call capacity", () => {
  const intent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 1,
    positions: [
      position({
        id: "shares",
        assetClass: "equity",
        quantity: 100,
        optionContract: null,
      }),
    ],
    orders: [
      order({
        id: "share-sale",
        assetClass: "equity",
        symbol: "SPY",
        quantity: 100,
        optionContract: null,
      }),
    ],
    brokerPositionContextReady: true,
    brokerOrderContextReady: true,
  });

  assert.equal(intent.allowed, false);
  assert.equal(intent.coverage.pendingUnderlyingSellShares, 100);
  assert.equal(intent.coverage.reservedShares, 100);
  assert.equal(intent.coverage.coveredCallCapacity, 0);
});

test("blocks Shadow covered-call opens while allowing long call closes", () => {
  const closeIntent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 1,
    executionMode: "shadow",
    shadowPositionContextReady: true,
    shadowMatchingQuantity: 1,
  });
  assert.equal(closeIntent.allowed, true);
  assert.equal(closeIntent.strategyIntent, "sell_to_close");

  const openIntent = resolveSellCallTicketIntent({
    side: "SELL",
    assetMode: "option",
    selectedContract,
    symbol: "SPY",
    quantity: 1,
    executionMode: "shadow",
    shadowPositionContextReady: true,
    shadowMatchingQuantity: 0,
  });
  assert.equal(openIntent.allowed, false);
  assert.equal(openIntent.strategyIntent, "uncovered_short_call");
});

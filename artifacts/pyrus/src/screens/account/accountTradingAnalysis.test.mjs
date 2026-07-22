import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAccountTradeLifecycleRows,
  buildAccountTradingAnalysisModel,
  resolveAccountTradeContractDetails,
} from "./accountTradingAnalysis.js";

const trade = (overrides = {}) => ({
  id: "trade-1",
  source: "live",
  sourceType: "manual",
  accountId: "account-1",
  symbol: "AAPL",
  side: "buy",
  assetClass: "equity",
  quantity: 1,
  openDate: "2026-07-16T14:00:00.000Z",
  closeDate: "2026-07-16T15:00:00.000Z",
  avgOpen: 100,
  avgClose: 105,
  realizedPnl: 5,
  commissions: 0,
  ...overrides,
});

const order = (id, overrides = {}) => ({
  id,
  symbol: "AAPL",
  type: "limit",
  status: "filled",
  placedAt: "2026-07-16T14:00:00.000Z",
  filledAt: "2026-07-16T14:01:00.000Z",
  averageFillPrice: 100,
  ...overrides,
});

test("trade lifecycle follows exact API order ids in their stable order", () => {
  const rows = buildAccountTradeLifecycleRows({
    trade: trade({
      orderIds: ["exit-order", "entry-order", "exit-order"],
    }),
    orders: [
      order("entry-order", { averageFillPrice: 100 }),
      order("same-symbol-decoy", { averageFillPrice: 999 }),
      order("exit-order", { averageFillPrice: 105 }),
    ],
  });

  const orderRows = rows.filter((row) => row.key.startsWith("order:"));
  assert.deepEqual(
    orderRows.map((row) => [row.orderId, row.value]),
    [
      ["exit-order", 105],
      ["entry-order", 100],
    ],
  );
});

test("an explicit empty order id list does not fall back to symbol guesses", () => {
  const rows = buildAccountTradeLifecycleRows({
    trade: trade({ orderIds: [] }),
    orders: [order("same-symbol-decoy")],
  });

  assert.equal(rows.some((row) => row.label === "Order"), false);
});

test("a trade without stable order ids does not invent same-symbol lifecycle links", () => {
  const rows = buildAccountTradeLifecycleRows({
    trade: trade(),
    orders: [order("same-symbol-decoy")],
  });

  assert.equal(rows.some((row) => row.label === "Order"), false);
});

test("linked order lifecycle detail exposes the fill and stable order id", () => {
  const rows = buildAccountTradeLifecycleRows({
    trade: trade({ orderIds: ["entry-order"] }),
    orders: [
      order("entry-order", {
        side: "buy",
        filledQuantity: 2,
        commission: 1.25,
      }),
    ],
  });

  const linkedOrder = rows.find((row) => row.key === "order:entry-order");
  assert.match(linkedOrder.detail, /BUY 2/);
  assert.match(linkedOrder.detail, /entry-order/);
  assert.equal(linkedOrder.value, 100);
});

test("trade contract detail normalizes optionContract before legacy selectedContract", () => {
  assert.deepEqual(
    resolveAccountTradeContractDetails(
      trade({
        assetClass: "option",
        optionContract: {
          right: "call",
          strike: 205,
          expirationDate: "2026-08-21",
          multiplier: 100,
          providerContractId: "option-205c",
        },
        selectedContract: {
          right: "put",
          strike: 190,
          expirationDate: "2026-08-14",
        },
      }),
    ),
    {
      expirationDate: "2026-08-21",
      multiplier: 100,
      providerContractId: "option-205c",
      right: "call",
      strike: 205,
    },
  );
});

test("contract details reject blank economics and use a positive adjusted multiplier", () => {
  assert.deepEqual(
    resolveAccountTradeContractDetails(
      trade({
        strike: " ",
        optionContract: {
          right: "put",
          strike: null,
          multiplier: 0,
          sharesPerContract: 50,
        },
      }),
    ),
    {
      expirationDate: null,
      multiplier: 50,
      providerContractId: null,
      right: "put",
      strike: null,
    },
  );
});

test("missing DTE, hold duration, and outcomes remain unknown", () => {
  const unknownTrade = trade({
    id: "unknown",
    assetClass: "option",
    optionContract: { right: "call" },
    dte: " ",
    holdDurationMinutes: null,
    realizedPnl: null,
  });
  const lifecycle = buildAccountTradeLifecycleRows({ trade: unknownTrade });
  const analysis = buildAccountTradingAnalysisModel({
    trades: [
      ...Array.from({ length: 9 }, (_, index) =>
        trade({ id: `known-${index}`, realizedPnl: index - 4 }),
      ),
      unknownTrade,
    ],
  });

  assert.equal(lifecycle.find((row) => row.key === "contract")?.value, null);
  assert.equal(
    lifecycle.find((row) => row.key === "hold")?.detail,
    "Hold duration unavailable",
  );
  assert.equal(
    analysis.bucketGroups.dte.find((group) => group.key === "unknown")?.count,
    10,
  );
  assert.equal(
    analysis.bucketGroups.dte.find((group) => group.key === "unknown")
      ?.realizedPnl,
    null,
  );
});

test("an unknown outcome keeps lifecycle result tone neutral", () => {
  const unknownOutcome = trade({ realizedPnl: null, commissions: 2 });
  const lifecycle = buildAccountTradeLifecycleRows({ trade: unknownOutcome });

  assert.equal(
    lifecycle.find((row) => row.key === "result")?.tone,
    "neutral",
  );
});

test("fee exemplars require known fees", () => {
  const analysis = buildAccountTradingAnalysisModel({
    trades: [
      trade({ id: "complete", commissions: 1 }),
      trade({ id: "missing-quantity", quantity: null, commissions: 2 }),
      trade({ id: "missing-exit", avgClose: null, commissions: 3 }),
      trade({ id: "missing-fee", commissions: null }),
    ],
  });

  assert.equal(
    analysis.representativeTrades.find((card) => card.key === "highest-fee")
      ?.tradeId,
    "live:missing-exit",
  );
  assert.equal(
    analysis.representativeTrades.find((card) => card.key === "highest-fee")
      ?.value,
    3,
  );

  const noKnownFees = buildAccountTradingAnalysisModel({
    trades: [trade({ commissions: null })],
  });
  assert.equal(
    noKnownFees.representativeTrades.some((card) => card.key === "highest-fee"),
    false,
  );
});

test("waterfall withholds a population whose realized exit chronology is incomplete", () => {
  const analysis = buildAccountTradingAnalysisModel({
    trades: [
      trade({ id: "dated" }),
      trade({
        id: "entry-only",
        closeDate: null,
        openDate: "2026-07-17T14:00:00.000Z",
      }),
    ],
  });

  assert.deepEqual(analysis.waterfall, []);
});

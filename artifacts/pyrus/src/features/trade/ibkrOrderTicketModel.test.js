import assert from "node:assert/strict";
import test from "node:test";
import {
  TICKET_ASSET_MODES,
  TRADING_EXECUTION_MODES,
  buildTwsBracketOrders,
  getDefaultTicketRiskPrices,
  normalizeTicketAssetMode,
  normalizeTicketOrderType,
  normalizeTradingExecutionMode,
  resolveTicketOrderPrices,
  validateTicketBracket,
} from "./ibkrOrderTicketModel.js";

test("normalizes ticket asset modes with options as the default", () => {
  assert.deepEqual(TICKET_ASSET_MODES, ["option", "equity"]);
  assert.equal(normalizeTicketAssetMode("option"), "option");
  assert.equal(normalizeTicketAssetMode("shares"), "equity");
  assert.equal(normalizeTicketAssetMode("stock"), "equity");
  assert.equal(normalizeTicketAssetMode("unknown"), "option");
  assert.equal(normalizeTicketAssetMode(null), "option");
});

test("normalizes trading execution modes with shadow as the safe default", () => {
  assert.deepEqual(TRADING_EXECUTION_MODES, ["real", "shadow"]);
  assert.equal(normalizeTradingExecutionMode("real"), "real");
  assert.equal(normalizeTradingExecutionMode("live"), "real");
  assert.equal(normalizeTradingExecutionMode("ibkr"), "real");
  assert.equal(normalizeTradingExecutionMode("shadow"), "shadow");
  assert.equal(normalizeTradingExecutionMode("unknown"), "shadow");
  assert.equal(normalizeTradingExecutionMode(null), "shadow");
});

test("normalizes IBKR ticket order types including stop-limit", () => {
  assert.equal(normalizeTicketOrderType("LMT"), "limit");
  assert.equal(normalizeTicketOrderType("MKT"), "market");
  assert.equal(normalizeTicketOrderType("STP"), "stop");
  assert.equal(normalizeTicketOrderType("STP_LMT"), "stop_limit");
});

test("resolves parent ticket prices for stop-limit orders", () => {
  assert.deepEqual(
    resolveTicketOrderPrices({
      orderType: "STP_LMT",
      limitPrice: "1.21",
      stopPrice: "1.25",
      fallbackPrice: 1.2,
    }),
    {
      fillPrice: 1.21,
      limitPrice: 1.21,
      stopPrice: 1.25,
    },
  );
});

test("defaults bracket risk prices by long versus short premium direction", () => {
  assert.deepEqual(getDefaultTicketRiskPrices(2, "BUY"), {
    stopLoss: 1.3,
    takeProfit: 3.5,
  });
  assert.deepEqual(getDefaultTicketRiskPrices(2, "SELL"), {
    stopLoss: 2.7,
    takeProfit: 0.7,
  });
  assert.deepEqual(getDefaultTicketRiskPrices(100, "BUY", "equity"), {
    stopLoss: 98,
    takeProfit: 102,
  });
  assert.deepEqual(getDefaultTicketRiskPrices(100, "SELL", "equity"), {
    stopLoss: 102,
    takeProfit: 98,
  });
});

test("validates bracket prices relative to entry direction", () => {
  assert.equal(
    validateTicketBracket({
      side: "BUY",
      entryPrice: 2,
      stopLoss: 1.25,
      takeProfit: 3.5,
    }),
    null,
  );
  assert.equal(
    validateTicketBracket({
      side: "SELL",
      entryPrice: 2,
      stopLoss: 2.75,
      takeProfit: 0.75,
    }),
    null,
  );
  assert.match(
    validateTicketBracket({
      side: "BUY",
      entryPrice: 2,
      stopLoss: 2.25,
      takeProfit: 3.5,
    }),
    /long premium/,
  );
  assert.equal(
    validateTicketBracket({
      side: "BUY",
      entryPrice: 2,
      stopLoss: "",
      takeProfit: 3.5,
      includeStopLoss: false,
      includeTakeProfit: true,
    }),
    null,
  );
  assert.equal(
    validateTicketBracket({
      side: "BUY",
      entryPrice: 2,
      stopLoss: 1.25,
      takeProfit: "",
      includeStopLoss: true,
      includeTakeProfit: false,
    }),
    null,
  );
  assert.match(
    validateTicketBracket({
      side: "BUY",
      entryPrice: 100,
      stopLoss: 101,
      takeProfit: 103,
      assetMode: "equity",
    }),
    /long shares/,
  );
});

test("builds TWS bracket orders with parent index links", () => {
  const orders = buildTwsBracketOrders({
    previewPayload: {
      contract: {
        conId: 123,
        symbol: "SPY",
        secType: "OPT",
        exchange: "SMART",
      },
      order: {
        account: "U1",
        action: "BUY",
        totalQuantity: 2,
        orderType: "LMT",
        lmtPrice: 1.2,
        tif: "DAY",
        transmit: true,
      },
    },
    side: "BUY",
    quantity: 2,
    stopLossPrice: 0.75,
    takeProfitPrice: 2.4,
  });

  assert.equal(orders.length, 3);
  assert.equal(orders[0].order.transmit, false);
  assert.equal(orders[1].order.action, "SELL");
  assert.equal(orders[1].order.orderType, "STP");
  assert.equal(orders[1].order.parentOrderIndex, 0);
  assert.equal(orders[1].order.transmit, false);
  assert.equal(orders[2].order.orderType, "LMT");
  assert.equal(orders[2].order.parentOrderIndex, 0);
  assert.equal(orders[2].order.transmit, true);
});

test("builds TWS attached exit orders independently", () => {
  const previewPayload = {
    contract: {
      conId: 123,
      symbol: "FCEL",
      secType: "STK",
      exchange: "SMART",
    },
    order: {
      account: "U1",
      action: "BUY",
      totalQuantity: 1,
      orderType: "LMT",
      lmtPrice: 1.2,
      tif: "DAY",
      transmit: true,
    },
  };

  const stopOnly = buildTwsBracketOrders({
    previewPayload,
    side: "BUY",
    quantity: 1,
    stopLossPrice: 1,
    takeProfitPrice: "",
    includeStopLoss: true,
    includeTakeProfit: false,
  });

  assert.equal(stopOnly.length, 2);
  assert.equal(stopOnly[0].order.transmit, false);
  assert.equal(stopOnly[1].order.orderType, "STP");
  assert.equal(stopOnly[1].order.transmit, true);

  const targetOnly = buildTwsBracketOrders({
    previewPayload,
    side: "BUY",
    quantity: 1,
    stopLossPrice: "",
    takeProfitPrice: 1.5,
    includeStopLoss: false,
    includeTakeProfit: true,
  });

  assert.equal(targetOnly.length, 2);
  assert.equal(targetOnly[0].order.transmit, false);
  assert.equal(targetOnly[1].order.orderType, "LMT");
  assert.equal(targetOnly[1].order.transmit, true);
});

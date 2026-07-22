import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSnapTradeEquityOrderDraft,
  mapTicketOrderTypeToSnapTrade,
  mapTicketTimeInForceToSnapTrade,
} from "./snapTradeOrderTicketModel.js";

const READY_ACCOUNT = {
  id: "acct-ready",
  displayName: "Main IBKR",
  executionReady: true,
  executionBlockers: [],
};

test("maps existing ticket order controls to SnapTrade equity enums", () => {
  assert.equal(mapTicketOrderTypeToSnapTrade("MKT"), "Market");
  assert.equal(mapTicketOrderTypeToSnapTrade("LMT"), "Limit");
  assert.equal(mapTicketOrderTypeToSnapTrade("STP"), "Stop");
  assert.equal(mapTicketOrderTypeToSnapTrade("STP_LMT"), "StopLimit");
  assert.equal(mapTicketTimeInForceToSnapTrade("DAY"), "Day");
  assert.equal(mapTicketTimeInForceToSnapTrade("GTC"), "GTC");
});

test("SnapTrade equity drafts fail closed for unknown execution enums", () => {
  assert.equal(mapTicketOrderTypeToSnapTrade("TRAIL"), null);
  assert.equal(mapTicketTimeInForceToSnapTrade("GTD"), null);

  const base = {
    account: READY_ACCOUNT,
    symbol: "MSFT",
    side: "BUY",
    orderType: "LMT",
    tif: "DAY",
    quantity: 1,
    orderPrices: { limitPrice: 402.1 },
  };
  assert.equal(
    buildSnapTradeEquityOrderDraft({ ...base, side: "HOLD" }).reason,
    "side",
  );
  assert.equal(
    buildSnapTradeEquityOrderDraft({ ...base, orderType: "TRAIL" }).reason,
    "order_type",
  );
  assert.equal(
    buildSnapTradeEquityOrderDraft({ ...base, tif: "GTD" }).reason,
    "time_in_force",
  );
  assert.equal(
    buildSnapTradeEquityOrderDraft({
      ...base,
      account: { ...READY_ACCOUNT, executionReady: "true" },
    }).reason,
    "snaptrade_account",
  );
});

test("buildSnapTradeEquityOrderDraft creates a confirmed direct equity order body", () => {
  const draft = buildSnapTradeEquityOrderDraft({
    account: READY_ACCOUNT,
    symbol: "msft",
    side: "BUY",
    orderType: "LMT",
    tif: "DAY",
    quantity: 3,
    orderPrices: {
      limitPrice: 402.1,
      stopPrice: null,
    },
  });

  assert.equal(draft.ready, true);
  assert.deepEqual(draft.body, {
    confirm: true,
    action: "BUY",
    symbol: "MSFT",
    orderType: "Limit",
    timeInForce: "Day",
    tradingSession: "REGULAR",
    units: 3,
    notionalValue: null,
    price: 402.1,
    stop: null,
    clientOrderId: null,
  });
});

test("buildSnapTradeEquityOrderDraft keeps market orders price-less", () => {
  const draft = buildSnapTradeEquityOrderDraft({
    account: READY_ACCOUNT,
    symbol: "plug",
    side: "BUY",
    orderType: "MKT",
    tif: "DAY",
    quantity: 1,
    orderPrices: { limitPrice: 2.22, stopPrice: 2.1 },
  });

  assert.equal(draft.ready, true);
  assert.equal(draft.body.orderType, "Market");
  assert.equal(draft.body.price, null);
  assert.equal(draft.body.stop, null);
});

test("buildSnapTradeEquityOrderDraft requires an execution-ready account", () => {
  const draft = buildSnapTradeEquityOrderDraft({
    account: {
      id: "acct-blocked",
      executionReady: false,
      executionBlockers: ["snaptrade.connection.read_only"],
    },
    symbol: "AAPL",
    side: "BUY",
    orderType: "MKT",
    tif: "DAY",
    quantity: 1,
    orderPrices: {},
  });

  assert.equal(draft.ready, false);
  assert.equal(draft.reason, "snaptrade_account");
  assert.equal(draft.body, null);
});

test("buildSnapTradeEquityOrderDraft requires stop and limit prices for stop-limit", () => {
  const missingStop = buildSnapTradeEquityOrderDraft({
    account: READY_ACCOUNT,
    symbol: "AAPL",
    side: "SELL",
    orderType: "STP_LMT",
    tif: "GTC",
    quantity: 1,
    orderPrices: {
      limitPrice: 190,
      stopPrice: null,
    },
  });
  const ready = buildSnapTradeEquityOrderDraft({
    account: READY_ACCOUNT,
    symbol: "AAPL",
    side: "SELL",
    orderType: "STP_LMT",
    tif: "GTC",
    quantity: 1,
    orderPrices: {
      limitPrice: 190,
      stopPrice: 191,
    },
  });

  assert.equal(missingStop.ready, false);
  assert.equal(missingStop.reason, "stop");
  assert.equal(ready.ready, true);
  assert.equal(ready.body.orderType, "StopLimit");
  assert.equal(ready.body.price, 190);
  assert.equal(ready.body.stop, 191);
});

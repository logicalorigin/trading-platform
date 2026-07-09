import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRobinhoodEquityOrderDraft,
  placeRobinhoodEquityOrderRequest,
  reviewRobinhoodEquityOrderRequest,
} from "./robinhoodEquityOrderRequests.js";

const READY_ACCOUNT = {
  id: "account/id",
  agentic: true,
  executionReady: true,
};

test("maps every supported ticket order type to Robinhood equity enums", () => {
  const cases = [
    ["MKT", "Market", null, null],
    ["LMT", "Limit", 402.1, null],
    ["STP", "StopMarket", null, 401.5],
    ["STP_LMT", "StopLimit", 402.1, 401.5],
  ];

  for (const [orderType, expectedType, expectedLimit, expectedStop] of cases) {
    const draft = buildRobinhoodEquityOrderDraft({
      account: READY_ACCOUNT,
      symbol: "MSFT",
      side: "BUY",
      orderType,
      tif: "DAY",
      quantity: 1,
      orderPrices: { limitPrice: 402.1, stopPrice: 401.5 },
    });
    assert.equal(draft.ready, true);
    assert.equal(draft.body.orderType, expectedType);
    assert.equal(draft.body.limitPrice, expectedLimit);
    assert.equal(draft.body.stopPrice, expectedStop);
  }
});

test("maps the ticket and sends Robinhood review/place requests with CSRF", async () => {
  const draft = buildRobinhoodEquityOrderDraft({
    account: READY_ACCOUNT,
    symbol: "msft",
    side: "SELL",
    orderType: "STP_LMT",
    tif: "GTC",
    quantity: 3,
    orderPrices: { limitPrice: 402.1, stopPrice: 401.5 },
  });
  assert.equal(draft.ready, true);
  assert.deepEqual(draft.body, {
    symbol: "MSFT",
    side: "SELL",
    orderType: "StopLimit",
    timeInForce: "GTC",
    marketHours: "regular_hours",
    quantity: 3,
    notionalValue: null,
    limitPrice: 402.1,
    stopPrice: 401.5,
  });

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ provider: "robinhood" }),
    };
  };

  await reviewRobinhoodEquityOrderRequest({
    accountId: READY_ACCOUNT.id,
    csrfToken: "csrf-token",
    body: draft.body,
    fetchImpl,
  });
  await placeRobinhoodEquityOrderRequest({
    accountId: READY_ACCOUNT.id,
    csrfToken: "csrf-token",
    body: {
      ...draft.body,
      taxPreflightToken: "tax-token",
      taxAcknowledgements: ["wash-sale"],
    },
    fetchImpl,
  });

  assert.equal(
    calls[0].url,
    "/api/broker-execution/robinhood/accounts/account%2Fid/orders/impact",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-csrf-token": "csrf-token",
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), draft.body);
  assert.equal(
    calls[1].url,
    "/api/broker-execution/robinhood/accounts/account%2Fid/orders",
  );
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(calls[1].init.headers, calls[0].init.headers);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    ...draft.body,
    taxPreflightToken: "tax-token",
    taxAcknowledgements: ["wash-sale"],
    confirm: true,
  });
});

test("requires an execution-ready Agentic account", () => {
  const draft = buildRobinhoodEquityOrderDraft({
    account: { ...READY_ACCOUNT, agentic: false },
    symbol: "AAPL",
    side: "BUY",
    orderType: "MKT",
    tif: "DAY",
    quantity: 1,
  });

  assert.deepEqual(draft, {
    ready: false,
    reason: "robinhood_account",
    body: null,
  });
});

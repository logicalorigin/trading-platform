import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrokerOptionOrderDraft,
  placeBrokerOptionOrderRequest,
  reviewBrokerOptionOrderRequest,
} from "./brokerOptionOrderRequests.js";

const READY_ACCOUNT = { id: "account/id", executionReady: true, agentic: true };

const baseInput = {
  account: READY_ACCOUNT,
  contractSymbol: "O:MSFT260918C00450000",
  multiplier: 100,
  sharesPerContract: 100,
  underlyingSymbol: "msft",
  expiration: new Date("2026-09-18T00:00:00.000Z"),
  strike: 450,
  right: "C",
  side: "BUY",
  positionEffect: "open",
  orderType: "LMT",
  tif: "DAY",
  quantity: 2,
  orderPrices: { limitPrice: 4.25 },
};

test("maps buy-to-open ticket fields for every direct option broker", () => {
  const robinhood = buildBrokerOptionOrderDraft({
    ...baseInput,
    broker: "robinhood",
  });
  assert.deepEqual(robinhood.body, {
    contractSymbol: "O:MSFT260918C00450000",
    multiplier: 100,
    sharesPerContract: 100,
    chainSymbol: "MSFT",
    expiration: "2026-09-18",
    strike: 450,
    optionType: "Call",
    orderType: "Limit",
    quantity: 2,
    side: "Buy",
    positionEffect: "Open",
    timeInForce: "Day",
    marketHours: "regular_hours",
    limitPrice: 4.25,
    stopPrice: null,
  });

  const snaptrade = buildBrokerOptionOrderDraft({
    ...baseInput,
    broker: "snaptrade",
  });
  assert.deepEqual(snaptrade.body, {
    contractSymbol: "O:MSFT260918C00450000",
    multiplier: 100,
    sharesPerContract: 100,
    underlyingSymbol: "MSFT",
    expiration: "2026-09-18",
    strike: 450,
    optionType: "Call",
    orderType: "Limit",
    action: "BUY_TO_OPEN",
    timeInForce: "Day",
    units: 2,
    price: 4.25,
  });

  const schwab = buildBrokerOptionOrderDraft({
    ...baseInput,
    broker: "schwab",
  });
  assert.deepEqual(schwab.body, {
    contractSymbol: "O:MSFT260918C00450000",
    multiplier: 100,
    sharesPerContract: 100,
    underlyingSymbol: "MSFT",
    expiration: "2026-09-18",
    strike: 450,
    optionType: "Call",
    orderType: "Limit",
    quantity: 2,
    instruction: "BuyToOpen",
    duration: "Day",
    session: "Normal",
    limitPrice: 4.25,
  });
});

test("maps an explicit sell-to-close intent for every direct option broker", () => {
  const expected = {
    robinhood: ["side", "Sell", "positionEffect", "Close"],
    snaptrade: ["action", "SELL_TO_CLOSE"],
    schwab: ["instruction", "SellToClose"],
  };
  for (const broker of Object.keys(expected)) {
    const draft = buildBrokerOptionOrderDraft({
      ...baseInput,
      broker,
      side: "SELL",
      positionEffect: "close",
    });
    assert.equal(draft.ready, true);
    const [firstKey, firstValue, secondKey, secondValue] = expected[broker];
    assert.equal(draft.body[firstKey], firstValue);
    if (secondKey) assert.equal(draft.body[secondKey], secondValue);
  }
});

test("rejects unready accounts and unsupported provider controls", () => {
  assert.equal(
    buildBrokerOptionOrderDraft({
      ...baseInput,
      broker: "robinhood",
      account: { ...READY_ACCOUNT, agentic: false },
    }).reason,
    "robinhood_account",
  );
  assert.equal(
    buildBrokerOptionOrderDraft({
      ...baseInput,
      broker: "snaptrade",
      orderType: "STP",
    }).reason,
    "order_type",
  );
  assert.equal(
    buildBrokerOptionOrderDraft({
      ...baseInput,
      broker: "schwab",
      tif: "IOC",
    }).reason,
    "time_in_force",
  );
});

test("rejects missing, mini, and adjusted contract identity before request construction", () => {
  assert.equal(
    buildBrokerOptionOrderDraft({
      ...baseInput,
      broker: "snaptrade",
      contractSymbol: null,
    }).reason,
    "contract_identity",
  );
  assert.equal(
    buildBrokerOptionOrderDraft({
      ...baseInput,
      broker: "snaptrade",
      multiplier: 10,
      sharesPerContract: 10,
    }).reason,
    "contract_economics",
  );
  assert.equal(
    buildBrokerOptionOrderDraft({
      ...baseInput,
      broker: "snaptrade",
      sharesPerContract: 5,
    }).reason,
    "contract_economics",
  );
});

test("uses each option review route and confirms place requests", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    };
  };

  for (const broker of ["robinhood", "snaptrade", "schwab"]) {
    await reviewBrokerOptionOrderRequest({
      broker,
      accountId: READY_ACCOUNT.id,
      csrfToken: "csrf-token",
      body: { broker },
      fetchImpl,
    });
    await placeBrokerOptionOrderRequest({
      broker,
      accountId: READY_ACCOUNT.id,
      csrfToken: "csrf-token",
      body: { broker, taxPreflightToken: "tax-token" },
      fetchImpl,
    });
  }

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "/api/broker-execution/robinhood/accounts/account%2Fid/options/impact",
      "/api/broker-execution/robinhood/accounts/account%2Fid/options",
      "/api/broker-execution/snaptrade/accounts/account%2Fid/options/impact",
      "/api/broker-execution/snaptrade/accounts/account%2Fid/options",
      "/api/broker-execution/schwab/accounts/account%2Fid/options/preview",
      "/api/broker-execution/schwab/accounts/account%2Fid/options",
    ],
  );
  for (const call of calls) {
    assert.equal(call.init.headers["x-csrf-token"], "csrf-token");
  }
  for (const call of calls.filter((_, index) => index % 2 === 1)) {
    assert.equal(JSON.parse(call.init.body).confirm, true);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrokerOptionOrderDraft,
  placeBrokerOptionOrderRequest,
  readBrokerSubmitReconciliation,
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

test("preserves buy-to-close and sell-to-open adapter semantics for future account-aware routing", () => {
  const cases = [
    {
      side: "BUY",
      positionEffect: "close",
      expected: {
        robinhood: ["side", "Buy", "positionEffect", "Close"],
        snaptrade: ["action", "BUY_TO_CLOSE"],
        schwab: ["instruction", "BuyToClose"],
      },
    },
    {
      side: "SELL",
      positionEffect: "open",
      expected: {
        robinhood: ["side", "Sell", "positionEffect", "Open"],
        snaptrade: ["action", "SELL_TO_OPEN"],
        schwab: ["instruction", "SellToOpen"],
      },
    },
  ];

  for (const testCase of cases) {
    for (const broker of Object.keys(testCase.expected)) {
      const draft = buildBrokerOptionOrderDraft({
        ...baseInput,
        broker,
        side: testCase.side,
        positionEffect: testCase.positionEffect,
      });
      assert.equal(draft.ready, true);
      const [firstKey, firstValue, secondKey, secondValue] =
        testCase.expected[broker];
      assert.equal(draft.body[firstKey], firstValue);
      if (secondKey) assert.equal(draft.body[secondKey], secondValue);
    }
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

test("preserves reconcile metadata from an unknown submit outcome", async () => {
  const data = {
    outcome: "unknown",
    reconcileRequired: true,
    retryable: false,
    refId: "44444444-4444-4444-8444-444444444444",
  };
  await assert.rejects(
    placeBrokerOptionOrderRequest({
      broker: "robinhood",
      accountId: READY_ACCOUNT.id,
      csrfToken: "csrf-token",
      body: { order: "option" },
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          title: "Outcome unknown; reconcile before retrying",
          code: "robinhood_option_order_submit_reconcile_required",
          data,
        }),
      }),
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(
        error.code,
        "robinhood_option_order_submit_reconcile_required",
      );
      assert.deepEqual(error.data, data);
      return true;
    },
  );
});

test("classifies only explicit unknown or submitted-but-unrecorded outcomes as locks", () => {
  const reconciliation = {
    outcome: "unknown",
    reconcileRequired: true,
    retryable: false,
  };
  assert.deepEqual(
    readBrokerSubmitReconciliation({ data: reconciliation }),
    reconciliation,
  );
  assert.deepEqual(
    readBrokerSubmitReconciliation({
      data: {
        title: "Outcome unknown",
        data: reconciliation,
      },
    }),
    reconciliation,
  );
  const submittedButUnrecorded = {
    reconcileRequired: true,
    reconciliationReason: "tax_preflight_order_submit_record_failed",
    order: { brokerageOrderId: "broker-order-123" },
  };
  assert.deepEqual(
    readBrokerSubmitReconciliation(submittedButUnrecorded),
    submittedButUnrecorded,
  );
  assert.equal(
    readBrokerSubmitReconciliation({
      data: { reconcileRequired: true, retryable: true },
    }),
    null,
  );
  assert.equal(readBrokerSubmitReconciliation(new Error("failed")), null);
});

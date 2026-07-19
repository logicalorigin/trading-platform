import assert from "node:assert/strict";
import test from "node:test";

import { cancelSnapTradeOrderRequest } from "./snapTradeOrderCancelRequest.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("cancels a SnapTrade equity order through the equity cancel route with CSRF", async () => {
  let request = null;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "CANCELED" }),
    };
  };

  const result = await cancelSnapTradeOrderRequest({
    accountId: "snaptrade:account/1",
    orderId: "broker-order-1",
    assetClass: "equity",
    csrfToken: "session-csrf",
  });

  assert.equal(
    request.url,
    "/api/broker-execution/snaptrade/accounts/snaptrade%3Aaccount%2F1/orders/cancel",
  );
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["X-CSRF-Token"], "session-csrf");
  assert.equal(request.init.body, JSON.stringify({ orderId: "broker-order-1" }));
  assert.deepEqual(result, { status: "CANCELED" });
});

test("routes SnapTrade option cancellation through the option cancel endpoint", async () => {
  let requestedUrl = null;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "CANCELED" }),
    };
  };

  await cancelSnapTradeOrderRequest({
    accountId: "snaptrade:account-1",
    orderId: "option-order-1",
    assetClass: "option",
    csrfToken: "session-csrf",
  });

  assert.equal(
    requestedUrl,
    "/api/broker-execution/snaptrade/accounts/snaptrade%3Aaccount-1/options/cancel",
  );
});

test("fails closed before fetch when cancellation identity is missing", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("unexpected fetch");
  };

  for (const request of [
    {
      accountId: "  ",
      orderId: "broker-order-1",
      assetClass: "equity",
      csrfToken: "session-csrf",
    },
    {
      accountId: "snaptrade:account-1",
      orderId: "  ",
      assetClass: "equity",
      csrfToken: "session-csrf",
    },
  ]) {
    await assert.rejects(
      () => cancelSnapTradeOrderRequest(request),
      /account and broker order id/,
    );
  }
  assert.equal(fetchCalled, false);
});

test("fails closed before fetch for unsupported SnapTrade asset classes", async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("unexpected fetch");
  };

  await assert.rejects(
    () =>
      cancelSnapTradeOrderRequest({
        accountId: "snaptrade:account-1",
        orderId: "broker-order-1",
        assetClass: "crypto",
        csrfToken: "session-csrf",
      }),
    /equity or option/,
  );
  assert.equal(fetchCalled, false);
});

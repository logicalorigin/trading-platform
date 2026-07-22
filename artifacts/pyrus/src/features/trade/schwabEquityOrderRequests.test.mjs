import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSchwabEquityOrderDraft,
  previewSchwabEquityOrderRequest,
  submitSchwabEquityOrderRequest,
} from "./schwabEquityOrderRequests.js";

const READY_ACCOUNT = { id: "schwab/account", executionReady: true };

test("maps ticket controls to the Schwab equity body", () => {
  const draft = buildSchwabEquityOrderDraft({
    account: READY_ACCOUNT,
    symbol: "msft",
    side: "SELL",
    orderType: "STP_LMT",
    tif: "GTC",
    quantity: 3,
    orderPrices: { limitPrice: 402.1, stopPrice: 401.5 },
  });

  assert.deepEqual(draft, {
    ready: true,
    reason: null,
    body: {
      symbol: "MSFT",
      action: "SELL",
      quantity: 3,
      orderType: "StopLimit",
      timeInForce: "GoodTillCancel",
      session: "Normal",
      limitPrice: 402.1,
      stopPrice: 401.5,
    },
  });
});

test("requires an execution-ready account and whole shares", () => {
  assert.equal(
    buildSchwabEquityOrderDraft({
      account: { executionReady: false },
    }).reason,
    "schwab_account",
  );
  assert.equal(
    buildSchwabEquityOrderDraft({
      account: READY_ACCOUNT,
      symbol: "MSFT",
      side: "BUY",
      orderType: "MKT",
      tif: "DAY",
      quantity: 0.5,
    }).reason,
    "quantity",
  );
});

test("Schwab equity drafts fail closed for an unknown side", () => {
  const draft = buildSchwabEquityOrderDraft({
    account: READY_ACCOUNT,
    symbol: "MSFT",
    side: "HOLD",
    orderType: "MKT",
    tif: "DAY",
    quantity: 1,
  });

  assert.deepEqual(draft, { ready: false, reason: "side", body: null });
});

test("sends Schwab equity preview and submit requests with CSRF", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ provider: "schwab" }),
    };
  };
  const body = { symbol: "MSFT", action: "BUY" };

  await previewSchwabEquityOrderRequest({
    accountId: READY_ACCOUNT.id,
    csrfToken: "csrf-token",
    body,
    fetchImpl,
  });
  await submitSchwabEquityOrderRequest({
    accountId: READY_ACCOUNT.id,
    csrfToken: "csrf-token",
    body: { ...body, taxPreflightToken: "tax-token" },
    fetchImpl,
  });

  assert.equal(
    calls[0].url,
    "/api/broker-execution/schwab/accounts/schwab%2Faccount/orders/preview",
  );
  assert.equal(
    calls[1].url,
    "/api/broker-execution/schwab/accounts/schwab%2Faccount/orders",
  );
  assert.equal(calls[0].init.headers["x-csrf-token"], "csrf-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    ...body,
    taxPreflightToken: "tax-token",
    confirm: true,
  });
});

test("preserves reconciliation metadata from an unknown submit outcome", async () => {
  const data = {
    outcome: "unknown",
    reconcileRequired: true,
    retryable: false,
    reason: "request_timeout",
  };

  await assert.rejects(
    submitSchwabEquityOrderRequest({
      accountId: READY_ACCOUNT.id,
      csrfToken: "csrf-token",
      body: { symbol: "MSFT" },
      fetchImpl: async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          title: "Outcome unknown; reconcile before retrying",
          code: "schwab_order_submit_reconcile_required",
          data,
        }),
      }),
    }),
    (error) => {
      assert.equal(
        error.message,
        "Outcome unknown; reconcile before retrying",
      );
      assert.equal(error.code, "schwab_order_submit_reconcile_required");
      assert.deepEqual(error.data, data);
      return true;
    },
  );
});

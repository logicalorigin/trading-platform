import assert from "node:assert/strict";
import test from "node:test";

import type { IbkrRuntimeConfig } from "../../lib/runtime";
import { IbkrClient } from "./client";

const config = (): IbkrRuntimeConfig => ({
  baseUrl: "http://127.0.0.1:15000/v1/api",
  bearerToken: null,
  cookie: null,
  defaultAccountId: null,
  extOperator: null,
  extraHeaders: {},
  username: null,
  password: null,
  allowInsecureTls: true,
  paperAccountOnly: false,
});

test("IBKR cancel waits through PendingCancel until terminal Cancelled", async () => {
  const previousFetch = globalThis.fetch;
  let statusReads = 0;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (
      path.endsWith("/iserver/account/U1234567/order/order-1") &&
      init?.method === "DELETE"
    ) {
      return Response.json({ msg: "Request was submitted", order_id: "order-1" });
    }
    if (path.endsWith("/iserver/account/order/status/order-1")) {
      statusReads += 1;
      return Response.json({
        order_status: statusReads === 1 ? "PendingCancel" : "Cancelled",
        filledQuantity: 0,
        remainingQuantity: 1,
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const result = await new IbkrClient(config()).cancelOrder({
      accountId: "U1234567",
      orderId: "order-1",
      mode: "live",
    });
    assert.equal(statusReads, 2);
    assert.equal(result.status, "canceled");
    assert.equal(result.terminal, true);
    assert.equal(result.filledQuantity, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR order normalization keeps PendingCancel nonterminal", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            orderId: "order-1",
            acct: "U1234567",
            ticker: "AAPL",
            secType: "STK",
            side: "BUY",
            orderType: "LMT",
            timeInForce: "DAY",
            order_ccp_status: "PendingCancel",
            totalSize: 1,
            filledQuantity: 0,
            remainingQuantity: 1,
            price: 100,
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const [order] = await new IbkrClient(config()).listOrders({
      accountId: "U1234567",
      mode: "live",
    });
    assert.equal(order?.status, "pending_cancel");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR order reads select and verify the requested account without an accountId query", async () => {
  const previousFetch = globalThis.fetch;
  let accountReads = 0;
  const requests: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/iserver/accounts")) {
      accountReads += 1;
      return Response.json({
        accounts: ["U1111111", "U2222222"],
        selectedAccount: accountReads === 1 ? "U1111111" : "U2222222",
        isPaper: false,
      });
    }
    if (
      url.pathname.endsWith("/iserver/account") &&
      init?.method === "POST"
    ) {
      assert.deepEqual(JSON.parse(String(init.body)), { acctId: "U2222222" });
      return Response.json({ set: true, acctId: "U2222222" });
    }
    if (url.pathname.endsWith("/iserver/account/orders")) {
      assert.equal(url.searchParams.get("force"), "true");
      assert.equal(url.searchParams.has("accountId"), false);
      return Response.json({ orders: [] });
    }
    throw new Error(`unexpected IBKR request: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const orders = await new IbkrClient(config()).listOrders({
      accountId: "U2222222",
      mode: "live",
    });
    assert.deepEqual(orders, []);
    assert.deepEqual(requests, [
      "GET /v1/api/iserver/accounts",
      "POST /v1/api/iserver/account",
      "GET /v1/api/iserver/accounts",
      "GET /v1/api/iserver/account/orders?force=true",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR order reads stop when the requested account selection cannot be verified", async () => {
  const previousFetch = globalThis.fetch;
  let ordersRead = false;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1111111", "U2222222"],
        selectedAccount: "U1111111",
        isPaper: false,
      });
    }
    if (
      url.pathname.endsWith("/iserver/account") &&
      init?.method === "POST"
    ) {
      return Response.json({ set: true, acctId: "U2222222" });
    }
    if (url.pathname.endsWith("/iserver/account/orders")) {
      ordersRead = true;
      return Response.json({ orders: [] });
    }
    throw new Error(`unexpected IBKR request: ${url.pathname}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        new IbkrClient(config()).listOrders({
          accountId: "U2222222",
          mode: "live",
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ibkr_account_selection_failed",
    );
    assert.equal(ordersRead, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR cancel status reads legacy cum_fill and size quantities", async () => {
  const previousFetch = globalThis.fetch;
  let accountReads = 0;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      accountReads += 1;
      return Response.json({
        accounts: ["U1111111", "U1234567"],
        selectedAccount: accountReads === 1 ? "U1111111" : "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/account") && init?.method === "POST") {
      return Response.json({ set: true, acctId: "U1234567" });
    }
    if (
      path.endsWith("/iserver/account/U1234567/order/order-1") &&
      init?.method === "DELETE"
    ) {
      return Response.json({ msg: "Request was submitted", order_id: "order-1" });
    }
    if (path.endsWith("/iserver/account/order/status/order-1")) {
      return Response.json({
        order_status: "Submitted",
        cum_fill: "0.5",
        size: "0.5",
        total_size: "1",
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const result = await new IbkrClient(config()).cancelOrder({
      accountId: "U1234567",
      orderId: "order-1",
      mode: "live",
    });
    assert.equal(result.status, "partially_filled");
    assert.equal(result.filledQuantity, 0.5);
    assert.equal(result.terminal, false);
    assert.equal(result.cancelConfirmed, false);
    assert.equal(result.reconciliationRequired, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR unknown order status stays pending instead of appearing submitted", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            orderId: "order-unknown",
            acct: "U1234567",
            ticker: "AAPL",
            secType: "STK",
            side: "BUY",
            orderType: "LMT",
            timeInForce: "DAY",
            order_ccp_status: "UnexpectedNewState",
            totalSize: 1,
            filledQuantity: 0,
            remainingQuantity: 1,
            price: 100,
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const [order] = await new IbkrClient(config()).listOrders({
      accountId: "U1234567",
      mode: "live",
    });
    assert.equal(order?.status, "pending_submit");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

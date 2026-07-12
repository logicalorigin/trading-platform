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

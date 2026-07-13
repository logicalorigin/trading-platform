import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceOrderInput } from "@workspace/ibkr-contracts";

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

const order = {
  accountId: "U1234567",
  mode: "live",
  confirm: true,
  clientOrderId: "intent-123",
  symbol: "AAPL",
  assetClass: "equity",
  side: "buy",
  type: "limit",
  quantity: 1,
  limitPrice: 100,
  stopPrice: null,
  timeInForce: "day",
  optionContract: null,
} satisfies PlaceOrderInput & { clientOrderId: string };

test("IBKR what-if and submission use the identical prepared order", async () => {
  const previousFetch = globalThis.fetch;
  const paths: string[] = [];
  let whatIfBody: unknown = null;
  let submittedBody: unknown = null;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        { symbol: "AAPL", conid: 265598, description: "NASDAQ" },
      ]);
    }
    if (path.endsWith("/iserver/marketdata/snapshot")) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders/whatif")) {
      whatIfBody = JSON.parse(String(init?.body));
      return Response.json({
        amount: { amount: "100.00", commission: "1.00", total: "101.00" },
        equity: { change: "-101.00" },
        initial: { change: "100.00" },
        maintenance: { change: "100.00" },
      });
    }
    if (
      path.endsWith("/iserver/account/U1234567/orders") &&
      init?.method === "POST"
    ) {
      submittedBody = JSON.parse(String(init?.body));
      return Response.json([
        { order_id: "order-1", order_status: "Submitted" },
      ]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            acct: "U1234567",
            orderId: "order-1",
            conid: 265598,
            ticker: "AAPL",
            filledQuantity: 0,
            remainingQuantity: 1,
            totalSize: 1,
            status: "Submitted",
            origOrderType: "LMT",
            order_ref: "intent-123",
            timeInForce: "DAY",
            side: "BUY",
            price: 100,
          },
        ],
      });
    }
    if (path.endsWith("/iserver/account/order/status/order-1")) {
      return Response.json({
        order_id: "order-1",
        conid: 265598,
        symbol: "AAPL",
        side: "B",
        size: "1",
        total_size: "1",
        account: "U1234567",
        order_type: "LIMIT",
        cum_fill: "0",
        order_status: "Submitted",
        tif: "DAY",
        order_not_editable: false,
        cannot_cancel_order: false,
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    const preview = await client.previewOrder(order);
    const placed = await client.placeOrder(order);

    assert.deepEqual(whatIfBody, submittedBody);
    assert.equal(preview.clientOrderId, "intent-123");
    assert.equal(preview.orderPayload.cOID, "intent-123");
    assert.match(preview.orderFingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(preview.whatIf.commission, "1.00");
    assert.equal(placed.id, "order-1");
    assert.equal(placed.placementConfirmed, true);
    assert.equal(placed.reconciliationRequired, false);
    assert.ok(
      paths.indexOf("/v1/api/iserver/marketdata/snapshot") <
        paths.indexOf("/v1/api/iserver/account/U1234567/orders/whatif"),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR what-if fails closed for empty and unrecognized responses", async () => {
  const previousFetch = globalThis.fetch;
  const responses: unknown[] = [{}, { status: "ok" }];
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        { symbol: "AAPL", conid: 265598, description: "NASDAQ" },
      ]);
    }
    if (path.endsWith("/iserver/marketdata/snapshot")) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders/whatif")) {
      return Response.json(responses.shift());
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    const empty = await client.previewOrder(order);
    const unrecognized = await client.previewOrder(order);

    assert.match(empty.whatIf.error ?? "", /did not verify/i);
    assert.match(unrecognized.whatIf.error ?? "", /did not verify/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

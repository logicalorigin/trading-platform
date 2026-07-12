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

const originalOrderBody = {
  orders: [
    {
      acctId: "U1234567",
      conid: 265598,
      manualIndicator: true,
      secType: "265598:STK",
      cOID: "replace-intent-123",
      orderType: "LMT",
      listingExchange: "NASDAQ",
      outsideRTH: false,
      side: "BUY",
      ticker: "AAPL",
      tif: "DAY",
      quantity: 1,
      price: 100,
    },
  ],
};

test("IBKR replacement previews and submits one exact price-only prepared ticket", async () => {
  const previousFetch = globalThis.fetch;
  const paths: string[] = [];
  let modified = false;
  let whatIfBody: unknown = null;
  let modifyBody: unknown = null;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    paths.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            acct: "U1234567",
            account: "U1234567",
            orderId: "1234567890",
            conid: 265598,
            ticker: "AAPL",
            secType: "STK",
            remainingQuantity: 1,
            filledQuantity: 0,
            totalSize: 1,
            status: "Submitted",
            order_ccp_status: "Submitted",
            origOrderType: "LMT",
            orderType: "Limit",
            order_ref: "replace-intent-123",
            timeInForce: "DAY",
            side: "BUY",
            price: modified ? 99 : 100,
          },
        ],
      });
    }
    if (path.endsWith("/iserver/account/order/status/1234567890")) {
      return Response.json({
        order_id: "1234567890",
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
    if (path.endsWith("/iserver/contract/rules")) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        conid: 265598,
        exchange: "NASDAQ",
        isBuy: true,
        modifyOrder: true,
        orderId: 1234567890,
      });
      return Response.json({
        canTradeAcctIds: ["U1234567"],
        orderTypes: ["LMT"],
        forceOrderPreview: false,
      });
    }
    if (path.endsWith("/iserver/marketdata/snapshot")) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders/whatif")) {
      whatIfBody = JSON.parse(String(init?.body));
      return Response.json({
        amount: { amount: "99.00", commission: "1.00", total: "100.00" },
        equity: { change: "-100.00" },
        initial: { change: "99.00" },
        maintenance: { change: "99.00" },
        position: { change: "1" },
      });
    }
    if (
      path.endsWith("/iserver/account/U1234567/order/1234567890") &&
      init?.method === "POST"
    ) {
      modifyBody = JSON.parse(String(init.body));
      modified = true;
      return Response.json({ order_id: "1234567890", order_status: "Submitted" });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    const preview = await client.previewOrderReplacement({
      accountId: "U1234567",
      orderId: "1234567890",
      mode: "live",
      originalOrderBody,
      limitPrice: 99,
    });
    const replaced = await client.replacePreparedOrder({
      accountId: "U1234567",
      orderId: "1234567890",
      mode: "live",
      previousOrderBody: originalOrderBody,
      preparedOrderBody: { orders: [preview.orderPayload] },
    });

    assert.deepEqual(whatIfBody, { orders: [preview.orderPayload] });
    assert.deepEqual(modifyBody, preview.orderPayload);
    assert.equal(preview.orderPayload.price, 99);
    assert.equal(preview.orderPayload.cOID, "replace-intent-123");
    assert.equal(replaced.id, "1234567890");
    assert.equal(replaced.limitPrice, 99);
    assert.equal(replaced.filledQuantity, 0);
    assert.equal(replaced.replacementConfirmed, true);
    assert.equal(replaced.reconciliationRequired, false);
    assert.ok(
      paths.indexOf("POST /v1/api/iserver/contract/rules") <
        paths.indexOf("GET /v1/api/iserver/marketdata/snapshot"),
    );
    assert.ok(
      paths.indexOf("GET /v1/api/iserver/marketdata/snapshot") <
        paths.indexOf("POST /v1/api/iserver/account/U1234567/orders/whatif"),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR replacement preview fails closed when zero-fill evidence is missing", async () => {
  const previousFetch = globalThis.fetch;
  let rulesRequested = false;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            acct: "U1234567",
            orderId: "1234567890",
            conid: 265598,
            totalSize: 1,
            filledQuantity: 0,
            remainingQuantity: 1,
            status: "Submitted",
            origOrderType: "LMT",
            order_ref: "replace-intent-123",
            timeInForce: "DAY",
            side: "BUY",
            price: 100,
          },
        ],
      });
    }
    if (path.endsWith("/iserver/account/order/status/1234567890")) {
      return Response.json({
        order_id: "1234567890",
        conid: 265598,
        side: "B",
        size: "1",
        total_size: "1",
        account: "U1234567",
        order_type: "LIMIT",
        order_status: "Submitted",
        tif: "DAY",
        order_not_editable: false,
        cannot_cancel_order: false,
      });
    }
    if (path.endsWith("/iserver/contract/rules")) {
      rulesRequested = true;
      return Response.json({});
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).previewOrderReplacement({
        accountId: "U1234567",
        orderId: "1234567890",
        mode: "live",
        originalOrderBody,
        limitPrice: 99,
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_replace_verification_incomplete",
        );
        return true;
      },
    );
    assert.equal(rulesRequested, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

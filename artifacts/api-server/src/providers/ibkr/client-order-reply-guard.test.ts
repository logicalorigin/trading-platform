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

const order: PlaceOrderInput = {
  accountId: "U1234567",
  mode: "live",
  confirm: true,
  clientOrderId: "intent-warning-1",
  symbol: "AAPL",
  assetClass: "equity",
  side: "buy",
  type: "limit",
  quantity: 1,
  limitPrice: 100,
  stopPrice: null,
  timeInForce: "day",
  optionContract: null,
};

test("IBKR warning replies require explicit continuation and are never auto-confirmed", async () => {
  const previousFetch = globalThis.fetch;
  let replyRequests = 0;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"] });
    }
    if (path.endsWith("/iserver/secdef/search")) {
      return Response.json([
        {
          symbol: "AAPL",
          conid: 265598,
          description: "NASDAQ",
        },
      ]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders")) {
      return Response.json([
        {
          id: "reply-1",
          message: ["Review this order warning."],
        },
      ]);
    }
    if (path.endsWith("/iserver/reply/reply-1")) {
      replyRequests += 1;
      return Response.json([
        { order_id: "order-1", order_status: "Submitted" },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).placeOrder(order),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_order_warning_confirmation_required",
        );
        assert.deepEqual((error as { data?: unknown }).data, {
          replyId: "reply-1",
          messages: ["Review this order warning."],
        });
        return true;
      },
    );
    assert.equal(replyRequests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("explicit IBKR reply continuation sends only the chosen decision", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path.endsWith("/iserver/reply/reply-decline")) {
      return Response.json({ status: "discarded" });
    }
    if (path.endsWith("/iserver/reply/reply-accept")) {
      return Response.json([
        {
          id: "reply-next",
          message: ["Review the next warning."],
        },
      ]);
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    assert.deepEqual(
      await client.replyOrderWarning({
        replyId: "reply-decline",
        confirmed: false,
      }),
      { kind: "declined" },
    );
    assert.deepEqual(
      await client.replyOrderWarning({
        replyId: "reply-accept",
        confirmed: true,
      }),
      {
        kind: "warning",
        replyId: "reply-next",
        messages: ["Review the next warning."],
      },
    );
    assert.deepEqual(requests, [
      {
        path: "/v1/api/iserver/reply/reply-decline",
        body: { confirmed: false },
      },
      {
        path: "/v1/api/iserver/reply/reply-accept",
        body: { confirmed: true },
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

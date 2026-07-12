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
        return true;
      },
    );
    assert.equal(replyRequests, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

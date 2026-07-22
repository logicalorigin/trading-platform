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

test("IBKR rejects fractional share quantities before broker discovery", async () => {
  const previousFetch = globalThis.fetch;
  let brokerCalled = false;
  globalThis.fetch = (async () => {
    brokerCalled = true;
    throw new Error("broker should not be called");
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).previewOrder({ ...order, quantity: 1.5 }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_order_quantity_invalid",
        );
        return true;
      },
    );
    assert.equal(brokerCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR stock resolution requires an exact normalized symbol and safe conid", async () => {
  const previousFetch = globalThis.fetch;
  const resultsBySymbol = new Map<string, Record<string, unknown>[]>([
    ["AAPL", [{ symbol: "MSFT", conid: 272093, description: "NASDAQ" }]],
    ["ZERO", [{ symbol: "ZERO", conid: 0 }]],
    ["NEGATIVE", [{ symbol: "NEGATIVE", conid: -1 }]],
    ["FRACTIONAL", [{ symbol: "FRACTIONAL", conid: 1.5 }]],
    [
      "UNSAFE",
      [{ symbol: "UNSAFE", conid: Number.MAX_SAFE_INTEGER + 1 }],
    ],
    ["BRK.B", [{ symbol: "BRK B", conid: 8314, description: "NYSE" }]],
  ]);
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    assert.ok(url.pathname.endsWith("/iserver/secdef/search"));
    return Response.json(
      resultsBySymbol.get(url.searchParams.get("symbol") ?? "") ?? [],
    );
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    await assert.rejects(
      client.resolveStockContracts(["AAPL"]),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_contract_not_found",
        );
        return true;
      },
    );

    for (const symbol of ["ZERO", "NEGATIVE", "FRACTIONAL", "UNSAFE"]) {
      await assert.rejects(
        client.resolveStockContracts([symbol]),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "ibkr_invalid_conid",
          );
          return true;
        },
      );
    }

    assert.deepEqual(await client.resolveStockContracts(["BRK.B"]), [
      {
        conid: 8314,
        secType: "STK",
        listingExchange: "NYSE",
        symbol: "BRK.B",
        providerContractId: "8314",
      },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

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

test("IBKR market submission omits price and confirms an immediate fill", async () => {
  const previousFetch = globalThis.fetch;
  const paths: string[] = [];
  let whatIfBody: Record<string, unknown> | null = null;
  let submittedBody: Record<string, unknown> | null = null;
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
        amount: { amount: "101.25", commission: "1.00", total: "102.25" },
        equity: { change: "-102.25" },
        initial: { change: "101.25" },
        maintenance: { change: "101.25" },
      });
    }
    if (
      path.endsWith("/iserver/account/U1234567/orders") &&
      init?.method === "POST"
    ) {
      submittedBody = JSON.parse(String(init?.body));
      return Response.json([
        { order_id: "order-market-1", order_status: "Submitted" },
      ]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            acct: "U1234567",
            orderId: "order-market-1",
            conid: 265598,
            ticker: "AAPL",
            filledQuantity: 1,
            remainingQuantity: 0,
            totalSize: 1,
            status: "Filled",
            origOrderType: "MARKET",
            orderType: "Market",
            order_ref: "intent-market-123",
            timeInForce: "CLOSE",
            side: "BUY",
            avgPrice: "101.25",
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const marketOrder = {
      ...order,
      clientOrderId: "intent-market-123",
      type: "market",
      limitPrice: null,
    } satisfies PlaceOrderInput & { clientOrderId: string };
    const client = new IbkrClient(config());
    const preview = await client.previewOrder(marketOrder);
    const placed = await client.placeOrder(marketOrder);
    const preparedOrder = (
      (whatIfBody as { orders?: Record<string, unknown>[] } | null)?.orders ?? []
    )[0];

    assert.deepEqual(whatIfBody, submittedBody);
    assert.equal(preparedOrder?.orderType, "MKT");
    assert.equal(Object.hasOwn(preparedOrder ?? {}, "price"), false);
    assert.equal(placed.id, "order-market-1");
    assert.equal(placed.type, "market");
    assert.equal(placed.status, "filled");
    assert.equal(placed.filledQuantity, 1);
    assert.equal(placed.limitPrice, null);
    assert.equal(placed.clientOrderId, "intent-market-123");
    assert.equal(placed.providerContractId, "265598");
    assert.equal(placed.placementConfirmed, true);
    assert.equal(placed.reconciliationRequired, false);
    assert.equal(
      paths.some((path) => path.includes("/iserver/account/order/status/")),
      false,
    );
    assert.equal(preview.clientOrderId, "intent-market-123");
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

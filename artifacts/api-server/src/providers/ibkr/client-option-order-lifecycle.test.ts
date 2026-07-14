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

const contract = {
  ticker: "AAPL260821C00200000",
  underlying: "AAPL",
  expirationDate: new Date("2026-08-21T00:00:00.000Z"),
  strike: 200,
  right: "call" as const,
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: "700001",
};

const order: PlaceOrderInput = {
  accountId: "U1234567",
  mode: "live",
  clientOrderId: "option-intent-1",
  symbol: "AAPL",
  assetClass: "option",
  side: "buy",
  type: "limit",
  quantity: 2,
  limitPrice: 4.5,
  stopPrice: null,
  timeInForce: "day",
  optionContract: contract,
  optionAction: "buy_to_open",
  positionEffect: "open",
  strategyIntent: "long_option",
};

const contractInfo = (overrides: Record<string, unknown> = {}) => ({
  con_id: 700001,
  instrument_type: "OPT",
  maturity_date: "20260821",
  multiplier: "100",
  strike: 200,
  right: "C",
  ticker: "AAPL",
  local_symbol: "AAPL  260821C00200000",
  trading_class: "AAPL",
  currency: "USD",
  contract_clarification_type: null,
  ...overrides,
});

test("IBKR resolves a selected option tuple to a verified canonical conid", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/iserver/secdef/search")) {
      return Response.json([{ conid: 265598, symbol: "AAPL", sections: [] }]);
    }
    if (url.pathname.endsWith("/iserver/secdef/info")) {
      return Response.json([
        {
          conid: 700001,
          maturityDate: "20260821",
          strike: 200,
          right: "C",
          exchange: "SMART",
        },
      ]);
    }
    if (url.pathname.endsWith("/iserver/contract/700001/info")) {
      return Response.json(contractInfo());
    }
    throw new Error(`unexpected IBKR request: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const resolved = await new IbkrClient(config()).resolveOptionOrderContract({
      ...contract,
      providerContractId: null,
    });
    assert.equal(resolved.providerContractId, "700001");
    assert.equal(resolved.ticker, contract.ticker);
    assert.equal(resolved.strike, contract.strike);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR previews and verifies an exact prepared option order", async () => {
  const previousFetch = globalThis.fetch;
  let submittedBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/contract/700001/info")) {
      return Response.json(contractInfo());
    }
    if (path.endsWith("/iserver/marketdata/snapshot")) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders/whatif")) {
      return Response.json({
        amount: { amount: "900.00", commission: "1.00", total: "901.00" },
        equity: { change: "-901.00" },
        position: { change: "2" },
      });
    }
    if (
      path.endsWith("/iserver/account/U1234567/orders") &&
      init?.method === "POST"
    ) {
      submittedBody = JSON.parse(String(init.body));
      return Response.json([
        { order_id: "option-order-1", order_status: "Submitted" },
      ]);
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            acct: "U1234567",
            orderId: "option-order-1",
            conid: 700001,
            ticker: "AAPL",
            secType: "OPT",
            filledQuantity: 0,
            remainingQuantity: 2,
            totalSize: 2,
            status: "Submitted",
            origOrderType: "LMT",
            order_ref: "option-intent-1",
            timeInForce: "DAY",
            side: "BUY",
            price: 4.5,
          },
        ],
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    const preview = await client.previewOrder(order);
    const placed = await client.placePreparedOrder(order, {
      accountId: preview.accountId,
      body: { orders: [preview.orderPayload] },
    });
    const rawOrder = (
      submittedBody as { orders?: Record<string, unknown>[] } | null
    )?.orders?.[0];

    assert.equal(rawOrder?.secType, "700001:OPT");
    assert.equal(rawOrder?.quantity, 2);
    assert.equal(preview.optionContract?.providerContractId, "700001");
    assert.equal(placed.assetClass, "option");
    assert.equal(placed.side, "buy");
    assert.equal(placed.quantity, 2);
    assert.equal(placed.optionContract?.ticker, contract.ticker);
    assert.equal(placed.optionAction, "buy_to_open");
    assert.equal(placed.positionEffect, "open");
    assert.equal(placed.strategyIntent, "long_option");
    assert.equal(placed.placementConfirmed, true);
    assert.equal(placed.reconciliationRequired, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR rejects a selected option conid whose contract tuple differs", async () => {
  const previousFetch = globalThis.fetch;
  let whatIfSubmitted = false;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.endsWith("/iserver/contract/700001/info")) {
      return Response.json(contractInfo({ strike: 205 }));
    }
    if (path.endsWith("/orders/whatif")) {
      whatIfSubmitted = true;
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).previewOrder(order),
      (error) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_option_contract_identity_mismatch",
        );
        return true;
      },
    );
    assert.equal(whatIfSubmitted, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR rejects a non-canonical selected option conid", async () => {
  const previousFetch = globalThis.fetch;
  let contractInfoRequested = false;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({
        accounts: ["U1234567"],
        selectedAccount: "U1234567",
        isPaper: false,
      });
    }
    if (path.includes("/iserver/contract/")) {
      contractInfoRequested = true;
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).previewOrder({
        ...order,
        optionContract: {
          ...contract,
          providerContractId: "700001.0",
        },
      }),
      (error) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_option_contract_id_invalid",
        );
        return true;
      },
    );
    assert.equal(contractInfoRequested, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR tuple resolution never falls back to a different option", async () => {
  const previousFetch = globalThis.fetch;
  let whatIfSubmitted = false;
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
      return Response.json([{ symbol: "AAPL", conid: 265598 }]);
    }
    if (path.endsWith("/iserver/secdef/info")) {
      return Response.json([
        {
          conid: 700002,
          maturityDate: "20260821",
          strike: 205,
          right: "C",
          exchange: "SMART",
        },
      ]);
    }
    if (path.endsWith("/orders/whatif")) {
      whatIfSubmitted = true;
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    await assert.rejects(
      new IbkrClient(config()).previewOrder({
        ...order,
        optionContract: { ...contract, providerContractId: null },
      }),
      (error) => {
        assert.equal(
          (error as { code?: string }).code,
          "ibkr_option_contract_not_found",
        );
        return true;
      },
    );
    assert.equal(whatIfSubmitted, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR cancels a fully unfilled prepared option order", async () => {
  const previousFetch = globalThis.fetch;
  let cancelSubmitted = false;
  const preparedOrderBody = {
    orders: [
      {
        acctId: "U1234567",
        conid: 700001,
        cOID: "option-intent-1",
        listingExchange: "SMART",
        manualIndicator: true,
        orderType: "LMT",
        outsideRTH: false,
        price: 4.5,
        quantity: 2,
        secType: "700001:OPT",
        side: "BUY",
        ticker: "AAPL",
        tif: "DAY",
      },
    ],
  };
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/iserver/accounts")) {
      return Response.json({ accounts: ["U1234567"], isPaper: false });
    }
    if (path.endsWith("/iserver/account/orders")) {
      return Response.json({
        orders: [
          {
            acct: "U1234567",
            orderId: "option-order-1",
            conid: 700001,
            ticker: "AAPL",
            secType: "OPT",
            filledQuantity: 0,
            remainingQuantity: 2,
            totalSize: 2,
            status: "Submitted",
            origOrderType: "LMT",
            order_ref: "option-intent-1",
            timeInForce: "DAY",
            side: "BUY",
            price: 4.5,
          },
        ],
      });
    }
    if (path.endsWith("/iserver/account/order/status/option-order-1")) {
      return Response.json(
        cancelSubmitted
          ? {
              order_id: "option-order-1",
              order_status: "Cancelled",
              cum_fill: 0,
              size: 0,
              total_size: 2,
            }
          : {
              order_id: "option-order-1",
              account: "U1234567",
              conid: 700001,
              side: "BUY",
              order_type: "LMT",
              tif: "DAY",
              cum_fill: 0,
              size: 2,
              total_size: 2,
              order_status: "Submitted",
              order_not_editable: false,
              cannot_cancel_order: false,
            },
      );
    }
    if (
      path.endsWith("/iserver/account/U1234567/order/option-order-1") &&
      init?.method === "DELETE"
    ) {
      cancelSubmitted = true;
      return Response.json({
        msg: "Request was submitted",
        order_id: "option-order-1",
      });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const result = await new IbkrClient(config()).cancelOrder({
      accountId: "U1234567",
      orderId: "option-order-1",
      mode: "live",
      preparedOrderBody,
    });

    assert.equal(cancelSubmitted, true);
    assert.equal(result.status, "canceled");
    assert.equal(result.filledQuantity, 0);
    assert.equal(result.cancelConfirmed, true);
    assert.equal(result.reconciliationRequired, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("IBKR previews and verifies a price-only option replacement", async () => {
  const previousFetch = globalThis.fetch;
  let modified = false;
  const originalOrderBody = {
    orders: [
      {
        acctId: "U1234567",
        conid: 700001,
        cOID: "option-intent-1",
        listingExchange: "SMART",
        manualIndicator: true,
        orderType: "LMT",
        outsideRTH: false,
        price: 4.5,
        quantity: 2,
        secType: "700001:OPT",
        side: "BUY",
        ticker: "AAPL",
        tif: "DAY",
      },
    ],
  };
  const replacementOrder = { ...order, limitPrice: 4.25 };
  globalThis.fetch = (async (input, init) => {
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
            orderId: "7000001",
            conid: 700001,
            ticker: "AAPL",
            secType: "OPT",
            filledQuantity: 0,
            remainingQuantity: 2,
            totalSize: 2,
            status: "Submitted",
            origOrderType: "LMT",
            order_ref: "option-intent-1",
            timeInForce: "DAY",
            side: "BUY",
            price: modified ? 4.25 : 4.5,
          },
        ],
      });
    }
    if (path.endsWith("/iserver/account/order/status/7000001")) {
      return Response.json({
        order_id: "7000001",
        account: "U1234567",
        conid: 700001,
        side: "BUY",
        order_type: "LMT",
        tif: "DAY",
        cum_fill: 0,
        size: 2,
        total_size: 2,
        order_status: "Submitted",
        order_not_editable: false,
        cannot_cancel_order: false,
      });
    }
    if (path.endsWith("/iserver/contract/rules")) {
      return Response.json({
        canTradeAcctIds: ["U1234567"],
        orderTypes: ["LMT"],
      });
    }
    if (path.endsWith("/iserver/contract/700001/info")) {
      return Response.json(contractInfo());
    }
    if (path.endsWith("/iserver/marketdata/snapshot")) {
      return Response.json([]);
    }
    if (path.endsWith("/iserver/account/U1234567/orders/whatif")) {
      return Response.json({
        amount: { amount: "850.00", commission: "1.00", total: "851.00" },
        equity: { change: "-851.00" },
        position: { change: "2" },
      });
    }
    if (
      path.endsWith("/iserver/account/U1234567/order/7000001") &&
      init?.method === "POST"
    ) {
      const body = JSON.parse(String(init.body));
      assert.equal(body.price, 4.25);
      modified = true;
      return Response.json({ order_id: "7000001", order_status: "Submitted" });
    }
    throw new Error(`unexpected IBKR request: ${path}`);
  }) as typeof fetch;

  try {
    const client = new IbkrClient(config());
    const preview = await client.previewOrderReplacement({
      accountId: "U1234567",
      orderId: "7000001",
      mode: "live",
      originalOrderBody,
      limitPrice: 4.25,
      expectedOrder: order,
    });
    const replaced = await client.replacePreparedOrder({
      accountId: "U1234567",
      orderId: "7000001",
      mode: "live",
      previousOrderBody: originalOrderBody,
      preparedOrderBody: { orders: [preview.orderPayload] },
      expectedOrder: replacementOrder,
    });

    assert.equal(preview.assetClass, "option");
    assert.equal(preview.optionContract?.providerContractId, "700001");
    assert.equal(replaced.assetClass, "option");
    assert.equal(replaced.quantity, 2);
    assert.equal(replaced.limitPrice, 4.25);
    assert.equal(replaced.optionContract?.providerContractId, "700001");
    assert.equal(replaced.optionAction, "buy_to_open");
    assert.equal(replaced.replacementConfirmed, true);
    assert.equal(replaced.reconciliationRequired, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

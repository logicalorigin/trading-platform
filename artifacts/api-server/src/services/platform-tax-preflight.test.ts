import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceOrderInput } from "@workspace/ibkr-contracts";

import { runAsAppUser } from "./app-user-context";
import { placeOrder, submitRawOrders } from "./platform";

const baseIbkrOrder = (
  overrides: Partial<PlaceOrderInput> = {},
): PlaceOrderInput => ({
  accountId: "U1234567",
  mode: "shadow",
  confirm: true,
  symbol: "AAPL",
  assetClass: "equity",
  side: "buy",
  type: "limit",
  quantity: 1,
  limitPrice: 210,
  stopPrice: null,
  timeInForce: "day",
  optionContract: null,
  ...overrides,
});

const rejectsWithCode = (code: string) => (error: unknown): boolean => {
  assert.equal((error as { code?: string }).code, code);
  return true;
};

test("IBKR structured broker submission requires tax preflight even when request mode is shadow", async () => {
  await runAsAppUser("tax-platform-structured", async () => {
    await assert.rejects(
      placeOrder(baseIbkrOrder()),
      rejectsWithCode("tax_preflight_required"),
    );
  });
});

test("IBKR raw broker submission requires tax preflight even when request mode is shadow", async () => {
  await runAsAppUser("tax-platform-raw", async () => {
    await assert.rejects(
      submitRawOrders({
        accountId: "U1234567",
        mode: "shadow",
        confirm: true,
        parentOrderRequest: baseIbkrOrder(),
        ibkrOrders: [
          {
            acctId: "U1234567",
            conid: 265598,
            side: "BUY",
            orderType: "LMT",
            quantity: 1,
            price: 210,
            tif: "DAY",
          },
        ],
      }),
      rejectsWithCode("tax_preflight_required"),
    );
  });
});

test("IBKR raw broker submission requires parent order request for tax fingerprinting", async () => {
  await assert.rejects(
    submitRawOrders({
      accountId: "U1234567",
      mode: "shadow",
      confirm: true,
      ibkrOrders: [
        {
          acctId: "U1234567",
          conid: 265598,
          side: "BUY",
          orderType: "LMT",
          quantity: 1,
          price: 210,
          tif: "DAY",
        },
      ],
    }),
    rejectsWithCode("tax_preflight_parent_order_required"),
  );
});

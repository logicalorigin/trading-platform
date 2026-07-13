import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceOrderInput } from "@workspace/ibkr-contracts";

import { cancelAccountOrder } from "./account";
import {
  cancelOrder,
  placeOrder,
  replaceOrder,
  submitRawOrders,
} from "./platform";

const baseOrder = (
  overrides: Partial<PlaceOrderInput> = {},
): PlaceOrderInput => ({
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
  ...overrides,
});

const rejectsWithCode = (code: string) => (error: unknown): boolean => {
  assert.equal((error as { code?: string }).code, code);
  return true;
};

test("shadow mode cannot reach structured IBKR submission", async () => {
  await assert.rejects(
    placeOrder(baseOrder({ mode: "shadow" })),
    rejectsWithCode("ibkr_broker_mutation_live_mode_required"),
  );
});

test("shadow mode cannot reach raw IBKR submission", async () => {
  await assert.rejects(
    submitRawOrders({
      accountId: "U1234567",
      mode: "shadow",
      confirm: true,
      parentOrderRequest: baseOrder({ mode: "shadow" }),
      ibkrOrders: [],
    }),
    rejectsWithCode("ibkr_broker_mutation_live_mode_required"),
  );
});

test("shadow mode cannot reach IBKR replacement", async () => {
  await assert.rejects(
    replaceOrder({
      accountId: "U1234567",
      orderId: "1234567890",
      limitPrice: 99,
      orderFingerprint: "0".repeat(64),
      taxPreflightToken: "tax-pf",
      mode: "shadow",
      confirm: true,
    }),
    rejectsWithCode("ibkr_broker_mutation_live_mode_required"),
  );
});

test("shadow mode cannot reach either IBKR cancellation service", async () => {
  await assert.rejects(
    cancelOrder({
      accountId: "U1234567",
      orderId: "order-1",
      mode: "shadow",
      confirm: true,
    }),
    rejectsWithCode("ibkr_broker_mutation_live_mode_required"),
  );
  await assert.rejects(
    cancelAccountOrder({
      accountId: "U1234567",
      orderId: "order-1",
      mode: "shadow",
      confirm: true,
    }),
    rejectsWithCode("ibkr_broker_mutation_live_mode_required"),
  );
});

test("raw and automated live IBKR submissions remain disabled", async () => {
  await assert.rejects(
    submitRawOrders({
      accountId: "U1234567",
      mode: "live",
      confirm: true,
      parentOrderRequest: baseOrder(),
      ibkrOrders: [],
    }),
    rejectsWithCode("ibkr_raw_live_orders_disabled"),
  );
  await assert.rejects(
    placeOrder({
      ...baseOrder(),
      source: "automation",
    } as PlaceOrderInput & { source: string }),
    rejectsWithCode("ibkr_automated_live_orders_disabled"),
  );
});

test("runtime defaults cannot authorize raw submission or replacement", async () => {
  await assert.rejects(
    submitRawOrders({
      accountId: "U1234567",
      confirm: true,
      parentOrderRequest: baseOrder(),
      ibkrOrders: [],
    }),
    rejectsWithCode("ibkr_order_mode_required"),
  );
  await assert.rejects(
    replaceOrder({
      accountId: "U1234567",
      orderId: "1234567890",
      limitPrice: 99,
      orderFingerprint: "0".repeat(64),
      taxPreflightToken: "tax-pf",
      confirm: true,
    }),
    rejectsWithCode("ibkr_order_mode_required"),
  );
});

test("live submission requires a prepared order intent", async () => {
  await assert.rejects(
    placeOrder(baseOrder()),
    rejectsWithCode("ibkr_order_intent_required"),
  );
});

test("direct live IBKR placement stays inside the first manual equity lane", async () => {
  await assert.rejects(
    placeOrder({
      ...baseOrder({ type: "market", limitPrice: null }),
      clientOrderId: "intent-market",
    }),
    rejectsWithCode("ibkr_live_order_scope_restricted"),
  );
  await assert.rejects(
    placeOrder({
      ...baseOrder({ quantity: 2 }),
      clientOrderId: "intent-two-shares",
    }),
    rejectsWithCode("ibkr_live_order_scope_restricted"),
  );
});

test("raw live replacement remains disabled without a prepared intent", async () => {
  await assert.rejects(
    replaceOrder({
      accountId: "U1234567",
      orderId: "1234567890",
      limitPrice: 99,
      orderFingerprint: "",
      taxPreflightToken: "",
      mode: "live",
      confirm: true,
    }),
    rejectsWithCode("ibkr_replace_intent_required"),
  );
});

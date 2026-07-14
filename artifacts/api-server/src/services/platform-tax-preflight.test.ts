import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PlaceOrderInput } from "@workspace/ibkr-contracts";

import { runAsAppUser } from "./app-user-context";
import {
  buildOrderVisibilityCacheKey,
  placeOrder,
  previewOrder,
  replacementPreviewRequiresReconciliation,
  submitRawOrders,
} from "./platform";
import { HttpError } from "../lib/errors";

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

const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

test("IBKR structured broker submission rejects shadow mode before tax preflight", async () => {
  await runAsAppUser("tax-platform-structured", async () => {
    await assert.rejects(
      placeOrder(baseIbkrOrder()),
      rejectsWithCode("ibkr_broker_mutation_live_mode_required"),
    );
  });
});

test("IBKR raw broker submission rejects shadow mode before tax preflight", async () => {
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
      rejectsWithCode("ibkr_broker_mutation_live_mode_required"),
    );
  });
});

test("IBKR raw live submission remains disabled", async () => {
  await assert.rejects(
    submitRawOrders({
      accountId: "U1234567",
      mode: "live",
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
    rejectsWithCode("ibkr_raw_live_orders_disabled"),
  );
});

test("IBKR broker-backed preview rejects shadow mode before any provider call", async () => {
  await assert.rejects(
    previewOrder(baseIbkrOrder()),
    rejectsWithCode("ibkr_order_preview_live_mode_required"),
  );
});

test("prepared IBKR mutations remain bound to one owned gateway lifecycle", () => {
  assert.match(platformSource, /getControlledIbkrOrderLifecycle\(\)/);
  assert.match(platformSource, /gatewaySnapshot = assertIbkrClientPortalGatewaySnapshot\(\)/);
  assert.equal(
    platformSource.match(/assertPreparedIbkrGatewayBinding\(/g)?.length,
    4,
  );
});

test("direct IBKR order visibility cache isolates app users and gateway generations", () => {
  const input = { accountId: "U1234567", mode: "live" as const };
  const gateway = {
    appUserId: "user-a",
    baseUrl: "https://127.0.0.1:5000",
    hosted: true,
    loginCompletions: 2,
    startedAt: 123,
  };
  const first = buildOrderVisibilityCacheKey(input, {
    appUserId: "user-a",
    gatewaySnapshot: gateway,
  });

  assert.notEqual(
    first,
    buildOrderVisibilityCacheKey(input, {
      appUserId: "user-b",
      gatewaySnapshot: { ...gateway, appUserId: "user-b" },
    }),
  );
  assert.notEqual(
    first,
    buildOrderVisibilityCacheKey(input, {
      appUserId: "user-a",
      gatewaySnapshot: { ...gateway, loginCompletions: 3 },
    }),
  );
  assert.notEqual(
    first,
    buildOrderVisibilityCacheKey(input, {
      appUserId: "user-a",
      gatewaySnapshot: { ...gateway, startedAt: 124 },
    }),
  );
});

test("live full-fill visibility reconciles the controlled IBKR lifecycle", () => {
  const readOrdersSource = platformSource.slice(
    platformSource.indexOf("async function readCurrentOrders"),
    platformSource.indexOf("async function listOrdersForVisibility"),
  );
  assert.match(readOrdersSource, /order\.mode !== "live"/);
  assert.match(readOrdersSource, /order\.status !== "filled"/);
  assert.match(
    readOrdersSource,
    /order\.filledQuantity !== order\.quantity/,
  );
  assert.match(readOrdersSource, /recordSubmittedIbkrOrderFilled\(/);
  assert.match(readOrdersSource, /clientOrderId: order\.clientOrderId/);
  assert.match(
    readOrdersSource,
    /providerContractId: order\.providerContractId/,
  );
  assert.match(readOrdersSource, /client\.listExecutions\(/);
  assert.match(readOrdersSource, /lifecycle\.status === "active"/);
  assert.match(readOrdersSource, /activeOrderStillVisible/);
  assert.match(readOrdersSource, /!activeOrderStillVisible/);
  assert.match(
    readOrdersSource,
    /lifecycle\.status === "reconciliation_required"/,
  );
  assert.match(readOrdersSource, /recordSubmittedIbkrExecutionFilled\(/);
  assert.match(readOrdersSource, /clientOrderId: first\.orderRef/);
  assert.match(readOrdersSource, /days: 7/);
  assert.match(readOrdersSource, /Number\.isFinite\(lifecycle\.quantity\)/);
  assert.match(readOrdersSource, /lifecycle\.quantity > 0/);
  assert.doesNotMatch(readOrdersSource, /lifecycle\.quantity === 1/);
});

test("the live trading guard accepts a verified request-scoped portal gateway", () => {
  const guardSource = platformSource.slice(
    platformSource.indexOf("export async function assertIbkrGatewayTradingAvailable"),
    platformSource.indexOf("async function validateOrderIntentForRouting"),
  );
  assert.match(guardSource, /isIbkrClientPortalConfigured\(\)/);
  assert.doesNotMatch(guardSource, /getProviderConfiguration\(\)\.ibkr/);
});

test("replacement preview persists reconciliation for ambiguous state evidence only", () => {
  const replacementPreviewSource = platformSource.slice(
    platformSource.indexOf("export async function previewOrderReplacement"),
    platformSource.indexOf("export async function replaceOrder"),
  );
  assert.ok(
    replacementPreviewSource.indexOf("try {") <
      replacementPreviewSource.indexOf("await assertIbkrGatewayTradingAvailable"),
  );
  assert.match(
    replacementPreviewSource,
    /recordSubmittedIbkrOrderReconciliationRequired\(/,
  );
  assert.equal(
    replacementPreviewRequiresReconciliation(
      new HttpError(409, "filled", { code: "ibkr_replace_order_has_fills" }),
    ),
    true,
  );
  assert.equal(
    replacementPreviewRequiresReconciliation(new Error("transport unknown")),
    true,
  );
  for (const code of [
    "ibkr_replace_request_invalid",
    "ibkr_replace_price_unchanged",
    "ibkr_replace_rules_rejected",
  ]) {
    assert.equal(
      replacementPreviewRequiresReconciliation(
        new HttpError(409, "safe rejection", { code }),
      ),
      false,
    );
  }
});

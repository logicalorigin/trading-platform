import assert from "node:assert/strict";
import test from "node:test";

import {
  __schwabEquityOrderInternalsForTests,
  type SchwabEquityOrderAccount,
} from "./schwab-equity-orders";

const {
  validateSchwabEquityOrderInput,
  buildSchwabOrderRequest,
  assertExecutionReady,
  executionReady,
  normalizeSchwabSymbol,
  formatPrice,
} = __schwabEquityOrderInternalsForTests;

function expectHttpError(fn: () => unknown, statusCode: number, code: string) {
  assert.throws(fn, (err: unknown) => {
    const e = err as { statusCode?: number; code?: string };
    assert.equal(e.statusCode, statusCode);
    assert.equal(e.code, code);
    return true;
  });
}

test("normalizeSchwabSymbol upper-cases, trims, and rejects invalid symbols", () => {
  assert.equal(normalizeSchwabSymbol("aapl"), "AAPL");
  assert.equal(normalizeSchwabSymbol("  msft "), "MSFT");
  assert.equal(normalizeSchwabSymbol("BRK.B"), "BRK.B");
  assert.equal(normalizeSchwabSymbol(""), null);
  assert.equal(normalizeSchwabSymbol("123"), null); // must start with a letter
  assert.equal(normalizeSchwabSymbol("A B"), null);
  assert.equal(normalizeSchwabSymbol(null), null);
});

test("formatPrice renders a Schwab-friendly string, trimming trailing zeros", () => {
  assert.equal(formatPrice(45.97), "45.97");
  assert.equal(formatPrice(10), "10");
  assert.equal(formatPrice(1.5), "1.5");
  assert.equal(formatPrice(0.1234), "0.1234");
  assert.equal(formatPrice(45.970001), "45.97"); // rounded to 4dp then trimmed
});

test("validate accepts a market buy and defaults session to Normal", () => {
  const normalized = validateSchwabEquityOrderInput({
    symbol: "xyz",
    action: "BUY",
    quantity: 15,
    orderType: "Market",
    timeInForce: "Day",
  });
  assert.deepEqual(normalized, {
    symbol: "XYZ",
    action: "BUY",
    quantity: 15,
    orderType: "Market",
    timeInForce: "Day",
    session: "Normal",
    limitPrice: null,
    stopPrice: null,
  });
});

test("validate requires limit/stop prices for the relevant order types", () => {
  expectHttpError(
    () =>
      validateSchwabEquityOrderInput({
        symbol: "XYZ",
        action: "SELL",
        quantity: 2,
        orderType: "Limit",
        timeInForce: "Day",
      }),
    422,
    "schwab_order_limit_price_required",
  );
  expectHttpError(
    () =>
      validateSchwabEquityOrderInput({
        symbol: "XYZ",
        action: "SELL",
        quantity: 2,
        orderType: "Stop",
        timeInForce: "Day",
      }),
    422,
    "schwab_order_stop_price_required",
  );
});

test("validate rejects bad symbol, action, and quantity", () => {
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "1", action: "BUY", quantity: 1, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_symbol_invalid",
  );
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "XYZ", action: "HODL" as never, quantity: 1, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_action_invalid",
  );
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "XYZ", action: "BUY", quantity: 1.5, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_quantity_invalid",
  );
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "XYZ", action: "BUY", quantity: 0, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_quantity_invalid",
  );
});

test("buildSchwabOrderRequest matches the Schwab doc market-BUY example", () => {
  const request = buildSchwabOrderRequest(
    validateSchwabEquityOrderInput({
      symbol: "XYZ",
      action: "BUY",
      quantity: 15,
      orderType: "Market",
      timeInForce: "Day",
    }),
  );
  assert.deepEqual(request, {
    orderType: "MARKET",
    session: "NORMAL",
    duration: "DAY",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      { instruction: "BUY", quantity: 15, instrument: { symbol: "XYZ", assetType: "EQUITY" } },
    ],
  });
});

test("buildSchwabOrderRequest matches the Schwab doc limit-SELL example (price as string)", () => {
  const request = buildSchwabOrderRequest(
    validateSchwabEquityOrderInput({
      symbol: "XYZ",
      action: "SELL",
      quantity: 2,
      orderType: "Limit",
      timeInForce: "Day",
      limitPrice: 45.97,
    }),
  );
  assert.deepEqual(request, {
    orderType: "LIMIT",
    session: "NORMAL",
    duration: "DAY",
    price: "45.97",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      { instruction: "SELL", quantity: 2, instrument: { symbol: "XYZ", assetType: "EQUITY" } },
    ],
  });
});

test("buildSchwabOrderRequest emits both price and stopPrice for a stop-limit", () => {
  const request = buildSchwabOrderRequest(
    validateSchwabEquityOrderInput({
      symbol: "XYZ",
      action: "SELL",
      quantity: 5,
      orderType: "StopLimit",
      timeInForce: "GoodTillCancel",
      session: "Seamless",
      limitPrice: 40.5,
      stopPrice: 41,
    }),
  );
  assert.equal(request.orderType, "STOP_LIMIT");
  assert.equal(request.duration, "GOOD_TILL_CANCEL");
  assert.equal(request.session, "SEAMLESS");
  assert.equal(request.price, "40.5");
  assert.equal(request.stopPrice, "41");
});

function account(overrides: Partial<SchwabEquityOrderAccount>): SchwabEquityOrderAccount {
  return {
    id: "acct-1",
    connectionId: "conn-1",
    accountHash: "HASH",
    displayName: "Schwab Individual",
    baseCurrency: "USD",
    mode: "live",
    accountStatus: "open",
    executionReady: false,
    executionBlockers: [],
    lastSyncedAt: null,
    ...overrides,
  };
}

test("executionReady requires the capability, no blockers, and an open/undefined status", () => {
  assert.equal(
    executionReady({ capabilities: ["execution-ready"], executionBlockers: [], accountStatus: "open" }),
    true,
  );
  assert.equal(
    executionReady({ capabilities: ["execution-ready"], executionBlockers: [], accountStatus: null }),
    true,
  );
  assert.equal(
    executionReady({ capabilities: [], executionBlockers: [], accountStatus: "open" }),
    false,
  );
  assert.equal(
    executionReady({
      capabilities: ["execution-ready"],
      executionBlockers: ["schwab.order_tooling_unverified"],
      accountStatus: "open",
    }),
    false,
  );
});

test("assertExecutionReady throws 409 with the blockers while Schwab is blocked", () => {
  const blocked = account({
    executionReady: false,
    executionBlockers: ["schwab.order_tooling_unverified"],
  });
  assert.throws(
    () => assertExecutionReady(blocked),
    (err: unknown) => {
      const e = err as { statusCode?: number; code?: string; data?: { blockers?: string[] } };
      assert.equal(e.statusCode, 409);
      assert.equal(e.code, "schwab_account_execution_blocked");
      assert.deepEqual(e.data?.blockers, ["schwab.order_tooling_unverified"]);
      return true;
    },
  );
});

test("assertExecutionReady passes through when the account is execution-ready", () => {
  assert.doesNotThrow(() => assertExecutionReady(account({ executionReady: true })));
});

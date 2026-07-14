import assert from "node:assert/strict";
import test from "node:test";

import {
  OPTION_ORDER_ACTIONS,
  resolveOptionActionAvailability,
  resolveOptionOrderIntent,
} from "./optionOrderIntentModel.js";

test("maps every canonical option action without contradictory fields", () => {
  assert.deepEqual(
    OPTION_ORDER_ACTIONS.map((action) =>
      resolveOptionOrderIntent({ action, right: "call" }),
    ),
    [
      {
        action: "buy_to_open",
        abbreviation: "BTO",
        actionLabel: "BUY TO OPEN",
        side: "BUY",
        positionEffect: "open",
        strategyIntent: "long_option",
        intentLabel: "LONG CALL",
        detail: "Open a long call. Maximum loss is the premium and fees paid.",
      },
      {
        action: "buy_to_close",
        abbreviation: "BTC",
        actionLabel: "BUY TO CLOSE",
        side: "BUY",
        positionEffect: "close",
        strategyIntent: undefined,
        intentLabel: "CLOSE SHORT CALL",
        detail: "Close an existing short call; the order cannot open a long position.",
      },
      {
        action: "sell_to_close",
        abbreviation: "STC",
        actionLabel: "SELL TO CLOSE",
        side: "SELL",
        positionEffect: "close",
        strategyIntent: "sell_to_close",
        intentLabel: "CLOSE LONG CALL",
        detail: "Close an existing long call; quantity cannot exceed the held contracts.",
      },
      {
        action: "sell_to_open",
        abbreviation: "STO",
        actionLabel: "SELL TO OPEN",
        side: "SELL",
        positionEffect: "open",
        strategyIntent: "covered_call",
        intentLabel: "COVERED CALL",
        detail: "Open a covered call. Shares and working-order reservations are rechecked before routing.",
      },
    ],
  );
});

test("maps put STO only to cash-secured-put intent", () => {
  assert.deepEqual(
    resolveOptionOrderIntent({ action: "sell_to_open", right: "P" }),
    {
      action: "sell_to_open",
      abbreviation: "STO",
      actionLabel: "SELL TO OPEN",
      side: "SELL",
      positionEffect: "open",
      strategyIntent: "cash_secured_put",
      intentLabel: "CASH-SECURED PUT",
      detail: "Open a cash-secured put. Cash and working-order reservations are rechecked before routing.",
    },
  );
});

test("rejects unknown actions and contract rights", () => {
  assert.equal(
    resolveOptionOrderIntent({ action: "sell", right: "call" }),
    null,
  );
  assert.equal(
    resolveOptionOrderIntent({ action: "sell_to_open", right: "stock" }),
    null,
  );
});

test("IBKR is the only live route with all four actions enabled", () => {
  for (const action of OPTION_ORDER_ACTIONS) {
    assert.deepEqual(
      resolveOptionActionAvailability({
        action,
        executionMode: "real",
        broker: "ibkr",
      }),
      { enabled: true, reason: "" },
    );
  }

  for (const broker of ["snaptrade", "robinhood", "schwab"]) {
    assert.equal(
      resolveOptionActionAvailability({
        action: "buy_to_open",
        executionMode: "real",
        broker,
      }).enabled,
      true,
    );
    assert.match(
      resolveOptionActionAvailability({
        action: "sell_to_close",
        executionMode: "real",
        broker,
      }).reason,
      /account-scoped position and working-order context/i,
    );
  }
});

test("shadow allows long opens and exact-contract long closes only", () => {
  assert.equal(
    resolveOptionActionAvailability({
      action: "buy_to_open",
      executionMode: "shadow",
      broker: "ibkr",
    }).enabled,
    true,
  );
  assert.match(
    resolveOptionActionAvailability({
      action: "sell_to_close",
      executionMode: "shadow",
      broker: "ibkr",
      positionContextReady: false,
      matchingLongQuantity: 2,
      quantity: 1,
    }).reason,
    /still loading/i,
  );
  assert.equal(
    resolveOptionActionAvailability({
      action: "sell_to_close",
      executionMode: "shadow",
      broker: "ibkr",
      positionContextReady: true,
      matchingLongQuantity: 2,
      quantity: 2,
    }).enabled,
    true,
  );
  assert.match(
    resolveOptionActionAvailability({
      action: "sell_to_close",
      executionMode: "shadow",
      broker: "ibkr",
      positionContextReady: true,
      matchingLongQuantity: 1,
      quantity: 2,
    }).reason,
    /only 1 matching long contract/i,
  );
  for (const action of ["buy_to_close", "sell_to_open"]) {
    assert.equal(
      resolveOptionActionAvailability({
        action,
        executionMode: "shadow",
        broker: "ibkr",
      }).enabled,
      false,
    );
  }
});

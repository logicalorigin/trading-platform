import assert from "node:assert/strict";
import test from "node:test";

import { fingerprintIbkrOrderBody } from "./ibkr-order-intent";
import { preparedIbkrOrderInput } from "./platform";
import type {
  IbkrPreparedOrderIntent,
  IbkrPreparedPlaceOrderIntent,
} from "./tax-planning";

const optionContract = {
  ticker: "AAPL260821C00200000",
  underlying: "AAPL",
  expirationDate: "2026-08-21T00:00:00.000Z",
  strike: 200,
  right: "call",
  multiplier: 100,
  sharesPerContract: 100,
  providerContractId: "700001",
  standardDeliverableVerified: true,
};

function optionIntent(
  overrides: Partial<IbkrPreparedPlaceOrderIntent> = {},
): IbkrPreparedOrderIntent {
  const orderBody = {
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
  return {
    version: 1,
    accountId: "U1234567",
    clientOrderId: "option-intent-1",
    orderFingerprint: fingerprintIbkrOrderBody(orderBody),
    orderBody,
    preparedAt: "2026-07-14T00:00:00.000Z",
    whatIf: {},
    optionContract,
    optionAction: "buy_to_open",
    positionEffect: "open",
    strategyIntent: "long_option",
    ...overrides,
  };
}

test("prepared IBKR option intent restores exact BTO semantics", () => {
  const order = preparedIbkrOrderInput(optionIntent());

  assert.equal(order.assetClass, "option");
  assert.equal(order.side, "buy");
  assert.equal(order.type, "limit");
  assert.equal(order.quantity, 2);
  assert.equal(order.optionContract?.providerContractId, "700001");
  assert.equal(
    order.optionContract?.expirationDate.toISOString(),
    "2026-08-21T00:00:00.000Z",
  );
  assert.equal(order.optionAction, "buy_to_open");
  assert.equal(order.positionEffect, "open");
  assert.equal(order.strategyIntent, "long_option");
});

test("prepared IBKR option intent rejects semantic or conid drift", () => {
  assert.throws(
    () =>
      preparedIbkrOrderInput(
        optionIntent({ optionAction: "sell_to_open" }),
      ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "ibkr_order_intent_invalid");
      return true;
    },
  );
  assert.throws(
    () =>
      preparedIbkrOrderInput(
        optionIntent({
          optionContract: { ...optionContract, providerContractId: "700002" },
        }),
      ),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "ibkr_order_intent_invalid");
      return true;
    },
  );
});

test("legacy prepared whole-share equity intent remains valid for held-share sells", () => {
  const orderBody = {
    orders: [
      {
        acctId: "U1234567",
        conid: 265598,
        cOID: "equity-intent-1",
        manualIndicator: true,
        orderType: "MKT",
        outsideRTH: false,
        quantity: 2,
        secType: "265598:STK",
        side: "SELL",
        ticker: "AAPL",
        tif: "DAY",
      },
    ],
  };
  const order = preparedIbkrOrderInput({
    version: 1,
    accountId: "U1234567",
    clientOrderId: "equity-intent-1",
    orderFingerprint: fingerprintIbkrOrderBody(orderBody),
    orderBody,
    preparedAt: "2026-07-14T00:00:00.000Z",
    whatIf: {},
  });

  assert.equal(order.assetClass, "equity");
  assert.equal(order.side, "sell");
  assert.equal(order.type, "market");
  assert.equal(order.quantity, 2);
  assert.equal(order.optionContract, null);
});

test("prepared IBKR equity intent rejects fractional shares", () => {
  const intent = optionIntent();
  const order = intent.orderBody.orders;
  assert.ok(Array.isArray(order));
  const raw = order[0] as Record<string, unknown>;
  const orderBody = {
    orders: [
      {
        ...raw,
        conid: 265598,
        quantity: 2.5,
        secType: "265598:STK",
        side: "SELL",
      },
    ],
  };

  assert.throws(
    () =>
      preparedIbkrOrderInput({
        version: 1,
        accountId: "U1234567",
        clientOrderId: "option-intent-1",
        orderFingerprint: fingerprintIbkrOrderBody(orderBody),
        orderBody,
        preparedAt: "2026-07-14T00:00:00.000Z",
        whatIf: {},
      }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "ibkr_order_intent_invalid");
      return true;
    },
  );
});

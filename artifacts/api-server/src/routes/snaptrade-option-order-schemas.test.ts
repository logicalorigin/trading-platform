import assert from "node:assert/strict";
import test from "node:test";

import { SubmitSnapTradeOptionOrderResponse } from "./snaptrade-option-order-schemas";

test("SnapTrade option submit response preserves reconciliation warnings", () => {
  const parsed = SubmitSnapTradeOptionOrderResponse.parse({
    provider: "snaptrade",
    submittedAt: "2026-07-20T14:00:00.000Z",
    account: {
      id: "account-1",
      connectionId: "connection-1",
      snapTradeAccountId: "snaptrade-account-1",
      displayName: "Brokerage",
      baseCurrency: "USD",
      mode: "live",
      accountStatus: "open",
      executionReady: true,
      executionBlockers: [],
      lastSyncedAt: null,
    },
    order: {
      underlyingSymbol: "AAPL",
      occSymbol: "AAPL  260821C00200000",
      expiration: "2026-08-21",
      strike: 200,
      optionType: "Call",
      action: "BUY_TO_OPEN",
      orderType: "Limit",
      timeInForce: "Day",
      units: 1,
      price: 2.5,
      multiplier: 100,
      sharesPerContract: 100,
      brokerageOrderId: "broker-order-1",
      status: "ACCEPTED",
    },
    reconcileRequired: true,
    reconciliationReason: "tax_preflight_order_submit_record_failed",
  });

  assert.equal(parsed.reconcileRequired, true);
  assert.equal(
    parsed.reconciliationReason,
    "tax_preflight_order_submit_record_failed",
  );
});

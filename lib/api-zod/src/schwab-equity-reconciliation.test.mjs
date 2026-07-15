import assert from "node:assert/strict";
import test from "node:test";

import { SubmitSchwabEquityOrderResponse } from "./generated/api.ts";

const submittedOrder = {
  provider: "schwab",
  submittedAt: "2026-07-07T20:02:00.000Z",
  account: {
    id: "account-fixture",
    connectionId: "connection-fixture",
    accountHash: "hash-fixture",
    displayName: "Brokerage",
    baseCurrency: "USD",
    mode: "live",
    accountStatus: null,
    executionReady: true,
    executionBlockers: [],
    lastSyncedAt: null,
  },
  orderId: "order-fixture",
  status: "submitted",
};

test("Schwab submit responses preserve reconciliation metadata", () => {
  const parsed = SubmitSchwabEquityOrderResponse.parse({
    ...submittedOrder,
    reconcileRequired: true,
    reconciliationReason: "tax_preflight_order_submit_record_failed",
  });

  assert.equal(parsed.reconcileRequired, true);
  assert.equal(
    parsed.reconciliationReason,
    "tax_preflight_order_submit_record_failed",
  );
  assert.equal(
    SubmitSchwabEquityOrderResponse.safeParse(submittedOrder).success,
    true,
  );
});

test("Schwab reconciliation metadata rejects unsupported states", () => {
  for (const [field, value] of [
    ["reconcileRequired", false],
    ["reconciliationReason", "unknown"],
  ]) {
    assert.equal(
      SubmitSchwabEquityOrderResponse.safeParse({
        ...submittedOrder,
        [field]: value,
      }).success,
      false,
      `${field} accepted ${String(value)}`,
    );
  }
});

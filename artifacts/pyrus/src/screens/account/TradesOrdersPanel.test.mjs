import assert from "node:assert/strict";
import test from "node:test";

const {
  accountOrderSideTone,
  accountOrderStatusTone,
  getAccountOrderCancelUnavailableReason,
} = await import("./TradesOrdersPanel.jsx");

test("unknown order fields use neutral presentation", () => {
  assert.equal(accountOrderSideTone("unknown"), "default");
  assert.equal(accountOrderStatusTone("unknown"), "default");
});

test("known live order statuses share the working presentation", () => {
  for (const status of [
    "pending_submit",
    "submitted",
    "accepted",
    "partially_filled",
    "working",
  ]) {
    assert.equal(accountOrderStatusTone(status), "status-working");
  }
  assert.equal(accountOrderStatusTone("filled"), "status-filled");
  assert.equal(accountOrderStatusTone("rejected"), "status-rejected");
});

test("cancel action requires a known cancelable status and provider order id", () => {
  assert.match(
    getAccountOrderCancelUnavailableReason({
      status: "unknown",
      brokerOrderId: "mystery-1",
    }),
    /status/i,
  );
  assert.match(
    getAccountOrderCancelUnavailableReason({
      status: "accepted",
      brokerOrderId: null,
    }),
    /broker order id/i,
  );
  assert.match(
    getAccountOrderCancelUnavailableReason({
      status: "pending_cancel",
      brokerOrderId: "pending-1",
    }),
    /status/i,
  );
  assert.equal(
    getAccountOrderCancelUnavailableReason({
      status: "accepted",
      brokerOrderId: "open-1",
    }),
    null,
  );
  assert.equal(
    getAccountOrderCancelUnavailableReason({
      status: "accepted",
      id: "internal-order-1",
    }),
    null,
  );
});

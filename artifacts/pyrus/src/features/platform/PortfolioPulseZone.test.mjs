import assert from "node:assert/strict";
import test from "node:test";

import { isWorkingOrder } from "./PortfolioPulseZone.jsx";

test("Portfolio pulse classifies every canonical order status", () => {
  for (const status of [
    "pending_submit",
    "pending_cancel",
    "submitted",
    "accepted",
    "partially_filled",
  ]) {
    assert.equal(isWorkingOrder({ status }), true, status);
  }

  for (const status of ["filled", "canceled", "rejected", "expired", ""]) {
    assert.equal(isWorkingOrder({ status }), false, status || "empty");
  }
});

test("Portfolio pulse normalizes harmless status casing and whitespace", () => {
  assert.equal(isWorkingOrder({ status: "  Accepted  " }), true);
  assert.equal(isWorkingOrder({ status: " FILLED " }), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import {
  parseSnapTradeCancelResponse,
  snapTradeMutationFailureRequiresReconciliation,
} from "./snaptrade-order-mutation-journal";

const FAILED_CODE = "snaptrade_mutation_failed";

const upstreamFailure = (status: number): HttpError =>
  new HttpError(502, "SnapTrade mutation failed", {
    code: FAILED_CODE,
    data: { status },
  });

test("SnapTrade mutation classification fails closed only for ambiguous HTTP statuses", () => {
  for (const status of [302, 408, 409, 425, 429, 500, 502, 503, 504, 599]) {
    assert.equal(
      snapTradeMutationFailureRequiresReconciliation({
        error: upstreamFailure(status),
        networkCode: "snaptrade_mutation_network_error",
        failedCode: FAILED_CODE,
      }),
      "upstream_response_unknown",
      `status ${status}`,
    );
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(
      snapTradeMutationFailureRequiresReconciliation({
        error: upstreamFailure(status),
        networkCode: "snaptrade_mutation_network_error",
        failedCode: FAILED_CODE,
      }),
      null,
      `status ${status}`,
    );
  }
  assert.equal(
    snapTradeMutationFailureRequiresReconciliation({
      error: new HttpError(502, "SnapTrade mutation failed", {
        code: FAILED_CODE,
      }),
      networkCode: "snaptrade_mutation_network_error",
      failedCode: FAILED_CODE,
    }),
    "upstream_response_unknown",
  );
});

test("SnapTrade mutation classification treats transport loss as unknown", () => {
  assert.equal(
    snapTradeMutationFailureRequiresReconciliation({
      error: new HttpError(502, "network failed", {
        code: "snaptrade_mutation_network_error",
      }),
      networkCode: "snaptrade_mutation_network_error",
      failedCode: FAILED_CODE,
    }),
    "network_error",
  );
});

test("SnapTrade cancel parser requires the exact returned brokerage order id", () => {
  assert.deepEqual(
    parseSnapTradeCancelResponse(
      {
        brokerage_order_id: "broker-order-1",
        raw_response: { status: "CANCELLED" },
      },
      "broker-order-1",
    ),
    { orderId: "broker-order-1", status: "CANCELLED" },
  );
  assert.deepEqual(
    parseSnapTradeCancelResponse(
      { brokerage_order_id: "broker-order-1", raw_response: {} },
      "broker-order-1",
    ),
    { orderId: "broker-order-1", status: "CANCEL_REQUESTED" },
  );
  for (const payload of [
    { status: "CANCELLED" },
    { brokerage_order_id: "different-order" },
  ]) {
    assert.throws(
      () => parseSnapTradeCancelResponse(payload, "broker-order-1"),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "snaptrade_order_cancel_invalid_response",
    );
  }
});

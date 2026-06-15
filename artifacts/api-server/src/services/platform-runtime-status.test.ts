import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeConnectedBridgeLastError } from "./platform-runtime-status";

test("connected bridge suppresses request-scoped historical ticker-id misses", () => {
  assert.equal(
    sanitizeConnectedBridgeLastError(
      "No historical data query found for ticker id:31656",
      true,
    ),
    null,
  );
});

test("disconnected bridge keeps historical ticker-id misses visible", () => {
  assert.equal(
    sanitizeConnectedBridgeLastError(
      "No historical data query found for ticker id:31656",
      false,
    ),
    "No historical data query found for ticker id:31656",
  );
});

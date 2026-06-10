import assert from "node:assert/strict";
import test from "node:test";

import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

const {
  markShadowAccountDbUnavailable,
  isShadowAccountDbBackoffActive,
  clearShadowAccountDbBackoff,
} = internals;

test("pool-acquire timeouts do not arm the shadow DB-unavailable backoff", () => {
  clearShadowAccountDbBackoff();
  markShadowAccountDbUnavailable(
    new Error("pool timed out while waiting for an open connection"),
  );
  assert.equal(
    isShadowAccountDbBackoffActive(),
    false,
    "pool contention is local saturation, not a DB outage",
  );
});

test("genuine connectivity failures still arm the backoff", () => {
  clearShadowAccountDbBackoff();
  const error = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  markShadowAccountDbUnavailable(error);
  assert.equal(isShadowAccountDbBackoffActive(), true);
  clearShadowAccountDbBackoff();
  assert.equal(isShadowAccountDbBackoffActive(), false);
});

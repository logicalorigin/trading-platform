import assert from "node:assert/strict";
import test from "node:test";

import { logger } from "../lib/logger";
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

test("pool-contention diagnostics do not retain credential-bearing errors", () => {
  const secret = "pool-backoff-secret";
  const originalDebug = logger.debug;
  let logged: unknown;
  (logger as unknown as { debug: typeof logger.debug }).debug = ((
    fields: unknown,
  ) => {
    logged = fields;
  }) as typeof logger.debug;
  try {
    markShadowAccountDbUnavailable(
      new Error(
        `pool timed out while waiting for an open connection at postgresql://user:${secret}@db.example.test/pyrus`,
      ),
    );
  } finally {
    (logger as unknown as { debug: typeof logger.debug }).debug = originalDebug;
  }

  const serialized = JSON.stringify(logged, (_key, value) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value,
  );
  assert.doesNotMatch(serialized, new RegExp(secret, "u"));
  assert.doesNotMatch(serialized, /postgresql:\/\//u);
  assert.equal(
    (logged as { err?: unknown } | undefined)?.err,
    undefined,
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

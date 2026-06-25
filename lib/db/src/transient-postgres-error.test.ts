import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPoolContentionError,
  isStatementTimeoutError,
  isTransientPostgresError,
} from "./transient-postgres-error";

test("classifies pg/sqlx pool acquire timeouts as transient", () => {
  assert.equal(
    isTransientPostgresError(
      new Error("pool timed out while waiting for an open connection"),
    ),
    true,
  );
});

test("classifies pool-acquire timeouts as pool contention", () => {
  assert.equal(
    isPoolContentionError(
      new Error("pool timed out while waiting for an open connection"),
    ),
    true,
  );
  assert.equal(
    isPoolContentionError(
      new Error("timeout exceeded when trying to connect"),
    ),
    true,
  );
});

test("pool contention follows nested causes", () => {
  const error = new Error("read failed");
  (error as { cause?: unknown }).cause = new Error(
    "pool timed out while waiting for an open connection",
  );
  assert.equal(isPoolContentionError(error), true);
});

test("genuine connectivity failures are not pool contention", () => {
  for (const message of [
    "could not connect to server",
    "connection terminated unexpectedly",
    "terminating connection due to administrator command",
  ]) {
    assert.equal(isPoolContentionError(new Error(message)), false);
  }
  const codeError = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  assert.equal(isPoolContentionError(codeError), false);
  assert.equal(isTransientPostgresError(codeError), true);
});

test("classifies statement_timeout by message and SQLSTATE 57014", () => {
  assert.equal(
    isStatementTimeoutError(
      new Error("canceling statement due to statement timeout"),
    ),
    true,
  );
  const codeError = Object.assign(new Error("canceling statement"), {
    code: "57014",
  });
  assert.equal(isStatementTimeoutError(codeError), true);
});

test("statement_timeout follows nested causes", () => {
  const error = new Error("read failed");
  (error as { cause?: unknown }).cause = new Error(
    "canceling statement due to statement timeout",
  );
  assert.equal(isStatementTimeoutError(error), true);
});

test("statement_timeout is NOT folded into the generic transient classifier", () => {
  // Kept separate so financial read/write paths keep treating a timeout as a
  // hard error; only callers that explicitly opt in (signal-monitor reads)
  // degrade gracefully on it.
  const timeout = new Error("canceling statement due to statement timeout");
  assert.equal(isTransientPostgresError(timeout), false);
  assert.equal(isPoolContentionError(timeout), false);
});

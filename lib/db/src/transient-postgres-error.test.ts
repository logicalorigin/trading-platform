import assert from "node:assert/strict";
import test from "node:test";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
  summarizeTransientPostgresError,
} from "./transient-postgres-error";

test("transient Postgres classifier recognizes unexpected connection termination", () => {
  assert.equal(
    isTransientPostgresError(new Error("Connection terminated unexpectedly")),
    true,
  );
});

test("transient Postgres classifier recognizes wrapped timeout errors", () => {
  const error = new Error("Failed query: select 1");
  Object.assign(error, {
    cause: new Error("Connection terminated due to connection timeout"),
  });

  assert.equal(isTransientPostgresError(error), true);
});

test("transient Postgres classifier recognizes network and Postgres restart codes", () => {
  assert.equal(
    isTransientPostgresError(
      Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    ),
    true,
  );
  assert.equal(
    isTransientPostgresError(
      Object.assign(new Error("restart"), { code: "57P01" }),
    ),
    true,
  );
});

test("transient Postgres classifier ignores unrelated application errors", () => {
  assert.equal(isTransientPostgresError(new Error("Gateway unavailable")), false);
});

test("transient Postgres summary preserves nested causes without leaking unknown fields", () => {
  const cause = Object.assign(new Error("Connection terminated unexpectedly"), {
    code: "ECONNRESET",
  });
  const error = Object.assign(new Error("Failed query"), { cause });

  assert.deepEqual(summarizeTransientPostgresError(error), {
    name: "Error",
    message: "Failed query",
    code: null,
    cause: {
      name: "Error",
      message: "Connection terminated unexpectedly",
      code: "ECONNRESET",
    },
  });
});

test("transient Postgres backoff logs once per cooldown window", () => {
  const warnings: string[] = [];
  const backoff = createTransientPostgresBackoff({
    backoffMs: 1_000,
    warningCooldownMs: 1_000,
  });
  const logger = {
    warn: (_payload: unknown, message: string) => {
      warnings.push(message);
    },
  };

  backoff.markFailure({
    error: new Error("timeout exceeded when trying to connect"),
    logger,
    message: "database unavailable",
    nowMs: 10_000,
  });
  backoff.markFailure({
    error: new Error("timeout exceeded when trying to connect"),
    logger,
    message: "database unavailable",
    nowMs: 10_500,
  });
  backoff.markFailure({
    error: new Error("timeout exceeded when trying to connect"),
    logger,
    message: "database unavailable",
    nowMs: 11_001,
  });

  assert.deepEqual(warnings, ["database unavailable", "database unavailable"]);
  assert.equal(backoff.isActive(11_500), true);
  assert.equal(backoff.isActive(12_002), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPoolContentionError,
  isStatementTimeoutError,
  isTransientPostgresError,
  summarizeTransientPostgresError,
} from "./transient-postgres-error";

test("classifies pg/sqlx pool acquire timeouts as transient", () => {
  assert.equal(
    isTransientPostgresError(
      new Error("pool timed out while waiting for an open connection"),
    ),
    true,
  );
});

test("classifies server connection exhaustion as transient", () => {
  const error = Object.assign(new Error("sorry, too many clients already"), {
    code: "53300",
  });
  assert.equal(isTransientPostgresError(error), true);
  assert.equal(isPoolContentionError(error), false);
});

test("classifies a broken database socket as transient", () => {
  const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

  assert.equal(isTransientPostgresError(error), true);
  assert.equal(
    summarizeTransientPostgresError(error).message,
    "Database connection failed",
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
    isPoolContentionError(new Error("timeout exceeded when trying to connect")),
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

test("database error summaries redact expanded SQL and bound parameters", () => {
  const cause = Object.assign(
    new Error("canceling statement due to statement timeout"),
    { code: "57014" },
  );
  const error = new Error(
    `Failed query: select * from signal_monitor_events where event_key in (${"$1,".repeat(4_000)}$1)\nparams: secret-event-key`,
    { cause },
  );

  const summary = summarizeTransientPostgresError(error);
  assert.equal(summary.message, "Database query failed");
  assert.doesNotMatch(JSON.stringify(summary), /secret-event-key/);
  assert.equal(summary.cause?.message, "Database statement timed out");
  assert.equal(summary.cause?.code, "57014");

  const oversized = summarizeTransientPostgresError(
    new Error("x".repeat(4_000)),
  );
  assert.equal(oversized.message, "Database operation failed");
});

test("database error summaries reject credential-shaped messages", () => {
  const secret = "postgres-error-summary-secret";
  const credentialUrl = `postgres://alice:${secret}@fallback.invalid/pyrus`;

  for (const message of [
    `connect failed for ${credentialUrl}`,
    `connect failed with password=${secret}`,
    `connect failed with dbPassword=${secret}`,
    `connect failed with clientSecret=${secret}`,
    `connect failed with accessToken=${secret}`,
    `database failed {"password":"${secret}"}`,
    `{"accessToken":"${secret}"}`,
    `payload="{\\"password\\":\\"${secret}\\"}"`,
    `connect failed :${secret}@db.internal`,
    `connect failed with API key: ${secret}`,
    `connect failed --password ${secret}`,
    `AWS_SECRET_ACCESS_KEY=${secret}`,
    `Key (access_token)=(${secret}) already exists`,
    `Authorization Bearer ${secret}`,
    `Bearer ${secret}`,
    `connect failed /password: ${secret}`,
    `connect failed (alice:${secret}@fallback.invalid)`,
    `connect failed alice:part/${secret}@fallback.invalid`,
    `connect failed alice:part ${secret}@fallback.invalid`,
    `connect failed alice: ${secret}@/var/run/postgresql`,
    `alice:${secret.repeat(300)}@fallback.invalid`,
    encodeURIComponent(
      encodeURIComponent(`connect failed for ${credentialUrl}`),
    ),
    `bad% ${encodeURIComponent(encodeURIComponent(credentialUrl))}`,
  ]) {
    const summary = summarizeTransientPostgresError(new Error(message));

    assert.equal(summary.message, "Database operation failed");
    assert.equal(JSON.stringify(summary).includes(secret), false);
  }

  const unsafeMetadata = Object.assign(new Error("safe message"), {
    name: credentialUrl,
    code: `password=${secret}`,
  });
  const unsafeSummary = summarizeTransientPostgresError(unsafeMetadata);
  assert.equal(unsafeSummary.name, null);
  assert.equal(unsafeSummary.code, null);
  assert.equal(JSON.stringify(unsafeSummary).includes(secret), false);

  const schemaShapedSecretMetadata = Object.assign(new Error("safe message"), {
    name: "unit05Secret",
    code: "UNIT05_SECRET",
  });
  const schemaShapedSecretSummary = summarizeTransientPostgresError(
    schemaShapedSecretMetadata,
  );
  assert.equal(schemaShapedSecretSummary.name, null);
  assert.equal(schemaShapedSecretSummary.code, null);

  for (const code of ["TOKEN", "23ABC", "P0KEY", "57LOL"]) {
    const unsafeCode = summarizeTransientPostgresError(
      Object.assign(new Error("safe message"), {
        name: "DatabaseError",
        code,
      }),
    );
    assert.equal(unsafeCode.code, null);
  }

  for (const code of ["57P01", "23505", "ECONNREFUSED", "EPIPE"]) {
    const safeSummary = summarizeTransientPostgresError(
      Object.assign(new Error("safe message"), {
        name: "DatabaseError",
        code,
      }),
    );
    assert.equal(safeSummary.name, "DatabaseError");
    assert.equal(safeSummary.code, code);
  }
});

test("database error classifiers ignore stacks and bound message scans", () => {
  const stackOnly = new Error("safe message");
  stackOnly.stack = `${"x".repeat(10_000)} pool timed out while waiting for an open connection`;
  assert.equal(isTransientPostgresError(stackOnly), false);
  assert.equal(isPoolContentionError(stackOnly), false);

  const oversizedMessage = new Error(
    `${"x".repeat(10_000)} canceling statement due to statement timeout`,
  );
  assert.equal(isStatementTimeoutError(oversizedMessage), false);
});

test("database error summaries bound Drizzle-prefix inspection", () => {
  const summary = summarizeTransientPostgresError(
    new Error(`${" ".repeat(4_097)}Failed query: select 1`),
  );

  assert.equal(summary.message, "Database operation failed");
});

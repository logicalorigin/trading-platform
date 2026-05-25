import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveApiRequestLogLevel } from "./request-logging";

test("API request logging silences health and fast successful requests", () => {
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/healthz",
      statusCode: 200,
      responseTimeMs: 2_000,
    }),
    "silent",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/healthz",
      statusCode: 200,
      responseTimeMs: 5,
    }),
    "silent",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/accounts/combined/summary",
      statusCode: 200,
      responseTimeMs: 40,
    }),
    "silent",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/accounts/combined/summary",
      statusCode: 304,
      responseTimeMs: 40,
    }),
    "silent",
  );
});

test("API request logging keeps slow requests, client errors, and server errors visible", () => {
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/accounts/combined/summary",
      statusCode: 200,
      responseTimeMs: 1_000,
    }),
    "warn",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/accounts/missing",
      statusCode: 404,
      responseTimeMs: 20,
    }),
    "warn",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/accounts/combined/summary",
      statusCode: 500,
      responseTimeMs: 20,
    }),
    "error",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/accounts/combined/summary",
      statusCode: 200,
      responseTimeMs: 20,
      err: new Error("boom"),
    }),
    "error",
  );
});

test("API request logging silences expected stream closes except 5xx failures", () => {
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/streams/broker",
      statusCode: 200,
      responseTimeMs: 40_000,
    }),
    "silent",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/diagnostics/stream",
      statusCode: 499,
      responseTimeMs: 40_000,
      err: new Error("premature close"),
    }),
    "silent",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/settings/ibkr-line-usage/stream",
      statusCode: 200,
      responseTimeMs: 40_000,
    }),
    "silent",
  );
  assert.equal(
    resolveApiRequestLogLevel({
      url: "/api/streams/broker",
      statusCode: 500,
      responseTimeMs: 40_000,
    }),
    "error",
  );
});

test("dev pretty logging is explicit opt-in", () => {
  const source = readFileSync(new URL("./logger.ts", import.meta.url), "utf8");

  assert.match(source, /PYRUS_LOG_PRETTY/);
  assert.match(source, /PYRUS_LOG_PRETTY/);
  assert.match(source, /isProduction \|\| !prettyLoggingEnabled/);
  assert.match(source, /target: "pino-pretty"/);
});

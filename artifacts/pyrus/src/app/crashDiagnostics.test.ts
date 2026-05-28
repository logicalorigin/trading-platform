import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RootCrashDiagnosticsFallback,
  buildRootCrashDiagnosticBundle,
  redactCrashDiagnosticValue,
} from "./crashDiagnostics";

test("crash diagnostic redaction removes sensitive keys and account-like values", () => {
  const redacted = redactCrashDiagnosticValue({
    accountId: "U12345678",
    message: "Failure for U12345678",
    url: "https://user:pass@example.test/path?token=secret-value&ok=1",
    nested: {
      authorization: "Bearer secret",
      safe: "SPY",
    },
  }) as Record<string, unknown>;

  assert.equal(redacted.accountId, "[redacted]");
  assert.equal(redacted.message, "Failure for U***");
  assert.equal(
    redacted.url,
    "https://[redacted]@example.test/path?token=[redacted]&ok=1",
  );
  assert.deepEqual(redacted.nested, {
    authorization: "[redacted]",
    safe: "SPY",
  });
});

test("root crash bundle includes runtime and normalized error metadata", () => {
  const bundle = buildRootCrashDiagnosticBundle({
    label: "PYRUS app shell",
    error: new TypeError("Render failed"),
    componentStack: "\n    at Crash",
  });

  assert.equal(bundle.kind, "pyrus-root-crash");
  assert.equal(bundle.label, "PYRUS app shell");
  assert.equal(bundle.error.name, "TypeError");
  assert.equal(bundle.error.message, "Render failed");
  assert.equal(bundle.componentStack, "\n    at Crash");
  assert.equal(bundle.runtime.packageName, "@workspace/pyrus");
});

test("root crash fallback always renders the diagnostic screen", () => {
  const markup = renderToStaticMarkup(
    createElement(RootCrashDiagnosticsFallback, {
      error: new TypeError("Render failed"),
      label: "PYRUS app shell",
      normalizedError: new TypeError("Render failed"),
      componentStack: "\n    at Crash",
      resetErrorBoundary() {},
    }),
  );

  assert.match(markup, /data-testid="root-crash-diagnostics"/);
  assert.match(markup, /PYRUS ROOT CRASH/);
  assert.match(markup, /src="\/brand\/pyrus-mark-dark\.svg"/);
  assert.match(markup, /src="\/brand\/pyrus-wordmark-tight\.png"/);
  assert.match(markup, /Open Diagnostics/);
  assert.match(markup, /Redacted Bundle/);
  assert.doesNotMatch(markup, /root-crash-minimal/);
  assert.doesNotMatch(markup, /only shown in development/);
});

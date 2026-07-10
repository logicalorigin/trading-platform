import assert from "node:assert/strict";
import test from "node:test";

import {
  postClientDiagnosticEvent,
  redactCrashDiagnosticValue,
} from "./crashDiagnostics.tsx";

test("crash diagnostic strings redact common credential forms", () => {
  const redacted = redactCrashDiagnosticValue(
    [
      "Authorization: Bearer bearer-secret",
      "Cookie: pyrus_session=cookie-secret; theme=dark",
      '{"accessToken":"json-secret","apiKey":"key-secret"}',
      "request failed with Bearer standalone-secret",
      "eyJheader1234567890.eyJpayload1234567890.signature1234567890",
      "https://user:password@service.test/path?token=query-secret&ok=1",
      "Account DU12345",
      "account du67890",
    ].join("\n"),
  );

  assert.equal(typeof redacted, "string");
  for (const secret of [
    "bearer-secret",
    "cookie-secret",
    "json-secret",
    "key-secret",
    "standalone-secret",
    "eyJpayload1234567890",
    "password",
    "query-secret",
    "DU12345",
    "du67890",
  ]) {
    assert.doesNotMatch(redacted, new RegExp(secret));
  }
  assert.match(redacted, /Authorization: \[redacted\]/i);
  assert.match(redacted, /Cookie: \[redacted\]/i);
  assert.match(redacted, /ok=1/);
});

test("client diagnostic events are redacted before upload", () => {
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  let request = null;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (url, options) => {
      request = { options, url };
      return Promise.resolve({ ok: true });
    },
  });

  try {
    postClientDiagnosticEvent({
      category: "react-error-boundary",
      severity: "warning",
      code: "Account-DU12345",
      message: "Authorization: Bearer message-secret for DU12345",
      raw: {
        accountId: "DU12345",
        detail: "Bearer nested-secret",
        token: "raw-token",
      },
    });
  } finally {
    if (originalFetch) {
      Object.defineProperty(globalThis, "fetch", originalFetch);
    } else {
      delete globalThis.fetch;
    }
  }

  assert.equal(request?.url, "/api/diagnostics/client-events");
  const payload = JSON.parse(request?.options?.body);
  const serialized = JSON.stringify(payload);
  for (const secret of [
    "DU12345",
    "message-secret",
    "nested-secret",
    "raw-token",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.equal(payload.raw.accountId, "[redacted]");
  assert.equal(payload.raw.token, "[redacted]");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFailurePoint,
  redactDiagnosticText,
} from "./failurePointModel.js";

test("failure-point diagnostics redact credentials and broker account IDs", () => {
  const redacted = redactDiagnosticText(
    [
      "Authorization: Bearer bearer-secret for DU12345",
      "Proxy-Authorization: Basic proxy-secret",
      "Cookie: pyrus_session=cookie-secret; theme=dark",
      '{"accessToken":"json-secret","apiKey":"key-secret"}',
      "request failed with Bearer standalone-secret",
      "eyJheader1234567890.eyJpayload1234567890.signature1234567890",
      "https://user:password@service.test/path?token=query-secret&ok=1",
      "Accounts U12345, DU67890, and F24680",
    ].join("\n"),
  );

  for (const secret of [
    "bearer-secret",
    "proxy-secret",
    "cookie-secret",
    "json-secret",
    "key-secret",
    "standalone-secret",
    "eyJpayload1234567890",
    "password",
    "query-secret",
    "U12345",
    "DU67890",
    "F24680",
  ]) {
    assert.doesNotMatch(redacted, new RegExp(secret, "i"));
  }
  assert.match(redacted, /Authorization: \[redacted\]/i);
  assert.match(redacted, /Cookie: \[redacted\]/i);
});

test("failure-point reasons redact credential keys before humanizing labels", () => {
  const failurePoint = buildFailurePoint({
    reason: "api_key=reason-secret",
  });

  assert.doesNotMatch(failurePoint.reason, /reason[ -]secret/i);
  assert.match(failurePoint.reason, /api key=\[redacted\]/i);
});

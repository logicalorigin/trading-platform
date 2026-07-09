import assert from "node:assert/strict";
import test from "node:test";

import { redactCrashDiagnosticValue } from "./crashDiagnostics.tsx";

test("crash diagnostic strings redact common credential forms", () => {
  const redacted = redactCrashDiagnosticValue(
    [
      "Authorization: Bearer bearer-secret",
      "Cookie: pyrus_session=cookie-secret; theme=dark",
      '{"accessToken":"json-secret","apiKey":"key-secret"}',
      "request failed with Bearer standalone-secret",
      "eyJheader1234567890.eyJpayload1234567890.signature1234567890",
      "https://user:password@service.test/path?token=query-secret&ok=1",
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
  ]) {
    assert.doesNotMatch(redacted, new RegExp(secret));
  }
  assert.match(redacted, /Authorization: \[redacted\]/i);
  assert.match(redacted, /Cookie: \[redacted\]/i);
  assert.match(redacted, /ok=1/);
});

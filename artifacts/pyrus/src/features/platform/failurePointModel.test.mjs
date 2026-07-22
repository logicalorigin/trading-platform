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
      '{"accessToken":"json-secret","apiKey":"key-secret","password":"json-password"}',
      "request failed with Bearer standalone-secret",
      "proxy failed with Basic basic-secret",
      "eyJheader1234567890.eyJpayload1234567890.signature1234567890",
      "https://user:url-password@service.test/path?token=query-secret&ok=1",
      "postgresql://db-user:db-secret@database.test/pyrus?sslmode=require",
      "redis://:redis-secret@cache.test:6379/0",
      "wss://stream-user:stream-secret@broker.test/feed?token=ws-secret",
      "clientSecret=camel-secret",
      "client_secret=snake-secret",
      "live_session_token=session-secret",
      "dbPassword=db-password-secret",
      "AWS_SECRET_ACCESS_KEY=aws-secret",
      '{"clientSecret":"json-client-secret","live_session_token":"json-session-secret"}',
      "Accounts U12345, DU67890, and F24680",
    ].join("\n"),
  );

  for (const secret of [
    "bearer-secret",
    "proxy-secret",
    "cookie-secret",
    "json-secret",
    "key-secret",
    "json-password",
    "standalone-secret",
    "basic-secret",
    "eyJpayload1234567890",
    "url-password",
    "query-secret",
    "db-secret",
    "redis-secret",
    "stream-secret",
    "ws-secret",
    "camel-secret",
    "snake-secret",
    "session-secret",
    "db-password-secret",
    "aws-secret",
    "json-client-secret",
    "json-session-secret",
    "U12345",
    "DU67890",
    "F24680",
  ]) {
    assert.doesNotMatch(redacted, new RegExp(secret, "i"));
  }
  assert.match(redacted, /Authorization: \[redacted\]/i);
  assert.match(redacted, /Proxy-Authorization: \[redacted\]/i);
  assert.match(redacted, /Cookie: \[redacted\]/i);
  assert.match(redacted, /"accessToken":"\[redacted\]"/);
  assert.match(redacted, /"apiKey":"\[redacted\]"/);
  assert.match(redacted, /"password":"\[redacted\]"/);
  assert.match(redacted, /request failed with Bearer \[redacted\]/i);
  assert.match(redacted, /proxy failed with Basic \[redacted\]/i);
  assert.match(redacted, /\[token redacted\]/i);
  assert.match(redacted, /Accounts U1\.\.\.45, DU6\.\.\.90, and F2\.\.\.80/);
});

test("failure-point reasons redact credential keys before humanizing labels", () => {
  const failurePoint = buildFailurePoint({
    reason: "api_key=reason-secret",
  });

  assert.doesNotMatch(failurePoint.reason, /reason[ -]secret/i);
  assert.match(failurePoint.reason, /api key=\[redacted\]/i);
});

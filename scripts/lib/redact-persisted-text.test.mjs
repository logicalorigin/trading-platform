import assert from "node:assert/strict";
import test from "node:test";

import {
  redactPersistedText,
  redactPersistedValue,
} from "./redact-persisted-text.mjs";

test("redacts common credentials from persisted text", () => {
  const source = [
    "Authorization: Bearer test-token-123",
    'Authorization: Bearer "fixture quoted bearer value"',
    'authorization="Basic dGVzdDpmaXh0dXJl"',
    'authorization="ApiKey fixture-auth-token"',
    "jwt=eyJmaXh0dXJl.eyJvbmx5.dGVzdA",
    "DATABASE_URL=postgres://user:pass@example.invalid/db",
    "CACHE_URL=redis://user:pass@example.invalid/0",
    "WEBHOOK_URL=https://user:pass@example.invalid/hook",
    "SINGLE_USER_URL=https://fixture-userinfo@example.invalid/hook",
    "Cookie: session=fixture-cookie; preference=fixture-preference",
    'password="fixture password"',
    "client_secret=fixture-secret",
    "access-token=fixture-access-token",
    "code=fixture-code&api_key=fixture-api-key",
    'command --token fixture-cli-token --password "fixture cli password"',
  ].join("\n");

  const redacted = redactPersistedText(source);

  for (const secret of [
    "test-token-123",
    "fixture quoted bearer value",
    "dGVzdDpmaXh0dXJl",
    "fixture-auth-token",
    "eyJmaXh0dXJl.eyJvbmx5.dGVzdA",
    "user:pass",
    "fixture-userinfo",
    "fixture-cookie",
    "fixture-preference",
    "fixture password",
    "fixture-secret",
    "fixture-access-token",
    "fixture-code",
    "fixture-api-key",
    "fixture-cli-token",
    "fixture cli password",
  ]) {
    assert.ok(!redacted.includes(secret), `retained fixture secret: ${secret}`);
  }
  assert.match(redacted, /Authorization: <redacted>/);
  assert.match(redacted, /DATABASE_URL=<redacted>/);
});

test("preserves ordinary diagnostic text", () => {
  const source = String.raw`token count 42; exit code 0; HTTP code: 500; code=404; code=EADDRINUSE; error_code=EADDRINUSE; --code coverage; secret rotation planned; Bearer authentication; Basic authentication; JWT authentication; https://example.invalid/public; nested={\"code\":\"EADDRINUSE\"}`;
  assert.equal(redactPersistedText(source), source);
});

test("normalizes controls before matching credential keys", () => {
  for (const [input, marker] of [
    ["to\u001b[31mken=fixture-ansi-split-secret", "fixture-ansi-split-secret"],
    [
      "to\u001b[38:5:1mken=fixture-colon-ansi-split-secret",
      "fixture-colon-ansi-split-secret",
    ],
    ["to\u202eken=fixture-bidi-split-secret", "fixture-bidi-split-secret"],
    [
      "to\u200bken=fixture-zero-width-split-secret",
      "fixture-zero-width-split-secret",
    ],
    ["to\u0000ken=fixture-nul-split-secret", "fixture-nul-split-secret"],
    ["to\u0007ken=fixture-bell-split-secret", "fixture-bell-split-secret"],
    ["to\u007fken=fixture-del-split-secret", "fixture-del-split-secret"],
  ]) {
    const redacted = redactPersistedText(input);
    assert.ok(!redacted.includes(marker), `retained fixture marker: ${marker}`);
    assert.equal(redacted, "token=<redacted>");
  }
});

test("redacts quoted authorization codes without losing diagnostic codes", () => {
  for (const [input, marker] of [
    [
      'code="fixture quoted authorization code"',
      "fixture quoted authorization code",
    ],
    ['code="fixture \\"inner\\" authorization code"', "inner"],
    [
      String.raw`{\"code\":\"fixture \\\"inner\\\" authorization code\"}`,
      "inner",
    ],
    ['code="123456"', "123456"],
    ['code="exampleOauthSecret"', "exampleOauthSecret"],
    ['code="evil_oauth_code"', "evil_oauth_code"],
    ['code="error"', "error"],
    ['code="eaddrinuse"', "eaddrinuse"],
    ['code="ESECRET"', "ESECRET"],
    ['code="HTTP/123456"', "HTTP/123456"],
    ['code="HTTP/1.1.1"', "HTTP/1.1.1"],
    ['code="fixture unterminated authorization code', "unterminated"],
  ]) {
    const redacted = redactPersistedText(input);
    assert.ok(!redacted.includes(marker), `retained fixture marker: ${marker}`);
    assert.match(redacted, /<redacted>/u);
  }
  assert.equal(redactPersistedText('code="404"'), 'code="404"');
  assert.equal(redactPersistedText('code="http/1.1"'), 'code="http/1.1"');
  assert.equal(redactPersistedText('code="ENOENT"'), 'code="ENOENT"');
  assert.equal(
    redactPersistedText(String.raw`{\"code\":\"EADDRINUSE\"}`),
    String.raw`{\"code\":\"EADDRINUSE\"}`,
  );
});

test("redacts unterminated quoted credentials through the end of the line", () => {
  for (const [input, marker] of [
    [
      'Authorization: Bearer "fixture unterminated bearer value',
      "fixture unterminated bearer value",
    ],
    ['password="fixture unterminated password value', "password value"],
    ['--token "fixture unterminated cli tail', "cli tail"],
    ['Authorization: Basic "fixture unterminated basic tail', "basic tail"],
    [
      String.raw`nested={\"token\":\"fixture unterminated escaped tail}`,
      "escaped tail",
    ],
    [
      String.raw`nested={\\\"code\\\":\\\"fixture double escaped tail}`,
      "double escaped tail",
    ],
    [
      String.raw`nested={\"token\":\"fixture \\\"inner\\\" unterminated escaped tail}`,
      "unterminated escaped tail",
    ],
    [
      String.raw`nested={\"code\":\"fixture \\\"inner\\\" unterminated code tail}`,
      "unterminated code tail",
    ],
    [
      String.raw`nested={\\\"code\\\":\\\"fixture \\\\\\\"inner\\\\\\\" unterminated double tail}`,
      "unterminated double tail",
    ],
    [
      String.raw`token="fixture \"inner\" unterminated token tail`,
      "unterminated token tail",
    ],
    [
      String.raw`code="fixture \"inner\" unterminated raw code tail`,
      "unterminated raw code tail",
    ],
    [
      String.raw`--token "fixture \"inner\" unterminated cli escaped tail`,
      "unterminated cli escaped tail",
    ],
    [
      String.raw`Cookie: "fixture \"inner\" unterminated cookie tail`,
      "unterminated cookie tail",
    ],
    [
      String.raw`message Bearer "fixture \"inner\" unterminated scheme tail`,
      "unterminated scheme tail",
    ],
  ]) {
    const redacted = redactPersistedText(input);
    assert.ok(!redacted.includes(marker), `retained fixture marker: ${marker}`);
    assert.match(redacted, /<redacted>/u);
  }
});

test("redacts complete quoted authorization values as one credential", () => {
  for (const [input, marker] of [
    [
      'authorization="ApiKey fixture quoted authorization tail"',
      "authorization tail",
    ],
    [
      "Authorization: ApiKey 'fixture colon authorization tail'",
      "colon authorization tail",
    ],
    [
      "Proxy-Authorization: Custom fixture proxy authorization tail",
      "proxy authorization tail",
    ],
    [
      String.raw`Authorization: Bearer \"fixture escaped bearer tail\"`,
      "escaped bearer tail",
    ],
  ]) {
    const redacted = redactPersistedText(input);
    assert.ok(!redacted.includes(marker), `retained fixture marker: ${marker}`);
    assert.match(redacted, /<redacted>/u);
  }
});

test("redacts escaped, multiline, private-key, signed-request, and provider credentials", () => {
  const source = String.raw`nested={\"token\":\"fixture-nested-value\",\"authorization\":\"ApiKey fixture-nested-authorization\",\"code\":\"fixture-nested-code\"}
api_key: |
  fixture-yaml-one

  fixture-yaml-two
private_key: >-
  fixture-private-field
-----BEGIN OPENSSH PRIVATE KEY-----
fixture-pem-body
-----END OPENSSH PRIVATE KEY-----
-----BEGIN PGP PRIVATE KEY BLOCK-----
fixture-pgp-body
-----END PGP PRIVATE KEY BLOCK-----
https://bucket.example.invalid/object?X-Amz-Credential=fixture-credential&X-Amz-Signature=fixture-signature&X-Amz-Security-Token=fixture-session
Authorization: AWS4-HMAC-SHA256 Credential=fixture-auth, SignedHeaders=host, Signature=fixture-auth-signature
Authorization: Digest username="fixture-user", response="fixture-digest"
AWS4-HMAC-SHA256 Credential=fixture-standalone, Signature=fixture-standalone-signature
Digest username="fixture-standalone-user", response="fixture-standalone-response"
ghp_123456789012345678901234567890123456
github_pat_12345678901234567890fixture
glpat-12345678901234567890
xoxb-1234567890-fixturemarker
sk-proj-123456789012345678901234567890
sk_live_1234567890123456
AKIA1234567890ABCDEF`;

  const redacted = redactPersistedText(source);
  for (const marker of [
    "fixture-nested-value",
    "fixture-nested-authorization",
    "fixture-nested-code",
    "fixture-yaml-one",
    "fixture-yaml-two",
    "fixture-private-field",
    "fixture-pem-body",
    "fixture-pgp-body",
    "fixture-credential",
    "fixture-signature",
    "fixture-session",
    "fixture-auth-signature",
    "fixture-digest",
    "fixture-standalone-signature",
    "fixture-standalone-response",
    "ghp_123456789012345678901234567890123456",
    "github_pat_12345678901234567890fixture",
    "glpat-12345678901234567890",
    "xoxb-1234567890-fixturemarker",
    "sk-proj-123456789012345678901234567890",
    "sk_live_1234567890123456",
    "AKIA1234567890ABCDEF",
  ]) {
    assert.ok(!redacted.includes(marker), `retained fixture marker: ${marker}`);
  }
});

test("redacts nested report values without changing non-string types", () => {
  const value = {
    incident: {
      evidence: [
        "token=fixture-deep-token",
        { lastEvent: "password=fixture-deep-password" },
      ],
      count: 3,
      available: false,
    },
  };
  const redacted = redactPersistedValue(value);
  assert.equal(redacted.incident.count, 3);
  assert.equal(redacted.incident.available, false);
  assert.doesNotMatch(
    JSON.stringify(redacted),
    /fixture-deep-token|fixture-deep-password/,
  );
});

test("removes terminal and bidirectional controls from persisted text", () => {
  const redacted = redactPersistedText(
    "plain\u001b[31m forged\u001b[0m\u009b2J\rreturn \u061c\u200e\u200f\u202e spoof\u2066 value\u2028next",
  );
  assert.doesNotMatch(
    redacted,
    /[\u0000-\u0008\u000b-\u000d\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u,
  );
  assert.doesNotMatch(redacted, /\[(?:31|0)m/u);
  assert.match(
    redacted,
    /plain[\s\S]*forged[\s\S]*spoof[\s\S]*value[\s\S]*next/u,
  );
});

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  buildAuthorizationHeader,
  buildBaseString,
  generateNonce,
  generateTimestamp,
  hmacSha256Sign,
  quotePlus,
  rsaSha256Sign,
  signHmacRequest,
  signRsaRequest,
} from "./oauth-signer";

test("quotePlus matches Python urllib.parse.quote_plus semantics", () => {
  assert.equal(quotePlus("a b"), "a+b");
  assert.equal(quotePlus("a+b"), "a%2Bb");
  assert.equal(quotePlus("a&b=c"), "a%26b%3Dc");
  assert.equal(quotePlus("~-._"), "~-._"); // unreserved, left intact
  assert.equal(quotePlus("!*'()"), "%21%2A%27%28%29"); // quote_plus escapes these
  assert.equal(
    quotePlus("https://api.ibkr.com/v1/api"),
    "https%3A%2F%2Fapi.ibkr.com%2Fv1%2Fapi",
  );
});

test("generateNonce is 16 alphanumeric chars", () => {
  for (let i = 0; i < 200; i += 1) {
    const nonce = generateNonce();
    assert.equal(nonce.length, 16);
    assert.match(nonce, /^[A-Za-z0-9]{16}$/);
  }
  assert.equal(generateNonce(24).length, 24);
});

test("generateTimestamp is unix seconds as string", () => {
  assert.equal(generateTimestamp(1_700_000_000_500), "1700000000");
  assert.equal(generateTimestamp(0), "0");
});

test("buildBaseString exact known-answer vector (IBKR double-encoded form)", () => {
  const base = buildBaseString({
    method: "POST",
    url: "https://api.ibkr.com/v1/api/oauth/live_session_token",
    params: {
      oauth_consumer_key: "PYRUSCON1",
      oauth_nonce: "abc123",
      oauth_signature_method: "RSA-SHA256",
      oauth_timestamp: "1700000000",
      oauth_token: "mytoken",
    },
  });
  assert.equal(
    base,
    "POST&https%3A%2F%2Fapi.ibkr.com%2Fv1%2Fapi%2Foauth%2Flive_session_token&" +
      "oauth_consumer_key%3DPYRUSCON1%26oauth_nonce%3Dabc123%26" +
      "oauth_signature_method%3DRSA-SHA256%26oauth_timestamp%3D1700000000%26" +
      "oauth_token%3Dmytoken",
  );
});

test("buildBaseString sorts params and prefixes the prepend", () => {
  const params = { b: "2", a: "1", c: "3" };
  const withPrepend = buildBaseString({
    method: "post",
    url: "https://x/y",
    params,
    prepend: "deadbeef",
  });
  const without = buildBaseString({ method: "POST", url: "https://x/y", params });
  assert.ok(withPrepend.startsWith("deadbeef"));
  assert.equal(withPrepend.slice("deadbeef".length), without);
  // sorted a,b,c and method upper-cased
  assert.ok(without.startsWith("POST&"));
  assert.ok(without.includes("a%3D1%26b%3D2%26c%3D3"));
});

test("rsaSha256Sign produces a PKCS#1 v1.5 SHA-256 signature that verifies", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" }, // "BEGIN RSA PRIVATE KEY"
  });
  const base = "POST&https%3A%2F%2Fapi.ibkr.com&oauth_nonce%3Dabc";
  const sig = rsaSha256Sign(base, privateKey);
  assert.match(sig, /^[A-Za-z0-9+/]+=*$/); // raw base64, no newlines
  const ok = crypto.verify(
    "RSA-SHA256",
    Buffer.from(base, "utf8"),
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(sig, "base64"),
  );
  assert.equal(ok, true);
  // tampered base string must fail
  const bad = crypto.verify(
    "RSA-SHA256",
    Buffer.from(base + "x", "utf8"),
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(sig, "base64"),
  );
  assert.equal(bad, false);
});

test("hmacSha256Sign keys on the base64-decoded LST", () => {
  const lst = crypto.randomBytes(20).toString("base64");
  const base = "GET&https%3A%2F%2Fapi.ibkr.com%2Fv1%2Fapi%2Fiserver%2Faccounts&oauth_nonce%3Dz";
  const sig = hmacSha256Sign(base, lst);
  const expected = crypto
    .createHmac("sha256", Buffer.from(lst, "base64"))
    .update(Buffer.from(base, "utf8"))
    .digest("base64");
  assert.equal(sig, expected);
  // a different LST yields a different signature
  assert.notEqual(hmacSha256Sign(base, crypto.randomBytes(20).toString("base64")), sig);
});

test("buildAuthorizationHeader sorts params and percent-encodes values", () => {
  const header = buildAuthorizationHeader(
    {
      oauth_consumer_key: "PYRUSCON1",
      oauth_signature: "ab+cd/ef=",
      oauth_nonce: "n1",
    },
    "limited_poa",
  );
  assert.ok(header.startsWith('OAuth realm="limited_poa", '));
  // sorted: oauth_consumer_key, oauth_nonce, oauth_signature
  assert.ok(
    header.indexOf("oauth_consumer_key=") <
      header.indexOf("oauth_nonce=") &&
      header.indexOf("oauth_nonce=") < header.indexOf("oauth_signature="),
  );
  // signature's +,/,= are escaped
  assert.ok(header.includes('oauth_signature="ab%2Bcd%2Fef%3D"'));
});

test("signRsaRequest header carries a verifiable signature (limited_poa realm)", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const signed = signRsaRequest({
    method: "POST",
    url: "https://api.ibkr.com/v1/api/oauth/live_session_token",
    consumerKey: "PYRUSCON1",
    accessToken: "acctoken",
    privateSignatureKeyPem: privateKey,
    realm: "limited_poa",
    extraParams: { diffie_hellman_challenge: "abcdef123456" },
    prepend: "cafebabe",
    nonce: "fixednonce123456",
    timestamp: "1700000000",
  });
  assert.ok(signed.authorizationHeader.startsWith('OAuth realm="limited_poa", '));
  assert.ok(signed.baseString.startsWith("cafebabe"));
  assert.equal(signed.oauthParams.oauth_signature_method, "RSA-SHA256");
  assert.ok(signed.oauthParams.diffie_hellman_challenge === "abcdef123456");
  const ok = crypto.verify(
    "RSA-SHA256",
    Buffer.from(signed.baseString, "utf8"),
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(signed.oauthParams.oauth_signature!, "base64"),
  );
  assert.equal(ok, true);
});

test("signHmacRequest folds query params into the base string, not the header", () => {
  const lst = crypto.randomBytes(20).toString("base64");
  const signed = signHmacRequest({
    method: "GET",
    url: "https://api.ibkr.com/v1/api/iserver/marketdata/snapshot",
    consumerKey: "PYRUSCON1",
    accessToken: "acctoken",
    liveSessionToken: lst,
    realm: "limited_poa",
    queryParams: { conids: "265598", fields: "31" },
    nonce: "fixednonce123456",
    timestamp: "1700000000",
  });
  // query params participate in the base string
  assert.ok(signed.baseString.includes("conids%3D265598"));
  assert.ok(signed.baseString.includes("fields%3D31"));
  // but are NOT in the oauth header params
  assert.equal(signed.oauthParams.conids, undefined);
  assert.equal(signed.oauthParams.oauth_signature_method, "HMAC-SHA256");
  // signature recomputes correctly from the base string
  const expected = hmacSha256Sign(signed.baseString, lst);
  assert.equal(signed.oauthParams.oauth_signature, expected);
});

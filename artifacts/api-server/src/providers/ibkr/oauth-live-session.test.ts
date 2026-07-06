import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  computeDhChallenge,
  computeLiveSessionToken,
  computeSharedSecret,
  decryptAccessTokenSecret,
  generateDhRandomHex,
  modPow,
  parseDhParams,
  toTwosComplementBytes,
  validateLiveSessionToken,
} from "./oauth-live-session";

// Our registered 2048-bit DH params (non-secret), inlined for a deterministic
// fixture. generator = 2.
const DH_PEM = `-----BEGIN DH PARAMETERS-----
MIIBDAKCAQEAvqGEiQMAebXevbpOKyOcFXJZNx1HICCfAvVfl+sx7NR2sWgJmOmT
l6O+4nzEJRSvaYhh4D9Qd1N0pIfZkSghrZ17ZajG9Y/3n2E/FsaFiLtn7xALQb5r
NiqrJZleVBYdRe3g7EeLDgkOM0Zgy73ZE0Q++oVAiaDTRzVQmQQz0lOuJ5HzX+nc
TFiZ+XY0l7LLaL+I2Hm7HAKEtzTBTZIsXamyqDJeTHfdeWKM0gGaeB+F2OIutDTR
fGJExz/Elb3jme2SeCUHv1+3K8F148VgnyDQTCoHsFcNwSkRdUO6zemX+CCNf1No
o7UNEmoD+VGOiHgJMIxYtcfVJyWG8OMAHwIBAgICAOE=
-----END DH PARAMETERS-----`;

test("modPow known-answer vectors", () => {
  assert.equal(modPow(2n, 10n, 1000n), 24n);
  assert.equal(modPow(4n, 13n, 497n), 445n); // textbook RSA example
  assert.equal(modPow(3n, 0n, 7n), 1n);
  assert.equal(modPow(5n, 3n, 13n), 8n);
  assert.equal(modPow(123n, 456n, 1n), 0n);
});

test("toTwosComplementBytes matches Java BigInteger.toByteArray sign handling", () => {
  assert.deepEqual([...toTwosComplementBytes(0x7fn)], [0x7f]);
  assert.deepEqual([...toTwosComplementBytes(0x80n)], [0x00, 0x80]); // bitlen 8 -> sign byte
  assert.deepEqual([...toTwosComplementBytes(0xffn)], [0x00, 0xff]);
  assert.deepEqual([...toTwosComplementBytes(0x100n)], [0x01, 0x00]); // bitlen 9 -> none
  assert.deepEqual([...toTwosComplementBytes(0xffffn)], [0x00, 0xff, 0xff]);
  assert.deepEqual([...toTwosComplementBytes(0x1n)], [0x01]);
  assert.deepEqual([...toTwosComplementBytes(0n)], [0x00]);
});

test("parseDhParams reads the PKCS#3 PEM and the raw-hex form", () => {
  const fromPem = parseDhParams(DH_PEM);
  assert.equal(fromPem.generator, 2);
  assert.equal(fromPem.primeHex.length, 512); // 2048-bit
  assert.match(fromPem.primeHex, /^[0-9a-f]+$/);
  assert.ok(fromPem.primeHex.startsWith("bea18489"));
  assert.ok(fromPem.primeHex.endsWith("e3001f"));
  // top bit set (true 2048-bit modulus) and odd (prime)
  assert.equal(BigInt("0x" + fromPem.primeHex).toString(2).length, 2048);
  assert.equal(BigInt("0x" + fromPem.primeHex) % 2n, 1n);
  // raw-hex path round-trips and normalizes 0x + case
  assert.equal(parseDhParams(fromPem.primeHex).primeHex, fromPem.primeHex);
  assert.equal(parseDhParams("0x" + fromPem.primeHex.toUpperCase()).primeHex, fromPem.primeHex);
});

test("generateDhRandomHex is 256 random bits of hex", () => {
  const a = generateDhRandomHex();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, generateDhRandomHex());
});

test("Diffie-Hellman challenge + shared secret agree between two parties", () => {
  const { primeHex, generator } = parseDhParams(DH_PEM);
  // fixed exponents for determinism
  const aHex = "0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0";
  const bHex = "1122334455667788990011223344556677889900aabbccddeeff001122334455";
  const A = computeDhChallenge({ primeHex, generator, randomHex: aHex });
  const B = computeDhChallenge({ primeHex, generator, randomHex: bHex });
  // party 1 uses B + a ; party 2 uses A + b ; both must reach the same K
  const k1 = computeSharedSecret({ dhResponseHex: B, randomHex: aHex, primeHex });
  const k2 = computeSharedSecret({ dhResponseHex: A, randomHex: bHex, primeHex });
  assert.equal(k1, k2);
  assert.ok(k1 > 0n);
});

test("Live Session Token: both parties derive the same LST from the shared secret", () => {
  const { primeHex, generator } = parseDhParams(DH_PEM);
  const clientRandom = "abcdef0011223344556677889900aabbccddeeff00112233445566778899aabb";
  const serverRandom = "00112233445566778899aabbccddeeff0f1e2d3c4b5a6978a5b4c3d2e1f00112";
  const A = computeDhChallenge({ primeHex, generator, randomHex: clientRandom });
  const B = computeDhChallenge({ primeHex, generator, randomHex: serverRandom });
  const decryptedSecret = Buffer.from("0123456789abcdeffedcba9876543210", "hex");

  // Client path via the module under test.
  const clientLst = computeLiveSessionToken({
    dhResponseHex: B,
    randomHex: clientRandom,
    primeHex,
    decryptedSecret,
  });
  // Independent "server" computation of the same LST.
  const serverK = computeSharedSecret({ dhResponseHex: A, randomHex: serverRandom, primeHex });
  const serverLst = crypto
    .createHmac("sha1", toTwosComplementBytes(serverK))
    .update(decryptedSecret)
    .digest("base64");

  assert.equal(clientLst, serverLst);
});

test("validateLiveSessionToken accepts the correct signature and rejects tampering", () => {
  const consumerKey = "PYRUSCON1";
  const lst = crypto.randomBytes(20).toString("base64");
  // IBKR's side: HMAC-SHA1(key=base64decode(LST), msg=consumer_key), hex.
  const signature = crypto
    .createHmac("sha1", Buffer.from(lst, "base64"))
    .update(Buffer.from(consumerKey, "utf8"))
    .digest("hex");
  assert.equal(validateLiveSessionToken({ liveSessionToken: lst, signature, consumerKey }), true);
  assert.equal(
    validateLiveSessionToken({ liveSessionToken: lst, signature, consumerKey: "WRONGKEY1" }),
    false,
  );
  const flipped = signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
  assert.equal(
    validateLiveSessionToken({ liveSessionToken: lst, signature: flipped, consumerKey }),
    false,
  );
});

test("decryptAccessTokenSecret reverses RSA PKCS#1 v1.5 public encryption", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const secret = crypto.randomBytes(32);
  const encrypted = crypto
    .publicEncrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      secret,
    )
    .toString("base64");
  const decrypted = decryptAccessTokenSecret(encrypted, privateKey);
  assert.ok(decrypted.bytes.equals(secret));
  assert.equal(decrypted.hex, secret.toString("hex"));
});

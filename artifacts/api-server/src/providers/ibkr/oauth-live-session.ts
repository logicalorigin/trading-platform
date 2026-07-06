// IBKR OAuth 1.0a Live Session Token (LST) derivation — the Diffie-Hellman half
// of the auth flow. Node stdlib crypto + BigInt only.
//
// Flow (docs/plans/ibkr-third-party-oauth-scope.md §"OAuth 1.0a Extended", steps
// 4-5; resolved details in ibkr-oauth-selfservice-runbook.md):
//   1. Client picks a random 256-bit exponent a, sends challenge A = g^a mod p
//      (p,g = the DH params we registered with IBKR).
//   2. IBKR replies with B (dh_response) + an LST signature.
//   3. Shared secret K = B^a mod p. LST = HMAC-SHA1(key=K_bytes, msg=secret_bytes)
//      where secret_bytes is the RSA-decrypted access-token secret.
//   4. Validate: HMAC-SHA1(key=base64decode(LST), msg=consumer_key) == signature.
//
// Ground truth: Voyz/ibind `ibind/oauth/oauth1a.py`. The load-bearing subtlety is
// serializing K as Java-BigInteger-style two's-complement bytes (a leading 0x00
// sign byte when the bit length is a multiple of 8) — the classic cause of an
// LST that computes cleanly yet fails IBKR's signature check.

import crypto from "node:crypto";

// Modular exponentiation via square-and-multiply (BigInt ** is infeasible for
// 2048-bit exponents).
export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

// A random 256-bit private exponent, as a hex string (ibind: generate_dh_random_bytes).
export function generateDhRandomHex(): string {
  return crypto.randomBytes(32).toString("hex");
}

// DH challenge A = g^a mod p, serialized as hex without a leading "0x" (may be
// odd-length — IBKR parses it as a hex integer, matching ibind's hex(A)[2:]).
export function computeDhChallenge(args: {
  primeHex: string;
  generator: number | bigint;
  randomHex: string;
}): string {
  const p = BigInt("0x" + args.primeHex);
  const g = BigInt(args.generator);
  const a = BigInt("0x" + args.randomHex);
  return modPow(g, a, p).toString(16);
}

// Shared secret K = B^a mod p.
export function computeSharedSecret(args: {
  dhResponseHex: string;
  randomHex: string;
  primeHex: string;
}): bigint {
  const B = BigInt("0x" + args.dhResponseHex);
  const a = BigInt("0x" + args.randomHex);
  const p = BigInt("0x" + args.primeHex);
  return modPow(B, a, p);
}

// Serialize a non-negative BigInt as Java BigInteger.toByteArray does: big-endian
// magnitude with a leading 0x00 sign byte when the bit length is a multiple of 8.
export function toTwosComplementBytes(value: bigint): Buffer {
  if (value < 0n) throw new Error("toTwosComplementBytes: negative value");
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  const magnitude = Buffer.from(hex, "hex");
  // bit length as Python's len(bin(x)[2:]) — 1 for 0, else the true bit count.
  const bitLength = value.toString(2).length;
  if (bitLength % 8 === 0) {
    return Buffer.concat([Buffer.from([0x00]), magnitude]);
  }
  return magnitude;
}

// LST = base64( HMAC-SHA1( key = K bytes, msg = decrypted access-token secret ) ).
export function computeLiveSessionToken(args: {
  dhResponseHex: string;
  randomHex: string;
  primeHex: string;
  decryptedSecret: Buffer;
}): string {
  const K = computeSharedSecret(args);
  const keyBytes = toTwosComplementBytes(K);
  return crypto
    .createHmac("sha1", keyBytes)
    .update(args.decryptedSecret)
    .digest("base64");
}

// Validate the LST against IBKR's returned signature:
//   HMAC-SHA1( key = base64decode(LST), msg = consumer_key ) == signature (hex).
export function validateLiveSessionToken(args: {
  liveSessionToken: string;
  signature: string;
  consumerKey: string;
}): boolean {
  const computed = crypto
    .createHmac("sha1", Buffer.from(args.liveSessionToken, "base64"))
    .update(Buffer.from(args.consumerKey, "utf8"))
    .digest("hex");
  if (computed.length !== args.signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(computed, "utf8"),
    Buffer.from(args.signature, "utf8"),
  );
}

// RSA (PKCS#1 v1.5) decryption of the access-token secret IBKR issues encrypted
// with our registered encryption public key. Returns both the raw bytes (the LST
// HMAC message) and their hex form (the base-string prepend for the LST request).
export function decryptAccessTokenSecret(
  encryptedBase64: string,
  privateEncryptionKeyPem: string,
): { bytes: Buffer; hex: string } {
  const bytes = crypto.privateDecrypt(
    { key: privateEncryptionKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encryptedBase64, "base64"),
  );
  return { bytes, hex: bytes.toString("hex") };
}

// Minimal DER reader: read one tag-length-value at `offset` within `buf`.
function readTlv(buf: Buffer, offset: number): { tag: number; value: Buffer; next: number } {
  const tag = buf[offset]!;
  let lengthByte = buf[offset + 1]!;
  let cursor = offset + 2;
  let length = lengthByte;
  if (lengthByte & 0x80) {
    const numBytes = lengthByte & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i += 1) {
      length = length * 256 + buf[cursor]!;
      cursor += 1;
    }
  }
  return { tag, value: buf.subarray(cursor, cursor + length), next: cursor + length };
}

// Extract the prime `p` (hex, sign byte stripped) and generator `g` from either a
// raw prime hex string or a PKCS#3 "BEGIN DH PARAMETERS" PEM. IBKR_OAUTH_DH_PARAM
// may hold either form (see runbook A4/A5).
export function parseDhParams(input: string): { primeHex: string; generator: number } {
  const trimmed = input.trim();
  if (!trimmed.includes("BEGIN DH PARAMETERS")) {
    // Treat as a raw prime hex; generator defaults to 2 (our openssl dhparam).
    return { primeHex: trimmed.replace(/^0x/i, "").toLowerCase(), generator: 2 };
  }
  const der = Buffer.from(
    trimmed
      .replace(/-----(BEGIN|END) DH PARAMETERS-----/g, "")
      .replace(/\s+/g, ""),
    "base64",
  );
  const seq = readTlv(der, 0);
  if (seq.tag !== 0x30) throw new Error("parseDhParams: expected SEQUENCE");
  const prime = readTlv(seq.value, 0);
  const generator = readTlv(seq.value, prime.next);
  // Strip a leading 0x00 sign byte from the prime magnitude before hex-encoding.
  let primeBytes = prime.value;
  if (primeBytes.length > 0 && primeBytes[0] === 0x00) primeBytes = primeBytes.subarray(1);
  return {
    primeHex: primeBytes.toString("hex"),
    generator: Number(BigInt("0x" + (generator.value.toString("hex") || "02"))),
  };
}

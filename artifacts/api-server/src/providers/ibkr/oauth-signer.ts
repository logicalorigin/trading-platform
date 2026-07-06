// IBKR Web API OAuth 1.0a "Extended" signer — the crypto core for direct IBKR
// trading without SnapTrade (SnapTrade's IBKR is read-only Flex). Node stdlib
// crypto only, zero new deps.
//
// Two signature regimes, per docs/plans/ibkr-third-party-oauth-scope.md §"OAuth
// 1.0a Extended flow" and the resolved spec in ibkr-oauth-selfservice-runbook.md:
//   - AUTH phase (request_token / access_token / live_session_token): RSA-SHA256
//     (PKCS#1 v1.5) over the OAuth base string, base64.
//   - API calls (iserver/*, portfolio/*, orders): HMAC-SHA256 keyed by the
//     base64-decoded Live Session Token over the OAuth base string.
//
// Ground truth: Voyz/ibind `ibind/oauth/oauth1a.py` (the canonical OSS
// implementation the scope names). The base-string construction here is IBKR's
// NON-standard form — it quote_plus-encodes the entire sorted "k=v&..." param
// string as one unit (double-encoding), NOT per-parameter as RFC 5849 does.
// Deviating from this yields a valid-looking signature that IBKR rejects.

import crypto from "node:crypto";

export type OAuthParams = Record<string, string>;

// Matches Python urllib.parse.quote_plus: keep [A-Za-z0-9_.-~], encode the rest,
// and render space as "+". encodeURIComponent already leaves [A-Za-z0-9_.!~*'()-]
// unescaped, so we additionally encode !*'() (which quote_plus escapes) and swap
// %20 for "+". This exact encoding feeds the signature base string, so it must
// mirror the reference byte-for-byte.
export function quotePlus(input: string): string {
  return encodeURIComponent(input)
    .replace(/[!*'()]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

const NONCE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// 16-char alphanumeric nonce (ibind: secrets.choice over ascii_letters+digits).
export function generateNonce(length = 16): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += NONCE_ALPHABET[bytes[i]! % NONCE_ALPHABET.length];
  }
  return out;
}

// Unix timestamp in whole seconds, as a string (injectable clock for tests).
export function generateTimestamp(nowMs: number = Date.now()): string {
  return String(Math.floor(nowMs / 1000));
}

// The OAuth signature base string:
//   method + "&" + quote_plus(url) + "&" + quote_plus( sorted "k=v" joined by "&" )
// Values are joined RAW (not pre-encoded) and the whole param blob is encoded as
// one unit — matching ibind. `prepend` (the decrypted access-token secret, hex)
// is prefixed for the live_session_token request only.
export function buildBaseString(args: {
  method: string;
  url: string;
  params: OAuthParams;
  prepend?: string;
}): string {
  const { method, url, params, prepend } = args;
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const base = [
    method.toUpperCase(),
    quotePlus(url),
    quotePlus(paramString),
  ].join("&");
  return prepend === undefined ? base : `${prepend}${base}`;
}

// RSA-SHA256 (PKCS#1 v1.5) signature over the base string, base64. Used for the
// auth phase. IBKR reads the PKCS#1 ("BEGIN RSA PRIVATE KEY") PEM directly.
export function rsaSha256Sign(baseString: string, privateSignatureKeyPem: string): string {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(Buffer.from(baseString, "utf8"));
  signer.end();
  return signer.sign(
    { key: privateSignatureKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    "base64",
  );
}

// HMAC-SHA256 signature over the base string, keyed by the base64-DECODED Live
// Session Token, base64. Used for every authenticated API call.
export function hmacSha256Sign(baseString: string, liveSessionToken: string): string {
  return crypto
    .createHmac("sha256", Buffer.from(liveSessionToken, "base64"))
    .update(Buffer.from(baseString, "utf8"))
    .digest("base64");
}

// Assemble the OAuth Authorization header. All values are percent-encoded per
// RFC 5849 §3.5.1 (the signature's +,/,= must be escaped inside the header).
export function buildAuthorizationHeader(params: OAuthParams, realm: string): string {
  const pairs = Object.keys(params)
    .sort()
    .map((key) => `${key}="${quotePlus(params[key]!)}"`);
  return `OAuth realm="${realm}", ${pairs.join(", ")}`;
}

export type SignedRequest = {
  authorizationHeader: string;
  /** oauth_* params incl. the signature (the base string excludes the signature). */
  oauthParams: OAuthParams;
  baseString: string;
};

// Compose an RSA-SHA256-signed auth-phase request (e.g. live_session_token).
// `extraParams` carries request-specific base-string members such as
// `diffie_hellman_challenge`. `prepend` is the decrypted secret (hex) for LST.
export function signRsaRequest(args: {
  method: string;
  url: string;
  consumerKey: string;
  accessToken: string;
  privateSignatureKeyPem: string;
  realm: string;
  extraParams?: OAuthParams;
  prepend?: string;
  nonce?: string;
  timestamp?: string;
}): SignedRequest {
  const oauthParams: OAuthParams = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: args.nonce ?? generateNonce(),
    oauth_signature_method: "RSA-SHA256",
    oauth_timestamp: args.timestamp ?? generateTimestamp(),
    oauth_token: args.accessToken,
    ...(args.extraParams ?? {}),
  };
  const baseString = buildBaseString({
    method: args.method,
    url: args.url,
    params: oauthParams,
    prepend: args.prepend,
  });
  const signature = rsaSha256Sign(baseString, args.privateSignatureKeyPem);
  const signed: OAuthParams = { ...oauthParams, oauth_signature: signature };
  return {
    authorizationHeader: buildAuthorizationHeader(signed, args.realm),
    oauthParams: signed,
    baseString,
  };
}

// Compose an HMAC-SHA256-signed API request keyed by the Live Session Token.
// `queryParams` are the request's query args, which participate in the base
// string alongside the oauth_* params (RFC 5849).
export function signHmacRequest(args: {
  method: string;
  url: string;
  consumerKey: string;
  accessToken: string;
  liveSessionToken: string;
  realm: string;
  queryParams?: OAuthParams;
  nonce?: string;
  timestamp?: string;
}): SignedRequest {
  const oauthParams: OAuthParams = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: args.nonce ?? generateNonce(),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: args.timestamp ?? generateTimestamp(),
    oauth_token: args.accessToken,
  };
  const baseParams: OAuthParams = { ...oauthParams, ...(args.queryParams ?? {}) };
  const baseString = buildBaseString({
    method: args.method,
    url: args.url,
    params: baseParams,
  });
  const signature = hmacSha256Sign(baseString, args.liveSessionToken);
  // Only oauth_* params go in the header; query params ride on the URL.
  const signed: OAuthParams = { ...oauthParams, oauth_signature: signature };
  return {
    authorizationHeader: buildAuthorizationHeader(signed, args.realm),
    oauthParams: signed,
    baseString,
  };
}

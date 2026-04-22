import crypto from "node:crypto";

export function buildOAuth1Header({
  method,
  url,
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  extraParams = {},
}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };
  if (token != null && String(token).trim() !== "") {
    oauth.oauth_token = String(token);
  }
  const oauthHeaderExtras = pickOAuthHeaderParams(extraParams);

  const normalizedUrl = normalizedBaseUrl(url);
  const signatureParams = compactObject({
    ...queryParams(url),
    ...extraParams,
    ...oauth,
  });

  const parameterString = Object.keys(signatureParams)
    .sort()
    .map((key) => `${encodeOAuth(key)}=${encodeOAuth(signatureParams[key])}`)
    .join("&");

  const signatureBase = [
    String(method || "GET").toUpperCase(),
    encodeOAuth(normalizedUrl),
    encodeOAuth(parameterString),
  ].join("&");

  const signingKey = `${encodeOAuth(consumerSecret || "")}&${encodeOAuth(tokenSecret || "")}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");

  const headerParams = compactObject({
    ...oauth,
    ...oauthHeaderExtras,
    oauth_signature: signature,
  });

  const header = Object.keys(headerParams)
    .sort()
    .map((key) => `${encodeOAuth(key)}=\"${encodeOAuth(headerParams[key])}\"`)
    .join(", ");

  return `OAuth ${header}`;
}

function pickOAuthHeaderParams(extraParams) {
  const out = {};
  for (const [key, value] of Object.entries(extraParams || {})) {
    if (!key || value == null) {
      continue;
    }
    if (!String(key).toLowerCase().startsWith("oauth_")) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function compactObject(input) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value == null) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function queryParams(rawUrl) {
  const url = new URL(rawUrl);
  const result = {};
  for (const [key, value] of url.searchParams.entries()) {
    result[key] = value;
  }
  return result;
}

function normalizedBaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  const port = url.port && !["80", "443"].includes(url.port) ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname}${port}${url.pathname}`;
}

function encodeOAuth(value) {
  return encodeURIComponent(String(value == null ? "" : value))
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

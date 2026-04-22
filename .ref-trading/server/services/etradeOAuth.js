import { buildOAuth1Header } from "./oauth1.js";

const PROD_BASE_URL = "https://api.etrade.com";
const SANDBOX_BASE_URL = "https://apisb.etrade.com";
const DEFAULT_AUTHORIZE_URL = "https://us.etrade.com/e/t/etws/authorize";
const REQUEST_TIMEOUT_MS = 15000;

export function resolveEtradeConsumerCredentials(credentials = {}) {
  const hasProd = hasCredential(credentials.ETRADE_PROD_KEY) && hasCredential(credentials.ETRADE_PROD_SECRET);
  const hasSandbox = hasCredential(credentials.ETRADE_SB_KEY) && hasCredential(credentials.ETRADE_SB_SECRET);

  if (!hasProd && !hasSandbox) {
    throw new Error("E*TRADE consumer key/secret not configured");
  }

  if (hasProd) {
    return {
      consumerKey: String(credentials.ETRADE_PROD_KEY).trim(),
      consumerSecret: String(credentials.ETRADE_PROD_SECRET).trim(),
      useSandbox: false,
    };
  }

  return {
    consumerKey: String(credentials.ETRADE_SB_KEY).trim(),
    consumerSecret: String(credentials.ETRADE_SB_SECRET).trim(),
    useSandbox: true,
  };
}

export function resolveEtradeApiBaseUrl(useSandbox) {
  return useSandbox ? SANDBOX_BASE_URL : PROD_BASE_URL;
}

export function buildEtradeAuthorizeUrl({ consumerKey, requestToken, authorizeUrl }) {
  const base = String(authorizeUrl || process.env.ETRADE_AUTHORIZE_URL || DEFAULT_AUTHORIZE_URL).trim();
  const url = new URL(base);
  url.searchParams.set("key", String(consumerKey || ""));
  url.searchParams.set("token", String(requestToken || ""));
  return url.toString();
}

export async function requestEtradeRequestToken({
  consumerKey,
  consumerSecret,
  useSandbox,
  callbackUrl = "oob",
}) {
  const baseUrl = resolveEtradeApiBaseUrl(useSandbox);
  const endpoint = `${baseUrl}/oauth/request_token`;
  const authorization = buildOAuth1Header({
    method: "GET",
    url: endpoint,
    consumerKey,
    consumerSecret,
    extraParams: {
      oauth_callback: callbackUrl,
    },
  });

  const text = await requestOAuthText(endpoint, {
    method: "GET",
    headers: {
      Authorization: authorization,
    },
  });
  const parsed = parseOAuthFormEncoded(text);
  const requestToken = parsed.oauth_token;
  const requestTokenSecret = parsed.oauth_token_secret;

  if (!hasCredential(requestToken) || !hasCredential(requestTokenSecret)) {
    throw new Error("E*TRADE request token response missing oauth_token or oauth_token_secret");
  }

  return {
    baseUrl,
    callbackUrl,
    requestToken,
    requestTokenSecret,
    callbackConfirmed: String(parsed.oauth_callback_confirmed || "").toLowerCase() === "true",
    raw: parsed,
  };
}

export async function exchangeEtradeAccessToken({
  consumerKey,
  consumerSecret,
  useSandbox,
  requestToken,
  requestTokenSecret,
  verifier,
}) {
  if (!hasCredential(requestToken) || !hasCredential(requestTokenSecret)) {
    throw new Error("Missing request token/secret for E*TRADE access token exchange");
  }
  if (!hasCredential(verifier)) {
    throw new Error("Missing oauth verifier for E*TRADE access token exchange");
  }

  const baseUrl = resolveEtradeApiBaseUrl(useSandbox);
  const endpoint = `${baseUrl}/oauth/access_token`;
  const authorization = buildOAuth1Header({
    method: "GET",
    url: endpoint,
    consumerKey,
    consumerSecret,
    token: requestToken,
    tokenSecret: requestTokenSecret,
    extraParams: {
      oauth_verifier: String(verifier).trim(),
    },
  });

  const text = await requestOAuthText(endpoint, {
    method: "GET",
    headers: {
      Authorization: authorization,
    },
  });
  const parsed = parseOAuthFormEncoded(text);
  const accessToken = parsed.oauth_token;
  const accessSecret = parsed.oauth_token_secret;

  if (!hasCredential(accessToken) || !hasCredential(accessSecret)) {
    throw new Error("E*TRADE access token response missing oauth_token or oauth_token_secret");
  }

  return {
    baseUrl,
    accessToken,
    accessSecret,
    issuedAt: new Date().toISOString(),
    etradeSessionDate: etDateKey(new Date()),
    raw: parsed,
  };
}

export async function renewEtradeAccessToken({
  consumerKey,
  consumerSecret,
  useSandbox,
  accessToken,
  accessSecret,
}) {
  if (!hasCredential(accessToken) || !hasCredential(accessSecret)) {
    throw new Error("Missing E*TRADE access token/secret for renewal");
  }

  const baseUrl = resolveEtradeApiBaseUrl(useSandbox);
  const endpoint = `${baseUrl}/oauth/renew_access_token`;
  const authorization = buildOAuth1Header({
    method: "GET",
    url: endpoint,
    consumerKey,
    consumerSecret,
    token: accessToken,
    tokenSecret: accessSecret,
  });

  const text = await requestOAuthText(endpoint, {
    method: "GET",
    headers: {
      Authorization: authorization,
    },
  });

  return {
    ok: true,
    renewedAt: new Date().toISOString(),
    etradeSessionDate: etDateKey(new Date()),
    responseText: text,
  };
}

export async function revokeEtradeAccessToken({
  consumerKey,
  consumerSecret,
  useSandbox,
  accessToken,
  accessSecret,
}) {
  if (!hasCredential(accessToken) || !hasCredential(accessSecret)) {
    throw new Error("Missing E*TRADE access token/secret for revoke");
  }

  const baseUrl = resolveEtradeApiBaseUrl(useSandbox);
  const endpoint = `${baseUrl}/oauth/revoke_access_token`;
  const authorization = buildOAuth1Header({
    method: "GET",
    url: endpoint,
    consumerKey,
    consumerSecret,
    token: accessToken,
    tokenSecret: accessSecret,
  });

  const text = await requestOAuthText(endpoint, {
    method: "GET",
    headers: {
      Authorization: authorization,
    },
  });

  return {
    ok: true,
    revokedAt: new Date().toISOString(),
    responseText: text,
  };
}

export function etDateKey(value) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value instanceof Date ? value : new Date(value));
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }
  return `${map.year}-${map.month}-${map.day}`;
}

export function isLikelyExpiredByEtDate(issuedEtDate) {
  if (!hasCredential(issuedEtDate)) {
    return false;
  }
  return String(issuedEtDate).trim() !== etDateKey(new Date());
}

function parseOAuthFormEncoded(text) {
  const params = new URLSearchParams(String(text || ""));
  const out = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

async function requestOAuthText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Accept: "application/x-www-form-urlencoded, text/plain, application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      const message = text?.trim() || `E*TRADE OAuth request failed (${response.status})`;
      throw new Error(message);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function hasCredential(value) {
  if (value == null) {
    return false;
  }
  return String(value).trim().length > 0;
}

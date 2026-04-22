const DEFAULT_AUTHORIZE_URL = "https://passport.webull.com/oauth2/authenticate/login";
const DEFAULT_API_BASE_URL = "https://us-oauth-open-api.webull.com";
const REQUEST_TIMEOUT_MS = 15000;

export function resolveWebullConnectCredentials(credentials = {}) {
  const clientId = firstCredential(
    credentials.WEBULL_CLIENT_ID,
    credentials.WEBULL_OAUTH_CLIENT_ID,
  );
  const clientSecret = firstCredential(
    credentials.WEBULL_CLIENT_SECRET,
    credentials.WEBULL_OAUTH_CLIENT_SECRET,
  );
  if (!clientId || !clientSecret) {
    throw new Error("Webull Connect client id/secret not configured");
  }

  return {
    clientId,
    clientSecret,
    scope: firstCredential(
      credentials.WEBULL_OAUTH_SCOPE,
      credentials.WEBULL_SCOPE,
      "account:read trading:read trading:write",
    ),
    redirectUri: firstCredential(
      credentials.WEBULL_OAUTH_REDIRECT_URI,
      credentials.WEBULL_REDIRECT_URI,
      "",
    ) || null,
    authorizeUrl: resolveWebullConnectAuthorizeUrl(credentials),
    apiBaseUrl: resolveWebullConnectApiBaseUrl(credentials),
  };
}

export function resolveWebullConnectAuthorizeUrl(credentials = {}) {
  return stripTrailingSlash(
    firstCredential(
      credentials.WEBULL_OAUTH_AUTHORIZE_URL,
      credentials.WEBULL_CONNECT_AUTHORIZE_URL,
      process.env.WEBULL_OAUTH_AUTHORIZE_URL,
      DEFAULT_AUTHORIZE_URL,
    ),
  );
}

export function resolveWebullConnectApiBaseUrl(credentials = {}) {
  return stripTrailingSlash(
    firstCredential(
      credentials.WEBULL_OAUTH_API_BASE_URL,
      credentials.WEBULL_CONNECT_API_BASE_URL,
      process.env.WEBULL_OAUTH_API_BASE_URL,
      DEFAULT_API_BASE_URL,
    ),
  );
}

export function buildWebullConnectAuthorizeUrl({
  clientId,
  redirectUri,
  scope,
  state,
  authorizeUrl,
}) {
  if (!hasCredential(clientId)) {
    throw new Error("Webull Connect authorize URL requires client_id");
  }
  if (!hasCredential(redirectUri)) {
    throw new Error("Webull Connect authorize URL requires redirect_uri");
  }

  const url = new URL(String(authorizeUrl || DEFAULT_AUTHORIZE_URL));
  url.searchParams.set("client_id", String(clientId).trim());
  url.searchParams.set("redirect_uri", String(redirectUri).trim());
  url.searchParams.set("response_type", "code");
  if (hasCredential(scope)) {
    url.searchParams.set("scope", String(scope).trim());
  }
  if (hasCredential(state)) {
    url.searchParams.set("state", String(state).trim());
  }
  return url.toString();
}

export async function exchangeWebullConnectToken({
  clientId,
  clientSecret,
  code,
  redirectUri,
  apiBaseUrl,
}) {
  if (!hasCredential(code)) {
    throw new Error("Missing Webull OAuth authorization code");
  }
  if (!hasCredential(redirectUri)) {
    throw new Error("Missing Webull OAuth redirect URI");
  }

  return requestWebullOAuthToken({
    apiBaseUrl,
    form: {
      grant_type: "authorization_code",
      client_id: String(clientId || "").trim(),
      client_secret: String(clientSecret || "").trim(),
      code: String(code).trim(),
      redirect_uri: String(redirectUri).trim(),
    },
  });
}

export async function refreshWebullConnectToken({
  clientId,
  clientSecret,
  refreshToken,
  apiBaseUrl,
}) {
  if (!hasCredential(refreshToken)) {
    throw new Error("Missing Webull OAuth refresh token");
  }

  return requestWebullOAuthToken({
    apiBaseUrl,
    form: {
      grant_type: "refresh_token",
      client_id: String(clientId || "").trim(),
      client_secret: String(clientSecret || "").trim(),
      refresh_token: String(refreshToken).trim(),
    },
  });
}

function stripTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function requestWebullOAuthToken({
  apiBaseUrl,
  form,
}) {
  const endpoint = `${stripTrailingSlash(apiBaseUrl || DEFAULT_API_BASE_URL)}/openapi/oauth2/token`;
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(form || {})) {
    if (value == null || value === "") {
      continue;
    }
    body.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseJsonSafe(text);
    if (!response.ok) {
      throw new Error(extractWebullOAuthErrorMessage(payload, text) || `Webull OAuth request failed (${response.status})`);
    }

    return normalizeWebullOAuthTokenPayload(payload);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWebullOAuthTokenPayload(payload) {
  const nowMs = Date.now();
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : root;

  const accessToken = firstCredential(
    data.access_token,
    data.accessToken,
    data.token,
  );
  const refreshToken = firstCredential(
    data.refresh_token,
    data.refreshToken,
  );
  if (!accessToken) {
    throw new Error("Webull OAuth response missing access_token");
  }

  return {
    accessToken,
    refreshToken: refreshToken || null,
    tokenType: firstCredential(data.token_type, data.tokenType, "Bearer") || "Bearer",
    scope: firstCredential(data.scope, data.scopes, "") || "",
    issuedAt: new Date(nowMs).toISOString(),
    accessExpiresAt: resolveExpirationTimestamp(data, {
      absoluteKeys: [
        "access_token_expires_at",
        "accessTokenExpiresAt",
        "expires_at",
        "expire_time",
        "expired_at",
      ],
      relativeKeys: [
        "expires_in",
        "expiresIn",
        "access_token_expires_in",
        "accessTokenExpiresIn",
      ],
      nowMs,
    }),
    refreshExpiresAt: resolveExpirationTimestamp(data, {
      absoluteKeys: [
        "refresh_token_expires_at",
        "refreshTokenExpiresAt",
        "refresh_expires_at",
        "refreshExpireTime",
      ],
      relativeKeys: [
        "refresh_token_expires_in",
        "refreshTokenExpiresIn",
        "refresh_expires_in",
      ],
      nowMs,
    }),
    raw: root,
  };
}

function resolveExpirationTimestamp(source, options = {}) {
  const absolute = firstFinite(
    ...(options.absoluteKeys || []).map((key) => source?.[key]),
  );
  if (Number.isFinite(absolute)) {
    const ms = absolute > 10_000_000_000 ? absolute : absolute * 1000;
    return new Date(ms).toISOString();
  }

  const absoluteText = firstCredential(
    ...(options.absoluteKeys || []).map((key) => source?.[key]),
  );
  if (absoluteText) {
    const parsed = Date.parse(absoluteText);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  const relative = firstFinite(
    ...(options.relativeKeys || []).map((key) => source?.[key]),
  );
  if (Number.isFinite(relative) && relative > 0) {
    return new Date(Number(options.nowMs || Date.now()) + relative * 1000).toISOString();
  }
  return null;
}

function extractWebullOAuthErrorMessage(payload, fallbackText) {
  const root = payload && typeof payload === "object" ? payload : null;
  const data = root?.data && typeof root.data === "object" ? root.data : null;
  const message = firstCredential(
    root?.msg,
    root?.message,
    root?.error_description,
    root?.error,
    data?.msg,
    data?.message,
    data?.error_description,
    data?.error,
  );
  return message || String(fallbackText || "").trim() || null;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function firstCredential(...values) {
  for (const value of values) {
    if (hasCredential(value)) {
      return String(value).trim();
    }
  }
  return null;
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function hasCredential(value) {
  if (value == null) {
    return false;
  }
  return String(value).trim().length > 0;
}

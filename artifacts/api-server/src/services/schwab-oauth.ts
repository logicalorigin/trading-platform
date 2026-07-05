import { randomBytes } from "node:crypto";

import { HttpError } from "../lib/errors";
import {
  beginSchwabConnectCustody,
  loadSchwabPendingConnect,
  loadSchwabTokens,
  storeSchwabTokens,
} from "./schwab-user-custody";
import type { SchwabUserReadiness } from "./schwab-user-custody";

// Schwab Trader API is a confidential OAuth2 client (app key + secret sent as
// HTTP Basic auth on the token endpoint). Unlike Robinhood's Agentic Trading
// beta there is no dynamic client registration and no PKCE: the app key is
// provisioned ahead of time in the Schwab developer portal.
export const SCHWAB_OAUTH_AUTHORIZATION_URL =
  "https://api.schwabapi.com/v1/oauth/authorize";
export const SCHWAB_OAUTH_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
export const SCHWAB_OAUTH_SCOPE = "api";
export const SCHWAB_OAUTH_CALLBACK_PATH =
  "/api/broker-execution/schwab/oauth/callback";

const CONNECT_TTL_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000;
// Schwab hard-expires refresh tokens 7 days after user authorization;
// refreshing the access token does not extend this wall.
const SCHWAB_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type StartSchwabConnectOptions = {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
};

export type SchwabConnectStartResponse = {
  provider: "schwab";
  authorizationUrl: string;
  state: string;
  redirectUri: string;
  expiresAt: string;
};

export type CompleteSchwabConnectOptions = {
  appUserId: string;
  code: string;
  state: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
};

export type GetSchwabAccessTokenOptions = {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
};

function readEnvString(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string {
  return env[key]?.trim() ?? "";
}

export function resolveSchwabRedirectBaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const override = readEnvString(env, "SCHWAB_OAUTH_REDIRECT_BASE_URL");
  if (override) {
    return override.replace(/\/+$/u, "");
  }
  const replitDomain = readEnvString(env, "REPLIT_DEV_DOMAIN");
  if (replitDomain) {
    return `https://${replitDomain}`;
  }
  return null;
}

export function resolveSchwabRedirectUri(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const base = resolveSchwabRedirectBaseUrl(env);
  if (!base) {
    throw new HttpError(503, "Schwab OAuth redirect base URL is not configured", {
      code: "schwab_redirect_base_url_not_configured",
    });
  }
  return `${base}${SCHWAB_OAUTH_CALLBACK_PATH}`;
}

export function readSchwabAppCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { appKey: string; appSecret: string } {
  const appKey = readEnvString(env, "SCHWAB_APP_KEY");
  const appSecret = readEnvString(env, "SCHWAB_APP_SECRET");
  if (!appKey || !appSecret) {
    throw new HttpError(503, "Schwab app credentials are not configured", {
      code: "schwab_app_credentials_not_configured",
    });
  }
  return { appKey, appSecret };
}

export function isSchwabAppCredentialsConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  try {
    readSchwabAppCredentials(env);
    return true;
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function startSchwabConnect(
  options: StartSchwabConnectOptions,
): Promise<SchwabConnectStartResponse> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const redirectUri = resolveSchwabRedirectUri(env);
  const { appKey } = readSchwabAppCredentials(env);

  const state = randomBytes(24).toString("base64url");

  await beginSchwabConnectCustody({
    appUserId: options.appUserId,
    oauthState: state,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
    now,
  });

  const params = new URLSearchParams();
  params.set("client_id", appKey);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("scope", SCHWAB_OAUTH_SCOPE);
  params.set("state", state);

  return {
    provider: "schwab",
    authorizationUrl: `${SCHWAB_OAUTH_AUTHORIZATION_URL}?${params.toString()}`,
    state,
    redirectUri,
    expiresAt: new Date(now.getTime() + CONNECT_TTL_MS).toISOString(),
  };
}

type SchwabTokenGrantResponse = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  scope: string | null;
};

async function requestSchwabTokenGrant(input: {
  body: URLSearchParams;
  appKey: string;
  appSecret: string;
  fetchImpl: typeof fetch;
  now: Date;
  failureCode: string;
}): Promise<SchwabTokenGrantResponse> {
  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(SCHWAB_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${input.appKey}:${input.appSecret}`,
        ).toString("base64")}`,
      },
      body: input.body.toString(),
    });
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, "Schwab token request failed", {
      code: `${input.failureCode}_network_error`,
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, "Schwab token request failed", {
      code: input.failureCode,
      expose: false,
      data: { status: response.status },
    });
  }

  const record = asRecord(payload);
  const accessToken = record["access_token"];
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new HttpError(502, "Schwab token response is invalid", {
      code: `${input.failureCode}_invalid_response`,
      expose: false,
    });
  }
  const refreshToken = record["refresh_token"];
  const expiresIn = record["expires_in"];
  const scope = record["scope"];

  return {
    accessToken: accessToken.trim(),
    refreshToken:
      typeof refreshToken === "string" && refreshToken.trim()
        ? refreshToken.trim()
        : null,
    accessTokenExpiresAt:
      typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(input.now.getTime() + expiresIn * 1000)
        : null,
    scope: typeof scope === "string" && scope.trim() ? scope.trim() : null,
  };
}

export async function completeSchwabConnect(
  options: CompleteSchwabConnectOptions,
): Promise<SchwabUserReadiness> {
  if (!options.code.trim() || !options.state.trim()) {
    throw new HttpError(422, "Schwab authorization callback is invalid", {
      code: "schwab_authorization_callback_invalid",
    });
  }

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const { appKey, appSecret } = readSchwabAppCredentials(env);
  const pending = await loadSchwabPendingConnect({
    appUserId: options.appUserId,
    oauthState: options.state.trim(),
  });
  if (!pending) {
    throw new HttpError(409, "Schwab authorization is not pending", {
      code: "schwab_authorization_not_pending",
    });
  }
  if (now.getTime() - pending.connectStartedAt.getTime() > CONNECT_TTL_MS) {
    throw new HttpError(409, "Schwab authorization has expired", {
      code: "schwab_authorization_expired",
    });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", options.code.trim());
  body.set("redirect_uri", resolveSchwabRedirectUri(env));

  const grant = await requestSchwabTokenGrant({
    body,
    appKey,
    appSecret,
    fetchImpl,
    now,
    failureCode: "schwab_token_exchange_failed",
  });

  return storeSchwabTokens({
    appUserId: options.appUserId,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    accessTokenExpiresAt: grant.accessTokenExpiresAt,
    refreshTokenExpiresAt: grant.refreshToken
      ? new Date(now.getTime() + SCHWAB_REFRESH_TOKEN_TTL_MS)
      : null,
    scope: grant.scope,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
    now,
  });
}

export async function getSchwabAccessToken(
  options: GetSchwabAccessTokenOptions,
): Promise<string> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const { appKey, appSecret } = readSchwabAppCredentials(env);
  const tokens = await loadSchwabTokens({
    appUserId: options.appUserId,
    encryptionKey: options.encryptionKey,
  });
  if (!tokens) {
    throw new HttpError(409, "Schwab is not connected", {
      code: "schwab_user_not_connected",
    });
  }

  const accessTokenFresh =
    tokens.accessToken &&
    (!tokens.accessTokenExpiresAt ||
      tokens.accessTokenExpiresAt.getTime() - ACCESS_TOKEN_REFRESH_SKEW_MS >
        now.getTime());
  if (tokens.accessToken && accessTokenFresh) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    throw new HttpError(409, "Schwab access token has expired", {
      code: "schwab_token_expired",
    });
  }
  if (
    tokens.refreshTokenExpiresAt &&
    tokens.refreshTokenExpiresAt.getTime() <= now.getTime()
  ) {
    throw new HttpError(409, "Schwab refresh token has expired; reconnect required", {
      code: "schwab_reconnect_required",
    });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", tokens.refreshToken);

  const grant = await requestSchwabTokenGrant({
    body,
    appKey,
    appSecret,
    fetchImpl,
    now,
    failureCode: "schwab_token_refresh_failed",
  });

  await storeSchwabTokens({
    appUserId: options.appUserId,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    accessTokenExpiresAt: grant.accessTokenExpiresAt,
    // Preserve the original 7-day wall even if Schwab returns a new
    // refresh_token: refreshing does not extend Schwab's hard expiry.
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    scope: grant.scope,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
    now,
  });

  return grant.accessToken;
}

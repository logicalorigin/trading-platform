import { createHash, randomBytes } from "node:crypto";

import { HttpError } from "../lib/errors";
import {
  beginRobinhoodConnectCustody,
  loadRobinhoodPendingConnect,
  loadRobinhoodTokens,
  storeRobinhoodTokens,
} from "./robinhood-user-custody";
import type { RobinhoodUserReadiness } from "./robinhood-user-custody";

// Verified live on 2026-07-02 from the RFC 9728/8414 well-known documents at
// https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading
// and https://agent.robinhood.com/.well-known/oauth-authorization-server:
// public client (token_endpoint_auth_method "none"), PKCE S256,
// authorization_code + refresh_token grants, open dynamic registration.
export const ROBINHOOD_TRADING_MCP_URL =
  "https://agent.robinhood.com/mcp/trading";
export const ROBINHOOD_OAUTH_REGISTRATION_URL =
  "https://agent.robinhood.com/oauth/trading/register";
export const ROBINHOOD_OAUTH_AUTHORIZATION_URL = "https://robinhood.com/oauth";
export const ROBINHOOD_OAUTH_TOKEN_URL =
  "https://api.robinhood.com/oauth2/token/";
export const ROBINHOOD_OAUTH_SCOPE = "internal";
export const ROBINHOOD_OAUTH_CALLBACK_PATH =
  "/api/broker-execution/robinhood/oauth/callback";

const CONNECT_TTL_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export type StartRobinhoodConnectOptions = {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
};

export type RobinhoodConnectStartResponse = {
  provider: "robinhood";
  authorizationUrl: string;
  state: string;
  redirectUri: string;
  expiresAt: string;
};

export type CompleteRobinhoodConnectOptions = {
  appUserId: string;
  code: string;
  state: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
};

export type GetRobinhoodAccessTokenOptions = {
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

export function resolveRobinhoodRedirectBaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const override = readEnvString(env, "ROBINHOOD_OAUTH_REDIRECT_BASE_URL");
  if (override) {
    return override.replace(/\/+$/u, "");
  }
  const replitDomain = readEnvString(env, "REPLIT_DEV_DOMAIN");
  if (replitDomain) {
    return `https://${replitDomain}`;
  }
  return null;
}

export function resolveRobinhoodRedirectUri(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const base = resolveRobinhoodRedirectBaseUrl(env);
  if (!base) {
    throw new HttpError(503, "Robinhood OAuth redirect base URL is not configured", {
      code: "robinhood_redirect_base_url_not_configured",
    });
  }
  return `${base}${ROBINHOOD_OAUTH_CALLBACK_PATH}`;
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

async function registerRobinhoodOAuthClient(input: {
  redirectUri: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(ROBINHOOD_OAUTH_REGISTRATION_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "PYRUS Platform",
        redirect_uris: [input.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, "Robinhood OAuth client registration failed", {
      code: "robinhood_oauth_registration_network_error",
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, "Robinhood OAuth client registration failed", {
      code: "robinhood_oauth_registration_failed",
      expose: false,
      data: { status: response.status },
    });
  }

  const clientId = asRecord(payload)["client_id"];
  if (typeof clientId !== "string" || !clientId.trim()) {
    throw new HttpError(502, "Robinhood OAuth client registration returned invalid data", {
      code: "robinhood_oauth_registration_invalid_response",
      expose: false,
    });
  }
  return clientId.trim();
}

export async function startRobinhoodConnect(
  options: StartRobinhoodConnectOptions,
): Promise<RobinhoodConnectStartResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const redirectUri = resolveRobinhoodRedirectUri(env);

  // Register a fresh public client on every connect start: registration is
  // unauthenticated and the client is bound to its redirect URIs, which move
  // whenever the dev domain rotates. Reusing a stale client would strand the
  // callback on the old domain.
  const oauthClientId = await registerRobinhoodOAuthClient({
    redirectUri,
    fetchImpl,
  });

  const pkceVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(pkceVerifier, "ascii")
    .digest("base64url");
  const state = randomBytes(24).toString("base64url");

  await beginRobinhoodConnectCustody({
    appUserId: options.appUserId,
    oauthClientId,
    oauthState: state,
    pkceVerifier,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
    now,
  });

  const params = new URLSearchParams();
  params.set("client_id", oauthClientId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("scope", ROBINHOOD_OAUTH_SCOPE);
  params.set("state", state);
  params.set("code_challenge", codeChallenge);
  params.set("code_challenge_method", "S256");

  return {
    provider: "robinhood",
    authorizationUrl: `${ROBINHOOD_OAUTH_AUTHORIZATION_URL}?${params.toString()}`,
    state,
    redirectUri,
    expiresAt: new Date(now.getTime() + CONNECT_TTL_MS).toISOString(),
  };
}

type RobinhoodTokenGrantResponse = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  scope: string | null;
};

async function requestRobinhoodTokenGrant(input: {
  body: URLSearchParams;
  fetchImpl: typeof fetch;
  now: Date;
  failureCode: string;
}): Promise<RobinhoodTokenGrantResponse> {
  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(ROBINHOOD_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: input.body.toString(),
    });
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, "Robinhood token request failed", {
      code: `${input.failureCode}_network_error`,
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, "Robinhood token request failed", {
      code: input.failureCode,
      expose: false,
      data: { status: response.status },
    });
  }

  const record = asRecord(payload);
  const accessToken = record["access_token"];
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new HttpError(502, "Robinhood token response is invalid", {
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

export async function completeRobinhoodConnect(
  options: CompleteRobinhoodConnectOptions,
): Promise<RobinhoodUserReadiness> {
  if (!options.code.trim() || !options.state.trim()) {
    throw new HttpError(422, "Robinhood authorization callback is invalid", {
      code: "robinhood_authorization_callback_invalid",
    });
  }

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const pending = await loadRobinhoodPendingConnect({
    appUserId: options.appUserId,
    oauthState: options.state.trim(),
    encryptionKey: options.encryptionKey,
  });
  if (!pending) {
    throw new HttpError(409, "Robinhood authorization is not pending", {
      code: "robinhood_authorization_not_pending",
    });
  }
  if (now.getTime() - pending.connectStartedAt.getTime() > CONNECT_TTL_MS) {
    throw new HttpError(409, "Robinhood authorization has expired", {
      code: "robinhood_authorization_expired",
    });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", options.code.trim());
  body.set("redirect_uri", resolveRobinhoodRedirectUri(env));
  body.set("client_id", pending.oauthClientId);
  body.set("code_verifier", pending.pkceVerifier);

  const grant = await requestRobinhoodTokenGrant({
    body,
    fetchImpl,
    now,
    failureCode: "robinhood_token_exchange_failed",
  });

  return storeRobinhoodTokens({
    appUserId: options.appUserId,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    accessTokenExpiresAt: grant.accessTokenExpiresAt,
    scope: grant.scope,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
    now,
  });
}

export async function getRobinhoodAccessToken(
  options: GetRobinhoodAccessTokenOptions,
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const tokens = await loadRobinhoodTokens({
    appUserId: options.appUserId,
    encryptionKey: options.encryptionKey,
  });
  if (!tokens) {
    throw new HttpError(409, "Robinhood is not connected", {
      code: "robinhood_user_not_connected",
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
    throw new HttpError(409, "Robinhood access token has expired", {
      code: "robinhood_token_expired",
    });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", tokens.refreshToken);
  body.set("client_id", tokens.oauthClientId);

  const grant = await requestRobinhoodTokenGrant({
    body,
    fetchImpl,
    now,
    failureCode: "robinhood_token_refresh_failed",
  });

  await storeRobinhoodTokens({
    appUserId: options.appUserId,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    accessTokenExpiresAt: grant.accessTokenExpiresAt,
    scope: grant.scope,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
    now,
  });

  return grant.accessToken;
}

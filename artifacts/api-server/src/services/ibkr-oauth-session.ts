import { existsSync, readFileSync } from "node:fs";

import {
  computeDhChallenge,
  computeLiveSessionToken,
  decryptAccessTokenSecret,
  generateDhRandomHex,
  parseDhParams,
  validateLiveSessionToken,
} from "../providers/ibkr/oauth-live-session";
import { signHmacRequest, signRsaRequest } from "../providers/ibkr/oauth-signer";

const DEFAULT_IBKR_OAUTH_BASE_URL = "https://api.ibkr.com/v1/api";
const DEFAULT_IBKR_OAUTH_REALM = "limited_poa";
const TICKLE_INTERVAL_MS = 60_000;

const consumerKeyEnvNames = ["IBKR_OAUTH_CONSUMER_KEY", "IBKR_CONSUMER_KEY"] as const;
const signingKeyEnvNames = [
  "IBKR_OAUTH_SIGNING_KEY",
  "IBKR_OAUTH_PRIVATE_KEY",
  "IBKR_OAUTH_RSA_PRIVATE_KEY",
] as const;
const encryptionKeyEnvNames = ["IBKR_OAUTH_ENCRYPTION_KEY"] as const;
const dhParamEnvNames = ["IBKR_OAUTH_DH_PARAM"] as const;
const accessTokenEnvNames = ["IBKR_OAUTH_ACCESS_TOKEN"] as const;
const accessTokenSecretEnvNames = ["IBKR_OAUTH_ACCESS_TOKEN_SECRET"] as const;

export type OAuthHttp = {
  post(
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<unknown>;
};

type TimerHandle = {
  unref?: () => void;
};

type TimerApi = {
  setInterval(
    callback: () => void | Promise<void>,
    ms: number,
  ): TimerHandle;
  clearInterval(handle: TimerHandle): void;
};

export type IbkrOAuthCredentials = {
  consumerKey: string;
  signingKey: string;
  encryptionKey: string;
  dhParam: string;
  accessToken: string;
  encryptedAccessTokenSecret: string;
  realm?: string;
  baseUrl?: string;
};

export type LiveSessionTokenResult = {
  liveSessionToken: string;
  expiresAt: Date;
};

export class IbkrOAuthNotConfiguredError extends Error {
  readonly code = "ibkr_oauth_not_configured";

  constructor(message = "IBKR OAuth credentials are not configured.") {
    super(message);
    this.name = "IbkrOAuthNotConfiguredError";
  }
}

export class IbkrOAuthSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IbkrOAuthSessionError";
    this.code = code;
  }
}

function readFirstPresent(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function readKeyMaterial(value: string): string {
  if (value.includes("BEGIN ")) {
    return value;
  }
  return existsSync(value) ? readFileSync(value, "utf8") : value;
}

export function readIbkrOAuthCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): IbkrOAuthCredentials | null {
  const consumerKey = readFirstPresent(env, consumerKeyEnvNames);
  const signingKey = readFirstPresent(env, signingKeyEnvNames);
  const encryptionKey = readFirstPresent(env, encryptionKeyEnvNames);
  const dhParam = readFirstPresent(env, dhParamEnvNames);
  const accessToken = readFirstPresent(env, accessTokenEnvNames);
  const encryptedAccessTokenSecret = readFirstPresent(env, accessTokenSecretEnvNames);

  if (
    !consumerKey ||
    !signingKey ||
    !encryptionKey ||
    !dhParam ||
    !accessToken ||
    !encryptedAccessTokenSecret
  ) {
    return null;
  }

  return {
    consumerKey,
    signingKey: readKeyMaterial(signingKey),
    encryptionKey: readKeyMaterial(encryptionKey),
    dhParam: readKeyMaterial(dhParam),
    accessToken,
    encryptedAccessTokenSecret,
  };
}

function baseUrlFor(credentials: IbkrOAuthCredentials, override?: string): string {
  return (override ?? credentials.baseUrl ?? DEFAULT_IBKR_OAUTH_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

function realmFor(credentials: IbkrOAuthCredentials, override?: string): string {
  return override ?? credentials.realm ?? DEFAULT_IBKR_OAUTH_REALM;
}

function absoluteUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function readRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new IbkrOAuthSessionError(
      "ibkr_oauth_invalid_response",
      "IBKR OAuth response was not an object.",
    );
  }
  return payload as Record<string, unknown>;
}

function readStringField(
  record: Record<string, unknown>,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function parseExpiresAt(value: string, now: Date): Date {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 10_000_000_000) {
      return new Date(numeric);
    }
    if (numeric > 1_000_000_000) {
      return new Date(numeric * 1000);
    }
    return new Date(now.getTime() + numeric * 1000);
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new IbkrOAuthSessionError(
    "ibkr_oauth_invalid_expiry",
    "IBKR OAuth response did not include a valid LST expiry.",
  );
}

function oauthHeaders(authorizationHeader: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: authorizationHeader,
    "Content-Type": "application/json",
  };
}

function hmacHeaders(args: {
  credentials: IbkrOAuthCredentials;
  liveSessionToken: string;
  method: string;
  path: string;
  baseUrl?: string;
  realm?: string;
  nonce?: string;
  timestamp?: string;
}): Record<string, string> {
  const baseUrl = baseUrlFor(args.credentials, args.baseUrl);
  const signed = signHmacRequest({
    method: args.method,
    url: absoluteUrl(baseUrl, args.path),
    consumerKey: args.credentials.consumerKey,
    accessToken: args.credentials.accessToken,
    liveSessionToken: args.liveSessionToken,
    realm: realmFor(args.credentials, args.realm),
    nonce: args.nonce,
    timestamp: args.timestamp,
  });
  return oauthHeaders(signed.authorizationHeader);
}

export async function acquireLiveSessionToken(args: {
  credentials: IbkrOAuthCredentials;
  http: OAuthHttp;
  baseUrl?: string;
  realm?: string;
  randomHex?: string;
  nonce?: string;
  timestamp?: string;
  now?: Date;
}): Promise<LiveSessionTokenResult> {
  const baseUrl = baseUrlFor(args.credentials, args.baseUrl);
  const realm = realmFor(args.credentials, args.realm);
  const { primeHex, generator } = parseDhParams(args.credentials.dhParam);
  const randomHex = args.randomHex ?? generateDhRandomHex();
  const challenge = computeDhChallenge({ primeHex, generator, randomHex });
  const decryptedSecret = decryptAccessTokenSecret(
    args.credentials.encryptedAccessTokenSecret,
    args.credentials.encryptionKey,
  );
  const signed = signRsaRequest({
    method: "POST",
    url: absoluteUrl(baseUrl, "/oauth/live_session_token"),
    consumerKey: args.credentials.consumerKey,
    accessToken: args.credentials.accessToken,
    privateSignatureKeyPem: args.credentials.signingKey,
    realm,
    extraParams: { diffie_hellman_challenge: challenge },
    prepend: decryptedSecret.hex,
    nonce: args.nonce,
    timestamp: args.timestamp,
  });

  const payload = await args.http.post(
    "/oauth/live_session_token",
    {},
    oauthHeaders(signed.authorizationHeader),
  );
  const record = readRecord(payload);
  const dhResponseHex = readStringField(record, [
    "diffie_hellman_response",
    "dh_response",
    "dhResponse",
    "B",
  ]);
  const signature = readStringField(record, [
    "live_session_token_signature",
    "lst_signature",
    "signature",
  ]);
  const expiry = readStringField(record, [
    "live_session_token_expiration",
    "live_session_token_expires_at",
    "expires_at",
    "expiresAt",
    "expiration",
  ]);

  if (!dhResponseHex || !signature || !expiry) {
    throw new IbkrOAuthSessionError(
      "ibkr_oauth_invalid_response",
      "IBKR OAuth response was missing DH response, signature, or expiry.",
    );
  }

  const liveSessionToken = computeLiveSessionToken({
    dhResponseHex,
    randomHex,
    primeHex,
    decryptedSecret: decryptedSecret.bytes,
  });

  if (
    !validateLiveSessionToken({
      liveSessionToken,
      signature,
      consumerKey: args.credentials.consumerKey,
    })
  ) {
    throw new IbkrOAuthSessionError(
      "ibkr_oauth_invalid_lst_signature",
      "IBKR OAuth Live Session Token signature validation failed.",
    );
  }

  return {
    liveSessionToken,
    expiresAt: parseExpiresAt(expiry, args.now ?? new Date()),
  };
}

export async function initBrokerageSession(args: {
  credentials: IbkrOAuthCredentials;
  http: OAuthHttp;
  liveSessionToken: string;
  baseUrl?: string;
  realm?: string;
  nonce?: string;
  timestamp?: string;
}): Promise<unknown> {
  return args.http.post(
    "/iserver/auth/ssodh/init",
    { publish: true, compete: true },
    hmacHeaders({
      credentials: args.credentials,
      liveSessionToken: args.liveSessionToken,
      method: "POST",
      path: "/iserver/auth/ssodh/init",
      baseUrl: args.baseUrl,
      realm: args.realm,
      nonce: args.nonce,
      timestamp: args.timestamp,
    }),
  );
}

type ActiveOAuthSession = LiveSessionTokenResult & {
  credentials: IbkrOAuthCredentials;
  timer: TimerHandle;
  reauthInFlight: Promise<void> | null;
};

export type IbkrOAuthSessionManagerOptions = {
  http: OAuthHttp;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  baseUrl?: string;
  realm?: string;
  tickleIntervalMs?: number;
  randomHex?: () => string;
  nonce?: () => string;
  timestamp?: () => string;
  now?: () => Date;
  timers?: TimerApi;
};

export class IbkrOAuthSessionManager {
  private readonly sessions = new Map<string, ActiveOAuthSession>();
  private readonly tickleIntervalMs: number;
  private readonly timers: TimerApi;
  private readonly now: () => Date;

  constructor(private readonly options: IbkrOAuthSessionManagerOptions) {
    this.tickleIntervalMs = options.tickleIntervalMs ?? TICKLE_INTERVAL_MS;
    this.timers = options.timers ?? {
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
    };
    this.now = options.now ?? (() => new Date());
  }

  async start(
    sessionId: string,
    options: { credentials?: IbkrOAuthCredentials } = {},
  ): Promise<LiveSessionTokenResult> {
    const active = this.sessions.get(sessionId);
    if (active) {
      return {
        liveSessionToken: active.liveSessionToken,
        expiresAt: active.expiresAt,
      };
    }

    const credentials =
      options.credentials ?? readIbkrOAuthCredentials(this.options.env);
    if (!credentials) {
      throw new IbkrOAuthNotConfiguredError();
    }

    const acquired = await this.acquire(credentials);
    await this.initialize(credentials, acquired.liveSessionToken);

    const timer = this.timers.setInterval(
      () => this.handleInterval(sessionId),
      this.tickleIntervalMs,
    );
    timer.unref?.();
    this.sessions.set(sessionId, {
      ...acquired,
      credentials,
      timer,
      reauthInFlight: null,
    });

    return acquired;
  }

  stop(sessionId: string): void {
    const active = this.sessions.get(sessionId);
    if (!active) {
      return;
    }
    this.timers.clearInterval(active.timer);
    this.sessions.delete(sessionId);
  }

  private async handleInterval(sessionId: string): Promise<void> {
    const active = this.sessions.get(sessionId);
    if (!active) {
      return;
    }

    if (this.now().getTime() >= active.expiresAt.getTime()) {
      active.reauthInFlight ??= this.reauthenticate(active).finally(() => {
        active.reauthInFlight = null;
      });
      await active.reauthInFlight;
      return;
    }

    await this.options.http.post(
      "/tickle",
      {},
      hmacHeaders({
        credentials: active.credentials,
        liveSessionToken: active.liveSessionToken,
        method: "POST",
        path: "/tickle",
        baseUrl: this.options.baseUrl,
        realm: this.options.realm,
        nonce: this.options.nonce?.(),
        timestamp: this.options.timestamp?.(),
      }),
    );
  }

  private async reauthenticate(active: ActiveOAuthSession): Promise<void> {
    const acquired = await this.acquire(active.credentials);
    await this.initialize(active.credentials, acquired.liveSessionToken);
    active.liveSessionToken = acquired.liveSessionToken;
    active.expiresAt = acquired.expiresAt;
  }

  private acquire(
    credentials: IbkrOAuthCredentials,
  ): Promise<LiveSessionTokenResult> {
    return acquireLiveSessionToken({
      credentials,
      http: this.options.http,
      baseUrl: this.options.baseUrl,
      realm: this.options.realm,
      randomHex: this.options.randomHex?.(),
      nonce: this.options.nonce?.(),
      timestamp: this.options.timestamp?.(),
      now: this.now(),
    });
  }

  private initialize(
    credentials: IbkrOAuthCredentials,
    liveSessionToken: string,
  ): Promise<unknown> {
    return initBrokerageSession({
      credentials,
      http: this.options.http,
      liveSessionToken,
      baseUrl: this.options.baseUrl,
      realm: this.options.realm,
      nonce: this.options.nonce?.(),
      timestamp: this.options.timestamp?.(),
    });
  }
}

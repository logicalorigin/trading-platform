import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";

import { db, robinhoodUserCredentialsTable } from "@workspace/db";
import type { RobinhoodUserCredential } from "@workspace/db/schema";
import { HttpError } from "../lib/errors";

export type RobinhoodUserReadinessStatus =
  | "not_connected"
  | "pending"
  | "connected"
  | "disabled";

export type RobinhoodUserReadinessNextAction =
  | "start_connect"
  | "complete_authorization"
  | "sync_accounts"
  | "manual_review";

export type RobinhoodUserReadiness = {
  connected: boolean;
  status: RobinhoodUserReadinessStatus;
  oauthClientRegistered: boolean;
  refreshTokenStored: boolean;
  connectedAt: string | null;
  disabledAt: string | null;
  nextAction: RobinhoodUserReadinessNextAction;
};

export type BeginRobinhoodConnectCustodyInput = {
  appUserId: string;
  oauthClientId: string;
  oauthState: string;
  pkceVerifier: string;
  encryptionKey?: string;
  keyVersion?: string;
  now?: Date;
};

export type LoadRobinhoodPendingConnectInput = {
  appUserId: string;
  oauthState: string;
  encryptionKey?: string;
};

export type LoadedRobinhoodPendingConnect = {
  oauthClientId: string;
  pkceVerifier: string;
  connectStartedAt: Date;
};

export type StoreRobinhoodTokensInput = {
  appUserId: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  scope: string | null;
  encryptionKey?: string;
  keyVersion?: string;
  now?: Date;
};

export type LoadRobinhoodTokensInput = {
  appUserId: string;
  encryptionKey?: string;
};

export type LoadedRobinhoodTokens = {
  oauthClientId: string;
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
};

const CIPHER = "aes-256-gcm";
const CIPHERTEXT_VERSION = "v1";
const IV_BYTES = 12;
const DEFAULT_KEY_VERSION = "v1";

function readCredentialEncryptionKey(input?: string): Buffer {
  const raw =
    input?.trim() ??
    process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY"]?.trim() ??
    "";
  if (!raw) {
    throw new HttpError(503, "Credential encryption key is not configured", {
      code: "credential_encryption_key_not_configured",
    });
  }

  const decoded = decodeCredentialEncryptionKey(raw);
  if (decoded.length !== 32) {
    throw new HttpError(503, "Credential encryption key is invalid", {
      code: "credential_encryption_key_invalid",
      expose: false,
    });
  }
  return decoded;
}

export function assertRobinhoodCredentialEncryptionConfigured(
  input?: string,
): void {
  readCredentialEncryptionKey(input);
}

export function isRobinhoodCredentialEncryptionConfigured(
  input?: string,
): boolean {
  try {
    readCredentialEncryptionKey(input);
    return true;
  } catch {
    return false;
  }
}

function decodeCredentialEncryptionKey(raw: string): Buffer {
  if (raw.startsWith("hex:")) {
    return Buffer.from(raw.slice("hex:".length), "hex");
  }
  if (raw.startsWith("base64:")) {
    return Buffer.from(raw.slice("base64:".length), "base64");
  }
  return Buffer.from(raw, "base64url");
}

type RobinhoodSecretField = "pkce_verifier" | "access_token" | "refresh_token";

function credentialAad(appUserId: string, field: RobinhoodSecretField): Buffer {
  return Buffer.from(`robinhood:oauth:${field}:${appUserId}`, "utf8");
}

function sealSecret(input: {
  appUserId: string;
  field: RobinhoodSecretField;
  secret: string;
  encryptionKey?: string;
}): string {
  const key = readCredentialEncryptionKey(input.encryptionKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(credentialAad(input.appUserId, input.field));
  const ciphertext = Buffer.concat([
    cipher.update(input.secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    CIPHER,
    CIPHERTEXT_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function openSecret(input: {
  appUserId: string;
  field: RobinhoodSecretField;
  ciphertext: string;
  encryptionKey?: string;
}): string {
  const parts = input.ciphertext.split(":");
  if (
    parts.length !== 5 ||
    parts[0] !== CIPHER ||
    parts[1] !== CIPHERTEXT_VERSION
  ) {
    throw new HttpError(500, "Robinhood credential ciphertext is invalid", {
      code: "robinhood_credential_ciphertext_invalid",
      expose: false,
    });
  }
  const [, , ivRaw, authTagRaw, ciphertextRaw] = parts;
  const decipher = createDecipheriv(
    CIPHER,
    readCredentialEncryptionKey(input.encryptionKey),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAAD(credentialAad(input.appUserId, input.field));
  decipher.setAuthTag(Buffer.from(authTagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function readKeyVersion(input?: string): string {
  return (
    input?.trim() ||
    process.env["PYRUS_CREDENTIAL_ENCRYPTION_KEY_VERSION"]?.trim() ||
    DEFAULT_KEY_VERSION
  );
}

function safePresent(value: string | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function readinessFromCredential(
  credential: RobinhoodUserCredential | undefined,
): RobinhoodUserReadiness {
  if (!credential) {
    return {
      connected: false,
      status: "not_connected",
      oauthClientRegistered: false,
      refreshTokenStored: false,
      connectedAt: null,
      disabledAt: null,
      nextAction: "start_connect",
    };
  }

  const disabled = Boolean(credential.disabledAt);
  const connected = !disabled && credential.status === "connected";
  const status: RobinhoodUserReadinessStatus = disabled
    ? "disabled"
    : connected
      ? "connected"
      : "pending";
  return {
    connected,
    status,
    oauthClientRegistered: safePresent(credential.oauthClientId),
    refreshTokenStored: safePresent(credential.refreshTokenCiphertext),
    connectedAt: credential.connectedAt?.toISOString() ?? null,
    disabledAt: credential.disabledAt?.toISOString() ?? null,
    nextAction: disabled
      ? "manual_review"
      : connected
        ? "sync_accounts"
        : credential.status === "pending"
          ? "complete_authorization"
          : "start_connect",
  };
}

async function findCredential(
  appUserId: string,
): Promise<RobinhoodUserCredential | undefined> {
  const [credential] = await db
    .select()
    .from(robinhoodUserCredentialsTable)
    .where(eq(robinhoodUserCredentialsTable.appUserId, appUserId))
    .limit(1);
  return credential;
}

export async function readRobinhoodUserReadiness(
  appUserId: string,
): Promise<RobinhoodUserReadiness> {
  return readinessFromCredential(await findCredential(appUserId));
}

export async function beginRobinhoodConnectCustody(
  input: BeginRobinhoodConnectCustodyInput,
): Promise<RobinhoodUserReadiness> {
  if (!input.appUserId.trim()) {
    throw new HttpError(422, "App user id is required", {
      code: "app_user_id_required",
    });
  }
  if (!input.oauthClientId.trim() || input.oauthClientId.trim().length > 128) {
    throw new HttpError(422, "Robinhood OAuth client id is invalid", {
      code: "robinhood_oauth_client_id_invalid",
    });
  }
  if (!input.oauthState.trim() || !input.pkceVerifier.trim()) {
    throw new HttpError(422, "Robinhood connect state is invalid", {
      code: "robinhood_connect_state_invalid",
    });
  }

  const now = input.now ?? new Date();
  const existing = await findCredential(input.appUserId);
  if (existing?.disabledAt) {
    throw new HttpError(409, "Robinhood connection is disabled", {
      code: "robinhood_connection_disabled",
    });
  }

  const pkceVerifierCiphertext = sealSecret({
    appUserId: input.appUserId,
    field: "pkce_verifier",
    secret: input.pkceVerifier,
    encryptionKey: input.encryptionKey,
  });
  // A fresh connect intentionally resets any previously stored tokens: the new
  // authorization supersedes the old grant and the redirect URI may have moved.
  const pendingValues = {
    oauthClientId: input.oauthClientId.trim(),
    status: "pending",
    oauthState: input.oauthState.trim(),
    pkceVerifierCiphertext,
    connectStartedAt: now,
    accessTokenCiphertext: null,
    refreshTokenCiphertext: null,
    tokenKeyVersion: readKeyVersion(input.keyVersion),
    accessTokenExpiresAt: null,
    scope: null,
    connectedAt: null,
    updatedAt: now,
  };

  if (existing) {
    const [updated] = await db
      .update(robinhoodUserCredentialsTable)
      .set(pendingValues)
      .where(eq(robinhoodUserCredentialsTable.id, existing.id))
      .returning();
    if (!updated) {
      throw new HttpError(500, "Failed to store Robinhood connect state", {
        code: "robinhood_connect_state_store_failed",
        expose: false,
      });
    }
    return readinessFromCredential(updated);
  }

  const [stored] = await db
    .insert(robinhoodUserCredentialsTable)
    .values({
      appUserId: input.appUserId,
      ...pendingValues,
    })
    .returning();
  if (!stored) {
    throw new HttpError(500, "Failed to store Robinhood connect state", {
      code: "robinhood_connect_state_store_failed",
      expose: false,
    });
  }
  return readinessFromCredential(stored);
}

export async function loadRobinhoodPendingConnect(
  input: LoadRobinhoodPendingConnectInput,
): Promise<LoadedRobinhoodPendingConnect | null> {
  const credential = await findCredential(input.appUserId);
  if (
    !credential ||
    credential.disabledAt ||
    credential.status !== "pending" ||
    !credential.oauthState ||
    !credential.pkceVerifierCiphertext ||
    !credential.connectStartedAt
  ) {
    return null;
  }
  if (credential.oauthState !== input.oauthState) {
    return null;
  }

  return {
    oauthClientId: credential.oauthClientId,
    pkceVerifier: openSecret({
      appUserId: input.appUserId,
      field: "pkce_verifier",
      ciphertext: credential.pkceVerifierCiphertext,
      encryptionKey: input.encryptionKey,
    }),
    connectStartedAt: credential.connectStartedAt,
  };
}

export async function storeRobinhoodTokens(
  input: StoreRobinhoodTokensInput,
): Promise<RobinhoodUserReadiness> {
  if (!input.accessToken.trim()) {
    throw new HttpError(422, "Robinhood access token is required", {
      code: "robinhood_access_token_required",
    });
  }
  const credential = await findCredential(input.appUserId);
  if (!credential || credential.disabledAt) {
    throw new HttpError(409, "Robinhood connection is not pending", {
      code: "robinhood_connection_not_pending",
    });
  }

  const now = input.now ?? new Date();
  const [updated] = await db
    .update(robinhoodUserCredentialsTable)
    .set({
      status: "connected",
      oauthState: null,
      pkceVerifierCiphertext: null,
      accessTokenCiphertext: sealSecret({
        appUserId: input.appUserId,
        field: "access_token",
        secret: input.accessToken,
        encryptionKey: input.encryptionKey,
      }),
      refreshTokenCiphertext: input.refreshToken
        ? sealSecret({
            appUserId: input.appUserId,
            field: "refresh_token",
            secret: input.refreshToken,
            encryptionKey: input.encryptionKey,
          })
        : credential.refreshTokenCiphertext,
      tokenKeyVersion: readKeyVersion(input.keyVersion),
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scope: input.scope,
      connectedAt: credential.connectedAt ?? now,
      updatedAt: now,
    })
    .where(eq(robinhoodUserCredentialsTable.id, credential.id))
    .returning();

  if (!updated) {
    throw new HttpError(500, "Failed to store Robinhood tokens", {
      code: "robinhood_token_store_failed",
      expose: false,
    });
  }
  return readinessFromCredential(updated);
}

export async function loadRobinhoodTokens(
  input: LoadRobinhoodTokensInput,
): Promise<LoadedRobinhoodTokens | null> {
  const credential = await findCredential(input.appUserId);
  if (!credential || credential.disabledAt || credential.status !== "connected") {
    return null;
  }

  return {
    oauthClientId: credential.oauthClientId,
    accessToken: credential.accessTokenCiphertext
      ? openSecret({
          appUserId: input.appUserId,
          field: "access_token",
          ciphertext: credential.accessTokenCiphertext,
          encryptionKey: input.encryptionKey,
        })
      : null,
    refreshToken: credential.refreshTokenCiphertext
      ? openSecret({
          appUserId: input.appUserId,
          field: "refresh_token",
          ciphertext: credential.refreshTokenCiphertext,
          encryptionKey: input.encryptionKey,
        })
      : null,
    accessTokenExpiresAt: credential.accessTokenExpiresAt,
  };
}

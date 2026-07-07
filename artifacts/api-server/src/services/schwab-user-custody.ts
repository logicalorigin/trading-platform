import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";

import { db, schwabUserCredentialsTable } from "@workspace/db";
import type { SchwabUserCredential } from "@workspace/db/schema";
import { HttpError } from "../lib/errors";

export type SchwabUserReadinessStatus =
  | "not_connected"
  | "pending"
  | "connected"
  | "expired"
  | "disabled";

export type SchwabUserReadinessNextAction =
  | "start_connect"
  | "complete_authorization"
  | "sync_accounts"
  | "reconnect"
  | "manual_review";

export type SchwabUserReadiness = {
  connected: boolean;
  status: SchwabUserReadinessStatus;
  refreshTokenStored: boolean;
  connectedAt: string | null;
  refreshTokenExpiresAt: string | null;
  disabledAt: string | null;
  nextAction: SchwabUserReadinessNextAction;
  executionBlockers: string[];
};

export type BeginSchwabConnectCustodyInput = {
  appUserId: string;
  oauthState: string;
  encryptionKey?: string;
  keyVersion?: string;
  now?: Date;
};

export type LoadSchwabPendingConnectInput = {
  appUserId: string;
  oauthState: string;
};

export type LoadedSchwabPendingConnect = {
  connectStartedAt: Date;
};

export type StoreSchwabTokensInput = {
  appUserId: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  encryptionKey?: string;
  keyVersion?: string;
  now?: Date;
};

export type LoadSchwabTokensInput = {
  appUserId: string;
  encryptionKey?: string;
};

export type LoadedSchwabTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
};

const CIPHER = "aes-256-gcm";
const CIPHERTEXT_VERSION = "v1";
const IV_BYTES = 12;
const DEFAULT_KEY_VERSION = "v1";
const REFRESH_TOKEN_REAUTH_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export function isSchwabCredentialEncryptionConfigured(
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

type SchwabSecretField = "access_token" | "refresh_token";

function credentialAad(appUserId: string, field: SchwabSecretField): Buffer {
  return Buffer.from(`schwab:oauth:${field}:${appUserId}`, "utf8");
}

function sealSecret(input: {
  appUserId: string;
  field: SchwabSecretField;
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
  field: SchwabSecretField;
  ciphertext: string;
  encryptionKey?: string;
}): string {
  const parts = input.ciphertext.split(":");
  if (
    parts.length !== 5 ||
    parts[0] !== CIPHER ||
    parts[1] !== CIPHERTEXT_VERSION
  ) {
    throw new HttpError(500, "Schwab credential ciphertext is invalid", {
      code: "schwab_credential_ciphertext_invalid",
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

function refreshTokenExpired(
  credential: SchwabUserCredential,
  now: Date,
): boolean {
  return Boolean(
    credential.refreshTokenExpiresAt &&
      credential.refreshTokenExpiresAt.getTime() <= now.getTime(),
  );
}

function refreshTokenNeedsReauth(
  credential: SchwabUserCredential,
  now: Date,
): boolean {
  return Boolean(
    credential.refreshTokenExpiresAt &&
      credential.refreshTokenExpiresAt.getTime() - now.getTime() <=
        REFRESH_TOKEN_REAUTH_WINDOW_MS,
  );
}

function readinessFromCredential(
  credential: SchwabUserCredential | undefined,
  now: Date,
): SchwabUserReadiness {
  if (!credential) {
    return {
      connected: false,
      status: "not_connected",
      refreshTokenStored: false,
      connectedAt: null,
      refreshTokenExpiresAt: null,
      disabledAt: null,
      nextAction: "start_connect",
      executionBlockers: [],
    };
  }

  const disabled = Boolean(credential.disabledAt);
  const expired =
    !disabled &&
    (credential.status === "expired" ||
      (credential.status === "connected" && refreshTokenExpired(credential, now)));
  const connected = !disabled && !expired && credential.status === "connected";
  const status: SchwabUserReadinessStatus = disabled
    ? "disabled"
    : expired
      ? "expired"
      : connected
        ? "connected"
        : "pending";
  const reauthRequired =
    !disabled &&
    credential.status === "connected" &&
    refreshTokenNeedsReauth(credential, now);
  return {
    connected,
    status,
    refreshTokenStored: safePresent(credential.refreshTokenCiphertext),
    connectedAt: credential.connectedAt?.toISOString() ?? null,
    refreshTokenExpiresAt:
      credential.refreshTokenExpiresAt?.toISOString() ?? null,
    disabledAt: credential.disabledAt?.toISOString() ?? null,
    nextAction: disabled
      ? "manual_review"
      : expired || reauthRequired
        ? "reconnect"
        : connected
          ? "sync_accounts"
          : credential.status === "pending"
            ? "complete_authorization"
            : "start_connect",
    executionBlockers: expired || reauthRequired ? ["broker_reauth"] : [],
  };
}

async function findCredential(
  appUserId: string,
): Promise<SchwabUserCredential | undefined> {
  const [credential] = await db
    .select()
    .from(schwabUserCredentialsTable)
    .where(eq(schwabUserCredentialsTable.appUserId, appUserId))
    .limit(1);
  return credential;
}

export async function readSchwabUserReadiness(
  appUserId: string,
  now: Date = new Date(),
): Promise<SchwabUserReadiness> {
  return readinessFromCredential(await findCredential(appUserId), now);
}

export async function beginSchwabConnectCustody(
  input: BeginSchwabConnectCustodyInput,
): Promise<SchwabUserReadiness> {
  if (!input.appUserId.trim()) {
    throw new HttpError(422, "App user id is required", {
      code: "app_user_id_required",
    });
  }
  if (!input.oauthState.trim()) {
    throw new HttpError(422, "Schwab connect state is invalid", {
      code: "schwab_connect_state_invalid",
    });
  }

  const now = input.now ?? new Date();
  const existing = await findCredential(input.appUserId);
  if (existing?.disabledAt) {
    throw new HttpError(409, "Schwab connection is disabled", {
      code: "schwab_connection_disabled",
    });
  }

  // A fresh connect intentionally resets any previously stored tokens: the new
  // authorization supersedes the old grant (Schwab's 7-day refresh wall makes
  // reconnects routine) and the redirect URI may have moved.
  const pendingValues = {
    status: "pending",
    oauthState: input.oauthState.trim(),
    connectStartedAt: now,
    accessTokenCiphertext: null,
    refreshTokenCiphertext: null,
    tokenKeyVersion: readKeyVersion(input.keyVersion),
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    connectedAt: null,
    updatedAt: now,
  };

  if (existing) {
    const [updated] = await db
      .update(schwabUserCredentialsTable)
      .set(pendingValues)
      .where(eq(schwabUserCredentialsTable.id, existing.id))
      .returning();
    if (!updated) {
      throw new HttpError(500, "Failed to store Schwab connect state", {
        code: "schwab_connect_state_store_failed",
        expose: false,
      });
    }
    return readinessFromCredential(updated, now);
  }

  const [stored] = await db
    .insert(schwabUserCredentialsTable)
    .values({
      appUserId: input.appUserId,
      ...pendingValues,
    })
    .returning();
  if (!stored) {
    throw new HttpError(500, "Failed to store Schwab connect state", {
      code: "schwab_connect_state_store_failed",
      expose: false,
    });
  }
  return readinessFromCredential(stored, now);
}

export async function loadSchwabPendingConnect(
  input: LoadSchwabPendingConnectInput,
): Promise<LoadedSchwabPendingConnect | null> {
  const credential = await findCredential(input.appUserId);
  if (
    !credential ||
    credential.disabledAt ||
    credential.status !== "pending" ||
    !credential.oauthState ||
    !credential.connectStartedAt
  ) {
    return null;
  }
  if (credential.oauthState !== input.oauthState) {
    return null;
  }

  return {
    connectStartedAt: credential.connectStartedAt,
  };
}

export async function storeSchwabTokens(
  input: StoreSchwabTokensInput,
): Promise<SchwabUserReadiness> {
  if (!input.accessToken.trim()) {
    throw new HttpError(422, "Schwab access token is required", {
      code: "schwab_access_token_required",
    });
  }
  const credential = await findCredential(input.appUserId);
  if (!credential || credential.disabledAt) {
    throw new HttpError(409, "Schwab connection is not pending", {
      code: "schwab_connection_not_pending",
    });
  }

  const now = input.now ?? new Date();
  const [updated] = await db
    .update(schwabUserCredentialsTable)
    .set({
      status: "connected",
      oauthState: null,
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
      refreshTokenExpiresAt: input.refreshToken
        ? input.refreshTokenExpiresAt
        : credential.refreshTokenExpiresAt,
      scope: input.scope,
      connectedAt: credential.connectedAt ?? now,
      updatedAt: now,
    })
    .where(eq(schwabUserCredentialsTable.id, credential.id))
    .returning();

  if (!updated) {
    throw new HttpError(500, "Failed to store Schwab tokens", {
      code: "schwab_token_store_failed",
      expose: false,
    });
  }
  return readinessFromCredential(updated, now);
}

export async function loadSchwabTokens(
  input: LoadSchwabTokensInput,
): Promise<LoadedSchwabTokens | null> {
  const credential = await findCredential(input.appUserId);
  if (!credential || credential.disabledAt || credential.status !== "connected") {
    return null;
  }

  return {
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
    refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
  };
}

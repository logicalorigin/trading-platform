import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";

import { db, snapTradeUserCredentialsTable } from "@workspace/db";
import type { SnapTradeUserCredential } from "@workspace/db/schema";
import { HttpError } from "../lib/errors";

export type SnapTradeUserReadinessStatus =
  | "not_registered"
  | "registered"
  | "disabled";

export type SnapTradeUserReadinessNextAction =
  | "register_snaptrade_user"
  | "configure_redirect_uri"
  | "generate_connection_portal"
  | "manual_review";

export type SnapTradeUserReadiness = {
  registered: boolean;
  status: SnapTradeUserReadinessStatus;
  snapTradeUserIdPresent: boolean;
  userSecretStored: boolean;
  registeredAt: string | null;
  disabledAt: string | null;
  nextAction: SnapTradeUserReadinessNextAction;
};

export type RecordSnapTradeUserCredentialInput = {
  appUserId: string;
  snapTradeUserId: string;
  userSecret: string;
  encryptionKey?: string;
  keyVersion?: string;
  now?: Date;
};

export type LoadSnapTradeUserCredentialInput = {
  appUserId: string;
  encryptionKey?: string;
};

export type LoadedSnapTradeUserCredential = {
  snapTradeUserId: string;
  userSecret: string;
};

const CIPHER = "aes-256-gcm";
const CIPHERTEXT_VERSION = "v1";
const IV_BYTES = 12;
const DEFAULT_KEY_VERSION = "v1";

export function deriveSnapTradeUserId(appUserId: string): string {
  const normalized = appUserId.trim().toLowerCase();
  if (!normalized) {
    throw new HttpError(422, "App user id is required", {
      code: "app_user_id_required",
    });
  }
  return `pyrus-${normalized}`;
}

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

export function assertCredentialEncryptionConfigured(input?: string): void {
  readCredentialEncryptionKey(input);
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

function credentialAad(snapTradeUserId: string): Buffer {
  return Buffer.from(`snaptrade:user-secret:${snapTradeUserId}`, "utf8");
}

function sealUserSecret(input: {
  snapTradeUserId: string;
  userSecret: string;
  encryptionKey?: string;
}): string {
  const key = readCredentialEncryptionKey(input.encryptionKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv);
  cipher.setAAD(credentialAad(input.snapTradeUserId));
  const ciphertext = Buffer.concat([
    cipher.update(input.userSecret, "utf8"),
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

function openUserSecret(input: {
  snapTradeUserId: string;
  ciphertext: string;
  encryptionKey?: string;
}): string {
  const parts = input.ciphertext.split(":");
  if (
    parts.length !== 5 ||
    parts[0] !== CIPHER ||
    parts[1] !== CIPHERTEXT_VERSION
  ) {
    throw new HttpError(500, "SnapTrade user secret ciphertext is invalid", {
      code: "snaptrade_user_secret_ciphertext_invalid",
      expose: false,
    });
  }
  const [, , ivRaw, authTagRaw, ciphertextRaw] = parts;
  const decipher = createDecipheriv(
    CIPHER,
    readCredentialEncryptionKey(input.encryptionKey),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAAD(credentialAad(input.snapTradeUserId));
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

function validateRecordInput(input: RecordSnapTradeUserCredentialInput): void {
  if (!input.appUserId.trim()) {
    throw new HttpError(422, "App user id is required", {
      code: "app_user_id_required",
    });
  }
  if (
    !input.snapTradeUserId.trim() ||
    input.snapTradeUserId.trim().length > 128
  ) {
    throw new HttpError(422, "SnapTrade user id is invalid", {
      code: "snaptrade_user_id_invalid",
    });
  }
  if (!input.userSecret.trim()) {
    throw new HttpError(422, "SnapTrade user secret is required", {
      code: "snaptrade_user_secret_required",
    });
  }
}

function safePresent(value: string): boolean {
  return value.trim().length > 0;
}

function readinessFromCredential(
  credential: SnapTradeUserCredential | undefined,
): SnapTradeUserReadiness {
  if (!credential) {
    return {
      registered: false,
      status: "not_registered",
      snapTradeUserIdPresent: false,
      userSecretStored: false,
      registeredAt: null,
      disabledAt: null,
      nextAction: "register_snaptrade_user",
    };
  }

  const disabled = Boolean(credential.disabledAt);
  return {
    registered: !disabled,
    status: disabled ? "disabled" : "registered",
    snapTradeUserIdPresent: safePresent(credential.snapTradeUserId),
    userSecretStored: safePresent(credential.userSecretCiphertext),
    registeredAt: credential.registeredAt.toISOString(),
    disabledAt: credential.disabledAt?.toISOString() ?? null,
    nextAction: disabled ? "manual_review" : "generate_connection_portal",
  };
}

export async function readSnapTradeUserReadiness(
  appUserId: string,
): Promise<SnapTradeUserReadiness> {
  const [credential] = await db
    .select()
    .from(snapTradeUserCredentialsTable)
    .where(eq(snapTradeUserCredentialsTable.appUserId, appUserId))
    .limit(1);

  return readinessFromCredential(credential);
}

export async function recordSnapTradeUserCredential(
  input: RecordSnapTradeUserCredentialInput,
): Promise<SnapTradeUserReadiness> {
  validateRecordInput(input);

  const [existing] = await db
    .select({ id: snapTradeUserCredentialsTable.id })
    .from(snapTradeUserCredentialsTable)
    .where(eq(snapTradeUserCredentialsTable.appUserId, input.appUserId))
    .limit(1);
  if (existing) {
    throw new HttpError(409, "SnapTrade user is already registered", {
      code: "snaptrade_user_already_registered",
    });
  }

  const snapTradeUserId = input.snapTradeUserId.trim();
  const userSecretCiphertext = sealUserSecret({
    snapTradeUserId,
    userSecret: input.userSecret,
    encryptionKey: input.encryptionKey,
  });
  const [stored] = await db
    .insert(snapTradeUserCredentialsTable)
    .values({
      appUserId: input.appUserId,
      snapTradeUserId,
      userSecretCiphertext,
      userSecretKeyVersion: readKeyVersion(input.keyVersion),
      status: "registered",
      registeredAt: input.now ?? new Date(),
    })
    .returning();

  if (!stored) {
    throw new HttpError(500, "Failed to store SnapTrade user credential", {
      code: "snaptrade_user_credential_store_failed",
      expose: false,
    });
  }

  return readinessFromCredential(stored);
}

export async function loadSnapTradeUserCredential(
  input: LoadSnapTradeUserCredentialInput,
): Promise<LoadedSnapTradeUserCredential | null> {
  const [credential] = await db
    .select()
    .from(snapTradeUserCredentialsTable)
    .where(eq(snapTradeUserCredentialsTable.appUserId, input.appUserId))
    .limit(1);
  if (!credential || credential.disabledAt) {
    return null;
  }

  return {
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: openUserSecret({
      snapTradeUserId: credential.snapTradeUserId,
      ciphertext: credential.userSecretCiphertext,
      encryptionKey: input.encryptionKey,
    }),
  };
}

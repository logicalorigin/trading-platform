import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import {
  authSessionsTable,
  dbAuth,
  getPostgresDiagnosticContext,
  type PostgresDiagnosticContext,
  usersTable,
  type User,
} from "@workspace/db";
import { HttpError } from "../lib/errors";

const PASSWORD_SCRYPT_N = 16_384;
const PASSWORD_SCRYPT_R = 8;
const PASSWORD_SCRYPT_P = 1;
const PASSWORD_KEY_LENGTH = 64;
const SESSION_TOKEN_BYTES = 48;
const CSRF_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

export type PublicAuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  entitlements: string[];
};

export type AuthenticatedSession = {
  id: string;
  user: PublicAuthUser;
  csrfTokenHash: string;
  expiresAt: Date;
};

type AuthSessionLookupMemo = Map<
  string,
  Promise<AuthenticatedSession | null>
>;

const authSessionLookupMemoKey: unique symbol = Symbol(
  "authSessionLookupMemo",
);

type AuthSessionLookupMemoContext = PostgresDiagnosticContext & {
  [authSessionLookupMemoKey]?: AuthSessionLookupMemo;
};

export type AuthResult = {
  user: PublicAuthUser;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
};

type BootstrapInput = {
  email: string;
  displayName?: string | null;
  password: string;
  bootstrapToken: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type CreateAuthSessionInput = {
  userId: string;
  expiresAt?: Date;
};

function publicUser(user: User): PublicAuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    entitlements: user.entitlements,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): void {
  if (!email || email.length > 320 || !email.includes("@")) {
    throw new HttpError(422, "Invalid email", { code: "invalid_email" });
  }
}

function validatePassword(password: string): void {
  if (password.length < 12) {
    throw new HttpError(422, "Password must be at least 12 characters", {
      code: "password_too_short",
    });
  }
}

function token(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

function csrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function requestAuthSessionLookupMemo(): AuthSessionLookupMemo | null {
  const context =
    getPostgresDiagnosticContext() as AuthSessionLookupMemoContext | null;
  if (!context) return null;
  context[authSessionLookupMemoKey] ??= new Map();
  return context[authSessionLookupMemoKey];
}

function scrypt(
  password: string,
  salt: string,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function expectedBootstrapToken(): string {
  const value = process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"]?.trim();
  if (!value) {
    throw new HttpError(503, "Bootstrap is not configured", {
      code: "auth_bootstrap_not_configured",
    });
  }
  return value;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: PASSWORD_SCRYPT_N,
    r: PASSWORD_SCRYPT_R,
    p: PASSWORD_SCRYPT_P,
  });
  return [
    "scrypt",
    "v1",
    String(PASSWORD_SCRYPT_N),
    String(PASSWORD_SCRYPT_R),
    String(PASSWORD_SCRYPT_P),
    salt,
    derived.toString("base64url"),
  ].join(":");
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(":");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") {
    return false;
  }
  const [, , n, r, p, salt, expected] = parts;
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return safeEqual(derived.toString("base64url"), expected);
}

export async function createAuthSession(
  input: CreateAuthSessionInput,
): Promise<AuthResult> {
  const sessionToken = token();
  const csrf = csrfToken();
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + DEFAULT_SESSION_TTL_MS);

  const [session] = await dbAuth
    .insert(authSessionsTable)
    .values({
      userId: input.userId,
      tokenHash: sha256Base64Url(sessionToken),
      csrfTokenHash: sha256Base64Url(csrf),
      expiresAt,
    })
    .returning();

  if (!session) {
    throw new HttpError(500, "Failed to create auth session", {
      code: "auth_session_create_failed",
      expose: false,
    });
  }

  const [user] = await dbAuth
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, input.userId))
    .limit(1);
  if (!user) {
    throw new HttpError(404, "User not found", { code: "user_not_found" });
  }

  return {
    user: publicUser(user),
    sessionToken,
    csrfToken: csrf,
    expiresAt,
  };
}

export async function bootstrapInitialUser(
  input: BootstrapInput,
): Promise<AuthResult> {
  const expected = expectedBootstrapToken();
  if (!safeEqual(input.bootstrapToken, expected)) {
    throw new HttpError(401, "Invalid bootstrap token", {
      code: "invalid_bootstrap_token",
    });
  }

  const email = normalizeEmail(input.email);
  validateEmail(email);
  validatePassword(input.password);

  const passwordHash = await hashPassword(input.password);

  // Serialize concurrent bootstrap attempts with a transaction-scoped advisory
  // lock so exactly one admin can ever be created (check-then-insert is atomic).
  const user = await dbAuth.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4066105526)`);
    const [countRow] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(usersTable);
    if (Number(countRow?.value ?? 0) > 0) {
      throw new HttpError(409, "Bootstrap is already complete", {
        code: "bootstrap_already_complete",
      });
    }
    const [created] = await tx
      .insert(usersTable)
      .values({
        email,
        displayName: input.displayName?.trim() || null,
        passwordHash,
        role: "admin",
      })
      .returning();
    return created;
  });

  if (!user) {
    throw new HttpError(500, "Failed to create user", {
      code: "user_create_failed",
      expose: false,
    });
  }

  return createAuthSession({ userId: user.id });
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  validateEmail(email);

  // Password login only ever considers PASSWORD users. Launch (JIT) users have a
  // null password_hash and authenticate via the parent-site handoff; excluding
  // them here also prevents a launch user that shares an email from shadowing an
  // admin's password login.
  const [user] = await dbAuth
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.email, email),
        isNull(usersTable.disabledAt),
        isNotNull(usersTable.passwordHash),
      ),
    )
    .limit(1);

  if (
    !user ||
    !user.passwordHash ||
    !(await verifyPassword(input.password, user.passwordHash))
  ) {
    throw new HttpError(401, "Invalid email or password", {
      code: "invalid_credentials",
    });
  }

  return createAuthSession({ userId: user.id });
}

export async function readAuthSessionFromToken(
  sessionToken: string | null | undefined,
  now?: Date,
): Promise<AuthenticatedSession | null> {
  if (!sessionToken) return null;

  const memo = now === undefined ? requestAuthSessionLookupMemo() : null;
  if (memo) {
    const cached = memo.get(sessionToken);
    if (cached) return cached;

    // Request-scope only: app.ts creates this ALS context per HTTP request.
    // Key by the exact token and cache null too; a mid-request revocation after
    // the first read is observed on the next request, so the first read wins for
    // one in-flight request without extending validity across requests.
    const lookup = readAuthSessionFromTokenUncached(
      sessionToken,
      new Date(),
    ).catch((error) => {
      memo.delete(sessionToken);
      throw error;
    });
    memo.set(sessionToken, lookup);
    return lookup;
  }

  return readAuthSessionFromTokenUncached(sessionToken, now ?? new Date());
}

async function readAuthSessionFromTokenUncached(
  sessionToken: string,
  now: Date,
): Promise<AuthenticatedSession | null> {
  const tokenHash = sha256Base64Url(sessionToken);
  const [row] = await dbAuth
    .select({
      session: authSessionsTable,
      user: usersTable,
    })
    .from(authSessionsTable)
    .innerJoin(usersTable, eq(authSessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(authSessionsTable.tokenHash, tokenHash),
        isNull(authSessionsTable.revokedAt),
        gt(authSessionsTable.expiresAt, now),
        isNull(usersTable.disabledAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    id: row.session.id,
    user: publicUser(row.user),
    csrfTokenHash: row.session.csrfTokenHash,
    expiresAt: row.session.expiresAt,
  };
}

export async function refreshAuthSessionCsrfToken(
  session: AuthenticatedSession,
): Promise<string> {
  const csrf = csrfToken();
  await dbAuth
    .update(authSessionsTable)
    .set({
      csrfTokenHash: sha256Base64Url(csrf),
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(authSessionsTable.id, session.id));
  return csrf;
}

export function validateAuthCsrfToken(
  session: AuthenticatedSession | null | undefined,
  csrf: string | null | undefined,
): boolean {
  if (!session || !csrf) return false;
  return safeEqual(sha256Base64Url(csrf), session.csrfTokenHash);
}

export async function revokeAuthSession(sessionToken: string): Promise<void> {
  await dbAuth
    .update(authSessionsTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(authSessionsTable.tokenHash, sha256Base64Url(sessionToken)));
}

export const __authInternalsForTests = {
  hashPassword,
  verifyPassword,
  sha256Base64Url,
};

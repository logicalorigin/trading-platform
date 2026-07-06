import { importSPKI, jwtVerify, type JWTPayload } from "jose";

type LaunchVerifyKey = Awaited<ReturnType<typeof importSPKI>>;
import { and, eq, lt } from "drizzle-orm";
import { db, launchTokenJtiTable, usersTable, type User } from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { createAuthSession, type AuthResult } from "./auth";
import {
  defaultEntitlementsForPlan,
  normalizeEntitlements,
} from "./entitlements";

// Slice 6: the "Launch Platform" handoff. An external parent site mints a short-lived
// signed JWT (RS256; parent holds the private key, we hold only the public key) that we
// verify + one-time-consume, then JIT find-or-create the user by (issuer, sub) and mint a
// pyrus_session. See SPEC_multitenant-onboarding-ibkr.md §5.1-5.3.
const LAUNCH_JWT_ALG = "RS256";
const CLOCK_TOLERANCE_S = 30;
const MAX_TOKEN_LIFETIME_S = 120; // spec: exp must be short (<= 120s)

let cachedPublicKey: Promise<LaunchVerifyKey> | null = null;

function launchPublicKeyPem(): string | null {
  const raw = process.env["LAUNCH_JWT_PUBLIC_KEY"];
  if (!raw || !raw.trim()) return null;
  // Allow the PEM to be provided as a single-line env var with escaped newlines.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function allowedIssuers(): string[] {
  return (process.env["LAUNCH_JWT_ISSUER"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function launchAudience(): string {
  return (process.env["LAUNCH_JWT_AUDIENCE"] ?? "").trim();
}

// True only when every piece of launch config is present. When false, /auth/launch
// returns 503 (feature not enabled) rather than a misleading auth error.
export function isLaunchAuthConfigured(): boolean {
  return Boolean(
    launchPublicKeyPem() && allowedIssuers().length > 0 && launchAudience(),
  );
}

function launchPublicKey(): Promise<LaunchVerifyKey> {
  const pem = launchPublicKeyPem();
  if (!pem) {
    throw new HttpError(503, "Launch authentication is not configured.", {
      code: "launch_auth_not_configured",
      expose: true,
    });
  }
  if (!cachedPublicKey) {
    cachedPublicKey = importSPKI(pem, LAUNCH_JWT_ALG);
  }
  return cachedPublicKey;
}

const invalidToken = () =>
  new HttpError(401, "Invalid launch token.", {
    code: "launch_token_invalid",
    expose: true,
  });

type LaunchClaims = JWTPayload & {
  email?: unknown;
  name?: unknown;
  plan?: unknown;
  entitlements?: unknown;
};

async function verifyLaunchToken(token: string): Promise<LaunchClaims> {
  const issuers = allowedIssuers();
  const audience = launchAudience();
  if (!issuers.length || !audience) {
    throw new HttpError(503, "Launch authentication is not configured.", {
      code: "launch_auth_not_configured",
      expose: true,
    });
  }
  const key = await launchPublicKey();

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      // Pinning algorithms rejects alg=none and any HS* (symmetric) confusion attack.
      algorithms: [LAUNCH_JWT_ALG],
      audience,
      issuer: issuers,
      clockTolerance: CLOCK_TOLERANCE_S,
    }));
  } catch {
    // Do not leak the specific verification failure to the caller.
    throw invalidToken();
  }

  if (typeof payload.sub !== "string" || !payload.sub.trim()) throw invalidToken();
  if (typeof payload.jti !== "string" || !payload.jti.trim()) throw invalidToken();
  if (typeof payload.iss !== "string" || !payload.iss.trim()) throw invalidToken();
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    throw invalidToken();
  }
  // Reject long-lived tokens even if the signature is valid (limits the replay window).
  if (payload.exp - payload.iat > MAX_TOKEN_LIFETIME_S) throw invalidToken();
  if (typeof payload.email !== "string" || !payload.email.trim()) throw invalidToken();

  return payload as LaunchClaims;
}

// One-time consume: insert the jti; a replay collides on the PK and is rejected.
async function consumeLaunchTokenJti(jti: string, expiresAt: Date): Promise<void> {
  // Opportunistically sweep expired rows so the table stays small.
  await db
    .delete(launchTokenJtiTable)
    .where(lt(launchTokenJtiTable.expiresAt, new Date()))
    .catch((error) => {
      logger.debug?.({ err: error }, "launch_token_jti sweep failed");
    });
  const inserted = await db
    .insert(launchTokenJtiTable)
    .values({ jti, expiresAt })
    .onConflictDoNothing()
    .returning({ jti: launchTokenJtiTable.jti });
  if (!inserted.length) {
    throw new HttpError(401, "Launch token has already been used.", {
      code: "launch_token_replayed",
      expose: true,
    });
  }
}

async function provisionLaunchUser(input: {
  issuer: string;
  sub: string;
  email: string;
  name: string | null;
  plan: string | null;
  entitlements: string[];
}): Promise<User> {
  const findExisting = async () => {
    const [row] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.externalIssuer, input.issuer),
          eq(usersTable.externalUserId, input.sub),
        ),
      )
      .limit(1);
    return row ?? null;
  };

  const existing = await findExisting();
  if (existing) {
    const [updated] = await db
      .update(usersTable)
      .set({
        email: input.email,
        displayName: input.name ?? existing.displayName,
        plan: input.plan ?? existing.plan,
        entitlements: input.entitlements,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      email: input.email,
      displayName: input.name,
      externalIssuer: input.issuer,
      externalUserId: input.sub,
      plan: input.plan,
      entitlements: input.entitlements,
      role: "member",
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Concurrent first-launch won the race; re-read the row it created.
  const row = await findExisting();
  if (!row) {
    throw new HttpError(500, "Failed to provision launch user.", {
      code: "launch_provision_failed",
      expose: false,
    });
  }
  return row;
}

function readStringClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Verify -> one-time consume -> JIT provision -> mint session. Order matters: the jti is
// consumed before provisioning so a valid token can never be replayed even if two requests
// arrive together (the DB PK serializes them).
export async function launchSession(token: string): Promise<AuthResult> {
  const claims = await verifyLaunchToken(token);
  await consumeLaunchTokenJti(
    claims.jti as string,
    new Date((claims.exp as number) * 1_000),
  );
  const plan = readStringClaim(claims.plan);
  // Token entitlements are the source of truth; fall back to a plan-derived
  // default only when the token omits an explicit array (Slice 7).
  let entitlements = normalizeEntitlements(claims.entitlements);
  if (entitlements.length === 0) {
    entitlements = defaultEntitlementsForPlan(plan);
  }
  const user = await provisionLaunchUser({
    issuer: claims.iss as string,
    sub: claims.sub as string,
    email: (claims.email as string).trim(),
    name: readStringClaim(claims.name),
    plan,
    entitlements,
  });
  return createAuthSession({ userId: user.id });
}

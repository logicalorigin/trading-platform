import { Router, type IRouter, type Request, type Response } from "express";
import { HttpError } from "../lib/errors";
import {
  bootstrapInitialUser,
  loginUser,
  readAuthSessionFromToken,
  refreshAuthSessionCsrfToken,
  revokeAuthSession,
  validateAuthCsrfToken,
  type AuthenticatedSession,
} from "../services/auth";
import { isLaunchAuthConfigured, launchSession } from "../services/auth-launch";
import { recordAuditEvent } from "../services/audit-events";
import {
  sessionHasEntitlement,
  type Entitlement,
} from "../services/entitlements";

export const AUTH_SESSION_COOKIE = "pyrus_session";
export const AUTH_CSRF_HEADER = "x-csrf-token";

const router: IRouter = Router();

// In-memory fixed-window rate limiter for auth endpoints. Single-instance
// scope only; a distributed limiter is required before multi-instance deploy.
type RateWindow = { count: number; resetAt: number };
const MAX_RATE_BUCKETS = 10_000;
const rateBuckets = new Map<string, RateWindow>();

function clientIp(req: Request): string {
  return String(req.ip || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function pruneRateBuckets(now: number, protectedKey: string): void {
  for (const [existingKey, window] of rateBuckets) {
    if (existingKey === protectedKey) continue;
    if (window.resetAt <= now) rateBuckets.delete(existingKey);
  }
  if (rateBuckets.size < MAX_RATE_BUCKETS) return;
  const bucketsByReset = Array.from(rateBuckets.entries())
    .filter(([existingKey]) => existingKey !== protectedKey)
    .sort(([, left], [, right]) => left.resetAt - right.resetAt);
  for (const [existingKey] of bucketsByReset) {
    if (rateBuckets.size < MAX_RATE_BUCKETS) break;
    rateBuckets.delete(existingKey);
  }
}

function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (
    rateBuckets.size > MAX_RATE_BUCKETS ||
    (!bucket && rateBuckets.size >= MAX_RATE_BUCKETS)
  ) {
    pruneRateBuckets(now, key);
  }
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw new HttpError(429, "Too many attempts. Please wait and try again.", {
      code: "rate_limited",
    });
  }
  bucket.count += 1;
}

export function __resetAuthRateLimitsForTests(): void {
  rateBuckets.clear();
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readString(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

function isSecureRequest(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (
    String(proto || "")
      .split(",")[0]
      .trim()
      .toLowerCase() === "https"
  );
}

function setSessionCookie(
  req: Request,
  res: Response,
  sessionToken: string,
): void {
  res.cookie(AUTH_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  res.cookie(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    maxAge: 0,
  });
}

export function readSessionToken(req: Request): string | null {
  return readCookie(req, AUTH_SESSION_COOKIE);
}

export async function readRequestAuthSession(
  req: Request,
): Promise<AuthenticatedSession | null> {
  return readAuthSessionFromToken(readSessionToken(req));
}

export async function requireAuth(req: Request): Promise<AuthenticatedSession> {
  const session = await readRequestAuthSession(req);
  if (!session) {
    throw new HttpError(401, "Authentication required", {
      code: "auth_required",
    });
  }
  return session;
}

export async function requireAuthCsrf(
  req: Request,
): Promise<AuthenticatedSession> {
  const session = await requireAuth(req);
  const csrf = req.header(AUTH_CSRF_HEADER);
  if (!validateAuthCsrfToken(session, csrf)) {
    throw new HttpError(403, "CSRF token is invalid or missing", {
      code: "invalid_csrf_token",
    });
  }
  return session;
}

function assertAdmin(session: AuthenticatedSession): AuthenticatedSession {
  if (session.user.role !== "admin") {
    throw new HttpError(403, "Administrator access required", {
      code: "admin_required",
    });
  }
  return session;
}

export async function requireAdmin(
  req: Request,
): Promise<AuthenticatedSession> {
  return assertAdmin(await requireAuth(req));
}

export async function requireAdminCsrf(
  req: Request,
): Promise<AuthenticatedSession> {
  return assertAdmin(await requireAuthCsrf(req));
}

// Any authenticated, non-disabled user (a SaaS "member"). readAuthSessionFromToken
// already excludes disabled users, so this is requireAuth with an explicit,
// intent-revealing name that member-scoped routes use (broker connect/trade,
// account/positions), reserving requireAdmin for platform-ops surfaces.
export async function requireUser(req: Request): Promise<AuthenticatedSession> {
  return requireAuth(req);
}

export async function requireUserCsrf(
  req: Request,
): Promise<AuthenticatedSession> {
  return requireAuthCsrf(req);
}

// Slice 7: gate a member-facing route on a specific entitlement. Curried so it
// composes like the other guards (`await requireEntitlement("broker_connect")(req)`).
// Admins bypass (sessionHasEntitlement); members without the key get 403.
export function requireEntitlement(
  key: Entitlement,
): (req: Request) => Promise<AuthenticatedSession> {
  return async (req: Request) => {
    const session = await requireUser(req);
    if (!sessionHasEntitlement(session, key)) {
      void recordAuditEvent({
        appUserId: session.user.id,
        eventType: "entitlement.denied",
        subject: { type: "entitlement", id: key },
        resource: { type: "route", id: req.path },
        payload: { method: req.method },
      });
      throw new HttpError(403, "This feature requires an upgraded plan.", {
        code: "entitlement_required",
      });
    }
    return session;
  };
}

export function requireEntitlementCsrf(
  key: Entitlement,
): (req: Request) => Promise<AuthenticatedSession> {
  return async (req: Request) => {
    const session = await requireUserCsrf(req);
    if (!sessionHasEntitlement(session, key)) {
      void recordAuditEvent({
        appUserId: session.user.id,
        eventType: "entitlement.denied",
        subject: { type: "entitlement", id: key },
        resource: { type: "route", id: req.path },
        payload: { method: req.method },
      });
      throw new HttpError(403, "This feature requires an upgraded plan.", {
        code: "entitlement_required",
      });
    }
    return session;
  };
}

router.get("/auth/session", async (req, res) => {
  const session = await readRequestAuthSession(req);
  if (!session) {
    res.json({ user: null, csrfToken: null });
    return;
  }
  res.json({
    user: session.user,
    csrfToken: await refreshAuthSessionCsrfToken(session),
  });
});

router.post("/auth/bootstrap", async (req, res) => {
  const ip = clientIp(req);
  enforceRateLimit(`bootstrap:ip:${ip}`, 10, 10 * 60_000);
  enforceRateLimit("bootstrap:global", 30, 10 * 60_000);
  const body = asRecord(req.body);
  const result = await bootstrapInitialUser({
    email: readString(body, "email"),
    displayName: readString(body, "displayName") || null,
    password: readString(body, "password"),
    bootstrapToken: readString(body, "bootstrapToken"),
  });
  void recordAuditEvent({
    appUserId: result.user.id,
    eventType: "auth.bootstrap",
    subject: { type: "user", id: result.user.id },
    payload: { role: result.user.role },
  });
  setSessionCookie(req, res, result.sessionToken);
  res.json({
    user: result.user,
    csrfToken: result.csrfToken,
    expiresAt: result.expiresAt.toISOString(),
  });
});

router.post("/auth/login", async (req, res) => {
  const body = asRecord(req.body);
  const email = readString(body, "email");
  enforceRateLimit(`login:ip:${clientIp(req)}`, 20, 5 * 60_000);
  enforceRateLimit(`login:email:${email.trim().toLowerCase()}`, 10, 5 * 60_000);
  const result = await loginUser({
    email,
    password: readString(body, "password"),
  });
  void recordAuditEvent({
    appUserId: result.user.id,
    eventType: "auth.login",
    subject: { type: "user", id: result.user.id },
    payload: { method: "password" },
  });
  setSessionCookie(req, res, result.sessionToken);
  res.json({
    user: result.user,
    csrfToken: result.csrfToken,
    expiresAt: result.expiresAt.toISOString(),
  });
});

// "Launch Platform" handoff from the external parent site (Slice 6). Verifies a signed,
// short-lived, one-time JWT and mints a pyrus_session. Public (unauthenticated) by design;
// returns 503 when launch auth is not configured. POST (token in body) is preferred so the
// token is not logged; GET (token in query) supports a plain-link launch button and 302s in.
router.post("/auth/launch", async (req, res) => {
  if (!isLaunchAuthConfigured()) {
    throw new HttpError(503, "Launch authentication is not configured.", {
      code: "launch_auth_not_configured",
      expose: true,
    });
  }
  enforceRateLimit(`launch:ip:${clientIp(req)}`, 30, 5 * 60_000);
  const token = readString(asRecord(req.body), "token");
  if (!token) {
    throw new HttpError(400, "Missing launch token.", {
      code: "launch_token_missing",
      expose: true,
    });
  }
  const result = await launchSession(token);
  void recordAuditEvent({
    appUserId: result.user.id,
    eventType: "auth.launch",
    subject: { type: "user", id: result.user.id },
    payload: {
      role: result.user.role,
      entitlements: result.user.entitlements,
      transport: "post",
    },
  });
  setSessionCookie(req, res, result.sessionToken);
  res.json({
    user: result.user,
    csrfToken: result.csrfToken,
    expiresAt: result.expiresAt.toISOString(),
  });
});

router.get("/auth/launch", async (req, res) => {
  if (!isLaunchAuthConfigured()) {
    throw new HttpError(503, "Launch authentication is not configured.", {
      code: "launch_auth_not_configured",
      expose: true,
    });
  }
  enforceRateLimit(`launch:ip:${clientIp(req)}`, 30, 5 * 60_000);
  const token =
    typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    throw new HttpError(400, "Missing launch token.", {
      code: "launch_token_missing",
      expose: true,
    });
  }
  const result = await launchSession(token);
  void recordAuditEvent({
    appUserId: result.user.id,
    eventType: "auth.launch",
    subject: { type: "user", id: result.user.id },
    payload: {
      role: result.user.role,
      entitlements: result.user.entitlements,
      transport: "get",
    },
  });
  setSessionCookie(req, res, result.sessionToken);
  res.redirect(302, "/");
});

router.post("/auth/logout", async (req, res) => {
  await requireAuthCsrf(req);
  const sessionToken = readSessionToken(req);
  if (sessionToken) {
    await revokeAuthSession(sessionToken);
  }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

export default router;

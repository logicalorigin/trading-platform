import { createHash, randomBytes } from "node:crypto";

export const IBKR_PORTAL_EMBED_COOKIE = "pyrus_ibkr_embed";

const GRANT_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 6 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type EmbedIdentity = {
  appUserId: string;
  embedOrigin: string;
  parentOrigin: string;
};

type ExpiringEmbedIdentity = EmbedIdentity & {
  expiresAt: number;
};

type RedeemedEmbedSession = EmbedIdentity & {
  expiresAt: number;
  sessionToken: string;
};

type StoredEmbedSession = ExpiringEmbedIdentity & {
  gatewayCookieNames: Set<string>;
};

const grants = new Map<string, ExpiringEmbedIdentity>();
const sessions = new Map<string, StoredEmbedSession>();

// ponytail: the attended capacity-one host keeps grants in-process; move them
// to a shared TTL store before running multiple API replicas.

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function purgeExpired(now: number): void {
  for (const [key, value] of grants) {
    if (value.expiresAt <= now) grants.delete(key);
  }
  for (const [key, value] of sessions) {
    if (value.expiresAt <= now) sessions.delete(key);
  }
}

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function revokeIbkrPortalEmbedSessions(appUserId: string): void {
  for (const [key, value] of grants) {
    if (value.appUserId === appUserId) grants.delete(key);
  }
  for (const [key, value] of sessions) {
    if (value.appUserId === appUserId) sessions.delete(key);
  }
}

export function issueIbkrPortalEmbedGrant(
  identity: EmbedIdentity,
  now = Date.now(),
): { code: string; expiresAt: number } {
  purgeExpired(now);
  revokeIbkrPortalEmbedSessions(identity.appUserId);
  const code = newToken();
  const expiresAt = now + GRANT_TTL_MS;
  grants.set(tokenDigest(code), { ...identity, expiresAt });
  return { code, expiresAt };
}

export function redeemIbkrPortalEmbedGrant(
  code: string,
  requestOrigin: string,
  now = Date.now(),
): RedeemedEmbedSession | null {
  purgeExpired(now);
  if (!TOKEN_PATTERN.test(code)) return null;
  const grantKey = tokenDigest(code);
  const grant = grants.get(grantKey);
  if (!grant || grant.embedOrigin !== requestOrigin) return null;
  grants.delete(grantKey);

  const sessionToken = newToken();
  const session = {
    ...grant,
    expiresAt: now + SESSION_TTL_MS,
    // IBKR creates these SRP session cookies in browser JavaScript after 2FA,
    // so they cannot be discovered from an upstream Set-Cookie response.
    gatewayCookieNames: new Set(["XYZAB", "XYZAB_AM.LOGIN"]),
  };
  sessions.set(tokenDigest(sessionToken), session);
  return { ...grant, expiresAt: session.expiresAt, sessionToken };
}

export function readIbkrPortalEmbedSession(
  cookieHeader: string | undefined,
  requestOrigin: string,
  now = Date.now(),
): (ExpiringEmbedIdentity & { gatewayCookieNames: string[] }) | null {
  purgeExpired(now);
  const token = readCookie(cookieHeader, IBKR_PORTAL_EMBED_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const session = sessions.get(tokenDigest(token));
  if (!session || session.embedOrigin !== requestOrigin) return null;
  return {
    ...session,
    gatewayCookieNames: [...session.gatewayCookieNames].sort(),
  };
}

export function rememberIbkrPortalEmbedCookieNames(
  cookieHeader: string | undefined,
  requestOrigin: string,
  names: string[],
  now = Date.now(),
): void {
  purgeExpired(now);
  const token = readCookie(cookieHeader, IBKR_PORTAL_EMBED_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return;
  const session = sessions.get(tokenDigest(token));
  if (!session || session.embedOrigin !== requestOrigin) return;
  // ponytail: 64 gateway cookies is far above observed CPG use; raise only if
  // an attended login proves a larger legitimate set.
  for (const name of names.slice(0, 64)) {
    if (
      name.length <= 128 &&
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    ) {
      session.gatewayCookieNames.add(name);
    }
  }
}

export function __resetIbkrPortalEmbedSessionsForTests(): void {
  grants.clear();
  sessions.clear();
}

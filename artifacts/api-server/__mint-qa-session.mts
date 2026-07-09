// Throwaway QA session mint for API probes + authenticated screenshots.
// Mutates exactly ONE row via the app's own createAuthSession service (no user
// creation, no other writes). Picks an existing admin user (fallback: earliest
// non-disabled user) — never creates one. Delete after use.
import { writeFileSync } from "node:fs";
import { asc, eq, isNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { createAuthSession } from "./src/services/auth";

const OUT_DIR =
  "/tmp/claude-1000/-home-runner-workspace/fccb627d-8452-4d5f-8c32-0c59dd098930/scratchpad";
const SESSION_JSON = `${OUT_DIR}/qa-session.json`;
const STORAGE_STATE_JSON = `${OUT_DIR}/qa-storage-state.json`;

const host = String(process.env.REPLIT_DEV_DOMAIN || "").trim();
if (!host) {
  console.error("REPLIT_DEV_DOMAIN not set");
  process.exit(1);
}

// Prefer an existing admin; fall back to the earliest non-disabled user. Only
// id + role selected (no email/PII).
let [candidate] = await db
  .select({ id: usersTable.id, role: usersTable.role })
  .from(usersTable)
  .where(eq(usersTable.role, "admin"))
  .orderBy(asc(usersTable.createdAt))
  .limit(1);

if (!candidate) {
  [candidate] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(isNull(usersTable.disabledAt))
    .orderBy(asc(usersTable.createdAt))
    .limit(1);
}

if (!candidate) {
  console.error("no suitable user found (no admin, no non-disabled user)");
  process.exit(1);
}

const result = await createAuthSession({ userId: candidate.id });

const createdAt = new Date().toISOString();

writeFileSync(
  SESSION_JSON,
  JSON.stringify(
    {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      userId: candidate.id,
      userRole: candidate.role,
      cookieName: "pyrus_session",
      createdAt,
      expiresAt: result.expiresAt.toISOString(),
      revoke:
        "To revoke: call revokeAuthSession(sessionToken) from artifacts/api-server/src/services/auth.ts (hashes the token and sets auth_sessions.revoked_at). Not run automatically — do this at session end if desired.",
    },
    null,
    2,
  ),
);

writeFileSync(
  STORAGE_STATE_JSON,
  JSON.stringify({
    cookies: [
      {
        name: "pyrus_session",
        value: result.sessionToken,
        domain: host,
        path: "/",
        expires: Math.floor(result.expiresAt.getTime() / 1000),
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [],
  }),
);

// Non-secret confirmation only.
console.log("wrote:", SESSION_JSON);
console.log("wrote:", STORAGE_STATE_JSON);
console.log("userId:", candidate.id, "role:", candidate.role);
console.log("expiresAt:", result.expiresAt.toISOString());
process.exit(0);

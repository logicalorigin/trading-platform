// Throwaway dev/QA helper: mint a pyrus_session for agentic visual testing.
// Reuses the real createAuthSession so the session is indistinguishable from a login.
// Usage: tsx __mint-agent-session.mts [email]
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createAuthSession } from "./src/services/auth.ts";

const email = process.argv[2] ?? "riley@rileybishop.com";
const [user] = await db
  .select()
  .from(usersTable)
  .where(eq(usersTable.email, email))
  .limit(1);
if (!user) {
  console.error(JSON.stringify({ error: "user_not_found", email }));
  process.exit(1);
}
const res = await createAuthSession({ userId: user.id });
console.log(
  JSON.stringify({
    ok: true,
    email,
    userId: user.id,
    sessionToken: res.sessionToken,
    csrfToken: res.csrfToken,
    expiresAt: res.expiresAt,
  }),
);
process.exit(0);

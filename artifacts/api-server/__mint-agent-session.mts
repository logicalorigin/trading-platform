import { writeFileSync } from "node:fs";
import { asc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { createAuthSession } from "./src/services/auth";

// Mint an agent session for the primary (oldest) user so the headless browser
// can operate the app, and write it straight into a Playwright storageState file.
// The token is NEVER printed to stdout — it only lands in the storageState file.
// (2026-07-08: previous hard-coded QA admin id no longer exists in users — FK error.)
const [primaryUser] = await db
  .select({ id: usersTable.id, email: usersTable.email })
  .from(usersTable)
  .orderBy(asc(usersTable.createdAt))
  .limit(1);
if (!primaryUser) {
  console.error("no users exist in the database");
  process.exit(1);
}
const OUT =
  "/tmp/claude-1000/-home-runner-workspace/f1d3f876-a734-44d1-9d9e-7015d0354220/scratchpad/pyrus-agent-storage.json";

const host = String(process.env.REPLIT_DEV_DOMAIN || "").trim();
if (!host) {
  console.error("REPLIT_DEV_DOMAIN not set");
  process.exit(1);
}

const r = await createAuthSession({ userId: primaryUser.id });
const storageState = {
  cookies: [
    {
      name: "pyrus_session",
      value: r.sessionToken,
      domain: host,
      path: "/",
      expires: Math.floor(r.expiresAt.getTime() / 1000),
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ],
  origins: [
    {
      origin: `https://${host}`,
      localStorage: [
        {
          name: "pyrus:state:v1",
          value: JSON.stringify({
            theme: "dark",
            userPreferences: { appearance: { theme: "dark" } },
          }),
        },
      ],
    },
  ],
};
writeFileSync(OUT, JSON.stringify(storageState));
// Print only non-secret confirmation.
console.log("wrote storageState:", OUT);
console.log("user:", (r.user as { email?: string }).email ?? "(unknown)");
console.log("expires:", r.expiresAt.toISOString());
process.exit(0);

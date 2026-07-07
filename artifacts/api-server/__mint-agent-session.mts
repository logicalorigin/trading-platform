import { writeFileSync } from "node:fs";
import { createAuthSession } from "./src/services/auth";

// Mint an agent session for the existing QA/temp admin so the headless browser
// can operate the app, and write it straight into a Playwright storageState file.
// The token is NEVER printed to stdout — it only lands in the storageState file.
const QA_ADMIN_ID = "cc74ab92-6faf-4f2f-b3ef-891ac19a6a19";
const OUT =
  "/tmp/claude-1000/-home-runner-workspace/242a10dc-de69-44b3-b08c-00c1d0471796/scratchpad/pyrus-agent-storage.json";

const host = String(process.env.REPLIT_DEV_DOMAIN || "").trim();
if (!host) {
  console.error("REPLIT_DEV_DOMAIN not set");
  process.exit(1);
}

const r = await createAuthSession({ userId: QA_ADMIN_ID });
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
  origins: [],
};
writeFileSync(OUT, JSON.stringify(storageState));
// Print only non-secret confirmation.
console.log("wrote storageState:", OUT);
console.log("user:", (r.user as { email?: string }).email ?? "(unknown)");
console.log("expires:", r.expiresAt.toISOString());
process.exit(0);

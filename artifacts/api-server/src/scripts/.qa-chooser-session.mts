// Throwaway admin session for visual QA of the broker chooser. Delete after use.
import { db, usersTable } from "@workspace/db";
import { createAuthSession } from "../services/auth";

const EMAIL = "qa-chooser-temp@example.invalid";

const [user] = await db
  .insert(usersTable)
  .values({ email: EMAIL, passwordHash: "unusable-qa-hash", role: "admin" })
  .returning();
if (!user) throw new Error("failed to create QA user");
const session = await createAuthSession({ userId: user.id });
console.log(JSON.stringify({ sessionToken: session.sessionToken }));
process.exit(0);

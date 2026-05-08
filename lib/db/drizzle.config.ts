import { defineConfig } from "drizzle-kit";
import path from "path";

const resolvedDatabaseUrl =
  process.env.LOCAL_DATABASE_URL ?? process.env.DATABASE_URL;

if (!resolvedDatabaseUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: resolvedDatabaseUrl,
  },
});

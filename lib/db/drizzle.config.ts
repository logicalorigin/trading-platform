import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveDatabaseRuntimeConfig } from "./src/runtime";

const resolvedDatabaseUrl = resolveDatabaseRuntimeConfig().url;

if (!resolvedDatabaseUrl) {
  throw new Error("LOCAL_DATABASE_URL or DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: resolvedDatabaseUrl,
  },
});

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const readTimeoutMs = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: readTimeoutMs("DB_CONNECTION_TIMEOUT_MS", 3_000),
  query_timeout: readTimeoutMs("DB_QUERY_TIMEOUT_MS", 8_000),
  statement_timeout: readTimeoutMs("DB_STATEMENT_TIMEOUT_MS", 8_000),
});
export const db = drizzle(pool, { schema });

export * from "./schema";

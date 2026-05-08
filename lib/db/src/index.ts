import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const readOptionalPositiveInteger = (name: string): number | undefined => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

const readPositiveInteger = (name: string, fallback: number): number => {
  return readOptionalPositiveInteger(name) ?? fallback;
};

const optionalIntegerOption = (
  envName: string,
  optionName: string,
): Record<string, number> => {
  const value = readOptionalPositiveInteger(envName);
  return value === undefined ? {} : { [optionName]: value };
};

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const defaultPoolMax = (): number => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname === "helium" ? 3 : 10;
  } catch {
    return 10;
  }
};

const isHeliumDatabase = (): boolean => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname === "helium";
  } catch {
    return false;
  }
};

const heliumDatabase = isHeliumDatabase();
const defaultConnectionTimeoutMillis = heliumDatabase ? 1_000 : undefined;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: readPositiveInteger("DB_POOL_MAX", defaultPoolMax()),
  ...(heliumDatabase ? { ssl: false } : {}),
  ...(readOptionalPositiveInteger("DB_CONNECTION_TIMEOUT_MS") !== undefined ||
  defaultConnectionTimeoutMillis !== undefined
    ? {
        connectionTimeoutMillis:
          readOptionalPositiveInteger("DB_CONNECTION_TIMEOUT_MS") ??
          defaultConnectionTimeoutMillis,
      }
    : {}),
  ...optionalIntegerOption("DB_QUERY_TIMEOUT_MS", "query_timeout"),
  ...optionalIntegerOption("DB_STATEMENT_TIMEOUT_MS", "statement_timeout"),
  ...optionalIntegerOption("DB_IDLE_TIMEOUT_MS", "idleTimeoutMillis"),
});
export const db = drizzle(pool, { schema });

export * from "./schema";

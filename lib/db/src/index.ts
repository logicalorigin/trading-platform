import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { attachPostgresPoolErrorHandler } from "./pool-error-handler";
import { resolveDatabaseRuntimeConfig } from "./runtime";
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

const databaseRuntimeConfig = resolveDatabaseRuntimeConfig();
const resolvedDatabaseUrl = databaseRuntimeConfig.url;

if (!resolvedDatabaseUrl) {
  throw new Error(
    "Database connection env must be set. Did you forget to provision a database?",
  );
}

const defaultPoolMax = (): number => {
  try {
    // A single dashboard request fans out into ~10 concurrent shadow sub-reads
    // alongside background mark-refresh writers; a pool of 6 saturates and the
    // resulting acquire timeouts get misread as a DB outage. helium's server
    // max_connections has ample headroom, so allow more pooled connections.
    return new URL(resolvedDatabaseUrl).hostname === "helium" ? 12 : 10;
  } catch {
    return 10;
  }
};

const isHeliumDatabase = (): boolean => {
  try {
    return new URL(resolvedDatabaseUrl).hostname === "helium";
  } catch {
    return false;
  }
};

const heliumDatabase = isHeliumDatabase();
const defaultConnectionTimeoutMillis = heliumDatabase ? 30_000 : undefined;

export const pool = new Pool({
  connectionString: resolvedDatabaseUrl,
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
attachPostgresPoolErrorHandler(pool);
export const db = drizzle(pool, { schema });

export {
  attachPostgresClientErrorHandler,
  attachPostgresPoolErrorHandler,
} from "./pool-error-handler";
export * from "./runtime";
export * from "./schema";

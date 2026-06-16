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
const resolvedPoolMax = readPositiveInteger("DB_POOL_MAX", defaultPoolMax());

export const pool = new Pool({
  connectionString: resolvedDatabaseUrl,
  max: resolvedPoolMax,
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

export type PostgresPoolStats = {
  /** Configured maximum pooled connections (`max`). */
  max: number;
  /** Connections currently open (idle + checked-out). */
  total: number;
  /** Idle connections available for immediate checkout. */
  idle: number;
  /** Checked-out connections in active use (`total - idle`). */
  active: number;
  /** Acquire requests queued because every connection is checked out. */
  waiting: number;
};

/**
 * Point-in-time snapshot of the shared Postgres pool. Observability only:
 * `waiting > 0` means callers are blocked waiting for a connection (pool
 * saturation), which surfaces as acquire timeouts and stale-cache "degraded"
 * reads. Reads live node-postgres counters; takes no connection itself.
 */
export function getPoolStats(): PostgresPoolStats {
  const total = pool.totalCount;
  const idle = pool.idleCount;
  return {
    max: resolvedPoolMax,
    total,
    idle,
    active: Math.max(0, total - idle),
    waiting: pool.waitingCount,
  };
}

export {
  attachPostgresClientErrorHandler,
  attachPostgresPoolErrorHandler,
} from "./pool-error-handler";
export * from "./runtime";
export * from "./schema";

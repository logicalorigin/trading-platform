import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { attachPostgresPoolErrorHandler } from "./pool-error-handler";
import { resolveDatabaseRuntimeConfig } from "./runtime";
import * as schema from "./schema";

const { Pool } = pg;

export type PostgresPoolDiagnosticEvent = {
  type: "acquire" | "query";
  source: "pool" | "client";
  durationMs: number;
  sql: string | null;
  queryName: string | null;
  error: string | null;
  pool: PostgresPoolStats;
  stack: string[];
};

type PostgresPoolDiagnosticListener = (
  event: PostgresPoolDiagnosticEvent,
) => void;

let postgresPoolDiagnosticListener: PostgresPoolDiagnosticListener | null = null;

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

const slowAcquireDiagnosticMs = (): number =>
  readPositiveInteger("DB_POOL_SLOW_ACQUIRE_DIAGNOSTIC_MS", 500);

const slowQueryDiagnosticMs = (): number =>
  readPositiveInteger("DB_QUERY_SLOW_DIAGNOSTIC_MS", 2_000);

export function setPostgresPoolDiagnosticListener(
  listener: PostgresPoolDiagnosticListener | null,
): void {
  postgresPoolDiagnosticListener = listener;
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 600);
}

function queryText(args: unknown[]): string | null {
  const query = args[0];
  if (typeof query === "string") {
    return compactSql(query);
  }
  if (query && typeof query === "object" && "text" in query) {
    const text = (query as { text?: unknown }).text;
    return typeof text === "string" ? compactSql(text) : null;
  }
  return null;
}

function queryName(args: unknown[]): string | null {
  const query = args[0];
  if (query && typeof query === "object" && "name" in query) {
    const name = (query as { name?: unknown }).name;
    return typeof name === "string" ? name.slice(0, 120) : null;
  }
  return null;
}

function diagnosticStack(): string[] {
  return (new Error().stack ?? "")
    .split("\n")
    .slice(3)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.includes("/lib/db/src/index.ts") &&
        !line.includes("node_modules/pg/"),
    )
    .slice(0, 8);
}

function emitPostgresPoolDiagnostic(input: {
  type: "acquire" | "query";
  source: "pool" | "client";
  startedAtMs: number;
  sql?: string | null;
  queryName?: string | null;
  error?: unknown;
}): void {
  const listener = postgresPoolDiagnosticListener;
  if (!listener) return;

  const durationMs = Math.round(Date.now() - input.startedAtMs);
  const failed = Boolean(input.error);
  const threshold =
    input.type === "acquire"
      ? slowAcquireDiagnosticMs()
      : slowQueryDiagnosticMs();
  if (!failed && durationMs < threshold) {
    return;
  }

  try {
    listener({
      type: input.type,
      source: input.source,
      durationMs,
      sql: input.sql ?? null,
      queryName: input.queryName ?? null,
      error: errorMessage(input.error),
      pool: getPoolStats(),
      stack: diagnosticStack(),
    });
  } catch {
    // Diagnostics must not affect database behavior.
  }
}

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
    // resulting acquire timeouts get misread as a DB outage. helium's provider
    // plan HARD-CAPS at 12 client connections — the Postgres max_connections GUC
    // is higher but is NOT the binding limit, so 12 is the ceiling. Do not raise
    // it: relief must come from reducing concurrent demand, not more connections.
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
// Circuit-breaker for the hard 12-connection ceiling: one query stalled for tens
// of seconds (lock wait, contention-stalled scan) pins a scarce connection and
// cascades into pool-acquire timeouts that surface as flapping "degraded"/error
// reads. Cap server-side execution so a stalled query releases its connection
// instead of hanging to the 30s acquire timeout. 15s sits well above the slowest
// legitimate query (GET /bars ~6s p95) and far above normal writes (ms), so it
// only fires on pathological stalls. Override with DB_STATEMENT_TIMEOUT_MS.
const defaultStatementTimeoutMillis = heliumDatabase ? 15_000 : undefined;
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
  ...(readOptionalPositiveInteger("DB_STATEMENT_TIMEOUT_MS") !== undefined ||
  defaultStatementTimeoutMillis !== undefined
    ? {
        statement_timeout:
          readOptionalPositiveInteger("DB_STATEMENT_TIMEOUT_MS") ??
          defaultStatementTimeoutMillis,
      }
    : {}),
  ...optionalIntegerOption("DB_IDLE_TIMEOUT_MS", "idleTimeoutMillis"),
});
attachPostgresPoolErrorHandler(pool);

const instrumentedClients = new WeakSet<object>();

function instrumentQuery(
  originalQuery: (...args: unknown[]) => unknown,
  source: "pool" | "client",
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const startedAtMs = Date.now();
    const sql = queryText(args);
    const name = queryName(args);
    const lastArg = args[args.length - 1];

    if (typeof lastArg === "function") {
      const callback = lastArg as (...callbackArgs: unknown[]) => unknown;
      const wrappedArgs = [...args];
      wrappedArgs[wrappedArgs.length - 1] = (...callbackArgs: unknown[]) => {
        emitPostgresPoolDiagnostic({
          type: "query",
          source,
          startedAtMs,
          sql,
          queryName: name,
          error: callbackArgs[0],
        });
        return callback(...callbackArgs);
      };
      try {
        return originalQuery(...wrappedArgs);
      } catch (error) {
        emitPostgresPoolDiagnostic({
          type: "query",
          source,
          startedAtMs,
          sql,
          queryName: name,
          error,
        });
        throw error;
      }
    }

    try {
      const result = originalQuery(...args);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<unknown>).then(
          (value) => {
            emitPostgresPoolDiagnostic({
              type: "query",
              source,
              startedAtMs,
              sql,
              queryName: name,
            });
            return value;
          },
          (error) => {
            emitPostgresPoolDiagnostic({
              type: "query",
              source,
              startedAtMs,
              sql,
              queryName: name,
              error,
            });
            throw error;
          },
        );
      }
      emitPostgresPoolDiagnostic({
        type: "query",
        source,
        startedAtMs,
        sql,
        queryName: name,
      });
      return result;
    } catch (error) {
      emitPostgresPoolDiagnostic({
        type: "query",
        source,
        startedAtMs,
        sql,
        queryName: name,
        error,
      });
      throw error;
    }
  };
}

function instrumentClient(client: pg.PoolClient): pg.PoolClient {
  if (instrumentedClients.has(client)) {
    return client;
  }
  instrumentedClients.add(client);
  const queryable = client as unknown as {
    query: (...args: unknown[]) => unknown;
  };
  queryable.query = instrumentQuery(queryable.query.bind(client), "client");
  return client;
}

function instrumentPostgresPoolDiagnostics(targetPool: pg.Pool): void {
  const queryablePool = targetPool as unknown as {
    query: (...args: unknown[]) => unknown;
    connect: (...args: unknown[]) => unknown;
  };
  const originalQuery = queryablePool.query.bind(targetPool);
  const originalConnect = queryablePool.connect.bind(targetPool);

  queryablePool.query = instrumentQuery(originalQuery, "pool");
  queryablePool.connect = (...args: unknown[]) => {
    const startedAtMs = Date.now();
    const callback = args[0];

    if (typeof callback === "function") {
      return originalConnect((error: unknown, client: pg.PoolClient, done: unknown) => {
        emitPostgresPoolDiagnostic({
          type: "acquire",
          source: "pool",
          startedAtMs,
          error,
        });
        return (callback as (...callbackArgs: unknown[]) => unknown)(
          error,
          client ? instrumentClient(client) : client,
          done,
        );
      });
    }

    const result = originalConnect();
    if (result && typeof (result as Promise<pg.PoolClient>).then === "function") {
      return (result as Promise<pg.PoolClient>).then(
        (client) => {
          emitPostgresPoolDiagnostic({
            type: "acquire",
            source: "pool",
            startedAtMs,
          });
          return instrumentClient(client);
        },
        (error) => {
          emitPostgresPoolDiagnostic({
            type: "acquire",
            source: "pool",
            startedAtMs,
            error,
          });
          throw error;
        },
      );
    }
    emitPostgresPoolDiagnostic({
      type: "acquire",
      source: "pool",
      startedAtMs,
    });
    return result;
  };
}

instrumentPostgresPoolDiagnostics(pool);
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

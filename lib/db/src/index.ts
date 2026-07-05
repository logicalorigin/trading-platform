import { AsyncLocalStorage } from "node:async_hooks";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { attachPostgresPoolErrorHandler } from "./pool-error-handler";
import { resolveDatabaseRuntimeConfig } from "./runtime";
import * as schema from "./schema";

const { Pool } = pg;

export type PostgresDiagnosticContext = {
  requestId?: string | null;
  method?: string | null;
  path?: string | null;
  route?: string | null;
  routeClass?: string | null;
  requestFamily?: string | null;
  clientRole?: string | null;
  fetchPriority?: number | null;
  requestOrigin?: string | null;
  admissionAction?: string | null;
  workloadFamily?: string | null;
};

export type PostgresPoolDiagnosticEvent = {
  type: "acquire" | "query";
  source: "pool" | "client";
  durationMs: number;
  sql: string | null;
  queryName: string | null;
  error: string | null;
  pool: PostgresPoolStats;
  stack: string[];
  context: PostgresDiagnosticContext | null;
};

type PostgresPoolDiagnosticListener = (
  event: PostgresPoolDiagnosticEvent,
) => void;

let postgresPoolDiagnosticListener: PostgresPoolDiagnosticListener | null = null;
const postgresDiagnosticContext =
  new AsyncLocalStorage<PostgresDiagnosticContext>();

export function runWithPostgresDiagnosticContext<T>(
  context: PostgresDiagnosticContext,
  fn: () => T,
): T {
  return postgresDiagnosticContext.run(context, fn);
}

export function getPostgresDiagnosticContext(): PostgresDiagnosticContext | null {
  return postgresDiagnosticContext.getStore() ?? null;
}

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

// Per-event stack capture is OFF by default. `new Error().stack` formats a deep
// async/drizzle/pg stack, and on the slow-query/acquire firehose (~1,100 events/sec
// when the pool saturates) that V8 stack formatting is the single largest
// event-loop CPU cost — and it is self-amplifying, because the events fire
// *because* the loop is already saturated, which inflates every in-flight query's
// measured duration and trips more of them over the gate. The captured frames are
// mostly pg/drizzle internals the filter in diagnosticStack() strips anyway. Set
// DB_DIAGNOSTIC_CAPTURE_STACK=1 (or =true) to re-enable for targeted debugging.
const DB_DIAGNOSTIC_CAPTURE_STACK =
  process.env.DB_DIAGNOSTIC_CAPTURE_STACK === "1" ||
  process.env.DB_DIAGNOSTIC_CAPTURE_STACK === "true";

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
  if (!DB_DIAGNOSTIC_CAPTURE_STACK) return [];
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
  // Raw query args, NOT a precomputed sql string. `queryText`/`compactSql` run a
  // regex over up to 600 chars, and computing that for every (overwhelmingly fast)
  // query was unconditional per-query overhead on the hot path. We derive sql/name
  // lazily below, only AFTER the slow/failed gate returns, so fast queries — the
  // vast majority — never pay it.
  queryArgs?: unknown[];
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

  const args = input.queryArgs;
  try {
    listener({
      type: input.type,
      source: input.source,
      durationMs,
      sql: args ? queryText(args) : null,
      queryName: args ? queryName(args) : null,
      error: errorMessage(input.error),
      pool: getPoolStats(),
      stack: diagnosticStack(),
      context: getPostgresDiagnosticContext(),
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
    // resulting acquire timeouts get misread as a DB outage. 12 is a DELIBERATE
    // self-imposed policy, NOT a provider hard cap: helium's max_connections is
    // 112 and the role connection limit is unlimited (verified 2026-07-05 — 38+
    // concurrent connections succeed). Keep it low anyway, but for the right
    // reason: the binding constraint is single-thread result parsing on the event
    // loop, not connection count, so a bigger pool only piles more result sets
    // onto that one thread and lets bar-read storms crowd out other writers.
    // Relief comes from reducing demand, not raising this.
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
    const lastArg = args[args.length - 1];

    if (typeof lastArg === "function") {
      const callback = lastArg as (...callbackArgs: unknown[]) => unknown;
      const wrappedArgs = [...args];
      wrappedArgs[wrappedArgs.length - 1] = (...callbackArgs: unknown[]) => {
        emitPostgresPoolDiagnostic({
          type: "query",
          source,
          startedAtMs,
          queryArgs: args,
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
          queryArgs: args,
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
              queryArgs: args,
            });
            return value;
          },
          (error) => {
            emitPostgresPoolDiagnostic({
              type: "query",
              source,
              startedAtMs,
              queryArgs: args,
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
        queryArgs: args,
      });
      return result;
    } catch (error) {
      emitPostgresPoolDiagnostic({
        type: "query",
        source,
        startedAtMs,
        queryArgs: args,
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

/**
 * Drizzle client over the shared production pool. This is the value `db`
 * resolves to in every non-test code path; the test seam below NEVER swaps it
 * unless `__setDbForTests` is explicitly called, so production behavior is
 * unchanged.
 */
export type WorkspaceDatabase = NodePgDatabase<typeof schema>;

const productionDb: WorkspaceDatabase = drizzle(pool, { schema });

// Mutable indirection so a test harness can point `db` at an in-process
// PGlite-backed drizzle instance for the duration of a test, then restore the
// real one. Initialized to (and, in production, permanently) the real client.
let activeDb: WorkspaceDatabase = productionDb;

/**
 * `db` is a thin forwarding Proxy over `activeDb`. Existing callers
 * (`db.execute(...)`, `db.select()...`, `db.insert()...`) are unchanged: every
 * property access/method call is forwarded to whatever `activeDb` currently is.
 * In production `activeDb` is always `productionDb`, so this Proxy adds a single
 * property-lookup indirection and nothing else.
 */
export const db: WorkspaceDatabase = new Proxy({} as WorkspaceDatabase, {
  get(_target, property) {
    const value = Reflect.get(
      activeDb as object,
      property,
      activeDb as object,
    );
    // Bind functions to the live `activeDb` so `this` is correct after the
    // Proxy forwards the lookup. Drizzle's query builders rely on `this`.
    return typeof value === "function" ? value.bind(activeDb) : value;
  },
  has(_target, property) {
    return Reflect.has(activeDb as object, property);
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(activeDb as object);
  },
}) as WorkspaceDatabase;

/**
 * TEST-ONLY seam. Swaps the drizzle instance that `db` forwards to and returns
 * a restore function that reinstates the previous one. Never invoked by
 * production code. The argument is intentionally typed structurally so a
 * `PgliteDatabase` (a different concrete drizzle class that still extends the
 * same `PgDatabase` base) can be injected without leaking PGlite types into the
 * production surface.
 */
export function __setDbForTests(next: WorkspaceDatabase): () => void {
  const previous = activeDb;
  activeDb = next;
  return () => {
    activeDb = previous;
  };
}

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
export {
  createAdvisoryLockHolder,
  sharedAdvisoryLockHolder,
  type AdvisoryLockRelease,
} from "./advisory-lock";
export * from "./runtime";
export * from "./schema";
export * from "./retention";

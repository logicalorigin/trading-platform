import {
  describeDatabaseRuntimeConnection,
  type DatabaseRuntimeDescription,
} from "./runtime";
import {
  isTransientPostgresError,
  summarizeTransientPostgresError,
  type TransientPostgresErrorSummary,
} from "./transient-postgres-error";

type PoolLike = object & {
  on(
    event: "error",
    listener: (error: Error, client: unknown) => void,
  ): unknown;
};

type ClientLike = object & {
  on(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
  removeListener?(event: "error", listener: (error: Error) => void): unknown;
};

type SafeDatabaseRuntimeDescription = Omit<DatabaseRuntimeDescription, "url">;

export type PostgresPoolErrorReport = {
  event: "postgres-pool-error";
  transient: boolean;
  error: TransientPostgresErrorSummary;
  database: SafeDatabaseRuntimeDescription;
  client: {
    processID: number | null;
    database: string | null;
  };
};

export type PostgresClientErrorReport = Omit<
  PostgresPoolErrorReport,
  "event"
> & {
  event: "postgres-client-error";
  context: string | null;
};

export type PostgresPoolErrorReporter = (
  report: PostgresPoolErrorReport,
) => void;

export type PostgresClientErrorReporter = (
  report: PostgresClientErrorReport,
) => void;

type PostgresPoolErrorHandlerOptions = {
  reporter?: PostgresPoolErrorReporter;
  describeRuntime?: () => SafeDatabaseRuntimeDescription;
};

type PostgresClientErrorHandlerOptions = {
  reporter?: PostgresClientErrorReporter;
  describeRuntime?: () => SafeDatabaseRuntimeDescription;
  context?: string;
  onError?: (error: Error) => void;
};

let attachedPools = new WeakSet<object>();

function safeDatabaseRuntimeDescription(): SafeDatabaseRuntimeDescription {
  const { url: _url, ...description } = describeDatabaseRuntimeConnection();
  return description;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function summarizePoolClient(client: unknown): PostgresPoolErrorReport["client"] {
  const record = asRecord(client);
  const processID = record["processID"];
  const database = record["database"];
  return {
    processID: typeof processID === "number" ? processID : null,
    database: typeof database === "string" ? database : null,
  };
}

function defaultPostgresPoolErrorReporter(report: PostgresPoolErrorReport): void {
  const level = report.transient ? "warn" : "error";
  process.stderr.write(`${JSON.stringify({ level, ...report })}\n`);
}

function defaultPostgresClientErrorReporter(
  report: PostgresClientErrorReport,
): void {
  const level = report.transient ? "warn" : "error";
  process.stderr.write(`${JSON.stringify({ level, ...report })}\n`);
}

export function attachPostgresPoolErrorHandler(
  pool: PoolLike,
  options: PostgresPoolErrorHandlerOptions = {},
): boolean {
  if (attachedPools.has(pool)) {
    return false;
  }
  attachedPools.add(pool);

  const reporter = options.reporter ?? defaultPostgresPoolErrorReporter;
  const describeRuntime =
    options.describeRuntime ?? safeDatabaseRuntimeDescription;

  pool.on("error", (error: Error, client: unknown) => {
    try {
      reporter({
        event: "postgres-pool-error",
        transient: isTransientPostgresError(error),
        error: summarizeTransientPostgresError(error),
        database: describeRuntime(),
        client: summarizePoolClient(client),
      });
    } catch {
      // An error listener must never become a new uncaught exception path.
    }
  });

  return true;
}

export function attachPostgresClientErrorHandler(
  client: ClientLike,
  options: PostgresClientErrorHandlerOptions = {},
): () => void {
  const reporter = options.reporter ?? defaultPostgresClientErrorReporter;
  const describeRuntime =
    options.describeRuntime ?? safeDatabaseRuntimeDescription;

  const listener = (error: Error) => {
    try {
      options.onError?.(error);
      reporter({
        event: "postgres-client-error",
        transient: isTransientPostgresError(error),
        error: summarizeTransientPostgresError(error),
        database: describeRuntime(),
        client: summarizePoolClient(client),
        context: options.context ?? null,
      });
    } catch {
      // A client error listener must never become a new uncaught exception path.
    }
  };

  client.on("error", listener);

  return () => {
    try {
      if (typeof client.off === "function") {
        client.off("error", listener);
        return;
      }
      client.removeListener?.("error", listener);
    } catch {
      // Detach is best-effort during process shutdown and failed connections.
    }
  };
}

export function __resetPostgresPoolErrorHandlerForTests(pool?: object): void {
  if (pool) {
    attachedPools.delete(pool);
    return;
  }
  attachedPools = new WeakSet<object>();
}

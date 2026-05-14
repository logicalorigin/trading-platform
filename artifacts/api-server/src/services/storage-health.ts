import { describeDatabaseRuntimeConnection, pool } from "@workspace/db";
import {
  isTransientPostgresError,
  summarizeTransientPostgresError,
  type TransientPostgresErrorSummary,
} from "../lib/transient-db-error";

export type StorageHealthStatus = "ok" | "degraded" | "unavailable";
export type StorageHealthSource =
  | "workspace-local-postgres"
  | "replit-internal-dev-db"
  | "external-postgres";

export type StorageHealthSnapshot = {
  source: StorageHealthSource | null;
  sourceEnv: "DATABASE_URL" | "LOCAL_DATABASE_URL" | null;
  overrideActive: boolean;
  configured: boolean;
  status: StorageHealthStatus;
  reachable: boolean;
  readWriteVerified: boolean;
  checkedAt: string;
  protocol: string | null;
  host: string | null;
  port: string | null;
  database: string | null;
  user: string | null;
  sslMode: string | null;
  pingMs: number | null;
  reason: string | null;
  error: string | null;
  transient: boolean;
  dbError?: TransientPostgresErrorSummary;
};

type StorageHealthProbe = () => Promise<void>;

let storageHealthProbeForTests: StorageHealthProbe | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function describeDatabaseUrl(): Omit<
  StorageHealthSnapshot,
  | "status"
  | "reachable"
  | "checkedAt"
  | "pingMs"
  | "readWriteVerified"
  | "reason"
  | "error"
  | "transient"
  | "dbError"
> & { parseError: string | null } {
  return describeDatabaseRuntimeConnection();
}

function buildSnapshot(
  input: Partial<StorageHealthSnapshot> & {
    status: StorageHealthStatus;
    reachable: boolean;
    reason: string | null;
    error: string | null;
    pingMs: number | null;
    transient?: boolean;
    dbError?: TransientPostgresErrorSummary;
  },
): StorageHealthSnapshot {
  const connection = describeDatabaseUrl();
  return {
    source: connection.source,
    sourceEnv: connection.sourceEnv,
    overrideActive: connection.overrideActive,
    configured: connection.configured,
    protocol: connection.protocol,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    sslMode: connection.sslMode,
    checkedAt: nowIso(),
    status: input.status,
    reachable: input.reachable,
    readWriteVerified: input.status === "ok" && input.reachable,
    pingMs: input.pingMs,
    reason: input.reason,
    error: input.error,
    transient: input.transient ?? false,
    ...(input.dbError ? { dbError: input.dbError } : {}),
  };
}

let cachedStorageHealth = buildSnapshot({
  status: "unavailable",
  reachable: false,
  reason: "storage_probe_pending",
  error: null,
  pingMs: null,
});

async function defaultStorageHealthProbe(): Promise<void> {
  const client = await pool.connect();
  const probeId = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await client.query("begin");
    await client.query(
      "create temp table if not exists rayalgo_storage_health_probe (id text primary key, value text not null) on commit drop",
    );
    await client.query(
      "insert into rayalgo_storage_health_probe (id, value) values ($1, $2)",
      [probeId, "ok"],
    );
    const result = await client.query(
      "select value from rayalgo_storage_health_probe where id = $1",
      [probeId],
    );
    if (result.rows[0]?.value !== "ok") {
      throw new Error("Postgres read/write probe did not return the inserted row.");
    }
    await client.query("commit");
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function getCachedStorageHealthSnapshot(): StorageHealthSnapshot {
  return cachedStorageHealth;
}

export async function refreshStorageHealthSnapshot(): Promise<StorageHealthSnapshot> {
  const connection = describeDatabaseUrl();
  if (!connection.configured) {
    cachedStorageHealth = buildSnapshot({
      status: "unavailable",
      reachable: false,
      reason: "database_url_missing",
      error: "DATABASE_URL is not set.",
      pingMs: null,
    });
    return cachedStorageHealth;
  }
  if (connection.parseError) {
    cachedStorageHealth = buildSnapshot({
      status: "unavailable",
      reachable: false,
      reason: "database_url_invalid",
      error: connection.parseError,
      pingMs: null,
    });
    return cachedStorageHealth;
  }

  const startedAt = Date.now();
  try {
    await (storageHealthProbeForTests ?? defaultStorageHealthProbe)();
    cachedStorageHealth = buildSnapshot({
      status: "ok",
      reachable: true,
      reason: null,
      error: null,
      pingMs: Date.now() - startedAt,
    });
    return cachedStorageHealth;
  } catch (error) {
    const transient = isTransientPostgresError(error);
    cachedStorageHealth = buildSnapshot({
      status: "unavailable",
      reachable: false,
      reason: transient ? "postgres_unreachable" : "postgres_probe_failed",
      error: error instanceof Error ? error.message : String(error),
      pingMs: Date.now() - startedAt,
      transient,
      dbError: summarizeTransientPostgresError(error),
    });
    return cachedStorageHealth;
  }
}

export function markStorageHealthDegraded(
  reason: string,
  error: unknown,
): StorageHealthSnapshot {
  cachedStorageHealth = {
    ...cachedStorageHealth,
    status: "degraded",
    reachable: true,
    checkedAt: nowIso(),
    reason,
    error: error instanceof Error ? error.message : String(error),
    transient: isTransientPostgresError(error),
    dbError: summarizeTransientPostgresError(error),
  };
  return cachedStorageHealth;
}

export function __setStorageHealthProbeForTests(probe: StorageHealthProbe | null): void {
  storageHealthProbeForTests = probe;
}

export function __resetStorageHealthForTests(): void {
  storageHealthProbeForTests = null;
  cachedStorageHealth = buildSnapshot({
    status: "unavailable",
    reachable: false,
    reason: "storage_probe_pending",
    error: null,
    pingMs: null,
  });
}

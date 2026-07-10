import {
  describeDatabaseRuntimeConnection,
  pool,
} from "@workspace/db";
import * as dbExports from "@workspace/db";
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
  sourceEnv: "DATABASE_URL" | "LOCAL_DATABASE_URL" | "PGHOST" | null;
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
  // pingMs is the END-TO-END probe wall time, NOT DB round-trip latency: it wraps
  // background-lane admission wait, pool-acquire wait, and statement/commit exec.
  // Kept for compatibility; use the components below to attribute app-side queueing
  // vs. actual DB work. Fresh-connection DB RTT is ~2-5ms (see wo-db-pressure-report).
  pingMs: number | null;
  // Background admission lane (cap 2) queue wait before the probe starts.
  laneWaitMs: number | null;
  // pool.connect() wait once admitted (pool saturation shows up here).
  acquireMs: number | null;
  // Actual statement execution + synchronous-commit WAL flush (the real DB signal).
  execMs: number | null;
  reason: string | null;
  error: string | null;
  transient: boolean;
  dbError?: TransientPostgresErrorSummary;
};

type StorageHealthProbeTimings = {
  laneWaitMs: number;
  acquireMs: number;
  execMs: number;
};
type StorageHealthProbe = () => Promise<StorageHealthProbeTimings | void>;
type DbLaneRunner = <T>(lane: "background", fn: () => T) => T;

let storageHealthProbeForTests: StorageHealthProbe | null = null;
const DEFAULT_STORAGE_HEALTH_PROBE_INTERVAL_MS = 5 * 60 * 1000;
const runInDbLane = (
  dbExports as typeof dbExports & { runInDbLane: DbLaneRunner }
).runInDbLane;

function nowIso(): string {
  return new Date().toISOString();
}

function describeDatabaseUrl(): Omit<
  StorageHealthSnapshot,
  | "status"
  | "reachable"
  | "checkedAt"
  | "pingMs"
  | "laneWaitMs"
  | "acquireMs"
  | "execMs"
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
    laneWaitMs?: number | null;
    acquireMs?: number | null;
    execMs?: number | null;
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
    laneWaitMs: input.laneWaitMs ?? null,
    acquireMs: input.acquireMs ?? null,
    execMs: input.execMs ?? null,
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

async function defaultStorageHealthProbe(): Promise<StorageHealthProbeTimings> {
  const laneRequestedAt = Date.now();
  return runInDbLane("background", async () => {
    const admittedAt = Date.now();
    const client = await pool.connect();
    try {
      const acquiredAt = Date.now();
      const probeId = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await client.query("begin");
      await client.query(
        "create temp table if not exists pyrus_storage_health_probe (id text primary key, value text not null) on commit drop",
      );
      await client.query(
        "insert into pyrus_storage_health_probe (id, value) values ($1, $2)",
        [probeId, "ok"],
      );
      const result = await client.query(
        "select value from pyrus_storage_health_probe where id = $1",
        [probeId],
      );
      if (result.rows[0]?.value !== "ok") {
        throw new Error("Postgres read/write probe did not return the inserted row.");
      }
      await client.query("commit");
      return {
        laneWaitMs: admittedAt - laneRequestedAt,
        acquireMs: acquiredAt - admittedAt,
        execMs: Date.now() - acquiredAt,
      };
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  });
}

function storageHealthProbeIntervalMs(): number {
  const parsed = Number(process.env["STORAGE_HEALTH_PROBE_INTERVAL_MS"]);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_STORAGE_HEALTH_PROBE_INTERVAL_MS;
}

function canReuseCachedStorageHealth(nowMs: number): boolean {
  if (storageHealthProbeForTests) {
    return false;
  }
  if (cachedStorageHealth.reason === "storage_probe_pending") {
    return false;
  }
  const checkedAtMs = Date.parse(cachedStorageHealth.checkedAt);
  return (
    Number.isFinite(checkedAtMs) &&
    nowMs - checkedAtMs < storageHealthProbeIntervalMs()
  );
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
      error: "DATABASE_URL or Replit PG env is not set.",
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
  if (canReuseCachedStorageHealth(Date.now())) {
    return cachedStorageHealth;
  }

  const startedAt = Date.now();
  try {
    const timings = await (storageHealthProbeForTests ?? defaultStorageHealthProbe)();
    cachedStorageHealth = buildSnapshot({
      status: "ok",
      reachable: true,
      reason: null,
      error: null,
      pingMs: Date.now() - startedAt,
      laneWaitMs: timings?.laneWaitMs ?? null,
      acquireMs: timings?.acquireMs ?? null,
      execMs: timings?.execMs ?? null,
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

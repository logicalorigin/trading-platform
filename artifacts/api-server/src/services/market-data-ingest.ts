import { and, count, desc, eq, lte, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import type { GexResponse } from "./gex";

export type MarketDataIngestJobKind =
  | "stock_snapshot"
  | "option_chain_snapshot"
  | "gex_snapshot";
// Reserved future worker jobs: stock_bars, option_flow_events, flow_summary.

export type MarketDataIngestJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type EnqueueMarketDataJobInput = {
  kind: MarketDataIngestJobKind;
  symbol: string;
  timeframe?: string | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  priority?: number;
  maxAttempts?: number;
  nextRunAt?: Date | null;
  payload?: Record<string, unknown> | null;
  dedupeKey?: string;
};

export type EnqueueMarketDataJobResult = {
  queued: boolean;
  dedupeKey: string;
  reason?: string;
};

export type LatestGexSnapshot = {
  payload: GexResponse;
  computedAt: Date;
  ageMs: number;
  stale: boolean;
};

export type BlockedGexJobDiagnostic = {
  symbol: string;
  dedupeBucket: string;
  createdAt: Date;
  ageMs: number;
  missingKind: "stock_snapshot" | "option_chain_snapshot";
  prerequisiteStatus: "missing" | "failed";
  lastError: string | null;
};

const INGEST_JOB_DEFAULT_MAX_ATTEMPTS = 3;
export const SUPPORTED_MARKET_DATA_INGEST_JOB_KINDS = [
  "stock_snapshot",
  "option_chain_snapshot",
  "gex_snapshot",
] as const satisfies readonly MarketDataIngestJobKind[];

const SUPPORTED_MARKET_DATA_INGEST_JOB_KIND_SET = new Set<string>(
  SUPPORTED_MARKET_DATA_INGEST_JOB_KINDS,
);
const FORWARD_REFRESH_JOB_KINDS = [
  "stock_snapshot",
  "option_chain_snapshot",
  "gex_snapshot",
] as const satisfies readonly MarketDataIngestJobKind[];

type DbModule = {
  db: any;
  pool: {
    query: <T = unknown>(
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: T[] }>;
  };
  marketDataIngestJobsTable: any;
  gexSnapshotsTable: any;
  providerRequestLogTable: any;
};

async function loadDbModule(): Promise<DbModule | null> {
  if (!isMarketDataIngestDatabaseConfigured()) {
    return null;
  }
  try {
    return (await import("@workspace/db")) as unknown as DbModule;
  } catch (error) {
    logger.debug({ err: error }, "Market data ingest database module unavailable");
    return null;
  }
}

const isoOrEmpty = (value: Date | null | undefined): string =>
  value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toISOString()
    : "";

const stablePayloadPart = (
  payload: Record<string, unknown> | null | undefined,
): string => {
  const dedupeBucket = payload?.["dedupeBucket"];
  return dedupeBucket == null ? "" : String(dedupeBucket);
};

function numericDedupeBucket(
  payload: Record<string, unknown> | null | undefined,
): number | null {
  const value = payload?.["dedupeBucket"];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

async function cancelSupersededForwardRefreshJobs(
  pool: DbModule["pool"],
  symbol: string,
  payload: Record<string, unknown> | null | undefined,
): Promise<void> {
  const dedupeBucket = numericDedupeBucket(payload);
  if (dedupeBucket == null) {
    return;
  }

  await pool.query(
    `
    update market_data_ingest_jobs
       set status = 'cancelled',
           lease_owner = null,
           lease_expires_at = null,
           last_heartbeat_at = null,
           last_error = concat('superseded by newer market-data refresh bucket ', $2::text),
           updated_at = now()
     where symbol = $1
       and kind = any($3::text[])
       and status in ('queued', 'running', 'failed')
       and coalesce(payload->>'dedupeBucket', '') ~ '^[0-9]+$'
       and (payload->>'dedupeBucket')::bigint < $2::bigint
    `,
    [symbol, dedupeBucket, [...FORWARD_REFRESH_JOB_KINDS]],
  );
}

export function isMarketDataIngestDatabaseConfigured(): boolean {
  return Boolean(
    process.env["DATABASE_URL"] ||
      process.env["LOCAL_DATABASE_URL"] ||
      (process.env["PGHOST"] && process.env["PGDATABASE"] && process.env["PGUSER"]),
  );
}

export function isMarketDataIngestProviderConfigured(): boolean {
  return Boolean(
    process.env["MASSIVE_API_KEY"] ||
      process.env["MASSIVE_MARKET_DATA_API_KEY"] ||
      process.env["POLYGON_API_KEY"] ||
      process.env["POLYGON_KEY"],
  );
}

export function isMarketDataIngestConfigured(): boolean {
  return (
    isMarketDataIngestDatabaseConfigured() &&
    isMarketDataIngestProviderConfigured()
  );
}

export function buildIngestDedupeKey(input: EnqueueMarketDataJobInput): string {
  const symbol = normalizeSymbol(input.symbol);
  return [
    input.kind,
    symbol,
    input.timeframe?.trim() ?? "",
    isoOrEmpty(input.windowStart),
    isoOrEmpty(input.windowEnd),
    stablePayloadPart(input.payload),
  ].join(":");
}

export function isSupportedMarketDataIngestJobKind(
  kind: string,
): kind is MarketDataIngestJobKind {
  return SUPPORTED_MARKET_DATA_INGEST_JOB_KIND_SET.has(kind);
}

export async function enqueueMarketDataJob(
  input: EnqueueMarketDataJobInput,
): Promise<EnqueueMarketDataJobResult> {
  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return {
      queued: false,
      dedupeKey: input.dedupeKey ?? "",
      reason: "invalid_symbol",
    };
  }

  const dedupeKey = input.dedupeKey ?? buildIngestDedupeKey({ ...input, symbol });
  if (!isSupportedMarketDataIngestJobKind(input.kind)) {
    return { queued: false, dedupeKey, reason: "unsupported_kind" };
  }
  if (!isMarketDataIngestProviderConfigured()) {
    return { queued: false, dedupeKey, reason: "provider_unconfigured" };
  }

  const dbModule = await loadDbModule();
  if (!dbModule) {
    return { queued: false, dedupeKey, reason: "database_unconfigured" };
  }

  const { db, pool, marketDataIngestJobsTable } = dbModule;
  const priority =
    Number.isFinite(input.priority) && (input.priority ?? 0) > 0
      ? Math.floor(input.priority as number)
      : 5;
  const maxAttempts =
    Number.isFinite(input.maxAttempts) && (input.maxAttempts ?? 0) > 0
      ? Math.floor(input.maxAttempts as number)
      : INGEST_JOB_DEFAULT_MAX_ATTEMPTS;
  const now = new Date();

  try {
    await db
      .insert(marketDataIngestJobsTable)
      .values({
        kind: input.kind,
        symbol,
        timeframe: input.timeframe?.trim() || null,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null,
        priority,
        status: "queued",
        attemptCount: 0,
        maxAttempts,
        nextRunAt: input.nextRunAt ?? now,
        dedupeKey,
        payload: input.payload ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: marketDataIngestJobsTable.dedupeKey,
        set: {
          priority: sql`least(${marketDataIngestJobsTable.priority}, excluded.priority)`,
          status: sql`case when ${marketDataIngestJobsTable.status} in ('completed', 'failed', 'cancelled') then 'queued' else ${marketDataIngestJobsTable.status} end`,
          attemptCount: sql`case when ${marketDataIngestJobsTable.status} in ('completed', 'failed', 'cancelled') then 0 else ${marketDataIngestJobsTable.attemptCount} end`,
          maxAttempts: sql`greatest(${marketDataIngestJobsTable.maxAttempts}, excluded.max_attempts)`,
          leaseOwner: sql`case when ${marketDataIngestJobsTable.status} in ('completed', 'failed', 'cancelled') then null else ${marketDataIngestJobsTable.leaseOwner} end`,
          leaseExpiresAt: sql`case when ${marketDataIngestJobsTable.status} in ('completed', 'failed', 'cancelled') then null else ${marketDataIngestJobsTable.leaseExpiresAt} end`,
          lastHeartbeatAt: sql`case when ${marketDataIngestJobsTable.status} in ('completed', 'failed', 'cancelled') then null else ${marketDataIngestJobsTable.lastHeartbeatAt} end`,
          nextRunAt: sql`least(coalesce(${marketDataIngestJobsTable.nextRunAt}, excluded.next_run_at), excluded.next_run_at)`,
          payload: sql`coalesce(excluded.payload, ${marketDataIngestJobsTable.payload})`,
          lastError: sql`case when ${marketDataIngestJobsTable.status} in ('completed', 'failed', 'cancelled') then null else ${marketDataIngestJobsTable.lastError} end`,
          updatedAt: now,
        },
      });
    await cancelSupersededForwardRefreshJobs(pool, symbol, input.payload ?? null);
    return { queued: true, dedupeKey };
  } catch (error) {
    logger.debug(
      { err: error, kind: input.kind, symbol, dedupeKey },
      "Failed to enqueue market data ingest job",
    );
    return { queued: false, dedupeKey, reason: "database_error" };
  }
}

function isGexResponsePayload(payload: unknown): payload is GexResponse {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      typeof (payload as { ticker?: unknown }).ticker === "string" &&
      typeof (payload as { spot?: unknown }).spot === "number" &&
      Array.isArray((payload as { options?: unknown }).options) &&
      Array.isArray((payload as { snapshots?: unknown }).snapshots),
  );
}

export async function getLatestGexSnapshot(
  symbolInput: string,
  maxAgeMs: number,
): Promise<LatestGexSnapshot | null> {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    return null;
  }
  const dbModule = await loadDbModule();
  if (!dbModule) {
    return null;
  }

  const { db, gexSnapshotsTable } = dbModule;
  try {
    const [row] = await db
      .select({
        computedAt: gexSnapshotsTable.computedAt,
        payload: gexSnapshotsTable.payload,
      })
      .from(gexSnapshotsTable)
      .where(eq(gexSnapshotsTable.symbol, symbol))
      .orderBy(desc(gexSnapshotsTable.computedAt))
      .limit(1);
    if (!row || !isGexResponsePayload(row.payload)) {
      return null;
    }

    const ageMs = Math.max(0, Date.now() - row.computedAt.getTime());
    return {
      payload: row.payload,
      computedAt: row.computedAt,
      ageMs,
      stale: ageMs > maxAgeMs,
    };
  } catch (error) {
    logger.debug(
      { err: error, symbol },
      "Failed to read latest GEX ingest snapshot",
    );
    return null;
  }
}

export async function getMarketDataIngestDiagnostics(): Promise<{
  configured: boolean;
  providerConfigured: boolean;
  queueDepth: Record<string, number>;
  oldestQueuedAgeMs: number | null;
  runningCount: number;
  expiredLeaseCount: number;
  blockedGexJobCount: number;
  oldestBlockedGexAgeMs: number | null;
  blockedGexJobs: BlockedGexJobDiagnostic[];
  recentProviderFailures: Array<{
    provider: string;
    endpointFamily: string;
    symbol: string | null;
    status: string;
    httpStatus: number | null;
    errorMessage: string | null;
    createdAt: Date;
  }>;
  recentCompletedJobs: Array<{
    kind: string;
    symbol: string;
    updatedAt: Date;
  }>;
}> {
  const dbModule = await loadDbModule();
  if (!dbModule) {
    return {
      configured: false,
      providerConfigured: isMarketDataIngestProviderConfigured(),
      queueDepth: {},
      oldestQueuedAgeMs: null,
      runningCount: 0,
      expiredLeaseCount: 0,
      blockedGexJobCount: 0,
      oldestBlockedGexAgeMs: null,
      blockedGexJobs: [],
      recentProviderFailures: [],
      recentCompletedJobs: [],
    };
  }

  const { db, pool, marketDataIngestJobsTable, providerRequestLogTable } = dbModule;
  const now = new Date();
  try {
    const depthRows = await db
      .select({
        status: marketDataIngestJobsTable.status,
        value: count(),
      })
      .from(marketDataIngestJobsTable)
      .groupBy(marketDataIngestJobsTable.status);
    const [oldestQueued] = await db
      .select({ createdAt: marketDataIngestJobsTable.createdAt })
      .from(marketDataIngestJobsTable)
      .where(eq(marketDataIngestJobsTable.status, "queued"))
      .orderBy(marketDataIngestJobsTable.createdAt)
      .limit(1);
    const [running] = await db
      .select({ value: count() })
      .from(marketDataIngestJobsTable)
      .where(eq(marketDataIngestJobsTable.status, "running"));
    const [expired] = await db
      .select({ value: count() })
      .from(marketDataIngestJobsTable)
      .where(
        and(
          eq(marketDataIngestJobsTable.status, "running"),
          lte(marketDataIngestJobsTable.leaseExpiresAt, now),
        ),
      );
    const recentProviderFailures = await db
      .select({
        provider: providerRequestLogTable.provider,
        endpointFamily: providerRequestLogTable.endpointFamily,
        symbol: providerRequestLogTable.symbol,
        status: providerRequestLogTable.status,
        httpStatus: providerRequestLogTable.httpStatus,
        errorMessage: providerRequestLogTable.errorMessage,
        createdAt: providerRequestLogTable.createdAt,
      })
      .from(providerRequestLogTable)
      .where(ne(providerRequestLogTable.status, "ok"))
      .orderBy(desc(providerRequestLogTable.createdAt))
      .limit(5);
    const recentCompletedJobs = await db
      .select({
        kind: marketDataIngestJobsTable.kind,
        symbol: marketDataIngestJobsTable.symbol,
        updatedAt: marketDataIngestJobsTable.updatedAt,
      })
      .from(marketDataIngestJobsTable)
      .where(eq(marketDataIngestJobsTable.status, "completed"))
      .orderBy(desc(marketDataIngestJobsTable.updatedAt))
      .limit(10);
    const blockedGex = mapBlockedGexDiagnosticsRows(
      (
        await pool.query<BlockedGexRow>(BLOCKED_GEX_DIAGNOSTICS_SQL)
      ).rows,
      now,
    );

    return {
      configured: isMarketDataIngestConfigured(),
      providerConfigured: isMarketDataIngestProviderConfigured(),
      queueDepth: Object.fromEntries(
        depthRows.map((row: { status: string; value: unknown }) => [
          row.status,
          Number(row.value),
        ]),
      ),
      oldestQueuedAgeMs: oldestQueued
        ? Math.max(0, now.getTime() - oldestQueued.createdAt.getTime())
        : null,
      runningCount: Number(running?.value ?? 0),
      expiredLeaseCount: Number(expired?.value ?? 0),
      blockedGexJobCount: blockedGex.count,
      oldestBlockedGexAgeMs: blockedGex.oldestAgeMs,
      blockedGexJobs: blockedGex.jobs,
      recentProviderFailures,
      recentCompletedJobs,
    };
  } catch (error) {
    logger.debug({ err: error }, "Failed to read market data ingest diagnostics");
    return {
      configured: isMarketDataIngestConfigured(),
      providerConfigured: isMarketDataIngestProviderConfigured(),
      queueDepth: {},
      oldestQueuedAgeMs: null,
      runningCount: 0,
      expiredLeaseCount: 0,
      blockedGexJobCount: 0,
      oldestBlockedGexAgeMs: null,
      blockedGexJobs: [],
      recentProviderFailures: [],
      recentCompletedJobs: [],
    };
  }
}

type BlockedGexRow = {
  symbol: string;
  dedupe_bucket: string;
  created_at: Date | string;
  missing_kind: "stock_snapshot" | "option_chain_snapshot";
  prerequisite_status: "missing" | "failed";
  last_error: string | null;
  total_count: number | string;
  oldest_created_at: Date | string | null;
};

const BLOCKED_GEX_DIAGNOSTICS_SQL = `
with queued_gex as (
  select
    id,
    symbol,
    created_at,
    coalesce(payload->>'dedupeBucket', '') as dedupe_bucket
  from market_data_ingest_jobs
  where kind = 'gex_snapshot'
    and status = 'queued'
    and coalesce(payload->>'dedupeBucket', '') <> ''
),
evaluated as (
  select
    gex.*,
    stock_completed.id is not null as stock_completed,
    option_completed.id is not null as option_completed,
    stock_failed.id is not null as stock_failed,
    option_failed.id is not null as option_failed,
    stock_failed.last_error as stock_failed_error,
    option_failed.last_error as option_failed_error
  from queued_gex gex
  left join lateral (
    select id
    from market_data_ingest_jobs prerequisite
    where prerequisite.symbol = gex.symbol
      and prerequisite.kind = 'stock_snapshot'
      and prerequisite.status = 'completed'
      and coalesce(prerequisite.payload->>'dedupeBucket', '') = gex.dedupe_bucket
    limit 1
  ) stock_completed on true
  left join lateral (
    select id
    from market_data_ingest_jobs prerequisite
    where prerequisite.symbol = gex.symbol
      and prerequisite.kind = 'option_chain_snapshot'
      and prerequisite.status = 'completed'
      and coalesce(prerequisite.payload->>'dedupeBucket', '') = gex.dedupe_bucket
    limit 1
  ) option_completed on true
  left join lateral (
    select id, last_error
    from market_data_ingest_jobs prerequisite
    where prerequisite.symbol = gex.symbol
      and prerequisite.kind = 'stock_snapshot'
      and prerequisite.status = 'failed'
      and coalesce(prerequisite.payload->>'dedupeBucket', '') = gex.dedupe_bucket
    order by prerequisite.updated_at desc
    limit 1
  ) stock_failed on true
  left join lateral (
    select id, last_error
    from market_data_ingest_jobs prerequisite
    where prerequisite.symbol = gex.symbol
      and prerequisite.kind = 'option_chain_snapshot'
      and prerequisite.status = 'failed'
      and coalesce(prerequisite.payload->>'dedupeBucket', '') = gex.dedupe_bucket
    order by prerequisite.updated_at desc
    limit 1
  ) option_failed on true
),
blocked as (
  select
    symbol,
    dedupe_bucket,
    created_at,
    case
      when not stock_completed then 'stock_snapshot'
      else 'option_chain_snapshot'
    end as missing_kind,
    case
      when not stock_completed and stock_failed then 'failed'
      when stock_completed and not option_completed and option_failed then 'failed'
      else 'missing'
    end as prerequisite_status,
    case
      when not stock_completed then stock_failed_error
      else option_failed_error
    end as last_error
  from evaluated
  where not (stock_completed and option_completed)
)
select
  symbol,
  dedupe_bucket,
  created_at,
  missing_kind,
  prerequisite_status,
  last_error,
  count(*) over()::bigint as total_count,
  min(created_at) over() as oldest_created_at
from blocked
order by created_at asc
limit 10
`;

const toValidDate = (value: Date | string | null | undefined): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

function mapBlockedGexDiagnosticsRows(
  rows: BlockedGexRow[],
  now: Date,
): {
  count: number;
  oldestAgeMs: number | null;
  jobs: BlockedGexJobDiagnostic[];
} {
  const first = rows[0];
  const oldestCreatedAt = toValidDate(first?.oldest_created_at);
  return {
    count: Number(first?.total_count ?? 0),
    oldestAgeMs: oldestCreatedAt
      ? Math.max(0, now.getTime() - oldestCreatedAt.getTime())
      : null,
    jobs: rows.flatMap((row) => {
      const createdAt = toValidDate(row.created_at);
      if (!createdAt) {
        return [];
      }
      return [
        {
          symbol: row.symbol,
          dedupeBucket: row.dedupe_bucket,
          createdAt,
          ageMs: Math.max(0, now.getTime() - createdAt.getTime()),
          missingKind: row.missing_kind,
          prerequisiteStatus: row.prerequisite_status,
          lastError: row.last_error,
        },
      ];
    }),
  };
}

export const __marketDataIngestInternalsForTests = {
  numericDedupeBucket,
  mapBlockedGexDiagnosticsRows,
};

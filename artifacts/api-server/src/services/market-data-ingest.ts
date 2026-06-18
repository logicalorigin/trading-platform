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

export type LatestChartGexSnapshotOptions = {
  maxExpirations: number;
  strikesAroundMoney: number;
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

export type ClaimableQueuedJobsDiagnostic = {
  count: number;
  byKind: Record<string, number>;
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

  // A running option-chain/GEX prerequisite may be the only path to unblock the
  // next GEX job; let the worker finish it instead of discarding useful work.
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
       and status in ('queued', 'failed')
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
      process.env["MASSIVE_MARKET_DATA_API_KEY"],
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrFallback(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function parseGexSourceStatus(value: unknown): GexResponse["source"]["status"] {
  return value === "ok" || value === "partial" || value === "unavailable"
    ? value
    : "partial";
}

function parseGexProvider(value: unknown): GexResponse["source"]["provider"] {
  return value === "ibkr" ? "ibkr" : "massive";
}

function parseExpirationCoverage(
  value: unknown,
): GexResponse["source"]["expirationCoverage"] {
  const record = asRecord(value);
  return {
    requestedCount: numberOrFallback(record?.["requestedCount"], 0),
    returnedCount: numberOrFallback(record?.["returnedCount"], 0),
    loadedCount: numberOrFallback(record?.["loadedCount"], 0),
    failedCount: numberOrFallback(record?.["failedCount"], 0),
    complete: record?.["complete"] === true,
    capped: record?.["capped"] === true,
  };
}

function parseConfidenceCounts(
  value: unknown,
): GexResponse["source"]["flowClassificationConfidenceCounts"] {
  const record = asRecord(value);
  return {
    high: numberOrFallback(record?.["high"], 0),
    medium: numberOrFallback(record?.["medium"], 0),
    low: numberOrFallback(record?.["low"], 0),
    none: numberOrFallback(record?.["none"], 0),
  };
}

function parseBasisCounts(
  value: unknown,
): GexResponse["source"]["flowClassificationBasisCounts"] {
  const record = asRecord(value);
  return {
    quoteMatch: numberOrFallback(record?.["quoteMatch"], 0),
    tickTest: numberOrFallback(record?.["tickTest"], 0),
    none: numberOrFallback(record?.["none"], 0),
  };
}

function compactGexSnapshotPayload(input: {
  symbol: string;
  computedAt: Date;
  ticker: unknown;
  spot: unknown;
  timestamp: unknown;
  netGex: unknown;
  options: unknown;
  source: unknown;
  flowContext: unknown;
  flowContextStatus: unknown;
}): GexResponse | null {
  const spot = numberOrFallback(input.spot, 0);
  const options = Array.isArray(input.options)
    ? (input.options as GexResponse["options"])
    : [];
  if (spot <= 0 || options.length === 0) {
    return null;
  }

  const source = asRecord(input.source);
  const ticker = stringOrFallback(input.ticker, input.symbol);
  const timestamp = stringOrFallback(
    input.timestamp,
    input.computedAt.toISOString(),
  );
  const flowContext = asRecord(input.flowContext);
  const flowStatus =
    source?.["flowStatus"] === "ok" ? "ok" : ("unavailable" as const);

  return {
    ticker,
    tickerDetails: {
      ticker,
      name: ticker,
      sector: "",
      industry: "",
      marketCap: null,
      exchangeShortName: "",
      country: "",
      isEtf: false,
      isFund: false,
    },
    profile: {
      price: spot,
      dayLow: spot,
      dayHigh: spot,
      yearLow: null,
      yearHigh: null,
      mktCap: null,
    },
    spot,
    timestamp,
    isStale: false,
    options,
    snapshots: [
      {
        ts: timestamp,
        netGex: numberOrFallback(input.netGex, 0),
      },
    ],
    flowContext: flowContext
      ? {
          bullishShare: numberOrFallback(flowContext["bullishShare"], 0),
          todayVol: numberOrFallback(flowContext["todayVol"], 0),
          avg30dVol:
            flowContext["avg30dVol"] == null
              ? null
              : numberOrFallback(flowContext["avg30dVol"], 0),
          netDelta: numberOrFallback(flowContext["netDelta"], 0),
          refDelta: numberOrFallback(flowContext["refDelta"], 0),
          eventCount: numberOrFallback(flowContext["eventCount"], 0),
          volumeBaselineReady: flowContext["volumeBaselineReady"] === true,
        }
      : null,
    flowContextStatus: input.flowContextStatus === "ok" ? "ok" : "unavailable",
    source: {
      provider: parseGexProvider(source?.["provider"]),
      status: parseGexSourceStatus(source?.["status"]),
      expirationCoverage: parseExpirationCoverage(
        source?.["expirationCoverage"],
      ),
      optionCount: numberOrFallback(source?.["optionCount"], options.length),
      usableOptionCount: numberOrFallback(
        source?.["usableOptionCount"],
        options.length,
      ),
      withGamma: numberOrFallback(source?.["withGamma"], options.length),
      withOpenInterest: numberOrFallback(
        source?.["withOpenInterest"],
        options.length,
      ),
      withImpliedVolatility: numberOrFallback(
        source?.["withImpliedVolatility"],
        options.length,
      ),
      quoteUpdatedAt:
        typeof source?.["quoteUpdatedAt"] === "string"
          ? source["quoteUpdatedAt"]
          : null,
      chainUpdatedAt:
        typeof source?.["chainUpdatedAt"] === "string"
          ? source["chainUpdatedAt"]
          : null,
      flowStatus,
      flowEventCount: numberOrFallback(source?.["flowEventCount"], 0),
      classifiedFlowEventCount: numberOrFallback(
        source?.["classifiedFlowEventCount"],
        0,
      ),
      flowClassificationCoverage: numberOrFallback(
        source?.["flowClassificationCoverage"],
        0,
      ),
      flowClassificationBasisCounts: parseBasisCounts(
        source?.["flowClassificationBasisCounts"],
      ),
      flowClassificationConfidenceCounts: parseConfidenceCounts(
        source?.["flowClassificationConfidenceCounts"],
      ),
      message:
        typeof source?.["message"] === "string" ? source["message"] : null,
    },
  };
}

export async function getLatestChartGexSnapshot(
  symbolInput: string,
  maxAgeMs: number,
  options: LatestChartGexSnapshotOptions,
): Promise<LatestGexSnapshot | null> {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) {
    return null;
  }
  const dbModule = await loadDbModule();
  if (!dbModule) {
    return null;
  }

  const maxExpirations = Math.max(1, Math.floor(options.maxExpirations));
  const strikesPerExpiration =
    Math.max(1, Math.floor(options.strikesAroundMoney)) * 2 + 1;
  const { pool } = dbModule;
  try {
    const result = await pool.query<{
      computed_at: Date;
      ticker: string | null;
      spot: number | string | null;
      timestamp: string | null;
      net_gex: number | string | null;
      source: unknown;
      flow_context: unknown;
      flow_context_status: string | null;
      options: unknown;
    }>(
      `
with latest as (
  select computed_at, spot, net_gex, payload
  from gex_snapshots
  where symbol = $1
  order by computed_at desc
  limit 1
), base as (
  select
    computed_at,
    payload->>'ticker' as ticker,
    coalesce(nullif(payload->>'spot', '')::double precision, spot::double precision) as spot,
    payload->>'timestamp' as timestamp,
    net_gex::double precision as net_gex,
    payload->'source' as source,
    payload->'flowContext' as flow_context,
    payload->>'flowContextStatus' as flow_context_status
  from latest
), expirations as (
  select expiration_date
  from latest,
    lateral (
      select distinct option_row->>'expirationDate' as expiration_date
      from jsonb_array_elements(payload->'options') option_row
      where jsonb_typeof(payload->'options') = 'array'
        and jsonb_typeof(option_row) = 'object'
        and option_row ? 'expirationDate'
        and (option_row->>'expirationDate') >= to_char(current_date, 'YYYY-MM-DD')
      order by expiration_date
      limit $2
    ) expiration_rows
), ranked as (
  select
    option_row,
    dense_rank() over (
      partition by option_row->>'expirationDate'
      order by
        abs((option_row->>'strike')::double precision - (select spot from base)),
        (option_row->>'strike')::double precision
    ) as strike_rank
  from latest
  join lateral jsonb_array_elements(payload->'options') option_row on true
  join expirations on expirations.expiration_date = option_row->>'expirationDate'
  where jsonb_typeof(payload->'options') = 'array'
    and jsonb_typeof(option_row) = 'object'
    and option_row ? 'strike'
), selected as (
  select option_row
  from ranked
  where strike_rank <= $3
)
select
  base.computed_at,
  base.ticker,
  base.spot,
  base.timestamp,
  base.net_gex,
  base.source,
  base.flow_context,
  base.flow_context_status,
  coalesce(
    jsonb_agg(selected.option_row) filter (where selected.option_row is not null),
    '[]'::jsonb
  ) as options
from base
left join selected on true
group by
  base.computed_at,
  base.ticker,
  base.spot,
  base.timestamp,
  base.net_gex,
  base.source,
  base.flow_context,
  base.flow_context_status
      `,
      [symbol, maxExpirations, strikesPerExpiration],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const computedAt = new Date(row.computed_at);
    const payload = compactGexSnapshotPayload({
      symbol,
      computedAt,
      ticker: row.ticker,
      spot: row.spot,
      timestamp: row.timestamp,
      netGex: row.net_gex,
      options: row.options,
      source: row.source,
      flowContext: row.flow_context,
      flowContextStatus: row.flow_context_status,
    });
    if (!payload) {
      return null;
    }

    const ageMs = Math.max(0, Date.now() - computedAt.getTime());
    return {
      payload,
      computedAt,
      ageMs,
      stale: ageMs > maxAgeMs,
    };
  } catch (error) {
    logger.debug(
      { err: error, symbol },
      "Failed to read compact GEX ingest snapshot",
    );
    return null;
  }
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

export type MarketDataIngestDiagnostics = {
  configured: boolean;
  providerConfigured: boolean;
  queueDepth: Record<string, number>;
  oldestQueuedAgeMs: number | null;
  runningCount: number;
  expiredLeaseCount: number;
  claimableQueuedJobCount: number;
  claimableQueuedJobsByKind: Record<string, number>;
  workerLikelyInactive: boolean;
  workerInactiveReason: string | null;
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
  degraded?: boolean;
  reason?: string | null;
  timeoutMs?: number | null;
};

let marketDataIngestDiagnosticsGetterForTests:
  | (() => Promise<MarketDataIngestDiagnostics>)
  | null = null;

function resolveWorkerActivityDiagnostics(input: {
  configured: boolean;
  providerConfigured: boolean;
  runningCount: number;
  claimableQueuedJobCount: number;
}): Pick<
  MarketDataIngestDiagnostics,
  "workerLikelyInactive" | "workerInactiveReason"
> {
  if (
    input.configured &&
    input.providerConfigured &&
    input.runningCount === 0 &&
    input.claimableQueuedJobCount > 0
  ) {
    return {
      workerLikelyInactive: true,
      workerInactiveReason: "claimable_jobs_waiting_without_running_worker",
    };
  }
  return {
    workerLikelyInactive: false,
    workerInactiveReason: null,
  };
}

export async function getMarketDataIngestDiagnostics(): Promise<MarketDataIngestDiagnostics> {
  if (marketDataIngestDiagnosticsGetterForTests) {
    return marketDataIngestDiagnosticsGetterForTests();
  }

  const dbModule = await loadDbModule();
  if (!dbModule) {
    return {
      configured: false,
      providerConfigured: isMarketDataIngestProviderConfigured(),
      queueDepth: {},
      oldestQueuedAgeMs: null,
      runningCount: 0,
      expiredLeaseCount: 0,
      claimableQueuedJobCount: 0,
      claimableQueuedJobsByKind: {},
      workerLikelyInactive: false,
      workerInactiveReason: null,
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
    const claimableQueuedJobs = mapClaimableQueuedJobRows(
      (
        await pool.query<ClaimableQueuedJobRow>(CLAIMABLE_QUEUED_JOBS_SQL)
      ).rows,
    );
    const configured = isMarketDataIngestConfigured();
    const providerConfigured = isMarketDataIngestProviderConfigured();
    const runningCount = Number(running?.value ?? 0);
    const workerActivity = resolveWorkerActivityDiagnostics({
      configured,
      providerConfigured,
      runningCount,
      claimableQueuedJobCount: claimableQueuedJobs.count,
    });

    return {
      configured,
      providerConfigured,
      queueDepth: Object.fromEntries(
        depthRows.map((row: { status: string; value: unknown }) => [
          row.status,
          Number(row.value),
        ]),
      ),
      oldestQueuedAgeMs: oldestQueued
        ? Math.max(0, now.getTime() - oldestQueued.createdAt.getTime())
        : null,
      runningCount,
      expiredLeaseCount: Number(expired?.value ?? 0),
      claimableQueuedJobCount: claimableQueuedJobs.count,
      claimableQueuedJobsByKind: claimableQueuedJobs.byKind,
      ...workerActivity,
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
      claimableQueuedJobCount: 0,
      claimableQueuedJobsByKind: {},
      workerLikelyInactive: false,
      workerInactiveReason: null,
      blockedGexJobCount: 0,
      oldestBlockedGexAgeMs: null,
      blockedGexJobs: [],
      recentProviderFailures: [],
      recentCompletedJobs: [],
    };
  }
}

type ClaimableQueuedJobRow = {
  kind: string;
  value: number | string;
};

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

const CLAIMABLE_QUEUED_JOBS_SQL = `
with claimable as (
  select candidate.kind
  from market_data_ingest_jobs candidate
  where candidate.status = 'queued'
    and (candidate.next_run_at is null or candidate.next_run_at <= now())
    and (
      candidate.kind <> 'gex_snapshot'
      or coalesce(candidate.payload->>'dedupeBucket', '') = ''
      or (
        exists (
          select 1
          from market_data_ingest_jobs prerequisite
          where prerequisite.symbol = candidate.symbol
            and prerequisite.kind = 'stock_snapshot'
            and prerequisite.status = 'completed'
            and coalesce(prerequisite.payload->>'dedupeBucket', '') =
              coalesce(candidate.payload->>'dedupeBucket', '')
        )
        and exists (
          select 1
          from market_data_ingest_jobs prerequisite
          where prerequisite.symbol = candidate.symbol
            and prerequisite.kind = 'option_chain_snapshot'
            and prerequisite.status = 'completed'
            and coalesce(prerequisite.payload->>'dedupeBucket', '') =
              coalesce(candidate.payload->>'dedupeBucket', '')
        )
      )
    )
)
select kind, count(*)::bigint as value
from claimable
group by kind
`;

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

function mapClaimableQueuedJobRows(
  rows: ClaimableQueuedJobRow[],
): ClaimableQueuedJobsDiagnostic {
  const byKind = Object.fromEntries(
    rows.map((row) => [row.kind, Number(row.value ?? 0)]),
  );
  return {
    count: Object.values(byKind).reduce((sum, value) => sum + value, 0),
    byKind,
  };
}

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
  __setMarketDataIngestDiagnosticsGetterForTests: (
    getter: (() => Promise<MarketDataIngestDiagnostics>) | null,
  ) => {
    marketDataIngestDiagnosticsGetterForTests = getter;
  },
  numericDedupeBucket,
  mapClaimableQueuedJobRows,
  resolveWorkerActivityDiagnostics,
  mapBlockedGexDiagnosticsRows,
};

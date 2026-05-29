import { and, count, desc, eq, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import type { GexResponse } from "./gex";

export type MarketDataIngestJobKind =
  | "stock_snapshot"
  | "stock_bars"
  | "option_chain_snapshot"
  | "option_flow_events"
  | "gex_snapshot"
  | "flow_summary";

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

const INGEST_JOB_DEFAULT_MAX_ATTEMPTS = 3;

type DbModule = {
  db: any;
  marketDataIngestJobsTable: any;
  gexSnapshotsTable: any;
};

async function loadDbModule(): Promise<DbModule | null> {
  if (!isMarketDataIngestConfigured()) {
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

export function isMarketDataIngestConfigured(): boolean {
  return Boolean(
    process.env["DATABASE_URL"] ||
      process.env["LOCAL_DATABASE_URL"] ||
      (process.env["PGHOST"] && process.env["PGDATABASE"] && process.env["PGUSER"]),
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

  const dbModule = await loadDbModule();
  const dedupeKey = input.dedupeKey ?? buildIngestDedupeKey({ ...input, symbol });
  if (!dbModule) {
    return { queued: false, dedupeKey, reason: "database_unconfigured" };
  }

  const { db, marketDataIngestJobsTable } = dbModule;
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
          nextRunAt: sql`least(coalesce(${marketDataIngestJobsTable.nextRunAt}, excluded.next_run_at), excluded.next_run_at)`,
          payload: sql`coalesce(excluded.payload, ${marketDataIngestJobsTable.payload})`,
          updatedAt: now,
        },
      });
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
  queueDepth: Record<string, number>;
  oldestQueuedAgeMs: number | null;
  runningCount: number;
  expiredLeaseCount: number;
}> {
  const dbModule = await loadDbModule();
  if (!dbModule) {
    return {
      configured: false,
      queueDepth: {},
      oldestQueuedAgeMs: null,
      runningCount: 0,
      expiredLeaseCount: 0,
    };
  }

  const { db, marketDataIngestJobsTable } = dbModule;
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

    return {
      configured: true,
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
    };
  } catch (error) {
    logger.debug({ err: error }, "Failed to read market data ingest diagnostics");
    return {
      configured: true,
      queueDepth: {},
      oldestQueuedAgeMs: null,
      runningCount: 0,
      expiredLeaseCount: 0,
    };
  }
}

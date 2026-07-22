import assert from "node:assert/strict";
import test from "node:test";

import { marketDataIngestJobsTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import {
  __marketDataIngestInternalsForTests,
  getMarketDataIngestDiagnostics,
} from "./market-data-ingest";

const HOUR_MS = 60 * 60 * 1_000;

test("concurrent diagnostics callers join one ingest snapshot read", async (t) => {
  let callCount = 0;
  let resolveRead!: (value: Awaited<ReturnType<typeof getMarketDataIngestDiagnostics>>) => void;
  const pending = new Promise<
    Awaited<ReturnType<typeof getMarketDataIngestDiagnostics>>
  >((resolve) => {
    resolveRead = resolve;
  });
  __marketDataIngestInternalsForTests.__setMarketDataIngestDiagnosticsGetterForTests(
    () => {
      callCount += 1;
      return pending;
    },
  );
  t.after(() => {
    __marketDataIngestInternalsForTests.__setMarketDataIngestDiagnosticsGetterForTests(
      null,
    );
  });

  const first = getMarketDataIngestDiagnostics();
  const second = getMarketDataIngestDiagnostics();
  assert.equal(callCount, 1);

  resolveRead({
    configured: true,
    providerConfigured: true,
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
  });
  await Promise.all([first, second]);

  await getMarketDataIngestDiagnostics();
  assert.equal(callCount, 2);
});

test("diagnostics archives failed ingest jobs older than 24 hours", async () => {
  await withTestDb(async ({ db }) => {
    const now = Date.now();
    const staleAt = new Date(now - 25 * HOUR_MS);
    const recentAt = new Date(now - 23 * HOUR_MS);

    await db.insert(marketDataIngestJobsTable).values([
      {
        kind: "gex_snapshot",
        symbol: "AIP",
        status: "failed",
        attemptCount: 0,
        maxAttempts: 3,
        leaseOwner: "stale-worker",
        leaseExpiresAt: staleAt,
        lastHeartbeatAt: staleAt,
        nextRunAt: staleAt,
        dedupeKey: "lifecycle:AIP",
        lastError: "prerequisite stock snapshot failed",
        createdAt: staleAt,
        updatedAt: staleAt,
      },
      {
        kind: "gex_snapshot",
        symbol: "QQQ",
        status: "failed",
        attemptCount: 3,
        maxAttempts: 3,
        nextRunAt: staleAt,
        dedupeKey: "lifecycle:QQQ",
        lastError: "no latest spot quote found for QQQ",
        createdAt: staleAt,
        updatedAt: staleAt,
      },
      {
        kind: "gex_snapshot",
        symbol: "SPY",
        status: "failed",
        attemptCount: 3,
        maxAttempts: 3,
        nextRunAt: recentAt,
        dedupeKey: "lifecycle:SPY",
        lastError: "recent failure",
        createdAt: recentAt,
        updatedAt: recentAt,
      },
      {
        kind: "gex_snapshot",
        symbol: "IWM",
        status: "queued",
        attemptCount: 0,
        maxAttempts: 3,
        nextRunAt: staleAt,
        dedupeKey: "lifecycle:IWM",
        createdAt: staleAt,
        updatedAt: staleAt,
      },
      {
        kind: "option_chain_snapshot",
        symbol: "DIA",
        status: "failed",
        attemptCount: 3,
        maxAttempts: 3,
        nextRunAt: staleAt,
        dedupeKey: "lifecycle:DIA:chain",
        payload: { dedupeBucket: "protected" },
        lastError: "chain prerequisite failed",
        createdAt: staleAt,
        updatedAt: staleAt,
      },
      {
        kind: "gex_snapshot",
        symbol: "DIA",
        status: "queued",
        attemptCount: 0,
        maxAttempts: 3,
        nextRunAt: staleAt,
        dedupeKey: "lifecycle:DIA:gex",
        payload: { dedupeBucket: "protected" },
        createdAt: staleAt,
        updatedAt: staleAt,
      },
    ]);

    const diagnostics = await getMarketDataIngestDiagnostics();
    const rows = await db
      .select({
        symbol: marketDataIngestJobsTable.symbol,
        dedupeKey: marketDataIngestJobsTable.dedupeKey,
        status: marketDataIngestJobsTable.status,
        leaseOwner: marketDataIngestJobsTable.leaseOwner,
        nextRunAt: marketDataIngestJobsTable.nextRunAt,
        lastError: marketDataIngestJobsTable.lastError,
        updatedAt: marketDataIngestJobsTable.updatedAt,
      })
      .from(marketDataIngestJobsTable);
    const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
    const byDedupeKey = new Map(rows.map((row) => [row.dedupeKey, row]));

    assert.equal(bySymbol.get("AIP")?.status, "cancelled");
    assert.equal(bySymbol.get("AIP")?.leaseOwner, null);
    assert.equal(bySymbol.get("AIP")?.nextRunAt, null);
    assert.equal(
      bySymbol.get("AIP")?.lastError,
      "prerequisite stock snapshot failed",
    );
    assert.equal(bySymbol.get("QQQ")?.status, "cancelled");
    assert.equal(bySymbol.get("SPY")?.status, "failed");
    assert.equal(bySymbol.get("IWM")?.status, "queued");
    assert.equal(byDedupeKey.get("lifecycle:DIA:chain")?.status, "failed");
    assert.equal(byDedupeKey.get("lifecycle:DIA:gex")?.status, "queued");
    assert.equal(diagnostics.queueDepth["cancelled"], 2);
    assert.equal(diagnostics.queueDepth["failed"], 2);
    assert.equal(diagnostics.queueDepth["queued"], 2);

    const archivedAt = bySymbol.get("AIP")?.updatedAt.getTime();
    await getMarketDataIngestDiagnostics();
    const [aipAfterSecondSweep] = await db
      .select({ updatedAt: marketDataIngestJobsTable.updatedAt })
      .from(marketDataIngestJobsTable)
      .where(eq(marketDataIngestJobsTable.dedupeKey, "lifecycle:AIP"));
    assert.equal(aipAfterSecondSweep?.updatedAt.getTime(), archivedAt);
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { db, flowUniverseRankingsTable } from "@workspace/db";
import { createTestDb, type TestDatabase } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import {
  createFlowUniverseManager,
  type FlowUniverseObservation,
} from "./flow-universe";

let testDb: TestDatabase;

before(async () => {
  testDb = await createTestDb();
});

after(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.client.exec("truncate table flow_universe_rankings");
});

function createManager() {
  return createFlowUniverseManager({
    db,
    mode: "market",
    targetSize: 10,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });
}

async function readRanking(symbol: string) {
  const [row] = await db
    .select({
      flowScore: flowUniverseRankingsTable.flowScore,
      failureCount: flowUniverseRankingsTable.failureCount,
      cooldownUntil: flowUniverseRankingsTable.cooldownUntil,
      lastScannedAt: flowUniverseRankingsTable.lastScannedAt,
      lastFlowAt: flowUniverseRankingsTable.lastFlowAt,
      reason: flowUniverseRankingsTable.reason,
      metadata: flowUniverseRankingsTable.metadata,
      updatedAt: flowUniverseRankingsTable.updatedAt,
    })
    .from(flowUniverseRankingsTable)
    .where(eq(flowUniverseRankingsTable.symbol, symbol));
  assert.ok(row);
  return {
    ...row,
    flowScore: Number(row.flowScore),
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    lastScannedAt: row.lastScannedAt?.toISOString() ?? null,
    lastFlowAt: row.lastFlowAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

test("blocked observation compaction preserves sequential EWMA and cooldown outcomes", async () => {
  const symbol = "MIXED";
  const existing: FlowUniverseObservation = {
    symbol,
    scannedAt: new Date("2026-07-16T18:59:00.000Z"),
    events: [{ premium: 999 }],
    failed: true,
    reason: "existing-failure",
  };
  const observations: FlowUniverseObservation[] = [
    {
      symbol,
      scannedAt: new Date("2026-07-16T19:00:00.000Z"),
      events: [{ premium: 9 }],
      reason: "flow-one",
    },
    {
      symbol,
      scannedAt: new Date("2026-07-16T19:01:00.000Z"),
      events: [],
      failed: true,
      reason: "failure-one",
    },
    {
      symbol,
      scannedAt: new Date("2026-07-16T19:02:00.000Z"),
      events: [{ premium: 99 }],
      failed: true,
      reason: "failure-two",
    },
    {
      symbol,
      scannedAt: new Date("2026-07-16T19:03:00.000Z"),
      events: [],
      reason: "recovered",
    },
    {
      symbol,
      scannedAt: new Date("2026-07-16T19:04:00.000Z"),
      events: [],
      failed: true,
      reason: "failure-three",
    },
    {
      symbol,
      scannedAt: new Date("2026-07-16T19:05:00.000Z"),
      events: [{ premium: 9 }],
      failed: true,
      reason: "failure-four",
    },
  ];

  const sequentialManager = createManager();
  sequentialManager.recordObservation(existing);
  await sequentialManager.drainObservationPersistence();
  observations.forEach((observation) =>
    sequentialManager.recordObservation(observation),
  );
  await sequentialManager.drainObservationPersistence();
  const sequential = await readRanking(symbol);

  await testDb.client.exec("truncate table flow_universe_rankings");
  const compactedManager = createManager();
  compactedManager.recordObservation(existing);
  await compactedManager.drainObservationPersistence();
  Array.from({ length: 250 }, (_, index) =>
    compactedManager.recordObservation({
      symbol: `MIXED-BLOCKER-${index}`,
      events: [],
    }),
  );
  observations.forEach((observation) =>
    compactedManager.recordObservation(observation),
  );

  await compactedManager.drainObservationPersistence();

  assert.deepEqual(await readRanking(symbol), sequential);
  assert.equal(
    compactedManager.getCoverage().observationPersistenceCoalesced,
    observations.length - 1,
  );

  const sequentialFailureSymbol = "FAIL-SEQ";
  const compactedFailureSymbol = "FAIL-COMPACT";
  const failureSeed = {
    scannedAt: new Date("2026-07-16T20:00:00.000Z"),
    events: [{ premium: 999 }],
    failed: true,
    reason: "seed-failure",
  };
  const failures = [
    {
      scannedAt: new Date("2026-07-16T20:01:00.000Z"),
      events: [],
      failed: true,
      reason: "second-failure",
    },
    {
      scannedAt: new Date("2026-07-16T20:02:00.000Z"),
      events: [{ premium: 9 }],
      failed: true,
      reason: "third-failure",
    },
  ];
  sequentialManager.recordObservation({
    symbol: sequentialFailureSymbol,
    ...failureSeed,
  });
  failures.forEach((failure) =>
    sequentialManager.recordObservation({
      symbol: sequentialFailureSymbol,
      ...failure,
    }),
  );
  await sequentialManager.drainObservationPersistence();
  compactedManager.recordObservation({
    symbol: compactedFailureSymbol,
    ...failureSeed,
  });
  await compactedManager.drainObservationPersistence();
  Array.from({ length: 250 }, (_, index) =>
    compactedManager.recordObservation({
      symbol: `FAILURE-BLOCKER-${index}`,
      events: [],
    }),
  );
  failures.forEach((failure) =>
    compactedManager.recordObservation({
      symbol: compactedFailureSymbol,
      ...failure,
    }),
  );
  await compactedManager.drainObservationPersistence();

  assert.deepEqual(
    await readRanking(compactedFailureSymbol),
    await readRanking(sequentialFailureSymbol),
  );

  const overflowSymbol = "COMPACT-OVERFLOW";
  Array.from({ length: 250 }, (_, index) =>
    compactedManager.recordObservation({
      symbol: `OVERFLOW-BLOCKER-${index}`,
      events: [],
    }),
  );
  compactedManager.recordObservation({
    symbol: overflowSymbol,
    events: [{ unusualScore: Number.MAX_VALUE }],
  });
  await compactedManager.drainObservationPersistence();

  const overflowRows = await db
    .select({ symbol: flowUniverseRankingsTable.symbol })
    .from(flowUniverseRankingsTable)
    .where(eq(flowUniverseRankingsTable.symbol, overflowSymbol));
  assert.deepEqual(
    overflowRows,
    [],
    "a failed compacted update must roll back its baseline insert",
  );
  assert.equal(
    compactedManager.getCoverage().observationPersistenceQuarantined,
    1,
  );
});

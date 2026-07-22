import assert from "node:assert/strict";
import test from "node:test";

import { currentDbLane } from "@workspace/db";

import {
  createFlowUniverseOptionabilityVerifier,
  loadFlowUniverseOptionabilityCandidates,
  markFlowUniverseOptionability,
} from "./flow-universe-optionability-verifier";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

test("optionability verification runs in the background DB lane", async () => {
  const lanes: string[] = [];
  const verifier = createFlowUniverseOptionabilityVerifier({
    enabled: true,
    loadCandidates: async () => {
      lanes.push(currentDbLane());
      return [];
    },
    fetchExpirations: async () => ({ expirations: [] }),
  });

  await verifier.runOnce("test");

  assert.deepEqual(lanes, ["background"]);
});

test("optionability verifier clamps constructor settings to safe bounds", (t) => {
  const scheduledDelays: number[] = [];
  t.mock.method(globalThis, "setTimeout", ((
    _callback: () => void,
    delayMs: number,
  ) => {
    scheduledDelays.push(delayMs);
    return { unref() {} } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  const verifier = createFlowUniverseOptionabilityVerifier({
    intervalMs: 1,
    batchSize: 500,
    fetchExpirations: async () => ({ expirations: [] }),
  });

  const diagnostics = verifier.getDiagnostics();

  assert.equal(diagnostics.intervalMs, 60_000);
  assert.equal(diagnostics.batchSize, 5);

  const overflow = createFlowUniverseOptionabilityVerifier({
    intervalMs: MAX_TIMER_DELAY_MS + 1,
    initialDelayMs: MAX_TIMER_DELAY_MS + 1,
    delayMs: MAX_TIMER_DELAY_MS + 1,
    fetchExpirations: async () => ({ expirations: [] }),
  });
  overflow.start();

  assert.equal(overflow.getDiagnostics().intervalMs, MAX_TIMER_DELAY_MS);
  assert.deepEqual(
    {
      delayMs: overflow.getDiagnostics().delayMs,
      scheduledDelays,
    },
    {
      delayMs: MAX_TIMER_DELAY_MS,
      scheduledDelays: [MAX_TIMER_DELAY_MS],
    },
  );
});

test("optionability verifier clamps runtime updates to safe bounds", (t) => {
  const scheduledDelays: number[] = [];
  t.mock.method(globalThis, "setTimeout", ((
    _callback: () => void,
    delayMs: number,
  ) => {
    scheduledDelays.push(delayMs);
    return { unref() {} } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  const verifier = createFlowUniverseOptionabilityVerifier({
    intervalMs: 120_000,
    batchSize: 2,
    fetchExpirations: async () => ({ expirations: [] }),
  });

  verifier.updateConfig({ intervalMs: 1, batchSize: 500 });

  assert.equal(verifier.getDiagnostics().intervalMs, 60_000);
  assert.equal(verifier.getDiagnostics().batchSize, 5);

  verifier.updateConfig({
    intervalMs: MAX_TIMER_DELAY_MS + 1,
    initialDelayMs: MAX_TIMER_DELAY_MS + 1,
    delayMs: MAX_TIMER_DELAY_MS + 1,
  });
  verifier.start();

  assert.equal(verifier.getDiagnostics().intervalMs, MAX_TIMER_DELAY_MS);
  assert.deepEqual(
    {
      delayMs: verifier.getDiagnostics().delayMs,
      scheduledDelays,
    },
    {
      delayMs: MAX_TIMER_DELAY_MS,
      scheduledDelays: [MAX_TIMER_DELAY_MS],
    },
  );
});

test("fallback candidate query scales with accepted priorities, not the raw priority list", async () => {
  const requestedLimits: number[] = [];
  const db = {
    select() {
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: async (limit: number) => {
          requestedLimits.push(limit);
          return [];
        },
      };
      return query;
    },
  };

  await loadFlowUniverseOptionabilityCandidates({
    db: db as never,
    limit: 5,
    prioritySymbols: Array.from({ length: 500 }, (_, index) => `SYM${index}`),
  });

  assert.deepEqual(requestedLimits, [5, 20]);
});

test("optionability status writes share one database transaction", async () => {
  const operations: string[] = [];
  const rootWrite = () => {
    throw new Error("write escaped transaction");
  };
  const transactionDb = {
    update() {
      operations.push("update");
      return {
        set() {
          return {
            async where() {
              operations.push("updated catalog");
            },
          };
        },
      };
    },
    insert() {
      operations.push("insert");
      return {
        values() {
          return {
            async onConflictDoUpdate() {
              operations.push("updated ranking");
            },
          };
        },
      };
    },
  };
  const database = {
    update: rootWrite,
    insert: rootWrite,
    async transaction(callback: (tx: typeof transactionDb) => Promise<void>) {
      operations.push("transaction");
      await callback(transactionDb);
    },
  };

  await markFlowUniverseOptionability({
    db: database as never,
    symbol: "AAPL",
    market: "stocks",
    listingKey: "stocks:AAPL",
    status: "verified",
    reason: null,
    verifiedAt: new Date("2026-07-15T00:00:00.000Z"),
  });

  assert.deepEqual(operations, [
    "transaction",
    "update",
    "updated catalog",
    "insert",
    "updated ranking",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  loadFlowUniverseOptionabilityCandidates,
  markFlowUniverseOptionability,
} from "./flow-universe-optionability-verifier";

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

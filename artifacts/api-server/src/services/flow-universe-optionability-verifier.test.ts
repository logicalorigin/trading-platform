import assert from "node:assert/strict";
import test from "node:test";

import { loadFlowUniverseOptionabilityCandidates } from "./flow-universe-optionability-verifier";

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

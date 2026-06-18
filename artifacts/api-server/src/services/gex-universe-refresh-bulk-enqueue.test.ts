import assert from "node:assert/strict";
import test from "node:test";

import {
  refreshGexUniverseSnapshots,
  type GexUniverseRefreshInventory,
} from "./gex-universe-refresh";
import type {
  EnqueueMarketDataJobInput,
  EnqueueMarketDataJobResult,
} from "./market-data-ingest";

const EMPTY_INVENTORY: GexUniverseRefreshInventory = {
  available: true,
  unavailableReason: null,
  snapshots: [],
  jobs: [],
};

test("non-dry-run universe refresh enqueues all jobs in a single bulk call", async () => {
  const symbols = ["AAA", "BBB", "CCC"];
  const calls: EnqueueMarketDataJobInput[][] = [];

  const result = await refreshGexUniverseSnapshots(
    {
      scope: "symbols",
      symbols,
      dryRun: false,
      batchSize: symbols.length,
      reason: "test_bulk_enqueue",
    },
    {
      readInventory: async () => EMPTY_INVENTORY,
      enqueueMarketDataJobs: async (jobs) => {
        calls.push(jobs);
        return jobs.map((job) => ({
          queued: true,
          dedupeKey: `${job.kind}:${job.symbol}`,
        }));
      },
    },
  );

  // The whole refresh must use exactly one enqueue invocation (one pool
  // connection), not one per job.
  assert.equal(calls.length, 1, "expected a single bulk enqueue call");

  // 3 symbols x 3 job kinds (stock_snapshot, option_chain_snapshot,
  // gex_snapshot) = 9 jobs in the single batch.
  const batch = calls[0]!;
  assert.equal(batch.length, 9);
  for (const symbol of symbols) {
    const kinds = batch
      .filter((job) => job.symbol === symbol)
      .map((job) => job.kind)
      .sort();
    assert.deepEqual(kinds, [
      "gex_snapshot",
      "option_chain_snapshot",
      "stock_snapshot",
    ]);
  }

  assert.equal(result.enqueuedJobCount, 9);
  assert.deepEqual(result.enqueueFailures, []);
});

test("per-job results map back by index, including failures", async () => {
  const symbols = ["AAA", "BBB"];
  const result = await refreshGexUniverseSnapshots(
    {
      scope: "symbols",
      symbols,
      dryRun: false,
      batchSize: symbols.length,
      reason: "test_bulk_enqueue_failures",
    },
    {
      readInventory: async () => EMPTY_INVENTORY,
      enqueueMarketDataJobs: async (jobs) =>
        jobs.map((job, index): EnqueueMarketDataJobResult => {
          // Fail the second job to confirm index-aligned failure reporting.
          if (index === 1) {
            return {
              queued: false,
              dedupeKey: `${job.kind}:${job.symbol}`,
              reason: "database_error",
            };
          }
          return { queued: true, dedupeKey: `${job.kind}:${job.symbol}` };
        }),
    },
  );

  // 2 symbols x 3 kinds = 6 jobs; one fails.
  assert.equal(result.enqueuedJobCount, 5);
  assert.equal(result.enqueueFailures.length, 1);
  assert.equal(result.enqueueFailures[0]!.reason, "database_error");
});

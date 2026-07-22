import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import { runAlgoOptionTargetReconciliationBatch } from "./algo-option-target-reconciliation-worker";

test("target reconciliation handles entries and exits independently across providers", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await runAlgoOptionTargetReconciliationBatch(
    { limit: 20 },
    {
      listExecutions: async () => [
        {
          executionId: "execution-entry",
          appUserId: "user-1",
          deploymentId: "deployment-1",
          targetId: "target-1",
          accountId: "account-1",
          provider: "robinhood",
          action: "entry",
        },
        {
          executionId: "execution-exit",
          appUserId: "user-1",
          deploymentId: "deployment-1",
          targetId: "target-1",
          accountId: "account-1",
          provider: "robinhood",
          action: "exit",
        },
        {
          executionId: "execution-staged",
          appUserId: "user-1",
          deploymentId: "deployment-1",
          targetId: "target-2",
          accountId: "account-2",
          provider: "schwab",
          action: "entry",
        },
      ],
      reconcile: async (input) => {
        calls.push(input);
        if (input.executionId === "execution-exit") {
          throw new HttpError(503, "Provider read unavailable.", {
            code: "provider_read_unavailable",
            expose: true,
          });
        }
        return {
          state:
            input.executionId === "execution-entry" ? "filled" : "attention",
        } as never;
      },
    },
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], {
    executionId: "execution-entry",
    appUserId: "user-1",
    deploymentId: "deployment-1",
    targetId: "target-1",
    accountId: "account-1",
    provider: "robinhood",
    action: "entry",
  });
  assert.equal(result.attempted, 3);
  assert.equal(result.reconciled, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    result.results.map(({ executionId, status, code }) => ({
      executionId,
      status,
      code,
    })),
    [
      { executionId: "execution-entry", status: "filled", code: null },
      {
        executionId: "execution-exit",
        status: "failed",
        code: "provider_read_unavailable",
      },
      {
        executionId: "execution-staged",
        status: "attention",
        code: null,
      },
    ],
  );
});

test("target reconciliation clamps batch size before reading work", async () => {
  let receivedLimit = 0;
  await runAlgoOptionTargetReconciliationBatch(
    { limit: 100_000 },
    {
      listExecutions: async ({ limit }) => {
        receivedLimit = limit;
        return [];
      },
      reconcile: async () => {
        throw new Error("no work should reconcile");
      },
    },
  );
  assert.equal(receivedLimit, 100);
});

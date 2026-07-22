import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import { runSignalOptionsLiveTargetPositionBatch } from "./signal-options-live-target-position-worker";
import type { SignalOptionsLiveTargetPositionContext } from "./signal-options-live-target-exit";

const work = (positionId: string): SignalOptionsLiveTargetPositionContext => ({
  appUserId: "user-1",
  deploymentId: "deployment-1",
  targetId: "target-1",
  accountId: "account-1",
  providerAccountId: "robinhood:123456789",
  provider: "robinhood",
  symbol: "AAPL",
  deploymentConfig: {},
  position: {
    id: positionId,
    appUserId: "user-1",
    deploymentId: "deployment-1",
    targetId: "target-1",
    strategyPositionKey: `strategy:${positionId}`,
    symbol: "AAPL",
    status: "open",
    quantity: "1.000000",
    premiumBasis: "250.000000",
    providerPositionId: `provider:${positionId}`,
    expiration: "2026-08-21",
    contractSnapshot: {},
    managementState: {},
  },
});

test("live target position worker isolates one failed position from the next", async () => {
  const calls: string[] = [];
  const result = await runSignalOptionsLiveTargetPositionBatch(
    { limit: 20 },
    {
      listPositions: async () => [work("position-1"), work("position-2")],
      managePosition: async (context) => {
        calls.push(context.position.id);
        if (context.position.id === "position-1") {
          throw new HttpError(503, "Quote unavailable.", {
            code: "provider_quote_unavailable",
            expose: true,
          });
        }
        return { status: "managed" } as never;
      },
    },
  );

  assert.deepEqual(calls, ["position-1", "position-2"]);
  assert.equal(result.attempted, 2);
  assert.equal(result.managed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    result.results.map(({ positionId, status, code }) => ({
      positionId,
      status,
      code,
    })),
    [
      {
        positionId: "position-1",
        status: "failed",
        code: "provider_quote_unavailable",
      },
      { positionId: "position-2", status: "managed", code: null },
    ],
  );
});

test("live target position worker clamps batch size", async () => {
  let receivedLimit = 0;
  await runSignalOptionsLiveTargetPositionBatch(
    { limit: 100_000 },
    {
      listPositions: async ({ limit }) => {
        receivedLimit = limit;
        return [];
      },
      managePosition: async () => {
        throw new Error("no position should run");
      },
    },
  );
  assert.equal(receivedLimit, 100);
});

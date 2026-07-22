import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import { HttpError } from "../lib/errors";
import {
  manageSignalOptionsLiveTargetPosition,
  planSignalOptionsLiveTargetExit,
} from "./signal-options-live-target-exit";

const POSITION = {
  id: "position-1",
  quantity: "2.000000",
  premiumBasis: "500.000000",
  providerPositionId: "robinhood-option-aapl-210-call",
  expiration: "2026-08-21",
  managementState: {},
};

test("live target stop requires two distinct fresh broker quotes and preserves the ratchet", () => {
  const profile = resolveSignalOptionsExecutionProfile({});
  const first = planSignalOptionsLiveTargetExit({
    position: POSITION,
    profile,
    quote: {
      providerPositionId: POSITION.providerPositionId,
      bid: 1.4,
      ask: 1.45,
      updatedAt: new Date("2026-07-22T15:00:00.000Z"),
    },
    now: new Date("2026-07-22T15:00:01.000Z"),
    scaleOutAlreadyFired: false,
  });

  assert.equal(first.exit, null);
  assert.equal(first.managementState.peakBid, 2.5);
  assert.equal(first.managementState.stopPrice, 1.5);
  assert.equal(first.managementState.stopBreach?.bid, 1.4);

  const second = planSignalOptionsLiveTargetExit({
    position: { ...POSITION, managementState: first.managementState },
    profile,
    quote: {
      providerPositionId: POSITION.providerPositionId,
      bid: 1.35,
      ask: 1.4,
      updatedAt: new Date("2026-07-22T15:00:05.000Z"),
    },
    now: new Date("2026-07-22T15:00:06.000Z"),
    scaleOutAlreadyFired: false,
  });

  assert.deepEqual(second.exit, {
    reason: "hard_stop",
    quantity: 2,
    limitPrice: 1.35,
    quoteUpdatedAt: "2026-07-22T15:00:05.000Z",
  });
  assert.equal(second.managementState.peakBid, 2.5);
  assert.equal(second.managementState.stopPrice, 1.5);
});

test("live target manager applies the saved scale-out policy without duplicating it", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { scaleOut: { enabled: true, sellFractionPct: 50 } },
  });
  const planned = planSignalOptionsLiveTargetExit({
    position: POSITION,
    profile,
    quote: {
      providerPositionId: POSITION.providerPositionId,
      bid: 3.6,
      ask: 3.65,
      updatedAt: new Date("2026-07-22T15:00:00.000Z"),
    },
    now: new Date("2026-07-22T15:00:01.000Z"),
    scaleOutAlreadyFired: false,
  });

  assert.deepEqual(planned.exit, {
    reason: "scale_out_first_trail_arm",
    quantity: 1,
    limitPrice: 3.6,
    quoteUpdatedAt: "2026-07-22T15:00:00.000Z",
  });
  assert.equal(planned.managementState.peakBid, 3.6);
  assert.ok(planned.managementState.stopPrice > 2.5);

  const alreadyFired = planSignalOptionsLiveTargetExit({
    position: { ...POSITION, managementState: planned.managementState },
    profile,
    quote: {
      providerPositionId: POSITION.providerPositionId,
      bid: 3.6,
      ask: 3.65,
      updatedAt: new Date("2026-07-22T15:00:02.000Z"),
    },
    now: new Date("2026-07-22T15:00:03.000Z"),
    scaleOutAlreadyFired: true,
  });
  assert.equal(alreadyFired.exit, null);
});

test("expiration safety closes the full owned quantity before any scale-out", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: { scaleOut: { enabled: true, sellFractionPct: 50 } },
  });
  const planned = planSignalOptionsLiveTargetExit({
    position: POSITION,
    profile,
    quote: {
      providerPositionId: POSITION.providerPositionId,
      bid: 3.6,
      ask: 3.65,
      updatedAt: new Date("2026-08-21T15:00:00.000Z"),
    },
    now: new Date("2026-08-21T15:00:01.000Z"),
    scaleOutAlreadyFired: false,
  });

  assert.deepEqual(planned.exit, {
    reason: "expiration",
    quantity: 2,
    limitPrice: 3.6,
    quoteUpdatedAt: "2026-08-21T15:00:00.000Z",
  });
});

test("live target manager rejects stale or mismatched broker proof", () => {
  const profile = resolveSignalOptionsExecutionProfile({});
  assert.throws(
    () =>
      planSignalOptionsLiveTargetExit({
        position: POSITION,
        profile,
        quote: {
          providerPositionId: "different-position",
          bid: 2,
          ask: 2.1,
          updatedAt: new Date("2026-07-22T14:59:00.000Z"),
        },
        now: new Date("2026-07-22T15:00:00.000Z"),
        scaleOutAlreadyFired: false,
      }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === "algo_target_position_quote_invalid",
  );
});

test("live target manager reserves and submits only an exact owned-position exit", async () => {
  const calls: Array<{ stage: string; value: unknown }> = [];
  const context = {
    appUserId: "user-1",
    deploymentId: "deployment-1",
    targetId: "target-1",
    accountId: "account-1",
    providerAccountId: "robinhood:123456789",
    provider: "robinhood" as const,
    symbol: "AAPL",
    deploymentConfig: {
      signalOptions: {
        exitPolicy: { hardStopPct: -40 },
      },
    },
    position: {
      ...POSITION,
      appUserId: "user-1",
      deploymentId: "deployment-1",
      targetId: "target-1",
      strategyPositionKey: "signal-options:entry-event-1",
      symbol: "AAPL",
      status: "open" as const,
      contractSnapshot: {
        contractSymbol: "O:AAPL260821C00210000",
        occSymbol: "AAPL  260821C00210000",
        multiplier: 100,
        sharesPerContract: 100,
        chainSymbol: "AAPL",
        underlyingType: "equity",
        expiration: "2026-08-21",
        strike: 210,
        optionType: "Call",
      },
      managementState: {
        version: 1,
        peakBid: 2.5,
        stopPrice: 1.5,
        lastBid: 1.4,
        quoteUpdatedAt: "2026-07-22T15:00:00.000Z",
        evaluatedAt: "2026-07-22T15:00:01.000Z",
        stopBreach: {
          reason: "hard_stop",
          stopPrice: 1.5,
          bid: 1.4,
          quoteUpdatedAt: "2026-07-22T15:00:00.000Z",
        },
      },
    },
  };

  const result = await manageSignalOptionsLiveTargetPosition(context, {
    now: () => new Date("2026-07-22T15:00:06.000Z"),
    readRobinhoodQuote: async (input) => {
      calls.push({ stage: "quote", value: input });
      return {
        provider: "robinhood",
        checkedAt: "2026-07-22T15:00:06.000Z",
        account: { id: "account-1" },
        optionId: POSITION.providerPositionId,
        quote: {
          instrumentId: POSITION.providerPositionId,
          bidPrice: 1.35,
          askPrice: 1.4,
          updatedAt: "2026-07-22T15:00:05.000Z",
        },
      } as never;
    },
    scaleOutAlreadyFired: async () => false,
    saveManagementState: async (input) => {
      calls.push({ stage: "state", value: input });
      return true;
    },
    persistExitIntent: async (input) => {
      calls.push({ stage: "intent", value: input });
      return { id: "exit-event-1" };
    },
    reserveExit: async (input) => {
      calls.push({ stage: "reserve", value: input });
      return {
        id: "execution-1",
        status: "pending",
        clientOrderId: "88888888-8888-4888-8888-888888888888",
      } as never;
    },
    executeRobinhoodExit: async (input) => {
      calls.push({ stage: "execute", value: input });
      return { id: "execution-1", status: "submitted" } as never;
    },
  });

  assert.equal(result.status, "submitted");
  assert.deepEqual(
    calls.map((call) => call.stage),
    ["quote", "state", "intent", "reserve", "execute"],
  );
  const reservation = calls.find((call) => call.stage === "reserve")!
    .value as Record<string, unknown>;
  assert.equal(reservation.action, "exit");
  assert.equal(reservation.sourceEventId, "exit-event-1");
  assert.equal(reservation.requestedQuantity, 2);
  assert.equal(
    (reservation.orderSnapshot as Record<string, unknown>).positionId,
    POSITION.id,
  );
  assert.equal(
    (reservation.orderSnapshot as Record<string, unknown>).exitReason,
    "hard_stop",
  );
  const execution = calls.find((call) => call.stage === "execute")!
    .value as Record<string, unknown>;
  assert.deepEqual(execution.algoContext, {
    deploymentId: "deployment-1",
    targetId: "target-1",
    positionId: POSITION.id,
    targetExecutionId: "execution-1",
  });
});

test("live target manager does not call Robinhood outside the option session", async () => {
  let quoteReads = 0;
  const context = {
    appUserId: "user-1",
    deploymentId: "deployment-1",
    targetId: "target-1",
    accountId: "account-1",
    providerAccountId: "robinhood:123456789",
    provider: "robinhood" as const,
    symbol: "AAPL",
    deploymentConfig: {},
    position: {
      ...POSITION,
      appUserId: "user-1",
      deploymentId: "deployment-1",
      targetId: "target-1",
      strategyPositionKey: "signal-options:entry-event-1",
      symbol: "AAPL",
      status: "open" as const,
      contractSnapshot: {},
    },
  };
  const result = await manageSignalOptionsLiveTargetPosition(context, {
    now: () => new Date("2026-07-22T02:00:00.000Z"),
    readRobinhoodQuote: async () => {
      quoteReads += 1;
      throw new Error("quote must not be read while closed");
    },
  });
  assert.equal(result.status, "session_closed");
  assert.equal(result.plan, null);
  assert.equal(quoteReads, 0);
});

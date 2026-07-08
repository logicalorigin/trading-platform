import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { type ExecutionEvent } from "@workspace/db";

import {
  __signalOptionsAutomationInternalsForTests as internals,
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
  type SignalOptionsPosition,
} from "./signal-options-automation";

const DEPLOYMENT_ID = "dep-opposite-dual";

function profile(input?: { enabled?: boolean; fraction?: number }) {
  return resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      flipOnOppositeSignal: true,
      oppositeSignalDualConfirm: {
        enabled: input?.enabled ?? true,
        firstBarSellFractionPct: input?.fraction ?? 50,
      },
    },
  });
}

function position(input?: {
  quantity?: number;
  tier?: "high" | "standard" | "low";
  pending?: SignalOptionsPosition["oppositeSignalPendingConfirm"];
}): SignalOptionsPosition {
  return {
    id: "position-1",
    candidateId: "candidate-entry",
    symbol: "AAPL",
    direction: "buy",
    optionRight: "call",
    timeframe: "15m",
    signalAt: "2026-07-07T14:15:00.000Z",
    openedAt: "2026-07-07T14:30:00.000Z",
    entryPrice: 1,
    quantity: input?.quantity ?? 4,
    peakPrice: 1.4,
    stopPrice: 0.7,
    premiumAtRisk: (input?.quantity ?? 4) * 100,
    selectedContract: {
      underlying: "AAPL",
      expirationDate: "2026-07-17",
      strike: 200,
      right: "call",
      multiplier: 100,
    },
    lastMarkPrice: 1.2,
    lastMarkedAt: "2026-07-07T14:45:00.000Z",
    signalQuality: input?.tier
      ? {
          tier: input.tier,
          liquidityTier: "standard",
          score: input.tier === "low" ? 20 : input.tier === "high" ? 80 : 50,
          reasons: [],
          adx: null,
          mtfMatches: 2,
          mtfDirections: [1, 1],
          spreadPctOfMid: null,
          bullishRegime: true,
        }
      : null,
    oppositeSignalPendingConfirm: input?.pending ?? null,
  };
}

function entryEvent(input?: { quantity?: number }): ExecutionEvent {
  const pos = position({ quantity: input?.quantity ?? 4 });
  return {
    id: "entry-1",
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    symbol: "AAPL",
    summary: "entry",
    occurredAt: new Date("2026-07-07T14:30:00.000Z"),
    payload: {
      position: pos,
      candidate: {
        id: pos.candidateId,
        direction: pos.direction,
        optionRight: pos.optionRight,
        timeframe: pos.timeframe,
        signalAt: pos.signalAt,
      },
      selectedContract: pos.selectedContract,
    },
  } as unknown as ExecutionEvent;
}

function partialOppositeExitEvent(): ExecutionEvent {
  const preExit = position({ quantity: 4 });
  const remainingPosition = {
    ...preExit,
    quantity: 2,
    premiumAtRisk: 200,
    oppositeSignalPendingConfirm: {
      signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
      signalAt: "2026-07-07T14:45:00.000Z",
      direction: "sell",
      candidateId: "candidate-sell-1",
    },
  };
  return {
    id: "partial-1",
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    symbol: "AAPL",
    summary: "opposite partial",
    occurredAt: new Date("2026-07-07T14:45:00.000Z"),
    payload: {
      reason: "opposite_signal",
      partial: true,
      scaleOutId: "opposite_signal_first_confirm",
      exitQuantity: 2,
      remainingQuantity: 2,
      position: {
        ...preExit,
        quantity: 2,
        premiumAtRisk: 200,
      },
      remainingPosition,
      selectedContract: preExit.selectedContract,
      pnl: 40,
    },
  } as unknown as ExecutionEvent;
}

test("first opposite confirm emits a one-time half exit with pending state", () => {
  const action = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile({ fraction: 50 }),
    position: position({ quantity: 4 }),
    signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
    signalAt: "2026-07-07T14:45:00.000Z",
    candidateDirection: "sell",
    candidateId: "candidate-sell-1",
  });

  assert.equal(action.kind, "partial_exit");
  assert.equal(action.exitQuantity, 2);
  assert.equal(action.remainingQuantity, 2);
  assert.equal(action.pendingConfirm.direction, "sell");
});

test("second consecutive opposite confirm exits the residual with opposite_signal", () => {
  const action = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile(),
    position: position({
      quantity: 2,
      pending: {
        signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
        signalAt: "2026-07-07T14:45:00.000Z",
        direction: "sell",
        candidateId: "candidate-sell-1",
      },
    }),
    signalKey: "AAPL:15m:2026-07-07T15:00:00.000Z:sell",
    signalAt: "2026-07-07T15:00:00.000Z",
    candidateDirection: "sell",
    candidateId: "candidate-sell-2",
  });

  assert.deepEqual(action, {
    kind: "full_exit",
    reason: "second_confirm",
    exitReason: "opposite_signal",
  });
});

test("same opposite confirm signal cannot sell the residual twice", () => {
  const action = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile(),
    position: position({
      quantity: 2,
      pending: {
        signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
        signalAt: "2026-07-07T14:45:00.000Z",
        direction: "sell",
        candidateId: "candidate-sell-1",
      },
    }),
    signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
    signalAt: "2026-07-07T14:45:00.000Z",
    candidateDirection: "sell",
    candidateId: "candidate-sell-1",
  });

  assert.deepEqual(action, {
    kind: "hold",
    reason: "duplicate_pending_confirm",
  });
});

test("direction resume clears pending state during replay", () => {
  const clear = internals.buildOppositeSignalPendingConfirmClearPosition(
    position({
      quantity: 2,
      pending: {
        signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
        signalAt: "2026-07-07T14:45:00.000Z",
        direction: "sell",
      },
    }),
  );
  const clearEvent = {
    id: "clear-1",
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    symbol: "AAPL",
    summary: "clear pending",
    occurredAt: new Date("2026-07-07T15:00:00.000Z"),
    payload: {
      reason: "opposite_signal_pending_confirm_cleared",
      position: clear,
    },
  } as unknown as ExecutionEvent;

  const [replayed] = internals.deriveActivePositions([
    entryEvent({ quantity: 4 }),
    partialOppositeExitEvent(),
    clearEvent,
  ]) as SignalOptionsPosition[];

  assert.equal(replayed?.quantity, 2);
  assert.equal(replayed?.oppositeSignalPendingConfirm, null);
});

test("one-contract position keeps immediate full-exit behavior", () => {
  const action = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile(),
    position: position({ quantity: 1 }),
    signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
    signalAt: "2026-07-07T14:45:00.000Z",
    candidateDirection: "sell",
  });

  assert.deepEqual(action, {
    kind: "full_exit",
    reason: "single_contract",
    exitReason: "opposite_signal",
  });
});

test("low quality position keeps immediate full-exit behavior", () => {
  const action = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile(),
    position: position({ quantity: 4, tier: "low" }),
    signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
    signalAt: "2026-07-07T14:45:00.000Z",
    candidateDirection: "sell",
  });

  assert.deepEqual(action, {
    kind: "full_exit",
    reason: "low_quality",
    exitReason: "opposite_signal",
  });
});

test("flip precedence waits until the full-exit confirm", () => {
  const first = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile(),
    position: position({ quantity: 4 }),
    signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
    signalAt: "2026-07-07T14:45:00.000Z",
    candidateDirection: "sell",
  });
  assert.equal(first.kind, "partial_exit");

  const second = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile(),
    position: position({
      quantity: 2,
      pending: first.kind === "partial_exit" ? first.pendingConfirm : null,
    }),
    signalKey: "AAPL:15m:2026-07-07T15:00:00.000Z:sell",
    signalAt: "2026-07-07T15:00:00.000Z",
    candidateDirection: "sell",
  });
  assert.equal(second.kind, "full_exit");
});

test("disabled flag preserves immediate full-exit behavior", () => {
  const action = internals.resolveOppositeSignalDualConfirmAction({
    profile: profile({ enabled: false }),
    position: position({ quantity: 4 }),
    signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
    signalAt: "2026-07-07T14:45:00.000Z",
    candidateDirection: "sell",
  });

  assert.deepEqual(action, {
    kind: "full_exit",
    reason: "disabled",
    exitReason: "opposite_signal",
  });
});

test("pending confirm survives restart replay from remainingPosition", () => {
  const [replayed] = internals.deriveActivePositions([
    entryEvent({ quantity: 4 }),
    partialOppositeExitEvent(),
  ]) as SignalOptionsPosition[];

  assert.equal(replayed?.quantity, 2);
  assert.deepEqual(replayed?.oppositeSignalPendingConfirm, {
    signalKey: "AAPL:15m:2026-07-07T14:45:00.000Z:sell",
    signalAt: "2026-07-07T14:45:00.000Z",
    direction: "sell",
    candidateId: "candidate-sell-1",
  });
});

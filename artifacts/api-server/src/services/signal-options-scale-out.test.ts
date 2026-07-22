import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { type ExecutionEvent } from "@workspace/db";

import {
  __signalOptionsAutomationInternalsForTests as internals,
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  type SignalOptionsPosition,
} from "./signal-options-automation";
import { computeSignalOptionsPositionStop } from "./signal-options-exit-policy";

const DEPLOYMENT_ID = "dep-scale";
const NOW = new Date("2026-07-07T15:30:00.000Z");

function scaleOutProfile() {
  return resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      scaleOut: {
        enabled: true,
        sellFractionPct: 60,
        runnerGivebackPct: 30,
      },
    },
  });
}

function entryEvent(input: { quantity: number; premiumAtRisk?: number }): ExecutionEvent {
  return {
    id: "entry-1",
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    symbol: "AAPL",
    summary: "entry",
    occurredAt: new Date("2026-07-07T14:30:00.000Z"),
    payload: {
      position: {
        id: "position-1",
        candidateId: "candidate-1",
        symbol: "AAPL",
        direction: "buy",
        optionRight: "call",
        timeframe: "15m",
        signalAt: "2026-07-07T14:15:00.000Z",
        openedAt: "2026-07-07T14:30:00.000Z",
        entryPrice: 1,
        quantity: input.quantity,
        peakPrice: 1,
        stopPrice: 0.6,
        premiumAtRisk: input.premiumAtRisk ?? input.quantity * 100,
        selectedContract: {
          underlying: "AAPL",
          expirationDate: "2026-07-17",
          strike: 200,
          right: "call",
          multiplier: 100,
        },
      },
      candidate: {
        id: "candidate-1",
        direction: "buy",
        optionRight: "call",
        signalAt: "2026-07-07T14:15:00.000Z",
      },
    },
  } as unknown as ExecutionEvent;
}

function exitEvent(input: {
  id: string;
  quantity?: number;
  pnl: number;
  partial?: boolean;
  scaleOutId?: string;
  occurredAt?: Date;
  remainingPosition?: Record<string, unknown>;
}): ExecutionEvent {
  return {
    id: input.id,
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    symbol: "AAPL",
    summary: input.partial ? "scale out" : "final exit",
    occurredAt: input.occurredAt ?? NOW,
    payload: {
      reason: input.partial ? "scale_out_first_trail_arm" : "runner_trail_stop",
      partial: input.partial === true,
      scaleOutId: input.scaleOutId,
      exitQuantity: input.quantity,
      pnl: input.pnl,
      position: {
        id: "position-1",
        candidateId: "candidate-1",
        quantity: input.quantity,
      },
      remainingPosition: input.remainingPosition,
      selectedContract: {
        underlying: "AAPL",
        expirationDate: "2026-07-17",
        strike: 200,
        right: "call",
        multiplier: 100,
      },
    },
  } as unknown as ExecutionEvent;
}

test("scale-out decision fires once at first trail arm and clamps sold quantity", () => {
  const profile = scaleOutProfile();

  const oneContract = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 120,
    profile,
    quantity: 1,
  });
  assert.equal(oneContract.scaleOutArmed, false);
  assert.equal(oneContract.exitQuantity, undefined);

  const twoContracts = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 120,
    profile,
    quantity: 2,
  });
  assert.equal(twoContracts.scaleOutArmed, true);
  assert.equal(twoContracts.exitQuantity, 1);

  const fiveContracts = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 120,
    profile,
    quantity: 5,
  });
  assert.equal(fiveContracts.scaleOutArmed, true);
  assert.equal(fiveContracts.exitQuantity, 3);

  const alreadyFired = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 120,
    profile,
    quantity: 5,
    scaleOutAlreadyFired: true,
  });
  assert.equal(alreadyFired.scaleOutArmed, false);
  assert.equal(alreadyFired.exitQuantity, undefined);
});

test("scale-out residual keeps the user-configured progressive trail", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      progressiveTrailEnabled: true,
      progressiveTrailSteps: [
        { activationPct: 20, minLockedGainPct: 0, givebackPct: 10 },
      ],
      scaleOut: {
        enabled: true,
        sellFractionPct: 60,
        runnerGivebackPct: 30,
      },
    },
  });
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 200,
    markPrice: 180,
    profile,
    quantity: 2,
    scaleOutAlreadyFired: true,
  });

  assert.equal(stop.returnPct, 100);
  assert.equal(stop.givebackPct, 10);
  assert.equal(stop.trailStopPrice, 190);
  assert.equal(stop.scaleOutArmed, false);
});

test("scale-out residual keeps the user-configured base profit retracement", () => {
  const profile = resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      trailGivebackPct: 10,
      scaleOut: {
        enabled: true,
        sellFractionPct: 60,
        runnerGivebackPct: 30,
      },
    },
  });
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 200,
    markPrice: 180,
    profile,
    quantity: 2,
    scaleOutAlreadyFired: true,
  });

  assert.equal(stop.givebackPct, 10);
  assert.equal(stop.trailStopPrice, 190);
});

test("absent scaleOut config preserves full-close stop behavior", () => {
  const stop = computeSignalOptionsPositionStop({
    entryPrice: 100,
    peakPrice: 140,
    markPrice: 100,
    profile: resolveSignalOptionsExecutionProfile({}),
    quantity: 5,
  });

  assert.equal(stop.trailActive, true);
  assert.equal(stop.trailStopPrice, 130);
  assert.equal(stop.exitQuantity, undefined);
  assert.equal(stop.scaleOutArmed, false);
});

test("fold retains a position after partial exit and deletes it after final exit", () => {
  const partial = exitEvent({
    id: "partial-1",
    quantity: 3,
    pnl: 120,
    partial: true,
    scaleOutId: "first_trail_arm",
    remainingPosition: {
      id: "position-1",
      candidateId: "candidate-1",
      quantity: 2,
      peakPrice: 2.5,
      stopPrice: 1.75,
      lastStop: { givebackPct: 30, stopPrice: 1.75 },
      lastWireTrail: { active: true },
    },
  });
  const positionsAfterPartial = internals.deriveActivePositions([
    entryEvent({ quantity: 5, premiumAtRisk: 500 }),
    partial,
  ]);

  assert.equal(positionsAfterPartial.length, 1);
  assert.equal(positionsAfterPartial[0]?.quantity, 2);
  assert.equal(positionsAfterPartial[0]?.premiumAtRisk, 200);
  assert.equal(positionsAfterPartial[0]?.peakPrice, 2.5);
  assert.equal(positionsAfterPartial[0]?.stopPrice, 1.75);
  assert.deepEqual(positionsAfterPartial[0]?.lastStop, {
    givebackPct: 30,
    stopPrice: 1.75,
  });

  const positionsAfterFinal = internals.deriveActivePositions([
    entryEvent({ quantity: 5, premiumAtRisk: 500 }),
    partial,
    exitEvent({ id: "final-1", quantity: 2, pnl: 80 }),
  ]);
  assert.equal(positionsAfterFinal.length, 0);
});

test("fold replay exposes fired scale-out marker so restart replay cannot re-fire", () => {
  const events = [
    entryEvent({ quantity: 5, premiumAtRisk: 500 }),
    exitEvent({
      id: "partial-1",
      quantity: 3,
      pnl: 120,
      partial: true,
      scaleOutId: "first_trail_arm",
    }),
  ];
  const [position] = internals.deriveActivePositions(events) as SignalOptionsPosition[];

  assert.equal(position?.quantity, 2);
  assert.equal(
    internals.signalOptionsPositionScaleOutAlreadyFired({
      events,
      position: position!,
      scaleOutId: "first_trail_arm",
    }),
    true,
  );
});

test("a prior lifecycle scale-out marker does not suppress a same-identity re-entry", () => {
  const priorScaleOut = exitEvent({
    id: "partial-prior-lifecycle",
    quantity: 3,
    pnl: 120,
    partial: true,
    scaleOutId: "first_trail_arm",
  });
  priorScaleOut.payload = {
    ...(priorScaleOut.payload as Record<string, unknown>),
    position: {
      id: "position-1",
      candidateId: "candidate-1",
      openedAt: "2026-07-07T14:30:00.000Z",
    },
  };
  const reEntry = {
    ...(internals.deriveActivePositions([
      entryEvent({ quantity: 5, premiumAtRisk: 500 }),
    ])[0] as SignalOptionsPosition),
    openedAt: "2026-07-07T15:00:00.000Z",
  };

  assert.equal(
    internals.signalOptionsPositionScaleOutAlreadyFired({
      events: [priorScaleOut],
      position: reEntry,
      scaleOutId: "first_trail_arm",
    }),
    false,
  );
});

test("claim keys allow scale-out plus final exit while blocking duplicate scale-out", () => {
  internals.__resetSignalOptionsClaimedExitsForTests();

  assert.equal(
    internals.tryClaimSignalOptionsPositionExit(
      `${DEPLOYMENT_ID}:position-1:scale-out:first_trail_arm`,
      NOW.getTime(),
    ),
    true,
  );
  assert.equal(
    internals.tryClaimSignalOptionsPositionExit(
      `${DEPLOYMENT_ID}:position-1:scale-out:first_trail_arm`,
      NOW.getTime() + 1,
    ),
    false,
  );
  assert.equal(
    internals.tryClaimSignalOptionsPositionExit(
      `${DEPLOYMENT_ID}:position-1`,
      NOW.getTime() + 2,
    ),
    true,
  );
});

test("daily P&L sums fee-aware scale-out and final exits but collapses duplicate scale-outs", () => {
  const partial = exitEvent({
    id: "partial-1",
    quantity: 3,
    pnl: 120,
    partial: true,
    scaleOutId: "first_trail_arm",
    occurredAt: new Date("2026-07-07T15:00:00.000Z"),
  });
  const duplicatePartial = exitEvent({
    id: "partial-2",
    quantity: 3,
    pnl: 120,
    partial: true,
    scaleOutId: "first_trail_arm",
    occurredAt: new Date("2026-07-07T15:01:00.000Z"),
  });
  const final = exitEvent({
    id: "final-1",
    quantity: 2,
    pnl: 80,
    occurredAt: new Date("2026-07-07T15:30:00.000Z"),
  });

  assert.equal(
    internals.computeSignalOptionsDailyRealizedPnl(
      [partial, duplicatePartial, final],
      NOW,
    ),
    196.63,
  );
});

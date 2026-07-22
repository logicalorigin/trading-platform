import assert from "node:assert/strict";
import test from "node:test";

import { type ExecutionEvent } from "@workspace/db";

import {
  __signalOptionsAutomationInternalsForTests as internals,
  SIGNAL_OPTIONS_EXIT_EVENT,
} from "./signal-options-automation";

// The daily-loss halt reads computeSignalOptionsDailyRealizedPnl. Duplicate exit
// events for one position (overlapping emitters: tick manager, flip close,
// maintenance) must count ONCE — a double-counted loss trips the halt early and
// blocks the rest of the day's entries. Exits with no position identity fail open.

const NOW = new Date("2026-07-07T15:30:00Z");

function exitEvent(input: {
  id: string;
  positionId?: string | null;
  candidateId?: string | null;
  openedAt?: string | null;
  pnl: number;
  quantity?: number;
  partial?: boolean;
  scaleOutId?: string | null;
  signalKey?: string | null;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
}): ExecutionEvent {
  return {
    id: input.id,
    deploymentId: "dep-1",
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    symbol: "AAPL",
    summary: "exit",
    occurredAt: input.occurredAt ?? NOW,
    payload: {
      pnl: input.pnl,
      position: input.positionId
        ? {
            id: input.positionId,
            candidateId: input.candidateId ?? null,
            openedAt: input.openedAt ?? null,
            quantity: input.quantity,
          }
        : {},
      ...(input.candidateId ? { candidateId: input.candidateId } : {}),
      ...(input.partial ? { partial: true } : {}),
      ...(input.scaleOutId ? { scaleOutId: input.scaleOutId } : {}),
      ...(input.signalKey ? { signalKey: input.signalKey } : {}),
      // Live NYSE session timestamp so the actionable-session filter admits it.
      exitSessions: undefined,
      ...input.payload,
    },
  } as unknown as ExecutionEvent;
}

test("duplicate exits for the same position id count once", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({ id: "e1", positionId: "p-1", pnl: -250 }),
      exitEvent({ id: "e2", positionId: "p-1", pnl: -250 }),
    ],
    NOW,
  );
  assert.equal(total, -250);
});

test("duplicate exit dedup is independent of caller event order", () => {
  const older = exitEvent({
    id: "e1",
    positionId: "p-1",
    pnl: -250,
    occurredAt: new Date("2026-07-07T14:30:00Z"),
  });
  const newer = exitEvent({
    id: "e2",
    positionId: "p-1",
    pnl: -175,
    occurredAt: new Date("2026-07-07T15:30:00Z"),
  });

  assert.equal(
    internals.computeSignalOptionsDailyRealizedPnl([older, newer], NOW),
    -175,
  );
  assert.equal(
    internals.computeSignalOptionsDailyRealizedPnl([newer, older], NOW),
    -175,
  );
});

test("exits for different positions still sum", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({ id: "e1", positionId: "p-1", pnl: -250 }),
      exitEvent({ id: "e2", positionId: "p-2", pnl: 100 }),
    ],
    NOW,
  );
  assert.equal(total, -150);
});

test("gross exit P&L includes the mirrored Shadow option exit fee", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [exitEvent({ id: "e1", positionId: "p-1", pnl: -250, quantity: 1 })],
    NOW,
  );

  assert.equal(total, -250.67);
});

test("same-symbol re-entry lifecycles sum even when the logical position id is reused", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({
        id: "e1",
        positionId: "deployment-1:AAPL",
        candidateId: "candidate-reused",
        openedAt: "2026-07-07T14:00:00.000Z",
        pnl: -261,
        occurredAt: new Date("2026-07-07T14:30:00Z"),
      }),
      exitEvent({
        id: "e2",
        positionId: "deployment-1:AAPL",
        candidateId: "candidate-reused",
        openedAt: "2026-07-07T15:00:00.000Z",
        pnl: -267,
        occurredAt: new Date("2026-07-07T15:30:00Z"),
      }),
    ],
    NOW,
  );

  assert.equal(total, -528);
});

test("a legacy final exit without openedAt dedups against its lifecycle repair", () => {
  const common = {
    positionId: "deployment-1:AAPL",
    candidateId: "candidate-current",
    pnl: -261,
    occurredAt: new Date("2026-07-07T14:30:00Z"),
  };
  const legacy = exitEvent({ id: "legacy-final", ...common });
  const repair = exitEvent({
    id: "lifecycle-repair",
    ...common,
    openedAt: "2026-07-07T14:00:00.000Z",
  });

  assert.equal(
    internals.computeSignalOptionsDailyRealizedPnl([legacy, repair], NOW),
    -261,
  );
  assert.equal(
    internals.computeSignalOptionsDailyRealizedPnl([repair, legacy], NOW),
    -261,
  );
});

test("legacy repair dedup stays scoped to each reused lifecycle window", () => {
  const lifecycle = (input: {
    suffix: string;
    openedAt: string;
    closedAt: string;
    pnl: number;
  }) => {
    const common = {
      positionId: "deployment-1:AAPL",
      candidateId: "candidate-reused",
      pnl: input.pnl,
      occurredAt: new Date(input.closedAt),
    };
    return [
      exitEvent({ id: `legacy-${input.suffix}`, ...common }),
      exitEvent({
        id: `repair-${input.suffix}`,
        ...common,
        openedAt: input.openedAt,
      }),
    ];
  };
  const events = [
    ...lifecycle({
      suffix: "one",
      openedAt: "2026-07-07T14:00:00.000Z",
      closedAt: "2026-07-07T14:30:00.000Z",
      pnl: -261,
    }),
    ...lifecycle({
      suffix: "two",
      openedAt: "2026-07-07T15:00:00.000Z",
      closedAt: "2026-07-07T15:30:00.000Z",
      pnl: 100,
    }),
  ];

  assert.equal(
    internals.computeSignalOptionsDailyRealizedPnl(events, NOW),
    -161,
  );
  assert.equal(
    internals.computeSignalOptionsDailyRealizedPnl([...events].reverse(), NOW),
    -161,
  );
});

test("separate opposite-signal partial exits on one lifecycle both count", () => {
  const common = {
    positionId: "deployment-1:AAPL",
    candidateId: "candidate-reused",
    openedAt: "2026-07-07T14:00:00.000Z",
    partial: true,
    scaleOutId: "opposite_signal_first_confirm",
  };
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({
        ...common,
        id: "e1",
        signalKey: "AAPL|sell|2026-07-07T14:30:00.000Z",
        pnl: -40,
      }),
      exitEvent({
        ...common,
        id: "e2",
        signalKey: "AAPL|sell|2026-07-07T15:00:00.000Z",
        pnl: -50,
      }),
    ],
    NOW,
  );

  assert.equal(total, -90);
});

test("candidate id dedups when position id is absent", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({ id: "e1", candidateId: "c-1", pnl: -80 }),
      exitEvent({ id: "e2", candidateId: "c-1", pnl: -80 }),
    ],
    NOW,
  );
  assert.equal(total, -80);
});

test("exits with no identity fail open (both counted)", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({ id: "e1", pnl: -50 }),
      exitEvent({ id: "e2", pnl: -60 }),
    ],
    NOW,
  );
  assert.equal(total, -110);
});

test("other-day exits stay excluded (dedup does not widen the window)", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({ id: "e1", positionId: "p-1", pnl: -250 }),
      exitEvent({
        id: "e2",
        positionId: "p-2",
        pnl: -999,
        occurredAt: new Date("2026-07-06T15:30:00Z"),
      }),
    ],
    NOW,
  );
  assert.equal(total, -250);
});

test("same-day historical exits do not contribute to the live daily-loss P&L", () => {
  const total = internals.computeSignalOptionsDailyRealizedPnl(
    [
      exitEvent({
        id: "live",
        positionId: "p-live",
        pnl: -25,
        quantity: 1,
      }),
      exitEvent({
        id: "historical",
        positionId: "p-historical",
        pnl: -999,
        payload: {
          backfillEventKey: "signal_options_backfill:AAPL:exit",
          metadata: {
            runMode: "historical_backfill",
            runSource: "signal_options_backfill",
          },
        },
      }),
    ],
    NOW,
  );

  assert.equal(total, -25.67);
});

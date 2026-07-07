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
  pnl: number;
  occurredAt?: Date;
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
        ? { id: input.positionId, candidateId: input.candidateId ?? null }
        : {},
      ...(input.candidateId ? { candidateId: input.candidateId } : {}),
      // Live NYSE session timestamp so the actionable-session filter admits it.
      exitSessions: undefined,
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

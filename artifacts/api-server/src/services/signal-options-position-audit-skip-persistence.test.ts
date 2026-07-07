import assert from "node:assert/strict";
import test from "node:test";

import { type ExecutionEvent } from "@workspace/db";

import {
  __signalOptionsAutomationInternalsForTests as internals,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
} from "./signal-options-automation";

function skippedEvent(reason: string): ExecutionEvent {
  return {
    id: `evt-${reason}`,
    deploymentId: "dep-position-audit-skip",
    algoRunId: null,
    providerAccountId: "shadow",
    symbol: "AAPL",
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    summary: "skip",
    occurredAt: new Date("2026-07-07T12:00:00.000Z"),
    createdAt: new Date("2026-07-07T12:00:00.000Z"),
    updatedAt: new Date("2026-07-07T12:00:00.000Z"),
    payload: {
      reason,
      position: {
        id: "pos-1",
        candidateId: "cand-1",
      },
    },
  } as unknown as ExecutionEvent;
}

test("position-audit skips persist to the ledger under authoritative tally mode", () => {
  for (const reason of [
    "position_exit_quote_unavailable",
    "after_hours_option_exit_blocked",
  ]) {
    assert.equal(
      internals.shouldPersistSignalOptionsEventToLedger({
        event: skippedEvent(reason),
        mode: "on",
      }),
      true,
      `${reason} should persist`,
    );
  }
});

test("entry-candidate firehose skips remain memory-only under authoritative tally mode", () => {
  assert.equal(
    internals.shouldPersistSignalOptionsEventToLedger({
      event: skippedEvent("mtf_not_aligned"),
      mode: "on",
    }),
    false,
  );
});

test("position-audit skips are not extracted into the seen-signal store", () => {
  for (const reason of [
    "position_exit_quote_unavailable",
    "after_hours_option_exit_blocked",
  ]) {
    const event = skippedEvent(reason);
    assert.equal(internals.isSignalOptionsSeenSignalStoreCandidate(event), false);
    assert.equal(internals.extractSignalOptionsSeenSignalRow(event), null);
  }
});

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

const DEPLOYMENT_ID = "dep-reentry";
const EXIT_AT = new Date("2026-07-07T15:00:00.000Z");

function profile(input?: {
  enabled?: boolean;
  watchWindowBars?: number;
  maxReEntriesPerSignal?: number;
}) {
  return resolveSignalOptionsExecutionProfile({
    exitPolicy: {
      reEntryWatch: {
        enabled: input?.enabled ?? true,
        watchWindowBars: input?.watchWindowBars ?? 6,
        maxReEntriesPerSignal: input?.maxReEntriesPerSignal ?? 1,
      },
    },
  });
}

function position(input?: {
  sourceSignalKey?: string | null;
  reEntries?: number;
}): SignalOptionsPosition {
  const watch = input?.reEntries
    ? {
        key: "AAPL|15m|buy|source-sig",
        symbol: "AAPL",
        direction: "buy" as const,
        timeframe: "15m",
        sourceSignalKey: input.sourceSignalKey ?? "source-sig",
        sourceCandidateId: "candidate-entry",
        sourceSignalAt: "2026-07-07T14:30:00.000Z",
        exitReason: "early_invalidation",
        exitAt: EXIT_AT.toISOString(),
        exitUnderlyingPrice: 189.45,
        reEntries: input.reEntries,
      }
    : null;
  return {
    id: "position-1",
    candidateId: "candidate-entry",
    symbol: "AAPL",
    direction: "buy",
    optionRight: "call",
    timeframe: "15m",
    signalAt: "2026-07-07T14:30:00.000Z",
    sourceSignalKey: input?.sourceSignalKey ?? "source-sig",
    openedAt: "2026-07-07T14:31:00.000Z",
    entryPrice: 1,
    quantity: 1,
    peakPrice: 1,
    stopPrice: 0.6,
    premiumAtRisk: 100,
    selectedContract: {
      underlying: "AAPL",
      expirationDate: "2026-07-17",
      strike: 200,
      right: "call",
      multiplier: 100,
    },
    reEntryWatch: watch,
  } as SignalOptionsPosition;
}

function entryEvent(): ExecutionEvent {
  const pos = position();
  return {
    id: "entry-1",
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    symbol: "AAPL",
    summary: "entry",
    occurredAt: new Date("2026-07-07T14:31:00.000Z"),
    payload: {
      signalKey: "source-sig",
      position: pos,
      candidate: {
        id: pos.candidateId,
        symbol: "AAPL",
        direction: "buy",
        optionRight: "call",
        timeframe: "15m",
        signalAt: pos.signalAt,
      },
      selectedContract: pos.selectedContract,
    },
  } as unknown as ExecutionEvent;
}

function exitEvent(reason: string): ExecutionEvent {
  const pos = position();
  const reEntryWatch = internals.buildSignalOptionsReEntryWatchFromExit({
    profile: profile(),
    position: pos,
    reason,
    occurredAt: EXIT_AT,
    exitUnderlyingPrice: 189.45,
  });
  return {
    id: `exit-${reason}`,
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    symbol: "AAPL",
    summary: "exit",
    occurredAt: EXIT_AT,
    payload: {
      reason,
      position: pos,
      selectedContract: pos.selectedContract,
      reEntryWatch,
    },
  } as unknown as ExecutionEvent;
}

function actionableState(input?: {
  symbol?: string;
  direction?: "buy" | "sell";
  latestBarAt?: string;
  barsSinceSignal?: number;
}) {
  return {
    profileId: "profile-1",
    symbol: input?.symbol ?? "AAPL",
    timeframe: "15m" as const,
    currentSignalDirection: input?.direction ?? "buy",
    currentSignalAt: "2026-07-07T14:30:00.000Z",
    currentSignalPrice: 190,
    latestBarAt: input?.latestBarAt ?? "2026-07-07T15:45:00.000Z",
    barsSinceSignal: input?.barsSinceSignal ?? 5,
    fresh: true,
    status: "ok",
  };
}

test("watch entry is created for early-invalidation and hard-stop exits only", () => {
  for (const reason of ["early_invalidation", "hard_stop"]) {
    const watch = internals.buildSignalOptionsReEntryWatchFromExit({
      profile: profile(),
      position: position(),
      reason,
      occurredAt: EXIT_AT,
      exitUnderlyingPrice: 189.45,
    });
    assert.ok(watch, reason);
    assert.equal(watch.symbol, "AAPL");
    assert.equal(watch.direction, "buy");
    assert.equal(watch.sourceSignalKey, "source-sig");
    assert.equal(watch.exitReason, reason);
    assert.equal(watch.reEntries, 0);
  }

  for (const reason of ["runner_trail_stop", "opposite_signal", "expiration"]) {
    assert.equal(
      internals.buildSignalOptionsReEntryWatchFromExit({
        profile: profile(),
        position: position(),
        reason,
        occurredAt: EXIT_AT,
        exitUnderlyingPrice: 189.45,
      }),
      null,
      reason,
    );
  }

  const folded = internals.deriveSignalOptionsPositionState([
    entryEvent(),
    exitEvent("early_invalidation"),
  ]);
  assert.equal(folded.positions.length, 0);
  assert.equal(folded.reEntryWatches.length, 1);
  assert.equal(folded.reEntryWatches[0]?.sourceSignalKey, "source-sig");
});

test("re-entry watch selects an actionable same-direction signal inside the watch window", () => {
  const folded = internals.deriveSignalOptionsPositionState([
    entryEvent(),
    exitEvent("early_invalidation"),
  ]);
  const selected = internals.selectSignalOptionsReEntryWatchForState({
    profile: profile({ watchWindowBars: 6 }),
    watches: folded.reEntryWatches,
    state: actionableState(),
    signalKey: "source-sig",
  });

  assert.equal(selected?.sourceSignalKey, "source-sig");
});

test("re-entry watch suppresses signals outside the watch window", () => {
  const folded = internals.deriveSignalOptionsPositionState([
    entryEvent(),
    exitEvent("early_invalidation"),
  ]);
  const selected = internals.selectSignalOptionsReEntryWatchForState({
    profile: profile({ watchWindowBars: 6 }),
    watches: folded.reEntryWatches,
    state: actionableState({
      latestBarAt: "2026-07-07T16:46:00.000Z",
      barsSinceSignal: 8,
    }),
    signalKey: "source-sig",
  });

  assert.equal(selected, null);
});

test("max re-entries per source signal is respected", () => {
  const cappedWatch = internals.buildSignalOptionsReEntryWatchFromExit({
    profile: profile({ maxReEntriesPerSignal: 1 }),
    position: position({ reEntries: 1 }),
    reason: "hard_stop",
    occurredAt: EXIT_AT,
    exitUnderlyingPrice: 189.45,
  });
  assert.ok(cappedWatch);
  const selected = internals.selectSignalOptionsReEntryWatchForState({
    profile: profile({ maxReEntriesPerSignal: 1 }),
    watches: [cappedWatch],
    state: actionableState(),
    signalKey: "source-sig",
  });

  assert.equal(selected, null);
});

test("seen-signal dedup is bypassed only for matching watched setups", () => {
  const folded = internals.deriveSignalOptionsPositionState([
    entryEvent(),
    exitEvent("early_invalidation"),
  ]);
  const seenSignals = new Set(["source-sig"]);

  const watched = internals.signalOptionsReEntrySeenSignalBypass({
    profile: profile(),
    watches: folded.reEntryWatches,
    seenSignals,
    state: actionableState(),
    signalKey: "source-sig",
  });
  assert.equal(watched?.sourceSignalKey, "source-sig");

  const unrelated = internals.signalOptionsReEntrySeenSignalBypass({
    profile: profile(),
    watches: folded.reEntryWatches,
    seenSignals,
    state: actionableState({ symbol: "MSFT" }),
    signalKey: "source-sig",
  });
  assert.equal(unrelated, null);
});

test("disabled re-entry watch leaves exit and seen-signal behavior unchanged", () => {
  const disabled = resolveSignalOptionsExecutionProfile({});
  const seenSignals = new Set(["source-sig"]);

  assert.equal(
    internals.buildSignalOptionsReEntryWatchFromExit({
      profile: disabled,
      position: position(),
      reason: "early_invalidation",
      occurredAt: EXIT_AT,
      exitUnderlyingPrice: 189.45,
    }),
    null,
  );
  assert.equal(
    internals.signalOptionsReEntrySeenSignalBypass({
      profile: disabled,
      watches: [],
      seenSignals,
      state: actionableState(),
      signalKey: "source-sig",
    }),
    null,
  );
  assert.equal(seenSignals.has("source-sig"), true);
});

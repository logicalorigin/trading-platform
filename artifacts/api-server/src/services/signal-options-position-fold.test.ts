import assert from "node:assert/strict";
import test from "node:test";

import { type ExecutionEvent } from "@workspace/db";

import {
  __signalOptionsAutomationInternalsForTests as internals,
  SIGNAL_OPTIONS_ENTRY_EVENT,
  SIGNAL_OPTIONS_EXIT_EVENT,
  SIGNAL_OPTIONS_MARK_EVENT,
  SIGNAL_OPTIONS_SKIPPED_EVENT,
  type SignalOptionsPosition,
} from "./signal-options-automation";

// Approach A (push-native running tally) — correctness gate for the position
// fold. The tally applies only NEW events as deltas onto retained state; this
// asserts that folding events incrementally (one at a time, and in ordered
// batches) yields BYTE-IDENTICAL positions to the full deriveActivePositions.
// If this ever fails, the running tally would drift from the ledger => wrong
// positions => a mis-managed real-money trade.

const DEPLOYMENT_ID = "dep-1";
const t = (n: number) => new Date(2_000_000_000_000 + n * 60_000); // ordered, unique

function entryEvent(
  symbol: string,
  n: number,
  opts: { id: string; candidateId: string; entryPrice: number; quantity: number },
): ExecutionEvent {
  return {
    id: `evt-entry-${symbol}-${n}`,
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_ENTRY_EVENT,
    symbol,
    summary: `${symbol} entry`,
    occurredAt: t(n),
    payload: {
      position: {
        id: opts.id,
        candidateId: opts.candidateId,
        entryPrice: opts.entryPrice,
        quantity: opts.quantity,
        direction: "buy",
      },
      candidate: {
        id: opts.candidateId,
        direction: "buy",
        signalAt: t(n).toISOString(),
      },
    },
  } as unknown as ExecutionEvent;
}

function markEvent(
  symbol: string,
  n: number,
  opts: { peakPrice: number; stopPrice: number; lastMarkPrice: number },
): ExecutionEvent {
  return {
    id: `evt-mark-${symbol}-${n}`,
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_MARK_EVENT,
    symbol,
    summary: `${symbol} mark`,
    occurredAt: t(n),
    payload: {
      position: {
        peakPrice: opts.peakPrice,
        stopPrice: opts.stopPrice,
        lastMarkPrice: opts.lastMarkPrice,
        lastMarkedAt: t(n).toISOString(),
      },
    },
  } as unknown as ExecutionEvent;
}

function exitEvent(symbol: string, n: number, candidateId: string): ExecutionEvent {
  return {
    id: `evt-exit-${symbol}-${n}`,
    deploymentId: DEPLOYMENT_ID,
    eventType: SIGNAL_OPTIONS_EXIT_EVENT,
    symbol,
    summary: `${symbol} exit`,
    occurredAt: t(n),
    payload: { position: { candidateId }, candidate: { id: candidateId } },
  } as unknown as ExecutionEvent;
}

// A corpus exercising: two symbols, marks mutating carried positions, a re-entry
// replacing an existing position, and a close + (unclosed) re-entry.
const corpus: ExecutionEvent[] = [
  entryEvent("AAPL", 1, { id: "p-A1", candidateId: "c-A1", entryPrice: 1.5, quantity: 2 }),
  entryEvent("MSFT", 2, { id: "p-M1", candidateId: "c-M1", entryPrice: 3.0, quantity: 1 }),
  markEvent("AAPL", 3, { peakPrice: 1.8, stopPrice: 1.4, lastMarkPrice: 1.7 }),
  markEvent("MSFT", 4, { peakPrice: 3.2, stopPrice: 2.9, lastMarkPrice: 3.1 }),
  markEvent("AAPL", 5, { peakPrice: 2.0, stopPrice: 1.6, lastMarkPrice: 1.95 }),
  exitEvent("MSFT", 6, "c-M1"),
  entryEvent("AAPL", 7, { id: "p-A2", candidateId: "c-A2", entryPrice: 2.1, quantity: 3 }),
  markEvent("AAPL", 8, { peakPrice: 2.4, stopPrice: 1.9, lastMarkPrice: 2.3 }),
  entryEvent("MSFT", 9, { id: "p-M2", candidateId: "c-M2", entryPrice: 3.5, quantity: 1 }),
];

const bySymbol = (positions: SignalOptionsPosition[]) =>
  [...positions].sort((a, b) => a.symbol.localeCompare(b.symbol));

test("fold: one-at-a-time incremental === full deriveActivePositions", () => {
  const full = internals.deriveActivePositions(corpus);
  const sorted = [...corpus].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const state = internals.createSignalOptionsPositionFoldState();
  for (const event of sorted) {
    internals.foldSignalOptionsPositionEvents(state, [event]);
  }
  const incremental = [...state.positions.values()];
  assert.deepEqual(bySymbol(incremental), bySymbol(full));
  // Sanity: MSFT re-opened after its exit, AAPL re-entered.
  assert.equal(incremental.length, 2);
});

test("fold: ordered-batch incremental === full deriveActivePositions", () => {
  const full = internals.deriveActivePositions(corpus);
  const sorted = [...corpus].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  // Split into three ordered batches (mimics successive watermark tail-reads).
  const batches = [sorted.slice(0, 3), sorted.slice(3, 6), sorted.slice(6)];
  const state = internals.createSignalOptionsPositionFoldState();
  for (const batch of batches) {
    internals.foldSignalOptionsPositionEvents(state, batch);
  }
  assert.deepEqual(bySymbol([...state.positions.values()]), bySymbol(full));
});

test("fold: unordered batch still equals full (fold sorts each batch)", () => {
  const full = internals.deriveActivePositions(corpus);
  // Whole corpus handed to the fold in reverse — foldSignalOptionsPositionEvents
  // sorts by occurred_at internally, so a single shuffled batch matches full.
  const state = internals.createSignalOptionsPositionFoldState();
  internals.foldSignalOptionsPositionEvents(state, [...corpus].reverse());
  assert.deepEqual(bySymbol([...state.positions.values()]), bySymbol(full));
});

test("projection: incremental tail-folds === deriveActivePositions(full)", () => {
  const sorted = [...corpus].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const batches = [sorted.slice(0, 3), sorted.slice(3, 6), sorted.slice(6)];
  const projection = internals.createSignalOptionsPositionProjection("sig");
  const eventsFedSoFar: ExecutionEvent[] = [];

  for (const batch of batches) {
    internals.foldTailIntoSignalOptionsProjection(projection, batch);
    eventsFedSoFar.push(...batch);
    assert.deepEqual(
      bySymbol([...projection.foldState.positions.values()]),
      bySymbol(internals.deriveActivePositions(eventsFedSoFar)),
    );
  }
});

test("projection: re-delivered overlap events are not double-folded", () => {
  const sorted = [...corpus].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const batchA = sorted.slice(0, 5);
  const repeated = batchA[batchA.length - 1];
  const newEvent = sorted[5];
  assert.ok(repeated);
  assert.ok(newEvent);

  const projection = internals.createSignalOptionsPositionProjection("sig");
  internals.foldTailIntoSignalOptionsProjection(projection, batchA);
  internals.foldTailIntoSignalOptionsProjection(projection, [
    repeated,
    newEvent,
  ]);

  assert.deepEqual(
    bySymbol([...projection.foldState.positions.values()]),
    bySymbol(internals.deriveActivePositions([...batchA, newEvent])),
  );
});

test("drift helper compares decision position fields", () => {
  const basePosition = {
    id: "p-1",
    candidateId: "c-1",
    symbol: "aapl",
    direction: "buy",
    quantity: 2,
    entryPrice: 1.5,
    peakPrice: 1.8,
    stopPrice: 1.2,
    lastMarkPrice: 1.7,
  } as unknown as SignalOptionsPosition;
  const identicalPosition = {
    ...basePosition,
    symbol: "AAPL",
  } as unknown as SignalOptionsPosition;
  const driftedPosition = {
    ...basePosition,
    quantity: 3,
    peakPrice: 2.1,
  } as unknown as SignalOptionsPosition;

  assert.deepEqual(
    internals.signalOptionsPositionsDrift([basePosition], [identicalPosition]),
    [],
  );
  assert.notEqual(
    internals.signalOptionsPositionsDrift([basePosition], [driftedPosition])
      .length,
    0,
  );
});

function skippedEvent(
  id: string,
  deploymentId: string,
  n: number,
  payload: Record<string, unknown>,
): ExecutionEvent {
  return {
    id,
    deploymentId,
    eventType: SIGNAL_OPTIONS_SKIPPED_EVENT,
    symbol: "AAPL",
    summary: "AAPL candidate skipped",
    occurredAt: t(n),
    payload,
  } as unknown as ExecutionEvent;
}

test("recent skip buffer records entry-candidate skips newest-last", () => {
  const deploymentId = "dep-recent-skips";
  internals.signalOptionsRecentSkips.delete(deploymentId);

  try {
    const events = [1, 2, 3].map((n) =>
      skippedEvent(`evt-skip-${n}`, deploymentId, n, {
        reason: "mtf_not_aligned",
        signalKey: `AAPL:buy:${n}`,
        candidate: {
          id: `candidate-${n}`,
          symbol: "AAPL",
          direction: "buy",
          signalAt: t(n).toISOString(),
        },
      }),
    );

    for (const event of events) {
      assert.equal(internals.isSignalOptionsEntryCandidateSkip(event), true);
      internals.recordSignalOptionsRecentSkip(deploymentId, event);
    }

    assert.deepEqual(
      internals
        .listSignalOptionsRecentSkips(deploymentId)
        .map((event: ExecutionEvent) => event.id),
      ["evt-skip-1", "evt-skip-2", "evt-skip-3"],
    );

    assert.equal(
      internals.isSignalOptionsEntryCandidateSkip(
        skippedEvent("evt-position-mark-skip", deploymentId, 4, {
          reason: "position_mark_timeout",
          signalKey: "AAPL:buy:4",
          candidate: { id: "candidate-4" },
        }),
      ),
      false,
    );

    assert.equal(
      internals.isSignalOptionsEntryCandidateSkip(
        skippedEvent("evt-replay-skip", deploymentId, 5, {
          reason: "mtf_not_aligned",
          signalKey: "AAPL:buy:5",
          candidate: { id: "candidate-5" },
          metadata: { runMode: "replay" },
        }),
      ),
      false,
    );
  } finally {
    internals.signalOptionsRecentSkips.delete(deploymentId);
  }
});

function withSignalKey(event: ExecutionEvent, signalKey: string): ExecutionEvent {
  return {
    ...event,
    payload: {
      ...(event.payload as Record<string, unknown>),
      signalKey,
    },
  } as unknown as ExecutionEvent;
}

type SeenSignalOptions = NonNullable<
  Parameters<typeof internals.seenSignalKeys>[1]
>;

test("dedup partition: (non-firehose events + buffer skips) seen-set === (all events) seen-set", () => {
  const allEvents = [
    withSignalKey(
      entryEvent("AAPL", 20, {
        id: "p-dedup-A1",
        candidateId: "c-dedup-A1",
        entryPrice: 1.5,
        quantity: 1,
      }),
      "s-entry-aapl",
    ),
    skippedEvent("evt-dedup-skip-1", DEPLOYMENT_ID, 21, {
      reason: "mtf_not_aligned",
      signalKey: "s1",
      candidate: { symbol: "AAPL", direction: "buy" },
    }),
    skippedEvent("evt-dedup-skip-2", DEPLOYMENT_ID, 22, {
      reason: "premium_budget_too_small",
      signalKey: "s2",
      candidate: { symbol: "MSFT", direction: "buy" },
    }),
    withSignalKey(exitEvent("AAPL", 23, "c-dedup-A1"), "s-exit-aapl"),
    skippedEvent("evt-dedup-skip-3", DEPLOYMENT_ID, 24, {
      reason: "greek_selector_no_candidates",
      signalKey: "s3",
      candidate: { symbol: "NVDA", direction: "sell" },
    }),
    withSignalKey(
      entryEvent("MSFT", 25, {
        id: "p-dedup-M1",
        candidateId: "c-dedup-M1",
        entryPrice: 2.5,
        quantity: 2,
      }),
      "s-entry-msft",
    ),
  ];
  const firehoseSkips = allEvents.filter((event) =>
    internals.isSignalOptionsEntryCandidateSkip(event),
  );
  const nonFirehoseEvents = allEvents.filter(
    (event) => !internals.isSignalOptionsEntryCandidateSkip(event),
  );
  const seen = (events: ExecutionEvent[], options: SeenSignalOptions) =>
    [...internals.seenSignalKeys(events, options)].sort();
  const optionVariants: SeenSignalOptions[] = [
    {},
    { forceRetryMarketData: true },
  ];

  assert.deepEqual(
    firehoseSkips.map((event) => event.id),
    ["evt-dedup-skip-1", "evt-dedup-skip-2", "evt-dedup-skip-3"],
  );

  for (const options of optionVariants) {
    assert.deepEqual(
      seen(allEvents, options),
      seen([...nonFirehoseEvents, ...firehoseSkips], options),
    );
  }
});

test("recordSignalOptionsRecentSkip dedups by id", () => {
  const deploymentId = "dep-recent-skip-idempotent";
  internals.signalOptionsRecentSkips.delete(deploymentId);

  try {
    const event = skippedEvent("evt-skip-idempotent", deploymentId, 30, {
      reason: "mtf_not_aligned",
      signalKey: "s-idempotent",
      candidate: { symbol: "AAPL", direction: "buy" },
    });

    internals.recordSignalOptionsRecentSkip(deploymentId, event);
    internals.recordSignalOptionsRecentSkip(deploymentId, event);

    assert.deepEqual(
      internals
        .listSignalOptionsRecentSkips(deploymentId)
        .map((skip: ExecutionEvent) => skip.id),
      ["evt-skip-idempotent"],
    );
  } finally {
    internals.signalOptionsRecentSkips.delete(deploymentId);
  }
});

test("tally write policy cuts only entry-candidate skips when authoritative", () => {
  const firehoseSkip = skippedEvent("evt-write-firehose", DEPLOYMENT_ID, 35, {
    reason: "mtf_not_aligned",
    signalKey: "s-firehose",
    candidate: { symbol: "AAPL", direction: "buy" },
  });
  const positionMarkSkip = skippedEvent("evt-write-position", DEPLOYMENT_ID, 36, {
    reason: "position_mark_timeout",
    signalKey: "s-position",
    candidate: { symbol: "AAPL", direction: "buy" },
  });
  const entry = entryEvent("AAPL", 37, {
    id: "p-write-A1",
    candidateId: "c-write-A1",
    entryPrice: 1.5,
    quantity: 1,
  });

  assert.equal(
    internals.shouldPersistSignalOptionsEventToLedger({
      event: firehoseSkip,
      mode: "off",
    }),
    true,
  );
  assert.equal(
    internals.shouldPersistSignalOptionsEventToLedger({
      event: firehoseSkip,
      mode: "shadow",
    }),
    true,
  );
  assert.equal(
    internals.shouldPersistSignalOptionsEventToLedger({
      event: firehoseSkip,
      mode: "on",
    }),
    false,
  );
  assert.equal(
    internals.shouldPersistSignalOptionsEventToLedger({
      event: positionMarkSkip,
      mode: "on",
    }),
    true,
  );
  assert.equal(
    internals.shouldPersistSignalOptionsEventToLedger({
      event: entry,
      mode: "on",
    }),
    true,
  );
});

test("tally read helper merges buffered skips only in authoritative mode", () => {
  const deploymentId = "dep-recent-skip-merge";
  internals.signalOptionsRecentSkips.delete(deploymentId);

  try {
    const ledgerEntry = entryEvent("AAPL", 50, {
      id: "p-merge-A1",
      candidateId: "c-merge-A1",
      entryPrice: 1.5,
      quantity: 1,
    });
    const ledgerSkip = skippedEvent("evt-merge-skip-ledger", deploymentId, 51, {
      reason: "mtf_not_aligned",
      signalKey: "s-ledger",
      candidate: { symbol: "AAPL", direction: "buy" },
    });
    const bufferedSkip = skippedEvent("evt-merge-skip-buffer", deploymentId, 52, {
      reason: "premium_budget_too_small",
      signalKey: "s-buffer",
      candidate: { symbol: "MSFT", direction: "buy" },
    });
    internals.recordSignalOptionsRecentSkip(deploymentId, ledgerSkip);
    internals.recordSignalOptionsRecentSkip(deploymentId, bufferedSkip);

    assert.deepEqual(
      internals
        .signalOptionsEventsWithRecentSkips({
          deploymentId,
          events: [ledgerSkip, ledgerEntry],
          mode: "off",
        })
        .map((event: ExecutionEvent) => event.id),
      ["evt-merge-skip-ledger", "evt-entry-AAPL-50"],
    );
    assert.deepEqual(
      internals
        .signalOptionsEventsWithRecentSkips({
          deploymentId,
          events: [ledgerSkip, ledgerEntry],
          mode: "on",
        })
        .map((event: ExecutionEvent) => event.id),
      [
        "evt-merge-skip-buffer",
        "evt-merge-skip-ledger",
        "evt-entry-AAPL-50",
      ],
    );
  } finally {
    internals.signalOptionsRecentSkips.delete(deploymentId);
  }
});

function controlUpdatedEvent(n: number): ExecutionEvent {
  return {
    id: `evt-control-${n}`,
    deploymentId: DEPLOYMENT_ID,
    eventType: "signal_options_profile_updated",
    symbol: null,
    summary: "profile updated",
    occurredAt: t(n),
    payload: { profile: { riskCaps: { maxDailyLoss: 100 } } },
  } as unknown as ExecutionEvent;
}

test("projection retained window matches full daily P&L and control update time", () => {
  const retainedWindowCorpus: ExecutionEvent[] = [
    entryEvent("NVDA", 40, {
      id: "p-retained-N1",
      candidateId: "c-retained-N1",
      entryPrice: 1.2,
      quantity: 2,
    }),
    markEvent("NVDA", 41, {
      peakPrice: 1.5,
      stopPrice: 1.1,
      lastMarkPrice: 1.4,
    }),
    controlUpdatedEvent(42),
    markEvent("NVDA", 43, {
      peakPrice: 1.7,
      stopPrice: 1.25,
      lastMarkPrice: 1.55,
    }),
    markEvent("NVDA", 44, {
      peakPrice: 1.9,
      stopPrice: 1.4,
      lastMarkPrice: 1.8,
    }),
    {
      ...exitEvent("NVDA", 45, "c-retained-N1"),
      payload: {
        pnl: 84,
        position: { candidateId: "c-retained-N1" },
        candidate: { id: "c-retained-N1" },
      },
    } as unknown as ExecutionEvent,
  ];
  const projection = internals.createSignalOptionsPositionProjection("sig");
  const positions = internals.deriveActivePositions(retainedWindowCorpus);
  const now = t(46);

  internals.foldTailIntoSignalOptionsProjection(
    projection,
    retainedWindowCorpus,
  );

  assert.equal(
    internals.projectionDailyPnl(projection, positions, now),
    internals.computeSignalOptionsDailyPnl(retainedWindowCorpus, positions, now),
  );
  assert.equal(
    internals.projectionControlUpdatedAt(projection)?.getTime(),
    internals
      .latestSignalOptionsControlUpdatedAt(retainedWindowCorpus)
      ?.getTime(),
  );
});

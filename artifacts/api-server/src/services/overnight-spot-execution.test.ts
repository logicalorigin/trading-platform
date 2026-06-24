import assert from "node:assert/strict";
import test from "node:test";

import {
  __overnightSpotExecutionInternalsForTests as internals,
  runOvernightSpotSignalScan,
  type OvernightSpotExecutionDependencies,
} from "./overnight-spot-execution";

const SHADOW_DEPLOYMENT = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Overnight Spot Test",
  mode: "shadow" as const,
  enabled: true,
  providerAccountId: "shadow",
  symbolUniverse: ["AAPL"],
  config: {
    overnightSpot: {
      enabled: true,
      executionMode: "shadow",
      // Bypass the actionable-signal filter so the injected state always reaches
      // the dedup gate; this test targets the idempotency lookup, not signal
      // freshness/session gating.
      requireActionableSignal: false,
    },
  },
};

const BUY_STATE = {
  profileId: "profile-1",
  symbol: "AAPL",
  timeframe: "1d",
  currentSignalDirection: "buy" as const,
  currentSignalAt: new Date("2026-06-12T16:00:00.000Z"),
  currentSignalPrice: 100,
  fresh: true,
  status: "ok",
  barsSinceSignal: 0,
};

// Build a fully-injected dependency set whose order placement is spied. Any test
// that places an order is a FAILURE of idempotency, so the spies start "not
// called" and we assert they stay that way on a skip.
function buildScanDeps(
  overrides: Partial<OvernightSpotExecutionDependencies> = {},
): {
  deps: OvernightSpotExecutionDependencies;
  calls: {
    placeLiveOrder: number;
    placeShadowOrder: number;
    insertExecutionEvent: number;
    insertDiagnosticEvent: number;
  };
} {
  const calls = {
    placeLiveOrder: 0,
    placeShadowOrder: 0,
    insertExecutionEvent: 0,
    insertDiagnosticEvent: 0,
  };
  const deps: OvernightSpotExecutionDependencies = {
    loadDeployment: async () => SHADOW_DEPLOYMENT,
    evaluateSignals: async () => {},
    loadSignalStates: async () => [BUY_STATE],
    loadQuotes: async () =>
      new Map([
        ["AAPL", { bid: 99, ask: 101, mid: 100, updatedAt: new Date() }],
      ]),
    loadPositionQuantities: async () => new Map(),
    findExistingEventByClientOrderId: async () => null,
    insertExecutionEvent: async (input) => {
      calls.insertExecutionEvent += 1;
      return { id: "ledger-event", ...input };
    },
    insertDiagnosticEvent: async (input) => {
      calls.insertDiagnosticEvent += 1;
      return { id: "diagnostic-event", ...input };
    },
    placeShadowOrder: async () => {
      calls.placeShadowOrder += 1;
      return { id: "shadow-order" };
    },
    placeLiveOrder: async () => {
      calls.placeLiveOrder += 1;
      return { id: "live-order" };
    },
    notifyChanged: () => {},
    ...overrides,
  };
  return { deps, calls };
}

test("overnight spot skips recording duplicate recent blocked plans", () => {
  const existing = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      plan: {
        blockers: [{ code: "overnight_spot_quote_required" }],
      },
    },
  };
  const plan = {
    status: "blocked",
    blockers: [{ code: "overnight_spot_quote_required" }],
  };

  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing,
      plan: plan as never,
    }),
    true,
  );
});

test("overnight spot suppresses an unchanged blocked plan regardless of age (no time window)", () => {
  const existing = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      plan: {
        blockers: [{ code: "overnight_spot_quote_required" }],
      },
    },
  };
  const plan = {
    status: "blocked",
    blockers: [{ code: "overnight_spot_quote_required" }],
  };

  // Even an hours-old prior block with identical codes is suppressed now that we
  // log on transition only (the 30-minute re-log window was removed).
  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing,
      plan: plan as never,
    }),
    true,
  );
});

test("overnight spot does not dedupe when blocker codes change", () => {
  const existing = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: {
      plan: {
        blockers: [{ code: "overnight_spot_quote_required" }],
      },
    },
  };
  const plan = {
    status: "blocked",
    blockers: [{ code: "overnight_spot_spread_too_wide" }],
  };

  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing,
      plan: plan as never,
    }),
    false,
  );
});

// --- Section 6.6: writer routing (no DB) -----------------------------------
// (Covered indirectly by the scan tests below, which assert insertDiagnosticEvent
// fires for blocked/tracked and the order paths fire insertExecutionEvent.)

// --- Section 6.1: order idempotency across the table boundary ---------------
// A terminal order row lives in the LEDGER (execution_events). The scan must
// skip placing an order and must NOT call placeLiveOrder/placeShadowOrder.
test("scan skips placing an order when a ledger terminal event exists (idempotency across boundary)", async () => {
  const clientOrderIds: string[] = [];
  const { deps, calls } = buildScanDeps({
    // Capture the deterministic clientOrderId the scan computes, then return a
    // terminal LEDGER row for it (as the union reader would).
    findExistingEventByClientOrderId: async ({ clientOrderId }) => {
      clientOrderIds.push(clientOrderId);
      return {
        id: "ledger-live-entry",
        eventType: "overnight_spot_live_entry",
        occurredAt: new Date("2026-06-12T16:30:00.000Z"),
        payload: { clientOrderId },
      };
    },
  });

  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      runActions: true,
      now: new Date("2026-06-12T17:00:00.000Z"),
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.status, "skipped");
  assert.equal(result.results[0]?.reason, "duplicate_client_order_id");
  assert.equal(result.results[0]?.eventType, "overnight_spot_live_entry");
  // The order MUST NOT be placed.
  assert.equal(calls.placeLiveOrder, 0);
  assert.equal(calls.placeShadowOrder, 0);
  assert.equal(calls.insertExecutionEvent, 0);
  assert.equal(calls.insertDiagnosticEvent, 0);
  assert.ok(clientOrderIds.length >= 1);
});

// --- Section 6.2: clientOrderId with BOTH a diagnostics blocked row AND a
// ledger terminal row -> merge returns the terminal (newest) -> skip. ---------
test("selectExistingEventByClientOrderId returns the newest (terminal) row across both tables", async () => {
  const clientOrderId = "deterministic-sha256";
  // Blocked row is OLDER and lives in diagnostics; terminal row is NEWER and
  // lives in the ledger. The newest (terminal) must win so a placed order
  // shadows the earlier block (no re-place).
  const blockedRow = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T16:00:00.000Z"),
    payload: { clientOrderId },
  };
  const terminalRow = {
    eventType: "overnight_spot_live_entry",
    occurredAt: new Date("2026-06-12T16:30:00.000Z"),
    payload: { clientOrderId },
  };

  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [terminalRow],
    diagnosticRows: [blockedRow],
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  assert.equal(selected?.eventType, "overnight_spot_live_entry");

  // And the idempotency predicate skips on it.
  assert.equal(
    internals.shouldSkipExistingClientOrderEvent({
      existing: selected as never,
      runActions: true,
    }),
    true,
  );
});

// --- Section 6.3: blocked-dedup across the boundary -------------------------
// The blocked marker now lives in DIAGNOSTICS. The merge must still surface it
// for shouldSkipDuplicateBlockedPlan when no terminal row exists.
test("selectExistingEventByClientOrderId surfaces a diagnostics blocked row for blocked-dedup", async () => {
  const clientOrderId = "blocked-only-id";
  const blockedRow = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T16:00:00.000Z"),
    payload: {
      clientOrderId,
      plan: { blockers: [{ code: "overnight_spot_quote_required" }] },
    },
  };

  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [],
    diagnosticRows: [blockedRow],
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  assert.equal(selected?.eventType, "overnight_spot_signal_blocked");

  // It is NOT a terminal-order event, so idempotency does not fire...
  assert.equal(
    internals.shouldSkipExistingClientOrderEvent({
      existing: selected as never,
      runActions: true,
    }),
    false,
  );
  // ...but blocked-dedup does (identical blocker codes).
  assert.equal(
    internals.shouldSkipDuplicateBlockedPlan({
      existing: selected as never,
      plan: {
        status: "blocked",
        blockers: [{ code: "overnight_spot_quote_required" }],
      } as never,
    }),
    true,
  );
});

// --- Section 6.4: pure merge helper ----------------------------------------
test("selectExistingEventByClientOrderId merges by occurred_at desc and matches payload", async () => {
  const clientOrderId = "merge-target";
  // Interleave timestamps across the two arrays; the newest matching row wins.
  const ledgerRows = [
    {
      eventType: "overnight_spot_order_failed",
      occurredAt: new Date("2026-06-12T15:00:00.000Z"),
      payload: { clientOrderId },
    },
    {
      eventType: "overnight_spot_live_entry",
      occurredAt: new Date("2026-06-12T17:00:00.000Z"),
      payload: { clientOrderId },
    },
  ];
  const diagnosticRows = [
    {
      eventType: "overnight_spot_signal_blocked",
      occurredAt: new Date("2026-06-12T16:00:00.000Z"),
      payload: { clientOrderId },
    },
    {
      eventType: "overnight_spot_signal_blocked",
      occurredAt: new Date("2026-06-12T18:00:00.000Z"),
      payload: { clientOrderId: "different-id" },
    },
  ];

  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows,
    diagnosticRows,
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  // Newest row (18:00) does not match the clientOrderId; newest MATCHING is the
  // 17:00 live entry.
  assert.equal(selected?.eventType, "overnight_spot_live_entry");
});

test("selectExistingEventByClientOrderId skips a shadow event without a shadow order", async () => {
  const clientOrderId = "shadow-no-order";
  const shadowRow = {
    eventType: "overnight_spot_shadow_entry",
    occurredAt: new Date("2026-06-12T17:00:00.000Z"),
    payload: { clientOrderId },
  };
  const fallbackBlocked = {
    eventType: "overnight_spot_signal_blocked",
    occurredAt: new Date("2026-06-12T16:00:00.000Z"),
    payload: { clientOrderId },
  };

  // hasShadowOrder=false -> the shadow row is skipped, falling through to the
  // next match (the older blocked row). Matches the original behavior.
  const selected = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [shadowRow],
    diagnosticRows: [fallbackBlocked],
    clientOrderId,
    hasShadowOrder: async () => false,
  });
  assert.equal(selected?.eventType, "overnight_spot_signal_blocked");

  // hasShadowOrder=true -> the shadow row IS the match.
  const selectedWithOrder = await internals.selectExistingEventByClientOrderId({
    ledgerRows: [shadowRow],
    diagnosticRows: [fallbackBlocked],
    clientOrderId,
    hasShadowOrder: async () => true,
  });
  assert.equal(selectedWithOrder?.eventType, "overnight_spot_shadow_entry");
});

// --- Section 6.6 (direct): writer routing via the scan ---------------------
// A ready plan in shadow mode places a shadow order and writes the shadow
// execution event to the LEDGER (insertExecutionEvent), NOT diagnostics.
test("scan routes shadow execution events to the ledger, not diagnostics", async () => {
  const { deps, calls } = buildScanDeps();
  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      runActions: true,
      now: new Date("2026-06-12T17:00:00.000Z"),
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  // Either executed (ready) or blocked depending on plan gating; in both cases
  // assert the routing invariant holds for whatever was written.
  if (result.results[0]?.status === "executed") {
    assert.equal(calls.placeShadowOrder, 1);
    assert.equal(calls.insertExecutionEvent, 1);
    assert.equal(calls.insertDiagnosticEvent, 0);
  } else if (result.results[0]?.status === "blocked") {
    // A blocked plan writes the blocked telemetry to DIAGNOSTICS.
    assert.equal(calls.placeShadowOrder, 0);
    assert.equal(calls.insertExecutionEvent, 0);
    assert.equal(calls.insertDiagnosticEvent, 1);
  } else {
    assert.fail(`unexpected status ${result.results[0]?.status}`);
  }
});

// A tracked plan (runActions=false, recordSignals=true) writes the tracked
// telemetry to DIAGNOSTICS, never the ledger, and never places an order.
test("scan routes tracked telemetry to diagnostics and places no order", async () => {
  const { deps, calls } = buildScanDeps();
  const result = await runOvernightSpotSignalScan(
    {
      deploymentId: SHADOW_DEPLOYMENT.id,
      runActions: false,
      recordSignals: true,
      now: new Date("2026-06-12T17:00:00.000Z"),
    },
    deps,
  );

  assert.equal(result.results.length, 1);
  // With runActions=false a ready plan is "tracked"; a blocked plan is "blocked".
  // Both moved types route to diagnostics; no order is placed either way.
  assert.equal(calls.placeLiveOrder, 0);
  assert.equal(calls.placeShadowOrder, 0);
  assert.equal(calls.insertExecutionEvent, 0);
  assert.equal(calls.insertDiagnosticEvent, 1);
  assert.ok(
    result.results[0]?.status === "tracked" ||
      result.results[0]?.status === "blocked",
  );
});

// --- Section 6.6: automation_diagnostics 7-day retention prune ---------------
const HOUR_MS = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * HOUR_MS;

test("computeAutomationDiagnosticsPrune throttles within the hour and cuts at 7 days", () => {
  const now = new Date("2026-06-24T12:00:00.000Z").getTime();

  // Pruned 10 min ago -> skip.
  assert.equal(
    internals.computeAutomationDiagnosticsPrune(now, now - 10 * 60 * 1000)
      .shouldPrune,
    false,
  );

  // Never pruned, or > 1h ago, or exactly at the 1h boundary -> prune, cutoff = now - 7d.
  for (const lastPruneMs of [0, now - 2 * HOUR_MS, now - HOUR_MS]) {
    const decision = internals.computeAutomationDiagnosticsPrune(
      now,
      lastPruneMs,
    );
    assert.equal(decision.shouldPrune, true);
    assert.equal(decision.cutoff.getTime(), now - SEVEN_DAYS_MS);
  }
});

test("pruneAutomationDiagnostics deletes when due, throttles repeats, advances the window", async () => {
  const cutoffs: Date[] = [];
  const del = async (cutoff: Date) => {
    cutoffs.push(cutoff);
  };
  // First call (module state starts at 0) is always due.
  const t0 = new Date("2026-07-01T00:00:00.000Z");
  await internals.pruneAutomationDiagnostics(t0, del);
  assert.equal(cutoffs.length, 1);
  assert.equal(cutoffs[0]?.getTime(), t0.getTime() - SEVEN_DAYS_MS);

  // 5 min later -> throttled, no delete.
  await internals.pruneAutomationDiagnostics(
    new Date(t0.getTime() + 5 * 60 * 1000),
    del,
  );
  assert.equal(cutoffs.length, 1);

  // 61 min later -> due again, cutoff tracks the new now.
  const t2 = new Date(t0.getTime() + 61 * 60 * 1000);
  await internals.pruneAutomationDiagnostics(t2, del);
  assert.equal(cutoffs.length, 2);
  assert.equal(cutoffs[1]?.getTime(), t2.getTime() - SEVEN_DAYS_MS);
});

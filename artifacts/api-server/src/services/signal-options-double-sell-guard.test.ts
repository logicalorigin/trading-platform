import assert from "node:assert/strict";
import test from "node:test";

import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";
import { __shadowWatchlistBacktestInternalsForTests as shadowInternals } from "./shadow-account";

// REAL-MONEY SCENARIO: double-sell after a process restart.
//
// tryClaimSignalOptionsPositionExit (signal-options-automation.ts) is the
// in-process race guard between the worker scan and the position tick
// manager, which both evaluate the same open positions with no shared lock
// (see the comment above signalOptionsClaimedExits in the source). The claim
// map is a plain in-memory Map keyed by "deploymentId:positionId" with a
// 10-minute TTL — it is NOT persisted, so a process restart wipes it exactly
// like calling __resetSignalOptionsClaimedExitsForTests().
//
// automation.test.ts (`a position's exit can only be claimed once`) already
// pins the claim/duplicate-claim/TTL-expiry behavior in the steady-state
// case. This file is scoped to the restart-adjacent gap that test leaves
// implicit in its trailing comment ("a real re-exit is still prevented by
// the persisted exit event") and pins the TWO things that actually matter
// for real money:
//   1. The claim map gives ZERO protection immediately after a restart
//      (no TTL wait is required — the map is just empty).
//   2. The layer that DOES survive restart — a persisted
//      SIGNAL_OPTIONS_SHADOW_EXIT_EVENT — still rejects the duplicate via
//      signalOptionsShadowExitEventIsDuplicate (shadow-account.ts), which is
//      a pure function over event rows and does not itself require a DB.

const {
  tryClaimSignalOptionsPositionExit,
  __resetSignalOptionsClaimedExitsForTests,
} = __signalOptionsAutomationInternalsForTests;
const { signalOptionsShadowExitEventIsDuplicate } = shadowInternals;

const SIGNAL_OPTIONS_EXIT_CLAIM_TTL_MS = 10 * 60 * 1000;

test("restart wipes the in-process exit claim: a reclaim succeeds immediately, with no TTL wait", () => {
  __resetSignalOptionsClaimedExitsForTests();
  const now = 1_700_000_000_000;
  const key = "deployment-1:position-1";

  // Pre-restart: the tick manager claims the exit for this position.
  assert.equal(tryClaimSignalOptionsPositionExit(key, now), true);
  // A concurrent caller for the same position is correctly blocked while the
  // claim is live (steady-state protection, already pinned elsewhere).
  assert.equal(tryClaimSignalOptionsPositionExit(key, now + 1_000), false);

  // The process restarts. The claim map is an in-memory Map with no
  // persistence, so a restart clears it exactly like this reset call — there
  // is no code path that reloads claims from anywhere.
  __resetSignalOptionsClaimedExitsForTests();

  // Immediately after restart (same instant, no TTL elapsed) a second caller
  // re-evaluating the SAME position is allowed to claim again. This is the
  // vulnerability: unlike a natural TTL expiry (10 minutes), restart offers
  // an instantaneous reopening with no cooldown at all.
  assert.equal(tryClaimSignalOptionsPositionExit(key, now + 1_000), true);
});

test("claim TTL boundary: still blocked at exactly 10 minutes elapsed, reclaimable just after", () => {
  __resetSignalOptionsClaimedExitsForTests();
  const now = 1_700_000_000_000;
  const key = "deployment-1:position-2";

  assert.equal(tryClaimSignalOptionsPositionExit(key, now), true);
  // Prune condition in source is strictly `nowMs - claimedAt > TTL`, so at
  // exactly TTL elapsed the claim is NOT yet pruned.
  assert.equal(
    tryClaimSignalOptionsPositionExit(key, now + SIGNAL_OPTIONS_EXIT_CLAIM_TTL_MS),
    false,
  );
  // One millisecond later it is prunable and the same key can be reclaimed.
  assert.equal(
    tryClaimSignalOptionsPositionExit(
      key,
      now + SIGNAL_OPTIONS_EXIT_CLAIM_TTL_MS + 1,
    ),
    true,
  );
});

test("post-restart double-sell is still rejected by the persisted exit-event dedup, even though the claim map alone would allow it", () => {
  __resetSignalOptionsClaimedExitsForTests();
  const deploymentId = "deployment-1";
  const symbol = "CRM";
  const openedAt = new Date("2026-06-12T14:30:00.000Z");
  const key = `${deploymentId}:position-1`;

  // T1 (pre-restart): the position's stop is hit. The tick manager claims
  // the exit and (in the real system) persists a SIGNAL_OPTIONS_SHADOW_EXIT_EVENT
  // to the execution-events ledger before the process dies mid-flight.
  const t1 = openedAt.getTime() + 5 * 60 * 1000;
  assert.equal(tryClaimSignalOptionsPositionExit(key, t1), true);
  const persistedExitEvent = {
    deploymentId,
    symbol,
    occurredAt: new Date(t1),
  };

  // Restart: the in-process claim map is gone.
  __resetSignalOptionsClaimedExitsForTests();

  // T2 (post-restart): a late/replayed evaluation of the SAME position (e.g.
  // the worker scan that was mid-flight when the process died) re-checks the
  // claim map first. With the map empty, the claim map alone says "go ahead".
  const t2 = t1 + 30_000;
  assert.equal(
    tryClaimSignalOptionsPositionExit(key, t2),
    true,
    "the claim map on its own no longer blocks this — restart erased it",
  );

  // But the real code path (force-close / mark-time exit / expiration
  // ledger-sync — see signalOptionsShadowExitEventIsDuplicate's callers in
  // shadow-account.ts) does not stop at the claim map: it loads recent
  // execution events for the deployment/symbol from the DB and runs this
  // pure duplicate check before ever calling placeShadowOrder again. That
  // persisted event survives the restart and correctly flags T2 as a
  // duplicate of the already-recorded T1 exit, so the second sell must not
  // be placed.
  const candidate = { deploymentId, symbol, since: openedAt };
  assert.equal(
    signalOptionsShadowExitEventIsDuplicate(candidate, [persistedExitEvent]),
    true,
  );
});

// UNTESTABLE WITHOUT A DB HARNESS (documented, not forced):
//
// The dedup check above only proves the pure comparison is correct given
// events "as loaded from the DB". The actual order-placement-time guards
// that make double-selling real money impossible are both gated behind
// `db` queries and are not reachable through any exported pure seam:
//
//   - placeShadowOrder's sourceEventId/clientOrderId dedup
//     (shadow-account.ts, ~line 4437): looks up shadowOrdersTable by
//     sourceEventId/clientOrderId before inserting a new order/fill.
//   - buildShadowFillPlan's "Shadow account cannot sell more than the open
//     position" 409 (shadow-account.ts, ~line 4376, code
//     shadow_long_only_position_required): reads the live shadowPositionsTable
//     row's open quantity before allowing a sell.
//
// Both require a live shadowPositionsTable/shadowOrdersTable/db.transaction
// round trip and are not exposed as pure functions via
// __shadowWatchlistBacktestInternalsForTests. Per the no-DB-harness
// constraint on this task, they are out of scope here; a full pin of the
// restart double-sell window needs an integration test against a real (or
// PGlite) database exercising placeShadowOrder twice with the same
// sourceEventId after a simulated restart.

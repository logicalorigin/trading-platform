import assert from "node:assert/strict";
import test from "node:test";

import { __overnightSpotExecutionInternalsForTests as internals } from "./overnight-spot-execution";

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
      now: new Date("2026-06-12T17:10:00.000Z"),
    }),
    true,
  );
});

test("overnight spot re-records blocked plans after the dedupe window", () => {
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
      now: new Date("2026-06-12T17:31:00.000Z"),
    }),
    false,
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
      now: new Date("2026-06-12T17:10:00.000Z"),
    }),
    false,
  );
});

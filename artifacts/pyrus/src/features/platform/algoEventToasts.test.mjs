import assert from "node:assert/strict";
import test from "node:test";

import { buildAlgoEventToast } from "./algoEventToasts.js";

test("suppresses skipped candidate toasts for mtf_not_aligned reasons", () => {
  const toast = buildAlgoEventToast({
    id: "evt-aibu-1",
    symbol: "AIBU",
    eventType: "signal_options_candidate_skipped",
    summary: "AIBU shadow candidate skipped: mtf_not_aligned",
    payload: {
      reason: "mtf_not_aligned",
      entryGate: {
        reason: "mtf_not_aligned",
        reasons: ["mtf_not_aligned"],
      },
    },
  });

  assert.equal(toast, null);
});

test("suppresses blocked toasts when only the summary says MTF not aligned", () => {
  const toast = buildAlgoEventToast({
    id: "evt-btcw-1",
    symbol: "BTCW",
    eventType: "signal_options_gateway_blocked",
    summary: "MTF not aligned: needs 3 of 3 selected frames",
    payload: {
      reason: "entry_gate_failed",
    },
  });

  assert.equal(toast, null);
});

test("keeps non-MTF skipped candidate toasts visible", () => {
  const toast = buildAlgoEventToast({
    id: "evt-spread-1",
    symbol: "AIBU",
    eventType: "signal_options_candidate_skipped",
    summary: "AIBU shadow candidate skipped: spread_too_wide",
    payload: {
      reason: "spread_too_wide",
    },
  });

  assert.deepEqual(toast, {
    kind: "info",
    title: "AIBU · Candidate Skipped",
    body: "AIBU shadow candidate skipped: spread_too_wide",
    duration: 4000,
  });
});

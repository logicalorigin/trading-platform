import assert from "node:assert/strict";
import test from "node:test";

import {
  providerSummaryHasTransientFlowState,
  providerSummaryHasVisibleFlowDegradation,
} from "./flowSourceState.js";

const providerSummaryWithSource = (source) => ({
  erroredSource: null,
  errorMessage: null,
  failures: [],
  coverage: { degradedReason: null },
  sourcesBySymbol: { SPY: source },
});

test("pending scanner queue states preserve flow without displaying degraded", () => {
  const summary = providerSummaryWithSource({
    provider: "ibkr",
    status: "empty",
    ibkrStatus: "degraded",
    ibkrReason: "options_flow_scanner_queued",
  });

  assert.equal(providerSummaryHasTransientFlowState(summary), true);
  assert.equal(providerSummaryHasVisibleFlowDegradation(summary), false);
});

test("quote timeouts remain visible degraded states", () => {
  const summary = providerSummaryWithSource({
    provider: "ibkr",
    status: "empty",
    ibkrStatus: "degraded",
    ibkrReason: "IBKR bridge request to /options/quotes timed out after 12000ms.",
  });

  assert.equal(providerSummaryHasTransientFlowState(summary), true);
  assert.equal(providerSummaryHasVisibleFlowDegradation(summary), true);
});

test("stale quote timeouts do not keep the scanner visibly degraded", () => {
  const summary = providerSummaryWithSource({
    provider: "none",
    status: "error",
    errorMessage: "IBKR bridge request to /options/quotes timed out after 12000ms.",
    fetchedAt: "2026-05-06T14:45:00.000Z",
  });

  assert.equal(providerSummaryHasTransientFlowState(summary), true);
  assert.equal(
    providerSummaryHasVisibleFlowDegradation(summary, {
      nowMs: Date.parse("2026-05-06T14:49:00.000Z"),
    }),
    false,
  );
});

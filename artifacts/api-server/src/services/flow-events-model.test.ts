import assert from "node:assert/strict";
import test from "node:test";

import { deferredFlowEventsResult } from "./flow-events-model";

test("deferred flow scanner results report Massive as the data provider", () => {
  const result = deferredFlowEventsResult({
    underlying: "SPY",
    limit: 1,
    filters: { scope: "all", minPremium: 0, maxDte: null },
    reason: "options_flow_scanner_snapshot_pending",
  });

  assert.equal(result.source.provider, "massive");
  assert.deepEqual(result.source.attemptedProviders, ["massive"]);
  assert.equal(result.source.ibkrReason, "options_flow_scanner_snapshot_pending");
});

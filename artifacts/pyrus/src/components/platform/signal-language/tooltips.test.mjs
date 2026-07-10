import assert from "node:assert/strict";
import test from "node:test";

import {
  freshnessTooltip,
  spreadTooltip,
  verdictTooltip,
} from "./tooltips.js";

test("signal tooltips do not coerce missing numeric values to zero", () => {
  assert.equal(freshnessTooltip({ barsSince: null }), "Freshness unavailable.");
  assert.equal(freshnessTooltip({ barsSince: "" }), "Freshness unavailable.");
  assert.equal(spreadTooltip({ spreadPct: null }), "Spread unavailable.");
  assert.equal(spreadTooltip({ spreadPct: "" }), "Spread unavailable.");
  assert.doesNotMatch(verdictTooltip({ verdict: "Wait", score: null }), /Score 0\.0/);
  assert.doesNotMatch(verdictTooltip({ verdict: "Wait", score: "" }), /Score 0\.0/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveOlderHistoryPrefetchDecision,
  resolveOlderHistoryRequestSettleState,
} from "./researchSpotChartHistoryUtils.js";

test("left-edge drag can still request older history while viewing the full loaded window", () => {
  const decision = resolveOlderHistoryPrefetchDecision({
    visibleRange: { from: 0, to: 999 },
    barCount: 1000,
    oldestBarTime: 1710000000000,
    currentIntentSource: "chart-drag",
    currentIntentAgeMs: 50,
    userRangeIntentMaxAgeMs: 2500,
    edgeTriggerBars: 24,
    blocked: false,
    lastRequestKey: "",
  });

  assert.equal(decision.action, "request");
  assert.equal(decision.requestKey, "1710000000000:1000");
});

test("moving away from the left edge releases the older-history request block", () => {
  const decision = resolveOlderHistoryPrefetchDecision({
    visibleRange: { from: 80, to: 180 },
    barCount: 1000,
    oldestBarTime: 1710000000000,
    currentIntentSource: "chart-drag",
    currentIntentAgeMs: 50,
    userRangeIntentMaxAgeMs: 2500,
    edgeTriggerBars: 24,
    blocked: true,
    lastRequestKey: "1710000000000:1000",
  });

  assert.equal(decision.action, "release");
  assert.equal(decision.requestKey, "");
});

test("older-history prefetch ignores wheel zoom intent at the left edge", () => {
  const decision = resolveOlderHistoryPrefetchDecision({
    visibleRange: { from: 0, to: 300 },
    barCount: 1000,
    oldestBarTime: 1710000000000,
    currentIntentSource: "chart-wheel",
    currentIntentAgeMs: 50,
    userRangeIntentMaxAgeMs: 2500,
    edgeTriggerBars: 24,
    blocked: false,
    lastRequestKey: "",
  });

  assert.equal(decision.action, "none");
});

test("older-history prefetch ignores stale drag intent", () => {
  const decision = resolveOlderHistoryPrefetchDecision({
    visibleRange: { from: 0, to: 300 },
    barCount: 1000,
    oldestBarTime: 1710000000000,
    currentIntentSource: "chart-drag",
    currentIntentAgeMs: 3000,
    userRangeIntentMaxAgeMs: 2500,
    edgeTriggerBars: 24,
    blocked: false,
    lastRequestKey: "",
  });

  assert.equal(decision.action, "none");
});

test("older-history prefetch ignores duplicate request keys for the same edge window", () => {
  const decision = resolveOlderHistoryPrefetchDecision({
    visibleRange: { from: 0, to: 300 },
    barCount: 1000,
    oldestBarTime: 1710000000000,
    currentIntentSource: "chart-drag",
    currentIntentAgeMs: 50,
    userRangeIntentMaxAgeMs: 2500,
    edgeTriggerBars: 24,
    blocked: false,
    lastRequestKey: "1710000000000:1000",
  });

  assert.equal(decision.action, "none");
});

test("successful older-history requests release the edge block without clearing the request key", () => {
  const nextState = resolveOlderHistoryRequestSettleState({
    requestKey: "1710000000000:1000",
    currentRequestKey: "1710000000000:1000",
    didFail: false,
  });

  assert.equal(nextState.blocked, false);
  assert.equal(nextState.requestKey, "1710000000000:1000");
});

test("failed older-history requests release the edge block and clear the matching request key", () => {
  const nextState = resolveOlderHistoryRequestSettleState({
    requestKey: "1710000000000:1000",
    currentRequestKey: "1710000000000:1000",
    didFail: true,
  });

  assert.equal(nextState.blocked, false);
  assert.equal(nextState.requestKey, "");
});

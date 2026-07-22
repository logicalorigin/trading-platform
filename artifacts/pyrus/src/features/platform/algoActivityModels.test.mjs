import assert from "node:assert/strict";
import test from "node:test";

import { summarizeCockpitDelta } from "./algoActivitySummary.js";
import {
  collectEventTransitions,
  mergeTransitions,
} from "./algoTransitionsModel.js";

const BASE_MS = Date.parse("2026-07-21T15:00:00.000Z");
const at = (offsetMs) => new Date(BASE_MS + offsetMs).toISOString();

const event = (id, eventType, offsetMs, symbol = "SPY") => ({
  id,
  eventType,
  occurredAt: at(offsetMs),
  symbol,
});

test("cockpit summary counts current signal-options lifecycle events", () => {
  const summary = summarizeCockpitDelta({
    prevSnapshot: { evaluatedAt: at(0), signals: [] },
    nextSnapshot: { evaluatedAt: at(5_000), signals: [] },
    recentEvents: [
      event("old-entry", "signal_options_shadow_entry", -1),
      event("entry", "signal_options_shadow_entry", 1_000),
      event("exit", "signal_options_shadow_exit", 2_000),
      event("skip", "signal_options_candidate_skipped", 3_000, "QQQ"),
      event("blocked", "signal_options_gateway_blocked", 4_000, "IWM"),
      event("mark", "signal_options_shadow_mark", 5_000),
      event("lookalike-entry", "signal_options_deployment_entry", 5_500),
      event("lookalike-block", "signal_options_policy_blocked", 5_600),
    ],
    nowMs: BASE_MS + 5_000,
  });

  const counts = Object.fromEntries(
    summary.segments
      .filter((segment) => Number.isFinite(segment.count))
      .map((segment) => [segment.kind, segment.count]),
  );
  assert.deepEqual(counts, { blocked: 2, fills: 1, exits: 1 });
});

test("transition strip accepts current lifecycle events and rejects unrelated suffixes", () => {
  const transitions = collectEventTransitions(
    [
      event("old-entry", "signal_options_shadow_entry", -1),
      event("entry", "signal_options_shadow_entry", 1_000),
      event("exit", "signal_options_shadow_exit", 2_000),
      event("skip", "signal_options_candidate_skipped", 3_000),
      event("blocked", "signal_options_gateway_blocked", 4_000),
      event("mark", "signal_options_shadow_mark", 5_000),
      event("foreign", "deployment_entry", 6_000),
      event("lookalike-entry", "signal_options_deployment_entry", 7_000),
      event("lookalike-block", "signal_options_policy_blocked", 8_000),
    ],
    { sinceMs: BASE_MS },
  );

  assert.deepEqual(
    transitions.map((transition) => transition.eventType),
    [
      "signal_options_shadow_entry",
      "signal_options_shadow_exit",
      "signal_options_candidate_skipped",
      "signal_options_gateway_blocked",
    ],
  );
});

test("transition merge keeps the newest copy of a repeated event", () => {
  const older = { id: "event:entry", timeMs: BASE_MS + 1_000 };
  const newer = { id: "event:entry", timeMs: BASE_MS + 2_000 };

  assert.deepEqual(mergeTransitions([older, newer]), [newer]);
});

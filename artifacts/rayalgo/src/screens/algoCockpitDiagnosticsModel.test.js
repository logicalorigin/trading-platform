import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCockpitGateSummary,
} from "./algoCockpitDiagnosticsModel.js";

test("cockpit gate summary falls back when diagnostics are absent", () => {
  const summary = buildCockpitGateSummary({
    kpis: {
      blockedCandidates: 75,
      shadowFilledCandidates: 0,
    },
    signals: [
      { symbol: "ASML", fresh: true },
      { symbol: "SMCI", fresh: true },
      { symbol: "HOOD", fresh: false },
    ],
    candidates: [
      { actionStatus: "blocked" },
      { actionStatus: "shadow_filled" },
    ],
    events: [
      {
        eventType: "signal_options_shadow_entry",
        payload: {},
      },
      {
        eventType: "signal_options_shadow_entry",
        payload: {},
      },
      {
        payload: {
          reason: "bear_regime_gate_failed",
          entryGate: {
            reasons: ["adx_below_minimum"],
          },
        },
      },
      {
        payload: {
          reason: "no_contract_for_strike_slot",
          chainDebug: {
            reason: "options_upstream_failure",
          },
        },
      },
      {
        payload: {
          reason: "no_contract_for_strike_slot",
          expirationsDebug: {
            reason: "options_backoff",
          },
        },
      },
    ],
  });

  assert.equal(summary.signalFreshness.fresh, 2);
  assert.equal(summary.signalFreshness.notFresh, 1);
  assert.equal(summary.tradePath.blockedCandidates, 75);
  assert.equal(summary.tradePath.shadowFilledCandidates, 2);
  assert.deepEqual(summary.skipReasonRows[0], [
    "no_contract_for_strike_slot",
    2,
  ]);
  assert.deepEqual(summary.entryGateRows[0], ["adx_below_minimum", 1]);
  assert.deepEqual(summary.optionChainRows[0], ["options_backoff", 1]);
});

test("cockpit gate summary prefers diagnostics when present", () => {
  const summary = buildCockpitGateSummary({
    diagnostics: {
      signalFreshness: {
        fresh: 9,
        notFresh: 8,
      },
      tradePath: {
        blockedCandidates: 7,
        shadowFilledCandidates: 6,
      },
      skipReasons: {
        diagnostic_reason: 5,
      },
      entryGateReasons: {
        diagnostic_gate: 4,
      },
      optionChainReasons: {
        diagnostic_chain: 3,
      },
    },
    kpis: {
      blockedCandidates: 75,
      shadowFilledCandidates: 1,
    },
    signals: [{ fresh: true }],
    events: [
      {
        payload: {
          reason: "fallback_reason",
          entryGate: {
            reasons: ["fallback_gate"],
          },
          chainDebug: {
            reason: "fallback_chain",
          },
        },
      },
    ],
  });

  assert.equal(summary.signalFreshness.fresh, 9);
  assert.equal(summary.signalFreshness.notFresh, 8);
  assert.equal(summary.tradePath.blockedCandidates, 7);
  assert.equal(summary.tradePath.shadowFilledCandidates, 6);
  assert.deepEqual(summary.skipReasonRows[0], ["diagnostic_reason", 5]);
  assert.deepEqual(summary.entryGateRows[0], ["diagnostic_gate", 4]);
  assert.deepEqual(summary.optionChainRows[0], ["diagnostic_chain", 3]);
});

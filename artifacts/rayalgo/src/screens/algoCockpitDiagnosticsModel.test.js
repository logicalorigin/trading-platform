import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttentionStream,
  buildCockpitGateSummary,
  isDiagRowsHealthy,
  isGateSummaryHealthy,
} from "./algoCockpitDiagnosticsModel.js";

test("buildAttentionStream returns empty when there's nothing to flag", () => {
  const stream = buildAttentionStream({
    attentionItems: [],
    ruleAdherence: [],
    gatewayReady: true,
    gatewayBlocks: 0,
  });
  assert.deepEqual(stream, []);
});

test("buildAttentionStream surfaces cockpit attention items first", () => {
  const stream = buildAttentionStream({
    attentionItems: [
      { id: "a1", severity: "critical", symbol: "AAPL", summary: "spread" },
    ],
  });
  assert.equal(stream.length, 1);
  assert.equal(stream[0].kind, "attention");
  assert.equal(stream[0].severity, "critical");
  assert.equal(stream[0].title, "AAPL");
});

test("buildAttentionStream maps rule failures and warnings, skips passing rules", () => {
  const stream = buildAttentionStream({
    ruleAdherence: [
      { id: "r1", status: "fail", label: "Daily cap", detail: "over budget" },
      { id: "r2", status: "warning", label: "Win rate", detail: "below target" },
      { id: "r3", status: "pass", label: "Trail" },
    ],
  });
  assert.equal(stream.length, 2);
  assert.equal(stream[0].kind, "rule");
  assert.equal(stream[0].severity, "critical");
  assert.equal(stream[1].severity, "warning");
});

test("buildAttentionStream adds a gateway warning when the bridge isn't ready", () => {
  const stream = buildAttentionStream({ gatewayReady: false });
  assert.equal(stream.length, 1);
  assert.equal(stream[0].kind, "gateway");
});

test("buildAttentionStream adds a gateway warning when gateway blocks > 0", () => {
  const stream = buildAttentionStream({
    gatewayReady: true,
    gatewayBlocks: 4,
  });
  assert.equal(stream.length, 1);
  assert.equal(stream[0].kind, "gateway");
  assert.match(stream[0].title, /4 gateway blocks/);
});

test("isDiagRowsHealthy treats empty rows as healthy", () => {
  assert.equal(isDiagRowsHealthy([]), true);
  assert.equal(isDiagRowsHealthy(null), true);
  assert.equal(isDiagRowsHealthy(undefined), true);
});

test("isDiagRowsHealthy treats zero-count rows as healthy", () => {
  assert.equal(
    isDiagRowsHealthy([
      ["a", 0],
      ["b", 0],
    ]),
    true,
  );
});

test("isDiagRowsHealthy treats any positive count as unhealthy", () => {
  assert.equal(
    isDiagRowsHealthy([
      ["a", 0],
      ["b", 3],
    ]),
    false,
  );
});

test("isGateSummaryHealthy requires zero blocked candidates and gateway blocks", () => {
  assert.equal(
    isGateSummaryHealthy({ blockedCandidates: 0, gatewayBlocks: 0 }),
    true,
  );
  assert.equal(
    isGateSummaryHealthy({ blockedCandidates: 2, gatewayBlocks: 0 }),
    false,
  );
  assert.equal(
    isGateSummaryHealthy({ blockedCandidates: 0, gatewayBlocks: 1 }),
    false,
  );
  assert.equal(isGateSummaryHealthy(null), true);
  assert.equal(isGateSummaryHealthy(undefined), true);
});

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
        eventType: "signal_options_shadow_mark",
        payload: {},
      },
      {
        eventType: "signal_options_gateway_blocked",
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
  assert.equal(summary.tradePath.markEvents, 1);
  assert.equal(summary.tradePath.gatewayBlocks, 1);
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
        markEvents: 5,
        gatewayBlocks: 4,
        activePositions: 3,
      },
      lifecycle: {
        candidates: 11,
        contractsSelected: 10,
        shadowEntries: 9,
      },
      markHealth: {
        activePositions: 3,
        stale: 2,
        markFailures: 1,
      },
      readinessIncidents: [
        {
          source: "worker",
          reason: "ibkr_not_configured",
          count: 12,
        },
      ],
      skipCategories: {
        gateway: 12,
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
  assert.equal(summary.tradePath.markEvents, 5);
  assert.equal(summary.tradePath.gatewayBlocks, 4);
  assert.equal(summary.tradePath.activePositions, 3);
  assert.deepEqual(summary.skipCategoryRows[0], ["gateway", 12]);
  assert.deepEqual(summary.readinessRows[0], [
    "worker / ibkr_not_configured",
    12,
  ]);
  assert.deepEqual(summary.lifecycleRows[0], ["candidates", 11]);
  assert.deepEqual(summary.markHealthRows[0], ["activePositions", 3]);
  assert.deepEqual(summary.skipReasonRows[0], ["diagnostic_reason", 5]);
  assert.deepEqual(summary.entryGateRows[0], ["diagnostic_gate", 4]);
  assert.deepEqual(summary.optionChainRows[0], ["diagnostic_chain", 3]);
});

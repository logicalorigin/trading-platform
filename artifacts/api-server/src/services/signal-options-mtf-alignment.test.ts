import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";

import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";

const {
  evaluateSignalOptionsEntryGate,
  signalOptionsEffectiveMtfTimeframes,
} = __signalOptionsAutomationInternalsForTests;

// Require all three configured frames to agree before a buy entry.
const profile = resolveSignalOptionsExecutionProfile({
  entryGate: {
    mtfAlignment: {
      enabled: true,
      requiredCount: 3,
      timeframes: ["15m", "1h", "1d"],
    },
  },
});

// The engine's internal filterState says "all bullish" (mtfDirections [1,1,1]) —
// this is the source the gate used to trust, and it carries no timeframe labels.
const candidate = {
  id: "c1",
  symbol: "SPY",
  direction: "buy",
  optionRight: "call",
  signal: { filterState: { mtfDirections: [1, 1, 1], adx: 30 } },
} as unknown as Parameters<typeof evaluateSignalOptionsEntryGate>[0]["candidate"];

test("matrix MTF: blocks a buy when a configured frame (1d) actually disagrees", () => {
  const gate = evaluateSignalOptionsEntryGate({
    candidate,
    profile,
    mtfTimeframeDirections: { "15m": "buy", "1h": "buy", "1d": "sell" },
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "mtf_not_aligned");
});

test("matrix MTF: passes a buy when all configured frames agree", () => {
  const gate = evaluateSignalOptionsEntryGate({
    candidate,
    profile,
    mtfTimeframeDirections: { "15m": "buy", "1h": "buy", "1d": "buy" },
  });
  assert.equal(gate.ok, true);
});

test("matrix MTF: a frame with no signal yet counts as not-aligned (cannot satisfy)", () => {
  const gate = evaluateSignalOptionsEntryGate({
    candidate,
    profile,
    mtfTimeframeDirections: { "15m": "buy", "1h": "buy", "1d": null },
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "mtf_not_aligned");
});

test("legacy fallback (no matrix) wrongly passes — proves why the matrix source is needed", () => {
  // Same candidate+profile, but no matrix directions injected: the gate falls
  // back to the unlabeled engine filterState [1,1,1] and counts 3-of-3, passing
  // even though the real 1d frame disagrees above. This is the bug the matrix
  // path fixes.
  const gate = evaluateSignalOptionsEntryGate({ candidate, profile });
  assert.equal(gate.ok, true);
});

test("effective MTF frames use only the configured MTF selection", () => {
  const twoFrameProfile = resolveSignalOptionsExecutionProfile({
    entryGate: {
      mtfAlignment: {
        enabled: true,
        requiredCount: 2,
        timeframes: ["2m", "5m"],
      },
    },
  });
  const mtfTimeframes = signalOptionsEffectiveMtfTimeframes({
    profile: twoFrameProfile,
    deployment: {
      config: { parameters: { signalTimeframe: "15m" } },
    } as Parameters<typeof signalOptionsEffectiveMtfTimeframes>[0]["deployment"],
  });

  assert.deepEqual(mtfTimeframes, ["2m", "5m"]);
});

test("matrix MTF: every configured frame must align", () => {
  const threeFrameProfile = resolveSignalOptionsExecutionProfile({
    entryGate: {
      mtfAlignment: {
        enabled: true,
        requiredCount: 3,
        timeframes: ["2m", "5m", "15m"],
      },
    },
  });
  const mtfTimeframes = signalOptionsEffectiveMtfTimeframes({
    profile: threeFrameProfile,
    deployment: {
      config: { parameters: { signalTimeframe: "15m" } },
    } as Parameters<typeof signalOptionsEffectiveMtfTimeframes>[0]["deployment"],
  });

  // requiredCount is a configurable N-of-M confluence threshold (resolver clamps it to
  // the frame count but does NOT force it there). With full alignment demanded
  // (requiredCount = 3), a frame with no signal yet (2m: null) cannot satisfy the
  // gate: 2-of-3 aligned still blocks.
  const gate = evaluateSignalOptionsEntryGate({
    candidate,
    profile: threeFrameProfile,
    mtfTimeframes,
    mtfTimeframeDirections: { "2m": null, "5m": "buy", "15m": "buy" },
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "mtf_not_aligned");
});

test("matrix MTF: passes only when every configured frame aligns", () => {
  const threeFrameProfile = resolveSignalOptionsExecutionProfile({
    entryGate: {
      mtfAlignment: {
        enabled: true,
        requiredCount: 2,
        timeframes: ["2m", "5m", "15m"],
      },
    },
  });
  const mtfTimeframes = signalOptionsEffectiveMtfTimeframes({
    profile: threeFrameProfile,
    deployment: {
      config: { parameters: { signalTimeframe: "15m" } },
    } as Parameters<typeof signalOptionsEffectiveMtfTimeframes>[0]["deployment"],
  });

  const gate = evaluateSignalOptionsEntryGate({
    candidate,
    profile: threeFrameProfile,
    mtfTimeframes,
    mtfTimeframeDirections: { "2m": "buy", "5m": "buy", "15m": "buy" },
  });

  assert.equal(gate.ok, true);
});

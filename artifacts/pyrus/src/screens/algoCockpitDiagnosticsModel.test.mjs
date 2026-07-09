import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttentionStream,
  buildCockpitGateSummary,
} from "./algoCockpitDiagnosticsModel.js";

const unreadableArray = (label) => {
  const values = [];
  Object.defineProperty(values, 0, {
    get() {
      throw new Error(`${label} fallback was read`);
    },
  });
  values.length = 1;
  return values;
};

test("complete cockpit diagnostics skip raw fallback scans", () => {
  const summary = buildCockpitGateSummary({
    diagnostics: {
      signalFreshness: { fresh: 2, notFresh: 1 },
      tradePath: { blockedCandidates: 0, shadowFilledCandidates: 1 },
      skipReasons: { configured: 2 },
      entryGateReasons: { configured: 1 },
      optionChainReasons: { configured: 1 },
    },
    signals: unreadableArray("signal"),
    events: unreadableArray("event"),
  });

  assert.deepEqual(summary.signalFreshness, {
    fresh: 2,
    notFresh: 1,
    withoutDirection: 0,
  });
  assert.deepEqual(summary.skipReasonRows, [["configured", 2]]);
});

test("attention stream does not tell users to start the retired broker bridge", () => {
  const stream = buildAttentionStream({ marketDataReady: false });
  const gatewayItem = stream.find((item) => item.id === "gateway-not-ready");

  assert.equal(gatewayItem?.kindLabel, "MARKET DATA");
  assert.equal(gatewayItem?.title, "Market data pending");
  assert.equal(
    gatewayItem?.summary,
    "Signal evaluation is waiting on the Massive market-data stream.",
  );
  assert.doesNotMatch(
    JSON.stringify(stream),
    /broker bridge|Data bridge not ready|IB Gateway/i,
  );
});

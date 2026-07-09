import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionStream } from "./algoCockpitDiagnosticsModel.js";

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

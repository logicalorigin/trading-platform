import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionStream } from "./algoCockpitDiagnosticsModel.js";

test("attention stream does not tell users to start the retired broker bridge", () => {
  const stream = buildAttentionStream({ gatewayReady: false });
  const gatewayItem = stream.find((item) => item.id === "gateway-not-ready");

  assert.equal(gatewayItem?.title, "Signal evaluation paused");
  assert.equal(
    gatewayItem?.summary,
    "Signal evaluation is paused until the reported readiness blocker clears.",
  );
  assert.doesNotMatch(JSON.stringify(stream), /broker bridge|Data bridge not ready/i);
});

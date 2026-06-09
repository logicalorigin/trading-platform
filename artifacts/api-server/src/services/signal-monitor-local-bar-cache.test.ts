import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorLocalBarCacheInternalsForTests } from "./signal-monitor-local-bar-cache";

test("signal monitor local bar cache warms from durable massive history", () => {
  const sources =
    __signalMonitorLocalBarCacheInternalsForTests.storeSourceNames();

  assert.equal(sources.at(-1), "massive-history");
  assert(
    sources[0] === "massive-websocket" ||
      sources[0] === "massive-delayed-websocket",
  );
});

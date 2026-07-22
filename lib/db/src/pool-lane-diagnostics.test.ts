import assert from "node:assert/strict";
import test from "node:test";

import { getPoolStats } from "./index";

test("pool diagnostics expose dedicated auth and trading occupancy", () => {
  const stats = getPoolStats();
  assert.ok(stats.authPool);
  assert.ok(stats.tradingPool);

  for (const lane of [stats.authPool, stats.tradingPool]) {
    assert.ok(lane.max > 0);
    assert.equal(typeof lane.total, "number");
    assert.equal(typeof lane.idle, "number");
    assert.equal(typeof lane.active, "number");
    assert.equal(typeof lane.rawPoolWaiting, "number");
    assert.equal(lane.admissionWaiting, 0);
    assert.equal(lane.admissionBacklog, false);
    assert.equal(lane.totalWaiting, lane.rawPoolWaiting);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildPositionsAtDateInspectorState } from "./positionsAtDateInspectorModel.js";

test("positions-at-date inspector defaults to live state", () => {
  const state = buildPositionsAtDateInspectorState({
    currentPositionsCount: 4,
  });

  assert.equal(state.mode, "live");
  assert.equal(state.rightRail, "4 current positions");
  assert.deepEqual(state.positions, []);
});

test("positions-at-date inspector gives pinned date precedence", () => {
  const state = buildPositionsAtDateInspectorState({
    activeDate: "2026-05-03",
    pinnedDate: "2026-05-03",
    response: {
      status: "historical",
      positions: [{ id: "AAPL" }],
      activity: [{ id: "fill-1" }],
    },
  });

  assert.equal(state.mode, "pinned");
  assert.equal(state.rightRail, "Pinned date");
  assert.equal(state.positions.length, 1);
  assert.equal(state.activity.length, 1);
});

test("positions-at-date inspector exposes unavailable response", () => {
  const state = buildPositionsAtDateInspectorState({
    activeDate: "2026-05-01",
    response: {
      status: "unavailable",
      message: "No snapshot",
      positions: [],
      activity: [],
    },
  });

  assert.equal(state.mode, "hover");
  assert.equal(state.unavailable, true);
  assert.equal(state.message, "No snapshot");
});

test("positions-at-date inspector keeps balance snapshots visible without positions", () => {
  const state = buildPositionsAtDateInspectorState({
    activeDate: "2026-05-08",
    response: {
      status: "historical",
      message: "No Flex positions",
      positions: [],
      activity: [],
      totals: {
        balance: {
          netLiquidation: 5752.74,
          cash: 1934.74,
          buyingPower: 13205.1,
          dayPnl: -0.6,
        },
      },
    },
  });

  assert.equal(state.unavailable, false);
  assert.equal(state.balance.netLiquidation, 5752.74);
  assert.equal(state.message, "No Flex positions");
});

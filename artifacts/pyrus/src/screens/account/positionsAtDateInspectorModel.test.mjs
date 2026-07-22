import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPositionsAtDateInspectorState } from "./positionsAtDateInspectorModel.js";

test("live position counts distinguish unknown from explicit zero", () => {
  assert.equal(
    buildPositionsAtDateInspectorState({ currentPositionsCount: null }).rightRail,
    "Current positions unavailable",
  );
  assert.equal(
    buildPositionsAtDateInspectorState({ currentPositionsCount: 0 }).rightRail,
    "0 current positions",
  );
});

test("historical activity renders even when its position snapshot is unavailable", () => {
  const state = buildPositionsAtDateInspectorState({
    activeDate: "2026-07-21",
    response: {
      date: "2026-07-21",
      status: "unavailable",
      positions: [],
      activity: [{ id: "cash:deposit" }],
      totals: { balance: null },
      message:
        "No Flex open-position snapshot or recorded balance snapshot exists for this date; showing recorded account activity.",
    },
  });

  assert.equal(state.unavailable, false);
  assert.deepEqual(state.positions, []);
  assert.deepEqual(state.activity, [{ id: "cash:deposit" }]);
  assert.match(state.message, /snapshot.*showing recorded account activity/i);
});

test("a snapshot for a different date cannot masquerade as the selected history", () => {
  const state = buildPositionsAtDateInspectorState({
    activeDate: "2026-07-01",
    response: {
      date: "2026-07-21",
      status: "available",
      positions: [{ id: "current-position" }],
      activity: [],
      totals: {
        balance: { netLiquidation: 1_000 },
      },
    },
  });

  assert.equal(state.unavailable, true);
  assert.deepEqual(state.positions, []);
  assert.equal(state.balance, null);
  assert.match(state.message, /selected date/i);
});

test("a current snapshot does not fabricate an empty activity population", () => {
  const state = buildPositionsAtDateInspectorState({
    activeDate: "2026-07-21",
    response: {
      date: "2026-07-21",
      status: "available",
      positions: [],
      activity: null,
      totals: { balance: { netLiquidation: 125 } },
    },
  });

  assert.equal(state.activityKnown, false);
  assert.deepEqual(state.activity, []);
});

test("a balance-only response does not fabricate empty position or activity populations", () => {
  const state = buildPositionsAtDateInspectorState({
    activeDate: "2026-07-21",
    response: {
      date: "2026-07-21",
      status: "unavailable",
      positions: null,
      activity: null,
      totals: { balance: { netLiquidation: 125 } },
    },
  });

  assert.equal(state.unavailable, false);
  assert.equal(state.positionsKnown, false);
  assert.equal(state.activityKnown, false);
});

test("historical inspector badges disclose unknown populations", () => {
  const source = readFileSync(
    new URL("./PositionsPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /positionsKnown\s*\?\s*`\$\{positions\.length\} positions`\s*:\s*"Positions unavailable"/);
  assert.match(source, /activityKnown\s*\?\s*`\$\{activity\.length\} activity rows`\s*:\s*"Activity unavailable"/);
  assert.match(source, /!positionsKnown\s*\?/);
});

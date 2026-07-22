import assert from "node:assert/strict";
import test from "node:test";

import { FLOW_SORTABLE_COLUMNS } from "../flow/flowTapeColumns.js";
import {
  compareFlowEvents,
  normalizeFlowSortBy,
} from "./flowTapeModel.js";

test("every sortable Flow column survives sort-key normalization", () => {
  for (const columnId of FLOW_SORTABLE_COLUMNS) {
    assert.equal(normalizeFlowSortBy(columnId), columnId, columnId);
  }
  assert.equal(normalizeFlowSortBy("unknown"), "time");
});

test("optional numeric Flow columns sort by their rendered values", () => {
  const numericFields = {
    oi: "oi",
    distance: "distancePercent",
    delta: "delta",
    gamma: "gamma",
    theta: "theta",
    vega: "vega",
  };

  for (const [sortBy, field] of Object.entries(numericFields)) {
    const high = {
      occurredAt: "2026-07-21T15:00:00.000Z",
      [field]: 2,
    };
    const low = {
      occurredAt: "2026-07-21T15:01:00.000Z",
      [field]: 1,
    };

    assert.ok(
      compareFlowEvents(high, low, sortBy, "desc") < 0,
      `${sortBy} should rank the larger rendered value first`,
    );
  }
});

test("missing optional numeric values sort last in both directions", () => {
  const numericFields = {
    oi: "oi",
    distance: "distancePercent",
    delta: "delta",
    gamma: "gamma",
    theta: "theta",
    vega: "vega",
  };

  for (const [sortBy, field] of Object.entries(numericFields)) {
    const events = [
      { id: "missing", occurredAt: "2026-07-21T15:02:00.000Z", [field]: null },
      { id: "zero", occurredAt: "2026-07-21T15:00:00.000Z", [field]: 0 },
      { id: "positive", occurredAt: "2026-07-21T15:01:00.000Z", [field]: 1 },
    ];

    assert.deepEqual(
      [...events]
        .sort((left, right) => compareFlowEvents(left, right, sortBy, "asc"))
        .map((entry) => entry.id),
      ["zero", "positive", "missing"],
      `${sortBy} ascending should keep missing values last`,
    );
    assert.deepEqual(
      [...events]
        .sort((left, right) => compareFlowEvents(left, right, sortBy, "desc"))
        .map((entry) => entry.id),
      ["positive", "zero", "missing"],
      `${sortBy} descending should keep missing values last`,
    );
  }
});

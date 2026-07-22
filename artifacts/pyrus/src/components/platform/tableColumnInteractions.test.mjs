import assert from "node:assert/strict";
import test from "node:test";

import {
  nextSortDirection,
  normalizeColumnOrder,
  orderColumnsById,
  reorderColumnOrder,
} from "./tableColumnInteractions.js";

test("column order removes stale values and preserves every valid column once", () => {
  assert.deepEqual(
    normalizeColumnOrder(
      ["pnl", "stale", "pnl"],
      ["symbol", "price", "pnl"],
      ["symbol"],
    ),
    ["pnl", "symbol", "price"],
  );
});

test("column reordering respects locked columns and never mutates the input", () => {
  const current = ["symbol", "price", "pnl"];
  assert.deepEqual(
    reorderColumnOrder(current, "pnl", "price", {
      validColumnIds: current,
      lockedColumnIds: ["symbol"],
    }),
    ["symbol", "pnl", "price"],
  );
  assert.deepEqual(
    reorderColumnOrder(current, "symbol", "pnl", {
      validColumnIds: current,
      lockedColumnIds: ["symbol"],
    }),
    current,
  );
  assert.deepEqual(current, ["symbol", "price", "pnl"]);
});

test("column objects and sort direction follow the normalized controlled state", () => {
  const columns = [{ id: "symbol" }, { id: "price" }, { id: "pnl" }];
  assert.deepEqual(
    orderColumnsById(columns, ["pnl", "symbol"]).map((column) => column.id),
    ["pnl", "symbol", "price"],
  );
  assert.equal(nextSortDirection(null), "desc");
  assert.equal(nextSortDirection("desc"), "asc");
  assert.equal(nextSortDirection("asc"), "desc");
});

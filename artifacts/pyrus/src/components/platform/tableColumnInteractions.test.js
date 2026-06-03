import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeColumnOrder,
  reorderColumnOrder,
} from "./tableColumnInteractions.js";
import { sortDirectionToAria } from "./InteractiveColumnHeader.jsx";

test("sortDirectionToAria maps unset and active directions", () => {
  assert.equal(sortDirectionToAria("asc"), "ascending");
  assert.equal(sortDirectionToAria("desc"), "descending");
  assert.equal(sortDirectionToAria(null), "none");
});

test("normalizeColumnOrder keeps valid unique ids and appends new defaults", () => {
  assert.deepEqual(
    normalizeColumnOrder(["gamma", "alpha", "gamma", "missing"], [
      "alpha",
      "beta",
      "gamma",
      "delta",
    ]),
    ["gamma", "alpha", "beta", "delta"],
  );
});

test("normalizeColumnOrder falls back when saved order is unusable", () => {
  assert.deepEqual(
    normalizeColumnOrder(null, ["alpha", "beta", "gamma"]),
    ["alpha", "beta", "gamma"],
  );
});

test("reorderColumnOrder moves ids while keeping invalid and duplicate entries out", () => {
  assert.deepEqual(
    reorderColumnOrder(
      ["alpha", "beta", "missing", "gamma", "beta"],
      "gamma",
      "alpha",
      { validColumnIds: ["alpha", "beta", "gamma"] },
    ),
    ["gamma", "alpha", "beta"],
  );
});

test("reorderColumnOrder does not cross locked columns", () => {
  assert.deepEqual(
    reorderColumnOrder(["symbol", "price", "qty", "actions"], "price", "symbol", {
      lockedColumnIds: ["symbol", "actions"],
      validColumnIds: ["symbol", "price", "qty", "actions"],
    }),
    ["symbol", "price", "qty", "actions"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPageIndex,
  getPageCount,
  paginateRows,
} from "./TablePagination.jsx";

test("table pagination computes page counts and clamps page indexes", () => {
  assert.equal(getPageCount(0, 25), 1);
  assert.equal(getPageCount(25, 25), 1);
  assert.equal(getPageCount(26, 25), 2);
  assert.equal(clampPageIndex(-4, 3), 0);
  assert.equal(clampPageIndex(99, 3), 2);
});

test("table pagination slices visible rows without changing source rows", () => {
  const rows = Array.from({ length: 55 }, (_, index) => index + 1);
  const page = paginateRows(rows, 1, 25);

  assert.deepEqual(page.pageRows, rows.slice(25, 50));
  assert.equal(page.startIndex, 25);
  assert.equal(page.endIndex, 50);
  assert.equal(page.total, 55);
  assert.equal(page.pageCount, 3);
  assert.equal(page.safePage, 1);
  assert.deepEqual(rows.slice(0, 3), [1, 2, 3]);
});

test("table pagination uses a safe fallback for invalid inputs", () => {
  const page = paginateRows("bad", 5, 0);

  assert.deepEqual(page.pageRows, []);
  assert.equal(page.pageSize, 25);
  assert.equal(page.pageCount, 1);
  assert.equal(page.safePage, 0);
});

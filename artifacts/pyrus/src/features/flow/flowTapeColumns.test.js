import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FLOW_COLUMN_ORDER,
  DEFAULT_FLOW_VISIBLE_COLUMNS,
  FLOW_COLUMN_BY_ID,
  expandFlowColumnIds,
  normalizeFlowColumnOrder,
  normalizeFlowVisibleColumns,
} from "./flowTapeColumns.js";

test("flow tape columns define the compact bid/ask default", () => {
  assert.equal(FLOW_COLUMN_BY_ID.get("bidAsk")?.label, "BID/ASK");
  assert.ok(DEFAULT_FLOW_VISIBLE_COLUMNS.includes("bidAsk"));
  assert.equal(DEFAULT_FLOW_VISIBLE_COLUMNS.includes("bid"), false);
  assert.equal(DEFAULT_FLOW_VISIBLE_COLUMNS.includes("ask"), false);
  assert.equal(DEFAULT_FLOW_VISIBLE_COLUMNS.includes("spread"), false);
});

test("flow tape column expansion preserves legacy aliases", () => {
  assert.deepEqual(expandFlowColumnIds(["price", "side", "missing"]), [
    "fill",
    "side",
  ]);
  assert.deepEqual(
    expandFlowColumnIds(["bid", "ask", "spread"], { replaceRawBidAsk: true }),
    ["bidAsk"],
  );
});

test("flow tape column order drops invalid values and appends missing columns", () => {
  const normalized = normalizeFlowColumnOrder([
    "score",
    "missing",
    "price",
    "score",
    "side",
  ]);
  assert.deepEqual(normalized.slice(0, 3), ["score", "fill", "side"]);
  assert.equal(normalized.length, DEFAULT_FLOW_COLUMN_ORDER.length);
  assert.equal(new Set(normalized).size, DEFAULT_FLOW_COLUMN_ORDER.length);
});

test("flow tape visible columns always include the compact bid/ask column", () => {
  assert.deepEqual(normalizeFlowVisibleColumns(["premium"]), [
    "bidAsk",
    "premium",
  ]);
  assert.deepEqual(normalizeFlowVisibleColumns(["fill", "premium"]), [
    "fill",
    "bidAsk",
    "premium",
  ]);
  assert.deepEqual(normalizeFlowVisibleColumns(["bid", "ask", "premium"]), [
    "bidAsk",
    "premium",
  ]);
});

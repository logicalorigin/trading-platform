import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () =>
  readFileSync(new URL("./GexScreen.jsx", import.meta.url), "utf8");

test("GEX strike profile supports persisted column reordering", () => {
  const gexSource = source();

  assert.match(gexSource, /TableHeaderDndContext/);
  assert.match(gexSource, /SortableColumnHeaderCell/);
  assert.match(gexSource, /gexProfileColumnOrder/);
  assert.match(gexSource, /const reorderProfileColumn = \(activeColumnId, overColumnId\) =>/);
  assert.match(gexSource, /reorderColumnOrder\(\s*current,\s*activeColumnId,\s*overColumnId,/);
});

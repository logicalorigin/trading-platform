import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradePositionsPanel.jsx", import.meta.url), "utf8");

test("live trade order rows keep stable identities when broker ids are absent", () => {
  assert.match(source, /export const getTradeLiveOrderRowId = \(order\) =>/);
  assert.match(source, /const orderRowId = getTradeLiveOrderRowId\(order\)/);
  assert.match(source, /key=\{orderRowId\}/);
  assert.doesNotMatch(source, /key=\{order\.id\}/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./shadow-account.ts", import.meta.url),
  "utf8",
);

test("positions-at-date joins fills to orders instead of emitting an unbounded order-id IN list", () => {
  const start = source.indexOf(
    "async function getFreshShadowAccountPositionsAtDate",
  );
  const end = source.indexOf("function shadowClosedTradesDateCachePart", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);
  assert.match(
    block,
    /\.select\(\{\s*fill:\s*shadowFillsTable,\s*order:\s*shadowOrdersTable\s*\}\)/,
  );
  assert.match(block, /\.innerJoin\(\s*shadowOrdersTable,/);
  assert.match(block, /shadowCashActivityOrderPredicate\(source\)/);
  assert.doesNotMatch(block, /readShadowOrdersByFillOrderId/);
});

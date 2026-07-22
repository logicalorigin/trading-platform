import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./AccountReturnsPanel.jsx", import.meta.url),
  "utf8",
);

test("calendar detail and accessibility never announce unavailable P&L as zero", () => {
  assert.match(source, /const pnlFmt = day\.hasPnlData/);
  assert.match(source, /day\?\.hasPnlData\s*\? formatAccountSignedMoney\(day\.pnl/);
  assert.match(source, /if \(!day\.hasPnlData\) return "Unavailable"/);
  assert.doesNotMatch(source, /formatAccountSignedMoney\(day\.pnl \|\| 0/);
  assert.doesNotMatch(source, /formatAccountSignedMoney\(day\.realized \|\| 0/);
});

test("calendar summaries hide incomplete P&L populations", () => {
  assert.match(source, /summary\.pnlComplete/);
  assert.match(source, /summary\.realizedComplete/);
  assert.match(source, /summary\.pnlComplete && summary\.best/);
  assert.match(source, /summary\.pnlComplete && summary\.worst/);
});

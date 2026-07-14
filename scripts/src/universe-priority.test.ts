import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeUniversePrioritySymbol,
  parseUniversePrioritySymbolList,
  uniqueUniversePrioritySymbols,
} from "./universe-priority";

test("priority symbols reuse canonical share-class normalization", () => {
  assert.equal(normalizeUniversePrioritySymbol("brk-b"), "BRK.B");
  assert.equal(normalizeUniversePrioritySymbol("BRK B"), "BRK.B");
  assert.equal(normalizeUniversePrioritySymbol("brk.b"), "BRK.B");
});

test("explicit symbol scope rejects empty or malformed entries", () => {
  assert.deepEqual(parseUniversePrioritySymbolList(null), []);

  for (const raw of ["", "AAPL,,MSFT", "AAPL$", "$", "AAPL,   "]) {
    assert.throws(
      () => parseUniversePrioritySymbolList(raw),
      /non-empty|invalid/i,
    );
  }

  assert.throws(
    () => uniqueUniversePrioritySymbols(["AAPL$", "AAPL"]),
    /invalid/i,
  );
});

test("priority symbols reject Unicode retargeting and invalid catalog shape", () => {
  for (const raw of ["ſ", ".", "A".repeat(65)]) {
    assert.throws(() => parseUniversePrioritySymbolList(raw), /invalid/i);
  }
});

test("canonical priority symbols preserve first-seen order and deduplicate", () => {
  assert.deepEqual(
    parseUniversePrioritySymbolList("spy,brk-b,BRK.B,aapl,SPY"),
    ["SPY", "BRK.B", "AAPL"],
  );
  assert.deepEqual(
    uniqueUniversePrioritySymbols([null, " msft ", "BRK B", "brk.b"]),
    ["MSFT", "BRK.B"],
  );
});

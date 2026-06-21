import assert from "node:assert/strict";
import test from "node:test";

import { patchOptionChainRowSideWithQuote } from "./optionChainRows.js";

// Regression for "last/premium shows 0": a tickless streaming option quote
// (price 0, no usable bid/ask) must not overwrite the premium with $0.00. The
// build path already enforces a >0 contract (buildOptionChainRowsFromApi /
// quotePrice); the streaming patch path must match it.

test("a 0 streaming option price keeps the prior premium, never $0.00", () => {
  const row = { cPrem: 1.25, cBid: 1.2, cAsk: 1.3 };
  const patched = patchOptionChainRowSideWithQuote(row, "C", {
    price: 0,
    bid: 0,
    ask: 0,
  });
  assert.notEqual(patched.cPrem, 0);
  assert.equal(patched.cPrem, 1.25);
});

test("a 0 last with no prior premium and no quote yields a dash (null), never 0", () => {
  const row = { cPrem: null, cBid: null, cAsk: null };
  const patched = patchOptionChainRowSideWithQuote(row, "C", {
    price: 0,
    bid: 0,
    ask: 0,
  });
  assert.equal(patched.cPrem, null);
});

test("a real bid/ask still yields a midpoint mark even when last is 0", () => {
  const row = { pPrem: null };
  const patched = patchOptionChainRowSideWithQuote(row, "P", {
    price: 0,
    bid: 1.0,
    ask: 1.4,
  });
  assert.equal(patched.pPrem, 1.2);
});

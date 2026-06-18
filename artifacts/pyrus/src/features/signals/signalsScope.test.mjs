import assert from "node:assert/strict";
import test from "node:test";

import {
  boundSignalsRowsToUniverse,
  buildSignalsSourceScopeKey,
  signalsFiltersActive,
} from "./signalsScope.js";

test("buildSignalsSourceScopeKey changes on environment or universe change (order-insensitive)", () => {
  const base = buildSignalsSourceScopeKey({
    environment: "paper",
    universeSymbols: ["SPY", "QQQ"],
  });
  // Same env + same symbols in any order -> same key.
  assert.equal(
    base,
    buildSignalsSourceScopeKey({
      environment: "paper",
      universeSymbols: ["QQQ", "SPY"],
    }),
  );
  // Environment change -> new key.
  assert.notEqual(
    base,
    buildSignalsSourceScopeKey({
      environment: "live",
      universeSymbols: ["SPY", "QQQ"],
    }),
  );
  // Universe change -> new key.
  assert.notEqual(
    base,
    buildSignalsSourceScopeKey({
      environment: "paper",
      universeSymbols: ["SPY"],
    }),
  );
  // Missing inputs never throw.
  assert.equal(buildSignalsSourceScopeKey(), "::");
});

test("buildSignalsSourceScopeKey normalizes duplicate lower-case universe symbols into a stable key", () => {
  const key = buildSignalsSourceScopeKey({
    environment: "paper",
    universeSymbols: ["spy", "qqq", "spy", " qqq "],
  });

  assert.equal(key, "paper::QQQ,SPY");
  assert.equal(
    key,
    buildSignalsSourceScopeKey({
      environment: "paper",
      universeSymbols: ["QQQ", "SPY"],
    }),
  );
});

test("boundSignalsRowsToUniverse drops rows outside the authoritative universe", () => {
  const rows = [{ symbol: "SPY" }, { symbol: "QQQ" }, { symbol: "STALE" }];
  assert.deepEqual(
    boundSignalsRowsToUniverse(rows, ["SPY", "QQQ"]).map((row) => row.symbol),
    ["SPY", "QQQ"],
  );
  // Unavailable universe -> pass through (don't hide everything during load).
  assert.deepEqual(boundSignalsRowsToUniverse(rows, []), rows);
  assert.deepEqual(boundSignalsRowsToUniverse(rows, undefined), rows);
  // Case-insensitive + duplicate-insensitive match (normalized on both sides).
  assert.deepEqual(
    boundSignalsRowsToUniverse(
      [{ symbol: "SPY" }, { symbol: "QQQ" }, { symbol: "STALE" }],
      ["spy", "qqq", "spy", " qqq "],
    ).map((row) => row.symbol),
    ["SPY", "QQQ"],
  );
  // Non-array rows -> empty.
  assert.deepEqual(boundSignalsRowsToUniverse(undefined, ["SPY"]), []);
});

test("signalsFiltersActive is true only when a search/status/direction filter narrows the table", () => {
  assert.equal(
    signalsFiltersActive({ query: "", statusFilter: "all", directionFilter: "all" }),
    false,
  );
  assert.equal(
    signalsFiltersActive({ query: "   ", statusFilter: "all", directionFilter: "all" }),
    false,
  );
  assert.equal(
    signalsFiltersActive({ query: "spy", statusFilter: "all", directionFilter: "all" }),
    true,
  );
  assert.equal(
    signalsFiltersActive({ query: "", statusFilter: "fresh", directionFilter: "all" }),
    true,
  );
  assert.equal(
    signalsFiltersActive({ query: "", statusFilter: "all", directionFilter: "buy" }),
    true,
  );
  assert.equal(signalsFiltersActive(), false);
});

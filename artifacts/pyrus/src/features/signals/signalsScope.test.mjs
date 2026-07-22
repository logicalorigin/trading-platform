import assert from "node:assert/strict";
import test from "node:test";

import {
  boundSignalsRowsToUniverse,
  buildSignalsSourceScopeKey,
  resolveSignalsEmptyState,
  signalsFiltersActive,
} from "./signalsScope.js";

test("buildSignalsSourceScopeKey changes on environment or universe change (order-insensitive)", () => {
  const base = buildSignalsSourceScopeKey({
    environment: "shadow",
    universeSymbols: ["SPY", "QQQ"],
  });
  // Same env + same symbols in any order -> same key.
  assert.equal(
    base,
    buildSignalsSourceScopeKey({
      environment: "shadow",
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
      environment: "shadow",
      universeSymbols: ["SPY"],
    }),
  );
  // Missing inputs never throw.
  assert.equal(buildSignalsSourceScopeKey(), "::");
});

test("buildSignalsSourceScopeKey normalizes duplicate lower-case universe symbols into a stable key", () => {
  const key = buildSignalsSourceScopeKey({
    environment: "shadow",
    universeSymbols: ["spy", "qqq", "spy", " qqq "],
  });

  assert.equal(key, "shadow::QQQ,SPY");
  assert.equal(
    key,
    buildSignalsSourceScopeKey({
      environment: "shadow",
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
  // Authoritative empty -> clear; only unavailable/nullish passes through.
  assert.deepEqual(boundSignalsRowsToUniverse(rows, []), []);
  assert.deepEqual(boundSignalsRowsToUniverse(rows, null), rows);
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

test("resolveSignalsEmptyState distinguishes filtered, idle, and true-empty recovery", () => {
  assert.deepEqual(
    resolveSignalsEmptyState({
      filtersActive: true,
      monitorEnabled: true,
    }),
    {
      kind: "filtered-empty",
      title: "No matching signals",
      detail: "No tracked ticker matches the current filters.",
      actionLabel: "Clear filters",
    },
  );
  assert.deepEqual(
    resolveSignalsEmptyState({
      filtersActive: false,
      monitorEnabled: false,
    }),
    {
      kind: "monitor-off",
      title: "Signal monitor is off",
      detail: "Turn on the monitor when you want the signal universe to scan.",
      actionLabel: "Turn monitor on",
    },
  );
  assert.deepEqual(
    resolveSignalsEmptyState({
      filtersActive: false,
      monitorEnabled: true,
    }),
    {
      kind: "empty",
      title: "No signals yet",
      detail: "Run a scan or check the selected universe for tracked tickers.",
      actionLabel: "Run scan",
    },
  );
  assert.equal(resolveSignalsEmptyState().kind, "monitor-off");
});

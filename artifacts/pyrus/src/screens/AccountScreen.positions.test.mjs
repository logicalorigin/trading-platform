import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountScreen.jsx", import.meta.url), "utf8");

function constBlock(name) {
  const start = source.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = source.indexOf("\n  );", start);
  assert.notEqual(end, -1, `Missing end of ${name}`);
  return source.slice(start, end + "\n  );".length);
}

test("account positions table query requests live quote hydration", () => {
  const positionsQuery = source.match(
    /const positionsQuery = useGetAccountPositions\([\s\S]*?\n  \);/,
  )?.[0];
  assert.ok(positionsQuery, "Missing positionsQuery");
  assert.match(positionsQuery, /liveQuotes:\s*true/);
  assert.doesNotMatch(positionsQuery, /liveQuotes:\s*false/);
});

test("stream-backed account primary data does not immediately refetch REST duplicates", () => {
  const restGate = source.match(
    /const primaryAccountRestQueriesEnabled = Boolean\([\s\S]*?\n  \);/,
  )?.[0];
  assert.ok(restGate, "Missing primaryAccountRestQueriesEnabled");
  assert.match(restGate, /!accountPageStreamEnabled/);
  assert.match(restGate, /accountPrimaryFallbackReady/);
  assert.match(restGate, /!accountPageStreamFreshness\.accountPrimaryFresh/);

  for (const queryName of [
    "summaryQuery",
    "allocationQuery",
    "positionsQuery",
    "riskQuery",
  ]) {
    const querySource = constBlock(queryName);
    assert.match(querySource, /enabled:\s*primaryAccountRestQueriesEnabled/);
  }

  const ordersGate = source.match(
    /const ordersPanelQueriesEnabled = Boolean\([\s\S]*?\n  \);/,
  )?.[0];
  assert.ok(ordersGate, "Missing ordersPanelQueriesEnabled");
  assert.match(ordersGate, /primaryAccountRestQueriesEnabled/);
});

test("positions source selector is wired to live state, not pinned to all", () => {
  assert.match(
    source,
    /const \[sourceFilter, setSourceFilter\] = useState\(/,
    "Missing sourceFilter state in AccountScreen",
  );

  const positionsPanel = source.match(
    /<LazyPositionsPanel[\s\S]*?\/>/,
  )?.[0];
  assert.ok(positionsPanel, "Missing LazyPositionsPanel render");
  // The selector must receive the live state + change handler so it can filter.
  assert.match(positionsPanel, /sourceFilter=\{sourceFilter\}/);
  assert.match(positionsPanel, /onSourceFilterChange=\{setSourceFilter\}/);
  // It must NOT be hardcoded to "all" (the original inert bug).
  assert.doesNotMatch(positionsPanel, /sourceFilter="all"/);
});

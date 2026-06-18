import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TradeScreen.jsx", import.meta.url),
  "utf8",
);

test("option chart loader is gated on historicalDataEnabled so a disabled query is not 'loading'", () => {
  // Regression: a disabled React Query v5 query is permanently `isPending`, so
  // chartRequestLoading pinned the "Loading option history" overlay on whenever a
  // contract was selected while option data was disabled (e.g. safeQaMode). The
  // loader gate must match optionBarsQuery's own enable condition
  // (historicalDataEnabled && optionIdentityReady).
  const start = source.indexOf("const chartRequestLoading");
  assert.notEqual(start, -1, "chartRequestLoading must exist");
  const block = source.slice(start, start + 240);
  assert.match(block, /historicalDataEnabled &&/);
  assert.match(block, /optionIdentityReady &&/);
  assert.match(block, /optionBarsQuery\.fetchStatus === "fetching"/);
});

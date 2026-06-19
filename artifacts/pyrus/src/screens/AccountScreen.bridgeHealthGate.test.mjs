import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-assertion regression (jsx is not tsc-covered) for the bridge-detached
// flex-health un-gate. Run: npx tsx --test src/screens/AccountScreen.bridgeHealthGate.test.mjs

const source = readFileSync(
  new URL("./AccountScreen.jsx", import.meta.url),
  "utf8",
);

test("flex health query is gated only on screen visibility, not on bridge-attached / accordion", () => {
  // Regression: the diagnostic that explains a detached bridge was itself gated
  // behind the bridge being attached (accountQueriesEnabled) + the Setup & Health
  // accordion being expanded (supportPanelQueriesEnabled) - circular, so a
  // detached bridge could never be diagnosed. /accounts/flex/health is a plain
  // server route, so it must fetch whenever the Account screen is visible.
  assert.match(
    source,
    /useGetFlexHealth\(\{[\s\S]*?enabled:\s*Boolean\(isVisible && !shadowMode && !safeQaMode\)/,
    "health query must be gated on isVisible && !shadowMode && !safeQaMode",
  );
  assert.doesNotMatch(
    source,
    /supportPanelQueriesEnabled/,
    "the orphaned bridge/accordion-gated supportPanelQueriesEnabled must be removed",
  );
});

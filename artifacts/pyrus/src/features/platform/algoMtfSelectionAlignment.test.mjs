import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-contract guard for Algo Monitor MTF selection alignment (seq164):
// the STA table (AlgoScreen profileDraft) and the Algo Monitor sidebar must use
// the SAME live MTF selection. AlgoScreen publishes the live MTF set to the
// shared store; the sidebar prefers it (falling back to the committed profile).
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const algoScreen = read("../../screens/AlgoScreen.jsx");
const sidebar = read("./PlatformAlgoMonitorSidebar.jsx");

test("AlgoScreen publishes the live draft MTF set to the shared store", () => {
  assert.match(algoScreen, /publishAlgoStaMtfTimeframes\(staSignalTimeframes\)/);
});

test("Sidebar MTF set prefers the live store selection, with committed fallback", () => {
  assert.match(sidebar, /useAlgoStaMtfTimeframes\(\)/);
  assert.match(
    sidebar,
    /const live = normalizeSignalOptionsMtfTimeframes\(activeStaMtfTimeframes, \[\]\)/,
  );
  // committed fallback must remain for when AlgoScreen is not mounted
  assert.match(
    sidebar,
    /automationState\?\.profile\?\.entryGate\?\.mtfAlignment\?\.timeframes/,
  );
});

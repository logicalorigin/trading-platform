import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-contract guard for Algo Monitor MTF selection alignment (seq164):
// the STA table (AlgoScreen profileDraft) and the Algo Monitor sidebar must use
// the SAME live MTF selection. AlgoScreen publishes the live MTF set to the
// shared store; the sidebar prefers it (falling back to the committed profile).
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const algoScreen = read("../../screens/AlgoScreen.jsx");
const algoTimeframeControlBand = read("../../screens/algo/AlgoTimeframeControlBand.jsx");
const sidebar = read("./PlatformAlgoMonitorSidebar.jsx");

test("AlgoScreen publishes the execution-aligned live draft MTF set", () => {
  assert.match(algoScreen, /normalizeAlgoAlignedMtfTimeframes\(/);
  assert.match(algoScreen, /staActionSignalTimeframes\[0\]/);
  assert.match(algoScreen, /publishAlgoStaMtfTimeframes\(staSignalTimeframes\)/);
});

test("Algo timeframe control renders stale profiles with execution-aligned MTF", () => {
  assert.match(algoTimeframeControlBand, /normalizeAlgoAlignedMtfTimeframes\(/);
  assert.match(algoTimeframeControlBand, /const locked = selected && timeframe === executionTimeframe/);
});

test("Sidebar MTF set prefers the live store selection, with committed fallback", () => {
  assert.match(sidebar, /useAlgoStaMtfTimeframes\(\)/);
  assert.match(
    sidebar,
    /const live = Array\.isArray\(activeStaMtfTimeframes\)/,
  );
  assert.match(
    sidebar,
    /SIGNAL_OPTIONS_MTF_TIMEFRAMES\.includes\(timeframe\)/,
  );
  assert.match(sidebar, /normalizeAlgoAlignedMtfTimeframes\(/);
  // committed fallback must remain for when AlgoScreen is not mounted
  assert.match(
    sidebar,
    /automationState\?\.profile\?\.entryGate\?\.mtfAlignment\?\.timeframes/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALGO_DRILL_TABS,
  algoFocusStore,
  clearAlgoFocus,
  setAlgoDrillTab,
  setAlgoFocus,
} from "./algoFocusStore";

test("setAlgoFocus normalizes the symbol to uppercase", () => {
  algoFocusStore.__resetForTests();
  setAlgoFocus("spy");
  assert.equal(algoFocusStore.getSnapshot().focusedSymbol, "SPY");
});

test("setAlgoFocus accepts an optional drill tab argument", () => {
  algoFocusStore.__resetForTests();
  setAlgoFocus("NVDA", "position");
  const snapshot = algoFocusStore.getSnapshot();
  assert.equal(snapshot.focusedSymbol, "NVDA");
  assert.equal(snapshot.drillTab, "position");
});

test("setAlgoFocus rejects unknown drill tabs and keeps the prior tab", () => {
  algoFocusStore.__resetForTests();
  setAlgoFocus("SPY", "history");
  setAlgoFocus("SPY", "bogus");
  assert.equal(algoFocusStore.getSnapshot().drillTab, "history");
});

test("setAlgoFocus emits to subscribers only on actual change", () => {
  algoFocusStore.__resetForTests();
  let calls = 0;
  const unsubscribe = algoFocusStore.subscribe(() => {
    calls += 1;
  });
  setAlgoFocus("SPY");
  setAlgoFocus("SPY");
  unsubscribe();
  assert.equal(calls, 1);
});

test("clearAlgoFocus returns to the default snapshot", () => {
  algoFocusStore.__resetForTests();
  setAlgoFocus("AMD", "action");
  clearAlgoFocus();
  const snapshot = algoFocusStore.getSnapshot();
  assert.equal(snapshot.focusedSymbol, null);
  assert.equal(snapshot.drillTab, "overview");
});

test("setAlgoDrillTab validates against the allowed tab list", () => {
  algoFocusStore.__resetForTests();
  setAlgoFocus("SPY", "overview");
  setAlgoDrillTab("position");
  assert.equal(algoFocusStore.getSnapshot().drillTab, "position");
  setAlgoDrillTab("not-a-tab");
  assert.equal(algoFocusStore.getSnapshot().drillTab, "position");
});

test("ALGO_DRILL_TABS exposes the canonical tab list", () => {
  assert.deepEqual(ALGO_DRILL_TABS, [
    "overview",
    "action",
    "position",
    "history",
  ]);
});

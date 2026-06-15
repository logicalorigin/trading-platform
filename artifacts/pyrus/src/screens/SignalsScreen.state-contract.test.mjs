import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () => readFileSync(new URL("./SignalsScreen.jsx", import.meta.url), "utf8");

test("Signals screen does not request or display UI-side Signal Matrix hydration", () => {
  const screenSource = source();

  assert.equal(screenSource.includes("onRequestSignalMatrixHydration"), false);
  assert.equal(screenSource.includes("priority symbols"), false);
  assert.equal(screenSource.includes("priorityCount"), false);
  assert.equal(screenSource.includes("priorityHydrationSymbols"), false);
  assert.equal(screenSource.includes("matrixHydrationFullRequestReady"), false);
  assert.equal(screenSource.includes("requestCells"), false);
  assert.equal(screenSource.includes("requestSymbols"), false);
});

test("Signals interval tooltip does not present sparkline point count as bars", () => {
  const screenSource = source();

  assert.equal(screenSource.includes("${sparklinePoints.length || 0} bars"), false);
  assert.match(
    screenSource,
    /\$\{timeframe\} \$\{direction \|\| "none"\} · \$\{formatBars\(state\.barsSinceSignal\)\} · \$\{intervalAge\}/,
  );
});

test("Signals table loading/errored do not mask pushed matrix state", () => {
  const screenSource = source();

  // Both the loading spinner and the "Signals unavailable" error must defer to
  // hasSignalData, so the table renders pushed/stored matrix data the moment it
  // exists instead of waiting on (or erroring out on) a slow profile/state read.
  // The KPI strip already renders from the same states; the table must too.
  assert.match(screenSource, /const hasSignalData =/);
  assert.match(screenSource, /const loading =\s*!hasSignalData &&/);
  assert.match(screenSource, /const errored =\s*!hasSignalData &&/);
  // The !stateResponseReady guard must remain so a slow state read alone can't
  // mask the matrix (stateResponseReady is true once signalMatrixStates arrive).
  assert.match(screenSource, /!stateResponseReady && effectiveStateLoading/);
  assert.doesNotMatch(
    screenSource,
    /const loading = effectiveStateLoading \|\| \(!profile && effectiveProfileLoading\);/,
  );
});

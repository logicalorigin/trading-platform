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

test("Signals table loading does not mask pushed matrix state", () => {
  const screenSource = source();

  assert.match(
    screenSource,
    /const loading =\s*\(!stateResponseReady && effectiveStateLoading\) \|\|\s*\(!profile && effectiveProfileLoading\);/,
  );
  assert.doesNotMatch(
    screenSource,
    /const loading = effectiveStateLoading \|\| \(!profile && effectiveProfileLoading\);/,
  );
});

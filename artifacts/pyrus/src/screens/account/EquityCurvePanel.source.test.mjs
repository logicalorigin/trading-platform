import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { equityEventKey } from "./EquityCurveEventRibbon.jsx";

const source = readFileSync(
  new URL("./EquityCurvePanel.jsx", import.meta.url),
  "utf8",
);
const ribbonSource = readFileSync(
  new URL("./EquityCurveEventRibbon.jsx", import.meta.url),
  "utf8",
);
const chartSource = readFileSync(
  new URL("./EquityCurveChart.jsx", import.meta.url),
  "utf8",
);

test("Equity Curve never retains a prior or mismatched range response", () => {
  assert.doesNotMatch(
    source,
    /fallbackRef|allowMismatchedFallback|resolveStableEquityRangeResponse|useStableEquityRangeResponse/,
  );
  assert.match(
    source,
    /const chartData = selectedRangeReady \? query\.data : null;/,
  );
  assert.match(
    source,
    /const currentRangeResponse = \(candidateQuery, selectedRange\) =>/,
  );
});

test("equity event keys preserve distinct fills snapped to the same chart point", () => {
  const shared = {
    timestampMs: 1_780_468_475_930,
    type: "trade_buy",
    symbol: "COHR",
  };

  assert.notEqual(
    equityEventKey({ ...shared, id: "fill-a" }, 0),
    equityEventKey({ ...shared, id: "fill-b" }, 1),
  );
  assert.notEqual(
    equityEventKey(shared, 0),
    equityEventKey(shared, 1),
  );
});

test("equity chart toggles and event glyphs expose their state and names", () => {
  assert.match(source, /aria-pressed=\{active\}/);
  assert.match(ribbonSource, /aria-label=\{equityEventTitle\(event\)\}/);
  assert.match(chartSource, /role=\{interactive \? "slider" : "img"\}/);
  assert.match(chartSource, /Account net liquidation value/);
});

test("equity chart date inspection and pinning are keyboard accessible", () => {
  assert.match(chartSource, /tabIndex=\{interactive \? 0 : -1\}/);
  assert.match(
    chartSource,
    /aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End Enter Space"/,
  );
  ["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].forEach(
    (key) => assert.match(chartSource, new RegExp(JSON.stringify(key))),
  );
  assert.match(chartSource, /onHoverPoint\?\.\(points\[nextIndex\]\)/);
  assert.match(chartSource, /onClickPoint\?\.\(points\[safeKeyboardIndex\]\)/);
});

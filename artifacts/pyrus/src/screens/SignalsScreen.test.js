import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const signalsSource = () =>
  readFileSync(new URL("./SignalsScreen.jsx", import.meta.url), "utf8");

test("signals chart shows absolute signal time and elapsed age", () => {
  const source = signalsSource();

  assert.match(source, /import \{ formatAppTime \} from "\.\.\/lib\/timeZone"/);
  assert.match(source, /const formatClockTime = \(value\) => \(value \? formatAppTime\(value\) : MISSING_VALUE\)/);
  assert.match(source, /const formatSince = \(value\) => \{/);
  assert.match(source, /const signalClockTime = formatClockTime\(row\.currentSignalAt\)/);
  assert.match(source, /const signalSince = formatSince\(row\.currentSignalAt\)/);
  assert.match(source, /label="Signal Time" value=\{signalClockTime\}/);
  assert.match(source, /label="Since" value=\{signalSince\}/);
  assert.match(source, /signalMarkerLabel/);
  assert.match(source, /<tspan[\s\S]*\{signalMarkerLabel\}[\s\S]*<\/tspan>/);
  assert.match(source, /<tspan[\s\S]*\{signalSince\}[\s\S]*<\/tspan>/);
});

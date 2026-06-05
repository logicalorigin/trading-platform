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

test("signals header renders timeframe buy sell aggregate strip", () => {
  const source = signalsSource();

  assert.match(source, /summarizeSignalsTimeframeDirections/);
  assert.match(source, /function TimeframeSignalKpiStrip/);
  assert.match(source, /const timeframeSignalSummary = useMemo\(/);
  assert.match(source, /summarizeSignalsTimeframeDirections\(rows\)/);
  assert.match(source, /data-testid="signals-timeframe-kpi-strip"/);
  assert.match(source, /data-testid=\{`signals-timeframe-kpi-\$\{item\.timeframe\}`\}/);
  assert.match(source, /data-buy-count=\{buy\}/);
  assert.match(source, /data-sell-count=\{sell\}/);
  assert.match(
    source,
    /<TimeframeSignalKpiStrip[\s\S]*summaries=\{timeframeSignalSummary\}/,
  );
});

test("signals header renders backend breadth history and net bias surfaces", () => {
  const source = signalsSource();

  assert.match(source, /useListSignalMonitorBreadthHistory/);
  assert.match(source, /normalizeSignalsBreadthHistory/);
  assert.match(source, /summarizeSignalsNetBias/);
  assert.match(source, /const \[breadthHistoryRange, setBreadthHistoryRange\] = useState\("day"\)/);
  assert.match(source, /range: breadthHistoryRange/);
  assert.match(source, /data-testid="signals-breadth-history-strip"/);
  assert.match(source, /data-testid="signals-breadth-history-chart"/);
  assert.match(source, /signals-breadth-range-day/);
  assert.match(source, /signals-breadth-range-week/);
  assert.match(source, /label="Net Bias"/);
  assert.match(source, /value=\{netBias\.label\}/);
  assert.match(source, /<SignalBreadthHistoryStrip[\s\S]*history=\{breadthHistory\}/);
});

test("signals table rows expose direction rails and signal flip markers", () => {
  const source = signalsSource();

  assert.match(source, /resolveSignalDirectionFlipStates/);
  assert.match(source, /previousSignalDirectionsRef/);
  assert.match(source, /flippedSignalSymbols/);
  assert.match(source, /data-signal-direction/);
  assert.match(source, /data-signal-flipped/);
  assert.match(source, /boxShadow: directionRailTone/);
  assert.match(source, /data-testid="signals-row-drilldown"/);
  assert.match(source, /data-signal-direction=\{row\.direction \|\| "none"\}/);
});

test("signals breadth history chart avoids green directional colors", () => {
  const source = signalsSource();
  const block =
    source.match(/function SignalBreadthHistoryStrip[\s\S]*?\n}\n\nfunction StatusCell/)?.[0] ??
    "";

  assert.match(block, /fill=\{CSS_COLOR\.blue\}/);
  assert.match(block, /fill=\{CSS_COLOR\.red\}/);
  assert.doesNotMatch(block, /CSS_COLOR\.green/);
  assert.doesNotMatch(block, /rgba\(16,\s*185,\s*129/);
});

test("signals mobile layout keeps the table reachable below the header strips", () => {
  const source = signalsSource();

  assert.match(source, /gridTemplateRows: phone \? "auto minmax\(360px, 1fr\)" : "auto minmax\(0, 1fr\)"/);
  assert.match(source, /overflowY: phone \? "auto" : "hidden"/);
  assert.match(source, /WebkitOverflowScrolling: phone \? "touch" : undefined/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () =>
  readFileSync(new URL("./SignalsScreen.jsx", import.meta.url), "utf8");

test("signals table exposes sort keys for all visible signal columns", () => {
  const signalsSource = source();

  for (const sortKey of [
    "age",
    "coverage",
    "mtf",
    "price",
    "signal",
    "stack",
    "strength",
    "trend",
    "verdict",
    "vol",
  ]) {
    assert.match(signalsSource, new RegExp(`${sortKey}: "${sortKey}"`));
  }
  assert.doesNotMatch(signalsSource, /action:\s*"symbol"/);
  assert.match(signalsSource, /SIGNALS_TABLE_TIMEFRAMES\.map\(\(timeframe\) => \[/);
  assert.match(signalsSource, /`tf-\$\{timeframe\}`,\s*`tf-\$\{timeframe\}`/);
  assert.match(signalsSource, /sortKey: columnSortKey/);
  assert.match(signalsSource, /sortTitle: columnSortKey \? `Sort by \$\{label\}` : undefined/);
});

test("signals timeframe cells show compact bars with elapsed interval age", () => {
  const signalsSource = source();

  assert.match(signalsSource, /const intervalAge = hydrated/);
  assert.match(signalsSource, /state\.currentSignalAt \|\| state\.latestBarAt \|\| state\.lastEvaluatedAt/);
  assert.match(signalsSource, /`\$\{timeframe\} \$\{direction \|\| "none"\} · \$\{formatBars\(state\.barsSinceSignal\)\} · \$\{intervalAge\} · \$\{sparklinePoints\.length \|\| 0\} bars`/);
  assert.match(signalsSource, /data-testid=\{`signals-\$\{timeframe\}-age`\}/);
  assert.match(signalsSource, /data-testid=\{`signals-\$\{timeframe\}-sparkline`\}/);
  assert.match(signalsSource, /buildDetailedFallbackSparklineData/);
  assert.match(signalsSource, /const signalSparklineFallbackPrice = \(state, fallbackPrice\) =>/);
  assert.match(signalsSource, /const currentSignalPrice = Number\(state\?\.currentSignalPrice\)/);
  assert.match(signalsSource, /const close = Number\(state\?\.close\)/);
  assert.match(signalsSource, /const rowFallbackPrice = Number\(fallbackPrice\)/);
  assert.match(signalsSource, /const current = signalSparklineFallbackPrice\(state, fallbackPrice\)/);
  assert.match(signalsSource, /hydrated[\s\S]*buildSignalsTableFallbackSparklineData/);
  assert.match(signalsSource, /data-sparkline-source=\{sparklineSource\}/);
  assert.match(signalsSource, /<MicroSparkline/);
  assert.match(signalsSource, /data=\{displaySparklineData\}/);
  assert.match(signalsSource, /pointColors=\{sparklinePointColors\}/);
  assert.match(signalsSource, /fontSize: fs\(9\)/);
  assert.match(signalsSource, /meta: \{ width: phone \? "78px" : "96px", align: "right" \}/);
  assert.match(signalsSource, /rowHeight=\{phone \? 58 : 56\}/);
});

test("signals stack fallback denominator follows configured table timeframes", () => {
  const signalsSource = source();

  assert.match(signalsSource, /\{stack\.label \|\| `0\/\$\{SIGNALS_TABLE_TIMEFRAMES\.length\}`\}/);
  assert.doesNotMatch(signalsSource, /stack\.label \|\| "0\/5"/);
});

test("signals table hydrates one shared sparkline timeline per filtered row", () => {
  const signalsSource = source();

  assert.match(signalsSource, /const signalSparklineRows = useMemo/);
  assert.match(signalsSource, /filteredRows[\s\S]*\.map\(\(row\) =>/);
  assert.match(signalsSource, /new Map\([\s\S]*rowSparklines\.map\(\(rowSparkline\) => \[/);
  assert.match(signalsSource, /\.sort\(\(left, right\) => left\.key\.localeCompare\(right\.key\)\)/);
  assert.doesNotMatch(signalsSource, /signalSparklineCellKey\(row\.symbol, timeframe\)/);
  assert.match(signalsSource, /const \[signalSparklineBarsBySymbol, setSignalSparklineBarsBySymbol\] = useState/);
  assert.match(signalsSource, /fetch\("\/api\/bars\/batch"/);
  assert.match(signalsSource, /SIGNALS_TABLE_SPARKLINE_BATCH_SIZE/);
  assert.match(signalsSource, /SIGNALS_TABLE_SPARKLINE_BATCH_CONCURRENCY/);
  assert.match(signalsSource, /setSignalSparklineBarsBySymbol\(\(current\) =>/);
  assert.match(signalsSource, /thinBarsForSignalsTableSparkline\(item\.bars \|\| \[\]\)/);
  assert.match(signalsSource, /if \(!active \|\| safeQaMode \|\| !signalSparklineRows\.length\)/);
  assert.match(signalsSource, /const symbolKey = signalSparklineRowKey\(row\.original\.symbol\)/);
  assert.match(signalsSource, /sparklineData=\{signalSparklineBarsBySymbol\[symbolKey\] \|\| \[\]\}/);
  assert.match(signalsSource, /fallbackPrice=\{row\.original\.currentSignalPrice\}/);
  assert.match(signalsSource, /signalEventsBySymbol\.get\(symbolKey\) \|\| EMPTY_SIGNAL_EVENTS/);
  assert.doesNotMatch(signalsSource, /signalEventsBySymbol\.get\(row\.original\.symbol\)/);
  assert.match(signalsSource, /symbol=\{row\.original\.symbol\}/);
});

test("signals screen receives safe-QA mode from the platform router", () => {
  const signalsSource = source();
  const routerSource = readFileSync(
    new URL("../features/platform/PlatformScreenRouter.jsx", import.meta.url),
    "utf8",
  );

  assert.match(signalsSource, /safeQaMode = false/);
  assert.match(routerSource, /<MemoSignalsScreen[\s\S]*safeQaMode=\{safeQaMode\}/);
});

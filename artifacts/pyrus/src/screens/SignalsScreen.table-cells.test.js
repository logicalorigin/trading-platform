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
  assert.match(signalsSource, /`\$\{timeframe\} \$\{direction \|\| "none"\} · \$\{formatBars\(state\.barsSinceSignal\)\} · \$\{intervalAge\}`/);
  assert.match(signalsSource, /data-testid=\{`signals-\$\{timeframe\}-age`\}/);
  assert.match(signalsSource, /fontSize: fs\(9\)/);
  assert.match(signalsSource, /meta: \{ width: phone \? "60px" : "76px", align: "right" \}/);
});

test("signals stack fallback denominator follows configured table timeframes", () => {
  const signalsSource = source();

  assert.match(signalsSource, /\{stack\.label \|\| `0\/\$\{SIGNALS_TABLE_TIMEFRAMES\.length\}`\}/);
  assert.doesNotMatch(signalsSource, /stack\.label \|\| "0\/5"/);
});

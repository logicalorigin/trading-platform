import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./BacktestingPanels.tsx", import.meta.url),
  "utf8",
);

test("Backtest completion makes the Algo draft destination explicit", () => {
  assert.match(source, />\s*Create Algo Draft\s*</);
  assert.match(
    source,
    /aria-label=\{`Create Algo draft from \$\{runDetail\?\.run\.name \?\? "selected run"\}`\}/,
  );
  assert.doesNotMatch(source, />\s*Promote\s*</);
  assert.match(source, /title: "Algo draft created"/);
});

test("Backtest result regions follow the product reading order", () => {
  const regionMarkers = [
    'testId="backtest-inputs"',
    'testId="backtest-results"',
    'data-testid="backtest-validation-warnings"',
    'testId="backtest-trades"',
    'testId="backtest-logs"',
    'testId="backtest-history"',
  ];
  const regionOffsets = regionMarkers.map((marker) => source.indexOf(marker));

  assert.ok(
    regionOffsets.every((offset) => offset >= 0),
    "every Backtest result region should expose a stable marker",
  );
  assert.deepEqual(regionOffsets, [...regionOffsets].sort((a, b) => a - b));
});

test("narrow Backtest layouts stack panels and preserve the trade ledger", () => {
  assert.match(
    source,
    /testId="backtest-logs"[\s\S]*?gridTemplateColumns:\s*backtestIsNarrow\s*\?\s*"minmax\(0, 1fr\)"/,
  );
  assert.match(
    source,
    /testId="backtest-history"[\s\S]*?gridTemplateColumns:\s*backtestIsNarrow\s*\?\s*"minmax\(0, 1fr\)"/,
  );
  assert.match(
    source,
    /data-testid="backtest-history-run"[\s\S]*?gridTemplateColumns:\s*backtestIsNarrow\s*\?\s*"minmax\(0, 1fr\)"/,
  );
  assert.match(
    source,
    /data-testid="backtest-trades-scroll"[\s\S]*?data-preserve-mobile-layout/,
  );
});

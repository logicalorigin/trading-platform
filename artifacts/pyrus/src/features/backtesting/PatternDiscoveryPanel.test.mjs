import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PatternDiscoveryPanel.tsx", import.meta.url),
  "utf8",
);

test("pattern discovery submits normalized selections and reports invalid input", () => {
  assert.match(
    source,
    /import \{ normalizePatternDiscoveryRunSelection \} from "\.\/patternDiscoveryInputs";/,
  );
  assert.match(source, /const selection = normalizePatternDiscoveryRunSelection\(\{/);
  assert.match(source, /setInputError\("Enter symbols, at least one timeframe, and a valid date range\."\)/);
  assert.match(source, /setBaseTimeframe\(selection\.baseTimeframe\)/);
  assert.match(source, /\.\.\.selection,/);
  assert.doesNotMatch(source, /const parseSymbols\s*=/);
  assert.doesNotMatch(source, /new Date\(`\$\{startsAt\}T00:00:00Z`\)/);
});

test("pattern discovery stops result polling for every terminal status", () => {
  assert.match(
    source,
    /import \{ shouldPollBacktestRun \} from "\.\/backtestPolling";/,
  );
  assert.match(
    source,
    /return shouldPollBacktestRun\(status\) \? 5000 : false;/,
  );
});

test("pattern discovery controls expose names and selected-state semantics", () => {
  for (const label of [
    "Saved pattern study",
    "Base timeframe",
    "Bias filter",
  ]) {
    assert.ok(source.includes(`ariaLabel="${label}"`), label);
  }

  for (const label of [
    "Study name",
    "Symbols",
    "Forward horizons (bars)",
    "Start date",
    "End date",
    "Min sample threshold",
    "Minimum sample filter",
  ]) {
    assert.ok(source.includes(`"aria-label": "${label}"`), label);
  }

  assert.match(source, /aria-label="Compare sweep studies"/);
  assert.match(source, /role="group"/);
  assert.match(source, /aria-labelledby="pattern-timeframe-set-label"/);
  assert.ok(
    (source.match(/aria-pressed=\{active\}/g) ?? []).length >= 2,
    "timeframe and horizon toggle buttons should expose their selected state",
  );
});

test("pattern discovery has no unreachable all-low-sample branch", () => {
  assert.doesNotMatch(source, /\ballLowN\b/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backtestSource = readFileSync(
  new URL("./BacktestingPanels.tsx", import.meta.url),
  "utf8",
);
const discoverySource = readFileSync(
  new URL("./PatternDiscoveryPanel.tsx", import.meta.url),
  "utf8",
);
const overnightSource = readFileSync(
  new URL("./OvernightExpectancyPanel.tsx", import.meta.url),
  "utf8",
);
const diagnosticsSource = readFileSync(
  new URL("../../screens/diagnostics/MachineStateDiagram.jsx", import.meta.url),
  "utf8",
);
const appStyles = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);

test("phone stacking preserves scrollable data matrices and service rows", () => {
  assert.match(backtestSource, /data-preserve-mobile-layout/);
  assert.match(discoverySource, /data-preserve-mobile-layout/);
  assert.match(overnightSource, /data-preserve-mobile-layout/g);
  assert.match(diagnosticsSource, /data-preserve-mobile-layout/);
  assert.match(
    appStyles,
    /\[style\*="grid-template-columns"\]:not\(\[data-preserve-mobile-layout\]\):not\(\[data-preserve-mobile-layout\] \*\)/,
  );
  assert.match(
    appStyles,
    /\[data-testid="backtest-workspace"\]\[data-layout="phone"\] \[style\*="min-width"\]:not\(\.ra-touch-target\):not\(\[data-preserve-mobile-layout\]\):not\(\[data-preserve-mobile-layout\] \*\)/,
  );
});

test("Backtest results, logs, and history collapse without flattening data tables", () => {
  assert.match(
    backtestSource,
    /testId="backtest-logs"[\s\S]*?gridTemplateColumns:\s*backtestIsNarrow\s*\?\s*"minmax\(0, 1fr\)"/,
  );
  assert.match(
    backtestSource,
    /testId="backtest-history"[\s\S]*?gridTemplateColumns:\s*backtestIsNarrow\s*\?\s*"minmax\(0, 1fr\)"/,
  );
  assert.match(
    backtestSource,
    /data-testid="backtest-history-run"[\s\S]*?gridTemplateColumns:\s*backtestIsNarrow\s*\?\s*"minmax\(0, 1fr\)"/,
  );
  assert.match(
    backtestSource,
    /data-testid="backtest-trades-scroll"[\s\S]*?data-preserve-mobile-layout/,
  );
});

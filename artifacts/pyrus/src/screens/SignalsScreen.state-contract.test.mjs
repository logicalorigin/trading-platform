import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () => readFileSync(new URL("./SignalsScreen.jsx", import.meta.url), "utf8");

test("Signals scope resets hydration + selection on environment/universe change", () => {
  const screenSource = source();
  // Scope key is composite (environment + authoritative universe), not env-only,
  // so a universe change also resets stale matrix/event symbols + hydration.
  assert.match(screenSource, /buildSignalsSourceScopeKey\(/);
  // Selection is cleared on scope reset so it can't survive a source/universe switch.
  assert.match(screenSource, /if \(reset\) \{\s*setSelectedSymbol\(""\);/);
});

test("Signals rows are bounded to the authoritative universe", () => {
  assert.match(source(), /boundSignalsRowsToUniverse\(/);
});

test("Signals overview metrics follow the filtered table when filters are active", () => {
  const screenSource = source();
  assert.match(screenSource, /signalsFiltersActive\(/);
  assert.match(screenSource, /summarizeSignalsRows\(overviewMetricRows\)/);
});

test("Signals overview metrics do not spread a key prop into JSX", () => {
  const screenSource = source();
  // key must be destructured out before the spread (avoids the React warning
  // about a key prop being spread into JSX).
  assert.doesNotMatch(screenSource, /key=\{metric\.key\} \{\.\.\.metric\}/);
  assert.match(screenSource, /metrics\.map\(\(\{ key, \.\.\.metricProps \}\)/);
});

test("Signals selection never resolves to a filtered-out (hidden) row", () => {
  const screenSource = source();
  // The selectedRow fallback to the UNFILTERED rows list (which let a hidden
  // symbol stay selected) must be gone.
  assert.doesNotMatch(
    screenSource,
    /selectedSymbol\) \|\|\s*\n\s*rows\.find\(\(row\) => row\.symbol === selectedSymbol\)/,
  );
  // The auto-select effect re-picks when the selection is hidden, not only empty.
  assert.match(screenSource, /const selectionVisible =/);
});

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
  assert.match(screenSource, /const displaySummary = useMemo\(\(\) => \{/);
  assert.match(screenSource, /signalMatrixUniverse\?\.resolvedSymbols/);
  assert.match(screenSource, /summary=\{displaySummary\}/);
  // The !stateResponseReady guard must remain so a slow state read alone can't
  // mask the matrix (stateResponseReady is true once signalMatrixStates arrive).
  assert.match(screenSource, /!stateResponseReady && effectiveStateLoading/);
  assert.doesNotMatch(
    screenSource,
    /const loading = effectiveStateLoading \|\| \(!profile && effectiveProfileLoading\);/,
  );
});

test("Signals platform-managed refresh does not manually refetch state snapshots", () => {
  const screenSource = source();

  assert.match(screenSource, /const refreshTasks = \[/);
  assert.match(
    screenSource,
    /if \(!platformManagedSignalData\) \{\s*refreshTasks\.push\(\s*profileQuery\.refetch\(\),\s*stateQuery\.refetch\(\),\s*\);\s*\}/s,
  );
  assert.doesNotMatch(
    screenSource,
    /Promise\.allSettled\(\[\s*breadthHistoryQuery\.refetch\(\),\s*profileQuery\.refetch\(\),\s*stateQuery\.refetch\(\),/s,
  );
  assert.doesNotMatch(screenSource, /\/api\/signal-monitor\/state/);
});

test("Signals matrix cells do not surface aged rows as stale issue tooltips", () => {
  const screenSource = source();

  assert.match(screenSource, /const issueStatus =/);
  assert.match(
    screenSource,
    /row\.status === SIGNALS_ROW_STATUS\.problem[\s\S]*: null;/,
  );
  assert.doesNotMatch(
    screenSource,
    /row\.status === SIGNALS_ROW_STATUS\.activeStale\s*\?\s*"stale"/,
  );
  assert.doesNotMatch(
    screenSource,
    /normalizeSignalStatus\(state\) === "stale"\s*\?\s*"stale"/,
  );
});

test("Signals table sparklines use runtime snapshots instead of DB-backed bars batch", () => {
  const screenSource = source();

  assert.match(screenSource, /useRuntimeTickerSnapshots/);
  assert.match(screenSource, /runtime-ticker-stream/);
  assert.doesNotMatch(screenSource, /fetchSignalSparklineBarsBatch/);
  assert.doesNotMatch(screenSource, /signals-table-sparkline/);
  assert.doesNotMatch(screenSource, /\/api\/bars\/batch/);
  assert.doesNotMatch(screenSource, /SIGNAL_SPARKLINE_PENDING/);
  assert.doesNotMatch(screenSource, /SIGNAL_SPARKLINE_FAILED/);
});

test("Signals interval sparklines hold the muted pending stroke until the cell hydrates", () => {
  // Launch regression: bars can render before the cell's matrix state
  // hydrates; with no signal direction the sparkline fell through to
  // MicroSparkline's financial green/red default (old green style). The cell
  // must gate the fallback color on its own hydration state.
  const screenSource = source();
  assert.match(screenSource, /resolveSignalSparklineFallbackColor\(\{/);
  assert.match(screenSource, /signalStateHydrated: hydrated,/);
  assert.match(
    screenSource,
    /: sparklineSignalColor \|\| hydrated\s*\?\s*"fallback"\s*:\s*"pending"/,
  );
});

test("Signals age column labels trend age and marks signal-bars fallback", () => {
  const screenSource = source();

  assert.match(screenSource, /header: "Trend age"/);
  assert.match(screenSource, /displayAgeSource === "signal-bars"/);
  assert.match(screenSource, /Signal bars fallback/);
  assert.match(screenSource, /\$\{bars\}b\$\{fromSignalBars \? " sig" : ""\}/);
});

test("Signals screen surfaces scope truncation from existing matrix metadata", () => {
  const screenSource = source();

  assert.match(screenSource, /signalMatrixUniverse\?\.resolvedSymbols/);
  assert.match(screenSource, /signalMatrixCoverage\?\.activeScopeSymbols/);
  assert.match(screenSource, /symbols in scope/);
  assert.match(screenSource, /\{scopeCoverageLabel\}/);
});

test("Signals fallback REST queries keep stale data and retry 429 pressure sheds", () => {
  const screenSource = source();
  const queryNames = [
    "profileQuery",
    "stateQuery",
    "eventsQuery",
    "breadthHistoryQuery",
  ];

  queryNames.forEach((name) => {
    const index = screenSource.indexOf(`const ${name} =`);
    assert.notEqual(index, -1, `${name} missing`);
    const block = screenSource.slice(index, index + 700);
    assert.match(block, /retry:\s*retryUnlessTimeout\(2\)/, `${name} retries`);
    assert.match(block, /retryDelay:\s*QUERY_DEFAULTS\.retryDelay/, `${name} uses shared retry delay`);
    assert.match(block, /placeholderData:\s*\(previousData\) => previousData/, `${name} keeps stale data`);
  });
});

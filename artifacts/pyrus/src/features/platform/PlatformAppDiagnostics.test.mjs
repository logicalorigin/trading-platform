import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const assertNoConsecutiveDuplicateLine = (source, line) => {
  const escapedLine = line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const duplicatePattern = new RegExp(
    `^([ \\t]*)${escapedLine}\\n\\1${escapedLine}$`,
    "m",
  );

  assert.equal(
    duplicatePattern.test(source),
    false,
    `Expected no consecutive duplicate line: ${line}`,
  );
};

test("platform diagnostics and root preference effects avoid duplicate no-op writes", () => {
  const platformSource = readLocalSource("./PlatformApp.jsx");
  const appContentSource = readLocalSource("../../app/AppContent.tsx");
  const crashDiagnosticsSource = readLocalSource("../../app/crashDiagnostics.tsx");
  const platformErrorBoundarySource = readLocalSource(
    "../../components/platform/PlatformErrorBoundary.tsx",
  );
  const diagnosticsSource = readLocalSource("../../screens/DiagnosticsScreen.jsx");
  const memoryPressurePreferencesSource = readLocalSource(
    "./memoryPressurePreferences.js",
  );
  const memoryPressureSource = readLocalSource("./useMemoryPressureSignal.js");
  const settingsSource = readLocalSource("../../screens/SettingsScreen.jsx");
  const chartTimeframeFavoritesSource = readLocalSource(
    "../charting/useChartTimeframeFavorites.js",
  );
  const accountSectionSource = readLocalSource("./useAccountSection.js");
  const diagnosticThresholdSettingsSource = readLocalSource(
    "../../screens/settings/DiagnosticThresholdSettingsPanel.jsx",
  );
  const localAlertsSource = readLocalSource("../../screens/diagnostics/localAlerts.js");
  const optionHydrationDiagnosticsSource = readLocalSource(
    "./optionHydrationDiagnostics.ts",
  );
  const bloombergLiveDockSource = readLocalSource("./BloombergLiveDock.jsx");
  const gexZeroGammaSource = readLocalSource("../gex/useGexZeroGamma.js");
  const tradingAnalysisSource = readLocalSource(
    "../../screens/account/TradingAnalysisWorkbench.jsx",
  );

  [
    "window.__PYRUS_PERF_WARMUP_OVERRIDES__ ||",
    "window.__PYRUS_PERF_WARMUP_SNAPSHOT__ = snapshot;",
    "window.__PYRUS_MEMORY_DIAGNOSTICS__ = getMemoryDiagnostics;",
    "delete window.__PYRUS_PERF_WARMUP_SNAPSHOT__;",
    "const startupRefreshEnabled = shouldRunStartupRefresh({",
    "document.documentElement.dataset.pyrusTheme = normalizedTheme;",
    "root.dataset.pyrusAccentPreset = normalizedAccentPreset;",
    "root.dataset.pyrusDensity = normalizedDensity;",
    "root.dataset.pyrusReducedMotion = normalizedReducedMotion;",
  ].forEach((line) => assertNoConsecutiveDuplicateLine(platformSource, line));

  assertNoConsecutiveDuplicateLine(
    memoryPressureSource,
    "window.__PYRUS_MEMORY_DIAGNOSTICS__?.() ||",
  );
  assert.equal(
    /window\.localStorage\.getItem\(PYRUS_STORAGE_KEY\)\s*\?\?\s*window\.localStorage\.getItem\(PYRUS_STORAGE_KEY\)/.test(
      tradingAnalysisSource,
    ),
    false,
    "Expected account trading analysis preferences to read localStorage once per path",
  );
  assert.doesNotMatch(
    crashDiagnosticsSource,
    /window\.localStorage\?\.getItem\(PYRUS_STORAGE_KEY\)\s*\?\?\s*window\.localStorage\?\.getItem\(PYRUS_STORAGE_KEY\)/,
    "Expected crash diagnostics to read workspace state once per path",
  );
  assert.match(
    crashDiagnosticsSource,
    /const raw = window\.localStorage\?\.getItem\(PYRUS_STORAGE_KEY\);/,
    "Expected crash diagnostics to read the current workspace storage key directly",
  );
  assert.match(
    crashDiagnosticsSource,
    /import \{ PYRUS_STORAGE_KEY \} from "\.\.\/lib\/workspaceStorage";/,
    "Expected crash diagnostics to reuse the shared workspace storage key",
  );
  assert.doesNotMatch(
    crashDiagnosticsSource,
    /const PYRUS_STORAGE_KEY = "pyrus:state:v1";/,
    "Expected crash diagnostics not to duplicate the workspace storage key literal",
  );
  assert.doesNotMatch(
    crashDiagnosticsSource,
    /readPyrusWorkspaceState/,
    "Expected crash diagnostics to preserve direct current-key read behavior",
  );
  for (const [source, label] of [
    [appContentSource, "app content"],
    [crashDiagnosticsSource, "crash diagnostics"],
    [platformErrorBoundarySource, "platform error boundary"],
  ]) {
    assert.doesNotMatch(
      source,
      /"warning"\s*\|\s*"warning"/,
      `Expected ${label} severity types to avoid duplicate warning union branches`,
    );
  }
  assertNoConsecutiveDuplicateLine(
    settingsSource,
    'document.documentElement.setAttribute("data-pyrus-accent-preset", value);',
  );
  assert.doesNotMatch(
    settingsSource,
    /window\.localStorage\.getItem\(PYRUS_STORAGE_KEY\)\s*\?\?\s*window\.localStorage\.getItem\(PYRUS_STORAGE_KEY\)/,
    "Expected workspace settings to read localStorage once per path",
  );
  assert.match(
    settingsSource,
    /const raw = window\.localStorage\.getItem\(PYRUS_STORAGE_KEY\);/,
    "Expected workspace settings to read the current storage key directly",
  );
  for (const [source, label] of [
    [settingsSource, "settings workspace state"],
    [chartTimeframeFavoritesSource, "chart timeframe favorites"],
    [accountSectionSource, "account section"],
  ]) {
    assert.doesNotMatch(
      source,
      /for \(const eventName of \[\s*PYRUS_WORKSPACE_SETTINGS_EVENT,\s*\]\)/,
      `Expected ${label} to dispatch the workspace settings event directly`,
    );
  }
  assert.doesNotMatch(
    settingsSource,
    /LEGACY_MARKET_GRID_TRACK_SESSION_KEY/,
    "Expected market grid sizing reset to remove the current session key once",
  );
  assert.doesNotMatch(
    settingsSource,
    /LEGACY_CHART_SCALE_PREFS_STORAGE_PREFIX/,
    "Expected chart scale cleanup to use the current storage prefix once",
  );
  assert.doesNotMatch(
    settingsSource,
    /LEGACY_OPTION_HYDRATION_HISTORY_STORAGE_KEY/,
    "Expected option hydration cleanup to use the current storage key once",
  );
  for (const source of [settingsSource, diagnosticsSource]) {
    assert.doesNotMatch(
      source,
      /LEGACY_DIAGNOSTIC_ALERT_PREF_EVENT/,
      "Expected diagnostic alert preference events to use the current event name once",
    );
    assert.doesNotMatch(
      source,
      /"pyrus:diagnostic-alert-preferences-updated"/,
      "Expected diagnostic alert preference event literals to live with local alert helpers",
    );
    assert.match(
      source,
      /LOCAL_ALERT_PREFERENCES_EVENT/,
      "Expected diagnostic alert preference event consumers to share the local alert event constant",
    );
  }
  assert.match(
    localAlertsSource,
    /export const LOCAL_ALERT_PREFERENCES_EVENT =\s*\n\s*"pyrus:diagnostic-alert-preferences-updated";/,
    "Expected local alert helpers to own the diagnostic alert preference event name",
  );
  assert.doesNotMatch(
    memoryPressurePreferencesSource,
    /LEGACY_(?:STORAGE_KEY|EVENT_NAME)/,
    "Expected memory pressure preferences to use current storage and event names once",
  );
  assert.match(
    memoryPressurePreferencesSource,
    /const raw = window\.localStorage\.getItem\(STORAGE_KEY\);/,
    "Expected memory pressure preferences to read the current storage key directly",
  );
  assert.doesNotMatch(
    optionHydrationDiagnosticsSource,
    /LEGACY_OPTION_HYDRATION_DIAGNOSTICS_STORAGE_KEY/,
    "Expected option hydration diagnostics to use the current storage key once",
  );
  assert.match(
    optionHydrationDiagnosticsSource,
    /const raw = window\.localStorage\.getItem\(STORAGE_KEY\);/,
    "Expected option hydration diagnostics to read the current storage key directly",
  );
  assert.doesNotMatch(
    localAlertsSource,
    /LEGACY_LOCAL_ALERT_STORAGE_KEY/,
    "Expected local alert preferences to use the current storage key once",
  );
  assert.match(
    localAlertsSource,
    /const raw = target\.getItem\(LOCAL_ALERT_STORAGE_KEY\);/,
    "Expected local alert preferences to read the current storage key directly",
  );
  assert.doesNotMatch(
    diagnosticThresholdSettingsSource,
    /LEGACY_THRESHOLD_EVENT/,
    "Expected diagnostic threshold settings to use the current event name once",
  );
  assert.equal(
    diagnosticThresholdSettingsSource.match(/new CustomEvent\(THRESHOLD_EVENT/g)?.length,
    1,
    "Expected diagnostic threshold settings to dispatch one threshold update event",
  );
  assert.equal(
    diagnosticThresholdSettingsSource.match(/addEventListener\(THRESHOLD_EVENT/g)?.length,
    1,
    "Expected diagnostic threshold settings to register one threshold update listener",
  );
  assert.equal(
    memoryPressurePreferencesSource.match(/window\.dispatchEvent\(new CustomEvent\(EVENT_NAME/g)?.length,
    1,
    "Expected memory pressure preferences to dispatch one preference update event",
  );
  assert.doesNotMatch(
    bloombergLiveDockSource,
    /LEGACY_BLOOMBERG_(?:LAST_GOOD_SOURCE_STORAGE_KEY|DIAGNOSTICS_GLOBAL)/,
    "Expected Bloomberg dock to use current storage and diagnostics names once",
  );
  assert.equal(
    bloombergLiveDockSource.match(
      /window\.localStorage\.getItem\(\s*BLOOMBERG_LAST_GOOD_SOURCE_STORAGE_KEY,\s*\)/g,
    )?.length,
    1,
    "Expected Bloomberg dock to read the current source cache key directly",
  );
  assert.equal(
    bloombergLiveDockSource.match(
      /window\[BLOOMBERG_DIAGNOSTICS_GLOBAL\] = getDiagnostics/g,
    )?.length,
    1,
    "Expected Bloomberg dock to publish one diagnostics global",
  );
  assert.match(
    settingsSource,
    /storage\.clearSessionKeys\(\[MARKET_GRID_TRACK_SESSION_KEY\]\)/,
    "Expected market grid sizing reset to clear the current session key directly",
  );
  assert.match(
    settingsSource,
    /key\) => key\.startsWith\(CHART_SCALE_PREFS_STORAGE_PREFIX\)/,
    "Expected chart scale cleanup to match the current storage prefix directly",
  );
  assert.match(
    settingsSource,
    /key\) => key === OPTION_HYDRATION_HISTORY_STORAGE_KEY/,
    "Expected option hydration cleanup to match the current storage key directly",
  );
  assert.equal(
    gexZeroGammaSource.match(/"data-pyrus-theme"/g)?.length,
    1,
    "Expected GEX observer to watch data-pyrus-theme once",
  );
  assert.equal(
    gexZeroGammaSource.match(/"data-pyrus-color-mode"/g)?.length,
    1,
    "Expected GEX observer to watch data-pyrus-color-mode once",
  );

  assert.equal(
    /if \(window\.__PYRUS_MEMORY_DIAGNOSTICS__ === getMemoryDiagnostics\) \{\n\s*delete window\.__PYRUS_MEMORY_DIAGNOSTICS__;\n\s*\}\n\s*if \(window\.__PYRUS_MEMORY_DIAGNOSTICS__ === getMemoryDiagnostics\)/.test(
      platformSource,
    ),
    false,
    "Expected memory diagnostics cleanup to run once",
  );
  assert.match(
    platformSource,
    /startupRefreshQueuedRef\.current \|\|\s*!startupRefreshEnabled \|\|/,
    "Expected warm-start policy to gate the broad startup invalidation fanout",
  );
});

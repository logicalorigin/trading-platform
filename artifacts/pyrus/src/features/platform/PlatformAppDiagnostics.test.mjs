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
  const memoryPressureSource = readLocalSource("./useMemoryPressureSignal.js");
  const settingsSource = readLocalSource("../../screens/SettingsScreen.jsx");
  const gexZeroGammaSource = readLocalSource("../gex/useGexZeroGamma.js");
  const tradingAnalysisSource = readLocalSource(
    "../../screens/account/TradingAnalysisWorkbench.jsx",
  );

  [
    "window.__PYRUS_PERF_WARMUP_OVERRIDES__ ||",
    "window.__PYRUS_PERF_WARMUP_SNAPSHOT__ = snapshot;",
    "window.__PYRUS_MEMORY_DIAGNOSTICS__ = getMemoryDiagnostics;",
    "delete window.__PYRUS_PERF_WARMUP_SNAPSHOT__;",
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
  assertNoConsecutiveDuplicateLine(
    settingsSource,
    'document.documentElement.setAttribute("data-pyrus-accent-preset", value);',
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
});

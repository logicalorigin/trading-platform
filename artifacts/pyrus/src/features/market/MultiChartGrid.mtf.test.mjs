import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Source-contract guard: the Markets MTF View toggle must stay wired in the
// same control row as Sync TF / Sync X, driven by the selected ticker + the
// MTF timeframe ladder, and must NOT corrupt the persisted multi-symbol layout.
const source = readFileSync(
  new URL("./MultiChartGrid.jsx", import.meta.url),
  "utf8",
);

test("MTF View control is present beside Sync TF / Sync X", () => {
  assert.match(source, /data-testid="market-chart-mtf-view"/);
  assert.match(source, />\s*MTF VIEW\s*</);
  assert.match(source, /onClick=\{toggleMtfView\}/);
});

test("MTF View is wired to the selected ticker + MTF timeframe ladder", () => {
  assert.match(source, /buildMtfTimeframeSequence\(/);
  assert.match(source, /available: MARKET_CHART_TIMEFRAMES/);
  assert.match(source, /normalizeTickerSymbol\(activeSym\)/);
});

test("MTF View is ephemeral: persists the snapshot, never the transient MTF slots", () => {
  assert.match(
    source,
    /mtfView && mtfRestoreRef\.current\s*\?\s*mtfRestoreRef\.current\.slots\s*:\s*slots/,
  );
});

test("Sync TF is disabled while MTF View owns the per-chart timeframes", () => {
  assert.match(source, /disabled=\{mtfView\}/);
});

test("MTF View is loop-safe (regression for the Maximum-update-depth crash)", () => {
  // The MTF effect must depend on a value-stable favorites KEY, never the raw
  // favorites array — the array churns identity on every PYRUS_WORKSPACE_SETTINGS_EVENT
  // that persistState fires, which would retrigger the effect and loop.
  assert.match(source, /const mtfFavoritesKey = mtfFavoriteTimeframes\.join\(","\)/);
  assert.match(source, /\}, \[mtfView, activeSym, mtfFavoritesKey\]\)/);
  assert.doesNotMatch(
    source,
    /\}, \[mtfView, activeSym, mtfFavoriteTimeframes\]\)/,
  );
  // setSlots must be a no-op (return `current`) when slots already match, so a
  // re-fire cannot keep producing new arrays and re-firing the persist effect.
  assert.match(source, /if \(slot\.ticker === ticker && slot\.tf === tf\)/);
  assert.match(source, /return changed \? next : current/);
});

test("MTF View preserves the user's real Sync TF setting across persist (seq134)", () => {
  assert.match(
    source,
    /marketGridSyncTimeframes:\s*mtfView && mtfRestoreRef\.current\s*\?\s*mtfRestoreRef\.current\.syncTimeframes\s*:\s*syncTimeframes/,
  );
});

test("MTF View hydrates every visible timeframe slot instead of only chart 1", () => {
  assert.match(source, /const visibleChartHydrationKey = visibleSlotEntries/);
  assert.match(source, /normalizeChartTimeframe\(entry\.slot\?\.tf\)/);
  assert.match(
    source,
    /mtfView \|\| layout === "1x1"\s*\?\s*visibleSlotEntries\.length\s*:\s*MARKET_CHART_INITIAL_HYDRATION_SLOTS/,
  );
  assert.match(
    source,
    /const chartReadySignalKey = `\$\{visibleChartHydrationKey\}:\$\{initialHydrationSlotLimit\}`;/,
  );
  assert.match(
    source,
    /\}, \[initialHydrationSlotLimit, visibleChartHydrationKey\]\)/,
  );
});

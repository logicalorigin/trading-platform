import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_DEFAULT_TIME_ZONE,
  DEFAULT_USER_PREFERENCES,
  MAX_CHART_FUTURE_EXPANSION_BARS,
  USER_PREFERENCES_STORAGE_KEY,
  formatPreferenceDateTime,
  normalizeUserPreferences,
  resolvePreferenceTimeZone,
  writeCachedUserPreferences,
} from "./userPreferenceModel";
import { resolveEffectiveThemeFromState } from "../../lib/uiTokens.jsx";

test("date formatting tolerates partial preference snapshots", () => {
  const preferences = {
    appearance: {
      theme: "dark",
    },
  };

  assert.equal(
    resolvePreferenceTimeZone(preferences as never),
    APP_DEFAULT_TIME_ZONE,
  );
  assert.notEqual(
    formatPreferenceDateTime("2026-05-01T15:30:00.000Z", {
      preferences: preferences as never,
      includeDate: false,
      fallback: "fallback",
    }),
    "fallback",
  );
});

test("chart future expansion defaults to no future axis and clamps stale values", () => {
  assert.equal(DEFAULT_USER_PREFERENCES.chart.futureExpansionBars, 0);

  assert.equal(
    normalizeUserPreferences({ chart: { futureExpansionBars: 200 } }).chart
      .futureExpansionBars,
    MAX_CHART_FUTURE_EXPANSION_BARS,
  );

  assert.equal(
    normalizeUserPreferences({ chart: { futureExpansionBars: -2 } }).chart
      .futureExpansionBars,
    0,
  );
});

test("chart flow events display defaults on and normalizes cached values", () => {
  assert.equal(DEFAULT_USER_PREFERENCES.chart.showFlowEvents, true);
  assert.equal(
    normalizeUserPreferences({ chart: { showFlowEvents: false } }).chart
      .showFlowEvents,
    false,
  );
  assert.equal(
    normalizeUserPreferences({ chart: { showFlowEvents: "nope" } }).chart
      .showFlowEvents,
    true,
  );
});

test("startup theme prefers cached appearance preferences over legacy top-level theme", () => {
  assert.equal(
    resolveEffectiveThemeFromState({
      theme: "dark",
      userPreferences: {
        appearance: {
          theme: "light",
        },
      },
    }),
    "light",
  );

  assert.equal(
    resolveEffectiveThemeFromState({
      theme: "light",
      userPreferences: {
        appearance: {
          theme: "dark",
        },
      },
    }),
    "dark",
  );
});

test("startup theme falls back to system when no cached preference exists", () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: light)",
    }),
  };

  try {
    assert.equal(DEFAULT_USER_PREFERENCES.appearance.theme, "system");
    assert.equal(resolveEffectiveThemeFromState({}), "light");
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});

test("preference cache does not overwrite active workspace routing state", () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const storage = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    dispatchEvent: () => true,
  };

  try {
    storage.set(
      USER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        screen: "trade",
        sym: "AAPL",
        marketGridLayout: "2x3",
      }),
    );

    writeCachedUserPreferences({
      ...DEFAULT_USER_PREFERENCES,
      workspace: {
        ...DEFAULT_USER_PREFERENCES.workspace,
        defaultScreen: "market",
        defaultSymbol: "SPY",
        marketGridLayout: "1x1",
      },
    });

    const next = JSON.parse(storage.get(USER_PREFERENCES_STORAGE_KEY) || "{}");
    assert.equal(next.screen, "trade");
    assert.equal(next.sym, "AAPL");
    assert.equal(next.marketGridLayout, "2x3");
    assert.equal(next.userPreferences.workspace.defaultScreen, "market");
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }
});

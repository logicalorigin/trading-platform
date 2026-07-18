import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildUserPreferencesResetValue,
  DEFAULT_USER_PREFERENCES,
  getCachedPreferenceDateTimeFormatter,
  normalizeUserPreferences,
  writeCachedUserPreferences,
} from "./userPreferenceModel.ts";
import {
  createDefaultOnboardingProgress,
  reduceOnboardingProgress,
} from "../onboarding/onboardingModel.ts";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("preference date-time formatter cache reuses equivalent option signatures", () => {
  const first = getCachedPreferenceDateTimeFormatter({
    timeZone: "America/Denver",
    month: "2-digit",
    day: "2-digit",
  });
  const second = getCachedPreferenceDateTimeFormatter({
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Denver",
  });

  assert.equal(first, second);
});

test("preference model reuses shared workspace state storage migration", () => {
  const preferenceSource = readLocalSource("./userPreferenceModel.ts");
  const workspaceStorageSource = readLocalSource("../../lib/workspaceStorage.ts");

  assert.match(
    preferenceSource,
    /readPyrusWorkspaceState/,
    "Expected preference model to read workspace state through the shared storage helper",
  );
  assert.doesNotMatch(
    preferenceSource,
    /RETIRED_WORKSPACE_STORAGE_KEY/,
    "Expected retired workspace key migration to live in one shared helper",
  );
  assert.match(
    preferenceSource,
    /export const USER_PREFERENCES_STORAGE_KEY = PYRUS_STORAGE_KEY;/,
    "Expected preference storage key export to alias the shared workspace storage key",
  );
  assert.doesNotMatch(
    preferenceSource,
    /export\s*\{\s*PYRUS_WORKSPACE_SETTINGS_EVENT\s*\}/,
    "Expected workspace settings event ownership to stay in workspaceStorage",
  );
  assert.match(
    workspaceStorageSource,
    /const RETIRED_WORKSPACE_STORAGE_KEY = \["ray", "algo:state:v1"\]\.join\(""\);/,
    "Expected workspace storage helper to retain the retired Ray workspace migration key",
  );
});

test("preference normalization retains bounded onboarding progress", () => {
  const onboarding = reduceOnboardingProgress(
    createDefaultOnboardingProgress(),
    { type: "mark-auto-open-shown" },
  );

  const normalized = normalizeUserPreferences({ onboarding });

  assert.equal(normalized.onboarding.autoOpenShownVersion, 1);
  assert.equal(normalized.onboarding.activeTrackId, null);
  assert.equal(normalized.onboarding.tracks["connect-account"].status, "paused");
});

test("generic preference reset preserves onboarding progress", () => {
  const onboarding = reduceOnboardingProgress(
    createDefaultOnboardingProgress(),
    { type: "mark-auto-open-shown" },
  );
  const reset = buildUserPreferencesResetValue({
    ...DEFAULT_USER_PREFERENCES,
    onboarding,
    appearance: {
      ...DEFAULT_USER_PREFERENCES.appearance,
      theme: "light",
    },
  });

  assert.equal(reset.appearance.theme, DEFAULT_USER_PREFERENCES.appearance.theme);
  assert.equal(reset.onboarding.autoOpenShownVersion, 1);
});

test("shared workspace cache never stores onboarding progress", () => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent ??= class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    dispatchEvent: () => true,
  };

  try {
    const onboarding = reduceOnboardingProgress(
      createDefaultOnboardingProgress(),
      { type: "mark-auto-open-shown" },
    );
    writeCachedUserPreferences({
      ...DEFAULT_USER_PREFERENCES,
      onboarding,
    });
    const cached = JSON.parse(stored.values().next().value);
    assert.equal(cached.userPreferences.onboarding, undefined);
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_USER_PREFERENCES,
  normalizeUserPreferences,
} from "./user-preferences-model";

test("server preference model defaults and preserves onboarding progress", () => {
  assert.equal(
    DEFAULT_USER_PREFERENCES.onboarding.autoOpenShownVersion,
    0,
  );

  const normalized = normalizeUserPreferences(
    {
      onboarding: {
        autoOpenShownVersion: 1,
      },
    },
    { strict: true },
  );
  assert.equal(normalized.onboarding.autoOpenShownVersion, 1);
  assert.equal(
    normalized.onboarding.tracks["connect-account"]?.status,
    "paused",
  );
});

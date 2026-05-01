import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_DEFAULT_TIME_ZONE,
  formatPreferenceDateTime,
  resolvePreferenceTimeZone,
} from "./userPreferenceModel";

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

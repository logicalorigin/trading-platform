import assert from "node:assert/strict";
import test from "node:test";

import { normalizeUserPreferences } from "./user-preferences-model";

const assertInvalidPreference = (value: unknown) => {
  assert.throws(
    () => normalizeUserPreferences(value, { strict: true }),
    (error: unknown) => {
      const httpError = error as { statusCode?: number; code?: string };
      return (
        httpError.statusCode === 400 &&
        httpError.code === "invalid_user_preference"
      );
    },
  );
};

test("strict numeric preferences require actual finite JSON numbers", () => {
  for (const value of [null, "", "70", true, Number.POSITIVE_INFINITY]) {
    assertInvalidPreference({
      notifications: { alertVolume: value },
    });
  }

  assert.equal(
    normalizeUserPreferences(
      { notifications: { alertVolume: 0 } },
      { strict: true },
    ).notifications.alertVolume,
    0,
  );
});

test("strict preference sections must be objects", () => {
  for (const value of [null, "dark", [], false]) {
    assertInvalidPreference({ appearance: value });
  }
});

test("strict quiet hours require a real 24-hour clock time", () => {
  for (const value of ["24:00", "12:60", "99:99", "1:00"]) {
    assertInvalidPreference({
      notifications: { quietHoursStart: value },
    });
  }

  const preferences = normalizeUserPreferences(
    {
      notifications: {
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
      },
    },
    { strict: true },
  );
  assert.equal(preferences.notifications.quietHoursStart, "00:00");
  assert.equal(preferences.notifications.quietHoursEnd, "23:59");
});

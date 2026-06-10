import assert from "node:assert/strict";
import test from "node:test";

import {
  getCachedPreferenceDateTimeFormatter,
} from "./userPreferenceModel.ts";

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

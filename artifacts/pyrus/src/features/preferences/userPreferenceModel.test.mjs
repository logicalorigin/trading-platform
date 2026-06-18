import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getCachedPreferenceDateTimeFormatter,
} from "./userPreferenceModel.ts";

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
  assert.match(
    workspaceStorageSource,
    /const RETIRED_WORKSPACE_STORAGE_KEY = \["ray", "algo:state:v1"\]\.join\(""\);/,
    "Expected workspace storage helper to retain the retired Ray workspace migration key",
  );
});

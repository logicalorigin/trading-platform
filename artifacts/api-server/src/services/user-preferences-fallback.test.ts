import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveUserPreferencesFallbackFile } from "./user-preferences";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

test("default fallback paths remain isolated by user ID", () => {
  const a = resolveUserPreferencesFallbackFile(USER_A, undefined);
  const b = resolveUserPreferencesFallbackFile(USER_B, undefined);

  assert.notEqual(a, b);
  assert.match(a, /user-preferences-11111111-1111-4111-8111-111111111111\.json$/);
});

test("configured fallback path resolves to deterministic hashed siblings", () => {
  const a = resolveUserPreferencesFallbackFile(
    USER_A,
    "/tmp/preferences.json",
  );
  const repeat = resolveUserPreferencesFallbackFile(
    USER_A,
    "/tmp/preferences.json",
  );
  const b = resolveUserPreferencesFallbackFile(
    USER_B,
    "/tmp/preferences.json",
  );

  assert.equal(a, repeat);
  assert.notEqual(a, b);
  assert.match(a, /^\/tmp\/preferences\.[a-f0-9]{64}\.json$/);
  assert.doesNotMatch(a, /11111111/);
});

test("fallback path rejects invalid or traversal-shaped user IDs", () => {
  assert.throws(
    () =>
      resolveUserPreferencesFallbackFile(
        "../../other-user",
        "/tmp/preferences.json",
      ),
    /Invalid app user ID/,
  );
});

test("fallback writer enforces mode 0600 and ignores an unkeyed legacy file", () => {
  const source = readFileSync(
    new URL("./user-preferences.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /chmodSync\(file, 0o600\)/);
  assert.match(source, /Ignoring legacy unkeyed preference fallback/);
  assert.doesNotMatch(
    source,
    /process\.env\["PYRUS_USER_PREFERENCES_FILE"\]\s*\|\|/,
  );
});

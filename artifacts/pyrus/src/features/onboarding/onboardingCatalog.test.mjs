import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ONBOARDING_CATALOG,
  ONBOARDING_CATALOG_VERSION,
} from "./onboardingCatalog.ts";

test("catalog is a fixed data-only five-track program with Connect first", () => {
  assert.equal(ONBOARDING_CATALOG_VERSION, 1);
  assert.deepEqual(
    ONBOARDING_CATALOG.tracks.map((track) => track.id),
    [
      "safety",
      "connect-account",
      "read-signal",
      "practice-review",
      "manage-risk",
    ],
  );
  assert.equal(ONBOARDING_CATALOG.tracks[0].required, true);
  assert.deepEqual(
    ONBOARDING_CATALOG.tracks[1].steps.map((step) => step.id),
    ["open-settings", "choose-provider", "verify-readiness"],
  );
  assert.equal(
    ONBOARDING_CATALOG.tracks[1].steps[2].completionKey,
    "account.connection-verified",
  );
  assert.match(ONBOARDING_CATALOG.tracks[1].steps[2].title, /connection/i);
  assert.doesNotMatch(
    ONBOARDING_CATALOG.tracks[1].steps[2].body,
    /execution-ready/i,
  );
});

test("catalog contains no callbacks, requests, or mutation ownership", () => {
  const source = readFileSync(
    new URL("./onboardingCatalog.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|sendBeacon|useMutation)\b/);
  assert.doesNotMatch(source, /\b(onClick|handler|callback)\s*:/);
  assert.match(source, /screenId: "settings"/);
});

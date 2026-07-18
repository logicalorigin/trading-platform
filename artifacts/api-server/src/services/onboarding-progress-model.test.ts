import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultOnboardingProgressPreference,
  normalizeOnboardingProgressPreference,
} from "./onboarding-progress-model";

test("server onboarding normalizer accepts bounded canonical progress", () => {
  const progress = createDefaultOnboardingProgressPreference();
  progress.autoOpenShownVersion = 1;
  progress.tracks["connect-account"]!.completedStepIds = ["open-settings"];

  const normalized = normalizeOnboardingProgressPreference(progress, {
    strict: true,
  });

  assert.equal(normalized.autoOpenShownVersion, 1);
  assert.deepEqual(normalized.tracks["connect-account"]!.completedStepIds, [
    "open-settings",
  ]);
});

test("server onboarding normalizer strips unknown fields and track IDs", () => {
  const normalized = normalizeOnboardingProgressPreference({
    unknown: "drop-me",
    tracks: {
      unknown: { status: "active" },
      "connect-account": {
        status: "paused",
        unknown: "drop-me",
      },
    },
  });

  assert.equal("unknown" in normalized, false);
  assert.equal("unknown" in normalized.tracks, false);
  assert.equal(
    "unknown" in normalized.tracks["connect-account"]!,
    false,
  );
});

test("strict server validation rejects malformed or oversized progress", () => {
  let malformed;
  try {
    normalizeOnboardingProgressPreference(
      { autoOpenShownVersion: "1" },
      { strict: true },
    );
  } catch (error) {
    malformed = error;
  }
  assert.ok(malformed);
  assert.match(
    String((malformed as { detail?: unknown }).detail),
    /onboarding\.autoOpenShownVersion/,
  );

  let oversized;
  try {
    normalizeOnboardingProgressPreference(
      { padding: "x".repeat(70_000) },
      { strict: true },
    );
  } catch (error) {
    oversized = error;
  }
  assert.ok(oversized);
  assert.match(String((oversized as { detail?: unknown }).detail), /64 KiB/);
});

test("strict server validation rejects unsupported schema and malformed track state", () => {
  const rejected = [
    {
      value: { schemaVersion: 2 },
      detail: /onboarding\.schemaVersion/,
    },
    {
      value: { tracks: [] },
      detail: /onboarding\.tracks/,
    },
    {
      value: {
        tracks: {
          "connect-account": {
            completedStepIds: ["open-settings", "unknown-step"],
          },
        },
      },
      detail: /completedStepIds/,
    },
  ];

  for (const { value, detail } of rejected) {
    assert.throws(
      () =>
        normalizeOnboardingProgressPreference(value, {
          strict: true,
        }),
      (error: unknown) => {
        assert.match(String((error as { detail?: unknown }).detail), detail);
        return true;
      },
    );
  }
});

test("server and client semantics use zero for an omitted version on a present track", () => {
  const normalized = normalizeOnboardingProgressPreference({
    tracks: {
      "connect-account": {
        status: "paused",
      },
    },
  });

  assert.equal(normalized.tracks["connect-account"]!.catalogVersion, 0);
});

test("server preserves a prior completion timestamp while a track is replayed", () => {
  const completedAt = "2026-07-18T00:00:00.000Z";
  const normalized = normalizeOnboardingProgressPreference(
    {
      tracks: {
        "connect-account": {
          status: "active",
          completedStepIds: ["open-settings", "choose-provider"],
          completedAt,
        },
      },
      activeTrackId: "connect-account",
    },
    { strict: true },
  );

  assert.equal(
    normalized.tracks["connect-account"]!.completedAt,
    completedAt,
  );
});

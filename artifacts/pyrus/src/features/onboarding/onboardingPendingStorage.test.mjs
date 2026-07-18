import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingOnboardingProgress,
  pendingOnboardingStorageKey,
  readPendingOnboardingProgress,
  writePendingOnboardingProgress,
} from "./onboardingPendingStorage.ts";
import {
  createDefaultOnboardingProgress,
  reduceOnboardingProgress,
} from "./onboardingModel.ts";

const withStorage = (run) => {
  const stored = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
  };
  try {
    run(stored);
  } finally {
    globalThis.window = previousWindow;
  }
};

test("pending onboarding progress is isolated by immutable user ID", () => {
  withStorage(() => {
    const shown = reduceOnboardingProgress(
      createDefaultOnboardingProgress(),
      { type: "mark-auto-open-shown" },
    );
    assert.equal(writePendingOnboardingProgress("user-a", shown), true);
    assert.equal(
      readPendingOnboardingProgress("user-a")?.autoOpenShownVersion,
      1,
    );
    assert.equal(readPendingOnboardingProgress("user-b"), null);
    assert.notEqual(
      pendingOnboardingStorageKey("user-a"),
      pendingOnboardingStorageKey("user-b"),
    );
  });
});

test("confirmed pending progress is removed only for the same user", () => {
  withStorage((stored) => {
    const progress = createDefaultOnboardingProgress();
    writePendingOnboardingProgress("user-a", progress);
    writePendingOnboardingProgress("user-b", progress);

    clearPendingOnboardingProgress("user-a");

    assert.equal(stored.has(pendingOnboardingStorageKey("user-a")), false);
    assert.equal(stored.has(pendingOnboardingStorageKey("user-b")), true);
  });
});

test("an older confirmation cannot clear newer pending progress", () => {
  withStorage(() => {
    const older = createDefaultOnboardingProgress();
    const newer = reduceOnboardingProgress(older, {
      type: "mark-auto-open-shown",
    });
    writePendingOnboardingProgress("user-a", newer);

    assert.equal(
      clearPendingOnboardingProgress("user-a", older),
      false,
    );
    assert.equal(
      readPendingOnboardingProgress("user-a")?.autoOpenShownVersion,
      1,
    );
    assert.equal(
      clearPendingOnboardingProgress("user-a", newer),
      true,
    );
    assert.equal(readPendingOnboardingProgress("user-a"), null);
  });
});

test("malformed pending storage fails closed", () => {
  withStorage((stored) => {
    stored.set(pendingOnboardingStorageKey("user-a"), "{broken");
    assert.equal(readPendingOnboardingProgress("user-a"), null);
    assert.equal(writePendingOnboardingProgress("", {}), false);
  });
});

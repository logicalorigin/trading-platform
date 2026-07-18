import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetUserPreferencesForTests,
  attachPreferenceIdentity,
  getPreferenceStateForTests,
  patchUserPreferences,
  reloadUserPreferences,
  syncUserPreferencesFromLocalCache,
} from "./useUserPreferences.ts";
import {
  pendingOnboardingStorageKey,
  readPendingOnboardingProgress,
  writePendingOnboardingProgress,
} from "../onboarding/onboardingPendingStorage.ts";
import {
  createDefaultOnboardingProgress,
  reduceOnboardingProgress,
} from "../onboarding/onboardingModel.ts";

const preferenceResponse = (onboarding = createDefaultOnboardingProgress()) => ({
  ok: true,
  json: async () => ({
    profileKey: "default",
    version: 1,
    source: "database",
    updatedAt: "2026-07-18T00:00:00.000Z",
    preferences: { onboarding },
  }),
});

const withBrowserStorage = async (run) => {
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
      removeItem: (key) => stored.delete(key),
    },
    addEventListener: () => undefined,
    dispatchEvent: () => true,
  };
  try {
    await run(stored);
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
};

test("identity change resets preferences before a prior response settles", async () => {
  __resetUserPreferencesForTests();
  const previousFetch = globalThis.fetch;
  let resolveUserA;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      resolveUserA = resolve;
    });

  try {
    attachPreferenceIdentity("user-a");
    const request = reloadUserPreferences("user-a");
    attachPreferenceIdentity("user-b");
    resolveUserA({
      ok: true,
      json: async () => ({
        profileKey: "default",
        version: 1,
        source: "database",
        updatedAt: "2026-07-18T00:00:00.000Z",
        preferences: {
          workspace: { defaultSymbol: "AAPL" },
          onboarding: { autoOpenShownVersion: 1 },
        },
      }),
    });
    await request;

    const state = getPreferenceStateForTests();
    assert.equal(state.userId, "user-b");
    assert.equal(state.snapshot.preferences.workspace.defaultSymbol, "SPY");
    assert.equal(state.snapshot.preferences.onboarding.autoOpenShownVersion, 0);
  } finally {
    globalThis.fetch = previousFetch;
    __resetUserPreferencesForTests();
  }
});

test("signed-out identity never starts a preference request", async () => {
  __resetUserPreferencesForTests();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("must not run");
  };

  try {
    attachPreferenceIdentity(null);
    await reloadUserPreferences(null);
    assert.equal(calls, 0);
    assert.equal(getPreferenceStateForTests().remoteStatus, "idle");
  } finally {
    globalThis.fetch = previousFetch;
    __resetUserPreferencesForTests();
  }
});

test("a late prior-user reload cannot clear the current user's reload", async () => {
  __resetUserPreferencesForTests();
  const previousFetch = globalThis.fetch;
  const resolvers = [];
  globalThis.fetch = () =>
    new Promise((resolve) => {
      resolvers.push(resolve);
    });

  try {
    attachPreferenceIdentity("user-a");
    const requestA = reloadUserPreferences("user-a");
    attachPreferenceIdentity("user-b");
    const requestB = reloadUserPreferences("user-b");

    resolvers[0](preferenceResponse());
    await requestA;
    const repeatedRequestB = reloadUserPreferences("user-b");
    const requestCount = resolvers.length;

    resolvers.slice(1).forEach((resolve) => resolve(preferenceResponse()));
    await Promise.all([requestB, repeatedRequestB]);

    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = previousFetch;
    __resetUserPreferencesForTests();
  }
});

test("an explicit onboarding patch supersedes older pending progress", async () => {
  await withBrowserStorage(async () => {
    __resetUserPreferencesForTests();
    const previousFetch = globalThis.fetch;
    let requestBody;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return preferenceResponse(requestBody.preferences.onboarding);
    };

    try {
      const oldPending = createDefaultOnboardingProgress();
      const newerProgress = reduceOnboardingProgress(oldPending, {
        type: "mark-auto-open-shown",
      });
      writePendingOnboardingProgress("user-a", oldPending);
      attachPreferenceIdentity("user-a");

      await patchUserPreferences(
        { onboarding: newerProgress },
        "user-a",
        null,
      );

      assert.equal(
        requestBody.preferences.onboarding.autoOpenShownVersion,
        1,
      );
    } finally {
      globalThis.fetch = previousFetch;
      __resetUserPreferencesForTests();
    }
  });
});

test("an older server response cannot clear newer cross-tab onboarding progress", async () => {
  await withBrowserStorage(async () => {
    __resetUserPreferencesForTests();
    const previousFetch = globalThis.fetch;
    let resolveFetch;
    globalThis.fetch = () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      });

    try {
      const older = createDefaultOnboardingProgress();
      const newer = reduceOnboardingProgress(older, {
        type: "mark-auto-open-shown",
      });
      attachPreferenceIdentity("user-a");
      const request = patchUserPreferences(
        { onboarding: older },
        "user-a",
        null,
      );
      await Promise.resolve();
      await Promise.resolve();
      writePendingOnboardingProgress("user-a", newer);
      resolveFetch(preferenceResponse(older));

      await request;

      assert.equal(
        readPendingOnboardingProgress("user-a")?.autoOpenShownVersion,
        1,
      );
      assert.equal(
        getPreferenceStateForTests().snapshot.preferences.onboarding
          .autoOpenShownVersion,
        1,
      );
      assert.equal(
        getPreferenceStateForTests().onboardingStorageStatus,
        "stored",
      );
    } finally {
      globalThis.fetch = previousFetch;
      __resetUserPreferencesForTests();
    }
  });
});

test("cross-tab pending onboarding progress updates the current user's visible state", async () => {
  await withBrowserStorage(async () => {
    __resetUserPreferencesForTests();
    try {
      attachPreferenceIdentity("user-a");
      const shown = reduceOnboardingProgress(
        createDefaultOnboardingProgress(),
        { type: "mark-auto-open-shown" },
      );
      writePendingOnboardingProgress("user-a", shown);

      syncUserPreferencesFromLocalCache({
        key: pendingOnboardingStorageKey("user-a"),
      });

      assert.equal(
        getPreferenceStateForTests().snapshot.preferences.onboarding
          .autoOpenShownVersion,
        1,
      );
      assert.equal(
        getPreferenceStateForTests().onboardingStorageStatus,
        "stored",
      );
    } finally {
      __resetUserPreferencesForTests();
    }
  });
});

test("an unrelated storage event cannot import pending onboarding progress", async () => {
  await withBrowserStorage(async () => {
    __resetUserPreferencesForTests();
    try {
      attachPreferenceIdentity("user-a");
      const shown = reduceOnboardingProgress(
        createDefaultOnboardingProgress(),
        { type: "mark-auto-open-shown" },
      );
      writePendingOnboardingProgress("user-a", shown);

      syncUserPreferencesFromLocalCache({ key: "unrelated" });

      assert.equal(
        getPreferenceStateForTests().snapshot.preferences.onboarding
          .autoOpenShownVersion,
        0,
      );
      assert.equal(
        getPreferenceStateForTests().onboardingStorageStatus,
        "none",
      );
    } finally {
      __resetUserPreferencesForTests();
    }
  });
});

test("onboarding storage failure stays explicit until the server confirms", async () => {
  await withBrowserStorage(async () => {
    __resetUserPreferencesForTests();
    const previousFetch = globalThis.fetch;
    globalThis.window.localStorage.setItem = () => {
      throw new Error("storage unavailable");
    };

    try {
      attachPreferenceIdentity("user-a");
      globalThis.fetch = async () => ({
        ok: false,
        json: async () => ({ message: "network unavailable" }),
      });
      await patchUserPreferences(
        { onboarding: createDefaultOnboardingProgress() },
        "user-a",
        null,
      );
      assert.equal(
        getPreferenceStateForTests().onboardingStorageStatus,
        "failed",
      );

      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body);
        return preferenceResponse(body.preferences.onboarding);
      };
      await patchUserPreferences(
        {
          onboarding: reduceOnboardingProgress(
            createDefaultOnboardingProgress(),
            { type: "mark-auto-open-shown" },
          ),
        },
        "user-a",
        null,
      );
      assert.equal(
        getPreferenceStateForTests().onboardingStorageStatus,
        "none",
      );
    } finally {
      globalThis.fetch = previousFetch;
      __resetUserPreferencesForTests();
    }
  });
});

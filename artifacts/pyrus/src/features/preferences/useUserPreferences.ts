import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  clearPendingOnboardingProgress,
  pendingOnboardingStorageKey,
  readPendingOnboardingProgress,
  writePendingOnboardingProgress,
} from "../onboarding/onboardingPendingStorage";
import { useAuthSession } from "../auth/authSession.jsx";
import {
  USER_PREFERENCES_UPDATED_EVENT,
  USER_PREFERENCES_STORAGE_KEY,
  buildLocalPreferenceSnapshot,
  buildUserPreferencesResetValue,
  deepMergeRecords,
  normalizePreferenceSnapshot,
  normalizeUserPreferences,
  writeCachedUserPreferences,
  type UserPreferenceSnapshot,
  type UserPreferences,
} from "./userPreferenceModel";

type PreferenceRemoteStatus = "idle" | "loading" | "confirmed" | "failed";
type OnboardingStorageStatus = "none" | "stored" | "failed";

type UserPreferenceState = {
  userId: string | null;
  snapshot: UserPreferenceSnapshot;
  loading: boolean;
  saving: boolean;
  error: string | null;
  remoteStatus: PreferenceRemoteStatus;
  onboardingStorageStatus: OnboardingStorageStatus;
};

export type UserPreferencesApi = {
  snapshot: UserPreferenceSnapshot;
  preferences: UserPreferences;
  loading: boolean;
  saving: boolean;
  error: string | null;
  remoteStatus: PreferenceRemoteStatus;
  onboardingStorageStatus: OnboardingStorageStatus;
  reload: () => Promise<void>;
  patch: (patchValue: Record<string, unknown>) => Promise<void>;
  reset: () => Promise<void>;
};

const readError = (error: unknown, fallback: string): string => {
  if (error && typeof error === "object") {
    const record = error as { detail?: unknown; message?: unknown };
    if (record.detail) return String(record.detail);
    if (record.message) return String(record.message);
  }
  return fallback;
};

const buildIdentityState = (userId: string | null) => {
  const snapshot = buildLocalPreferenceSnapshot();
  const pending = userId ? readPendingOnboardingProgress(userId) : null;
  return {
    snapshot: pending
      ? {
          ...snapshot,
          preferences: {
            ...snapshot.preferences,
            onboarding: pending,
          },
        }
      : snapshot,
    onboardingStorageStatus: pending ? ("stored" as const) : ("none" as const),
  };
};

const createPreferenceState = (
  userId: string | null,
): UserPreferenceState => {
  const identityState = buildIdentityState(userId);
  return {
    userId,
    ...identityState,
    loading: false,
    saving: false,
    error: null,
    remoteStatus: "idle",
  };
};

let preferenceState = createPreferenceState(null);
let preferenceGeneration = 0;
let reloadPromise: Promise<void> | null = null;
let reloadController: AbortController | null = null;
let mutationTail: Promise<void> = Promise.resolve();
let mutationSequence = 0;
let browserListenerReady = false;
let suppressCacheEvent = false;

const listeners = new Set<() => void>();

const emitPreferenceState = () => {
  listeners.forEach((listener) => listener());
};

const setPreferenceState = (patch: Partial<UserPreferenceState>) => {
  preferenceState = {
    ...preferenceState,
    ...patch,
  };
  emitPreferenceState();
};

const cachePreferences = (preferences: UserPreferences) => {
  suppressCacheEvent = true;
  try {
    writeCachedUserPreferences(preferences);
  } finally {
    suppressCacheEvent = false;
  }
};

const identityIsCurrent = (userId: string, generation: number): boolean =>
  preferenceState.userId === userId && preferenceGeneration === generation;

const applySnapshot = (
  snapshot: UserPreferenceSnapshot,
  userId: string,
  generation: number,
  onboardingStorageStatus: OnboardingStorageStatus = "none",
) => {
  if (!identityIsCurrent(userId, generation)) return;
  cachePreferences(snapshot.preferences);
  setPreferenceState({
    snapshot,
    loading: false,
    saving: false,
    error: null,
    remoteStatus: "confirmed",
    onboardingStorageStatus,
  });
};

export const syncUserPreferencesFromLocalCache = (
  event?: Event | { key?: string | null },
) => {
  if (suppressCacheEvent || !preferenceState.userId) return;
  const storageKey = event && "key" in event ? event.key : undefined;
  if (
    storageKey !== undefined &&
    storageKey !== USER_PREFERENCES_STORAGE_KEY &&
    storageKey !== pendingOnboardingStorageKey(preferenceState.userId)
  ) {
    return;
  }
  const local = buildLocalPreferenceSnapshot();
  const pending = readPendingOnboardingProgress(preferenceState.userId);
  setPreferenceState({
    snapshot: {
      ...local,
      preferences: {
        ...local.preferences,
        onboarding:
          pending ?? preferenceState.snapshot.preferences.onboarding,
      },
    },
    onboardingStorageStatus: pending
      ? "stored"
      : preferenceState.onboardingStorageStatus === "stored"
        ? "none"
        : preferenceState.onboardingStorageStatus,
  });
};

const ensureBrowserPreferenceListeners = () => {
  if (browserListenerReady || typeof window === "undefined") return;
  browserListenerReady = true;
  window.addEventListener(
    USER_PREFERENCES_UPDATED_EVENT,
    syncUserPreferencesFromLocalCache,
  );
  window.addEventListener("storage", syncUserPreferencesFromLocalCache);
};

const getPreferenceState = () => preferenceState;

const subscribeToPreferences = (listener: () => void) => {
  ensureBrowserPreferenceListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const attachPreferenceIdentity = (
  requestedUserId: string | null | undefined,
): number => {
  const userId =
    typeof requestedUserId === "string" && requestedUserId
      ? requestedUserId
      : null;
  if (preferenceState.userId === userId) return preferenceGeneration;

  preferenceGeneration += 1;
  reloadController?.abort();
  reloadController = null;
  reloadPromise = null;
  mutationSequence = 0;
  mutationTail = Promise.resolve();
  preferenceState = createPreferenceState(userId);
  emitPreferenceState();
  return preferenceGeneration;
};

export const reloadUserPreferences = (
  userId: string | null,
  csrfToken: string | null = null,
): Promise<void> => {
  if (!userId || preferenceState.userId !== userId) {
    return Promise.resolve();
  }
  if (reloadPromise) return reloadPromise;

  const generation = preferenceGeneration;
  const controller = new AbortController();
  reloadController = controller;
  setPreferenceState({
    loading: true,
    error: null,
    remoteStatus: "loading",
  });
  const request = fetch("/api/settings/preferences", {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  })
    .then((response) =>
      response.ok
        ? response.json()
        : response.json().then((payload) => Promise.reject(payload)),
    )
    .then(async (payload) => {
      if (!identityIsCurrent(userId, generation)) return;
      const snapshot = normalizePreferenceSnapshot(payload);
      const pending = readPendingOnboardingProgress(userId);
      if (!pending) {
        applySnapshot(snapshot, userId, generation);
        return;
      }
      applySnapshot(
        {
          ...snapshot,
          preferences: {
            ...snapshot.preferences,
            onboarding: pending,
          },
        },
        userId,
        generation,
        "stored",
      );
      await patchUserPreferences({ onboarding: pending }, userId, csrfToken);
    })
    .catch((error) => {
      if (
        !identityIsCurrent(userId, generation) ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }
      setPreferenceState({
        loading: false,
        error: readError(error, "Preferences are unavailable."),
        remoteStatus: "failed",
      });
    })
    .finally(() => {
      if (reloadController === controller) reloadController = null;
      if (reloadPromise === request) reloadPromise = null;
    });
  reloadPromise = request;
  return request;
};

export const patchUserPreferences = (
  patchValue: Record<string, unknown>,
  userId: string | null,
  csrfToken: string | null,
): Promise<void> => {
  if (!userId || preferenceState.userId !== userId) {
    return Promise.resolve();
  }
  const pending = readPendingOnboardingProgress(userId);
  const effectivePatch =
    patchValue.onboarding !== undefined
      ? patchValue
      : pending
        ? { ...patchValue, onboarding: pending }
        : patchValue;
  const optimistic = normalizeUserPreferences(
    deepMergeRecords(
      preferenceState.snapshot.preferences as unknown as Record<string, unknown>,
      effectivePatch,
    ),
  );
  const onboardingStorageStatus =
    "onboarding" in effectivePatch
      ? writePendingOnboardingProgress(userId, optimistic.onboarding)
        ? "stored"
        : "failed"
      : preferenceState.onboardingStorageStatus;
  cachePreferences(optimistic);
  setPreferenceState({
    snapshot: {
      ...preferenceState.snapshot,
      preferences: optimistic,
      source:
        preferenceState.snapshot.source === "database" ? "database" : "local",
    },
    saving: true,
    error: null,
    onboardingStorageStatus,
  });

  const generation = preferenceGeneration;
  const sequence = ++mutationSequence;
  const request = mutationTail
    .catch(() => undefined)
    .then(async () => {
      if (!identityIsCurrent(userId, generation)) return;
      const response = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify({ preferences: effectivePatch }),
      });
      const payload = await response.json();
      if (!response.ok) throw payload;
      if (
        identityIsCurrent(userId, generation) &&
        sequence === mutationSequence
      ) {
        clearPendingOnboardingProgress(
          userId,
          optimistic.onboarding,
        );
        const retainedPending = readPendingOnboardingProgress(userId);
        const confirmed = normalizePreferenceSnapshot(payload);
        applySnapshot(
          retainedPending
            ? {
                ...confirmed,
                preferences: {
                  ...confirmed.preferences,
                  onboarding: retainedPending,
                },
              }
            : confirmed,
          userId,
          generation,
          retainedPending ? "stored" : "none",
        );
      }
    })
    .catch((error) => {
      if (
        identityIsCurrent(userId, generation) &&
        sequence === mutationSequence
      ) {
        setPreferenceState({
          saving: false,
          error: readError(error, "Failed to save preferences."),
        });
      }
    });
  mutationTail = request;
  return request;
};

export const resetUserPreferences = (
  userId: string | null,
  csrfToken: string | null,
): Promise<void> =>
  patchUserPreferences(
    buildUserPreferencesResetValue(preferenceState.snapshot.preferences),
    userId,
    csrfToken,
  );

export const getPreferenceStateForTests = (): UserPreferenceState =>
  preferenceState;

export const __resetUserPreferencesForTests = (): void => {
  reloadController?.abort();
  preferenceGeneration = 0;
  reloadPromise = null;
  reloadController = null;
  mutationTail = Promise.resolve();
  mutationSequence = 0;
  preferenceState = createPreferenceState(null);
};

export function useUserPreferences(): UserPreferencesApi {
  const { csrfToken, user } = useAuthSession();
  const userId =
    typeof user?.id === "string" && user.id ? user.id : null;
  const state = useSyncExternalStore(
    subscribeToPreferences,
    getPreferenceState,
    getPreferenceState,
  );
  const scopedState = useMemo(
    () => (state.userId === userId ? state : createPreferenceState(userId)),
    [state, userId],
  );

  useEffect(() => {
    attachPreferenceIdentity(userId);
  }, [userId]);

  useEffect(() => {
    if (
      userId &&
      state.userId === userId &&
      state.remoteStatus === "idle"
    ) {
      void reloadUserPreferences(userId, csrfToken);
    }
  }, [csrfToken, state.remoteStatus, state.userId, userId]);

  return useMemo(
    () => ({
      snapshot: scopedState.snapshot,
      preferences: scopedState.snapshot.preferences,
      loading: scopedState.loading,
      saving: scopedState.saving,
      error: scopedState.error,
      remoteStatus: scopedState.remoteStatus,
      onboardingStorageStatus: scopedState.onboardingStorageStatus,
      reload: () => reloadUserPreferences(userId, csrfToken),
      patch: (patchValue) =>
        patchUserPreferences(patchValue, userId, csrfToken),
      reset: () => resetUserPreferences(userId, csrfToken),
    }),
    [csrfToken, scopedState, userId],
  );
}

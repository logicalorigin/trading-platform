import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_UPDATED_EVENT,
  buildLocalPreferenceSnapshot,
  deepMergeRecords,
  normalizePreferenceSnapshot,
  normalizeUserPreferences,
  writeCachedUserPreferences,
  type UserPreferenceSnapshot,
  type UserPreferences,
} from "./userPreferenceModel";

type UserPreferenceState = {
  snapshot: UserPreferenceSnapshot;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

export type UserPreferencesApi = {
  snapshot: UserPreferenceSnapshot;
  preferences: UserPreferences;
  loading: boolean;
  saving: boolean;
  error: string | null;
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

let preferenceState: UserPreferenceState = {
  snapshot: buildLocalPreferenceSnapshot(),
  loading: false,
  saving: false,
  error: null,
};
let remoteLoaded = false;
let remoteLoadAttempted = false;
let reloadPromise: Promise<void> | null = null;
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

const applySnapshot = (snapshot: UserPreferenceSnapshot) => {
  cachePreferences(snapshot.preferences);
  setPreferenceState({
    snapshot,
    loading: false,
    saving: false,
    error: null,
  });
};

const refreshFromLocalCache = () => {
  if (suppressCacheEvent) return;
  setPreferenceState({
    snapshot: buildLocalPreferenceSnapshot(),
  });
};

const ensureBrowserPreferenceListeners = () => {
  if (browserListenerReady || typeof window === "undefined") return;
  browserListenerReady = true;
  window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, refreshFromLocalCache);
  window.addEventListener("storage", refreshFromLocalCache);
};

const getPreferenceState = () => preferenceState;

const subscribeToPreferences = (listener: () => void) => {
  ensureBrowserPreferenceListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const reloadUserPreferences = (): Promise<void> => {
  if (reloadPromise) {
    return reloadPromise;
  }

  setPreferenceState({ loading: true, error: null });
  remoteLoadAttempted = true;
  reloadPromise = fetch("/api/settings/preferences", {
    headers: { Accept: "application/json" },
  })
    .then((response) =>
      response.ok
        ? response.json()
        : response.json().then((payload) => Promise.reject(payload)),
    )
    .then((payload) => {
      remoteLoaded = true;
      applySnapshot(normalizePreferenceSnapshot(payload));
    })
    .catch((error) => {
      setPreferenceState({
        loading: false,
        error: readError(error, "Preferences are unavailable."),
      });
    })
    .finally(() => {
      reloadPromise = null;
    });
  return reloadPromise;
};

export const patchUserPreferences = (
  patchValue: Record<string, unknown>,
): Promise<void> => {
  const optimistic = normalizeUserPreferences(
    deepMergeRecords(
      preferenceState.snapshot.preferences as unknown as Record<string, unknown>,
      patchValue,
    ),
  );
  cachePreferences(optimistic);
  setPreferenceState({
    snapshot: {
      ...preferenceState.snapshot,
      preferences: optimistic,
      source: preferenceState.snapshot.source === "database" ? "database" : "local",
    },
    saving: true,
    error: null,
  });

  return fetch("/api/settings/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ preferences: patchValue }),
  })
    .then((response) =>
      response.ok
        ? response.json()
        : response.json().then((payload) => Promise.reject(payload)),
    )
    .then((payload) => {
      remoteLoaded = true;
      applySnapshot(normalizePreferenceSnapshot(payload));
    })
    .catch((error) => {
      setPreferenceState({
        saving: false,
        error: readError(error, "Failed to save preferences."),
      });
    });
};

export const resetUserPreferences = (): Promise<void> => {
  cachePreferences(DEFAULT_USER_PREFERENCES);
  setPreferenceState({
    snapshot: {
      ...preferenceState.snapshot,
      preferences: DEFAULT_USER_PREFERENCES,
      source: preferenceState.snapshot.source === "database" ? "database" : "local",
    },
    saving: true,
    error: null,
  });

  return fetch("/api/settings/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ preferences: DEFAULT_USER_PREFERENCES }),
  })
    .then((response) =>
      response.ok
        ? response.json()
        : response.json().then((payload) => Promise.reject(payload)),
    )
    .then((payload) => {
      remoteLoaded = true;
      applySnapshot(normalizePreferenceSnapshot(payload));
    })
    .catch((error) => {
      setPreferenceState({
        saving: false,
        error: readError(error, "Failed to reset preferences."),
      });
    });
};

export function useUserPreferences(): UserPreferencesApi {
  const state = useSyncExternalStore(
    subscribeToPreferences,
    getPreferenceState,
    getPreferenceState,
  );

  useEffect(() => {
    if (!remoteLoaded && !remoteLoadAttempted && !state.loading) {
      void reloadUserPreferences();
    }
  }, [state.loading]);

  return useMemo(
    () => ({
      snapshot: state.snapshot,
      preferences: state.snapshot.preferences,
      loading: state.loading,
      saving: state.saving,
      error: state.error,
      reload: reloadUserPreferences,
      patch: patchUserPreferences,
      reset: resetUserPreferences,
    }),
    [state.error, state.loading, state.saving, state.snapshot],
  );
}

import {
  LEGACY_RAYALGO_STORAGE_KEY,
  LEGACY_RAYALGO_WORKSPACE_SETTINGS_EVENT,
  PYRUS_STORAGE_KEY,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
} from "./uiTokens.jsx";

export const readPersistedState = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }
    const raw =
      window.localStorage.getItem(PYRUS_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_RAYALGO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
};

export const _initialState = readPersistedState();

export const persistState = (patch) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const current = readPersistedState();
    const next = { ...current, ...patch };
    window.localStorage.setItem(PYRUS_STORAGE_KEY, JSON.stringify(next));
    for (const eventName of [
      PYRUS_WORKSPACE_SETTINGS_EVENT,
      LEGACY_RAYALGO_WORKSPACE_SETTINGS_EVENT,
    ]) {
      window.dispatchEvent(new CustomEvent(eventName, { detail: next }));
    }
  } catch (_error) {}
};

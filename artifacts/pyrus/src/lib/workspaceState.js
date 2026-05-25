import {
  PYRUS_STORAGE_KEY,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  readPyrusWorkspaceState,
} from "./uiTokens.jsx";

export const readPersistedState = () => {
  return readPyrusWorkspaceState();
};

export const _initialState = readPersistedState();

export const persistState = (patch) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const current = readPersistedState();
    const next = { ...current, ...patch };
    window.localStorage.setItem(PYRUS_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PYRUS_WORKSPACE_SETTINGS_EVENT, { detail: next }));
  } catch (_error) {}
};

import { RAYALGO_STORAGE_KEY } from "./uiTokens.jsx";

export const readPersistedState = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }
    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
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
    window.localStorage.setItem(RAYALGO_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent("rayalgo:workspace-settings-updated", { detail: next }),
    );
  } catch (_error) {}
};

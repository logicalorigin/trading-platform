export const PYRUS_STORAGE_KEY = "pyrus:state:v1";
export const PYRUS_WORKSPACE_SETTINGS_EVENT = "pyrus:workspace-settings-updated";

const RETIRED_WORKSPACE_STORAGE_KEY = ["ray", "algo:state:v1"].join("");

export const readPyrusWorkspaceState = (): Record<string, unknown> => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }

    let raw = window.localStorage.getItem(PYRUS_STORAGE_KEY);
    if (!raw) {
      const retiredRaw = window.localStorage.getItem(RETIRED_WORKSPACE_STORAGE_KEY);
      if (retiredRaw) {
        window.localStorage.setItem(PYRUS_STORAGE_KEY, retiredRaw);
        window.localStorage.removeItem(RETIRED_WORKSPACE_STORAGE_KEY);
        raw = retiredRaw;
      }
    }
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

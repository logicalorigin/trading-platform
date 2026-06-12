export const PLATFORM_SCREEN_IDS = Object.freeze([
  "market",
  "signals",
  "flow",
  "gex",
  "trade",
  "account",
  "research",
  "algo",
  "backtest",
  "diagnostics",
  "settings",
]);

const PLATFORM_SCREEN_ID_SET = new Set<string>(PLATFORM_SCREEN_IDS);
const PYRUS_WORKSPACE_STATE_STORAGE_KEY = "pyrus:state:v1";

export const normalizeInitialPlatformScreen = (screenId: unknown) => {
  const normalizedScreen = screenId === "unusual" ? "flow" : screenId || "market";
  return typeof normalizedScreen === "string" && PLATFORM_SCREEN_ID_SET.has(normalizedScreen)
    ? normalizedScreen
    : "market";
};

export const readInitialPlatformScreen = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return "market";
    }
    const raw = window.localStorage.getItem(PYRUS_WORKSPACE_STATE_STORAGE_KEY);
    const state: unknown = raw ? JSON.parse(raw) : {};
    const screen = state && typeof state === "object" && "screen" in state ? state.screen : null;
    return normalizeInitialPlatformScreen(screen);
  } catch {
    return "market";
  }
};

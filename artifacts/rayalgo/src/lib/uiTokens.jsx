export const RAYALGO_STORAGE_KEY = "rayalgo:state:v1";

export const THEMES = {
  dark: {
    bg0: "#080b12",
    bg1: "#0d1117",
    bg2: "#141b27",
    bg3: "#1a2235",
    bg4: "#212d42",
    border: "#1e293b",
    borderLight: "#253349",
    borderFocus: "#3b82f6",
    text: "#e2e8f0",
    textSec: "#94a3b8",
    textDim: "#64748b",
    textMuted: "#475569",
    accent: "#3b82f6",
    accentDim: "#1e3a5f",
    green: "#10b981",
    greenDim: "#064e3b",
    greenBg: "rgba(16,185,129,0.08)",
    red: "#ef4444",
    redDim: "#7f1d1d",
    redBg: "rgba(239,68,68,0.08)",
    amber: "#f59e0b",
    amberDim: "#78350f",
    amberBg: "rgba(245,158,11,0.08)",
    blue: "#3b82f6",
    purple: "#8b5cf6",
    cyan: "#06b6d4",
    pink: "#ec4899",
  },
  light: {
    bg0: "#f5f5f4",
    bg1: "#ffffff",
    bg2: "#ffffff",
    bg3: "#f8fafc",
    bg4: "#ffffff",
    border: "#e2e8f0",
    borderLight: "#cbd5e1",
    borderFocus: "#2563eb",
    text: "#0f172a",
    textSec: "#475569",
    textDim: "#64748b",
    textMuted: "#94a3b8",
    accent: "#2563eb",
    accentDim: "#dbeafe",
    green: "#059669",
    greenDim: "#a7f3d0",
    greenBg: "rgba(5,150,105,0.10)",
    red: "#dc2626",
    redDim: "#fecaca",
    redBg: "rgba(220,38,38,0.10)",
    amber: "#d97706",
    amberDim: "#fde68a",
    amberBg: "rgba(217,119,6,0.10)",
    blue: "#2563eb",
    purple: "#7c3aed",
    cyan: "#0891b2",
    pink: "#db2777",
  },
};

export const FONT_STACKS = {
  sans: "'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  code: "'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export const TYPOGRAPHY = {
  mono: FONT_STACKS.sans,
  data: FONT_STACKS.sans,
  code: FONT_STACKS.code,
  sans: FONT_STACKS.sans,
  display: FONT_STACKS.sans,
};

export const FONT_WEIGHTS = {
  regular: 400,
  label: 600,
  emphasis: 700,
};

export const TYPOGRAPHY_SIZES = {
  micro: 7,
  label: 8,
  control: 8,
  tableHeader: 7,
  tableCell: 8,
  caption: 9,
  body: 10,
  bodyStrong: 11,
  metric: 10,
  panelTitle: 9,
  sectionTitle: 10,
  screenTitle: 17,
};

export const SCALE_LEVELS = {
  xs: 0.85,
  s: 0.92,
  m: 1.0,
  l: 1.12,
  xl: 1.25,
};

export const DENSITY_LEVELS = {
  compact: 1.0,
  comfortable: 1.14,
};

const readStoredUiState = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }

    const raw = window.localStorage.getItem(RAYALGO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const persistedUiState = readStoredUiState();

let CURRENT_THEME =
  typeof persistedUiState.theme === "string" &&
  Object.prototype.hasOwnProperty.call(THEMES, persistedUiState.theme)
    ? persistedUiState.theme
    : "dark";

let CURRENT_SCALE =
  typeof persistedUiState.scale === "string" &&
  Object.prototype.hasOwnProperty.call(SCALE_LEVELS, persistedUiState.scale)
    ? persistedUiState.scale
    : "m";

let CURRENT_DENSITY =
  typeof persistedUiState.userPreferences?.appearance?.density === "string" &&
  Object.prototype.hasOwnProperty.call(
    DENSITY_LEVELS,
    persistedUiState.userPreferences.appearance.density,
  )
    ? persistedUiState.userPreferences.appearance.density
    : "compact";

const SCALE_FACTOR = () => SCALE_LEVELS[CURRENT_SCALE] ?? SCALE_LEVELS.m;
const DENSITY_FACTOR = () =>
  DENSITY_LEVELS[CURRENT_DENSITY] ?? DENSITY_LEVELS.compact;

export const getCurrentTheme = () => CURRENT_THEME;

export const setCurrentTheme = (nextTheme) => {
  CURRENT_THEME =
    typeof nextTheme === "string" &&
    Object.prototype.hasOwnProperty.call(THEMES, nextTheme)
      ? nextTheme
      : "dark";

  return CURRENT_THEME;
};

export const getCurrentScale = () => CURRENT_SCALE;

export const setCurrentScale = (nextScale) => {
  CURRENT_SCALE =
    typeof nextScale === "string" &&
    Object.prototype.hasOwnProperty.call(SCALE_LEVELS, nextScale)
      ? nextScale
      : "m";

  return CURRENT_SCALE;
};

export const getCurrentDensity = () => CURRENT_DENSITY;

export const setCurrentDensity = (nextDensity) => {
  CURRENT_DENSITY =
    typeof nextDensity === "string" &&
    Object.prototype.hasOwnProperty.call(DENSITY_LEVELS, nextDensity)
      ? nextDensity
      : "compact";

  return CURRENT_DENSITY;
};

export const fs = (n) => Math.max(10, Math.round(n * SCALE_FACTOR()));

export const textSize = (role) => {
  const baseSize =
    typeof role === "string" && Object.prototype.hasOwnProperty.call(TYPOGRAPHY_SIZES, role)
      ? TYPOGRAPHY_SIZES[role]
      : Number(role);

  return fs(Number.isFinite(baseSize) ? baseSize : TYPOGRAPHY_SIZES.body);
};

export const dim = (n) => Math.round(n * SCALE_FACTOR());

export const sp = (value) => {
  if (typeof value === "number") {
    return Math.round(value * SCALE_FACTOR() * DENSITY_FACTOR());
  }

  if (typeof value === "string") {
    return value.replace(/(-?\d*\.?\d+)(px|em|rem)?/g, (_, num, unit) => {
      return (
        Math.round(parseFloat(num) * SCALE_FACTOR() * DENSITY_FACTOR()) +
        (unit || "px")
      );
    });
  }

  return value;
};

export const T = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop === "string" && prop in TYPOGRAPHY) {
        return TYPOGRAPHY[prop];
      }

      if (typeof prop === "string") {
        return THEMES[CURRENT_THEME]?.[prop];
      }

      return undefined;
    },
  },
);

export const MISSING_VALUE = "----";

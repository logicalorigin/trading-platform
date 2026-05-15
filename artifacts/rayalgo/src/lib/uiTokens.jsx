export const RAYALGO_STORAGE_KEY = "rayalgo:state:v1";

export const THEMES = {
  dark: {
    bg0: "#16151A",
    bg1: "#1E1D22",
    bg2: "#26252B",
    bg3: "#2F2E35",
    bg4: "#3A3940",
    border: "#2F2E35",
    borderLight: "#3A3940",
    borderFocus: "#E08F76",
    text: "#F2EFE9",
    textSec: "#B8B4AC",
    textDim: "#86837D",
    textMuted: "#605C57",
    accent: "#E08F76",
    accentDim: "#3F2A22",
    green: "#4FB286",
    greenDim: "#1F3A2C",
    greenBg: "rgba(79,178,134,0.10)",
    red: "#D77470",
    redDim: "#3F2222",
    redBg: "rgba(215,116,112,0.10)",
    amber: "#D9A864",
    amberDim: "#3F3122",
    amberBg: "rgba(217,168,100,0.10)",
    blue: "#7CA7D9",
    purple: "#A189CF",
    cyan: "#6FB5C2",
    pink: "#D9849B",
    onAccent: "#FFFFFF",
    pulseLive: "#4FB286",
    pulseAlert: "#D9A864",
    pulseLoss: "#D77470",
  },
  light: {
    bg0: "#FAFAF7",
    bg1: "#FFFFFF",
    bg2: "#F1EFEA",
    bg3: "#E8E5DE",
    bg4: "#D9D5CD",
    border: "#E8E5DE",
    borderLight: "#F0EDE6",
    borderFocus: "#D97757",
    text: "#19171A",
    textSec: "#4E4B4F",
    textDim: "#86837D",
    textMuted: "#ACA8A0",
    accent: "#D97757",
    accentDim: "#F2DDD2",
    green: "#0F6E51",
    greenDim: "#CFE3D9",
    greenBg: "rgba(15,110,81,0.08)",
    red: "#B5403B",
    redDim: "#F2D4D2",
    redBg: "rgba(181,64,59,0.08)",
    amber: "#C28526",
    amberDim: "#F2E2C6",
    amberBg: "rgba(194,133,38,0.08)",
    blue: "#2E5A8E",
    purple: "#6B4E8E",
    cyan: "#2D7A8B",
    pink: "#B8567A",
    onAccent: "#FFFFFF",
    pulseLive: "#0F6E51",
    pulseAlert: "#C28526",
    pulseLoss: "#B5403B",
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
  medium: 500,
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
  // Public-style display sizes for the new aesthetic.
  // Existing roles above are preserved so legacy screens render unchanged.
  displayHero: 36,
  displayLarge: 26,
  displayMedium: 20,
  displaySmall: 16,
  paragraph: 14,
  paragraphMuted: 13,
};

export const RADII = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
};

export const ELEVATION = {
  none: "none",
  sm: "0 1px 2px rgba(25, 23, 26, 0.04), 0 1px 3px rgba(25, 23, 26, 0.06)",
  md: "0 4px 8px rgba(25, 23, 26, 0.06), 0 2px 4px rgba(25, 23, 26, 0.04)",
  lg: "0 10px 24px rgba(25, 23, 26, 0.10), 0 4px 8px rgba(25, 23, 26, 0.06)",
};

export const MAX_WIDTHS = {
  reading: 720,
  content: 1280,
  cockpit: 1600,
  full: null,
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

export const resolveSystemTheme = () => {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
  } catch {}

  return "light";
};

export const resolveEffectiveThemePreference = (preferenceTheme, fallbackTheme) => {
  if (
    typeof preferenceTheme === "string" &&
    Object.prototype.hasOwnProperty.call(THEMES, preferenceTheme) &&
    preferenceTheme !== "system"
  ) {
    return preferenceTheme;
  }

  if (preferenceTheme === "system") {
    return resolveSystemTheme();
  }

  if (
    typeof fallbackTheme === "string" &&
    Object.prototype.hasOwnProperty.call(THEMES, fallbackTheme)
  ) {
    return fallbackTheme;
  }

  return resolveSystemTheme();
};

export const resolveEffectiveThemeFromState = (state = {}) =>
  resolveEffectiveThemePreference(
    state?.userPreferences?.appearance?.theme,
    state?.theme,
  );

const persistedUiState = readStoredUiState();

let CURRENT_THEME = resolveEffectiveThemeFromState(persistedUiState);

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
      : "light";

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

const resolveCssVarValue = (styles, value, depth = 0) => {
  if (!value || depth > 4) {
    return value;
  }
  const match = String(value).trim().match(/^var\((--[^,\s)]+)(?:,\s*([^)]+))?\)$/);
  if (!match) {
    return String(value).trim();
  }

  const nested = styles.getPropertyValue(match[1]).trim() || match[2] || "";
  return resolveCssVarValue(styles, nested, depth + 1);
};

export const getToken = (name, fallback = "") => {
  if (
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function" ||
    typeof name !== "string" ||
    !name.trim()
  ) {
    return fallback;
  }

  const styles = window.getComputedStyle(document.documentElement);
  const raw = styles.getPropertyValue(name.trim()).trim();
  return resolveCssVarValue(styles, raw) || fallback;
};

export const resolveTokenColor = (name, fallback = "") =>
  getToken(name, fallback);

export const MISSING_VALUE = "----";

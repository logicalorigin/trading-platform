import {
  PYRUS_STORAGE_KEY,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  readPyrusWorkspaceState,
} from "./workspaceStorage";

export {
  PYRUS_STORAGE_KEY,
  PYRUS_WORKSPACE_SETTINGS_EVENT,
  readPyrusWorkspaceState,
};
export { MISSING_VALUE } from "./displayValues";

export const THEMES = {
  dark: {
    bg0: "#080808",
    bg1: "#0D0D0D",
    bg2: "#161616",
    bg3: "#1F1F1F",
    bg4: "#2A2A2A",
    border: "#292929",
    borderLight: "#383838",
    borderFocus: "#168BFF",
    text: "#F4F8FF",
    textSec: "#C3C3C3",
    textDim: "#A1A1A1",
    textMuted: "#888888",
    accent: "#168BFF",
    accentDim: "#041B36",
    accentHoverBg: "rgba(22, 139, 255, 0.12)",
    accentActiveBg: "rgba(22, 139, 255, 0.22)",
    green: "#2ED889",
    greenDim: "#0E2B20",
    greenBg: "rgba(46,216,137,0.11)",
    red: "#FF3048",
    redDim: "#2C0B13",
    redBg: "rgba(255,48,72,0.12)",
    amber: "#E9B949",
    amberDim: "#2A1F0F",
    amberBg: "rgba(233,185,73,0.12)",
    blue: "#168BFF",
    purple: "#AA5CFF",
    cyan: "#24C8DB",
    pink: "#FF5F9E",
    onAccent: "#080808",
    pulseLive: "#2ED889",
    pulseAlert: "#E9B949",
    pulseLoss: "#FF3048",
  },
  light: {
    bg0: "#FAFAFA",
    bg1: "#FFFFFF",
    bg2: "#F5F5F5",
    bg3: "#EDEDED",
    bg4: "#E5E5E5",
    border: "#E1E1E1",
    borderLight: "#F1F1F1",
    borderFocus: "#0B66D8",
    text: "#101827",
    textSec: "#414141",
    textDim: "#5A5A5A",
    textMuted: "#686868",
    accent: "#0B66D8",
    accentDim: "#E4F0FF",
    accentHoverBg: "rgba(11, 102, 216, 0.08)",
    accentActiveBg: "rgba(11, 102, 216, 0.16)",
    green: "#067052",
    greenDim: "#E7F5EF",
    greenBg: "rgba(6,112,82,0.09)",
    red: "#C51F38",
    redDim: "#FBE6EA",
    redBg: "rgba(197,31,56,0.10)",
    amber: "#794900",
    amberDim: "#FAF0DB",
    amberBg: "rgba(121,73,0,0.10)",
    blue: "#0B66D8",
    purple: "#7A3FF0",
    cyan: "#046F82",
    pink: "#B32666",
    onAccent: "#FFFFFF",
    pulseLive: "#067052",
    pulseAlert: "#794900",
    pulseLoss: "#C51F38",
  },
};

const SANS_FONT_STACK =
  "'IBM Plex Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const FONT_STACKS = {
  sans: SANS_FONT_STACK,
  data: SANS_FONT_STACK,
  code: SANS_FONT_STACK,
};

export const TYPOGRAPHY = {
  mono: FONT_STACKS.data,
  data: FONT_STACKS.data,
  code: FONT_STACKS.code,
  sans: FONT_STACKS.sans,
  display: FONT_STACKS.sans,
};

export const CSS_COLOR = Object.freeze({
  bg0: "var(--ra-surface-0)",
  bg1: "var(--ra-surface-1)",
  bg2: "var(--ra-surface-2)",
  bg3: "var(--ra-surface-3)",
  bg4: "var(--ra-surface-4)",
  border: "var(--ra-border-default)",
  borderLight: "var(--ra-border-light)",
  borderFocus: "var(--ra-border-focus)",
  text: "var(--ra-text-primary)",
  textSec: "var(--ra-text-secondary)",
  textDim: "var(--ra-text-dim)",
  textMuted: "var(--ra-text-muted)",
  accent: "var(--ra-color-accent)",
  accentDim: "var(--ra-accent-dim)",
  accentHoverBg: "var(--ra-accent-hover-bg)",
  accentActiveBg: "var(--ra-accent-active-bg)",
  green: "var(--ra-green-500)",
  greenDim: "var(--ra-green-dim)",
  greenBg: "var(--ra-green-bg)",
  red: "var(--ra-red-500)",
  redDim: "var(--ra-red-dim)",
  redBg: "var(--ra-red-bg)",
  amber: "var(--ra-amber-500)",
  amberDim: "var(--ra-amber-dim)",
  amberBg: "var(--ra-amber-bg)",
  blue: "var(--ra-blue-500)",
  purple: "var(--ra-purple-500)",
  cyan: "var(--ra-cyan-500)",
  pink: "var(--ra-pink-500)",
  onAccent: "var(--ra-on-accent)",
  pulseLive: "var(--ra-green-500)",
  pulseAlert: "var(--ra-amber-500)",
  pulseLoss: "var(--ra-red-500)",
});

export const cssColorMix = (color, percent) =>
  `color-mix(in srgb, ${color} ${Math.round(percent)}%, transparent)`;

export const cssColorAlpha = (color, alphaHex) => {
  const normalizedColor = String(color || "").trim();
  const normalizedAlpha = String(alphaHex || "").trim();
  if (!normalizedColor) return "transparent";
  if (/^#[0-9a-fA-F]{6}$/.test(normalizedColor) && /^[0-9a-fA-F]{2}$/.test(normalizedAlpha)) {
    return `${normalizedColor}${normalizedAlpha}`;
  }
  const alpha = Number.parseInt(normalizedAlpha, 16);
  if (!Number.isFinite(alpha)) {
    return normalizedColor;
  }
  return cssColorMix(normalizedColor, (alpha / 255) * 100);
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
  // Consolidated three-step scale: 4 (controls/chips), 8 (cards/panels),
  // pill (fully round). Legacy keys stay so call sites don't churn.
  xs: 4,
  sm: 4,
  md: 8,
  lg: 8,
  xl: 8,
  pill: 999,
};

/**
 * ELEVATION — theme-aware layered shadows. Each level resolves through
 * CSS vars declared in index.css so dark and light themes can carry
 * their own shadow recipe (dark needs darker / more diffuse shadows
 * because the bg is dark; light needs subtler shadows so they don't
 * read as smudges). Composes 2-3 shadows per level:
 *
 *   ambient — large diffuse, no offset, soft
 *   key     — directional, sharper, slight y-offset
 *   highlight — inset 1px top, dark theme only (lit-from-above)
 *
 * Plus ELEVATION.hover — accent-tinted overlay shadow for elevated
 * surfaces that lift under hover. Composes with the base elevation.
 */
export const ELEVATION = {
  none: "none",
  sm: "var(--ra-elevation-sm)",
  md: "var(--ra-elevation-md)",
  lg: "var(--ra-elevation-lg)",
  hover: "var(--ra-elevation-hover)",
};

/**
 * GLOW — status-glow box-shadows (design-audit item 13, D2). Glow is a
 * status channel, never chrome decoration: the semantic aliases key off the
 * --ra-color-* layer so protan mode and accent presets propagate. For a
 * custom tone, set `--ra-glow-tone` inline (same idiom as --ra-motion-*)
 * and use GLOW.sm/md/lg/ring.
 */
export const GLOW = {
  none: "none",
  sm: "var(--ra-glow-sm)",
  md: "var(--ra-glow-md)",
  lg: "var(--ra-glow-lg)",
  ring: "var(--ra-glow-ring)",
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

const readStoredUiState = () => readPyrusWorkspaceState();

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

export const setCurrentScale = (nextScale) => {
  CURRENT_SCALE =
    typeof nextScale === "string" &&
    Object.prototype.hasOwnProperty.call(SCALE_LEVELS, nextScale)
      ? nextScale
      : "m";

  return CURRENT_SCALE;
};

export const setCurrentDensity = (nextDensity) => {
  CURRENT_DENSITY =
    typeof nextDensity === "string" &&
    Object.prototype.hasOwnProperty.call(DENSITY_LEVELS, nextDensity)
      ? nextDensity
      : "compact";

  return CURRENT_DENSITY;
};

// Floor at the smallest authored type token (micro = 7), not above it. A 10px floor
// silently collapsed micro/label/control/tableHeader/tableCell/caption (7–9px) to a
// single 10px size, flattening the small-text hierarchy across the app (SYS-01).
export const fs = (n) => Math.max(7, Math.round(n * SCALE_FACTOR()));

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

      if (typeof prop === "string" && prop in CSS_COLOR) {
        return CSS_COLOR[prop];
      }

      if (typeof prop === "string") {
        return THEMES[CURRENT_THEME]?.[prop];
      }

      return undefined;
    },
  },
);

/**
 * G — gradient token proxy. Returns CSS var references (strings like
 * "var(--ra-gradient-...)") suitable for direct use in inline style
 * `background`, `background-image`, `mask-image`, etc.
 *
 * Each gradient resolves through CSS variables defined in index.css, so
 * accent-preset and theme changes propagate without re-rendering. Add a
 * new gradient here and a matching --ra-gradient-* declaration in :root.
 *
 *   surfaceTopHighlight — lit-from-above wash for cards and elevated surfaces
 *   hairlineDividerH    — horizontal hairline (transparent → border → transparent)
 *   hairlineDividerV    — vertical hairline (rotated 90°)
 *   accentSweep         — accent-colored horizontal sweep, for hover affordances
 *   dataBarPositive     — green vertical: bright top → faint bottom
 *   dataBarNegative     — red vertical:   faint top → bright bottom
 *   glassNav            — semi-transparent surface for backdrop-blur nav
 */
const G_TOKEN_VARS = {
  surfaceTopHighlight: "--ra-gradient-surface-top-highlight",
  hairlineDividerH: "--ra-gradient-hairline-divider-h",
  hairlineDividerV: "--ra-gradient-hairline-divider-v",
  accentSweep: "--ra-gradient-accent-sweep",
  dataBarPositive: "--ra-gradient-data-bar-positive",
  dataBarNegative: "--ra-gradient-data-bar-negative",
  glassNav: "--ra-gradient-glass-nav",
};

export const G = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const cssVar = G_TOKEN_VARS[prop];
      return cssVar ? `var(${cssVar})` : undefined;
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

export const resolveCssColor = (color, fallback = "") => {
  const value = String(color || "").trim();
  if (!value) return fallback;
  if (!value.includes("var(")) return value;
  if (
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return fallback || value;
  }

  const styles = window.getComputedStyle(document.documentElement);
  return resolveCssVarValue(styles, value) || fallback || value;
};

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { THEMES } from "../src/lib/uiTokens.jsx";

const ROOT = new URL("../", import.meta.url);
const INDEX_CSS_URL = new URL("src/index.css", ROOT);
const DESIGN_URL = new URL("../../DESIGN.md", ROOT);

const THEME_TOKEN_MAP = Object.freeze({
  bg0: "--ra-surface-0",
  bg1: "--ra-surface-1",
  bg2: "--ra-surface-2",
  bg3: "--ra-surface-3",
  bg4: "--ra-surface-4",
  border: "--ra-border-default",
  borderLight: "--ra-border-light",
  borderFocus: "--ra-border-focus",
  text: "--ra-text-primary",
  textSec: "--ra-text-secondary",
  textDim: "--ra-text-dim",
  textMuted: "--ra-text-muted",
  accent: "--ra-color-accent",
  accentDim: "--ra-accent-dim",
  accentHoverBg: "--ra-accent-hover-bg",
  accentActiveBg: "--ra-accent-active-bg",
  green: "--ra-green-500",
  greenDim: "--ra-green-dim",
  greenBg: "--ra-green-bg",
  red: "--ra-red-500",
  redDim: "--ra-red-dim",
  redBg: "--ra-red-bg",
  amber: "--ra-amber-500",
  amberDim: "--ra-amber-dim",
  amberBg: "--ra-amber-bg",
  blue: "--ra-blue-500",
  purple: "--ra-purple-500",
  cyan: "--ra-cyan-500",
  pink: "--ra-pink-500",
  onAccent: "--ra-on-accent",
  pulseLive: "--ra-green-500",
  pulseAlert: "--ra-amber-500",
  pulseLoss: "--ra-red-500",
});

const REQUIRED_DESIGN_SECTIONS = [
  "## Source Of Truth",
  "## Workspace Frame And Chrome",
  "## Typography And Density",
  "## Surfaces And Elevation",
  "## Interaction And Motion",
  "## Conformance Review",
];

const NORMAL_TEXT_FOREGROUNDS = [
  "text",
  "textSec",
  "textDim",
  "textMuted",
  "accent",
  "green",
  "red",
  "amber",
  "blue",
  "cyan",
  "pink",
  "purple",
];

const TONE_SURFACE_PAIRS = [
  ["accent", "accentDim"],
  ["green", "greenDim"],
  ["red", "redDim"],
  ["amber", "amberDim"],
];

const ACCENT_PRESETS = ["pyrus", "coral", "amber", "green", "aurora"];
const MIN_NORMAL_TEXT_CONTRAST = 4.5;

const readBalancedBlock = (source, selector) => {
  const marker = `${selector} {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing CSS block: ${selector}`);
  const bodyStart = start + marker.length;
  let depth = 1;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart, index);
  }
  throw new Error(`Unclosed CSS block: ${selector}`);
};

const parseCustomProperties = (block) => {
  const declarations = new Map();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
};

const mergeDeclarations = (...maps) => {
  const merged = new Map();
  maps.forEach((map) => map.forEach((value, key) => merged.set(key, value)));
  return merged;
};

const resolveCustomProperty = (declarations, property, seen = new Set()) => {
  assert.ok(!seen.has(property), `Circular CSS custom property: ${property}`);
  const value = declarations.get(property);
  assert.ok(value, `Missing CSS custom property: ${property}`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (!reference) return value;
  return resolveCustomProperty(
    declarations,
    reference[1],
    new Set([...seen, property]),
  );
};

const normalizeCssValue = (value) =>
  String(value).trim().toLowerCase().replace(/\s+/g, "");

const parseHex = (value) => {
  const normalized = String(value).trim();
  assert.match(normalized, /^#[0-9a-f]{6}$/i, `Expected a six-digit hex color: ${value}`);
  return normalized
    .slice(1)
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16) / 255);
};

const relativeLuminance = (value) => {
  const [red, green, blue] = parseHex(value).map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground, background) => {
  const high = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const low = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (high + 0.05) / (low + 0.05);
};

const assertContrast = (foreground, background, label) => {
  const ratio = contrastRatio(foreground, background);
  assert.ok(
    ratio >= MIN_NORMAL_TEXT_CONTRAST,
    `${label} contrast ${ratio.toFixed(2)}:1 is below ${MIN_NORMAL_TEXT_CONTRAST}:1`,
  );
};

const indexCss = await readFile(INDEX_CSS_URL, "utf8");
const designDoc = await readFile(DESIGN_URL, "utf8");

const rootDeclarations = parseCustomProperties(readBalancedBlock(indexCss, ":root"));
const lightDeclarations = mergeDeclarations(
  rootDeclarations,
  parseCustomProperties(
    readBalancedBlock(indexCss, ':root[data-pyrus-theme="light"]'),
  ),
);
const declarationsByTheme = {
  dark: rootDeclarations,
  light: lightDeclarations,
};

for (const mode of ["dark", "light"]) {
  const theme = THEMES[mode];
  const declarations = declarationsByTheme[mode];

  for (const [themeKey, cssProperty] of Object.entries(THEME_TOKEN_MAP)) {
    assert.equal(
      normalizeCssValue(theme[themeKey]),
      normalizeCssValue(resolveCustomProperty(declarations, cssProperty)),
      `${mode}.${themeKey} must match ${cssProperty}`,
    );
  }

  for (const foregroundKey of NORMAL_TEXT_FOREGROUNDS) {
    for (const backgroundKey of ["bg0", "bg1", "bg2"]) {
      assertContrast(
        theme[foregroundKey],
        theme[backgroundKey],
        `${mode}.${foregroundKey} on ${backgroundKey}`,
      );
    }
  }

  for (const [foregroundKey, backgroundKey] of TONE_SURFACE_PAIRS) {
    assertContrast(
      theme[foregroundKey],
      theme[backgroundKey],
      `${mode}.${foregroundKey} on ${backgroundKey}`,
    );
  }

  for (const backgroundKey of ["accent", "green", "red", "amber"]) {
    assertContrast(
      theme.onAccent,
      theme[backgroundKey],
      `${mode}.onAccent on ${backgroundKey}`,
    );
  }
}

for (const preset of ACCENT_PRESETS) {
  const darkPreset = mergeDeclarations(
    rootDeclarations,
    parseCustomProperties(
      readBalancedBlock(indexCss, `:root[data-pyrus-accent-preset="${preset}"]`),
    ),
  );
  const lightPreset = mergeDeclarations(
    lightDeclarations,
    parseCustomProperties(
      readBalancedBlock(
        indexCss,
        `:root[data-pyrus-accent-preset="${preset}"][data-pyrus-theme="light"]`,
      ),
    ),
  );
  assertContrast(
    THEMES.dark.onAccent,
    resolveCustomProperty(darkPreset, "--ra-accent-500"),
    `dark ${preset} accent foreground`,
  );
  assertContrast(
    THEMES.light.onAccent,
    resolveCustomProperty(lightPreset, "--ra-accent-500"),
    `light ${preset} accent foreground`,
  );
}

for (const section of REQUIRED_DESIGN_SECTIONS) {
  assert.ok(designDoc.includes(section), `DESIGN.md is missing ${section}`);
}

console.log("PYRUS design conformance guard passed.");

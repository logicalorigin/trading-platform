import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ELEVATION,
  MAX_WIDTHS,
  RADII,
  THEMES,
  TYPOGRAPHY_SIZES,
  dim,
  fs,
  resolveEffectiveThemePreference,
  setCurrentScale,
  setCurrentTheme,
  textSize,
} from "./uiTokens.jsx";

const REQUIRED_PALETTE_KEYS = [
  "bg0",
  "bg1",
  "bg2",
  "bg3",
  "bg4",
  "border",
  "borderLight",
  "borderFocus",
  "text",
  "textSec",
  "textDim",
  "textMuted",
  "accent",
  "accentDim",
  "green",
  "greenDim",
  "greenBg",
  "red",
  "redDim",
  "redBg",
  "amber",
  "amberDim",
  "amberBg",
  "blue",
  "purple",
  "cyan",
  "pink",
  "onAccent",
  "pulseLive",
  "pulseAlert",
  "pulseLoss",
];

const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

const collectSourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [fullPath] : [];
  });

test("THEMES.dark and THEMES.light expose the full warm palette", () => {
  for (const mode of ["dark", "light"]) {
    const palette = THEMES[mode];
    assert.ok(palette, `THEMES.${mode} should exist`);
    for (const key of REQUIRED_PALETTE_KEYS) {
      assert.equal(
        typeof palette[key],
        "string",
        `THEMES.${mode}.${key} should be a string`,
      );
    }
  }
});

test("redesign brand accent is the terracotta family on both themes", () => {
  assert.equal(THEMES.dark.accent, "#E08F76");
  assert.equal(THEMES.light.accent, "#D97757");
  assert.equal(THEMES.dark.borderFocus, "#E08F76");
  assert.equal(THEMES.light.borderFocus, "#D97757");
});

test("pulse-state aliases mirror green/amber/red on both themes", () => {
  assert.equal(THEMES.dark.pulseLive, THEMES.dark.green);
  assert.equal(THEMES.dark.pulseAlert, THEMES.dark.amber);
  assert.equal(THEMES.dark.pulseLoss, THEMES.dark.red);
  assert.equal(THEMES.light.pulseLive, THEMES.light.green);
  assert.equal(THEMES.light.pulseAlert, THEMES.light.amber);
  assert.equal(THEMES.light.pulseLoss, THEMES.light.red);
});

test("TYPOGRAPHY_SIZES exposes the public-style display roles", () => {
  for (const role of [
    "displayHero",
    "displayLarge",
    "displayMedium",
    "displaySmall",
    "paragraph",
    "paragraphMuted",
  ]) {
    assert.equal(
      typeof TYPOGRAPHY_SIZES[role],
      "number",
      `TYPOGRAPHY_SIZES.${role} should be a number`,
    );
  }
  assert.ok(
    TYPOGRAPHY_SIZES.displayHero > TYPOGRAPHY_SIZES.displayLarge,
    "displayHero should be larger than displayLarge",
  );
  assert.ok(
    TYPOGRAPHY_SIZES.displayLarge > TYPOGRAPHY_SIZES.displayMedium,
    "displayLarge should be larger than displayMedium",
  );
});

test("textSize returns a positive number for known and unknown roles", () => {
  setCurrentScale("m");
  for (const role of [
    "displayHero",
    "displayLarge",
    "displayMedium",
    "displaySmall",
    "paragraph",
    "caption",
    "body",
  ]) {
    const value = textSize(role);
    assert.equal(typeof value, "number");
    assert.ok(value >= 10, `textSize(${role}) should be at least the min 10px`);
  }
  assert.equal(typeof textSize("not-a-real-role"), "number");
});

test("files using textSize import it from the concrete uiTokens module", () => {
  const offenders = collectSourceFiles(SRC_DIR)
    .filter((filePath) => !filePath.endsWith("uiTokens.jsx"))
    .filter((filePath) => !filePath.endsWith("uiTokens.test.js"))
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      if (!/\btextSize\s*\(/.test(source)) {
        return false;
      }
      return !/import\s*\{[\s\S]*?\btextSize\b[\s\S]*?\}\s*from\s*["'][^"']*uiTokens\.jsx["']/.test(
        source,
      );
    })
    .map((filePath) => relative(SRC_DIR, filePath).replaceAll("\\", "/"))
    .sort();

  assert.deepEqual(offenders, []);
});

test("MAX_WIDTHS exposes the three documented sizes plus full-width opt-out", () => {
  assert.equal(MAX_WIDTHS.reading, 720);
  assert.equal(MAX_WIDTHS.content, 1280);
  assert.equal(MAX_WIDTHS.cockpit, 1600);
  assert.equal(MAX_WIDTHS.full, null);
});

test("RADII and ELEVATION expose the primitives Button/Input/Stat rely on", () => {
  assert.equal(RADII.pill, 999);
  assert.equal(typeof RADII.md, "number");
  assert.equal(typeof RADII.sm, "number");
  for (const level of ["none", "sm", "md", "lg"]) {
    assert.equal(typeof ELEVATION[level], "string");
  }
  // Layered elevation tokens resolve through CSS vars (per-theme depth).
  for (const level of ["sm", "md", "lg", "hover"]) {
    assert.match(ELEVATION[level], /^var\(--ra-elevation-/);
  }
});

test("layered elevation: every level stacks ≥2 shadows in CSS", () => {
  // Modern elevation depth comes from a stack (ambient + key + inset
  // highlight) rather than a single drop shadow. This test pins the
  // dark-theme recipe — comma-separated shadow list with at least 2
  // entries per level so a future single-shadow regression fails loud.
  const cssSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
    "utf8",
  );
  for (const level of ["sm", "md", "lg"]) {
    const match = cssSource.match(
      new RegExp(`--ra-elevation-${level}:[\\s\\S]*?;`),
    );
    assert.ok(match, `--ra-elevation-${level} not declared`);
    const value = match[0];
    const commas = (value.match(/,/g) || []).length;
    assert.ok(
      commas >= 1,
      `--ra-elevation-${level} must stack ≥2 shadows (had ${commas + 1})`,
    );
  }
  // Hover overlay must use accent color-mix so it flexes with accent
  // preset (Coral / Amber / Green / Aurora).
  const hover = cssSource.match(/--ra-elevation-hover:[\s\S]*?;/);
  assert.ok(hover, "--ra-elevation-hover not declared");
  assert.match(hover[0], /color-mix\([\s\S]*?--ra-color-accent/);
});

test("resolveEffectiveThemePreference respects explicit preference and fallback", () => {
  assert.equal(resolveEffectiveThemePreference("dark"), "dark");
  assert.equal(resolveEffectiveThemePreference("light"), "light");
  assert.equal(resolveEffectiveThemePreference(undefined, "dark"), "dark");
  assert.equal(resolveEffectiveThemePreference(null, "light"), "light");
  const systemResult = resolveEffectiveThemePreference("system");
  assert.ok(
    systemResult === "dark" || systemResult === "light",
    "system preference should resolve to a real theme",
  );
});

test("setCurrentTheme rejects unknown themes and returns the applied theme", () => {
  const applied = setCurrentTheme("dark");
  assert.equal(applied, "dark");
  const fallback = setCurrentTheme("does-not-exist");
  assert.equal(fallback, "light");
  setCurrentTheme("dark");
});

test("fs and dim scale and round numerically with the active scale", () => {
  setCurrentScale("m");
  assert.equal(fs(12), 12);
  assert.equal(dim(20), 20);
  setCurrentScale("l");
  assert.ok(fs(12) > 12);
  assert.ok(dim(20) >= 20);
  setCurrentScale("m");
});

test("motion: error-shake keyframe + class + reduced-motion override", () => {
  // raErrorShake is the only horizontal-jitter motion in the app. The
  // class must respect prefers-reduced-motion AND the
  // data-rayalgo-reduced-motion="on" opt-in, so users who explicitly
  // disable motion don't see the jitter on invalid submits.
  const cssSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
    "utf8",
  );

  assert.match(cssSource, /@keyframes raErrorShake \{/);
  assert.match(
    cssSource,
    /\.ra-error-shake \{[\s\S]*?animation: raErrorShake 280ms/,
  );
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.ra-error-shake[\s\S]*?animation: none/,
  );
  assert.match(
    cssSource,
    /html\[data-rayalgo-reduced-motion="on"\] \.ra-error-shake[\s\S]*?animation: none/,
  );
});

test("motion roles documented in motion.jsx", () => {
  // motion.jsx must carry the role-table comment block so future
  // contributors know which timing/easing pair goes with which role.
  // Pinned as a regression guard — if someone removes it during a
  // refactor, this test fails loud.
  const motionSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "motion.jsx"),
    "utf8",
  );
  assert.match(motionSource, /RayAlgo motion roles/);
  for (const role of [
    "entrance",
    "hover",
    "active-press",
    "selection-change",
    "value-flash",
    "error-shake",
  ]) {
    assert.match(motionSource, new RegExp(role), `motion role "${role}" missing from doc`);
  }
});

test("global scrollbar uses --ra-border-default + brightens on hover", () => {
  // Scrollbar thumb must color-mix through --ra-border-default so it
  // flexes with theme. Hover state brightens to --ra-color-accent so
  // the active-grab affordance matches the rest of the UI's accent.
  // The .chart-widget-menu has its own ::-webkit-scrollbar-thumb rule
  // for the chart menu's themed scrollbar — find the GLOBAL rule
  // (unscoped, no parent selector).
  const cssSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
    "utf8",
  );

  const globalBaseMatches = cssSource.match(
    /^::-webkit-scrollbar-thumb \{[\s\S]*?^\}/gm,
  );
  assert.ok(
    globalBaseMatches && globalBaseMatches.length >= 1,
    "global ::-webkit-scrollbar-thumb rule not declared",
  );
  // The last one is the global rule (declared later in the file).
  const baseRule = globalBaseMatches[globalBaseMatches.length - 1];
  assert.match(baseRule, /color-mix\([\s\S]*?--ra-border-default/);
  assert.match(baseRule, /background-clip: padding-box/);

  const hoverRule = cssSource.match(
    /^::-webkit-scrollbar-thumb:hover \{[\s\S]*?^\}/m,
  );
  assert.ok(hoverRule, "global ::-webkit-scrollbar-thumb:hover not declared");
  assert.match(hoverRule[0], /color-mix\([\s\S]*?--ra-color-accent/);

  // Firefox scrollbar-color via the universal rule.
  assert.match(
    cssSource,
    /\* \{[\s\S]*?scrollbar-color: color-mix\([\s\S]*?--ra-border-default/,
  );
});

test("scroll-fade utility classes feather edges via mask-image", () => {
  // .ra-scroll-fade-y / -x apply a linear-gradient mask that fades the
  // first and last 16px to transparent — softens the abrupt edge of a
  // scrolling list against the surrounding panel.
  const cssSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
    "utf8",
  );

  const fadeY = cssSource.match(/\.ra-scroll-fade-y \{[\s\S]*?\}/);
  const fadeX = cssSource.match(/\.ra-scroll-fade-x \{[\s\S]*?\}/);
  assert.ok(fadeY, ".ra-scroll-fade-y not declared");
  assert.ok(fadeX, ".ra-scroll-fade-x not declared");

  assert.match(fadeY[0], /mask-image: linear-gradient\(\s*180deg/);
  assert.match(fadeY[0], /-webkit-mask-image: linear-gradient\(\s*180deg/);
  assert.match(fadeY[0], /transparent 0[,\s]/);
  assert.match(fadeY[0], /black 16px/);

  assert.match(fadeX[0], /mask-image: linear-gradient\(\s*90deg/);
});

test("hairline divider classes use G.hairlineDivider gradients", () => {
  // .ra-hairline-h / .ra-hairline-v render a 1px line via the
  // G.hairlineDividerH / G.hairlineDividerV gradients (transparent →
  // border → transparent), softer than border-bottom: 1px solid. The
  // class must be 1px tall (or 1px wide), have no border (the gradient
  // IS the line), and reference the gradient CSS var.
  const cssSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
    "utf8",
  );

  const hMatch = cssSource.match(/\.ra-hairline-h \{[\s\S]*?\}/);
  const vMatch = cssSource.match(/\.ra-hairline-v \{[\s\S]*?\}/);
  assert.ok(hMatch, ".ra-hairline-h not declared");
  assert.ok(vMatch, ".ra-hairline-v not declared");

  assert.match(hMatch[0], /height: 1px/);
  assert.match(hMatch[0], /background: var\(--ra-gradient-hairline-divider-h\)/);
  assert.match(hMatch[0], /border: none/);

  assert.match(vMatch[0], /width: 1px/);
  assert.match(vMatch[0], /background: var\(--ra-gradient-hairline-divider-v\)/);
  assert.match(vMatch[0], /border: none/);
});

test("G proxy returns CSS var refs for every gradient token", async () => {
  // The G proxy MUST return "var(--ra-gradient-...)" strings (never
  // raw hex / rgba) — that's the only way accent-preset + theme
  // changes flex through inline-styled JSX without re-resolving on
  // every render.
  const { G } = await import("./uiTokens.jsx");

  const expected = {
    surfaceTopHighlight: "--ra-gradient-surface-top-highlight",
    hairlineDividerH: "--ra-gradient-hairline-divider-h",
    hairlineDividerV: "--ra-gradient-hairline-divider-v",
    accentSweep: "--ra-gradient-accent-sweep",
    dataBarPositive: "--ra-gradient-data-bar-positive",
    dataBarNegative: "--ra-gradient-data-bar-negative",
    glassNav: "--ra-gradient-glass-nav",
  };

  for (const [key, cssVar] of Object.entries(expected)) {
    assert.equal(G[key], `var(${cssVar})`, `G.${key} should be var(${cssVar})`);
  }

  // Unknown keys return undefined (so typos surface as bugs rather
  // than silently returning a working but wrong string).
  assert.equal(G.thisDoesNotExist, undefined);
});

test("every G gradient token has a matching --ra-gradient-* CSS declaration", () => {
  // Pins the cross-file invariant: every G.* token's CSS var must
  // actually be declared in index.css so the gradient resolves at
  // paint time.
  const cssSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
    "utf8",
  );
  const requiredVars = [
    "--ra-gradient-surface-top-highlight",
    "--ra-gradient-hairline-divider-h",
    "--ra-gradient-hairline-divider-v",
    "--ra-gradient-accent-sweep",
    "--ra-gradient-data-bar-positive",
    "--ra-gradient-data-bar-negative",
    "--ra-gradient-glass-nav",
  ];
  for (const varName of requiredVars) {
    assert.match(
      cssSource,
      new RegExp(`${varName.replace(/-/g, "\\-")}:`),
      `index.css must declare ${varName}`,
    );
  }
  // Gradient defs must compose through other CSS vars (not raw hex/rgba)
  // so they flex with theme + accent changes.
  const grad = cssSource.match(
    /--ra-gradient-data-bar-positive:[\s\S]*?\);/,
  );
  assert.ok(grad, "data-bar-positive gradient not found");
  assert.match(grad[0], /var\(--ra-color-pnl-positive\)/);
});

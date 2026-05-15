import assert from "node:assert/strict";
import test from "node:test";

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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");

const indexHtml = read("index.html");
const indexCss = read("src/index.css");
const brandLoader = read("src/components/BrandLoader.tsx");
const pyrusLoaderMark = read("src/components/brand/pyrus-loader-mark.tsx");
const pyrusMark = read("src/components/brand/pyrus-mark.tsx");
const platformShell = read("src/features/platform/PlatformShell.jsx");
const screenRegistry = read("src/features/platform/screenRegistry.jsx");

test("React boot loader uses theme tokens instead of forcing dark mode", () => {
  assert.doesNotMatch(brandLoader, /data-theme="dark"/);
  assert.doesNotMatch(brandLoader, /BRAND_LOADER_(?:SHELL|PANEL)_BG = "#050914"/);
  assert.match(brandLoader, /var\(--ra-surface-0, #F7FAFF\)/);
  assert.match(brandLoader, /PyrusWordmark/);
  assert.doesNotMatch(indexCss, /\.brand-loader-word\s*\{[^}]*mix-blend-mode:\s*screen/s);
});

test("static boot loader has a light default and an explicit dark override", () => {
  assert.match(indexHtml, /\.pyrus-boot-loader\s*\{[^}]*background: #F7FAFF/s);
  assert.match(
    indexHtml,
    /html\[data-pyrus-theme="dark"\] \.pyrus-boot-loader\s*\{[^}]*background: #050914/s,
  );
  assert.match(indexHtml, /pyrus-wordmark-tight-light\.png/);
});

test("boot and React loaders use the primary Pyrus mark asset", () => {
  for (const source of [indexHtml, pyrusLoaderMark, pyrusMark]) {
    assert.doesNotMatch(source, /pyrus-loader-mark-dark\.svg/);
    assert.match(source, /pyrus-mark-dark\.svg/);
  }
});

test("lazy screen fallbacks use the platform theme variables", () => {
  for (const source of [platformShell, screenRegistry]) {
    assert.doesNotMatch(source, /var\(--background, #0[25]0[68]1[47]\)/);
    assert.match(source, /var\(--ra-surface-0, #F7FAFF\)/);
  }
  assert.doesNotMatch(screenRegistry, /var\(--foreground, #f8fafc\)/);
});

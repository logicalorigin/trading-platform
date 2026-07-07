import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");

const indexHtml = read("index.html");
const indexCss = read("src/index.css");
const viteConfig = read("vite.config.ts");
const bootNeural = read("src/boot-neural.tsx");
const bootNeuralScene = read("src/boot-neural-scene.tsx");
const appContent = read("src/app/AppContent.tsx");
const brandLoader = read("src/components/BrandLoader.tsx");
const crashDiagnostics = read("src/app/crashDiagnostics.tsx");
const appHeader = read("src/features/platform/AppHeader.jsx");
const platformApp = read("src/features/platform/PlatformApp.jsx");
const pyrusLoaderMark = read("src/components/brand/pyrus-loader-mark.tsx");
const pyrusLogo = read("src/components/brand/PyrusLogo.tsx");
const pyrusMark = read("src/components/brand/pyrus-mark.tsx");
const pyrusWordmark = read("src/components/brand/pyrus-wordmark.tsx");
const platformShell = read("src/features/platform/PlatformShell.jsx");
const screenRegistry = read("src/features/platform/screenRegistry.jsx");

test("React boot loader uses theme tokens instead of forcing dark mode", () => {
  assert.doesNotMatch(brandLoader, /data-theme="dark"/);
  assert.doesNotMatch(brandLoader, /BRAND_LOADER_(?:SHELL|PANEL)_BG = "#050914"/);
  assert.match(brandLoader, /var\(--ra-surface-0, #F7FAFF\)/);
  assert.match(brandLoader, /PyrusWordmark/);
  assert.doesNotMatch(brandLoader, /<img\b/);
  assert.doesNotMatch(indexCss, /\.brand-loader-word\s*\{[^}]*mix-blend-mode:\s*screen/s);
});

test("static boot loader has a light default and an explicit dark override", () => {
  assert.match(indexHtml, /\.pyrus-boot-loader\s*\{[^}]*background: #F7FAFF/s);
  assert.match(
    indexHtml,
    /html\[data-pyrus-theme="dark"\] \.pyrus-boot-loader\s*\{[^}]*background: #050914/s,
  );
  assert.match(indexHtml, /id="pyrus-boot-neural-root"/);
  assert.doesNotMatch(indexHtml, /src="\/src\/boot-neural\.tsx"/);
  assert.match(viteConfig, /BOOT_NEURAL_SOURCE_MODULE = "\/src\/boot-neural\.tsx"/);
  assert.match(
    viteConfig,
    /BOOT_NEURAL_SCENE_SOURCE_MODULE = "\/src\/boot-neural-scene\.tsx"/,
  );
  assert.match(viteConfig, /bootNeuralHtmlEntryPlugin/);
  assert.match(viteConfig, /__PYRUS_BOOT_NEURAL_SCENE_URL__/);
  assert.match(viteConfig, /facadeModuleId/);
  assert.match(viteConfig, /devInjectTo = "head"/);
  assert.match(viteConfig, /productionInjectTo = "head-prepend"/);
  assert.match(viteConfig, /"boot-neural": path\.resolve\(import\.meta\.dirname, "src\/boot-neural\.tsx"\)/);
  assert.match(viteConfig, /"boot-neural-scene": path\.resolve\(/);
  assert.match(indexHtml, /<div class="pyrus-boot-word">PYRUS<\/div>/);
  assert.match(bootNeural, /NeuralCoreScene/);
  assert.match(bootNeural, /__PYRUS_BOOT_NEURAL_SCENE_URL__/);
  assert.match(bootNeural, /@vite-ignore/);
  assert.match(bootNeural, /EMPTY_BOOT_NEURAL_SCENE/);
  assert.match(bootNeural, /sceneModule\.default \?\? sceneModule\.n/);
  assert.match(bootNeural, /sceneExport\?\.default/);
  assert.match(bootNeural, /isWebglAvailable/);
  assert.doesNotMatch(bootNeural, /from "@\/lib\/webglCapability"/);
  assert.doesNotMatch(bootNeural, /@\/components\/marketing\/neural-core-scene/);
  assert.match(
    bootNeuralScene,
    /import NeuralCoreScene from "@\/components\/marketing\/neural-core-scene"/,
  );
  assert.match(bootNeuralScene, /export default NeuralCoreScene/);
});

test("launch and header brand surfaces use neural resolve animation", () => {
  assert.match(appContent, /NeuralLoader/);
  assert.doesNotMatch(appContent, /LogoLoader/);
  assert.match(platformApp, /NeuralLoader/);
  assert.doesNotMatch(platformApp, /LogoLoader/);
  assert.match(appHeader, /BrandResolve/);
  assert.match(appHeader, /HEADER_MARK_SPHERE_PROPS/);
  assert.match(appHeader, /webglPolicy="available"/);
});

test("React loaders use the current Pyrus brand kit assets", () => {
  assert.doesNotMatch(indexHtml, /\/brand\//);
  assert.doesNotMatch(crashDiagnostics, /\/brand\//);
  assert.match(pyrusLoaderMark, /PyrusMark/);
  assert.match(pyrusMark, /\/brand\/pyrus-mark\.svg/);
  assert.match(pyrusWordmark, /\/brand\/pyrus-wordmark-tight\.png/);
  assert.match(pyrusWordmark, /\/brand\/pyrus-wordmark-tight-light\.png/);

  for (const source of [pyrusLoaderMark, pyrusMark, pyrusWordmark]) {
    assert.doesNotMatch(source, /pyrus-loader-mark-dark\.svg/);
    assert.doesNotMatch(source, /pyrus-mark\.png/);
  }
});

test("PyrusWordmark stays owned by the wordmark module", () => {
  assert.doesNotMatch(
    pyrusLogo,
    /export\s*\{\s*PyrusWordmark\s*\}/,
    "Expected PyrusLogo to avoid re-exporting the wordmark component",
  );
});

test("lazy screen fallbacks use the platform theme variables", () => {
  for (const source of [platformShell, screenRegistry]) {
    assert.doesNotMatch(source, /var\(--background, #0[25]0[68]1[47]\)/);
    assert.match(source, /var\(--ra-surface-0, #F7FAFF\)/);
  }
  assert.doesNotMatch(screenRegistry, /var\(--foreground, #f8fafc\)/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (relativePath) =>
  readFileSync(new URL(relativePath, root), "utf8");
const exists = (relativePath) => existsSync(new URL(relativePath, root));
const size = (relativePath) => statSync(new URL(relativePath, root)).size;

const requiredFiles = [
  "src/components/marketing/neural-core/NeuralCore.tsx",
  "src/components/marketing/neural-core/helpers.ts",
  "src/components/marketing/neural-core/shaders.ts",
  "src/components/marketing/neural-core/types.ts",
  "src/components/marketing/neural-core/index.ts",
  "src/components/marketing/neural-core/pyrus-logo-points.ts",
  "src/components/marketing/neural-core-scene.tsx",
  "src/components/marketing/brand-resolve.tsx",
  "src/components/marketing/pyrus-mark.tsx",
  "src/components/marketing/pyrus-mark-shared.tsx",
  "src/components/marketing/use-prefers-reduced-motion.ts",
  "src/components/marketing/pyrus-logo.standalone.tsx",
  "src/lib/observe-visibility.ts",
  "src/lib/pyrus-mark-geometry.ts",
  "src/styles/brand.css",
  "public/brand/pyrus-wordmark-tight.png",
  "public/brand/pyrus-mark.svg",
  "public/brand/pyrus-mark-dark.svg",
];

const retiredFiles = [
  "src/components/marketing/pyrus-mark-3d.tsx",
  "src/components/marketing/pyrus-mark-3d-scene.tsx",
];

test("brand kit compatibility entry points and assets are installed", () => {
  for (const file of requiredFiles) {
    assert.ok(exists(file), `Expected ${file} to exist`);
  }
  for (const file of retiredFiles) {
    assert.equal(exists(file), false, `Expected ${file} to be removed`);
  }

  const indexCss = read("src/index.css");
  assert.match(indexCss, /@import "\.\/styles\/brand\.css";/);

  const wordmark = read("src/components/brand/pyrus-wordmark.tsx");
  assert.match(wordmark, /\/brand\/pyrus-wordmark-tight\.png/);

  assert.ok(
    size("src/components/marketing/neural-core/pyrus-logo-points.ts") > 2_000_000,
    "Expected source sampled Pyrus logo point cloud, not a placeholder",
  );
  assert.doesNotMatch(
    read("src/components/marketing/neural-core/helpers.ts"),
    /pyrus-wordmark-points|PYRUS_WORDMARK_PTS/,
  );

  const reducedMotionHook = read(
    "src/components/marketing/use-prefers-reduced-motion.ts",
  );
  assert.match(reducedMotionHook, /MutationObserver/);
  assert.match(reducedMotionHook, /data-pyrus-reduced-motion/);
});

test("adapted neural install does not import react-three-fiber", () => {
  for (const file of requiredFiles.filter((path) => path.startsWith("src/"))) {
    assert.doesNotMatch(read(file), /@react-three\/fiber/);
  }
});

test("neural cloud is only wired to loader surfaces", () => {
  const app = read("src/app/App.tsx");
  // The immersive loader layout (cloud + brand) is shared by the boot curtain
  // and the app/workspace loaders via BootShellLayout.
  const bootShell = read("src/components/neural/BootShellLayout.tsx");
  const neuralLoader = read("src/components/neural/NeuralLoader.tsx");
  const brandResolve = read("src/components/marketing/brand-resolve.tsx");
  const neuralCanvas = read("src/components/neural/NeuralCanvas.tsx");
  const neuralTypes = read("src/components/neural/neural-core/types.ts");

  assert.doesNotMatch(app, /NeuralBackdrop|neural-backdrop/);
  assert.doesNotMatch(app, /LogoLoader/);
  assert.match(app, /NeuralLoader/);
  // NeuralLoader delegates its rendered surface to the shared BootShellLayout.
  assert.match(neuralLoader, /BootShellLayout/);
  assert.match(bootShell, /BrandResolve/);
  assert.match(bootShell, /NeuralCoreScene/);
  assert.match(bootShell, /isNeuralWebglRendererSupported/);
  assert.doesNotMatch(bootShell, /canUseWebGL/);
  assert.match(brandResolve, /NeuralCoreScene/);
  assert.match(brandResolve, /isWebglAvailable/);
  assert.match(brandResolve, /morph/);
  assert.doesNotMatch(neuralCanvas, /ambient/);
  assert.doesNotMatch(neuralTypes, /ambient/);
});

test("shared loader runs capability hooks before rendering", () => {
  const bootShell = read("src/components/neural/BootShellLayout.tsx");
  const brandResolve = read("src/components/marketing/brand-resolve.tsx");
  const bootShellLayoutBody = bootShell.slice(
    bootShell.indexOf("export function BootShellLayout"),
  );
  const reducedMotionHook = bootShellLayoutBody.indexOf(
    "const reducedMotion = usePrefersReducedMotion();",
  );
  const returnIdx = bootShellLayoutBody.indexOf("return (");

  assert.notEqual(reducedMotionHook, -1);
  assert.notEqual(returnIdx, -1);
  assert.ok(
    reducedMotionHook < returnIdx,
    "Expected BootShellLayout capability hooks to run before its render",
  );
  // NeuralLoader still short-circuits to the static loader while the opener owns
  // a WebGL context.
  assert.match(read("src/components/neural/NeuralLoader.tsx"), /if \(isNeuralOpenerActive\(\)\)/);
  assert.match(
    brandResolve,
    /const showSphere =\s+mounted && !sphereFailed && !reducedMotion && isWebglAvailable\(\)/,
  );
  assert.match(brandResolve, /componentDidCatch\(\) \{\s+this\.props\.onError\(\);/);
});

test("brand resolve keeps only the live app rendering contract", () => {
  const brandResolve = read("src/components/marketing/brand-resolve.tsx");
  const brandCss = read("src/styles/brand.css");

  assert.doesNotMatch(
    brandResolve,
    /\b(openOnDots|suppressCrisp|dotsAreMark|webglPolicy|logoVariant|sphereMask)\b/,
  );
  assert.doesNotMatch(brandResolve, /morphDriveRef\?:/);
  assert.doesNotMatch(
    brandCss,
    /brand-resolve-(sphere|logo|guide)/,
  );
  assert.doesNotMatch(brandCss, /brand-loader-word--resolve|pyrus-splash-pulse/);
});

test("brand motion honors the app reduced-motion preference", () => {
  const brandCss = read("src/styles/brand.css");

  assert.match(
    brandCss,
    /html\[data-pyrus-reduced-motion="on"\] \.pyrus-ring\s*\{[^}]*animation:\s*none/s,
  );
});

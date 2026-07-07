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
  "src/components/marketing/neural-core/pyrus-wordmark-points.ts",
  "src/components/marketing/neural-core-scene.tsx",
  "src/components/marketing/neural-stage.tsx",
  "src/components/marketing/neural-loader.tsx",
  "src/components/marketing/brand-loader.tsx",
  "src/components/marketing/brand-resolve.tsx",
  "src/components/marketing/pyrus-mark.tsx",
  "src/components/marketing/pyrus-mark-shared.tsx",
  "src/components/marketing/pyrus-mark-3d.tsx",
  "src/components/marketing/pyrus-mark-3d-scene.tsx",
  "src/components/marketing/pyrus-logo.standalone.tsx",
  "src/lib/observe-visibility.ts",
  "src/lib/pyrus-mark-geometry.ts",
  "src/styles/brand.css",
  "public/brand/pyrus-wordmark-tight.png",
  "public/brand/pyrus-mark.svg",
  "public/brand/pyrus-mark-dark.svg",
];

test("brand kit compatibility entry points and assets are installed", () => {
  for (const file of requiredFiles) {
    assert.ok(exists(file), `Expected ${file} to exist`);
  }

  const indexCss = read("src/index.css");
  assert.match(indexCss, /@import "\.\/styles\/brand\.css";/);

  const wordmark = read("src/components/brand/pyrus-wordmark.tsx");
  assert.match(wordmark, /\/brand\/pyrus-wordmark-tight\.png/);

  assert.ok(
    size("src/components/marketing/neural-core/pyrus-logo-points.ts") > 2_000_000,
    "Expected source sampled Pyrus logo point cloud, not a placeholder",
  );
  assert.ok(
    size("src/components/marketing/neural-core/pyrus-wordmark-points.ts") > 30_000,
    "Expected source sampled Pyrus wordmark point cloud, not a placeholder",
  );
});

test("adapted neural install does not import react-three-fiber", () => {
  for (const file of requiredFiles.filter((path) => path.startsWith("src/"))) {
    assert.doesNotMatch(read(file), /@react-three\/fiber/);
  }
});

test("neural cloud is only wired to loader surfaces", () => {
  const app = read("src/app/App.tsx");
  const neuralLoader = read("src/components/neural/NeuralLoader.tsx");
  const brandResolve = read("src/components/marketing/brand-resolve.tsx");
  const neuralCanvas = read("src/components/neural/NeuralCanvas.tsx");
  const neuralTypes = read("src/components/neural/neural-core/types.ts");

  assert.doesNotMatch(app, /NeuralBackdrop|neural-backdrop/);
  assert.doesNotMatch(app, /LogoLoader/);
  assert.match(app, /NeuralLoader/);
  assert.match(neuralLoader, /BrandResolve/);
  assert.match(neuralLoader, /NeuralCoreScene/);
  assert.match(neuralLoader, /isWebglAvailable/);
  assert.doesNotMatch(neuralLoader, /canUseWebGL/);
  assert.match(neuralLoader, /webglPolicy="available"/);
  assert.match(brandResolve, /NeuralCoreScene/);
  assert.match(brandResolve, /webglPolicy/);
  assert.match(brandResolve, /morph/);
  assert.doesNotMatch(neuralCanvas, /ambient/);
  assert.doesNotMatch(neuralTypes, /ambient/);
});

test("neural loader keeps hooks before opener fallback", () => {
  const neuralLoader = read("src/components/neural/NeuralLoader.tsx");
  const reducedMotionHook = neuralLoader.indexOf(
    "const reducedMotion = usePrefersReducedMotion();",
  );
  const openerFallback = neuralLoader.indexOf("if (isNeuralOpenerActive())");

  assert.notEqual(reducedMotionHook, -1);
  assert.notEqual(openerFallback, -1);
  assert.ok(
    reducedMotionHook < openerFallback,
    "Expected NeuralLoader hooks to run before the opener-active fallback branch",
  );
});

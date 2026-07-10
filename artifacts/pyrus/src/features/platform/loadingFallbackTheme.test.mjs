import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");

const indexHtml = read("index.html");
const indexCss = read("src/index.css");
const bootShell = read("src/components/neural/BootShellLayout.tsx");
const viteConfig = read("vite.config.ts");
const appContent = read("src/app/AppContent.tsx");
const brandLoader = read("src/components/BrandLoader.tsx");
const brandResolve = read("src/components/marketing/brand-resolve.tsx");
const crashDiagnostics = read("src/app/crashDiagnostics.tsx");
const appHeader = read("src/features/platform/AppHeader.jsx");
const platformApp = read("src/features/platform/PlatformApp.jsx");
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
  // The pre-React fallback is a calm, single centered composition.
  assert.match(indexHtml, /\.pyrus-boot-loader\s*\{[^}]*#F7FAFF/s);
  assert.match(
    indexHtml,
    /html\[data-pyrus-theme="dark"\] \.pyrus-boot-loader\s*\{[^}]*#050914/s,
  );
  // The static boot loader renders the branded wordmark image (matching the
  // React BootShellScreen), not a plain-text PYRUS.
  assert.match(indexHtml, /class="pyrus-boot-wordmark"/);
  assert.match(indexHtml, /\/brand\/pyrus-wordmark-tight\.png/);
  assert.match(indexHtml, /\/brand\/pyrus-wordmark-tight-light\.png/);
  assert.doesNotMatch(indexHtml, /class="pyrus-boot-mark"/);
  assert.doesNotMatch(indexHtml, /class="pyrus-boot-content"/);
  assert.doesNotMatch(
    indexHtml,
    /\.pyrus-boot-loader\s*\{[^}]*grid-template-columns/s,
  );
  assert.doesNotMatch(indexHtml, /pyrus-boot-neural-root/);
  assert.doesNotMatch(viteConfig, /boot-neural/);
});

test("expanded neural atmosphere is present before the animated renderer loads", () => {
  const staticCloudAsset = new URL(
    "../../../public/brand/pyrus-neural-cloud.webp",
    import.meta.url,
  );

  assert.ok(existsSync(staticCloudAsset));
  assert.ok(statSync(staticCloudAsset).size > 10_000);
  assert.match(
    indexHtml,
    /rel="preload"[^>]+href="\/brand\/pyrus-neural-cloud\.webp"/,
  );
  assert.match(indexHtml, /class="pyrus-boot-cloud"/);
  assert.match(
    indexHtml,
    /class="pyrus-boot-cloud-static" src="data:image\/webp;base64,/,
  );
  const embeddedCloud = indexHtml.match(
    /class="pyrus-boot-cloud-static" src="data:image\/webp;base64,([^"]+)"/,
  );
  assert.ok(embeddedCloud);
  assert.deepEqual(
    Buffer.from(embeddedCloud[1], "base64"),
    readFileSync(staticCloudAsset),
  );
  assert.match(bootShell, /className="pyrus-boot-cloud-static"/);
  assert.match(bootShell, /\/brand\/pyrus-neural-cloud\.webp/);
  assert.match(bootShell, /particles:\s*22000/);
  assert.match(bootShell, /orbitCount:\s*9000/);
  assert.match(bootShell, /radius:\s*3\.1/);
  assert.match(bootShell, /tiltStrength:\s*0/);
  assert.match(indexCss, /\.pyrus-boot-cloud-live/);
});

test("loading surfaces animate while the persistent header mark stays static", () => {
  assert.match(appContent, /NeuralLoader/);
  assert.doesNotMatch(appContent, /LogoLoader/);
  assert.match(platformApp, /NeuralLoader/);
  assert.doesNotMatch(platformApp, /LogoLoader/);
  assert.match(appHeader, /PyrusMark/);
  assert.doesNotMatch(appHeader, /BrandResolve|HEADER_MARK_SPHERE_PROPS/);
  assert.match(brandResolve, /isWebglAvailable/);
});

test("React loaders use the current Pyrus brand kit assets", () => {
  // The static boot loader renders the branded wordmark (favicon + wordmark are
  // the only /brand/ refs allowed in index.html); guard against stale assets.
  assert.match(indexHtml, /\/brand\/pyrus-wordmark-tight\.png/);
  assert.doesNotMatch(indexHtml, /class="pyrus-boot-mark"/);
  assert.doesNotMatch(indexHtml, /pyrus-mark\.png/);
  assert.doesNotMatch(indexHtml, /pyrus-loader-mark-dark\.svg/);
  assert.doesNotMatch(crashDiagnostics, /\/brand\//);
  assert.match(pyrusMark, /\/brand\/pyrus-mark\.svg/);
  assert.match(pyrusWordmark, /\/brand\/pyrus-wordmark-tight\.png/);
  assert.match(pyrusWordmark, /\/brand\/pyrus-wordmark-tight-light\.png/);

  for (const source of [pyrusMark, pyrusWordmark]) {
    assert.doesNotMatch(source, /pyrus-loader-mark-dark\.svg/);
    assert.doesNotMatch(source, /pyrus-mark\.png/);
  }
});

test("lazy screen fallbacks use the platform theme variables", () => {
  for (const source of [platformShell, screenRegistry]) {
    assert.doesNotMatch(source, /var\(--background, #0[25]0[68]1[47]\)/);
    assert.match(source, /var\(--ra-surface-0, #F7FAFF\)/);
  }
  assert.doesNotMatch(screenRegistry, /var\(--foreground, #f8fafc\)/);
});

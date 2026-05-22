import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const logoSource = readFileSync(new URL("./LogoLoader.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app/App.tsx", import.meta.url), "utf8");
const registrySource = readFileSync(
  new URL("../features/platform/screenRegistry.jsx", import.meta.url),
  "utf8",
);
const researchSource = readFileSync(
  new URL("../screens/ResearchScreen.jsx", import.meta.url),
  "utf8",
);
const marketSource = readFileSync(
  new URL("../screens/MarketScreen.jsx", import.meta.url),
  "utf8",
);

test("LogoLoader owns the shared PYRUS boot treatment", () => {
  assert.match(logoSource, /type LogoLoaderProps = \{/);
  assert.match(logoSource, /label\?: string/);
  assert.match(logoSource, /minHeight\?: string \| number/);
  assert.match(logoSource, /tone\?: LogoLoaderTone/);
  assert.match(logoSource, /testId\?: string/);
  assert.match(logoSource, /const LOGO_LOADER_PALETTES = \{/);
  assert.match(logoSource, /document\.documentElement\.dataset\.pyrusTheme/);
  assert.match(logoSource, /const normalizeMinHeight/);
  assert.match(logoSource, /pyrusBootFade/);
  assert.match(logoSource, /pyrusBootBar/);
  assert.match(logoSource, /PyrusRadialMark/);
  assert.match(logoSource, /prefers-reduced-motion/);
  assert.match(logoSource, /data-testid=\{testId\}/);
  assert.match(logoSource, /data-tone=\{tone\}/);
});

test("app and screen chunk fallbacks use LogoLoader", () => {
  assert.match(appSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(appSource, /<Suspense fallback=\{<LogoLoader testId="app-loading-fallback" \/>\}>/);
  assert.doesNotMatch(appSource, /APP_LOADING_FALLBACK_PALETTES/);
  assert.doesNotMatch(appSource, /function AppLoadingFallback/);

  assert.match(registrySource, /import LogoLoader from "\.\.\/\.\.\/components\/LogoLoader"/);
  assert.match(registrySource, /export const ScreenLoadingFallback = \(\{ label = "Loading" \}\) =>/);
  assert.match(registrySource, /tone="panel"[\s\S]*label=\{label\}[\s\S]*testId="screen-loading-fallback"/);

  assert.match(researchSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(researchSource, /<Suspense fallback=\{<LogoLoader tone="panel" minHeight="100%" \/>\}>/);
  assert.doesNotMatch(researchSource, /ResearchLoadingFallback/);

  assert.match(marketSource, /testId="market-chart-grid-loader"/);
  assert.match(marketSource, /testId="market-activity-loader"/);
  assert.doesNotMatch(marketSource, /Market Charts<\/CardTitle>[\s\S]*aria-hidden="true"/);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const logoSource = readFileSync(new URL("./LogoLoader.tsx", import.meta.url), "utf8");
const markSource = readFileSync(new URL("./brand/pyrus-mark.tsx", import.meta.url), "utf8");
const wordmarkSource = readFileSync(new URL("./brand/pyrus-wordmark.tsx", import.meta.url), "utf8");
const brandSource = readFileSync(new URL("./brand/PyrusLogo.tsx", import.meta.url), "utf8");
const globalCssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const publicMarkPng = readFileSync(new URL("../../public/brand/pyrus-mark.png", import.meta.url));
const trackedMarkPng = readFileSync(
  new URL("../../../../branding/92767643-0c16-41f8-a80b-780819515a22.png", import.meta.url),
);
const publicWordmarkPng = readFileSync(new URL("../../public/brand/pyrus-wordmark-tight.png", import.meta.url));
const publicLightWordmarkPng = readFileSync(
  new URL("../../public/brand/pyrus-wordmark-tight-light.png", import.meta.url),
);
const indexHtmlSource = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app/App.tsx", import.meta.url), "utf8");
const appHeaderSource = readFileSync(
  new URL("../features/platform/AppHeader.jsx", import.meta.url),
  "utf8",
);
const platformShellSource = readFileSync(
  new URL("../features/platform/PlatformShell.jsx", import.meta.url),
  "utf8",
);
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
const publicBrandFiles = readdirSync(new URL("../../public/brand/", import.meta.url));

test("LogoLoader owns the shared branded boot treatment", () => {
  assert.match(logoSource, /type LogoLoaderProps = \{/);
  assert.match(logoSource, /label\?: string/);
  assert.match(logoSource, /minHeight\?: string \| number/);
  assert.match(logoSource, /tone\?: LogoLoaderTone/);
  assert.match(logoSource, /testId\?: string/);
  assert.match(logoSource, /const LOGO_LOADER_PALETTES = \{/);
  assert.match(logoSource, /document\.documentElement\.dataset\.pyrusTheme/);
  assert.doesNotMatch(logoSource, /dataset\.pyrusTheme === "light" \|\|/);
  assert.match(logoSource, /const normalizeMinHeight/);
  assert.match(logoSource, /LogoLockup/);
  assert.doesNotMatch(logoSource, /PyrusCircleLogo/);
  assert.match(logoSource, /className="pyrus-loader-lockup"/);
  assert.match(logoSource, /descriptor=\{tone === "panel" \? "" : "Algo Trading Platform"\}/);
  assert.match(logoSource, /markClassName=\{tone === "panel" \? "h-12 w-12" : "h-32 w-32"\}/);
  assert.match(logoSource, /wordmarkWidth=\{tone === "panel" \? 116 : 190\}/);
  assert.doesNotMatch(logoSource, /tone === "app" \? \(/);
  assert.doesNotMatch(logoSource, /PyrusRadialMark/);
  assert.doesNotMatch(logoSource, /pyrusMarkPulse/);
  assert.doesNotMatch(logoSource, /pyrusBootBar/);
  assert.doesNotMatch(logoSource, /pyrus-boot-bar/);
  assert.match(logoSource, /data-testid=\{testId\}/);
  assert.match(logoSource, /data-tone=\{tone\}/);
});

test("Pyrus wordmark renders the tight PNG directly, not live font text", () => {
  assert.match(wordmarkSource, /export function PyrusWordmark/);
  assert.match(wordmarkSource, /const PYRUS_WORDMARK_DARK_SRC = "\/brand\/pyrus-wordmark-tight\.png"/);
  assert.match(wordmarkSource, /const PYRUS_WORDMARK_LIGHT_SRC = "\/brand\/pyrus-wordmark-tight-light\.png"/);
  assert.match(wordmarkSource, /const WORDMARK_WIDTH = 852/);
  assert.match(wordmarkSource, /const WORDMARK_HEIGHT = 104/);
  assert.match(wordmarkSource, /className=\{\["pyrus-wordmark", className\]\.filter\(Boolean\)\.join\(" "\)\}/);
  assert.match(wordmarkSource, /role=\{title \? "img" : undefined\}/);
  assert.match(wordmarkSource, /className="pyrus-wordmark-image pyrus-wordmark-image--dark"/);
  assert.match(wordmarkSource, /className="pyrus-wordmark-image pyrus-wordmark-image--light"/);
  assert.match(wordmarkSource, /src=\{PYRUS_WORDMARK_DARK_SRC\}/);
  assert.match(wordmarkSource, /src=\{PYRUS_WORDMARK_LIGHT_SRC\}/);
  assert.match(wordmarkSource, /decoding="async"/);
  assert.match(wordmarkSource, /loading="eager"/);
  assert.equal(publicWordmarkPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(publicLightWordmarkPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(!publicBrandFiles.includes("pyrus-wordmark-tight.svg"));
  assert.doesNotMatch(wordmarkSource, /WORDMARK_PATH/);
  assert.doesNotMatch(wordmarkSource, /viewBox/);
  assert.doesNotMatch(wordmarkSource, /maskImage/);
  assert.doesNotMatch(wordmarkSource, /WebkitMaskImage/);
  assert.doesNotMatch(wordmarkSource, /mixBlendMode: "screen"/);
  assert.doesNotMatch(wordmarkSource, /<text/);
  assert.doesNotMatch(wordmarkSource, /fontFamily/);
  assert.doesNotMatch(wordmarkSource, /linearGradient/);
  assert.doesNotMatch(wordmarkSource, /<path d="M16 88V18H53/);
  assert.match(brandSource, /import \{ PyrusWordmark \} from "\.\/pyrus-wordmark"/);
  assert.match(brandSource, /export \{ PyrusWordmark \}/);
  assert.match(brandSource, /export function LogoMark/);
  assert.match(brandSource, /export function LogoLockup/);
  assert.match(globalCssSource, /\.pyrus-wordmark\s*\{/);
  assert.match(globalCssSource, /\.pyrus-wordmark-image\s*\{/);
  assert.match(globalCssSource, /\.pyrus-wordmark-image--light\s*\{\s*display:\s*none/);
  assert.match(globalCssSource, /:root\[data-pyrus-theme="light"\] \.pyrus-wordmark-image--dark/);
  assert.match(globalCssSource, /\[data-theme="light"\] \.pyrus-wordmark-image--light/);
});

test("primary brand surfaces render the PNG wordmark", () => {
  assert.match(brandSource, /export const PyrusBrandLockup = LogoMark/);
  assert.match(brandSource, /width=\{compact \? 116 : 150\}/);
  assert.match(brandSource, /color: "var\(--ra-text-primary, #F4F8FF\)"/);
  assert.match(brandSource, /className="pyrus-loader-mark"/);
  assert.match(brandSource, /descriptor = "Algo Trading Platform"/);
  assert.match(brandSource, /className="pyrus-loader-wordmark"/);
  assert.match(brandSource, /className="pyrus-lockup-descriptor"/);
  assert.match(
    appHeaderSource,
    /import \{ PyrusBrandLockup, PyrusWordmark \} from "\.\.\/\.\.\/components\/brand\/PyrusLogo"/,
  );
  assert.match(
    appHeaderSource,
    /<PyrusMark className="h-\[21px\] w-\[21px\]" \/>[\s\S]*<PyrusWordmark width=\{96\} title="" style=\{\{ color: T\.text \}\} \/>/,
  );
  assert.match(
    appHeaderSource,
    /<PyrusBrandLockup compact=\{headerTight\} \/>/,
  );
  assert.match(appHeaderSource, /aria-label="PYRUS"/);
  assert.doesNotMatch(platformShellSource, /components\/brand\/PyrusLogo/);
  assert.doesNotMatch(platformShellSource, /components\/brand\/pyrus-mark/);
  assert.doesNotMatch(brandSource, /TRADING OS/);
  assert.doesNotMatch(brandSource, /showDescriptor/);
  assert.doesNotMatch(appHeaderSource, /Trading OS/);
  assert.doesNotMatch(appHeaderSource, /showDescriptor/);
});

test("Pyrus mark uses the tracked high-detail ring PNG asset", () => {
  assert.match(markSource, /export function PyrusMark/);
  assert.match(markSource, /const PYRUS_MARK_SRC = "\/brand\/pyrus-mark\.png"/);
  assert.match(markSource, /className=\{cn\("pyrus-mark h-10 w-10", className\)\}/);
  assert.match(markSource, /className="pyrus-mark-image"/);
  assert.match(markSource, /src=\{PYRUS_MARK_SRC\}/);
  assert.match(markSource, /decoding="async"/);
  assert.match(markSource, /loading="eager"/);
  assert.match(markSource, /role=\{title \? "img" : undefined\}/);
  assert.match(markSource, /<img/);
  assert.doesNotMatch(markSource, /<svg/);
  assert.doesNotMatch(markSource, /linearGradient/);
  assert.doesNotMatch(markSource, /MarkDefs/);
  assert.doesNotMatch(markSource, /rimDots/);
  assert.doesNotMatch(markSource, /dataNodeAngles/);
  assert.doesNotMatch(markSource, /gaugeTicks/);
  assert.doesNotMatch(markSource, /className="pyrus-ring"/);
  assert.doesNotMatch(markSource, /PyrusRadialMark/);
  assert.doesNotMatch(markSource, /sectorPath/);
  assert.doesNotMatch(markSource, /ringBands/);
  assert.doesNotMatch(markSource, /outerRayAngles/);
  assert.match(brandSource, /import \{ PyrusMark \} from "\.\/pyrus-mark"/);
  assert.doesNotMatch(brandSource, /PyrusRadialMark/);
  assert.match(globalCssSource, /\.pyrus-mark\s*\{/);
  assert.match(globalCssSource, /\.pyrus-mark-image\s*\{/);
  assert.match(globalCssSource, /object-fit:\s*cover/);
  assert.match(globalCssSource, /\.pyrus-loader-lockup\s*\{/);
  assert.match(globalCssSource, /\.pyrus-loader-mark\s*\{/);
  assert.match(globalCssSource, /\.pyrus-loader-mark \.pyrus-mark\s*\{/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark svg\s*\{/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark img\s*\{/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-ring\s*\{/);
  assert.doesNotMatch(globalCssSource, /@keyframes pyrus-ring-spin/);
  assert.match(globalCssSource, /\.pyrus-lockup-descriptor\s*\{/);
  assert.match(globalCssSource, /letter-spacing:\s*0\.32em/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark::before/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark::after/);
  assert.doesNotMatch(globalCssSource, /pyrus-loader-orbit/);
  assert.doesNotMatch(globalCssSource, /pyrus-loader-aperture/);
  assert.doesNotMatch(globalCssSource, /pyrus-loader-ring-hydrate/);
  assert.match(globalCssSource, /@keyframes pyrus-loader-breathe/);
  assert.match(globalCssSource, /\.pyrus-loader-wordmark\s*\{/);
  assert.match(globalCssSource, /@keyframes pyrus-loader-wordmark-hydrate/);
  assert.match(globalCssSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pyrus-loader-mark/);
  assert.match(globalCssSource, /html\[data-pyrus-reduced-motion="on"\] \.pyrus-loader-mark/);
});

test("static favicon points to the tracked Pyrus mark PNG", () => {
  assert.match(indexHtmlSource, /<link rel="icon" type="image\/png" href="\/brand\/pyrus-mark\.png" \/>/);
  assert.doesNotMatch(indexHtmlSource, /favicon\.svg/);
  assert.deepStrictEqual(publicMarkPng, trackedMarkPng);
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
  assert.doesNotMatch(marketSource, /testId="market-activity-loader"/);
  assert.doesNotMatch(marketSource, /Market Charts<\/CardTitle>[\s\S]*aria-hidden="true"/);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const logoSource = readFileSync(new URL("./LogoLoader.tsx", import.meta.url), "utf8");
const brandLoaderSource = readFileSync(new URL("./BrandLoader.tsx", import.meta.url), "utf8");
const markSource = readFileSync(new URL("./brand/pyrus-mark.tsx", import.meta.url), "utf8");
const loaderMarkSource = readFileSync(
  new URL("./brand/pyrus-loader-mark.tsx", import.meta.url),
  "utf8",
);
const wordmarkSource = readFileSync(new URL("./brand/pyrus-wordmark.tsx", import.meta.url), "utf8");
const brandSource = readFileSync(new URL("./brand/PyrusLogo.tsx", import.meta.url), "utf8");
const globalCssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const publicMarkPng = readFileSync(new URL("../../public/brand/pyrus-mark.png", import.meta.url));
const publicLoaderMarkSvg = readFileSync(
  new URL("../../public/brand/pyrus-loader-mark-dark.svg", import.meta.url),
  "utf8",
);
const trackedMarkPng = readFileSync(
  new URL("../../../../branding/92767643-0c16-41f8-a80b-780819515a22.png", import.meta.url),
);
const publicWordmarkPng = readFileSync(new URL("../../public/brand/pyrus-wordmark-tight.png", import.meta.url));
const publicLightWordmarkPng = readFileSync(
  new URL("../../public/brand/pyrus-wordmark-tight-light.png", import.meta.url),
);
const indexHtmlSource = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app/App.tsx", import.meta.url), "utf8");
const appContentSource = readFileSync(new URL("../app/AppContent.tsx", import.meta.url), "utf8");
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
  assert.match(logoSource, /import BrandLoader/);
  assert.match(logoSource, /type LogoLoaderProps = BrandLoaderProps/);
  assert.match(logoSource, /testId = "logo-loader"/);
  assert.match(logoSource, /<BrandLoader testId=\{testId\} \{\.\.\.props\} \/>/);
  assert.match(brandLoaderSource, /export type BrandLoaderProps = \{/);
  assert.match(brandLoaderSource, /label\?: string/);
  assert.match(brandLoaderSource, /minHeight\?: string \| number/);
  assert.match(brandLoaderSource, /tone\?: BrandLoaderTone/);
  assert.match(brandLoaderSource, /testId\?: string/);
  assert.match(brandLoaderSource, /const BRAND_LOADER_SHELL_BG = "#050914"/);
  assert.match(brandLoaderSource, /const BRAND_LOADER_PANEL_BG = "#050914"/);
  assert.doesNotMatch(brandLoaderSource, /const BRAND_LOADER_PALETTES/);
  assert.doesNotMatch(brandLoaderSource, /resolveBrandLoaderTheme/);
  assert.doesNotMatch(brandLoaderSource, /document\.documentElement\.dataset\.pyrusTheme/);
  assert.match(brandLoaderSource, /const normalizeMinHeight/);
  assert.match(brandLoaderSource, /import \{ PyrusLoaderMark \} from "\.\/brand\/pyrus-loader-mark"/);
  assert.match(brandLoaderSource, /data-theme="dark"/);
  assert.match(brandLoaderSource, /background: isPanel \? BRAND_LOADER_PANEL_BG : BRAND_LOADER_SHELL_BG/);
  assert.match(brandLoaderSource, /<div aria-hidden="true" className="brand-loader-lockup">/);
  assert.match(brandLoaderSource, /className="brand-loader-mark"/);
  assert.match(
    brandLoaderSource,
    /className=\{isPanel \? "h-\[60px\] w-\[60px\]" : "h-\[104px\] w-\[104px\]"\}/,
  );
  assert.match(brandLoaderSource, /<PyrusLoaderMark/);
  assert.match(brandLoaderSource, /className="brand-loader-word"/);
  assert.match(brandLoaderSource, /height=\{isPanel \? 18 : 26\}/);
  assert.match(brandLoaderSource, /width=\{isPanel \? 148 : 213\}/);
  assert.match(brandLoaderSource, /mixBlendMode: "screen"/);
  assert.doesNotMatch(logoSource, /PyrusCircleLogo/);
  assert.doesNotMatch(brandLoaderSource, /PyrusCircleLogo/);
  assert.doesNotMatch(logoSource, /PyrusRadialMark/);
  assert.doesNotMatch(brandLoaderSource, /pyrusMarkPulse/);
  assert.doesNotMatch(brandLoaderSource, /pyrusBootBar/);
  assert.doesNotMatch(brandLoaderSource, /pyrus-boot-bar/);
  assert.match(brandLoaderSource, /data-testid=\{testId\}/);
  assert.match(brandLoaderSource, /data-tone=\{tone\}/);
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
    /<PyrusMark className="h-\[21px\] w-\[21px\]" \/>[\s\S]*<PyrusWordmark width=\{96\} title="" style=\{\{ color: CSS_COLOR\.text \}\} \/>/,
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

test("Pyrus mark surfaces use the intended ring assets", () => {
  assert.deepStrictEqual(publicMarkPng, trackedMarkPng);
  assert.ok(publicBrandFiles.includes("pyrus-mark.png"));
  assert.ok(publicBrandFiles.includes("pyrus-loader-mark-dark.svg"));
  assert.equal(publicMarkPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(publicLoaderMarkSvg, /<svg/);
  assert.match(publicLoaderMarkSvg, /viewBox="0 0 200 200"/);
  assert.match(publicLoaderMarkSvg, /<linearGradient id="pyrus-grad"/);
  assert.match(publicLoaderMarkSvg, /id="ring-07-particles"/);
  assert.match(publicLoaderMarkSvg, /id="ring-07b-data-nodes"/);
  assert.match(publicLoaderMarkSvg, /class="pyrus-ring"/);
  assert.match(publicLoaderMarkSvg, /@keyframes pyrus-ring-spin/);
  assert.match(markSource, /export function PyrusMark/);
  assert.match(markSource, /const PYRUS_MARK_SRC = "\/brand\/pyrus-mark\.png"/);
  assert.match(markSource, /className=\{cn\("pyrus-mark h-10 w-10", className\)\}/);
  assert.match(markSource, /className="pyrus-mark-image"/);
  assert.match(markSource, /src=\{PYRUS_MARK_SRC\}/);
  assert.match(markSource, /<img/);
  assert.doesNotMatch(markSource, /PyrusInstrumentMark/);
  assert.doesNotMatch(markSource, /<svg/);
  assert.match(loaderMarkSource, /export function PyrusLoaderMark/);
  assert.match(loaderMarkSource, /const PYRUS_LOADER_MARK_SRC = "\/brand\/pyrus-loader-mark-dark\.svg"/);
  assert.match(loaderMarkSource, /className=\{\["pyrus-loader-instrument", className\]\.filter\(Boolean\)\.join\(" "\)\}/);
  assert.match(loaderMarkSource, /src=\{PYRUS_LOADER_MARK_SRC\}/);
  assert.match(loaderMarkSource, /<img/);
  assert.doesNotMatch(loaderMarkSource, /\/brand\/pyrus-mark\.png/);
  assert.doesNotMatch(loaderMarkSource, /viewBox/);
  assert.doesNotMatch(loaderMarkSource, /<linearGradient/);
  assert.doesNotMatch(loaderMarkSource, /rimDots/);
  assert.doesNotMatch(loaderMarkSource, /dataNodeAngles/);
  assert.doesNotMatch(loaderMarkSource, /ring-07-particles/);
  assert.doesNotMatch(loaderMarkSource, /ring-07b-data-nodes/);
  assert.doesNotMatch(loaderMarkSource, /className="pyrus-ring"/);
  assert.doesNotMatch(markSource, /PyrusRadialMark/);
  assert.doesNotMatch(loaderMarkSource, /sectorPath/);
  assert.doesNotMatch(loaderMarkSource, /ringBands/);
  assert.doesNotMatch(loaderMarkSource, /outerRayAngles/);
  assert.match(brandSource, /import \{ PyrusMark \} from "\.\/pyrus-mark"/);
  assert.doesNotMatch(brandSource, /PyrusRadialMark/);
  assert.match(globalCssSource, /\.pyrus-mark\s*\{/);
  assert.match(globalCssSource, /\.pyrus-mark-image\s*\{/);
  assert.match(globalCssSource, /object-fit:\s*contain/);
  assert.match(globalCssSource, /\.pyrus-loader-instrument\s*\{/);
  assert.match(globalCssSource, /\.pyrus-loader-instrument\s*\{[\s\S]*?height:\s*104px/);
  assert.match(globalCssSource, /\.pyrus-loader-instrument\s*\{[\s\S]*?width:\s*104px/);
  assert.match(globalCssSource, /\[data-tone="panel"\] \.pyrus-loader-instrument\s*\{[\s\S]*?height:\s*60px/);
  assert.match(globalCssSource, /\[data-tone="panel"\] \.pyrus-loader-instrument\s*\{[\s\S]*?width:\s*60px/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-lockup\s*\{/);
  assert.match(globalCssSource, /\.pyrus-loader-mark\s*\{/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark svg\s*\{/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark img\s*\{/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-ring\s*\{/);
  assert.doesNotMatch(globalCssSource, /@keyframes pyrus-ring-spin/);
  assert.match(globalCssSource, /@keyframes brand-loader-spinup/);
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-spinup\s*\{[\s\S]*?0%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*rotate\(-18deg\) scale\(0\.96\);[\s\S]*?filter:\s*brightness\(0\.86\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-spinup\s*\{[\s\S]*?55%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?filter:\s*blur\(0\) brightness\(1\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-spinup\s*\{[\s\S]*?80%\s*\{[\s\S]*?transform:\s*rotate\(5deg\) scale\(1\.045\);[\s\S]*?filter:\s*brightness\(1\.55\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-spinup\s*\{[\s\S]*?100%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*rotate\(0deg\) scale\(1\);[\s\S]*?filter:\s*brightness\(1\);/,
  );
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{/);
  assert.match(
    globalCssSource,
    /\.brand-loader-mark\s*\{[\s\S]*?animation:\s*brand-loader-spinup 1\.05s cubic-bezier\(0\.16, 1, 0\.3, 1\) both;/,
  );
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{[\s\S]*?transform-origin:\s*50% 50%/);
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{[\s\S]*?will-change:\s*opacity, transform, filter/);
  assert.match(globalCssSource, /@keyframes brand-loader-word/);
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-word\s*\{[\s\S]*?0%\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transform:\s*translateY\(12px\) scale\(0\.965\);[\s\S]*?filter:\s*blur\(5px\) brightness\(0\.72\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-word\s*\{[\s\S]*?48%\s*\{[\s\S]*?opacity:\s*0\.72;[\s\S]*?transform:\s*translateY\(3px\) scale\(0\.99\);[\s\S]*?filter:\s*blur\(1\.4px\) brightness\(1\.18\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-word\s*\{[\s\S]*?78%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(-1px\) scale\(1\.018\);[\s\S]*?filter:\s*blur\(0\) brightness\(1\.22\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-word\s*\{[\s\S]*?100%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(0\) scale\(1\);[\s\S]*?filter:\s*blur\(0\) brightness\(1\);/,
  );
  assert.match(globalCssSource, /\.brand-loader-word\s*\{/);
  assert.match(
    globalCssSource,
    /\.brand-loader-word\s*\{[\s\S]*?animation:\s*brand-loader-word 0\.72s cubic-bezier\(0\.16, 1, 0\.3, 1\) 0\.74s both;/,
  );
  assert.match(globalCssSource, /\.brand-loader-word\s*\{[\s\S]*?height:\s*26px/);
  assert.match(globalCssSource, /\[data-tone="panel"\] \.brand-loader-word\s*\{[\s\S]*?height:\s*18px/);
  assert.match(globalCssSource, /\.brand-loader-word\s*\{[\s\S]*?will-change:\s*opacity, transform, filter/);
  assert.match(globalCssSource, /\.pyrus-lockup-descriptor\s*\{/);
  assert.match(globalCssSource, /letter-spacing:\s*0\.32em/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark::before/);
  assert.doesNotMatch(globalCssSource, /\.pyrus-loader-mark::after/);
  assert.doesNotMatch(globalCssSource, /pyrus-loader-orbit/);
  assert.doesNotMatch(globalCssSource, /pyrus-loader-aperture/);
  assert.doesNotMatch(globalCssSource, /pyrus-loader-ring-hydrate/);
  assert.doesNotMatch(globalCssSource, /@keyframes pyrus-loader-breathe/);
  assert.match(globalCssSource, /\.pyrus-loader-wordmark\s*\{/);
  assert.doesNotMatch(globalCssSource, /@keyframes pyrus-loader-wordmark-hydrate/);
  assert.doesNotMatch(globalCssSource, /html\[data-pyrus-reduced-motion="on"\] \.pyrus-ring/);
});

test("static favicon points to the tracked Pyrus mark PNG", () => {
  const faviconLine = indexHtmlSource.match(/<link rel="icon"[^>]+>/)?.[0] ?? "";

  assert.match(faviconLine, /type="image\/png"/);
  assert.match(faviconLine, /href="\/brand\/pyrus-mark\.png"/);
  assert.doesNotMatch(faviconLine, /pyrus-mark-dark\.svg/);
  assert.doesNotMatch(indexHtmlSource, /favicon\.svg/);
  assert.deepStrictEqual(publicMarkPng, trackedMarkPng);
});

test("static HTML leaves the React root empty before mount", () => {
  assert.match(indexHtmlSource, /<div id="root"><\/div>/);
  assert.doesNotMatch(indexHtmlSource, /pyrus-boot-/);
  assert.doesNotMatch(indexHtmlSource, /aria-label="Loading PYRUS"/);
  assert.doesNotMatch(indexHtmlSource, /role="status"/);
});

test("static boot shell installs PYRUS crash diagnostics before React mounts", () => {
  const guardIndex = indexHtmlSource.indexOf("__PYRUS_BOOT_CRASH_DIAGNOSTICS__");
  const mainIndex = indexHtmlSource.indexOf('src="/src/main.tsx"');

  assert.ok(guardIndex >= 0, "boot crash guard must be installed");
  assert.ok(mainIndex >= 0, "Vite main module script must be present");
  assert.ok(guardIndex < mainIndex, "boot crash guard must run before main.tsx");
  assert.match(indexHtmlSource, /lastCrashKey = "pyrus:last-crash-diagnostics:v1"/);
  assert.match(indexHtmlSource, /data-testid="root-crash-diagnostics"/);
  assert.match(indexHtmlSource, /PYRUS ROOT CRASH/);
  assert.match(indexHtmlSource, /src="\/brand\/pyrus-mark-dark\.svg"/);
  assert.match(indexHtmlSource, /src="\/brand\/pyrus-wordmark-tight\.png"/);
  assert.match(indexHtmlSource, /Open Diagnostics/);
});

test("app boot and screen routing use the React loader without a static boot shell", () => {
  assert.match(appSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.doesNotMatch(appSource, /components\/brand\/PyrusLogo/);
  assert.doesNotMatch(appSource, /components\/brand\/pyrus-mark-shared/);
  assert.doesNotMatch(appSource, /PyrusInstrumentMark/);
  assert.doesNotMatch(appSource, /import BrandLoader/);
  assert.doesNotMatch(appSource, /PYRUS_MARK_SRC/);
  assert.doesNotMatch(appSource, /PYRUS_WORDMARK_DARK_SRC/);
  assert.doesNotMatch(appSource, /PYRUS_WORDMARK_LIGHT_SRC/);
  assert.match(appSource, /const AppContent = lazyWithRetry\(async \(\) => \{/);
  assert.match(appSource, /import\("\.\/AppContent"\)/);
  assert.doesNotMatch(appSource, /await mod\.preloadInitialAppContentRoute\(\)/);
  assert.match(appSource, /function AppShellFallback\(\)/);
  assert.match(appSource, /testId="app-loading-fallback"/);
  assert.match(appSource, /<Suspense fallback=\{<AppShellFallback \/>\}>/);
  assert.match(appSource, /<AppContent \/>/);

  assert.match(appContentSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(appContentSource, /export const preloadInitialAppContentRoute = \(\) =>/);
  assert.match(appContentSource, /preloadDynamicImport\(loadPlatformApp/);
  assert.match(appContentSource, /ROOT_ROUTE_CHUNK_RETRIES/);
  assert.match(appContentSource, /const getPreloadedInitialAppContentRoute = \(labMode: string \| null\) =>/);
  assert.match(appContentSource, /preloadInitialAppContentRoute\(\)/);
  assert.match(appContentSource, /const InitialRouteComponent = getPreloadedInitialAppContentRoute\(labMode\)/);
  assert.match(appContentSource, /<InitialRouteComponent \/>/);
  assert.match(appContentSource, /function AppContentRouteFallback\(\)/);
  assert.match(appContentSource, /testId="app-content-route-loading"/);
  assert.match(appContentSource, /import \{ PlatformErrorBoundary \} from "\.\.\/components\/platform\/PlatformErrorBoundary"/);
  assert.match(appContentSource, /reportCategory="react-workspace-chunk"/);
  assert.match(appContentSource, /<Suspense fallback=\{<AppContentRouteFallback \/>\}>/);
  assert.doesNotMatch(appSource, /APP_LOADING_FALLBACK_PALETTES/);
  assert.doesNotMatch(appSource, /function AppLoadingFallback/);

  assert.match(registrySource, /import LogoLoader/);
  assert.match(registrySource, /export const ScreenLoadingFallback = /);
  assert.match(registrySource, /testId="screen-loading-fallback"/);
  assert.match(registrySource, /tone="panel"/);
  assert.match(registrySource, /return ScreenComponent \? \(/);
  assert.match(registrySource, /<ScreenLoadingFallback screenId=\{screenId\} error=\{loadError\} \/>/);
  assert.match(platformShellSource, /<Suspense fallback=\{<ScreenLoadingFallback screenId=\{id\} \/>\}>[\s\S]*renderScreenById\(id\)/);

  assert.match(researchSource, /const ResearchWorkspaceFallback = \(\) =>/);
  assert.match(researchSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(researchSource, /<Suspense fallback=\{<ResearchWorkspaceFallback \/>\}>/);
  assert.match(researchSource, /testId="research-workspace-loading"/);
  assert.doesNotMatch(researchSource, /data-testid=.*loading.*shell/);

  assert.match(marketSource, /testId="market-chart-grid-loader"/);
  assert.doesNotMatch(marketSource, /testId="market-activity-loader"/);
  assert.doesNotMatch(marketSource, /Market Charts<\/CardTitle>[\s\S]*aria-hidden="true"/);
});

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
const publicMarkDarkSvg = readFileSync(
  new URL("../../public/brand/pyrus-mark-dark.svg", import.meta.url),
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
const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
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
const screenModulePreloaderSource = readFileSync(
  new URL("../features/platform/screenModulePreloader.js", import.meta.url),
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

const brandMarkRingSpec = [
  ["ring-07-particles", 18, "normal"],
  ["ring-07b-data-nodes", 22, "reverse"],
  ["ring-06-outer-data-grid", 26, "reverse"],
  ["ring-05-execution-track", 34, "normal"],
  ["ring-03-model-transition", 44, "reverse"],
  ["ring-01-inner-ticks-outer", 56, "normal"],
] as const;

function assertBrandMarkRingRotationSpec(source: string, label: string) {
  assert.match(source, /viewBox="0 0 200 200"/, `${label} uses the brand viewBox`);
  assert.match(source, /transform-box:\s*view-box/, `${label} resolves transforms against the viewBox`);
  assert.match(source, /transform-origin:\s*50% 50%/, `${label} rotates around the mark center`);
  assert.match(
    source,
    /animation:\s*pyrus-ring-spin var\(--pyrus-ring-duration, 30s\) linear infinite/,
    `${label} uses one linear ring keyframe`,
  );
  assert.match(
    source,
    /animation-direction:\s*var\(--pyrus-ring-direction, normal\)/,
    `${label} controls direction per ring`,
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.pyrus-ring \{ animation: none; \}/,
    `${label} freezes rings for reduced motion`,
  );

  for (const [id, duration, direction] of brandMarkRingSpec) {
    assert.match(
      source,
      new RegExp(
        `id="${id}"[\\s\\S]*?class="pyrus-ring"[\\s\\S]*?--pyrus-ring-duration: ${duration}s; --pyrus-ring-direction: ${direction};`,
      ),
      `${label} ${id} follows the rotation spec`,
    );
  }

  assert.doesNotMatch(source, /id="boundary-r62"[^>]*class="pyrus-ring"/);
  assert.doesNotMatch(source, /id="gauge-arc"[^>]*class="pyrus-ring"/);
  assert.doesNotMatch(source, /id="boundary-r30"[^>]*class="pyrus-ring"/);
  assert.doesNotMatch(source, /--pyrus-ring-duration: (?:14|24|32|36|40|52|68|88|112)s/);
}

test("LogoLoader owns the shared branded boot treatment", () => {
  assert.match(logoSource, /import BrandLoader/);
  assert.match(logoSource, /type LogoLoaderProps = BrandLoaderProps/);
  assert.match(logoSource, /testId = "logo-loader"/);
  assert.match(logoSource, /<BrandLoader testId=\{testId\} \{\.\.\.props\} \/>/);
  assert.match(brandLoaderSource, /export type BrandLoaderProgress = \{/);
  assert.match(brandLoaderSource, /export type BrandLoaderProps = \{/);
  assert.match(brandLoaderSource, /label\?: string/);
  assert.match(brandLoaderSource, /minHeight\?: string \| number/);
  assert.match(brandLoaderSource, /tone\?: BrandLoaderTone/);
  assert.match(brandLoaderSource, /testId\?: string/);
  assert.match(brandLoaderSource, /bootHandoffElapsedMs\?: number \| null/);
  assert.match(brandLoaderSource, /progress\?: BrandLoaderProgress \| null/);
  assert.match(brandLoaderSource, /const normalizeBootHandoffElapsedMs/);
  assert.match(brandLoaderSource, /const normalizeProgressPercent/);
  assert.match(brandLoaderSource, /"--brand-loader-handoff-offset": `\$\{normalizedBootHandoffElapsedMs\}ms`/);
  assert.match(brandLoaderSource, /const BRAND_LOADER_SHELL_BG = "#050914"/);
  assert.match(brandLoaderSource, /const BRAND_LOADER_PANEL_BG = "#050914"/);
  assert.doesNotMatch(brandLoaderSource, /const BRAND_LOADER_PALETTES/);
  assert.doesNotMatch(brandLoaderSource, /resolveBrandLoaderTheme/);
  assert.doesNotMatch(brandLoaderSource, /document\.documentElement\.dataset\.pyrusTheme/);
  assert.match(brandLoaderSource, /const normalizeMinHeight/);
  assert.match(brandLoaderSource, /import \{ PyrusLoaderMark \} from "\.\/brand\/pyrus-loader-mark"/);
  assert.match(brandLoaderSource, /data-theme="dark"/);
  assert.match(brandLoaderSource, /data-boot-handoff=\{normalizedBootHandoffElapsedMs === null \? undefined : "phase"\}/);
  assert.match(brandLoaderSource, /data-progress=\{progressPercent === null \? undefined : progressPercent\}/);
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
  assert.match(brandLoaderSource, /className="brand-loader-progress"/);
  assert.match(brandLoaderSource, /className="brand-loader-progress-percent"/);
  assert.match(brandLoaderSource, /role="progressbar"/);
  assert.match(brandLoaderSource, /aria-valuenow=\{progressPercent\}/);
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
  assert.match(brandSource, /animatedMark\?: boolean/);
  assert.match(brandSource, /markClassName\?: string/);
  assert.match(brandSource, /markImageClassName\?: string/);
  assert.match(brandSource, /wordmarkWidth\?: number/);
  assert.match(brandSource, /animated=\{animatedMark\}/);
  assert.match(brandSource, /imageClassName=\{markImageClassName\}/);
  assert.match(brandSource, /width=\{wordmarkWidth \?\? \(compact \? 116 : 150\)\}/);
  assert.match(brandSource, /color: "var\(--ra-text-primary, #F4F8FF\)"/);
  assert.match(brandSource, /className="pyrus-loader-mark"/);
  assert.match(brandSource, /descriptor = "Algo Trading Platform"/);
  assert.match(brandSource, /className="pyrus-loader-wordmark"/);
  assert.match(brandSource, /className="pyrus-lockup-descriptor"/);
  assert.match(
    appHeaderSource,
    /import \{ PyrusBrandLockup \} from "\.\.\/\.\.\/components\/brand\/PyrusLogo"/,
  );
  assert.match(
    appHeaderSource,
    /<PyrusBrandLockup[\s\S]*?animatedMark[\s\S]*?compact[\s\S]*?className="pyrus-header-brand-lockup"[\s\S]*?markClassName="h-\[24px\] w-\[24px\]"[\s\S]*?markImageClassName="pyrus-header-mark-image"[\s\S]*?wordmarkWidth=\{86\}/,
  );
  assert.match(
    appHeaderSource,
    /<PyrusBrandLockup[\s\S]*?animatedMark[\s\S]*?compact=\{headerTight\}[\s\S]*?className="pyrus-header-brand-lockup"[\s\S]*?markClassName=\{headerTight \? "h-\[25px\] w-\[25px\]" : "h-\[31px\] w-\[31px\]"\}[\s\S]*?markImageClassName="pyrus-header-mark-image"[\s\S]*?wordmarkWidth=\{headerTight \? 106 : 136\}/,
  );
  assert.match(appHeaderSource, /aria-label="PYRUS"/);
  assert.doesNotMatch(appHeaderSource, /const ModeChip/);
  assert.doesNotMatch(appHeaderSource, /<ModeChip/);
  assert.doesNotMatch(appHeaderSource, /data-testid="header-mode-chip"/);
  assert.doesNotMatch(appHeaderSource, /PyrusWordmark width=\{96\}/);
  assert.doesNotMatch(appHeaderSource, /PyrusMark className="h-\[21px\] w-\[21px\]"/);
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
  assert.ok(publicBrandFiles.includes("pyrus-mark-dark.svg"));
  assert.equal(publicMarkPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(publicLoaderMarkSvg, /<svg/);
  assert.match(publicLoaderMarkSvg, /<linearGradient id="pyrus-grad"/);
  assert.match(publicMarkDarkSvg, /<linearGradient id="pyrus-grad"/);
  assertBrandMarkRingRotationSpec(publicLoaderMarkSvg, "loader mark SVG");
  assertBrandMarkRingRotationSpec(publicMarkDarkSvg, "dark mark SVG");
  assert.match(markSource, /export function PyrusMark/);
  assert.match(markSource, /const PYRUS_MARK_SRC = "\/brand\/pyrus-mark\.png"/);
  assert.match(markSource, /const PYRUS_ANIMATED_MARK_SRC = "\/brand\/pyrus-loader-mark-dark\.svg"/);
  assert.match(markSource, /animated\?: boolean/);
  assert.match(markSource, /imageClassName\?: string/);
  assert.match(markSource, /className=\{cn\("pyrus-mark h-10 w-10", className\)\}/);
  assert.match(markSource, /className=\{cn\("pyrus-mark-image", imageClassName\)\}/);
  assert.match(markSource, /src=\{animated \? PYRUS_ANIMATED_MARK_SRC : PYRUS_MARK_SRC\}/);
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
  assert.match(globalCssSource, /\.pyrus-header-mark-image\s*\{/);
  assert.match(globalCssSource, /brightness\(1\.2\)/);
  assert.match(globalCssSource, /saturate\(1\.28\)/);
  assert.match(globalCssSource, /drop-shadow\(0 0 4px rgba\(61, 184, 255, 0\.42\)\)/);
  assert.match(globalCssSource, /drop-shadow\(0 0 7px rgba\(255, 61, 42, 0\.2\)\)/);
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
  assert.match(globalCssSource, /\[data-tone="panel"\] \.brand-loader-lockup\s*\{[\s\S]*?gap:\s*16px/);
  assert.match(globalCssSource, /@keyframes brand-loader-mark-enter/);
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-mark-enter\s*\{[\s\S]*?0%\s*\{[\s\S]*?opacity:\s*0\.86;[\s\S]*?transform:\s*rotate\(-10deg\) scale\(0\.985\);[\s\S]*?filter:\s*brightness\(0\.82\) saturate\(0\.92\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-mark-enter\s*\{[\s\S]*?62%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*rotate\(2deg\) scale\(1\.018\);[\s\S]*?filter:\s*brightness\(1\.24\) saturate\(1\.08\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-mark-enter\s*\{[\s\S]*?100%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*rotate\(0deg\) scale\(1\);[\s\S]*?filter:\s*brightness\(1\) saturate\(1\);/,
  );
  assert.match(globalCssSource, /@keyframes brand-loader-mark-live/);
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-mark-live\s*\{[\s\S]*?48%\s*\{[\s\S]*?transform:\s*scale\(1\.014\);[\s\S]*?filter:\s*brightness\(1\.16\) saturate\(1\.06\);/,
  );
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{/);
  assert.match(globalCssSource, /--brand-loader-mark-enter-duration:\s*680ms/);
  assert.match(globalCssSource, /--brand-loader-mark-live-delay:\s*760ms/);
  assert.match(
    globalCssSource,
    /\.brand-loader-mark\s*\{[\s\S]*?animation:[\s\S]*?brand-loader-mark-enter var\(--brand-loader-mark-enter-duration\) cubic-bezier\(0\.16, 1, 0\.3, 1\) calc\(0ms - var\(--brand-loader-handoff-offset, 0ms\)\) both,[\s\S]*?brand-loader-mark-live 1800ms cubic-bezier\(0\.45, 0, 0\.2, 1\) calc\(var\(--brand-loader-mark-live-delay\) - var\(--brand-loader-handoff-offset, 0ms\)\) infinite;/,
  );
  assert.match(
    globalCssSource,
    /\[data-tone="panel"\] \.brand-loader-mark\s*\{[\s\S]*?--brand-loader-mark-enter-duration:\s*420ms;[\s\S]*?--brand-loader-mark-live-delay:\s*480ms;/,
  );
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{[\s\S]*?transform-origin:\s*50% 50%/);
  assert.match(globalCssSource, /\.brand-loader-mark\s*\{[\s\S]*?will-change:\s*opacity, transform, filter/);
  assert.match(globalCssSource, /@keyframes brand-loader-word-enter/);
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-word-enter\s*\{[\s\S]*?0%\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transform:\s*translateY\(8px\) scale\(0\.985\);[\s\S]*?filter:\s*blur\(3px\) brightness\(0\.8\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-word-enter\s*\{[\s\S]*?64%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(0\) scale\(1\.006\);[\s\S]*?filter:\s*blur\(0\) brightness\(1\.12\);/,
  );
  assert.match(
    globalCssSource,
    /@keyframes brand-loader-word-enter\s*\{[\s\S]*?100%\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(0\) scale\(1\);[\s\S]*?filter:\s*blur\(0\) brightness\(1\);/,
  );
  assert.match(globalCssSource, /\.brand-loader-word\s*\{/);
  assert.match(globalCssSource, /--brand-loader-word-delay:\s*180ms/);
  assert.match(globalCssSource, /--brand-loader-word-duration:\s*520ms/);
  assert.match(
    globalCssSource,
    /\.brand-loader-word\s*\{[\s\S]*?animation:\s*brand-loader-word-enter var\(--brand-loader-word-duration\) cubic-bezier\(0\.16, 1, 0\.3, 1\) calc\(var\(--brand-loader-word-delay\) - var\(--brand-loader-handoff-offset, 0ms\)\) both;/,
  );
  assert.match(globalCssSource, /\.brand-loader-word\s*\{[\s\S]*?height:\s*26px/);
  assert.match(globalCssSource, /\.brand-loader-word\s*\{[\s\S]*?mix-blend-mode:\s*screen/);
  assert.match(globalCssSource, /\.brand-loader-progress\s*\{/);
  assert.match(globalCssSource, /\.brand-loader-progress-row\s*\{/);
  assert.match(globalCssSource, /\.brand-loader-progress-track\s*\{/);
  assert.match(globalCssSource, /\.brand-loader-progress-fill\s*\{/);
  assert.match(globalCssSource, /\.pyrus-boot-progress-overlay\s*\{/);
  assert.match(
    globalCssSource,
    /\[data-tone="panel"\] \.brand-loader-word\s*\{[\s\S]*?--brand-loader-word-delay:\s*80ms;[\s\S]*?--brand-loader-word-duration:\s*360ms;[\s\S]*?height:\s*18px/,
  );
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

test("static HTML renders the tracked Pyrus boot loader before React mounts", () => {
  assert.match(indexHtmlSource, /__PYRUS_BOOT_LOADER_STARTED_AT__/);
  assert.match(indexHtmlSource, /performance\.now\(\)/);
  assert.match(indexHtmlSource, /<div id="root">[\s\S]*data-testid="pyrus-boot-loader"/);
  assert.match(indexHtmlSource, /class="pyrus-boot-mark"/);
  assert.match(indexHtmlSource, /src="\/brand\/pyrus-loader-mark-dark\.svg"/);
  assert.match(indexHtmlSource, /class="pyrus-boot-word"[\s\S]*src="\/brand\/pyrus-wordmark-tight\.png"/);
  assert.match(indexHtmlSource, /class="pyrus-boot-word"[\s\S]*width="213"[\s\S]*height="26"/);
  assert.match(indexHtmlSource, /aria-label="Loading PYRUS"/);
  assert.match(indexHtmlSource, /role="status"/);
  assert.match(indexHtmlSource, /\.pyrus-boot-lockup\s*\{[^}]*gap:\s*24px/);
  assert.match(indexHtmlSource, /\.pyrus-boot-mark\s*\{[\s\S]*?animation:[\s\S]*?pyrus-boot-mark 680ms[\s\S]*?pyrus-boot-mark-live 1800ms[\s\S]*?760ms infinite/);
  assert.match(indexHtmlSource, /\.pyrus-boot-word\s*\{[\s\S]*?animation:\s*pyrus-boot-word 520ms[\s\S]*?180ms both/);
  assert.match(indexHtmlSource, /\.pyrus-boot-word\s*\{[^}]*height:\s*26px/);
  assert.match(indexHtmlSource, /\.pyrus-boot-word\s*\{[^}]*width:\s*213px/);
  assert.match(indexHtmlSource, /\.pyrus-boot-word\s*\{[^}]*object-fit:\s*contain/);
  assert.match(indexHtmlSource, /\.pyrus-boot-word\s*\{[^}]*mix-blend-mode:\s*screen/);
  assert.match(indexHtmlSource, /@keyframes pyrus-boot-mark\s*\{[\s\S]*?0%\s*\{[\s\S]*?opacity:\s*0\.86;[\s\S]*?transform:\s*rotate\(-10deg\) scale\(0\.985\);[\s\S]*?filter:\s*brightness\(0\.82\) saturate\(0\.92\);/);
  assert.match(indexHtmlSource, /@keyframes pyrus-boot-mark\s*\{[\s\S]*?62%\s*\{[\s\S]*?transform:\s*rotate\(2deg\) scale\(1\.018\);[\s\S]*?filter:\s*brightness\(1\.24\) saturate\(1\.08\);/);
  assert.match(indexHtmlSource, /@keyframes pyrus-boot-mark-live\s*\{[\s\S]*?48%\s*\{[\s\S]*?transform:\s*scale\(1\.014\);[\s\S]*?filter:\s*brightness\(1\.16\) saturate\(1\.06\);/);
  assert.match(indexHtmlSource, /@keyframes pyrus-boot-word\s*\{[\s\S]*?0%\s*\{[\s\S]*?transform:\s*translateY\(8px\) scale\(0\.985\);[\s\S]*?filter:\s*blur\(3px\) brightness\(0\.8\);/);
  assert.match(indexHtmlSource, /@keyframes pyrus-boot-word\s*\{[\s\S]*?64%\s*\{[\s\S]*?transform:\s*translateY\(0\) scale\(1\.006\);[\s\S]*?filter:\s*blur\(0\) brightness\(1\.12\);/);
  assert.doesNotMatch(indexHtmlSource, /<div class="pyrus-boot-word">PYRUS<\/div>/);
  for (const [, bootWordStyles] of indexHtmlSource.matchAll(/\.pyrus-boot-word\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(bootWordStyles, /font-size:/);
    assert.doesNotMatch(bootWordStyles, /font-weight:/);
    assert.doesNotMatch(bootWordStyles, /letter-spacing:/);
  }
  assert.doesNotMatch(indexHtmlSource, /rayalgo/i);
  assert.doesNotMatch(indexHtmlSource, /RayAlgo/);
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
  assert.match(indexHtmlSource, /getResourceTarget/);
  assert.match(indexHtmlSource, /isFatalResourceError/);
  assert.match(
    indexHtmlSource,
    /if \(resourceTarget && !isFatalResourceError\(resourceTarget\)\) return;/,
  );
  assert.match(indexHtmlSource, /target: resourceTarget/);
  assert.match(indexHtmlSource, /dismiss/);
  assert.match(indexHtmlSource, /removeEventListener\("error", onBootError, true\)/);
  assert.match(
    indexHtmlSource,
    /removeEventListener\(\s*"unhandledrejection",\s*onBootUnhandledRejection,\s*true,/,
  );
});

test("app boot and screen routing use the React loader after the static shell", () => {
  assert.match(mainSource, /dismissBootCrashDiagnostics/);
  assert.match(mainSource, /__PYRUS_BOOT_CRASH_DIAGNOSTICS__/);
  assert.match(mainSource, /readBootLoaderElapsedMs/);
  assert.match(mainSource, /__PYRUS_BOOT_LOADER_STARTED_AT__/);
  assert.match(mainSource, /completeBootProgressTask/);
  assert.match(mainSource, /startBootProgressTask\("react-root"\)/);
  assert.match(mainSource, /rootElement\.querySelector\('\[data-testid="pyrus-boot-loader"\]'\)/);
  assert.match(mainSource, /const bootLoaderElapsedMs = readBootLoaderElapsedMs\(rootElement\);/);
  assert.match(mainSource, /createRoot\(rootElement\)\.render\(<App bootLoaderElapsedMs=\{bootLoaderElapsedMs\} \/>\);/);
  assert.match(mainSource, /dismissBootCrashDiagnostics\(\);/);

  assert.match(appSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(appSource, /useBootProgress/);
  assert.doesNotMatch(appSource, /components\/brand\/PyrusLogo/);
  assert.doesNotMatch(appSource, /components\/brand\/pyrus-mark-shared/);
  assert.doesNotMatch(appSource, /PyrusInstrumentMark/);
  assert.doesNotMatch(appSource, /import BrandLoader/);
  assert.doesNotMatch(appSource, /PYRUS_MARK_SRC/);
  assert.doesNotMatch(appSource, /PYRUS_WORDMARK_DARK_SRC/);
  assert.doesNotMatch(appSource, /PYRUS_WORDMARK_LIGHT_SRC/);
  assert.match(appSource, /const AppContent = lazyWithRetry\(async \(\) => \{/);
  assert.match(appSource, /import\("\.\/AppContent"\)/);
  assert.match(appSource, /startBootProgressTask\("app-content-chunk"\)/);
  assert.match(appSource, /completeBootProgressTask\("app-content-chunk"\)/);
  assert.match(appSource, /failBootProgressTask\("app-content-chunk"/);
  assert.doesNotMatch(appSource, /await mod\.preloadInitialAppContentRoute\(\)/);
  assert.match(appSource, /type AppProps = \{[\s\S]*?bootLoaderElapsedMs\?: number \| null/);
  assert.match(appSource, /function AppShellFallback\(\{ bootLoaderElapsedMs = null \}: AppProps\)/);
  assert.match(appSource, /bootHandoffElapsedMs=\{bootLoaderElapsedMs\}/);
  assert.match(appSource, /progress=\{progress\}/);
  assert.match(appSource, /testId="app-loading-fallback"/);
  assert.match(appSource, /<Suspense fallback=\{<AppShellFallback bootLoaderElapsedMs=\{bootLoaderElapsedMs\} \/>\}>/);
  assert.match(appSource, /<AppContent bootLoaderElapsedMs=\{bootLoaderElapsedMs\} \/>/);

  assert.match(appContentSource, /import LogoLoader from "\.\.\/components\/LogoLoader"/);
  assert.match(appContentSource, /BOOT_SCREEN_MODULE_PRELOAD_TASK_IDS/);
  assert.match(appContentSource, /useBootProgress/);
  assert.match(appContentSource, /type AppContentProps = \{[\s\S]*?bootLoaderElapsedMs\?: number \| null/);
  assert.match(appContentSource, /export const preloadInitialAppContentRoute = \(\) =>/);
  assert.match(appContentSource, /preloadDynamicImport\(loadPlatformApp/);
  assert.match(appContentSource, /startBootProgressTask\("workspace-route-chunk"/);
  assert.match(appContentSource, /completeBootProgressTask\("workspace-route-chunk"/);
  assert.match(appContentSource, /failBootProgressTask\("workspace-route-chunk"/);
  assert.match(appContentSource, /skipBootProgressTasks\(/);
  assert.match(appContentSource, /ROOT_ROUTE_CHUNK_RETRIES/);
  assert.match(appContentSource, /const getPreloadedInitialAppContentRoute = \(labMode: string \| null\) =>/);
  assert.match(appContentSource, /preloadInitialAppContentRoute\(\)/);
  assert.match(appContentSource, /const InitialRouteComponent = getPreloadedInitialAppContentRoute\(labMode\)/);
  assert.match(appContentSource, /<InitialRouteComponent \/>/);
  assert.match(appContentSource, /function AppContentRouteFallback\(\{ bootLoaderElapsedMs = null \}: AppContentProps\)/);
  assert.match(appContentSource, /bootHandoffElapsedMs=\{bootLoaderElapsedMs\}/);
  assert.match(appContentSource, /progress=\{progress\}/);
  assert.match(appContentSource, /testId="app-content-route-loading"/);
  assert.match(appContentSource, /import \{ PlatformErrorBoundary \} from "\.\.\/components\/platform\/PlatformErrorBoundary"/);
  assert.match(appContentSource, /reportCategory="react-workspace-chunk"/);
  assert.match(appContentSource, /<Suspense fallback=\{<AppContentRouteFallback bootLoaderElapsedMs=\{bootLoaderElapsedMs\} \/>\}>/);
  assert.doesNotMatch(appSource, /APP_LOADING_FALLBACK_PALETTES/);
  assert.doesNotMatch(appSource, /function AppLoadingFallback/);

  assert.match(registrySource, /import LogoLoader/);
  assert.match(screenModulePreloaderSource, /BOOT_SCREEN_MODULE_PRELOAD_TASK_BY_SCREEN_ID/);
  assert.match(screenModulePreloaderSource, /startBootProgressTask\(bootProgressTaskId\)/);
  assert.match(screenModulePreloaderSource, /completeBootProgressTask\(bootProgressTaskId\)/);
  assert.match(screenModulePreloaderSource, /failBootProgressTask\(bootProgressTaskId, error\)/);
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

  assert.match(marketSource, /data-testid="market-chart-grid-shell"/);
  assert.match(marketSource, /data-testid="market-chart-grid-shell-cell"/);
  assert.doesNotMatch(marketSource, /market-chart-grid-loader/);
  assert.doesNotMatch(marketSource, /testId="market-activity-loader"/);
  assert.doesNotMatch(marketSource, /Market Charts<\/CardTitle>[\s\S]*aria-hidden="true"/);
});

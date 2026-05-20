#!/usr/bin/env node
/**
 * Visual review script for density-tightening passes.
 *
 * Spins up a headless Chromium (using the headless_shell variant —
 * the regular Chromium binary in our Playwright cache is missing
 * libcups.so.2 + libgbm.so.1, but headless_shell has all its deps).
 *
 * For each screen, navigates to it, waits for first paint + streaming
 * hydration, then captures:
 *   1. A full-viewport screenshot at /tmp/visual-review-<screen>.png
 *   2. A measurement record (header heights, first-panel-y, etc.)
 *
 * Run before a density commit to capture baseline; run after to compare.
 * The firstPanelY delta is the cleanest "did we recover vertical real
 * estate" measurement — lower-is-better.
 *
 * Usage:
 *   cd artifacts/rayalgo
 *   node scripts/visual-review.mjs
 *   node scripts/visual-review.mjs --screen account     # single screen
 *   node scripts/visual-review.mjs --viewport mobile    # phone viewport
 */

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const HEADLESS_SHELL =
  "/home/runner/workspace/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell";

// Chromium's dynamic deps (libgbm, libcups) aren't on the default
// LD_LIBRARY_PATH but they ARE in the Nix store. Inject the right paths
// before Playwright spawns the browser so it can resolve them.
const NIX_LIB_PATHS = [
  "/nix/store/24w3s75aa2lrvvxsybficn8y3zxd27kp-mesa-libgbm-25.1.0/lib",
  "/nix/store/0bp09zmflpq2igy8cm2b83dl0rpmyw90-cups-2.4.7-lib/lib",
].join(":");

process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
  ? `${NIX_LIB_PATHS}:${process.env.LD_LIBRARY_PATH}`
  : NIX_LIB_PATHS;

const BASE_URL = process.env.RAYALGO_DEV_URL || "http://127.0.0.1:18747";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// Each screen is identified by the visible tab label so we can click
// the platform-screen-nav button (it doesn't have per-screen testids).
const SCREENS = [
  { id: "market", label: "Market" },
  { id: "flow", label: "Flow" },
  { id: "account", label: "Account" },
  { id: "algo", label: "Algo" },
  { id: "trade", label: "Trade" },
  { id: "settings", label: "Settings" },
];

const args = process.argv.slice(2);
const screenFilter = (() => {
  const idx = args.indexOf("--screen");
  if (idx !== -1) return args[idx + 1];
  return null;
})();
const viewportName = (() => {
  const idx = args.indexOf("--viewport");
  if (idx !== -1) return args[idx + 1];
  return "desktop";
})();
const viewport = VIEWPORTS[viewportName] || VIEWPORTS.desktop;

const targets = screenFilter
  ? SCREENS.filter((s) => s.id === screenFilter)
  : SCREENS;

const browser = await chromium.launch({
  executablePath: HEADLESS_SHELL,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
  ],
});

const measurements = {};

try {
  await mkdir("/tmp/visual-review", { recursive: true });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();

  page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));

  await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  // Initial hydration window — streaming bars, KPI fetches, etc. all
  // need to settle so screenshots aren't of half-loaded UI.
  await page.waitForTimeout(3500);

  for (const screen of targets) {
    // Click the platform-screen-nav button with this screen's label.
    // Falls back to direct navigation if the tab isn't found (Settings
    // is sometimes behind an overflow menu on narrower viewports).
    try {
      const desktopButton = page.locator(
        `[data-testid="platform-screen-nav"] button:has-text("${screen.label}")`,
      );
      const desktopVisible = await desktopButton.first().isVisible().catch(() => false);
      if (desktopVisible) {
        await desktopButton.first().click();
      } else {
        // Mobile viewport: try the primary bottom-nav button first.
        const mobilePrimary = page.locator(
          `[data-testid="mobile-bottom-nav-${screen.id}"]`,
        );
        const mobilePrimaryVisible = await mobilePrimary
          .first()
          .isVisible()
          .catch(() => false);
        if (mobilePrimaryVisible) {
          await mobilePrimary.first().click();
        } else {
          // Mobile + non-primary screen: open the More sheet and click inside.
          const moreButton = page.locator(
            `[data-testid="mobile-bottom-nav-more"]`,
          );
          const moreVisible = await moreButton.first().isVisible().catch(() => false);
          if (moreVisible) {
            await moreButton.first().click();
            await page.waitForTimeout(300);
            const sheetButton = page.locator(
              `[data-testid="mobile-more-screen-${screen.id}"]`,
            );
            const sheetVisible = await sheetButton
              .first()
              .isVisible()
              .catch(() => false);
            if (sheetVisible) {
              await sheetButton.first().click();
            }
          }
        }
      }
    } catch (_e) {
      // Screen-nav click failed; carry on with whatever screen is up.
    }
    // Wait for the screen host to mount + screen-ready signal.
    try {
      await page.waitForSelector(`[data-testid="screen-host-${screen.id}"]`, {
        timeout: 5000,
      });
    } catch (_e) {
      console.warn(`[${screen.id}] screen-host not found, continuing`);
    }
    // Give per-screen content (API calls, store hydration) plenty of
    // time — Account in particular waits on broker positions / returns.
    await page.waitForTimeout(4000);

    const m = await page.evaluate((screenId) => {
      const root = document.querySelector(
        `[data-testid="screen-host-${screenId}"]`,
      );
      const platformHeader = document.querySelector(
        '[data-testid="platform-header-controls"]',
      );
      const screenNav = document.querySelector(
        '[data-testid="platform-screen-nav"]',
      );
      const firstPanel = root?.querySelector(
        '[class*="ra-panel-enter"], section',
      );
      const firstCard = root?.querySelector('[class*="ra-card"]');
      return {
        platformHeaderH:
          platformHeader?.getBoundingClientRect().height || 0,
        screenNavH: screenNav?.getBoundingClientRect().height || 0,
        firstPanelY: firstPanel?.getBoundingClientRect().top || 0,
        firstCardY: firstCard?.getBoundingClientRect().top || 0,
        viewportInnerH: window.innerHeight,
        viewportInnerW: window.innerWidth,
        scrollY: window.scrollY,
      };
    }, screen.id);
    measurements[screen.id] = m;

    const screenshotPath = `/tmp/visual-review/${viewportName}-${screen.id}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(
      `[${screen.id}]`,
      JSON.stringify({ ...m, screenshot: screenshotPath }),
    );
  }

  await writeFile(
    `/tmp/visual-review/${viewportName}-measurements.json`,
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    `\nSaved measurements to /tmp/visual-review/${viewportName}-measurements.json`,
  );
} finally {
  await browser.close();
}

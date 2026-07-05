import { expect, test, type Page } from "@playwright/test";

const DEFAULT_APP_URL = "http://127.0.0.1:18747/";
const APP_URL = process.env.PYRUS_APP_URL || DEFAULT_APP_URL;
const WATERFALL_TEST_TIMEOUT_MS = 210_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SERVER_PROBE_TIMEOUT_MS = 2_500;

const ALL_SCREENS = [
  { id: "market", label: "Market" },
  { id: "signals", label: "Signals" },
  { id: "flow", label: "Flow" },
  { id: "gex", label: "GEX" },
  { id: "trade", label: "Trade" },
  { id: "account", label: "Account" },
  { id: "research", label: "Research" },
  { id: "algo", label: "Algo" },
  { id: "backtest", label: "Backtest" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "settings", label: "Settings" },
] as const;

type ScreenId = (typeof ALL_SCREENS)[number]["id"];

const WATERFALL_SCREEN_FILTER = new Set(
  (process.env.PYRUS_WATERFALL_SCREENS || "")
    .split(",")
    .map((screenId) => screenId.trim())
    .filter(Boolean),
);
const SCREENS =
  WATERFALL_SCREEN_FILTER.size > 0
    ? ALL_SCREENS.filter((screen) => WATERFALL_SCREEN_FILTER.has(screen.id))
    : ALL_SCREENS;

type ScreenTiming = {
  screenId: ScreenId;
  visibleAfterMs: number;
  loadingFallbackVisible: boolean;
  suspenseFallbackVisible: boolean;
  resources: Array<{
    name: string;
    duration: number;
    startTime: number;
    transferSize: number;
    initiatorType: string;
  }>;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isVisibleOrAttached = async (page: Page, selector: string) => {
  const locator = page.locator(selector);
  if ((await locator.count()) === 0) {
    return false;
  }
  return locator.first().isVisible();
};

const appServerAvailable = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const captureRecentResources = async (
  page: Page,
  startedAt: number,
): Promise<ScreenTiming["resources"]> =>
  page.evaluate((navigationStartedAt) => {
    return performance
      .getEntriesByType("resource")
      .filter((entry): entry is PerformanceResourceTiming => {
        return (
          entry instanceof PerformanceResourceTiming &&
          entry.startTime >= navigationStartedAt
        );
      })
      .map((entry) => ({
        name: entry.name,
        duration: Math.round(entry.duration),
        startTime: Math.round(entry.startTime),
        transferSize: entry.transferSize || 0,
        initiatorType: entry.initiatorType,
      }))
      .sort((left, right) => right.duration - left.duration)
      .slice(0, 8);
  }, startedAt);

test.describe("Pyrus app screen waterfall", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await appServerAvailable(APP_URL)),
      `Pyrus app is not reachable at ${APP_URL}. Start the app with Replit's normal runner or set PYRUS_APP_URL.`,
    );
  });

  test("all primary screens display without sticky loading fallbacks", async ({
    page,
  }) => {
    test.setTimeout(WATERFALL_TEST_TIMEOUT_MS);

    const runtimeFailures: string[] = [];
    const httpIssues: string[] = [];
    const screenTimings: ScreenTiming[] = [];

    page.on("pageerror", (error) => {
      runtimeFailures.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        if (text.startsWith("Failed to load resource:")) {
          httpIssues.push(`console: ${text}`);
          return;
        }
        runtimeFailures.push(`console: ${text}`);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        httpIssues.push(`http ${response.status()}: ${response.url()}`);
      }
    });

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-testid="platform-screen-stack"]')).toBeVisible({
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden({
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    for (const screen of SCREENS) {
      const startedAt = await page.evaluate(() => performance.now());

      if (screen.id !== "market") {
        const navButton = page
          .locator('[data-testid="platform-screen-nav"]')
          .getByRole("button", {
            name: new RegExp(`^${escapeRegExp(screen.label)}$`),
          });
        await navButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
      }

      const screenHost = page.locator(`[data-testid="screen-host-${screen.id}"]`);
      await expect(screenHost).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });
      await expect(screenHost).toHaveAttribute("aria-hidden", "false", {
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await expect(
        page.locator(`[data-testid="screen-load-error-${screen.id}"]`),
      ).toHaveCount(0);
      await expect(
        page.locator(`[data-testid="screen-loading-${screen.id}"]`),
      ).toBeHidden({ timeout: NAVIGATION_TIMEOUT_MS });
      await expect(page.locator('[data-testid="screen-suspense-fallback"]')).toBeHidden({
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden();

      screenTimings.push({
        screenId: screen.id,
        visibleAfterMs: Math.round((await page.evaluate(() => performance.now())) - startedAt),
        loadingFallbackVisible: await isVisibleOrAttached(
          page,
          `[data-testid="screen-loading-${screen.id}"]`,
        ),
        suspenseFallbackVisible: await isVisibleOrAttached(
          page,
          '[data-testid="screen-suspense-fallback"]',
        ),
        resources: await captureRecentResources(page, startedAt),
      });
    }

    console.log(
      JSON.stringify(
        {
          appUrl: APP_URL,
          httpIssues,
          screens: screenTimings,
        },
        null,
        2,
      ),
    );

    expect(runtimeFailures).toEqual([]);
    expect(
      screenTimings.filter(
        (timing) => timing.loadingFallbackVisible || timing.suspenseFallbackVisible,
      ),
    ).toEqual([]);
  });
});

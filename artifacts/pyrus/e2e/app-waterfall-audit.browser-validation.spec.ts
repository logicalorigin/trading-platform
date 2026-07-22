import { expect, test, type Page } from "@playwright/test";

const DEFAULT_APP_URL = "http://127.0.0.1:18747/";
const APP_URL = process.env.PYRUS_APP_URL || DEFAULT_APP_URL;
const WATERFALL_TEST_TIMEOUT_MS = 210_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SERVER_PROBE_TIMEOUT_MS = 2_500;

const ALL_SCREENS = [
  { id: "market", label: "Market", anchor: '[data-testid="market-demo-screen"]' },
  { id: "signals", label: "Signals", anchor: '[data-testid="signals-screen"]' },
  { id: "flow", label: "Flow", anchor: '[data-testid="flow-main-layout"]' },
  { id: "gex", label: "GEX", anchor: '[data-testid="gex-screen"]' },
  { id: "trade", label: "Trade", anchor: ".ra-panel-enter[data-trade-layout]" },
  { id: "account", label: "Account", anchor: '[data-testid="account-screen"]' },
  { id: "research", label: "Research", anchor: '[data-testid="research-screen"]' },
  { id: "algo", label: "Algo", anchor: '[data-testid="algo-screen"]' },
  { id: "backtest", label: "Backtest", anchor: '[data-testid="backtest-screen"]' },
  { id: "diagnostics", label: "Diagnostics", anchor: '[data-testid="diagnostics-screen"]' },
  { id: "settings", label: "Settings", anchor: '[data-testid="settings-screen"]' },
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
  resources: Array<{
    name: string;
    duration: number;
    startTime: number;
    transferSize: number;
    initiatorType: string;
  }>;
};

type HttpIssue = {
  status: number;
  method: string;
  pathname: string;
  search: string;
};

const isExpectedHttpIssue = (issue: HttpIssue) => {
  if (
    issue.status === 404 &&
    issue.method === "POST" &&
    /^\/api\/streams\/stocks\/aggregates\/sessions\/[^/]+\/symbols$/.test(
      issue.pathname,
    )
  ) {
    return true;
  }

  return (
    issue.status === 503 &&
    issue.method === "GET" &&
    /^\/api\/algo\/deployments\/[^/]+\/signal-options\/performance$/.test(
      issue.pathname,
    ) &&
    new URLSearchParams(issue.search).get("cacheMode") === "cache-only"
  );
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    const httpIssues: HttpIssue[] = [];
    const httpConsoleDiagnostics: string[] = [];
    const screenTimings: ScreenTiming[] = [];

    page.on("pageerror", (error) => {
      runtimeFailures.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        if (text.startsWith("Failed to load resource:")) {
          httpConsoleDiagnostics.push(text);
          return;
        }
        runtimeFailures.push(`console: ${text}`);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        httpIssues.push({
          status: response.status(),
          method: response.request().method(),
          pathname: url.pathname,
          search: url.search,
        });
      }
    });

    await page.setViewportSize({ width: 1600, height: 1000 });
    const authSessionResponse = await page.context().request.get(
      new URL("/api/auth/session", APP_URL).toString(),
    );
    const authSessionPayload = (await authSessionResponse.json()) as {
      authenticated?: boolean;
    };
    expect(authSessionResponse.ok()).toBe(true);
    expect(
      authSessionPayload.authenticated,
      "PYRUS_STORAGE_STATE must contain a live authenticated Pyrus session",
    ).toBe(true);
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-testid="platform-screen-stack"]')).toBeVisible({
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden({
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    for (const screen of SCREENS) {
      const startedAt = await page.evaluate(() => performance.now());
      const navButton = page
        .locator('[data-testid="platform-screen-nav"]')
        .getByRole("button", {
          name: new RegExp(`^${escapeRegExp(screen.label)}$`),
        });

      if (screen.id !== "market") {
        await navButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
      }
      await expect(navButton).toHaveAttribute("aria-current", "page", {
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      const screenHost = page.locator(`[data-testid="screen-host-${screen.id}"]`);
      await expect(screenHost).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });
      await expect(screenHost).toHaveAttribute("aria-hidden", "false", {
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await expect(screenHost.locator(screen.anchor)).toBeVisible({
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await expect(
        screenHost.locator(`[data-testid="screen-load-error-${screen.id}"]`),
      ).toHaveCount(0);
      await expect(
        screenHost.locator(`[data-testid="screen-loading-${screen.id}"]`),
      ).toHaveCount(0);
      await expect(
        screenHost.locator('[data-testid="screen-suspense-fallback"]'),
      ).toHaveCount(0);
      await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden();

      screenTimings.push({
        screenId: screen.id,
        visibleAfterMs: Math.round((await page.evaluate(() => performance.now())) - startedAt),
        resources: await captureRecentResources(page, startedAt),
      });
    }

    console.log(
      JSON.stringify(
        {
          appUrl: APP_URL,
          httpConsoleDiagnostics,
          httpIssues,
          screens: screenTimings,
        },
        null,
        2,
      ),
    );

    expect(runtimeFailures).toEqual([]);
    expect(httpIssues.filter((issue) => !isExpectedHttpIssue(issue))).toEqual([]);
  });
});

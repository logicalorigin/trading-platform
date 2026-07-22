import { expect, test, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
const FIXTURE_TIME = "2026-07-19T22:00:00.000Z";
const SCENARIOS = [
  { name: "phone-light", width: 390, height: 844, theme: "light" },
  { name: "tablet-dark", width: 768, height: 1024, theme: "dark" },
  { name: "desktop-light", width: 1440, height: 900, theme: "light" },
] as const;

const isAllowedTelemetry = (method: string, path: string) =>
  method === "POST" &&
  (path === "/api/diagnostics/client-events" ||
    path === "/api/diagnostics/client-metrics" ||
    path === "/api/sparklines/seed");

const settledOnboarding = {
  schemaVersion: 1,
  autoOpenShownVersion: 1,
  requiredNoticeSeenVersion: 1,
  requiredNoticeResolvedVersion: 1,
  requiredAcknowledgedVersion: 1,
  readinessInspectedVersion: 1,
  activeTrackId: null,
  tracks: {},
};

async function installApiFixture(page: Page, theme: "light" | "dark") {
  const blockedMutations: string[] = [];

  await page.addInitScript(
    ({ selectedTheme, onboarding }) => {
      Object.defineProperty(window, "__PYRUS_PERF_WARMUP_OVERRIDES__", {
        configurable: true,
        value: {
          disableOperationalCodePreload: true,
          disableHiddenScreenWarmMount: true,
          disableBackgroundDataWarmup: true,
          disableResearchWorkspacePreload: true,
        },
      });
      window.localStorage.setItem(
        "pyrus:state:v1",
        JSON.stringify({
          screen: "diagnostics",
          theme: selectedTheme,
          sidebarCollapsed: true,
          activitySidebarCollapsed: true,
          userPreferences: {
            appearance: { theme: selectedTheme },
            onboarding,
          },
        }),
      );
    },
    { selectedTheme: theme, onboarding: settledOnboarding },
  );

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (isAllowedTelemetry(method, path)) {
      if (path === "/api/sparklines/seed") {
        const body = request.postDataJSON() as {
          symbols?: unknown[];
          timeframe?: string;
        };
        await route.fulfill({
          json: {
            timeframe: body.timeframe || "5m",
            source: "fixture",
            historySource: "fixture",
            requestedSymbolCount: body.symbols?.length || 0,
            hydratedSymbolCount: 0,
            items: [],
          },
        });
      } else {
        await route.fulfill({ status: 202, json: {} });
      }
      return;
    }
    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (method !== "GET") {
      blockedMutations.push(`${method} ${path}`);
      await route.fulfill({
        status: 405,
        json: { error: "Mutation blocked by loading/error recovery fixture." },
      });
      return;
    }
    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: `loading-recovery-${theme}`,
            email: `loading-recovery-${theme}@example.com`,
            role: "user",
            entitlements: [],
          },
          csrfToken: `loading-recovery-${theme}-csrf`,
        },
      });
      return;
    }
    if (path === "/api/session") {
      await route.fulfill({
        json: {
          environment: "shadow",
          brokerProvider: "ibkr",
          marketDataProvider: "massive",
          marketDataProviders: {
            live: "massive",
            historical: "massive",
            research: "fmp",
          },
          configured: { massive: true, ibkr: false, research: false },
          ibkrBridge: null,
          runtime: { ibkr: {} },
          timestamp: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/settings/preferences") {
      await route.fulfill({
        json: {
          profileKey: "default",
          version: 1,
          preferences: {
            appearance: { theme },
            onboarding: settledOnboarding,
          },
          source: "database",
          updatedAt: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/watchlists") {
      await route.fulfill({ json: { watchlists: [] } });
      return;
    }
    if (path === "/api/accounts") {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return blockedMutations;
}

for (const scenario of SCENARIOS) {
  test(`${scenario.name}: stable polite loading becomes keyboard-recoverable failure`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({
      width: scenario.width,
      height: scenario.height,
    });
    const blockedMutations = await installApiFixture(page, scenario.theme);

    let releaseFaultModule = () => {};
    const faultModuleGate = new Promise<void>((resolve) => {
      releaseFaultModule = resolve;
    });
    await page.route("**/src/screens/DiagnosticsScreen.jsx*", async (route) => {
      await faultModuleGate;
      await route.fulfill({
        contentType: "application/javascript",
        body: `
          export default function DiagnosticsScreen() {
            if (!globalThis.__PYRUS_LOADING_RECOVERY_READY__) {
              throw new Error("Synthetic Diagnostics render fault");
            }
            return null;
          }
        `,
      });
    });

    const url = new URL(APP_URL);
    url.searchParams.set("screen", "diagnostics");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });

    const host = page.getByTestId("screen-host-diagnostics");
    const loader = page.getByTestId("screen-loading-diagnostics");
    await expect(host).toBeVisible({ timeout: READY_TIMEOUT_MS });
    await expect(loader).toBeVisible({ timeout: READY_TIMEOUT_MS });
    await expect(loader).toHaveAttribute("role", "status");
    await expect(loader).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("html")).toHaveAttribute(
      "data-pyrus-theme",
      scenario.theme,
    );

    const [hostBox, loaderBox] = await Promise.all([
      host.boundingBox(),
      loader.boundingBox(),
    ]);
    expect(hostBox).not.toBeNull();
    expect(loaderBox).not.toBeNull();
    expect(loaderBox!.height).toBeGreaterThanOrEqual(160);
    expect(loaderBox!.width).toBeLessThanOrEqual(hostBox!.width + 1);

    releaseFaultModule();
    const fallback = page.getByTestId(
      "platform-error-boundary-diagnostics-screen",
    );
    await expect(fallback).toBeVisible({ timeout: READY_TIMEOUT_MS });
    await expect(fallback).toHaveAttribute("role", "alert");

    const retry = fallback.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeFocused();
    const actionHeights = await fallback
      .locator(".platform-error-boundary-action")
      .evaluateAll((actions) =>
        actions.map((action) => action.getBoundingClientRect().height),
      );
    const expectedMinimum = scenario.width < 1024 ? 44 : 24;
    expect(
      actionHeights.every((height) => height >= expectedMinimum),
      `expected recovery actions >= ${expectedMinimum}px, received ${actionHeights.join(", ")}`,
    ).toBe(true);

    const palette = await fallback
      .locator(".platform-error-boundary-panel")
      .evaluate((panel) => {
        const style = getComputedStyle(panel);
        return {
          background: style.backgroundColor,
          color: style.color,
          overflow: panel.scrollWidth - panel.clientWidth,
        };
      });
    expect(palette.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(palette.color).not.toBe(palette.background);
    expect(palette.overflow).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      (
        globalThis as typeof globalThis & {
          __PYRUS_LOADING_RECOVERY_READY__?: boolean;
        }
      ).__PYRUS_LOADING_RECOVERY_READY__ = true;
    });
    await page.keyboard.press("Enter");
    await expect(fallback).toHaveCount(0);
    await expect(host).toBeVisible();
    expect(blockedMutations).toEqual([]);
  });
}

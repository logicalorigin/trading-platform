import { expect, test, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
const EDGE_GUTTER_PX = 8;

const viewports = [
  { name: "phone-375", width: 375, height: 812, touch: true },
  { name: "tablet-768", width: 768, height: 1024, touch: true },
  { name: "desktop-1280", width: 1280, height: 900, touch: false },
  { name: "wide-1920", width: 1920, height: 1080, touch: false },
] as const;

const allowedBackgroundMutation = (method: string, path: string) =>
  (method === "POST" && path === "/api/sparklines/seed") ||
  (method === "POST" && path === "/api/diagnostics/client-metrics");

async function fulfillAllowedMutation(route: Route, path: string) {
  if (path === "/api/sparklines/seed") {
    const payload = route.request().postDataJSON() as {
      symbols?: unknown[];
      timeframe?: string;
    };
    await route.fulfill({
      json: {
        timeframe: payload.timeframe || "5m",
        source: "fixture",
        historySource: "fixture",
        requestedSymbolCount: payload.symbols?.length || 0,
        hydratedSymbolCount: 0,
        items: [],
      },
    });
    return;
  }
  await route.fulfill({ status: 202, json: {} });
}

async function installMarketPopupFixture(page: Page) {
  const protectedMutations: string[] = [];

  await page.addInitScript(() => {
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
        screen: "market",
        sidebarCollapsed: true,
        activitySidebarCollapsed: true,
      }),
    );
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (method === "GET" && path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "market-popup-responsive-review",
            email: "market-popup-responsive-review@example.com",
            role: "user",
            entitlements: [],
          },
          csrfToken: "market-popup-responsive-review-csrf",
        },
      });
      return;
    }

    if (allowedBackgroundMutation(method, path)) {
      await fulfillAllowedMutation(route, path);
      return;
    }

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      protectedMutations.push(`${method} ${path}`);
      await route.fulfill({
        status: 405,
        json: { error: "Protected mutation blocked by Market popup QA." },
      });
      return;
    }

    await route.continue();
  });

  return { protectedMutations };
}

test.describe.configure({ mode: "serial" });

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.touch });

    test("Pyrus Signals settings stay inside the Market viewport", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const fixture = await installMarketPopupFixture(page);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      const targetUrl = new URL(APP_URL);
      targetUrl.searchParams.set("screen", "market");
      await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded" });

      expect(new URL(page.url()).searchParams.has("pyrusQa")).toBe(false);
      await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
        timeout: READY_TIMEOUT_MS,
      });
      await expect(page.getByTestId("screen-host-market")).toBeVisible({
        timeout: READY_TIMEOUT_MS,
      });
      await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
        timeout: READY_TIMEOUT_MS,
      });

      const trigger = page
        .locator('button[aria-label="Pyrus Signals overlay"]:visible')
        .first();
      await expect(trigger).toBeEnabled();
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();

      const panel = page
        .locator(
          '[data-radix-popper-content-wrapper] > div[data-state="open"]',
        )
        .filter({ hasText: "Pyrus Signals Settings" })
        .last();
      await expect(panel).toBeVisible();

      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(panelBox!.x).toBeGreaterThanOrEqual(EDGE_GUTTER_PX - 1);
      expect(panelBox!.y).toBeGreaterThanOrEqual(EDGE_GUTTER_PX - 1);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(
        viewport.width - EDGE_GUTTER_PX + 1,
      );
      expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(
        viewport.height - EDGE_GUTTER_PX + 1,
      );
      expect(panelBox!.width).toBeLessThanOrEqual(
        Math.min(560, viewport.width - EDGE_GUTTER_PX * 2) + 1,
      );

      const panelScroll = await panel.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(panelScroll.scrollWidth).toBeLessThanOrEqual(
        panelScroll.clientWidth + 1,
      );
      expect(panelScroll.scrollHeight).toBeGreaterThan(
        panelScroll.clientHeight,
      );

      const timeHorizonRow = panel
        .getByText("Time Horizon", { exact: true })
        .locator("..")
        .locator("..");
      const rowColumnCount = await timeHorizonRow.evaluate((element) =>
        window
          .getComputedStyle(element)
          .gridTemplateColumns.trim()
          .split(/\s+/)
          .filter(Boolean).length,
      );
      expect(rowColumnCount).toBe(viewport.width < 768 ? 1 : 2);

      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      expect(fixture.protectedMutations).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  });
}

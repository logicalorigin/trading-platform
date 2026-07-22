import { expect, test, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
const FIXTURE_TIME = "2026-07-19T22:00:00.000Z";
const LONG_IDENTITY =
  "Portfolio Operations Administrator With An Intentionally Long Display Name";
const LONG_ERROR =
  "Synthetic broker readiness failure with intentionally long diagnostic copy that must wrap inside the status surface without changing header allocation or covering navigation.";

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

const isBackgroundTelemetry = (method: string, path: string) =>
  method === "POST" &&
  (path === "/api/diagnostics/client-events" ||
    path === "/api/diagnostics/client-metrics" ||
    path === "/api/sparklines/seed");

async function installStatusFixture(
  page: Page,
  {
    theme = "dark",
    watchlistMutationResults = [],
  }: {
    theme?: "light" | "dark";
    watchlistMutationResults?: Array<"error" | "success">;
  } = {},
) {
  const blockedMutations: string[] = [];
  let watchlistMutationCount = 0;

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
          screen: "market",
          theme: selectedTheme,
          sidebarCollapsed: false,
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

    if (isBackgroundTelemetry(method, path)) {
      await route.fulfill({
        status: 202,
        json:
          path === "/api/sparklines/seed"
            ? {
                timeframe: "5m",
                source: "fixture",
                historySource: "fixture",
                requestedSymbolCount: 0,
                hydratedSymbolCount: 0,
                items: [],
              }
            : {},
      });
      return;
    }
    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "POST" && path === "/api/watchlists") {
      const result = watchlistMutationResults[watchlistMutationCount];
      watchlistMutationCount += 1;
      if (result === "success") {
        const requestBody = request.postDataJSON() as { name?: string };
        await route.fulfill({
          json: {
            id: `status-fixture-${watchlistMutationCount}`,
            name: requestBody.name || "Fixture",
            isDefault: false,
            items: [],
          },
        });
      } else {
        await route.fulfill({
          status: 503,
          json: { detail: LONG_ERROR },
        });
      }
      return;
    }
    if (method !== "GET") {
      blockedMutations.push(`${method} ${path}`);
      await route.fulfill({
        status: 405,
        json: { error: "Mutation blocked by global status fixture." },
      });
      return;
    }
    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "global-status-review",
            email: "global-status-review@example.com",
            displayName: LONG_IDENTITY,
            role: "user",
            entitlements: [],
          },
          csrfToken: "global-status-review-csrf",
        },
      });
      return;
    }
    if (path === "/api/session") {
      await route.fulfill({
        json: {
          environment: "shadow",
          brokerProvider: "snaptrade",
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
    if (path === "/api/broker-execution/snaptrade/readiness") {
      await route.fulfill({
        status: 503,
        json: { detail: LONG_ERROR },
      });
      return;
    }
    if (path === "/api/watchlists") {
      await route.fulfill({
        json: {
          watchlists: [
            {
              id: "status-fixture-default",
              name: "Primary",
              isDefault: true,
              items: [],
            },
          ],
        },
      });
      return;
    }
    if (path === "/api/accounts") {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  return {
    blockedMutations,
    watchlistMutationCount: () => watchlistMutationCount,
  };
}

test("trust status stays ahead of decoration and long errors remain contained at doctrine widths", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const fixture = await installStatusFixture(page, { theme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });

  const url = new URL(APP_URL);
  url.searchParams.set("screen", "market");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const status = page.getByTestId("platform-header-status");
    const session = page.getByTestId("header-session-status");
    const broker = page.getByTestId("header-snaptrade-broker-status");
    await expect(status).toBeVisible();
    await expect(session).toBeVisible();
    await expect(broker).toBeVisible();

    const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(
        '[data-testid="platform-compact-header"]',
      );
      const status = document.querySelector<HTMLElement>(
        '[data-testid="platform-header-status"]',
      );
      const session = document.querySelector<HTMLElement>(
        '[data-testid="header-session-status"]',
      );
      const broker = document.querySelector<HTMLElement>(
        '[data-testid="header-snaptrade-broker-status"]',
      );
      if (!header || !status || !session || !broker) {
        throw new Error("Header status geometry is incomplete.");
      }
      const box = (element: HTMLElement) => {
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      };
      return {
        header: box(header),
        status: box(status),
        session: box(session),
        broker: box(broker),
        documentOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(geometry.session.left).toBeLessThanOrEqual(geometry.broker.left);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.status.left).toBeGreaterThanOrEqual(
      geometry.header.left - 1,
    );
    expect(geometry.status.right).toBeLessThanOrEqual(
      geometry.header.right + 1,
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open broker connection details" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Broker connection" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(LONG_ERROR);
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844);
  expect(fixture.blockedMutations).toEqual([]);
});

test("toast burst is single-announcement, priority ordered, bounded, and mutation isolated", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await installStatusFixture(page, {
    watchlistMutationResults: ["error", "success", "error", "success"],
  });

  const url = new URL(APP_URL);
  url.searchParams.set("screen", "market");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  const create = page.getByTestId("watchlist-create-watchlist");
  await expect(create).toBeVisible({ timeout: READY_TIMEOUT_MS });

  for (let index = 0; index < 4; index += 1) {
    page.once("dialog", (dialog) =>
      dialog.accept(`Status fixture ${index + 1}`),
    );
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/watchlists",
    );
    await create.click();
    await response;
    await expect(create).toBeEnabled();
  }

  const stack = page.getByTestId("toast-stack");
  await expect(stack).toBeVisible();
  await expect(stack).not.toHaveAttribute("aria-live");
  const items = stack.getByTestId("toast-item");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toHaveAttribute("role", "alert");
  await expect(items.nth(1)).toHaveAttribute("role", "alert");
  await expect(items.nth(2)).toHaveAttribute("role", "status");
  await expect(items.nth(0)).toContainText("Unable to create watchlist");
  await expect(items.nth(2)).toContainText("Watchlist created");

  const overlap = await page.evaluate(() => {
    const stack = document.querySelector<HTMLElement>(
      '[data-testid="toast-stack"]',
    );
    const header = document.querySelector<HTMLElement>(
      '[data-testid="platform-compact-header"]',
    );
    if (!stack || !header) {
      throw new Error("Global overlay geometry is incomplete.");
    }
    const toastBox = stack.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    return {
      headerOverlap:
        toastBox.left < headerBox.right &&
        toastBox.right > headerBox.left &&
        toastBox.top < headerBox.bottom &&
        toastBox.bottom > headerBox.top,
      documentOverflow:
        document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(overlap.headerOverlap).toBe(false);
  expect(overlap.documentOverflow).toBeLessThanOrEqual(1);
  expect(fixture.watchlistMutationCount()).toBe(4);
  expect(fixture.blockedMutations).toEqual([]);
});

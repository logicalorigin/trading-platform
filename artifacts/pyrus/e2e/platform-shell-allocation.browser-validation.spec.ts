import { expect, test, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const NAVIGATION_TIMEOUT_MS = 60_000;
const FIXTURE_TIME = "2026-07-19T22:00:00.000Z";

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

const quietEventStreamPaths = new Set([
  "/api/diagnostics/stream",
  "/api/signal-monitor/matrix/stream",
  "/api/streams/accounts",
  "/api/streams/accounts/shadow",
  "/api/streams/algo/cockpit",
  "/api/streams/executions",
  "/api/streams/options/chains",
  "/api/streams/orders",
  "/api/streams/quotes",
  "/api/streams/stocks/aggregates",
]);

async function fulfillQuietEventStream(route: Route) {
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: "event: ready\ndata: {}\n\nretry: 60000\n\n",
  });
}

async function installShellFixture(page: Page) {
  const blockedMutations: string[] = [];
  const unexpectedReads: string[] = [];

  await page.addInitScript(({ onboarding }) => {
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
        sym: "SPY",
        sidebarCollapsed: true,
        activitySidebarCollapsed: true,
        userPreferences: { onboarding },
      }),
    );
  }, { onboarding: settledOnboarding });

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname);

    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (
      method === "POST" &&
      (path === "/api/diagnostics/client-events" ||
        path === "/api/diagnostics/client-metrics" ||
        path === "/api/sparklines/seed")
    ) {
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
    if (method !== "GET") {
      blockedMutations.push(`${method} ${path}`);
      await route.fulfill({
        status: 405,
        json: { error: "Mutation blocked by the shell fixture." },
      });
      return;
    }
    if (quietEventStreamPaths.has(path)) {
      await fulfillQuietEventStream(route);
      return;
    }
    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "shell-allocation-review",
            email: "shell-allocation-review@example.com",
            role: "user",
            entitlements: [],
          },
          csrfToken: "shell-allocation-review-csrf",
        },
      });
      return;
    }
    if (path === "/api/auth/bootstrap") {
      await route.fulfill({ json: { status: "ready" } });
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
          preferences: { onboarding: settledOnboarding },
          source: "database",
          updatedAt: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/watchlists") {
      await route.fulfill({
        json: {
          watchlists: [
            {
              id: "shell-core",
              name: "Core",
              isDefault: true,
              items: [{ id: "shell-spy", symbol: "SPY" }],
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
    if (path === "/api/algo/deployments") {
      await route.fulfill({ json: { deployments: [] } });
      return;
    }
    if (path === "/api/algo/events") {
      await route.fulfill({ json: { events: [] } });
      return;
    }
    if (path === "/api/broker-connections") {
      await route.fulfill({ json: { connections: [] } });
      return;
    }
    if (path === "/api/broker-execution/included-accounts") {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }
    if (path === "/api/broker-execution/snaptrade/readiness") {
      await route.fulfill({
        json: {
          provider: "snaptrade",
          configured: false,
          status: "unconfigured",
          checkedAt: FIXTURE_TIME,
          credentials: { clientIdPresent: false, apiKeyPresent: false },
          user: { registered: false, status: "not_registered" },
          limitations: [],
          upstream: null,
        },
      });
      return;
    }
    if (path === "/api/charting/pine-scripts") {
      await route.fulfill({ json: {} });
      return;
    }
    if (path === "/api/bars") {
      await route.fulfill({
        json: {
          symbol: url.searchParams.get("symbol") || "SPY",
          timeframe: url.searchParams.get("timeframe") || "5m",
          bars: [],
          transport: null,
          delayed: false,
          gapFilled: false,
          freshness: "unavailable",
          marketDataMode: null,
          dataUpdatedAt: null,
          ageMs: null,
          emptyReason: "fixture",
          historySource: null,
          studyFallback: false,
          historyPage: null,
        },
      });
      return;
    }
    if (path === "/api/executions") {
      await route.fulfill({ json: { executions: [] } });
      return;
    }
    if (path === "/api/flow/events" || path === "/api/flow/events/aggregate") {
      await route.fulfill({ json: { events: [], source: {} } });
      return;
    }
    if (path === "/api/flow/universe") {
      await route.fulfill({ json: { symbols: [] } });
      return;
    }
    if (path === "/api/news") {
      await route.fulfill({ json: { articles: [] } });
      return;
    }
    if (path === "/api/orders") {
      await route.fulfill({ json: { orders: [] } });
      return;
    }
    if (path === "/api/positions") {
      await route.fulfill({ json: { positions: [] } });
      return;
    }
    if (path === "/api/quotes/snapshot") {
      await route.fulfill({
        json: {
          quotes: [],
          transport: null,
          delayed: false,
          fallbackUsed: false,
        },
      });
      return;
    }
    if (path === "/api/research/status") {
      await route.fulfill({
        json: {
          configured: false,
          provider: "fmp",
          available: false,
          updatedAt: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/signal-monitor/events") {
      await route.fulfill({
        json: {
          events: [],
          nextCursor: null,
          hasMore: false,
          sourceStatus: "database",
        },
      });
      return;
    }
    if (path === "/api/signal-monitor/profile") {
      await route.fulfill({ json: null });
      return;
    }
    if (path === "/api/universe/logos") {
      await route.fulfill({ json: { logos: {} } });
      return;
    }
    if (
      path === "/api/gex-snapshots" ||
      /^\/api\/gex\/[^/]+\/(?:projection|zero-gamma)$/u.test(path)
    ) {
      await route.fulfill({ json: {} });
      return;
    }

    unexpectedReads.push(`${method} ${path}`);
    await route.fulfill({ json: {} });
  });

  return { blockedMutations, unexpectedReads };
}

const openAuthenticatedShell = async (page: Page) => {
  await page.goto(`${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=market`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByTestId("platform-screen-stack"),
    "The synthetic member session should reach the normal authenticated shell.",
  ).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });
  await expect(page.getByTestId("screen-host-market")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await expect(page.getByTestId("screen-suspense-fallback")).toBeHidden({
    timeout: NAVIGATION_TIMEOUT_MS,
  });
};

const expectNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth - window.innerWidth,
      (document.body?.scrollWidth || 0) - window.innerWidth,
    ),
  );
  expect(overflow).toBeLessThanOrEqual(1);
};

const expectPrimaryWorkspaceDominant = async (page: Page) => {
  const stack = page.getByTestId("platform-screen-stack");
  const optionalBoundingBox = async (testId: string) => {
    const element = page.getByTestId(testId);
    return (await element.count()) > 0 ? element.boundingBox() : null;
  };
  const [stackBox, watchlistBox, activityBox] = await Promise.all([
    stack.boundingBox(),
    optionalBoundingBox("platform-watchlist-sidebar"),
    optionalBoundingBox("platform-activity-sidebar"),
  ]);
  expect(stackBox).not.toBeNull();
  expect(stackBox!.width).toBeGreaterThan(windowWidth(page) / 2);
  for (const railBox of [watchlistBox, activityBox]) {
    if (railBox) expect(stackBox!.width).toBeGreaterThan(railBox.width);
  }
};

const windowWidth = (page: Page) => page.viewportSize()?.width || 0;

test("authenticated shell preserves allocation and closes drawers across doctrine widths", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  const fixture = await installShellFixture(page);
  await openAuthenticatedShell(page);

  const shell = page.locator(".ra-shell");
  await expect(shell).toHaveAttribute("data-layout", "tablet");
  await expect(page.getByTestId("platform-watchlist-sidebar")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  await expect(page.getByTestId("platform-activity-sidebar")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  await expect(page.getByTestId("mobile-bottom-nav")).toHaveCount(0);
  await expect(page.getByTestId("platform-bottom-status")).toBeVisible();
  await expectPrimaryWorkspaceDominant(page);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Expand watchlist sidebar" }).click();
  await expect(page.getByTestId("mobile-watchlist-drawer")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(shell).toHaveAttribute("data-layout", "phone");
  await expect(page.getByTestId("mobile-watchlist-drawer")).toBeHidden();
  await expect(page.getByTestId("platform-watchlist-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("platform-activity-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("platform-bottom-status")).toHaveCount(0);

  const mobileNav = page.getByTestId("mobile-bottom-nav");
  await expect(mobileNav).toBeVisible();
  const mobileNavButtons = mobileNav.getByRole("button");
  await expect(mobileNavButtons).toHaveCount(5);
  expect(
    (await mobileNavButtons.allTextContents()).map((label) => label.trim()),
  ).toEqual(["Market", "Signals", "Trade", "Account", "More"]);
  const mobileNavBoxes = await mobileNavButtons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        height: box.height,
      };
    }),
  );
  expect(mobileNavBoxes.every((box) => box.height >= 44)).toBe(true);
  expect(
    mobileNavBoxes.every(
      (box) =>
        box.left >= 0 &&
        box.right <= windowWidth(page) + 1 &&
        box.top >= 0 &&
        box.bottom <= 844 + 1,
    ),
  ).toBe(true);
  await expectPrimaryWorkspaceDominant(page);
  await expectNoHorizontalOverflow(page);

  await page.getByTestId("mobile-bottom-nav-more").click();
  await expect(page.getByTestId("mobile-more-sheet")).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(shell).toHaveAttribute("data-layout", "desktop");
  await expect(page.getByTestId("mobile-more-sheet")).toBeHidden();
  await expect(page.getByTestId("mobile-bottom-nav")).toHaveCount(0);
  await expect(page.getByTestId("platform-bottom-status")).toBeVisible();
  await expect(page.getByTestId("platform-watchlist-sidebar")).toBeVisible();
  await expect(page.getByTestId("platform-activity-sidebar")).toBeVisible();
  await expectPrimaryWorkspaceDominant(page);
  await expectNoHorizontalOverflow(page);

  await page
    .getByTestId("platform-screen-nav")
    .getByRole("button", { name: "Algo", exact: true })
    .click();
  await expect(page.getByTestId("screen-host-algo")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await expect(page.getByTestId("platform-activity-sidebar")).toHaveCount(0);
  await expectPrimaryWorkspaceDominant(page);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(shell).toHaveAttribute("data-layout", "tablet");
  await expect(page.getByTestId("platform-activity-sidebar")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(shell).toHaveAttribute("data-layout", "desktop");
  await expect(page.getByTestId("platform-activity-sidebar")).toHaveCount(0);
  await page
    .getByTestId("platform-screen-nav")
    .getByRole("button", { name: "Market", exact: true })
    .click();
  await expect(page.getByTestId("screen-host-market")).toBeVisible({
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await expect(page.getByTestId("platform-watchlist-sidebar")).toBeVisible();
  await expect(page.getByTestId("platform-activity-sidebar")).toBeVisible();
  await expectPrimaryWorkspaceDominant(page);
  await expectNoHorizontalOverflow(page);

  expect({
    runtimeErrors,
    unexpectedReads: fixture.unexpectedReads,
    blockedMutations: fixture.blockedMutations,
  }).toEqual({
    runtimeErrors: [],
    unexpectedReads: [],
    blockedMutations: [],
  });
});

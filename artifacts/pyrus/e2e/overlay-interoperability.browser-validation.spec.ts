import { expect, test, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
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

const users = {
  a: {
    id: "overlay-user-a",
    email: "overlay-user-a@example.com",
    displayName: "Overlay User A",
    role: "user",
    entitlements: [],
  },
  b: {
    id: "overlay-user-b",
    email: "overlay-user-b@example.com",
    displayName: "Overlay User B",
    role: "user",
    entitlements: [],
  },
} as const;

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

const staticReadResponses = new Map<string, unknown>([
  ["/api/accounts", { accounts: [] }],
  ["/api/algo/deployments", { deployments: [] }],
  ["/api/algo/events", { events: [] }],
  ["/api/broker-connections", { connections: [] }],
  ["/api/broker-execution/included-accounts", { accounts: [] }],
  ["/api/charting/pine-scripts", {}],
  ["/api/executions", { executions: [] }],
  ["/api/flow/events", { events: [], source: {} }],
  ["/api/flow/events/aggregate", { events: [], source: {} }],
  ["/api/flow/universe", { symbols: [] }],
  ["/api/gex-snapshots", {}],
  ["/api/news", { articles: [] }],
  ["/api/orders", { orders: [] }],
  ["/api/positions", { positions: [] }],
  [
    "/api/quotes/snapshot",
    { quotes: [], transport: null, delayed: false, fallbackUsed: false },
  ],
  [
    "/api/research/status",
    {
      configured: false,
      provider: "fmp",
      available: false,
      updatedAt: FIXTURE_TIME,
    },
  ],
  [
    "/api/signal-monitor/events",
    {
      events: [],
      nextCursor: null,
      hasMore: false,
      sourceStatus: "database",
    },
  ],
  ["/api/signal-monitor/profile", null],
  ["/api/universe/logos", { logos: {} }],
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

async function installOverlayFixture(page: Page) {
  const blockedMutations: string[] = [];
  const unexpectedReads: string[] = [];
  const allowedMutations: string[] = [];
  let activeUser: (typeof users)[keyof typeof users] | null = users.a;
  let watchlistMutationCount = 0;
  let releaseDelayedWatchlist = () => {};
  let markDelayedWatchlistStarted = () => {};
  const delayedWatchlistGate = new Promise<void>((resolve) => {
    releaseDelayedWatchlist = resolve;
  });
  const delayedWatchlistStarted = new Promise<void>((resolve) => {
    markDelayedWatchlistStarted = resolve;
  });

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
        sidebarCollapsed: false,
        activitySidebarCollapsed: true,
        userPreferences: {
          appearance: { theme: "dark", reducedMotion: "on" },
          onboarding,
        },
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
    if (method === "POST" && path === "/api/auth/logout") {
      allowedMutations.push(`${method} ${path}`);
      activeUser = null;
      await route.fulfill({ json: { user: null, csrfToken: null } });
      return;
    }
    if (method === "POST" && path === "/api/auth/login") {
      allowedMutations.push(`${method} ${path}`);
      const body = request.postDataJSON() as { email?: string };
      activeUser = body.email === users.a.email ? users.a : users.b;
      await route.fulfill({
        json: {
          user: activeUser,
          csrfToken: `${activeUser.id}-csrf`,
        },
      });
      return;
    }
    if (method === "POST" && path === "/api/watchlists") {
      allowedMutations.push(`${method} ${path}`);
      watchlistMutationCount += 1;
      if (watchlistMutationCount === 2) {
        markDelayedWatchlistStarted();
        await delayedWatchlistGate;
      }
      const body = request.postDataJSON() as { name?: string };
      await route.fulfill({
        json: {
          id: `overlay-watchlist-${watchlistMutationCount}`,
          name: body.name || `Overlay ${watchlistMutationCount}`,
          isDefault: false,
          items: [],
        },
      });
      return;
    }
    if (method !== "GET") {
      blockedMutations.push(`${method} ${path}`);
      await route.fulfill({
        status: 405,
        json: { error: "Mutation blocked by the overlay fixture." },
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
          user: activeUser,
          csrfToken: activeUser ? `${activeUser.id}-csrf` : null,
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
          preferences: {
            appearance: {
              theme: "dark",
              reducedMotion: "on",
            },
            onboarding: settledOnboarding,
          },
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
              id: "overlay-core",
              name: "Core",
              isDefault: true,
              items: [{ id: "overlay-spy", symbol: "SPY" }],
            },
          ],
        },
      });
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
    if (
      /^\/api\/gex\/[^/]+\/(?:projection|zero-gamma)$/u.test(path)
    ) {
      await route.fulfill({ json: {} });
      return;
    }
    if (staticReadResponses.has(path)) {
      await route.fulfill({ json: staticReadResponses.get(path) });
      return;
    }

    unexpectedReads.push(`${method} ${path}`);
    await route.fulfill({ json: {} });
  });

  return {
    allowedMutations,
    blockedMutations,
    delayedWatchlistStarted,
    releaseDelayedWatchlist,
    unexpectedReads,
    watchlistMutationCount: () => watchlistMutationCount,
  };
}

async function openNormalApp(page: Page) {
  const url = new URL(APP_URL);
  url.searchParams.delete("pyrusQa");
  url.searchParams.delete("qa");
  url.searchParams.set("screen", "market");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("screen-host-market")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
}

async function signOut(page: Page) {
  await page
    .getByRole("button", { name: "Open account session details" })
    .click();
  const sessionDialog = page.getByRole("dialog", { name: "Account session" });
  await expect(sessionDialog).toBeVisible();
  await sessionDialog.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
}

async function signIn(page: Page, email: string) {
  const form = page.getByRole("form", { name: "Sign in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill("valid-password");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
}

test("topmost modal owns focus and Escape across Drawer, BottomSheet, and command palette", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await installOverlayFixture(page);
  await openNormalApp(page);

  const notificationsTrigger = page.getByTestId(
    "header-notifications-trigger",
  );
  await notificationsTrigger.click();
  const drawer = page.getByTestId("notifications-drawer");
  await expect(drawer).toBeVisible();
  const drawerClose = drawer.getByRole("button", {
    name: /Close Notifications/,
  });
  await drawerClose.focus();
  await expect(drawerClose).toBeFocused();

  await page.keyboard.press("Control+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  const paletteInput = palette.getByPlaceholder(
    "Search symbols, screens, or actions…",
  );
  await expect(paletteInput).toBeFocused();

  const desktopLayers = await Promise.all([
    drawer.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    palette.evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ]);
  expect(desktopLayers).toEqual([12_000, 12_300]);

  await page.keyboard.press("Tab");
  expect(
    await palette.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(drawerClose).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(notificationsTrigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const moreTrigger = page.getByTestId("mobile-bottom-nav-more");
  await moreTrigger.click();
  const moreSheet = page.getByTestId("mobile-more-sheet");
  await expect(moreSheet).toBeVisible();
  const moreClose = moreSheet.locator('button[aria-label="Close More"]');
  await moreClose.focus();

  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await expect(paletteInput).toBeFocused();
  const phoneLayers = await Promise.all([
    moreSheet.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    palette.evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ]);
  expect(phoneLayers).toEqual([12_100, 12_300]);

  const closeTargetHeights = await Promise.all([
    moreClose.evaluate((element) => element.getBoundingClientRect().height),
    palette
      .getByRole("button", { name: "Close command palette" })
      .evaluate((element) => element.getBoundingClientRect().height),
  ]);
  expect(closeTargetHeights.every((height) => height >= 44)).toBe(true);
  await expect(page.locator("html")).toHaveAttribute(
    "data-pyrus-reduced-motion",
    "on",
  );

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(moreSheet).toBeVisible();
  await expect(moreClose).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(moreSheet).toHaveCount(0);
  await expect(moreTrigger).toBeFocused();

  expect({
    blockedMutations: fixture.blockedMutations,
    unexpectedReads: fixture.unexpectedReads,
  }).toEqual({ blockedMutations: [], unexpectedReads: [] });
});

test("notification history and late captures stay bound to immutable user identity", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await installOverlayFixture(page);
  await openNormalApp(page);

  const create = page.getByTestId("watchlist-create-watchlist");
  await expect(create).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("User A history"));
  const firstResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/watchlists",
  );
  await create.click();
  await firstResponse;
  await expect(page.getByTestId("toast-stack")).toContainText(
    "Watchlist created",
  );

  const notificationsTrigger = page.getByTestId(
    "header-notifications-trigger",
  );
  await notificationsTrigger.click();
  let drawer = page.getByTestId("notifications-drawer");
  await expect(drawer).toContainText("Watchlist created");
  await expect(drawer).toContainText("Notifications · 1");
  await expect(
    drawer.locator('[role="button"] button, button [role="button"]'),
  ).toHaveCount(0);

  const toastDoesNotCoverDrawerClose = await page.evaluate(() => {
    const toast = document.querySelector<HTMLElement>(
      '[data-testid="toast-stack"]',
    );
    const close = document.querySelector<HTMLElement>(
      '[data-testid="notifications-drawer"] button[aria-label^="Close Notifications"]',
    );
    if (!toast || !close) return true;
    const left = toast.getBoundingClientRect();
    const right = close.getBoundingClientRect();
    return !(
      left.left < right.right &&
      left.right > right.left &&
      left.top < right.bottom &&
      left.bottom > right.top
    );
  });
  expect(toastDoesNotCoverDrawerClose).toBe(true);
  await drawer
    .getByRole("button", { name: /Close Notifications/ })
    .click();

  page.once("dialog", (dialog) => dialog.accept("Detached User A"));
  const delayedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/watchlists",
  );
  await create.click();
  await fixture.delayedWatchlistStarted;

  await signOut(page);
  await signIn(page, users.b.email);
  fixture.releaseDelayedWatchlist();
  await delayedResponse;

  await page.getByTestId("header-notifications-trigger").click();
  drawer = page.getByTestId("notifications-drawer");
  await expect(drawer).toContainText("No recent toasts");
  await expect(drawer).not.toContainText("Watchlist created");
  await drawer
    .getByRole("button", { name: /Close Notifications/ })
    .click();

  await signOut(page);
  await signIn(page, users.a.email);
  await page.getByTestId("header-notifications-trigger").click();
  drawer = page.getByTestId("notifications-drawer");
  await expect(drawer).toContainText("Notifications · 1");
  await expect(drawer).toContainText("Watchlist created");
  await expect(drawer.getByText("×2")).toHaveCount(0);

  expect(fixture.watchlistMutationCount()).toBe(2);
  expect(fixture.allowedMutations).toEqual([
    "POST /api/watchlists",
    "POST /api/watchlists",
    "POST /api/auth/logout",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/auth/login",
  ]);
  expect({
    blockedMutations: fixture.blockedMutations,
    unexpectedReads: fixture.unexpectedReads,
  }).toEqual({ blockedMutations: [], unexpectedReads: [] });
});

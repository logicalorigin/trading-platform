import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
const FIXTURE_TIME = "2026-07-19T22:00:00.000Z";

const viewports = [
  {
    name: "phone",
    width: 390,
    height: 844,
    touch: true,
    expectedLayouts: ["stacked"],
  },
  {
    name: "tablet",
    width: 768,
    height: 1024,
    touch: true,
    expectedLayouts: ["stacked"],
  },
  {
    name: "desktop",
    width: 1440,
    height: 900,
    touch: false,
    expectedLayouts: ["focus", "wide"],
  },
] as const;

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
  "/api/streams/quotes",
  "/api/streams/stocks/aggregates",
]);

const quoteFor = (symbol: string) => {
  const prices: Record<string, number> = {
    NVDA: 175.25,
    QQQ: 562.1,
    SPY: 637.4,
  };
  const price = prices[symbol] || 100;
  return {
    symbol,
    price,
    bid: price - 0.05,
    ask: price + 0.05,
    bidSize: 12,
    askSize: 14,
    change: symbol === "QQQ" ? -1.1 : 1.25,
    changePercent: symbol === "QQQ" ? -0.2 : 0.65,
    open: price - 1,
    high: price + 2,
    low: price - 2,
    prevClose: price - 1.25,
    volume: 1_250_000,
    providerContractId: null,
    source: "ibkr",
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: FIXTURE_TIME,
    ageMs: 0,
    cacheAgeMs: 0,
    updatedAt: FIXTURE_TIME,
  };
};

const overlaps = (
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) =>
  left.x < right.x + right.width - 1 &&
  left.x + left.width > right.x + 1 &&
  left.y < right.y + right.height - 1 &&
  left.y + left.height > right.y + 1;

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

async function installMarketFixture(page: Page) {
  const blockedMutations: string[] = [];

  await page.addInitScript(
    ({ onboarding }) => {
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
    },
    { onboarding: settledOnboarding },
  );

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
        json: { error: "Mutation blocked by the Market fixture." },
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
            id: "market-responsive-review",
            email: "market-responsive-review@example.com",
            role: "user",
            entitlements: [],
          },
          csrfToken: "market-responsive-review-csrf",
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
              id: "market-core",
              name: "Core",
              isDefault: true,
              items: [
                { id: "market-spy", symbol: "SPY" },
                { id: "market-qqq", symbol: "QQQ" },
                { id: "market-nvda", symbol: "NVDA" },
              ],
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
    if (path === "/api/broker-connections") {
      await route.fulfill({ json: { connections: [] } });
      return;
    }
    if (path === "/api/broker-execution/included-accounts") {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }
    if (path === "/api/flow/universe") {
      const symbols = ["SPY", "QQQ", "NVDA"];
      await route.fulfill({
        json: {
          coverage: {
            mode: "market",
            targetSize: symbols.length,
            activeTargetSize: symbols.length,
            selectedSymbols: symbols.length,
            selectedShortfall: 0,
            rankedAt: FIXTURE_TIME,
            lastRefreshAt: FIXTURE_TIME,
            lastGoodAt: FIXTURE_TIME,
            stale: false,
            fallbackUsed: false,
          },
          symbols,
          sources: {
            builtInSymbols: symbols,
            watchlistSymbols: symbols,
            flowUniverseSymbols: symbols,
            candidateBuiltInSymbols: symbols,
            candidateWatchlistSymbols: symbols,
            candidatePrioritySymbols: symbols,
            verificationSymbols: symbols,
            planner: {},
          },
        },
      });
      return;
    }
    if (path === "/api/quotes/snapshot") {
      const symbols = (url.searchParams.get("symbols") || "SPY,QQQ,NVDA")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      await route.fulfill({
        json: {
          quotes: symbols.map(quoteFor),
          transport: "tws",
          delayed: false,
          fallbackUsed: false,
        },
      });
      return;
    }
    if (path === "/api/flow/events" || path === "/api/flow/events/aggregate") {
      await route.fulfill({
        json: {
          events: [],
          source: {
            provider: "massive",
            status: "loaded",
            fallbackUsed: false,
            attemptedProviders: ["massive"],
            errorMessage: null,
            fetchedAt: FIXTURE_TIME,
          },
        },
      });
      return;
    }
    if (path === "/api/bars") {
      const symbol = (url.searchParams.get("symbol") || "SPY").toUpperCase();
      await route.fulfill({
        json: {
          symbol,
          timeframe: url.searchParams.get("timeframe") || "5m",
          bars: [],
          transport: "fixture",
          delayed: false,
          gapFilled: false,
          freshness: "live",
          marketDataMode: "live",
          dataUpdatedAt: FIXTURE_TIME,
          ageMs: null,
          emptyReason: null,
          historySource: "fixture",
          studyFallback: false,
          historyPage: null,
        },
      });
      return;
    }
    if (path === "/api/news") {
      await route.fulfill({ json: { articles: [] } });
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
    if (
      path === "/api/gex-snapshots" ||
      /^\/api\/gex\/[^/]+\/(?:projection|zero-gamma)$/u.test(path)
    ) {
      await route.fulfill({ json: {} });
      return;
    }

    await route.continue();
  });

  return { blockedMutations };
}

test.describe.configure({ mode: "serial" });

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.touch });

    test("Market keeps its decision hierarchy, scanner contract, and containment", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      const fixture = await installMarketFixture(page);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      const targetUrl = new URL(APP_URL);
      targetUrl.searchParams.delete("pyrusQa");
      targetUrl.searchParams.delete("qa");
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
      await expect(page.getByTestId("screen-load-error-market")).toHaveCount(0);
      await expect(page.getByTestId("screen-loading-market")).toBeHidden();

      const root = page.getByTestId("market-demo-screen");
      const chartSlot = page.getByTestId("market-demo-chart-slot");
      const chartGrid = page.getByTestId("market-chart-grid");
      const scanner = page.getByTestId("market-demo-scanner");
      const context = page.getByTestId("market-demo-context-rail");
      await expect(root).toBeVisible({ timeout: READY_TIMEOUT_MS });
      await expect(chartGrid).toBeVisible({ timeout: READY_TIMEOUT_MS });

      let watchlistSurface: Locator;
      if (viewport.name === "phone") {
        await page.getByTestId("mobile-bottom-nav-more").click();
        await page.getByTestId("mobile-more-watchlist").click();
        watchlistSurface = page.getByTestId("mobile-watchlist-drawer");
        await expect(watchlistSurface).toBeVisible();
      } else {
        await page
          .getByRole("button", { name: "Expand watchlist sidebar" })
          .click();
        watchlistSurface =
          viewport.name === "tablet"
            ? page.getByTestId("mobile-watchlist-drawer")
            : page.getByTestId("platform-watchlist-sidebar");
        await expect(watchlistSurface).toBeVisible();
      }
      await expect(watchlistSurface.getByTestId("watchlist-row")).toHaveCount(3);
      await expect(watchlistSurface.getByTestId("watchlist-row-quote")).toHaveCount(3);
      await expect(watchlistSurface.getByTestId("watchlist-row-context")).toHaveCount(
        viewport.name === "desktop" ? 3 : 0,
      );
      if (viewport.touch) {
        const rowHeights = await watchlistSurface
          .getByTestId("watchlist-row")
          .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
        expect(rowHeights.every((height) => height >= 44 && height <= 60)).toBe(true);
      }
      if (viewport.name === "desktop") {
        await page.getByRole("button", { name: "Collapse watchlist" }).click();
      } else {
        await page.keyboard.press("Escape");
        await expect(watchlistSurface).toBeHidden();
      }

      await expect(
        page.getByRole("region", {
          name: "Market regime and key statistics",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("status", { name: "Scanner data live" }),
      ).toContainText("LIVE");
      await expect(
        page.locator('.market-chart-cell[data-active="true"]'),
      ).toHaveCount(1);

      const qqqRow = page.getByRole("button", {
        name: "Load QQQ chart",
      });
      await qqqRow.focus();
      await qqqRow.press("Enter");
      await expect(qqqRow).toHaveAttribute("aria-pressed", "true");
      const qqqRowBox = await qqqRow.boundingBox();
      expect(qqqRowBox).not.toBeNull();
      expect(qqqRowBox!.height).toBeGreaterThanOrEqual(
        viewport.touch ? 44 : 34,
      );

      const filter = page.getByRole("textbox", {
        name: "Filter scanner by symbol",
      });
      await filter.fill("ZZZZ");
      await expect(page.getByText("No matching symbols", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Clear filter" }).click();
      await expect(qqqRow).toBeVisible();

      const layout = await root.getAttribute("data-layout");
      expect(viewport.expectedLayouts).toContain(layout);
      const [chartSlotBox, chartGridBox, scannerBox, contextBox] =
        await Promise.all([
          chartSlot.boundingBox(),
          chartGrid.boundingBox(),
          scanner.boundingBox(),
          context.boundingBox(),
        ]);
      expect(chartSlotBox).not.toBeNull();
      expect(chartGridBox).not.toBeNull();
      expect(scannerBox).not.toBeNull();
      expect(contextBox).not.toBeNull();
      expect(overlaps(chartGridBox!, scannerBox!)).toBe(false);
      expect(overlaps(chartGridBox!, contextBox!)).toBe(false);

      const chartBottom = Math.max(
        chartSlotBox!.y + chartSlotBox!.height,
        chartGridBox!.y + chartGridBox!.height,
      );
      if (layout === "stacked") {
        expect(scannerBox!.y).toBeGreaterThanOrEqual(chartBottom + 6);
        expect(contextBox!.y).toBeGreaterThanOrEqual(
          scannerBox!.y + scannerBox!.height + 6,
        );
      } else if (layout === "focus") {
        expect(scannerBox!.x + scannerBox!.width).toBeLessThanOrEqual(
          chartSlotBox!.x - 6,
        );
      } else if (layout === "wide") {
        expect(scannerBox!.x + scannerBox!.width).toBeLessThanOrEqual(
          chartSlotBox!.x - 6,
        );
        expect(chartSlotBox!.x + chartSlotBox!.width).toBeLessThanOrEqual(
          contextBox!.x - 6,
        );
      }

      const horizontalOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(horizontalOverflow).toBeLessThanOrEqual(1);
      expect(fixture.blockedMutations).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  });
}

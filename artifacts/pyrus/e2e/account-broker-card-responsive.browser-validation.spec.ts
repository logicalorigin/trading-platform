import { expect, test, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const FIXTURE_NOW = "2026-07-19T17:00:00.000Z";

const brokerAccounts = [
  {
    id: "ibkr:U1234567",
    providerAccountId: "U1234567",
    provider: "ibkr",
    mode: "live",
    displayName: "Growth",
    currency: "USD",
    buyingPower: 100_000,
    cash: 42_000,
    netLiquidation: 248_420.15,
    dayPnl: 1_284.42,
    dayPnlPercent: 0.52,
    includedInTrading: true,
    updatedAt: FIXTURE_NOW,
  },
  {
    id: "ibkr:U7654321",
    providerAccountId: "U7654321",
    provider: "ibkr",
    mode: "live",
    displayName: "Retirement",
    currency: "USD",
    buyingPower: 50_000,
    cash: 21_000,
    netLiquidation: 84_112.08,
    dayPnl: -318.09,
    dayPnlPercent: -0.38,
    includedInTrading: true,
    updatedAt: FIXTURE_NOW,
  },
];

const closedTradesByAccount = {
  "ibkr:U1234567": [
    {
      id: "growth-win-one",
      accountId: "ibkr:U1234567",
      symbol: "NVDA",
      assetClass: "Stock",
      positionType: "stock",
      quantity: 10,
      openDate: "2026-07-01T14:30:00.000Z",
      closeDate: "2026-07-02T19:00:00.000Z",
      avgOpen: 150,
      avgClose: 250,
      realizedPnl: 1_000,
      realizedPnlPercent: 66.67,
      holdDurationMinutes: 1_710,
      commissions: 2,
      currency: "USD",
      source: "IBKR",
    },
    {
      id: "growth-loss-one",
      accountId: "ibkr:U1234567",
      symbol: "TSLA",
      assetClass: "Stock",
      positionType: "stock",
      quantity: 5,
      openDate: "2026-07-03T14:30:00.000Z",
      closeDate: "2026-07-04T19:00:00.000Z",
      avgOpen: 300,
      avgClose: 220,
      realizedPnl: -400,
      realizedPnlPercent: -26.67,
      holdDurationMinutes: 1_710,
      commissions: 2,
      currency: "USD",
      source: "IBKR",
    },
    {
      id: "growth-win-two",
      accountId: "ibkr:U1234567",
      symbol: "META",
      assetClass: "Stock",
      positionType: "stock",
      quantity: 3,
      openDate: "2026-07-07T14:30:00.000Z",
      closeDate: "2026-07-08T19:00:00.000Z",
      avgOpen: 400,
      avgClose: 600,
      realizedPnl: 600,
      realizedPnlPercent: 50,
      holdDurationMinutes: 1_710,
      commissions: 2,
      currency: "USD",
      source: "IBKR",
    },
    {
      id: "growth-loss-two",
      accountId: "ibkr:U1234567",
      symbol: "AMD",
      assetClass: "Stock",
      positionType: "stock",
      quantity: 4,
      openDate: "2026-07-09T14:30:00.000Z",
      closeDate: "2026-07-10T19:00:00.000Z",
      avgOpen: 180,
      avgClose: 130,
      realizedPnl: -200,
      realizedPnlPercent: -27.78,
      holdDurationMinutes: 1_710,
      commissions: 2,
      currency: "USD",
      source: "IBKR",
    },
  ],
  "ibkr:U7654321": [
    {
      id: "retirement-win",
      accountId: "ibkr:U7654321",
      symbol: "SPY",
      assetClass: "ETF",
      positionType: "etf",
      quantity: 2,
      openDate: "2026-07-05T14:30:00.000Z",
      closeDate: "2026-07-06T19:00:00.000Z",
      avgOpen: 500,
      avgClose: 650,
      realizedPnl: 300,
      realizedPnlPercent: 30,
      holdDurationMinutes: 1_710,
      commissions: 1,
      currency: "USD",
      source: "IBKR",
    },
    {
      id: "retirement-loss",
      accountId: "ibkr:U7654321",
      symbol: "QQQ",
      assetClass: "ETF",
      positionType: "etf",
      quantity: 1,
      openDate: "2026-07-11T14:30:00.000Z",
      closeDate: "2026-07-12T19:00:00.000Z",
      avgOpen: 500,
      avgClose: 400,
      realizedPnl: -100,
      realizedPnlPercent: -20,
      holdDurationMinutes: 1_710,
      commissions: 1,
      currency: "USD",
      source: "IBKR",
    },
  ],
} as const;

async function fulfillQuietEventStream(route: Route) {
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: "retry: 60000\n\n",
  });
}

async function installAccountFixture(page: Page) {
  const blockedMutations: string[] = [];
  const unexpectedGets: string[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (method === "GET" && path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "broker-card-responsive-review",
            email: "broker-card-responsive@example.com",
            role: "user",
            entitlements: [],
          },
          csrfToken: "broker-card-responsive-csrf",
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/session") {
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
          timestamp: FIXTURE_NOW,
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/settings/preferences") {
      await route.fulfill({
        json: {
          profileKey: "default",
          version: 1,
          preferences: { onboarding: { autoOpenShownVersion: 1 } },
          source: "database",
          updatedAt: FIXTURE_NOW,
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/watchlists") {
      await route.fulfill({ json: { watchlists: [] } });
      return;
    }
    if (method === "GET" && path === "/api/accounts") {
      await route.fulfill({ json: { accounts: brokerAccounts } });
      return;
    }
    const decodedPath = decodeURIComponent(path);
    const accountMatch =
      /^\/api\/accounts\/([^/]+)\/(closed-trades|positions|orders)$/u.exec(
        decodedPath,
      );
    if (method === "GET" && accountMatch) {
      const [, accountId, resource] = accountMatch;
      if (accountId in closedTradesByAccount) {
        if (resource === "closed-trades") {
          await route.fulfill({
            json: {
              accountId,
              currency: "USD",
              trades:
                closedTradesByAccount[
                  accountId as keyof typeof closedTradesByAccount
                ],
              summary: {},
              updatedAt: FIXTURE_NOW,
            },
          });
          return;
        }
        if (resource === "positions") {
          await route.fulfill({
            json: {
              accountId,
              currency: "USD",
              positions:
                accountId === "ibkr:U1234567"
                  ? [
                      { id: "growth-long", quantity: 10, marketValue: 24_000 },
                      { id: "growth-short", quantity: -4, marketValue: -6_000 },
                    ]
                  : [
                      {
                        id: "retirement-long",
                        quantity: 20,
                        marketValue: 18_000,
                      },
                    ],
              totals: {},
              updatedAt: FIXTURE_NOW,
            },
          });
          return;
        }
        await route.fulfill({
          json: {
            accountId,
            tab: "working",
            currency: "USD",
            orders:
              accountId === "ibkr:U1234567"
                ? [{ id: "growth-working-one" }, { id: "growth-working-two" }]
                : [{ id: "retirement-working" }],
            updatedAt: FIXTURE_NOW,
          },
        });
        return;
      }
    }
    if (method === "GET" && path === "/api/accounts/shadow/summary") {
      await route.fulfill({
        json: {
          accountId: "shadow",
          isCombined: false,
          mode: "shadow",
          currency: "USD",
          accounts: [],
          updatedAt: FIXTURE_NOW,
          fx: {
            baseCurrency: "USD",
            timestamp: FIXTURE_NOW,
            rates: {},
            warning: null,
          },
          badges: {},
          metrics: {
            netLiquidation: {
              value: 50_000,
              currency: "USD",
              source: "SHADOW_LEDGER",
              field: "netLiquidation",
              updatedAt: FIXTURE_NOW,
            },
            dayPnl: {
              value: -540.25,
              currency: "USD",
              source: "SHADOW_LEDGER",
              field: "dayPnl",
              updatedAt: FIXTURE_NOW,
            },
            dayPnlPercent: {
              value: -1.07,
              currency: null,
              source: "SHADOW_LEDGER",
              field: "dayPnlPercent",
              updatedAt: FIXTURE_NOW,
            },
          },
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/algo/deployments") {
      await route.fulfill({ json: { deployments: [] } });
      return;
    }
    if (method === "GET" && path === "/api/algo/events") {
      await route.fulfill({ json: { events: [] } });
      return;
    }
    if (method === "GET" && path === "/api/quotes/snapshot") {
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
    if (method === "GET" && path === "/api/signal-monitor/events") {
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
    if (
      method === "GET" &&
      (path === "/api/streams/quotes" ||
        path === "/api/signal-monitor/matrix/stream")
    ) {
      await fulfillQuietEventStream(route);
      return;
    }
    if (method === "GET" && path === "/api/news") {
      await route.fulfill({ json: { articles: [] } });
      return;
    }
    if (method === "GET" && path === "/api/accounts/all/tax/overview") {
      await route.fulfill({
        json: {
          accountScope: "connected_accounts",
          estimates: {
            currency: "USD",
            totalReserveTarget: 0,
            federal: { status: "available" },
            state: { status: "available" },
          },
          scope: {
            includedAccounts: brokerAccounts.length,
            connectedAccounts: brokerAccounts.length,
          },
          unknowns: [],
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/tax/reserve") {
      await route.fulfill({
        json: {
          targetAmount: 0,
          reservedAmount: 0,
          currency: "USD",
          warnings: [],
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/accounts/all/tax/events") {
      await route.fulfill({ json: { events: [] } });
      return;
    }
    if (method === "GET" && path === "/api/accounts/flex/health") {
      await route.fulfill({
        json: {
          bridgeConnected: null,
          flexConfigured: false,
          flexTokenPresent: false,
          flexQueryIdPresent: false,
          schemaReady: true,
          missingTables: [],
          schemaError: null,
          lastSuccessfulRefreshAt: null,
          lastAttemptAt: null,
          lastStatus: null,
          lastError: null,
          snapshotsRecording: false,
          lastSnapshotAt: null,
          snapshotCoverageStartAt: null,
          snapshotCoverageEndAt: null,
          snapshotPointCount: 0,
          flexNavCoverageStartDate: null,
          flexNavCoverageEndDate: null,
          flexNavRowCount: 0,
          flexTradeCoverageStartAt: null,
          flexTradeCoverageEndAt: null,
          flexTradeRowCount: 0,
          flexCashCoverageStartAt: null,
          flexCashCoverageEndAt: null,
          flexCashRowCount: 0,
          flexDividendCoverageStartAt: null,
          flexDividendCoverageEndAt: null,
          flexDividendRowCount: 0,
          flexOpenPositionCoverageStartAt: null,
          flexOpenPositionCoverageEndAt: null,
          flexOpenPositionRowCount: 0,
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/signal-monitor/profile") {
      await route.fulfill({
        json: {
          id: "broker-card-responsive-profile",
          environment: "shadow",
          enabled: false,
          watchlistId: null,
          timeframe: "15m",
          pyrusSignalsSettings: {},
          freshWindowBars: 3,
          pollIntervalSeconds: 60,
          maxSymbols: 100,
          evaluationConcurrency: 1,
          lastEvaluatedAt: null,
          lastError: null,
          createdAt: FIXTURE_NOW,
          updatedAt: FIXTURE_NOW,
        },
      });
      return;
    }
    if (method === "POST" && path === "/api/sparklines/seed") {
      const payload = request.postDataJSON() as {
        symbols?: unknown[];
        timeframe?: string;
      };
      await route.fulfill({
        json: {
          timeframe: payload.timeframe,
          source: "fixture",
          historySource: "fixture",
          requestedSymbolCount: payload.symbols?.length || 0,
          hydratedSymbolCount: 0,
          items: [],
        },
      });
      return;
    }
    if (method === "POST" && path === "/api/diagnostics/client-metrics") {
      await route.fulfill({ status: 202, json: {} });
      return;
    }
    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "GET") {
      unexpectedGets.push(path);
      await route.fulfill({
        status: 501,
        json: { error: `Unexpected fixture GET: ${path}` },
      });
      return;
    }

    blockedMutations.push(`${method} ${path}`);
    await route.fulfill({
      status: 405,
      json: { error: "Mutation blocked by broker-card fixture." },
    });
  });

  return { blockedMutations, unexpectedGets };
}

for (const viewport of [
  { name: "phone-390", width: 390, height: 844, isPhone: true },
  { name: "tablet-start-768", width: 768, height: 1024, isPhone: false },
  { name: "tablet-boundary-847", width: 847, height: 1024, isPhone: false },
  { name: "tablet-boundary-848", width: 848, height: 1024, isPhone: false },
  { name: "desktop-start-1024", width: 1024, height: 900, isPhone: false },
  { name: "desktop-wide-1440", width: 1440, height: 900, isPhone: false },
] as const) {
  test(`broker account cards stay compact and disclose independently on ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const browserProblems: string[] = [];
    page.on("pageerror", (error) => {
      browserProblems.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        browserProblems.push(`${message.type()}: ${message.text()}`);
      }
    });
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const fixture = await installAccountFixture(page);

    await page.goto(`${APP_URL}?screen=account`, {
      waitUntil: "domcontentloaded",
    });
    expect(new URL(page.url()).searchParams.has("pyrusQa")).toBe(false);
    await expect(page.getByTestId("screen-host-account")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
      timeout: 60_000,
    });

    const tablist = page.getByTestId("account-tabs");
    await expect(tablist).toBeVisible({ timeout: 60_000 });
    const tabs = tablist.getByRole("tab");
    const cards = tablist.locator('[data-testid^="account-card-"]');
    await expect(tabs).toHaveCount(4);
    await expect(cards).toHaveCount(4);

    const [tablistBox, cardBoxes] = await Promise.all([
      tablist.boundingBox(),
      cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width };
        }),
      ),
    ]);
    expect(tablistBox).not.toBeNull();

    if (viewport.isPhone) {
      expect(
        cardBoxes.every((box) => Math.abs(box.width - tablistBox!.width) <= 1),
      ).toBe(true);
      expect(new Set(cardBoxes.map((box) => Math.round(box.x))).size).toBe(1);
      expect(new Set(cardBoxes.map((box) => Math.round(box.y))).size).toBe(
        cardBoxes.length,
      );
    } else {
      for (const box of cardBoxes) {
        expect(box.width).toBeGreaterThanOrEqual(195.5);
        expect(box.width).toBeLessThanOrEqual(220.5);
        expect(tablistBox!.width - box.width).toBeGreaterThanOrEqual(24);
      }
    }

    const growthExpand = page.getByTestId("account-tab-ibkr:U1234567-expand");
    const retirementExpand = page.getByTestId(
      "account-tab-ibkr:U7654321-expand",
    );
    await expect(growthExpand).toHaveAttribute("aria-expanded", "false");
    await expect(retirementExpand).toHaveAttribute("aria-expanded", "false");
    await expect(growthExpand).toHaveAccessibleName(
      "Show Growth trading details",
    );
    await expect(growthExpand).toHaveAttribute(
      "aria-controls",
      "account-tab-ibkr:U1234567-details",
    );
    await expect(page.getByTestId("account-tab-all-expand")).toHaveCount(0);
    await expect(page.getByTestId("account-tab-shadow-expand")).toHaveCount(0);

    for (const button of [growthExpand, retirementExpand]) {
      const box = await button.boundingBox();
      const minimumTargetHeight = viewport.width < 1024 ? 44 : 24;
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(minimumTargetHeight);
    }

    await growthExpand.focus();
    await expect(growthExpand).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(growthExpand).toHaveAttribute("aria-expanded", "true");
    await expect(growthExpand).toHaveAccessibleName(
      "Hide Growth trading details",
    );
    await retirementExpand.click();

    const growthPanel = page.getByTestId(
      "account-tab-ibkr:U1234567-disclosure",
    );
    const retirementPanel = page.getByTestId(
      "account-tab-ibkr:U7654321-disclosure",
    );
    await expect(growthPanel).toBeVisible();
    await expect(retirementPanel).toBeVisible();
    await expect(growthPanel).toContainText("Period P&L");
    await expect(growthPanel).toContainText("$1,000");
    await expect(growthPanel).toContainText("Win rate");
    await expect(growthPanel).toContainText("50");
    await expect(growthPanel).toContainText("Today P&L");
    await expect(growthPanel).toContainText("$1,284");
    await expect(growthPanel).toContainText("Open positions");
    await expect(growthPanel).toContainText("Working orders");
    await expect(growthPanel).toContainText("Gross exposure");
    await expect(growthPanel).toContainText("$30,000");

    const growthThirtyDays = growthPanel.getByRole("button", {
      name: "30 days",
    });
    const retirementThirtyDays = retirementPanel.getByRole("button", {
      name: "30 days",
    });
    const periodButtonHeights = await growthPanel
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );
    expect(
      periodButtonHeights.every(
        (height) => height >= (viewport.width < 1024 ? 44 : 24),
      ),
    ).toBe(true);
    await expect(growthThirtyDays).toHaveAttribute("aria-pressed", "true");
    await expect(retirementThirtyDays).toHaveAttribute("aria-pressed", "true");
    await growthPanel.getByRole("button", { name: "7 days" }).click();
    await expect(
      growthPanel.getByRole("button", { name: "7 days" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(retirementThirtyDays).toHaveAttribute("aria-pressed", "true");

    const expandedCards = await Promise.all([
      page.getByTestId("account-card-ibkr:U1234567").boundingBox(),
      page.getByTestId("account-card-ibkr:U7654321").boundingBox(),
    ]);
    if (viewport.isPhone) {
      expect(
        expandedCards.every(
          (box) => box && Math.abs(box.width - tablistBox!.width) <= 1,
        ),
      ).toBe(true);
    } else {
      expect(expandedCards.every((box) => box && box.width > 390)).toBe(true);
    }

    if (
      viewport.name === "phone-390" ||
      viewport.name === "desktop-wide-1440"
    ) {
      await testInfo.attach(`expanded-account-cards-${viewport.name}`, {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
    }

    await growthExpand.click();
    await expect(growthPanel).toBeHidden();
    await expect(retirementPanel).toBeVisible();

    const documentWidth = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(documentWidth.scrollWidth).toBeLessThanOrEqual(
      documentWidth.clientWidth + 1,
    );
    expect(fixture.blockedMutations).toEqual([]);
    expect(fixture.unexpectedGets).toEqual([]);
    expect(browserProblems).toEqual([]);
  });
}

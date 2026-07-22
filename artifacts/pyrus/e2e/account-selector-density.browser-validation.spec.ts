import { expect, test, type Page } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";

async function mockAccountSelectorData(page: Page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "account-selector-review",
          email: "account-selector@example.com",
          role: "admin",
          entitlements: [],
        },
        csrfToken: "account-selector-csrf",
      },
    }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({
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
        timestamp: "2026-07-15T17:00:00.000Z",
      },
    }),
  );
  await page.route(/\/api\/accounts(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        accounts: [
          {
            id: "ibkr:U1234567",
            provider: "ibkr",
            displayName: "Growth",
            providerAccountId: "U1234567",
            netLiquidation: 248_420.15,
            dayPnl: 1_284.42,
            dayPnlPercent: 0.52,
            currency: "USD",
          },
          {
            id: "snaptrade:webull-9876",
            provider: "snaptrade",
            displayName: "Webull Roth IRA",
            providerAccountId: "webull-9876",
            netLiquidation: 84_112.08,
            dayPnl: -318.09,
            dayPnlPercent: -0.38,
            currency: "USD",
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/accounts\/shadow\/summary(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        accountId: "shadow",
        currency: "USD",
        metrics: {
          netLiquidation: { value: 50_000, currency: "USD" },
          dayPnl: { value: -540.25, currency: "USD" },
          dayPnlPercent: { value: -1.07 },
        },
        updatedAt: "2026-07-15T17:00:00.000Z",
      },
    }),
  );
}

for (const viewport of [
  { name: "phone", width: 390, height: 844, maxCardHeight: 78 },
  { name: "desktop", width: 1440, height: 900, maxCardHeight: 80 },
] as const) {
  test(`account selector stays dense with Shadow metric parity on ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await mockAccountSelectorData(page);
    await page.goto(`${APP_URL}?screen=account`, {
      waitUntil: "domcontentloaded",
    });

    const tablist = page.getByTestId("account-tabs");
    await expect(tablist).toBeVisible({ timeout: 60_000 });
    await tablist.screenshot({
      path: `/tmp/pyrus-account-selector-${viewport.name}.png`,
    });
    const cards = tablist.getByRole("tab");
    await expect(cards).toHaveCount(4);
    const shadow = page.getByTestId("account-tab-shadow");
    await expect(shadow.getByTestId("account-tab-shadow-metrics")).toBeVisible({
      timeout: 15_000,
    });
    await expect(shadow).toContainText("NLV");
    await expect(shadow).toContainText("Day");
    await expect(shadow).toContainText("50");
    await expect(shadow).toContainText("540");

    const boxes = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    expect(boxes.every((box) => box.height <= viewport.maxCardHeight)).toBe(
      true,
    );
    if (viewport.name === "phone") {
      expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(2);
      expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(2);
    } else {
      expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1);
      expect(boxes.every((box) => box.width <= 236)).toBe(true);
    }
  });
}

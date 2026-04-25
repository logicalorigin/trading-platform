import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const expirations = ["2026-05-01", "2026-05-08", "2026-05-15"];
const basePrice = 500;

function makeBars(symbol = "SPY") {
  const now = Date.now();
  return Array.from({ length: 80 }, (_, index) => {
    const close = basePrice + Math.sin(index / 5) * 2 + index * 0.05;
    const open = close - Math.cos(index / 3) * 0.8;
    return {
      timestamp: new Date(now - (79 - index) * 5 * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100_000 + index * 1_000,
      source: symbol.endsWith("C") || symbol.endsWith("P") ? "mock-option" : "mock",
    };
  });
}

function makeOptionContracts(expirationDate: string) {
  const expirationIndex = expirations.indexOf(expirationDate);
  const offset = expirationIndex >= 0 ? expirationIndex * 5 : 0;
  const strikes = [490 + offset, 495 + offset, 500 + offset, 505 + offset, 510 + offset];

  return strikes.flatMap((strike) =>
    (["call", "put"] as const).map((right) => {
      const cp = right === "call" ? "C" : "P";
      const distance = Math.abs(strike - basePrice);
      const mark = Math.max(0.35, 8 - distance * 0.4 + expirationIndex);
      return {
        contract: {
          ticker: `SPY-${expirationDate}-${strike}-${cp}`,
          underlying: "SPY",
          expirationDate,
          strike,
          right,
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: `${expirationDate}-${strike}-${cp}`,
        },
        bid: mark - 0.05,
        ask: mark + 0.05,
        last: mark,
        mark,
        impliedVolatility: 0.22 + expirationIndex * 0.01,
        delta: right === "call" ? 0.48 : -0.48,
        gamma: 0.02,
        theta: -0.03,
        vega: 0.11,
        openInterest: 1_000 + strike,
        volume: 100 + strike,
        updatedAt: new Date().toISOString(),
      };
    }),
  );
}

async function mockTradeApi(page: Page, { delayChainMs = 0 } = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};

    if (url.pathname === "/api/session") {
      body = {
        configured: { ibkr: false, research: false },
        ibkrBridge: {
          authenticated: false,
          connected: false,
          liveMarketDataAvailable: false,
          transport: "client-portal",
        },
        environment: "paper",
        marketDataProviders: {},
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [{ id: "default", name: "Default", isDefault: true, symbols: ["SPY"] }],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const requested = (url.searchParams.get("symbols") || "SPY")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol) => ({
          symbol,
          price: basePrice,
          prevClose: basePrice - 2,
          change: 2,
          changePercent: 0.4,
          open: basePrice - 1,
          high: basePrice + 3,
          low: basePrice - 4,
          volume: 50_000_000,
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/options/expirations") {
      body = {
        underlying: "SPY",
        expirations: expirations.map((expirationDate) => ({ expirationDate })),
      };
    } else if (url.pathname === "/api/options/chains") {
      if (delayChainMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayChainMs));
      }
      const expirationDate = url.searchParams.get("expirationDate") || expirations[0];
      body = {
        underlying: "SPY",
        expirationDate,
        contracts: makeOptionContracts(expirationDate),
      };
    } else if (url.pathname === "/api/bars") {
      body = { bars: makeBars(url.searchParams.get("symbol") || "SPY") };
    } else if (url.pathname === "/api/flow/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = { profile: { enabled: false, timeframe: "15m", watchlistId: null } };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = { states: [] };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    } else if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function openTrade(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        tradeActiveTicker: "SPY",
        tradeContracts: {
          SPY: { strike: 500, cp: "C", exp: "" },
        },
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
}

async function openPlatformScreen(page: Page, screen: "trade" | "flow" | "research") {
  await page.addInitScript((initialScreen) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: initialScreen,
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        tradeActiveTicker: "SPY",
        tradeContracts: {
          SPY: { strike: 500, cp: "C", exp: "" },
        },
      }),
    );
  }, screen);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`screen-host-${screen}`)).toBeVisible({
    timeout: 30_000,
  });
}

async function expectActiveScreenFillsHost(page: Page, screen: "trade" | "flow" | "research") {
  const metrics = await page.getByTestId(`screen-host-${screen}`).evaluate((host) => {
    const hostBox = host.getBoundingClientRect();
    const childBox = host.firstElementChild?.getBoundingClientRect();

    return {
      hostWidth: hostBox.width,
      childWidth: childBox?.width ?? 0,
      rightGap: childBox ? hostBox.right - childBox.right : Number.POSITIVE_INFINITY,
    };
  });

  expect(metrics.hostWidth).toBeGreaterThan(1000);
  expect(metrics.childWidth).toBeGreaterThan(metrics.hostWidth - 1);
  expect(metrics.rightGap).toBeLessThanOrEqual(1);
}

test("Trade swaps contract chart above options chain and removes placeholder copy", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page);
  await openTrade(page);

  const topBox = await page.getByTestId("trade-top-zone").boundingBox();
  const middleBox = await page.getByTestId("trade-middle-zone").boundingBox();
  const contractBox = await page.getByTestId("trade-contract-chart-panel").boundingBox();
  const chainBox = await page.getByTestId("trade-options-chain-panel").boundingBox();

  expect(topBox).not.toBeNull();
  expect(middleBox).not.toBeNull();
  expect(contractBox).not.toBeNull();
  expect(chainBox).not.toBeNull();
  expect(contractBox!.y).toBeGreaterThanOrEqual(topBox!.y - 1);
  expect(contractBox!.y + contractBox!.height).toBeLessThanOrEqual(topBox!.y + topBox!.height + 1);
  expect(chainBox!.y).toBeGreaterThanOrEqual(middleBox!.y - 1);
  expect(chainBox!.y + chainBox!.height).toBeLessThanOrEqual(middleBox!.y + middleBox!.height + 1);

  await expect(page.getByTestId("trade-options-chain-panel").getByText("OPTIONS CHAIN")).toBeVisible();
  await expect(
    page.getByTestId("trade-contract-chart-panel").getByText("CONTRACT", { exact: true }),
  ).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/spaceholder|schema-pending|placeholder panel|under construction|Coming Soon/i);
});

test("Trade, Flow, and Research pages fill the available viewport width", async ({ browser }) => {
  for (const screen of ["trade", "flow", "research"] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await mockTradeApi(page);
      await openPlatformScreen(page, screen);
      await expectActiveScreenFillsHost(page, screen);
    } finally {
      await page.close();
    }
  }
});

test("Trade option chain loading state shows a spinner while chain request is pending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { delayChainMs: 1500 });
  await openTrade(page);

  await expect(
    page.getByTestId("trade-options-chain-panel").getByTestId("loading-spinner"),
  ).toBeVisible({ timeout: 10_000 });
});

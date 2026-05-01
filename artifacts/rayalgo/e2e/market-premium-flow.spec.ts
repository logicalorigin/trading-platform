import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const symbols = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "IWM"];

const quoteData: Record<
  string,
  { price: number; change: number; changePercent: number; volume: number }
> = {
  SPY: { price: 510.25, change: 2.1, changePercent: 0.41, volume: 62_000_000 },
  QQQ: { price: 438.8, change: -1.45, changePercent: -0.33, volume: 41_000_000 },
  NVDA: { price: 905.5, change: 18.2, changePercent: 2.05, volume: 72_000_000 },
  TSLA: { price: 210.2, change: -4.9, changePercent: -2.28, volume: 95_000_000 },
  AAPL: { price: 188.1, change: 0.48, changePercent: 0.26, volume: 51_000_000 },
  IWM: { price: 202.42, change: 0.12, changePercent: 0.06, volume: 28_000_000 },
};

function makeBars(symbol: string) {
  const now = Date.now();
  const base = quoteData[symbol]?.price ?? 100;
  return Array.from({ length: 72 }, (_, index) => {
    const close = base + Math.sin(index / 5) * 1.8;
    const open = close - Math.cos(index / 4) * 0.7;
    return {
      timestamp: new Date(now - (71 - index) * 15 * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 120_000 + index * 2_500,
      source: "mock",
    };
  });
}

function flowEvent(symbol: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${symbol}-${overrides.right || "call"}-${overrides.strike || 510}`,
    provider: "ibkr",
    basis: "snapshot",
    underlying: symbol,
    optionTicker: `${symbol}-OPT`,
    right: "call",
    strike: quoteData[symbol]?.price ?? 100,
    expirationDate: "2026-05-15",
    occurredAt: new Date().toISOString(),
    side: "buy",
    sentiment: "bullish",
    premium: 250_000,
    size: 35,
    openInterest: 20,
    impliedVolatility: 0.32,
    isUnusual: false,
    unusualScore: 0,
    tradeConditions: [],
    ...overrides,
  };
}

async function mockMarketApi(page: Page, flowUrls: string[]) {
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
          transport: "ib-gateway",
        },
        environment: "paper",
        marketDataProviders: {},
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [
          {
            id: "default",
            name: "Default",
            isDefault: true,
            symbols,
          },
        ],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const requested = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol) => {
          const quote = quoteData[symbol] ?? {
            price: 100,
            change: 0,
            changePercent: 0,
            volume: 100_000,
          };
          return {
            symbol,
            price: quote.price,
            prevClose: quote.price - quote.change,
            change: quote.change,
            changePercent: quote.changePercent,
            volume: quote.volume,
            updatedAt: new Date().toISOString(),
            delayed: false,
          };
        }),
      };
    } else if (url.pathname === "/api/bars") {
      body = {
        bars: makeBars((url.searchParams.get("symbol") || "SPY").toUpperCase()),
      };
    } else if (url.pathname === "/api/flow/events") {
      flowUrls.push(url.toString());
      const symbol = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      await new Promise((resolve) => setTimeout(resolve, 450));
      const eventsBySymbol: Record<string, unknown[]> = {
        SPY: [
          flowEvent("SPY", { premium: 350_000, strike: 510, right: "call" }),
          flowEvent("SPY", {
            premium: 90_000,
            strike: 505,
            right: "put",
            side: "sell",
            sentiment: "bearish",
          }),
        ],
        QQQ: [
          flowEvent("QQQ", {
            premium: 310_000,
            strike: 438,
            right: "put",
            side: "buy",
            sentiment: "bearish",
            isUnusual: true,
            unusualScore: 2.8,
          }),
        ],
        NVDA: [
          flowEvent("NVDA", {
            premium: 640_000,
            strike: 910,
            right: "call",
            isUnusual: true,
            unusualScore: 3.4,
          }),
        ],
      };
      body = {
        events: eventsBySymbol[symbol] || [],
        source: {
          provider: "ibkr",
          status: "live",
          fallbackUsed: false,
        },
      };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = { enabled: true, timeframe: "15m", watchlistId: "default" };
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

async function openMarketGrid(page: Page) {
  await page.addInitScript((gridSymbols) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        marketGridLayout: "2x3",
        marketGridSlots: gridSymbols.map((ticker) => ({
          ticker,
          tf: "15m",
          studies: ["ema21", "vwap", "rayReplica"],
        })),
      }),
    );
  }, symbols);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-chart-grid")).toBeVisible({
    timeout: 30_000,
  });
}

test("Market chart grid premium-flow strips render below charts and overlays stay on top", async ({
  page,
}) => {
  const flowUrls: string[] = [];
  await mockMarketApi(page, flowUrls);
  await openMarketGrid(page);

  const strips = page.getByTestId("market-premium-flow-strip");
  await expect(strips).toHaveCount(6);
  await expect(
    page.getByRole("status", { name: /SPY options premium flow Scanning/i }),
  ).toBeVisible();
  await expect(page.locator("[data-premium-flow-glyph]")).toHaveCount(6);

  await expect(
    page.getByRole("status", { name: /SPY options premium flow IBKR SNAPSHOT/i }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("status", { name: /IWM options premium flow No options flow/i }),
  ).toBeVisible();
  await expect(page.locator("[data-premium-flow-glyph]")).toHaveCount(0);

  expect(flowUrls.length).toBeGreaterThanOrEqual(6);
  expect(
    flowUrls.some((href) => new URL(href).searchParams.has("unusualThreshold")),
  ).toBe(false);

  const layout = await strips.evaluateAll((nodes) =>
    nodes.map((node) => {
      const strip = node.getBoundingClientRect();
      const cell = node.parentElement?.getBoundingClientRect();
      const chart = node.previousElementSibling?.getBoundingClientRect();
      return {
        hasControlRoot: node.hasAttribute("data-chart-control-root"),
        stripHeight: strip.height,
        stripWidth: strip.width,
        gapFromChart: chart ? strip.top - chart.bottom : null,
        bottomGap: cell ? cell.bottom - strip.bottom : null,
      };
    }),
  );

  for (const item of layout) {
    expect(item.hasControlRoot).toBe(true);
    expect(item.stripHeight).toBeGreaterThanOrEqual(28);
    expect(item.stripHeight).toBeLessThanOrEqual(36);
    expect(item.stripWidth).toBeGreaterThan(130);
    expect(item.gapFromChart ?? -1).toBeGreaterThanOrEqual(-1);
    expect(item.bottomGap ?? -1).toBeGreaterThanOrEqual(-1);
  }

  await page.getByTitle("Settings").first().click();
  const displayMenu = page.getByRole("menu").filter({ hasText: "Display" }).first();
  await expect(displayMenu).toBeVisible();
  await expect
    .poll(() =>
      displayMenu.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const topElement = document.elementFromPoint(
          rect.left + Math.min(20, rect.width / 2),
          rect.top + Math.min(20, rect.height / 2),
        );
        return topElement != null && node.contains(topElement);
      }),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await page.getByTitle("Tune RayReplica overlay settings").first().click();
  const rayReplicaTitle = page.getByText("RayReplica Settings").first();
  await expect(rayReplicaTitle).toBeVisible();
  await expect
    .poll(() =>
      rayReplicaTitle.evaluate((node) => {
        const panel =
          node.closest("[data-radix-popper-content-wrapper]") ||
          node.closest("[data-radix-popover-content]") ||
          node.parentElement;
        if (!panel) return false;
        const rect = panel.getBoundingClientRect();
        const topElement = document.elementFromPoint(
          rect.left + Math.min(20, rect.width / 2),
          rect.top + Math.min(20, rect.height / 2),
        );
        return topElement != null && panel.contains(topElement);
      }),
    )
    .toBe(true);
});

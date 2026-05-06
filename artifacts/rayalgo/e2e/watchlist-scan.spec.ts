import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const quoteData: Record<string, { price: number; change: number; changePercent: number; volume: number }> = {
  SPY: { price: 510.25, change: 2.1, changePercent: 0.41, volume: 62_000_000 },
  QQQ: { price: 438.8, change: -1.45, changePercent: -0.33, volume: 41_000_000 },
  NVDA: { price: 905.5, change: 18.2, changePercent: 2.05, volume: 72_000_000 },
};

function makeBars(symbol: string) {
  const now = Date.now();
  const base = quoteData[symbol]?.price ?? 100;
  return Array.from({ length: 48 }, (_, index) => {
    const close = base + Math.sin(index / 5) * 1.6;
    const open = close - Math.cos(index / 4) * 0.7;
    return {
      timestamp: new Date(now - (47 - index) * 15 * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100_000 + index * 2_000,
      source: "mock",
    };
  });
}

const signalStates = [
  {
    symbol: "SPY",
    timeframe: "15m",
    currentSignalDirection: "buy",
    currentSignalAt: new Date().toISOString(),
    currentSignalPrice: quoteData.SPY.price,
    latestBarAt: new Date().toISOString(),
    barsSinceSignal: 1,
    fresh: true,
    status: "ok",
    lastEvaluatedAt: new Date().toISOString(),
  },
  {
    symbol: "NVDA",
    timeframe: "15m",
    currentSignalDirection: "sell",
    currentSignalAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    currentSignalPrice: quoteData.NVDA.price,
    latestBarAt: new Date().toISOString(),
    barsSinceSignal: 5,
    fresh: false,
    status: "ok",
    lastEvaluatedAt: new Date().toISOString(),
  },
];

async function mockPlatformApi(
  page: Page,
  {
    watchlist,
    onReorder,
  }: {
    watchlist: unknown;
    onReorder?: (payload: unknown) => void;
  },
) {
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
    } else if (url.pathname === "/api/watchlists" && route.request().method() === "GET") {
      body = { watchlists: [watchlist] };
    } else if (
      url.pathname === "/api/watchlists/default/items/reorder" &&
      route.request().method() === "PUT"
    ) {
      const payload = route.request().postDataJSON();
      onReorder?.(payload);
      body = watchlist;
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
      body = { bars: makeBars((url.searchParams.get("symbol") || "SPY").toUpperCase()) };
    } else if (url.pathname === "/api/flow/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = { enabled: true, timeframe: "15m", watchlistId: "default" };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = { states: signalStates };
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

async function openMarketWithWatchlist(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: false,
        marketGridLayout: "1x1",
        marketGridSlots: [
          {
            ticker: "SPY",
            tf: "15m",
            studies: ["ema21", "vwap", "rayReplica"],
          },
        ],
      }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
}

test("watchlist displays legacy symbols plus signal-monitor rows and signal sort", async ({
  page,
}) => {
  await mockPlatformApi(page, {
    watchlist: {
      id: "default",
      name: "Default",
      isDefault: true,
      symbols: ["SPY", "QQQ"],
    },
  });
  await openMarketWithWatchlist(page);

  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="SPY"]')).toBeVisible();
  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="QQQ"]')).toBeVisible();
  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="NVDA"]')).toBeVisible();
  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="NVDA"]')).toHaveAttribute(
    "data-source",
    "monitor",
  );

  await expect(page.locator('[data-testid="watchlist-signal-pill"][data-fresh="true"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="watchlist-signal-pill"][data-fresh="false"]')).toHaveCount(1);

  await page.getByTestId("watchlist-sort-signal").click();
  await expect
    .poll(async () =>
      page
        .locator('[data-testid="watchlist-row"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-symbol"))),
    )
    .toEqual(["SPY", "NVDA", "QQQ"]);

  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="SPY"]')).toHaveAttribute(
    "draggable",
    "false",
  );
});

test("watchlist drag and drop reorders canonical rows in manual mode", async ({ page }) => {
  let reorderPayload: unknown = null;
  await mockPlatformApi(page, {
    watchlist: {
      id: "default",
      name: "Default",
      isDefault: true,
      items: [
        { id: "spy-item", symbol: "SPY", name: "S&P 500", sortOrder: 0 },
        { id: "qqq-item", symbol: "QQQ", name: "Nasdaq 100", sortOrder: 1 },
        { id: "nvda-item", symbol: "NVDA", name: "NVIDIA", sortOrder: 2 },
      ],
    },
    onReorder: (payload) => {
      reorderPayload = payload;
    },
  });
  await openMarketWithWatchlist(page);

  const spyRow = page.locator('[data-testid="watchlist-row"][data-symbol="SPY"]');
  const qqqRow = page.locator('[data-testid="watchlist-row"][data-symbol="QQQ"]');
  await expect(qqqRow).toHaveAttribute("draggable", "true");

  await qqqRow.dragTo(spyRow);

  await expect
    .poll(() => reorderPayload)
    .toEqual({ itemIds: ["qqq-item", "spy-item", "nvda-item"] });
});

test("watchlist row renders persisted identity metadata without clipping", async ({ page }) => {
  await mockPlatformApi(page, {
    watchlist: {
      id: "default",
      name: "Default",
      isDefault: true,
      items: [
        {
          id: "qqq-item",
          symbol: "QQQ",
          name: "Nasdaq 100",
          market: "etf",
          normalizedExchangeMic: "XNAS",
          exchangeDisplay: "NASDAQ",
          countryCode: "US",
          exchangeCountryCode: "US",
          sector: "ETF",
          industry: "Growth Equity",
          sortOrder: 0,
        },
      ],
    },
  });
  await openMarketWithWatchlist(page);

  const row = page.locator('[data-testid="watchlist-row"][data-symbol="QQQ"]');
  await expect(row).toBeVisible();
  await expect(row.locator('[title="Issuer country"]')).toContainText("US");
  await expect(row.locator('[title="Market"]')).toContainText("ETF");

  const boxes = await row.evaluate((element) => {
    const rowBox = element.getBoundingClientRect();
    return Array.from(
      element.querySelectorAll('[title="Issuer country"], [title="Market"]'),
    ).map((chip) => {
      const box = chip.getBoundingClientRect();
      return {
        left: box.left - rowBox.left,
        right: rowBox.right - box.right,
        top: box.top - rowBox.top,
        bottom: rowBox.bottom - box.bottom,
      };
    });
  });
  expect(
    boxes.every(
      (box) => box.left >= 0 && box.right >= 0 && box.top >= 0 && box.bottom >= 0,
    ),
  ).toBe(true);
});

test("watchlist selector menu is anchored, mutually exclusive with add mode, and dismisses outside", async ({
  page,
}) => {
  await mockPlatformApi(page, {
    watchlist: {
      id: "default",
      name: "Default",
      isDefault: true,
      items: [{ id: "spy-item", symbol: "SPY", name: "S&P 500", sortOrder: 0 }],
    },
  });
  await openMarketWithWatchlist(page);

  const trigger = page.getByTestId("watchlist-menu-trigger");
  const menu = page.getByTestId("watchlist-menu");
  const addToggle = page.getByTestId("watchlist-add-toggle");
  const addPanel = page.getByTestId("watchlist-add-panel");

  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  await addToggle.click();
  await expect(addPanel).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(addPanel).toHaveCount(0);

  await page.getByTestId("market-workspace").click({ position: { x: 10, y: 10 } });
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

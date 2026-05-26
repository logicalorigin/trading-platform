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
    onRemove,
  }: {
    watchlist: unknown;
    onReorder?: (payload: unknown) => void;
    onRemove?: (itemId: string) => void;
  },
) {
  const removedItemIds = new Set<string>();
  const currentWatchlist = () => {
    const typedWatchlist = watchlist as { items?: Array<{ id?: string }> };
    if (!Array.isArray(typedWatchlist.items)) {
      return watchlist;
    }
    return {
      ...typedWatchlist,
      items: typedWatchlist.items.filter(
        (item) => !item.id || !removedItemIds.has(item.id),
      ),
    };
  };

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
      body = { watchlists: [currentWatchlist()] };
    } else if (
      url.pathname === "/api/watchlists/default/items/reorder" &&
      route.request().method() === "PUT"
    ) {
      const payload = route.request().postDataJSON();
      onReorder?.(payload);
      body = currentWatchlist();
    } else if (
      url.pathname.startsWith("/api/watchlists/default/items/") &&
      route.request().method() === "DELETE"
    ) {
      const itemId = decodeURIComponent(url.pathname.split("/").pop() || "");
      removedItemIds.add(itemId);
      onRemove?.(itemId);
      body = currentWatchlist();
    } else if (
      url.pathname === "/api/signal-monitor/matrix" &&
      route.request().method() === "POST"
    ) {
      body = {
        states: signalStates,
        timeframes: ["2m", "5m", "15m"],
        evaluatedAt: new Date().toISOString(),
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
      "pyrus:state:v1",
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
            studies: ["ema21", "vwap", "pyrusSignals"],
          },
        ],
      }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
}

async function expectWatchlistRowsToFit(page: Page) {
  const overflowingRows = await page
    .locator('[data-testid="watchlist-row"]')
    .evaluateAll((rows) =>
      rows
        .map((row) => ({
          symbol: row.getAttribute("data-symbol"),
          clientWidth: row.clientWidth,
          scrollWidth: row.scrollWidth,
        }))
        .filter((row) => row.scrollWidth > row.clientWidth + 1),
    );

  expect(overflowingRows).toEqual([]);
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
  const spySignalCluster = page
    .locator('[data-testid="watchlist-row"][data-symbol="SPY"]')
    .getByTestId("watchlist-signal-cluster");
  await expect(spySignalCluster).toContainText("BUY");
  await expect(spySignalCluster.getByTestId("watchlist-signal-dot-2m")).toHaveAttribute(
    "data-timeframe",
    "2m",
  );
  await expect(spySignalCluster.getByTestId("watchlist-signal-dot-5m")).toHaveAttribute(
    "data-timeframe",
    "5m",
  );
  await expect(spySignalCluster.getByTestId("watchlist-signal-dot-15m")).toHaveAttribute(
    "data-timeframe",
    "15m",
  );
  const visibleSignalDots = await spySignalCluster
    .locator('[data-testid^="watchlist-signal-dot-"]')
    .evaluateAll((dots) =>
      dots.map((dot) => {
        const box = dot.getBoundingClientRect();
        const styles = window.getComputedStyle(dot);
        return {
          width: box.width,
          height: box.height,
          opacity: Number(styles.opacity),
        };
      }),
    );
  expect(visibleSignalDots).toHaveLength(3);
  expect(
    visibleSignalDots.every(
      (dot) => dot.width >= 7 && dot.height >= 7 && dot.opacity >= 0.65,
    ),
  ).toBe(true);
  await expect(spySignalCluster).not.toContainText("2m");
  await expect(spySignalCluster).not.toContainText("5m");
  await expect(spySignalCluster).not.toContainText("15m");
  await expect(
    page
      .locator('[data-testid="watchlist-row"][data-symbol="NVDA"]')
      .getByTestId("watchlist-signal-cluster"),
  ).toContainText("SELL");
  await expect(page.getByTestId("watchlist-sort-volume")).toHaveCount(0);
  const spyRow = page.locator('[data-testid="watchlist-row"][data-symbol="SPY"]');
  await expect(spyRow).not.toContainText("S&P 500");
  await expect(spyRow).not.toContainText("62.0M");
  const rowElementPlacement = await spyRow.evaluate((row) => {
    const rowBox = row.getBoundingClientRect();
    const dayChange = row.querySelector('[data-testid="watchlist-day-change"]');
    const price = row.querySelector('[data-testid="watchlist-row-price"]');
    const dots = row.querySelector('[data-testid="watchlist-signal-dots"]');
    const signalPill = row.querySelector('[data-testid="watchlist-signal-pill"]');
    const dayChangeBox = dayChange?.getBoundingClientRect();
    const priceBox = price?.getBoundingClientRect();
    const dotsBox = dots?.getBoundingClientRect();
    const signalPillBox = signalPill?.getBoundingClientRect();
    if (!dayChangeBox || !priceBox || !dotsBox || !signalPillBox) {
      throw new Error("Missing watchlist row placement target");
    }
    return {
      priceBottom: priceBox.bottom - rowBox.top,
      priceRight: priceBox.right - rowBox.left,
      dayChangeTop: dayChangeBox.top - rowBox.top,
      dayChangeRight: dayChangeBox.right - rowBox.left,
      dotsRight: dotsBox.right - rowBox.left,
      signalPillLeft: signalPillBox.left - rowBox.left,
    };
  });
  expect(rowElementPlacement.dayChangeTop).toBeGreaterThanOrEqual(
    rowElementPlacement.priceBottom - 1,
  );
  expect(
    Math.abs(rowElementPlacement.dayChangeRight - rowElementPlacement.priceRight),
  ).toBeLessThanOrEqual(2);
  expect(rowElementPlacement.dotsRight).toBeLessThanOrEqual(
    rowElementPlacement.signalPillLeft,
  );
  const signalPlacement = await page
    .locator('[data-testid="watchlist-row"][data-symbol="SPY"]')
    .evaluate((row) => {
      const rowBox = row.getBoundingClientRect();
      const cluster = row.querySelector('[data-testid="watchlist-signal-cluster"]');
      const clusterBox = cluster?.getBoundingClientRect();
      return {
        rowHeight: rowBox.height,
        clusterTop: clusterBox ? clusterBox.top - rowBox.top : Number.POSITIVE_INFINITY,
        clusterRight: clusterBox ? rowBox.right - clusterBox.right : Number.POSITIVE_INFINITY,
      };
    });
  expect(signalPlacement.clusterTop).toBeLessThan(signalPlacement.rowHeight / 2);
  expect(signalPlacement.clusterRight).toBeLessThanOrEqual(12);
  await expect(
    page.getByTestId("watchlist-row-sparkline").first().locator("svg"),
  ).toBeVisible();
  const sparklinePointCount = await page
    .getByTestId("watchlist-row-sparkline")
    .first()
    .locator("polyline")
    .evaluate((polyline) =>
      (polyline.getAttribute("points") || "").trim().split(/\s+/).filter(Boolean).length,
    );
  expect(sparklinePointCount).toBeGreaterThanOrEqual(24);
  await expect(page.getByTestId("watchlist-remove-symbol")).toHaveCount(0);
  await expectWatchlistRowsToFit(page);
  const initialSidebarWidth = await page
    .getByTestId("platform-watchlist-sidebar")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(initialSidebarWidth).toBeLessThanOrEqual(224);
  const headerOverlapPairs = await page
    .getByTestId("platform-watchlist-sidebar")
    .evaluate((sidebar) => {
      const selectors = [
        ["menu", '[data-testid="watchlist-menu-trigger"]'],
        ["select", '[data-testid="watchlist-select-toggle"]'],
        ["create", '[data-testid="watchlist-create-watchlist"]'],
        ["collapse", '[data-testid="watchlist-sidebar-collapse"]'],
      ];
      const boxes = selectors
        .map(([name, selector]) => {
          const element = sidebar.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            name,
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          };
        })
        .filter(Boolean);
      const overlaps = [];
      for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
          const left = boxes[leftIndex];
          const right = boxes[rightIndex];
          const separated =
            left.right <= right.left ||
            right.right <= left.left ||
            left.bottom <= right.top ||
            right.bottom <= left.top;
          if (!separated) {
            overlaps.push(`${left.name}/${right.name}`);
          }
        }
      }
      return overlaps;
    });
  expect(headerOverlapPairs).toEqual([]);
  const resizeHandle = page.getByTestId("watchlist-sidebar-resize-handle");
  const resizeHandleBox = await resizeHandle.boundingBox();
  expect(resizeHandleBox).not.toBeNull();
  if (resizeHandleBox) {
    await page.mouse.move(
      resizeHandleBox.x + resizeHandleBox.width / 2,
      resizeHandleBox.y + resizeHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      resizeHandleBox.x + resizeHandleBox.width / 2 + 36,
      resizeHandleBox.y + resizeHandleBox.height / 2,
    );
    await page.mouse.up();
  }
  await expect
    .poll(() =>
      page
        .getByTestId("platform-watchlist-sidebar")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(initialSidebarWidth + 24);
  await expectWatchlistRowsToFit(page);

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
  await expectWatchlistRowsToFit(page);
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

test("watchlist removes selected rows from the top-level select control", async ({ page }) => {
  const removedItemIds: string[] = [];
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
    onRemove: (itemId) => {
      removedItemIds.push(itemId);
    },
  });
  await openMarketWithWatchlist(page);

  await expect(page.getByTestId("watchlist-remove-symbol")).toHaveCount(0);
  await page.getByTestId("watchlist-select-toggle").click();
  await expect(page.getByTestId("watchlist-selection-toolbar")).toBeVisible();
  await expect(page.getByTestId("watchlist-selection-count")).toHaveText("0 selected");
  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="SPY"]')).toHaveAttribute(
    "draggable",
    "false",
  );

  await page.locator('[data-testid="watchlist-row"][data-symbol="SPY"]').click();
  await page.locator('[data-testid="watchlist-row"][data-symbol="NVDA"]').click();
  await expect(page.getByTestId("watchlist-selection-count")).toHaveText("2 selected");

  await page.getByTestId("watchlist-remove-selected").click();
  await expect.poll(() => removedItemIds).toEqual(["spy-item", "nvda-item"]);
  await expect(page.getByTestId("watchlist-selection-toolbar")).toHaveCount(0);
  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="SPY"]')).toHaveAttribute(
    "data-source",
    "monitor",
  );
  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="NVDA"]')).toHaveAttribute(
    "data-source",
    "monitor",
  );
  await expect(page.locator('[data-testid="watchlist-row"][data-symbol="QQQ"]')).toBeVisible();
});

test("watchlist row omits secondary identity chips without clipping", async ({ page }) => {
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
  await expect(row.locator('[title="Issuer country"], [title="Market"]')).toHaveCount(0);
  await expect(row).not.toContainText("US");
  await expect(row).not.toContainText("ETF");

  await expectWatchlistRowsToFit(page);
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

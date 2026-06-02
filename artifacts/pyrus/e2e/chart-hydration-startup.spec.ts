import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

const marketSymbols = ["SPY", "QQQ", "IWM", "AAPL"];
const basePrices: Record<string, number> = {
  SPY: 520,
  QQQ: 440,
  IWM: 210,
  AAPL: 190,
};

type BarRequest = {
  symbol: string;
  limit: number | null;
  family: string | null;
  priority: string | null;
  from: string | null;
  to: string | null;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const createDeferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const makeBars = (
  symbol: string,
  count: number,
  anchorMs = Date.parse("2026-05-21T16:00:00.000Z"),
) => {
  const base = basePrices[symbol] ?? 100;
  return Array.from({ length: count }, (_, index) => {
    const close = base + Math.sin(index / 6) * 1.4 + index * 0.01;
    const open = close - Math.cos(index / 5) * 0.6;
    return {
      timestamp: new Date(anchorMs - (count - 1 - index) * 15 * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 0.9,
      low: Math.min(open, close) - 0.9,
      close,
      volume: 100_000 + index * 750,
      source: "mock",
    };
  });
};

async function mockMarketHydrationApi(
  page: Page,
  options: {
    barGate?: Deferred;
    pressure?: "normal" | "backoff" | "stalled";
  } = {},
) {
  const observed = {
    bars: [] as BarRequest[],
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};

    if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname === "/api/session") {
      const pressure = options.pressure || "normal";
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        marketDataProviders: {
          live: "ibkr",
          historical: "ibkr",
          research: "fmp",
        },
        configured: { massive: false, ibkr: true, research: false },
        ibkrBridge: {
          configured: true,
          authenticated: true,
          healthFresh: true,
          selectedAccountId: "DU1234567",
          transport: "tws",
          marketDataMode: "live",
          lastError:
            pressure === "stalled"
              ? "historical lane stalled after request timed out"
              : pressure === "backoff"
                ? "historical lane backed off"
                : null,
        },
        timestamp: "2026-05-21T16:00:00.000Z",
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [
          {
            id: "default",
            name: "Default",
            isDefault: true,
            items: marketSymbols.map((symbol, index) => ({
              id: `default-${symbol}`,
              symbol,
              name: symbol,
              sortOrder: index,
              addedAt: "2026-05-21T16:00:00.000Z",
            })),
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
          const price = basePrices[symbol] ?? 100;
          return {
            symbol,
            price,
            prevClose: price - 1,
            change: 1,
            changePercent: 1 / price,
            delayed: false,
          };
        }),
      };
    } else if (url.pathname === "/api/bars") {
      const symbol = (url.searchParams.get("symbol") || "SPY").toUpperCase();
      const limit = Number(url.searchParams.get("limit"));
      const family = route.request().headers()["x-pyrus-request-family"] || null;
      const to = url.searchParams.get("to");
      const toMs = to ? Date.parse(to) : Number.NaN;
      observed.bars.push({
        symbol,
        limit: Number.isFinite(limit) ? limit : null,
        family,
        priority: route.request().headers()["x-pyrus-fetch-priority"] || null,
        from: url.searchParams.get("from"),
        to,
      });
      if (options.barGate) {
        await options.barGate.promise;
      }
      body = {
        bars: makeBars(
          symbol,
          Number.isFinite(limit) ? Math.max(1, limit) : 240,
          family === "chart-backfill" && Number.isFinite(toMs)
            ? toMs
            : undefined,
        ),
      };
    } else if (url.pathname === "/api/flow/events") {
      body = {
        events: [],
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
      body = {
        id: "mock-signal-monitor-profile",
        environment: "paper",
        enabled: false,
        watchlistId: null,
        timeframe: "15m",
        pyrusSignalsSettings: {},
        freshWindowBars: 3,
        pollIntervalSeconds: 60,
        maxSymbols: 50,
        evaluationConcurrency: 2,
        lastEvaluatedAt: null,
        lastError: null,
        createdAt: "2026-05-21T16:00:00.000Z",
        updatedAt: "2026-05-21T16:00:00.000Z",
      };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = { states: [] };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (
      url.pathname === "/api/settings/preferences" ||
      url.pathname === "/api/user-preferences"
    ) {
      body = {
        profileKey: "chart-hydration-startup",
        version: 1,
        preferences: {
          appearance: { theme: "dark" },
          chart: { showVolume: true },
        },
        source: "local",
        updatedAt: "2026-05-21T16:00:00.000Z",
      };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("**/*tradingview.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "",
    });
  });

  return observed;
}

async function openMarket(page: Page, layout = "2x2") {
  await page.goto("about:blank");
  await page.addInitScript(
    ({ symbols, layout }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        "pyrus:state:v1",
        JSON.stringify({
          screen: "market",
          sym: "SPY",
          theme: "dark",
          sidebarCollapsed: true,
          marketGridLayout: layout,
          marketGridSlots: symbols.map((ticker: string, index: number) => ({
            ticker,
            tf: "15m",
            market: "stocks",
            provider: "ibkr",
            tradeProvider: "ibkr",
            providerContractId: String(320_000_000 + index),
            studies: ["ema21", "vwap", "pyrusSignals"],
          })),
        }),
      );
    },
    { symbols: marketSymbols, layout },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("market-chart-grid")).toBeVisible();
}

async function expectChartRendered(page: Page, testId: string) {
  const surface = page.getByTestId(`${testId}-surface`);
  await expect(surface).toHaveAttribute(
    "data-chart-visible-logical-range",
    /^(?!none$).+/,
    { timeout: 20_000 },
  );
  await expect
    .poll(async () => Number(await surface.getAttribute("data-chart-rendered-bar-count")))
    .toBeGreaterThan(0);
}

async function readRenderedBarCount(page: Page, testId: string) {
  return Number(
    await page
      .getByTestId(`${testId}-surface`)
      .getAttribute("data-chart-rendered-bar-count"),
  );
}

const initialWindowRequestCount = (requests: BarRequest[]) =>
  requests.filter(
    (request) =>
      request.family !== "chart-warmup" &&
      request.limit != null &&
      request.limit < 900,
  ).length;

test("Market activity hydrates independently while visible charts paint before warmups", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const barGate = createDeferred();
  const observed = await mockMarketHydrationApi(page, { barGate });

  await openMarket(page, "2x2");
  const grid = page.getByTestId("market-chart-grid");

  await expect(grid).toHaveAttribute(
    "data-chart-hydration-pressure",
    /^(normal|degraded)$/,
  );
  await expect
    .poll(() => initialWindowRequestCount(observed.bars), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);
  expect(
    observed.bars.filter((request) => request.family === "chart-warmup"),
    "no mini chart warmup can start while first-paint bars are blocked",
  ).toEqual([]);

  await expect(page.getByTestId("market-activity-panel-card")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("market-activity-loader")).toHaveCount(0);

  barGate.resolve();

  await expectChartRendered(page, "market-chart-0");
  await expectChartRendered(page, "market-chart-1");
  await expectChartRendered(page, "market-chart-2");
  await expectChartRendered(page, "market-chart-3");
  expect(
    observed.bars.filter((request) => request.family === "chart-warmup"),
    "mini chart warmups should not compete with first paint",
  ).toEqual([]);
  await expect
    .poll(
      () =>
        page
          .locator(
            '[data-testid="market-chart-grid"] [data-chart-surface-module-version]',
          )
          .count(),
      { timeout: 20_000 },
    )
    .toBe(4);
});

test("Market backoff pressure hydrates visible charts at the slower cadence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const observed = await mockMarketHydrationApi(page, { pressure: "backoff" });

  await openMarket(page, "2x2");
  const grid = page.getByTestId("market-chart-grid");

  await expect(grid).toHaveAttribute("data-chart-hydration-pressure", "backoff", {
    timeout: 15_000,
  });
  await expect
    .poll(() => initialWindowRequestCount(observed.bars), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);

  await expect(page.getByTestId("market-activity-panel-card")).toBeVisible({
    timeout: 15_000,
  });
  await expectChartRendered(page, "market-chart-0");
  await expectChartRendered(page, "market-chart-1");
  await expectChartRendered(page, "market-chart-2");
  await expectChartRendered(page, "market-chart-3");
  await expect
    .poll(
      async () =>
        Number(
          await page
            .locator('[data-testid="market-chart-grid"]')
            .getAttribute("data-chart-hydration-slot-limit"),
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2);
});

test("Market stalled pressure still expands visible chart hydration", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const observed = await mockMarketHydrationApi(page, { pressure: "stalled" });

  await openMarket(page, "2x2");
  const grid = page.getByTestId("market-chart-grid");

  await expect(grid).toHaveAttribute("data-chart-hydration-pressure", "stalled", {
    timeout: 15_000,
  });
  await expect
    .poll(() => observed.bars.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);

  await expect(page.getByTestId("market-activity-panel-card")).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(
      async () =>
        Number(
          await grid.getAttribute("data-chart-hydration-slot-limit"),
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(4);
  await expectChartRendered(page, "market-chart-0");
  await expectChartRendered(page, "market-chart-1");
  await expectChartRendered(page, "market-chart-2");
  await expectChartRendered(page, "market-chart-3");
});

test("Market stalled pressure hydrates older candles as users zoom and pan into history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const observed = await mockMarketHydrationApi(page, { pressure: "stalled" });

  await openMarket(page, "2x2");
  const surface = page.getByTestId("market-chart-0-surface");
  const plot = page.getByTestId("market-chart-0-surface-plot");

  await expectChartRendered(page, "market-chart-0");
  const initialRenderedCount = await readRenderedBarCount(
    page,
    "market-chart-0",
  );
  expect(initialRenderedCount).toBeGreaterThan(0);

  const plotBox = await plot.boundingBox();
  expect(plotBox, "mini chart plot should have a geometry box").not.toBeNull();
  await page.mouse.move(
    plotBox!.x + plotBox!.width * 0.5,
    plotBox!.y + plotBox!.height * 0.55,
  );
  await page.mouse.wheel(0, 900);
  await page.mouse.down();
  await page.mouse.move(
    plotBox!.x + plotBox!.width * 0.78,
    plotBox!.y + plotBox!.height * 0.55,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(surface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "true",
    { timeout: 10_000 },
  );
  await expect
    .poll(
      () =>
        observed.bars.some(
          (request) =>
            request.symbol === "SPY" &&
            request.family === "chart-warmup" &&
            (request.limit ?? 0) >= 900,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect
    .poll(() => readRenderedBarCount(page, "market-chart-0"), {
      timeout: 20_000,
    })
    .toBeGreaterThan(initialRenderedCount);

  const expandedRenderedCount = await readRenderedBarCount(
    page,
    "market-chart-0",
  );
  await page.mouse.move(
    plotBox!.x + plotBox!.width * 0.5,
    plotBox!.y + plotBox!.height * 0.55,
  );
  await page.mouse.wheel(0, 1200);

  await expect
    .poll(
      () =>
        observed.bars.some(
          (request) =>
            request.symbol === "SPY" &&
            request.family === "chart-backfill" &&
            request.from &&
            request.to,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect
    .poll(() => readRenderedBarCount(page, "market-chart-0"), {
      timeout: 20_000,
    })
    .toBeGreaterThan(expandedRenderedCount);
});

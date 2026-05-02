import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const marketSymbols = ["SPY", "QQQ", "IWM", "VIXY", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN"];
const basePrices = Object.fromEntries(
  marketSymbols.map((symbol, index) => [symbol, 100 + index * 22]),
);

const layoutCases = [
  { width: 1440, height: 1000, layout: "1x1", expectedActivityLayout: "side-by-side" },
  { width: 1440, height: 1000, layout: "2x2", expectedActivityLayout: "side-by-side" },
  { width: 1440, height: 1000, layout: "2x3", expectedActivityLayout: "side-by-side" },
  { width: 1440, height: 1000, layout: "3x3", expectedActivityLayout: "side-by-side" },
  { width: 1280, height: 900, layout: "2x3", expectedActivityLayout: "side-by-side" },
  { width: 1280, height: 900, layout: "3x3", expectedActivityLayout: "side-by-side" },
  { width: 1024, height: 900, layout: "2x3", expectedActivityLayout: "stacked" },
  { width: 1024, height: 900, layout: "3x3", expectedActivityLayout: "stacked" },
  { width: 900, height: 900, layout: "2x3", expectedActivityLayout: "stacked" },
];

function isIgnorableConsoleMessage(message: ConsoleMessage) {
  const text = message.text();
  return (
    text.includes("AudioContext was not allowed to start") ||
    text.includes("appearance") ||
    text.includes("slider-vertical")
  );
}

function parseLogicalRangeSignature(signature: string | null) {
  if (!signature || signature === "none") {
    return null;
  }
  const [from, to] = signature.split(":").map(Number);
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
}

function expectLogicalRangesClose(
  actualSignature: string | null,
  expectedSignature: string | null,
  tolerance = 0.001,
) {
  const actual = parseLogicalRangeSignature(actualSignature);
  const expected = parseLogicalRangeSignature(expectedSignature);
  expect(actual, `actual logical range ${actualSignature}`).not.toBeNull();
  expect(expected, `expected logical range ${expectedSignature}`).not.toBeNull();
  expect(Math.abs(actual!.from - expected!.from)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual!.to - expected!.to)).toBeLessThanOrEqual(tolerance);
}

function makeBars(symbol: string) {
  const now = Date.now();
  const base = basePrices[symbol] ?? 100;
  return Array.from({ length: 120 }, (_, index) => {
    const wave = Math.sin(index / 4) * 1.8;
    const close = base + wave + index * 0.02;
    const open = close - Math.cos(index / 5) * 0.7;
    return {
      timestamp: new Date(now - (119 - index) * 15 * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 120_000 + index * 1_500,
      source: "mock",
    };
  });
}

function makeFlowEvents(symbol: string) {
  const now = Date.now();
  const base = basePrices[symbol] ?? 100;
  const putDominant = ["QQQ", "IWM", "TSLA"].includes(symbol);
  const side = putDominant ? "put" : "call";

  return [
    {
      id: `${symbol}-flow-1`,
      underlying: symbol,
      provider: "ibkr",
      basis: "snapshot",
      side: "buy",
      strike: Math.round(base),
      right: side,
      premium: putDominant ? 720_000 : 445_000,
      size: 22,
      openInterest: 210,
      impliedVolatility: 0.3,
      expirationDate: new Date(now + 3 * 86_400_000).toISOString(),
      occurredAt: new Date(now).toISOString(),
      sentiment: putDominant ? "bearish" : "bullish",
      tradeConditions: ["sweep"],
      isUnusual: true,
      unusualScore: 3,
      optionTicker: `${symbol}${putDominant ? "P" : "C"}1`,
    },
    {
      id: `${symbol}-flow-2`,
      underlying: symbol,
      provider: "ibkr",
      basis: "snapshot",
      side: "mid",
      strike: Math.round(base + (putDominant ? -2 : 2)),
      right: side,
      premium: putDominant ? 180_000 : 155_000,
      size: 12,
      openInterest: 180,
      impliedVolatility: 0.28,
      expirationDate: new Date(now + 4 * 86_400_000).toISOString(),
      occurredAt: new Date(now - 12 * 60_000).toISOString(),
      sentiment: putDominant ? "bearish" : "bullish",
      tradeConditions: [],
      isUnusual: false,
      unusualScore: 0,
      optionTicker: `${symbol}${putDominant ? "P" : "C"}2`,
    },
  ];
}

async function mockMarketApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};

    if (url.pathname === "/api/session") {
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        marketDataProviders: {
          live: "ibkr",
          historical: "ibkr",
          research: "fmp",
        },
        configured: { polygon: false, ibkr: false, research: false },
        ibkrBridge: null,
        timestamp: new Date().toISOString(),
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
              addedAt: new Date().toISOString(),
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
        quotes: requested.map((symbol, index) => {
          const price = basePrices[symbol] ?? 100 + index;
          const prevClose = price - (index % 2 ? -1.2 : 1.1);
          return {
            symbol,
            price,
            prevClose,
            change: price - prevClose,
            changePercent: ((price - prevClose) / prevClose) * 100,
            delayed: false,
          };
        }),
      };
    } else if (url.pathname === "/api/bars") {
      body = { bars: makeBars((url.searchParams.get("symbol") || "SPY").toUpperCase()) };
    } else if (url.pathname === "/api/flow/events") {
      body = {
        events: makeFlowEvents((url.searchParams.get("underlying") || "SPY").toUpperCase()),
        source: {
          provider: "ibkr",
          status: "live",
          unusualThreshold: 1,
          fallbackUsed: false,
        },
      };
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
  await page.route("**/*tradingview.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "",
    });
  });
}

async function openMarket(page: Page, layout: string) {
  await page.goto("about:blank");
  await page.addInitScript(
    ({ layout, symbols }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        "rayalgo:state:v1",
        JSON.stringify({
          screen: "market",
          sym: "SPY",
          theme: "dark",
          sidebarCollapsed: true,
          marketGridLayout: layout,
          marketGridSlots: symbols.map((ticker: string) => ({
            ticker,
            tf: "15m",
            studies: ["ema21", "vwap", "rayReplica"],
          })),
        }),
      );
    },
    { layout, symbols: marketSymbols },
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("market-chart-grid")).toBeVisible();
  await page.getByRole("button", { name: layout }).click();
}

async function expectNoElementOverflow(page: Page, selector: string) {
  const overflows = await page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim() || element.getAttribute("title") || element.tagName,
        width: rect.width,
        height: rect.height,
        overflowX: element.scrollWidth > element.clientWidth + 1,
        overflowY: element.scrollHeight > element.clientHeight + 1,
      };
    }),
  );

  expect(overflows.length, `${selector} should render`).toBeGreaterThan(0);
  overflows.forEach((entry) => {
    expect(entry.width, `${entry.text} should have visible width`).toBeGreaterThan(0);
    expect(entry.height, `${entry.text} should have visible height`).toBeGreaterThan(0);
    expect(entry.overflowX, `${entry.text} should not overflow horizontally`).toBe(false);
    expect(entry.overflowY, `${entry.text} should not overflow vertically`).toBe(false);
  });
}

test("Market chart grid keeps touched viewports through layout changes and clears them on reset", async ({
  page,
}) => {
  const runtimeIssues: string[] = [];
  page.on("pageerror", (error) => runtimeIssues.push(error.stack || error.message));
  page.on("console", (message) => {
    if (
      (message.type() === "error" || message.type() === "warning") &&
      !isIgnorableConsoleMessage(message)
    ) {
      runtimeIssues.push(message.text());
    }
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockMarketApi(page);
  await openMarket(page, "2x2");

  const chartSurfaces = page.locator(
    '[data-testid="market-chart-grid"] [data-chart-range-identity^="market-grid"]',
  );
  await expect(chartSurfaces).toHaveCount(4);
  const firstSurface = chartSurfaces.first();
  await expect(firstSurface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "false",
  );

  const firstPlot = firstSurface.locator("[data-chart-plot-root]");
  const firstBox = await firstPlot.boundingBox();
  expect(firstBox, "first chart plot should have a geometry box").not.toBeNull();
  await page.mouse.move(
    firstBox!.x + firstBox!.width / 2,
    firstBox!.y + firstBox!.height / 2,
  );
  await page.mouse.wheel(0, -500);
  await expect(firstSurface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "true",
    { timeout: 10_000 },
  );
  const touchedRange = await firstSurface.getAttribute(
    "data-chart-visible-logical-range",
  );
  expect(touchedRange).not.toBe("none");

  await page.getByRole("button", { name: "3x3" }).click();
  const expandedChartSurfaces = page.locator(
    '[data-testid="market-chart-grid"] [data-chart-range-identity^="market-grid"]',
  );
  await expect(expandedChartSurfaces).toHaveCount(9);
  await expect(expandedChartSurfaces.first()).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "true",
  );
  await expect
    .poll(() =>
      expandedChartSurfaces.first().getAttribute("data-chart-visible-logical-range"),
    )
    .not.toBe("none");
  expectLogicalRangesClose(
    await expandedChartSurfaces.first().getAttribute("data-chart-visible-logical-range"),
    touchedRange,
    2.5,
  );

  await page.getByTestId("market-chart-reset-views").click();
  await expect(expandedChartSurfaces.first()).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "false",
  );
  const touchedFlags = await expandedChartSurfaces.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-chart-viewport-user-touched"),
    ),
  );
  expect(touchedFlags).toEqual(Array(9).fill("false"));
  expect(runtimeIssues, "Market chart viewport test should not emit runtime issues").toEqual([]);
});

test("Market chart grid drag-pans inactive plots without selecting or snapping them", async ({
  page,
}) => {
  const runtimeIssues: string[] = [];
  page.on("pageerror", (error) => runtimeIssues.push(error.stack || error.message));
  page.on("console", (message) => {
    if (
      (message.type() === "error" || message.type() === "warning") &&
      !isIgnorableConsoleMessage(message)
    ) {
      runtimeIssues.push(message.text());
    }
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockMarketApi(page);
  await openMarket(page, "2x2");

  const chartSurfaces = page.locator(
    '[data-testid="market-chart-grid"] [data-chart-range-identity^="market-grid"]',
  );
  await expect(chartSurfaces).toHaveCount(4);
  const inactiveSurface = chartSurfaces.nth(1);
  const inactivePlot = inactiveSurface.locator("[data-chart-plot-root]");
  await expect(inactiveSurface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "false",
  );
  await expect
    .poll(() =>
      inactiveSurface.getAttribute("data-chart-visible-logical-range"),
    )
    .not.toBe("none");

  const beforeRange = await inactiveSurface.getAttribute(
    "data-chart-visible-logical-range",
  );
  const plotBox = await inactivePlot.boundingBox();
  expect(plotBox, "inactive chart plot should have a geometry box").not.toBeNull();
  await page.waitForTimeout(150);

  await page.mouse.move(
    plotBox!.x + plotBox!.width * 0.28,
    plotBox!.y + plotBox!.height * 0.52,
  );
  await page.mouse.down();
  await page.mouse.move(
    plotBox!.x + plotBox!.width * 0.72,
    plotBox!.y + plotBox!.height * 0.52,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect
    .poll(() =>
      inactiveSurface.getAttribute("data-chart-visible-logical-range"),
    )
    .not.toBe(beforeRange);
  const pannedRange = await inactiveSurface.getAttribute(
    "data-chart-visible-logical-range",
  );

  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("rayalgo:state:v1") || "{}",
        );
        return state.sym || null;
      }),
    )
    .toBe("SPY");

  await page.waitForTimeout(350);
  const settledRange = await inactiveSurface.getAttribute("data-chart-visible-logical-range");
  expectLogicalRangesClose(
    settledRange,
    pannedRange,
  );

  await inactivePlot.click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("rayalgo:state:v1") || "{}",
        );
        return state.sym || null;
      }),
    )
    .toBe("QQQ");
  expect(runtimeIssues, "Market chart drag-pan test should not emit runtime issues").toEqual([]);
});

for (const testcase of layoutCases) {
  test(`Market ${testcase.layout} is stable at ${testcase.width}x${testcase.height}`, async ({
    page,
  }) => {
    const runtimeIssues: string[] = [];
    page.on("pageerror", (error) => runtimeIssues.push(error.stack || error.message));
    page.on("console", (message) => {
      if (
        (message.type() === "error" || message.type() === "warning") &&
        !isIgnorableConsoleMessage(message)
      ) {
        runtimeIssues.push(message.text());
      }
    });

    await page.setViewportSize({ width: testcase.width, height: testcase.height });
    await mockMarketApi(page);
    await openMarket(page, testcase.layout);
    await expect(page.getByTestId("market-premium-flow-strip").first()).toBeVisible({
      timeout: 30_000,
    });

    await page.waitForTimeout(600);

    expect(runtimeIssues, "Market layout should not emit runtime issues").toEqual([]);
    expect(await page.getByTestId("market-workspace").getAttribute("data-activity-layout")).toBe(
      testcase.expectedActivityLayout,
    );

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, "document should not overflow horizontally").toBeLessThanOrEqual(
      testcase.width + 1,
    );

    const chartBoxes = await page
      .locator('[data-testid="market-chart-grid"] [data-chart-control-root]')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
    expect(chartBoxes.length, "visible chart cells should render").toBeGreaterThan(0);
    chartBoxes.forEach((box) => {
      expect(box.width, "chart cell should keep usable width").toBeGreaterThan(0);
      expect(box.height, "chart cell should keep usable height").toBeGreaterThan(0);
    });

    await expectNoElementOverflow(page, '[data-testid="market-premium-flow-strip"]');
  });
}

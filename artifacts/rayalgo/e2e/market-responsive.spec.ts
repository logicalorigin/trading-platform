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

function makeBars(symbol: string, version = 0, count = 120) {
  const now = Date.now() + version * 15 * 60_000;
  const base = basePrices[symbol] ?? 100;
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 4) * 1.8;
    const close = base + wave + index * 0.02;
    const open = close - Math.cos(index / 5) * 0.7;
    return {
      timestamp: new Date(now - (count - 1 - index) * 15 * 60_000).toISOString(),
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

function currentMonthIsoDate(dayPreference: number) {
  const now = new Date();
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.max(1, Math.min(lastDay, dayPreference));
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day),
  )
    .toISOString()
    .slice(0, 10);
}

async function mockMarketApi(
  page: Page,
  options: {
    ibkrStreaming?: boolean;
    advanceBarsOnRequest?: boolean;
    initialBarCount?: number;
    researchConfigured?: boolean;
    earningsEntries?: Array<Record<string, unknown>>;
  } = {},
) {
  const observed = {
    barsUrls: [] as string[],
    streamUrls: [] as string[],
  };
  const barRequestCounts = new Map<string, number>();
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
        configured: {
          polygon: false,
          ibkr: Boolean(options.ibkrStreaming),
          research: Boolean(options.researchConfigured),
        },
        ibkrBridge: options.ibkrStreaming
          ? {
              authenticated: true,
              healthFresh: true,
              selectedAccountId: "DU1234567",
              transport: "tws",
              marketDataMode: "live",
            }
          : null,
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
      observed.barsUrls.push(url.toString());
      const symbol = (url.searchParams.get("symbol") || "SPY").toUpperCase();
      const currentCount = barRequestCounts.get(symbol) || 0;
      barRequestCounts.set(symbol, currentCount + 1);
      body = {
        bars: makeBars(
          symbol,
          options.advanceBarsOnRequest ? currentCount : 0,
          options.initialBarCount ?? 120,
        ),
      };
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
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const entries = options.earningsEntries || [];
      body = {
        entries: entries.filter((entry) => {
          const date = String(entry.date || "");
          return (!from || date >= from) && (!to || date <= to);
        }),
      };
    } else if (url.pathname === "/api/research/status") {
      body = {
        configured: Boolean(options.researchConfigured),
        provider: options.researchConfigured ? "fmp" : null,
      };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = {
        id: "mock-signal-monitor-profile",
        environment: "paper",
        enabled: false,
        watchlistId: null,
        timeframe: "15m",
        rayReplicaSettings: {},
        freshWindowBars: 3,
        pollIntervalSeconds: 60,
        maxSymbols: 50,
        evaluationConcurrency: 2,
        lastEvaluatedAt: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = { states: [] };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    } else if (url.pathname.includes("/streams/")) {
      observed.streamUrls.push(url.toString());
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
  return observed;
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
          marketGridSlots: symbols.map((ticker: string, index: number) => ({
            ticker,
            tf: "15m",
            market: "stocks",
            provider: index % 2 === 0 ? "ibkr" : "polygon",
            tradeProvider: "ibkr",
            dataProviderPreference: "polygon",
            providerContractId: String(320_000_000 + index),
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

async function installControllableEventSource(page: Page) {
  await page.addInitScript(() => {
    class TestEventSource {
      static instances: TestEventSource[] = [];
      url: string;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

      constructor(url: string) {
        this.url = url;
        TestEventSource.instances.push(this);
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.(new Event("open"));
          this.emit("ready", {});
        }, 0);
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: (event: MessageEvent) => void) {
        this.listeners.get(type)?.delete(listener);
      }

      close() {
        this.readyState = 2;
      }

      emit(type: string, payload: unknown) {
        const event = new MessageEvent(type, {
          data:
            typeof payload === "string" ? payload : JSON.stringify(payload),
        });
        this.listeners.get(type)?.forEach((listener) => listener(event));
      }
    }

    (window as unknown as { EventSource: typeof TestEventSource }).EventSource =
      TestEventSource;
    (window as unknown as {
      __RAYALGO_TEST_EMIT_EVENT_SOURCE__: (
        urlIncludes: string,
        type: string,
        payload: unknown,
      ) => void;
      __RAYALGO_TEST_EVENT_SOURCE_URLS__: () => string[];
    }).__RAYALGO_TEST_EMIT_EVENT_SOURCE__ = (urlIncludes, type, payload) => {
      TestEventSource.instances
        .filter((source) => source.url.includes(urlIncludes))
        .forEach((source) => source.emit(type, payload));
    };
    (window as unknown as {
      __RAYALGO_TEST_EVENT_SOURCE_URLS__: () => string[];
    }).__RAYALGO_TEST_EVENT_SOURCE_URLS__ = () =>
      TestEventSource.instances.map((source) => source.url);
  });
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

test("Market calendar overlay renders month events, detail chart, and Trade handoff", async ({
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

  const nvdaDate = currentMonthIsoDate(18);
  const aaplDate = currentMonthIsoDate(8);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockMarketApi(page, {
    researchConfigured: true,
    earningsEntries: [
      {
        symbol: "NVDA",
        date: nvdaDate,
        time: "amc",
        epsEstimated: 5.22,
        revenueEstimated: 38_000_000_000,
        fiscalDateEnding: nvdaDate,
      },
      {
        symbol: "AAPL",
        date: aaplDate,
        time: "bmo",
        epsEstimated: 1.48,
        revenueEstimated: 94_000_000_000,
        fiscalDateEnding: aaplDate,
      },
    ],
  });
  await openMarket(page, "1x1");

  await page.getByTestId("market-calendar-open").click();
  await expect(page.getByTestId("market-calendar-overlay")).toBeVisible();
  await expect(page.getByTestId("market-calendar-provider-status")).toContainText(
    /earnings live/i,
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("market-calendar-month-grid")).toBeVisible();
  await page.getByText("NVDA AMC").click();
  await expect(page.getByTestId("market-calendar-detail")).toContainText("NVDA");
  await expect(page.getByTestId("market-calendar-detail")).toContainText("Revenue est");
  await expect(page.getByTestId("market-calendar-detail-mini-chart")).toBeVisible();
  await expect(page.getByTestId("market-calendar-detail-chart")).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId("market-calendar-scope-all_watchlists").click();
  await expect(page.getByTestId("market-calendar-detail")).toContainText("NVDA");

  await page
    .getByTestId("market-calendar-detail")
    .getByRole("button", { name: /trade/i })
    .click();
  await expect(page.getByTestId("market-calendar-overlay")).toBeHidden();
  await expect(page.getByTestId("trade-tab-NVDA")).toBeVisible({
    timeout: 20_000,
  });
  expect(runtimeIssues, "Market calendar overlay should not emit runtime issues").toEqual([]);
});

test("Market chart grid lets chart surfaces own touched viewports and clears them on reset", async ({
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
    '[data-testid="market-chart-grid"] [data-chart-range-identity^="trade-equity-chart"]',
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

  await page.waitForTimeout(350);
  expectLogicalRangesClose(
    await firstSurface.getAttribute("data-chart-visible-logical-range"),
    touchedRange,
    2.5,
  );

  await page.getByTestId("market-chart-reset-views").click();
  await expect(firstSurface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "false",
  );
  const touchedFlags = await chartSurfaces.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-chart-viewport-user-touched"),
    ),
  );
  expect(touchedFlags).toEqual(Array(4).fill("false"));
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
  const observed = await mockMarketApi(page);
  await openMarket(page, "2x2");

  const chartSurfaces = page.locator(
    '[data-testid="market-chart-grid"] [data-chart-range-identity^="trade-equity-chart"]',
  );
  await expect(chartSurfaces).toHaveCount(4);
  const inactiveSurface = chartSurfaces.nth(1);
  const inactivePlot = inactiveSurface.locator("[data-chart-plot-root]");
  const inactiveIdentity = await inactiveSurface.getAttribute(
    "data-chart-range-identity",
  );
  expect(inactiveIdentity).not.toContain("320000001");
  expect(inactiveIdentity).not.toContain("polygon");
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
  const stockBarsUrls = observed.barsUrls.filter((href) => {
    const url = new URL(href);
    return marketSymbols.includes((url.searchParams.get("symbol") || "").toUpperCase());
  });
  expect(stockBarsUrls.length).toBeGreaterThan(0);
  expect(
    stockBarsUrls.filter((href) => new URL(href).searchParams.has("providerContractId")),
    "Market stock chart bar requests must match Trade's symbol-only equity path",
  ).toEqual([]);
  expect(
    observed.streamUrls.filter((href) => {
      const url = new URL(href);
      return (
        url.pathname === "/api/streams/bars" &&
        marketSymbols.includes((url.searchParams.get("symbol") || "").toUpperCase()) &&
        url.searchParams.has("providerContractId")
      );
    }),
    "Market stock chart streams must not carry stale stock provider contracts",
  ).toEqual([]);

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

test("Market chart grid keeps active plot pans through live bar refreshes", async ({
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
  await installControllableEventSource(page);
  await mockMarketApi(page, {
    ibkrStreaming: true,
    initialBarCount: 119,
  });
  await openMarket(page, "2x2");

  const chartSurfaces = page.locator(
    '[data-testid="market-chart-grid"] [data-chart-range-identity^="trade-equity-chart"]',
  );
  await expect(chartSurfaces).toHaveCount(4);
  const activeSurface = chartSurfaces.first();
  const activePlot = activeSurface.locator("[data-chart-plot-root]");
  await expect
    .poll(() => activeSurface.getAttribute("data-chart-visible-logical-range"))
    .not.toBe("none");

  const beforeRange = await activeSurface.getAttribute(
    "data-chart-visible-logical-range",
  );
  const plotBox = await activePlot.boundingBox();
  expect(plotBox, "active chart plot should have a geometry box").not.toBeNull();
  const dragStartPoint = {
    x: plotBox!.x + plotBox!.width * 0.3,
    y: plotBox!.y + plotBox!.height * 0.55,
  };
  const renderedCountBefore = Number(
    await activeSurface.getAttribute("data-chart-rendered-bar-count"),
  );
  expect(renderedCountBefore).toBeGreaterThan(0);

  await page.mouse.move(
    dragStartPoint.x,
    dragStartPoint.y,
  );
  await page.mouse.down();
  await page.mouse.move(
    plotBox!.x + plotBox!.width * 0.72,
    plotBox!.y + plotBox!.height * 0.55,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(activeSurface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "true",
    { timeout: 10_000 },
  );
  await expect
    .poll(() => activeSurface.getAttribute("data-chart-visible-logical-range"))
    .not.toBe(beforeRange);
  const pannedRange = await activeSurface.getAttribute(
    "data-chart-visible-logical-range",
  );
  await page.mouse.move(12, 12);
  await page.waitForTimeout(16_000);

  await page.evaluate(() => {
    const emit = (window as unknown as {
      __RAYALGO_TEST_EMIT_EVENT_SOURCE__?: (
        urlIncludes: string,
        type: string,
        payload: unknown,
      ) => void;
    }).__RAYALGO_TEST_EMIT_EVENT_SOURCE__;
    const baseTimestamp = Date.now() + 15 * 60_000;
    for (let index = 0; index < 4; index += 1) {
      emit?.("symbol=SPY", "bar", {
        symbol: "SPY",
        timeframe: "15m",
        bar: {
          timestamp: new Date(baseTimestamp + index * 15 * 60_000).toISOString(),
          open: 126 + index,
          high: 128 + index,
          low: 125 + index,
          close: 127 + index,
          volume: 250_000 + index * 10_000,
          source: "ibkr-history",
          freshness: "live",
          marketDataMode: "live",
          dataUpdatedAt: new Date().toISOString(),
        },
      });
    }
  });

  await expect
    .poll(
      async () =>
        Number(await activeSurface.getAttribute("data-chart-rendered-bar-count")),
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(renderedCountBefore + 4);
  const eventSourceUrls = await page.evaluate(() => {
    const getUrls = (window as unknown as {
      __RAYALGO_TEST_EVENT_SOURCE_URLS__?: () => string[];
    }).__RAYALGO_TEST_EVENT_SOURCE_URLS__;
    return getUrls?.() || [];
  });
  expect(
    eventSourceUrls.filter((href) => {
      const url = new URL(href, "http://rayalgo.local");
      return (
        url.pathname === "/api/streams/bars" &&
        (url.searchParams.get("symbol") || "").toUpperCase() === "SPY" &&
        url.searchParams.has("providerContractId")
      );
    }),
    "Active Market stock chart stream must stay on the symbol-only IBKR path",
  ).toEqual([]);

  await page.waitForTimeout(900);
  expectLogicalRangesClose(
    await activeSurface.getAttribute("data-chart-visible-logical-range"),
    pannedRange,
    2.5,
  );
  expect(runtimeIssues, "Market active chart pan test should not emit runtime issues").toEqual([]);
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

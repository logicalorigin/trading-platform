import { expect, test, type ConsoleMessage, type Locator, type Page } from "@playwright/test";

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

function logicalRangesClose(
  actualSignature: string | null,
  expectedSignature: string | null,
  tolerance = 0.001,
) {
  const actual = parseLogicalRangeSignature(actualSignature);
  const expected = parseLogicalRangeSignature(expectedSignature);
  return Boolean(
    actual &&
      expected &&
      Math.abs(actual.from - expected.from) <= tolerance &&
      Math.abs(actual.to - expected.to) <= tolerance,
  );
}

async function expectPlotInsideChartFrame(
  chart: Locator,
  plot: Locator,
) {
  const chartBox = await chart.boundingBox();
  const plotBox = await plot.boundingBox();

  expect(chartBox, "chart frame should have a geometry box").not.toBeNull();
  expect(plotBox, "chart plot should have a geometry box").not.toBeNull();
  expect(plotBox!.x).toBeGreaterThanOrEqual(chartBox!.x - 1);
  expect(plotBox!.y).toBeGreaterThanOrEqual(chartBox!.y - 1);
  expect(plotBox!.x + plotBox!.width).toBeLessThanOrEqual(
    chartBox!.x + chartBox!.width + 1,
  );
  expect(plotBox!.y + plotBox!.height).toBeLessThanOrEqual(
    chartBox!.y + chartBox!.height + 1,
  );
}

function makeBars(symbol: string, version = 0, count = 120, anchorMs = Date.now()) {
  const now = anchorMs + version * 15 * 60_000;
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

function makeSignalStates() {
  const now = new Date().toISOString();
  return [
    {
      symbol: "SPY",
      timeframe: "15m",
      currentSignalDirection: "buy",
      currentSignalAt: now,
      currentSignalPrice: basePrices.SPY,
      latestBarAt: now,
      barsSinceSignal: 1,
      fresh: true,
      status: "ok",
      lastEvaluatedAt: now,
    },
    {
      symbol: "QQQ",
      timeframe: "15m",
      currentSignalDirection: "sell",
      currentSignalAt: now,
      currentSignalPrice: basePrices.QQQ,
      latestBarAt: now,
      barsSinceSignal: 2,
      fresh: true,
      status: "ok",
      lastEvaluatedAt: now,
    },
  ];
}

async function mockMarketApi(
  page: Page,
  options: {
    ibkrStreaming?: boolean;
    advanceBarsOnRequest?: boolean;
    initialBarCount?: number;
    barAnchorMs?: number;
    signalStates?: unknown[];
    preferences?: unknown;
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
        configured: { polygon: false, ibkr: Boolean(options.ibkrStreaming), research: false },
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
          options.barAnchorMs,
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
      body = { entries: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = {
        id: "mock-signal-monitor-profile",
        environment: "paper",
        enabled: Boolean(options.signalStates?.length),
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
      body = { states: options.signalStates || [] };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/settings/preferences") {
      body = {
        profileKey: "mock",
        version: 1,
        preferences: options.preferences || undefined,
        source: "local",
        updatedAt: new Date(0).toISOString(),
      };
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

async function openMarket(
  page: Page,
  layout: string,
  statePatch: Record<string, unknown> = {},
) {
  await page.goto("about:blank");
  await page.addInitScript(
    ({ layout, symbols, statePatch }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      const baseState = {
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
      };
      window.localStorage.setItem(
        "rayalgo:state:v1",
        JSON.stringify({
          ...baseState,
          ...statePatch,
        }),
      );
    },
    { layout, symbols: marketSymbols, statePatch },
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

test("Market startup resolves nested light theme before React mounts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockMarketApi(page, {
    preferences: {
      appearance: {
        theme: "light",
      },
    },
  });
  let delayedPlatformChunk = false;
  await page.route("**/src/features/platform/PlatformApp.jsx*", async (route) => {
    if (!delayedPlatformChunk) {
      delayedPlatformChunk = true;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.continue();
  });
  await page.goto("about:blank");
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        marketGridLayout: "2x2",
        userPreferences: {
          appearance: {
            theme: "light",
          },
        },
      }),
    );
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(
    await page.evaluate(() => document.documentElement.dataset.rayalgoTheme),
  ).toBe("light");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(245, 245, 244)");
  const fallback = page.getByTestId("app-loading-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute("data-theme", "light");
  expect(await fallback.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    "rgb(245, 245, 244)",
  );
  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.rayalgoTheme))
    .toBe("light");
});

test("Market chart frames render signal colors and extended-session shading", async ({
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
  await mockMarketApi(page, {
    barAnchorMs: Date.parse("2026-04-30T21:00:00Z"),
    signalStates: makeSignalStates(),
    preferences: {
      appearance: {
        theme: "dark",
      },
    },
  });
  await openMarket(page, "2x2");

  const buyFrame = page.getByTestId("market-mini-chart-0");
  const sellFrame = page.getByTestId("market-mini-chart-1");
  await expect(buyFrame).toHaveAttribute("data-signal-frame-active", "true");
  await expect(buyFrame).toHaveAttribute("data-signal-direction", "buy");
  await expect(buyFrame).toHaveAttribute("data-signal-frame-color", "#3b82f6");
  await expect(sellFrame).toHaveAttribute("data-signal-frame-active", "true");
  await expect(sellFrame).toHaveAttribute("data-signal-direction", "sell");
  await expect(sellFrame).toHaveAttribute("data-signal-frame-color", "#ef4444");

  const buyBorderColor = await buyFrame.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  const sellBorderColor = await sellFrame.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  expect(buyBorderColor).toBe("rgb(59, 130, 246)");
  expect(sellBorderColor).toBe("rgb(239, 68, 68)");

  const firstSurface = page.getByTestId("market-mini-chart-0-surface");
  await expect(firstSurface).toHaveAttribute("data-chart-extended-session-enabled", "true");
  await expect
    .poll(async () =>
      Number(await firstSurface.getAttribute("data-chart-extended-session-window-count")),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      Number(await firstSurface.getAttribute("data-chart-extended-session-bar-count")),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId("chart-extended-session-after").first()).toBeVisible();
  expect(runtimeIssues, "Market signal/session visual test should not emit runtime issues").toEqual([]);
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

test("Market chart grid resets stale viewports and keeps plots framed across layouts", async ({
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
  await openMarket(page, "2x3");

  const chart = page.getByTestId("market-mini-chart-0");
  const surface = page.getByTestId("market-mini-chart-0-surface");
  const plot = page.getByTestId("market-mini-chart-0-surface-plot");
  await expect(surface).toHaveAttribute(
    "data-chart-viewport-layout",
    /market-grid:2x3:slot-0:3x2:rev-0/,
  );
  await expect
    .poll(() => surface.getAttribute("data-chart-visible-logical-range"))
    .not.toBe("none");
  await expectPlotInsideChartFrame(chart, plot);

  const initialPlotBox = await plot.boundingBox();
  expect(initialPlotBox, "initial plot should have a geometry box").not.toBeNull();
  await page.mouse.move(
    initialPlotBox!.x + initialPlotBox!.width * 0.5,
    initialPlotBox!.y + initialPlotBox!.height * 0.5,
  );
  await page.mouse.wheel(0, -500);
  await expect(surface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "true",
    { timeout: 10_000 },
  );
  const touchedRange = await surface.getAttribute(
    "data-chart-visible-logical-range",
  );
  const touched = parseLogicalRangeSignature(touchedRange);
  expect(touched, `touched logical range ${touchedRange}`).not.toBeNull();

  await page.getByRole("button", { name: "3x3" }).click();
  await expect(surface).toHaveAttribute(
    "data-chart-viewport-layout",
    /market-grid:3x3:slot-0:3x3:rev-0/,
    { timeout: 10_000 },
  );
  await expect(surface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "false",
    { timeout: 10_000 },
  );
  await expect
    .poll(() => surface.getAttribute("data-chart-visible-logical-range"))
    .not.toBe("none");
  await expectPlotInsideChartFrame(chart, plot);

  const resetRange = await surface.getAttribute(
    "data-chart-visible-logical-range",
  );
  const reset = parseLogicalRangeSignature(resetRange);
  expect(reset, `reset logical range ${resetRange}`).not.toBeNull();
  expect(logicalRangesClose(resetRange, touchedRange, 2)).toBe(false);
  const compactPlotBox = await plot.boundingBox();
  expect(compactPlotBox, "compact plot should have a geometry box").not.toBeNull();
  expect(compactPlotBox!.height).toBeLessThan(initialPlotBox!.height);

  await page.getByRole("button", { name: "1x1" }).click();
  await expect(surface).toHaveAttribute(
    "data-chart-viewport-layout",
    /market-grid:1x1:slot-0:1x1:rev-0/,
    { timeout: 10_000 },
  );
  await expect(surface).toHaveAttribute(
    "data-chart-viewport-user-touched",
    "false",
  );
  await expectPlotInsideChartFrame(chart, plot);
  const soloPlotBox = await plot.boundingBox();
  expect(soloPlotBox, "solo plot should have a geometry box").not.toBeNull();
  expect(soloPlotBox!.height).toBeGreaterThan(compactPlotBox!.height);

  expect(runtimeIssues, "Market layout viewport test should not emit runtime issues").toEqual([]);
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
  const instanceCreatesBefore = Number(
    await activeSurface.getAttribute("data-chart-instance-create-count"),
  );
  const instanceDisposesBefore = Number(
    await activeSurface.getAttribute("data-chart-instance-dispose-count"),
  );
  const tailAppendsBefore = Number(
    await activeSurface.getAttribute("data-chart-series-tail-append-count"),
  );
  const fullResetsBefore = Number(
    await activeSurface.getAttribute("data-chart-series-full-reset-count"),
  );

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
      const startMs = baseTimestamp + index * 15 * 60_000;
      emit?.("stocks/aggregates", "aggregate", {
        eventType: "stock-aggregate",
        symbol: "SPY",
        open: 126 + index,
        high: 128 + index,
        low: 125 + index,
        close: 127 + index,
        volume: 250_000 + index * 10_000,
        accumulatedVolume: 1_250_000 + index * 25_000,
        vwap: 126.5 + index,
        sessionVwap: 126.25 + index,
        officialOpen: null,
        averageTradeSize: 100,
        startMs,
        endMs: startMs + 60_000,
        delayed: false,
        source: "ibkr-websocket-derived",
        latency: null,
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
  await expect
    .poll(async () =>
      Number(await activeSurface.getAttribute("data-chart-series-tail-append-count")),
    )
    .toBeGreaterThan(tailAppendsBefore);
  expect(
    Number(await activeSurface.getAttribute("data-chart-instance-create-count")),
    "live aggregates should update the existing chart instance",
  ).toBe(instanceCreatesBefore);
  expect(
    Number(await activeSurface.getAttribute("data-chart-instance-dispose-count")),
    "live aggregates should not dispose the chart instance",
  ).toBe(instanceDisposesBefore);
  expect(
    Number(await activeSurface.getAttribute("data-chart-series-full-reset-count")),
    "live aggregates should append/patch series tails without full resets",
  ).toBe(fullResetsBefore);
  expect(
    await activeSurface.getAttribute("data-chart-auto-hydration"),
    "live aggregates must not re-enable auto hydration for a user-panned chart",
  ).toBe("false");
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
        url.pathname === "/api/streams/stocks/aggregates" &&
        (url.searchParams.get("symbols") || "")
          .split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .includes("SPY")
      );
    }),
    "Active Market stock chart stream must use the shared IBKR aggregate path",
  ).not.toEqual([]);
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
    0.2,
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

import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const flowSymbols = ["SPY", "QQQ", "NVDA", "TSLA", "IWM", "AAPL"];
const basePrices = Object.fromEntries(
  flowSymbols.map((symbol, index) => [symbol, 420 + index * 18]),
);
const symbolOffsets = Object.fromEntries(
  flowSymbols.map((symbol, index) => [symbol, (index + 1) * 10_000]),
);

function mockConid(symbol: string, suffix: number) {
  return String(900_000 + (symbolOffsets[symbol] ?? 0) + suffix);
}

function makeBars(symbol: string) {
  const now = Date.now();
  const base = basePrices[symbol] ?? 420;
  return Array.from({ length: 80 }, (_, index) => {
    const close = base + Math.sin(index / 5) * 2 + index * 0.04;
    return {
      timestamp: new Date(now - (79 - index) * 5 * 60_000).toISOString(),
      open: close - 0.4,
      high: close + 1,
      low: close - 1,
      close,
      volume: 80_000 + index * 1_000,
      source: "mock",
    };
  });
}

function makeOptionBars(symbol: string) {
  return makeBars(symbol).map((bar, index) => {
    const close = 2.1 + Math.sin(index / 6) * 0.18 + index * 0.006;
    return {
      ...bar,
      open: close - 0.06,
      high: close + 0.12,
      low: close - 0.1,
      close,
      volume: 40 + index * 3,
      source: "mock-option-history",
    };
  });
}

function makeFlowEvents(
  symbol: string,
  options: { invalidFirstProviderContractId?: boolean; missingFirstProviderContractId?: boolean } = {},
) {
  const now = Date.now();
  const base = basePrices[symbol] ?? 420;
  const putFlow = ["QQQ", "TSLA", "IWM"].includes(symbol);
  const right = putFlow ? "put" : "call";
  const side = putFlow ? "sell" : "buy";

  return Array.from({ length: 3 }, (_, index) => ({
    id: `${symbol}-flow-${index}`,
    underlying: symbol,
    provider: "ibkr",
    basis: index === 2 ? "trade" : "snapshot",
    side,
    strike: Math.round(base + (putFlow ? -index : index) * 2),
    right,
    price: 2.35 + index * 0.4,
    bid: 2.25 + index * 0.4,
    ask: 2.45 + index * 0.4,
    last: 2.4 + index * 0.4,
    mark: 2.35 + index * 0.4,
    premium: 95_000 + index * 130_000 + (putFlow ? 45_000 : 80_000),
    size: 12 + index * 9,
    openInterest: 120 + index * 40,
    impliedVolatility: 0.24 + index * 0.03,
    delta: putFlow ? -0.36 - index * 0.03 : 0.42 + index * 0.03,
    gamma: 0.04 + index * 0.01,
    theta: -0.08 - index * 0.02,
    vega: 0.11 + index * 0.01,
    underlyingPrice: base,
    moneyness: index === 0 ? "ATM" : "OTM",
    distancePercent: index * (putFlow ? -0.48 : 0.48),
    confidence: index === 2 ? "confirmed_trade" : "snapshot_activity",
    sourceBasis: index === 2 ? "confirmed_trade" : "snapshot_activity",
    expirationDate: new Date(now + (index + 2) * 86_400_000).toISOString(),
    occurredAt: new Date(now - index * 4 * 60_000).toISOString(),
    sentiment: putFlow ? "bearish" : "bullish",
    tradeConditions: index === 0 ? ["sweep"] : index === 1 ? ["block"] : [],
    isUnusual: index !== 2,
	    unusualScore: index === 0 ? 3.4 : index === 1 ? 1.7 : 0,
    optionTicker: `${symbol}${putFlow ? "P" : "C"}${index}`,
    providerContractId:
      options.invalidFirstProviderContractId && index === 0
        ? `${symbol}-polygon-fallback`
        : options.missingFirstProviderContractId && index === 0
        ? null
        : mockConid(symbol, index + 1),
  }));
}

async function mockFlowApi(
  page: Page,
  options: {
    emptyOptionBars?: boolean;
    invalidFirstProviderContractId?: boolean;
    missingFirstProviderContractId?: boolean;
    onFlowEventsRequest?: (url: URL) => void;
    resolveContractFailure?: boolean;
    skipChainMatch?: boolean;
  } = {},
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
          transport: "client-portal",
        },
        environment: "paper",
        marketDataProviders: {},
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [
          { id: "default", name: "Default", isDefault: true, symbols: flowSymbols },
        ],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const requested = (url.searchParams.get("symbols") || "SPY")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol, index) => {
          const price = basePrices[symbol] ?? 420 + index;
          return {
            symbol,
            price,
            prevClose: price - 2,
            change: 2,
            changePercent: 0.48,
            open: price - 1,
            high: price + 3,
            low: price - 4,
            volume: 40_000_000,
            delayed: false,
          };
        }),
      };
    } else if (url.pathname === "/api/options/chains") {
      const symbol = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      const expirationDate = url.searchParams.get("expirationDate") || "2026-05-15";
      const base = basePrices[symbol] ?? 420;
      const strike = Math.round(base) + (options.skipChainMatch ? 50 : 0);
      body = {
        underlying: symbol,
        expirationDate,
        contracts: ["call", "put"].map((right) => ({
          contract: {
            ticker: `${symbol}-${expirationDate}-${strike}-${right === "call" ? "C" : "P"}`,
            underlying: symbol,
            expirationDate,
            strike,
            right,
            multiplier: 100,
            sharesPerContract: 100,
            providerContractId:
              right === "call"
                ? mockConid(symbol, 4_001)
                : mockConid(symbol, 4_002),
          },
          bid: 1.1,
          ask: 1.2,
          last: 1.15,
          mark: 1.15,
          volume: 100,
          openInterest: 250,
          quoteFreshness: "live",
        })),
        debug: { cacheStatus: "miss", totalMs: 1, upstreamMs: 1 },
      };
    } else if (url.pathname === "/api/options/resolve-contract") {
      const symbol = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      const expirationDate = url.searchParams.get("expirationDate") || "2026-05-15";
      const strike = Number(url.searchParams.get("strike") || "0");
      const right = url.searchParams.get("right") === "put" ? "put" : "call";
      body = {
        underlying: symbol,
        expirationDate,
        strike,
        right,
        status: options.resolveContractFailure ? "not_found" : "resolved",
        providerContractId: options.resolveContractFailure
          ? null
          : mockConid(symbol, 8_001),
        contract: options.resolveContractFailure
          ? null
          : {
              ticker: `${symbol}-resolved`,
              underlying: symbol,
              expirationDate,
              strike,
              right,
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: mockConid(symbol, 8_001),
            },
        errorMessage: options.resolveContractFailure
          ? "IBKR did not return a matching option contract."
          : null,
        debug: { cacheStatus: "miss", totalMs: 1, upstreamMs: 1 },
      };
    } else if (url.pathname === "/api/options/chart-bars") {
      const symbol = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      const expirationDate = url.searchParams.get("expirationDate") || "2026-05-15";
      const strike = Number(url.searchParams.get("strike") || "0");
      const right = url.searchParams.get("right") === "put" ? "put" : "call";
      const requestedProviderContractId = url.searchParams.get("providerContractId");
      const resolvedProviderContractId = options.resolveContractFailure
        ? null
        : requestedProviderContractId && /^\d+$/.test(requestedProviderContractId)
          ? requestedProviderContractId
          : options.skipChainMatch
            ? mockConid(symbol, 8_001)
            : mockConid(symbol, right === "call" ? 4_001 : 4_002);
      const bars =
        options.emptyOptionBars || options.resolveContractFailure
          ? []
          : makeOptionBars(symbol);
      body = {
        symbol,
        timeframe: url.searchParams.get("timeframe") || "1m",
        bars,
        transport: resolvedProviderContractId ? "tws" : null,
        delayed: false,
        gapFilled: false,
        freshness: bars.length ? "live" : "unavailable",
        marketDataMode: bars.length ? "live" : null,
        dataUpdatedAt: bars.length
          ? bars[bars.length - 1]?.timestamp
          : null,
        ageMs: null,
        emptyReason: bars.length
          ? null
          : options.resolveContractFailure
            ? "option_contract_resolution_error"
            : "no-option-aggregate-bars",
        historySource: bars.length ? "ibkr-history" : null,
        studyFallback: false,
        underlying: symbol,
        expirationDate,
        strike,
        right,
        optionTicker: url.searchParams.get("optionTicker") || null,
        contract: resolvedProviderContractId
          ? {
              ticker: `${symbol}-${expirationDate}-${strike}-${right === "call" ? "C" : "P"}`,
              underlying: symbol,
              expirationDate,
              strike,
              right,
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: resolvedProviderContractId,
            }
          : null,
        providerContractId: resolvedProviderContractId,
        resolutionSource: resolvedProviderContractId
          ? requestedProviderContractId && /^\d+$/.test(requestedProviderContractId)
            ? "provided"
            : options.skipChainMatch
              ? "resolver"
              : "chain"
          : "none",
        dataSource: bars.length ? "ibkr-history" : "none",
        feedIssue: Boolean(options.resolveContractFailure),
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          degraded: !bars.length,
          reason: bars.length ? null : "no-option-aggregate-bars",
        },
      };
    } else if (url.pathname === "/api/bars") {
      body = {
        bars: options.emptyOptionBars &&
          url.searchParams.get("assetClass") === "option"
          ? []
          : makeBars((url.searchParams.get("symbol") || "SPY").toUpperCase()),
      };
    } else if (url.pathname === "/api/flow/events") {
      options.onFlowEventsRequest?.(url);
      const requested =
        url.searchParams
          .get("symbols")
          ?.split(",")
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean) ||
        [url.searchParams.get("underlying") || "SPY"].map((symbol) =>
          symbol.toUpperCase(),
        );
      body = {
        events: requested.flatMap((symbol) => makeFlowEvents(symbol, options)),
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
}

async function openFlow(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "flow",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("screen-host-flow")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("flow-top-toolbar")).toBeVisible({
    timeout: 30_000,
  });
}

async function openFlowWithState(page: Page, state: Record<string, unknown>) {
  await page.addInitScript((nextState) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "flow",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        ...nextState,
      }),
    );
  }, state);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("screen-host-flow")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("flow-top-toolbar")).toBeVisible({
    timeout: 30_000,
  });
}

async function expectNoDocumentOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

async function expectChartCanvasDrawn(page: Page, chartTestId: string) {
  await expect(page.getByTestId(chartTestId)).toBeVisible();
  await expect(page.getByTestId(`${chartTestId}-surface`)).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate((testId) => {
          const chart = document.querySelector(`[data-testid="${testId}"]`);
          if (!chart) return false;
          const canvases = Array.from(chart.querySelectorAll("canvas"));
          if (!canvases.length) return false;
          return canvases.some((canvas) => {
            if (canvas.width <= 0 || canvas.height <= 0) return false;
            const context = canvas.getContext("2d");
            if (!context) return false;
            const sampleWidth = Math.min(canvas.width, 240);
            const sampleHeight = Math.min(canvas.height, 160);
            const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
            let paintedPixels = 0;
            for (let index = 0; index < data.length; index += 16) {
              const alpha = data[index + 3];
              if (alpha > 0) {
                paintedPixels += 1;
              }
              if (paintedPixels > 80) return true;
            }
            return false;
          });
        }, chartTestId),
      { timeout: 10_000 },
    )
    .toBe(true);
}

test("Flow scanner keeps scanning after leaving the Flow page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const broadScanRequests: string[] = [];
  await mockFlowApi(page, {
    onFlowEventsRequest: (url) => {
      if (
        url.searchParams.get("scope") === "unusual" &&
        url.searchParams.get("limit") === "25"
      ) {
        broadScanRequests.push(
          url.searchParams.get("underlying")?.toUpperCase() || "",
        );
      }
    },
  });
  await openFlowWithState(page, {
    flowScannerConfig: {
      mode: "watchlist",
      scope: "unusual",
      maxSymbols: 6,
      batchSize: 2,
      intervalMs: 2_500,
      concurrency: 2,
      limit: 25,
      unusualThreshold: 1,
      minPremium: 0,
      maxDte: null,
    },
  });

  const flowHost = page.getByTestId("screen-host-flow");
  await flowHost.getByRole("button", { name: "Start Flow scan" }).click();
  await expect(flowHost.getByRole("button", { name: "Stop Flow scan" })).toBeVisible();
  await expect
    .poll(() => broadScanRequests.length, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const requestsBeforeLeavingFlow = broadScanRequests.length;
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.getByTestId("market-workspace")).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() => broadScanRequests.length, { timeout: 20_000 })
    .toBeGreaterThan(requestsBeforeLeavingFlow);

  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expect(page.getByTestId("screen-host-flow")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("screen-host-flow").getByRole("button", { name: "Stop Flow scan" }),
  ).toBeVisible();
});

test("Header Flow settings share linked filters with the Flow page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page);
  await openFlow(page);

  const flowHost = page.getByTestId("screen-host-flow");
  const filterPanel = flowHost.getByTestId("flow-filter-panel");
  await filterPanel.getByTestId("flow-include-input").fill("SPY, QQQ");
  await filterPanel.getByRole("button", { name: "Puts" }).click();
  await filterPanel.getByRole("button", { name: "$100K" }).click();

  await page.getByTestId("header-unusual-tape-settings-trigger").click();
  await expect(page.getByTestId("header-flow-filter-include")).toHaveValue(
    "SPY, QQQ",
  );
  await expect(page.getByTestId("header-flow-filter-type")).toHaveValue("puts");
  await expect(page.getByTestId("header-flow-filter-min-premium")).toHaveValue(
    "100000",
  );

  await page.getByTestId("header-flow-filter-exclude").fill("TSLA");
  await page.getByTestId("header-flow-filter-type").selectOption("sweep");
  await page.getByTestId("header-flow-filter-min-premium").selectOption("250000");
  await page.getByTestId("header-flow-filter-preset").selectOption("golden");

  await expect(filterPanel.getByTestId("flow-include-input")).toHaveValue(
    "SPY, QQQ",
  );
  await expect(filterPanel.getByTestId("flow-exclude-input")).toHaveValue("TSLA");
  await expect(page.getByTestId("header-flow-filter-type")).toHaveValue("golden");
  await expect(page.getByTestId("header-flow-filter-preset")).toHaveValue("golden");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("rayalgo:state:v1");
        return raw ? JSON.parse(raw) : {};
      }),
    )
    .toMatchObject({
      flowActivePresetId: "golden",
      flowFilter: "golden",
      flowMinPrem: 250_000,
      flowIncludeQuery: "SPY, QQQ",
      flowExcludeQuery: "TSLA",
    });
});

test("Flow desktop uses toolbar, inline filters, and persistent column drawer settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page);
  await openFlow(page);

  await expect(page.getByTestId("flow-filter-panel")).toBeVisible();
  await expect(page.getByTestId("flow-quality-bar")).toBeVisible();
  await expect(page.getByTestId("flow-preset-bar")).toBeVisible();
  await expect(page.getByTestId("flow-ticker-lens")).toBeVisible();
  await expect(page.getByTestId("flow-tape-row").first()).toBeVisible();
  await expect(page.getByTestId("flow-sentiment-bar")).toBeVisible();
  await expect(page.getByTestId("flow-tape-header-time")).toContainText("AGE");
  await expect(page.getByTestId("flow-tape-header-expiration")).toBeVisible();
  await expect(page.getByTestId("flow-tape-header-right")).toBeVisible();
  await expect(page.getByTestId("flow-tape-header-strike")).toBeVisible();
  await expect(page.getByTestId("flow-tape-header-fill")).toBeVisible();
  await expect(page.getByTestId("flow-tape-header-bidAsk")).toBeVisible();
  await expect(page.getByTestId("flow-tape-row").first()).toContainText("B 2.25");
  await expect(page.getByTestId("flow-tape-row").first()).toContainText("A 2.45");
  await expect(page.getByTestId("flow-tape-row").first().getByTitle(/2\.25 bid · 2\.35 fill · 2\.45 ask/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fill = document.querySelector('[data-testid="flow-tape-header-fill"]');
        const bidAsk = document.querySelector('[data-testid="flow-tape-header-bidAsk"]');
        if (!fill || !bidAsk) return Number.POSITIVE_INFINITY;
        return Math.abs(
          bidAsk.getBoundingClientRect().left - fill.getBoundingClientRect().right,
        );
      }),
    )
    .toBeLessThan(140);
  await page.getByTestId("flow-tape-header-ticker").click();
  await expect(page.getByTestId("flow-tape-header-ticker")).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(page.getByTestId("flow-filter-panel")).not.toContainText("SORT");

  await page.getByTestId("flow-built-in-preset-premium-250k").click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rayalgo:state:v1") || "{}");
        return state.flowActivePresetId;
      }),
    )
    .toBe("premium-250k");

  await page.getByTestId("flow-column-toggle").click();
  const drawer = page.getByTestId("flow-column-drawer");
  await expect(drawer).toBeVisible();

  const sideCheckbox = drawer.getByTestId("flow-column-row-side").locator("input");
  await expect(sideCheckbox).toBeChecked();
  await sideCheckbox.click();
  await expect(sideCheckbox).not.toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rayalgo:state:v1") || "{}");
        return Array.isArray(state.flowVisibleColumns)
          ? state.flowVisibleColumns.includes("side")
          : true;
      }),
    )
    .toBe(false);
  await expectNoDocumentOverflow(page);
});

test("Flow tape repairs persisted column state to show the visual bid ask column", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page);
  await openFlowWithState(page, {
    flowColumnOrder: [
      "side",
      "execution",
      "type",
      "fill",
      "premium",
      "size",
      "oi",
      "ratio",
      "dte",
      "iv",
      "score",
    ],
    flowVisibleColumns: [
      "side",
      "execution",
      "type",
      "fill",
      "premium",
      "size",
      "oi",
      "ratio",
      "dte",
      "iv",
      "score",
    ],
  });

  await expect(page.getByTestId("flow-tape-header-bidAsk")).toBeVisible();
  await expect(page.getByTestId("flow-tape-row").first()).toContainText("B 2.25");
  await expect(page.getByTestId("flow-tape-row").first()).toContainText("A 2.45");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("rayalgo:state:v1") || "{}");
        return Array.isArray(state.flowVisibleColumns)
          ? state.flowVisibleColumns.includes("bidAsk")
          : false;
      }),
    )
    .toBe(true);
});

test("Flow inspection requests and renders option charts for several clicked flow rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page);
  await openFlow(page);

  for (const rowIndex of [0, 1, 2]) {
    const chartRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === "/api/options/chart-bars";
    });

    await page.getByTestId("flow-tape-row").nth(rowIndex).click();
    await expect(page.getByTestId("flow-contract-drawer")).toHaveCount(0);
    await expect(page.getByTestId("flow-inline-execution-quality")).toBeVisible();
    const request = await chartRequest;
    expect(new URL(request.url()).searchParams.get("optionTicker")).toBeTruthy();
    await expectChartCanvasDrawn(page, "flow-inspection-option-chart");
    await expect(page.getByText("Option history unavailable")).toHaveCount(0);
  }
});

test("Flow inspection hydrates fallback flow contracts through the shared option chart endpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page, { missingFirstProviderContractId: true });
  await openFlow(page);

  const chartRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/options/chart-bars" &&
      !url.searchParams.has("providerContractId")
    );
  });

  await page.getByTestId("flow-tape-row").first().click();
  await chartRequest;
  await expectChartCanvasDrawn(page, "flow-inspection-option-chart");
  await expect(page.getByText("Option contract lookup unavailable")).toHaveCount(0);
});

test("Flow inspection sends non-IBKR fallback ids to the shared option chart endpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page, {
    invalidFirstProviderContractId: true,
    skipChainMatch: true,
  });
  await openFlow(page);

  const chartRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/options/chart-bars";
  });

  await page.getByTestId("flow-tape-row").first().click();
  const request = await chartRequest;
  const url = new URL(request.url());
  expect(url.searchParams.has("providerContractId")).toBe(false);
  await expectChartCanvasDrawn(page, "flow-inspection-option-chart");
});

test("Flow inspection does not call the legacy option bars route when shared chart lookup fails", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page, {
    invalidFirstProviderContractId: true,
    resolveContractFailure: true,
    skipChainMatch: true,
  });
  await openFlow(page);

  const legacyOptionBarsRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/bars" &&
      url.searchParams.get("assetClass") === "option"
    ) {
      legacyOptionBarsRequests.push(url.toString());
    }
  });
  const chartRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/options/chart-bars";
  });

  await page.getByTestId("flow-tape-row").first().click();
  await chartRequest;
  await expect(page.getByText("Option contract lookup unavailable")).toBeVisible();
  expect(legacyOptionBarsRequests).toHaveLength(0);
});

test("Flow inspection keeps the chart frame visible for empty option history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockFlowApi(page, { emptyOptionBars: true });
  await openFlow(page);

  await page.getByTestId("flow-tape-row").first().click();
  await expect(page.getByText("No option trades in this window")).toBeVisible();
  await expect(page.getByTestId("flow-inspection-option-chart")).toBeVisible();
  await expect(page.getByTestId("flow-inspection-option-chart-surface")).toBeVisible();
});

test("Flow mobile renders row cards with filter overlay, column drawer, copy, and pin actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockFlowApi(page);
  await openFlow(page);

  await expect(page.getByTestId("flow-filter-panel")).toBeHidden();
  await expect(page.getByTestId("flow-mobile-card-list")).toBeVisible();
  const firstCard = page.getByTestId("flow-row-card").first();
  await expect(firstCard).toBeVisible();

  await page.getByTestId("flow-filter-toggle").click();
  await expect(page.getByTestId("flow-filter-panel")).toBeVisible();
  await page.getByTestId("flow-filter-toggle").click();
  await expect(page.getByTestId("flow-filter-panel")).toBeHidden();

  await page.getByTestId("flow-column-toggle").click();
  await expect(page.getByTestId("flow-column-drawer")).toBeVisible();
  await page.getByTestId("flow-column-toggle").click();

  await firstCard.getByLabel("Copy flow contract").click();
  await expect(firstCard.getByLabel("Copy flow contract")).toHaveAttribute(
    "title",
    "Copied",
  );

  await firstCard.getByLabel("Pin flow row").click();
  await expect(page.getByTestId("flow-pinned-row")).toBeVisible();

  await firstCard.click();
  await expect(page.getByTestId("flow-contract-drawer")).toHaveCount(0);
  await expect(page.getByTestId("flow-inline-execution-quality")).toBeVisible();
  await expect(page.getByTestId("flow-mobile-fill-spread").first()).toBeVisible();
  const detailAboveCards = await page.evaluate(() => {
    const detail = document.querySelector(
      '[data-testid="flow-inline-execution-quality"]',
    );
    const cards = document.querySelector('[data-testid="flow-mobile-card-list"]');
    if (!detail || !cards) return false;
    return detail.getBoundingClientRect().bottom <= cards.getBoundingClientRect().top;
  });
  expect(detailAboveCards).toBe(true);
  await expectNoDocumentOverflow(page);
});

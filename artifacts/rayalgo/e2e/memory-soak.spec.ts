import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

const enabled = process.env.RAYALGO_MEMORY_SOAK === "1";
const useLiveApi = process.env.RAYALGO_MEMORY_SOAK_LIVE_API === "1";
const soakMinutes = Math.max(
  1,
  Number.parseFloat(process.env.RAYALGO_MEMORY_SOAK_MINUTES || "3"),
);
const soakMs = Math.round(soakMinutes * 60_000);
const sampleEveryCycles = Math.max(
  1,
  Number.parseInt(process.env.RAYALGO_MEMORY_SOAK_SAMPLE_EVERY || "3", 10),
);

test.skip(!enabled, "Set RAYALGO_MEMORY_SOAK=1 to run the memory soak.");
test.setTimeout(soakMs + 120_000);

const symbols = ["SPY", "QQQ", "IWM", "VIXY", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN"];
const expirations = ["2026-05-01", "2026-05-08", "2026-05-15"];
const basePrices: Record<string, number> = Object.fromEntries(
  symbols.map((symbol, index) => [symbol, 100 + index * 23]),
);
const runtimeIssueLogByPage = new WeakMap<Page, string[]>();

test.afterEach(async ({ page }, testInfo) => {
  const runtimeIssues = runtimeIssueLogByPage.get(page) ?? [];

  await testInfo.attach("runtime-console-and-page-errors.json", {
    body: JSON.stringify(runtimeIssues, null, 2),
    contentType: "application/json",
  });

  const memoryDiagnostics = await page
    .evaluate(() => {
      const diagnosticsWindow = window as Window & {
        __RAYALGO_MEMORY_DIAGNOSTICS__?: () => unknown;
      };
      return typeof diagnosticsWindow.__RAYALGO_MEMORY_DIAGNOSTICS__ ===
        "function"
        ? diagnosticsWindow.__RAYALGO_MEMORY_DIAGNOSTICS__()
        : null;
    })
    .catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));

  await testInfo.attach("rayalgo-memory-diagnostics.json", {
    body: JSON.stringify(memoryDiagnostics, null, 2),
    contentType: "application/json",
  });

  if (useLiveApi) {
    const apiDiagnostics = await page
      .request.get("/api/diagnostics/latest", { timeout: 10_000 })
      .then(async (response) => ({
        status: response.status(),
        body: await response.json().catch(async () => response.text()),
      }))
      .catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      }));
    const apiEvents = await page
      .request.get("/api/diagnostics/events?limit=20", { timeout: 10_000 })
      .then(async (response) => ({
        status: response.status(),
        body: await response.json().catch(async () => response.text()),
      }))
      .catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      }));

    await testInfo.attach("rayalgo-api-diagnostics.json", {
      body: JSON.stringify({ latest: apiDiagnostics, events: apiEvents }, null, 2),
      contentType: "application/json",
    });
  }
});

function isIgnorableConsoleMessage(message: ConsoleMessage) {
  const text = message.text();
  return (
    text.includes("AudioContext was not allowed to start") ||
    text.includes("appearance") ||
    text.includes("slider-vertical")
  );
}

function makeBars(symbol: string, count = 140, minutes = 15) {
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const base = basePrices[symbol] ?? 100;

  return Array.from({ length: count }, (_, index) => {
    const close = base + Math.sin(index / 5) * 2.1 + index * 0.015;
    const open = close - Math.cos(index / 4) * 0.7;
    return {
      timestamp: new Date(now - (count - 1 - index) * minutes * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 120_000 + index * 1_750,
      source: symbol.includes("-") ? "mock-option" : "mock",
    };
  });
}

function makeFlowEvents(symbol: string) {
  const now = Date.now();
  const base = basePrices[symbol] ?? 100;
  const putDominant = ["QQQ", "IWM", "TSLA"].includes(symbol);
  return Array.from({ length: 4 }, (_, index) => ({
    id: `${symbol}-flow-${index}`,
    provider: "ibkr",
    basis: "snapshot",
    underlying: symbol,
    optionTicker: `${symbol}-${index}`,
    right: putDominant ? "put" : "call",
    strike: Math.round(base + (index - 1) * 2),
    expirationDate: new Date(now + (index + 2) * 86_400_000).toISOString(),
    occurredAt: new Date(now - index * 9 * 60_000).toISOString(),
    side: index % 3 === 0 ? "buy" : "mid",
    sentiment: putDominant ? "bearish" : "bullish",
    premium: 125_000 + index * 95_000,
    size: 10 + index * 4,
    openInterest: 100 + index * 40,
    impliedVolatility: 0.24 + index * 0.015,
    isUnusual: index % 2 === 0,
    unusualScore: index % 2 === 0 ? 2.5 + index * 0.4 : 0,
    tradeConditions: index % 2 === 0 ? ["sweep"] : [],
  }));
}

function makeOptionContracts(expirationDate: string) {
  const expirationIndex = Math.max(0, expirations.indexOf(expirationDate));
  const strikes = [490, 495, 500, 505, 510].map(
    (strike) => strike + expirationIndex * 5,
  );

  return strikes.flatMap((strike) =>
    (["call", "put"] as const).map((right) => {
      const cp = right === "call" ? "C" : "P";
      const distance = Math.abs(strike - 500);
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

async function mockPlatformApi(page: Page) {
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
            items: symbols.map((symbol, index) => ({
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
      const requested = (url.searchParams.get("symbols") || "SPY")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol, index) => {
          const price = basePrices[symbol] ?? 100 + index;
          const prevClose = price - (index % 2 ? -1.2 : 1.2);
          return {
            symbol,
            price,
            prevClose,
            change: price - prevClose,
            changePercent: ((price - prevClose) / prevClose) * 100,
            open: price - 1,
            high: price + 2,
            low: price - 2,
            volume: 40_000_000 + index * 1_000_000,
            delayed: false,
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    } else if (url.pathname === "/api/bars") {
      const symbol = (url.searchParams.get("symbol") || "SPY").toUpperCase();
      const assetClass = url.searchParams.get("assetClass");
      body = { bars: makeBars(symbol, assetClass === "option" ? 90 : 140, assetClass === "option" ? 1 : 15) };
    } else if (url.pathname === "/api/flow/events") {
      const symbol = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      body = {
        events: makeFlowEvents(symbol),
        source: {
          provider: "ibkr",
          status: "live",
          fallbackUsed: false,
        },
      };
    } else if (url.pathname === "/api/options/expirations") {
      body = {
        underlying: "SPY",
        expirations: expirations.map((expirationDate) => ({ expirationDate })),
      };
    } else if (url.pathname === "/api/options/chains") {
      const expirationDate = url.searchParams.get("expirationDate") || expirations[0];
      body = {
        underlying: "SPY",
        expirationDate,
        contracts: makeOptionContracts(expirationDate),
      };
    } else if (url.pathname === "/api/options/chains/batch") {
      const requestBody = route.request().postDataJSON() as {
        expirationDates?: string[];
      };
      body = {
        underlying: "SPY",
        results: (requestBody.expirationDates || []).map((expirationDate) => ({
          expirationDate,
          status: "loaded",
          contracts: makeOptionContracts(expirationDate),
        })),
      };
    } else if (url.pathname === "/api/positions") {
      body = { positions: [] };
    } else if (url.pathname === "/api/accounts") {
      body = { accounts: [] };
    } else if (url.pathname === "/api/orders") {
      body = { orders: [] };
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

async function collectMemorySample(page: Page, label: string) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("HeapProfiler.enable");
    await session.send("HeapProfiler.collectGarbage");
    const [heap, dom, diagnostics] = await Promise.all([
      session.send("Runtime.getHeapUsage"),
      session.send("Memory.getDOMCounters"),
      page
        .evaluate(() => {
          const diagnosticsWindow = window as Window & {
            __RAYALGO_MEMORY_DIAGNOSTICS__?: () => unknown;
          };
          return typeof diagnosticsWindow.__RAYALGO_MEMORY_DIAGNOSTICS__ ===
            "function"
            ? diagnosticsWindow.__RAYALGO_MEMORY_DIAGNOSTICS__()
            : null;
        })
        .catch(() => null),
    ]);
    return {
      label,
      usedHeapMb: Math.round((heap.usedSize / 1024 / 1024) * 10) / 10,
      totalHeapMb: Math.round((heap.totalSize / 1024 / 1024) * 10) / 10,
      documents: dom.documents,
      nodes: dom.nodes,
      jsEventListeners: dom.jsEventListeners,
      diagnostics,
    };
  } finally {
    await session.detach();
  }
}

async function switchScreen(page: Page, label: "Market" | "Trade" | "Flow") {
  await page.getByRole("button", { name: label, exact: true }).click();
  if (label === "Market") {
    await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("market-chart-grid")).toBeVisible();
  } else if (label === "Trade") {
    await expect(page.getByTestId("trade-top-zone")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
  } else {
    await expect(page.getByTestId("screen-host-flow")).toBeVisible({ timeout: 30_000 });
  }
}

test("keeps heap and DOM bounded while cycling Market, Trade, and Flow", async ({
  page,
}) => {
  const runtimeIssues: string[] = [];
  let crashed = false;
  page.on("pageerror", (error) => runtimeIssues.push(error.message));
  page.on("crash", () => {
    crashed = true;
    runtimeIssues.push("page crashed");
  });
  page.on("console", (message) => {
    if (
      (message.type() === "error" || message.type() === "warning") &&
      !isIgnorableConsoleMessage(message)
    ) {
      runtimeIssues.push(message.text());
    }
  });
  runtimeIssueLogByPage.set(page, runtimeIssues);

  if (!useLiveApi) {
    await mockPlatformApi(page);
  }

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
        marketGridLayout: "3x3",
        marketGridSlots: gridSymbols.map((ticker: string) => ({
          ticker,
          tf: "15m",
          studies: ["ema21", "vwap", "rayReplica"],
        })),
        tradeActiveTicker: "SPY",
        tradeContracts: {
          SPY: { strike: 500, cp: "C", exp: "" },
        },
      }),
    );
  }, symbols);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
  await switchScreen(page, "Trade");
  await switchScreen(page, "Flow");
  await switchScreen(page, "Market");
  await page.waitForTimeout(1_000);

  const baseline = await collectMemorySample(page, "baseline");
  const samples = [baseline];
  const deadline = Date.now() + soakMs;
  let cycle = 0;

  while (Date.now() < deadline) {
    cycle += 1;
    await switchScreen(page, "Trade");
    await page.waitForTimeout(250);
    await switchScreen(page, "Flow");
    await page.waitForTimeout(250);
    await switchScreen(page, "Market");
    await page.waitForTimeout(250);

    if (cycle % sampleEveryCycles === 0 || Date.now() >= deadline) {
      samples.push(await collectMemorySample(page, `cycle-${cycle}`));
    }
  }

  const finalSample = await collectMemorySample(page, "final");
  samples.push(finalSample);
  const peakHeapMb = Math.max(...samples.map((sample) => sample.usedHeapMb));
  const peakNodes = Math.max(...samples.map((sample) => sample.nodes));
  const finalChartScopes =
    (finalSample.diagnostics as {
      chartHydration?: {
        scopes?: Array<{
          scope?: string;
          hydratedBaseCount?: number;
          renderedBarCount?: number;
        }>;
      };
    } | null)?.chartHydration?.scopes ?? [];
  const truncatedHydrationScopes = finalChartScopes.filter(
    (scope) =>
      Number.isFinite(scope.hydratedBaseCount) &&
      Number.isFinite(scope.renderedBarCount) &&
      (scope.renderedBarCount as number) < (scope.hydratedBaseCount as number),
  );

  console.log(
    JSON.stringify(
      {
        mode: useLiveApi ? "live-api" : "mock-api",
        soakMinutes,
        cycles: cycle,
        baseline,
        final: finalSample,
        peakHeapMb,
        peakNodes,
        sampleCount: samples.length,
        lastSamples: samples.slice(-5),
      },
      null,
      2,
    ),
  );

  expect(crashed, "Chrome page should not crash during soak").toBe(false);
  expect(runtimeIssues, "Runtime console/page errors should not occur").toEqual([]);
  expect(finalSample.usedHeapMb, "final heap should remain bounded after GC").toBeLessThanOrEqual(
    Math.max(baseline.usedHeapMb + 35, baseline.usedHeapMb * 1.75),
  );
  expect(peakHeapMb, "peak heap should remain bounded after repeated screen cycling").toBeLessThanOrEqual(
    Math.max(baseline.usedHeapMb + 80, baseline.usedHeapMb * 2.5),
  );
  expect(finalSample.nodes, "final DOM nodes should remain bounded after GC").toBeLessThanOrEqual(
    baseline.nodes + 3_500,
  );
  expect(peakNodes, "peak DOM nodes should remain bounded during screen cycling").toBeLessThanOrEqual(
    baseline.nodes + 10_000,
  );
  expect(
    truncatedHydrationScopes,
    "chart caps should not shrink rendered bars below hydrated bars",
  ).toEqual([]);
});

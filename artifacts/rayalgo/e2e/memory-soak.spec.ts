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
const STREAM_STALE_WARNING_MS = 10_000;
const STOCK_AGGREGATE_STALE_WARNING_MS = 20_000;

test.skip(!enabled, "Set RAYALGO_MEMORY_SOAK=1 to run the memory soak.");
test.setTimeout(soakMs + 120_000);

const symbols = ["SPY", "QQQ", "IWM", "VIXY", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN"];
const expirations = ["2026-05-01", "2026-05-08", "2026-05-15"];
const basePrices: Record<string, number> = Object.fromEntries(
  symbols.map((symbol, index) => [symbol, 100 + index * 23]),
);
const runtimeIssueLogByPage = new WeakMap<Page, string[]>();
const soakSummaryByPage = new WeakMap<Page, unknown>();
const liveDiagnosticsByPage = new WeakMap<Page, unknown>();
const failedRequestLogByPage = new WeakMap<Page, unknown[]>();

test.afterEach(async ({ page }, testInfo) => {
  const runtimeIssues = runtimeIssueLogByPage.get(page) ?? [];
  const soakSummary = soakSummaryByPage.get(page) ?? null;
  const liveDiagnostics = liveDiagnosticsByPage.get(page) ?? null;
  const failedRequests = failedRequestLogByPage.get(page) ?? [];

  await testInfo.attach("runtime-console-and-page-errors.json", {
    body: JSON.stringify(runtimeIssues, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("runtime-failed-requests.json", {
    body: JSON.stringify(failedRequests, null, 2),
    contentType: "application/json",
  });

  if (soakSummary) {
    await testInfo.attach("rayalgo-soak-summary.json", {
      body: JSON.stringify(soakSummary, null, 2),
      contentType: "application/json",
    });
  }

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
    await testInfo.attach("rayalgo-live-diagnostics.json", {
      body: JSON.stringify(liveDiagnostics, null, 2),
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
  await page.route("**/*tradingview.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "",
    });
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const nowIso = new Date().toISOString();
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
              addedAt: nowIso,
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
            updatedAt: nowIso,
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
    } else if (url.pathname === "/api/options/chart-bars") {
      const underlying = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      const expirationDate = url.searchParams.get("expirationDate") || expirations[0];
      const strike = Number(url.searchParams.get("strike") || "500");
      const right = (url.searchParams.get("right") || "call").toLowerCase() === "put" ? "put" : "call";
      const providerContractId = url.searchParams.get("providerContractId") || `${expirationDate}-${strike}-${right === "call" ? "C" : "P"}`;
      body = {
        symbol: `${underlying}-${expirationDate}-${strike}-${right === "call" ? "C" : "P"}`,
        underlying,
        expirationDate,
        strike,
        right,
        optionTicker: null,
        contract: {
          ticker: `${underlying}-${expirationDate}-${strike}-${right === "call" ? "C" : "P"}`,
          underlying,
          expirationDate,
          strike,
          right,
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId,
        },
        providerContractId,
        resolutionSource: "provided",
        dataSource: "ibkr-history",
        feedIssue: false,
        timeframe: url.searchParams.get("timeframe") || "1m",
        bars: makeBars(`${underlying}-${right}`, 90, 1).map((bar) => ({
          ...bar,
          providerContractId,
          transport: "mock",
          delayed: false,
          freshness: "live",
          marketDataMode: "live",
          dataUpdatedAt: nowIso,
          ageMs: 0,
        })),
        transport: "mock",
        delayed: false,
        gapFilled: false,
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: nowIso,
        ageMs: 0,
        emptyReason: null,
        historySource: "mock",
        studyFallback: false,
        historyPage: null,
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: 90,
          returnedCount: 90,
          bridgeChunks: 1,
          providerMode: "live",
          liveMarketDataAvailable: true,
          missingProviderContractIds: [],
          complete: true,
          capped: false,
          stale: false,
        },
      };
    } else if (url.pathname === "/api/positions") {
      body = { positions: [] };
    } else if (url.pathname === "/api/accounts/flex/health") {
      body = {
        bridgeConnected: false,
        flexConfigured: false,
        flexTokenPresent: false,
        flexQueryIdPresent: false,
        schemaReady: false,
        missingTables: [],
        schemaError: null,
        lastSuccessfulRefreshAt: null,
        lastAttemptAt: null,
        lastStatus: null,
        lastError: null,
        snapshotsRecording: false,
        lastSnapshotAt: null,
        snapshotCoverageStartAt: null,
        snapshotCoverageEndAt: null,
        snapshotPointCount: 0,
        flexNavCoverageStartDate: null,
        flexNavCoverageEndDate: null,
        flexNavRowCount: 0,
      };
    } else if (url.pathname === "/api/accounts/shadow/positions") {
      body = {
        accountId: "shadow",
        currency: "USD",
        positions: [],
        totals: {},
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/summary") {
      body = {
        accountId: "combined",
        isCombined: true,
        mode: "paper",
        currency: "USD",
        accounts: [],
        updatedAt: nowIso,
        fx: {
          baseCurrency: "USD",
          timestamp: null,
          rates: {},
          warning: null,
        },
        badges: {},
        metrics: {},
      };
    } else if (url.pathname === "/api/accounts/combined/equity-history") {
      body = {
        accountId: "combined",
        range: "1M",
        currency: "USD",
        flexConfigured: false,
        lastFlexRefreshAt: null,
        benchmark: url.searchParams.get("benchmark"),
        asOf: null,
        latestSnapshotAt: null,
        isStale: false,
        staleReason: null,
        terminalPointSource: null,
        liveTerminalIncluded: false,
        points: [],
        events: [],
      };
    } else if (url.pathname === "/api/accounts/combined/allocation") {
      body = {
        accountId: "combined",
        currency: "USD",
        assetClass: [],
        sector: [],
        exposure: {
          grossLong: 0,
          grossShort: 0,
          netExposure: 0,
        },
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/positions") {
      body = {
        accountId: "combined",
        currency: "USD",
        positions: [],
        totals: {},
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/positions-at-date") {
      body = {
        accountId: "combined",
        date: nowIso,
        currency: "USD",
        status: "unavailable",
        snapshotDate: null,
        message: null,
        positions: [],
        activity: [],
        totals: {},
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/closed-trades") {
      body = {
        accountId: "combined",
        currency: "USD",
        trades: [],
        summary: {},
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/orders") {
      body = {
        accountId: "combined",
        tab: "working",
        currency: "USD",
        orders: [],
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/risk") {
      body = {
        accountId: "combined",
        currency: "USD",
        concentration: {},
        winnersLosers: {},
        margin: {},
        greeks: {},
        expiryConcentration: {},
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/cash-activity") {
      body = {
        accountId: "combined",
        currency: "USD",
        settledCash: null,
        unsettledCash: null,
        totalCash: null,
        dividendsMonth: 0,
        dividendsYtd: 0,
        interestPaidEarnedYtd: 0,
        feesYtd: 0,
        activities: [],
        dividends: [],
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/accounts/combined/trading-patterns") {
      body = {
        snapshot: { persisted: false },
        context: {},
        summary: {},
        tickerStats: [],
        sourceStats: [],
        timeStats: {},
        equityAnnotations: [],
        tradeEvents: [],
        roundTrips: [],
        openLots: [],
        anomalies: [],
        fullPacketIncluded: false,
      };
    } else if (url.pathname === "/api/accounts") {
      body = { accounts: [] };
    } else if (url.pathname === "/api/orders") {
      body = { orders: [] };
    } else if (url.pathname === "/api/executions") {
      body = { executions: [] };
    } else if (url.pathname === "/api/market-depth") {
      body = {
        depth: {
          levels: [],
          updatedAt: nowIso,
        },
      };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/flow/universe") {
      body = {
        coverage: {
          mode: "watchlist",
          targetSize: symbols.length,
          activeTargetSize: symbols.length,
          selectedSymbols: symbols.length,
          selectedShortfall: 0,
          rankedAt: nowIso,
          lastRefreshAt: nowIso,
          lastGoodAt: nowIso,
          stale: false,
          fallbackUsed: false,
          cooldownCount: 0,
          scannedSymbols: symbols.length,
          cycleScannedSymbols: symbols.length,
          currentBatch: symbols.slice(0, 4),
          lastScanAt: nowIso,
          degradedReason: null,
          radarSelectedSymbols: 0,
          radarEstimatedCycleMs: 0,
          radarBatchSize: 0,
          radarIntervalMs: 0,
          promotedSymbols: [],
        },
        symbols,
        sources: {
          builtInSymbols: [],
          flowUniverseSymbols: symbols,
        },
      };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/universe/tickers") {
      body = { count: 0, results: [] };
    } else if (url.pathname === "/api/backtests/drafts") {
      body = { drafts: [] };
    } else if (url.pathname === "/api/algo/deployments") {
      body = { deployments: [] };
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
        createdAt: nowIso,
        updatedAt: nowIso,
      };
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

async function readJsonResponse(page: Page, path: string) {
  try {
    const response = await page.request.get(path, { timeout: 10_000 });
    const body = await response.json().catch(async () => response.text());
    return {
      ok: response.ok(),
      status: response.status(),
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      body: null,
    };
  }
}

function findDiagnosticsSnapshot(payload: any, subsystem: string) {
  const snapshots = Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  return snapshots.find((entry) => entry?.subsystem === subsystem) ?? null;
}

function normalizeIssueSet(issues: string[]) {
  return [...new Set(issues.filter(Boolean))].sort();
}

async function collectLiveSoakSample(page: Page, label: string) {
  if (!useLiveApi) {
    return null;
  }

  const [runtimeResponse, latestResponse, eventsResponse, ui] = await Promise.all([
    readJsonResponse(page, "/api/diagnostics/runtime"),
    readJsonResponse(page, "/api/diagnostics/latest"),
    readJsonResponse(page, "/api/diagnostics/events?limit=20"),
    page
      .evaluate(() => {
        const readText = (selector: string) =>
          document.querySelector(selector)?.textContent
            ?.replace(/\s+/g, " ")
            .trim()
            .slice(0, 400) ?? null;
        return {
          marketVisible: Boolean(document.querySelector('[data-testid="market-workspace"]')),
          tradeVisible: Boolean(document.querySelector('[data-testid="trade-top-zone"]')),
          flowVisible: Boolean(document.querySelector('[data-testid="screen-host-flow"]')),
          flowScannerStatusText: readText('[data-testid="flow-scanner-status-panel"]'),
        };
      })
      .catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  const appCodeIssues: string[] = [];
  const streamingRuntimeIssues: string[] = [];
  const runtime = runtimeResponse.body;
  const latest = latestResponse.body;
  const ibkrSnapshot = findDiagnosticsSnapshot(latest, "ibkr");
  const marketDataSnapshot = findDiagnosticsSnapshot(latest, "market-data");
  const apiSnapshot = findDiagnosticsSnapshot(latest, "api");
  const ibkr = runtime?.ibkr ?? null;
  const streams = ibkr?.streams ?? {};
  const bridgeQuote = streams.bridgeQuote ?? {};
  const stockAggregates = streams.stockAggregates ?? {};
  const marketDataAdmission = streams.marketDataAdmission ?? {};
  const optionsFlowScanner = marketDataAdmission?.optionsFlowScanner ?? {};
  const deepScanner = optionsFlowScanner?.deepScanner ?? {};

  if (!runtimeResponse.ok) {
    streamingRuntimeIssues.push(
      `runtime diagnostics request failed (${runtimeResponse.status ?? "no-status"}${runtimeResponse.error ? `: ${runtimeResponse.error}` : ""})`,
    );
  }
  if (!latestResponse.ok) {
    streamingRuntimeIssues.push(
      `latest diagnostics request failed (${latestResponse.status ?? "no-status"}${latestResponse.error ? `: ${latestResponse.error}` : ""})`,
    );
  }
  if (!eventsResponse.ok) {
    streamingRuntimeIssues.push(
      `diagnostics events request failed (${eventsResponse.status ?? "no-status"}${eventsResponse.error ? `: ${eventsResponse.error}` : ""})`,
    );
  }
  if (apiSnapshot?.status && apiSnapshot.status !== "ok") {
    appCodeIssues.push(`api diagnostics status is ${apiSnapshot.status}`);
  }
  if (ibkr?.connected === false) {
    streamingRuntimeIssues.push("IBKR runtime reports disconnected");
  }
  if (ibkr?.authenticated === false) {
    streamingRuntimeIssues.push("IBKR runtime reports unauthenticated session");
  }
  if (ibkr?.strictReady === false) {
    streamingRuntimeIssues.push(
      `IBKR strict readiness is false (${ibkr?.strictReason || "unknown"})`,
    );
  }
  if (typeof ibkr?.marketDataMode === "string" && ibkr.marketDataMode !== "live") {
    streamingRuntimeIssues.push(`market data mode is ${ibkr.marketDataMode}`);
  }
  if (
    Number.isFinite(Number(ibkrSnapshot?.metrics?.heartbeatAgeMs)) &&
    Number(ibkrSnapshot.metrics.heartbeatAgeMs) >= 30_000
  ) {
    streamingRuntimeIssues.push(
      `IBKR heartbeat age is ${Math.round(Number(ibkrSnapshot.metrics.heartbeatAgeMs))}ms`,
    );
  }
  if (
    Number.isFinite(Number(bridgeQuote?.freshnessAgeMs)) &&
    Number(bridgeQuote.freshnessAgeMs) >= STREAM_STALE_WARNING_MS
  ) {
    streamingRuntimeIssues.push(
      `quote stream freshness age is ${Math.round(Number(bridgeQuote.freshnessAgeMs))}ms`,
    );
  }
  if (
    Number.isFinite(Number(bridgeQuote?.lastEventAgeMs)) &&
    Number(bridgeQuote.lastEventAgeMs) >= STREAM_STALE_WARNING_MS
  ) {
    streamingRuntimeIssues.push(
      `quote stream last event age is ${Math.round(Number(bridgeQuote.lastEventAgeMs))}ms`,
    );
  }
  if (Number.isFinite(Number(bridgeQuote?.recentGapCount)) && Number(bridgeQuote.recentGapCount) > 0) {
    streamingRuntimeIssues.push(
      `quote stream observed ${Number(bridgeQuote.recentGapCount)} recent gaps`,
    );
  }
  if (
    Number.isFinite(Number(stockAggregates?.activeConsumerCount)) &&
    Number(stockAggregates.activeConsumerCount) > 0 &&
    Number.isFinite(Number(stockAggregates?.lastAggregateAgeMs)) &&
    Number(stockAggregates.lastAggregateAgeMs) >= STOCK_AGGREGATE_STALE_WARNING_MS
  ) {
    streamingRuntimeIssues.push(
      `stock aggregate age is ${Math.round(Number(stockAggregates.lastAggregateAgeMs))}ms`,
    );
  }
  if (Number.isFinite(Number(stockAggregates?.gapCount)) && Number(stockAggregates.gapCount) > 0) {
    streamingRuntimeIssues.push(
      `stock aggregates observed ${Number(stockAggregates.gapCount)} gaps`,
    );
  }
  if (
    Number.isFinite(Number(marketDataAdmission?.flowScannerRemainingLineCount)) &&
    Number(marketDataAdmission.flowScannerRemainingLineCount) <= 0 &&
    Number.isFinite(Number(deepScanner?.queuedCount)) &&
    Number(deepScanner.queuedCount) > 0
  ) {
    streamingRuntimeIssues.push(
      `flow scanner exhausted its line budget with ${Number(deepScanner.queuedCount)} queued`,
    );
  }
  if (
    Number.isFinite(Number(marketDataAdmission?.accountMonitorRemainingLineCount)) &&
    Number(marketDataAdmission.accountMonitorRemainingLineCount) <= 0
  ) {
    streamingRuntimeIssues.push("account monitor exhausted its line budget");
  }
  if (marketDataSnapshot?.status && marketDataSnapshot.status !== "ok") {
    streamingRuntimeIssues.push(`market-data diagnostics status is ${marketDataSnapshot.status}`);
  }
  if (
    Number.isFinite(Number(marketDataSnapshot?.metrics?.freshness_age_ms)) &&
    Number(marketDataSnapshot.metrics.freshness_age_ms) >= STREAM_STALE_WARNING_MS
  ) {
    streamingRuntimeIssues.push(
      `market-data freshness age is ${Math.round(Number(marketDataSnapshot.metrics.freshness_age_ms))}ms`,
    );
  }
  if (
    typeof marketDataSnapshot?.metrics?.lastError === "string" &&
    marketDataSnapshot.metrics.lastError.trim()
  ) {
    streamingRuntimeIssues.push(`market-data last error: ${marketDataSnapshot.metrics.lastError}`);
  }

  return {
    label,
    collectedAt: new Date().toISOString(),
    appCodeIssues: normalizeIssueSet(appCodeIssues),
    streamingRuntimeIssues: normalizeIssueSet(streamingRuntimeIssues),
    ui,
    runtimeResponse,
    latestResponse,
    eventsResponse,
    runtimeSummary: {
      connected: ibkr?.connected ?? null,
      authenticated: ibkr?.authenticated ?? null,
      strictReady: ibkr?.strictReady ?? null,
      strictReason: ibkr?.strictReason ?? null,
      marketDataMode: ibkr?.marketDataMode ?? null,
      streamState: ibkr?.streamState ?? null,
      streamFresh: ibkr?.streamFresh ?? null,
      quoteFreshnessAgeMs: bridgeQuote?.freshnessAgeMs ?? null,
      quoteLastEventAgeMs: bridgeQuote?.lastEventAgeMs ?? null,
      quoteRecentGapCount: bridgeQuote?.recentGapCount ?? null,
      stockAggregateAgeMs: stockAggregates?.lastAggregateAgeMs ?? null,
      stockAggregateGapCount: stockAggregates?.gapCount ?? null,
      accountMonitorLineCount: marketDataAdmission?.accountMonitorLineCount ?? null,
      accountMonitorRemainingLineCount:
        marketDataAdmission?.accountMonitorRemainingLineCount ?? null,
      flowScannerLineCount: marketDataAdmission?.flowScannerLineCount ?? null,
      flowScannerRemainingLineCount:
        marketDataAdmission?.flowScannerRemainingLineCount ?? null,
      ibkrHeartbeatAgeMs: ibkrSnapshot?.metrics?.heartbeatAgeMs ?? null,
      marketDataFreshnessAgeMs: marketDataSnapshot?.metrics?.freshness_age_ms ?? null,
      marketDataStatus: marketDataSnapshot?.status ?? null,
    },
  };
}

test("keeps heap and DOM bounded while cycling Market, Trade, and Flow", async ({
  page,
}) => {
  const runtimeIssues: string[] = [];
  const appCodeIssues: string[] = [];
  const streamingRuntimeIssues: string[] = [];
  const failedRequests: Array<Record<string, unknown>> = [];
  let crashed = false;
  page.on("pageerror", (error) =>
    runtimeIssues.push(error.stack || error.message),
  );
  page.on("crash", () => {
    crashed = true;
    runtimeIssues.push("page crashed");
  });
  page.on("console", (message) => {
    if (
      (message.type() === "error" || message.type() === "warning") &&
      !isIgnorableConsoleMessage(message)
    ) {
      const location = message.location();
      const locationUrl = location?.url ? ` (${location.url})` : "";
      runtimeIssues.push(`${message.text()}${locationUrl}`);
    }
  });
  page.on("response", async (response) => {
    if (response.status() < 500) {
      return;
    }
    const request = response.request();
    let bodySnippet: string | null = null;
    try {
      const body = await response.text();
      bodySnippet = body.slice(0, 500);
    } catch {
      bodySnippet = null;
    }
    failedRequests.push({
      type: "response",
      method: request.method(),
      url: response.url(),
      status: response.status(),
      bodySnippet,
    });
  });
  page.on("requestfailed", (request) => {
    failedRequests.push({
      type: "requestfailed",
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? null,
    });
  });
  runtimeIssueLogByPage.set(page, runtimeIssues);
  failedRequestLogByPage.set(page, failedRequests);

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
  const liveSamples = [];
  if (useLiveApi) {
    const baselineLiveSample = await collectLiveSoakSample(page, "baseline");
    if (baselineLiveSample) {
      liveSamples.push(baselineLiveSample);
      appCodeIssues.push(...baselineLiveSample.appCodeIssues);
      streamingRuntimeIssues.push(...baselineLiveSample.streamingRuntimeIssues);
      expect(
        baselineLiveSample.runtimeResponse.ok && baselineLiveSample.latestResponse.ok,
        "live soak requires reachable runtime diagnostics endpoints",
      ).toBe(true);
    }
  }
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
      if (useLiveApi) {
        const liveSample = await collectLiveSoakSample(page, `cycle-${cycle}`);
        if (liveSample) {
          liveSamples.push(liveSample);
          appCodeIssues.push(...liveSample.appCodeIssues);
          streamingRuntimeIssues.push(...liveSample.streamingRuntimeIssues);
        }
      }
    }
  }

  const finalSample = await collectMemorySample(page, "final");
  samples.push(finalSample);
  if (useLiveApi) {
    const finalLiveSample = await collectLiveSoakSample(page, "final");
    if (finalLiveSample) {
      liveSamples.push(finalLiveSample);
      appCodeIssues.push(...finalLiveSample.appCodeIssues);
      streamingRuntimeIssues.push(...finalLiveSample.streamingRuntimeIssues);
    }
  }
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
  const summary = {
    mode: useLiveApi ? "live-api" : "mock-api",
    soakMinutes,
    cycles: cycle,
    baseline,
    final: finalSample,
    peakHeapMb,
    peakNodes,
    sampleCount: samples.length,
    liveSampleCount: liveSamples.length,
    issueBuckets: {
      appCode: normalizeIssueSet([...runtimeIssues, ...appCodeIssues]),
      streamingRuntime: normalizeIssueSet(streamingRuntimeIssues),
    },
    failedRequests,
    lastSamples: samples.slice(-5),
    lastLiveSamples: liveSamples.slice(-5),
  };
  soakSummaryByPage.set(page, summary);
  if (useLiveApi) {
    liveDiagnosticsByPage.set(page, {
      liveSamples,
      latest: liveSamples.at(-1) ?? null,
    });
  }

  expect(crashed, "Chrome page should not crash during soak").toBe(false);
  expect(runtimeIssues, "Runtime console/page errors should not occur").toEqual([]);
  expect(
    normalizeIssueSet(appCodeIssues),
    "App/code soak issues should remain empty",
  ).toEqual([]);
  expect(
    normalizeIssueSet(streamingRuntimeIssues),
    "Streaming/runtime soak issues should remain empty",
  ).toEqual([]);
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

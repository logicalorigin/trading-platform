import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const symbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"];
const mockNow = Date.parse("2026-05-01T16:00:00.000Z");
const spotChartIntervals = [
  "5s",
  "15s",
  "30s",
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

const spotApiTimeframeByInterval: Record<(typeof spotChartIntervals)[number], string> = {
  "5s": "5s",
  "15s": "5s",
  "30s": "5s",
  "1m": "1m",
  "2m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "15m",
  "1h": "1h",
  "4h": "1h",
  "1d": "1d",
};

type MockMarketDataAdmission = {
  activeLineCount: number;
  flowScannerLineCount: number;
  budget: {
    maxLines: number;
    flowScannerLineCap: number;
  };
  poolUsage: Record<string, Record<string, unknown>>;
  counters?: Record<string, Record<string, number>>;
};

async function disableStreamingSources(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        window.setTimeout(() => {
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: MockEventSource,
    });
  });
}

function timeframeStepMs(timeframe: string | null) {
  switch (timeframe) {
    case "5s":
      return 5_000;
    case "15s":
      return 15_000;
    case "30s":
      return 30_000;
    case "1m":
      return 60_000;
    case "2m":
      return 2 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "30m":
      return 30 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    default:
      return 5 * 60_000;
  }
}

function makeBars(symbol: string, timeframe = "5m") {
  const stepMs = timeframeStepMs(timeframe);
  const base = 100 + symbols.indexOf(symbol) * 25;
  return Array.from({ length: 80 }, (_, index) => {
    const close = base + Math.sin(index / 6) * 1.5 + index * 0.03;
    return {
      timestamp: new Date(mockNow - (79 - index) * stepMs).toISOString(),
      open: close - 0.4,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100_000 + index * 1_000,
      source: "mock",
    };
  });
}

async function mockShellApi(
  page: Page,
  {
    barsRequests = [],
    ibkrReady = false,
    runtimeLineUsage = null,
  }: {
    barsRequests?: Array<Record<string, string>>;
    ibkrReady?: boolean;
    runtimeLineUsage?: MockMarketDataAdmission | null;
  } = {},
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    let body: unknown = {};

    if (url.pathname === "/api/session") {
      const ibkrBridge = ibkrReady
        ? {
            connected: true,
            authenticated: true,
            competing: false,
            healthFresh: true,
            healthAgeMs: 400,
            bridgeReachable: true,
            socketConnected: true,
            accountsLoaded: true,
            accounts: [{ accountId: "DU1234567" }],
            selectedAccountId: "DU1234567",
            connectionTarget: "127.0.0.1:4002",
            sessionMode: "paper",
            clientId: 7,
            marketDataMode: "live",
            liveMarketDataAvailable: true,
            configuredLiveMarketDataMode: true,
            streamFresh: true,
            streamState: "live",
            streamStateReason: "fresh_stream_event",
            lastStreamEventAgeMs: 500,
            strictReady: true,
            strictReason: null,
          }
        : null;
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        marketDataProviders: {
          live: "ibkr",
          historical: "ibkr",
          research: "fmp",
        },
        configured: { polygon: false, ibkr: ibkrReady, research: false },
        ibkrBridge,
        timestamp: new Date(mockNow).toISOString(),
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
              addedAt: new Date(mockNow).toISOString(),
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
        quotes: requested.map((symbol, index) => ({
          symbol,
          price: 100 + index * 10,
          prevClose: 99 + index * 10,
          change: 1,
          changePercent: 1,
          volume: 1_000_000,
          updatedAt: new Date(mockNow).toISOString(),
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/bars") {
      const params = Object.fromEntries(url.searchParams.entries());
      barsRequests.push(params);
      body = {
        bars: makeBars(
          (url.searchParams.get("symbol") || "SPY").toUpperCase(),
          url.searchParams.get("timeframe") || "5m",
        ),
      };
    } else if (url.pathname === "/api/flow/events") {
      body = {
        events: [],
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
    } else if (url.pathname === "/api/research/status") {
      body = { configured: false, provider: null };
    } else if (url.pathname === "/api/research/snapshots") {
      const requested = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        snapshots: requested.map((symbol, index) => ({
          symbol,
          price: 100 + index * 5,
          change: index % 2 ? -0.4 : 0.8,
          changePercent: index % 2 ? -0.3 : 0.6,
          mc: 100_000_000_000 + index * 1_000_000_000,
          pe: 24,
          eps: 6.5,
          sharesOut: 1_000_000_000,
        })),
      };
    } else if (url.pathname === "/api/research/fundamentals") {
      body = { fundamentals: null };
    } else if (url.pathname === "/api/research/financials") {
      body = { financials: null };
    } else if (url.pathname === "/api/research/sec-filings") {
      body = { filings: [] };
    } else if (url.pathname === "/api/research/transcripts") {
      body = { transcripts: [] };
    } else if (url.pathname.startsWith("/api/research/transcripts/")) {
      body = { transcript: null };
    } else if (url.pathname === "/api/settings/preferences") {
      body = {
        source: "database",
        preferences: {},
        updatedAt: new Date(mockNow).toISOString(),
      };
    } else if (url.pathname === "/api/settings/backend") {
      body = {
        settings: [],
        summary: {
          pendingRestartCount: 0,
          providers: { polygon: false, research: false, ibkr: false },
          tradingMode: "paper",
          diagnosticsStatus: "ok",
          diagnosticsSeverity: "info",
          thresholdCount: 0,
          ibkrLaneCount: 0,
          bridgeOverrideActive: false,
          algoDeploymentCount: 0,
          enabledAlgoDeploymentCount: 0,
        },
      };
    } else if (url.pathname === "/api/settings/ibkr-lanes") {
      body = { lanes: [], policy: {}, defaults: {} };
    } else if (url.pathname === "/api/settings/ibkr-line-usage") {
      body = { lanes: [], summary: { activeLines: 0, maxLines: 0 } };
    } else if (url.pathname === "/api/diagnostics/latest") {
      body = {
        status: "ok",
        severity: "info",
        timestamp: new Date(mockNow).toISOString(),
        probes: {},
        subsystems: {},
        metrics: {},
      };
    } else if (url.pathname === "/api/diagnostics/runtime") {
      body = {
        providers: {
          polygon: {
            configured: false,
            status: "unconfigured",
            baseUrl: null,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastError: null,
          },
        },
        ibkr: {
          configured: ibkrReady,
          reachable: ibkrReady,
          connected: ibkrReady,
          authenticated: ibkrReady,
          competing: false,
          selectedAccountId: ibkrReady ? "DU...4567" : null,
          accountCount: ibkrReady ? 1 : 0,
          connectionTarget: ibkrReady ? "127.0.0.1:4002" : null,
          sessionMode: "paper",
          clientId: ibkrReady ? 7 : null,
          marketDataMode: ibkrReady ? "live" : null,
          liveMarketDataAvailable: ibkrReady ? true : null,
          healthFresh: ibkrReady,
          healthAgeMs: ibkrReady ? 400 : null,
          bridgeReachable: ibkrReady,
          socketConnected: ibkrReady,
          accountsLoaded: ibkrReady,
          configuredLiveMarketDataMode: ibkrReady,
          streamFresh: ibkrReady,
          streamState: ibkrReady ? "live" : "offline",
          streamStateReason: ibkrReady
            ? "fresh_stream_event"
            : "not_configured",
          lastStreamEventAgeMs: ibkrReady ? 500 : null,
          strictReady: ibkrReady,
          strictReason: null,
          streams: {
            marketDataAdmission: runtimeLineUsage || {
              activeLineCount: 0,
              flowScannerLineCount: 0,
              budget: { maxLines: 0, flowScannerLineCap: 0 },
              poolUsage: {},
              counters: {},
            },
          },
        },
      };
    } else if (url.pathname === "/api/diagnostics/history") {
      body = { points: [], snapshots: [] };
    } else if (url.pathname === "/api/diagnostics/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/diagnostics/thresholds") {
      body = { thresholds: [] };
    } else if (
      url.pathname === "/api/diagnostics/client-events" ||
      url.pathname === "/api/diagnostics/client-metrics"
    ) {
      body = { ok: true };
    } else if (url.pathname === "/api/backtests/strategies") {
      body = {
        strategies: [
          {
            strategyId: "sma_crossover",
            version: "v1",
            label: "SMA Crossover",
            description: "Deterministic smoke strategy",
            status: "runnable",
            supportedTimeframes: ["1d", "1h"],
            directionMode: "long_only",
            parameterDefinitions: [
              {
                key: "fastPeriod",
                label: "Fast Period",
                type: "integer",
                defaultValue: 10,
                options: [],
                min: 2,
                max: 100,
                step: 1,
              },
              {
                key: "slowPeriod",
                label: "Slow Period",
                type: "integer",
                defaultValue: 30,
                options: [],
                min: 5,
                max: 200,
                step: 1,
              },
            ],
            defaultParameters: { fastPeriod: 10, slowPeriod: 30 },
          },
        ],
      };
    } else if (url.pathname === "/api/backtests/studies") {
      body = { studies: [] };
    } else if (url.pathname === "/api/backtests/runs") {
      body = { runs: [] };
    } else if (url.pathname === "/api/backtests/jobs") {
      body = { jobs: [] };
    } else if (url.pathname === "/api/backtests/drafts") {
      body = { drafts: [] };
    } else if (url.pathname === "/api/algo/deployments") {
      body = { deployments: [] };
    } else if (url.pathname === "/api/algo/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = {
        id: "signal-profile",
        environment: "paper",
        enabled: false,
        watchlistId: "default",
        timeframe: "15m",
        rayReplicaSettings: {},
        freshWindowBars: 3,
        pollIntervalSeconds: 60,
        maxSymbols: 50,
        evaluationConcurrency: 3,
        lastEvaluatedAt: null,
        lastError: null,
        createdAt: new Date(mockNow).toISOString(),
        updatedAt: new Date(mockNow).toISOString(),
      };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = { profile: null, states: [], evaluatedAt: new Date(mockNow).toISOString() };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    } else if (url.pathname === "/api/accounts") {
      body = { accounts: [] };
    } else if (url.pathname.includes("/account/") || url.pathname.includes("/accounts/")) {
      body = { accounts: [], positions: [], orders: [], trades: [], points: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("**/*tradingview.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  });
}

function collectRuntimeIssues(page: Page) {
  const issues: string[] = [];
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to load resource")) return;
    issues.push(text);
  });
  return issues;
}

async function openScreen(page: Page, label: string, screenId: string) {
  const nav = page.getByTestId("platform-screen-nav");
  await nav.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await expect(page.getByTestId(`screen-host-${screenId}`)).toHaveAttribute(
    "aria-hidden",
    "false",
  );
}

async function selectChartInterval(
  page: Page,
  chartTestId: string,
  interval: string,
) {
  const chart = page.getByTestId(chartTestId);
  const trigger = chart.getByTestId("chart-timeframe-menu-trigger");
  const current = await trigger.getAttribute("data-chart-timeframe");
  if (current !== interval) {
    await trigger.click();
    await page.getByTestId(`chart-timeframe-option-${interval}`).click();
  }
  await expect(trigger).toHaveAttribute("data-chart-timeframe", interval, {
    timeout: 10_000,
  });
}

async function expectChartHydrated(page: Page, surfaceTestId: string) {
  const surface = page.getByTestId(surfaceTestId);
  await expect(surface).toHaveAttribute(
    "data-chart-visible-logical-range",
    /^(?!none$).+/,
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () =>
        Number((await surface.getAttribute("data-chart-rendered-bar-count")) || "0"),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(1);
}

async function expectSpotBarsRequestForInterval(
  barsRequests: Array<Record<string, string>>,
  interval: (typeof spotChartIntervals)[number],
) {
  const expectedTimeframe = spotApiTimeframeByInterval[interval];
  await expect
    .poll(
      () =>
        barsRequests.some(
          (request) =>
            request.timeframe === expectedTimeframe &&
            Number(request.limit || "0") > 1,
        ),
      { timeout: 10_000 },
    )
    .toBeTruthy();
}

test("platform shell keeps shared chrome while switching primary screens", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");

  const nav = page.getByTestId("platform-screen-nav");
  await expect(nav).toBeVisible();
  await expect(page.getByTestId("platform-compact-header")).toBeVisible();
  await expect(page.getByTestId("platform-bottom-status")).toBeVisible();

  for (const label of ["Market", "Flow", "Trade", "Account", "Research", "Algo", "Backtest", "Diagnostics", "Settings"]) {
    await expect(nav.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
  }

  for (const label of ["Flow", "Trade", "Account", "Diagnostics", "Settings", "Market"]) {
    await nav.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await expect(page.getByTestId("platform-compact-header")).toBeVisible();
    await expect(page.getByTestId("platform-screen-nav")).toBeVisible();
    await expect(page.getByTestId("platform-bottom-status")).toBeVisible();
  }

  expect(pageErrors).toEqual([]);
});

test("platform pages render page-by-page and keep primary controls interactive", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");
  await openScreen(page, "Market", "market");

  await expect(page.getByTestId("market-workspace")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("market-chart-grid")).toBeVisible();
  await expect(page.getByTestId("market-activity-panel")).toBeVisible();

  await openScreen(page, "Flow", "flow");
  await expect(page.getByTestId("flow-main-layout")).toBeVisible();
  await expect(page.getByTestId("flow-filter-panel")).toBeVisible();
  await expect(page.getByTestId("flow-filter-toggle")).toBeVisible();
  await page.getByTestId("flow-column-toggle").click();
  await expect(page.getByTestId("flow-column-drawer")).toBeVisible();

  await openScreen(page, "Trade", "trade");
  await expect(page.getByTestId("trade-top-zone")).toBeVisible();
  await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
  await expect(page.getByTestId("trade-options-chain-panel")).toBeVisible();

  await openScreen(page, "Account", "account");
  await expect(page.getByTestId("account-screen")).toBeVisible();
  await page.getByTestId("account-section-shadow").click();
  await expect(page.getByText("Shadow internal paper")).toBeVisible();
  await page.getByTestId("account-section-real").click();
  await expect(page.getByText("Aggregated real accounts")).toBeVisible();

  await openScreen(page, "Research", "research");
  await expect(page.getByTestId("research-screen")).toBeVisible();
  await expect(page.getByTestId("research-search-input")).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByTestId("research-view-comps").click();
  await expect(page.getByTestId("research-view-comps")).toBeVisible();
  await page.getByTestId("research-view-macro").click();
  await expect(page.getByTestId("research-view-macro")).toBeVisible();
  await page.getByTestId("research-view-graph").click();
  await page.getByTestId("research-search-input").fill("NVDA");
  await expect(page.getByText(/match(?:es)?/)).toBeVisible();

  await openScreen(page, "Algo", "algo");
  await expect(page.getByTestId("algo-screen")).toBeVisible();
  await expect(page.getByText("Execution Control Plane")).toBeVisible();
  await expect(page.getByText("No promoted draft strategies").first()).toBeVisible();

  await openScreen(page, "Backtest", "backtest");
  await expect(page.getByTestId("backtest-workspace")).toBeVisible();
  await expect(page.getByText("Research Workbench")).toBeVisible();
  await expect(page.getByText("Backtest Inputs")).toBeVisible();

  await openScreen(page, "Diagnostics", "diagnostics");
  await expect(page.getByTestId("diagnostics-screen")).toBeVisible();
  await page.getByTestId("diagnostics-tab-memory").click();
  await expect(page.getByText("API Memory")).toBeVisible();
  await page.getByTestId("diagnostics-tab-overview").click();
  await expect(page.getByText("API Latency Trend")).toBeVisible();

  await openScreen(page, "Settings", "settings");
  await expect(page.getByTestId("settings-screen")).toBeVisible();
  await page.getByTestId("settings-search-input").fill("chart");
  await page.getByTestId("settings-tab-charting").click();
  await expect(page.getByText("Chart Display")).toBeVisible();
  await page.getByTestId("settings-search-input").fill("");
  await page.getByTestId("settings-tab-workspace").click();
  await expect(page.getByText("Workspace Defaults")).toBeVisible();

  expect(runtimeIssues).toEqual([]);
});

test("platform keeps Account screen state mounted while hidden", async ({ page }) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");

  await openScreen(page, "Account", "account");
  await page.getByTestId("account-section-shadow").click();
  await expect(page.getByText("Shadow internal paper")).toBeVisible();

  await openScreen(page, "Market", "market");
  await expect(page.getByTestId("screen-host-account")).toHaveAttribute(
    "aria-hidden",
    "true",
  );

  await openScreen(page, "Account", "account");
  await expect(page.getByText("Shadow internal paper")).toBeVisible();
  expect(runtimeIssues).toEqual([]);
});

test("header connectivity shows market data line usage in the compact area and popover", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await disableStreamingSources(page);
  await mockShellApi(page, {
    ibkrReady: true,
    runtimeLineUsage: {
      activeLineCount: 77,
      flowScannerLineCount: 34,
      budget: {
        maxLines: 200,
        flowScannerLineCap: 40,
      },
      poolUsage: {
        "flow-scanner": {
          activeLineCount: 34,
          maxLines: 40,
          remainingLineCount: 6,
          strict: true,
        },
        visible: {
          activeLineCount: 18,
          maxLines: 108,
          remainingLineCount: 90,
        },
      },
      counters: {},
    },
  });
  await page.goto("/");

  const compactLineUsage = page.getByTestId("header-market-data-line-usage");
  await expect(compactLineUsage).toContainText("LINES", { timeout: 15_000 });
  await expect(compactLineUsage).toContainText("77 / 200");

  await page
    .getByRole("button", { name: "Open IB Gateway connection details" })
    .click();
  const popover = page.getByRole("dialog", { name: "IB Gateway bridge" });
  await expect(popover).toContainText("Market data lines");
  await expect(popover).toContainText("77 / 200");
  await expect(popover).toContainText("Flow scanner");
  await expect(popover).toContainText("34");
  await expect(popover).toContainText("40");

  expect(runtimeIssues).toEqual([]);
});

test("spot market mini chart hydrates every interval selection", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const barsRequests: Array<Record<string, string>> = [];

  await disableStreamingSources(page);
  await mockShellApi(page, { barsRequests });
  await page.goto("/");

  await expect(page.getByTestId("market-mini-chart-0")).toBeVisible({
    timeout: 30_000,
  });

  for (const interval of spotChartIntervals) {
    await selectChartInterval(page, "market-mini-chart-0", interval);
    await expectSpotBarsRequestForInterval(barsRequests, interval);
    await expectChartHydrated(page, "market-mini-chart-0-surface");
  }

  expect(barsRequests.length).toBeGreaterThan(0);
  expect(runtimeIssues).toEqual([]);
});

test("trade spot chart hydrates every interval selection", async ({ page }) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const barsRequests: Array<Record<string, string>> = [];

  await disableStreamingSources(page);
  await mockShellApi(page, { barsRequests });
  await page.goto("/");
  await openScreen(page, "Trade", "trade");

  await expect(page.getByTestId("trade-equity-chart")).toBeVisible({
    timeout: 30_000,
  });

  for (const interval of spotChartIntervals) {
    await selectChartInterval(page, "trade-equity-chart", interval);
    await expectSpotBarsRequestForInterval(barsRequests, interval);
    await expectChartHydrated(page, "trade-equity-chart-surface");
  }

  expect(barsRequests.length).toBeGreaterThan(0);
  expect(runtimeIssues).toEqual([]);
});

test("market chart frame changes timeframe from the dropdown and drag-pans", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const barsRequests: Array<Record<string, string>> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await disableStreamingSources(page);
  await mockShellApi(page, { barsRequests });
  await page.goto("/");

  const chart = page.getByTestId("market-mini-chart-0");
  const surface = page.getByTestId("market-mini-chart-0-surface");
  await expect(chart).toBeVisible({ timeout: 30_000 });
  await expect(surface).toHaveAttribute(
    "data-chart-visible-logical-range",
    /^(?!none$).+/,
    { timeout: 15_000 },
  );
  await expectChartHydrated(page, "market-mini-chart-0-surface");

  const trigger = chart.getByTestId("chart-timeframe-menu-trigger");
  await expect(trigger).toHaveAttribute("data-chart-timeframe", "15m");
  await trigger.click();
  await page.getByTestId("chart-timeframe-option-1h").click();
  await expect(trigger).toHaveAttribute("data-chart-timeframe", "1h", {
    timeout: 10_000,
  });
  await expect
    .poll(
      () => barsRequests.some((request) => request["timeframe"] === "1h"),
      { timeout: 10_000 },
    )
    .toBe(true);

  const before = await surface.getAttribute("data-chart-visible-logical-range");
  const plot = page.getByTestId("market-mini-chart-0-surface-plot");
  const box = await plot.boundingBox();
  expect(box, "market chart plot should have a geometry box").not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.35, box!.y + box!.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(surface).toHaveAttribute("data-chart-viewport-user-touched", "true");
  await expect
    .poll(() => surface.getAttribute("data-chart-visible-logical-range"))
    .not.toBe(before);

  expect(pageErrors).toEqual([]);
});

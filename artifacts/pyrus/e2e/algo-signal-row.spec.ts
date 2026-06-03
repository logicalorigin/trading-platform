import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

const nowIso = "2026-05-20T16:00:00.000Z";
const deploymentId = "dep-signal-visual";
const signalKeys = {
  aapl: "AAPL:5m:buy:visual",
  msft: "MSFT:5m:sell:visual",
  nvda: "NVDA:5m:buy:visual",
};
const matrixTimeframes = ["1m", "2m", "5m", "15m", "1h", "1d"];

const basePrices: Record<string, number> = {
  AAPL: 150,
  MSFT: 420,
  NVDA: 1020,
  SPY: 510,
};

const barsFor = (symbol: string) =>
  Array.from({ length: 48 }, (_, index) => ({
    time: Math.floor(Date.parse(nowIso) / 1000) - (47 - index) * 900,
    open: (basePrices[symbol] ?? 100) + index * 0.18,
    high: (basePrices[symbol] ?? 100) + 1 + index * 0.18,
    low: (basePrices[symbol] ?? 100) - 1 + index * 0.18,
    close: (basePrices[symbol] ?? 100) + index * 0.2 + Math.sin(index / 2) * 0.7,
    volume: 500_000 + index * 1_000,
    symbol,
  }));

const signalRows = [
  {
    signalKey: signalKeys.aapl,
    symbol: "AAPL",
    timeframe: "5m",
    direction: "buy",
    score: 8.2,
    fresh: true,
    barsSinceSignal: 1,
    signalPrice: 150.23,
    sparkBars: barsFor("AAPL").slice(-24),
    signalAt: nowIso,
    status: "available",
  },
  {
    signalKey: signalKeys.msft,
    symbol: "MSFT",
    timeframe: "5m",
    direction: "sell",
    score: 5.1,
    fresh: false,
    barsSinceSignal: 12,
    signalPrice: 420.11,
    sparkBars: barsFor("MSFT").slice(-24),
    signalAt: "2026-05-20T14:20:00.000Z",
    status: "available",
  },
  {
    signalKey: signalKeys.nvda,
    symbol: "NVDA",
    timeframe: "5m",
    direction: "buy",
    score: 6.4,
    fresh: true,
    barsSinceSignal: 2,
    signalPrice: 1020.42,
    sparkBars: barsFor("NVDA").slice(-24),
    signalAt: nowIso,
    status: "available",
  },
];

const candidates = [
  {
    id: "cand-aapl",
    symbol: "AAPL",
    signalKey: signalKeys.aapl,
    signal: signalRows[0],
    sourceType: "mean_reversion",
    strategyLabel: "Mean Reversion",
    timeframe: "5m",
    direction: "buy",
    action: "buy_call",
    actionStatus: "ready",
    selectedContract: {
      ticker: "AAPL 20260522 C 155",
      underlying: "AAPL",
      right: "C",
      expirationDate: "2026-05-22",
      strike: 155,
      multiplier: 100,
      providerContractId: "aapl-call-155",
    },
    quote: {
      bid: 2.1,
      ask: 2.14,
      mid: 2.12,
      delta: 0.44,
      gamma: 0.018,
      theta: -0.06,
      vega: 0.11,
      impliedVolatility: 0.42,
      openInterest: 14_200,
      volume: 1_240,
      quoteFreshness: "fresh",
      marketDataMode: "live",
    },
    liquidity: { bid: 2.1, ask: 2.14, mid: 2.12, spreadPctOfMid: 1.9 },
    orderPlan: { quantity: 1, entryLimitPrice: 2.12, premiumAtRisk: 212 },
    timeline: [{ occurredAt: nowIso, eventType: "candidate_ready" }],
  },
  {
    id: "cand-msft",
    symbol: "MSFT",
    signalKey: signalKeys.msft,
    signal: signalRows[1],
    sourceType: "breakout",
    strategyLabel: "Breakout",
    timeframe: "5m",
    direction: "sell",
    action: "buy_put",
    actionStatus: "blocked",
    status: "blocked",
    reason: "spread_too_wide",
    selectedContract: {
      ticker: "MSFT 20260522 P 415",
      underlying: "MSFT",
      right: "P",
      expirationDate: "2026-05-22",
      strike: 415,
      multiplier: 100,
      providerContractId: "msft-put-415",
    },
    quote: {
      bid: 3.1,
      ask: 3.38,
      mid: 3.24,
      delta: -0.39,
      gamma: 0.015,
      theta: -0.08,
      vega: 0.1,
      impliedVolatility: 0.46,
      openInterest: 5_800,
      volume: 410,
      quoteFreshness: "stale",
      marketDataMode: "live",
    },
    liquidity: { bid: 3.1, ask: 3.38, mid: 3.24, spreadPctOfMid: 8.6 },
    orderPlan: { quantity: 1, entryLimitPrice: 3.24, premiumAtRisk: 324 },
    timeline: [{ occurredAt: "2026-05-20T15:10:00.000Z", eventType: "blocked" }],
  },
  {
    id: "cand-nvda",
    symbol: "NVDA",
    signalKey: signalKeys.nvda,
    signal: signalRows[2],
    sourceType: "momentum",
    strategyLabel: "Momentum",
    timeframe: "5m",
    direction: "buy",
    action: "monitor",
    actionStatus: "candidate",
    selectedContract: {},
    quote: {},
    liquidity: {},
    orderPlan: {},
    timeline: [{ occurredAt: nowIso, eventType: "candidate" }],
  },
];

const matrixStates = [
  ["AAPL", "1m", "buy", true, 0],
  ["AAPL", "2m", "buy", true, 0],
  ["AAPL", "5m", "buy", true, 1],
  ["AAPL", "15m", "buy", true, 1],
  ["AAPL", "1h", "buy", true, 2],
  ["AAPL", "1d", "buy", true, 3],
  ["MSFT", "1m", "sell", false, 9],
  ["MSFT", "2m", "sell", false, 10],
  ["MSFT", "5m", "sell", false, 12],
  ["MSFT", "15m", "buy", false, 8],
  ["MSFT", "1h", "sell", false, 14],
  ["MSFT", "1d", "sell", false, 18],
  ["NVDA", "1m", "buy", true, 0],
  ["NVDA", "2m", "buy", true, 1],
  ["NVDA", "5m", "buy", true, 2],
  ["NVDA", "15m", "sell", false, 6],
  ["NVDA", "1h", "buy", true, 3],
  ["NVDA", "1d", "buy", true, 4],
].map(([symbol, timeframe, currentSignalDirection, fresh, barsSinceSignal]) => ({
  symbol,
  timeframe,
  currentSignalDirection,
  fresh,
  barsSinceSignal,
  status: "ok",
  currentSignalAt: nowIso,
  latestBarAt: nowIso,
  lastEvaluatedAt: nowIso,
}));

type MockApiOptions = {
  cockpitPipelineStages?: unknown[];
  candidates?: typeof candidates;
  matrixRequests?: Array<{
    cells?: unknown;
    symbols?: unknown;
    timeframes?: unknown;
  }>;
  signals?: typeof signalRows;
};

async function installMockApi(page: Page, options: MockApiOptions = {}) {
  const routeCandidates = options.candidates ?? candidates;
  const routeSignals = options.signals ?? signalRows;
  const cockpitPipelineStages = options.cockpitPipelineStages ?? [];

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

  await page.route("**/*tradingview.com/**", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};

    if (url.pathname.includes("/stream")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname === "/api/session") {
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        configured: { massive: false, ibkr: true, research: false },
        ibkrBridge: {
          connected: true,
          authenticated: true,
          healthFresh: true,
          bridgeReachable: true,
          socketConnected: true,
          accountsLoaded: true,
          accounts: [{ accountId: "DU1234567" }],
          selectedAccountId: "DU1234567",
          configuredLiveMarketDataMode: true,
          streamFresh: true,
          strictReady: true,
        },
        timestamp: nowIso,
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [
          {
            id: "default",
            name: "Default",
            isDefault: true,
            items: ["AAPL", "MSFT", "NVDA", "SPY"].map((symbol, index) => ({
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
      const requested = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      const prices: Record<string, number> = {
        AAPL: 150.23,
        MSFT: 420.11,
        NVDA: 1020.42,
        SPY: 510.2,
      };
      body = {
        quotes: requested.map((symbol) => ({
          symbol,
          price: prices[symbol] ?? 100,
          prevClose: (prices[symbol] ?? 100) - 1,
          change: symbol === "MSFT" ? -1.8 : 1.2,
          changePercent: symbol === "MSFT" ? -0.42 : 0.8,
          volume: 2_400_000,
          updatedAt: nowIso,
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/bars") {
      body = {
        bars: barsFor((url.searchParams.get("symbol") || "SPY").toUpperCase()),
        dataSource: "ibkr-history",
        historySource: "ibkr-history",
        freshness: "live",
        marketDataMode: "live",
      };
    } else if (url.pathname === "/api/backtests/drafts") {
      body = { drafts: [] };
    } else if (url.pathname === "/api/algo/deployments") {
      body = {
        deployments: [
          {
            id: deploymentId,
            name: "Visual Signal Ops",
            mode: "paper",
            enabled: true,
            strategyId: "pyrus_signals",
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ],
      };
    } else if (url.pathname === `/api/algo/deployments/${deploymentId}/signal-options/state`) {
      body = {
        profile: null,
        signals: routeSignals,
        candidates: routeCandidates,
        activePositions: [],
        updatedAt: nowIso,
      };
    } else if (url.pathname === `/api/algo/deployments/${deploymentId}/cockpit`) {
      body = {
        deploymentId,
        evaluatedAt: nowIso,
        generatedAt: nowIso,
        signals: routeSignals,
        candidates: routeCandidates,
        activePositions: [],
        kpis: {
          todayPnl: 124.5,
          dailyRealizedPnl: 80,
          openUnrealizedPnl: 44.5,
          candidates: routeCandidates.length,
          blockedCandidates: routeCandidates.filter(
            (candidate) => candidate.actionStatus === "blocked",
          ).length,
          shadowFilledCandidates: 0,
          openPositions: 0,
          openSymbols: 0,
          maxOpenSymbols: 10,
          dailyLossRemaining: 1000,
          openPremium: 0,
        },
        readiness: { ready: true, message: "Ready" },
        fleet: { totalDeployments: 1, enabledDeployments: 1 },
        pipelineStages: cockpitPipelineStages,
        attentionItems: [],
      };
    } else if (url.pathname === `/api/algo/deployments/${deploymentId}/signal-options/performance`) {
      body = {
        summary: {
          closedTrades: 7,
          realizedPnl: 240,
          winRatePercent: 58,
          profitFactor: 1.4,
          expectancy: 34,
        },
        openExposure: {
          openPremium: 0,
          openSymbols: 0,
          maxOpenSymbols: 10,
          unmarkedPositions: 0,
        },
        ruleAdherence: [],
      };
    } else if (url.pathname === "/api/algo/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = {
        id: "signal-profile",
        environment: "paper",
        enabled: true,
        watchlistId: "default",
        timeframe: "5m",
        pyrusSignalsSettings: {},
        freshWindowBars: 3,
        pollIntervalSeconds: 60,
        maxSymbols: 50,
        evaluationConcurrency: 3,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = {
        profile: null,
        states: matrixStates.filter((state) => state.timeframe === "5m"),
        events: [],
        universeSymbols: ["AAPL", "MSFT", "NVDA"],
        evaluatedAt: nowIso,
      };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/signal-monitor/matrix") {
      let requestBody: Record<string, unknown> = {};
      try {
        requestBody = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        requestBody = {};
      }
      options.matrixRequests?.push({
        cells: requestBody.cells,
        symbols: requestBody.symbols,
        timeframes: requestBody.timeframes,
      });
      body = {
        states: matrixStates,
        timeframes: matrixTimeframes,
        evaluatedAt: nowIso,
        skippedSymbols: [],
        truncated: false,
      };
    } else if (url.pathname === "/api/settings/preferences") {
      body = { source: "mock", preferences: {}, updatedAt: nowIso };
    } else if (url.pathname === "/api/settings/backend") {
      body = {
        settings: [],
        summary: {
          pendingRestartCount: 0,
          providers: { massive: false, research: false, ibkr: true },
          tradingMode: "paper",
          diagnosticsStatus: "ok",
          diagnosticsSeverity: "info",
          algoDeploymentCount: 1,
          enabledAlgoDeploymentCount: 1,
        },
      };
    } else if (url.pathname === "/api/settings/ibkr-lanes") {
      body = { lanes: [], policy: {}, defaults: {} };
    } else if (url.pathname === "/api/settings/ibkr-line-usage") {
      body = {
        updatedAt: nowIso,
        admission: {
          activeLineCount: 4,
          accountMonitorLineCount: 0,
          flowScannerLineCount: 0,
          budget: { maxLines: 100, accountMonitorLineCap: 20, flowScannerLineCap: 40 },
          poolUsage: {},
          counters: {},
        },
        bridge: {},
        streams: {},
        drift: {},
      };
    } else if (url.pathname === "/api/diagnostics/latest") {
      body = { status: "ok", severity: "info", timestamp: nowIso, snapshots: [], events: [] };
    } else if (url.pathname === "/api/diagnostics/runtime") {
      body = { providers: {}, ibkr: { configured: true, strictReady: true } };
    } else if (url.pathname === "/api/accounts") {
      body = { accounts: [{ accountId: "DU1234567", label: "Paper" }] };
    } else if (url.pathname === "/api/accounts/shadow/positions") {
      body = { positions: [], summary: {}, updatedAt: nowIso };
    } else if (url.pathname.startsWith("/api/research/")) {
      body = {};
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function openScreen(
  page: Page,
  width: number,
  height: number,
  screen: "algo" | "signals",
  options: MockApiOptions = {},
) {
  await page.setViewportSize({ width, height });
  await installMockApi(page, options);
  await page.addInitScript((initialScreen) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "pyrus:state:v1",
      JSON.stringify({
        screen: initialScreen,
        sym: "AAPL",
        theme: "dark",
        sidebarCollapsed: true,
      }),
    );
  }, screen);
  await page.goto("/?pyrusQa=safe", { waitUntil: "domcontentloaded" });
}

async function openSignals(
  page: Page,
  width: number,
  height: number,
  options: MockApiOptions = {},
) {
  await openScreen(page, width, height, "signals", options);
  await expect(page.getByTestId("signals-screen")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("signals-table-row").first()).toBeVisible({
    timeout: 30_000,
  });
}

async function openAlgo(
  page: Page,
  width: number,
  height: number,
  options: MockApiOptions = {},
) {
  await openScreen(page, width, height, "algo", options);
  await expect(page.getByTestId("algo-screen")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("algo-operations-signal-table")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("algo-signal-row-AAPL")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(8_000);
}

test("e2e audit: Signals six-frame matrix flows into STA contract selection", async ({ page }) => {
  const matrixRequests: NonNullable<MockApiOptions["matrixRequests"]> = [];
  await openSignals(page, 1440, 900, { matrixRequests });

  const aaplSignalRow = page.locator(
    '[data-testid="signals-table-row"][data-symbol="AAPL"]',
  );
  await expect(aaplSignalRow).toBeVisible();
  await expect(aaplSignalRow).toHaveAttribute(
    "data-matrix-hydrated-count",
    "6",
    { timeout: 30_000 },
  );
  expect(
    matrixRequests.some((request) =>
      JSON.stringify(request).includes('"1d"'),
    ),
  ).toBeTruthy();

  await page
    .getByTestId("platform-screen-nav")
    .getByRole("button", { name: "Algo" })
    .click();
  await expect(page.getByTestId("algo-screen")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("algo-operations-signal-table")).toBeVisible({
    timeout: 30_000,
  });

  const aaplStaRow = page.getByTestId("algo-signal-row-AAPL");
  await expect(aaplStaRow).toBeVisible();
  await expect(aaplStaRow.locator('[data-testid="watchlist-signal-dot-1d"]')).toHaveAttribute(
    "data-direction",
    "buy",
  );
  await expect(aaplStaRow).toContainText("Priced");
  await expect(aaplStaRow).toContainText("05/22 155C");
  await expect(aaplStaRow).toContainText("conid aapl-call-155");
  await expect(aaplStaRow.getByTestId("algo-signal-greeks-grid")).toBeVisible();
});

test("visual review: desktop signal hero rows", async ({ page }) => {
  await openAlgo(page, 1440, 900);

  const aaplRow = page.getByTestId("algo-signal-row-AAPL");
  await expect(aaplRow.getByTestId("algo-verdict-try")).toBeVisible();
  await expect(aaplRow.getByTestId("algo-signal-hero-sparkline")).toHaveAttribute(
    "title",
    /Signal .* · .* since/,
  );
  await expect(page.getByTestId("algo-signal-dots").first()).toBeVisible();
  await expect(page.getByTestId("algo-signal-row-action-submit").first()).toBeVisible();
  await expect(page.getByTestId("algo-spread-gauge").first()).toBeVisible();
  await expect(page.getByTestId("algo-right-rail")).toBeVisible();
  await expect(page.getByTestId("algo-halt-strip")).toBeVisible();
  await expect(page.getByTestId("algo-halt-toggle-dailyLoss")).toBeVisible();
  await expect(page.getByTestId("algo-halt-toggle-bidAskRequired")).toBeVisible();
  const rightRail = page.getByTestId("algo-right-rail");
  await expect(rightRail.getByTestId("algo-halt-label-dailyLoss")).toHaveText("Daily");
  await expect(rightRail.getByTestId("algo-halt-input-dailyLoss")).toBeVisible();
  await expect(rightRail.getByTestId("algo-halt-label-maxContracts")).toHaveText("Contracts");
  await expect(rightRail.getByTestId("algo-halt-input-maxContracts")).toBeVisible();
  await expect(rightRail.getByTestId("algo-controls-container")).toBeVisible();
  await expect(rightRail.getByTestId("algo-settings-container")).toBeVisible();
  await expect(rightRail.getByTestId("algo-diagnostics-container")).toBeVisible();
  await expect(rightRail.getByTestId("algo-diagnostics-footer")).toBeVisible();
  const containerAudit = await rightRail.evaluate((node) => {
    const body = node.querySelector('[data-testid="algo-right-rail-body"]');
    const controls = node.querySelector('[data-testid="algo-controls-container"]');
    const halt = node.querySelector('[data-testid="algo-halt-strip"]');
    const settings = node.querySelector('[data-testid="algo-settings-container"]');
    const quality = node.querySelector('[data-testid="algo-settings-section-qualityExits"]');
    const diagnostics = node.querySelector('[data-testid="algo-diagnostics-container"]');
    return {
      controlsContainHalt: Boolean(controls && halt && controls.contains(halt)),
      controlsContainSettings: Boolean(controls && settings && controls.contains(settings)),
      controlsContainQuality: Boolean(controls && quality && controls.contains(quality)),
      controlsContainDiagnostics: Boolean(controls && diagnostics && controls.contains(diagnostics)),
      diagnosticsInsideSettings: Boolean(settings && diagnostics && settings.contains(diagnostics)),
      bodyOverflow: body ? getComputedStyle(body).overflowY : "",
      controlsOverflow: controls ? getComputedStyle(controls).overflowY : "",
      diagnosticsOverflow: diagnostics ? getComputedStyle(diagnostics).overflowY : "",
      controlsScrollable: controls
        ? controls.scrollHeight > controls.clientHeight + 20
        : false,
    };
  });
  expect(containerAudit).toEqual({
    controlsContainHalt: true,
    controlsContainSettings: true,
    controlsContainQuality: true,
    controlsContainDiagnostics: false,
    diagnosticsInsideSettings: false,
    bodyOverflow: "hidden",
    controlsOverflow: "auto",
    diagnosticsOverflow: "auto",
    controlsScrollable: true,
  });
  await expect(rightRail.getByTestId("algo-halt-group-signal")).toBeVisible();
  await expect(rightRail.getByTestId("algo-halt-group-quote")).toBeVisible();
  await expect(rightRail.getByTestId("algo-halt-control-mtfAlignment")).toBeVisible();
  await expect(rightRail.getByTestId("algo-halt-toggle-mtfAlignment")).toBeVisible();
  await expect(rightRail.getByTestId("algo-halt-toggle-freshQuoteRequired")).toBeVisible();
  await expect(rightRail.getByText("MAX OPEN SYMBOLS")).toHaveCount(0);
  await expect(rightRail.getByText("MAX CONTRACTS")).toHaveCount(0);
  await expect(rightRail.getByText("TIME HORIZON")).toHaveCount(0);
  await expect(rightRail.getByText("FILL TTL SECONDS")).toHaveCount(0);
  const dailyControlBorder = await rightRail
    .getByTestId("algo-halt-control-dailyLoss")
    .evaluate((node) => getComputedStyle(node).borderTopStyle);
  expect(dailyControlBorder).toBe("none");
  const desktopHaltColumns = await rightRail
    .getByTestId("algo-halt-group-quote")
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(desktopHaltColumns).toBe(2);
  await rightRail.getByTestId("algo-halt-input-dailyLoss").fill("1200");
  await rightRail.getByTestId("algo-halt-toggle-bidAskRequired").click();
  await rightRail.getByTestId("algo-halt-toggle-mtfAlignment").click();
  await expect(rightRail.getByTestId("algo-save-bar")).toContainText("3 unsaved changes");
  await rightRail.screenshot({
    path: "/tmp/algo-right-rail-desktop.png",
    animations: "disabled",
  });
  await rightRail.getByTestId("algo-controls-container").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(rightRail.getByTestId("algo-settings-section-qualityExits")).toBeVisible();
  await expect(rightRail.getByTestId("algo-diagnostics-container")).toBeVisible();
  const diagnosticsGap = await rightRail.evaluate((node) => {
    const controls = node.querySelector('[data-testid="algo-controls-container"]');
    const diagnostics = node.querySelector('[data-testid="algo-diagnostics-container"]');
    if (!controls || !diagnostics) return -1;
    return Math.round(
      diagnostics.getBoundingClientRect().top - controls.getBoundingClientRect().bottom,
    );
  });
  expect(diagnosticsGap).toBeGreaterThanOrEqual(6);
  await rightRail.screenshot({
    path: "/tmp/algo-right-rail-bottom.png",
    animations: "disabled",
  });

  await page.getByTestId("algo-operations-signal-table").screenshot({
    path: "/tmp/algo-signal-row-desktop.png",
    animations: "disabled",
  });
});

test("STA row Age shows signal time and Signal button opens Trade contract", async ({
  page,
}) => {
  await openAlgo(page, 1440, 900);

  const aaplRow = page.getByTestId("algo-signal-row-AAPL");
  await expect(aaplRow).toBeVisible();
  const ageCell = aaplRow.getByRole("cell").nth(1);
  await expect(ageCell).toContainText(/\d{1,2}:\d{2}/);
  await expect(ageCell).not.toContainText(/\bsince\b/i);
  await expect(ageCell).not.toContainText(/\b5m\b/);
  await expect(ageCell).not.toContainText(/\b1\/8\b/);
  await expect(ageCell).not.toContainText(/\b1 bars?\b/i);

  const tradeButton = aaplRow.getByRole("button", {
    name: "Open AAPL contract in Trade",
  });
  await expect(tradeButton).toBeEnabled();
  await tradeButton.click();

  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Signal-options context")).toBeVisible();
  await expect(page.getByText("MATCHED")).toBeVisible();
  await expect(page.getByText(/planned 05\/22 155C/)).toBeVisible();
  await expect(page.getByText("AAPL 05/22 155C").first()).toBeVisible();
});

test("signal table status suppresses heavy deferred once contracts exist", async ({ page }) => {
  await openAlgo(page, 1440, 900, {
    cockpitPipelineStages: [
      {
        id: "scan_universe",
        status: "blocked",
        count: 90,
        latestSignalBarAt: nowIso,
        lastSignalScanAt: nowIso,
        heavyWorkDeferred: true,
        resourcePressureLevel: "high",
        detail: "fresh signals updated; 1 contract resolved; remaining action work deferred",
      },
      {
        id: "contract_selected",
        status: "healthy",
        count: 1,
        detail: "1 contract resolved",
      },
    ],
  });

  const table = page.getByTestId("algo-operations-signal-table");
  await expect(table).toContainText("fresh signals updated; 1 contract resolved");
  await expect(table).not.toContainText("Heavy deferred");
});

test("signal table status shows pre-contract blockers instead of deferred work", async ({ page }) => {
  await openAlgo(page, 1440, 900, {
    candidates: candidates.map((candidate, index) => ({
      ...candidate,
      action: candidate.action || "buy_call",
      actionStatus: "blocked",
      status: "skipped",
      selectedContract: {},
      reason: index === 0 ? "mtf_not_aligned" : "market_session_quiet",
    })),
    cockpitPipelineStages: [
      {
        id: "scan_universe",
        status: "blocked",
        count: 90,
        latestSignalBarAt: nowIso,
        lastSignalScanAt: nowIso,
        heavyWorkDeferred: true,
        resourcePressureLevel: "high",
        detail: "fresh signals updated; 3 candidates blocked before contract selection",
      },
      {
        id: "contract_selected",
        status: "attention",
        count: 0,
        detail: "3 candidates blocked before contract selection",
      },
    ],
  });

  const table = page.getByTestId("algo-operations-signal-table");
  await expect(table).toContainText("3 candidates blocked before contract selection");
  await expect(table).not.toContainText("action work deferred before contract selection");
});

test("visual review: mobile signal hero rows", async ({ page }) => {
  await openAlgo(page, 390, 844);

  await expect(page.getByTestId("algo-signal-row-AAPL")).toBeVisible();
  await page.getByTestId("algo-settings-drawer-open").click();
  const drawer = page.getByTestId("algo-settings-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("algo-settings-drawer-close")).toBeVisible();
  await expect(drawer.getByTestId("algo-halt-strip")).toBeVisible();
  await expect(drawer.getByTestId("algo-halt-toggle-freshQuoteRequired")).toBeVisible();
  await expect(drawer.getByTestId("algo-halt-label-freshQuoteRequired")).toHaveText("Fresh");
  await expect(drawer.getByTestId("algo-halt-input-spreadGate")).toBeVisible();
  await expect(drawer.getByTestId("algo-controls-container")).toBeVisible();
  await expect(drawer.getByTestId("algo-settings-container")).toBeVisible();
  await expect(drawer.getByTestId("algo-diagnostics-container")).toBeVisible();
  await expect(drawer.getByTestId("algo-halt-group-signal")).toBeVisible();
  await expect(drawer.getByTestId("algo-halt-toggle-mtfAlignment")).toBeVisible();
  const mobileHaltColumns = await drawer
    .getByTestId("algo-halt-group-quote")
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").filter(Boolean).length);
  expect(mobileHaltColumns).toBe(2);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("algo-settings-drawer")).toHaveCount(0);
  await page.getByTestId("algo-settings-drawer-open").click();
  await page.getByTestId("algo-settings-drawer").screenshot({
    path: "/tmp/algo-right-rail-mobile.png",
    animations: "disabled",
  });
  await page.getByTestId("algo-settings-drawer").getByTestId("algo-settings-drawer-close").click();
  await expect(page.getByTestId("algo-settings-drawer")).toHaveCount(0);
  await page.getByTestId("algo-operations-signal-table").screenshot({
    path: "/tmp/algo-signal-row-mobile.png",
    animations: "disabled",
  });
});

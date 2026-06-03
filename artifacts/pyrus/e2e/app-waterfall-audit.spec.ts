import {
  expect,
  test,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";

test.setTimeout(120_000);

type ScreenId =
  | "market"
  | "signals"
  | "flow"
  | "gex"
  | "trade"
  | "account"
  | "research"
  | "algo"
  | "backtest"
  | "diagnostics"
  | "settings";

type ScreenDefinition = {
  id: ScreenId;
  label: string;
  readyTestId: string;
  primaryTask: string;
  firstViewportContract: string;
  criticalResourceFragments?: string[];
  allowedLateResourceFragments?: string[];
  stuckFallbackTestIds?: string[];
};

type AuditViewport = {
  name: "desktop" | "mobile";
  size: { width: number; height: number };
};

type AuditScenario = {
  name: string;
  mode: "mocked" | "live";
  viewport: AuditViewport;
  mockApi: boolean;
  failInvariants: boolean;
  requireCriticalResources: boolean;
  expectProductionAssets: boolean;
};

type ResourceRecord = {
  screen: ScreenId | "boot";
  url: string;
  path: string;
  resourceType: string;
  startedAtMs: number;
  finishedAtMs: number | null;
  durationMs: number | null;
  failed: boolean;
  failureText: string | null;
};

type ApiRequestRecord = {
  screen: ScreenId | "boot";
  completedScreen: ScreenId | "boot";
  url: string;
  path: string;
  method: string;
  resourceType: string;
  status: number | null;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  failed: boolean;
  failureText: string | null;
  requestFamily: string | null;
  fetchPriority: string | null;
};

type LongTaskRecord = {
  startTime: number;
  duration: number;
  name: string;
};

type LayoutShiftRecord = {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
};

type RouteDataTimingRecord = {
  screenId: string;
  stage: string;
  source: string;
  durationMs: number;
  startedAtMs: number;
  observedAtMs: number;
  observedAt: string;
  detail: Record<string, unknown>;
};

type NavigationEventRecord = {
  screen: ScreenId | "boot";
  url: string;
  path: string;
  elapsedMs: number;
};

type ClientMetricSnapshot = {
  longTasks: LongTaskRecord[];
  layoutShifts: LayoutShiftRecord[];
  routeDataTimings: RouteDataTimingRecord[];
};

type ScreenAuditResult = {
  id: ScreenId;
  label: string;
  viewport: AuditViewport["name"];
  mode: AuditScenario["mode"];
  primaryTask: string;
  firstViewportContract: string;
  shellVisibleMs: number;
  readyMs: number;
  resourceCount: number;
  apiRequestCount: number;
  slowApiRequests: string[];
  longTaskCount: number;
  longTaskTotalMs: number;
  maxLongTaskMs: number;
  layoutShiftScore: number;
  routeDataStages: string[];
  criticalResources: string[];
  missingCriticalResources: string[];
  lateCriticalResources: string[];
  lateAllowedResources: string[];
  stuckFallbacks: string[];
};

const mockNow = Date.parse("2026-06-02T15:30:00.000Z");
const symbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"];
const routeDataTimingEvent = "pyrus:route-data-timing";
const defaultViewport: AuditViewport = {
  name: "desktop",
  size: { width: 1440, height: 1000 },
};
const mobileViewport: AuditViewport = {
  name: "mobile",
  size: { width: 390, height: 844 },
};
const mobilePrimaryScreenIds = new Set<ScreenId>([
  "market",
  "signals",
  "trade",
  "account",
]);
const expectProductionAssets =
  process.env.PYRUS_ROUTE_AUDIT_EXPECT_PRODUCTION === "1";

const screens: ScreenDefinition[] = [
  {
    id: "market",
    label: "Market",
    readyTestId: "market-workspace",
    primaryTask: "Inspect visible watchlist charts and market context.",
    firstViewportContract: "Market workspace and chart grid shell are stable before background chart work continues.",
    criticalResourceFragments: ["MarketScreen.jsx", "MultiChartGrid"],
    stuckFallbackTestIds: ["market-chart-grid-shell"],
  },
  {
    id: "signals",
    label: "Signals",
    readyTestId: "signals-screen",
    primaryTask: "Scan the signal matrix and timeframe coverage.",
    firstViewportContract: "Signals table shell renders without route-local lazy first-viewport work.",
  },
  {
    id: "flow",
    label: "Flow",
    readyTestId: "flow-main-layout",
    primaryTask: "Review premium-flow tape and scanner state.",
    firstViewportContract: "Visible flow layout owns foreground flow requests ahead of broad background scans.",
  },
  {
    id: "gex",
    label: "GEX",
    readyTestId: "gex-screen",
    primaryTask: "Read GEX exposure summaries and projection context.",
    firstViewportContract: "GEX route shell and primary summary are visible without hidden first-viewport Suspense.",
  },
  {
    id: "trade",
    label: "Trade",
    readyTestId: "trade-top-zone",
    primaryTask: "Select a symbol, inspect chain context, and prepare an order.",
    firstViewportContract: "Top trade controls render first; deep panels may lazy-load behind visible panel boundaries.",
    allowedLateResourceFragments: [
      "TradeOrderTicket",
      "TradeChainPanel",
      "TradeStrategyGreeksPanel",
      "TradeL2Panel",
      "TradePositionsPanel",
      "TickerSearch",
      "BottomSheet",
      "Drawer",
    ],
  },
  {
    id: "account",
    label: "Account",
    readyTestId: "account-screen",
    primaryTask: "Check account health, exposure, equity, returns, and positions.",
    firstViewportContract: "Hero, returns, exposure, equity, and positions are preloaded for the visible account viewport.",
    criticalResourceFragments: [
      "AccountScreen.jsx",
      "AccountHeroBlock",
      "AccountReturnsPanel",
      "PortfolioExposurePanel",
      "EquityCurvePanel",
      "PositionsPanel",
    ],
    allowedLateResourceFragments: [
      "TodaySnapshotPanel",
      "TradingAnalysisWorkbench",
      "TradesOrdersPanel",
      "CashFundingPanel",
      "SetupHealthPanel",
    ],
  },
  {
    id: "research",
    label: "Research",
    readyTestId: "research-screen",
    primaryTask: "Inspect the research workspace and primary observatory.",
    firstViewportContract: "Research route shell renders immediately; observatory may hydrate behind a visible workspace fallback.",
    criticalResourceFragments: ["ResearchScreen.jsx"],
    allowedLateResourceFragments: ["PhotonicsObservatory"],
    stuckFallbackTestIds: ["research-workspace-loading"],
  },
  {
    id: "algo",
    label: "Algo",
    readyTestId: "algo-screen",
    primaryTask: "Review live Algo signal rows, positions, and setup state.",
    firstViewportContract: "Live page, signal table, and positions table are first-viewport critical; right rail is deferred.",
    criticalResourceFragments: [
      "AlgoScreen.jsx",
      "AlgoLivePage",
      "OperationsSignalTable",
      "OperationsPositionsTable",
    ],
    allowedLateResourceFragments: ["AlgoRightRail", "AlgoSettingsRegion"],
    stuckFallbackTestIds: ["algo-live-loading", "algo-setup-loading", "algo-deferred-block"],
  },
  {
    id: "backtest",
    label: "Backtest",
    readyTestId: "backtest-workspace",
    primaryTask: "Open backtesting drafts and workspace panels.",
    firstViewportContract: "Backtesting panel modules are explicitly preloaded and use visible fallbacks.",
    criticalResourceFragments: ["BacktestScreen.jsx", "BacktestingPanels"],
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    readyTestId: "diagnostics-screen",
    primaryTask: "Inspect runtime diagnostics without foreground blocking.",
    firstViewportContract: "Diagnostics shell renders without route-local first-viewport lazy work.",
  },
  {
    id: "settings",
    label: "Settings",
    readyTestId: "settings-screen",
    primaryTask: "Inspect platform settings and runtime policy.",
    firstViewportContract: "Settings shell renders without route-local first-viewport lazy work.",
  },
];

const REQUEST_CANCELLATION_RE =
  /(?:net::)?ERR_ABORTED|NS_BINDING_ABORTED|aborted/i;

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function makeBars(symbol: string, limit = 80) {
  const base = 100 + symbols.indexOf(symbol) * 20;
  const barCount = Math.max(20, Math.min(Number.isFinite(limit) ? limit : 80, 120));
  return Array.from({ length: barCount }, (_, index) => {
    const close = base + Math.sin(index / 8) * 1.5 + index * 0.04;
    return {
      timestamp: new Date(mockNow - (barCount - 1 - index) * 60_000).toISOString(),
      open: close - 0.35,
      high: close + 0.85,
      low: close - 0.9,
      close,
      volume: 1_000_000 + index * 1_000,
      source: "mock-history",
      freshness: "live",
      marketDataMode: "live",
      delayed: false,
    };
  });
}

async function installMockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const now = new Date(mockNow).toISOString();

    if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    let body: unknown = { ok: true, items: [], rows: [], data: [] };

    if (url.pathname === "/api/session") {
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        marketDataProviders: { live: "ibkr", historical: "ibkr", research: "mock" },
        configured: { massive: false, ibkr: false, research: false },
        ibkrBridge: null,
        timestamp: now,
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
              addedAt: now,
            })),
          },
        ],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const requested = (url.searchParams.get("symbols") || symbols.join(","))
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol, index) => ({
          symbol,
          price: 100 + index * 7,
          prevClose: 99 + index * 7,
          change: 1,
          changePercent: 1,
          volume: 1_000_000,
          updatedAt: now,
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/bars") {
      const symbol = (url.searchParams.get("symbol") || "SPY").toUpperCase();
      const limit = Number(url.searchParams.get("limit") || "80");
      body = {
        bars: makeBars(symbol, Number.isFinite(limit) ? limit : 80),
        dataSource: "mock-history",
        historySource: "mock-history",
        freshness: "live",
        marketDataMode: "live",
      };
    } else if (url.pathname === "/api/universe/tickers") {
      body = {
        results: symbols.map((symbol, index) => ({
          ticker: symbol,
          name: symbol,
          market: symbol === "SPY" || symbol === "QQQ" ? "etf" : "stocks",
          rootSymbol: symbol,
          primaryExchange: symbol === "SPY" || symbol === "QQQ" ? "ARCX" : "XNAS",
          providerContractId: String(1000 + index),
          active: true,
        })),
      };
    } else if (url.pathname.startsWith("/api/research/")) {
      body = {
        configured: false,
        provider: "mock",
        entries: [],
        snapshots: [],
        fundamentals: null,
        financials: null,
        filings: [],
        transcripts: [],
      };
    } else if (url.pathname.startsWith("/api/settings/")) {
      body = {
        source: "mock",
        preferences: {},
        settings: [],
        lanes: [],
        policy: {},
        defaults: {},
        updatedAt: now,
      };
    } else if (url.pathname.startsWith("/api/diagnostics/")) {
      body = {
        status: "ok",
        severity: "info",
        timestamp: now,
        snapshots: [],
        events: [],
        thresholds: [],
        points: [],
        ok: true,
      };
    } else if (url.pathname.startsWith("/api/backtests/")) {
      body = { strategies: [], studies: [], runs: [], jobs: [], drafts: [] };
    } else if (url.pathname.startsWith("/api/algo/")) {
      body = {
        deployments: [],
        events: [],
        options: [],
        state: null,
        performance: [],
        cockpit: null,
      };
    } else if (url.pathname.startsWith("/api/signal-monitor/")) {
      body = {
        profile: null,
        states: [],
        events: [],
        matrix: [],
        evaluatedAt: now,
      };
    } else if (
      url.pathname.startsWith("/api/accounts") ||
      url.pathname === "/api/positions" ||
      url.pathname === "/api/orders" ||
      url.pathname === "/api/executions"
    ) {
      body = {
        accounts: [
          {
            accountId: "DU1234567",
            netLiquidation: 100_000,
            cash: 75_000,
            buyingPower: 200_000,
            updatedAt: now,
          },
        ],
        positions: [],
        orders: [],
        trades: [],
        executions: [],
        points: [],
        updatedAt: now,
      };
    } else if (url.pathname === "/api/flow/events") {
      body = { events: [], source: { provider: "mock", status: "live" } };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function seedWorkspace(page: Page, initialScreen: ScreenId = "market") {
  await page.addInitScript((screen) => {
    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;

      readonly url: string;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        queueMicrotask(() => {
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        });
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: MockEventSource,
    });
    window.localStorage.setItem(
      "pyrus:state:v1",
      JSON.stringify({
        screen,
        sym: "SPY",
        sidebarCollapsed: true,
        marketGridLayout: "3x3",
      }),
    );
  }, initialScreen);
}

function installResourceTracker(page: Page) {
  let activeScreen: ScreenId | "boot" = "boot";
  const navigationStartedAt = Date.now();
  const starts = new WeakMap<Request, { screen: ScreenId | "boot"; startedAt: number }>();
  const resources: ResourceRecord[] = [];
  const apiRequests: ApiRequestRecord[] = [];

  const recordRequest = async (
    request: Request,
    failed: boolean,
    failureText: string | null,
  ) => {
    const start = starts.get(request) ?? { screen: activeScreen, startedAt: Date.now() };
    const url = request.url();

    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      path = url;
    }

    const finishedAt = Date.now();
    const startedAtMs = start.startedAt - navigationStartedAt;
    const finishedAtMs = finishedAt - navigationStartedAt;

    if (
      url.includes("/src/") ||
      url.includes("/@fs/") ||
      path.startsWith("/assets/")
    ) {
      resources.push({
        screen: start.screen,
        url,
        path,
        resourceType: request.resourceType(),
        startedAtMs,
        finishedAtMs,
        durationMs: finishedAt - start.startedAt,
        failed,
        failureText,
      });
    }

    if (path.startsWith("/api/")) {
      const response = failed ? null : await request.response().catch(() => null);
      const headers = request.headers();
      apiRequests.push({
        screen: start.screen,
        completedScreen: activeScreen,
        url,
        path,
        method: request.method(),
        resourceType: request.resourceType(),
        status: response?.status() ?? null,
        startedAtMs,
        finishedAtMs,
        durationMs: finishedAt - start.startedAt,
        failed,
        failureText,
        requestFamily: headers["x-pyrus-request-family"] ?? null,
        fetchPriority: headers["x-pyrus-fetch-priority"] ?? null,
      });
    }
  };

  page.on("request", (request) => {
    starts.set(request, { screen: activeScreen, startedAt: Date.now() });
  });
  page.on("requestfinished", (request) => {
    void recordRequest(request, false, null);
  });
  page.on("requestfailed", (request) => {
    const failureText = request.failure()?.errorText || "failed";
    if (REQUEST_CANCELLATION_RE.test(failureText)) return;
    void recordRequest(request, true, failureText);
  });

  return {
    resources,
    apiRequests,
    elapsedMs() {
      return Date.now() - navigationStartedAt;
    },
    setActiveScreen(screen: ScreenId | "boot") {
      activeScreen = screen;
    },
  };
}

async function installClientMetricObserver(page: Page) {
  await page.addInitScript((timingEventName) => {
    type RouteAuditWindow = Window & {
      __PYRUS_ROUTE_AUDIT__?: ClientMetricSnapshot;
    };
    const auditWindow = window as RouteAuditWindow;
    auditWindow.__PYRUS_ROUTE_AUDIT__ = {
      longTasks: [],
      layoutShifts: [],
      routeDataTimings: [],
    };

    const pushBounded = <T>(target: T[], value: T, max = 240) => {
      target.push(value);
      if (target.length > max) {
        target.splice(0, target.length - max);
      }
    };

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          pushBounded(auditWindow.__PYRUS_ROUTE_AUDIT__!.longTasks, {
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name || "longtask",
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long-task entries are optional in Chromium contexts.
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            value?: number;
            hadRecentInput?: boolean;
          };
          pushBounded(auditWindow.__PYRUS_ROUTE_AUDIT__!.layoutShifts, {
            startTime: entry.startTime,
            value: typeof shift.value === "number" ? shift.value : 0,
            hadRecentInput: shift.hadRecentInput === true,
          });
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
    } catch {
      // Layout-shift entries are optional in Chromium contexts.
    }

    window.addEventListener(timingEventName, (event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail !== "object") return;
      pushBounded(
        auditWindow.__PYRUS_ROUTE_AUDIT__!.routeDataTimings,
        detail as RouteDataTimingRecord,
      );
    });
  }, routeDataTimingEvent);
}

async function readClientMetricSnapshot(page: Page): Promise<ClientMetricSnapshot> {
  return page.evaluate(() => {
    type RouteAuditWindow = Window & {
      __PYRUS_ROUTE_AUDIT__?: ClientMetricSnapshot;
    };
    return (
      (window as RouteAuditWindow).__PYRUS_ROUTE_AUDIT__ ?? {
        longTasks: [],
        layoutShifts: [],
        routeDataTimings: [],
      }
    );
  });
}

async function safeReadClientMetricSnapshot(page: Page): Promise<ClientMetricSnapshot> {
  return readClientMetricSnapshot(page).catch(() => ({
    longTasks: [],
    layoutShifts: [],
    routeDataTimings: [],
  }));
}

async function waitForNavigationReady(page: Page, viewport: AuditViewport) {
  if (viewport.name === "mobile") {
    await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible({
      timeout: 30_000,
    });
    return;
  }

  await expect(page.getByTestId("platform-screen-nav")).toBeVisible({
    timeout: 30_000,
  });
}

async function navigateToScreen(
  page: Page,
  screen: ScreenDefinition,
  viewport: AuditViewport,
) {
  if (viewport.name !== "mobile") {
    await page
      .getByTestId("platform-screen-nav")
      .getByRole("button", { name: new RegExp(`^${screen.label}`) })
      .click({ timeout: 10_000 });
    return;
  }

  if (mobilePrimaryScreenIds.has(screen.id)) {
    await page.getByTestId(`mobile-bottom-nav-${screen.id}`).click({
      timeout: 10_000,
    });
    return;
  }

  await page.getByTestId("mobile-bottom-nav-more").click({ timeout: 10_000 });
  await expect(page.getByTestId("mobile-more-sheet")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId(`mobile-more-screen-${screen.id}`).click({
    timeout: 10_000,
  });
}

async function openScreen(
  page: Page,
  screen: ScreenDefinition,
  viewport: AuditViewport,
) {
  const startedAt = Date.now();
  const host = page.getByTestId(`screen-host-${screen.id}`);
  const isMounted = (await host.count()) > 0;
  const isActive =
    isMounted &&
    (await host.getAttribute("aria-hidden", { timeout: 250 }).catch(() => null)) ===
      "false";

  if (!isActive) {
    await navigateToScreen(page, screen, viewport);
  }

  await expect(host).toHaveAttribute("aria-hidden", "false", { timeout: 30_000 });
  const shellVisibleMs = Date.now() - startedAt;
  await expect(page.getByTestId(screen.readyTestId)).toBeVisible({ timeout: 30_000 });
  const readyMs = Date.now() - startedAt;
  return { shellVisibleMs, readyMs };
}

function summarizeScreenResources(
  screen: ScreenDefinition,
  resources: ResourceRecord[],
  readyAtMs: number,
  { requireCriticalResources }: { requireCriticalResources: boolean },
): Pick<
  ScreenAuditResult,
  | "criticalResources"
  | "missingCriticalResources"
  | "lateCriticalResources"
  | "lateAllowedResources"
> {
  const screenResources = resources.filter(
    (resource) => resource.screen === screen.id || resource.screen === "boot",
  );
  const criticalResources = (screen.criticalResourceFragments || []).filter((fragment) =>
    screenResources.some((resource) => resource.url.includes(fragment)),
  );
  const missingCriticalResources = requireCriticalResources
    ? (screen.criticalResourceFragments || []).filter(
        (fragment) => !criticalResources.includes(fragment),
      )
    : [];
  const lateCriticalResources = screenResources
    .filter(
      (resource) =>
        resource.startedAtMs > readyAtMs + 250 &&
        requireCriticalResources &&
        (screen.criticalResourceFragments || []).some((fragment) =>
          resource.url.includes(fragment),
        ),
    )
    .map((resource) => resource.path);
  const lateAllowedResources = screenResources
    .filter(
      (resource) =>
        resource.startedAtMs > readyAtMs + 250 &&
        (screen.allowedLateResourceFragments || []).some((fragment) =>
          resource.url.includes(fragment),
        ),
    )
    .map((resource) => resource.path);

  return {
    criticalResources,
    missingCriticalResources,
    lateCriticalResources,
    lateAllowedResources,
  };
}

function summarizeRouteMetrics({
  screen,
  apiRequests,
  clientMetrics,
  routeStartedAtMs,
  routeEndedAtMs,
}: {
  screen: ScreenDefinition;
  apiRequests: ApiRequestRecord[];
  clientMetrics: ClientMetricSnapshot;
  routeStartedAtMs: number;
  routeEndedAtMs: number;
}) {
  const routeApiRequests = apiRequests.filter(
    (request) => request.screen === screen.id || request.completedScreen === screen.id,
  );
  const slowApiRequests = routeApiRequests
    .filter((request) => request.durationMs >= 1_000 || request.failed)
    .map((request) => {
      const status = request.status ?? (request.failed ? "failed" : "pending");
      const priority = request.fetchPriority ? ` p${request.fetchPriority}` : "";
      const family = request.requestFamily ? ` ${request.requestFamily}` : "";
      return `${request.method} ${request.path} ${status} ${round(request.durationMs)}ms${priority}${family}`;
    });
  const longTasks = clientMetrics.longTasks.filter(
    (entry) =>
      entry.startTime >= routeStartedAtMs && entry.startTime <= routeEndedAtMs,
  );
  const layoutShifts = clientMetrics.layoutShifts.filter(
    (entry) =>
      !entry.hadRecentInput &&
      entry.startTime >= routeStartedAtMs &&
      entry.startTime <= routeEndedAtMs,
  );
  const routeDataTimings = clientMetrics.routeDataTimings.filter(
    (entry) => entry.screenId === screen.id,
  );

  return {
    apiRequestCount: routeApiRequests.length,
    slowApiRequests,
    longTaskCount: longTasks.length,
    longTaskTotalMs: round(
      longTasks.reduce((sum, entry) => sum + entry.duration, 0),
    ),
    maxLongTaskMs: round(
      longTasks.reduce((max, entry) => Math.max(max, entry.duration), 0),
    ),
    layoutShiftScore: round(
      layoutShifts.reduce((sum, entry) => sum + entry.value, 0),
      4,
    ),
    routeDataStages: Array.from(
      new Set(
        routeDataTimings.map(
          (entry) => `${entry.stage}:${Math.round(entry.durationMs)}ms`,
        ),
      ),
    ).slice(0, 8),
  };
}

async function findVisibleFallbacks(page: Page, screen: ScreenDefinition) {
  const visibleFallbacks: string[] = [];
  for (const testId of screen.stuckFallbackTestIds || []) {
    const fallback = page.getByTestId(testId).first();
    if ((await fallback.count().catch(() => 0)) > 0 && (await fallback.isVisible().catch(() => false))) {
      visibleFallbacks.push(testId);
    }
  }
  return visibleFallbacks;
}

async function runRouteAudit(
  page: Page,
  testInfo: TestInfo,
  scenario: AuditScenario,
) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const navigationEvents: NavigationEventRecord[] = [];
  let activeNavigationScreen: ScreenId | "boot" = "boot";
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to load resource")) return;
    consoleErrors.push(text);
  });

  await page.setViewportSize(scenario.viewport.size);
  await seedWorkspace(page);
  await installClientMetricObserver(page);
  if (scenario.mockApi) {
    await installMockApi(page);
  }
  const tracker = installResourceTracker(page);
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      path = url;
    }
    navigationEvents.push({
      screen: activeNavigationScreen,
      url,
      path,
      elapsedMs: tracker.elapsedMs(),
    });
  });

  const results: ScreenAuditResult[] = [];
  const attachReport = async (
    status:
      | { kind: "completed" }
      | { kind: "failed"; error: { message: string; stack?: string } },
  ) => {
    const finalClientMetrics = await safeReadClientMetricSnapshot(page);
    const sourceResourceCount = tracker.resources.filter(
      (resource) =>
        resource.path.startsWith("/src/") || resource.path.startsWith("/@fs/"),
    ).length;
    const productionAssetCount = tracker.resources.filter((resource) =>
      resource.path.startsWith("/assets/"),
    ).length;
    const report = {
      generatedAt: new Date().toISOString(),
      status,
      activeScreen: activeNavigationScreen,
      scenario,
      results,
      resourceSummary: {
        resourceCount: tracker.resources.length,
        sourceResourceCount,
        productionAssetCount,
        apiRequestCount: tracker.apiRequests.length,
        longTaskCount: finalClientMetrics.longTasks.length,
        layoutShiftCount: finalClientMetrics.layoutShifts.length,
        routeDataTimingCount: finalClientMetrics.routeDataTimings.length,
        navigationEventCount: navigationEvents.length,
      },
      navigationEvents,
      resources: tracker.resources,
      apiRequests: tracker.apiRequests,
      clientMetrics: finalClientMetrics,
      pageErrors,
      consoleErrors,
    };
    await testInfo.attach(`app-waterfall-audit-${scenario.name}.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    return report;
  };

  try {
    await page.goto("/?pyrusQa=safe", { waitUntil: "domcontentloaded" });
    await waitForNavigationReady(page, scenario.viewport);

    for (const screen of screens) {
      activeNavigationScreen = screen.id;
      tracker.setActiveScreen(screen.id);
      const beforeCount = tracker.resources.length;
      const routeStartedAtMs = tracker.elapsedMs();
      const routeStartedPerfMs = await page.evaluate(() => performance.now());
      const navigation = await openScreen(page, screen, scenario.viewport);
      await page.waitForTimeout(500);
      const routeEndedPerfMs = await page.evaluate(() => performance.now());
      const clientMetrics = await readClientMetricSnapshot(page);
      const summary = summarizeScreenResources(
        screen,
        tracker.resources.slice(0),
        routeStartedAtMs + navigation.readyMs,
        { requireCriticalResources: scenario.requireCriticalResources },
      );
      const routeMetricSummary = summarizeRouteMetrics({
        screen,
        apiRequests: tracker.apiRequests.slice(0),
        clientMetrics,
        routeStartedAtMs: routeStartedPerfMs,
        routeEndedAtMs: routeEndedPerfMs,
      });
      const stuckFallbacks = await findVisibleFallbacks(page, screen);
      results.push({
        id: screen.id,
        label: screen.label,
        viewport: scenario.viewport.name,
        mode: scenario.mode,
        primaryTask: screen.primaryTask,
        firstViewportContract: screen.firstViewportContract,
        shellVisibleMs: round(navigation.shellVisibleMs),
        readyMs: round(navigation.readyMs),
        resourceCount: tracker.resources.length - beforeCount,
        apiRequestCount: routeMetricSummary.apiRequestCount,
        slowApiRequests: routeMetricSummary.slowApiRequests,
        longTaskCount: routeMetricSummary.longTaskCount,
        longTaskTotalMs: routeMetricSummary.longTaskTotalMs,
        maxLongTaskMs: routeMetricSummary.maxLongTaskMs,
        layoutShiftScore: routeMetricSummary.layoutShiftScore,
        routeDataStages: routeMetricSummary.routeDataStages,
        criticalResources: summary.criticalResources,
        missingCriticalResources: summary.missingCriticalResources,
        lateCriticalResources: summary.lateCriticalResources,
        lateAllowedResources: summary.lateAllowedResources,
        stuckFallbacks,
      });
    }
  } catch (error) {
    await attachReport({
      kind: "failed",
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { message: String(error) },
    });
    throw error;
  }

  const report = await attachReport({ kind: "completed" });
  console.log(
    `[app-waterfall-audit:${scenario.name}] ${JSON.stringify(
      results.map((result) => ({
        id: result.id,
        viewport: result.viewport,
        shellVisibleMs: result.shellVisibleMs,
        readyMs: result.readyMs,
        resourceCount: result.resourceCount,
        apiRequestCount: result.apiRequestCount,
        maxLongTaskMs: result.maxLongTaskMs,
        layoutShiftScore: result.layoutShiftScore,
        lateAllowedCount: result.lateAllowedResources.length,
      })),
    )}`,
  );

  if (!scenario.failInvariants) {
    return report;
  }

  const missingCritical = results.flatMap((result) =>
    result.missingCriticalResources.map(
      (fragment) => `${result.id}: missing critical resource ${fragment}`,
    ),
  );
  const lateCritical = results.flatMap((result) =>
    result.lateCriticalResources.map(
      (path) => `${result.id}: late critical resource ${path}`,
    ),
  );
  const stuckFallbacks = results.flatMap((result) =>
    result.stuckFallbacks.map((testId) => `${result.id}: stuck fallback ${testId}`),
  );

  expect(pageErrors, `${scenario.name}: page errors during route audit`).toEqual([]);
  expect(consoleErrors, `${scenario.name}: console errors during route audit`).toEqual([]);
  expect(
    missingCritical,
    `${scenario.name}: critical first-viewport chunks should be observed`,
  ).toEqual([]);
  expect(
    lateCritical,
    `${scenario.name}: critical first-viewport chunks should not start after route ready`,
  ).toEqual([]);
  expect(
    stuckFallbacks,
    `${scenario.name}: first-viewport loading fallbacks should not remain visible`,
  ).toEqual([]);
  if (scenario.expectProductionAssets) {
    expect(
      report.resourceSummary.productionAssetCount,
      `${scenario.name}: production route audit should load built assets`,
    ).toBeGreaterThan(0);
    expect(
      report.resourceSummary.sourceResourceCount,
      `${scenario.name}: production route audit should not load Vite source modules`,
    ).toBe(0);
  }

  return report;
}

const mockedScenarios: AuditScenario[] = [
  {
    name: expectProductionAssets ? "desktop-production-mocked" : "desktop-mocked",
    mode: "mocked",
    viewport: defaultViewport,
    mockApi: true,
    failInvariants: true,
    requireCriticalResources: !expectProductionAssets,
    expectProductionAssets,
  },
  {
    name: expectProductionAssets ? "mobile-production-mocked" : "mobile-mocked",
    mode: "mocked",
    viewport: mobileViewport,
    mockApi: true,
    failInvariants: true,
    requireCriticalResources: !expectProductionAssets,
    expectProductionAssets,
  },
];

for (const scenario of mockedScenarios) {
  test(`audits ${scenario.name} app routes for loading waterfalls and UX metrics`, async ({
    page,
  }, testInfo: TestInfo) => {
    await runRouteAudit(page, testInfo, scenario);
  });
}

test("observes live backend route waterfalls without enforcing baseline budgets", async ({
  page,
}, testInfo: TestInfo) => {
  test.skip(
    process.env.PYRUS_ROUTE_AUDIT_LIVE !== "1",
    "Set PYRUS_ROUTE_AUDIT_LIVE=1 to run the live backend observational sweep.",
  );
  await runRouteAudit(page, testInfo, {
    name: "desktop-live-observational",
    mode: "live",
    viewport: defaultViewport,
    mockApi: false,
    failInvariants: false,
    requireCriticalResources: !expectProductionAssets,
    expectProductionAssets,
  });
});

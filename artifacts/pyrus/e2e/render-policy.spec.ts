import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

const STORAGE_KEY = "pyrus:state:v1";
const mockNow = Date.parse("2026-05-28T14:30:00.000Z");
const symbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"];

type WarmupSnapshot = {
  activeScreen: string;
  firstScreenReady: boolean;
  screenWarmupPhase: string;
  mountedScreens: string[];
  screenReadiness?: Record<string, { frameReady?: boolean }>;
};

function nowIso() {
  return new Date(mockNow).toISOString();
}

function makeBars(symbol: string, limit = 80) {
  const base = 100 + Math.max(0, symbols.indexOf(symbol)) * 10;
  return Array.from({ length: Math.max(20, Math.min(limit, 120)) }, (_, index) => {
    const close = base + Math.sin(index / 7) * 1.25 + index * 0.03;
    return {
      timestamp: new Date(mockNow - (limit - index) * 60_000).toISOString(),
      open: close - 0.4,
      high: close + 0.8,
      low: close - 0.9,
      close,
      volume: 1_000_000 + index * 2_000,
      source: "mock-history",
      freshness: "live",
      marketDataMode: "live",
      delayed: false,
    };
  });
}

async function installRenderPolicyBootState(page: Page) {
  await page.addInitScript(({ storageKey }) => {
    const warmupWindow = window as Window & {
      __PYRUS_PERF_WARMUP_OVERRIDES__?: {
        disableOperationalCodePreload?: boolean;
        disableHiddenScreenWarmMount?: boolean;
        disableBackgroundDataWarmup?: boolean;
        disableResearchWorkspacePreload?: boolean;
      };
    };
    warmupWindow.__PYRUS_PERF_WARMUP_OVERRIDES__ = {
      disableOperationalCodePreload: true,
      disableHiddenScreenWarmMount: true,
      disableBackgroundDataWarmup: true,
      disableResearchWorkspacePreload: true,
    };

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        sidebarCollapsed: false,
        activitySidebarCollapsed: false,
      }),
    );

    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = MockEventSource.CLOSED;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        window.setTimeout(() => {
          const event = new Event("error");
          this.dispatchEvent(event);
          this.onerror?.(event);
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
  }, { storageKey: STORAGE_KEY });
}

async function installRenderPolicyMockApi(page: Page) {
  await page.route("**/*tradingview.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (
      url.pathname.includes("/streams/") ||
      url.pathname === "/api/diagnostics/client-events" ||
      url.pathname === "/api/diagnostics/client-metrics"
    ) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    let body: unknown = {};

    if (url.pathname === "/api/session") {
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        marketDataProviders: { live: "ibkr", historical: "ibkr", research: "mock" },
        configured: { polygon: false, ibkr: false, research: false },
        ibkrBridge: null,
        timestamp: nowIso(),
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
              addedAt: nowIso(),
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
          updatedAt: nowIso(),
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
    } else if (url.pathname === "/api/flow/events") {
      body = {
        events: [],
        source: { provider: "mock", status: "live", fallbackUsed: false },
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
        updatedAt: nowIso(),
        admission: {
          activeLineCount: 0,
          accountMonitorLineCount: 0,
          accountMonitorRemainingLineCount: 20,
          flowScannerLineCount: 0,
          budget: { maxLines: 0, accountMonitorLineCap: 20, flowScannerLineCap: 0 },
          poolUsage: {},
          counters: {},
        },
        bridge: { diagnostics: null, error: null },
        streams: { quoteStreams: {}, optionQuoteStreams: {}, stockAggregates: {} },
        drift: { admissionVsBridgeLineDelta: null },
      };
    } else if (url.pathname.startsWith("/api/diagnostics/")) {
      body = {
        status: "ok",
        severity: "info",
        timestamp: nowIso(),
        snapshots: [],
        events: [],
        thresholds: [],
        points: [],
        ok: true,
        providers: {},
        ibkr: { configured: false, connected: false, authenticated: false },
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
        evaluatedAt: nowIso(),
      };
    } else if (
      url.pathname.startsWith("/api/accounts") ||
      url.pathname === "/api/positions" ||
      url.pathname === "/api/orders" ||
      url.pathname === "/api/executions"
    ) {
      body = {
        accounts: [],
        positions: [],
        orders: [],
        trades: [],
        executions: [],
        points: [],
        updatedAt: nowIso(),
      };
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

async function readWarmupSnapshot(page: Page): Promise<WarmupSnapshot | null> {
  return page.evaluate(() => {
    return (
      window as Window & {
        __PYRUS_PERF_WARMUP_SNAPSHOT__?: WarmupSnapshot;
      }
    ).__PYRUS_PERF_WARMUP_SNAPSHOT__ ?? null;
  });
}

test("delayed active screen module keeps the app frame visible until the screen renders", async ({
  page,
}) => {
  await installRenderPolicyBootState(page);
  await installRenderPolicyMockApi(page);

  let releaseMarketModule: () => void = () => {};
  let resolveMarketModuleRequest: () => void = () => {};
  const moduleRequestStarted = new Promise<void>((resolve) => {
    resolveMarketModuleRequest = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    releaseMarketModule = resolve;
  });
  let heldFirstMarketModule = false;

  await page.route("**/src/screens/MarketScreen.jsx*", async (route) => {
    if (!heldFirstMarketModule && route.request().resourceType() === "script") {
      heldFirstMarketModule = true;
      resolveMarketModuleRequest();
      await releasePromise;
    }
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await moduleRequestStarted;

  await expect(page.getByTestId("platform-compact-header")).toBeVisible();
  await expect(page.getByTestId("platform-screen-nav")).toBeVisible();
  await expect(page.getByTestId("platform-watchlist-sidebar")).toBeVisible();
  await expect(page.getByTestId("platform-activity-sidebar")).toBeVisible();
  await expect(page.getByTestId("screen-loading-fallback")).toHaveAttribute(
    "aria-label",
    "Loading market",
  );
  await expect(page.getByTestId("market-workspace")).toHaveCount(0);

  await expect
    .poll(async () => (await readWarmupSnapshot(page))?.firstScreenReady ?? null)
    .toBe(false);

  const beforeReleaseSnapshot = await readWarmupSnapshot(page);
  expect(beforeReleaseSnapshot?.activeScreen).toBe("market");
  expect(beforeReleaseSnapshot?.screenWarmupPhase).not.toBe("ready");
  expect(beforeReleaseSnapshot?.screenReadiness?.market?.frameReady).not.toBe(true);

  releaseMarketModule();

  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("screen-loading-fallback")).toHaveCount(0);

  await expect
    .poll(async () => {
      const snapshot = await readWarmupSnapshot(page);
      return {
        firstScreenReady: snapshot?.firstScreenReady ?? false,
        screenWarmupPhase: snapshot?.screenWarmupPhase ?? "missing",
        marketFrameReady: snapshot?.screenReadiness?.market?.frameReady === true,
      };
    })
    .toEqual({
      firstScreenReady: true,
      screenWarmupPhase: "ready",
      marketFrameReady: true,
    });
});

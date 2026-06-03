import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const nowIso = "2026-05-20T16:00:00.000Z";
const signalAt = "2026-05-20T15:30:00.000Z";

const bars = Array.from({ length: 36 }, (_, index) => {
  const timestampMs = Date.parse(signalAt) - (20 - index) * 5 * 60_000;
  const base = 150 + index * 0.18;
  return {
    timestamp: new Date(timestampMs).toISOString(),
    open: base,
    high: base + 0.8,
    low: base - 0.6,
    close: base + Math.sin(index / 2) * 0.35,
    volume: 400_000 + index * 5_000,
    symbol: "AAPL",
  };
});

const signalState = {
  symbol: "AAPL",
  timeframe: "5m",
  currentSignalDirection: "buy",
  currentSignalAt: signalAt,
  currentSignalPrice: 153.24,
  latestBarAt: nowIso,
  barsSinceSignal: 6,
  fresh: true,
  active: true,
  status: "ok",
  lastEvaluatedAt: nowIso,
  filterState: {
    adx: 28,
    mtfDirections: [1, 1, 1],
  },
};

async function installMockApi(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readonly url: string;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
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
          strictReady: true,
          configuredLiveMarketDataMode: true,
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
            items: [{ id: "default-AAPL", symbol: "AAPL", name: "AAPL", sortOrder: 0, addedAt: nowIso }],
          },
        ],
      };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = {
        id: "signal-profile",
        environment: "paper",
        enabled: true,
        watchlistId: "default",
        timeframe: "5m",
        pyrusSignalsSettings: {},
        freshWindowBars: 8,
        pollIntervalSeconds: 60,
        maxSymbols: 50,
        evaluationConcurrency: 3,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = {
        profile: { id: "signal-profile", environment: "paper", timeframe: "5m", freshWindowBars: 8 },
        states: [signalState],
        events: [],
        evaluatedAt: nowIso,
      };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = {
        events: [
          {
            id: "event-aapl-buy",
            symbol: "AAPL",
            timeframe: "5m",
            direction: "buy",
            signalAt,
            emittedAt: signalAt,
            source: "mock",
          },
        ],
      };
    } else if (url.pathname === "/api/signal-monitor/matrix") {
      body = {
        states: ["2m", "5m", "15m"].map((timeframe) => ({
          ...signalState,
          timeframe,
          barsSinceSignal: timeframe === "2m" ? 1 : signalState.barsSinceSignal,
        })),
        timeframes: ["2m", "5m", "15m"],
        evaluatedAt: nowIso,
        skippedSymbols: [],
        truncated: false,
      };
    } else if (url.pathname === "/api/bars") {
      body = {
        bars,
        dataSource: "ibkr-history",
        historySource: "ibkr-history",
        freshness: "live",
        marketDataMode: "live",
      };
    } else if (url.pathname === "/api/settings/preferences") {
      body = { source: "mock", preferences: {}, updatedAt: nowIso };
    } else if (url.pathname === "/api/diagnostics/latest") {
      body = { status: "ok", severity: "info", timestamp: nowIso, snapshots: [], events: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("signals drilldown chart shows signal clock time and elapsed age", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 860 });
  await installMockApi(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "pyrus:state:v1",
      JSON.stringify({
        screen: "signals",
        sym: "AAPL",
        theme: "dark",
        sidebarCollapsed: true,
      }),
    );
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("signals-screen")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("signals-table-row").first().click();

  const chart = page.getByTestId("signals-drilldown-price-chart");
  await expect(chart).toBeVisible({ timeout: 30_000 });
  await expect(chart).toContainText("Signal Time");
  await expect(chart).toContainText("Since");
  await expect(chart).toContainText("BUY");
  await expect(chart).toContainText("since");
});

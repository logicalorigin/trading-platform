import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const symbols = ["SPY", "QQQ", "NVDA"];

function signalProfile(enabled: boolean) {
  const now = new Date().toISOString();
  return {
    id: "signal-profile",
    environment: "paper",
    enabled,
    watchlistId: "default",
    timeframe: "15m",
    rayReplicaSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 60,
    maxSymbols: 50,
    evaluationConcurrency: 3,
    lastEvaluatedAt: enabled ? now : null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

function signalState() {
  const now = new Date().toISOString();
  return {
    id: "spy-state",
    profileId: "signal-profile",
    symbol: "SPY",
    timeframe: "15m",
    currentSignalDirection: "buy",
    currentSignalAt: now,
    currentSignalPrice: 510.25,
    latestBarAt: now,
    barsSinceSignal: 0,
    fresh: true,
    active: true,
    status: "ok",
    lastEvaluatedAt: now,
    lastError: null,
  };
}

function makeBars(symbol: string) {
  const now = Date.now();
  const base = symbol === "QQQ" ? 438 : symbol === "NVDA" ? 905 : 510;
  return Array.from({ length: 72 }, (_, index) => ({
    timestamp: new Date(now - (71 - index) * 60_000).toISOString(),
    open: base + index * 0.01,
    high: base + 1,
    low: base - 1,
    close: base + index * 0.01,
    volume: 100_000 + index * 1_000,
    source: "mock",
  }));
}

function flowEvent(symbol: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${symbol}-${overrides.right || "call"}-${overrides.strike || 510}`,
    provider: "ibkr",
    basis: "snapshot",
    underlying: symbol,
    optionTicker: `${symbol}-OPT`,
    right: "call",
    strike: symbol === "QQQ" ? 438 : 510,
    expirationDate: "2026-05-15",
    occurredAt: new Date().toISOString(),
    side: "buy",
    sentiment: "bullish",
    premium: 250_000,
    size: 35,
    openInterest: 20,
    impliedVolatility: 0.32,
    isUnusual: true,
    unusualScore: 2.8,
    tradeConditions: [],
    ...overrides,
  };
}

async function mockHeaderApi(
  page: Page,
  { signalMonitorEnabled = true }: { signalMonitorEnabled?: boolean } = {},
) {
  const apiState = {
    signalMonitorEnabled,
    profileUpdates: [] as Array<Record<string, unknown>>,
    evaluations: [] as Array<Record<string, unknown>>,
  };

  const signalStateResponse = () => ({
    profile: signalProfile(apiState.signalMonitorEnabled),
    states: apiState.signalMonitorEnabled ? [signalState()] : [],
    evaluatedAt: new Date().toISOString(),
    truncated: false,
    skippedSymbols: [],
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body: unknown = {};

    if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.pathname === "/api/session") {
      body = {
        configured: { ibkr: false, research: false },
        ibkrBridge: {
          authenticated: false,
          connected: false,
          liveMarketDataAvailable: false,
          transport: "ib-gateway",
        },
        environment: "paper",
        marketDataProviders: {},
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [
          {
            id: "default",
            name: "Default",
            isDefault: true,
            symbols,
          },
        ],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const requested = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol) => ({
          symbol,
          price: symbol === "QQQ" ? 438 : symbol === "NVDA" ? 905 : 510,
          prevClose: symbol === "QQQ" ? 436 : symbol === "NVDA" ? 900 : 508,
          change: 2,
          changePercent: 0.4,
          volume: 50_000_000,
          updatedAt: new Date().toISOString(),
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/bars") {
      body = {
        bars: makeBars((url.searchParams.get("symbol") || "SPY").toUpperCase()),
      };
    } else if (url.pathname === "/api/flow/events") {
      const symbol = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      body = {
        events:
          symbol === "QQQ"
            ? [
                flowEvent("QQQ", {
                  right: "put",
                  strike: 438,
                  side: "buy",
                  sentiment: "bearish",
                  premium: 310_000,
                  unusualScore: 3.1,
                }),
              ]
            : [],
        source: {
          provider: "ibkr",
          status: "live",
          fallbackUsed: false,
        },
      };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      if (method === "PUT") {
        const requestBody = route.request().postDataJSON?.() || {};
        apiState.profileUpdates.push(requestBody);
        if (typeof requestBody.enabled === "boolean") {
          apiState.signalMonitorEnabled = requestBody.enabled;
        }
      }
      body = signalProfile(apiState.signalMonitorEnabled);
    } else if (url.pathname === "/api/signal-monitor/evaluate") {
      const requestBody = route.request().postDataJSON?.() || {};
      apiState.evaluations.push(requestBody);
      body = signalStateResponse();
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = signalStateResponse();
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/options/expirations") {
      body = {
        underlying: url.searchParams.get("underlying") || "QQQ",
        expirations: [{ expirationDate: "2026-05-15" }],
      };
    } else if (url.pathname === "/api/options/chains") {
      body = {
        underlying: url.searchParams.get("underlying") || "QQQ",
        expirationDate: url.searchParams.get("expirationDate") || "2026-05-15",
        contracts: [],
      };
    } else if (url.pathname === "/api/options/chains/batch") {
      body = {
        underlying: "QQQ",
        results: [],
      };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  return apiState;
}

async function openPlatform(page: Page) {
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
      }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test("header broadcast scrollers render and open Trade from tape items", async ({
  page,
}) => {
  await mockHeaderApi(page);
  await openPlatform(page);

  await expect(page.getByTestId("header-broadcast-scrollers")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("header-unusual-broad-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("header-signal-tape")).toContainText("BUY");
  await expect(page.getByTitle("SPY BUY 15m")).toBeVisible();
  await expect(page.getByTestId("header-unusual-tape")).toContainText("QQQ", {
    timeout: 15_000,
  });
  await expect(
    page.getByTestId("header-unusual-tape").locator("button").first(),
  ).toHaveText("FLOW");

  await page.getByTitle("SPY BUY 15m").click();
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTitle(/QQQ unusual/).click();
  await expect(page.getByText(/QQQ 05\/15 438 P/)).toBeVisible({
    timeout: 15_000,
  });
});

test("signals radio tower controls the monitor scan state", async ({ page }) => {
  const api = await mockHeaderApi(page, { signalMonitorEnabled: false });
  await openPlatform(page);

  const signalLane = page.getByTestId("header-signal-tape");
  const signalTower = page.getByTestId("header-signal-scan-toggle");

  await expect(page.getByTestId("header-broadcast-scrollers")).toBeVisible({
    timeout: 30_000,
  });
  await expect(signalLane).toContainText("SIGNALS OFF");
  await expect(signalTower).toHaveAttribute("aria-pressed", "false");

  await signalTower.click();
  await expect
    .poll(() => api.profileUpdates.at(-1)?.enabled)
    .toBe(true);
  await expect.poll(() => api.evaluations.length).toBe(1);
  await expect(signalTower).toHaveAttribute("aria-pressed", "true");
  await expect(signalLane).toContainText("BUY");

  await page.getByTestId("header-signal-tape-settings-trigger").click();
  const settingsToggle = page.getByTestId("header-signal-scan-settings-toggle");
  await expect(settingsToggle).toHaveAttribute("aria-pressed", "true");
  await expect(settingsToggle).toContainText("Signal Scan On");

  await settingsToggle.click();
  await expect
    .poll(() => api.profileUpdates.at(-1)?.enabled)
    .toBe(false);
  await expect.poll(() => api.evaluations.length).toBe(1);
  await expect(signalTower).toHaveAttribute("aria-pressed", "false");
});

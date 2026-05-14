import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const symbols = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "IWM"];
const fifteenMinuteMs = 15 * 60_000;
const chartNowMs = Math.floor(Date.now() / fifteenMinuteMs) * fifteenMinuteMs;
const chartBarIso = (index: number) =>
  new Date(chartNowMs - (71 - index) * fifteenMinuteMs).toISOString();

const quoteData: Record<
  string,
  { price: number; change: number; changePercent: number; volume: number }
> = {
  SPY: { price: 510.25, change: 2.1, changePercent: 0.41, volume: 62_000_000 },
  QQQ: { price: 438.8, change: -1.45, changePercent: -0.33, volume: 41_000_000 },
  NVDA: { price: 905.5, change: 18.2, changePercent: 2.05, volume: 72_000_000 },
  TSLA: { price: 210.2, change: -4.9, changePercent: -2.28, volume: 95_000_000 },
  AAPL: { price: 188.1, change: 0.48, changePercent: 0.26, volume: 51_000_000 },
  IWM: { price: 202.42, change: 0.12, changePercent: 0.06, volume: 28_000_000 },
};

type MarketGridTestOptions = {
  showVolume?: boolean;
  includeConfirmedHistory?: boolean;
  workspaceState?: Record<string, unknown>;
};

const buildTestUserPreferences = (options: MarketGridTestOptions = {}) => ({
  appearance: { theme: "dark" },
  chart: { showVolume: options.showVolume ?? true },
});

function makeBars(symbol: string) {
  const base = quoteData[symbol]?.price ?? 100;
  return Array.from({ length: 72 }, (_, index) => {
    const close = base + Math.sin(index / 5) * 1.8;
    const open = close - Math.cos(index / 4) * 0.7;
    return {
      timestamp: chartBarIso(index),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 120_000 + index * 2_500,
      source: "mock",
    };
  });
}

function flowEvent(symbol: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${symbol}-${overrides.right || "call"}-${overrides.strike || 510}`,
    provider: "ibkr",
    basis: "snapshot",
    underlying: symbol,
    optionTicker: `${symbol}-OPT`,
    right: "call",
    strike: quoteData[symbol]?.price ?? 100,
    expirationDate: "2026-05-15",
    occurredAt: chartBarIso(70),
    side: "buy",
    sentiment: "bullish",
    premium: 250_000,
    size: 35,
    openInterest: 20,
    impliedVolatility: 0.32,
    isUnusual: false,
    unusualScore: 0,
    tradeConditions: [],
    ...overrides,
  };
}

async function mockMarketApi(
  page: Page,
  flowUrls: string[],
  options: MarketGridTestOptions = {},
) {
  const userPreferences = buildTestUserPreferences(options);

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
          transport: "ib-gateway",
        },
        environment: "paper",
        marketDataProviders: {},
      };
    } else if (url.pathname === "/api/settings/preferences") {
      body = {
        profileKey: "default",
        version: 1,
        preferences: userPreferences,
        source: "local",
        updatedAt: new Date(0).toISOString(),
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
        quotes: requested.map((symbol) => {
          const quote = quoteData[symbol] ?? {
            price: 100,
            change: 0,
            changePercent: 0,
            volume: 100_000,
          };
          return {
            symbol,
            price: quote.price,
            prevClose: quote.price - quote.change,
            change: quote.change,
            changePercent: quote.changePercent,
            volume: quote.volume,
            updatedAt: new Date().toISOString(),
            delayed: false,
          };
        }),
      };
    } else if (url.pathname === "/api/bars") {
      body = {
        bars: makeBars((url.searchParams.get("symbol") || "SPY").toUpperCase()),
      };
    } else if (url.pathname === "/api/flow/events/aggregate") {
      body = {
        events: symbols.flatMap((symbol) => [
          flowEvent(symbol, {
            id: `${symbol}-snapshot-primary`,
            provider: "ibkr",
            basis: "snapshot",
            sourceBasis: "snapshot_activity",
            premium: symbol === "SPY" ? 1_000_000 : 250_000,
            strike: quoteData[symbol]?.price ?? 100,
            right: ["QQQ", "TSLA", "IWM"].includes(symbol) ? "put" : "call",
            sentiment: ["QQQ", "TSLA", "IWM"].includes(symbol)
              ? "bearish"
              : "bullish",
            isUnusual: true,
            unusualScore: 2.4,
          }),
        ]),
        source: {
          provider: "ibkr",
          status: "live",
          fallbackUsed: false,
          attemptedProviders: ["ibkr"],
          unusualThreshold: 1,
          scannerCoverage: {
            mode: "all_watchlists_plus_universe",
            targetSize: symbols.length,
            activeTargetSize: symbols.length,
            selectedSymbols: symbols.length,
            selectedShortfall: 0,
            fallbackUsed: false,
            stale: false,
            cooldownCount: 0,
            scannedSymbols: symbols.length,
            cycleScannedSymbols: symbols.length,
            currentBatch: symbols,
            degradedReason: null,
          },
        },
      };
    } else if (url.pathname === "/api/flow/events") {
      flowUrls.push(url.toString());
      const symbol = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      const scope = url.searchParams.get("scope") || "all";
      const limit = Number(url.searchParams.get("limit") || "0");
      const lineBudget = Number(url.searchParams.get("lineBudget") || "0");
      const historicalWindow =
        url.searchParams.has("from") || url.searchParams.has("to");
      await new Promise((resolve) => setTimeout(resolve, 450));
      const confirmedHistoryEvents: Record<string, unknown[]> = {
        SPY: [
          flowEvent("SPY", {
            id: "SPY-confirmed-history",
            provider: "polygon",
            basis: "trade",
            sourceBasis: "confirmed_trade",
            occurredAt: chartBarIso(24),
            premium: 125_000,
            size: 25,
            strike: 510,
            right: "call",
            optionTicker: "SPYC510",
            isUnusual: true,
            unusualScore: 1.4,
          }),
        ],
      };
      const eventsBySymbol: Record<string, unknown[]> = {
        SPY: [
          flowEvent("SPY", {
            id: "SPY-confirmed-call",
            provider: "polygon",
            sourceBasis: "confirmed_trade",
            occurredAt: chartBarIso(44),
            premium: 350_000,
            strike: 510,
            right: "call",
            optionTicker: "SPYC510",
            isUnusual: true,
            unusualScore: 2.4,
          }),
          flowEvent("SPY", {
            id: "SPY-confirmed-put",
            provider: "polygon",
            basis: "trade",
            sourceBasis: "confirmed_trade",
            occurredAt: chartBarIso(52),
            premium: 90_000,
            strike: 505,
            right: "put",
            optionTicker: "SPYP505",
            side: "buy",
            sentiment: "bearish",
          }),
          flowEvent("SPY", {
            id: "SPY-confirmed-neutral",
            provider: "polygon",
            basis: "trade",
            sourceBasis: "confirmed_trade",
            occurredAt: chartBarIso(56),
            premium: 70_000,
            strike: 512,
            right: "call",
            optionTicker: "SPYC512",
            side: "mid",
            sentiment: "neutral",
          }),
          flowEvent("SPY", {
            id: "SPY-snapshot-neutral",
            premium: 700_000,
            strike: 512,
            right: "call",
            optionTicker: "SPYC512",
            side: "mid",
            sentiment: "neutral",
          }),
        ],
        QQQ: [
          flowEvent("QQQ", {
            id: "QQQ-confirmed-put",
            provider: "polygon",
            basis: "trade",
            sourceBasis: "confirmed_trade",
            occurredAt: chartBarIso(48),
            premium: 310_000,
            strike: 438,
            right: "put",
            side: "buy",
            sentiment: "bearish",
            isUnusual: true,
            unusualScore: 2.8,
          }),
        ],
        NVDA: [
          flowEvent("NVDA", {
            premium: 640_000,
            strike: 910,
            right: "call",
            isUnusual: true,
            unusualScore: 3.4,
          }),
        ],
      };
      body = {
        events:
          scope === "all" && historicalWindow && options.includeConfirmedHistory
            ? confirmedHistoryEvents[symbol] || []
            : scope === "all" && !historicalWindow && options.includeConfirmedHistory
              ? eventsBySymbol[symbol] || []
            : scope === "all" &&
                ((limit >= 80 && lineBudget === 40) ||
                  (historicalWindow && limit >= 1_000))
              ? eventsBySymbol[symbol] || []
              : [],
        source: {
          provider: "ibkr",
          status: "live",
          fallbackUsed: false,
          unusualThreshold: 1,
        },
      };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = { enabled: true, timeframe: "15m", watchlistId: "default" };
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

async function openMarketGrid(
  page: Page,
  options: MarketGridTestOptions = {},
) {
  await page.addInitScript(({ gridSymbols, userPreferences, workspaceState }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        userPreferences,
        sidebarCollapsed: true,
        marketUnusualThreshold: 2,
        marketGridLayout: "2x3",
        marketGridSlots: gridSymbols.map((ticker) => ({
          ticker,
          tf: "15m",
          studies: ["ema21", "vwap", "rayReplica"],
        })),
        ...workspaceState,
      }),
    );
  }, {
    gridSymbols: symbols,
    userPreferences: buildTestUserPreferences(options),
    workspaceState: options.workspaceState || {},
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-chart-grid")).toBeVisible({
    timeout: 30_000,
  });
}

test("Market chart flow markers expose semantic tones", async ({ page }) => {
  const flowUrls: string[] = [];
  await mockMarketApi(page, flowUrls, { showVolume: false });
  await openMarketGrid(page, { showVolume: false });
  await expect(
    page.getByTestId("market-mini-chart-0-surface-market-closed-overlay"),
  ).toHaveCount(0);

  const spyMarker = page.getByTestId("market-mini-chart-0-surface-chart-event").first();
  await expect(spyMarker).toBeVisible({ timeout: 30_000 });
  await expect(spyMarker).toHaveAttribute("data-chart-event-type", "unusual_flow");
  await expect(spyMarker).toHaveAttribute("data-chart-flow-marker-tone", "bullish");
  await expect(spyMarker).toHaveAttribute(
    "data-chart-flow-marker-basis",
    "confirmed_trade",
  );
  await expect(spyMarker).toHaveAttribute(
    "data-chart-flow-event-time",
    chartBarIso(44),
  );
  await expect(spyMarker).toHaveAttribute(
    "data-chart-flow-event-day",
    /^\d{4}-\d{2}-\d{2}$/,
  );
  await expect(spyMarker).toHaveCSS("color", "rgb(16, 185, 129)");
  await spyMarker.hover();
  const spyTooltip = page.getByTestId("market-mini-chart-0-surface-flow-tooltip");
  await expect(spyTooltip).toBeVisible();
  await expect(spyTooltip).toHaveAttribute("data-chart-flow-tooltip-compact", "true");
  await expect(spyTooltip).toContainText("POLYGON");
  await expect(spyTooltip).toContainText("Prem");
  const tooltipBox = await spyTooltip.boundingBox();
  const surfaceBox = await page.getByTestId("market-mini-chart-0-surface").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  if (tooltipBox && surfaceBox) {
    expect(tooltipBox.x).toBeGreaterThanOrEqual(surfaceBox.x - 1);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(
      surfaceBox.x + surfaceBox.width + 1,
    );
    expect(tooltipBox.y).toBeGreaterThanOrEqual(surfaceBox.y - 1);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(
      surfaceBox.y + surfaceBox.height + 1,
    );
  }
  await spyTooltip.hover();
  await expect(spyTooltip).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(spyTooltip).toBeHidden({ timeout: 2_000 });

  const qqqMarker = page.getByTestId("market-mini-chart-1-surface-chart-event").first();
  await expect(qqqMarker).toBeVisible({ timeout: 30_000 });
  await expect(qqqMarker).toHaveAttribute("data-chart-event-type", "unusual_flow");
  await expect(qqqMarker).toHaveAttribute("data-chart-flow-marker-tone", "bearish");
  await expect(qqqMarker).toHaveAttribute(
    "data-chart-flow-marker-basis",
    "confirmed_trade",
  );
  await expect(qqqMarker).toHaveCSS("color", "rgb(239, 68, 68)");

  expect(flowUrls.length).toBeGreaterThanOrEqual(2);
});

test("Market chart flow honors shared type filters while ignoring ticker queries", async ({
  page,
}) => {
  const flowUrls: string[] = [];
  await mockMarketApi(page, flowUrls, { showVolume: false });
  await openMarketGrid(page, {
    showVolume: false,
    workspaceState: {
      flowFilter: "puts",
      flowIncludeQuery: "NVDA",
      flowExcludeQuery: "SPY",
    },
  });

  const spyMarker = page.getByTestId("market-mini-chart-0-surface-chart-event").first();
  await expect(spyMarker).toBeVisible({ timeout: 30_000 });
  await expect(spyMarker).toHaveAttribute("data-chart-event-type", "unusual_flow");
  await expect(spyMarker).toHaveAttribute("data-chart-event-symbol", "SPY");
  await expect(spyMarker).toHaveAttribute("data-chart-flow-marker-tone", "bearish");
  const firstSurface = page.getByTestId("market-mini-chart-0-surface");
  await expect(firstSurface.locator('[data-chart-flow-volume-segment="bearish"]')).toHaveCount(1);
  await expect(firstSurface.locator('[data-chart-flow-volume-segment="bullish"]')).toHaveCount(0);
  await expect(firstSurface.locator('[data-chart-flow-volume-segment="neutral"]')).toHaveCount(0);

  const qqqMarker = page.getByTestId("market-mini-chart-1-surface-chart-event").first();
  await expect(qqqMarker).toBeVisible({ timeout: 30_000 });
  await expect(qqqMarker).toHaveAttribute("data-chart-event-symbol", "QQQ");
  await expect(qqqMarker).toHaveAttribute("data-chart-flow-marker-tone", "bearish");
});

test("Market chart renders confirmed prints while keeping snapshots off price markers", async ({
  page,
}) => {
  const flowUrls: string[] = [];
  await mockMarketApi(page, flowUrls, {
    showVolume: false,
    includeConfirmedHistory: true,
  });
  await openMarketGrid(page, { showVolume: false });

  const surface = page.getByTestId("market-mini-chart-0-surface");
  await expect
    .poll(
      async () =>
        Number(await surface.getAttribute("data-chart-flow-confirmed-event-count")),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        Number(await surface.getAttribute("data-chart-flow-snapshot-event-count")),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await expect(
    surface.locator('[data-chart-flow-marker-basis="confirmed_trade"]').first(),
  ).toBeVisible();
  await expect(surface).toHaveAttribute("data-chart-flow-marker-state", "rendered");
  await expect(
    surface.locator('[data-chart-flow-marker-basis="snapshot_activity"]'),
  ).toHaveCount(0);
  await expect(surface).toHaveAttribute(
    "data-chart-flow-marker-snapshot-skip-count",
    /[1-9]\d*/,
  );
  await expect(surface).toHaveAttribute(
    "data-chart-flow-volume-bucket-count",
    /[1-9]\d*/,
  );
  await expect(
    surface.locator('[data-chart-flow-volume-basis="snapshot_activity"]'),
  ).toHaveCount(0);
});

test("Market chart grid premium-flow strips and flow-volume overlays render with regular volume hidden", async ({
  page,
}) => {
  const flowUrls: string[] = [];
  await mockMarketApi(page, flowUrls, { showVolume: false });
  await openMarketGrid(page, { showVolume: false });

  const strips = page.getByTestId("market-premium-flow-strip");
  await expect(strips).toHaveCount(6);
  await expect(page.getByTestId("market-mini-chart-0")).toBeVisible();
  await expect(
    page.getByRole("status", {
      name: /SPY options premium flow (Scanning|IBKR snapshot live|POLYGON SNAPSHOT)/i,
    }),
  ).toBeVisible();

  await expect(
    page.getByRole("status", {
      name: /SPY options premium flow (IBKR snapshot live|POLYGON SNAPSHOT)/i,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(strips.nth(0)).toHaveAttribute("data-flow-source-provider", "IBKR");
  await expect(strips.nth(0)).toHaveAttribute("data-flow-source-live", "true");
  await expect(strips.nth(0)).toHaveAttribute("data-flow-fallback-used", "false");
  await expect(strips.nth(5)).toHaveAttribute("data-flow-source-provider", "IBKR");
  await expect(strips.nth(5)).toHaveAttribute("data-flow-source-live", "true");
  const flowLane = page.getByTestId("market-activity-flow-lane");
  await expect(flowLane).toHaveAttribute("data-flow-snapshot-source", "broad-scanner");
  await expect(flowLane).toHaveAttribute("data-flow-source-provider", "IBKR");
  await expect(flowLane).toHaveAttribute("data-flow-source-live", "true");
  await expect(page.locator("[data-premium-flow-glyph]")).toHaveCount(0);
  await expect(
    page.getByTestId("market-mini-chart-0-surface-chart-event").first(),
  ).toBeVisible();
  await expect(
    page.getByTestId("market-mini-chart-0-surface-chart-event").first(),
  ).toHaveAttribute("data-chart-event-type", "unusual_flow");
  await expect(
    page.getByTestId("market-mini-chart-0-surface-chart-event").first(),
  ).toHaveAttribute("data-chart-event-symbol", "SPY");
  await expect(
    page.getByTestId("market-mini-chart-0-surface-chart-event").first(),
  ).toHaveAttribute("data-chart-event-source", "polygon");
  await expect(
    page.getByTestId("market-mini-chart-0-surface-chart-event").first(),
  ).toHaveAttribute("data-chart-flow-marker-tone", "bullish");
  await expect(
    page.getByTestId("market-mini-chart-1-surface-chart-event").first(),
  ).toBeVisible();
  await expect(
    page.getByTestId("market-mini-chart-1-surface-chart-event").first(),
  ).toHaveAttribute("data-chart-event-type", "unusual_flow");
  await expect(
    page.getByTestId("market-mini-chart-1-surface-chart-event").first(),
  ).toHaveAttribute("data-chart-event-symbol", "QQQ");
  await expect(
    page.getByTestId("market-mini-chart-1-surface-chart-event").first(),
  ).toHaveAttribute("data-chart-flow-marker-tone", "bearish");
  const firstSurface = page.getByTestId("market-mini-chart-0-surface");
  await expect(firstSurface).toHaveAttribute(
    "data-chart-regular-volume-enabled",
    "false",
  );
  await expect(firstSurface).toHaveAttribute(
    "data-chart-flow-raw-input-count",
    /(?:[2-9]|\d{2,})/,
  );
  await expect(firstSurface).toHaveAttribute(
    "data-chart-flow-bucketed-event-count",
    /[1-9]\d*/,
  );
  await expect(
    page.getByTestId("market-mini-chart-0-surface-flow-volume").first(),
  ).toBeVisible();
  await expect(
    firstSurface.locator('[data-chart-flow-volume-segment="bullish"]').first(),
  ).toBeVisible();
  await expect(
    firstSurface.locator('[data-chart-flow-volume-segment="bearish"]').first(),
  ).toBeVisible();
  await expect(
    firstSurface.locator('[data-chart-flow-volume-segment="neutral"]').first(),
  ).toBeVisible();
  await expect(
    firstSurface.locator('[data-chart-flow-volume-basis="snapshot_activity"]'),
  ).toHaveCount(0);

  expect(flowUrls.length).toBeGreaterThanOrEqual(6);
  const historicalFlowUrls = flowUrls.filter((href) => {
    const params = new URL(href).searchParams;
    return (
      params.get("scope") === "all" &&
      params.has("from") &&
      params.has("to") &&
      params.has("historicalBucketSeconds") &&
      Number(params.get("limit") || "0") >= 1_000
    );
  });
  expect(historicalFlowUrls.length).toBeGreaterThanOrEqual(6);
  expect(
    historicalFlowUrls.every(
      (href) => new URL(href).searchParams.get("scope") === "all",
    ),
  ).toBe(true);
  expect(
    historicalFlowUrls.every(
      (href) => !new URL(href).searchParams.has("unusualThreshold"),
    ),
    "Market chart flow should request broad backend flow and filter unusual events locally",
  ).toBe(true);
  expect(
    historicalFlowUrls.every(
      (href) => new URL(href).searchParams.get("blocking") === "false",
    ),
  ).toBe(true);
  expect(
    flowUrls.filter((href) => new URL(href).searchParams.get("scope") !== "all"),
    "Market should not run a separate all-flow watchlist scanner while chart flow is active",
  ).toEqual([]);

  const layout = await strips.evaluateAll((nodes) =>
    nodes.map((node) => {
      const strip = node.getBoundingClientRect();
      const cell = node.parentElement?.getBoundingClientRect();
      const chart = node.previousElementSibling?.getBoundingClientRect();
      return {
        hasControlRoot: node.hasAttribute("data-chart-control-root"),
        stripHeight: strip.height,
        stripWidth: strip.width,
        gapFromChart: chart ? strip.top - chart.bottom : null,
        bottomGap: cell ? cell.bottom - strip.bottom : null,
      };
    }),
  );

  for (const item of layout) {
    expect(item.hasControlRoot).toBe(true);
    expect(item.stripHeight).toBeGreaterThanOrEqual(28);
    expect(item.stripHeight).toBeLessThanOrEqual(36);
    expect(item.stripWidth).toBeGreaterThan(130);
    expect(item.gapFromChart ?? -1).toBeGreaterThanOrEqual(-1);
    expect(item.bottomGap ?? -1).toBeGreaterThanOrEqual(-1);
  }

  const firstChartFrame = page.getByTestId("market-mini-chart-0");
  await firstChartFrame.hover();
  await firstChartFrame.getByRole("button", { name: "Settings" }).click();
  const displayMenu = page.getByRole("menu").filter({ hasText: "Display" }).first();
  await expect(displayMenu).toBeVisible();
  await expect
    .poll(() =>
      displayMenu.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const topElement = document.elementFromPoint(
          rect.left + Math.min(20, rect.width / 2),
          rect.top + Math.min(20, rect.height / 2),
        );
        return topElement != null && node.contains(topElement);
      }),
    )
    .toBe(true);

  await page.keyboard.press("Escape");
  await firstChartFrame.getByTitle("Tune RayReplica overlay settings").click();
  const rayReplicaTitle = page.getByText("RayReplica Settings").first();
  await expect(rayReplicaTitle).toBeVisible();
  await expect
    .poll(() =>
      rayReplicaTitle.evaluate((node) => {
        const panel =
          node.closest("[data-radix-popper-content-wrapper]") ||
          node.closest("[data-radix-popover-content]") ||
          node.parentElement;
        if (!panel) return false;
        const rect = panel.getBoundingClientRect();
        const topElement = document.elementFromPoint(
          rect.left + Math.min(20, rect.width / 2),
          rect.top + Math.min(20, rect.height / 2),
        );
        return topElement != null && panel.contains(topElement);
      }),
    )
    .toBe(true);
});

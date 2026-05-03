import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

const expirations = ["2026-05-01", "2026-05-08", "2026-05-15"];
const basePrice = 500;
const mockBarNow = Date.parse("2026-04-30T20:00:00.000Z");

function mockOptionConid(expirationDate: string, strike: number, cp: "C" | "P") {
  const expirationIndex = Math.max(0, expirations.indexOf(expirationDate));
  return String(920_000 + expirationIndex * 1_000 + strike * 2 + (cp === "P" ? 1 : 0));
}

function makeBars(symbol = "SPY", now = mockBarNow) {
  return Array.from({ length: 80 }, (_, index) => {
    const close = basePrice + Math.sin(index / 5) * 2 + index * 0.05;
    const open = close - Math.cos(index / 3) * 0.8;
    return {
      timestamp: new Date(now - (79 - index) * 5 * 60_000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100_000 + index * 1_000,
      source:
        symbol.endsWith("C") || symbol.endsWith("P") ? "mock-option" : "mock",
    };
  });
}

function makeOptionContracts(
  expirationDate: string,
  underlying = "SPY",
  quoteFreshness = "metadata",
) {
  const expirationIndex = expirations.indexOf(expirationDate);
  const offset = expirationIndex >= 0 ? expirationIndex * 5 : 0;
  const strikes = [
    490 + offset,
    495 + offset,
    500 + offset,
    505 + offset,
    510 + offset,
  ];

  return strikes.flatMap((strike) =>
    (["call", "put"] as const).map((right) => {
      const cp = right === "call" ? "C" : "P";
      const distance = Math.abs(strike - basePrice);
      const mark = Math.max(0.35, 8 - distance * 0.4 + expirationIndex);
      return {
        contract: {
          ticker: `${underlying}-${expirationDate}-${strike}-${cp}`,
          underlying,
          expirationDate,
          strike,
          right,
          multiplier: 100,
          sharesPerContract: 100,
          providerContractId: mockOptionConid(expirationDate, strike, cp),
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
        quoteFreshness,
        openInterest: 1_000 + strike,
        volume: 100 + strike,
        updatedAt: new Date().toISOString(),
      };
    }),
  );
}

async function mockTradeApi(
  page: Page,
  {
    delayChainMs = 0,
    delayFullChainMs = 0,
    delayBatchChainMs = 0,
    chainUrls = [],
    batchRequests = [],
    barsRequests = [],
    shadowPreviewRequests = [],
    livePreviewRequests = [],
    orderSubmitRequests = [],
    orderSubmitStatus = 201,
    orderSubmitResponse = null,
    gatewayMode = "off",
    flowEvents = [],
    optionQuoteFreshness = "metadata",
    emptyFastSelected = false,
    emptyOptionChains = false,
    watchlistSymbols = ["SPY"],
    watchlistItems = null,
  }: {
    delayChainMs?: number;
    delayFullChainMs?: number;
    delayBatchChainMs?: number;
    chainUrls?: string[];
    batchRequests?: Array<Record<string, unknown>>;
    barsRequests?: Array<Record<string, string>>;
    shadowPreviewRequests?: Array<Record<string, unknown>>;
    livePreviewRequests?: Array<Record<string, unknown>>;
    orderSubmitRequests?: Array<Record<string, unknown>>;
    orderSubmitStatus?: number;
    orderSubmitResponse?: Record<string, unknown> | null;
    gatewayMode?: "off" | "ready" | "disconnected";
    flowEvents?: Array<Record<string, unknown>>;
    optionQuoteFreshness?: string;
    emptyFastSelected?: boolean;
    emptyOptionChains?: boolean;
    watchlistSymbols?: string[];
    watchlistItems?: Array<Record<string, unknown>> | null;
  } = {},
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    let status = 200;

    if (url.pathname === "/api/session") {
      const gatewayReady = gatewayMode === "ready";
      const gatewayConfigured = gatewayMode !== "off";
      body = {
        configured: { ibkr: gatewayConfigured, research: false },
        ibkrBridge: {
          authenticated: gatewayReady,
          connected: gatewayReady,
          healthFresh: true,
          accountsLoaded: gatewayReady,
          selectedAccountId: gatewayConfigured ? "DU1234567" : null,
          accounts: gatewayReady ? ["DU1234567"] : [],
          liveMarketDataAvailable: false,
          transport: "client-portal",
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
            ...(watchlistItems
              ? { items: watchlistItems }
              : { symbols: watchlistSymbols }),
          },
        ],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const requested = (url.searchParams.get("symbols") || "SPY")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol) => ({
          symbol,
          price: basePrice,
          prevClose: basePrice - 2,
          change: 2,
          changePercent: 0.4,
          open: basePrice - 1,
          high: basePrice + 3,
          low: basePrice - 4,
          volume: 50_000_000,
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/options/expirations") {
      body = {
        underlying: "SPY",
        expirations: expirations.map((expirationDate) => ({ expirationDate })),
      };
    } else if (url.pathname === "/api/options/chart-bars") {
      const params = Object.fromEntries(url.searchParams.entries());
      barsRequests.push(params);
      body = {
        bars: makeBars(
          params.providerContractId || params.contract || params.symbol || "OPTION",
        ),
      };
    } else if (url.pathname === "/api/options/chains") {
      chainUrls.push(url.toString());
      const underlying = (url.searchParams.get("underlying") || "SPY").toUpperCase();
      const expirationDate =
        url.searchParams.get("expirationDate") || expirations[0];
      const isFullCoverage = url.searchParams.get("strikeCoverage") === "full";
      const chainDelayMs =
        isFullCoverage && delayFullChainMs > 0
          ? delayFullChainMs
          : delayChainMs;
      if (chainDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, chainDelayMs));
      }
      const selectedFastChainEmpty =
        emptyFastSelected &&
        !isFullCoverage &&
        expirationDate === expirations[0];
      const contracts =
        emptyOptionChains || selectedFastChainEmpty
          ? []
          : makeOptionContracts(expirationDate, underlying, optionQuoteFreshness);
      body = {
        underlying,
        expirationDate,
        contracts: contracts.map((contract) => ({
          ...contract,
          contract: {
            ...contract.contract,
            ticker: contract.contract.ticker.replace(/^SPY-/, `${underlying}-`),
            underlying,
          },
        })),
      };
    } else if (url.pathname === "/api/options/chains/batch") {
      const requestBody = route.request().postDataJSON() as {
        underlying?: string;
        expirationDates?: string[];
      };
      const underlying = (requestBody.underlying || "SPY").toUpperCase();
      batchRequests.push(requestBody);
      if (delayBatchChainMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayBatchChainMs));
      }
      body = {
        underlying,
        results: (requestBody.expirationDates || []).map((expirationDate) => ({
          expirationDate,
          status: "loaded",
          contracts: emptyOptionChains
            ? []
            : makeOptionContracts(
                expirationDate,
                underlying,
                optionQuoteFreshness,
              ),
        })),
      };
    } else if (url.pathname === "/api/bars") {
      barsRequests.push(Object.fromEntries(url.searchParams.entries()));
      body = { bars: makeBars(url.searchParams.get("symbol") || "SPY") };
    } else if (url.pathname === "/api/orders/preview") {
      const requestBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      const optionContract =
        typeof requestBody.optionContract === "object" &&
        requestBody.optionContract !== null
          ? (requestBody.optionContract as Record<string, unknown>)
          : null;
      livePreviewRequests.push(requestBody);
      body = {
        accountId: requestBody.accountId || "DU1234567",
        mode: requestBody.mode || "paper",
        symbol: requestBody.symbol || "SPY",
        assetClass: requestBody.assetClass || "option",
        resolvedContractId: Number(optionContract?.providerContractId || 756733),
        fillPrice: Number(requestBody.limitPrice ?? 1.25),
        fees: 2.02,
        estimatedGrossAmount:
          Number(requestBody.limitPrice ?? 1.25) *
          Number(requestBody.quantity ?? 1) *
          (requestBody.assetClass === "equity" ? 1 : 100),
        orderPayload: {
          order: {
            action:
              String(requestBody.side || "buy").toLowerCase() === "buy"
                ? "BUY"
                : "SELL",
            orderType: String(requestBody.type || "limit").toUpperCase(),
            totalQuantity: Number(requestBody.quantity ?? 1),
            lmtPrice: Number(requestBody.limitPrice ?? 1.25),
            tif: String(requestBody.timeInForce || "day").toUpperCase(),
          },
        },
        optionContract,
      };
    } else if (url.pathname === "/api/orders") {
      if (route.request().method() === "POST") {
        const requestBody = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        orderSubmitRequests.push(requestBody);
        status = orderSubmitStatus;
        body =
          orderSubmitResponse ||
          {
            id: "802",
            accountId: requestBody.accountId || "DU1234567",
            mode: requestBody.mode || "paper",
            symbol: requestBody.symbol || "SPY",
            assetClass: requestBody.assetClass || "option",
            side: requestBody.side || "buy",
            type: requestBody.type || "limit",
            timeInForce: requestBody.timeInForce || "day",
            status: "submitted",
            quantity: requestBody.quantity ?? 1,
            filledQuantity: 0,
            limitPrice: requestBody.limitPrice ?? null,
            stopPrice: requestBody.stopPrice ?? null,
            placedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            optionContract: requestBody.optionContract || null,
          };
      } else {
        body = { orders: [] };
      }
    } else if (url.pathname === "/api/shadow/orders/preview") {
      const requestBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      const optionContract =
        typeof requestBody.optionContract === "object" &&
        requestBody.optionContract !== null
          ? (requestBody.optionContract as Record<string, unknown>)
          : {};
      const fillPrice = Number(requestBody.limitPrice ?? 1.25);
      const quantity = Number(requestBody.quantity ?? 1);
      const multiplier = requestBody.assetClass === "equity" ? 1 : 100;
      shadowPreviewRequests.push(requestBody);
      body = {
        accountId: "shadow",
        mode: "paper",
        symbol: requestBody.symbol || "SPY",
        assetClass: requestBody.assetClass || "option",
        resolvedContractId: Number(optionContract.providerContractId || 0),
        fillPrice,
        fees: 2.02,
        estimatedGrossAmount: fillPrice * quantity * multiplier,
        estimatedCashDelta: -(fillPrice * quantity * multiplier + 2.02),
        orderPayload: {
          ...requestBody,
          accountId: "shadow",
          timeInForce: requestBody.timeInForce || "day",
        },
        optionContract,
      };
    } else if (url.pathname === "/api/flow/events") {
      body = { events: flowEvents };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = {
        profile: { enabled: false, timeframe: "15m", watchlistId: null },
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
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function openTrade(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        tradeActiveTicker: "SPY",
        tradeContracts: {
          SPY: { strike: 500, cp: "C", exp: "" },
        },
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
}

async function dragPanChart(page: Page, chartTestId: string) {
  const surface = page.getByTestId(`${chartTestId}-surface`);
  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toHaveAttribute(
    "data-chart-visible-logical-range",
    /^(?!none$).+/,
    { timeout: 10_000 },
  );
  const before = await surface.getAttribute("data-chart-visible-logical-range");
  const plot = surface.locator("[data-chart-plot-root]");
  const box = await plot.boundingBox();
  expect(box, `${chartTestId} plot should have a geometry box`).not.toBeNull();
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
}

async function openPlatformScreen(
  page: Page,
  screen: "trade" | "flow" | "research",
) {
  await page.addInitScript((initialScreen) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: initialScreen,
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        tradeActiveTicker: "SPY",
        tradeContracts: {
          SPY: { strike: 500, cp: "C", exp: "" },
        },
      }),
    );
  }, screen);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`screen-host-${screen}`)).toBeVisible({
    timeout: 30_000,
  });
}

async function expectActiveScreenFillsHost(
  page: Page,
  screen: "trade" | "flow" | "research",
) {
  const readyTestId =
    screen === "trade"
      ? "trade-top-zone"
      : screen === "flow"
        ? "flow-main-layout"
        : "research-screen";
  await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 30_000 });

  const metrics = await page
    .getByTestId(`screen-host-${screen}`)
    .evaluate((host) => {
      const hostBox = host.getBoundingClientRect();
      const childBox = host.firstElementChild?.getBoundingClientRect();

      return {
        hostWidth: hostBox.width,
        childWidth: childBox?.width ?? 0,
        rightGap: childBox
          ? hostBox.right - childBox.right
          : Number.POSITIVE_INFINITY,
      };
    });

  expect(metrics.hostWidth).toBeGreaterThan(1000);
  expect(metrics.childWidth).toBeGreaterThan(metrics.hostWidth - 1);
  expect(metrics.rightGap).toBeLessThanOrEqual(1);
}

async function expectCompactPlatformHeader(page: Page) {
  const header = page.getByTestId("platform-compact-header");
  await expect(header).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("platform-screen-nav")).toBeVisible();
  await expect(page.getByTestId("platform-header-kpis")).toBeVisible();
  await expect(page.getByTestId("platform-header-account")).toBeVisible();
  await expect(page.getByTestId("platform-header-status")).toBeVisible();

  await expect(
    page.getByTestId("platform-header-kpis").locator("button"),
  ).toHaveCount(5);
  await expect(
    page.getByTestId("platform-header-account").getByText("Net Liq"),
  ).toBeVisible();
  await expect(
    page.getByTestId("platform-header-account").getByText("Buying Power"),
  ).toBeVisible();
  await expect(
    page.getByTestId("platform-header-account").getByText("Cash"),
  ).toBeVisible();

  const metrics = await header.evaluate((element) => {
    const headerBox = element.getBoundingClientRect();
    const rows = Array.from(element.children).map((child) => {
      const childBox = child.getBoundingClientRect();
      return {
        top: Math.round(childBox.top - headerBox.top),
        bottom: Math.round(childBox.bottom - headerBox.top),
      };
    });

    return {
      height: headerBox.height,
      rowSpread:
        Math.max(...rows.map((row) => row.top)) -
        Math.min(...rows.map((row) => row.top)),
      childrenInside: rows.every((row) => row.bottom <= headerBox.height + 1),
    };
  });

  expect(metrics.height).toBeLessThanOrEqual(60);
  expect(metrics.rowSpread).toBeLessThanOrEqual(6);
  expect(metrics.childrenInside).toBe(true);

  const bottomStatusText = await page
    .getByTestId("platform-bottom-status")
    .innerText();
  expect(bottomStatusText).not.toMatch(
    /\b(PAPER|LIVE|DELAYED|CP|IB GATEWAY)\b/,
  );
}

test("Trade swaps contract chart above options chain and removes placeholder copy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("trade-workspace-seeded")) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem("trade-workspace-seeded", "true");
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "SPY",
        theme: "dark",
        tradeActiveTicker: "SPY",
        tradeRecentTickers: ["SPY", "QQQ", "NVDA"],
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({ timeout: 30_000 });

  const topBox = await page.getByTestId("trade-top-zone").boundingBox();
  const middleBox = await page.getByTestId("trade-middle-zone").boundingBox();
  const contractBox = await page
    .getByTestId("trade-contract-chart-panel")
    .boundingBox();
  const chainBox = await page
    .getByTestId("trade-options-chain-panel")
    .boundingBox();

  expect(topBox).not.toBeNull();
  expect(middleBox).not.toBeNull();
  expect(contractBox).not.toBeNull();
  expect(chainBox).not.toBeNull();
  expect(contractBox!.y).toBeGreaterThanOrEqual(topBox!.y - 1);
  expect(contractBox!.y + contractBox!.height).toBeLessThanOrEqual(
    topBox!.y + topBox!.height + 1,
  );
  expect(chainBox!.y).toBeGreaterThanOrEqual(middleBox!.y - 1);
  expect(chainBox!.y + chainBox!.height).toBeLessThanOrEqual(
    middleBox!.y + middleBox!.height + 1,
  );

  await expect(
    page.getByTestId("trade-options-chain-panel").getByText("OPTIONS CHAIN"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("trade-contract-chart-panel")
      .getByText("CONTRACT", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("SHADOW PAPER")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "SHADOW", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "REAL", exact: true }),
  ).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(
    /spaceholder|schema-pending|placeholder panel|under construction|Coming Soon/i,
  );
});

test("Trade ticket switches between Shadow and IBKR execution modes", async ({
  page,
}) => {
  const shadowPreviewRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
	  await mockTradeApi(page, {
	    shadowPreviewRequests,
	    gatewayMode: "ready",
	    optionQuoteFreshness: "live",
	  });
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("trade-ticket-mode-seeded")) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem("trade-ticket-mode-seeded", "true");
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        tradeActiveTicker: "SPY",
        tradeContracts: {
          SPY: { strike: 500, cp: "C", exp: "05/01" },
        },
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByText("ORDER TICKET", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("SHADOW PAPER")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: "PREVIEW SHADOW" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /BUY SHADOW/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId("trade-ticket-stop-loss-toggle"),
  ).toBeDisabled();
  await expect(
    page.getByTestId("trade-ticket-take-profit-toggle"),
  ).toBeDisabled();

  await page.getByRole("button", { name: "PREVIEW SHADOW" }).click();
  await expect
    .poll(() => shadowPreviewRequests.length, { timeout: 10_000 })
    .toBe(1);
  expect(shadowPreviewRequests[0]?.accountId).toBe("shadow");
  await expect(page.getByText("CONID")).toBeVisible();

	  await page.getByRole("button", { name: "REAL", exact: true }).click();
	  await expect(page.getByText("IBKR PAPER")).toBeVisible();
	  await expect(
	    page.getByRole("button", { name: "PREVIEW IBKR" }),
	  ).toBeVisible();
  await expect(page.getByTestId("trade-ticket-stop-loss-toggle")).toBeEnabled();
  await expect(page.getByTestId("trade-ticket-take-profit-toggle")).toBeEnabled();

  await page.getByTestId("trade-ticket-stop-loss-toggle").click();
  await page.getByTestId("trade-ticket-take-profit-toggle").click();
  await expect(
    page.getByRole("button", { name: /BUY 2 EXITS/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = window.localStorage.getItem("rayalgo:state:v1");
        return stored ? JSON.parse(stored).tradeExecutionMode : null;
      }),
    )
    .toBe("real");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Trade", exact: true }).click();
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("IBKR PAPER")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: "PREVIEW IBKR" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "SHADOW", exact: true }).click();
  await expect(page.getByText("SHADOW PAPER")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "PREVIEW SHADOW" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("trade-ticket-stop-loss-toggle"),
  ).toBeDisabled();
  await expect(
    page.getByTestId("trade-ticket-take-profit-toggle"),
  ).toBeDisabled();
		  await expect(
		    page.getByRole("button", { name: /BUY SHADOW/ }),
		  ).toBeVisible();
});

test("Trade ticket surfaces IBKR order rejection without sticking submitting state", async ({
  page,
}) => {
  const orderSubmitRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, {
    gatewayMode: "ready",
    optionQuoteFreshness: "live",
    orderSubmitRequests,
    orderSubmitStatus: 500,
    orderSubmitResponse: {
      message: "IBKR rejected FCEL test order.",
    },
  });
  await openTrade(page);

  await expect(page.getByText("ORDER TICKET", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "REAL", exact: true }).click();
  await expect(page.getByRole("button", { name: "PREVIEW IBKR" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /BUY \d+ ct/ }).click();
  await expect(page.getByTestId("broker-action-confirm-dialog")).toBeVisible();
  await page.getByRole("button", { name: "BUY IBKR ORDER" }).click();

  await expect
    .poll(() => orderSubmitRequests.length, { timeout: 10_000 })
    .toBe(1);
  await expect(page.getByTestId("broker-action-confirm-error")).toContainText(
    "IBKR rejected FCEL test order.",
  );
  await expect(
    page.getByRole("button", { name: "BUY IBKR ORDER" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "SUBMITTING..." })).toHaveCount(
    0,
  );
});

test("Trade ticket blocks execution when IB Gateway is disconnected but allows IBKR preview", async ({
  page,
}) => {
  const shadowPreviewRequests: Array<Record<string, unknown>> = [];
  const livePreviewRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, {
    gatewayMode: "disconnected",
    shadowPreviewRequests,
    livePreviewRequests,
    optionQuoteFreshness: "live",
  });
  await openTrade(page);

  await expect(
    page.getByTestId("trade-top-zone").getByText("IB Gateway is disconnected."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "PREVIEW SHADOW" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "GATEWAY REQUIRED" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "REAL", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "PREVIEW IBKR" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "GATEWAY REQUIRED" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "PREVIEW IBKR" }).click();

  await expect
    .poll(() => livePreviewRequests.length, { timeout: 10_000 })
    .toBe(1);
  expect(livePreviewRequests[0]?.accountId).toBe("DU1234567");
  expect(shadowPreviewRequests).toHaveLength(0);
});

test("Trade ticket toggles between option contracts and shares", async ({
  page,
}) => {
  const shadowPreviewRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
	  await mockTradeApi(page, {
	    shadowPreviewRequests,
	    gatewayMode: "ready",
	    optionQuoteFreshness: "live",
	  });
  await openTrade(page);

  await expect(page.getByTestId("trade-ticket-asset-mode")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("trade-ticket-asset-mode-option"),
  ).toBeVisible();
  await expect(
    page.getByTestId("trade-ticket-asset-mode-equity"),
  ).toBeVisible();
  await expect(page.getByText("MID", { exact: true })).toBeVisible();

  await page.getByTestId("trade-ticket-asset-mode-equity").click();
  await expect(page.getByText("LAST", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("trade-top-zone").getByText("VOL", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "PREVIEW SHADOW" }).click();
  await expect
    .poll(() => shadowPreviewRequests.length, { timeout: 10_000 })
    .toBe(1);
  expect(shadowPreviewRequests[0]?.assetClass).toBe("equity");
  expect(shadowPreviewRequests[0]?.optionContract).toBeNull();
  expect(shadowPreviewRequests[0]?.symbol).toBe("SPY");

  await page.getByTestId("trade-ticket-asset-mode-option").click();
  await expect(page.getByText("MID", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "PREVIEW SHADOW" }).click();
  await expect
    .poll(() => shadowPreviewRequests.length, { timeout: 10_000 })
    .toBe(2);
  expect(shadowPreviewRequests[1]?.assetClass).toBe("option");
  expect(shadowPreviewRequests[1]?.optionContract).toMatchObject({
    underlying: "SPY",
    strike: 500,
    right: "call",
  });
});

test("Trade ticket keeps shares tradable when option data is unavailable", async ({
  page,
}) => {
  const shadowPreviewRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
	  await mockTradeApi(page, {
	    emptyOptionChains: true,
	    shadowPreviewRequests,
	    gatewayMode: "ready",
	  });
  await openTrade(page);

  await expect(page.getByText("No live contract quote")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId("trade-ticket-asset-mode-equity").click();
  await expect(page.getByText("No live contract quote")).toHaveCount(0);
  await expect(page.getByText("LAST", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "PREVIEW SHADOW" })).toBeVisible();

  const limitInput = page.getByLabel("limit price");
  await limitInput.fill("501.25");
  await page.getByRole("button", { name: "PREVIEW SHADOW" }).click();

  await expect
    .poll(() => shadowPreviewRequests.length, { timeout: 10_000 })
    .toBe(1);
  expect(shadowPreviewRequests[0]?.assetClass).toBe("equity");
  expect(shadowPreviewRequests[0]?.optionContract).toBeNull();
  expect(shadowPreviewRequests[0]?.symbol).toBe("SPY");
  expect(shadowPreviewRequests[0]?.limitPrice).toBe(501.25);
});

test("Trade charts render unusual options activity on spot and option charts", async ({
  page,
}) => {
  const occurredAt = new Date(mockBarNow).toISOString();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, {
    flowEvents: [
      {
        id: "flow-spy-call-sweep",
        underlying: "SPY",
        optionTicker: "SPY-2026-05-01-500-C",
        expirationDate: "2026-05-01",
        occurredAt,
        right: "call",
        side: "ask",
        price: 4.2,
        bid: 4.1,
        ask: 4.3,
        mark: 4.2,
        size: 500,
        multiplier: 100,
        sharesPerContract: 100,
        premium: 210_000,
        strike: 500,
        underlyingPrice: basePrice,
        provider: "ibkr",
        basis: "trade",
        sentiment: "bullish",
        isUnusual: true,
        unusualScore: 3,
      },
    ],
  });
  await openTrade(page);

  await expect(
    page.getByTestId("trade-equity-chart-surface-chart-event").first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByTestId("trade-contract-option-chart-uoa-badge"),
  ).toBeVisible({ timeout: 15_000 });
});

test("Platform header is a compact single band with market KPIs and account data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page);
  await openPlatformScreen(page, "trade");

  await expectCompactPlatformHeader(page);
});

test("Trade switches between ticker tabs without showing the prior ticker", async ({
  page,
}) => {
  const barsRequests: Array<Record<string, string>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { barsRequests });
  await openTrade(page);

  const tradeChart = page.getByTestId("trade-equity-chart");
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search SPY",
  );

  await page.getByText("QQQ", { exact: true }).first().click();
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search QQQ",
  );

  await page.getByText("NVDA", { exact: true }).first().click();
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search NVDA",
  );
  await expect
    .poll(
      () => barsRequests.some((request) => request.symbol === "NVDA"),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("Trade supports switching across more than eight ticker tabs", async ({
  page,
}) => {
  const barsRequests: Array<Record<string, string>> = [];
  const tradeRecentTickers = [
    "AAPL",
    "MSFT",
    "TSLA",
    "AMD",
    "META",
    "GOOGL",
    "AMZN",
    "NFLX",
    "PLTR",
    "NVDA",
  ];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { barsRequests });
  await page.addInitScript((recentTickers) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "AAPL",
        theme: "dark",
        tradeActiveTicker: "AAPL",
        tradeRecentTickers: recentTickers,
      }),
    );
  }, tradeRecentTickers);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });

  for (const ticker of tradeRecentTickers) {
    await expect(page.getByText(ticker, { exact: true }).first()).toBeVisible();
  }

  const tradeChart = page.getByTestId("trade-equity-chart");
  await page.getByText("PLTR", { exact: true }).first().click();
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search PLTR",
  );
  await expect
    .poll(
      () => barsRequests.some((request) => request.symbol === "PLTR"),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("Trade persists drag-reordered ticker tabs", async ({ page }) => {
  const tradeRecentTickers = ["AAPL", "MSFT", "TSLA", "AMD"];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page);
  await page.addInitScript((recentTickers) => {
    if (window.sessionStorage.getItem("trade-reorder-seeded")) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem("trade-reorder-seeded", "true");
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "AAPL",
        theme: "dark",
        tradeActiveTicker: "AAPL",
        tradeRecentTickers: recentTickers,
      }),
    );
  }, tradeRecentTickers);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });

  const tabOrder = () =>
    page.getByTestId("trade-tab-strip").locator('[data-testid^="trade-tab-"]').evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("data-testid") || "")
        .filter((testId) => testId.startsWith("trade-tab-") && !testId.startsWith("trade-tab-close-"))
        .map((testId) => testId.replace("trade-tab-", "")),
    );

  await expect.poll(tabOrder).toEqual(["AAPL", "MSFT", "TSLA", "AMD"]);

  const sourceBox = await page.getByTestId("trade-tab-TSLA").boundingBox();
  const targetBox = await page.getByTestId("trade-tab-AAPL").boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + 3, targetBox!.y + targetBox!.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(tabOrder).toEqual(["TSLA", "AAPL", "MSFT", "AMD"]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(tabOrder).toEqual(["TSLA", "AAPL", "MSFT", "AMD"]);

  await page.getByTestId("trade-tab-MSFT").click();
  await expect(page.getByTestId("trade-equity-chart").getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search MSFT",
  );

  await page.getByTestId("trade-tab-close-AAPL").click();
  await expect.poll(tabOrder).toEqual(["TSLA", "MSFT", "AMD"]);
});

test("Trade watchlist click replaces persisted active ticker in the viewing area", async ({
  page,
}) => {
  const barsRequests: Array<Record<string, string>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, {
    barsRequests,
    watchlistItems: [
      { id: "watch-aapl", symbol: "AAPL", name: "Apple" },
      { id: "watch-pltr", symbol: "pltr", name: "Palantir" },
      { id: "watch-nvda", symbol: "NVDA", name: "NVIDIA" },
    ],
  });
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "AAPL",
        theme: "dark",
        sidebarCollapsed: false,
        tradeActiveTicker: "AAPL",
        tradeRecentTickers: ["AAPL"],
        tradeContracts: {
          AAPL: { strike: 500, cp: "C", exp: "" },
        },
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({
    timeout: 30_000,
  });

  const tradeChart = page.getByTestId("trade-equity-chart");
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search AAPL",
  );

  await page
    .locator('[data-testid="watchlist-row"][data-symbol="PLTR"]')
    .click();

  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search PLTR",
  );
  await expect
    .poll(
      () => barsRequests.some((request) => request.symbol === "PLTR"),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("Trade workspace does not show the notes strip above the chart grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page);
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("trade-workspace-seeded")) return;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem("trade-workspace-seeded", "true");
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        tradeActiveTicker: "SPY",
        tradeRecentTickers: ["SPY", "QQQ", "NVDA"],
        tradeContracts: {
          SPY: { strike: 500, cp: "C", exp: "" },
        },
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trade-top-zone")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("trade-workspace-notes-toggle")).toHaveCount(0);
  await expect(page.getByTestId("trade-workspace-notes")).toHaveCount(0);
});

test("Trade, Flow, and Research pages fill the available viewport width", async ({
  browser,
}) => {
  for (const screen of ["trade", "flow", "research"] as const) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    try {
      await mockTradeApi(page);
      await openPlatformScreen(page, screen);
      await expectActiveScreenFillsHost(page, screen);
    } finally {
      await page.close();
    }
  }
});

test("Trade phone layout loads lazy module and exposes full trading stack", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTradeApi(page);
  await openTrade(page);

  await expect(page.locator(".ra-shell")).toHaveAttribute("data-layout", "phone");
  await expect(page.locator('[data-trade-layout="phone"]')).toBeVisible();
  await expect(page.getByTestId("trade-equity-chart")).toBeVisible();
  await expect(page.getByTestId("trade-contract-chart-panel")).toBeVisible();
  await expect(page.getByTestId("trade-order-ticket")).toBeVisible();
  await expect(page.getByTestId("trade-options-chain-panel")).toBeVisible();
  await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
  await expect(page.getByTestId("trade-bottom-zone")).toBeVisible();

  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    topColumns: getComputedStyle(
      document.querySelector('[data-testid="trade-top-zone"]') as Element,
    ).gridTemplateColumns,
    middleColumns: getComputedStyle(
      document.querySelector('[data-testid="trade-middle-zone"]') as Element,
    ).gridTemplateColumns,
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.topColumns.split(" ").length).toBe(1);
  expect(metrics.middleColumns.split(" ").length).toBe(1);
});

test("Trade option chain loading state shows a spinner while chain request is pending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { delayChainMs: 1500, delayBatchChainMs: 1500 });
  await openTrade(page);

  await expect(
    page
      .getByTestId("trade-options-chain-panel")
      .getByTestId("loading-spinner"),
  ).toBeVisible({ timeout: 10_000 });
});

test("Trade option chain cold load hydrates full expiration batches", async ({
  page,
}) => {
  const chainUrls: string[] = [];
  const batchRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { chainUrls, batchRequests });
  await openTrade(page);

  await expect
    .poll(() => batchRequests.length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(
      () =>
        new Set(
          batchRequests.flatMap((request) =>
            Array.isArray(request["expirationDates"])
              ? request["expirationDates"]
              : [],
          ),
        ).size,
      { timeout: 10_000 },
    )
    .toBe(expirations.length);

  expect(
    chainUrls.some(
      (href) => new URL(href).searchParams.get("strikeCoverage") === "full",
    ),
  ).toBe(false);
  expect(
    batchRequests.some((request) => request["strikeCoverage"] === "full"),
  ).toBe(true);
  expect(
    batchRequests.every(
      (request) =>
        request["strikeCoverage"] === "full" &&
        request["quoteHydration"] === "metadata",
    ),
  ).toBe(true);
  await expect
    .poll(
      () =>
        chainUrls.some((href) => {
          const params = new URL(href).searchParams;
          return (
            params.get("strikesAroundMoney") === "5" &&
            params.get("quoteHydration") === "metadata"
          );
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("Trade option chain batches start even while selected chain is slow", async ({
  page,
}) => {
  const batchRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { delayChainMs: 4_000, batchRequests });
  await openTrade(page);

  await expect
    .poll(() => batchRequests.length, { timeout: 8_000 })
    .toBeGreaterThanOrEqual(1);
});

test("Trade option chain falls back to full selected coverage after fast empty", async ({
  page,
}) => {
  const chainUrls: string[] = [];
  const batchRequests: Array<Record<string, unknown>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, {
    chainUrls,
    batchRequests,
    emptyFastSelected: true,
  });
  await openTrade(page);

  await expect
    .poll(
      () =>
        chainUrls.some(
          (href) => new URL(href).searchParams.get("strikeCoverage") === "full",
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  expect(
    batchRequests.some((request) => request["strikeCoverage"] === "full"),
  ).toBe(true);
});

test("Trade option chain selects a hydrated conid and renders option chart bars", async ({
  page,
}) => {
  const batchRequests: Array<Record<string, unknown>> = [];
  const barsRequests: Array<Record<string, string>> = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { batchRequests, barsRequests });
  await openTrade(page);
  await expect
    .poll(
      () =>
        new Set(
          batchRequests.flatMap((request) =>
            Array.isArray(request["expirationDates"])
              ? request["expirationDates"]
              : [],
          ),
        ).size,
      { timeout: 10_000 },
    )
    .toBe(expirations.length);

  const chart = page.getByTestId("trade-contract-option-chart");
  const contractChartPanel = page.getByTestId("trade-contract-chart-panel");
  await expect(chart).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByTestId("trade-contract-option-chart-surface"),
  ).toHaveAttribute("data-chart-visible-logical-range", /^(?!none$).+/, {
    timeout: 10_000,
  });
  await expect(contractChartPanel.getByText(/^MARK$/)).toHaveCount(0);
  await expect(contractChartPanel.getByText(/^BID$/)).toHaveCount(0);
  await expect(contractChartPanel.getByText(/^ASK$/)).toHaveCount(0);
  await expect(contractChartPanel.getByText(/^IV$/)).toHaveCount(0);
  await expect
    .poll(
      () =>
        barsRequests.some(
          (request) =>
            request["providerContractId"] === mockOptionConid("2026-05-01", 500, "C"),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect(
    page
      .getByTestId("trade-contract-chart-panel")
      .getByText("Select a hydrated contract"),
  ).toHaveCount(0);

  const panel = page.getByTestId("trade-options-chain-panel");
  for (const [expirationValue, providerContractId] of [
    ["05/08", mockOptionConid("2026-05-08", 500, "C")],
    ["05/15", mockOptionConid("2026-05-15", 500, "C")],
  ] as const) {
    await panel.locator("select").selectOption(expirationValue);
    await expect(chart).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        () =>
          barsRequests.some(
            (request) => request["providerContractId"] === providerContractId,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
  }
});

test("Trade spot and option charts drag-pan through the shared chart frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page);
  await openTrade(page);

  await dragPanChart(page, "trade-equity-chart");
  await dragPanChart(page, "trade-contract-option-chart");
});

test("Trade option chain keeps rows visible while selected chain refreshes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockTradeApi(page, { delayFullChainMs: 1_500 });
  await openTrade(page);

  const panel = page.getByTestId("trade-options-chain-panel");
  const expandButton = panel.getByRole("button", { name: "Expand" });
  await expect(expandButton).toBeVisible({ timeout: 10_000 });
  await expandButton.click();

  await expect(panel.getByTestId("chain-refreshing-spinner")).toBeVisible({
    timeout: 1_000,
  });
  await expect(panel.getByText("Strike")).toBeVisible();
});

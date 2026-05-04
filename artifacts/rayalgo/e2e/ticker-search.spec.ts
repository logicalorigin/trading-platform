import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const tickerSearchFixtures = {
  CAR: [
    {
      ticker: "CAR",
      name: "Avis Budget Group Inc.",
      market: "stocks",
      active: true,
      providers: ["ibkr"],
      tradeProvider: "ibkr",
      providerContractId: "13767863",
      exchangeDisplay: "NASDAQ",
      primaryExchange: "NASDAQ",
    },
  ],
  OPTX: [
    {
      ticker: "OPTX",
      name: "Syntec Optics Holdings Inc.",
      market: "stocks",
      active: true,
      providers: ["ibkr"],
      tradeProvider: "ibkr",
      providerContractId: "674611261",
      exchangeDisplay: "NASDAQ",
      primaryExchange: "NASDAQ",
    },
  ],
  ES: [
    {
      ticker: "ES",
      name: "E-mini S&P 500 Futures",
      market: "futures",
      active: true,
      providers: ["ibkr"],
      tradeProvider: "ibkr",
      providerContractId: "495512557",
      exchangeDisplay: "CME",
      primaryExchange: "CME",
      contractMeta: { expiry: "202606", multiplier: "50" },
    },
  ],
  BTC: [
    {
      ticker: "BTC",
      name: "Bitcoin",
      market: "crypto",
      active: true,
      providers: ["ibkr"],
      tradeProvider: "ibkr",
      providerContractId: "479624278",
      exchangeDisplay: "PAXOS",
      primaryExchange: "PAXOS",
      currencyName: "USD",
    },
  ],
  APPLE: [
    {
      ticker: "AAPL",
      name: "Apple Inc.",
      market: "stocks",
      active: true,
      providers: ["ibkr"],
      tradeProvider: "ibkr",
      providerContractId: "265598",
      exchangeDisplay: "NASDAQ",
      primaryExchange: "NASDAQ",
    },
  ],
  SPX_STOCK_FALSE_POSITIVE: [
    {
      ticker: "SPXC",
      name: "SPX Technologies Inc.",
      market: "stocks",
      active: true,
      providers: ["ibkr"],
      tradeProvider: "ibkr",
      providerContractId: "552312",
      exchangeDisplay: "NYSE",
      primaryExchange: "NYSE",
    },
  ],
};

async function mockTickerSearchApi(page: import("@playwright/test").Page) {
  await page.route("**/api/universe/tickers**", async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get("search") || "").trim().toUpperCase();
    const requestedLimit = Number(url.searchParams.get("limit") || "0");
    const key = search === "AAPL" ? "APPLE" : search;
    const generatedResults =
      search === "BITF"
        ? [
            {
              ticker: "FUFU",
              name: "BitFuFu Inc. Class A Ordinary Shares",
              market: "stocks",
              active: true,
              providers: ["polygon"],
              tradeProvider: null,
              providerContractId: null,
              exchangeDisplay: "NASDAQ",
              primaryExchange: "NASDAQ",
            },
          ]
        : search === "ALPHA"
        ? Array.from({ length: 52 }, (_, index) => ({
            ticker: `ALP${String(index + 1).padStart(2, "0")}`,
            name: `Alpha Search Result ${index + 1}`,
            market: "stocks",
            active: true,
            providers: ["ibkr"],
            tradeProvider: "ibkr",
            providerContractId: `9900${index + 1}`,
            exchangeDisplay: index % 2 ? "NYSE" : "NASDAQ",
            primaryExchange: index % 2 ? "NYSE" : "NASDAQ",
          }))
        : search === "SPX"
          ? tickerSearchFixtures.SPX_STOCK_FALSE_POSITIVE
          : search === "$SPX"
            ? []
        : null;
    const results = generatedResults ||
      tickerSearchFixtures[key as keyof typeof tickerSearchFixtures] ||
      Object.entries(tickerSearchFixtures)
        .filter(([fixtureKey]) => fixtureKey.includes(search))
        .flatMap(([, rows]) => rows);
    const limitedResults =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? results.slice(0, requestedLimit)
        : results;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: limitedResults.length, results: limitedResults }),
    });
  });
}

async function openFirstTickerSearch(page: import("@playwright/test").Page) {
  await mockTickerSearchApi(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/?lab=ticker-search", { waitUntil: "domcontentloaded" });

  const searchButton = page.getByTestId("chart-symbol-search-button").first();
  await expect(searchButton).toBeVisible({ timeout: 30_000 });
  await searchButton.click({ noWaitAfter: true });

  const popover = page.getByTestId("ticker-search-popover").first();
  await expect(popover).toBeVisible();

  const input = popover.getByTestId("ticker-search-input");
  await expect(input).toBeVisible();
  return { input, popover };
}

async function openTradeChartTickerSearch(page: import("@playwright/test").Page) {
  await mockTickerSearchApi(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "trade",
        sym: "SPY",
        tradeActiveTicker: "SPY",
      }),
    );
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const tradeChart = page.getByTestId("trade-equity-chart");
  await expect(tradeChart).toBeVisible({ timeout: 30_000 });

  const searchButton = tradeChart.getByTestId("chart-symbol-search-button");
  await expect(searchButton).toBeVisible({ timeout: 30_000 });
  await searchButton.click({ noWaitAfter: true });

  const panel = page
    .locator('[data-testid="ticker-search-panel"], [data-testid="ticker-search-popover"]')
    .first();
  await expect(panel).toBeVisible({ timeout: 30_000 });

  const input = panel.getByTestId("ticker-search-input");
  await expect(input).toBeVisible();
  return { input, panel, tradeChart };
}

async function fillAndWaitForTickerSearch(
  page: import("@playwright/test").Page,
  input: ReturnType<import("@playwright/test").Page["locator"]>,
  query: string,
) {
  const normalizedQuery = query.toUpperCase();
  const responsePromise = page.waitForResponse(
    (response) => {
      if (!response.url().includes("/api/universe/tickers") || response.status() !== 200) {
        return false;
      }
      const url = new URL(response.url());
      return (url.searchParams.get("search") || "").toUpperCase() === normalizedQuery;
    },
    { timeout: 30_000 },
  );

  await input.fill(query);
  await expect(input).toHaveValue(query);
  await responsePromise;
}

async function expectSelectableTickerRow(
  popover: import("@playwright/test").Locator,
  expected: { ticker: string; market: string },
) {
  const row = popover
    .locator(
      `[data-testid="ticker-search-row"][data-ticker="${expected.ticker}"][data-market="${expected.market}"]`,
    )
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(/IBKR/);
  await expect(row).toHaveAttribute("data-provider-contract-id", /.+/);
  return row;
}

[
  {
    name: "live ticker search selects CAR with Enter",
    query: "CAR",
    expected: { ticker: "CAR", market: "stocks" },
    selection: "enter" as const,
  },
  {
    name: "live ticker search selects OPTX by click",
    query: "OPTX",
    expected: { ticker: "OPTX", market: "stocks" },
    selection: "click" as const,
  },
  {
    name: "live ticker search selects ES futures with Enter",
    query: "ES",
    expected: { ticker: "ES", market: "futures" },
    selection: "enter" as const,
  },
  {
    name: "live ticker search selects BTC crypto by click",
    query: "BTC",
    expected: { ticker: "BTC", market: "crypto" },
    selection: "click" as const,
  },
  {
    name: "live ticker search resolves Apple by company name",
    query: "Apple",
    expected: { ticker: "AAPL", market: "stocks" },
    selection: "enter" as const,
  },
].forEach((testcase) => {
  test(testcase.name, async ({ page }) => {
    const { input, popover } = await openFirstTickerSearch(page);

    await fillAndWaitForTickerSearch(page, input, testcase.query);

    const firstRow = popover.getByTestId("ticker-search-row").first();
    await expect(firstRow).toHaveAttribute("data-ticker", testcase.expected.ticker, {
      timeout: 30_000,
    });
    await expect(firstRow).toHaveAttribute("data-market", testcase.expected.market);

    const row = await expectSelectableTickerRow(popover, testcase.expected);
    if (testcase.selection === "enter") {
      await input.press("Enter");
    } else {
      await row.click();
    }

    await expect(page.getByTestId("ticker-search-popover")).toHaveCount(0);
    await expect(page.getByTitle(`Search ${testcase.expected.ticker}`).first()).toBeVisible();
  });
});

test("trade equity chart search selects AAPL by company name", async ({ page }) => {
  const { input, panel, tradeChart } = await openTradeChartTickerSearch(page);

  await fillAndWaitForTickerSearch(page, input, "Apple");

  const firstRow = panel.getByTestId("ticker-search-row").first();
  await expect(firstRow).toHaveAttribute("data-ticker", "AAPL", {
    timeout: 30_000,
  });
  await expect(firstRow).toHaveAttribute("data-market", "stocks");

  await input.press("Enter");

  await expect(
    page.locator('[data-testid="ticker-search-panel"], [data-testid="ticker-search-popover"]'),
  ).toHaveCount(0);
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search AAPL",
  );
});

test("trade chart search selects fuzzy data-only matches like market chart search", async ({
  page,
}) => {
  const { input, panel, tradeChart } = await openTradeChartTickerSearch(page);

  await fillAndWaitForTickerSearch(page, input, "BITF");

  const fuzzyRow = panel
    .locator('[data-testid="ticker-search-row"][data-ticker="FUFU"]')
    .first();
  await expect(fuzzyRow).toBeVisible({ timeout: 30_000 });
  await expect(fuzzyRow).toContainText(/Data only/i);
  await fuzzyRow.click();

  await expect(
    page.locator('[data-testid="ticker-search-panel"], [data-testid="ticker-search-popover"]'),
  ).toHaveCount(0);
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search FUFU",
  );
});

test("empty chart search shows smart suggestions before typing", async ({ page }) => {
  const { popover } = await openFirstTickerSearch(page);

  await expect(popover.getByText("Continue")).toBeVisible();
  await expect(popover.getByTestId("ticker-search-row").first()).toHaveAttribute(
    "data-ticker",
    "SPY",
  );
});

test("smart search keeps SPX index intent above stock false positives", async ({ page }) => {
  const { input, popover } = await openFirstTickerSearch(page);

  await fillAndWaitForTickerSearch(page, input, "spx");

  const firstRow = popover.getByTestId("ticker-search-row").first();
  await expect(firstRow).toHaveAttribute("data-ticker", "SPX");
  await expect(firstRow).toHaveAttribute("data-market", "indices");
  await expect(firstRow).toContainText("Index");

  await expect(
    popover.locator('[data-testid="ticker-search-row"][data-ticker="SPXC"]').first(),
  ).toBeVisible();
});

test("unresolved smart suggestion rewrites prefixed index query for live resolution", async ({
  page,
}) => {
  const { input, popover } = await openFirstTickerSearch(page);

  await fillAndWaitForTickerSearch(page, input, "$SPX");
  const suggestion = popover
    .locator('[data-testid="ticker-search-row"][data-ticker="SPX"][data-market="indices"]')
    .first();
  await expect(suggestion).toBeVisible();

  const resolvedResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/universe/tickers") &&
      response.url().includes("search=SPX") &&
      response.status() === 200,
    { timeout: 30_000 },
  );
  await suggestion.click();
  await expect(input).toHaveValue("SPX");
  await resolvedResponse;
});

test("ticker search progressively loads large result sets without a fixed visible cap", async ({ page }) => {
  const { input, popover } = await openFirstTickerSearch(page);

  await fillAndWaitForTickerSearch(page, input, "ALPHA");

  await expect(popover.getByTestId("ticker-search-row")).toHaveCount(24);
  const loadMore = popover.getByRole("button", { name: /load more matches/i });
  await expect(loadMore).toBeVisible();

  const expandedResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/universe/tickers") &&
      response.url().includes("search=ALPHA") &&
      response.url().includes("limit=64") &&
      response.status() === 200,
    { timeout: 30_000 },
  );
  await loadMore.click();
  await expandedResponse;

  await expect(popover.getByTestId("ticker-search-row")).toHaveCount(48);
});

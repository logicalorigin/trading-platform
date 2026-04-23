import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

async function openFirstTickerSearch(page: import("@playwright/test").Page) {
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

  const panel = page.getByTestId("ticker-search-panel");
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
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/universe/tickers") &&
      response.url().includes(`search=${encodeURIComponent(query)}`) &&
      response.status() === 200,
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
  await expect(row.locator("img")).toHaveCount(0);
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

  await expect(page.getByTestId("ticker-search-panel")).toHaveCount(0);
  await expect(tradeChart.getByTestId("chart-symbol-search-button")).toHaveAttribute(
    "title",
    "Search AAPL",
  );
});

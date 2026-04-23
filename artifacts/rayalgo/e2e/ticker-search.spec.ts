import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

async function openFirstTickerSearch(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const searchButton = page.getByTestId("chart-symbol-search-button").first();
  await expect(searchButton).toBeVisible({ timeout: 30_000 });
  await searchButton.click();

  const input = page.getByTestId("ticker-search-input").first();
  await expect(input).toBeVisible();
  return input;
}

test("live ticker search selects CAR with Enter", async ({ page }) => {
  const input = await openFirstTickerSearch(page);

  await input.fill("CAR");
  const firstRow = page.getByTestId("ticker-search-row").first();
  await expect(firstRow).toHaveAttribute("data-ticker", "CAR", { timeout: 30_000 });
  await expect(firstRow).toContainText(/IBKR/);
  await expect(firstRow).toHaveAttribute("data-provider-contract-id", /.+/);
  await expect(firstRow.locator("img")).toHaveCount(0);

  await input.press("Enter");

  await expect(page.getByTestId("ticker-search-popover")).toHaveCount(0);
  await expect(page.getByTitle("Search CAR").first()).toBeVisible();
});

test("live ticker search selects OPTX by click", async ({ page }) => {
  const input = await openFirstTickerSearch(page);

  await input.fill("OPTX");

  const optxRow = page.locator('[data-testid="ticker-search-row"][data-ticker="OPTX"][data-market="stocks"]').first();
  await expect(optxRow).toBeVisible({ timeout: 30_000 });
  await expect(optxRow).toContainText(/IBKR/);
  await expect(optxRow).toHaveAttribute("data-provider-contract-id", /.+/);
  await expect(optxRow.locator("img")).toHaveCount(0);
  await optxRow.click();

  await expect(page.getByTestId("ticker-search-popover")).toHaveCount(0);
  await expect(page.getByTitle("Search OPTX").first()).toBeVisible();
});

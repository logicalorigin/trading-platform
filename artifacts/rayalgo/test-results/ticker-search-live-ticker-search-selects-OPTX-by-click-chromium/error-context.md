# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ticker-search.spec.ts >> live ticker search selects OPTX by click
- Location: e2e/ticker-search.spec.ts:37:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="ticker-search-row"][data-ticker="OPTX"][data-market="stocks"]').first()
Expected: visible
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for locator('[data-testid="ticker-search-row"][data-ticker="OPTX"][data-market="stocks"]').first()

```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | test.describe.configure({ mode: "serial" });
  4  | test.setTimeout(60_000);
  5  | 
  6  | async function openFirstTickerSearch(page: import("@playwright/test").Page) {
  7  |   await page.addInitScript(() => {
  8  |     window.localStorage.clear();
  9  |   });
  10 |   await page.goto("/", { waitUntil: "domcontentloaded" });
  11 | 
  12 |   const searchButton = page.getByTestId("chart-symbol-search-button").first();
  13 |   await expect(searchButton).toBeVisible({ timeout: 30_000 });
  14 |   await searchButton.click();
  15 | 
  16 |   const input = page.getByTestId("ticker-search-input").first();
  17 |   await expect(input).toBeVisible();
  18 |   return input;
  19 | }
  20 | 
  21 | test("live ticker search selects CAR with Enter", async ({ page }) => {
  22 |   const input = await openFirstTickerSearch(page);
  23 | 
  24 |   await input.fill("CAR");
  25 |   const firstRow = page.getByTestId("ticker-search-row").first();
  26 |   await expect(firstRow).toHaveAttribute("data-ticker", "CAR", { timeout: 30_000 });
  27 |   await expect(firstRow).toContainText(/IBKR/);
  28 |   await expect(firstRow).toHaveAttribute("data-provider-contract-id", /.+/);
  29 |   await expect(firstRow.locator("img")).toHaveCount(0);
  30 | 
  31 |   await input.press("Enter");
  32 | 
  33 |   await expect(page.getByTestId("ticker-search-popover")).toHaveCount(0);
  34 |   await expect(page.getByTitle("Search CAR").first()).toBeVisible();
  35 | });
  36 | 
  37 | test("live ticker search selects OPTX by click", async ({ page }) => {
  38 |   const input = await openFirstTickerSearch(page);
  39 | 
  40 |   await input.fill("OPTX");
  41 | 
  42 |   const optxRow = page.locator('[data-testid="ticker-search-row"][data-ticker="OPTX"][data-market="stocks"]').first();
> 43 |   await expect(optxRow).toBeVisible({ timeout: 30_000 });
     |                         ^ Error: expect(locator).toBeVisible() failed
  44 |   await expect(optxRow).toContainText(/IBKR/);
  45 |   await expect(optxRow).toHaveAttribute("data-provider-contract-id", /.+/);
  46 |   await expect(optxRow.locator("img")).toHaveCount(0);
  47 |   await optxRow.click();
  48 | 
  49 |   await expect(page.getByTestId("ticker-search-popover")).toHaveCount(0);
  50 |   await expect(page.getByTitle("Search OPTX").first()).toBeVisible();
  51 | });
  52 | 
```
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.setTimeout(180_000);

const screenshotDir = join(tmpdir(), "account-visual-review");

async function openAccountScreen(page: Page) {
  await page.goto("/");
  const nav = page.getByTestId("platform-screen-nav");
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await nav.getByRole("button", { name: /^Account/ }).click();
  await expect(page.getByTestId("screen-host-account")).toHaveAttribute(
    "aria-hidden",
    "false",
    { timeout: 30_000 },
  );
  // Allow account queries (allocation, risk, patterns, equity, bars) to settle.
  await page.waitForTimeout(15_000);
}

async function shotByText(page: Page, label: string, file: string) {
  const heading = page
    .locator(`text=/^${label}$/i`)
    .first()
    .locator("xpath=ancestor::*[contains(@class,'ra-panel')][1]");
  if (await heading.count()) {
    await heading.scrollIntoViewIfNeeded();
    await heading.screenshot({ path: join(screenshotDir, file) }).catch(() => undefined);
    return true;
  }
  return false;
}

test("capture account screen for visual review", async ({ page }) => {
  await mkdir(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1800, height: 1400 });
  await openAccountScreen(page);

  // Hide the watchlist sidebar so we get more screen real-estate.
  const watchlistToggle = page
    .locator('[aria-label*="watchlist" i], [title*="watchlist" i]')
    .first();
  if (await watchlistToggle.count()) {
    await watchlistToggle.click({ trial: true }).catch(() => undefined);
  }

  // Element-targeted screenshots for the panels I modified.
  await shotByText(page, "Returns", "P-AccountReturnsPanel.png");
  await shotByText(page, "Allocation & Exposure", "P-AllocationPanel.png");
  await shotByText(page, "Risk Dashboard", "P-RiskDashboardPanel.png");
  await shotByText(page, "Equity Curve", "P-EquityCurvePanel.png");
  await shotByText(page, "Position Heatmap", "P-PositionTreemapPanel.png");
  await shotByText(page, "Intraday P&L", "P-IntradayPnlPanel.png");
  await shotByText(page, "Current Positions · 0", "P-PositionsPanel.png");
  await shotByText(page, "Trading Analysis", "P-TradingPatternsPanel.png");
  await shotByText(page, "Closed Trades · 0", "P-ClosedTradesPanel.png");
  await shotByText(page, "Selected Trade", "P-SelectedTradeAnalysisPanel.png");
  await shotByText(page, "Cash & Funding", "P-CashFundingPanel.png");
  await shotByText(page, "Setup & Health", "P-SetupHealthPanel.png");

  // Full page in dark and then light theme.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: join(screenshotDir, "full-dark.png"),
    fullPage: true,
  });

  // Toggle light theme — the platform exposes a theme toggle in Settings.
  // Try a header theme toggle first; fallback to keyboard shortcut.
  const themeToggle = page
    .locator('[aria-label*="theme" i], [title*="theme" i], [data-testid*="theme"]')
    .first();
  if (await themeToggle.count()) {
    await themeToggle.click().catch(() => undefined);
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: join(screenshotDir, "full-light.png"),
      fullPage: true,
    });
  }
});

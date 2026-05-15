import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test.setTimeout(120_000);

const screenshotDir = "/tmp/polish-pass";

const SCREENS: Array<{ id: string; anchorTestId: string; settleMs?: number }> = [
  { id: "market", anchorTestId: "market-workspace", settleMs: 10_000 },
  { id: "flow", anchorTestId: "flow-top-toolbar", settleMs: 6_000 },
  { id: "gex", anchorTestId: "gex-screen", settleMs: 6_000 },
  { id: "trade", anchorTestId: "trade-top-zone", settleMs: 8_000 },
  { id: "account", anchorTestId: "account-screen", settleMs: 12_000 },
  { id: "algo", anchorTestId: "algo-screen", settleMs: 6_000 },
  { id: "diagnostics", anchorTestId: "diagnostics-screen", settleMs: 6_000 },
  { id: "settings", anchorTestId: "settings-screen", settleMs: 6_000 },
];

async function openScreen(page: Page, screen: string, anchorTestId: string, settleMs: number) {
  await page.addInitScript((s) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: s,
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: true,
        tradeActiveTicker: "SPY",
        tradeContracts: { SPY: { strike: 500, cp: "C", exp: "" } },
      }),
    );
  }, screen);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(anchorTestId)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(settleMs);
}

for (const { id, anchorTestId, settleMs = 6_000 } of SCREENS) {
  test(`polish ${id} @ desktop-1440`, async ({ page }) => {
    await mkdir(screenshotDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, id, anchorTestId, settleMs);
    await page.screenshot({ path: join(screenshotDir, `${id}.png`) });
  });
}

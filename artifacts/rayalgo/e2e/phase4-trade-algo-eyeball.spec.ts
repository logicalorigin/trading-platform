import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test.setTimeout(240_000);

const screenshotDir = "/tmp/phase4-screens";

const VIEWPORTS = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-800", width: 800, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

async function openScreen(page: Page, screen: "trade" | "algo", anchorTestId: string) {
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
  await page.waitForTimeout(6_000);
}

for (const vp of VIEWPORTS) {
  test(`Trade eyeball @ ${vp.name}`, async ({ page }) => {
    await mkdir(screenshotDir, { recursive: true });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openScreen(page, "trade", "trade-top-zone");
    await page.screenshot({ path: join(screenshotDir, `trade-${vp.name}.png`) });
  });

  test(`Algo eyeball @ ${vp.name}`, async ({ page }) => {
    await mkdir(screenshotDir, { recursive: true });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openScreen(page, "algo", "algo-screen");
    await page.screenshot({ path: join(screenshotDir, `algo-${vp.name}.png`) });
  });
}

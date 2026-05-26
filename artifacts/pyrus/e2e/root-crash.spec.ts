import { expect, test } from "@playwright/test";

test("root crash diagnostics render for an explicit app-shell render crash", async ({ page }) => {
  await page.goto("/?crash=render", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("root-crash-diagnostics")).toBeVisible();
  await expect(page.getByText("PYRUS ROOT CRASH")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "PYRUS dev crash diagnostics trigger" }),
  ).toBeVisible();
  await expect(page.locator('img[src="/brand/pyrus-mark-dark.svg"]').first()).toBeVisible();
  await expect(page.locator('img[src="/brand/pyrus-wordmark-tight.png"]').first()).toBeVisible();
});

test("root crash diagnostics survive a synchronous logo-module boot failure", async ({ page }) => {
  await page.route(/\/src\/components\/brand\/pyrus-mark\.tsx(?:\?|$)/, (route) =>
    route.abort("failed"),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("root-crash-diagnostics")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("PYRUS ROOT CRASH")).toBeVisible();
  await expect(page.locator('img[src="/brand/pyrus-mark-dark.svg"]').first()).toBeVisible();
  await expect(page.locator('img[src="/brand/pyrus-wordmark-tight.png"]').first()).toBeVisible();
});

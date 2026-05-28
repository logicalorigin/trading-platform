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

test("retired logo module failure does not become a root boot failure", async ({ page }) => {
  await page.route(/\/src\/components\/brand\/pyrus-mark\.tsx(?:\?|$)/, (route) =>
    route.abort("failed"),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("platform-error-boundary-pyrus-workspace")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("root-crash-diagnostics")).toHaveCount(0);
});

test("root crash diagnostics survive an early app-module boot failure", async ({ page }) => {
  await page.route(/\/src\/app\/App\.tsx(?:\?|$)/, (route) =>
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

test("workspace chunk failure does not escalate to root crash diagnostics", async ({ page }) => {
  await page.route(/\/src\/features\/platform\/PlatformApp\.jsx(?:\?|$)/, (route) =>
    route.abort("failed"),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("platform-error-boundary-pyrus-workspace")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("root-crash-diagnostics")).toHaveCount(0);
});

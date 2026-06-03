import { expect, test } from "@playwright/test";

test.setTimeout(90_000);

const waitForWorkspaceBootOverlayToClear = async (page) => {
  await expect(page.getByTestId("pyrus-boot-progress-overlay")).toHaveCount(0, {
    timeout: 60_000,
  });
};

const openAccountScreen = async (page) => {
  await waitForWorkspaceBootOverlayToClear(page);
  await page.getByRole("button", { name: /^Account$/ }).click();
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await waitForWorkspaceBootOverlayToClear(page);
};

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

test("vite client bootstrap loss reports the app entry script URL", async ({ page }) => {
  await page.route("**/@vite/client", (route) => route.abort("failed"));

  await page.goto("/?pyrusQa=safe", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("root-crash-diagnostics")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("root-crash-diagnostics-bundle")).toContainText(
    "/src/main.tsx",
  );
});

test("failed app entry script keeps root crash diagnostics with the resource URL", async ({
  page,
}) => {
  await page.route(/\/src\/main\.tsx(?:\?|$)/, (route) =>
    route.abort("failed"),
  );

  await page.goto("/?pyrusQa=safe", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("root-crash-diagnostics")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("PYRUS ROOT CRASH")).toBeVisible();
  await expect(page.getByTestId("root-crash-diagnostics-bundle")).toContainText(
    "/src/main.tsx",
  );
});

test("logo module recovers from a transient workspace dependency failure", async ({ page }) => {
  let failedOnce = false;
  await page.route(/\/src\/components\/brand\/pyrus-mark\.tsx(?:\?|$)/, (route) => {
    if (!failedOnce) {
      failedOnce = true;
      return route.abort("failed");
    }
    return route.continue();
  });

  await page.goto("/?pyrusQa=safe", { waitUntil: "domcontentloaded" });

  await waitForWorkspaceBootOverlayToClear(page);
  await expect(page.getByRole("button", { name: /^Account$/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("root-crash-diagnostics")).toHaveCount(0);
  await expect(page.getByTestId("platform-error-boundary-pyrus-workspace")).toHaveCount(0);
  expect(failedOnce).toBe(true);
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

test("account hero chunk recovers from a transient dynamic import failure", async ({ page }) => {
  let failedOnce = false;
  await page.route(/\/src\/screens\/account\/AccountHeroBlock\.jsx(?:\?|$)/, (route) => {
    if (!failedOnce) {
      failedOnce = true;
      return route.abort("failed");
    }
    return route.continue();
  });

  await page.goto("/?pyrusQa=safe", { waitUntil: "domcontentloaded" });
  await openAccountScreen(page);

  await expect(page.getByTestId("account-hero-block")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("root-crash-diagnostics")).toHaveCount(0);
  await expect(page.getByTestId("platform-error-boundary-pyrus-workspace")).toHaveCount(0);
});

test("account today chunk recovers from a transient dynamic import failure", async ({ page }) => {
  let failedOnce = false;
  await page.route(/\/src\/screens\/account\/TodaySnapshotPanel\.jsx(?:\?|$)/, (route) => {
    if (!failedOnce) {
      failedOnce = true;
      return route.abort("failed");
    }
    return route.continue();
  });

  await page.goto("/?pyrusQa=safe", { waitUntil: "domcontentloaded" });
  await openAccountScreen(page);

  await expect(page.getByText("Today").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("root-crash-diagnostics")).toHaveCount(0);
  await expect(page.getByTestId("platform-error-boundary-pyrus-workspace")).toHaveCount(0);
});

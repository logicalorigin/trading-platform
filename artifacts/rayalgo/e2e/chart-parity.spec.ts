import { expect, test, type ConsoleMessage } from "@playwright/test";

const primaryFrame = '[data-testid="parity-app-primary"]';
const secondaryFrame = '[data-testid="parity-app-secondary"]';

test.describe.configure({ mode: "serial" });

function isIgnorableRuntimeConsoleError(message: ConsoleMessage) {
  const text = message.text();
  const { url } = message.location();

  if (url.includes("tradingview-widget.com/support/support-portal-problems/")) {
    return true;
  }

  return (
    url.includes("tradingview-widget.com/static/bundles/embed/") &&
    text.includes("Fetch:/support/support-portal-problems/")
  );
}

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !isIgnorableRuntimeConsoleError(message)) {
      pageErrors.push(message.text());
    }
  });

  await page.goto("/?lab=chart-parity", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("parity-root")).toBeVisible();

  test.info().annotations.push({
    type: "runtime-errors",
    description: JSON.stringify(pageErrors),
  });
  expect(pageErrors, "parity lab should not emit runtime errors during load").toEqual([]);
});

test("renders the shared-frame parity lab shell", async ({ page }) => {
  await expect(page.getByTestId("parity-app-primary")).toBeVisible();
  await expect(page.getByTestId("parity-app-secondary")).toBeVisible();
  await expect(page.getByTestId("parity-reference-card")).toBeVisible();
  await expect(page.getByTestId("parity-app-primary-surface")).toBeVisible();
  await expect(page.getByTestId("parity-app-secondary-surface")).toBeVisible();
  await expect(page.getByTestId("parity-reference-surface")).toBeVisible();
});

test("keeps timeframe state independent per chart frame", async ({ page }) => {
  const primary = page.locator(primaryFrame);
  const secondary = page.locator(secondaryFrame);

  await primary.getByRole("button", { name: "1h" }).click();
  await expect(primary).toContainText("fixture 1h");
  await expect(secondary).toContainText("fixture 5m");

  await secondary.getByRole("button", { name: "15m" }).click();
  await expect(secondary).toContainText("fixture 15m");
  await expect(primary).toContainText("fixture 1h");
});

test("keeps study toggles isolated to the targeted frame", async ({ page }) => {
  const primary = page.locator(primaryFrame);
  const secondary = page.locator(secondaryFrame);

  await primary.getByRole("button", { name: /Indicators/ }).click();
  const primaryVwap = page.getByRole("menuitemcheckbox", { name: "vwap" });
  await expect(primaryVwap).toHaveAttribute("aria-checked", "true");
  await primaryVwap.click();
  await expect(primary).toContainText("Indicators 2");
  await expect(primary).not.toContainText("ema-21 · ema-55 · vwap");

  await secondary.getByRole("button", { name: /Indicators/ }).click();
  const secondaryVwap = page.getByRole("menuitemcheckbox", { name: "vwap" });
  await expect(secondaryVwap).toHaveAttribute("aria-checked", "true");
  await expect(secondary).toContainText("Indicators 3");
  await expect(secondary).toContainText("ema-21 · ema-55 · vwap");
});

test("keeps toolbar interactions isolated to the targeted frame", async ({ page }) => {
  const primary = page.locator(primaryFrame);
  const secondary = page.locator(secondaryFrame);

  await primary.getByTitle("Horizontal line").click();

  await expect(primary.getByTitle("Horizontal line")).toHaveAttribute("aria-pressed", "true");
  await expect(secondary.getByTitle("Horizontal line")).toHaveAttribute("aria-pressed", "false");
  await expect(primary.getByTitle("Crosshair / pan")).toHaveAttribute("aria-pressed", "false");
  await expect(secondary.getByTitle("Crosshair / pan")).toHaveAttribute("aria-pressed", "true");
});

test("preserves frame structure on empty scenarios", async ({ page }) => {
  await page.getByTestId("parity-scenario-empty").click();

  await expect(page.getByTestId("parity-app-primary")).toBeVisible();
  await expect(page.getByTestId("parity-app-secondary")).toBeVisible();
  await expect(page.getByTestId("parity-reference-card")).toBeVisible();
  await expect(page.locator(primaryFrame)).toContainText(/no live chart data/i);
  await expect(page.locator(secondaryFrame)).toContainText(/no live chart data/i);
});

test("renders the live RayReplica parity fixture and settings surface", async ({ page }) => {
  await page.getByTestId("parity-scenario-rayreplica").click();

  await expect(page.locator(primaryFrame)).toContainText("RayReplica");
  await expect(page.getByTitle("Tune RayReplica overlay settings")).toBeVisible();
  await expect(page.locator(primaryFrame).getByText(/RAYREPLICA/i).first()).toBeVisible();

  await page.getByTitle("Tune RayReplica overlay settings").click();
  await expect(page.getByText("Structure").first()).toBeVisible();
  await expect(page.getByText("Confirm").first()).toBeVisible();
});

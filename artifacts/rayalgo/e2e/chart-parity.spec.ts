import { expect, test } from "@playwright/test";

const primaryFrame = '[data-testid="parity-app-primary"]';
const secondaryFrame = '[data-testid="parity-app-secondary"]';
const primaryToolbar = '[data-testid="parity-app-primary-surface-toolbar"]';
const secondaryToolbar = '[data-testid="parity-app-secondary-surface-toolbar"]';

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
    }
  });

  await page.goto("/?lab=chart-parity", { waitUntil: "networkidle" });
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

  const primaryVwap = primary.getByRole("button", { name: "vwap" });
  const secondaryVwap = secondary.getByRole("button", { name: "vwap" });

  await expect(primaryVwap).toHaveAttribute("aria-pressed", "true");
  await expect(secondaryVwap).toHaveAttribute("aria-pressed", "true");

  await primaryVwap.click();

  await expect(primaryVwap).toHaveAttribute("aria-pressed", "false");
  await expect(secondaryVwap).toHaveAttribute("aria-pressed", "true");
});

test("keeps toolbar interactions isolated to the targeted frame", async ({ page }) => {
  const primary = page.locator(primaryToolbar);
  const secondary = page.locator(secondaryToolbar);

  await primary.getByRole("button", { name: "LINE" }).click();

  await expect(primary.getByRole("button", { name: "LINE" })).toHaveAttribute("aria-pressed", "true");
  await expect(secondary.getByRole("button", { name: "LINE" })).toHaveAttribute("aria-pressed", "false");
  await expect(primary.getByRole("button", { name: "CND" })).toHaveAttribute("aria-pressed", "false");
  await expect(secondary.getByRole("button", { name: "CND" })).toHaveAttribute("aria-pressed", "true");
});

test("preserves frame structure on empty scenarios", async ({ page }) => {
  await page.getByTestId("parity-scenario-empty").click();

  await expect(page.getByTestId("parity-app-primary")).toBeVisible();
  await expect(page.getByTestId("parity-app-secondary")).toBeVisible();
  await expect(page.getByTestId("parity-reference-card")).toBeVisible();
  await expect(page.locator(primaryFrame)).toContainText("fixture 5m");
  await expect(page.getByText("no live chart data").first()).toBeVisible();
});

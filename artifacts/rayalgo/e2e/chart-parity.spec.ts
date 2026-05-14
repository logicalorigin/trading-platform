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

function expectBoxInsidePlot(
  box: { x: number; y: number; width: number; height: number },
  plotBox: { x: number; y: number; width: number; height: number },
  label: string,
) {
  const tolerance = 1.5;

  expect(box.x, `${label} should not extend left of plot`).toBeGreaterThanOrEqual(
    plotBox.x - tolerance,
  );
  expect(box.y, `${label} should not extend above plot`).toBeGreaterThanOrEqual(
    plotBox.y - tolerance,
  );
  expect(
    box.x + box.width,
    `${label} should not extend right of plot`,
  ).toBeLessThanOrEqual(plotBox.x + plotBox.width + tolerance);
  expect(
    box.y + box.height,
    `${label} should not extend below plot`,
  ).toBeLessThanOrEqual(plotBox.y + plotBox.height + tolerance);
}

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  await page.route("https://s3.tradingview.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }),
  );
  await page.route("https://www.tradingview-widget.com/**", (route) =>
    route.fulfill({
      status: 204,
      body: "",
    }),
  );
  await page.route("**/api/settings/preferences", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profileKey: "chart-parity",
        version: 1,
        preferences: {},
        source: "mock",
        updatedAt: new Date(0).toISOString(),
      }),
    }),
  );
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

  await primary.getByTestId("chart-timeframe-menu-trigger").click();
  await page.getByTestId("chart-timeframe-option-1h").click();
  await expect(primary).toContainText("fixture 1h");
  await expect(secondary).toContainText("fixture 5m");

  await secondary.getByTestId("chart-timeframe-menu-trigger").click();
  await page.getByTestId("chart-timeframe-option-15m").click();
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
  await expect(page.locator(primaryFrame)).toContainText(/bars are not hydrated yet/i);
  await expect(page.locator(secondaryFrame)).toContainText(/bars are not hydrated yet/i);
});

test("renders the live RayReplica parity fixture and settings surface", async ({ page }) => {
  await page.getByTestId("parity-scenario-rayreplica").click();

  const primary = page.locator(primaryFrame);

  await expect(primary).toContainText("RayReplica");
  await expect(page.getByTitle("Tune RayReplica overlay settings")).toBeVisible();
  await expect(primary.getByTestId("rayreplica-dashboard-panel")).toBeVisible();
  await expect(
    primary.getByTestId("rayreplica-dashboard-panel").getByText(/^(RA|RayAlgo)$/),
  ).toBeVisible();
  await expect(primary.getByTestId("rayreplica-badge-swing-label").first()).toBeVisible();
  await expect(primary.locator('[data-testid="rayreplica-dot-bull-break"], [data-testid="rayreplica-dot-bear-break"]').first()).toBeVisible();
  await expect(primary.getByTestId("rayreplica-zone-order-block").first()).toBeVisible();
  await expect(primary.getByTestId("rayreplica-zone-key-level").first()).toBeVisible();
  await expect(primary.getByTestId("rayreplica-zone-tp-sl").first()).toBeVisible();
  await expect(primary.locator('[data-testid="rayreplica-window-bullish"], [data-testid="rayreplica-window-bearish"]').first()).toBeVisible();
  await expect(page.getByTestId("rayreplica-diagnostics")).toBeVisible();

  await page.getByTitle("Tune RayReplica overlay settings").click();
  await expect(page.getByText("Structure").first()).toBeVisible();
  await expect(page.getByText("Confirm").first()).toBeVisible();

  const structureZones = primary.locator(
    '[data-testid="rayreplica-zone-bos"], [data-testid="rayreplica-zone-choch"]',
  );
  await expect(structureZones.first()).toBeVisible();
  await page.getByLabel("Show BOS").click();
  await page.getByLabel("Show CHOCH").click();
  await expect(structureZones).toHaveCount(0);
  await page.getByLabel("Show BOS").click();
  await page.getByLabel("Show CHOCH").click();
  await expect(structureZones.first()).toBeVisible();
});

test("keeps RayReplica dashboard inside the narrow chart frame", async ({ page }) => {
  await page.getByTestId("parity-scenario-rayreplica").click();
  await page.getByTestId("parity-layout-narrow").click();

  const frameBox = await page.locator(primaryFrame).boundingBox();
  const dashboardBox = await page.locator(`${primaryFrame} [data-testid="rayreplica-dashboard-panel"]`).boundingBox();

  expect(frameBox, "primary frame should have a bounding box").not.toBeNull();
  expect(dashboardBox, "RayReplica dashboard should have a bounding box").not.toBeNull();

  if (!frameBox || !dashboardBox) {
    return;
  }

  expect(dashboardBox.x).toBeGreaterThanOrEqual(frameBox.x);
  expect(dashboardBox.y).toBeGreaterThanOrEqual(frameBox.y);
  expect(dashboardBox.x + dashboardBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);
  expect(dashboardBox.y + dashboardBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height);
});

test("keeps RayReplica overlays inside the narrow chart plot area", async ({ page }) => {
  await page.getByTestId("parity-scenario-rayreplica").click();
  await page.getByTestId("parity-layout-narrow").click();

  const primary = page.locator(primaryFrame);
  await expect(primary.getByTestId("rayreplica-dashboard-panel")).toBeVisible();

  const plotBox = await primary
    .getByTestId("parity-app-primary-surface-plot")
    .boundingBox();
  const surfaceBox = await primary
    .getByTestId("parity-app-primary-surface")
    .boundingBox();
  const overlayLayerBox = await primary
    .getByTestId("parity-app-primary-surface-overlay-layer")
    .boundingBox();
  const dashboardBox = await primary
    .getByTestId("rayreplica-dashboard-panel")
    .boundingBox();
  const footerScaleControlsBox = await primary
    .locator("[data-chart-footer-scale-controls]")
    .boundingBox();

  expect(surfaceBox, "primary chart surface should have a bounding box").not.toBeNull();
  expect(plotBox, "primary chart plot should have a bounding box").not.toBeNull();
  expect(overlayLayerBox, "primary overlay layer should have a bounding box").not.toBeNull();
  expect(dashboardBox, "RayReplica dashboard should have a bounding box").not.toBeNull();
  expect(
    footerScaleControlsBox,
    "footer scale controls should have a bounding box",
  ).not.toBeNull();

  if (
    !surfaceBox ||
    !plotBox ||
    !overlayLayerBox ||
    !dashboardBox ||
    !footerScaleControlsBox
  ) {
    return;
  }

  expect(
    Math.abs(plotBox.y - surfaceBox.y),
    "chart plot should start at the surface top so top chart data overlays it",
  ).toBeLessThanOrEqual(1.5);
  expect(
    Math.abs(plotBox.y + plotBox.height - dashboardBox.y),
    "chart plot should end where the RayReplica dashboard starts",
  ).toBeLessThanOrEqual(1.5);
  expectBoxInsidePlot(overlayLayerBox, plotBox, "RayReplica overlay layer");
  expect(
    Math.abs(overlayLayerBox.y - plotBox.y),
    "RayReplica overlay layer should start at the drawable chart pane top",
  ).toBeLessThanOrEqual(1.5);
  expect(
    plotBox.y + plotBox.height - (overlayLayerBox.y + overlayLayerBox.height),
    "RayReplica overlay layer should stop above the time axis",
  ).toBeGreaterThanOrEqual(6);

  expect(
    dashboardBox.y,
    "RayReplica dashboard strip should sit below the chart plot",
  ).toBeGreaterThanOrEqual(plotBox.y + plotBox.height - 1.5);
  expect(
    dashboardBox.y + dashboardBox.height,
    "RayReplica dashboard strip should remain inside the chart frame",
  ).toBeLessThanOrEqual(surfaceBox.y + surfaceBox.height + 1.5);
  expect(
    footerScaleControlsBox.y,
    "footer scale controls should sit below the RayReplica dashboard strip",
  ).toBeGreaterThanOrEqual(dashboardBox.y + dashboardBox.height - 1.5);

  const overlayBoxes = await primary
    .locator(
      [
        '[data-testid^="rayreplica-badge-"]',
        '[data-testid^="rayreplica-dot-"]',
        '[data-testid^="rayreplica-zone-"]',
        '[data-testid^="rayreplica-window-"]',
      ].join(","),
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          testId: element.getAttribute("data-testid") || element.tagName,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }),
    );

  expect(overlayBoxes.length, "RayReplica overlays should render").toBeGreaterThan(0);

  overlayBoxes.forEach((box) => {
    expectBoxInsidePlot(box, overlayLayerBox, box.testId);
  });

  const windowBoxes = overlayBoxes.filter((box) =>
    box.testId.startsWith("rayreplica-window-"),
  );
  expect(windowBoxes.length, "RayReplica background windows should render").toBeGreaterThan(0);
  windowBoxes.forEach((box) => {
    expect(
      Math.abs(box.y - plotBox.y),
      "RayReplica background shading should start at the chart plot top",
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs(
        box.y + box.height - (overlayLayerBox.y + overlayLayerBox.height),
      ),
      "RayReplica background shading should stop at the drawable pane lower bound",
    ).toBeLessThanOrEqual(1.5);
  });
});

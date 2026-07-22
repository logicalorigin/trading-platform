import { expect, test, type Page } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
const HEADER_WIDTHS = [
  979, 980, 1024, 1119, 1120, 1179, 1180, 1440, 1441, 1759, 1760,
];
const EXPECTED_MEMBER_CONTAINMENT_DENIALS = new Set([
  "403 GET /api/algo/deployments",
  "403 GET /api/algo/events",
  "403 GET /api/charting/pine-scripts",
  "403 GET /api/streams/algo/cockpit",
]);
const FORBIDDEN_RESOURCE_CONSOLE_ERROR =
  "console: Failed to load resource: the server responded with a status of 403 (Forbidden)";

const openAuthenticatedHeader = async (page: Page) => {
  await page.goto(`${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=market`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByTestId("platform-screen-stack"),
    "T2.6 requires an authenticated normal-app session; provide PYRUS_STORAGE_STATE when the login gate is active.",
  ).toBeVisible({ timeout: READY_TIMEOUT_MS });
  await expect(page.getByTestId("screen-host-market")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("screen-suspense-fallback")).toBeHidden({
    timeout: READY_TIMEOUT_MS,
  });
};

const readHeaderGeometry = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(
      '[data-testid="platform-compact-header"]',
    );
    const nav = document.querySelector<HTMLElement>(
      '[data-testid="platform-screen-nav"]',
    );
    const controls = document.querySelector<HTMLElement>(
      '[data-testid="platform-header-controls"]',
    );
    const status = document.querySelector<HTMLElement>(
      '[data-testid="platform-header-status"]',
    );
    const brand = Array.from(header?.children || []).find(
      (element) => element.getAttribute("aria-label") === "PYRUS",
    ) as HTMLElement | undefined;

    if (!header || !nav || !controls || !brand) {
      throw new Error("Desktop header geometry is incomplete.");
    }

    const bounds = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
      };
    };
    const headerBox = bounds(header);
    const brandBox = bounds(brand);
    const navBox = bounds(nav);
    const controlsBox = bounds(controls);
    const statusBox = status ? bounds(status) : null;

    return {
      headerBox,
      brandBox,
      navBox,
      controlsBox,
      statusBox,
      controlsOverflow: controls.scrollWidth - controls.clientWidth,
    };
  });

test("authenticated desktop header stays navigable at every existing width threshold", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const runtimeErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
        ":id",
      )
      .replace(/\/\d{5,}(?=\/|$)/g, "/:id");
    failedResponses.push(
      `${response.status()} ${response.request().method()} ${pathname}`,
    );
  });

  await page.setViewportSize({ width: HEADER_WIDTHS[0], height: 900 });
  await openAuthenticatedHeader(page);

  const header = page.getByTestId("platform-compact-header");
  const nav = page.getByTestId("platform-screen-nav");
  const market = nav.getByRole("button", { name: "Market", exact: true });
  const signals = nav.getByRole("button", { name: "Signals", exact: true });
  const diagnostics = nav.getByRole("button", {
    name: "Diagnostics",
    exact: true,
  });

  await expect(market).toHaveAttribute("aria-current", "page");

  for (const width of HEADER_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(header).toBeVisible();
    await expect(nav).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );

    const geometry = await readHeaderGeometry(page);
    expect(
      {
        width,
        brandBeforeNav: geometry.brandBox.right <= geometry.navBox.left + 1,
        navBeforeControls:
          geometry.navBox.right <= geometry.controlsBox.left + 1,
        navReachable: geometry.navBox.width >= 44,
        controlsContained:
          geometry.controlsBox.left >= geometry.headerBox.left - 1 &&
          geometry.controlsBox.right <= geometry.headerBox.right + 1 &&
          geometry.controlsBox.top >= geometry.headerBox.top - 1 &&
          geometry.controlsBox.bottom <= geometry.headerBox.bottom + 1,
        controlsUnclipped: geometry.controlsOverflow <= 1,
        statusContained:
          geometry.statusBox === null ||
          (geometry.statusBox.left >= geometry.controlsBox.left - 1 &&
            geometry.statusBox.right <= geometry.controlsBox.right + 1 &&
            geometry.statusBox.top >= geometry.controlsBox.top - 1 &&
            geometry.statusBox.bottom <= geometry.controlsBox.bottom + 1),
      },
      `header collision at ${width}px`,
    ).toEqual({
      width,
      brandBeforeNav: true,
      navBeforeControls: true,
      navReachable: true,
      controlsContained: true,
      controlsUnclipped: true,
      statusContained: true,
    });
  }

  await page.setViewportSize({ width: 979, height: 900 });
  await page.keyboard.press("Tab");
  await expect(market).toBeFocused();
  for (let index = 0; index < 9; index += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(diagnostics).toBeFocused();
  const diagnosticsGeometry = await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="platform-screen-nav"] button[aria-label="Diagnostics"]',
    );
    if (!button?.parentElement) {
      throw new Error("Diagnostics navigation geometry is unavailable.");
    }
    const buttonBox = button.getBoundingClientRect();
    const navBox = button.parentElement.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      fullyVisible:
        buttonBox.left >= navBox.left - 1 && buttonBox.right <= navBox.right + 1,
      labelUnclipped: button.scrollWidth <= button.clientWidth + 1,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(diagnosticsGeometry).toEqual({
    fullyVisible: true,
    labelUnclipped: true,
    outlineStyle: "solid",
    outlineWidth: 2,
  });

  for (let index = 0; index < 9; index += 1) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect(market).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(signals).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(signals).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("screen-host-signals")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });

  // These ownerless resources deliberately fail closed for members. Correlating
  // each browser error to an exact response keeps this exception closed.
  const expectedContainmentDenials = failedResponses.filter((failure) =>
    EXPECTED_MEMBER_CONTAINMENT_DENIALS.has(failure),
  );
  const unexpectedFailedResponses = failedResponses.filter(
    (failure) => !EXPECTED_MEMBER_CONTAINMENT_DENIALS.has(failure),
  );
  const forbiddenConsoleErrors = runtimeErrors.filter(
    (error) => error === FORBIDDEN_RESOURCE_CONSOLE_ERROR,
  );
  const unexpectedRuntimeErrors = runtimeErrors.filter(
    (error) => error !== FORBIDDEN_RESOURCE_CONSOLE_ERROR,
  );

  expect({ unexpectedRuntimeErrors, unexpectedFailedResponses }).toEqual({
    unexpectedRuntimeErrors: [],
    unexpectedFailedResponses: [],
  });
  expect(forbiddenConsoleErrors).toHaveLength(expectedContainmentDenials.length);
});

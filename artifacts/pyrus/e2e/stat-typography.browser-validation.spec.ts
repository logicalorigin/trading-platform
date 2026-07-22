import { expect, test, type Locator, type Page } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;

const openScreen = async (page: Page, screenId: "market" | "flow" | "account") => {
  await page.goto(`${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=${screenId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByTestId(`screen-host-${screenId}`),
    "T2.4 requires an authenticated normal-app session; provide PYRUS_STORAGE_STATE when the login gate is active.",
  ).toBeVisible({ timeout: READY_TIMEOUT_MS });
  await expect(page.getByTestId("screen-suspense-fallback")).toBeHidden({
    timeout: READY_TIMEOUT_MS,
  });
};

const readDataVoice = (element: Locator) =>
  element.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      fontFamily: style.fontFamily,
      fontVariantNumeric: style.fontVariantNumeric,
    };
  });

test("shared Stat values match the rendered Market and Account data voice", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await openScreen(page, "market");
  const marketRegion = page.getByRole("region", {
    name: "Market regime and key statistics",
  });
  const marketValue = marketRegion
    .getByText("Breadth", { exact: true })
    .locator("xpath=following-sibling::*[1]");
  await expect(marketValue).toBeVisible({ timeout: READY_TIMEOUT_MS });
  const marketVoice = await readDataVoice(marketValue);

  await openScreen(page, "flow");
  const flowValue = page
    .getByTestId("screen-host-flow")
    .getByText("Ask / buy", { exact: true })
    .first()
    .locator("xpath=following-sibling::*[1]");
  await expect(flowValue).toBeVisible({ timeout: READY_TIMEOUT_MS });
  const flowVoice = await readDataVoice(flowValue);

  await openScreen(page, "account");
  const accountValue = page
    .getByTestId("account-hero-primary-row")
    .locator(":scope > span")
    .first();
  await expect(accountValue).toBeVisible({ timeout: READY_TIMEOUT_MS });
  const accountVoice = await readDataVoice(accountValue);

  for (const voice of [marketVoice, flowVoice, accountVoice]) {
    expect(voice.fontFamily).toContain("IBM Plex Sans");
    expect(voice.fontVariantNumeric).toContain("tabular-nums");
  }
  expect(flowVoice).toEqual(marketVoice);
  expect(flowVoice).toEqual(accountVoice);
});

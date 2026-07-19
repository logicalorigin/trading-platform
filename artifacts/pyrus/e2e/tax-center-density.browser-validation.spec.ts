import { expect, test } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, rowCounts: [2, 2], maxHeight: 250 },
  { name: "tablet", width: 768, height: 1024, rowCounts: [2, 2], maxHeight: 250 },
  { name: "desktop", width: 1440, height: 900, rowCounts: [4], maxHeight: 220 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`Tax Center uses a compact metric band on ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "tax-density-review",
            email: "tax-density@example.com",
            role: "admin",
            entitlements: [],
          },
          csrfToken: "tax-density-csrf",
        },
      }),
    );
    await page.route("**/api/accounts/*/tax/overview", (route) =>
      route.fulfill({
        json: {
          accountScope: "connected_accounts",
          estimates: {
            currency: "USD",
            totalReserveTarget: 12_400,
            federal: { status: "available" },
            state: { status: "verified" },
          },
          scope: { includedAccounts: 2, connectedAccounts: 3 },
          unknowns: [],
        },
      }),
    );
    await page.route("**/api/accounts/*/tax/events", (route) =>
      route.fulfill({ json: { events: [{ id: "one" }, { id: "two" }] } }),
    );
    await page.route("**/api/tax/reserve", (route) =>
      route.fulfill({
        json: {
          targetAmount: 12_400,
          reservedAmount: 8_700,
          currency: "USD",
          warnings: [],
        },
      }),
    );

    await page.goto(`${APP_URL}?screen=account`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
      timeout: 60_000,
    });

    const wrapper = page.getByTestId("account-deferred-tax");
    const panel = wrapper.locator("section");
    await wrapper.scrollIntoViewIfNeeded();
    await expect(panel.getByText("Events loaded: 2", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const statBoxes = await Promise.all(
      ["Federal", "State", "Reserve target", "Connected accounts"].map(
        async (label) =>
          panel.getByText(label, { exact: true }).locator("..").boundingBox(),
      ),
    );
    expect(statBoxes.every(Boolean)).toBe(true);
    const rows = statBoxes.reduce((counts, box) => {
      const row = Math.round(box!.y);
      counts.set(row, (counts.get(row) || 0) + 1);
      return counts;
    }, new Map<number, number>());
    expect([...rows.values()].sort((left, right) => left - right)).toEqual(
      [...viewport.rowCounts].sort((left, right) => left - right),
    );
    expect(statBoxes.every((box) => box!.width >= 120)).toBe(true);

    const [wrapperBox, panelBox] = await Promise.all([
      wrapper.boundingBox(),
      panel.boundingBox(),
    ]);
    expect(wrapperBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(wrapperBox!.height - panelBox!.height).toBeLessThanOrEqual(2);
    expect(panelBox!.height).toBeLessThan(viewport.maxHeight);
    expect(pageErrors).toEqual([]);

    await page.screenshot({ path: `/tmp/pyrus-account-${viewport.name}.png` });
    await panel.screenshot({ path: `/tmp/pyrus-tax-center-${viewport.name}.png` });

    if (viewport.name === "phone") {
      await panel.getByRole("button", { name: "Reserve", exact: true }).click();
      const reserveBoxes = await Promise.all(
        ["Target", "Reserved", "Mode"].map(async (label) =>
          panel.getByText(label, { exact: true }).locator("..").boundingBox(),
        ),
      );
      expect(reserveBoxes.every(Boolean)).toBe(true);
      expect(new Set(reserveBoxes.map((box) => Math.round(box!.y))).size).toBe(1);
      expect(reserveBoxes.every((box) => box!.width >= 120)).toBe(true);
    }
  });
}

test("Settings Tax uses authored metric rows on phone", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "tax-density-review",
          email: "tax-density@example.com",
          role: "admin",
          entitlements: [],
        },
        csrfToken: "tax-density-csrf",
      },
    }),
  );
  await page.route("**/api/tax/profile", (route) =>
    route.fulfill({
      json: {
        profile: { taxYear: 2026, filingStatus: "single" },
        accounts: [
          { id: "one", included: true },
          { id: "two", included: false },
        ],
      },
    }),
  );
  await page.route("**/api/tax/state-rules/status**", (route) =>
    route.fulfill({
      json: {
        ready: true,
        summary: { available: 51, stale: 0, unavailable: 0, failed_validation: 0 },
      },
    }),
  );
  await page.route("**/api/tax/reserve", (route) =>
    route.fulfill({
      json: {
        targetAmount: 12_400,
        reservedAmount: 8_700,
        coverageRatio: 0.7,
        currency: "USD",
        capability: { supportsBrokerReserve: false, reason: "virtual" },
      },
    }),
  );

  await page.goto(`${APP_URL}?screen=settings`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
    timeout: 60_000,
  });
  await page.getByTestId("settings-tab-tax").click();

  const statePanel = page
    .locator("section")
    .filter({ hasText: "State Rule Packs" })
    .first();
  await statePanel.scrollIntoViewIfNeeded();
  await expect(statePanel.getByText("Available", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const stateBoxes = await Promise.all(
    ["Available", "Stale", "Unavailable", "Failed"].map(async (label) =>
      statePanel.getByText(label, { exact: true }).locator("..").boundingBox(),
    ),
  );
  expect(stateBoxes.every(Boolean)).toBe(true);
  const stateRows = new Set(stateBoxes.map((box) => Math.round(box!.y)));
  expect(stateRows.size).toBe(2);
  expect(stateBoxes.every((box) => box!.width >= 150)).toBe(true);
  expect(pageErrors).toEqual([]);

  await statePanel.screenshot({ path: "/tmp/pyrus-tax-settings-phone.png" });
});

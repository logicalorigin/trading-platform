import { expect, test } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`route loader is frameless and centered in the ${viewport.name} workspace frame`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "workspace-loader-review",
            email: "workspace-loader@example.com",
            role: "admin",
            entitlements: [],
          },
          csrfToken: "workspace-loader-csrf",
        },
      }),
    );
    await page.route("**/api/session", (route) =>
      route.fulfill({
        json: {
          environment: "shadow",
          brokerProvider: "ibkr",
          marketDataProvider: "massive",
          marketDataProviders: {
            live: "massive",
            historical: "massive",
            research: "fmp",
          },
          configured: { massive: true, ibkr: false, research: false },
          ibkrBridge: null,
          runtime: { ibkr: {} },
          timestamp: "2026-07-15T17:00:00.000Z",
        },
      }),
    );

    let releaseAccountModule = () => {};
    const accountModuleGate = new Promise<void>((resolve) => {
      releaseAccountModule = resolve;
    });
    await page.route("**/src/screens/AccountScreen.jsx*", async (route) => {
      await accountModuleGate;
      await route.continue();
    });

    try {
      await page.goto(`${APP_URL}?screen=account`, {
        waitUntil: "domcontentloaded",
      });
      const frame = page.getByTestId("screen-host-account");
      const loader = page.getByTestId("account-route-loading");
      const cloud = loader.locator(".pyrus-workspace-cloud");
      const liveCloud = cloud.locator(".pyrus-workspace-cloud-live");
      await expect(loader).toBeVisible({ timeout: 60_000 });
      await expect(loader.locator(".pyrus-workspace-cloud-static")).toHaveCount(0);
      const cloudAvailable = (await cloud.count()) > 0;
      if (cloudAvailable) {
        await expect(liveCloud).toBeVisible({ timeout: 60_000 });
        await expect(liveCloud.locator("canvas")).toBeVisible({ timeout: 60_000 });
      }

      const [frameBox, loaderBox, cloudBox, cloudStyle] = await Promise.all([
        frame.boundingBox(),
        loader.boundingBox(),
        cloudAvailable ? cloud.boundingBox() : Promise.resolve(null),
        cloudAvailable
          ? cloud.evaluate((node) => {
              const style = getComputedStyle(node);
              return {
                backgroundColor: style.backgroundColor,
                borderTopWidth: style.borderTopWidth,
                boxShadow: style.boxShadow,
                overflow: style.overflow,
              };
            })
          : Promise.resolve(null),
      ]);
      await page.screenshot({
        path: `/tmp/pyrus-workspace-loader-centered-${viewport.name}.png`,
      });
      expect(frameBox).not.toBeNull();
      expect(loaderBox).not.toBeNull();
      expect(
        Math.abs(
          frameBox!.y +
            frameBox!.height / 2 -
            (loaderBox!.y + loaderBox!.height / 2),
        ),
      ).toBeLessThanOrEqual(4);
      expect(loaderBox!.height).toBeGreaterThan(frameBox!.height * 0.9);
      if (cloudAvailable) {
        expect(cloudBox).not.toBeNull();
        expect(
          Math.abs(
            frameBox!.x +
              frameBox!.width / 2 -
              (cloudBox!.x + cloudBox!.width / 2),
          ),
        ).toBeLessThanOrEqual(4);
        expect(cloudStyle).toEqual({
          backgroundColor: "rgba(0, 0, 0, 0)",
          borderTopWidth: "0px",
          boxShadow: "none",
          overflow: "visible",
        });
      }
    } finally {
      releaseAccountModule();
    }
  });
}

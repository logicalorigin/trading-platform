import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const SHOT_DIR =
  process.env.PYRUS_QA_SHOT_DIR || "/tmp/pyrus-onboarding-visual";

const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const EMPTY_GET_PATHS = new Set([
  "/api/algo/deployments",
  "/api/algo/events",
  "/api/bars",
  "/api/broker-connections",
  "/api/broker-execution/ibkr-portal/readiness",
  "/api/broker-execution/robinhood/readiness",
  "/api/broker-execution/schwab/readiness",
  "/api/broker-execution/snaptrade/brokerages",
  "/api/broker-execution/snaptrade/readiness",
  "/api/charting/pine-scripts",
  "/api/flow/events",
  "/api/flow/events/aggregate",
  "/api/flow/universe",
  "/api/gex/SPY/projection",
  "/api/gex/SPY/zero-gamma",
  "/api/news",
  "/api/quotes/snapshot",
  "/api/research/status",
  "/api/settings/backend",
  "/api/signal-monitor/events",
  "/api/signal-monitor/profile",
  "/api/watchlists",
]);
const EVENT_STREAM_PATHS = new Set([
  "/api/diagnostics/stream",
  "/api/signal-monitor/matrix/stream",
  "/api/streams/quotes",
  "/api/streams/stocks/aggregates",
]);

mkdirSync(SHOT_DIR, { recursive: true });

async function mockOnboardingRuntime(page: Page) {
  let onboarding: unknown;
  let connectionVerified = false;
  const unknownGetPaths = new Set<string>();
  const blockedMutations: string[] = [];
  const backgroundPosts: string[] = [];
  const preferenceWrites: unknown[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "00000000-0000-4000-8000-000000000042",
            email: "onboarding-visual@example.com",
            role: "user",
            entitlements: ["broker_connect"],
          },
          csrfToken: "onboarding-visual-csrf",
        },
      });
      return;
    }
    if (path === "/api/session") {
      await route.fulfill({
        json: {
          environment: "shadow",
          brokerProvider: "snaptrade",
          marketDataProvider: "massive",
          marketDataProviders: {
            live: "massive",
            historical: "massive",
            research: "fmp",
          },
          configured: { massive: true, ibkr: false, research: false },
          ibkrBridge: null,
          runtime: { ibkr: {} },
          timestamp: "2026-07-18T12:00:00.000Z",
        },
      });
      return;
    }
    if (path === "/api/settings/preferences") {
      if (method === "PATCH") {
        const payload = request.postDataJSON() as Record<string, unknown>;
        preferenceWrites.push(payload);
        expect(Object.keys(payload)).toEqual(["preferences"]);
        const preferences = payload.preferences as Record<string, unknown>;
        expect(Object.keys(preferences)).toEqual(["onboarding"]);
        onboarding = preferences.onboarding;
      } else if (method !== "GET") {
        blockedMutations.push(`${method} ${path}`);
        await route.fulfill({
          status: 405,
          json: { error: "Unexpected preferences method." },
        });
        return;
      }
      await route.fulfill({
        json: {
          profileKey: "default",
          version: 1,
          preferences: onboarding === undefined ? {} : { onboarding },
          source: "database",
          updatedAt: "2026-07-18T12:00:00.000Z",
        },
      });
      return;
    }
    if (path === "/api/broker-execution/included-accounts") {
      await route.fulfill({
        json: {
          accounts: [
            {
              id: "00000000-0000-4000-8000-000000000043",
              providerAccountId: "snaptrade:visual-review",
              provider: "snaptrade",
              mode: "live",
              displayName: "Visual review account",
              accountType: "equity",
              includedInTrading: true,
              connectionVerified,
              executionReady: false,
              executionBlockers: connectionVerified
                ? ["snaptrade.connection.read_only"]
                : ["broker.connection_not_connected"],
              updatedAt: "2026-07-18T12:00:00.000Z",
            },
          ],
        },
      });
      return;
    }
    if (method === "POST" && path === "/api/sparklines/seed") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(
        ["limit", "pointLimit", "symbols", "timeframe"].sort(),
      );
      expect(Array.isArray(payload.symbols)).toBe(true);
      backgroundPosts.push(`${method} ${path}`);
      await route.fulfill({
        json: {
          timeframe: payload.timeframe,
          source: "fixture",
          historySource: "fixture",
          requestedSymbolCount: (payload.symbols as unknown[]).length,
          hydratedSymbolCount: 0,
          items: [],
        },
      });
      return;
    }
    if (
      method === "POST" &&
      path === "/api/diagnostics/client-metrics"
    ) {
      expect(request.postDataJSON()).toBeTruthy();
      backgroundPosts.push(`${method} ${path}`);
      await route.fulfill({ status: 202, json: {} });
      return;
    }
    if (method === "GET" && EVENT_STREAM_PATHS.has(path)) {
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream",
        },
        body: "retry: 60000\n\n",
      });
      return;
    }
    if (method === "GET") {
      if (EMPTY_GET_PATHS.has(path)) {
        await route.fulfill({ json: {} });
        return;
      }
      unknownGetPaths.add(path);
      await route.fulfill({
        status: 501,
        json: { error: `Unexpected fixture GET: ${path}` },
      });
      return;
    }
    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }

    blockedMutations.push(`${method} ${path}`);
    await route.fulfill({
      status: 405,
      json: { error: "Mutation blocked by onboarding visual fixture." },
    });
  });

  return {
    verifyConnection: () => {
      connectionVerified = true;
    },
    unknownGetPaths,
    blockedMutations,
    backgroundPosts,
    preferenceWrites,
  };
}

async function expectInsideViewport(
  page: Page,
  locator: ReturnType<Page["locator"]>,
) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

for (const viewport of viewports) {
  test(`Getting Started and Connect Account stay usable on ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await mockOnboardingRuntime(page);

    const runtimeFailures: string[] = [];
    const productMutations: string[] = [];
    page.on("pageerror", (error) => runtimeFailures.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeFailures.push(message.text());
    });
    page.on("request", (request) => {
      const method = request.method();
      const url = request.url();
      if (
        !["GET", "HEAD", "OPTIONS"].includes(method) &&
        !url.includes("/api/settings/preferences") &&
        !url.includes("/api/sparklines/seed") &&
        !url.includes("/api/diagnostics/client-metrics")
      ) {
        productMutations.push(`${method} ${url}`);
      }
    });

    await page.goto(APP_URL, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
      timeout: 60_000,
    });

    const goalPicker = page.getByTestId("onboarding-goal-picker");
    await expect(goalPicker).toBeVisible({ timeout: 30_000 });
    await expect(goalPicker.getByText("Connect an account")).toBeVisible();
    await expect(
      goalPicker
        .locator(
          viewport.width < 768
            ? ".onboarding-goal-phone-status"
            : ".onboarding-goal-status",
        )
        .first(),
    ).toContainText("Review essentials first");
    const reviewEssentials = goalPicker.getByRole("button", {
      name: "Review essentials",
    });
    await expect(reviewEssentials).toBeFocused();
    await expectInsideViewport(page, goalPicker);
    await page.screenshot({
      path: join(SHOT_DIR, `onboarding-goals-${viewport.name}.png`),
    });

    await reviewEssentials.click();
    const essentials = page.getByTestId("onboarding-safety-essentials");
    await expect(essentials).toBeVisible();
    await essentials.getByRole("button", { name: "Continue" }).click();
    await essentials
      .getByRole("button", { name: "I understand the boundary" })
      .click();
    const finish = essentials.getByRole("button", {
      name: "Finish essentials",
    });
    await expect(finish).toBeVisible({ timeout: 30_000 });
    await finish.click();

    await expect(goalPicker).toBeVisible();
    await goalPicker
      .getByRole("button", { name: "Start account setup" })
      .click();

    const guide = page.locator(".onboarding-guide");
    await expect(guide).toBeVisible();
    await guide.getByRole("button", { name: "Open Settings" }).click();
    await expect(page.getByTestId("screen-host-settings")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-onboarding-anchor="settings-data-broker-tab"]'),
    ).toBeVisible();
    await expect(page.locator(".onboarding-target-outline")).toBeVisible({
      timeout: 10_000,
    });
    await expectInsideViewport(page, guide);
    await page.screenshot({
      path: join(SHOT_DIR, `onboarding-connect-guide-${viewport.name}.png`),
    });

    if (viewport.width < 768) {
      await page.getByTestId("mobile-bottom-nav-more").click();
      await expect(
        page.getByTestId("mobile-more-getting-started"),
      ).toBeVisible();
    } else {
      await page.keyboard.press("Control+K");
      await expect(
        page.getByRole("dialog", { name: "Command palette" }),
      ).toBeVisible();
    }
    await expect(guide).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(guide).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(guide).toBeHidden();

    if (viewport.width < 768) {
      await page.getByTestId("mobile-bottom-nav-more").click();
      await page.getByTestId("mobile-more-getting-started").click();
    } else {
      await page.keyboard.press("Control+K");
      await page
        .getByRole("option", { name: /Open Getting Started/ })
        .click();
    }
    await expect(goalPicker).toBeVisible();
    const resumeAccountSetup = goalPicker.getByRole("button", {
      name: "Resume account setup",
    });
    await expect(resumeAccountSetup).toBeFocused();
    await resumeAccountSetup.click();
    await expect(guide).toBeVisible();

    const dataBrokerTab = page.locator(
      '[data-onboarding-anchor="settings-data-broker-tab"]',
    );
    await dataBrokerTab.click();
    await guide
      .getByRole("button", { name: "Continue with Data & Broker" })
      .click();
    await expect(
      page.locator('[data-onboarding-anchor="broker-provider-controls"]'),
    ).toHaveAttribute("data-onboarding-state", "ready", {
      timeout: 30_000,
    });
    await page.screenshot({
      path: join(
        SHOT_DIR,
        `onboarding-connect-provider-${viewport.name}.png`,
      ),
    });
    await guide
      .getByRole("button", { name: "Continue with current selection" })
      .click();
    await expect(
      page.locator('[data-onboarding-anchor="broker-readiness"]'),
    ).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: join(
        SHOT_DIR,
        `onboarding-connect-verification-${viewport.name}.png`,
      ),
    });

    fixture.verifyConnection();
    await guide
      .getByRole("button", { name: "Refresh connection" })
      .click();
    await expect(goalPicker).toBeVisible({ timeout: 30_000 });
    await expect(
      goalPicker
        .locator(
          viewport.width < 768
            ? ".onboarding-goal-phone-status"
            : ".onboarding-goal-status",
        )
        .first(),
    ).toContainText("Complete · 3/3");
    await page.screenshot({
      path: join(
        SHOT_DIR,
        `onboarding-connect-complete-${viewport.name}.png`,
      ),
    });
    await goalPicker
      .getByRole("button", { name: "Replay account setup" })
      .click();
    await expect(guide).toContainText("Step 1 of 3");
    await page.keyboard.press("Escape");
    await expect(guide).toBeHidden();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
    expect(productMutations).toEqual([]);
    expect(fixture.blockedMutations).toEqual([]);
    expect(
      fixture.backgroundPosts.every((entry) =>
        [
          "POST /api/sparklines/seed",
          "POST /api/diagnostics/client-metrics",
        ].includes(entry),
      ),
    ).toBe(true);
    expect(fixture.unknownGetPaths).toEqual(new Set());
    expect(fixture.preferenceWrites.length).toBeGreaterThan(0);
    expect(runtimeFailures).toEqual([]);
  });
}

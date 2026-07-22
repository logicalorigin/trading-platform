import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * UX-37 audit — account-card clipping and data display.
 *
 * Renders the redesigned Account selector cards (worktree AccountTabs
 * composition: group of pressed buttons + detail disclosures) with populated
 * fixture accounts at 390/768/1440 in light and dark, captures each state,
 * and reports hard clips: descendants that overflow their box without an
 * ellipsis or scroll affordance.
 */

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const SHOT_DIR = process.env.PYRUS_QA_SHOT_DIR || "/tmp/ux37-account-cards";
const FIXTURE_NOW = "2026-07-23T15:00:00.000Z";

mkdirSync(SHOT_DIR, { recursive: true });

const brokerAccounts = [
  {
    id: "ibkr:U1234567",
    providerAccountId: "U1234567",
    provider: "ibkr",
    mode: "live",
    displayName: "Growth",
    currency: "USD",
    buyingPower: 100_000,
    cash: 42_000,
    netLiquidation: 248_420.15,
    dayPnl: 1_284.42,
    dayPnlPercent: 0.52,
    includedInTrading: true,
    updatedAt: FIXTURE_NOW,
  },
  {
    id: "ibkr:U7654321",
    providerAccountId: "U7654321",
    provider: "ibkr",
    mode: "live",
    displayName: "Very Long Retirement Account Name",
    currency: "USD",
    buyingPower: 50_000,
    cash: 21_000,
    netLiquidation: 84_112.08,
    dayPnl: -318.09,
    dayPnlPercent: -0.38,
    includedInTrading: true,
    updatedAt: FIXTURE_NOW,
  },
];

const quietStreams = new Set([
  "/api/diagnostics/stream",
  "/api/signal-monitor/matrix/stream",
  "/api/streams/accounts",
  "/api/streams/accounts/shadow",
  "/api/streams/algo/cockpit",
  "/api/streams/executions",
  "/api/streams/options/chains",
  "/api/streams/orders",
  "/api/streams/quotes",
  "/api/streams/stocks/aggregates",
]);

async function installAccountAuditFixture(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__PYRUS_PERF_WARMUP_OVERRIDES__", {
      configurable: true,
      value: {
        disableOperationalCodePreload: true,
        disableHiddenScreenWarmMount: true,
        disableBackgroundDataWarmup: true,
        disableResearchWorkspacePreload: true,
      },
    });
    window.localStorage.setItem(
      "pyrus:state:v1",
      JSON.stringify({
        screen: "account",
        sidebarCollapsed: true,
        activitySidebarCollapsed: true,
        userPreferences: {
          onboarding: {
            schemaVersion: 1,
            autoOpenShownVersion: 1,
            requiredNoticeSeenVersion: 1,
            requiredNoticeResolvedVersion: 1,
            requiredAcknowledgedVersion: 1,
            readinessInspectedVersion: 1,
            activeTrackId: null,
            tracks: {},
          },
        },
      }),
    );
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = decodeURIComponent(new URL(request.url()).pathname);

    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "POST") {
      await route.fulfill({ status: 202, json: {} });
      return;
    }
    if (method !== "GET") {
      await route.fulfill({ status: 405, json: { error: "Audit fixture." } });
      return;
    }
    if (quietStreams.has(path)) {
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
    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "ux37-account-card-audit",
            email: "ux37-account-card-audit@example.com",
            role: "user",
            entitlements: [],
          },
          csrfToken: "ux37-account-card-audit-csrf",
        },
      });
      return;
    }
    if (path === "/api/auth/bootstrap") {
      await route.fulfill({ json: { status: "ready" } });
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
          configured: { massive: true, ibkr: true, research: false },
          ibkrBridge: null,
          runtime: { ibkr: {} },
          timestamp: FIXTURE_NOW,
        },
      });
      return;
    }
    if (path === "/api/settings/preferences") {
      await route.fulfill({
        json: {
          profileKey: "default",
          version: 1,
          preferences: {},
          source: "database",
          updatedAt: FIXTURE_NOW,
        },
      });
      return;
    }
    if (path === "/api/accounts") {
      await route.fulfill({ json: { accounts: brokerAccounts } });
      return;
    }
    if (path === "/api/algo/deployments") {
      await route.fulfill({ json: { deployments: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

type HardClip = {
  testId: string | null;
  tag: string;
  text: string;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
};

const collectHardClips = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="account-tabs"]');
    if (!root) return { missingRoot: true, clips: [] as HardClip[] };
    const clips: HardClip[] = [];
    for (const element of root.querySelectorAll("*")) {
      if (!(element instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(element);
      const horizontalClip =
        element.scrollWidth > element.clientWidth + 1 &&
        style.textOverflow !== "ellipsis" &&
        !["auto", "scroll"].includes(style.overflowX);
      const verticalClip =
        element.scrollHeight > element.clientHeight + 1 &&
        !["auto", "scroll"].includes(style.overflowY) &&
        style.overflowY !== "visible";
      if (horizontalClip || verticalClip) {
        clips.push({
          testId: element.getAttribute("data-testid"),
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || "").trim().slice(0, 60),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        });
      }
    }
    return { missingRoot: false, clips };
  });

const viewports = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  for (const scheme of ["dark", "light"] as const) {
    test(`audit account cards on ${viewport.name} ${scheme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.emulateMedia({
        reducedMotion: "reduce",
        colorScheme: scheme,
      });
      await installAccountAuditFixture(page);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      const target = new URL(APP_URL);
      target.searchParams.set("screen", "account");
      await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("screen-host-account")).toBeVisible({
        timeout: 60_000,
      });
      const selector = page.getByTestId("account-tabs");
      await expect(selector).toBeVisible({ timeout: 60_000 });
      await expect(
        selector.locator('[data-testid^="account-card-"]'),
      ).toHaveCount(4, { timeout: 30_000 });

      const collapsed = await collectHardClips(page);
      await page.screenshot({
        path: join(SHOT_DIR, `${viewport.name}-${scheme}-collapsed.png`),
        fullPage: false,
      });

      // Expand every detail disclosure that exists, then re-audit.
      const disclosures = selector.locator(
        '[data-testid$="-expand"]:visible',
      );
      const disclosureCount = await disclosures.count();
      for (let index = 0; index < disclosureCount; index += 1) {
        await disclosures.nth(index).click();
      }
      await page.waitForTimeout(300);
      const expanded = await collectHardClips(page);
      await page.screenshot({
        path: join(SHOT_DIR, `${viewport.name}-${scheme}-expanded.png`),
        fullPage: false,
      });

      // eslint-disable-next-line no-console
      console.log(
        `UX37 AUDIT ${viewport.name} ${scheme}`,
        JSON.stringify({ collapsed, expanded }, null, 1),
      );
      expect(pageErrors).toEqual([]);
    });
  }
}

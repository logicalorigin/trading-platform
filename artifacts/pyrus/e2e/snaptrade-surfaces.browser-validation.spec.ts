import { expect, test, type Page } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const NAVIGATION_TIMEOUT_MS = 60_000;
const SHOT_DIR =
  process.env.PYRUS_QA_SHOT_DIR || "test-results/snaptrade-surfaces";

const SNAPTRADE_EXECUTION_ACCOUNT_KEY = "pyrus:snaptrade-execution-account:v1";
const WORKSPACE_STATE_KEY = "pyrus:state:v1";

type FailureLog = {
  runtimeFailures: string[];
  httpIssues: string[];
  snapTradeRequests: string[];
};

function watchFailures(page: Page): FailureLog {
  const log: FailureLog = {
    runtimeFailures: [],
    httpIssues: [],
    snapTradeRequests: [],
  };
  page.on("pageerror", (error) => {
    log.runtimeFailures.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource:")) {
      log.httpIssues.push(text);
      return;
    }
    log.runtimeFailures.push(`console: ${text}`);
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/broker-execution/snaptrade")) {
      log.snapTradeRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  return log;
}

async function gotoAppReady(page: Page, url: string): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="platform-screen-stack"]')).toBeVisible({
    timeout: NAVIGATION_TIMEOUT_MS,
  });
  await expect(
    page.locator('[data-testid="pyrus-boot-progress-overlay"]'),
  ).toBeHidden({ timeout: NAVIGATION_TIMEOUT_MS });
}

function seedTicketState(page: Page, extra?: Record<string, unknown>): Promise<void> {
  return page.addInitScript(
    ({ stateKey, merge }) => {
      let current: Record<string, unknown> = {};
      try {
        current = JSON.parse(window.localStorage.getItem(stateKey) || "{}");
      } catch {
        current = {};
      }
      window.localStorage.setItem(
        stateKey,
        JSON.stringify({ ...current, ...merge }),
      );
    },
    {
      stateKey: WORKSPACE_STATE_KEY,
      merge: {
        tradeExecutionMode: "real",
        tradeTicketExpanded: true,
        tradeActiveTicker: "SPY",
        ...extra,
      },
    },
  );
}

test.describe("SnapTrade surfaces (live app QA)", () => {
  test.skip(
    process.env.PYRUS_LIVE_BROWSER_VALIDATION !== "1",
    "Set PYRUS_LIVE_BROWSER_VALIDATION=1 after approving live SnapTrade browser QA.",
  );
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    const response = await fetch(APP_URL, { method: "HEAD" }).catch(() => null);
    test.skip(!response || !response.ok, `app unreachable at ${APP_URL}`);
  });

  test("header broker control renders logged-out state and popover without errors", async ({
    page,
  }) => {
    const log = watchFailures(page);
    await gotoAppReady(page, APP_URL);

    const trigger = page.locator(
      'button[aria-label="Open broker connection details"]',
    );
    await expect(trigger).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });
    await expect(
      trigger.locator('[data-testid="header-snaptrade-broker-status"]'),
    ).toBeVisible();
    await expect(trigger).toContainText(/Broker/i);

    await trigger.click();
    const dialog = page.locator('[role="dialog"][aria-label="Broker connection"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    for (const label of ["SnapTrade", "User", "Upstream", "Execution", "Access"]) {
      await expect(dialog).toContainText(label);
    }
    await expect(dialog).toContainText("trade-if-available");

    const brokerSelect = dialog.locator(
      'select[aria-label="SnapTrade broker target"]',
    );
    await expect(brokerSelect).toBeVisible();
    await expect(brokerSelect).toHaveValue("INTERACTIVE-BROKERS-FLEX");

    const primaryAction = dialog.getByRole("button", {
      name: /Activate|Open Portal/,
    });
    const syncAction = dialog.getByRole("button", { name: /^Sync$/ });
    await expect(primaryAction).toBeDisabled();
    await expect(syncAction).toBeDisabled();

    await page.screenshot({
      path: `${SHOT_DIR}/qa-header-popover-loggedout.png`,
      fullPage: false,
    });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    expect(log.runtimeFailures).toEqual([]);
  });

  test("SHARES real ticket blocks cleanly with no SnapTrade account synced", async ({
    page,
  }) => {
    const log = watchFailures(page);
    await seedTicketState(page);
    await gotoAppReady(page, `${APP_URL}?screen=trade`);

    const zone = page.locator('[data-testid="trade-order-ticket-zone"]');
    await expect(zone).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });

    const expand = zone.locator('button[aria-label="Expand order ticket"]');
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }

    await zone.locator('[data-testid="trade-ticket-asset-mode-equity"]').click();

    await expect(zone).toContainText(
      "Sync an execution-ready SnapTrade account in Settings before submitting shares.",
      { timeout: 15_000 },
    );
    await expect(zone).toContainText("SNAPTRADE SETUP");
    await expect(zone).toContainText("Sync SnapTrade");

    const readinessStrip = zone.locator(
      '[data-testid="trade-ticket-readiness-strip"]',
    );
    await expect(readinessStrip).toContainText("Blocked");

    const recentOrders = zone.locator(
      '[data-testid="snaptrade-recent-orders-status"]',
    );
    await expect(recentOrders).toBeVisible();
    await expect(recentOrders).toContainText("RECENT ORDERS");

    const submit = zone.getByRole("button", {
      name: /SNAPTRADE ACCOUNT REQUIRED/,
    });
    await expect(submit).toBeDisabled();

    await page.screenshot({
      path: `${SHOT_DIR}/qa-ticket-unseeded.png`,
      fullPage: false,
    });

    const preview = zone.getByRole("button", { name: /PREVIEW SNAPTRADE/ });
    await expect(preview).toBeEnabled();
    await preview.click();
    await expect(page.getByText("Auth session required").first()).toBeVisible({
      timeout: 10_000,
    });

    const ticketRequests = log.snapTradeRequests.filter(
      (entry) => !entry.includes("/snaptrade/readiness"),
    );
    expect(ticketRequests).toEqual([]);
    expect(log.runtimeFailures).toEqual([]);
  });

  test("SHARES real ticket degrades gracefully with a seeded unknown account", async ({
    page,
  }) => {
    const log = watchFailures(page);
    await seedTicketState(page);
    await page.addInitScript(
      ({ accountKey }) => {
        window.localStorage.setItem(
          accountKey,
          JSON.stringify({
            accounts: [
              {
                id: "qa-acct-1",
                connectionId: "conn-1",
                snapTradeAccountId: "upstream-1",
                displayName: "QA SnapTrade",
                brokerageName: "Interactive Brokers",
                baseCurrency: "USD",
                executionReady: true,
                executionBlockers: [],
                lastSyncedAt: "2026-07-01T00:00:00.000Z",
              },
            ],
            selectedAccount: { id: "qa-acct-1" },
            savedAt: "2026-07-01T00:00:00.000Z",
          }),
        );
      },
      { accountKey: SNAPTRADE_EXECUTION_ACCOUNT_KEY },
    );
    await gotoAppReady(page, `${APP_URL}?screen=trade`);

    const zone = page.locator('[data-testid="trade-order-ticket-zone"]');
    await expect(zone).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });

    const expand = zone.locator('button[aria-label="Expand order ticket"]');
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    }

    await zone.locator('[data-testid="trade-ticket-asset-mode-equity"]').click();

    await expect(zone).toContainText("SNAPTRADE LIVE", { timeout: 15_000 });
    await expect(zone).toContainText("QA SnapTrade");

    const recentOrders = zone.locator(
      '[data-testid="snaptrade-recent-orders-status"]',
    );
    await expect(recentOrders).toBeVisible();

    await expect
      .poll(() => log.snapTradeRequests.length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const requestedPaths = log.snapTradeRequests.join("\n");
    expect(requestedPaths).toContain("/accounts/qa-acct-1/orders/recent");

    await page.screenshot({
      path: `${SHOT_DIR}/qa-ticket-seeded.png`,
      fullPage: false,
    });

    expect(log.runtimeFailures).toEqual([]);
  });

  test("header account control offers sign-in and first-time setup", async ({
    page,
  }) => {
    const log = watchFailures(page);
    await gotoAppReady(page, `${APP_URL}?pyrusQa=safe`);

    const trigger = page.locator(
      'button[aria-label="Open account session details"]',
    );
    await expect(trigger).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });
    await expect(trigger).toContainText(/Sign in/i);

    await trigger.click();
    const dialog = page.locator('[role="dialog"][aria-label="Account session"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await expect(
      dialog.locator('[data-testid="header-session-email"]'),
    ).toBeVisible();
    await expect(
      dialog.locator('[data-testid="header-session-password"]'),
    ).toBeVisible();

    await dialog.getByRole("button", { name: /First-time setup/ }).click();
    await expect(
      dialog.locator('[data-testid="header-session-display-name"]'),
    ).toBeVisible();
    await expect(
      dialog.locator('[data-testid="header-session-bootstrap-token"]'),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Create admin account/ }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: /Back to sign in/ }).click();

    await dialog
      .locator('[data-testid="header-session-email"]')
      .fill("not-an-email");
    await dialog.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(dialog.locator('[role="alert"]')).toContainText(
      "Enter a valid email address.",
    );

    await dialog
      .locator('[data-testid="header-session-email"]')
      .fill("qa-wrong@pyrus.local");
    await dialog
      .locator('[data-testid="header-session-password"]')
      .fill("definitely-wrong-password");
    await dialog.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(dialog.locator('[role="alert"]')).toBeVisible({
      timeout: 10_000,
    });

    await page.screenshot({
      path: `${SHOT_DIR}/qa-session-popover.png`,
      fullPage: false,
    });

    expect(log.runtimeFailures).toEqual([]);
  });

  test("settings Data & Broker tab hides SnapTrade panel for non-admin session", async ({
    page,
  }) => {
    const log = watchFailures(page);
    await gotoAppReady(page, `${APP_URL}?screen=settings`);

    const tab = page.locator('[data-testid="settings-tab-data-broker"]');
    await expect(tab).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-pressed", "true");

    await expect(page.getByText("Runtime Settings").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("SnapTrade Brokerage")).toHaveCount(0);

    await page.screenshot({
      path: `${SHOT_DIR}/qa-settings-nonadmin.png`,
      fullPage: false,
    });

    expect(log.runtimeFailures).toEqual([]);
  });

  test("settings Data & Broker tab renders the dynamic trade-capable broker chooser for admin session", async ({
    page,
  }) => {
    const log = watchFailures(page);
    const logoPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: {
          user: { id: "qa-admin", email: "qa-admin@example.com", role: "admin" },
          csrfToken: "qa-csrf-token",
        },
      }),
    );
    await page.route("**/api/broker-execution/snaptrade/readiness", (route) =>
      route.fulfill({
        json: {
          provider: "snaptrade",
          configured: true,
          status: "research_required",
          checkedAt: new Date().toISOString(),
          executionDecision: { decision: "PROVIDER_RESEARCH_REQUIRED" },
          credentials: { clientIdPresent: true, apiKeyPresent: true },
          clientInfo: { reachable: true, redirectUriConfigured: true },
          brokerages: { total: 3, enabled: 3, allowsTrading: 2, degradedOrMaintenance: 0 },
          limitations: [],
          upstream: null,
          user: { snapTradeUserIdPresent: true, credentialPresent: true },
        },
      }),
    );
    await page.route("**/api/broker-execution/snaptrade/brokerages", (route) =>
      route.fulfill({
        json: {
          provider: "snaptrade",
          checkedAt: new Date().toISOString(),
          brokerages: [
            {
              slug: "ETRADE",
              displayName: "E*Trade",
              description: null,
              url: "https://www.us.etrade.com/",
              allowsTrading: true,
              enabled: true,
              maintenanceMode: false,
              isDegraded: false,
              allowsFractionalUnits: false,
              logoUrl: logoPng,
              squareLogoUrl: logoPng,
              authorizationTypes: [{ type: "trade", authType: "OAUTH" }],
            },
            {
              slug: "ALPACA-PAPER",
              displayName: "Alpaca Paper",
              description: null,
              url: null,
              allowsTrading: true,
              enabled: true,
              maintenanceMode: false,
              isDegraded: false,
              allowsFractionalUnits: true,
              logoUrl: null,
              squareLogoUrl: null,
              authorizationTypes: [{ type: "trade", authType: "TOKEN" }],
            },
            {
              slug: "INTERACTIVE-BROKERS-FLEX",
              displayName: "Interactive Brokers",
              description: null,
              url: null,
              allowsTrading: false,
              enabled: true,
              maintenanceMode: false,
              isDegraded: false,
              allowsFractionalUnits: false,
              logoUrl: null,
              squareLogoUrl: null,
              authorizationTypes: [{ type: "read", authType: "TOKEN" }],
            },
          ],
        },
      }),
    );

    await gotoAppReady(page, `${APP_URL}?screen=settings`);

    const tab = page.locator('[data-testid="settings-tab-data-broker"]');
    await expect(tab).toBeVisible({ timeout: NAVIGATION_TIMEOUT_MS });
    await tab.click();

    await expect(page.getByText("SnapTrade Brokerage")).toBeVisible({
      timeout: 15_000,
    });

    const etradeButton = page.getByRole("button", { name: /E\*Trade/ });
    const alpacaButton = page.getByRole("button", { name: /Alpaca Paper/ });
    await expect(page.getByRole("button", { name: /Broker picker/ })).toHaveCount(
      0,
    );
    await expect(etradeButton).toBeVisible();
    await expect(alpacaButton).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Interactive Brokers/ }),
    ).toHaveCount(0);

    await expect(etradeButton).toHaveAttribute("aria-pressed", "true");
    await expect(etradeButton.locator("img")).toBeVisible();
    await expect(etradeButton).toContainText("Live trading");

    await alpacaButton.click();
    await expect(alpacaButton).toHaveAttribute("aria-pressed", "true");
    await expect(etradeButton).toHaveAttribute("aria-pressed", "false");

    await page.screenshot({
      path: `${SHOT_DIR}/qa-settings-admin-broker-chooser.png`,
      fullPage: false,
    });

    expect(log.runtimeFailures).toEqual([]);
  });
});

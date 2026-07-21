import { expect, test, type Page, type Route } from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const FIXTURE_NOW = "2026-07-21T18:00:00.000Z";

const disconnectedReadiness = {
  status: "disconnected",
  gatewayRunning: false,
  authenticated: false,
  browserLoginComplete: false,
  apiSessionActivationFailed: false,
  established: null,
  isPaper: null,
  selectedAccountId: null,
  accounts: [],
  executionTargets: [],
  loginPath: null,
  message: "Not connected. Start a connection to log in to IBKR.",
};

const loginPendingReadiness = {
  ...disconnectedReadiness,
  status: "needs_login",
  gatewayRunning: true,
  message: "Gateway is running. Log in to IBKR to finish connecting.",
};

const browserAcknowledgedReadiness = {
  ...loginPendingReadiness,
  browserLoginComplete: true,
  message:
    "IBKR sign-in response received. PYRUS is opening the API session and loading accounts; this connection is not active yet.",
};

const activationFailedReadiness = {
  ...browserAcknowledgedReadiness,
  apiSessionActivationFailed: true,
  message:
    "IBKR sign-in response received, but the API session is still unavailable. PYRUS is checking the session; this connection is not active.",
};

const connectedReadiness = {
  ...browserAcknowledgedReadiness,
  status: "connected",
  authenticated: true,
  apiSessionActivationFailed: false,
  established: true,
  isPaper: false,
  selectedAccountId: "U1234567",
  accounts: ["U1234567"],
  executionTargets: [
    {
      accountId: "U1234567",
      maskedAccountId: "••••4567",
      selected: true,
    },
  ],
  message: "Connected to IBKR.",
};

async function fulfillQuietEventStream(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: "retry: 60000\n\n",
  });
}

async function installIbkrConnectionFixture(page: Page) {
  let currentReadiness:
    | typeof disconnectedReadiness
    | typeof connectedReadiness = disconnectedReadiness;
  let statusCalls = 0;
  let connectCalls = 0;
  const mutations: string[] = [];
  const orderRequests: string[] = [];

  await page.route("**/ibkr-viewer.html**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>IBKR secure login fixture</title><main>IBKR login and two-factor authentication</main>",
    });
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (/\/orders?(?:\/|$)/u.test(path)) {
      orderRequests.push(`${method} ${path}`);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      mutations.push(`${method} ${path}`);
    }

    if (method === "GET" && path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "ibkr-connection-browser-review",
            email: "ibkr-connection-review@example.com",
            role: "admin",
            entitlements: ["broker_connect", "ibkr_access"],
          },
          csrfToken: "ibkr-connection-browser-csrf",
        },
      });
      return;
    }
    if (method === "GET" && path === "/api/session") {
      await route.fulfill({
        json: {
          environment: "shadow",
          brokerProvider: "ibkr",
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
    if (method === "GET" && path === "/api/settings/preferences") {
      await route.fulfill({
        json: {
          profileKey: "default",
          version: 1,
          preferences: { onboarding: { autoOpenShownVersion: 1 } },
          source: "database",
          updatedAt: FIXTURE_NOW,
        },
      });
      return;
    }
    if (
      method === "GET" &&
      path === "/api/broker-execution/ibkr-portal/readiness"
    ) {
      await route.fulfill({ json: currentReadiness });
      return;
    }
    if (
      method === "POST" &&
      path === "/api/broker-execution/ibkr-portal/connect"
    ) {
      expect(request.headers()["x-csrf-token"]).toBe(
        "ibkr-connection-browser-csrf",
      );
      connectCalls += 1;
      currentReadiness = {
        ...loginPendingReadiness,
        status: "gateway_starting",
        message: "Starting the IBKR gateway…",
      };
      await route.fulfill({
        json: {
          status: "gateway_starting",
          loginPath: "/ibkr-viewer.html?session=browser-review",
        },
      });
      return;
    }
    if (
      method === "GET" &&
      path === "/api/broker-execution/ibkr-portal/status"
    ) {
      statusCalls += 1;
      if (statusCalls === 3) {
        await route.fulfill({
          status: 503,
          json: { message: "temporary status transport interruption" },
        });
        return;
      }
      currentReadiness =
        statusCalls === 1
          ? loginPendingReadiness
          : statusCalls === 2
            ? browserAcknowledgedReadiness
            : statusCalls === 4
              ? activationFailedReadiness
              : connectedReadiness;
      await route.fulfill({ json: currentReadiness });
      return;
    }
    if (
      method === "POST" &&
      path === "/api/broker-execution/ibkr-portal/disconnect"
    ) {
      await route.fulfill({ json: { disconnected: true } });
      return;
    }
    if (method === "GET" && path === "/api/watchlists") {
      await route.fulfill({ json: { watchlists: [] } });
      return;
    }
    if (method === "GET" && path === "/api/accounts") {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }
    if (method === "GET" && path === "/api/broker-connections") {
      await route.fulfill({ json: { connections: [] } });
      return;
    }
    if (
      method === "GET" &&
      path === "/api/broker-execution/included-accounts"
    ) {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }
    if (
      method === "GET" &&
      path === "/api/broker-execution/snaptrade/brokerages"
    ) {
      await route.fulfill({ json: { brokerages: [] } });
      return;
    }
    if (
      method === "GET" &&
      (path === "/api/diagnostics/stream" ||
        path === "/api/signal-monitor/matrix/stream" ||
        path.startsWith("/api/streams/"))
    ) {
      await fulfillQuietEventStream(route);
      return;
    }
    if (method === "POST" && path === "/api/sparklines/seed") {
      const payload = request.postDataJSON() as {
        symbols?: unknown[];
        timeframe?: string;
      };
      await route.fulfill({
        json: {
          timeframe: payload.timeframe,
          source: "fixture",
          historySource: "fixture",
          requestedSymbolCount: payload.symbols?.length || 0,
          hydratedSymbolCount: 0,
          items: [],
        },
      });
      return;
    }
    if (method === "POST" && path === "/api/diagnostics/client-metrics") {
      await route.fulfill({ status: 202, json: {} });
      return;
    }
    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "GET") {
      await route.fulfill({ json: {} });
      return;
    }
    await route.fulfill({
      status: 405,
      json: { error: `Unexpected fixture mutation: ${method} ${path}` },
    });
  });

  return {
    connectCalls: () => connectCalls,
    mutations,
    orderRequests,
    statusCalls: () => statusCalls,
  };
}

test("IBKR connection UI survives 2FA finalization and reaches a verified real account", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await installIbkrConnectionFixture(page);
  const browserProblems: string[] = [];
  page.on("pageerror", (error) => {
    browserProblems.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserProblems.push(`console: ${message.text()}`);
    }
  });

  await page.goto(`${APP_URL}?screen=settings`, {
    waitUntil: "domcontentloaded",
  });
  expect(new URL(page.url()).searchParams.has("pyrusQa")).toBe(false);
  await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
    timeout: 60_000,
  });

  const dataBrokerTab = page.getByTestId("settings-tab-data-broker");
  await dataBrokerTab.click();
  await expect(dataBrokerTab).toHaveAttribute("aria-pressed", "true");

  const ibkrCard = page.locator('[data-broker-card="IBKR_PORTAL"]');
  await expect(ibkrCard).toBeVisible({ timeout: 30_000 });
  await ibkrCard.getByRole("button", { name: "Select Interactive Brokers" }).click();
  await ibkrCard.getByRole("button", { name: "Connect", exact: true }).click();

  const dialog = page.locator("dialog.ibkr-portal-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Starting IBKR Client Portal");
  const iframe = dialog.getByTitle("Interactive Brokers Client Portal login");
  await expect(iframe).toBeVisible();
  await iframe.evaluate((node) => {
    (window as typeof window & { __ibkrFixtureIframe?: Element }).__ibkrFixtureIframe =
      node;
  });

  await dialog
    .getByRole("button", { name: "Hide IBKR Client Portal window" })
    .click();
  await expect(dialog).toBeHidden();
  await ibkrCard
    .getByRole("button", { name: "Continue Login", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(iframe).toBeVisible();
  expect(
    await iframe.evaluate(
      (node) =>
        node ===
        (window as typeof window & { __ibkrFixtureIframe?: Element })
          .__ibkrFixtureIframe,
    ),
  ).toBe(true);

  await expect(dialog).toContainText("Complete your IBKR login", {
    timeout: 6_000,
  });
  await expect(dialog).toContainText("IBKR sign-in received", {
    timeout: 6_000,
  });
  await dialog.screenshot({
    path: testInfo.outputPath("ibkr-post-2fa-verifying.png"),
  });
  await expect(dialog).toContainText("Connection status unavailable — retrying.", {
    timeout: 6_000,
  });
  await expect(
    dialog.getByLabel("IBKR account verification recovery"),
  ).toBeVisible({ timeout: 6_000 });
  await expect(dialog).toContainText("IBKR did not activate the API session");
  await expect(dialog).toContainText("Connected to IBKR", {
    timeout: 6_000,
  });
  await expect(dialog).toContainText("U1234567 · 1 trading account available");
  await dialog.screenshot({
    path: testInfo.outputPath("ibkr-connected-real-account.png"),
  });

  await expect(ibkrCard.getByLabel("Connected")).toBeVisible();
  await expect(page.getByText("Connected to account U1234567")).toBeVisible();
  expect(fixture.connectCalls()).toBe(1);
  expect(fixture.statusCalls()).toBe(5);
  expect(
    fixture.orderRequests.filter((entry) => !entry.startsWith("GET ")),
  ).toEqual([]);
  expect(
    fixture.mutations.filter(
      (entry) =>
        !entry.startsWith("POST /api/broker-execution/ibkr-portal/connect") &&
        !entry.startsWith("POST /api/sparklines/seed") &&
        !entry.startsWith("POST /api/diagnostics/client-metrics"),
    ),
  ).toEqual([]);
  expect(
    browserProblems.filter(
      (problem) =>
        !problem.includes(
          "Failed to load resource: the server responded with a status of 503",
        ),
    ),
  ).toEqual([]);
});

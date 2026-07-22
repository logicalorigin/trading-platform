import {
  expect,
  test,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 30_000;

const PRESENTATIONS = [
  { id: "phone-dark", width: 390, height: 844, theme: "dark" },
  { id: "phone-light", width: 390, height: 844, theme: "light" },
  { id: "tablet-dark", width: 768, height: 1024, theme: "dark" },
  { id: "tablet-light", width: 768, height: 1024, theme: "light" },
  { id: "desktop-dark", width: 1440, height: 900, theme: "dark" },
  { id: "desktop-light", width: 1440, height: 900, theme: "light" },
] as const;

type Theme = (typeof PRESENTATIONS)[number]["theme"];
type AuthFixtureOptions = {
  session?: (route: Route, requestNumber: number) => Promise<void> | void;
  login?: (route: Route) => Promise<void> | void;
  bootstrap?: (route: Route) => Promise<void> | void;
};

type AuthFixtureLog = {
  allowedBackgroundRequests: string[];
  blockedMutations: string[];
  sessionRequests: number;
  unexpectedReads: string[];
};

const signedOutSession = { user: null, csrfToken: null };
const successfulSession = {
  user: {
    id: "auth-state-review",
    email: "auth-state-review@pyrus.invalid",
    displayName: "Auth State Review",
    role: "user",
    entitlements: [],
  },
  csrfToken: "auth-state-review-csrf",
};

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function prepareAuthPage(page: Page, theme: Theme) {
  await page.emulateMedia({
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem(
      "pyrus:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: selectedTheme,
        userPreferences: {
          appearance: {
            theme: selectedTheme,
            reducedMotion: "on",
          },
        },
      }),
    );
  }, theme);
}

async function installAuthFixture(
  page: Page,
  options: AuthFixtureOptions = {},
): Promise<AuthFixtureLog> {
  const log: AuthFixtureLog = {
    allowedBackgroundRequests: [],
    blockedMutations: [],
    sessionRequests: 0,
    unexpectedReads: [],
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    const requestLabel = `${method} ${path}`;

    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === "GET" && path === "/api/auth/session") {
      log.sessionRequests += 1;
      if (options.session) {
        await options.session(route, log.sessionRequests);
      } else {
        await route.fulfill({ json: signedOutSession });
      }
      return;
    }
    if (method === "POST" && path === "/api/auth/login" && options.login) {
      await options.login(route);
      return;
    }
    if (
      method === "POST" &&
      path === "/api/auth/bootstrap" &&
      options.bootstrap
    ) {
      await options.bootstrap(route);
      return;
    }
    if (
      method === "POST" &&
      [
        "/api/diagnostics/client-events",
        "/api/diagnostics/client-metrics",
        "/api/sparklines/seed",
      ].includes(path)
    ) {
      log.allowedBackgroundRequests.push(requestLabel);
      await route.fulfill({ status: 204 });
      return;
    }
    if (method !== "GET") {
      log.blockedMutations.push(requestLabel);
      await route.fulfill({
        status: 405,
        json: { error: "mutation_blocked_by_auth_fixture" },
      });
      return;
    }

    log.unexpectedReads.push(requestLabel);
    await route.fulfill({
      status: 503,
      json: { error: "read_not_needed_by_auth_fixture" },
    });
  });

  return log;
}

async function openSignedOutGate(page: Page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("login-brand-stage")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
}

async function expectTabOrder(page: Page, selectors: string[]) {
  const first = page.locator(selectors[0]);
  await first.focus();
  await expect(first).toBeFocused();
  for (const selector of selectors.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(page.locator(selector)).toBeFocused();
  }
}

async function expectAuthGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const content = document.querySelector(".pyrus-auth-content");
    const contentRect = content?.getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll(".pyrus-auth-content input"),
      ...document.querySelectorAll(".pyrus-auth-content button"),
    ];
    return {
      content:
        contentRect == null
          ? null
          : {
              left: contentRect.left,
              right: contentRect.right,
              width: contentRect.width,
            },
      controlHeights: controls.map(
        (control) => control.getBoundingClientRect().height,
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth - window.innerWidth,
      titleFont: Number.parseFloat(
        getComputedStyle(document.querySelector("h1") as Element).fontSize,
      ),
    };
  });

  expect(geometry.content).not.toBeNull();
  expect(geometry.content?.left).toBeGreaterThanOrEqual(0);
  expect(geometry.content?.right).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  expect(geometry.content?.width).toBeLessThanOrEqual(380.5);
  expect(geometry.controlHeights.every((height) => height >= 44)).toBe(true);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.titleFont).toBeGreaterThanOrEqual(20);
}

async function attachAuthContent(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  await testInfo.attach(name, {
    body: await page.locator(".pyrus-auth-content").screenshot({
      animations: "disabled",
    }),
    contentType: "image/png",
  });
}

test.describe("Login gate state matrix", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  for (const presentation of PRESENTATIONS) {
    test(`${presentation.id} keeps sign-in and first-run readable and keyboard ordered`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({
        width: presentation.width,
        height: presentation.height,
      });
      await prepareAuthPage(page, presentation.theme);
      const fixture = await installAuthFixture(page);
      await openSignedOutGate(page);

      await expect(page.locator("html")).toHaveAttribute(
        "data-pyrus-theme",
        presentation.theme,
      );
      await expect(
        page.getByText("Use your operator account to continue."),
      ).toBeVisible();
      await expect(page.getByLabel("Sign in")).toBeVisible();
      await expectAuthGeometry(page);
      await expectTabOrder(page, [
        "#email",
        "#password",
        '[data-testid="login-gate-submit"]',
        '[data-testid="login-gate-mode-switch"]',
      ]);
      await attachAuthContent(page, testInfo, `${presentation.id}-sign-in`);

      await page.getByTestId("login-gate-mode-switch").click();
      await expect(
        page.getByRole("heading", { name: "First-time setup" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Create the first operator account for this installation.",
        ),
      ).toBeVisible();
      await expect(page.getByLabel("First-time setup")).toBeVisible();
      await expect(page.locator("#bootstrapToken")).toHaveAttribute(
        "type",
        "password",
      );
      await expect(page.locator("#password")).toHaveAttribute(
        "aria-describedby",
        "login-gate-password-help",
      );
      await expect(page.locator("#bootstrapToken")).toHaveAttribute(
        "autocomplete",
        "off",
      );
      await expect(page.locator("#bootstrapToken")).toHaveAttribute(
        "aria-describedby",
        "login-gate-bootstrap-token-help",
      );
      await expect(
        page.getByText("From the PYRUS_AUTH_BOOTSTRAP_TOKEN secret."),
      ).toBeVisible();
      await expectAuthGeometry(page);
      await expectTabOrder(page, [
        "#email",
        "#displayName",
        "#password",
        "#bootstrapToken",
        '[data-testid="login-gate-submit"]',
        '[data-testid="login-gate-mode-switch"]',
      ]);
      await attachAuthContent(page, testInfo, `${presentation.id}-first-run`);

      expect(fixture.sessionRequests).toBe(1);
      expect(fixture.unexpectedReads).toEqual([]);
      expect(fixture.blockedMutations).toEqual([]);
    });
  }

  test("session lookup failure withholds credentials until retry succeeds", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepareAuthPage(page, "dark");
    const fixture = await installAuthFixture(page, {
      session: async (route, requestNumber) => {
        if (requestNumber === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            json: {
              title: "Authentication unavailable",
              status: 503,
            },
          });
          return;
        }
        await route.fulfill({ json: signedOutSession });
      },
    });

    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Sign-in status unavailable" }),
    ).toBeVisible({ timeout: READY_TIMEOUT_MS });
    await expect(page.locator("#email, #password")).toHaveCount(0);

    const retry = page.getByTestId("login-gate-session-retry");
    await expect(retry).toBeVisible();
    await expect(retry).toHaveAttribute("type", "button");
    expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await retry.click();

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    expect(fixture.sessionRequests).toBe(2);
    expect(fixture.unexpectedReads).toEqual([]);
    expect(fixture.blockedMutations).toEqual([]);
  });

  test("sign-in exposes pending and server-error states without a dead button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await prepareAuthPage(page, "light");
    const loginGate = deferred();
    let loginRequests = 0;
    const fixture = await installAuthFixture(page, {
      login: async (route) => {
        loginRequests += 1;
        await loginGate.promise;
        await route.fulfill({
          status: 401,
          contentType: "application/problem+json",
          json: {
            title: "Invalid credentials",
            status: 401,
            detail: "Email or password is incorrect.",
            code: "invalid_credentials",
          },
        });
      },
    });
    await openSignedOutGate(page);

    await page.locator("#email").fill("signin-review@pyrus.invalid");
    await page.locator("#password").fill("wrong-password");
    await page.getByTestId("login-gate-submit").click();

    const submit = page.getByTestId("login-gate-submit");
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(submit).toContainText("Signing in…");
    expect(loginRequests).toBe(1);

    loginGate.resolve();
    await expect(page.getByRole("alert")).toContainText(
      "Email or password is incorrect.",
    );
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveAttribute("aria-busy", "false");
    await expect(submit).toHaveText("Sign in");
    expect(fixture.unexpectedReads).toEqual([]);
    expect(fixture.blockedMutations).toEqual([]);
  });

  test("first-run validates the secret locally, then adopts a successful session", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareAuthPage(page, "dark");
    const bootstrapGate = deferred();
    let bootstrapRequests = 0;
    const fixture = await installAuthFixture(page, {
      bootstrap: async (route) => {
        bootstrapRequests += 1;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual([
          "bootstrapToken",
          "displayName",
          "email",
          "password",
        ]);
        await bootstrapGate.promise;
        await route.fulfill({ json: successfulSession });
      },
    });
    await openSignedOutGate(page);
    await page.getByTestId("login-gate-mode-switch").click();

    await page.locator("#email").fill("first-run-review@pyrus.invalid");
    await page.locator("#displayName").fill("First Run Review");
    await page.locator("#password").fill("twelve-or-more-characters");
    await page.getByTestId("login-gate-submit").click();
    await expect(page.getByRole("alert")).toHaveText(
      "Enter the setup token from Secrets.",
    );
    expect(bootstrapRequests).toBe(0);

    await page.locator("#bootstrapToken").fill("fixture-secret-token");
    await page.getByTestId("login-gate-submit").click();
    const submit = page.getByTestId("login-gate-submit");
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(submit).toContainText("Creating account…");
    expect(bootstrapRequests).toBe(1);

    bootstrapGate.resolve();
    await expect(submit).toHaveCount(0, { timeout: READY_TIMEOUT_MS });
    await expect(page.getByTestId("login-brand-stage")).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(fixture.blockedMutations).toEqual([]);
  });
});

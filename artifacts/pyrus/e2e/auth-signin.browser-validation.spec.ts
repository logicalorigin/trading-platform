import { expect, test, type Page } from "@playwright/test";

// Run:
//   pnpm --filter @workspace/pyrus exec playwright test e2e/auth-signin.browser-validation.spec.ts --reporter=list
// The session and login responses are intercepted in-browser, so the test never
// submits credentials to the configured app.
//
// Regression under test: "the sign-in button sometimes does nothing."
// src/features/auth/LoginGate.jsx renders a full-page wall (ABOVE
// <PlatformApp/>, so the workspace never mounts) for a signed-out visitor.
// Its submit handler posts to /api/auth/login (authSession.jsx's
// postAuthJson), sets `pending` while in flight, and clears it on success
// (via refresh()) or failure (setError). The two concrete bug shapes this
// spec catches:
//   1. Dead button: click produces NEITHER a network call NOR any visible
//      state change.
//   2. Stuck pending: the request fires but the button/UI never resolves
//      (pending never clears, no error, no reveal).
//
const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const ACTION_TIMEOUT_MS = 20_000;

type NetLog = {
  runtimeFailures: string[];
  authRequests: string[];
  authResponses: string[];
};

function watchAuthTraffic(page: Page): NetLog {
  const log: NetLog = { runtimeFailures: [], authRequests: [], authResponses: [] };
  page.on("pageerror", (error) => {
    log.runtimeFailures.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource:")) return; // expected: 401 on wrong creds
    log.runtimeFailures.push(`console: ${text}`);
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/auth/")) {
      log.authRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/auth/")) {
      log.authResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  return log;
}

test.describe("Sign-in gate (auth-signin regression)", () => {
  test.setTimeout(120_000);

  test("Sign in always produces an observable outcome -- never a dead button", async ({
    page,
  }) => {
    const log = watchAuthTraffic(page);
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        status: 200,
        json: { user: null, csrfToken: null },
      }),
    );
    await page.route("**/api/auth/login", (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        return route.abort();
      }
      return route.fulfill({
        status: 401,
        contentType: "application/problem+json",
        json: {
          title: "Invalid credentials",
          status: 401,
          detail: "Email or password is incorrect.",
          code: "invalid_credentials",
        },
      });
    });

    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-testid="login-gate-submit"]'),
    ).toBeVisible({ timeout: ACTION_TIMEOUT_MS });

    // Assumption: LoginGate's inputs carry raw HTML ids (id="email" /
    // id="password") rather than data-testid -- only the submit button has
    // one (dataTestId="login-gate-submit" on the shared <Button>). Safe
    // because LoginGate is the only form mounted while the gate is up.
    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    const submit = page.locator('[data-testid="login-gate-submit"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submit).toBeEnabled();

    // Valid-format fake credentials exercise the submit path against the
    // intercepted response above.
    await emailInput.fill("qa-e2e-signin@pyrus.local");
    await passwordInput.fill("qa-e2e-wrong-password");

    await submit.click();

    // Failure mode 1: dead button -- no network call at all.
    await expect
      .poll(
        () =>
          log.authRequests.some(
            (request) =>
              request.startsWith("POST ") &&
              request.includes("/api/auth/login"),
          ),
        {
          timeout: ACTION_TIMEOUT_MS,
          message: () =>
            `expected a POST to /api/auth/login after clicking Sign in; saw requests: ${JSON.stringify(log.authRequests)}`,
        },
      )
      .toBe(true);

    console.log("auth requests observed:", JSON.stringify(log.authRequests, null, 2));
    console.log("auth responses observed:", JSON.stringify(log.authResponses, null, 2));

    // Failure mode 2: stuck pending -- request fires but nothing ever
    // resolves visibly. With wrong credentials the expected resolution is
    // the inline role="alert" error; if the credentials happened to be
    // valid, the gate would instead reveal the app.
    await expect(async () => {
      const alertVisible = await page
        .locator('[role="alert"]')
        .first()
        .isVisible()
        .catch(() => false);
      const pastGate = await page
        .locator('[data-testid="platform-screen-stack"]')
        .isVisible()
        .catch(() => false);
      expect(alertVisible || pastGate).toBe(true);
    }).toPass({ timeout: ACTION_TIMEOUT_MS });

    // The button must not be left permanently disabled (pending stuck true).
    const stillOnGate = await submit.isVisible().catch(() => false);
    if (stillOnGate) {
      await expect(submit).toBeEnabled({ timeout: 10_000 });
    }

    console.log("runtime failures:", JSON.stringify(log.runtimeFailures, null, 2));
    expect(log.runtimeFailures).toEqual([]);
  });
});

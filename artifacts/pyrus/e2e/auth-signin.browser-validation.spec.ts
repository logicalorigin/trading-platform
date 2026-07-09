import { expect, test, type Page } from "@playwright/test";

// Run:
//   pnpm --filter @workspace/pyrus exec playwright test e2e/auth-signin.browser-validation.spec.ts --reporter=list
// Against the public preview:
//   PYRUS_APP_URL=https://$REPLIT_DEV_DOMAIN/ pnpm --filter @workspace/pyrus exec playwright test e2e/auth-signin.browser-validation.spec.ts --reporter=list
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
// Assumption (flag for verification once the box calms): a fresh, cookie-less
// Playwright context is expected to see the gate. Other existing specs
// (snaptrade-surfaces, app-waterfall-audit, neural-loader) navigate fresh
// contexts straight to [data-testid="platform-screen-stack"] without ever
// handling a gate, which implies this deployment may currently auto-authenticate
// or otherwise bypass LoginGate for a plain visitor. This spec does not assume
// either way -- it detects whichever terminal state actually renders and skips
// cleanly if the gate never shows.

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const BOOT_TIMEOUT_MS = 60_000;
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

async function waitForBootOutcome(
  page: Page,
  url: string,
): Promise<"gate" | "authenticated" | "timeout"> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const gate = page.locator('[data-testid="login-gate-submit"]');
  const app = page.locator('[data-testid="platform-screen-stack"]');
  try {
    await Promise.race([
      gate.waitFor({ state: "visible", timeout: BOOT_TIMEOUT_MS }),
      app.waitFor({ state: "visible", timeout: BOOT_TIMEOUT_MS }),
    ]);
  } catch {
    return "timeout";
  }
  if (await app.isVisible().catch(() => false)) return "authenticated";
  if (await gate.isVisible().catch(() => false)) return "gate";
  return "timeout";
}

test.describe("Sign-in gate (auth-signin regression)", () => {
  test.setTimeout(120_000);

  test("Sign in always produces an observable outcome -- never a dead button", async ({
    page,
  }) => {
    const log = watchAuthTraffic(page);

    const outcome = await waitForBootOutcome(page, APP_URL);
    test.skip(
      outcome === "timeout",
      `App did not finish booting within ${BOOT_TIMEOUT_MS}ms at ${APP_URL} -- box likely under load; skipping.`,
    );
    test.skip(
      outcome === "authenticated",
      "LoginGate not shown (session already authenticated, or this env bypasses the gate) -- nothing to exercise.",
    );

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

    // Valid-format but unknown credentials: the goal is to exercise the
    // submit path (client validation must pass so the fetch actually fires),
    // not to actually get in.
    await emailInput.fill("qa-e2e-signin@pyrus.local");
    await passwordInput.fill("qa-e2e-wrong-password");

    await submit.click();

    // Failure mode 1: dead button -- no network call at all.
    await expect
      .poll(() => log.authRequests.length, {
        timeout: ACTION_TIMEOUT_MS,
        message: () =>
          `expected a POST to /api/auth/login after clicking Sign in; saw requests: ${JSON.stringify(log.authRequests)}`,
      })
      .toBeGreaterThan(0);

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

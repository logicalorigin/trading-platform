import { expect, test, type Page } from "@playwright/test";

// Validates the neural loading screen across its three paths:
//   1. default       — opener plays when WebGL is available, app reveals
//   2. reduced-motion — opener gates off, app reveals via the crisp fallback
//   3. no-WebGL       — opener gates off, app still reveals
//
// The default test adapts to the runtime: in a WebGL-less headless Chromium it
// only asserts the reveal; in a WebGL-capable browser it also asserts the
// opener's <canvas> mounts. Every case asserts a `complete`-driven reveal
// (the real workspace appears), never a fixed timer.

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const NAV_TIMEOUT_MS = 30_000;
const REVEAL_TIMEOUT_MS = 60_000;

async function detectWebgl(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const c = document.createElement("canvas");
      return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  });
}

async function expectWorkspaceRevealed(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="platform-screen-stack"]')).toBeVisible({
    timeout: REVEAL_TIMEOUT_MS,
  });
  // After reveal the opener overlay and the static boot loader are gone.
  await expect(page.locator('[data-testid="neural-stage"]')).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="pyrus-boot-loader"]')).toHaveCount(0);
}

test.describe("neural loading screen", () => {
  test("default: opener plays when WebGL is available, app reveals either way", async ({
    page,
  }) => {
    await page.goto(APP_URL, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    if (await detectWebgl(page)) {
      await expect(
        page.locator('[data-testid="neural-stage"] canvas'),
      ).toBeVisible({ timeout: NAV_TIMEOUT_MS });
    }
    await expectWorkspaceRevealed(page);
  });

  test("reduced motion: opener never plays, app reveals via fallback", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await page.goto(APP_URL, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await expect(page.locator('[data-testid="neural-stage"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="platform-screen-stack"]'),
      ).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    } finally {
      await context.close();
    }
  });

  test("no WebGL: opener gates off, app still reveals", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Force WebGL unavailable before any app code runs.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patched(
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (typeof type === "string" && type.toLowerCase().includes("webgl")) {
          return null;
        }
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    try {
      await page.goto(APP_URL, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      await expect(page.locator('[data-testid="neural-stage"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="platform-screen-stack"]'),
      ).toBeVisible({ timeout: REVEAL_TIMEOUT_MS });
    } finally {
      await context.close();
    }
  });
});

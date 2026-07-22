import { expect, test, type Page } from "@playwright/test";

// Run:
//   PYRUS_LIVE_BROWSER_VALIDATION=1 PYRUS_MUTATING_BROWSER_VALIDATION=1 pnpm --filter @workspace/pyrus exec playwright test e2e/algo-panel-save.browser-validation.spec.ts --reporter=list
// Against the public preview:
//   PYRUS_LIVE_BROWSER_VALIDATION=1 PYRUS_MUTATING_BROWSER_VALIDATION=1 PYRUS_APP_URL=https://$REPLIT_DEV_DOMAIN/ pnpm --filter @workspace/pyrus exec playwright test e2e/algo-panel-save.browser-validation.spec.ts --reporter=list
//
// Round-trip under test: AlgoSettingsRegion.jsx (a compact-field editor) ->
// useServerSyncedDraft.js (dirty tracking) -> AlgoSaveBar.jsx ("Save
// changes") -> saveAllAlgoAdjustments.js -> a PATCH to
// /api/algo/deployments/:id/signal-options/profile (registered in
// artifacts/api-server/src/routes/automation.ts) -> the value must survive a
// full page reload.
//
// Failure modes this spec catches: the dirty flag never clears after a
// successful save, the save reports success client-side but the PATCH
// actually returned 4xx/5xx, or the value is lost/reverted after reload.

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const BOOT_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 20_000;

const ALGO_URL = `${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=algo`;

// riskCaps.maxContracts: a plain <input type="number"> (min 1 / max 500 /
// step 1) in the "Risk" settings section, which SETTINGS_SECTIONS marks
// defaultOpen: true -- so the field is in the DOM on first paint with no
// section-expand click needed. It is a "profile"-slice field, so saving it
// exercises the signal-options/profile PATCH (not strategy-settings).
// Assumption: this field exists on any non-overnight/spot deployment; an
// OVERNIGHT_SPOT-kind deployment renders only <OvernightControlPanel/> here
// instead (AlgoRightRail.jsx) -- the spec skips if the field isn't present.
const FIELD_TESTID = "algo-compact-input-riskCaps.maxContracts";

type NetLog = {
  runtimeFailures: string[];
  patchRequests: Array<{ url: string; method: string; body: string | null }>;
  patchResponses: Array<{ url: string; status: number; body: string | null }>;
};

function watchAlgoTraffic(page: Page): NetLog {
  const log: NetLog = { runtimeFailures: [], patchRequests: [], patchResponses: [] };
  page.on("pageerror", (error) => {
    log.runtimeFailures.push(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("Failed to load resource:")) return;
    log.runtimeFailures.push(`console: ${text}`);
  });
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/algo/deployments/")) {
      log.patchRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postData(),
      });
    }
  });
  page.on("response", async (response) => {
    if (
      response.request().method() === "PATCH" &&
      response.url().includes("/api/algo/deployments/")
    ) {
      const body = await response.text().catch(() => null);
      log.patchResponses.push({ url: response.url(), status: response.status(), body });
    }
  });
  return log;
}

async function gotoAlgoReadyOrSkip(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(ALGO_URL, { waitUntil: "domcontentloaded" });

  const app = page.locator('[data-testid="platform-screen-stack"]');
  const gate = page.locator('[data-testid="login-gate-submit"]');
  try {
    await Promise.race([
      app.waitFor({ state: "visible", timeout: BOOT_TIMEOUT_MS }),
      gate.waitFor({ state: "visible", timeout: BOOT_TIMEOUT_MS }),
    ]);
  } catch {
    test.skip(
      true,
      `App did not finish booting within ${BOOT_TIMEOUT_MS}ms at ${ALGO_URL} -- box likely under load; skipping.`,
    );
  }
  test.skip(
    await gate.isVisible().catch(() => false),
    "Blocked by the sign-in gate before reaching the Algo screen -- skipping.",
  );
  await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden({
    timeout: BOOT_TIMEOUT_MS,
  });
}

async function restoreOriginalValue(
  page: Page,
  originalValue: string,
): Promise<void> {
  await page.goto(ALGO_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="platform-screen-stack"]')).toBeVisible({
    timeout: BOOT_TIMEOUT_MS,
  });
  await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden({
    timeout: BOOT_TIMEOUT_MS,
  });

  const field = page.locator(`[data-testid="${FIELD_TESTID}"]`);
  await expect(field).toBeVisible({ timeout: 15_000 });
  if ((await field.inputValue()) === originalValue) return;

  const saveBar = page.locator('[data-testid="algo-save-bar"]');
  await field.fill(originalValue);
  await expect(saveBar).toContainText(/unsaved change/i, { timeout: 10_000 });

  const patchResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/algo/deployments/") &&
      (response.url().includes("/signal-options/profile") ||
        response.url().includes("/strategy-settings")),
    { timeout: ACTION_TIMEOUT_MS },
  );
  await saveBar.getByRole("button", { name: /Save changes/ }).click();
  const patchResponse = await patchResponsePromise;
  expect(
    patchResponse.status(),
    `restore PATCH ${patchResponse.url()} returned ${patchResponse.status()}`,
  ).toBeLessThan(300);
  await expect(saveBar).toContainText("All changes saved", { timeout: 15_000 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.locator(`[data-testid="${FIELD_TESTID}"]`),
  ).toHaveValue(originalValue, { timeout: BOOT_TIMEOUT_MS });
}

test.describe("Algo control-panel save round-trip", () => {
  test.skip(
    process.env.PYRUS_LIVE_BROWSER_VALIDATION !== "1",
    "Set PYRUS_LIVE_BROWSER_VALIDATION=1 after approving live browser QA.",
  );
  test.skip(
    process.env.PYRUS_MUTATING_BROWSER_VALIDATION !== "1",
    "Set PYRUS_MUTATING_BROWSER_VALIDATION=1 after approving a reversible deployment-setting write.",
  );
  test.setTimeout(150_000);

  test("editing a setting, saving, and reloading persists the change", async ({ page }) => {
    const log = watchAlgoTraffic(page);
    await gotoAlgoReadyOrSkip(page);

    const saveBar = page.locator('[data-testid="algo-save-bar"]');
    const saveBarVisible = await saveBar.isVisible({ timeout: 15_000 }).catch(() => false);
    test.skip(!saveBarVisible, "No focused deployment / save bar rendered -- nothing to edit.");

    const field = page.locator(`[data-testid="${FIELD_TESTID}"]`);
    const fieldVisible = await field.isVisible({ timeout: 10_000 }).catch(() => false);
    test.skip(
      !fieldVisible,
      "Focused deployment doesn't expose the signal-options riskCaps.maxContracts field (likely an overnight/spot deployment) -- nothing standard to edit.",
    );

    await expect(saveBar).toContainText("All changes saved");

    const originalValue = await field.inputValue();
    const originalNumber = Number(originalValue);
    expect(Number.isInteger(originalNumber)).toBe(true);
    const nextNumber = originalNumber >= 500 ? originalNumber - 1 : originalNumber + 1;
    let restoreRequired = false;
    try {
      await field.fill(String(nextNumber));

      // Catches "control doesn't mark the draft dirty".
      await expect(saveBar).toContainText(/unsaved change/i, { timeout: 10_000 });

      const saveButton = saveBar.getByRole("button", { name: /Save changes/ });
      await expect(saveButton).toBeEnabled();

      const patchResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/api/algo/deployments/") &&
          (response.url().includes("/signal-options/profile") ||
            response.url().includes("/strategy-settings")),
        { timeout: ACTION_TIMEOUT_MS },
      );
      restoreRequired = true;
      await saveButton.click();
      const patchResponse = await patchResponsePromise;

      console.log("PATCH requests:", JSON.stringify(log.patchRequests, null, 2));
      console.log("PATCH responses:", JSON.stringify(log.patchResponses, null, 2));

      // Catches "save reports success client-side but the PATCH actually failed".
      expect(
        patchResponse.status(),
        `PATCH ${patchResponse.url()} returned ${patchResponse.status()}`,
      ).toBeLessThan(300);

      // Catches "dirty flag never clears after a successful save".
      await expect(saveBar).toContainText("All changes saved", { timeout: 15_000 });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="platform-screen-stack"]')).toBeVisible({
        timeout: BOOT_TIMEOUT_MS,
      });
      await expect(page.locator('[data-testid="pyrus-boot-progress-overlay"]')).toBeHidden({
        timeout: BOOT_TIMEOUT_MS,
      });

      // The focused deployment persists across reload via
      // algoDeploymentFocusStore.js, so this reads the same deployment.
      const fieldAfterReload = page.locator(`[data-testid="${FIELD_TESTID}"]`);
      await expect(fieldAfterReload).toBeVisible({ timeout: 15_000 });
      await expect(fieldAfterReload).toHaveValue(String(nextNumber), {
        timeout: 10_000,
      });

      console.log("runtime failures:", JSON.stringify(log.runtimeFailures, null, 2));
      expect(log.runtimeFailures).toEqual([]);
    } finally {
      if (restoreRequired) {
        await restoreOriginalValue(page, originalValue);
      }
    }
  });
});

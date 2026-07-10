import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import {
  chromium,
  type Browser,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import {
  auditEventsTable,
  authSessionsTable,
  db,
  taxProfilesTable,
  taxReserveBucketsTable,
  userPreferenceProfilesTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

import { createAuthSession } from "../services/auth";

const APP_URL = "http://127.0.0.1:18747/";
const FRAME_INTERVAL_MS = 500;
const CAPTURE_DURATION_MS = 20_000;
const ACCOUNT_PANEL_LOADING_DEADLINE_MS = 15_000;
const AUTH_SESSION_COOKIE = "pyrus_session";
const RETIRED_UI_TEXT_PATTERNS = [
  { label: "Expanded Limits", pattern: /Expanded Limits/i },
  {
    label: "10 symbols · $1,000 halt",
    pattern: /10 symbols\s*·\s*\$1,000 halt/i,
  },
  { label: "runtime fallback", pattern: /runtime fallback/i },
] as const;
const TARGETS = [
  { id: "account", label: "Account" },
  { id: "algo", label: "Algo" },
] as const;
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const OUTPUT_ROOT = join(
  REPO_ROOT,
  "artifacts/output/visual-fallback-review",
  new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"),
);

type Frame = {
  activeScreen: string | null;
  elapsedMs: number;
  visibleScreenHosts: string[];
  visibleTestIds: string[];
  statusText: string[];
  bodyText: string;
};

type TargetActivation = {
  passed: boolean;
  firstActivatedAtMs: number | null;
  invalidActivatedFrames: Array<{
    elapsedMs: number;
    visibleScreenHosts: string[];
  }>;
  delayedLoadingFrames: Array<{
    elapsedMs: number;
    visibleTestIds: string[];
  }>;
  lingeringPanelFrames: Array<{
    elapsedMs: number;
    statusText: string[];
    visibleTestIds: string[];
  }>;
  retiredTextMatches: string[];
  finalActiveScreen: string | null;
  finalVisibleScreenHosts: string[];
};

const evaluateTargetActivation = (
  target: (typeof TARGETS)[number],
  frames: Frame[],
  finalBodyText = "",
): TargetActivation => {
  const expectedHost = `screen-host-${target.id}`;
  const activatedFrames = frames.filter(
    (frame) => frame.activeScreen === target.label,
  );
  const invalidActivatedFrames = activatedFrames
    .filter(
      (frame) =>
        frame.visibleScreenHosts.length !== 1 ||
        frame.visibleScreenHosts[0] !== expectedHost,
    )
    .map(({ elapsedMs, visibleScreenHosts }) => ({
      elapsedMs,
      visibleScreenHosts: [...visibleScreenHosts],
    }));
  const forbiddenLoadingTestIds = new Set([
    `screen-loading-${target.id}`,
    ...(target.id === "algo" ? ["algo-setup-loading"] : []),
  ]);
  const delayedLoadingFrames = frames
    .filter(
      (frame) =>
        frame.elapsedMs > FRAME_INTERVAL_MS &&
        frame.visibleTestIds.some((testId) =>
          forbiddenLoadingTestIds.has(testId),
        ),
    )
    .map(({ elapsedMs, visibleTestIds }) => ({
      elapsedMs,
      visibleTestIds: [...visibleTestIds],
    }));
  const lingeringPanelFrames =
    target.id === "account"
      ? frames
          .filter(
            (frame) =>
              frame.elapsedMs >= ACCOUNT_PANEL_LOADING_DEADLINE_MS &&
              (frame.visibleTestIds.includes("account-panel-loading-waits") ||
                frame.statusText.some((text) =>
                  /Loading (?:exposure|equity curve|trading analysis|setup health)/i.test(
                    text,
                  ),
                )),
          )
          .map(({ elapsedMs, statusText, visibleTestIds }) => ({
            elapsedMs,
            statusText: [...statusText],
            visibleTestIds: [...visibleTestIds],
          }))
      : [];
  const finalFrame = frames.at(-1) ?? null;
  const inspectedText = `${frames.map((frame) => frame.bodyText).join("\n")}\n${finalBodyText}`;
  const retiredTextMatches = RETIRED_UI_TEXT_PATTERNS.filter(({ pattern }) =>
    pattern.test(inspectedText),
  ).map(({ label }) => label);
  const finalMatches =
    finalFrame?.activeScreen === target.label &&
    finalFrame.visibleScreenHosts.length === 1 &&
    finalFrame.visibleScreenHosts[0] === expectedHost;
  const firstActivatedAtMs = activatedFrames[0]?.elapsedMs ?? null;

  return {
    passed:
      activatedFrames.length > 0 &&
      firstActivatedAtMs !== null &&
      firstActivatedAtMs <= FRAME_INTERVAL_MS &&
      invalidActivatedFrames.length === 0 &&
      delayedLoadingFrames.length === 0 &&
      lingeringPanelFrames.length === 0 &&
      retiredTextMatches.length === 0 &&
      finalMatches,
    firstActivatedAtMs,
    invalidActivatedFrames,
    delayedLoadingFrames,
    lingeringPanelFrames,
    retiredTextMatches,
    finalActiveScreen: finalFrame?.activeScreen ?? null,
    finalVisibleScreenHosts: [...(finalFrame?.visibleScreenHosts ?? [])],
  };
};

const snapshotDiagnostics = (
  runtimeErrors: string[],
  apiIssues: Array<Record<string, unknown>>,
) => ({
  runtimeErrors: [...runtimeErrors],
  apiIssues: [...apiIssues],
});

const waitForNeuralOpenerToFinish = (page: Page) =>
  page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-testid="neural-stage"], [data-testid="neural-boot-static"]',
      ),
    undefined,
    { timeout: 60_000 },
  );

const captureFrame = async (
  page: Page,
  targetId: string,
  elapsedMs: number,
): Promise<Frame> =>
  page.evaluate(
    ({ elapsedMs: sampleElapsedMs, targetId: sampleTargetId }) => {
      const visibleTestIds = Array.from(
        document.querySelectorAll("[data-testid]"),
      )
        .filter((element) => {
          const browserElement = element as HTMLElement & {
            checkVisibility?: (options?: {
              checkOpacity?: boolean;
              checkVisibilityCSS?: boolean;
            }) => boolean;
          };
          const rect = element.getBoundingClientRect();
          return (
            (browserElement.checkVisibility?.({
              checkOpacity: true,
              checkVisibilityCSS: true,
            }) ??
              true) &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((element) => element.getAttribute("data-testid"))
        .filter((value): value is string => Boolean(value))
        .filter(
          (testId) =>
            testId.includes("loading") ||
            testId.includes("fallback") ||
            testId.includes("overlay") ||
            testId === `${sampleTargetId}-screen` ||
            testId.startsWith("screen-host-"),
        );
      const statusText = Array.from(
        document.querySelectorAll(
          '[role="status"], [role="alert"], [aria-busy="true"]',
        ),
      )
        .filter((element) => {
          const browserElement = element as HTMLElement & {
            checkVisibility?: (options?: {
              checkOpacity?: boolean;
              checkVisibilityCSS?: boolean;
            }) => boolean;
          };
          const rect = element.getBoundingClientRect();
          return (
            (browserElement.checkVisibility?.({
              checkOpacity: true,
              checkVisibilityCSS: true,
            }) ??
              true) &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((element) =>
          (element.textContent || "").replace(/\s+/g, " ").trim(),
        )
        .filter(Boolean)
        .slice(0, 40);
      return {
        activeScreen:
          document
            .querySelector(
              '[data-testid="platform-screen-nav"] [aria-current="page"]',
            )
            ?.textContent?.replace(/\s+/g, " ")
            .trim() || null,
        elapsedMs: sampleElapsedMs,
        visibleScreenHosts: visibleTestIds.filter((testId) =>
          testId.startsWith("screen-host-"),
        ),
        visibleTestIds,
        statusText,
        bodyText: (document.body?.innerText || "")
          .replace(/\s+/g, " ")
          .slice(0, 4_000),
      };
    },
    { elapsedMs, targetId },
  );

if (process.argv.includes("--self-test")) {
  const baseFrame: Frame = {
    activeScreen: "Account",
    elapsedMs: 500,
    visibleScreenHosts: ["screen-host-account"],
    visibleTestIds: [],
    statusText: [],
    bodyText: "",
  };
  if (!evaluateTargetActivation(TARGETS[0], [baseFrame]).passed) {
    throw new Error("Expected the matching target host to pass");
  }
  if (
    evaluateTargetActivation(TARGETS[0], [
      { ...baseFrame, visibleScreenHosts: ["screen-host-market"] },
    ]).passed
  ) {
    throw new Error("Expected a mismatched target host to fail");
  }
  if (
    evaluateTargetActivation(TARGETS[0], [
      { ...baseFrame, activeScreen: "Market", elapsedMs: 500 },
      { ...baseFrame, elapsedMs: 1_000 },
    ]).passed
  ) {
    throw new Error("Expected a delayed screen activation to fail");
  }
  if (
    evaluateTargetActivation(TARGETS[0], [
      baseFrame,
      {
        ...baseFrame,
        elapsedMs: 1_000,
        visibleTestIds: ["screen-loading-account"],
      },
    ]).passed
  ) {
    throw new Error("Expected a whole-screen loader after 500ms to fail");
  }
  if (
    evaluateTargetActivation(TARGETS[0], [
      baseFrame,
      {
        ...baseFrame,
        elapsedMs: ACCOUNT_PANEL_LOADING_DEADLINE_MS,
        statusText: ["Loading exposure"],
        visibleTestIds: ["account-panel-loading-waits"],
      },
    ]).passed
  ) {
    throw new Error("Expected a lingering Account panel loader to fail");
  }
  if (
    evaluateTargetActivation(TARGETS[0], [
      { ...baseFrame, bodyText: "Expanded Limits" },
    ]).passed
  ) {
    throw new Error("Expected retired UI copy to fail");
  }
  const runtimeErrors = ["captured"];
  const apiIssues = [{ kind: "captured" }];
  const snapshot = snapshotDiagnostics(runtimeErrors, apiIssues);
  runtimeErrors.push("teardown");
  apiIssues.push({ kind: "teardown" });
  if (snapshot.runtimeErrors.length !== 1 || snapshot.apiIssues.length !== 1) {
    throw new Error("Expected diagnostics to be immutable after snapshotting");
  }
  console.log("Visual fallback harness self-test passed");
  process.exit(0);
}

mkdirSync(OUTPUT_ROOT, { recursive: true });

const report: Record<string, unknown> = {
  appUrl: APP_URL,
  frameIntervalMs: FRAME_INTERVAL_MS,
  captureDurationMs: CAPTURE_DURATION_MS,
  viewport: { width: 1440, height: 900 },
  targets: {},
};
const activationFailures: string[] = [];
let browser: Browser | null = null;
let qaUserId: string | null = null;
let runError: unknown = null;

try {
  browser = await chromium.launch({
    executablePath:
      process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const qaRunId = `${Date.now()}-${randomBytes(12).toString("hex")}`;
  const [qaUser] = await db
    .insert(usersTable)
    .values({
      email: `codex-visual-review-${qaRunId}@pyrus.local`,
      displayName: `Codex Visual QA ${qaRunId}`,
      passwordHash: null,
      role: "admin",
    })
    .returning();
  if (!qaUser) {
    throw new Error("Unable to mint the temporary visual-QA user");
  }
  qaUserId = qaUser.id;
  const qaSession = await createAuthSession({ userId: qaUser.id });

  for (const target of TARGETS) {
    const targetDir = join(OUTPUT_ROOT, target.id);
    mkdirSync(targetDir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
      recordVideo: {
        dir: targetDir,
        size: { width: 1440, height: 900 },
      },
    });
    const page = await context.newPage();
    const pageOpenedAt = Date.now();
    const runtimeErrors: string[] = [];
    const apiIssues: Array<Record<string, unknown>> = [];
    const handlePageError = (error: Error) =>
      runtimeErrors.push(`pageerror: ${error.message}`);
    const handleConsole = (message: ConsoleMessage) => {
      if (message.type() === "error") {
        runtimeErrors.push(`console: ${message.text()}`);
      }
    };
    const handleRequestFailed = (request: Request) => {
      apiIssues.push({
        kind: "requestfailed",
        path: new URL(request.url()).pathname,
        resourceType: request.resourceType(),
        error: request.failure()?.errorText || null,
      });
    };
    const handleResponse = (response: Response) => {
      const headers = response.headers();
      const diagnostics = Object.fromEntries(
        Object.entries(headers).filter(([name]) =>
          /pressure|admission|cache|retry-after/i.test(name),
        ),
      );
      if (
        response.status() >= 400 ||
        (response.url().includes("/api/") &&
          Object.keys(diagnostics).length > 0)
      ) {
        apiIssues.push({
          kind: "response",
          status: response.status(),
          path: new URL(response.url()).pathname,
          diagnostics,
        });
      }
    };
    page.on("pageerror", handlePageError);
    page.on("console", handleConsole);
    page.on("requestfailed", handleRequestFailed);
    page.on("response", handleResponse);

    await page.goto(APP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector('[data-testid="login-brand-stage"]', {
      state: "visible",
      timeout: 60_000,
    });
    await page.waitForSelector("#email", {
      state: "visible",
      timeout: 60_000,
    });
    await page.waitForSelector('[data-testid="pyrus-boot-progress-overlay"]', {
      state: "hidden",
      timeout: 60_000,
    });
    await waitForNeuralOpenerToFinish(page);
    await page.screenshot({ path: join(targetDir, "auth-before-signin.png") });
    await context.addCookies([
      {
        name: AUTH_SESSION_COOKIE,
        value: qaSession.sessionToken,
        url: APP_URL,
        httpOnly: true,
        sameSite: "Lax",
        secure: false,
        expires: Math.floor(qaSession.expiresAt.getTime() / 1_000),
      },
    ]);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector('[data-testid="platform-screen-stack"]', {
      state: "visible",
      timeout: 60_000,
    });
    await page.waitForSelector('[data-testid="pyrus-boot-progress-overlay"]', {
      state: "hidden",
      timeout: 60_000,
    });
    await waitForNeuralOpenerToFinish(page);
    await page.waitForSelector('[data-testid="screen-host-market"]', {
      state: "visible",
      timeout: 60_000,
    });
    await page.waitForSelector('[data-testid="market-demo-screen"]', {
      state: "visible",
      timeout: 60_000,
    });

    runtimeErrors.length = 0;
    apiIssues.length = 0;
    const preNavigationWarmupSnapshot = await page.evaluate(() =>
      structuredClone(
        (
          window as Window & {
            __PYRUS_PERF_WARMUP_SNAPSHOT__?: {
              screenModulePreloads?: unknown;
            };
          }
        ).__PYRUS_PERF_WARMUP_SNAPSHOT__?.screenModulePreloads ?? null,
      ),
    );
    await page.screenshot({ path: join(targetDir, "before-navigation.png") });
    const nav = page
      .locator('[data-testid="platform-screen-nav"]')
      .getByRole("button", { name: new RegExp(`^${target.label}$`) });
    await nav.waitFor({ state: "attached", timeout: 30_000 });
    const navigationIntentDiagnostics = await page.evaluate((targetLabel) => {
      const navElement = document.querySelector(
        '[data-testid="platform-screen-nav"]',
      );
      const navRect = navElement?.getBoundingClientRect() ?? null;
      const buttons = Array.from(
        navElement?.querySelectorAll("button") ?? [],
      ).map((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        const label =
          button.getAttribute("aria-label") || button.textContent || "";
        const intersectsNav = Boolean(
          navRect &&
            rect.right > navRect.left &&
            rect.left < navRect.right &&
            rect.bottom > navRect.top &&
            rect.top < navRect.bottom,
        );
        return {
          label: label.trim(),
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          intersectsNav,
          rect: {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      });
      const targetButton = buttons.find(
        (button) => button.label === targetLabel,
      );
      return {
        targetLabel,
        targetVisible: Boolean(
          targetButton &&
            targetButton.display !== "none" &&
            targetButton.visibility !== "hidden" &&
            Number(targetButton.opacity) > 0 &&
            targetButton.intersectsNav &&
            targetButton.rect.width > 0 &&
            targetButton.rect.height > 0,
        ),
        nav: navElement
          ? {
              clientWidth: navElement.clientWidth,
              scrollWidth: navElement.scrollWidth,
              scrollLeft: navElement.scrollLeft,
              rect: navRect
                ? {
                    left: Math.round(navRect.left),
                    right: Math.round(navRect.right),
                    width: Math.round(navRect.width),
                  }
                : null,
            }
          : null,
        buttons,
      };
    }, target.label);
    const navigationPerformanceStartTime = await page.evaluate(() =>
      performance.now(),
    );
    if (!(await nav.isEnabled())) {
      throw new Error(`${target.label} navigation button is disabled`);
    }
    await nav.evaluate((button) => (button as HTMLButtonElement).click());

    const frames: Frame[] = [];
    const startedAt = Date.now();
    let scheduledElapsedMs = 0;
    for (;;) {
      const scheduledAt = startedAt + scheduledElapsedMs;
      const waitMs = scheduledAt - Date.now();
      if (waitMs > 0) {
        await page.waitForTimeout(waitMs);
      }
      const elapsedMs = Date.now() - startedAt;
      frames.push(await captureFrame(page, target.id, elapsedMs));
      if (Date.now() - startedAt >= CAPTURE_DURATION_MS) break;
      scheduledElapsedMs =
        (Math.floor(elapsedMs / FRAME_INTERVAL_MS) + 1) * FRAME_INTERVAL_MS;
    }

    await page.screenshot({ path: join(targetDir, "after-navigation.png") });
    const finalText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const navigationModuleResources = await page.evaluate(
      ({ navigationStartedAt }) =>
        performance
          .getEntriesByType("resource")
          .filter((entry) => {
            try {
              return (
                entry.startTime >= navigationStartedAt &&
                new URL(entry.name).pathname.startsWith("/src/")
              );
            } catch {
              return false;
            }
          })
          .map((entry) => {
            const resource = entry as PerformanceResourceTiming;
            return {
              path: new URL(resource.name).pathname,
              startTime: Math.round(resource.startTime),
              responseEnd: Math.round(resource.responseEnd),
              duration: Math.round(resource.duration),
              transferSize: resource.transferSize,
            };
          })
          .sort((left, right) => left.startTime - right.startTime),
      { navigationStartedAt: navigationPerformanceStartTime },
    );
    const postNavigationWarmupSnapshot = await page.evaluate(() =>
      structuredClone(
        (
          window as Window & {
            __PYRUS_PERF_WARMUP_SNAPSHOT__?: {
              screenModulePreloads?: unknown;
            };
          }
        ).__PYRUS_PERF_WARMUP_SNAPSHOT__?.screenModulePreloads ?? null,
      ),
    );
    page.off("pageerror", handlePageError);
    page.off("console", handleConsole);
    page.off("requestfailed", handleRequestFailed);
    page.off("response", handleResponse);
    const diagnostics = snapshotDiagnostics(runtimeErrors, apiIssues);
    const activation = evaluateTargetActivation(target, frames, finalText);
    if (!activation.passed) {
      activationFailures.push(`${target.id}: ${JSON.stringify(activation)}`);
    }
    if (!navigationIntentDiagnostics.targetVisible) {
      activationFailures.push(
        `${target.id} nav clipped: ${JSON.stringify(navigationIntentDiagnostics)}`,
      );
    }
    const targetReport = {
      frames,
      ...diagnostics,
      activation,
      navigationIntentDiagnostics,
      preNavigationWarmupSnapshot,
      postNavigationWarmupSnapshot,
      navigationModuleResources,
      finalBodyText: finalText.replace(/\s+/g, " ").slice(0, 20_000),
      navigationVideoOffsetMs: startedAt - pageOpenedAt,
      videoPath: join(targetDir, "transition.webm"),
    };
    const video = page.video();
    await context.close();
    await video?.saveAs(targetReport.videoPath);
    (report.targets as Record<string, unknown>)[target.id] = targetReport;
    writeFileSync(
      join(targetDir, "transition.json"),
      JSON.stringify(targetReport, null, 2),
    );
  }
} catch (error) {
  runError = error;
}

const cleanupErrors: unknown[] = [];
try {
  await browser?.close();
} catch (error) {
  cleanupErrors.push(error);
}
if (qaUserId) {
  const cleanupUserId = qaUserId;
  for (const cleanup of [
    () =>
      db
        .delete(authSessionsTable)
        .where(eq(authSessionsTable.userId, cleanupUserId)),
    () =>
      db
        .delete(userPreferenceProfilesTable)
        .where(eq(userPreferenceProfilesTable.appUserId, cleanupUserId)),
    () =>
      db
        .delete(auditEventsTable)
        .where(eq(auditEventsTable.appUserId, cleanupUserId)),
    () =>
      db
        .delete(taxReserveBucketsTable)
        .where(eq(taxReserveBucketsTable.appUserId, cleanupUserId)),
    () =>
      db
        .delete(taxProfilesTable)
        .where(eq(taxProfilesTable.appUserId, cleanupUserId)),
    () => db.delete(usersTable).where(eq(usersTable.id, cleanupUserId)),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    const [[remainingSession], [remainingUser]] = await Promise.all([
      db
        .select({ id: authSessionsTable.id })
        .from(authSessionsTable)
        .where(eq(authSessionsTable.userId, cleanupUserId))
        .limit(1),
      db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, cleanupUserId))
        .limit(1),
    ]);
    if (remainingSession || remainingUser) {
      cleanupErrors.push(
        new Error(
          `Temporary visual-QA identity cleanup verification failed for ${cleanupUserId}`,
        ),
      );
    }
  } catch (error) {
    cleanupErrors.push(error);
  }
}

if (runError && cleanupErrors.length > 0) {
  throw new AggregateError(
    [runError, ...cleanupErrors],
    "Visual-QA run failed and its temporary identity was not fully cleaned",
  );
}
if (runError) {
  throw runError;
}
if (cleanupErrors.length > 0) {
  throw new AggregateError(
    cleanupErrors,
    `Failed to fully clean temporary visual-QA identity ${qaUserId}`,
  );
}

writeFileSync(
  join(OUTPUT_ROOT, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    outputRoot: OUTPUT_ROOT,
    targets: TARGETS.map(({ id }) => id),
  }),
);
if (activationFailures.length > 0) {
  throw new Error(
    `Visual navigation assertion failed: ${activationFailures.join("; ")}`,
  );
}
process.exit(0);

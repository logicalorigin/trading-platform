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
  shadowAccountsTable,
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
const SCREEN_CONTENT_LOADING_DEADLINE_MS = 15_000;
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
const DIAGNOSE_ALGO_CLICK = process.argv.includes("--diagnose-algo-click");
const PROFILE_ALGO_CLICK = process.argv.includes("--profile-algo-click");
const PROFILE_ACCOUNT_CLICK = process.argv.includes("--profile-account-click");
const PROFILE_NAVIGATION_CLICK = PROFILE_ALGO_CLICK || PROFILE_ACCOUNT_CLICK;
const MARKET_ONE_CHART = process.argv.includes("--market-one-chart");
const selectRunTargets = (args: readonly string[]) => {
  if (
    args.includes("--account-only") ||
    args.includes("--profile-account-click")
  ) {
    return TARGETS.filter((target) => target.id === "account");
  }
  if (
    args.includes("--diagnose-algo-click") ||
    args.includes("--profile-algo-click") ||
    args.includes("--market-one-chart") ||
    args.includes("--algo-only")
  ) {
    return TARGETS.filter((target) => target.id === "algo");
  }
  return TARGETS;
};
const RUN_TARGETS = selectRunTargets(process.argv);
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
  firstSampledActivatedAtMs: number | null;
  invalidActivatedFrames: Array<{
    activeScreen: string | null;
    elapsedMs: number;
    visibleScreenHosts: string[];
  }>;
  delayedLoadingFrames: Array<{
    elapsedMs: number;
    visibleTestIds: string[];
  }>;
  lingeringContentFrames: Array<{
    elapsedMs: number;
    statusText: string[];
    visibleTestIds: string[];
  }>;
  retiredTextMatches: string[];
  finalActiveScreen: string | null;
  finalVisibleScreenHosts: string[];
};

type BrowserClickTiming = {
  armedAt: number;
  events: Array<{
    phase: string;
    at: number;
    activeScreen?: string | null;
    visibleScreenHosts?: string[];
  }>;
};

const evaluateBrowserActivation = (timing: BrowserClickTiming | null) => {
  const eventAt = (phase: string) =>
    timing?.events.find((event) => event.phase === phase)?.at ?? null;
  const pointerDownAt = eventAt("pointerdown");
  const clickCaptureAt = eventAt("click-capture");
  const targetCommitAt = eventAt("target-commit");
  const targetFrameAt = eventAt("target-frame");
  const elapsed = (start: number | null, end: number | null) =>
    start !== null && end !== null ? end - start : null;
  const pointerToCommitMs = elapsed(pointerDownAt, targetCommitAt);
  const pointerToFrameMs = elapsed(pointerDownAt, targetFrameAt);
  const delayedForbiddenLoaders = (timing?.events ?? [])
    .filter((event) => event.phase.startsWith("forbidden-loader-visible:"))
    .map((event) => ({
      testId: event.phase.slice("forbidden-loader-visible:".length),
      pointerElapsedMs: elapsed(pointerDownAt, event.at),
    }))
    .filter(
      (event) =>
        event.pointerElapsedMs !== null &&
        event.pointerElapsedMs >= FRAME_INTERVAL_MS,
    );
  const invalidPostActivationFrames = (timing?.events ?? [])
    .filter((event) => event.phase === "post-activation-invalid")
    .map((event) => ({
      activeScreen: event.activeScreen ?? null,
      pointerElapsedMs: elapsed(pointerDownAt, event.at),
      visibleScreenHosts: [...(event.visibleScreenHosts ?? [])],
    }));

  return {
    passed:
      pointerToCommitMs !== null &&
      pointerToCommitMs >= 0 &&
      pointerToFrameMs !== null &&
      pointerToFrameMs >= pointerToCommitMs &&
      pointerToFrameMs <= FRAME_INTERVAL_MS &&
      delayedForbiddenLoaders.length === 0 &&
      invalidPostActivationFrames.length === 0,
    armedToFrameMs: elapsed(timing?.armedAt ?? null, targetFrameAt),
    pointerToCommitMs,
    pointerToFrameMs,
    clickCaptureToCommitMs: elapsed(clickCaptureAt, targetCommitAt),
    clickCaptureToFrameMs: elapsed(clickCaptureAt, targetFrameAt),
    delayedForbiddenLoaders,
    invalidPostActivationFrames,
  };
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
  const firstActivatedFrameIndex = frames.findIndex(
    (frame) => frame.activeScreen === target.label,
  );
  const postActivationFrames =
    firstActivatedFrameIndex >= 0 ? frames.slice(firstActivatedFrameIndex) : [];
  const invalidActivatedFrames = postActivationFrames
    .filter(
      (frame) =>
        frame.activeScreen !== target.label ||
        frame.visibleScreenHosts.length !== 1 ||
        frame.visibleScreenHosts[0] !== expectedHost,
    )
    .map(({ activeScreen, elapsedMs, visibleScreenHosts }) => ({
      activeScreen,
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
  const lingeringContentFrames = frames
    .filter((frame) => {
      if (frame.elapsedMs < SCREEN_CONTENT_LOADING_DEADLINE_MS) {
        return false;
      }
      if (target.id === "account") {
        return (
          frame.visibleTestIds.includes("account-route-loading") ||
          frame.visibleTestIds.includes("account-panel-loading-waits") ||
          frame.statusText.some((text) =>
            /Loading (?:cash activity|exposure|equity curve|trading analysis|setup health)/i.test(
              text,
            ),
          )
        );
      }
      if (target.id === "algo") {
        return frame.visibleTestIds.some((testId) =>
          ["algo-route-loading", "algo-live-page-loading"].includes(testId),
        );
      }
      return false;
    })
    .map(({ elapsedMs, statusText, visibleTestIds }) => ({
      elapsedMs,
      statusText: [...statusText],
      visibleTestIds: [...visibleTestIds],
    }));
  const finalFrame = frames.at(-1) ?? null;
  const inspectedText = `${frames.map((frame) => frame.bodyText).join("\n")}\n${finalBodyText}`;
  const retiredTextMatches = RETIRED_UI_TEXT_PATTERNS.filter(({ pattern }) =>
    pattern.test(inspectedText),
  ).map(({ label }) => label);
  const finalMatches =
    finalFrame?.activeScreen === target.label &&
    finalFrame.visibleScreenHosts.length === 1 &&
    finalFrame.visibleScreenHosts[0] === expectedHost;
  const firstSampledActivatedAtMs = activatedFrames[0]?.elapsedMs ?? null;

  return {
    passed:
      activatedFrames.length > 0 &&
      firstSampledActivatedAtMs !== null &&
      invalidActivatedFrames.length === 0 &&
      delayedLoadingFrames.length === 0 &&
      lingeringContentFrames.length === 0 &&
      retiredTextMatches.length === 0 &&
      finalMatches,
    firstSampledActivatedAtMs,
    invalidActivatedFrames,
    delayedLoadingFrames,
    lingeringContentFrames,
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

const startNavigationCpuTrace = async (page: Page, targetDir: string) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Tracing.start", {
    categories: [
      "-*",
      "blink.user_timing",
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.stack",
      "disabled-by-default-v8.cpu_profiler",
      "disabled-by-default-v8.cpu_profiler.hires",
      "latencyInfo",
      "loading",
      "toplevel",
      "v8",
      "v8.execute",
    ].join(","),
    options: "sampling-frequency=10000",
    transferMode: "ReturnAsStream",
  });

  return async () => {
    const traceComplete = new Promise<{ stream?: string }>((resolve) => {
      session.once("Tracing.tracingComplete", resolve);
    });
    await session.send("Tracing.end");
    const { stream } = await traceComplete;
    if (!stream) {
      throw new Error("Chromium completed tracing without returning a stream");
    }
    const chunks: Buffer[] = [];
    for (;;) {
      const chunk = await session.send("IO.read", { handle: stream });
      chunks.push(
        Buffer.from(
          chunk.data || "",
          chunk.base64Encoded ? "base64" : "utf8",
        ),
      );
      if (chunk.eof) break;
    }
    await session.send("IO.close", { handle: stream });
    await session.detach();
    writeFileSync(join(targetDir, "navigation-cpu-trace.json"), Buffer.concat(chunks));
  };
};

let browser: Browser | null = null;
let interruptedSignal: NodeJS.Signals | null = null;
const handleInterruption = (signal: NodeJS.Signals) => {
  interruptedSignal ??= signal;
  void browser?.close().catch(() => {});
};

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
  if (
    selectRunTargets(["--account-only"])
      .map(({ id }) => id)
      .join(",") !== "account"
  ) {
    throw new Error("Expected Account-only runs to select only Account");
  }
  if (
    selectRunTargets(["--profile-account-click"])
      .map(({ id }) => id)
      .join(",") !== "account"
  ) {
    throw new Error("Expected Account click profiles to select only Account");
  }
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
    !evaluateTargetActivation(TARGETS[0], [
      { ...baseFrame, activeScreen: "Market", elapsedMs: 500 },
      { ...baseFrame, elapsedMs: 1_000 },
    ]).passed
  ) {
    throw new Error(
      "Expected post-click frame sampling to stay separate from activation timing",
    );
  }
  if (
    evaluateTargetActivation(TARGETS[0], [
      { ...baseFrame, elapsedMs: 200 },
      {
        ...baseFrame,
        activeScreen: "Market",
        elapsedMs: 600,
        visibleScreenHosts: ["screen-host-market"],
      },
      { ...baseFrame, elapsedMs: 1_000 },
    ]).passed
  ) {
    throw new Error("Expected a post-activation screen bounce to fail");
  }
  const fastBrowserActivation = evaluateBrowserActivation({
    armedAt: 100,
    events: [
      { phase: "pointerdown", at: 200 },
      { phase: "target-commit", at: 350 },
      { phase: "target-frame", at: 400 },
    ],
  });
  if (!fastBrowserActivation.passed) {
    throw new Error("Expected a target frame within 500ms of pointerdown to pass");
  }
  if (
    evaluateBrowserActivation({
      armedAt: 100,
      events: [
        { phase: "pointerdown", at: 200 },
        { phase: "target-commit", at: 350 },
        { phase: "target-frame", at: 400 },
        {
          phase: "forbidden-loader-visible:screen-loading-account",
          at: 800,
        },
      ],
    }).passed
  ) {
    throw new Error(
      "Expected a forbidden loader observed after 500ms to fail browser activation",
    );
  }
  if (
    evaluateBrowserActivation({
      armedAt: 100,
      events: [
        { phase: "pointerdown", at: 200 },
        { phase: "target-commit", at: 350 },
        { phase: "target-frame", at: 400 },
        {
          phase: "post-activation-invalid",
          at: 600,
          activeScreen: "Market",
          visibleScreenHosts: ["screen-host-market"],
        },
      ],
    }).passed
  ) {
    throw new Error(
      "Expected a browser-observed post-activation screen bounce to fail",
    );
  }
  const slowBrowserActivation = evaluateBrowserActivation({
    armedAt: 100,
    events: [
      { phase: "pointerdown", at: 200 },
      { phase: "target-commit", at: 650 },
      { phase: "target-frame", at: 701 },
    ],
  });
  if (slowBrowserActivation.passed) {
    throw new Error("Expected a target frame after 500ms to fail");
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
        elapsedMs: SCREEN_CONTENT_LOADING_DEADLINE_MS,
        statusText: ["Loading exposure"],
        visibleTestIds: ["account-panel-loading-waits"],
      },
    ]).passed
  ) {
    throw new Error("Expected a lingering Account panel loader to fail");
  }
  if (
    evaluateTargetActivation(TARGETS[0], [
      baseFrame,
      {
        ...baseFrame,
        elapsedMs: SCREEN_CONTENT_LOADING_DEADLINE_MS,
        statusText: ["Loading cash activity"],
      },
    ]).passed
  ) {
    throw new Error("Expected a lingering Account cash loader to fail");
  }
  if (
    evaluateTargetActivation(TARGETS[1], [
      {
        ...baseFrame,
        activeScreen: "Algo",
        elapsedMs: SCREEN_CONTENT_LOADING_DEADLINE_MS,
        visibleScreenHosts: ["screen-host-algo"],
        visibleTestIds: ["algo-live-page-loading"],
      },
    ]).passed
  ) {
    throw new Error("Expected a lingering Algo content loader to fail");
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
  let browserClosedOnInterrupt = false;
  browser = {
    close: async () => {
      browserClosedOnInterrupt = true;
    },
  } as Browser;
  handleInterruption("SIGTERM");
  handleInterruption("SIGINT");
  await Promise.resolve();
  if (interruptedSignal !== "SIGTERM" || !browserClosedOnInterrupt) {
    throw new Error(
      "Expected the first interrupt to close the browser and unwind cleanup",
    );
  }
  console.log("Visual fallback harness self-test passed");
  process.exit(0);
}

process.on("SIGINT", handleInterruption);
process.on("SIGTERM", handleInterruption);

mkdirSync(OUTPUT_ROOT, { recursive: true });

const report: Record<string, unknown> = {
  appUrl: APP_URL,
  frameIntervalMs: FRAME_INTERVAL_MS,
  captureDurationMs: CAPTURE_DURATION_MS,
  viewport: { width: 1440, height: 900 },
  targets: {},
};
const activationFailures: string[] = [];
let qaUserId: string | null = null;
let runError: unknown = null;

try {
  browser = await chromium.launch({
    executablePath:
      process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  if (interruptedSignal) {
    throw new Error(`Visual-QA run interrupted by ${interruptedSignal}`);
  }
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
  if (interruptedSignal) {
    throw new Error(`Visual-QA run interrupted by ${interruptedSignal}`);
  }
  const qaSession = await createAuthSession({ userId: qaUser.id });

  for (const target of RUN_TARGETS) {
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
    if (MARKET_ONE_CHART) {
      await context.addInitScript(`(() => {
        const key = "pyrus:state:v1";
        let state = {};
        try {
          state = JSON.parse(window.localStorage.getItem(key) || "{}") || {};
        } catch {}
        window.localStorage.setItem(
          key,
          JSON.stringify({ ...state, marketGridLayout: "1x1" }),
        );
      })()`);
    }
    const page = await context.newPage();
    const pageOpenedAt = Date.now();
    const runtimeErrors: string[] = [];
    const apiIssues: Array<Record<string, unknown>> = [];
    const handlePageError = (error: Error) =>
      runtimeErrors.push(`pageerror: ${error.stack || error.message}`);
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
    await page.evaluate(`(() => {
      const targetId = ${JSON.stringify(target.id)};
      const targetLabel = ${JSON.stringify(target.label)};
      const expectedHost = "screen-host-" + targetId;
      const activationDeadlineMs = ${JSON.stringify(FRAME_INTERVAL_MS)};
      const captureDurationMs = ${JSON.stringify(CAPTURE_DURATION_MS)};
      const forbiddenLoadingTestIds = [
        "screen-loading-" + targetId,
        ...(targetId === "algo" ? ["algo-setup-loading"] : []),
      ];
      const timing = {
        armedAt: performance.now(),
        events: [],
      };
      window.__PYRUS_VISUAL_CLICK_TIMING__ = timing;
      const isElementVisible = (element) => {
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          element.getClientRects().length > 0
        );
      };
      const readVisibleScreenHosts = () =>
        Array.from(
          document.querySelectorAll('[data-testid^="screen-host-"]'),
        )
          .filter(isElementVisible)
          .map((element) => element.getAttribute("data-testid"))
          .filter(Boolean);
      let pointerDownAt = null;
      const recordedForbiddenLoaderIds = new Set();
      const recordForbiddenLoaders = () => {
        const observedAt = performance.now();
        if (
          pointerDownAt === null ||
          observedAt - pointerDownAt < activationDeadlineMs
        ) {
          return;
        }
        forbiddenLoadingTestIds.forEach((testId) => {
          if (recordedForbiddenLoaderIds.has(testId)) return;
          const element = document.querySelector(
            '[data-testid="' + testId + '"]',
          );
          if (!element || !isElementVisible(element)) return;
          recordedForbiddenLoaderIds.add(testId);
          timing.events.push({
            phase: "forbidden-loader-visible:" + testId,
            at: observedAt,
          });
        });
      };
      let targetCommitted = false;
      let targetFrameRecorded = false;
      let topologyFramePending = false;
      let targetFrameId = null;
      let topologyCheckFrameId = null;
      let topologyPollFrameId = null;
      let forbiddenLoaderPollFrameId = null;
      let probesClosed = false;
      let postActivationInvalidRecorded = false;
      const readTargetState = () => {
        const activeScreen = document
          .querySelector(
            '[data-testid="platform-screen-nav"] [aria-current="page"]',
          )
          ?.getAttribute("aria-label") ?? null;
        const visibleScreenHosts = readVisibleScreenHosts();
        return {
          activeScreen,
          visibleScreenHosts,
          matchesTarget:
            activeScreen === targetLabel &&
            visibleScreenHosts.length === 1 &&
            visibleScreenHosts[0] === expectedHost,
        };
      };
      const inspectPostActivationFrame = () => {
        if (probesClosed || postActivationInvalidRecorded) return;
        const state = readTargetState();
        if (state.matchesTarget) return;
        postActivationInvalidRecorded = true;
        timing.events.push({
          phase: "post-activation-invalid",
          at: performance.now(),
          activeScreen: state.activeScreen,
          visibleScreenHosts: state.visibleScreenHosts,
        });
      };
      const recordPostActivationFrame = () => {
        if (probesClosed || !targetFrameRecorded || topologyFramePending) return;
        topologyFramePending = true;
        topologyCheckFrameId = window.requestAnimationFrame(() => {
          topologyCheckFrameId = null;
          topologyFramePending = false;
          inspectPostActivationFrame();
        });
      };
      const pollPostActivationFrames = () => {
        if (probesClosed || postActivationInvalidRecorded) return;
        inspectPostActivationFrame();
        if (!postActivationInvalidRecorded) {
          topologyPollFrameId = window.requestAnimationFrame(
            pollPostActivationFrames,
          );
        }
      };
      const recordTargetCommit = () => {
        if (targetFrameRecorded) {
          recordPostActivationFrame();
          return;
        }
        if (targetCommitted) return;
        const state = readTargetState();
        if (!state.matchesTarget) return;
        targetCommitted = true;
        timing.events.push({ phase: "target-commit", at: performance.now() });
        targetFrameId = window.requestAnimationFrame(() => {
          targetFrameId = null;
          if (probesClosed) return;
          if (!readTargetState().matchesTarget) {
            targetCommitted = false;
            return;
          }
          targetFrameRecorded = true;
          timing.events.push({ phase: "target-frame", at: performance.now() });
          topologyPollFrameId = window.requestAnimationFrame(
            pollPostActivationFrames,
          );
        });
      };
      const nodeContainsScreenHost = (node) =>
        node instanceof Element &&
        (node.matches('[data-testid^="screen-host-"]') ||
          Boolean(node.querySelector('[data-testid^="screen-host-"]')));
      const handleTargetMutations = (records) => {
        if (!targetFrameRecorded) {
          recordTargetCommit();
          return;
        }
        const topologyChanged = records.some(
          (record) =>
            record.type === "attributes" ||
            [...record.addedNodes, ...record.removedNodes].some(
              nodeContainsScreenHost,
            ),
        );
        if (topologyChanged) {
          recordPostActivationFrame();
        }
      };
      const screenStack = document.querySelector(
        '[data-testid="platform-screen-stack"]',
      );
      const screenNav = document.querySelector(
        '[data-testid="platform-screen-nav"]',
      );
      const targetObserver = new MutationObserver(handleTargetMutations);
      if (screenStack) {
        targetObserver.observe(screenStack, {
          attributes: true,
          attributeFilter: ["aria-hidden"],
          childList: true,
          subtree: true,
        });
      }
      if (screenNav) {
        targetObserver.observe(screenNav, {
          attributes: true,
          attributeFilter: ["aria-current"],
          subtree: true,
        });
      }
      recordTargetCommit();
      document.addEventListener(
        "pointerdown",
        () => {
          pointerDownAt = performance.now();
          timing.events.push({ phase: "pointerdown", at: pointerDownAt });
          const forbiddenLoaderObserver = new MutationObserver(
            recordForbiddenLoaders,
          );
          forbiddenLoaderObserver.observe(screenStack || document.body, {
            attributes: true,
            attributeFilter: ["aria-hidden"],
            childList: true,
            subtree: true,
          });
          const pollForbiddenLoaders = () => {
            if (probesClosed) return;
            recordForbiddenLoaders();
            forbiddenLoaderPollFrameId = window.requestAnimationFrame(
              pollForbiddenLoaders,
            );
          };
          window.setTimeout(() => {
            if (probesClosed) return;
            recordForbiddenLoaders();
            forbiddenLoaderPollFrameId = window.requestAnimationFrame(
              pollForbiddenLoaders,
            );
          }, activationDeadlineMs);
          window.setTimeout(
            () => {
              probesClosed = true;
              targetObserver.disconnect();
              forbiddenLoaderObserver.disconnect();
              if (targetFrameId !== null) {
                window.cancelAnimationFrame(targetFrameId);
              }
              if (topologyCheckFrameId !== null) {
                window.cancelAnimationFrame(topologyCheckFrameId);
              }
              if (topologyPollFrameId !== null) {
                window.cancelAnimationFrame(topologyPollFrameId);
              }
              if (forbiddenLoaderPollFrameId !== null) {
                window.cancelAnimationFrame(forbiddenLoaderPollFrameId);
              }
            },
            captureDurationMs,
          );
        },
        { capture: true, once: true },
      );
      document.addEventListener(
        "click",
        () => {
          timing.events.push({
            phase: "click-capture",
            at: performance.now(),
          });
          window.requestAnimationFrame(() =>
            timing.events.push({
              phase: "animation-frame",
              at: performance.now(),
            }),
          );
          window.setTimeout(
            () =>
              timing.events.push({
                phase: "next-task",
                at: performance.now(),
              }),
            0,
          );
        },
        { capture: true, once: true },
      );
      document.addEventListener(
        "click",
        () =>
          timing.events.push({
            phase: "click-bubble",
            at: performance.now(),
          }),
        { once: true },
      );
    })()`);
    const startedAt = Date.now();
    const stopNavigationCpuTrace = PROFILE_NAVIGATION_CLICK
      ? await startNavigationCpuTrace(page, targetDir)
      : null;
    try {
      if (DIAGNOSE_ALGO_CLICK) {
      const clickProbePath = join(targetDir, "click-probe.json");
      const clickProbe = {
        requestedAt: new Date().toISOString(),
        preNavigationWarmupSnapshot,
        events: [] as Array<{
          phase: string;
          browserPerformanceNow: number;
          receivedAt: string;
        }>,
      };
      const persistClickProbe = () =>
        writeFileSync(clickProbePath, JSON.stringify(clickProbe, null, 2));
      persistClickProbe();
      await page.exposeFunction(
        "__pyrusVisualClickProbe",
        (phase: string, browserPerformanceNow: number) => {
          clickProbe.events.push({
            phase,
            browserPerformanceNow,
            receivedAt: new Date().toISOString(),
          });
          persistClickProbe();
        },
      );
      await nav.evaluate((button) => {
        window.setTimeout(() => {
          const notify = (
            window as Window & {
              __pyrusVisualClickProbe: (
                phase: string,
                browserPerformanceNow: number,
              ) => Promise<void>;
            }
          ).__pyrusVisualClickProbe;
          void notify("entered", performance.now());
          (button as HTMLButtonElement).click();
          void notify("returned", performance.now());
        }, 0);
      });
      await new Promise((resolve) => setTimeout(resolve, 45_000));
      if (!clickProbe.events.some((event) => event.phase === "returned")) {
        throw new Error(
          "Algo click probe did not observe the DOM click returning within 45 seconds",
        );
      }
      } else {
        await nav.click();
      }
    } finally {
      await stopNavigationCpuTrace?.();
    }
    const navigationActionDurationMs = Date.now() - startedAt;
    const pointerDownEpochMs = await page.evaluate(() => {
      const timing = (
        window as Window & {
          __PYRUS_VISUAL_CLICK_TIMING__?: BrowserClickTiming;
        }
      ).__PYRUS_VISUAL_CLICK_TIMING__;
      const pointerDownAt = timing?.events.find(
        (event) => event.phase === "pointerdown",
      )?.at;
      return pointerDownAt == null
        ? null
        : performance.timeOrigin + pointerDownAt;
    });
    if (pointerDownEpochMs === null) {
      throw new Error(`${target.label} navigation did not record pointerdown`);
    }

    const frames: Frame[] = [];
    let scheduledElapsedMs = 0;
    for (;;) {
      const scheduledAt = pointerDownEpochMs + scheduledElapsedMs;
      const waitMs = scheduledAt - Date.now();
      if (waitMs > 0) {
        await page.waitForTimeout(waitMs);
      }
      const elapsedMs = Date.now() - pointerDownEpochMs;
      frames.push(await captureFrame(page, target.id, elapsedMs));
      if (Date.now() - pointerDownEpochMs >= CAPTURE_DURATION_MS) break;
      scheduledElapsedMs =
        (Math.floor(elapsedMs / FRAME_INTERVAL_MS) + 1) * FRAME_INTERVAL_MS;
    }

    const afterNavigationScreenshotError = await page
      .screenshot({ path: join(targetDir, "after-navigation.png") })
      .then(() => null)
      .catch((error) =>
        error instanceof Error ? error.message : String(error),
      );
    if (afterNavigationScreenshotError) {
      activationFailures.push(
        `${target.id} screenshot: ${afterNavigationScreenshotError}`,
      );
    }
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
    const browserClickTiming = (await page.evaluate(() =>
      structuredClone(
        (
          window as Window & {
            __PYRUS_VISUAL_CLICK_TIMING__?: unknown;
          }
        ).__PYRUS_VISUAL_CLICK_TIMING__ ?? null,
      ),
    )) as BrowserClickTiming | null;
    page.off("pageerror", handlePageError);
    page.off("console", handleConsole);
    page.off("requestfailed", handleRequestFailed);
    page.off("response", handleResponse);
    const diagnostics = snapshotDiagnostics(runtimeErrors, apiIssues);
    const activation = evaluateTargetActivation(target, frames, finalText);
    const browserActivation = evaluateBrowserActivation(browserClickTiming);
    if (!activation.passed || !browserActivation.passed) {
      activationFailures.push(
        `${target.id}: ${JSON.stringify({ activation, browserActivation })}`,
      );
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
      navigationActionDurationMs,
      browserClickTiming,
      browserActivation,
      preNavigationWarmupSnapshot,
      postNavigationWarmupSnapshot,
      navigationModuleResources,
      afterNavigationScreenshotError,
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
  runError = interruptedSignal
    ? new Error(`Visual-QA run interrupted by ${interruptedSignal}`, {
        cause: error,
      })
    : error;
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
    () =>
      db
        .delete(shadowAccountsTable)
        .where(eq(shadowAccountsTable.appUserId, cleanupUserId)),
    () => db.delete(usersTable).where(eq(usersTable.id, cleanupUserId)),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    const [[remainingSession], [remainingShadowAccount], [remainingUser]] =
      await Promise.all([
        db
          .select({ id: authSessionsTable.id })
          .from(authSessionsTable)
          .where(eq(authSessionsTable.userId, cleanupUserId))
          .limit(1),
        db
          .select({ id: shadowAccountsTable.id })
          .from(shadowAccountsTable)
          .where(eq(shadowAccountsTable.appUserId, cleanupUserId))
          .limit(1),
        db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.id, cleanupUserId))
          .limit(1),
      ]);
    if (remainingSession || remainingShadowAccount || remainingUser) {
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

process.off("SIGINT", handleInterruption);
process.off("SIGTERM", handleInterruption);
if (interruptedSignal && !runError) {
  runError = new Error(`Visual-QA run interrupted by ${interruptedSignal}`);
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

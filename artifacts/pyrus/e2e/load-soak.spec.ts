import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const enabled = process.env.PYRUS_LOAD_SOAK === "1";
const soakMinutes = Math.max(
  1,
  Number.parseFloat(process.env.PYRUS_LOAD_SOAK_MINUTES || "10"),
);
const soakMs = Math.round(soakMinutes * 60_000);
const outputDir =
  process.env.PYRUS_LOAD_SOAK_OUTPUT_DIR ||
  join(tmpdir(), `pyrus-load-soak-${Date.now()}`);
const OPTIONAL_EXERCISE_TIMEOUT_MS = 2_000;
const DATA_READY_TIMEOUT_MS = 5_000;
const RETAINED_PRIMARY_SHELL_MAX_MS = 1_000;
const RETAINED_PRIMARY_SCREEN_IDS = new Set<ScreenId>([
  "market",
  "flow",
  "gex",
  "trade",
  "account",
  "algo",
  "backtest",
]);
const REQUEST_CANCELLATION_RE =
  /(?:net::)?ERR_ABORTED|NS_BINDING_ABORTED|aborted/i;

test.skip(!enabled, "Set PYRUS_LOAD_SOAK=1 to run the all-screen load soak.");
test.setTimeout(soakMs + 300_000);

type ScreenId =
  | "market"
  | "flow"
  | "gex"
  | "trade"
  | "account"
  | "research"
  | "algo"
  | "backtest"
  | "diagnostics"
  | "settings";

type ScreenDefinition = {
  id: ScreenId;
  label: string;
  readyTestId: string;
  settleMs: number;
};

type MetricSnapshot = {
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  recalcStyleMs: number;
  heapUsedMb: number;
  heapTotalMb: number;
  nodes: number;
  documents: number;
  jsEventListeners: number;
  longTaskCount: number;
  longTaskMs: number;
};

type ScreenStats = {
  id: ScreenId;
  label: string;
  visits: number;
  shellVisibleMs: number;
  maxShellVisibleMs: number;
  dataReadyCount: number;
  dataReadyMs: number;
  maxDataReadyMs: number;
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  recalcStyleMs: number;
  heapDeltaMb: number;
  maxHeapMb: number;
  maxNodes: number;
  maxJsEventListeners: number;
  longTaskCount: number;
  longTaskMs: number;
  requestCount: number;
  apiRequestCount: number;
  failedRequestCount: number;
  canceledRequestCount: number;
  response5xxCount: number;
  requestMs: number;
  maxVisitTaskMs: number;
  samples: Array<{
    cycle: number;
    shellVisibleMs: number;
    dataReady: boolean;
    dataReadyMs: number | null;
    taskMs: number;
    scriptMs: number;
    layoutMs: number;
    recalcStyleMs: number;
    heapDeltaMb: number;
    heapUsedMb: number;
    nodes: number;
    jsEventListeners: number;
    longTaskCount: number;
    longTaskMs: number;
    requestCount: number;
    apiRequestCount: number;
    failedRequestCount: number;
    canceledRequestCount: number;
    response5xxCount: number;
    requestMs: number;
  }>;
};

const screens: ScreenDefinition[] = [
  { id: "market", label: "Market", readyTestId: "market-workspace", settleMs: 4_000 },
  { id: "flow", label: "Flow", readyTestId: "flow-main-layout", settleMs: 4_000 },
  { id: "gex", label: "GEX", readyTestId: "gex-screen", settleMs: 4_000 },
  { id: "trade", label: "Trade", readyTestId: "trade-top-zone", settleMs: 5_000 },
  { id: "account", label: "Account", readyTestId: "account-screen", settleMs: 5_000 },
  { id: "research", label: "Research", readyTestId: "research-screen", settleMs: 4_000 },
  { id: "algo", label: "Algo", readyTestId: "algo-screen", settleMs: 4_000 },
  { id: "backtest", label: "Backtest", readyTestId: "backtest-workspace", settleMs: 4_000 },
  {
    id: "diagnostics",
    label: "Diagnostics",
    readyTestId: "diagnostics-screen",
    settleMs: 4_000,
  },
  { id: "settings", label: "Settings", readyTestId: "settings-screen", settleMs: 4_000 },
];

const metricValue = (metrics: Array<{ name: string; value: number }>, name: string) =>
  metrics.find((metric) => metric.name === name)?.value ?? 0;

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const logSoakProgress = (message: string) => {
  console.log(`[load-soak] ${new Date().toISOString()} ${message}`);
};

const emptyStats = (screen: ScreenDefinition): ScreenStats => ({
  id: screen.id,
  label: screen.label,
  visits: 0,
  shellVisibleMs: 0,
  maxShellVisibleMs: 0,
  dataReadyCount: 0,
  dataReadyMs: 0,
  maxDataReadyMs: 0,
  taskMs: 0,
  scriptMs: 0,
  layoutMs: 0,
  recalcStyleMs: 0,
  heapDeltaMb: 0,
  maxHeapMb: 0,
  maxNodes: 0,
  maxJsEventListeners: 0,
  longTaskCount: 0,
  longTaskMs: 0,
  requestCount: 0,
  apiRequestCount: 0,
  failedRequestCount: 0,
  canceledRequestCount: 0,
  response5xxCount: 0,
  requestMs: 0,
  maxVisitTaskMs: 0,
  samples: [],
});

async function installLongTaskObserver(page: Page) {
  await page.addInitScript(() => {
    const soakWindow = window as Window & {
      __PYRUS_LOAD_SOAK__?: {
        longTasks: Array<{ startTime: number; duration: number; name: string }>;
      };
    };
    soakWindow.__PYRUS_LOAD_SOAK__ = { longTasks: [] };
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          soakWindow.__PYRUS_LOAD_SOAK__?.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long-task timing is optional in Chromium contexts.
    }
  });
}

async function collectMetrics(page: Page): Promise<MetricSnapshot> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Performance.enable");
    const [performanceMetrics, heap, dom, longTaskSummary] = await Promise.all([
      session.send("Performance.getMetrics"),
      session.send("Runtime.getHeapUsage"),
      session.send("Memory.getDOMCounters"),
      page.evaluate(() => {
        const soakWindow = window as Window & {
          __PYRUS_LOAD_SOAK__?: {
            longTasks: Array<{ startTime: number; duration: number; name: string }>;
          };
        };
        const longTasks = soakWindow.__PYRUS_LOAD_SOAK__?.longTasks ?? [];
        return {
          count: longTasks.length,
          duration: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
        };
      }),
    ]);
    const metrics = performanceMetrics.metrics as Array<{ name: string; value: number }>;
    return {
      taskMs: metricValue(metrics, "TaskDuration") * 1_000,
      scriptMs: metricValue(metrics, "ScriptDuration") * 1_000,
      layoutMs: metricValue(metrics, "LayoutDuration") * 1_000,
      recalcStyleMs: metricValue(metrics, "RecalcStyleDuration") * 1_000,
      heapUsedMb: heap.usedSize / 1024 / 1024,
      heapTotalMb: heap.totalSize / 1024 / 1024,
      nodes: dom.nodes,
      documents: dom.documents,
      jsEventListeners: dom.jsEventListeners,
      longTaskCount: longTaskSummary.count,
      longTaskMs: longTaskSummary.duration,
    };
  } finally {
    await session.detach();
  }
}

function diffMetrics(before: MetricSnapshot, after: MetricSnapshot) {
  return {
    taskMs: Math.max(0, after.taskMs - before.taskMs),
    scriptMs: Math.max(0, after.scriptMs - before.scriptMs),
    layoutMs: Math.max(0, after.layoutMs - before.layoutMs),
    recalcStyleMs: Math.max(0, after.recalcStyleMs - before.recalcStyleMs),
    heapDeltaMb: after.heapUsedMb - before.heapUsedMb,
    longTaskCount: Math.max(0, after.longTaskCount - before.longTaskCount),
    longTaskMs: Math.max(0, after.longTaskMs - before.longTaskMs),
  };
}

function updateScreenStats(
  stats: ScreenStats,
  input: {
    cycle: number;
    navigation: {
      shellVisibleMs: number;
      dataReady: boolean;
      dataReadyMs: number | null;
    };
    before: MetricSnapshot;
    after: MetricSnapshot;
    requests: {
      requestCount: number;
      apiRequestCount: number;
      failedRequestCount: number;
      canceledRequestCount: number;
      response5xxCount: number;
      requestMs: number;
    };
  },
) {
  const delta = diffMetrics(input.before, input.after);
  stats.visits += 1;
  stats.shellVisibleMs += input.navigation.shellVisibleMs;
  stats.maxShellVisibleMs = Math.max(
    stats.maxShellVisibleMs,
    input.navigation.shellVisibleMs,
  );
  if (input.navigation.dataReady) {
    stats.dataReadyCount += 1;
    stats.dataReadyMs += input.navigation.dataReadyMs ?? 0;
    stats.maxDataReadyMs = Math.max(
      stats.maxDataReadyMs,
      input.navigation.dataReadyMs ?? 0,
    );
  }
  stats.taskMs += delta.taskMs;
  stats.scriptMs += delta.scriptMs;
  stats.layoutMs += delta.layoutMs;
  stats.recalcStyleMs += delta.recalcStyleMs;
  stats.heapDeltaMb += delta.heapDeltaMb;
  stats.maxHeapMb = Math.max(stats.maxHeapMb, input.after.heapUsedMb);
  stats.maxNodes = Math.max(stats.maxNodes, input.after.nodes);
  stats.maxJsEventListeners = Math.max(
    stats.maxJsEventListeners,
    input.after.jsEventListeners,
  );
  stats.longTaskCount += delta.longTaskCount;
  stats.longTaskMs += delta.longTaskMs;
  stats.requestCount += input.requests.requestCount;
  stats.apiRequestCount += input.requests.apiRequestCount;
  stats.failedRequestCount += input.requests.failedRequestCount;
  stats.canceledRequestCount += input.requests.canceledRequestCount;
  stats.response5xxCount += input.requests.response5xxCount;
  stats.requestMs += input.requests.requestMs;
  stats.maxVisitTaskMs = Math.max(stats.maxVisitTaskMs, delta.taskMs);
  stats.samples.push({
    cycle: input.cycle,
    shellVisibleMs: round(input.navigation.shellVisibleMs),
    dataReady: input.navigation.dataReady,
    dataReadyMs:
      input.navigation.dataReadyMs == null
        ? null
        : round(input.navigation.dataReadyMs),
    taskMs: round(delta.taskMs),
    scriptMs: round(delta.scriptMs),
    layoutMs: round(delta.layoutMs),
    recalcStyleMs: round(delta.recalcStyleMs),
    heapDeltaMb: round(delta.heapDeltaMb),
    heapUsedMb: round(input.after.heapUsedMb),
    nodes: input.after.nodes,
    jsEventListeners: input.after.jsEventListeners,
    longTaskCount: delta.longTaskCount,
    longTaskMs: round(delta.longTaskMs),
    requestCount: input.requests.requestCount,
    apiRequestCount: input.requests.apiRequestCount,
    failedRequestCount: input.requests.failedRequestCount,
    canceledRequestCount: input.requests.canceledRequestCount,
    response5xxCount: input.requests.response5xxCount,
    requestMs: round(input.requests.requestMs),
  });
}

async function openScreen(page: Page, screen: ScreenDefinition) {
  const startedAt = Date.now();
  const host = page.getByTestId(`screen-host-${screen.id}`);
  const hostMounted = (await host.count()) > 0;
  const isActive =
    hostMounted &&
    (await host
      .getAttribute("aria-hidden", { timeout: 250 })
      .catch(() => null)) === "false";
  const nav = page.getByTestId("platform-screen-nav");
  const navIndex = screens.findIndex((item) => item.id === screen.id);
  if (!isActive) {
    if (navIndex === -1) {
      throw new Error(`No nav index for ${screen.id}`);
    }
    await nav.getByRole("button").nth(navIndex).click({ timeout: 10_000 });
  }
  await expect(host).toHaveAttribute("aria-hidden", "false", { timeout: 30_000 });
  const shellVisibleMs = Date.now() - startedAt;
  let dataReady = false;
  let dataReadyMs: number | null = null;
  await expect(page.getByTestId(screen.readyTestId))
    .toBeVisible({ timeout: DATA_READY_TIMEOUT_MS })
    .then(() => {
      dataReady = true;
      dataReadyMs = Date.now() - startedAt;
    })
    .catch(() => undefined);
  return { shellVisibleMs, dataReady, dataReadyMs };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.split("\n")[0] || error.message;
  return String(error);
}

async function exerciseScreen(page: Page, screen: ScreenDefinition) {
  if (screen.id === "diagnostics") {
    await page
      .getByTestId("diagnostics-tab-memory")
      .click({ timeout: OPTIONAL_EXERCISE_TIMEOUT_MS })
      .catch(() => undefined);
    await page.waitForTimeout(400);
    await page
      .getByTestId("diagnostics-tab-overview")
      .click({ timeout: OPTIONAL_EXERCISE_TIMEOUT_MS })
      .catch(() => undefined);
  } else if (screen.id === "market") {
    await page
      .locator('[data-testid="watchlist-row"]')
      .first()
      .click({ timeout: OPTIONAL_EXERCISE_TIMEOUT_MS })
      .catch(() => undefined);
  } else if (screen.id === "account") {
    await page
      .getByTestId("account-section-shadow")
      .click({ timeout: OPTIONAL_EXERCISE_TIMEOUT_MS })
      .catch(() => undefined);
    await page.waitForTimeout(400);
    await page
      .getByTestId("account-section-real")
      .click({ timeout: OPTIONAL_EXERCISE_TIMEOUT_MS })
      .catch(() => undefined);
  } else if (screen.id === "settings") {
    await page
      .getByText(/IBKR|Lane|Runtime/i)
      .first()
      .click({ timeout: OPTIONAL_EXERCISE_TIMEOUT_MS })
      .catch(() => undefined);
  }
}

function makeMarkdownSummary(input: {
  startedAt: string;
  finishedAt: string;
  soakMinutes: number;
  cycles: number;
  ranked: ScreenStats[];
  errors: string[];
  apiErrors: string[];
}) {
  const rows = input.ranked
    .map(
      (stats, index) =>
        `| ${index + 1} | ${stats.label} | ${round(
          stats.shellVisibleMs / Math.max(1, stats.visits),
        )} | ${round(stats.maxShellVisibleMs)} | ${stats.dataReadyCount}/${stats.visits} | ${round(
          stats.dataReadyMs / Math.max(1, stats.dataReadyCount),
        )} | ${round(stats.taskMs)} | ${round(
          stats.taskMs / Math.max(1, stats.visits),
        )} | ${round(stats.scriptMs)} | ${round(stats.layoutMs + stats.recalcStyleMs)} | ${round(
          stats.longTaskMs,
        )} | ${round(stats.heapDeltaMb)} | ${stats.maxNodes} | ${stats.apiRequestCount} | ${stats.canceledRequestCount} |`,
    )
    .join("\n");
  const slowShellSamples = input.ranked.flatMap((stats) =>
    stats.samples
      .filter(
        (sample) =>
          RETAINED_PRIMARY_SCREEN_IDS.has(stats.id) &&
          sample.shellVisibleMs > RETAINED_PRIMARY_SHELL_MAX_MS,
      )
      .map(
        (sample) =>
          `- ${stats.label} cycle ${sample.cycle}: shell ${sample.shellVisibleMs}ms, data ${
            sample.dataReadyMs ?? "pending"
          }ms, long tasks ${sample.longTaskMs}ms, DOM nodes ${sample.nodes}`,
      ),
  );

  return [
    "# PYRUS Load Soak",
    "",
    `Started: ${input.startedAt}`,
    `Finished: ${input.finishedAt}`,
    `Duration: ${input.soakMinutes} minutes`,
    `Cycles: ${input.cycles}`,
    "",
    "| Rank | Screen | Avg Shell ms | Max Shell ms | Data Ready | Avg Data ms | Total Task ms | Avg Task ms/visit | Script ms | Layout+Style ms | Long Task ms | Heap Delta MB | Max DOM Nodes | API Requests | Canceled Requests |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    rows,
    "",
    "Errors:",
    ...(input.errors.length ? input.errors.map((error) => `- ${error}`) : ["- None"]),
    "",
    `Slow Shell Samples (>${RETAINED_PRIMARY_SHELL_MAX_MS}ms retained primary routes):`,
    ...(slowShellSamples.length ? slowShellSamples : ["- None"]),
    "",
    "API/Data Errors:",
    ...(input.apiErrors.length
      ? input.apiErrors.map((error) => `- ${error}`)
      : ["- None"]),
    "",
  ].join("\n");
}

async function writeSummary(
  summary: unknown,
  markdown: string,
  testInfo: TestInfo,
) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "load-soak-summary.json");
  const markdownPath = join(outputDir, "load-soak-summary.md");
  await writeFile(jsonPath, JSON.stringify(summary, null, 2));
  await writeFile(markdownPath, markdown);
  await testInfo.attach("load-soak-summary.json", {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach("load-soak-summary.md", {
    path: markdownPath,
    contentType: "text/markdown",
  });
  console.log(`Load soak summary: ${markdownPath}`);
}

test("profiles browser load while cycling every primary screen", async ({
  page,
}, testInfo) => {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const apiErrors: string[] = [];
  const requestStart = new WeakMap<Request, { screen: ScreenId | "boot"; startedAt: number }>();
  const requestBuckets = new Map<
    ScreenId | "boot",
    {
      requestCount: number;
      apiRequestCount: number;
      failedRequestCount: number;
      canceledRequestCount: number;
      response5xxCount: number;
      requestMs: number;
    }
  >();
  const stats = new Map<ScreenId, ScreenStats>(
    screens.map((screen) => [screen.id, emptyStats(screen)]),
  );
  let activeScreen: ScreenId | "boot" = "boot";
  let crashed = false;

  const requestBucket = (screen: ScreenId | "boot") => {
    const bucket =
      requestBuckets.get(screen) ?? {
        requestCount: 0,
        apiRequestCount: 0,
        failedRequestCount: 0,
        canceledRequestCount: 0,
        response5xxCount: 0,
        requestMs: 0,
      };
    requestBuckets.set(screen, bucket);
    return bucket;
  };
  const snapshotBucket = (screen: ScreenId) => ({ ...requestBucket(screen) });
  const diffBucket = (
    before: ReturnType<typeof snapshotBucket>,
    after: ReturnType<typeof snapshotBucket>,
  ) => ({
    requestCount: after.requestCount - before.requestCount,
    apiRequestCount: after.apiRequestCount - before.apiRequestCount,
    failedRequestCount: after.failedRequestCount - before.failedRequestCount,
    canceledRequestCount: after.canceledRequestCount - before.canceledRequestCount,
    response5xxCount: after.response5xxCount - before.response5xxCount,
    requestMs: after.requestMs - before.requestMs,
  });

  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("crash", () => {
    crashed = true;
    errors.push("Chrome page crashed");
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to load resource")) return;
    errors.push(text);
  });
  page.on("request", (request) => {
    requestStart.set(request, { screen: activeScreen, startedAt: Date.now() });
  });
  page.on("requestfailed", (request) => {
    const meta = requestStart.get(request) ?? { screen: activeScreen, startedAt: Date.now() };
    const bucket = requestBucket(meta.screen);
    const failureText = request.failure()?.errorText ?? "";
    if (REQUEST_CANCELLATION_RE.test(failureText)) {
      bucket.canceledRequestCount += 1;
      return;
    }
    bucket.failedRequestCount += 1;
    const message = `request failed on ${meta.screen}: ${request.method()} ${request.url()} ${
      failureText
    }`.trim();
    if (request.url().includes("/api/")) {
      apiErrors.push(message);
    } else {
      errors.push(message);
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    const meta = requestStart.get(request) ?? { screen: activeScreen, startedAt: Date.now() };
    const bucket = requestBucket(meta.screen);
    const url = response.url();
    bucket.requestCount += 1;
    bucket.requestMs += Math.max(0, Date.now() - meta.startedAt);
    if (url.includes("/api/")) {
      bucket.apiRequestCount += 1;
    }
    if (response.status() >= 500) {
      bucket.response5xxCount += 1;
      const message = `HTTP ${response.status()} on ${meta.screen}: ${request.method()} ${url}`;
      if (url.includes("/api/")) {
        apiErrors.push(message);
      } else {
        errors.push(message);
      }
    }
  });

  await installLongTaskObserver(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "pyrus:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        sidebarCollapsed: true,
        marketGridLayout: "3x3",
      }),
    );
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("market-workspace")).toBeVisible({ timeout: 30_000 });
  logSoakProgress("boot market visible");

  const deadline = Date.now() + soakMs;
  let cycle = 0;
  while (Date.now() < deadline) {
    cycle += 1;
    for (const screen of screens) {
      if (Date.now() >= deadline || crashed) break;
      activeScreen = screen.id;
      try {
        logSoakProgress(`cycle ${cycle} ${screen.id} start`);
        const requestBefore = snapshotBucket(screen.id);
        const before = await collectMetrics(page);
        logSoakProgress(`cycle ${cycle} ${screen.id} metrics before`);
        const navigation = await openScreen(page, screen);
        logSoakProgress(
          `cycle ${cycle} ${screen.id} shell visible ${round(navigation.shellVisibleMs)}ms data ${navigation.dataReady ? `${round(navigation.dataReadyMs ?? 0)}ms` : "pending"}`,
        );
        await exerciseScreen(page, screen);
        await page.waitForTimeout(screen.settleMs);
        logSoakProgress(`cycle ${cycle} ${screen.id} settled`);
        const after = await collectMetrics(page);
        logSoakProgress(`cycle ${cycle} ${screen.id} metrics after`);
        const requestAfter = snapshotBucket(screen.id);
        updateScreenStats(stats.get(screen.id)!, {
          cycle,
          navigation,
          before,
          after,
          requests: diffBucket(requestBefore, requestAfter),
        });
      } catch (error) {
        errors.push(`screen ${screen.id}: ${errorMessage(error)}`);
      }
    }
    if (crashed) break;
  }

  const finishedAt = new Date().toISOString();
  const ranked = [...stats.values()]
    .map((entry) => ({
      ...entry,
      shellVisibleMs: round(entry.shellVisibleMs),
      maxShellVisibleMs: round(entry.maxShellVisibleMs),
      dataReadyMs: round(entry.dataReadyMs),
      maxDataReadyMs: round(entry.maxDataReadyMs),
      taskMs: round(entry.taskMs),
      scriptMs: round(entry.scriptMs),
      layoutMs: round(entry.layoutMs),
      recalcStyleMs: round(entry.recalcStyleMs),
      heapDeltaMb: round(entry.heapDeltaMb),
      maxHeapMb: round(entry.maxHeapMb),
      longTaskMs: round(entry.longTaskMs),
      requestMs: round(entry.requestMs),
      maxVisitTaskMs: round(entry.maxVisitTaskMs),
    }))
    .sort(
      (left, right) =>
        right.maxShellVisibleMs - left.maxShellVisibleMs ||
        right.taskMs - left.taskMs,
    );
  for (const entry of ranked) {
    if (
      RETAINED_PRIMARY_SCREEN_IDS.has(entry.id) &&
      entry.maxShellVisibleMs > RETAINED_PRIMARY_SHELL_MAX_MS
    ) {
      errors.push(
        `${entry.label} shell max ${entry.maxShellVisibleMs}ms exceeded ${RETAINED_PRIMARY_SHELL_MAX_MS}ms retained-route budget`,
      );
    }
  }
  const summary = {
    startedAt,
    finishedAt,
    soakMinutes,
    cycles: cycle,
    outputDir,
    ranked,
    byScreen: Object.fromEntries(ranked.map((entry) => [entry.id, entry])),
    bootRequests: requestBucket("boot"),
    errors: [...new Set(errors)],
    apiErrors: [...new Set(apiErrors)],
  };
  const markdown = makeMarkdownSummary({
    startedAt,
    finishedAt,
    soakMinutes,
    cycles: cycle,
    ranked,
    errors: summary.errors,
    apiErrors: summary.apiErrors,
  });

  await writeSummary(summary, markdown, testInfo);
  console.log(markdown);

  expect(crashed, "Chrome page should not crash during the load soak").toBe(false);
  expect(summary.errors, "Load soak should not record shell/page errors").toEqual([]);
});

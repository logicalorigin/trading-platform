import {
  expect,
  test,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";

const readIntegerEnv = (name: string, fallback: number) => {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const SAFE_QA_PERF_RUNS = Math.max(
  1,
  readIntegerEnv("PYRUS_SAFE_QA_PERF_RUNS", 3),
);

test.setTimeout(
  Math.max(
    60_000,
    readIntegerEnv("PYRUS_SAFE_QA_PERF_TIMEOUT_MS", 180_000) *
      SAFE_QA_PERF_RUNS,
  ),
);

type ScreenId =
  | "market"
  | "signals"
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
};

type RequestRecord = {
  runIndex: number;
  screen: ScreenId | "boot";
  completedScreen: ScreenId | "boot";
  method: string;
  url: string;
  path: string;
  resourceType: string;
  status: number | null;
  failed: boolean;
  failureText: string | null;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
};

type LongTaskRecord = {
  startTime: number;
  duration: number;
  name: string;
};

type RouteDataTimingRecord = {
  screenId: string;
  stage: string;
  source: string;
  durationMs: number;
  startedAtMs: number;
  observedAtMs: number;
  observedAt: string;
  detail: Record<string, unknown>;
};

type ClientMetricSnapshot = {
  longTasks: LongTaskRecord[];
  routeDataTimings: RouteDataTimingRecord[];
};

type ScreenModulePreloadEntry = {
  status?: string;
  startedAt?: number | null;
  completedAt?: number | null;
  label?: string;
  error?: string;
};

type ScreenModulePreloadSnapshot = Record<string, ScreenModulePreloadEntry>;

type WarmupSnapshot = {
  screenModulePreloads?: ScreenModulePreloadSnapshot;
  timelineMs?: Record<string, number>;
  queues?: Record<string, unknown>;
};

type WarmupSnapshotSummary = {
  screenModulePreloadCount: number;
  queueKeys: string[];
  timelineMs: Record<string, number>;
};

type DominantRouteReason =
  | "within-budget"
  | "route-chunk-not-ready"
  | "main-thread-long-task"
  | "slow-api-after-host"
  | "post-host-ready-lag"
  | "navigation-host-delay";

type RouteAttribution = {
  runIndex: number;
  previousScreen: ScreenId | "boot";
  routeStartedAtMs: number;
  routeEndedAtMs: number;
  preloadBefore: ScreenModulePreloadEntry | null;
  preloadAfter: ScreenModulePreloadEntry | null;
  warmupBefore: WarmupSnapshotSummary;
  warmupAfter: WarmupSnapshotSummary;
  slowApiRequests: string[];
  longTaskTotalMs: number;
  maxLongTaskMs: number;
  routeDataStages: string[];
  dominantReason: DominantRouteReason;
};

type ScreenResult = {
  runIndex: number;
  id: ScreenId;
  label: string;
  previousScreen: ScreenId | "boot";
  routeStartedAtMs: number;
  routeEndedAtMs: number;
  hostVisibleMs: number;
  readyMs: number;
  requestCount: number;
  apiRequestCount: number;
  slowApiCount: number;
  slowApiRequests: string[];
  longTaskCount: number;
  longTaskTotalMs: number;
  maxLongTaskMs: number;
  routeDataStages: string[];
  attribution: RouteAttribution;
};

type BudgetViolation = {
  runIndex: number;
  screenId: ScreenId;
  metric: "hostVisibleMs" | "maxLongTaskMs";
  actualMs: number;
  budgetMs: number;
  previousScreen: ScreenId | "boot";
  dominantReason: DominantRouteReason;
  preloadBeforeStatus: string;
  slowApiRequests: string[];
  routeDataStages: string[];
};

type RepeatedBudgetFinding = {
  screenId: ScreenId;
  metric: BudgetViolation["metric"];
  occurrences: number;
  runIndexes: number[];
  budgetMs: number;
  maxActualMs: number;
  dominantReasons: DominantRouteReason[];
  preloadBeforeStatuses: string[];
};

type LiveLeakRecord = {
  screen: ScreenId | "boot";
  method: string;
  path: string;
  status: number | null;
  label: string;
};

type BadResponseRecord = {
  screen: ScreenId | "boot";
  method: string;
  path: string;
  status: number | null;
  failureText: string | null;
};

const STORAGE_KEY = "pyrus:state:v1";
const ROUTE_DATA_TIMING_EVENT = "pyrus:route-data-timing";
const SCREEN_SEQUENCE_ENV = "PYRUS_SAFE_QA_PERF_SCREEN_SEQUENCE";
const REQUEST_CANCELLATION_RE =
  /(?:net::)?ERR_ABORTED|NS_BINDING_ABORTED|aborted/i;
const SLOW_API_MS = Math.max(250, readIntegerEnv("PYRUS_SAFE_QA_SLOW_API_MS", 1_000));
const ENFORCE_BUDGETS =
  process.env.PYRUS_SAFE_QA_PERF_ENFORCE_BUDGETS === "1";
const REPEATED_BUDGET_OCCURRENCE_THRESHOLD =
  SAFE_QA_PERF_RUNS > 1 ? 2 : 1;

const screens: ScreenDefinition[] = [
  { id: "market", label: "Market", readyTestId: "market-workspace" },
  { id: "signals", label: "Signals", readyTestId: "signals-screen" },
  { id: "flow", label: "Flow", readyTestId: "flow-main-layout" },
  { id: "gex", label: "GEX", readyTestId: "gex-screen" },
  { id: "trade", label: "Trade", readyTestId: "trade-top-zone" },
  { id: "account", label: "Account", readyTestId: "account-screen" },
  { id: "research", label: "Research", readyTestId: "research-screen" },
  { id: "algo", label: "Algo", readyTestId: "algo-screen" },
  { id: "backtest", label: "Backtest", readyTestId: "backtest-workspace" },
  { id: "diagnostics", label: "Diagnostics", readyTestId: "diagnostics-screen" },
  { id: "settings", label: "Settings", readyTestId: "settings-screen" },
];

const screensById = new Map<ScreenId, ScreenDefinition>(
  screens.map((screen) => [screen.id, screen]),
);

function resolveScreenSequence() {
  const rawSequence = process.env[SCREEN_SEQUENCE_ENV]?.trim();
  if (!rawSequence) {
    return screens;
  }

  const screenIds = rawSequence
    .split(/[,\s]+/)
    .map((screenId) => screenId.trim().toLowerCase())
    .filter(Boolean);
  if (!screenIds.length) {
    return screens;
  }

  return screenIds.map((screenId) => {
    const screen = screensById.get(screenId as ScreenId);
    if (!screen) {
      throw new Error(
        `${SCREEN_SEQUENCE_ENV} contains unknown screen "${screenId}". Valid screens: ${screens
          .map(({ id }) => id)
          .join(", ")}`,
      );
    }
    return screen;
  });
}

const screenSequence = resolveScreenSequence();

const defaultBudgets: Record<
  ScreenId,
  { hostVisibleMs: number; maxLongTaskMs: number }
> = {
  market: { hostVisibleMs: 700, maxLongTaskMs: 300 },
  signals: { hostVisibleMs: 900, maxLongTaskMs: 300 },
  flow: { hostVisibleMs: 900, maxLongTaskMs: 300 },
  gex: { hostVisibleMs: 900, maxLongTaskMs: 300 },
  trade: { hostVisibleMs: 700, maxLongTaskMs: 300 },
  account: { hostVisibleMs: 700, maxLongTaskMs: 300 },
  research: { hostVisibleMs: 900, maxLongTaskMs: 300 },
  algo: { hostVisibleMs: 900, maxLongTaskMs: 300 },
  backtest: { hostVisibleMs: 900, maxLongTaskMs: 300 },
  diagnostics: { hostVisibleMs: 900, maxLongTaskMs: 300 },
  settings: { hostVisibleMs: 700, maxLongTaskMs: 300 },
};

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const parsePath = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const sanitizeScreenModulePreloadEntry = (
  value: unknown,
): ScreenModulePreloadEntry | null => {
  if (!isRecord(value)) return null;

  return {
    status: typeof value.status === "string" ? value.status : undefined,
    startedAt:
      typeof value.startedAt === "number" || value.startedAt === null
        ? value.startedAt
        : undefined,
    completedAt:
      typeof value.completedAt === "number" || value.completedAt === null
        ? value.completedAt
        : undefined,
    label: typeof value.label === "string" ? value.label : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
  };
};

const getPreloadEntry = (
  snapshot: WarmupSnapshot | null,
  screenId: ScreenId,
): ScreenModulePreloadEntry | null =>
  sanitizeScreenModulePreloadEntry(snapshot?.screenModulePreloads?.[screenId]);

const summarizeWarmupSnapshot = (
  snapshot: WarmupSnapshot | null,
): WarmupSnapshotSummary => ({
  screenModulePreloadCount: Object.keys(snapshot?.screenModulePreloads ?? {})
    .length,
  queueKeys: Object.keys(snapshot?.queues ?? {}).sort(),
  timelineMs: Object.entries(snapshot?.timelineMs ?? {}).reduce<
    Record<string, number>
  >((acc, [key, value]) => {
    if (typeof value === "number") {
      acc[key] = round(value);
    }
    return acc;
  }, {}),
});

async function installSafeQaBootState(page: Page) {
  await page.addInitScript(
    ({ routeDataTimingEvent, storageKey }) => {
      type SafeQaPerfWindow = Window & {
        __PYRUS_SAFE_QA_ROUTE_PERF__?: ClientMetricSnapshot;
      };

      const perfWindow = window as SafeQaPerfWindow;
      perfWindow.__PYRUS_SAFE_QA_ROUTE_PERF__ = {
        longTasks: [],
        routeDataTimings: [],
      };

      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          screen: "market",
          sym: "SPY",
          sidebarCollapsed: true,
          activitySidebarCollapsed: true,
          marketGridLayout: "3x3",
        }),
      );

      const pushBounded = <T>(target: T[], value: T, max = 400) => {
        target.push(value);
        if (target.length > max) {
          target.splice(0, target.length - max);
        }
      };

      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            pushBounded(perfWindow.__PYRUS_SAFE_QA_ROUTE_PERF__!.longTasks, {
              startTime: entry.startTime,
              duration: entry.duration,
              name: entry.name || "longtask",
            });
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        // Long-task entries are optional in Chromium contexts.
      }

      window.addEventListener(routeDataTimingEvent, (event) => {
        const detail = (event as CustomEvent).detail;
        if (!detail || typeof detail !== "object") return;
        pushBounded(
          perfWindow.__PYRUS_SAFE_QA_ROUTE_PERF__!.routeDataTimings,
          detail as RouteDataTimingRecord,
        );
      });
    },
    { routeDataTimingEvent: ROUTE_DATA_TIMING_EVENT, storageKey: STORAGE_KEY },
  );
}

async function readClientMetricSnapshot(
  page: Page,
): Promise<ClientMetricSnapshot> {
  return page.evaluate(() => {
    type SafeQaPerfWindow = Window & {
      __PYRUS_SAFE_QA_ROUTE_PERF__?: ClientMetricSnapshot;
    };

    return (
      (window as SafeQaPerfWindow).__PYRUS_SAFE_QA_ROUTE_PERF__ ?? {
        longTasks: [],
        routeDataTimings: [],
      }
    );
  });
}

async function safeReadClientMetricSnapshot(
  page: Page,
): Promise<ClientMetricSnapshot> {
  return readClientMetricSnapshot(page).catch(() => ({
    longTasks: [],
    routeDataTimings: [],
  }));
}

async function readWarmupSnapshot(page: Page): Promise<WarmupSnapshot | null> {
  const snapshot = await page
    .evaluate(() => {
      type WarmupWindow = Window & {
        __PYRUS_PERF_WARMUP_SNAPSHOT__?: unknown;
      };

      return (
        (window as WarmupWindow).__PYRUS_PERF_WARMUP_SNAPSHOT__ ?? null
      );
    })
    .catch(() => null);

  if (!isRecord(snapshot)) return null;

  const screenModulePreloads = isRecord(snapshot.screenModulePreloads)
    ? Object.entries(snapshot.screenModulePreloads).reduce<
        ScreenModulePreloadSnapshot
      >((acc, [screenId, value]) => {
        const entry = sanitizeScreenModulePreloadEntry(value);
        if (entry) {
          acc[screenId] = entry;
        }
        return acc;
      }, {})
    : undefined;
  const timelineMs = isRecord(snapshot.timelineMs)
    ? Object.entries(snapshot.timelineMs).reduce<Record<string, number>>(
        (acc, [key, value]) => {
          if (typeof value === "number") {
            acc[key] = value;
          }
          return acc;
        },
        {},
      )
    : undefined;

  return {
    screenModulePreloads,
    timelineMs,
    queues: isRecord(snapshot.queues) ? snapshot.queues : undefined,
  };
}

function installRequestTracker(page: Page) {
  let activeScreen: ScreenId | "boot" = "boot";
  let activeRunIndex = 0;
  const navigationStartedAt = Date.now();
  const starts = new WeakMap<
    Request,
    { runIndex: number; screen: ScreenId | "boot"; startedAt: number }
  >();
  const requests: RequestRecord[] = [];
  const pendingRecords = new Set<Promise<void>>();

  const recordRequest = async (
    request: Request,
    failed: boolean,
    failureText: string | null,
  ) => {
    const start = starts.get(request) ?? {
      runIndex: activeRunIndex,
      screen: activeScreen,
      startedAt: Date.now(),
    };
    const finishedAt = Date.now();
    const url = request.url();
    const response = failed ? null : await request.response().catch(() => null);

    requests.push({
      runIndex: start.runIndex,
      screen: start.screen,
      completedScreen: activeScreen,
      method: request.method(),
      url,
      path: parsePath(url),
      resourceType: request.resourceType(),
      status: response?.status() ?? null,
      failed,
      failureText,
      startedAtMs: start.startedAt - navigationStartedAt,
      finishedAtMs: finishedAt - navigationStartedAt,
      durationMs: finishedAt - start.startedAt,
    });
  };

  const trackRecord = (promise: Promise<void>) => {
    pendingRecords.add(promise);
    void promise.finally(() => pendingRecords.delete(promise));
  };

  page.on("request", (request) => {
    starts.set(request, {
      runIndex: activeRunIndex,
      screen: activeScreen,
      startedAt: Date.now(),
    });
  });
  page.on("requestfinished", (request) => {
    trackRecord(recordRequest(request, false, null));
  });
  page.on("requestfailed", (request) => {
    const failureText = request.failure()?.errorText || "failed";
    if (REQUEST_CANCELLATION_RE.test(failureText)) return;
    trackRecord(recordRequest(request, true, failureText));
  });

  return {
    requests,
    elapsedMs() {
      return Date.now() - navigationStartedAt;
    },
    setActiveScreen(screen: ScreenId | "boot") {
      activeScreen = screen;
    },
    setRunIndex(runIndex: number) {
      activeRunIndex = runIndex;
    },
    async flush() {
      await Promise.allSettled(Array.from(pendingRecords));
    },
  };
}

async function waitForDesktopNavigation(page: Page) {
  await expect(page.getByTestId("platform-screen-nav")).toBeVisible({
    timeout: 30_000,
  });
}

async function navigateToScreen(page: Page, screen: ScreenDefinition) {
  await page
    .getByTestId("platform-screen-nav")
    .getByRole("button", { name: new RegExp(`^${screen.label}`) })
    .click({ timeout: 10_000 });
}

async function openScreen(page: Page, screen: ScreenDefinition) {
  const startedAt = Date.now();
  const host = page.getByTestId(`screen-host-${screen.id}`);
  const isMounted = (await host.count()) > 0;
  const isActive =
    isMounted &&
    (await host.getAttribute("aria-hidden", { timeout: 250 }).catch(() => null)) ===
      "false";

  if (!isActive) {
    await navigateToScreen(page, screen);
  }

  await expect(host).toHaveAttribute("aria-hidden", "false", {
    timeout: 30_000,
  });
  const hostVisibleMs = Date.now() - startedAt;
  await expect(host.getByTestId(screen.readyTestId).first()).toBeVisible({
    timeout: 30_000,
  });
  const readyMs = Date.now() - startedAt;

  return {
    hostVisibleMs,
    readyMs,
  };
}

function summarizeRouteMetrics({
  runIndex,
  screen,
  requests,
  clientMetrics,
  routeStartedAtMs,
  routeEndedAtMs,
}: {
  runIndex: number;
  screen: ScreenDefinition;
  requests: RequestRecord[];
  clientMetrics: ClientMetricSnapshot;
  routeStartedAtMs: number;
  routeEndedAtMs: number;
}) {
  const routeRequests = requests.filter(
    (request) =>
      request.runIndex === runIndex &&
      (request.screen === screen.id || request.completedScreen === screen.id),
  );
  const apiRequests = routeRequests.filter((request) =>
    request.path.startsWith("/api/"),
  );
  const slowApiRequests = apiRequests
    .filter((request) => request.durationMs >= SLOW_API_MS || request.failed)
    .map((request) => {
      const status = request.status ?? (request.failed ? "failed" : "pending");
      return `${request.method} ${request.path} ${status} ${round(
        request.durationMs,
      )}ms`;
    });
  const longTasks = clientMetrics.longTasks.filter(
    (entry) =>
      entry.startTime >= routeStartedAtMs && entry.startTime <= routeEndedAtMs,
  );
  const routeDataTimings = clientMetrics.routeDataTimings.filter(
    (entry) =>
      entry.screenId === screen.id &&
      entry.observedAtMs >= routeStartedAtMs &&
      entry.observedAtMs <= routeEndedAtMs,
  );

  return {
    requestCount: routeRequests.length,
    apiRequestCount: apiRequests.length,
    slowApiRequests,
    longTaskCount: longTasks.length,
    longTaskTotalMs: round(
      longTasks.reduce((sum, entry) => sum + entry.duration, 0),
    ),
    maxLongTaskMs: round(
      longTasks.reduce((max, entry) => Math.max(max, entry.duration), 0),
    ),
    routeDataStages: Array.from(
      new Set(
        routeDataTimings.map(
          (entry) =>
            `${entry.source}:${entry.stage}:${Math.round(
              entry.durationMs,
            )}ms`,
        ),
      ),
    ).slice(0, 8),
  };
}

function classifyRouteAttribution({
  screen,
  hostVisibleMs,
  readyMs,
  preloadBefore,
  slowApiRequests,
  longTaskTotalMs,
  maxLongTaskMs,
}: {
  screen: ScreenDefinition;
  hostVisibleMs: number;
  readyMs: number;
  preloadBefore: ScreenModulePreloadEntry | null;
  slowApiRequests: string[];
  longTaskTotalMs: number;
  maxLongTaskMs: number;
}): DominantRouteReason {
  const budget = defaultBudgets[screen.id];
  const postHostReadyLagMs = readyMs - hostVisibleMs;
  const preloadStatus = preloadBefore?.status ?? "missing";

  if (hostVisibleMs > budget.hostVisibleMs && preloadStatus !== "ready") {
    return "route-chunk-not-ready";
  }
  if (
    maxLongTaskMs > budget.maxLongTaskMs ||
    longTaskTotalMs > Math.max(300, budget.maxLongTaskMs)
  ) {
    return "main-thread-long-task";
  }
  if (slowApiRequests.length > 0 && postHostReadyLagMs > 1_000) {
    return "slow-api-after-host";
  }
  if (postHostReadyLagMs > 1_000) {
    return "post-host-ready-lag";
  }
  if (hostVisibleMs > budget.hostVisibleMs) {
    return "navigation-host-delay";
  }

  return "within-budget";
}

function detectLiveLeak(request: RequestRecord): LiveLeakRecord | null {
  if (!request.path.startsWith("/api/")) return null;

  let url: URL | null = null;
  try {
    url = new URL(request.url);
  } catch {
    url = null;
  }

  if (request.path === "/api/positions") {
    return { ...request, label: "root positions endpoint" };
  }
  if (request.path === "/api/orders") {
    return { ...request, label: "root orders endpoint" };
  }
  if (request.path === "/api/executions") {
    return { ...request, label: "root executions endpoint" };
  }
  if (/^\/api\/accounts\/[^/]+\/positions(?:\/|$)/.test(request.path)) {
    return { ...request, label: "account positions endpoint" };
  }
  if (
    request.path === "/api/signal-monitor/profile" &&
    url?.searchParams.get("environment")?.toLowerCase() === "live"
  ) {
    return { ...request, label: "live signal-monitor profile" };
  }

  return null;
}

function findBadResponses(requests: RequestRecord[]): BadResponseRecord[] {
  return requests
    .filter((request) => request.path !== "/favicon.ico")
    .filter(
      (request) =>
        request.failed ||
        (typeof request.status === "number" && request.status >= 400),
    )
    .map((request) => ({
      screen: request.screen,
      method: request.method,
      path: request.path,
      status: request.status,
      failureText: request.failureText,
    }));
}

function findBudgetViolations(results: ScreenResult[]): BudgetViolation[] {
  return results.flatMap((result) => {
    const budget = defaultBudgets[result.id];
    const violations: BudgetViolation[] = [];
    const baseViolation = {
      runIndex: result.runIndex,
      screenId: result.id,
      previousScreen: result.previousScreen,
      dominantReason: result.attribution.dominantReason,
      preloadBeforeStatus: result.attribution.preloadBefore?.status ?? "missing",
      slowApiRequests: result.slowApiRequests,
      routeDataStages: result.routeDataStages,
    };

    if (result.hostVisibleMs > budget.hostVisibleMs) {
      violations.push({
        ...baseViolation,
        metric: "hostVisibleMs",
        actualMs: result.hostVisibleMs,
        budgetMs: budget.hostVisibleMs,
      });
    }
    if (result.maxLongTaskMs > budget.maxLongTaskMs) {
      violations.push({
        ...baseViolation,
        metric: "maxLongTaskMs",
        actualMs: result.maxLongTaskMs,
        budgetMs: budget.maxLongTaskMs,
      });
    }
    return violations;
  });
}

function findRepeatedBudgetFindings(
  violations: BudgetViolation[],
): RepeatedBudgetFinding[] {
  const grouped = new Map<string, BudgetViolation[]>();

  for (const violation of violations) {
    const key = `${violation.screenId}:${violation.metric}`;
    const group = grouped.get(key) ?? [];
    group.push(violation);
    grouped.set(key, group);
  }

  return Array.from(grouped.values())
    .filter((group) => group.length >= REPEATED_BUDGET_OCCURRENCE_THRESHOLD)
    .map((group) => ({
      screenId: group[0].screenId,
      metric: group[0].metric,
      occurrences: group.length,
      runIndexes: group.map((violation) => violation.runIndex).sort((a, b) => a - b),
      budgetMs: group[0].budgetMs,
      maxActualMs: Math.max(...group.map((violation) => violation.actualMs)),
      dominantReasons: Array.from(
        new Set(group.map((violation) => violation.dominantReason)),
      ),
      preloadBeforeStatuses: Array.from(
        new Set(group.map((violation) => violation.preloadBeforeStatus)),
      ),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || b.maxActualMs - a.maxActualMs);
}

async function runSafeQaRoutePerf(page: Page, testInfo: TestInfo) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const results: ScreenResult[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to load resource")) return;
    consoleErrors.push(text);
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await installSafeQaBootState(page);
  const tracker = installRequestTracker(page);

  const attachReport = async (
    status:
      | { kind: "completed" }
      | { kind: "failed"; error: { message: string; stack?: string } },
  ) => {
    await tracker.flush();
    const finalClientMetrics = await safeReadClientMetricSnapshot(page);
    const requests = tracker.requests.slice();
    const apiRequests = requests.filter((request) =>
      request.path.startsWith("/api/"),
    );
    const liveLeaks = apiRequests
      .map(detectLiveLeak)
      .filter((leak): leak is LiveLeakRecord => leak !== null)
      .map((leak) => ({
        screen: leak.screen,
        method: leak.method,
        path: leak.path,
        status: leak.status,
        label: leak.label,
      }));
    const badResponses = findBadResponses(requests);
    const budgetViolations = findBudgetViolations(results);
    const repeatedBudgetFindings =
      findRepeatedBudgetFindings(budgetViolations);
    const report = {
      generatedAt: new Date().toISOString(),
      status,
      mode: "safe-qa",
      runs: SAFE_QA_PERF_RUNS,
      screenSequence: screenSequence.map((screen) => screen.id),
      viewport: { width: 1440, height: 1000 },
      budgetMode: ENFORCE_BUDGETS ? "enforced" : "soft",
      budgets: defaultBudgets,
      slowApiMs: SLOW_API_MS,
      repeatedBudgetOccurrenceThreshold: REPEATED_BUDGET_OCCURRENCE_THRESHOLD,
      results,
      summary: {
        runCount: SAFE_QA_PERF_RUNS,
        requestCount: requests.length,
        apiRequestCount: apiRequests.length,
        badResponseCount: badResponses.length,
        liveLeakCount: liveLeaks.length,
        consoleErrorCount: consoleErrors.length,
        pageErrorCount: pageErrors.length,
        longTaskCount: results.reduce(
          (sum, result) => sum + result.longTaskCount,
          0,
        ),
        maxLongTaskMs: round(
          results.reduce(
            (max, result) => Math.max(max, result.maxLongTaskMs),
            0,
          ),
        ),
        budgetViolationCount: budgetViolations.length,
        repeatedBudgetFindingCount: repeatedBudgetFindings.length,
      },
      badResponses,
      liveLeaks,
      budgetViolations,
      repeatedBudgetFindings,
      nextOptimizationCandidates: repeatedBudgetFindings,
      pageErrors,
      consoleErrors,
      requests,
      clientMetrics: finalClientMetrics,
    };

    await testInfo.attach("safe-qa-route-performance.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });

    return report;
  };

  try {
    for (let runIndex = 1; runIndex <= SAFE_QA_PERF_RUNS; runIndex += 1) {
      tracker.setRunIndex(runIndex);
      tracker.setActiveScreen("boot");
      await page.goto(`/?pyrusQa=safe&safeQaPerfRun=${runIndex}`, {
        waitUntil: "domcontentloaded",
      });
      await waitForDesktopNavigation(page);

      let previousScreen: ScreenId | "boot" = "boot";
      const runResults: ScreenResult[] = [];

      for (const screen of screenSequence) {
        const warmupBefore = await readWarmupSnapshot(page);
        const preloadBefore = getPreloadEntry(warmupBefore, screen.id);
        tracker.setActiveScreen(screen.id);
        const routeStartedAtMs = await page.evaluate(() => performance.now());
        const navigation = await openScreen(page, screen);
        await page.waitForTimeout(500);
        await tracker.flush();
        const routeEndedAtMs = await page.evaluate(() => performance.now());
        const warmupAfter = await readWarmupSnapshot(page);
        const preloadAfter = getPreloadEntry(warmupAfter, screen.id);
        const clientMetrics = await readClientMetricSnapshot(page);
        const metricSummary = summarizeRouteMetrics({
          runIndex,
          screen,
          requests: tracker.requests.slice(),
          clientMetrics,
          routeStartedAtMs,
          routeEndedAtMs,
        });
        const hostVisibleMs = round(navigation.hostVisibleMs);
        const readyMs = round(navigation.readyMs);
        const dominantReason = classifyRouteAttribution({
          screen,
          hostVisibleMs,
          readyMs,
          preloadBefore,
          slowApiRequests: metricSummary.slowApiRequests,
          longTaskTotalMs: metricSummary.longTaskTotalMs,
          maxLongTaskMs: metricSummary.maxLongTaskMs,
        });
        const attribution: RouteAttribution = {
          runIndex,
          previousScreen,
          routeStartedAtMs: round(routeStartedAtMs),
          routeEndedAtMs: round(routeEndedAtMs),
          preloadBefore,
          preloadAfter,
          warmupBefore: summarizeWarmupSnapshot(warmupBefore),
          warmupAfter: summarizeWarmupSnapshot(warmupAfter),
          slowApiRequests: metricSummary.slowApiRequests,
          longTaskTotalMs: metricSummary.longTaskTotalMs,
          maxLongTaskMs: metricSummary.maxLongTaskMs,
          routeDataStages: metricSummary.routeDataStages,
          dominantReason,
        };
        const result: ScreenResult = {
          runIndex,
          id: screen.id,
          label: screen.label,
          previousScreen,
          routeStartedAtMs: attribution.routeStartedAtMs,
          routeEndedAtMs: attribution.routeEndedAtMs,
          hostVisibleMs,
          readyMs,
          requestCount: metricSummary.requestCount,
          apiRequestCount: metricSummary.apiRequestCount,
          slowApiCount: metricSummary.slowApiRequests.length,
          slowApiRequests: metricSummary.slowApiRequests,
          longTaskCount: metricSummary.longTaskCount,
          longTaskTotalMs: metricSummary.longTaskTotalMs,
          maxLongTaskMs: metricSummary.maxLongTaskMs,
          routeDataStages: metricSummary.routeDataStages,
          attribution,
        };

        results.push(result);
        runResults.push(result);
        previousScreen = screen.id;
      }

      console.log(
        `[safe-qa-route-performance] run ${runIndex}/${SAFE_QA_PERF_RUNS} ${screenSequence
          .map(({ id }) => id)
          .join("->")} ${JSON.stringify(
          runResults.map((result) => ({
            id: result.id,
            previousScreen: result.previousScreen,
            hostVisibleMs: result.hostVisibleMs,
            readyMs: result.readyMs,
            requestCount: result.requestCount,
            apiRequestCount: result.apiRequestCount,
            slowApiCount: result.slowApiCount,
            longTaskCount: result.longTaskCount,
            maxLongTaskMs: result.maxLongTaskMs,
            preloadBeforeStatus:
              result.attribution.preloadBefore?.status ?? "missing",
            dominantReason: result.attribution.dominantReason,
          })),
        )}`,
      );
    }
  } catch (error) {
    await attachReport({
      kind: "failed",
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { message: String(error) },
    });
    throw error;
  }

  const report = await attachReport({ kind: "completed" });

  console.log(
    `[safe-qa-route-performance] aggregate ${JSON.stringify(
      results.map((result) => ({
        runIndex: result.runIndex,
        id: result.id,
        previousScreen: result.previousScreen,
        hostVisibleMs: result.hostVisibleMs,
        readyMs: result.readyMs,
        requestCount: result.requestCount,
        apiRequestCount: result.apiRequestCount,
        slowApiCount: result.slowApiCount,
        longTaskCount: result.longTaskCount,
        maxLongTaskMs: result.maxLongTaskMs,
        preloadBeforeStatus:
          result.attribution.preloadBefore?.status ?? "missing",
        dominantReason: result.attribution.dominantReason,
      })),
    )}`,
  );
  if (report.budgetViolations.length > 0) {
    console.warn(
      `[safe-qa-route-performance] soft budget violations: ${JSON.stringify(
        report.budgetViolations,
      )}`,
    );
  }
  if (report.repeatedBudgetFindings.length > 0) {
    console.warn(
      `[safe-qa-route-performance] repeated optimization candidates: ${JSON.stringify(
        report.repeatedBudgetFindings,
      )}`,
    );
  }

  return report;
}

test("profiles safe-QA routes and guards loading regressions", async ({
  page,
}, testInfo) => {
  const report = await runSafeQaRoutePerf(page, testInfo);

  expect(report.pageErrors, "safe-QA route profile page errors").toEqual([]);
  expect(report.consoleErrors, "safe-QA route profile console errors").toEqual([]);
  expect(report.badResponses, "safe-QA route profile bad responses").toEqual([]);
  expect(report.liveLeaks, "safe-QA route profile live data leaks").toEqual([]);

  if (ENFORCE_BUDGETS) {
    expect(
      report.budgetViolations,
      "safe-QA route profile enforced budget violations",
    ).toEqual([]);
  }
});

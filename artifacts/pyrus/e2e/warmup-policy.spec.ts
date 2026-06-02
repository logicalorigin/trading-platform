import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

test.setTimeout(1_200_000);

const port = Number(process.env.PLAYWRIGHT_PORT || 18747);
const baseURL = `http://127.0.0.1:${port}`;
const useMockApi =
  process.env.PYRUS_WARMUP_POLICY_MOCK_API === "1";
const repeatCount = Math.max(
  1,
  Number.parseInt(
    process.env.PYRUS_WARMUP_POLICY_REPEATS ||
      "3",
    10,
  ),
);
const idleWarmupMs = Math.max(
  1_000,
  Number.parseInt(
    process.env.PYRUS_WARMUP_POLICY_IDLE_MS ||
      "22000",
    10,
  ),
);
const dataReadyTimeoutMs = Math.max(
  1_000,
  Number.parseInt(
    process.env.PYRUS_WARMUP_POLICY_DATA_READY_MS ||
      "5000",
    10,
  ),
);
const routeSettleMs = Math.max(
  250,
  Number.parseInt(
    process.env.PYRUS_WARMUP_POLICY_ROUTE_SETTLE_MS ||
      "1000",
    10,
  ),
);

type WarmupOverrides = {
  disableOperationalCodePreload?: boolean;
  disableHiddenScreenWarmMount?: boolean;
  disableBackgroundDataWarmup?: boolean;
  disableResearchWorkspacePreload?: boolean;
};

type WarmupSnapshot = {
  activeScreen: string;
  firstScreenReady: boolean;
  screenWarmupPhase: string;
  mountedScreens: string[];
  mountedScreenCount: number;
  overrides: Required<WarmupOverrides>;
  completions: Record<string, boolean>;
  queues?: Record<string, boolean>;
  timelineMs?: Record<string, number>;
  gates: Record<string, unknown>;
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
};

type RequestRecord = {
  phase: string;
  completedPhase: string;
  url: string;
  path: string;
  method: string;
  resourceType: string;
  status: number | null;
  failed: boolean;
  failureText: string | null;
  durationMs: number;
};

type NumberSummary = {
  count: number;
  median: number | null;
  min: number | null;
  max: number | null;
};

type LongTaskSummary = {
  startIndex: number;
  endIndex: number;
  count: number;
  durationMs: number;
};

const variants: Array<{
  id: string;
  label: string;
  overrides: WarmupOverrides;
}> = [
  { id: "baseline", label: "Baseline", overrides: {} },
  {
    id: "code-preload-off",
    label: "Code preload off",
    overrides: { disableOperationalCodePreload: true },
  },
  {
    id: "hidden-mount-off",
    label: "Hidden mount off",
    overrides: { disableHiddenScreenWarmMount: true },
  },
  {
    id: "background-data-off",
    label: "Background data off",
    overrides: { disableBackgroundDataWarmup: true },
  },
  {
    id: "research-preload-off",
    label: "Research preload off",
    overrides: { disableResearchWorkspacePreload: true },
  },
  {
    id: "all-off",
    label: "All warmup off",
    overrides: {
      disableOperationalCodePreload: true,
      disableHiddenScreenWarmMount: true,
      disableBackgroundDataWarmup: true,
      disableResearchWorkspacePreload: true,
    },
  },
];

const routeChecks = [
  { id: "account", label: "Account", readyTestId: "account-screen" },
  { id: "trade", label: "Trade", readyTestId: "trade-top-zone" },
  { id: "backtest", label: "Backtest", readyTestId: "backtest-workspace" },
];

const mockNow = Date.parse("2026-05-23T14:30:00.000Z");
const mockSymbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"];

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const formatNumber = (value: number | null, digits = 1) =>
  value == null ? "n/a" : String(round(value, digits));

const metricValue = (metrics: Array<{ name: string; value: number }>, name: string) =>
  metrics.find((metric) => metric.name === name)?.value ?? 0;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeOverrides(overrides: WarmupOverrides): Required<WarmupOverrides> {
  return {
    disableOperationalCodePreload:
      overrides.disableOperationalCodePreload === true,
    disableHiddenScreenWarmMount:
      overrides.disableHiddenScreenWarmMount === true,
    disableBackgroundDataWarmup:
      overrides.disableBackgroundDataWarmup === true,
    disableResearchWorkspacePreload:
      overrides.disableResearchWorkspacePreload === true,
  };
}

function makeMockBars(symbol: string, limit = 80) {
  const base = 100 + mockSymbols.indexOf(symbol) * 20;
  return Array.from({ length: Math.max(20, Math.min(limit, 120)) }, (_, index) => {
    const close = base + Math.sin(index / 8) * 1.5 + index * 0.04;
    return {
      timestamp: new Date(mockNow - (limit - index) * 60_000).toISOString(),
      open: close - 0.35,
      high: close + 0.85,
      low: close - 0.9,
      close,
      volume: 1_000_000 + index * 1_000,
      source: "mock-history",
      freshness: "live",
      marketDataMode: "live",
      delayed: false,
    };
  });
}

async function installWarmupMockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const now = new Date(mockNow).toISOString();

    if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    let body: unknown = {};

    if (url.pathname === "/api/session") {
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        marketDataProviders: { live: "ibkr", historical: "ibkr", research: "mock" },
        configured: { massive: false, ibkr: false, research: false },
        ibkrBridge: null,
        timestamp: now,
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [
          {
            id: "default",
            name: "Default",
            isDefault: true,
            items: mockSymbols.map((symbol, index) => ({
              id: `default-${symbol}`,
              symbol,
              name: symbol,
              sortOrder: index,
              addedAt: now,
            })),
          },
        ],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const symbols = (url.searchParams.get("symbols") || mockSymbols.join(","))
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: symbols.map((symbol, index) => ({
          symbol,
          price: 100 + index * 7,
          prevClose: 99 + index * 7,
          change: 1,
          changePercent: 1,
          volume: 1_000_000,
          updatedAt: now,
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/bars") {
      const symbol = (url.searchParams.get("symbol") || "SPY").toUpperCase();
      const limit = Number(url.searchParams.get("limit") || "80");
      body = {
        bars: makeMockBars(symbol, Number.isFinite(limit) ? limit : 80),
        dataSource: "mock-history",
        historySource: "mock-history",
        freshness: "live",
        marketDataMode: "live",
      };
    } else if (url.pathname === "/api/universe/tickers") {
      body = {
        results: mockSymbols.map((symbol, index) => ({
          ticker: symbol,
          name: symbol,
          market: symbol === "SPY" || symbol === "QQQ" ? "etf" : "stocks",
          rootSymbol: symbol,
          primaryExchange: symbol === "SPY" || symbol === "QQQ" ? "ARCX" : "XNAS",
          providerContractId: String(1000 + index),
          active: true,
        })),
      };
    } else if (url.pathname.startsWith("/api/research/")) {
      body = {
        configured: false,
        provider: "mock",
        entries: [],
        snapshots: [],
        fundamentals: null,
        financials: null,
        filings: [],
        transcripts: [],
      };
    } else if (url.pathname.startsWith("/api/settings/")) {
      body = {
        source: "mock",
        preferences: {},
        settings: [],
        lanes: [],
        policy: {},
        defaults: {},
        updatedAt: now,
        admission: {
          activeLineCount: 0,
          accountMonitorLineCount: 0,
          accountMonitorRemainingLineCount: 20,
          flowScannerLineCount: 0,
          budget: { maxLines: 0, accountMonitorLineCap: 20, flowScannerLineCap: 0 },
          poolUsage: {},
          counters: {},
        },
        bridge: { diagnostics: null, error: null },
        streams: { quoteStreams: {}, optionQuoteStreams: {}, stockAggregates: {} },
        drift: { admissionVsBridgeLineDelta: null },
      };
    } else if (url.pathname.startsWith("/api/diagnostics/")) {
      body = {
        status: "ok",
        severity: "info",
        timestamp: now,
        snapshots: [],
        events: [],
        thresholds: [],
        points: [],
        ok: true,
      };
    } else if (url.pathname.startsWith("/api/backtests/")) {
      body = { strategies: [], studies: [], runs: [], jobs: [], drafts: [] };
    } else if (url.pathname.startsWith("/api/algo/")) {
      body = {
        deployments: [],
        events: [],
        options: [],
        state: null,
        performance: [],
        cockpit: null,
      };
    } else if (url.pathname.startsWith("/api/signal-monitor/")) {
      body = {
        profile: null,
        states: [],
        events: [],
        matrix: [],
        evaluatedAt: now,
      };
    } else if (
      url.pathname.startsWith("/api/accounts") ||
      url.pathname === "/api/positions" ||
      url.pathname === "/api/orders" ||
      url.pathname === "/api/executions"
    ) {
      body = {
        accounts: [
          {
            accountId: "DU1234567",
            netLiquidation: 100_000,
            cash: 75_000,
            buyingPower: 200_000,
            updatedAt: now,
          },
        ],
        positions: [],
        orders: [],
        trades: [],
        executions: [],
        points: [],
        updatedAt: now,
      };
    } else if (url.pathname === "/api/flow/events") {
      body = { events: [], source: { provider: "mock", status: "live" } };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function installWarmupPolicyObserver(page: Page, overrides: WarmupOverrides) {
  await page.context().addInitScript((nextOverrides) => {
    const warmupWindow = window as Window & {
      __PYRUS_PERF_WARMUP_OVERRIDES__?: WarmupOverrides;
      __PYRUS_PERF_WARMUP_OVERRIDES__?: WarmupOverrides;
      __PYRUS_WARMUP_POLICY_LONG_TASKS__?: Array<{
        startTime: number;
        duration: number;
        name: string;
      }>;
    };
    warmupWindow.__PYRUS_PERF_WARMUP_OVERRIDES__ = nextOverrides;
    warmupWindow.__PYRUS_PERF_WARMUP_OVERRIDES__ = nextOverrides;
    warmupWindow.__PYRUS_WARMUP_POLICY_LONG_TASKS__ = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          warmupWindow.__PYRUS_WARMUP_POLICY_LONG_TASKS__?.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Long-task entries are optional in Chromium contexts.
    }
  }, overrides);
}

function installRequestTracker(page: Page) {
  let phase = "boot";
  const starts = new WeakMap<Request, { phase: string; startedAt: number }>();
  const records: RequestRecord[] = [];

  const finalize = async (request: Request, failed: boolean, failureText: string | null) => {
    const completedPhase = phase;
    const start = starts.get(request) ?? { phase, startedAt: Date.now() };
    const response = failed ? null : await request.response().catch(() => null);
    const url = request.url();
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      path = url;
    }
    records.push({
      phase: start.phase,
      completedPhase,
      url,
      path,
      method: request.method(),
      resourceType: request.resourceType(),
      status: response?.status() ?? null,
      failed,
      failureText,
      durationMs: Math.max(0, Date.now() - start.startedAt),
    });
  };

  page.on("request", (request) => {
    starts.set(request, { phase, startedAt: Date.now() });
  });
  page.on("requestfinished", (request) => {
    void finalize(request, false, null);
  });
  page.on("requestfailed", (request) => {
    void finalize(request, true, request.failure()?.errorText || "failed");
  });

  return {
    records,
    setPhase(nextPhase: string) {
      phase = nextPhase;
    },
  };
}

async function collectMetrics(page: Page): Promise<MetricSnapshot> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Performance.enable");
    const [performanceMetrics, heap, dom] = await Promise.all([
      session.send("Performance.getMetrics"),
      session.send("Runtime.getHeapUsage"),
      session.send("Memory.getDOMCounters"),
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
    nodesDelta: after.nodes - before.nodes,
    jsEventListenersDelta: after.jsEventListeners - before.jsEventListeners,
  };
}

async function readWarmupSnapshot(page: Page): Promise<WarmupSnapshot | null> {
  return page.evaluate(() => {
    const warmupWindow = window as Window & {
      __PYRUS_PERF_WARMUP_SNAPSHOT__?: WarmupSnapshot;
    };
    return warmupWindow.__PYRUS_PERF_WARMUP_SNAPSHOT__ ?? null;
  });
}

async function waitForFirstScreenReady(page: Page) {
  await page.waitForFunction(
    () => {
      const warmupWindow = window as Window & {
        __PYRUS_PERF_WARMUP_SNAPSHOT__?: WarmupSnapshot;
      };
      return warmupWindow.__PYRUS_PERF_WARMUP_SNAPSHOT__?.firstScreenReady === true;
    },
    null,
    { timeout: 30_000 },
  );
}

async function waitForAppHttpReady(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not checked";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseURL, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1_000);
  }
  throw new Error(`App server did not recover within ${timeoutMs}ms: ${lastError}`);
}

async function gotoAppAndWait(
  page: Page,
  phaseLabel: string,
  recoveries?: string[],
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await waitForAppHttpReady();
    try {
      await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
        timeout: 30_000,
      });
      await waitForFirstScreenReady(page);
      return readWarmupSnapshot(page);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const recovery = `${phaseLabel}:goto-attempt-${attempt} ${message.split("\n")[0]}`;
      recoveries?.push(recovery);
      console.log(`[warmup-policy] ${recovery}`);
      await delay(1_000);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`App did not load for ${phaseLabel}`);
}

async function ensureAppReady(
  page: Page,
  phaseLabel: string,
  recoveries?: string[],
) {
  const snapshot = await readWarmupSnapshot(page).catch(() => null);
  if (snapshot?.firstScreenReady === true) {
    return snapshot;
  }

  const recovery = `${phaseLabel} app not ready; waiting for server and reloading`;
  recoveries?.push(recovery);
  console.log(`[warmup-policy] ${recovery}`);
  return gotoAppAndWait(page, phaseLabel, recoveries);
}

async function getLongTaskSummary(page: Page, startIndex = 0) {
  const tasks = await page.evaluate(() => {
    const warmupWindow = window as Window & {
      __PYRUS_WARMUP_POLICY_LONG_TASKS__?: Array<{
        startTime: number;
        duration: number;
        name: string;
      }>;
    };
    return warmupWindow.__PYRUS_WARMUP_POLICY_LONG_TASKS__ ?? [];
  });
  const slice = tasks.slice(startIndex);
  return {
    startIndex,
    endIndex: tasks.length,
    count: slice.length,
    durationMs: slice.reduce((sum, task) => sum + task.duration, 0),
  };
}

function isCanceledRequest(record: RequestRecord) {
  return /(?:net::)?ERR_ABORTED|NS_BINDING_ABORTED|aborted|canceled/i.test(
    record.failureText || "",
  );
}

function isAssetChunkRequest(record: RequestRecord) {
  return (
    record.resourceType === "script" ||
    record.resourceType === "stylesheet" ||
    /\.(?:css|js|jsx|mjs|ts|tsx|wasm)$/.test(record.path) ||
    record.path.startsWith("/src/") ||
    record.path.startsWith("/assets/")
  );
}

function topCounts(values: string[], limit = 8) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function formatRequestRecord(record: RequestRecord) {
  const status = record.status == null ? "no-status" : String(record.status);
  const failure = record.failureText ? ` ${record.failureText}` : "";
  return `${record.method} ${record.path} ${status}${failure}`;
}

function summarizeRequests(records: RequestRecord[], phasePrefix: string) {
  const started = records.filter((record) => record.phase.startsWith(phasePrefix));
  const completed = records.filter((record) =>
    record.completedPhase.startsWith(phasePrefix),
  );
  const apiStarted = started.filter((record) => record.path.startsWith("/api/"));
  const apiCompleted = completed.filter((record) => record.path.startsWith("/api/"));
  const assetChunkStarted = started.filter(isAssetChunkRequest);
  const failedStarted = started.filter((record) => record.failed);
  const canceledStarted = started.filter(isCanceledRequest);
  return {
    requestCount: started.length,
    completedRequestCount: completed.length,
    apiRequestCount: apiStarted.length,
    apiCompletedRequestCount: apiCompleted.length,
    assetChunkRequestCount: assetChunkStarted.length,
    failedRequestCount: failedStarted.length,
    canceledRequestCount: canceledStarted.length,
    response5xxCount: started.filter(
      (record) => record.status != null && record.status >= 500,
    ).length,
    requestMs: started.reduce((sum, record) => sum + record.durationMs, 0),
    completedRequestMs: completed.reduce((sum, record) => sum + record.durationMs, 0),
    topApiPaths: topCounts(apiStarted.map((record) => record.path)),
    topCompletedApiPaths: topCounts(apiCompleted.map((record) => record.path)),
    assetChunkRequests: topCounts(
      assetChunkStarted.map((record) => record.path),
      10,
    ),
    failedRequests: failedStarted.slice(0, 8).map(formatRequestRecord),
    canceledRequests: canceledStarted.slice(0, 8).map(formatRequestRecord),
  };
}

type RequestSummary = ReturnType<typeof summarizeRequests>;

type RouteResult = (typeof routeChecks)[number] & {
  shellVisibleMs: number;
  dataReady: boolean;
  dataReadyMs: number | null;
  metricsDelta: ReturnType<typeof diffMetrics>;
  longTasks: LongTaskSummary;
  requests: RequestSummary;
  snapshot: WarmupSnapshot | null;
};

type VariantRunResult = {
  id: string;
  label: string;
  repeat: number;
  phaseBase: string;
  overrides: Required<WarmupOverrides>;
  consoleErrors: string[];
  recoveries: string[];
  firstSnapshot: WarmupSnapshot | null;
  idle: {
    snapshot: WarmupSnapshot | null;
    mountedScreens: string[];
    metricsDelta: ReturnType<typeof diffMetrics>;
    longTasks: LongTaskSummary;
    requests: RequestSummary;
  };
  routes: RouteResult[];
};

async function openScreen(
  page: Page,
  screen: (typeof routeChecks)[number],
  phaseLabel: string,
  recoveries?: string[],
) {
  await ensureAppReady(page, `${phaseLabel}:before-open`, recoveries);
  const startedAt = Date.now();
  const host = page.getByTestId(`screen-host-${screen.id}`);
  const isMounted = (await host.count()) > 0;
  const isActive =
    isMounted &&
    (await host.getAttribute("aria-hidden", { timeout: 250 }).catch(() => null)) ===
      "false";

  if (!isActive) {
    const navButtons = page
      .getByTestId("platform-screen-nav")
      .locator("button")
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(screen.label)}\\s*$`) });
    if ((await navButtons.count().catch(() => 0)) !== 1) {
      await ensureAppReady(page, `${phaseLabel}:nav-missing`, recoveries);
    }
    await expect(navButtons).toHaveCount(1, { timeout: 10_000 });
    await navButtons.first().evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
  }

  await expect(host).toHaveAttribute("aria-hidden", "false", { timeout: 30_000 });
  const shellVisibleMs = Date.now() - startedAt;
  let dataReady = false;
  let dataReadyMs: number | null = null;
  await expect(page.getByTestId(screen.readyTestId))
    .toBeVisible({ timeout: dataReadyTimeoutMs })
    .then(() => {
      dataReady = true;
      dataReadyMs = Date.now() - startedAt;
    })
    .catch(() => undefined);

  return { shellVisibleMs, dataReady, dataReadyMs };
}

type VariantAggregate = {
  id: string;
  label: string;
  overrides: Required<WarmupOverrides>;
  sampleCount: number;
  idle: {
    mountedScreenSets: Array<{ name: string; count: number }>;
    longTaskMs: NumberSummary;
    heapDeltaMb: NumberSummary;
    apiRequests: NumberSummary;
    totalRequests: NumberSummary;
    assetChunkRequests: NumberSummary;
  };
  routes: Array<{
    id: string;
    label: string;
    sampleCount: number;
    dataReadyRate: number | null;
    shellVisibleMs: NumberSummary;
    dataReadyMs: NumberSummary;
    longTaskMs: NumberSummary;
    apiRequests: NumberSummary;
    totalRequests: NumberSummary;
  }>;
};

type PolicyRecommendation = {
  rule: string;
  recommendedOverrides: Required<WarmupOverrides>;
  summary: string;
  candidates: Array<{
    category: string;
    disabledFlag: keyof Required<WarmupOverrides>;
    offVariantId: string;
    routeBenefitCount: number;
    benefitedRoutes: Array<{
      routeId: string;
      label: string;
      metrics: Array<{
        metric: "shellVisibleMs" | "dataReadyMs";
        baselineMs: number;
        offMs: number;
        enabledImprovementPct: number;
      }>;
    }>;
    idleDisqualified: boolean;
    idlePenalties: string[];
    keepEnabled: boolean;
  }>;
};

type WarmupPolicySummary = {
  generatedAt: string;
  repeatCount: number;
  idleWarmupMs: number;
  routeSettleMs: number;
  dataReadyTimeoutMs: number;
  variants: typeof variants;
  routeChecks: typeof routeChecks;
  aggregates: VariantAggregate[];
  recommendation: PolicyRecommendation;
  results: VariantRunResult[];
};

const warmupPolicyCandidates: Array<{
  category: string;
  disabledFlag: keyof Required<WarmupOverrides>;
  offVariantId: string;
}> = [
  {
    category: "Operational code preload",
    disabledFlag: "disableOperationalCodePreload",
    offVariantId: "code-preload-off",
  },
  {
    category: "Hidden screen warm mount",
    disabledFlag: "disableHiddenScreenWarmMount",
    offVariantId: "hidden-mount-off",
  },
  {
    category: "Background data warmup",
    disabledFlag: "disableBackgroundDataWarmup",
    offVariantId: "background-data-off",
  },
  {
    category: "Research workspace preload",
    disabledFlag: "disableResearchWorkspacePreload",
    offVariantId: "research-preload-off",
  },
];

function summarizeNumbers(values: Array<number | null | undefined>): NumberSummary {
  const finiteValues = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (finiteValues.length === 0) {
    return { count: 0, median: null, min: null, max: null };
  }
  const middle = Math.floor(finiteValues.length / 2);
  const median =
    finiteValues.length % 2 === 0
      ? (finiteValues[middle - 1] + finiteValues[middle]) / 2
      : finiteValues[middle];
  return {
    count: finiteValues.length,
    median,
    min: finiteValues[0],
    max: finiteValues[finiteValues.length - 1],
  };
}

function aggregateResults(results: VariantRunResult[]): VariantAggregate[] {
  return variants.map((variant) => {
    const samples = results.filter((result) => result.id === variant.id);
    return {
      id: variant.id,
      label: variant.label,
      overrides: normalizeOverrides(variant.overrides),
      sampleCount: samples.length,
      idle: {
        mountedScreenSets: topCounts(
          samples.map((sample) => sample.idle.mountedScreens.join(", ") || "(none)"),
          4,
        ),
        longTaskMs: summarizeNumbers(
          samples.map((sample) => sample.idle.longTasks.durationMs),
        ),
        heapDeltaMb: summarizeNumbers(
          samples.map((sample) => sample.idle.metricsDelta.heapDeltaMb),
        ),
        apiRequests: summarizeNumbers(
          samples.map((sample) => sample.idle.requests.apiRequestCount),
        ),
        totalRequests: summarizeNumbers(
          samples.map((sample) => sample.idle.requests.requestCount),
        ),
        assetChunkRequests: summarizeNumbers(
          samples.map((sample) => sample.idle.requests.assetChunkRequestCount),
        ),
      },
      routes: routeChecks.map((route) => {
        const routeSamples = samples
          .map((sample) => sample.routes.find((routeResult) => routeResult.id === route.id))
          .filter((routeResult): routeResult is RouteResult => Boolean(routeResult));
        return {
          id: route.id,
          label: route.label,
          sampleCount: routeSamples.length,
          dataReadyRate:
            routeSamples.length === 0
              ? null
              : routeSamples.filter((routeResult) => routeResult.dataReady).length /
                routeSamples.length,
          shellVisibleMs: summarizeNumbers(
            routeSamples.map((routeResult) => routeResult.shellVisibleMs),
          ),
          dataReadyMs: summarizeNumbers(
            routeSamples.map((routeResult) => routeResult.dataReadyMs),
          ),
          longTaskMs: summarizeNumbers(
            routeSamples.map((routeResult) => routeResult.longTasks.durationMs),
          ),
          apiRequests: summarizeNumbers(
            routeSamples.map((routeResult) => routeResult.requests.apiRequestCount),
          ),
          totalRequests: summarizeNumbers(
            routeSamples.map((routeResult) => routeResult.requests.requestCount),
          ),
        };
      }),
    };
  });
}

function metricSlowerPct(baselineMs: number | null, offMs: number | null) {
  if (baselineMs == null || offMs == null || baselineMs <= 0) {
    return null;
  }
  return ((offMs - baselineMs) / baselineMs) * 100;
}

function isIdlePenalty(
  baselineValue: number | null,
  offValue: number | null,
  metric: "longTaskMs" | "heapDeltaMb" | "apiRequests",
) {
  const baselineCost =
    metric === "heapDeltaMb"
      ? Math.max(0, baselineValue ?? 0)
      : baselineValue ?? 0;
  const offCost =
    metric === "heapDeltaMb" ? Math.max(0, offValue ?? 0) : offValue ?? 0;
  if (baselineCost <= 0) {
    return false;
  }
  if (offCost <= 0) {
    return baselineCost > 0;
  }
  return baselineCost > offCost * 1.1;
}

function buildPolicyRecommendation(
  aggregates: VariantAggregate[],
): PolicyRecommendation {
  const baseline = aggregates.find((aggregate) => aggregate.id === "baseline");
  const recommendedOverrides: Required<WarmupOverrides> = {
    disableOperationalCodePreload: true,
    disableHiddenScreenWarmMount: true,
    disableBackgroundDataWarmup: true,
    disableResearchWorkspacePreload: true,
  };
  const rule =
    "Keep a speculative warmup category only when it improves median shell-visible or data-ready time by at least 15% on at least two target routes and does not add more than 10% median idle long-task, heap, or API-request cost.";

  if (!baseline) {
    return {
      rule,
      recommendedOverrides,
      summary: "No baseline aggregate was produced, so the conservative recommendation is to disable all speculative warmup.",
      candidates: [],
    };
  }

  const candidates = warmupPolicyCandidates.map((candidate) => {
    const offAggregate = aggregates.find(
      (aggregate) => aggregate.id === candidate.offVariantId,
    );
    const benefitedRoutes =
      offAggregate == null
        ? []
        : routeChecks
            .map((route) => {
              const baselineRoute = baseline.routes.find(
                (routeAggregate) => routeAggregate.id === route.id,
              );
              const offRoute = offAggregate.routes.find(
                (routeAggregate) => routeAggregate.id === route.id,
              );
              const metrics: Array<{
                metric: "shellVisibleMs" | "dataReadyMs";
                baselineMs: number;
                offMs: number;
                enabledImprovementPct: number;
              }> = [];

              const shellImprovementPct = metricSlowerPct(
                baselineRoute?.shellVisibleMs.median ?? null,
                offRoute?.shellVisibleMs.median ?? null,
              );
              if (shellImprovementPct != null && shellImprovementPct >= 15) {
                metrics.push({
                  metric: "shellVisibleMs",
                  baselineMs: baselineRoute?.shellVisibleMs.median ?? 0,
                  offMs: offRoute?.shellVisibleMs.median ?? 0,
                  enabledImprovementPct: shellImprovementPct,
                });
              }

              const dataReadyImprovementPct = metricSlowerPct(
                baselineRoute?.dataReadyMs.median ?? null,
                offRoute?.dataReadyMs.median ?? null,
              );
              if (dataReadyImprovementPct != null && dataReadyImprovementPct >= 15) {
                metrics.push({
                  metric: "dataReadyMs",
                  baselineMs: baselineRoute?.dataReadyMs.median ?? 0,
                  offMs: offRoute?.dataReadyMs.median ?? 0,
                  enabledImprovementPct: dataReadyImprovementPct,
                });
              }

              return metrics.length === 0
                ? null
                : {
                    routeId: route.id,
                    label: route.label,
                    metrics,
                  };
            })
            .filter(
              (
                benefit,
              ): benefit is {
                routeId: string;
                label: string;
                metrics: Array<{
                  metric: "shellVisibleMs" | "dataReadyMs";
                  baselineMs: number;
                  offMs: number;
                  enabledImprovementPct: number;
                }>;
              } => Boolean(benefit),
            );

    const idlePenalties: string[] = [];
    if (offAggregate) {
      if (
        isIdlePenalty(
          baseline.idle.longTaskMs.median,
          offAggregate.idle.longTaskMs.median,
          "longTaskMs",
        )
      ) {
        idlePenalties.push(
          `long tasks ${formatNumber(baseline.idle.longTaskMs.median)}ms vs ${formatNumber(offAggregate.idle.longTaskMs.median)}ms`,
        );
      }
      if (
        isIdlePenalty(
          baseline.idle.heapDeltaMb.median,
          offAggregate.idle.heapDeltaMb.median,
          "heapDeltaMb",
        )
      ) {
        idlePenalties.push(
          `heap ${formatNumber(baseline.idle.heapDeltaMb.median)}MB vs ${formatNumber(offAggregate.idle.heapDeltaMb.median)}MB`,
        );
      }
      if (
        isIdlePenalty(
          baseline.idle.apiRequests.median,
          offAggregate.idle.apiRequests.median,
          "apiRequests",
        )
      ) {
        idlePenalties.push(
          `API ${formatNumber(baseline.idle.apiRequests.median, 0)} vs ${formatNumber(offAggregate.idle.apiRequests.median, 0)}`,
        );
      }
    }

    const idleDisqualified = idlePenalties.length > 0;
    const keepEnabled =
      offAggregate != null && benefitedRoutes.length >= 2 && !idleDisqualified;
    recommendedOverrides[candidate.disabledFlag] = !keepEnabled;

    return {
      ...candidate,
      routeBenefitCount: benefitedRoutes.length,
      benefitedRoutes,
      idleDisqualified,
      idlePenalties,
      keepEnabled,
    };
  });

  const keptCategories = candidates
    .filter((candidate) => candidate.keepEnabled)
    .map((candidate) => candidate.category);

  return {
    rule,
    recommendedOverrides,
    summary:
      keptCategories.length === 0
        ? "No speculative warmup category met the route-benefit and idle-cost rule; default to no speculative warmup."
        : `Keep enabled: ${keptCategories.join(", ")}.`,
    candidates,
  };
}

function formatSummary(summary: NumberSummary, unit = "", digits = 1) {
  return `med ${formatNumber(summary.median, digits)}${unit} (min ${formatNumber(summary.min, digits)}, max ${formatNumber(summary.max, digits)}, n=${summary.count})`;
}

function formatTopCountSummary(items: Array<{ name: string; count: number }>) {
  return items.length === 0
    ? "none"
    : items.map((item) => `${item.name} x${item.count}`).join("; ");
}

function formatTimeline(snapshot: WarmupSnapshot | null) {
  const timeline = snapshot?.timelineMs;
  if (!timeline) {
    return "none";
  }
  const entries = Object.entries(timeline).sort((left, right) => left[1] - right[1]);
  return entries.length === 0
    ? "none"
    : entries.map(([key, value]) => `${key}=${round(value, 0)}ms`).join("; ");
}

function formatRequestSummary(requests: RequestSummary) {
  return `started ${requests.requestCount}, completed ${requests.completedRequestCount}, API ${requests.apiRequestCount}/${requests.apiCompletedRequestCount}, assets ${requests.assetChunkRequestCount}, failed ${requests.failedRequestCount}, canceled ${requests.canceledRequestCount}, 5xx ${requests.response5xxCount}`;
}

function buildMarkdownSummary(summary: WarmupPolicySummary) {
  const recommendationRows = summary.recommendation.candidates
    .map((candidate) => {
      const benefits =
        candidate.benefitedRoutes.length === 0
          ? "none"
          : candidate.benefitedRoutes
              .map(
                (route) =>
                  `${route.label}: ${route.metrics
                    .map(
                      (metric) =>
                        `${metric.metric} +${round(metric.enabledImprovementPct)}%`,
                    )
                    .join(", ")}`,
              )
              .join("; ");
      return `| ${candidate.category} | ${candidate.keepEnabled ? "keep" : "disable"} | ${candidate.routeBenefitCount} | ${candidate.idleDisqualified ? candidate.idlePenalties.join("; ") : "no"} | ${benefits} |`;
    })
    .join("\n");

  const idleRows = summary.aggregates
    .map(
      (aggregate) =>
        `| ${aggregate.label} | ${aggregate.sampleCount} | ${formatTopCountSummary(aggregate.idle.mountedScreenSets)} | ${formatSummary(aggregate.idle.longTaskMs, "ms")} | ${formatSummary(aggregate.idle.heapDeltaMb, "MB")} | ${formatSummary(aggregate.idle.apiRequests, "", 0)} | ${formatSummary(aggregate.idle.assetChunkRequests, "", 0)} |`,
    )
    .join("\n");

  const routeRows = summary.aggregates
    .flatMap((aggregate) =>
      aggregate.routes.map(
        (route) =>
          `| ${aggregate.label} | ${route.label} | ${route.sampleCount} | ${route.dataReadyRate == null ? "n/a" : `${round(route.dataReadyRate * 100, 0)}%`} | ${formatSummary(route.shellVisibleMs, "ms")} | ${formatSummary(route.dataReadyMs, "ms")} | ${formatSummary(route.longTaskMs, "ms")} | ${formatSummary(route.apiRequests, "", 0)} |`,
      ),
    )
    .join("\n");

  const sampleRows = summary.results
    .map((result) => {
      const routeSummary = result.routes
        .map(
          (route) =>
            `${route.label} ${round(route.shellVisibleMs)}ms/${route.dataReadyMs == null ? "pending" : `${round(route.dataReadyMs)}ms`} API ${route.requests.apiRequestCount}`,
        )
        .join("; ");
      return `| ${result.label} | ${result.repeat} | ${result.recoveries.length} | ${result.idle.mountedScreens.join(", ")} | ${round(result.idle.longTasks.durationMs)} | ${round(result.idle.metricsDelta.heapDeltaMb)} | ${formatRequestSummary(result.idle.requests)} | ${routeSummary} |`;
    })
    .join("\n");

  const requestDetails = summary.results
    .map((result) => {
      const routeLines = result.routes.map(
        (route) =>
          `- ${route.label}: ${formatRequestSummary(route.requests)}; top API ${formatTopCountSummary(route.requests.topApiPaths)}; assets ${formatTopCountSummary(route.requests.assetChunkRequests)}`,
      );
      return [
        `### ${result.label} repeat ${result.repeat}`,
        `Idle: ${formatRequestSummary(result.idle.requests)}`,
        `Idle top API: ${formatTopCountSummary(result.idle.requests.topApiPaths)}`,
        `Idle assets: ${formatTopCountSummary(result.idle.requests.assetChunkRequests)}`,
        `Idle failures: ${result.idle.requests.failedRequests.join("; ") || "none"}`,
        `Recoveries: ${result.recoveries.join("; ") || "none"}`,
        `Timeline: ${formatTimeline(result.idle.snapshot)}`,
        ...routeLines,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "# PYRUS Warmup Policy Matrix",
    "",
    `Generated: ${summary.generatedAt}`,
    `Repeats: ${summary.repeatCount}`,
    `Idle window: ${summary.idleWarmupMs}ms`,
    `Route settle: ${summary.routeSettleMs}ms`,
    "",
    "## Recommendation",
    "",
    summary.recommendation.rule,
    "",
    summary.recommendation.summary,
    "",
    `Recommended overrides: ${JSON.stringify(summary.recommendation.recommendedOverrides)}`,
    "",
    "| Category | Decision | Benefit Routes | Idle Disqualified | Benefit Details |",
    "| --- | --- | ---: | --- | --- |",
    recommendationRows,
    "",
    "## Idle Aggregates",
    "",
    "| Variant | Samples | Mounted After Idle | Idle Long Task ms | Idle Heap Delta | Idle API Requests | Idle Asset/Chunk Requests |",
    "| --- | ---: | --- | --- | --- | --- | --- |",
    idleRows,
    "",
    "## Route Aggregates",
    "",
    "| Variant | Route | Samples | Data Ready Rate | Shell Visible | Data Ready | Route Long Task ms | Route API Requests |",
    "| --- | --- | ---: | ---: | --- | --- | --- | --- |",
    routeRows,
    "",
    "## Sample Runs",
    "",
    "| Variant | Repeat | Recoveries | Mounted After Idle | Idle Long Task ms | Idle Heap Delta MB | Idle Requests | Route Results |",
    "| --- | ---: | ---: | --- | ---: | ---: | --- | --- |",
    sampleRows,
    "",
    "## Request Details",
    "",
    requestDetails,
    "",
  ].join("\n");
}

test("profiles startup idle work and route switches across warmup policies", async ({
  browser,
}, testInfo: TestInfo) => {
  const results: VariantRunResult[] = [];

  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
    for (const variant of variants) {
      const repeat = repeatIndex + 1;
      const phaseBase = `${variant.id}:repeat:${repeat}`;
      const normalizedOverrides = normalizeOverrides(variant.overrides);
      console.log(
        `[warmup-policy] ${variant.label} repeat ${repeat}/${repeatCount}`,
      );

        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        try {
          const page = await context.newPage();
          if (useMockApi) {
            await installWarmupMockApi(page);
          }
          await installWarmupPolicyObserver(page, normalizedOverrides);
        const requests = installRequestTracker(page);
        const consoleErrors: string[] = [];
        const recoveries: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") {
            consoleErrors.push(message.text());
          }
        });
        page.on("pageerror", (error) => {
          consoleErrors.push(error.message);
        });

        requests.setPhase(`${phaseBase}:boot`);
        await gotoAppAndWait(page, `${phaseBase}:boot`, recoveries);

        const firstSnapshot = await readWarmupSnapshot(page);
        expect(firstSnapshot?.overrides).toEqual(normalizedOverrides);

        const idleStartMetrics = await collectMetrics(page);
        const longTaskStart = (await getLongTaskSummary(page)).endIndex;
        requests.setPhase(`${phaseBase}:idle`);
        await page.waitForTimeout(idleWarmupMs);
        let idleSnapshot = await readWarmupSnapshot(page);
        if (idleSnapshot?.firstScreenReady !== true) {
          console.log(
            `[warmup-policy] ${phaseBase} lost warmup snapshot after idle; waiting for app to settle`,
          );
          await ensureAppReady(page, `${phaseBase}:idle`, recoveries).catch(
            () => undefined,
          );
          idleSnapshot = await readWarmupSnapshot(page);
        }
        const idleEndMetrics = await collectMetrics(page);
        const idleLongTasks = await getLongTaskSummary(page, longTaskStart);

        expect(idleSnapshot?.firstScreenReady).toBe(true);
        if (normalizedOverrides.disableOperationalCodePreload) {
          expect(idleSnapshot?.gates.operationalCodePreloadReady).toBe(false);
        }
        if (normalizedOverrides.disableHiddenScreenWarmMount) {
          expect(idleSnapshot?.gates.hiddenScreenWarmMountEnabled).toBe(false);
          expect(idleSnapshot?.mountedScreens).toEqual(["market"]);
        }
        if (normalizedOverrides.disableBackgroundDataWarmup) {
          expect(idleSnapshot?.gates.backgroundDataWarmupEnabled).toBe(false);
          expect(idleSnapshot?.gates.broadMarketDataHydrationReady).toBe(false);
        }

        const routeResults: RouteResult[] = [];
        for (const route of routeChecks) {
          await ensureAppReady(
            page,
            `${phaseBase}:route:${route.id}`,
            recoveries,
          );
          const routeLongTaskStart = (await getLongTaskSummary(page)).endIndex;
          const routeStartMetrics = await collectMetrics(page);
          requests.setPhase(`${phaseBase}:route:${route.id}`);
          const navigation = await openScreen(
            page,
            route,
            `${phaseBase}:route:${route.id}`,
            recoveries,
          );
          await page.waitForTimeout(routeSettleMs);
          await page.waitForTimeout(100);
          const routeEndMetrics = await collectMetrics(page);
          routeResults.push({
            ...route,
            ...navigation,
            metricsDelta: diffMetrics(routeStartMetrics, routeEndMetrics),
            longTasks: await getLongTaskSummary(page, routeLongTaskStart),
            requests: summarizeRequests(
              requests.records,
              `${phaseBase}:route:${route.id}`,
            ),
            snapshot: await readWarmupSnapshot(page),
          });
        }

        results.push({
          id: variant.id,
          label: variant.label,
          repeat,
          phaseBase,
          overrides: normalizedOverrides,
          consoleErrors,
          recoveries,
          firstSnapshot,
          idle: {
            snapshot: idleSnapshot,
            mountedScreens: idleSnapshot?.mountedScreens ?? [],
            metricsDelta: diffMetrics(idleStartMetrics, idleEndMetrics),
            longTasks: idleLongTasks,
            requests: summarizeRequests(requests.records, `${phaseBase}:idle`),
          },
          routes: routeResults,
        });
      } finally {
        await context.close();
      }
    }
  }

  const aggregates = aggregateResults(results);
  const recommendation = buildPolicyRecommendation(aggregates);
  const summary: WarmupPolicySummary = {
    generatedAt: new Date().toISOString(),
    repeatCount,
    idleWarmupMs,
    routeSettleMs,
    dataReadyTimeoutMs,
    variants,
    routeChecks,
    aggregates,
    recommendation,
    results,
  };
  const jsonPath = testInfo.outputPath("warmup-policy-summary.json");
  const markdownPath = testInfo.outputPath("warmup-policy-summary.md");
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(summary, null, 2));
  await writeFile(markdownPath, buildMarkdownSummary(summary));
  await testInfo.attach("warmup-policy-summary.json", {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach("warmup-policy-summary.md", {
    path: markdownPath,
    contentType: "text/markdown",
  });
  console.log(`Warmup policy summary: ${markdownPath}`);
});

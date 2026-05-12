import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);
test.describe.configure({ mode: "serial" });

const symbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"];
const mockNow = Date.parse("2026-05-01T16:00:00.000Z");
const spotChartIntervals = [
  "5s",
  "15s",
  "30s",
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

const spotApiTimeframeByInterval: Record<(typeof spotChartIntervals)[number], string> = {
  "5s": "5s",
  "15s": "5s",
  "30s": "5s",
  "1m": "1m",
  "2m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "15m",
  "1h": "1h",
  "4h": "1h",
  "1d": "1d",
};

type MockMarketDataAdmission = {
  activeLineCount: number;
  accountMonitorLineCount?: number;
  accountMonitorRemainingLineCount?: number;
  flowScannerLineCount: number;
  budget: {
    maxLines: number;
    accountMonitorLineCap?: number;
    flowScannerLineCap: number;
  };
  poolUsage: Record<string, Record<string, unknown>>;
  counters?: Record<string, Record<string, number>>;
};

async function disableStreamingSources(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readonly url: string;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        window.setTimeout(() => {
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: MockEventSource,
    });
  });
}

async function disableEventSource(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: undefined,
    });
  });
}

async function installControllableLineUsageEventSource(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      static instances: MockEventSource[] = [];

      readonly url: string;
      readyState = MockEventSource.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        MockEventSource.instances.push(this);
        window.setTimeout(() => {
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        }, 0);
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: MockEventSource,
    });
    (
      window as unknown as {
        __getMockEventSourceUrls: () => string[];
        __emitIbkrLineUsage: (payload: unknown) => void;
      }
    ).__getMockEventSourceUrls = () =>
      MockEventSource.instances
        .filter((source) => source.readyState !== MockEventSource.CLOSED)
        .map((source) => source.url);
    (
      window as unknown as {
        __emitIbkrLineUsage: (payload: unknown) => void;
      }
    ).__emitIbkrLineUsage = (payload: unknown) => {
      MockEventSource.instances
        .filter(
          (source) =>
            source.readyState !== MockEventSource.CLOSED &&
            source.url.includes("/api/settings/ibkr-line-usage/stream"),
        )
        .forEach((source) => {
          const event = new MessageEvent("ibkr-line-usage", {
            data: JSON.stringify(payload),
          });
          source.dispatchEvent(event);
          source.onmessage?.(event);
        });
    };
  });
}

async function waitForLineUsageStream(page: Page) {
  await page.waitForFunction(() =>
    (
      window as unknown as {
        __getMockEventSourceUrls?: () => string[];
      }
    )
      .__getMockEventSourceUrls?.()
      .some((url) => url.includes("/api/settings/ibkr-line-usage/stream")),
  );
}

async function emitLineUsageSnapshot(
  page: Page,
  admission: MockMarketDataAdmission,
) {
  await page.evaluate((nextAdmission) => {
    (
      window as unknown as {
        __emitIbkrLineUsage: (payload: unknown) => void;
      }
    ).__emitIbkrLineUsage({
      updatedAt: new Date().toISOString(),
      admission: nextAdmission,
      bridge: {
        diagnostics: null,
        error: null,
        activeLineCount: null,
        lineBudget: null,
        remainingLineCount: null,
      },
      streams: {
        quoteStreams: {},
        optionQuoteStreams: {},
        stockAggregates: {},
      },
      drift: { admissionVsBridgeLineDelta: null },
    });
  }, admission);
}

async function accelerateIntervalDelays(
  page: Page,
  replacements: Array<{ from: number; to: number }>,
) {
  await page.addInitScript((entries) => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const mapped = entries.find((entry) => entry.from === timeout);
      return nativeSetInterval(handler, mapped?.to ?? timeout, ...args);
    }) as typeof window.setInterval;
  }, replacements);
}

function timeframeStepMs(timeframe: string | null) {
  switch (timeframe) {
    case "5s":
      return 5_000;
    case "15s":
      return 15_000;
    case "30s":
      return 30_000;
    case "1m":
      return 60_000;
    case "2m":
      return 2 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "30m":
      return 30 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    default:
      return 5 * 60_000;
  }
}

const brokerLiveEdgeWindowMinutesByTimeframe: Record<string, number> = {
  "5s": 60,
  "15s": 60,
  "30s": 60,
  "1m": 240,
  "2m": 240,
  "5m": 240,
  "15m": 720,
  "30m": 720,
  "1h": 2_880,
  "4h": 2_880,
  "1d": 14_400,
};

function expectedBrokerRecentWindowMinutes(request: Record<string, string>) {
  const stepMs = timeframeStepMs(request.timeframe || null);
  const limit = Number(request.limit || "0");
  if (!stepMs || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  const horizonMinutes = Math.ceil((stepMs * (limit + 2)) / 60_000);
  const liveEdgeWindowMinutes =
    brokerLiveEdgeWindowMinutesByTimeframe[request.timeframe || ""] ?? 240;
  return Math.max(1, Math.min(horizonMinutes, liveEdgeWindowMinutes));
}

function makeBars(
  symbol: string,
  timeframe = "5m",
  {
    limit = 80,
    brokerRecentWindowMinutes = 60,
  }: { limit?: number; brokerRecentWindowMinutes?: number } = {},
) {
  const stepMs = timeframeStepMs(timeframe);
  const barCount = Math.max(20, Math.min(Number.isFinite(limit) ? limit : 80, 120));
  const liveEdgeWindowMs = Math.max(0, brokerRecentWindowMinutes) * 60_000;
  const base = 100 + symbols.indexOf(symbol) * 25;
  return Array.from({ length: barCount }, (_, index) => {
    const timestampMs = mockNow - (barCount - 1 - index) * stepMs;
    const close = base + Math.sin(index / 6) * 1.5 + index * 0.03;
    const isLiveEdge = timestampMs >= mockNow - liveEdgeWindowMs;
    return {
      timestamp: new Date(timestampMs).toISOString(),
      open: close - 0.4,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100_000 + index * 1_000,
      source: isLiveEdge ? "ibkr-history" : "massive-history",
      freshness: isLiveEdge ? "live" : "delayed",
      marketDataMode: isLiveEdge ? "live" : "delayed",
      dataUpdatedAt: new Date(isLiveEdge ? mockNow : timestampMs).toISOString(),
      delayed: !isLiveEdge,
    };
  });
}

async function mockShellApi(
  page: Page,
  {
    accountFixture = null,
    barsRequests = [],
    bridgeLauncherRequests = [],
    diagnosticsEventRequests = [],
    diagnosticsHistoryRequests = [],
    runtimeDiagnosticsRequests = [],
    ibkrReady = false,
    ibkrLineUsageRequests = [],
    runtimeLineUsage = null,
    shadowBacktestRequests = [],
  }: {
    accountFixture?: Record<string, unknown> | null;
    barsRequests?: Array<Record<string, string>>;
    bridgeLauncherRequests?: Array<Record<string, string>>;
    diagnosticsEventRequests?: Array<Record<string, string>>;
    diagnosticsHistoryRequests?: Array<Record<string, string>>;
    runtimeDiagnosticsRequests?: Array<Record<string, string>>;
    ibkrReady?: boolean;
    ibkrLineUsageRequests?: Array<Record<string, string>>;
    runtimeLineUsage?: MockMarketDataAdmission | null;
    shadowBacktestRequests?: Array<Record<string, unknown>>;
  } = {},
) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.includes("/streams/")) {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    let body: unknown = {};

    if (url.pathname === "/api/session") {
      const ibkrBridge = ibkrReady
        ? {
            connected: true,
            authenticated: true,
            competing: false,
            healthFresh: true,
            healthAgeMs: 400,
            bridgeReachable: true,
            socketConnected: true,
            accountsLoaded: true,
            accounts: [{ accountId: "DU1234567" }],
            selectedAccountId: "DU1234567",
            connectionTarget: "127.0.0.1:4002",
            sessionMode: "paper",
            clientId: 7,
            marketDataMode: "live",
            liveMarketDataAvailable: true,
            configuredLiveMarketDataMode: true,
            streamFresh: true,
            streamState: "live",
            streamStateReason: "fresh_stream_event",
            lastStreamEventAgeMs: 500,
            strictReady: true,
            strictReason: null,
          }
        : null;
      body = {
        environment: "paper",
        brokerProvider: "ibkr",
        marketDataProvider: "ibkr",
        marketDataProviders: {
          live: "ibkr",
          historical: "ibkr",
          research: "fmp",
        },
        configured: { polygon: false, ibkr: ibkrReady, research: false },
        ibkrBridge,
        timestamp: new Date(mockNow).toISOString(),
      };
    } else if (url.pathname === "/api/watchlists") {
      body = {
        watchlists: [
          {
            id: "default",
            name: "Default",
            isDefault: true,
            items: symbols.map((symbol, index) => ({
              id: `default-${symbol}`,
              symbol,
              name: symbol,
              sortOrder: index,
              addedAt: new Date(mockNow).toISOString(),
            })),
          },
        ],
      };
    } else if (url.pathname === "/api/quotes/snapshot") {
      const requested = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        quotes: requested.map((symbol, index) => ({
          symbol,
          price: 100 + index * 10,
          prevClose: 99 + index * 10,
          change: 1,
          changePercent: 1,
          volume: 1_000_000,
          updatedAt: new Date(mockNow).toISOString(),
          delayed: false,
        })),
      };
    } else if (url.pathname === "/api/bars") {
      const params = Object.fromEntries(url.searchParams.entries());
      barsRequests.push(params);
      const requestLimit = Number(url.searchParams.get("limit") || "80");
      const brokerRecentWindowMinutes = Number(
        url.searchParams.get("brokerRecentWindowMinutes") || "60",
      );
      body = {
        bars: makeBars(
          (url.searchParams.get("symbol") || "SPY").toUpperCase(),
          url.searchParams.get("timeframe") || "5m",
          {
            limit: requestLimit,
            brokerRecentWindowMinutes,
          },
        ),
        dataSource: "ibkr-history",
        historySource: "ibkr-history",
        freshness: "live",
        marketDataMode: "live",
      };
    } else if (url.pathname === "/api/flow/events") {
      body = {
        events: [],
        source: {
          provider: "ibkr",
          status: "live",
          unusualThreshold: 1,
          fallbackUsed: false,
        },
      };
    } else if (url.pathname === "/api/universe/tickers") {
      const search = (url.searchParams.get("search") || "").trim().toUpperCase();
      const names: Record<string, string> = {
        AAPL: "Apple Inc.",
        MSFT: "Microsoft Corp.",
        NVDA: "NVIDIA Corp.",
        QQQ: "Invesco QQQ Trust",
        SPY: "SPDR S&P 500 ETF Trust",
      };
      body = {
        results: symbols
          .filter((symbol) => {
            const name = names[symbol] || symbol;
            return (
              !search ||
              symbol.includes(search) ||
              name.toUpperCase().includes(search)
            );
          })
          .map((symbol, index) => ({
            ticker: symbol,
            name: names[symbol] || symbol,
            market: symbol === "SPY" || symbol === "QQQ" ? "etf" : "stocks",
            rootSymbol: symbol,
            primaryExchange: symbol === "SPY" || symbol === "QQQ" ? "ARCX" : "XNAS",
            normalizedExchangeMic:
              symbol === "SPY" || symbol === "QQQ" ? "ARCX" : "XNAS",
            exchangeDisplay: symbol === "SPY" || symbol === "QQQ" ? "ARCA" : "NASDAQ",
            providers: ["ibkr"],
            provider: "ibkr",
            tradeProvider: "ibkr",
            dataProviderPreference: "ibkr",
            providerContractId: String(1000 + index),
            active: true,
          })),
      };
    } else if (url.pathname === "/api/news") {
      body = { articles: [] };
    } else if (url.pathname === "/api/research/earnings-calendar") {
      body = { entries: [] };
    } else if (url.pathname === "/api/research/status") {
      body = { configured: false, provider: null };
    } else if (url.pathname === "/api/research/snapshots") {
      const requested = (url.searchParams.get("symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);
      body = {
        snapshots: requested.map((symbol, index) => ({
          symbol,
          price: 100 + index * 5,
          change: index % 2 ? -0.4 : 0.8,
          changePercent: index % 2 ? -0.3 : 0.6,
          mc: 100_000_000_000 + index * 1_000_000_000,
          pe: 24,
          eps: 6.5,
          sharesOut: 1_000_000_000,
        })),
      };
    } else if (url.pathname === "/api/research/fundamentals") {
      body = { fundamentals: null };
    } else if (url.pathname === "/api/research/financials") {
      body = { financials: null };
    } else if (url.pathname === "/api/research/sec-filings") {
      body = { filings: [] };
    } else if (url.pathname === "/api/research/transcripts") {
      body = { transcripts: [] };
    } else if (url.pathname.startsWith("/api/research/transcripts/")) {
      body = { transcript: null };
    } else if (url.pathname === "/api/settings/preferences") {
      body = {
        source: "database",
        preferences: {},
        updatedAt: new Date(mockNow).toISOString(),
      };
    } else if (url.pathname === "/api/settings/backend") {
      body = {
        settings: [],
        summary: {
          pendingRestartCount: 0,
          providers: { polygon: false, research: false, ibkr: false },
          tradingMode: "paper",
          diagnosticsStatus: "ok",
          diagnosticsSeverity: "info",
          thresholdCount: 0,
          ibkrLaneCount: 0,
          bridgeOverrideActive: false,
          algoDeploymentCount: 0,
          enabledAlgoDeploymentCount: 0,
        },
      };
    } else if (url.pathname === "/api/settings/ibkr-lanes") {
      body = { lanes: [], policy: {}, defaults: {} };
    } else if (url.pathname === "/api/settings/ibkr-line-usage") {
      ibkrLineUsageRequests.push(Object.fromEntries(url.searchParams.entries()));
      const admission = runtimeLineUsage || {
        activeLineCount: 0,
        accountMonitorLineCount: 0,
        accountMonitorRemainingLineCount: 20,
        flowScannerLineCount: 0,
        budget: { maxLines: 0, accountMonitorLineCap: 20, flowScannerLineCap: 0 },
        poolUsage: {
          "account-monitor": {
            activeLineCount: 0,
            maxLines: 20,
            remainingLineCount: 20,
            strict: true,
          },
        },
        counters: {},
      };
      body = {
        updatedAt: new Date(mockNow).toISOString(),
        admission,
        bridge: {
          diagnostics: null,
          error: null,
          activeLineCount: null,
          lineBudget: null,
          remainingLineCount: null,
        },
        streams: {
          quoteStreams: {},
          optionQuoteStreams: {},
          stockAggregates: {},
        },
        drift: { admissionVsBridgeLineDelta: null },
      };
    } else if (url.pathname === "/api/diagnostics/latest") {
      body = {
        status: "ok",
        severity: "info",
        timestamp: new Date(mockNow).toISOString(),
        snapshots: [
          {
            id: "resource-pressure",
            observedAt: new Date(mockNow).toISOString(),
            subsystem: "resource-pressure",
            status: "ok",
            severity: "info",
            summary: "Resource pressure is normal",
            dimensions: {},
            metrics: {
              pressureLevel: "normal",
              clientPressureLevel: "normal",
              clientPressureTrend: "steady",
              heapUsedPercent: 44,
              browserMemoryMb: 128,
              browserMemorySource: "performance.memory",
              sourceQuality: "medium",
              dominantDrivers: [],
            },
            raw: {},
          },
        ],
        events: [],
        thresholds: [],
        footerMemoryPressure: {
          observedAt: new Date(mockNow).toISOString(),
          level: "normal",
          trend: "steady",
          browserMemoryMb: 128,
          apiHeapUsedPercent: 44,
          sourceQuality: "medium",
          dominantDrivers: [],
        },
      };
    } else if (url.pathname === "/api/diagnostics/runtime") {
      runtimeDiagnosticsRequests.push(Object.fromEntries(url.searchParams.entries()));
      body = {
        providers: {
          polygon: {
            configured: false,
            status: "unconfigured",
            baseUrl: null,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastError: null,
          },
        },
        ibkr: {
          configured: ibkrReady,
          reachable: ibkrReady,
          connected: ibkrReady,
          authenticated: ibkrReady,
          competing: false,
          selectedAccountId: ibkrReady ? "DU...4567" : null,
          accountCount: ibkrReady ? 1 : 0,
          connectionTarget: ibkrReady ? "127.0.0.1:4002" : null,
          sessionMode: "paper",
          clientId: ibkrReady ? 7 : null,
          marketDataMode: ibkrReady ? "live" : null,
          liveMarketDataAvailable: ibkrReady ? true : null,
          healthFresh: ibkrReady,
          healthAgeMs: ibkrReady ? 400 : null,
          bridgeReachable: ibkrReady,
          socketConnected: ibkrReady,
          accountsLoaded: ibkrReady,
          configuredLiveMarketDataMode: ibkrReady,
          streamFresh: ibkrReady,
          streamState: ibkrReady ? "live" : "offline",
          streamStateReason: ibkrReady
            ? "fresh_stream_event"
            : "not_configured",
          lastStreamEventAgeMs: ibkrReady ? 500 : null,
          strictReady: ibkrReady,
          strictReason: null,
          streams: {
            marketDataAdmission: runtimeLineUsage || {
              activeLineCount: 0,
              accountMonitorLineCount: 0,
              accountMonitorRemainingLineCount: 20,
              flowScannerLineCount: 0,
              budget: { maxLines: 0, accountMonitorLineCap: 20, flowScannerLineCap: 0 },
              poolUsage: {
                "account-monitor": {
                  activeLineCount: 0,
                  maxLines: 20,
                  remainingLineCount: 20,
                  strict: true,
                },
              },
              counters: {},
            },
          },
        },
      };
    } else if (url.pathname === "/api/ibkr/bridge/launcher") {
      bridgeLauncherRequests.push(Object.fromEntries(url.searchParams.entries()));
      body = {
        activationId: "mock-activation",
        apiBaseUrl: "https://rayalgo.example.test",
        bridgeToken: "mock-bridge-token",
        bundleUrl: "https://rayalgo.example.test/api/ibkr/bridge/bundle.tar.gz",
        helperUrl: "https://rayalgo.example.test/api/ibkr/bridge/helper.ps1",
        helperVersion: "test",
        launchUrl: "rayalgo-ibkr://launch?activationId=mock-activation",
        managementToken: "mock-management-token",
      };
    } else if (url.pathname === "/api/diagnostics/history") {
      diagnosticsHistoryRequests.push(Object.fromEntries(url.searchParams.entries()));
      body = { points: [], snapshots: [] };
    } else if (url.pathname === "/api/diagnostics/events") {
      diagnosticsEventRequests.push(Object.fromEntries(url.searchParams.entries()));
      body = { events: [] };
    } else if (url.pathname === "/api/diagnostics/thresholds") {
      body = { thresholds: [] };
    } else if (
      url.pathname === "/api/diagnostics/client-events" ||
      url.pathname === "/api/diagnostics/client-metrics"
    ) {
      body = { ok: true };
    } else if (url.pathname === "/api/backtests/strategies") {
      body = {
        strategies: [
          {
            strategyId: "sma_crossover",
            version: "v1",
            label: "SMA Crossover",
            description: "Deterministic smoke strategy",
            status: "runnable",
            supportedTimeframes: ["1d", "1h"],
            directionMode: "long_only",
            parameterDefinitions: [
              {
                key: "fastPeriod",
                label: "Fast Period",
                type: "integer",
                defaultValue: 10,
                options: [],
                min: 2,
                max: 100,
                step: 1,
              },
              {
                key: "slowPeriod",
                label: "Slow Period",
                type: "integer",
                defaultValue: 30,
                options: [],
                min: 5,
                max: 200,
                step: 1,
              },
            ],
            defaultParameters: { fastPeriod: 10, slowPeriod: 30 },
          },
        ],
      };
    } else if (url.pathname === "/api/backtests/studies") {
      body = { studies: [] };
    } else if (url.pathname === "/api/backtests/runs") {
      body = { runs: [] };
    } else if (url.pathname === "/api/backtests/jobs") {
      body = { jobs: [] };
    } else if (url.pathname === "/api/backtests/drafts") {
      body = { drafts: [] };
    } else if (url.pathname === "/api/algo/deployments") {
      body = { deployments: [] };
    } else if (url.pathname === "/api/algo/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/signal-monitor/profile") {
      body = {
        id: "signal-profile",
        environment: "paper",
        enabled: false,
        watchlistId: "default",
        timeframe: "15m",
        rayReplicaSettings: {},
        freshWindowBars: 3,
        pollIntervalSeconds: 60,
        maxSymbols: 50,
        evaluationConcurrency: 3,
        lastEvaluatedAt: null,
        lastError: null,
        createdAt: new Date(mockNow).toISOString(),
        updatedAt: new Date(mockNow).toISOString(),
      };
    } else if (url.pathname === "/api/signal-monitor/state") {
      body = { profile: null, states: [], evaluatedAt: new Date(mockNow).toISOString() };
    } else if (url.pathname === "/api/signal-monitor/events") {
      body = { events: [] };
    } else if (url.pathname === "/api/charting/pine-scripts") {
      body = { scripts: [] };
    } else if (url.pathname === "/api/accounts") {
      body = { accounts: accountFixture?.accounts || [] };
    } else if (url.pathname === "/api/accounts/shadow/watchlist-backtest/runs") {
      const rawPayload = route.request().postData();
      const payload = rawPayload ? JSON.parse(rawPayload) : {};
      shadowBacktestRequests.push(payload);
      const isWeek = payload.range === "past_week" || payload.range === "week";
      body = {
        runId: isWeek ? "mock-week-run" : "mock-today-run",
        source: "watchlist_backtest",
        marketDate: "2026-05-01",
        marketDateFrom: isWeek ? "2026-04-27" : "2026-05-01",
        marketDateTo: "2026-05-01",
        rangeKey: isWeek ? "2026-04-27:2026-05-01" : "2026-05-01",
        timeframe: payload.timeframe || "15m",
        window: {
          start: new Date(mockNow - 60 * 60_000).toISOString(),
          end: new Date(mockNow).toISOString(),
          timezone: "America/New_York",
        },
        sizing: {
          maxPositionFraction: 0.1,
          maxOpenPositions: 10,
          wholeSharesOnly: true,
          startingNetLiquidation: 30_000,
          startingCash: 30_000,
        },
        universe: { watchlistCount: 1, symbolCount: symbols.length, watchlists: [] },
        summary: {
          signals: 3,
          ordersCreated: 2,
          entries: 1,
          exits: 1,
          openSyntheticPositions: 0,
          skippedSignals: 0,
          realizedPnl: isWeek ? 42.5 : 12.25,
          fees: 2,
          endingNetLiquidation: 30_040.5,
          endingCash: 30_040.5,
        },
        fills: [],
        skipped: [],
        updatedAt: new Date(mockNow).toISOString(),
      };
    } else if (url.pathname.includes("/account/") || url.pathname.includes("/accounts/")) {
      body = accountFixture || { accounts: [], positions: [], orders: [], trades: [], points: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("**/*tradingview.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  });
}

function makeAccountDensityFixture(): Record<string, unknown> {
  const positions = [
    {
      id: "pos-spy",
      symbol: "SPY",
      description: "SPDR S&P 500 ETF Trust",
      assetClass: "ETF",
      sector: "ETF",
      quantity: 36,
      averageCost: 503.12,
      mark: 512.44,
      dayChange: 121.38,
      dayChangePercent: 0.65,
      unrealizedPnl: 335.52,
      unrealizedPnlPercent: 1.85,
      marketValue: 18447.84,
      weightPercent: 40.2,
      betaWeightedDelta: 36,
      accounts: ["DU1234567"],
      sourceType: "manual",
      lots: [
        {
          accountId: "DU1234567",
          quantity: 36,
          averageCost: 503.12,
          marketValue: 18447.84,
          unrealizedPnl: 335.52,
        },
      ],
      openOrders: [
        {
          id: "order-spy-stop",
          side: "SELL",
          type: "STP",
          quantity: 10,
          stopPrice: 508,
          status: "working",
          accountId: "DU1234567",
        },
      ],
    },
    {
      id: "pos-nvda",
      symbol: "NVDA",
      description: "NVIDIA Corp.",
      assetClass: "Stocks",
      sector: "Technology",
      quantity: 18,
      averageCost: 918.42,
      mark: 941.16,
      dayChange: -86.22,
      dayChangePercent: -0.51,
      unrealizedPnl: 409.32,
      unrealizedPnlPercent: 2.48,
      marketValue: 16940.88,
      weightPercent: 36.9,
      betaWeightedDelta: 31.4,
      accounts: ["DU1234567"],
      sourceType: "automation",
      strategyLabel: "Momentum",
      lots: [
        {
          accountId: "DU1234567",
          quantity: 18,
          averageCost: 918.42,
          marketValue: 16940.88,
          unrealizedPnl: 409.32,
        },
      ],
      openOrders: [],
    },
    {
      id: "pos-aapl",
      symbol: "AAPL",
      description: "Apple Inc.",
      assetClass: "Stocks",
      sector: "Technology",
      quantity: 24,
      averageCost: 184.2,
      mark: 191.3,
      dayChange: 32.64,
      dayChangePercent: 0.71,
      unrealizedPnl: 170.4,
      unrealizedPnlPercent: 3.85,
      marketValue: 4591.2,
      weightPercent: 10,
      betaWeightedDelta: 20.2,
      accounts: ["DU1234567"],
      sourceType: "watchlist_backtest",
      strategyLabel: "Backtest",
      lots: [],
      openOrders: [],
    },
    {
      id: "pos-tsla",
      symbol: "TSLA",
      description: "Tesla Inc.",
      assetClass: "Stocks",
      sector: "Consumer Cyclical",
      quantity: -12,
      averageCost: 241.8,
      mark: 235.1,
      dayChange: 18.6,
      dayChangePercent: 0.66,
      unrealizedPnl: 80.4,
      unrealizedPnlPercent: 2.77,
      marketValue: -2821.2,
      weightPercent: -6.1,
      betaWeightedDelta: -18.7,
      accounts: ["DU1234567"],
      sourceType: "manual",
      lots: [],
      openOrders: [],
    },
  ];
  const orders = [
    {
      id: "ord-working-spy",
      symbol: "SPY",
      assetClass: "ETF",
      side: "SELL",
      type: "LMT",
      quantity: 10,
      filledQuantity: 0,
      limitPrice: 516.5,
      stopPrice: null,
      averageFillPrice: null,
      status: "working",
      timeInForce: "DAY",
      placedAt: "2026-05-01T14:30:00.000Z",
      filledAt: null,
      commission: null,
      sourceType: "manual",
      strategyLabel: "Trim",
    },
    {
      id: "ord-working-nvda",
      symbol: "NVDA",
      assetClass: "Stocks",
      side: "BUY",
      type: "LMT",
      quantity: 4,
      filledQuantity: 0,
      limitPrice: 932.25,
      stopPrice: null,
      averageFillPrice: null,
      status: "working",
      timeInForce: "DAY",
      placedAt: "2026-05-01T15:05:00.000Z",
      filledAt: null,
      commission: null,
      sourceType: "automation",
      strategyLabel: "Momentum",
    },
  ];
  const trades = [
    {
      source: "FLEX",
      id: "trade-aapl",
      symbol: "AAPL",
      assetClass: "Stocks",
      side: "Long",
      quantity: 12,
      avgOpen: 184.2,
      avgClose: 191.3,
      openDate: "2026-05-01T13:35:00.000Z",
      closeDate: "2026-05-01T15:10:00.000Z",
      realizedPnl: 85.2,
      realizedPnlPercent: 3.85,
      holdDurationMinutes: 95,
      commissions: 1.28,
      currency: "USD",
      sourceType: "manual",
    },
    {
      source: "FLEX",
      id: "trade-msft",
      symbol: "MSFT",
      assetClass: "Stocks",
      side: "Short",
      quantity: 8,
      avgOpen: 414.5,
      avgClose: 409.1,
      openDate: "2026-05-01T13:45:00.000Z",
      closeDate: "2026-05-01T15:45:00.000Z",
      realizedPnl: 43.2,
      realizedPnlPercent: 1.3,
      holdDurationMinutes: 120,
      commissions: 0.92,
      currency: "USD",
      sourceType: "automation",
      strategyLabel: "Mean Revert",
    },
  ];

  return {
    accounts: [{ accountId: "DU1234567", id: "DU1234567", label: "Paper DU1234567" }],
    positions,
    orders,
    trades,
    points: [
      { date: "2026-04-29", netLiquidation: 45000, dailyPnl: 80, cumulativePnl: 80 },
      { date: "2026-04-30", netLiquidation: 45210, dailyPnl: 210, cumulativePnl: 290 },
      { date: "2026-05-01", netLiquidation: 45930, dailyPnl: 720, cumulativePnl: 1010 },
    ],
    summary: {
      count: trades.length,
      winners: 2,
      losers: 0,
      realizedPnl: 128.4,
      commissions: 2.2,
      netLiquidation: 45930,
      dayPnl: 86.4,
    },
    totals: {
      netExposure: 37158.72,
      grossLong: 39979.92,
      grossShort: -2821.2,
      unrealizedPnl: 995.64,
      weightPercent: 81,
    },
  };
}

function collectRuntimeIssues(page: Page) {
  const issues: string[] = [];
  page.on("pageerror", (error) => issues.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to load resource")) return;
    issues.push(text);
  });
  return issues;
}

async function openScreen(page: Page, label: string, screenId: string) {
  const layout = await page.locator(".ra-shell").getAttribute("data-layout");
  if (layout === "phone") {
    const primaryScreenIds = new Set(["market", "flow", "trade", "account"]);
    if (primaryScreenIds.has(screenId)) {
      await page.getByTestId(`mobile-bottom-nav-${screenId}`).click();
    } else {
      await page.getByTestId("mobile-bottom-nav-more").click();
      await expect(page.getByTestId("mobile-more-sheet")).toBeVisible();
      await page.getByTestId(`mobile-more-screen-${screenId}`).click();
      await expect(page.getByTestId("mobile-more-sheet")).toBeHidden();
    }
  } else {
    const nav = page.getByTestId("platform-screen-nav");
    await nav.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  }
  await expect(page.getByTestId(`screen-host-${screenId}`)).toHaveAttribute(
    "aria-hidden",
    "false",
  );
}

async function selectChartInterval(
  page: Page,
  chartTestId: string,
  interval: string,
) {
  const chart = page.getByTestId(chartTestId);
  const trigger = chart.getByTestId("chart-timeframe-menu-trigger");
  const current = await trigger.getAttribute("data-chart-timeframe");
  if (current !== interval) {
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click({ force: true });
    const option = page.getByTestId(`chart-timeframe-option-${interval}`);
    await expect(option).toBeVisible({ timeout: 10_000 });
    await option.click({ force: true });
  }
  await expect(trigger).toHaveAttribute("data-chart-timeframe", interval, {
    timeout: 10_000,
  });
}

async function expectChartHydrated(page: Page, surfaceTestId: string) {
  const surface = page.getByTestId(surfaceTestId);
  await expect(surface).toHaveAttribute(
    "data-chart-visible-logical-range",
    /^(?!none$).+/,
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () =>
        Number((await surface.getAttribute("data-chart-rendered-bar-count")) || "0"),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(1);
}

async function expectChartLiveEdgeSource(page: Page, surfaceTestId: string) {
  const surface = page.getByTestId(surfaceTestId);
  await expect(surface).toHaveAttribute(
    "data-chart-latest-source",
    /^ibkr-history(?::rollup)?$/,
    { timeout: 15_000 },
  );
  await expect(surface).toHaveAttribute("data-chart-latest-freshness", "live");
  await expect(surface).toHaveAttribute(
    "data-chart-latest-market-data-mode",
    "live",
  );
  await expect(surface).toHaveAttribute("data-chart-latest-delayed", "false");
}

async function expectSpotBarsRequestForInterval(
  barsRequests: Array<Record<string, string>>,
  interval: (typeof spotChartIntervals)[number],
) {
  const expectedTimeframe = spotApiTimeframeByInterval[interval];
  await expect
    .poll(
      () =>
        barsRequests.some(
          (request) =>
            request.timeframe === expectedTimeframe &&
            Number(request.limit || "0") > 1 &&
            Number(request.brokerRecentWindowMinutes || "0") ===
              expectedBrokerRecentWindowMinutes(request),
        ),
      { timeout: 10_000 },
    )
    .toBeTruthy();
  const chartRequestsForTimeframe = barsRequests.filter(
    (request) =>
      request.timeframe === expectedTimeframe &&
      Number(request.limit || "0") > 1 &&
      request.brokerRecentWindowMinutes != null,
  );
  expect(chartRequestsForTimeframe.length).toBeGreaterThan(0);
  expect(
    chartRequestsForTimeframe.every(
      (request) => {
        const brokerRecentWindowMinutes = Number(
          request.brokerRecentWindowMinutes || "0",
        );
        return (
          brokerRecentWindowMinutes === 0 ||
          brokerRecentWindowMinutes === expectedBrokerRecentWindowMinutes(request)
        );
      },
    ),
    `${interval} spot chart requests should keep IBKR bounded to the live edge`,
  ).toBe(true);
}

test("platform shell keeps shared chrome while switching primary screens", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");

  const nav = page.getByTestId("platform-screen-nav");
  await expect(nav).toBeVisible();
  await expect(page.getByTestId("platform-compact-header")).toBeVisible();
  await expect(page.getByTestId("platform-bottom-status")).toBeVisible();

  for (const label of ["Market", "Flow", "Trade", "Account", "Research", "Algo", "Backtest", "Diagnostics", "Settings"]) {
    await expect(nav.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
  }

  for (const label of ["Flow", "Trade", "Account", "Diagnostics", "Settings", "Market"]) {
    await nav.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await expect(page.getByTestId("platform-compact-header")).toBeVisible();
    await expect(page.getByTestId("platform-screen-nav")).toBeVisible();
    await expect(page.getByTestId("platform-bottom-status")).toBeVisible();
  }

  expect(pageErrors).toEqual([]);
});

test("platform pages render page-by-page and keep primary controls interactive", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");
  await expect(page.getByTestId("footer-memory-pressure-indicator")).toBeVisible();
  await openScreen(page, "Market", "market");

  await expect(page.getByTestId("market-workspace")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("market-chart-grid")).toBeVisible();
  await expect(page.getByTestId("market-activity-panel")).toBeVisible();

  await openScreen(page, "Flow", "flow");
  await expect(page.getByTestId("flow-main-layout")).toBeVisible();
  await expect(page.getByTestId("flow-filter-panel")).toBeVisible();
  await expect(page.getByTestId("flow-filter-toggle")).toBeVisible();
  await page.getByTestId("flow-column-toggle").click();
  await expect(page.getByTestId("flow-column-drawer")).toBeVisible();

  await openScreen(page, "Trade", "trade");
  await expect(page.getByTestId("trade-top-zone")).toBeVisible();
  await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
  await expect(page.getByTestId("trade-options-chain-panel")).toBeVisible();

  await openScreen(page, "Account", "account");
  await expect(page.getByTestId("account-screen")).toBeVisible();
  await page.getByTestId("account-section-shadow").click();
  await expect(page.getByText("Shadow internal paper")).toBeVisible();
  await page.getByTestId("account-section-real").click();
  await expect(page.getByText("Aggregated real accounts")).toBeVisible();

  await openScreen(page, "Research", "research");
  await expect(page.getByTestId("research-screen")).toBeVisible();
  await expect(page.getByTestId("research-search-input")).toBeEnabled({
    timeout: 30_000,
  });
  await page.getByTestId("research-view-comps").click();
  await expect(page.getByTestId("research-view-comps")).toBeVisible();
  await page.getByTestId("research-view-macro").click();
  await expect(page.getByTestId("research-view-macro")).toBeVisible();
  await page.getByTestId("research-view-graph").click();
  await page.getByTestId("research-search-input").fill("NVDA");
  await expect(page.getByText(/match(?:es)?/)).toBeVisible();

  await openScreen(page, "Algo", "algo");
  await expect(page.getByTestId("algo-screen")).toBeVisible();
  await expect(page.getByText("Execution Control Plane")).toBeVisible();
  await expect(page.getByText("No promoted draft strategies").first()).toBeVisible();

  await openScreen(page, "Backtest", "backtest");
  await expect(page.getByTestId("backtest-workspace")).toBeVisible();
  await expect(page.getByText("Research Workbench")).toBeVisible();
  await expect(page.getByText("Backtest Inputs")).toBeVisible();

  await openScreen(page, "Diagnostics", "diagnostics");
  await expect(page.getByTestId("diagnostics-screen")).toBeVisible();
  await page.getByTestId("diagnostics-tab-memory").click();
  await expect(page.getByText("API Memory")).toBeVisible();
  await expect(page.getByText("Footer Pressure Signal")).toBeVisible();
  await page.getByTestId("diagnostics-tab-overview").click();
  await expect(page.getByText("API Latency Trend")).toBeVisible();

  await openScreen(page, "Settings", "settings");
  await expect(page.getByTestId("settings-screen")).toBeVisible();
  await page.getByTestId("settings-search-input").fill("chart");
  await page.getByTestId("settings-tab-charting").click();
  await expect(page.getByText("Chart Display")).toBeVisible();
  await page.getByTestId("settings-search-input").fill("");
  await page.getByTestId("settings-tab-workspace").click();
  await expect(page.getByText("Workspace Defaults")).toBeVisible();

  expect(runtimeIssues).toEqual([]);
});

test("footer memory indicator stays visible and settings expose footer controls", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");

  await expect(page.getByTestId("footer-memory-pressure-indicator")).toBeVisible();
  await openScreen(page, "Settings", "settings");
  await page.getByTestId("settings-tab-system").click();
  await expect(page.getByText("Footer Memory Signal")).toBeVisible();
  await expect(page.getByText("Pulse threshold")).toBeVisible();

  expect(runtimeIssues).toEqual([]);
});

test("platform phone layout navigates all primary screens without document overflow", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");

  await expect(page.locator(".ra-shell")).toHaveAttribute("data-layout", "phone");
  await expect(page.getByTestId("mobile-top-chrome")).toBeVisible();
  await expect(page.getByTestId("mobile-bottom-nav")).toBeVisible();
  await page.getByTestId("mobile-bottom-nav-more").click();
  await expect(page.getByTestId("mobile-more-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mobile-more-sheet")).toBeHidden();
  await page.getByTestId("mobile-activity-trigger").click();
  await expect(page.getByTestId("mobile-activity-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mobile-activity-sheet")).toBeHidden();
  await page.getByTestId("mobile-watchlist-trigger").click();
  await expect(page.getByTestId("mobile-watchlist-drawer")).toBeVisible();
  const watchlistRows = page.getByTestId("watchlist-row");
  await expect(watchlistRows.first()).toBeVisible();
  await expect(page.getByTestId("watchlist-manage-toggle")).toBeVisible();
  const maxWatchlistRowHeight = await watchlistRows.evaluateAll((elements) =>
    Math.max(...elements.map((element) => element.getBoundingClientRect().height)),
  );
  expect(maxWatchlistRowHeight).toBeLessThanOrEqual(48);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mobile-watchlist-drawer")).toBeHidden();

  const screens = [
    ["Market", "market", "market-workspace"],
    ["Flow", "flow", "flow-main-layout"],
    ["Trade", "trade", "trade-top-zone"],
    ["Account", "account", "account-screen"],
    ["Research", "research", "research-screen"],
    ["Algo", "algo", "algo-screen"],
    ["Backtest", "backtest", "backtest-workspace"],
    ["Diagnostics", "diagnostics", "diagnostics-screen"],
    ["Settings", "settings", "settings-screen"],
  ] as const;

  const expectAccountCalendarToStayCompact = async () => {
    const calendarGrid = page.getByTestId("account-pnl-calendar-month-grid");
    await expect(calendarGrid).toBeVisible();
    const calendarMetrics = await calendarGrid.evaluate((element) => {
      const columns = getComputedStyle(element)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      return {
        columns,
        height: element.getBoundingClientRect().height,
      };
    });
    expect(calendarMetrics.columns, "Account P&L calendar should keep 7 columns on phone").toBe(7);
    expect(calendarMetrics.height, "Account P&L calendar should stay compact on phone").toBeLessThan(240);
  };

  for (const [label, screenId, readyTestId] of screens) {
    await openScreen(page, label, screenId);
    await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 30_000 });
    if (screenId === "market") {
      await expect(page.getByTestId("market-activity-panel")).toHaveCount(0);
      await expect(page.getByTestId("market-workspace")).toHaveAttribute(
        "data-activity-layout",
        "hidden",
      );
    }
    if (screenId === "account") {
      await expectAccountCalendarToStayCompact();
    }
    const overflow = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth, `${label} should not document-overflow`).toBeLessThanOrEqual(
      overflow.viewportWidth + 1,
    );
  }

  await page.setViewportSize({ width: 375, height: 844 });
  await openScreen(page, "Account", "account");
  await expect(page.getByTestId("account-screen")).toBeVisible({ timeout: 30_000 });
  await expectAccountCalendarToStayCompact();
  const narrowOverflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(narrowOverflow.scrollWidth, "Account should not document-overflow at 375px").toBeLessThanOrEqual(
    narrowOverflow.viewportWidth + 1,
  );

  expect(runtimeIssues).toEqual([]);
});

test("account phone layout renders dense scan rows for positions trades and orders", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const maxCollapsedHeight = async (locator: ReturnType<Page["getByTestId"]>) =>
    locator.evaluateAll((elements) =>
      Math.max(...elements.map((element) => element.getBoundingClientRect().height)),
    );

  await page.setViewportSize({ width: 390, height: 844 });
  await disableStreamingSources(page);
  await mockShellApi(page, {
    accountFixture: makeAccountDensityFixture(),
    ibkrReady: true,
  });
  await page.goto("/");
  await openScreen(page, "Account", "account");

  const positionRows = page.getByTestId("account-position-scan-row");
  await expect(positionRows.first()).toBeVisible({ timeout: 30_000 });
  await expect(positionRows).toHaveCount(4);
  expect(await maxCollapsedHeight(positionRows)).toBeLessThanOrEqual(56);
  await positionRows.first().click();
  await expect(page.getByTestId("account-position-expanded-details").first()).toBeVisible();

  await page.getByTestId("account-trades-row-list").scrollIntoViewIfNeeded();
  const tradeRows = page.getByTestId("account-trade-scan-row");
  await expect(tradeRows.first()).toBeVisible({ timeout: 30_000 });
  await expect(tradeRows).toHaveCount(2);
  expect(await maxCollapsedHeight(tradeRows)).toBeLessThanOrEqual(56);
  await tradeRows.first().click();
  await expect(page.getByTestId("account-trade-expanded-details").first()).toBeVisible();

  await page.getByTestId("account-orders-row-list").scrollIntoViewIfNeeded();
  const orderRows = page.getByTestId("account-order-scan-row");
  await expect(orderRows.first()).toBeVisible({ timeout: 30_000 });
  await expect(orderRows).toHaveCount(2);
  expect(await maxCollapsedHeight(orderRows)).toBeLessThanOrEqual(56);
  await orderRows.first().click();
  await expect(page.getByTestId("account-order-expanded-details").first()).toBeVisible();

  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth, "Account should not document-overflow with dense rows").toBeLessThanOrEqual(
    overflow.viewportWidth + 1,
  );

  expect(runtimeIssues).toEqual([]);
});

test("platform keeps Account screen state mounted while hidden", async ({ page }) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");

  await openScreen(page, "Account", "account");
  await page.getByTestId("account-section-shadow").click();
  await expect(page.getByText("Shadow internal paper")).toBeVisible();

  await openScreen(page, "Market", "market");
  await expect(page.getByTestId("screen-host-account")).toHaveAttribute(
    "aria-hidden",
    "true",
  );

  await openScreen(page, "Account", "account");
  await expect(page.getByText("Shadow internal paper")).toBeVisible();
  expect(runtimeIssues).toEqual([]);
});

test("diagnostics stops history and event polling while hidden", async ({ page }) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const diagnosticsHistoryRequests: Array<Record<string, string>> = [];
  const diagnosticsEventRequests: Array<Record<string, string>> = [];

  await disableStreamingSources(page);
  await accelerateIntervalDelays(page, [{ from: 60_000, to: 50 }]);
  await mockShellApi(page, {
    diagnosticsEventRequests,
    diagnosticsHistoryRequests,
  });
  await page.goto("/");

  await openScreen(page, "Diagnostics", "diagnostics");
  await expect
    .poll(() => diagnosticsHistoryRequests.length, { timeout: 5_000 })
    .toBeGreaterThan(1);
  await expect
    .poll(() => diagnosticsEventRequests.length, { timeout: 5_000 })
    .toBeGreaterThan(1);
  expect(diagnosticsHistoryRequests[0]?.limit).toBe("240");
  expect(diagnosticsEventRequests[0]?.limit).toBe("240");

  await openScreen(page, "Market", "market");
  const hiddenHistoryCount = diagnosticsHistoryRequests.length;
  const hiddenEventCount = diagnosticsEventRequests.length;

  await page.waitForTimeout(200);
  expect(diagnosticsHistoryRequests.length).toBe(hiddenHistoryCount);
  expect(diagnosticsEventRequests.length).toBe(hiddenEventCount);
  expect(runtimeIssues).toEqual([]);
});

test("settings stops IBKR line usage polling while hidden", async ({ page }) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const ibkrLineUsageRequests: Array<Record<string, string>> = [];

  await disableEventSource(page);
  await accelerateIntervalDelays(page, [{ from: 2_000, to: 50 }]);
  await mockShellApi(page, { ibkrLineUsageRequests });
  await page.goto("/");

  await openScreen(page, "Settings", "settings");
  await page.getByTestId("settings-tab-data-broker").click();
  await expect
    .poll(() => ibkrLineUsageRequests.length, { timeout: 5_000 })
    .toBeGreaterThan(1);

  await openScreen(page, "Market", "market");
  const hiddenRequestCount = ibkrLineUsageRequests.length;

  await page.waitForTimeout(200);
  expect(ibkrLineUsageRequests.length).toBe(hiddenRequestCount);
  expect(runtimeIssues).toEqual([]);
});

test("account shadow watchlist backtest posts today and week ranges", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const shadowBacktestRequests: Array<Record<string, unknown>> = [];

  await disableStreamingSources(page);
  await mockShellApi(page, { shadowBacktestRequests });
  await page.goto("/");
  await openScreen(page, "Account", "account");
  await page.getByTestId("account-section-shadow").click();
  await expect(page.getByText("Shadow internal paper")).toBeVisible();

  const todayButton = page.getByTestId("shadow-watchlist-backtest-run-today");
  const weekButton = page.getByTestId("shadow-watchlist-backtest-run-week");
  await todayButton.scrollIntoViewIfNeeded();
  await expect(todayButton).toBeVisible();
  await expect(weekButton).toBeVisible();

  await todayButton.click();
  await expect
    .poll(() => shadowBacktestRequests.length, { timeout: 10_000 })
    .toBe(1);
  expect(shadowBacktestRequests[0]).toEqual({ timeframe: "15m" });

  await weekButton.click();
  await expect
    .poll(() => shadowBacktestRequests.length, { timeout: 10_000 })
    .toBe(2);
  expect(shadowBacktestRequests[1]).toEqual({
    timeframe: "15m",
    range: "past_week",
  });
  await expect(page.getByText("2026-04-27 -> 2026-05-01")).toBeVisible();

  expect(runtimeIssues).toEqual([]);
});

test("header connectivity shows market data line usage in the compact area and popover", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const runtimeDiagnosticsRequests: Array<Record<string, string>> = [];
  const lineUsage: MockMarketDataAdmission = {
    activeLineCount: 77,
    accountMonitorLineCount: 12,
    accountMonitorRemainingLineCount: 8,
    flowScannerLineCount: 34,
    budget: {
      maxLines: 200,
      accountMonitorLineCap: 20,
      flowScannerLineCap: 40,
    },
    poolUsage: {
      "account-monitor": {
        activeLineCount: 12,
        maxLines: 20,
        remainingLineCount: 8,
        strict: true,
      },
      "flow-scanner": {
        activeLineCount: 34,
        maxLines: 40,
        remainingLineCount: 6,
        strict: true,
      },
      visible: {
        activeLineCount: 18,
        maxLines: 88,
        remainingLineCount: 70,
      },
    },
    counters: {},
  };

  await installControllableLineUsageEventSource(page);
  await mockShellApi(page, {
    ibkrReady: true,
    runtimeDiagnosticsRequests,
    runtimeLineUsage: lineUsage,
  });
  await page.goto("/");
  await waitForLineUsageStream(page);
  await emitLineUsageSnapshot(page, lineUsage);

  const compactLineUsage = page.getByTestId("header-market-data-line-usage");
  await expect(compactLineUsage).toContainText("LINES", { timeout: 15_000 });
  await expect(compactLineUsage).toContainText("77 / 200");
  expect(runtimeDiagnosticsRequests).toHaveLength(0);

  await page
    .getByRole("button", { name: "Open IB Gateway connection details" })
    .click();
  const popover = page.getByRole("dialog", { name: "IB Gateway bridge" });
  await expect(popover).toContainText("Market data lines");
  await expect(popover).toContainText("77 / 200");
  await expect(popover).toContainText("Account monitor");
  await expect(popover).toContainText("12");
  await expect(popover).toContainText("20");
  await expect(popover).toContainText("Flow scanner");
  await expect(popover).toContainText("34");
  await expect(popover).toContainText("40");
  await expect
    .poll(() => runtimeDiagnosticsRequests.length, { timeout: 5_000 })
    .toBeGreaterThan(0);

  const triggerBox = await page
    .getByRole("button", { name: "Open IB Gateway connection details" })
    .boundingBox();
  const popoverBox = await popover.boundingBox();
  const viewport = page.viewportSize();
  if (!triggerBox || !popoverBox || !viewport) {
    throw new Error("Connectivity popover geometry was unavailable.");
  }
  expect(popoverBox.y).toBeGreaterThanOrEqual(
    triggerBox.y + triggerBox.height - 1,
  );
  expect(popoverBox.x).toBeGreaterThanOrEqual(0);
  expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(viewport.width);

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);

  expect(runtimeIssues).toEqual([]);
});

test("header connectivity line usage updates from the realtime stream while popover is open", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const ibkrLineUsageRequests: Array<Record<string, string>> = [];
  const initialLineUsage: MockMarketDataAdmission = {
    activeLineCount: 80,
    accountMonitorLineCount: 0,
    accountMonitorRemainingLineCount: 20,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      accountMonitorLineCap: 20,
      flowScannerLineCap: 40,
    },
    poolUsage: {
      "account-monitor": {
        activeLineCount: 0,
        maxLines: 20,
        remainingLineCount: 20,
        strict: true,
      },
      "flow-scanner": {
        activeLineCount: 0,
        maxLines: 40,
        remainingLineCount: 40,
        strict: true,
      },
      visible: {
        activeLineCount: 0,
        maxLines: 88,
        remainingLineCount: 88,
      },
      convenience: {
        activeLineCount: 80,
        maxLines: 80,
        remainingLineCount: 0,
      },
    },
    counters: {},
  };
  const requisitionedLineUsage: MockMarketDataAdmission = {
    activeLineCount: 120,
    accountMonitorLineCount: 20,
    accountMonitorRemainingLineCount: 0,
    flowScannerLineCount: 40,
    budget: {
      maxLines: 200,
      accountMonitorLineCap: 20,
      flowScannerLineCap: 40,
    },
    poolUsage: {
      "account-monitor": {
        activeLineCount: 20,
        maxLines: 20,
        remainingLineCount: 0,
        strict: true,
      },
      "flow-scanner": {
        activeLineCount: 40,
        maxLines: 40,
        remainingLineCount: 0,
        strict: true,
      },
      visible: {
        activeLineCount: 60,
        maxLines: 88,
        remainingLineCount: 28,
      },
      convenience: {
        activeLineCount: 0,
        maxLines: 80,
        remainingLineCount: 80,
      },
    },
    counters: {
      "account-monitor-live": { admitted: 20, rejected: 0, demoted: 0 },
      "flow-scanner-live": { admitted: 40, rejected: 0, demoted: 0 },
      "convenience-live": { admitted: 80, rejected: 0, demoted: 80 },
    },
  };

  await installControllableLineUsageEventSource(page);
  await mockShellApi(page, {
    ibkrReady: true,
    ibkrLineUsageRequests,
    runtimeLineUsage: initialLineUsage,
  });
  await page.goto("/");
  await waitForLineUsageStream(page);
  await emitLineUsageSnapshot(page, initialLineUsage);

  const compactLineUsage = page.getByTestId("header-market-data-line-usage");
  await expect(compactLineUsage).toContainText("80 / 200", { timeout: 15_000 });

  await page
    .getByRole("button", { name: "Open IB Gateway connection details" })
    .click();
  const popover = page.getByRole("dialog", { name: "IB Gateway bridge" });
  await expect(popover).toContainText("Market data lines");
  await expect(page.getByTestId("header-market-data-line-row-convenience")).toContainText("80");

  await emitLineUsageSnapshot(page, requisitionedLineUsage);

  await expect(compactLineUsage).toContainText("120 / 200");
  await expect(page.getByTestId("header-market-data-line-row-account-monitor")).toContainText("20");
  await expect(page.getByTestId("header-market-data-line-row-flow-scanner")).toContainText("40");
  await expect(page.getByTestId("header-market-data-line-row-convenience")).toContainText("0");
  expect(ibkrLineUsageRequests).toEqual([]);
  expect(runtimeIssues).toEqual([]);
});

test("header connectivity popover stays inside the narrow header viewport", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await disableStreamingSources(page);
  await mockShellApi(page, {
    ibkrReady: true,
    runtimeLineUsage: {
      activeLineCount: 77,
      accountMonitorLineCount: 12,
      accountMonitorRemainingLineCount: 8,
      flowScannerLineCount: 34,
      budget: {
        maxLines: 200,
        accountMonitorLineCap: 20,
        flowScannerLineCap: 40,
      },
      poolUsage: {
        "account-monitor": {
          activeLineCount: 12,
          maxLines: 20,
          remainingLineCount: 8,
          strict: true,
        },
        "flow-scanner": {
          activeLineCount: 34,
          maxLines: 40,
          remainingLineCount: 6,
          strict: true,
        },
        visible: {
          activeLineCount: 18,
          maxLines: 88,
          remainingLineCount: 70,
        },
      },
      counters: {},
    },
  });
  await page.goto("/");

  const trigger = page.getByRole("button", {
    name: "Open IB Gateway connection details",
  });
  await trigger.click();
  const popover = page.getByRole("dialog", { name: "IB Gateway bridge" });
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Market data lines");

  const triggerBox = await trigger.boundingBox();
  const popoverBox = await popover.boundingBox();
  const viewport = page.viewportSize();
  if (!triggerBox || !popoverBox || !viewport) {
    throw new Error("Narrow connectivity popover geometry was unavailable.");
  }
  expect(popoverBox.y).toBeGreaterThanOrEqual(
    triggerBox.y + triggerBox.height - 1,
  );
  expect(popoverBox.x).toBeGreaterThanOrEqual(0);
  expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(viewport.width);

  await page.mouse.click(8, 8);
  await expect(popover).toHaveCount(0);

  expect(runtimeIssues).toEqual([]);
});

test("header connectivity launch opens the bridge protocol without a browser popup", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const bridgeLauncherRequests: Array<Record<string, string>> = [];

  await disableStreamingSources(page);
  await page.addInitScript(() => {
    const launcherState = {
      anchorClicks: 0,
      href: "",
      windowOpenCalls: 0,
    };
    Object.defineProperty(window, "__rayalgoBridgeLauncherState", {
      configurable: true,
      value: launcherState,
    });
    window.open = ((...args: Parameters<typeof window.open>) => {
      launcherState.windowOpenCalls += 1;
      launcherState.href = String(args[0] || "");
      return null;
    }) as typeof window.open;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
      const href = this.getAttribute("href") || this.href || "";
      if (href.startsWith("rayalgo-ibkr://")) {
        launcherState.anchorClicks += 1;
        launcherState.href = href;
        return;
      }
      return originalAnchorClick.call(this);
    };
  });
  await mockShellApi(page, { bridgeLauncherRequests });
  await page.goto("/");

  await page
    .getByRole("button", { name: "Open IB Gateway connection details" })
    .click();
  const popover = page.getByRole("dialog", { name: "IB Gateway bridge" });
  await popover.getByRole("button", { name: "Launch" }).click();

  await expect
    .poll(() => bridgeLauncherRequests.length, { timeout: 10_000 })
    .toBe(1);
  await expect(popover).toContainText("IB Gateway activation is running");
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = (
            window as unknown as {
              __rayalgoBridgeLauncherState?: {
                anchorClicks: number;
                href: string;
                windowOpenCalls: number;
              };
            }
          ).__rayalgoBridgeLauncherState;
          return state || null;
        }),
      { timeout: 10_000 },
    )
    .toMatchObject({
      anchorClicks: 1,
      href: "rayalgo-ibkr://launch?activationId=mock-activation",
      windowOpenCalls: 0,
    });

  expect(runtimeIssues).toEqual([]);
});

test("market chart ticker search keeps a single active chart owner", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await disableStreamingSources(page);
  await mockShellApi(page);
  await page.goto("/");

  const firstSearchButton = page
    .getByTestId("market-mini-chart-0")
    .getByTestId("chart-symbol-search-button");
  const secondSearchButton = page
    .getByTestId("market-mini-chart-1")
    .getByTestId("chart-symbol-search-button");

  await expect(firstSearchButton).toBeVisible({ timeout: 30_000 });
  await expect(secondSearchButton).toBeVisible({ timeout: 30_000 });

  await firstSearchButton.click({ force: true });
  await expect(page.getByTestId("ticker-search-popover")).toHaveCount(1);
  await expect(firstSearchButton).toHaveAttribute("aria-expanded", "true");

  await secondSearchButton.click({ force: true });
  await expect(page.getByTestId("ticker-search-popover")).toHaveCount(1);
  await expect(firstSearchButton).toHaveAttribute("aria-expanded", "false");
  await expect(secondSearchButton).toHaveAttribute("aria-expanded", "true");

  expect(runtimeIssues).toEqual([]);
});

test("market chart ticker search updates the shared selected symbol", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await disableStreamingSources(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: false,
        marketGridLayout: "1x1",
        marketGridSoloSlotIndex: 0,
        marketGridSlots: [{ ticker: "SPY", tf: "15m" }],
      }),
    );
  });
  await mockShellApi(page);
  await page.goto("/");

  const searchButton = page
    .getByTestId("market-mini-chart-0")
    .getByTestId("chart-symbol-search-button");
  await expect(searchButton).toHaveAttribute("title", "Search SPY", {
    timeout: 30_000,
  });

  await searchButton.click({ force: true });
  await page.getByTestId("ticker-search-input").fill("Apple");
  const aaplRow = page.locator(
    '[data-testid="ticker-search-row"][data-ticker="AAPL"][data-provider-contract-id="1000"]',
  );
  await expect(aaplRow).toBeVisible({ timeout: 10_000 });
  await aaplRow.click();

  await expect(searchButton).toHaveAttribute("title", "Search AAPL", {
    timeout: 15_000,
  });
  await expect(
    page.locator('[data-testid="watchlist-row"][data-symbol="AAPL"]'),
  ).toHaveClass(/ra-focus-rail/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("rayalgo:state:v1") || "{}",
        );
        return state.sym || null;
      }),
    )
    .toBe("AAPL");

  expect(runtimeIssues).toEqual([]);
});

test("market watchlist selection replaces the visible solo chart ticker", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const barsRequests: Array<Record<string, string>> = [];

  await page.setViewportSize({ width: 1440, height: 1000 });
  await disableStreamingSources(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: false,
        marketGridLayout: "1x1",
        marketGridSoloSlotIndex: 0,
        marketGridSlots: [{ ticker: "SPY", tf: "15m" }],
      }),
    );
  });
  await mockShellApi(page, { barsRequests });
  await page.goto("/");

  const soloChart = page.getByTestId("market-mini-chart-0");
  const searchButton = soloChart.getByTestId("chart-symbol-search-button");
  await expect(searchButton).toHaveAttribute("title", "Search SPY", {
    timeout: 30_000,
  });

  await page.locator('[data-testid="watchlist-row"][data-symbol="AAPL"]').click();

  await expect(searchButton).toHaveAttribute("title", "Search AAPL", {
    timeout: 15_000,
  });
  await expect
    .poll(
      () => barsRequests.some((request) => request.symbol === "AAPL"),
      { timeout: 10_000 },
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("rayalgo:state:v1") || "{}",
        );
        return state.sym || null;
      }),
    )
    .toBe("AAPL");

  expect(runtimeIssues).toEqual([]);
});

test("market watchlist selection promotes an already-visible ticker into the primary chart", async ({
  page,
}) => {
  const runtimeIssues = collectRuntimeIssues(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await disableStreamingSources(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "rayalgo:state:v1",
      JSON.stringify({
        screen: "market",
        sym: "SPY",
        theme: "dark",
        sidebarCollapsed: false,
        marketGridLayout: "2x3",
        marketGridSlots: [
          { ticker: "SPY", tf: "15m" },
          { ticker: "QQQ", tf: "15m" },
          { ticker: "AAPL", tf: "15m" },
          { ticker: "MSFT", tf: "15m" },
          { ticker: "NVDA", tf: "15m" },
          { ticker: "IWM", tf: "15m" },
        ],
      }),
    );
  });
  await mockShellApi(page);
  await page.goto("/");

  const primarySearchButton = page
    .getByTestId("market-mini-chart-0")
    .getByTestId("chart-symbol-search-button");
  const priorAaplSlotSearchButton = page
    .getByTestId("market-mini-chart-2")
    .getByTestId("chart-symbol-search-button");

  await expect(primarySearchButton).toHaveAttribute("title", "Search SPY", {
    timeout: 30_000,
  });
  await expect(priorAaplSlotSearchButton).toHaveAttribute("title", "Search AAPL");

  await page.locator('[data-testid="watchlist-row"][data-symbol="AAPL"]').click();

  await expect(primarySearchButton).toHaveAttribute("title", "Search AAPL", {
    timeout: 15_000,
  });
  await expect(priorAaplSlotSearchButton).toHaveAttribute("title", "Search SPY");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("rayalgo:state:v1") || "{}",
        );
        return state.marketGridSlots?.[0]?.ticker || null;
      }),
    )
    .toBe("AAPL");

  expect(runtimeIssues).toEqual([]);
});

test("spot market mini chart hydrates every interval selection", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const runtimeIssues = collectRuntimeIssues(page);
  const barsRequests: Array<Record<string, string>> = [];

  await disableStreamingSources(page);
  await mockShellApi(page, { barsRequests });
  await page.goto("/");

  await expect(page.getByTestId("market-mini-chart-0")).toBeVisible({
    timeout: 30_000,
  });

  for (const interval of spotChartIntervals) {
    await selectChartInterval(page, "market-mini-chart-0", interval);
    await expectSpotBarsRequestForInterval(barsRequests, interval);
    await expectChartHydrated(page, "market-mini-chart-0-surface");
    await expectChartLiveEdgeSource(page, "market-mini-chart-0-surface");
  }

  expect(barsRequests.length).toBeGreaterThan(0);
  expect(runtimeIssues).toEqual([]);
});

test("trade spot chart hydrates every interval selection", async ({ page }) => {
  const runtimeIssues = collectRuntimeIssues(page);
  const barsRequests: Array<Record<string, string>> = [];

  await disableStreamingSources(page);
  await mockShellApi(page, { barsRequests });
  await page.goto("/");
  await openScreen(page, "Trade", "trade");

  await expect(page.getByTestId("trade-equity-chart")).toBeVisible({
    timeout: 30_000,
  });

  for (const interval of spotChartIntervals) {
    await selectChartInterval(page, "trade-equity-chart", interval);
    await expectSpotBarsRequestForInterval(barsRequests, interval);
    await expectChartHydrated(page, "trade-equity-chart-surface");
    await expectChartLiveEdgeSource(page, "trade-equity-chart-surface");
  }

  expect(barsRequests.length).toBeGreaterThan(0);
  expect(runtimeIssues).toEqual([]);
});

test("market chart frame changes timeframe from the dropdown and zooms", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const pageErrors: string[] = [];
  const barsRequests: Array<Record<string, string>> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await disableStreamingSources(page);
  await mockShellApi(page, { barsRequests });
  await page.goto("/");

  const chart = page.getByTestId("market-mini-chart-0");
  const surface = page.getByTestId("market-mini-chart-0-surface");
  await expect(chart).toBeVisible({ timeout: 30_000 });
  await expect(surface).toHaveAttribute(
    "data-chart-visible-logical-range",
    /^(?!none$).+/,
    { timeout: 15_000 },
  );
  await expectChartHydrated(page, "market-mini-chart-0-surface");

  const trigger = chart.getByTestId("chart-timeframe-menu-trigger");
  await expect(trigger).toHaveAttribute("data-chart-timeframe", "15m");
  await trigger.click();
  await page.getByTestId("chart-timeframe-option-1h").click();
  await expect(trigger).toHaveAttribute("data-chart-timeframe", "1h", {
    timeout: 10_000,
  });
  await expect
    .poll(
      () => barsRequests.some((request) => request["timeframe"] === "1h"),
      { timeout: 10_000 },
    )
    .toBe(true);

  const plot = page.getByTestId("market-mini-chart-0-surface-plot");
  const box = await plot.boundingBox();
  expect(box, "market chart plot should have a geometry box").not.toBeNull();
  await page.mouse.up();
  await page.mouse.move(8, 8);

  const initialRange = await surface.getAttribute("data-chart-visible-logical-range");
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.wheel(0, -500);
  await expect
    .poll(() => surface.getAttribute("data-chart-visible-logical-range"))
    .not.toBe(initialRange);
  await expect(surface).toHaveAttribute("data-chart-viewport-user-touched", "true");

  expect(pageErrors).toEqual([]);
});

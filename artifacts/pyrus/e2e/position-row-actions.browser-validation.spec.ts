import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
const ACCOUNT_ID = "U123";
const POSITION_ID = "position-aapl-u123";
const OLD_POSITION_MANAGEMENT_BLOCKER =
  "Broker position management is unavailable until preview, tax preflight, and prepared-order confirmation are wired.";
const TRADE_CONTEXT_PRESENTATIONS = [
  { id: "phone-dark", width: 390, height: 844, colorScheme: "dark" },
  { id: "tablet-light", width: 768, height: 1024, colorScheme: "light" },
  { id: "desktop-dark", width: 1440, height: 900, colorScheme: "dark" },
] as const;

const TRADE_TICKET_SECTION_IDS = [
  "trade-ticket-route-section",
  "trade-ticket-asset-section",
  "trade-ticket-order-section",
  "trade-ticket-estimate-section",
  "trade-ticket-review-section",
] as const;

const FLOW_CONTEXT_EVENT = {
  id: "flow-aapl-context",
  basis: "trade",
  occurredAt: new Date().toISOString(),
  underlying: "AAPL",
  expirationDate: "2026-07-24",
  right: "call",
  strike: 200,
  side: "BUY",
  price: 2.5,
  bid: 2.4,
  ask: 2.6,
  size: 250,
  premium: 62_500,
  openInterest: 1_200,
  impliedVolatility: 0.31,
  underlyingPrice: 192.5,
  provider: "massive",
  optionTicker: "O:AAPL260724C00200000",
  providerContractId: "flow-aapl-200-call",
  sourceBasis: "confirmed_trade",
  confidence: "confirmed_trade",
  isUnusual: true,
  unusualScore: 2.8,
};

const SECONDARY_ANALYSIS_CHAIN = [
  {
    contract: {
      ticker: "O:AAPL260724C00200000",
      providerContractId: "flow-aapl-200-call",
      underlying: "AAPL",
      expirationDate: "2026-07-24",
      right: "call",
      strike: 200,
    },
    bid: 2.4,
    ask: 2.6,
    last: 2.5,
    volume: 1_000,
    openInterest: 1_200,
    impliedVolatility: 0.31,
    delta: 0.46,
    gamma: 0.04,
    theta: -0.08,
    vega: 0.12,
    quoteFreshness: "live",
    quoteUpdatedAt: new Date().toISOString(),
  },
  {
    contract: {
      ticker: "O:AAPL260724P00200000",
      providerContractId: "flow-aapl-200-put",
      underlying: "AAPL",
      expirationDate: "2026-07-24",
      right: "put",
      strike: 200,
    },
    bid: 9.7,
    ask: 9.95,
    last: 9.8,
    volume: 820,
    openInterest: 980,
    impliedVolatility: 0.32,
    delta: -0.54,
    gamma: 0.04,
    theta: -0.09,
    vega: 0.12,
    quoteFreshness: "live",
    quoteUpdatedAt: new Date().toISOString(),
  },
] as const;

test.describe.configure({ mode: "serial" });

const EMPTY_OBJECT_GET_PATHS = new Set([
  "/api/algo/deployments",
  "/api/algo/events",
  "/api/broker-connections",
  "/api/broker-execution/robinhood/readiness",
  "/api/broker-execution/schwab/readiness",
  "/api/broker-execution/snaptrade/brokerages",
  "/api/charting/pine-scripts",
  "/api/flow/universe",
  "/api/news",
  "/api/research/status",
  "/api/settings/backend",
  "/api/universe/logos",
]);

const QUIET_EVENT_STREAM_PATHS = new Set([
  "/api/diagnostics/stream",
  "/api/signal-monitor/matrix/stream",
  "/api/streams/algo/cockpit",
  "/api/streams/executions",
  "/api/streams/options/chains",
  "/api/streams/stocks/aggregates",
]);

const allowedBackgroundMutation = (method: string, path: string) =>
  (method === "POST" && path === "/api/sparklines/seed") ||
  (method === "POST" && path === "/api/diagnostics/client-metrics");

const quoteFor = (symbol: string) => {
  const normalized = symbol.trim().toUpperCase();
  const price = normalized === "AAPL" ? 192.5 : 500;
  const updatedAt = new Date().toISOString();
  return {
    symbol: normalized,
    price,
    bid: price - 0.05,
    ask: price + 0.05,
    bidSize: 12,
    askSize: 14,
    change: 1.25,
    changePercent: 0.65,
    open: price - 1,
    high: price + 2,
    low: price - 2,
    prevClose: price - 1.25,
    volume: 1_250_000,
    providerContractId: null,
    source: "ibkr",
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: updatedAt,
    ageMs: 0,
    cacheAgeMs: 0,
    updatedAt,
  };
};

const positionFixture = () => {
  const updatedAt = new Date().toISOString();
  return {
    id: POSITION_ID,
    accountId: ACCOUNT_ID,
    accounts: [ACCOUNT_ID],
    symbol: "AAPL",
    description: "Apple Inc.",
    assetClass: "Equity",
    providerSecurityType: "STK",
    positionType: "stock",
    optionContract: null,
    marketDataSymbol: "AAPL",
    sector: "Technology",
    quantity: 4,
    averageCost: 185,
    mark: 192.5,
    dayChange: 1.25,
    dayChangePercent: 0.65,
    unrealizedPnl: 30,
    unrealizedPnlPercent: 4.05,
    marketValue: 770,
    weightPercent: 0.31,
    accountWeightPercent: 0.31,
    scopedWeightPercent: 100,
    betaWeightedDelta: 4,
    lots: [],
    openOrders: [],
    stopLoss: null,
    takeProfit: null,
    riskOverlay: null,
    source: "IBKR_POSITIONS",
    sourceType: "manual",
    strategyLabel: null,
    attributionStatus: "unknown",
    sourceAttribution: [],
    automationContext: null,
    openedAt: "2026-07-18T14:30:00.000Z",
    openedAtSource: "broker",
    quote: {
      bid: 192.45,
      ask: 192.55,
      mid: 192.5,
      last: 192.5,
      mark: 192.5,
      spread: 0.1,
      spreadPercent: 0.05,
      bidSize: 12,
      askSize: 14,
      updatedAt,
      freshness: "live",
      marketDataMode: "live",
      source: "bridge_quote",
      providerContractId: null,
      transport: "tws",
      delayed: false,
      dataUpdatedAt: updatedAt,
      ageMs: 0,
      cacheAgeMs: 0,
    },
  };
};

const linkedOrderFixture = {
  id: "order-aapl-stop-u123",
  accountId: ACCOUNT_ID,
  mode: "live",
  symbol: "AAPL",
  assetClass: "equity",
  side: "sell",
  type: "stop",
  timeInForce: "gtc",
  status: "submitted",
  quantity: 4,
  filledQuantity: 0,
  limitPrice: null,
  stopPrice: 180,
  placedAt: "2026-07-18T15:00:00.000Z",
  updatedAt: "2026-07-18T15:00:00.000Z",
  optionContract: null,
};

const barsFixture = (limit: number) => {
  const count = Math.max(2, Math.min(limit || 320, 1_200));
  const endMs = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const close = 188 + index * 0.015;
    return {
      timestamp: new Date(
        endMs - (count - index) * 5 * 60_000,
      ).toISOString(),
      open: close - 0.12,
      high: close + 0.2,
      low: close - 0.25,
      close,
      volume: 18_000 + index * 20,
      source: "fixture",
      transport: "massive",
      delayed: false,
      freshness: "live",
    };
  });
};

async function fulfillEventStream(
  route: Route,
  body: string,
  retryMs = 60_000,
) {
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: `retry: ${retryMs}\n${body}`,
  });
}

async function mockPositionActionsRuntime(
  page: Page,
  {
    holdPositions = false,
    initialPositionsState = "ready",
    chainState = "empty",
    flowState = "empty",
    theme = "dark",
  }: {
    holdPositions?: boolean;
    initialPositionsState?: "ready" | "error";
    chainState?: "empty" | "ready";
    flowState?: "empty" | "live" | "offline";
    theme?: "dark" | "light";
  } = {},
) {
  const unknownGetPaths = new Set<string>();
  const protectedMutations: string[] = [];
  const allowedBackgroundMutations: string[] = [];
  const allowedReadPosts: string[] = [];
  let positionsState = initialPositionsState;
  let positionsHeld = holdPositions;
  let releasePositionsGate = () => {};
  const positionsGate = new Promise<void>((resolve) => {
    releasePositionsGate = resolve;
  });

  await page.addInitScript(
    ({ accountId, appearanceTheme, showSecondaryAnalysis }) => {
      const NativeEventSource = window.EventSource;
      window.EventSource = class PositionActionsEventSource extends NativeEventSource {
        constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
          super(url, eventSourceInitDict);
          const path = new URL(String(url), window.location.href).pathname;
          if (
            path === "/api/streams/accounts" ||
            path === "/api/streams/orders"
          ) {
            // ponytail: this fixture models broker readiness only; replace it
            // with a shared controllable SSE harness if transport enters scope.
            window.setTimeout(() => {
              this.dispatchEvent(new MessageEvent("ready", { data: "{}" }));
            }, 0);
          }
        }
      };

      window.localStorage.setItem(
        "pyrus:state:v1",
        JSON.stringify({
          screen: "trade",
          sym: "AAPL",
          theme: appearanceTheme,
          selectedAccountId: accountId,
          tradeActiveTicker: "AAPL",
          tradeRecentTickers: ["AAPL"],
          ...(showSecondaryAnalysis
            ? {
                tradeContracts: {
                  AAPL: {
                    strike: 200,
                    cp: "C",
                    exp: "07/24",
                    providerContractId: "flow-aapl-200-call",
                  },
                },
              }
            : {}),
          tradeTicketExpanded: false,
          tradeExecutionMode: "real",
        }),
      );
    },
    {
      accountId: ACCOUNT_ID,
      appearanceTheme: theme,
      showSecondaryAnalysis: chainState === "ready",
    },
  );

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;

    if (method === "POST" && path === "/api/options/quotes") {
      allowedReadPosts.push(`${method} ${path}`);
      const payload = request.postDataJSON() as {
        providerContractIds?: string[];
      };
      const updatedAt = new Date().toISOString();
      const quotes = (payload.providerContractIds || [])
        .map((providerContractId) => {
          const contract = SECONDARY_ANALYSIS_CHAIN.find(
            (candidate) =>
              candidate.contract.providerContractId === providerContractId,
          );
          if (!contract) return null;
          return {
            symbol: contract.contract.ticker,
            price: contract.last,
            bid: contract.bid,
            ask: contract.ask,
            bidSize: 12,
            askSize: 14,
            change: null,
            changePercent: null,
            open: null,
            high: null,
            low: null,
            prevClose: null,
            volume: contract.volume,
            underlyingPrice: 192.5,
            providerContractId,
            source: "massive",
            transport: "massive",
            delayed: false,
            freshness: "live",
            marketDataMode: "live",
            dataUpdatedAt: updatedAt,
            ageMs: 0,
            cacheAgeMs: 0,
            updatedAt,
          };
        })
        .filter(Boolean);
      await route.fulfill({
        json: {
          underlying: "AAPL",
          quotes,
          transport: "massive",
          delayed: false,
          fallbackUsed: false,
        },
      });
      return;
    }

    if (allowedBackgroundMutation(method, path)) {
      allowedBackgroundMutations.push(`${method} ${path}`);
      if (path === "/api/sparklines/seed") {
        const payload = request.postDataJSON() as {
          symbols?: unknown[];
          timeframe?: string;
        };
        await route.fulfill({
          json: {
            timeframe: payload.timeframe || "5m",
            source: "fixture",
            historySource: "fixture",
            requestedSymbolCount: payload.symbols?.length || 0,
            hydratedSymbolCount: 0,
            items: [],
          },
        });
      } else {
        await route.fulfill({ status: 202, json: {} });
      }
      return;
    }

    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }

    if (method !== "GET") {
      protectedMutations.push(`${method} ${path}`);
      await route.fulfill({
        status: 405,
        json: { error: "Protected mutation blocked by position-actions QA." },
      });
      return;
    }

    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "position-actions-admin",
            email: "position-actions@example.com",
            role: "admin",
            entitlements: [],
          },
          csrfToken: "position-actions-csrf",
        },
      });
      return;
    }

    if (path === "/api/session") {
      const timestamp = new Date().toISOString();
      await route.fulfill({
        json: {
          environment: "live",
          brokerProvider: "ibkr",
          marketDataProvider: "ibkr",
          marketDataProviders: {
            live: "ibkr",
            historical: "ibkr",
            research: "fmp",
          },
          configured: { massive: false, ibkr: true, research: false },
          ibkrBridge: {
            configured: true,
            authenticated: true,
            connected: true,
            competing: false,
            selectedAccountId: ACCOUNT_ID,
            accounts: [ACCOUNT_ID],
            lastTickleAt: timestamp,
            lastError: null,
            lastRecoveryAttemptAt: null,
            lastRecoveryError: null,
            updatedAt: timestamp,
            transport: "tws",
            connectionTarget: "mock",
            sessionMode: "live",
            clientId: 7,
            marketDataMode: "live",
            liveMarketDataAvailable: true,
            healthFresh: true,
            healthAgeMs: 0,
            stale: false,
            bridgeReachable: true,
            socketConnected: true,
            accountsLoaded: true,
            configuredLiveMarketDataMode: true,
            streamFresh: true,
            streamState: "live",
            streamStateReason: null,
            lastStreamEventAgeMs: 0,
            strictReady: true,
            strictReason: null,
            connections: {},
          },
          runtime: { ibkr: {} },
          timestamp,
        },
      });
      return;
    }

    if (path === "/api/settings/preferences") {
      await route.fulfill({
        json: {
          profileKey: "default",
          version: 1,
          preferences: {
            appearance: {
              theme,
              reducedMotion: "on",
            },
            onboarding: {
              schemaVersion: 1,
              autoOpenShownVersion: 1,
              requiredNoticeSeenVersion: 1,
              requiredNoticeResolvedVersion: 1,
              requiredAcknowledgedVersion: 1,
              readinessInspectedVersion: 1,
              activeTrackId: null,
              tracks: {},
            },
            trading: { confirmOrders: true },
          },
          source: "database",
          updatedAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (path === "/api/accounts") {
      await route.fulfill({
        json: {
          accounts: [
            {
              id: ACCOUNT_ID,
              providerAccountId: ACCOUNT_ID,
              provider: "ibkr",
              mode: "live",
              displayName: "Direct IBKR",
              currency: "USD",
              buyingPower: 100_000,
              cash: 50_000,
              netLiquidation: 250_000,
              dayPnl: 1_250,
              dayPnlPercent: 0.5,
              accountType: "individual",
              includedInTrading: true,
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      });
      return;
    }

    if (path === `/api/accounts/${ACCOUNT_ID}/positions`) {
      if (positionsHeld) {
        await positionsGate;
      }
      if (positionsState === "error") {
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic positions read unavailable" },
        });
        return;
      }
      await route.fulfill({
        json: {
          accountId: ACCOUNT_ID,
          currency: "USD",
          positions: [positionFixture()],
          totals: {},
          updatedAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (path === "/api/positions") {
      await route.fulfill({ json: { positions: [] } });
      return;
    }

    if (path === "/api/accounts/shadow/positions") {
      await route.fulfill({
        json: {
          accountId: "shadow",
          currency: "USD",
          positions: [],
          totals: {},
          updatedAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (path === "/api/orders") {
      await route.fulfill({ json: { orders: [linkedOrderFixture] } });
      return;
    }

    if (path === "/api/executions") {
      await route.fulfill({ json: { executions: [] } });
      return;
    }

    if (path === "/api/broker-execution/ibkr-portal/readiness") {
      await route.fulfill({
        json: {
          status: "connected",
          gatewayRunning: true,
          authenticated: true,
          browserLoginComplete: true,
          apiSessionActivationFailed: false,
          established: true,
          isPaper: true,
          selectedAccountId: ACCOUNT_ID,
          accounts: [ACCOUNT_ID],
          executionTargets: [
            {
              accountId: ACCOUNT_ID,
              maskedAccountId: ACCOUNT_ID,
              selected: true,
            },
          ],
          controlledOrder: {
            status: "none",
            accountId: null,
            orderId: null,
            symbol: null,
            side: null,
            quantity: null,
            limitPrice: null,
            replacementUsed: false,
            cancelAttempted: false,
            reason: null,
          },
          loginPath: null,
          message: "Connected",
        },
      });
      return;
    }

    if (path === "/api/watchlists") {
      await route.fulfill({ json: { watchlists: [] } });
      return;
    }

    if (path === "/api/quotes/snapshot") {
      const symbols = (url.searchParams.get("symbols") || "")
        .split(",")
        .filter(Boolean);
      await route.fulfill({
        json: {
          quotes: symbols.map(quoteFor),
          transport: "tws",
          delayed: false,
          fallbackUsed: false,
        },
      });
      return;
    }

    if (path === "/api/bars") {
      const limit = Number(url.searchParams.get("limit")) || 320;
      const bars = barsFixture(limit);
      await route.fulfill({
        json: {
          symbol: url.searchParams.get("symbol") || "AAPL",
          timeframe: url.searchParams.get("timeframe") || "5m",
          bars,
          transport: "massive",
          delayed: false,
          gapFilled: false,
          freshness: "live",
          marketDataMode: "live",
          dataUpdatedAt: bars.at(-1)?.timestamp || null,
          ageMs: 0,
          emptyReason: null,
          historySource: "fixture",
          studyFallback: false,
          historyPage: null,
        },
      });
      return;
    }

    if (path === "/api/options/expirations") {
      await route.fulfill({
        json: {
          underlying: url.searchParams.get("underlying") || "AAPL",
          expirations:
            chainState === "ready"
              ? [{ expirationDate: "2026-07-24" }]
              : [],
        },
      });
      return;
    }

    if (path === "/api/options/chains") {
      await route.fulfill({
        json: {
          underlying: url.searchParams.get("underlying") || "AAPL",
          expirationDate: url.searchParams.get("expirationDate"),
          contracts:
            chainState === "ready" ? SECONDARY_ANALYSIS_CHAIN : [],
        },
      });
      return;
    }

    if (path === "/api/options/chart-bars") {
      await route.fulfill({ json: {} });
      return;
    }

    if (path === "/api/flow/events") {
      if (flowState === "offline") {
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic flow history unavailable" },
        });
        return;
      }
      await route.fulfill({
        json: {
          events: flowState === "live" ? [FLOW_CONTEXT_EVENT] : [],
          source: {
            provider: "massive",
            status: flowState === "live" ? "loaded" : "empty",
          },
        },
      });
      return;
    }

    if (path === "/api/flow/events/aggregate") {
      if (flowState === "offline") {
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic aggregate flow unavailable" },
        });
        return;
      }
      await route.fulfill({
        json: {
          events: flowState === "live" ? [FLOW_CONTEXT_EVENT] : [],
          source: {
            provider: "massive",
            status: flowState === "live" ? "loaded" : "empty",
          },
        },
      });
      return;
    }

    if (path === "/api/signal-monitor/profile") {
      const now = new Date().toISOString();
      await route.fulfill({
        json: {
          id: "position-actions-profile",
          environment: "shadow",
          enabled: false,
          watchlistId: null,
          timeframe: "5m",
          pyrusSignalsSettings: {},
          freshWindowBars: 2,
          pollIntervalSeconds: 60,
          maxSymbols: 25,
          evaluationConcurrency: 1,
          lastEvaluatedAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      return;
    }

    if (path === "/api/signal-monitor/events") {
      await route.fulfill({ json: { events: [] } });
      return;
    }

    if (path === "/api/broker-execution/included-accounts") {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }

    if (path === "/api/broker-execution/snaptrade/readiness") {
      await route.fulfill({
        json: {
          provider: "snaptrade",
          configured: false,
          status: "unconfigured",
          checkedAt: new Date().toISOString(),
          executionDecision: {
            decisionCode: "PROVIDER_RESEARCH_REQUIRED",
            gateFamily: "provider",
            outcome: "blocked",
            customerMessageKey: "broker.provider.researchRequired",
            severity: "blocked",
            auditEventHint: "broker_provider_research_required",
            redactionClass: "customer_safe",
          },
          credentials: { clientIdPresent: false, apiKeyPresent: false },
          user: {
            registered: false,
            status: "not_registered",
            snapTradeUserIdPresent: false,
            userSecretStored: false,
            registeredAt: null,
            disabledAt: null,
            nextAction: "register_snaptrade_user",
          },
          clientInfo: null,
          brokerages: null,
          limitations: [
            "snaptrade.client_id_missing",
            "snaptrade.api_key_missing",
            "snaptrade.provider_research_required",
          ],
          upstream: null,
        },
      });
      return;
    }

    if (
      path === "/api/streams/accounts" ||
      path === "/api/streams/orders"
    ) {
      await fulfillEventStream(route, "event: ready\ndata: {}\n\n", 5_000);
      return;
    }

    if (path === "/api/streams/quotes") {
      const symbols = (url.searchParams.get("symbols") || "")
        .split(",")
        .filter(Boolean);
      const payload = JSON.stringify({ quotes: symbols.map(quoteFor) });
      await fulfillEventStream(
        route,
        `event: quotes\ndata: ${payload}\n\n`,
        5_000,
      );
      return;
    }

    if (QUIET_EVENT_STREAM_PATHS.has(path)) {
      await fulfillEventStream(route, "\n");
      return;
    }

    if (/^\/api\/gex\/[^/]+\/(?:projection|zero-gamma)$/.test(path)) {
      await route.fulfill({ json: {} });
      return;
    }

    if (EMPTY_OBJECT_GET_PATHS.has(path)) {
      await route.fulfill({ json: {} });
      return;
    }

    unknownGetPaths.add(path);
    await route.fulfill({
      status: 501,
      json: { error: `Unexpected fixture GET: ${path}` },
    });
  });

  return {
    unknownGetPaths,
    protectedMutations,
    allowedBackgroundMutations,
    allowedReadPosts,
    releasePositions: () => {
      positionsHeld = false;
      releasePositionsGate();
    },
    setPositionsState: (state: "ready" | "error") => {
      positionsState = state;
    },
  };
}

async function expectContainedInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function attachTradeContextScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    path,
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
  await testInfo.attach(name, {
    path,
    contentType: "image/png",
  });
}

async function publishSyntheticTradeFlow(
  page: Page,
  status: "live" | "stale" | "offline",
) {
  // ponytail: this read-only fixture seeds the public UI store because chart
  // hydration intentionally gates network flow; replace it with a controllable
  // hydration-ready harness if runtime scheduling enters this acceptance scope.
  await page.evaluate(
    async ({ flowStatus, event }) => {
      const store = await import(
        "/src/features/platform/tradeFlowStore.js"
      );
      store.publishTradeFlowSnapshot("AAPL", {
        status: flowStatus,
        events: flowStatus === "offline" ? [] : [event],
        source: {
          provider: "fixture",
          status: flowStatus,
        },
      });
    },
    { flowStatus: status, event: FLOW_CONTEXT_EVENT },
  );
}

test("phone Trade distinguishes pending positions, failed positions, and offline flow", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const fixture = await mockPositionActionsRuntime(page, {
    holdPositions: true,
    initialPositionsState: "error",
    flowState: "offline",
  });

  await page.goto(`${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=trade`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("screen-host-trade")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
    timeout: READY_TIMEOUT_MS,
  });

  await page
    .getByTestId("trade-mobile-tabs")
    .getByRole("button", { name: "Positions", exact: true })
    .click();
  await expect(
    page.getByText("Loading open positions", { exact: true }),
  ).toBeVisible({ timeout: READY_TIMEOUT_MS });

  fixture.releasePositions();
  const unavailable = page.getByText("Positions unavailable", {
    exact: true,
  });
  await expect(unavailable).toBeVisible({ timeout: READY_TIMEOUT_MS });
  const retry = page.getByRole("button", {
    name: "Retry positions",
    exact: true,
  });
  const retryBox = await retry.boundingBox();
  expect(retryBox).not.toBeNull();
  expect(retryBox!.height).toBeGreaterThanOrEqual(43);

  fixture.setPositionsState("ready");
  await retry.click();
  await expect(page.getByTestId("trade-open-positions-table-scroll")).toContainText(
    "AAPL",
    { timeout: READY_TIMEOUT_MS },
  );

  await page
    .getByTestId("trade-mobile-tabs")
    .getByRole("button", { name: "Chain", exact: true })
    .click();
  await publishSyntheticTradeFlow(page, "offline");
  await expect(page.getByTestId("trade-spot-flow-status")).toContainText(
    "Flow unavailable",
    { timeout: READY_TIMEOUT_MS },
  );
  await expect(page.getByTestId("trade-options-flow-status")).toContainText(
    "Flow unavailable",
    { timeout: READY_TIMEOUT_MS },
  );
  await expect(page.getByTestId("trade-spot-flow-panel")).toContainText(
    "OFFLINE",
  );
  await expect(page.getByTestId("trade-options-flow-panel")).toContainText(
    "OFFLINE",
  );

  await attachTradeContextScreenshot(
    page,
    testInfo,
    "trade-phone-offline-flow",
  );
  await publishSyntheticTradeFlow(page, "stale");
  await expect(page.getByTestId("trade-spot-flow-status")).toContainText(
    "Showing last captured flow",
  );
  await expect(page.getByTestId("trade-options-flow-status")).toContainText(
    "Showing last captured flow",
  );
  await expect(page.getByTestId("trade-spot-flow-panel")).toContainText(
    "STALE",
  );
  expect(fixture.protectedMutations).toEqual([]);
  expect(fixture.unknownGetPaths).toEqual(new Set());
});

for (const presentation of TRADE_CONTEXT_PRESENTATIONS) {
  test(`${presentation.id} keeps positions and flow context reviewable`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({
      width: presentation.width,
      height: presentation.height,
    });
    await page.emulateMedia({
      colorScheme: presentation.colorScheme,
      reducedMotion: "reduce",
    });
    const fixture = await mockPositionActionsRuntime(page, {
      flowState: "live",
      theme: presentation.colorScheme,
    });
    const protectedMutationRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.startsWith("/api/") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        !allowedBackgroundMutation(request.method(), url.pathname)
      ) {
        protectedMutationRequests.push(`${request.method()} ${url.pathname}`);
      }
    });

    await page.goto(
      `${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=trade`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("screen-host-trade")).toBeVisible({
      timeout: READY_TIMEOUT_MS,
    });
    await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
      timeout: READY_TIMEOUT_MS,
    });

    const tradeLayout = page.locator(".ra-panel-enter[data-trade-layout]");
    await expect(tradeLayout).toBeVisible({ timeout: READY_TIMEOUT_MS });
    const usesPhonePanels =
      (await tradeLayout.getAttribute("data-trade-layout")) === "phone";
    if (usesPhonePanels) {
      await page
        .getByTestId("trade-mobile-tabs")
        .getByRole("button", { name: "Chain", exact: true })
        .click();
    }
    await publishSyntheticTradeFlow(page, "live");

    const spotFlowPanel = page.getByTestId("trade-spot-flow-panel");
    const optionsFlowPanel = page.getByTestId("trade-options-flow-panel");
    const expectedFlowMeta = usesPhonePanels ? "WAITING" : "LIVE";
    await spotFlowPanel.scrollIntoViewIfNeeded();
    await expect(spotFlowPanel).toContainText(expectedFlowMeta, {
      timeout: READY_TIMEOUT_MS,
    });
    await expect(spotFlowPanel).toContainText("1 prints");
    await expect(optionsFlowPanel).toContainText(expectedFlowMeta);
    await expect(optionsFlowPanel).toContainText("AAPL");
    if (usesPhonePanels) {
      await expect(spotFlowPanel).toContainText("Showing last captured flow");
      await expect(optionsFlowPanel).toContainText(
        "Showing last captured flow",
      );
    } else {
      await expect(page.getByTestId("trade-spot-flow-status")).toHaveCount(0);
      await expect(page.getByTestId("trade-options-flow-status")).toHaveCount(
        0,
      );
    }
    await attachTradeContextScreenshot(
      page,
      testInfo,
      `trade-${presentation.id}-flow`,
    );

    if (usesPhonePanels) {
      await page
        .getByTestId("trade-mobile-tabs")
        .getByRole("button", { name: "Positions", exact: true })
        .click();
    }
    const positionsZone = page.getByTestId("trade-bottom-zone");
    await positionsZone.scrollIntoViewIfNeeded();
    const positionsScroll = page.getByTestId(
      "trade-open-positions-table-scroll",
    );
    await expect(positionsScroll).toContainText("AAPL", {
      timeout: READY_TIMEOUT_MS,
    });
    await positionsScroll.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });

    const actionMenu = page.getByTestId("trade-position-row-action-menu");
    const primaryAction = actionMenu.getByRole("button", {
      name: /Load AAPL EQUITY into the order ticket/u,
    });
    const moreActions = actionMenu.getByRole("button", {
      name: "More actions for AAPL",
    });
    await expect(primaryAction).toBeVisible();
    await expect(moreActions).toBeVisible();
    if (presentation.width < 1024) {
      expect((await primaryAction.boundingBox())!.height).toBeGreaterThanOrEqual(
        43,
      );
      expect((await moreActions.boundingBox())!.height).toBeGreaterThanOrEqual(
        43,
      );
    }

    await moreActions.click();
    const menu = page.getByTestId("trade-position-row-action-menu-content");
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: /^Close position/u }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: /Protect|Cancel|Adjust|Focus/iu }),
    ).toHaveCount(0);
    await attachTradeContextScreenshot(
      page,
      testInfo,
      `trade-${presentation.id}-positions`,
    );
    await page.keyboard.press("Escape");

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(protectedMutationRequests).toEqual([]);
    expect(fixture.protectedMutations).toEqual([]);
    expect(fixture.unknownGetPaths).toEqual(new Set());
  });
}

for (const presentation of TRADE_CONTEXT_PRESENTATIONS) {
  test(`${presentation.id} keeps secondary Trade analysis truthful and subordinate`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({
      width: presentation.width,
      height: presentation.height,
    });
    await page.emulateMedia({
      colorScheme: presentation.colorScheme,
      reducedMotion: "reduce",
    });
    const fixture = await mockPositionActionsRuntime(page, {
      chainState: "ready",
      flowState: "live",
      theme: presentation.colorScheme,
    });

    await page.goto(
      `${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=trade`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("screen-host-trade")).toBeVisible({
      timeout: READY_TIMEOUT_MS,
    });
    await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
      timeout: READY_TIMEOUT_MS,
    });

    const tradeLayout = page.locator(".ra-panel-enter[data-trade-layout]");
    await expect(tradeLayout).toBeVisible({ timeout: READY_TIMEOUT_MS });
    const usesPhonePanels =
      (await tradeLayout.getAttribute("data-trade-layout")) === "phone";
    if (usesPhonePanels) {
      await page
        .getByTestId("trade-mobile-tabs")
        .getByRole("button", { name: "Positions", exact: true })
        .click();
    }

    const strategyContent = page.getByTestId(
      "trade-strategy-greeks-content",
    );
    await strategyContent.scrollIntoViewIfNeeded();
    await expect(strategyContent).toHaveAttribute(
      "data-greeks-state",
      "ready",
      { timeout: READY_TIMEOUT_MS },
    );
    await expect(strategyContent).toContainText("CONTRACT PRESETS");
    await expect(strategyContent).toContainText("4/4 AVAILABLE");
    await expect(strategyContent).toContainText("It does not submit");
    const strategyButton = page.getByTestId("trade-strategy-long_call_atm");
    await expect(strategyButton).toBeEnabled();
    if (presentation.width < 1024) {
      expect((await strategyButton.boundingBox())!.height).toBeGreaterThanOrEqual(
        43,
      );
    }
    await strategyButton.focus();
    await strategyButton.press("Enter");
    await publishSyntheticTradeFlow(page, "live");

    let l2Scope: Locator | null = null;
    let l2Content = page.getByTestId("trade-l2-content");
    let l2Trigger: Locator | null = null;
    if (usesPhonePanels) {
      l2Trigger = page
        .getByTestId("trade-bottom-zone")
        .getByRole("button", { name: "L2", exact: true });
      expect((await l2Trigger.boundingBox())!.height).toBeGreaterThanOrEqual(43);
      await l2Trigger.click();
      l2Scope = page.getByTestId("trade-mobile-l2-drawer");
      await expect(l2Scope).toBeVisible();
      await expectContainedInViewport(page, l2Scope);
      l2Content = l2Scope.getByTestId("trade-l2-content");
    } else {
      await l2Content.scrollIntoViewIfNeeded();
    }

    await expect(l2Content).toHaveAttribute(
      "data-book-quote-state",
      "ready",
    );
    await expect(l2Content).toContainText("0.20 sprd");
    await expect(l2Content).toContainText("Option depth unavailable");
    await attachTradeContextScreenshot(
      page,
      testInfo,
      `trade-${presentation.id}-secondary-analysis`,
    );

    const flowTab = l2Content.getByRole("tab", { name: "FLOW" });
    await flowTab.focus();
    await flowTab.press("Enter");
    await expect(l2Content).toHaveAttribute(
      "data-flow-state",
      /^(live|waiting)$/,
      { timeout: READY_TIMEOUT_MS },
    );
    const flowState = await l2Content.getAttribute("data-flow-state");
    await expect(l2Content).toContainText(
      flowState === "live" ? "flow: live" : "Showing last captured flow",
    );
    await expect(l2Content).not.toContainText("NaN");

    const tapeTab = l2Content.getByRole("tab", { name: "TAPE" });
    await tapeTab.focus();
    await tapeTab.press("Enter");
    await expect(l2Content).toHaveAttribute(
      "data-tape-state",
      flowState === "live" ? "empty" : "waiting",
      { timeout: READY_TIMEOUT_MS },
    );
    await expect(l2Content).toContainText(
      flowState === "live" ? "No broker fills yet" : "Broker fills waiting",
    );
    if (usesPhonePanels) {
      await page.keyboard.press("Escape");
      await expect(l2Scope!).toBeHidden();
      await expect(l2Trigger!).toBeFocused();
    }

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(fixture.protectedMutations).toEqual([]);
    expect(fixture.unknownGetPaths).toEqual(new Set());
    expect(fixture.allowedReadPosts.length).toBeGreaterThan(0);
    expect(
      fixture.allowedReadPosts.every(
        (entry) => entry === "POST /api/options/quotes",
      ),
    ).toBe(true);
  });
}

for (const presentation of TRADE_CONTEXT_PRESENTATIONS) {
  test(`${presentation.id} keeps the Trade ticket decision path ordered and review-only`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({
      width: presentation.width,
      height: presentation.height,
    });
    await page.emulateMedia({
      colorScheme: presentation.colorScheme,
      reducedMotion: "reduce",
    });
    const fixture = await mockPositionActionsRuntime(page, {
      chainState: "ready",
      theme: presentation.colorScheme,
    });

    await page.goto(
      `${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=trade`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByTestId("screen-host-trade")).toBeVisible({
      timeout: READY_TIMEOUT_MS,
    });
    await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
      timeout: READY_TIMEOUT_MS,
    });

    const ticketZone = page.getByTestId("trade-order-ticket-zone");
    const expandTicket = ticketZone.getByRole("button", {
      name: "Expand order ticket",
      exact: true,
    });
    await expandTicket.focus();
    await expandTicket.press("Enter");
    await expect(ticketZone).toHaveAttribute("data-expanded", "true");

    const ticket = ticketZone.getByTestId("trade-order-ticket");
    await expect(ticket).toBeVisible({ timeout: READY_TIMEOUT_MS });
    await attachTradeContextScreenshot(
      page,
      testInfo,
      `trade-${presentation.id}-ticket-route`,
    );
    const renderedSectionIds = await ticket
      .locator("[data-testid$='-section']")
      .evaluateAll((sections) =>
        sections.map((section) => section.getAttribute("data-testid")),
      );
    expect(renderedSectionIds).toEqual([...TRADE_TICKET_SECTION_IDS]);

    for (const [sectionId, heading] of [
      ["trade-ticket-route-section", "Route & account"],
      ["trade-ticket-asset-section", "Asset & market"],
      ["trade-ticket-order-section", "Order setup"],
      ["trade-ticket-estimate-section", "Estimate"],
      ["trade-ticket-review-section", "Review"],
    ] as const) {
      const section = ticket.getByTestId(sectionId);
      await section.scrollIntoViewIfNeeded();
      await expect(
        section.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }

    const orderSection = ticket.getByTestId("trade-ticket-order-section");
    await expect(orderSection.getByTestId("trade-ticket-side-controls")).toBeVisible();
    await expect(
      orderSection.getByTestId("trade-ticket-quantity-controls"),
    ).toBeVisible();
    await expect(
      orderSection.getByTestId("trade-ticket-order-type-controls"),
    ).toBeVisible();
    await expect(
      orderSection.getByTestId("trade-ticket-price-controls"),
    ).toBeVisible();
    await expect(
      ticket.getByTestId("trade-ticket-estimate-section"),
    ).toContainText("P&L AT EXPIRATION");
    await expect(
      ticket.getByTestId("trade-ticket-review-section"),
    ).toContainText("Preview first");

    if (presentation.width < 1024) {
      const touchControls = [
        ticket.getByLabel("IBKR execution account"),
        ticket
          .getByTestId("trade-ticket-option-actions")
          .getByRole("button")
          .first(),
        ticket
          .getByTestId("trade-ticket-quantity-controls")
          .getByRole("button")
          .first(),
        ticket.getByTestId("trade-ticket-preview-action"),
        ticket.getByTestId("trade-ticket-submit-action"),
      ];
      for (const control of touchControls) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(43);
      }
    }

    expect(
      await ticket.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await attachTradeContextScreenshot(
      page,
      testInfo,
      `trade-${presentation.id}-ticket-review`,
    );

    const collapseTicket = ticketZone.getByRole("button", {
      name: "Collapse order ticket",
      exact: true,
    });
    await collapseTicket.focus();
    await collapseTicket.press("Enter");
    await expect(ticketZone).toHaveAttribute("data-expanded", "false");
    await expect(expandTicket).toBeFocused();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(fixture.protectedMutations).toEqual([]);
    expect(fixture.unknownGetPaths).toEqual(new Set());
    expect(
      fixture.allowedReadPosts.every(
        (entry) => entry === "POST /api/options/quotes",
      ),
    ).toBe(true);
  });
}

test("phone position actions stay touch-safe and hand close into a review-only ticket", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await mockPositionActionsRuntime(page);

  const protectedMutationRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      !allowedBackgroundMutation(request.method(), url.pathname)
    ) {
      protectedMutationRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto(`${APP_URL}${APP_URL.includes("?") ? "&" : "?"}screen=trade`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("screen-host-trade")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
    timeout: READY_TIMEOUT_MS,
  });

  await page
    .getByTestId("trade-mobile-tabs")
    .getByRole("button", { name: "Positions", exact: true })
    .click();

  const scroll = page.getByTestId("trade-open-positions-table-scroll");
  await expect(scroll).toBeVisible({ timeout: READY_TIMEOUT_MS });
  await expect(
    scroll.getByRole("row").filter({ hasText: "AAPL" }),
  ).toHaveCount(1);
  await scroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });

  const split = page.getByTestId("trade-position-row-action-menu");
  const primary = split.getByRole("button", {
    name: /Load AAPL EQUITY into the order ticket/,
  });
  const more = split.getByRole("button", {
    name: "More actions for AAPL",
  });
  await expect(more).toBeVisible();

  const [primaryBox, moreBox] = await Promise.all([
    primary.boundingBox(),
    more.boundingBox(),
  ]);
  expect(primaryBox).not.toBeNull();
  expect(moreBox).not.toBeNull();
  expect(primaryBox!.width).toBeGreaterThanOrEqual(44);
  expect(primaryBox!.height).toBeGreaterThanOrEqual(44);
  expect(moreBox!.width).toBeGreaterThanOrEqual(44);
  expect(moreBox!.height).toBeGreaterThanOrEqual(44);
  await expectContainedInViewport(page, split);
  await expectContainedInViewport(page, more);

  await more.click();
  const menu = page.getByTestId("trade-position-row-action-menu-content");
  await expect(menu).toBeVisible();
  await expectContainedInViewport(page, menu);

  const menuItems = menu.getByRole("menuitem");
  await expect(menuItems).toHaveCount(2, { timeout: READY_TIMEOUT_MS });
  await expect(menuItems).toHaveText(["1 order", "Close position"], {
    timeout: READY_TIMEOUT_MS,
  });
  for (let index = 0; index < 2; index += 1) {
    const item = menuItems.nth(index);
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await expectContainedInViewport(page, item);
  }
  await expect(
    menu.getByRole("menuitem", { name: /Protect|Cancel|Adjust|Focus/i }),
  ).toHaveCount(0);
  await expect(page.getByText(OLD_POSITION_MANAGEMENT_BLOCKER, { exact: true }))
    .toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();

  await menu.getByRole("menuitem", { name: "1 order", exact: true }).click();
  const ordersTable = page.getByTestId("trade-live-orders-table-scroll");
  await expect(ordersTable).toBeVisible();
  await expect(ordersTable).toContainText("AAPL");
  await expect(ordersTable).toContainText("Submitted");

  const ticketZone = page.getByTestId("trade-order-ticket-zone");
  if ((await ticketZone.getAttribute("data-expanded")) === "true") {
    await ticketZone
      .getByRole("button", {
        name: /^(?:Open|Collapse)(?: AAPL)? order ticket$/,
      })
      .click();
    await expect(ticketZone).toHaveAttribute("data-expanded", "false");
  }

  await page
    .getByRole("tablist", { name: "Trade positions view" })
    .getByRole("tab", { name: /OPEN/ })
    .click();
  await expect(scroll).toBeVisible();
  await scroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });

  await more.click();
  await expect(menu).toBeVisible();
  const closePosition = menu.getByRole("menuitem", {
    name: /^Close position/,
  });
  await expect(closePosition).not.toHaveAttribute("aria-disabled", "true", {
    timeout: READY_TIMEOUT_MS,
  });
  await closePosition.click();

  const ticket = page.getByTestId("trade-order-ticket");
  const closeReview = ticket.getByTestId("trade-ticket-close-review");
  await expect(ticket).toBeVisible({ timeout: READY_TIMEOUT_MS });
  await expect(
    ticketZone.getByRole("button", {
      name: "Collapse AAPL order ticket",
      exact: true,
    }),
  ).toBeVisible();
  await expect(closeReview).toContainText("POSITION CLOSE REVIEW");
  await expect(closeReview).toContainText("SELL 4 SHARES · IBKR U123", {
    timeout: READY_TIMEOUT_MS,
  });
  await expect(closeReview).toContainText(
    "Review only. Preview, tax checks, and explicit confirmation are still required before submission.",
    { timeout: READY_TIMEOUT_MS },
  );
  await expect(ticket.getByLabel("shares quantity")).toHaveValue("4");
  await expect(
    ticket
      .getByRole("tablist", { name: "Order type" })
      .getByRole("tab", { name: "LMT", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    ticket
      .getByRole("tablist", { name: "Time in force" })
      .getByRole("tab", { name: "DAY", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  const taxStrip = ticket.getByTestId("trade-ticket-tax-compliance-strip");
  await expect(taxStrip).toContainText("Not run");
  await expect(taxStrip).toContainText("Runs before live submission.");
  await attachTradeContextScreenshot(
    page,
    testInfo,
    "trade-phone-close-review",
  );
  await expect(
    ticket.getByRole("button", { name: "PREVIEW IBKR", exact: true }),
  ).toBeVisible();
  await expect(
    ticket.getByRole("button", {
      name: "IBKR LIVE NOT READY",
      exact: true,
    }),
  ).toBeDisabled();

  expect(protectedMutationRequests).toEqual([]);
  expect(fixture.protectedMutations).toEqual([]);
  expect(fixture.unknownGetPaths).toEqual(new Set());
  expect(
    fixture.allowedBackgroundMutations.every((entry) =>
      [
        "POST /api/sparklines/seed",
        "POST /api/diagnostics/client-metrics",
      ].includes(entry),
    ),
  ).toBe(true);
});

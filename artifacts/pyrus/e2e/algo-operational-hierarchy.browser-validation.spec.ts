import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { SIGNAL_OPTIONS_DEFAULT_PROFILE } from "../src/screens/algo/algoHelpers.js";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 20_000;
const DEPLOYMENT_ID = "risk-unit-responsive-deployment";
const FIXTURE_NOW = "2026-07-19T18:00:00.000Z";
const ACTIVE_SHADOW_DEPLOYMENT_ID = "ux18-shadow-options";
const ACTIVE_LIVE_DEPLOYMENT_ID = "ux18-live-options";
const BROKER_ACCOUNT_ID = "UX18-IBKR-01";
const ROBINHOOD_AGENTIC_ACCOUNT_ID = "UX18-RH-AGENTIC-01";
const ROBINHOOD_PERSONAL_ACCOUNT_ID = "UX18-RH-PERSONAL-01";
const SCHWAB_ACCOUNT_ID = "UX18-SCHWAB-01";
const SNAPTRADE_ACCOUNT_ID = "UX18-SNAPTRADE-01";
const IBKR_ACCOUNT_ID = "UX18-IBKR-ALGO-01";
const ACTIVE_FIXTURE_NOW = new Date().toISOString();
const ACTIVE_SIGNAL_AT = new Date(Date.now() - 2 * 60_000).toISOString();

const allowedBackgroundMutation = (method: string, path: string) =>
  (method === "POST" && path === "/api/sparklines/seed") ||
  (method === "POST" && path === "/api/diagnostics/client-metrics") ||
  (method === "POST" && path === "/api/options/quotes");

const quietEventStreamPaths = new Set([
  "/api/diagnostics/stream",
  "/api/signal-monitor/matrix/stream",
  "/api/streams/accounts/shadow",
  "/api/streams/algo/cockpit",
  "/api/streams/executions",
  "/api/streams/options/chains",
  "/api/streams/quotes",
  "/api/streams/stocks/aggregates",
]);

const emptyObjectGetPaths = new Set([
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

const riskProfile = {
  ...SIGNAL_OPTIONS_DEFAULT_PROFILE,
  riskCaps: {
    ...SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps,
    maxPremiumPerEntrySetting: { unit: "usd", value: 1_500 },
    maxPremiumPerEntry: 1_500,
    maxDailyLossSetting: { unit: "usd", value: 1_000 },
    maxDailyLoss: 1_000,
    tradingAllowance: 10_000,
  },
};

const deployment = {
  id: DEPLOYMENT_ID,
  strategyId: "risk-unit-responsive-strategy",
  name: "Risk Unit Responsive Review",
  mode: "shadow",
  enabled: false,
  providerAccountId: "shadow",
  symbolUniverse: [],
  config: {
    parameters: {
      executionMode: "signal_options",
      signalTimeframe: "5m",
      timeHorizon: 8,
    },
    signalOptions: riskProfile,
  },
  lastEvaluatedAt: null,
  lastSignalAt: null,
  lastError: null,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
};

const activeShadowDeployment = {
  ...deployment,
  id: ACTIVE_SHADOW_DEPLOYMENT_ID,
  strategyId: "ux18-shadow-strategy",
  name: "Momentum Options Shadow",
  providerAccountId: "shadow",
  symbolUniverse: ["NVDA", "TSLA"],
  lastEvaluatedAt: ACTIVE_FIXTURE_NOW,
  lastSignalAt: ACTIVE_SIGNAL_AT,
  createdAt: ACTIVE_FIXTURE_NOW,
  updatedAt: ACTIVE_FIXTURE_NOW,
};

const activeLiveDeployment = {
  ...activeShadowDeployment,
  id: ACTIVE_LIVE_DEPLOYMENT_ID,
  strategyId: "ux18-live-strategy",
  name: "Momentum Options Live",
  mode: "live",
  providerAccountId: BROKER_ACCOUNT_ID,
  symbolUniverse: ["AAPL"],
};

const selectedContract = (symbol: string, strike: number) => {
  const providerContractId = `O:${symbol}260724C${String(
    strike * 1_000,
  ).padStart(8, "0")}`;
  return {
    ticker: providerContractId,
    providerContractId,
    underlying: symbol,
    expirationDate: "2026-07-24",
    right: "call",
    strike,
  };
};

const activeCandidates = [
  {
    id: "ux18-ready-nvda",
    deploymentId: ACTIVE_SHADOW_DEPLOYMENT_ID,
    symbol: "NVDA",
    timeframe: "5m",
    direction: "buy",
    signalKey: "ux18-nvda-5m",
    signalAt: ACTIVE_SIGNAL_AT,
    signal: {
      signalKey: "ux18-nvda-5m",
      symbol: "NVDA",
      timeframe: "5m",
      direction: "buy",
      currentSignalAt: ACTIVE_SIGNAL_AT,
    },
    action: { optionAction: "buy_call", signalDirection: "buy" },
    actionStatus: "ready",
    selectedContract: selectedContract("NVDA", 180),
    quote: {
      bid: 4.2,
      ask: 4.4,
      mid: 4.3,
      mark: 4.3,
      spreadPercent: 4.65,
      ageMs: 400,
      freshness: "live",
      updatedAt: ACTIVE_FIXTURE_NOW,
    },
    liquidity: { spreadPercent: 4.65, openInterest: 2_400, volume: 980 },
    signalQuality: {
      tier: "high",
      liquidityTier: "strong",
      score: 86,
      reasons: ["adx_confirmed", "strong_liquidity"],
      components: { total: 86 },
      raw: {},
      adx: 34.2,
      mtfMatches: 3,
      mtfDirections: [1, 1, 1],
      spreadPctOfMid: 4.65,
      bullishRegime: true,
    },
    timeline: [
      {
        type: "contract_selected",
        summary: "NVDA call selected for review",
        occurredAt: ACTIVE_FIXTURE_NOW,
      },
    ],
  },
  {
    id: "ux18-blocked-tsla",
    deploymentId: ACTIVE_SHADOW_DEPLOYMENT_ID,
    symbol: "TSLA",
    timeframe: "5m",
    direction: "buy",
    signalKey: "ux18-tsla-5m",
    signalAt: ACTIVE_SIGNAL_AT,
    signal: {
      signalKey: "ux18-tsla-5m",
      symbol: "TSLA",
      timeframe: "5m",
      direction: "buy",
      currentSignalAt: ACTIVE_SIGNAL_AT,
    },
    action: { optionAction: "buy_call", signalDirection: "buy" },
    actionStatus: "blocked",
    reason: "spread_too_wide",
    selectedContract: selectedContract("TSLA", 330),
    quote: {
      bid: 8.1,
      ask: 9.5,
      mid: 8.8,
      mark: 8.8,
      spreadPercent: 15.9,
      ageMs: 700,
      freshness: "live",
      updatedAt: ACTIVE_FIXTURE_NOW,
    },
    liquidity: { spreadPercent: 15.9, openInterest: 420, volume: 75 },
    signalQuality: {
      tier: "low",
      liquidityTier: "weak",
      score: 42,
      reasons: ["spread_too_wide"],
      components: { total: 42 },
      raw: {},
      adx: 28.6,
      mtfMatches: 3,
      mtfDirections: [1, 1, 1],
      spreadPctOfMid: 15.9,
      bullishRegime: true,
    },
    timeline: [
      {
        type: "candidate_skipped",
        summary: "Spread exceeds the entry gate",
        occurredAt: ACTIVE_FIXTURE_NOW,
      },
    ],
  },
];

const buildActiveMatrixState = (
  symbol: "NVDA" | "TSLA",
  timeframe: string,
) => ({
  id: `ux18-${symbol.toLowerCase()}-${timeframe}`,
  profileId: "ux18-signal-profile",
  symbol,
  timeframe,
  signalKey: `ux18-${symbol.toLowerCase()}-${timeframe}`,
  currentSignalDirection: "buy",
  currentSignalAt: ACTIVE_SIGNAL_AT,
  currentSignalPrice: symbol === "NVDA" ? 178.4 : 328.2,
  currentSignalClose: symbol === "NVDA" ? 179.1 : 329.4,
  latestBarAt: ACTIVE_FIXTURE_NOW,
  latestBarClose: symbol === "NVDA" ? 179.1 : 329.4,
  barsSinceSignal: 1,
  fresh: true,
  status: "ok",
  active: true,
  lastEvaluatedAt: ACTIVE_FIXTURE_NOW,
  lastError: null,
  indicatorSnapshot: {
    trendDirection: "bullish",
    trendAgeBars: 2,
    trendAgeBucket: "new",
    adx: symbol === "NVDA" ? 34.2 : 28.6,
    strength: "strong",
    volatilityScore: symbol === "NVDA" ? 7 : 6,
    mtf: [],
    filterState: { adxGate: "pass", sessionGate: "pass" },
  },
  trendDirection: "bullish",
  actionEligible: symbol === "NVDA",
  actionBlocker: symbol === "NVDA" ? null : "spread_too_wide",
});

const activeSignalProfile = {
  id: "ux18-signal-profile",
  environment: "shadow",
  enabled: true,
  watchlistId: "ux18-active-universe",
  timeframe: "5m",
  pyrusSignalsSettings: {},
  freshWindowBars: 3,
  pollIntervalSeconds: 60,
  maxSymbols: 2,
  evaluationConcurrency: 1,
  lastEvaluatedAt: ACTIVE_FIXTURE_NOW,
  lastError: null,
  createdAt: ACTIVE_FIXTURE_NOW,
  updatedAt: ACTIVE_FIXTURE_NOW,
};

const activeBrokerAccount = {
  id: BROKER_ACCOUNT_ID,
  providerAccountId: BROKER_ACCOUNT_ID,
  provider: "ibkr",
  mode: "live",
  displayName: "IBKR Review",
  currency: "USD",
  buyingPower: 125_000,
  cash: 62_000,
  netLiquidation: 280_000,
  dayPnl: 1_420,
  dayPnlPercent: 0.51,
  accountType: "individual",
  includedInTrading: true,
  updatedAt: ACTIVE_FIXTURE_NOW,
};

const activeDeploymentAccountChoices = [
  {
    accountType: "broker",
    accountId: ROBINHOOD_AGENTIC_ACCOUNT_ID,
    providerAccountId: ROBINHOOD_AGENTIC_ACCOUNT_ID,
    provider: "robinhood",
    displayName: "Robinhood Agentic",
    mode: "live",
    includedInTrading: true,
    configurable: true,
    activationReady: false,
    adapterImplemented: true,
    technicalReady: true,
    activationReleased: false,
    totalAlgoAllowance: null,
    linkedDeploymentIds: [],
    available: true,
    blockers: ["algo.platform.activation_release_pending"],
    activationBlockers: ["algo.platform.activation_release_pending"],
  },
  {
    accountType: "shadow",
    accountId: "shadow",
    providerAccountId: "shadow",
    provider: "shadow",
    displayName: "Signal Options Shadow",
    mode: "shadow",
    includedInTrading: true,
    configurable: true,
    activationReady: true,
    adapterImplemented: true,
    technicalReady: true,
    activationReleased: true,
    totalAlgoAllowance: null,
    linkedDeploymentIds: [],
    available: true,
    blockers: [],
    activationBlockers: [],
  },
  {
    accountType: "broker",
    accountId: ROBINHOOD_PERSONAL_ACCOUNT_ID,
    providerAccountId: ROBINHOOD_PERSONAL_ACCOUNT_ID,
    provider: "robinhood",
    displayName: "Robinhood Personal",
    mode: "live",
    includedInTrading: true,
    configurable: true,
    activationReady: false,
    adapterImplemented: true,
    technicalReady: true,
    activationReleased: false,
    totalAlgoAllowance: null,
    linkedDeploymentIds: [],
    available: true,
    blockers: ["robinhood.account.non_agentic"],
    activationBlockers: ["robinhood.account.non_agentic"],
  },
  {
    accountType: "broker",
    accountId: SCHWAB_ACCOUNT_ID,
    providerAccountId: "schwab:fixture",
    provider: "schwab",
    displayName: "Schwab Options",
    mode: "live",
    includedInTrading: true,
    configurable: true,
    activationReady: false,
    adapterImplemented: true,
    technicalReady: false,
    activationReleased: false,
    totalAlgoAllowance: null,
    linkedDeploymentIds: [],
    available: true,
    blockers: ["schwab.order_tooling_unverified"],
    activationBlockers: ["schwab.order_tooling_unverified"],
  },
  {
    accountType: "broker",
    accountId: SNAPTRADE_ACCOUNT_ID,
    providerAccountId: "snaptrade:fixture",
    provider: "snaptrade",
    displayName: "SnapTrade Options",
    mode: "live",
    includedInTrading: true,
    configurable: true,
    activationReady: false,
    adapterImplemented: true,
    technicalReady: false,
    activationReleased: false,
    totalAlgoAllowance: null,
    linkedDeploymentIds: [],
    available: true,
    blockers: ["algo.provider.snaptrade_brokerage_option_fixture_required"],
    activationBlockers: [
      "algo.provider.snaptrade_brokerage_option_fixture_required",
    ],
  },
  {
    accountType: "broker",
    accountId: IBKR_ACCOUNT_ID,
    providerAccountId: "ibkr:fixture",
    provider: "ibkr",
    displayName: "IBKR Options",
    mode: "live",
    includedInTrading: true,
    configurable: true,
    activationReady: false,
    adapterImplemented: true,
    technicalReady: false,
    activationReleased: false,
    totalAlgoAllowance: null,
    linkedDeploymentIds: [],
    available: true,
    blockers: ["ibkr.automated_live_orders_disabled"],
    activationBlockers: ["ibkr.automated_live_orders_disabled"],
  },
];

const buildActivePosition = ({
  id,
  accountId,
  symbol,
  description,
  quantity,
  averageCost,
  mark,
  source,
  sourceType,
}: {
  id: string;
  accountId: string;
  symbol: string;
  description: string;
  quantity: number;
  averageCost: number;
  mark: number;
  source: string;
  sourceType: string;
}) => ({
  id,
  accountId,
  accounts: [accountId],
  symbol,
  description,
  assetClass: "Equity",
  providerSecurityType: "STK",
  positionType: "stock",
  optionContract: null,
  marketDataSymbol: symbol,
  sector: "Technology",
  quantity,
  averageCost,
  mark,
  dayChange: 1.25,
  dayChangePercent: 0.65,
  unrealizedPnl: (mark - averageCost) * quantity,
  unrealizedPnlPercent: ((mark - averageCost) / averageCost) * 100,
  marketValue: mark * quantity,
  weightPercent: 1.2,
  accountWeightPercent: 1.2,
  scopedWeightPercent: 100,
  betaWeightedDelta: quantity,
  lots: [],
  openOrders: [],
  stopLoss: null,
  takeProfit: null,
  riskOverlay: null,
  source,
  sourceType,
  strategyLabel:
    sourceType === "signal_options" ? "Momentum Options Shadow" : null,
  attributionStatus: sourceType === "signal_options" ? "linked" : "unknown",
  sourceAttribution: [],
  automationContext:
    sourceType === "signal_options"
      ? { deploymentId: ACTIVE_SHADOW_DEPLOYMENT_ID, signalScore: 86 }
      : null,
  openedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
  openedAtSource: sourceType === "signal_options" ? "shadow_fill" : "broker",
  quote: {
    bid: mark - 0.05,
    ask: mark + 0.05,
    mid: mark,
    last: mark,
    mark,
    spread: 0.1,
    spreadPercent: 0.05,
    bidSize: 12,
    askSize: 14,
    updatedAt: ACTIVE_FIXTURE_NOW,
    freshness: "live",
    marketDataMode: "live",
    source: "fixture",
    providerContractId: null,
    transport: "fixture",
    delayed: false,
    dataUpdatedAt: ACTIVE_FIXTURE_NOW,
    ageMs: 0,
    cacheAgeMs: 0,
  },
});

const activeShadowPosition = buildActivePosition({
  id: "ux18-shadow-position-nvda",
  accountId: "shadow",
  symbol: "NVDA",
  description: "NVIDIA Corp.",
  quantity: 8,
  averageCost: 172.5,
  mark: 179.1,
  source: "PYRUS_SHADOW_LEDGER",
  sourceType: "signal_options",
});

const activeBrokerPosition = buildActivePosition({
  id: "ux18-broker-position-aapl",
  accountId: BROKER_ACCOUNT_ID,
  symbol: "AAPL",
  description: "Apple Inc.",
  quantity: 12,
  averageCost: 205.2,
  mark: 214.4,
  source: "IBKR_POSITIONS",
  sourceType: "manual",
});

const buildActiveEvents = (nowMs = Date.now()) => [
  {
    id: "ux18-entry-event",
    deploymentId: ACTIVE_SHADOW_DEPLOYMENT_ID,
    eventType: "signal_options_shadow_entry",
    occurredAt: new Date(nowMs - 20_000).toISOString(),
    symbol: "NVDA",
  },
  {
    id: "ux18-blocked-event",
    deploymentId: ACTIVE_SHADOW_DEPLOYMENT_ID,
    eventType: "signal_options_candidate_skipped",
    occurredAt: new Date(nowMs - 10_000).toISOString(),
    symbol: "TSLA",
    detail: "Spread exceeds the entry gate",
  },
];

const activePipelineStages = [
  { id: "scan_universe", status: "healthy", count: 2 },
  { id: "signal_detected", status: "healthy", count: 2 },
  { id: "action_mapped", status: "attention", count: 2 },
  { id: "contract_selected", status: "attention", count: 2 },
];

const activeAttentionItems = [
  {
    id: "ux18-spread-blocker",
    severity: "warning",
    title: "TSLA spread too wide",
    summary: "The entry gate blocked one candidate before Trade review.",
    detail: "Wait for a tighter bid/ask spread before the next scan.",
  },
];

const activeQuoteFor = (symbol: string) => {
  const normalized = symbol.trim().toUpperCase();
  const price =
    normalized === "NVDA" ? 179.1 : normalized === "TSLA" ? 329.4 : 214.4;
  return {
    symbol: normalized,
    price,
    bid: price - 0.05,
    ask: price + 0.05,
    change: 1.25,
    changePercent: 0.65,
    volume: 1_250_000,
    source: "fixture",
    transport: "fixture",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: ACTIVE_FIXTURE_NOW,
    ageMs: 0,
    cacheAgeMs: 0,
    updatedAt: ACTIVE_FIXTURE_NOW,
  };
};

const activeBars = (symbol: string, limit: number) => {
  const count = Math.max(24, Math.min(limit || 320, 320));
  const quote = activeQuoteFor(symbol);
  return Array.from({ length: count }, (_, index) => {
    const close = quote.price - (count - index) * 0.04;
    return {
      timestamp: new Date(
        Date.now() - (count - index) * 5 * 60_000,
      ).toISOString(),
      open: close - 0.12,
      high: close + 0.2,
      low: close - 0.25,
      close,
      volume: 18_000 + index * 20,
      source: "fixture",
      transport: "fixture",
      delayed: false,
      freshness: "live",
    };
  });
};

const activeOptionChain = (underlying: string) => {
  const normalized = underlying.trim().toUpperCase() || "NVDA";
  const strike = normalized === "TSLA" ? 330 : normalized === "AAPL" ? 215 : 180;
  return [
    {
      contract: selectedContract(normalized, strike),
      bid: 4.2,
      ask: 4.4,
      last: 4.3,
      volume: 980,
      openInterest: 2_400,
      impliedVolatility: 0.31,
      delta: 0.46,
      gamma: 0.04,
      theta: -0.08,
      vega: 0.12,
      quoteFreshness: "live",
      quoteUpdatedAt: ACTIVE_FIXTURE_NOW,
    },
  ];
};

async function fulfillEventStream(route: Route) {
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: "retry: 60000\n\n",
  });
}

async function installRiskUnitFixture(
  page: Page,
  {
    activeHierarchy = false,
    theme = "dark",
  }: { activeHierarchy?: boolean; theme?: "dark" | "light" } = {},
) {
  const unknownGetPaths = new Set<string>();
  const protectedMutations: string[] = [];
  const allowedBackgroundMutations: string[] = [];
  const activeEvents = activeHierarchy ? buildActiveEvents() : [];
  const knownDeploymentIds = new Set(
    activeHierarchy
      ? [ACTIVE_SHADOW_DEPLOYMENT_ID, ACTIVE_LIVE_DEPLOYMENT_ID]
      : [DEPLOYMENT_ID],
  );

  await page.routeWebSocket(
    ({ pathname }) => pathname === "/api/ws/options/quotes",
    (socket) => {
      socket.onMessage(() => {
        socket.send(JSON.stringify({ type: "ready" }));
      });
    },
  );

  await page.addInitScript(({ active, selectedTheme }) => {
    Object.defineProperty(window, "__PYRUS_PERF_WARMUP_OVERRIDES__", {
      configurable: true,
      value: {
        disableOperationalCodePreload: true,
        disableHiddenScreenWarmMount: true,
        disableBackgroundDataWarmup: true,
        disableResearchWorkspacePreload: true,
      },
    });
    window.localStorage.setItem(
      "pyrus:state:v1",
      JSON.stringify({
        screen: "algo",
        sidebarCollapsed: true,
        activitySidebarCollapsed: true,
        ...(active
          ? {
              accountTab: "shadow",
              accountSection: "shadow",
              theme: selectedTheme,
              userPreferences: {
                appearance: {
                  theme: selectedTheme,
                  density: "compact",
                  reducedMotion: "on",
                },
              },
            }
          : {}),
      }),
    );
  }, { active: activeHierarchy, selectedTheme: theme });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;

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
      } else if (path === "/api/options/quotes") {
        await route.fulfill({
          json: {
            quotes: [],
            transport: "fixture",
            delayed: false,
            fallbackUsed: true,
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
        json: { error: "Protected mutation blocked by risk-unit QA." },
      });
      return;
    }

    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "risk-unit-responsive-review",
            email: "risk-unit-responsive@example.com",
            role: "user",
            entitlements: [],
          },
          csrfToken: "risk-unit-responsive-csrf",
        },
      });
      return;
    }

    if (path === "/api/session") {
      await route.fulfill({
        json: {
          environment: activeHierarchy ? "live" : "shadow",
          brokerProvider: "ibkr",
          marketDataProvider: "massive",
          marketDataProviders: {
            live: "massive",
            historical: "massive",
            research: "fmp",
          },
          configured: {
            massive: true,
            ibkr: activeHierarchy,
            research: false,
          },
          ibkrBridge: activeHierarchy
            ? {
                configured: true,
                authenticated: true,
                connected: true,
                selectedAccountId: BROKER_ACCOUNT_ID,
                accounts: [BROKER_ACCOUNT_ID],
                transport: "tws",
                connectionTarget: "fixture",
                sessionMode: "live",
                marketDataMode: "live",
                liveMarketDataAvailable: true,
                strictReady: true,
                updatedAt: ACTIVE_FIXTURE_NOW,
              }
            : null,
          runtime: { ibkr: {} },
          timestamp: FIXTURE_NOW,
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
            ...(activeHierarchy
              ? {
                  appearance: {
                    theme,
                    density: "compact",
                    reducedMotion: "on",
                  },
                  privacy: { hideAccountValues: false },
                }
              : {}),
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
          },
          source: "database",
          updatedAt: FIXTURE_NOW,
        },
      });
      return;
    }

    if (path === "/api/watchlists") {
      await route.fulfill({ json: { watchlists: [] } });
      return;
    }

    if (path === "/api/accounts") {
      await route.fulfill({
        json: {
          accounts: activeHierarchy ? [activeBrokerAccount] : [],
        },
      });
      return;
    }

    if (path === "/api/algo/deployments") {
      await route.fulfill({
        json: {
          deployments: activeHierarchy
            ? [activeShadowDeployment, activeLiveDeployment]
            : [deployment],
          pnlByDeployment: activeHierarchy
            ? {
                [ACTIVE_SHADOW_DEPLOYMENT_ID]: {
                  todayPnl: 286,
                  dailyRealizedPnl: 120,
                  openUnrealizedPnl: 166,
                },
                [ACTIVE_LIVE_DEPLOYMENT_ID]: {
                  todayPnl: 74,
                  dailyRealizedPnl: 74,
                  openUnrealizedPnl: 0,
                },
              }
            : {
                [DEPLOYMENT_ID]: {
                  todayPnl: 0,
                  dailyRealizedPnl: 0,
                  openUnrealizedPnl: 0,
                },
              },
        },
      });
      return;
    }

    if (path === "/api/algo/deployment-accounts") {
      await route.fulfill({
        json: {
          accounts: activeHierarchy ? activeDeploymentAccountChoices : [],
        },
      });
      return;
    }

    if (path === "/api/backtests/drafts") {
      await route.fulfill({ json: { drafts: [] } });
      return;
    }

    if (path === "/api/algo/events") {
      await route.fulfill({
        json: { events: activeHierarchy ? activeEvents : [] },
      });
      return;
    }

    const stateDeploymentId = path.match(
      /^\/api\/algo\/deployments\/([^/]+)\/signal-options\/state$/,
    )?.[1];
    if (stateDeploymentId && knownDeploymentIds.has(stateDeploymentId)) {
      const activeDeployment =
        stateDeploymentId === ACTIVE_LIVE_DEPLOYMENT_ID
          ? activeLiveDeployment
          : activeShadowDeployment;
      const isActiveShadow =
        activeHierarchy && stateDeploymentId === ACTIVE_SHADOW_DEPLOYMENT_ID;
      await route.fulfill({
        json: {
          deployment: activeHierarchy ? activeDeployment : deployment,
          profile: riskProfile,
          mode: activeHierarchy ? activeDeployment.mode : "shadow",
          candidates: isActiveShadow ? activeCandidates : [],
          signals: [],
          activePositions: isActiveShadow ? [activeShadowPosition] : [],
          risk: {
            dailyHaltActive: false,
            maxDailyLoss: 1_000,
            dailyPnl: isActiveShadow ? 286 : 0,
            openSymbols: isActiveShadow ? 1 : 0,
            maxOpenSymbols: 10,
          },
          events: isActiveShadow ? activeEvents : [],
        },
      });
      return;
    }

    const cockpitDeploymentId = path.match(
      /^\/api\/algo\/deployments\/([^/]+)\/cockpit$/,
    )?.[1];
    if (
      cockpitDeploymentId &&
      knownDeploymentIds.has(cockpitDeploymentId)
    ) {
      const activeDeployment =
        cockpitDeploymentId === ACTIVE_LIVE_DEPLOYMENT_ID
          ? activeLiveDeployment
          : activeShadowDeployment;
      const isActiveShadow =
        activeHierarchy && cockpitDeploymentId === ACTIVE_SHADOW_DEPLOYMENT_ID;
      await route.fulfill({
        json: {
          fleet: {
            mode: activeHierarchy ? activeDeployment.mode : "shadow",
            totalDeployments: activeHierarchy ? 2 : 1,
            enabledDeployments: 0,
            pausedDeployments: activeHierarchy ? 2 : 1,
            erroredDeployments: 0,
            activeBlockers: isActiveShadow ? 1 : 0,
            latestEventAt: isActiveShadow ? ACTIVE_FIXTURE_NOW : null,
          },
          deployment: activeHierarchy ? activeDeployment : deployment,
          readiness: {
            ready: true,
            reason: "ready",
            message: activeHierarchy
              ? "Active UX-18 fixture ready"
              : "Fixture ready",
            scanDisabledReason: null,
            enableDisabledReason: null,
            profileDisabledReason: null,
          },
          pipelineStages: isActiveShadow ? activePipelineStages : [],
          attentionItems: isActiveShadow ? activeAttentionItems : [],
          diagnostics: isActiveShadow
            ? {
                signalFreshness: {
                  fresh: 2,
                  notFresh: 0,
                  withoutDirection: 0,
                },
                tradePath: {
                  blockedCandidates: 1,
                  shadowFilledCandidates: 1,
                },
                skipReasons: { spread_too_wide: 1 },
                entryGateReasons: { spread_too_wide: 1 },
                optionChainReasons: { selected: 2 },
                readiness: { market_data_ready: 1 },
                lifecycle: { paused: 1 },
                markHealth: { live: 2 },
              }
            : {},
          kpis: {
            dailyRealizedPnl: isActiveShadow ? 120 : 74,
            openUnrealizedPnl: isActiveShadow ? 166 : 0,
            openPositions: isActiveShadow ? 1 : 0,
          },
          risk: {
            dailyHaltActive: false,
            maxDailyLoss: 1_000,
            dailyPnl: isActiveShadow ? 286 : 74,
            openSymbols: isActiveShadow ? 1 : 0,
            maxOpenSymbols: 10,
          },
          candidates: isActiveShadow ? activeCandidates : [],
          signals: [],
          activePositions: isActiveShadow ? [activeShadowPosition] : [],
          events: isActiveShadow ? activeEvents : [],
          sourceBacktest: {},
          evaluatedAt: activeHierarchy ? ACTIVE_FIXTURE_NOW : FIXTURE_NOW,
          generatedAt: activeHierarchy ? ACTIVE_FIXTURE_NOW : FIXTURE_NOW,
        },
      });
      return;
    }

    const performanceDeploymentId = path.match(
      /^\/api\/algo\/deployments\/([^/]+)\/signal-options\/performance$/,
    )?.[1];
    if (
      performanceDeploymentId &&
      knownDeploymentIds.has(performanceDeploymentId)
    ) {
      await route.fulfill({
        json: {
          deploymentId: activeHierarchy
            ? performanceDeploymentId
            : DEPLOYMENT_ID,
          range: "all",
          summary: activeHierarchy
            ? {
                closedTrades: 18,
                winningTrades: 11,
                losingTrades: 7,
                winRatePercent: 61.1,
                realizedPnl: 1_840,
              }
            : {},
          openExposure: activeHierarchy
            ? { openPositions: 1, openPremium: 344 }
            : {},
          ruleAdherence: activeHierarchy
            ? [
                { rule: "spread_gate", status: "warning", count: 1 },
                { rule: "daily_loss", status: "pass", count: 0 },
              ]
            : [],
          topBlockers: activeHierarchy
            ? [{ reason: "spread_too_wide", count: 1 }]
            : [],
          recentClosedTrades: [],
          generatedAt: activeHierarchy ? ACTIVE_FIXTURE_NOW : FIXTURE_NOW,
        },
      });
      return;
    }

    if (
      /^\/api\/accounts\/(?:shadow|combined)\/positions$/.test(path) ||
      (activeHierarchy &&
        path === `/api/accounts/${BROKER_ACCOUNT_ID}/positions`)
    ) {
      const accountId = path.split("/")[3];
      const positions = !activeHierarchy
        ? []
        : accountId === "shadow"
          ? [activeShadowPosition]
          : accountId === BROKER_ACCOUNT_ID
            ? [activeBrokerPosition]
            : [activeShadowPosition, activeBrokerPosition];
      await route.fulfill({
        json: {
          accountId,
          currency: "USD",
          positions,
          totals: activeHierarchy
            ? {
                marketValue: positions.reduce(
                  (total, position) => total + position.marketValue,
                  0,
                ),
                unrealizedPnl: positions.reduce(
                  (total, position) => total + position.unrealizedPnl,
                  0,
                ),
              }
            : {},
          updatedAt: activeHierarchy ? ACTIVE_FIXTURE_NOW : FIXTURE_NOW,
        },
      });
      return;
    }

    if (path === "/api/signal-monitor/profile") {
      await route.fulfill({
        json: activeHierarchy
          ? activeSignalProfile
          : {
              id: "risk-unit-responsive-profile",
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
              createdAt: FIXTURE_NOW,
              updatedAt: FIXTURE_NOW,
            },
      });
      return;
    }

    if (path === "/api/signal-monitor/events") {
      await route.fulfill({ json: { events: [] } });
      return;
    }

    if (path === "/api/quotes/snapshot") {
      const symbols = (url.searchParams.get("symbols") || "")
        .split(",")
        .filter(Boolean);
      await route.fulfill({
        json: {
          quotes: activeHierarchy ? symbols.map(activeQuoteFor) : [],
          transport: activeHierarchy ? "fixture" : null,
          delayed: false,
          fallbackUsed: false,
        },
      });
      return;
    }

    if (activeHierarchy && path === "/api/bars") {
      const symbol = url.searchParams.get("symbol") || "NVDA";
      const bars = activeBars(
        symbol,
        Number(url.searchParams.get("limit")) || 320,
      );
      await route.fulfill({
        json: {
          symbol,
          timeframe: url.searchParams.get("timeframe") || "5m",
          bars,
          transport: "fixture",
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

    if (activeHierarchy && path === "/api/options/expirations") {
      await route.fulfill({
        json: {
          underlying: url.searchParams.get("underlying") || "NVDA",
          expirations: [{ expirationDate: "2026-07-24" }],
        },
      });
      return;
    }

    if (activeHierarchy && path === "/api/options/chains") {
      const underlying = url.searchParams.get("underlying") || "NVDA";
      await route.fulfill({
        json: {
          underlying,
          expirationDate:
            url.searchParams.get("expirationDate") || "2026-07-24",
          contracts: activeOptionChain(underlying),
        },
      });
      return;
    }

    if (activeHierarchy && path === "/api/options/chart-bars") {
      await route.fulfill({ json: {} });
      return;
    }

    if (activeHierarchy && path === "/api/positions") {
      await route.fulfill({ json: { positions: [] } });
      return;
    }

    if (activeHierarchy && path === "/api/orders") {
      await route.fulfill({ json: { orders: [] } });
      return;
    }

    if (activeHierarchy && path === "/api/executions") {
      await route.fulfill({ json: { executions: [] } });
      return;
    }

    if (
      path === "/api/flow/events" ||
      path === "/api/flow/events/aggregate"
    ) {
      await route.fulfill({ json: { events: [], source: {} } });
      return;
    }

    if (path === "/api/broker-execution/included-accounts") {
      await route.fulfill({
        json: {
          accounts: activeHierarchy
            ? [
                {
                  accountId: BROKER_ACCOUNT_ID,
                  provider: "ibkr",
                  included: true,
                },
              ]
            : [],
        },
      });
      return;
    }

    if (path === "/api/broker-execution/ibkr-portal/readiness") {
      await route.fulfill({
        json: activeHierarchy
          ? {
              status: "connected",
              gatewayRunning: true,
              authenticated: true,
              browserLoginComplete: true,
              apiSessionActivationFailed: false,
              established: true,
              isPaper: true,
              selectedAccountId: BROKER_ACCOUNT_ID,
              accounts: [BROKER_ACCOUNT_ID],
              executionTargets: [
                {
                  accountId: BROKER_ACCOUNT_ID,
                  provider: "ibkr",
                  ready: true,
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
              message: "IBKR paper review account is connected.",
            }
          : {
              status: "disconnected",
              gatewayRunning: false,
              authenticated: false,
              browserLoginComplete: false,
              apiSessionActivationFailed: false,
              established: null,
              isPaper: null,
              selectedAccountId: null,
              accounts: [],
              executionTargets: [],
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
              message: "IBKR is not connected in the UX-18 fixture.",
            },
      });
      return;
    }

    if (path === "/api/broker-execution/snaptrade/readiness") {
      await route.fulfill({
        json: {
          provider: "snaptrade",
          configured: false,
          status: "unconfigured",
          checkedAt: FIXTURE_NOW,
          credentials: { clientIdPresent: false, apiKeyPresent: false },
          user: { registered: false, status: "not_registered" },
          limitations: [],
          upstream: null,
        },
      });
      return;
    }

    if (activeHierarchy && path === "/api/signal-monitor/matrix/stream") {
      const requestedTimeframes = (
        url.searchParams.get("timeframes") || "5m,15m,1h"
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const timeframes = requestedTimeframes.length
        ? [...new Set(requestedTimeframes)]
        : ["5m", "15m", "1h"];
      const states = timeframes.flatMap((timeframe) => [
        buildActiveMatrixState("NVDA", timeframe),
        buildActiveMatrixState("TSLA", timeframe),
      ]);
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          "content-type": "text/event-stream",
        },
        body: `event: bootstrap\ndata: ${JSON.stringify({
          stream: "signal-matrix",
          event: "bootstrap",
          profile: activeSignalProfile,
          states,
          evaluatedAt: ACTIVE_FIXTURE_NOW,
          timeframes,
          coverage: {
            requestedSymbols: 2,
            activeScopeSymbols: 2,
            timeframes: timeframes.length,
            taskCount: states.length,
            source: "fixture",
            delayed: false,
            eventCount: 2,
            stateCount: states.length,
            skippedSymbols: 0,
            truncated: false,
            lastEventAt: ACTIVE_FIXTURE_NOW,
            lastEventAgeMs: 0,
          },
        })}\n\nretry: 60000\n\n`,
      });
      return;
    }

    if (quietEventStreamPaths.has(path)) {
      await fulfillEventStream(route);
      return;
    }

    if (emptyObjectGetPaths.has(path)) {
      await route.fulfill({ json: {} });
      return;
    }

    if (
      activeHierarchy &&
      /^\/api\/gex\/[^/]+\/(?:projection|zero-gamma)$/.test(path)
    ) {
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
    allowedBackgroundMutations,
    protectedMutations,
    unknownGetPaths,
  };
}

async function findVisible(locator: Locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) {
      return candidate;
    }
  }
  return null;
}

async function openRiskRail(page: Page, touch: boolean) {
  const openButton = await findVisible(
    page.getByRole("button", { name: "Open algo settings" }),
  );
  if (openButton) {
    if (touch) {
      await openButton.tap();
    } else {
      await openButton.click();
    }
    const drawer = await findVisible(
      page.getByRole("dialog", { name: "Algo settings" }),
    );
    if (!drawer) {
      throw new Error("Visible Algo settings drawer did not open.");
    }
    await expect(drawer).toBeVisible();
    const drawerRail = await findVisible(
      drawer.getByTestId("algo-right-rail"),
    );
    if (!drawerRail) {
      throw new Error("Visible Algo settings drawer has no risk rail.");
    }
    await expect(drawerRail).toBeVisible({ timeout: READY_TIMEOUT_MS });
    return drawerRail;
  }

  const rail = await findVisible(page.getByTestId("algo-right-rail"));
  if (!rail) {
    throw new Error("Visible desktop Algo risk rail was not found.");
  }
  await expect(rail).toBeVisible({ timeout: READY_TIMEOUT_MS });
  return rail;
}

async function expectUnit(
  rail: Locator,
  testId: string,
  unit: "usd" | "percent",
) {
  await expect(rail.getByTestId(`${testId}-usd`)).toHaveAttribute(
    "aria-pressed",
    String(unit === "usd"),
  );
  await expect(rail.getByTestId(`${testId}-percent`)).toHaveAttribute(
    "aria-pressed",
    String(unit === "percent"),
  );
}

async function expectTargetFloor(group: Locator, floor: number) {
  await group.scrollIntoViewIfNeeded();
  const buttons = group.getByRole("button");
  await expect(buttons).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(Math.min(floor, 28));
    expect(box!.height).toBeGreaterThanOrEqual(floor);
  }
}

async function expectNoHorizontalOverflow(container: Locator) {
  await container.scrollIntoViewIfNeeded();
  const dimensions = await container.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    children: Array.from(element.children).map((node) => {
      const child = node as HTMLElement;
      return {
        testId: child.dataset.testid || child.tagName.toLowerCase(),
        clientWidth: child.clientWidth,
        scrollWidth: child.scrollWidth,
        overflowX: window.getComputedStyle(child).overflowX,
      };
    }),
  }));
  expect(
    dimensions.scrollWidth,
    `Horizontal overflow details: ${JSON.stringify(dimensions.children)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectSingleTargetFloor(target: Locator, floor: number) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(floor);
  expect(box!.height).toBeGreaterThanOrEqual(floor);
}

async function expectFullyInside(target: Locator, container: Locator) {
  const [targetBox, containerBox] = await Promise.all([
    target.boundingBox(),
    container.boundingBox(),
  ]);
  expect(targetBox).not.toBeNull();
  expect(containerBox).not.toBeNull();
  expect(targetBox!.x).toBeGreaterThanOrEqual(containerBox!.x - 1);
  expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(
    containerBox!.x + containerBox!.width + 1,
  );
}

async function expectSideBySideWithoutOverlap(left: Locator, right: Locator) {
  const [leftBox, rightBox] = await Promise.all([
    left.boundingBox(),
    right.boundingBox(),
  ]);
  expect(leftBox).not.toBeNull();
  expect(rightBox).not.toBeNull();
  expect(leftBox!.x + leftBox!.width).toBeLessThanOrEqual(rightBox!.x + 1);
}

async function expectSeventyThirtyWorkspace(container: Locator) {
  const controls = container.getByTestId("algo-controls-container");
  const diagnostics = container.getByTestId("algo-diagnostics-container");
  const [controlsBox, diagnosticsBox] = await Promise.all([
    controls.boundingBox(),
    diagnostics.boundingBox(),
  ]);
  expect(controlsBox).not.toBeNull();
  expect(diagnosticsBox).not.toBeNull();
  expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(
    diagnosticsBox!.x + 1,
  );
  const contentWidth = controlsBox!.width + diagnosticsBox!.width;
  expect(controlsBox!.width / contentWidth).toBeCloseTo(0.7, 1);
}

async function expectPurposeBuiltGuardrailConsole(container: Locator) {
  const console = container.getByTestId("algo-guardrail-console");
  const risk = console.getByTestId("algo-halt-group-risk");
  const [daily, budget, symbols, contracts, quote, position, signal, infra] =
    await Promise.all(
      [
        "dailyLoss",
        "premiumBudget",
        "openSymbols",
        "maxContracts",
      ].map((id) => console.getByTestId(`algo-halt-control-${id}`).boundingBox())
        .concat([
          console.locator('section[aria-label="Quote halt controls"]').boundingBox(),
          console.locator('section[aria-label="Position halt controls"]').boundingBox(),
          console.locator('section[aria-label="Signal halt controls"]').boundingBox(),
          console.locator('section[aria-label="Infrastructure halt controls"]').boundingBox(),
        ]),
    );

  for (const box of [daily, budget, symbols, contracts, quote, position, signal, infra]) {
    expect(box).not.toBeNull();
  }
  await expect(
    console.getByTestId("algo-halt-control-tradingAllowance"),
  ).toHaveCount(0);
  expect(Math.abs(daily!.y - budget!.y)).toBeLessThanOrEqual(1);
  expect(symbols!.y).toBeGreaterThan(daily!.y);
  expect(contracts!.y + contracts!.height).toBeLessThanOrEqual(daily!.y + 1);
  expect(Math.abs(quote!.y - position!.y)).toBeLessThanOrEqual(1);
  expect(quote!.x + quote!.width).toBeLessThanOrEqual(position!.x + 1);
  expect(Math.abs(signal!.y - infra!.y)).toBeLessThanOrEqual(1);
  expect(signal!.x + signal!.width).toBeLessThanOrEqual(infra!.x + 1);
  await expectNoHorizontalOverflow(risk);
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
}

async function waitForAlgoWorkspace(page: Page) {
  await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("screen-host-algo")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("algo-live-content")).toBeVisible({
    timeout: READY_TIMEOUT_MS,
  });
  await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
    timeout: READY_TIMEOUT_MS,
  });
}

async function readTradeSelection(page: Page) {
  return page.evaluate(() => {
    const state = JSON.parse(
      window.localStorage.getItem("pyrus:state:v1") || "{}",
    );
    const ticker = state.tradeActiveTicker || state.sym || null;
    const contract = ticker ? state.tradeContracts?.[ticker] || null : null;
    return {
      ticker,
      strike: contract?.strike ?? null,
      cp: contract?.cp ?? null,
      exp: contract?.exp ?? null,
      providerContractId: contract?.providerContractId ?? null,
    };
  });
}

const viewports = [
  {
    name: "phone-390",
    width: 390,
    height: 844,
    touch: true,
    targetFloor: 44,
    keyboardKey: "Space",
  },
  {
    name: "tablet-768",
    width: 768,
    height: 1024,
    touch: true,
    targetFloor: 44,
    keyboardKey: "Enter",
  },
  {
    name: "desktop-1440",
    width: 1440,
    height: 900,
    touch: false,
    targetFloor: 24,
    keyboardKey: "Space",
  },
] as const;

const hierarchyPresentations = viewports.flatMap((viewport) =>
  (["dark", "light"] as const).map((theme) => ({
    ...viewport,
    id: `${viewport.name}-${theme}`,
    theme,
  })),
);

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.touch });

    test("risk amount units remain independent, responsive, and mutation-safe", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const fixture = await installRiskUnitFixture(page);

      const targetUrl = new URL(APP_URL);
      targetUrl.searchParams.set("screen", "algo");
      await test.step("open the normal Algo screen", async () => {
        await page.goto(targetUrl.toString(), {
          waitUntil: "domcontentloaded",
        });

        const currentUrl = new URL(page.url());
        expect(currentUrl.searchParams.has("pyrusQa")).toBe(false);
        expect(currentUrl.searchParams.has("qa")).toBe(false);
        await expect(page.getByTestId("platform-screen-stack")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(page.getByTestId("screen-host-algo")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(page.getByTestId("algo-live-content")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(page.getByTestId("algo-live-page-loading")).toBeHidden({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(
          page.getByTestId("pyrus-boot-progress-overlay"),
        ).toBeHidden({
          timeout: READY_TIMEOUT_MS,
        });
      });

      const rail = await test.step("open the risk settings rail", () =>
        openRiskRail(page, viewport.touch),
      );
      await page.screenshot({
        path: `test-results/algo-control-panel-${viewport.name}-current.png`,
        fullPage: false,
      });
      if (viewport.width === 768) {
        const controls = rail.getByTestId("algo-controls-container");
        await controls.evaluate((element) => {
          element.scrollTop = element.scrollHeight * 0.55;
        });
        await page.screenshot({
          path: "test-results/algo-control-panel-tablet-current-middle.png",
          fullPage: false,
        });
        await controls.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await page.screenshot({
          path: "test-results/algo-control-panel-tablet-current-bottom.png",
          fullPage: false,
        });
        await controls.evaluate((element) => {
          element.scrollTop = 0;
        });
      }
      const premiumHaltUnit = rail.getByTestId(
        "algo-halt-unit-premiumBudget",
      );
      const premiumMainUnit = rail.getByTestId(
        "algo-risk-unit-riskCaps.maxPremiumPerEntry",
      );
      const dailyHaltUnit = rail.getByTestId("algo-halt-unit-dailyLoss");
      const dailyMainUnit = rail.getByTestId(
        "algo-risk-unit-riskCaps.maxDailyLoss",
      );

      await expectUnit(rail, "algo-halt-unit-premiumBudget", "usd");
      await expectUnit(
        rail,
        "algo-risk-unit-riskCaps.maxPremiumPerEntry",
        "usd",
      );
      await expectUnit(rail, "algo-halt-unit-dailyLoss", "usd");
      await expectUnit(
        rail,
        "algo-risk-unit-riskCaps.maxDailyLoss",
        "usd",
      );
      await expect(rail.getByTestId("algo-halt-input-premiumBudget")).toHaveValue(
        "1500",
      );
      await expect(
        rail.getByTestId("algo-compact-input-riskCaps.maxPremiumPerEntry"),
      ).toHaveValue("1500");
      await expect(rail.getByTestId("algo-halt-input-dailyLoss")).toHaveValue(
        "1000",
      );
      await expect(
        rail.getByTestId("algo-compact-input-riskCaps.maxDailyLoss"),
      ).toHaveValue("1000");

      for (const group of [
        premiumHaltUnit,
        premiumMainUnit,
        dailyHaltUnit,
        dailyMainUnit,
      ]) {
        await expectTargetFloor(group, viewport.targetFloor);
      }
      for (const [group, input] of [
        [premiumHaltUnit, rail.getByTestId("algo-halt-input-premiumBudget")],
        [
          premiumMainUnit,
          rail.getByTestId("algo-compact-input-riskCaps.maxPremiumPerEntry"),
        ],
        [dailyHaltUnit, rail.getByTestId("algo-halt-input-dailyLoss")],
        [
          dailyMainUnit,
          rail.getByTestId("algo-compact-input-riskCaps.maxDailyLoss"),
        ],
      ] as const) {
        await expectSideBySideWithoutOverlap(group, input);
        await expectFullyInside(group, group.locator(".."));
        await expectFullyInside(input, input.locator(".."));
      }
      if (viewport.width >= 768 && viewport.width < 1_024) {
        await expectSeventyThirtyWorkspace(rail);
        await expectPurposeBuiltGuardrailConsole(rail);
      }
      await expectNoHorizontalOverflow(
        rail.locator('section[aria-label="Risk halt controls"]'),
      );
      await expectNoHorizontalOverflow(
        rail.getByTestId("algo-settings-section-risk"),
      );

      const premiumHaltPercent = rail.getByTestId(
        "algo-halt-unit-premiumBudget-percent",
      );
      await premiumHaltPercent.scrollIntoViewIfNeeded();
      if (viewport.touch) {
        await premiumHaltPercent.tap();
      } else {
        await premiumHaltPercent.click();
      }

      await expectUnit(rail, "algo-halt-unit-premiumBudget", "percent");
      await expectUnit(
        rail,
        "algo-risk-unit-riskCaps.maxPremiumPerEntry",
        "percent",
      );
      await expect(rail.getByTestId("algo-halt-input-premiumBudget")).toHaveValue(
        "15",
      );
      await expect(
        rail.getByTestId("algo-compact-input-riskCaps.maxPremiumPerEntry"),
      ).toHaveValue("15");
      await expect(
        rail.getByTestId("algo-halt-effective-premiumBudget"),
      ).toContainText("≈ $1,500.00");
      await expect(
        rail.getByTestId("algo-halt-effective-premiumBudget"),
      ).toHaveAttribute("aria-label", "15% of $10,000 equals $1,500.00");
      await expect(
        rail.getByTestId(
          "algo-risk-effective-riskCaps.maxPremiumPerEntry",
        ),
      ).toContainText("15% of $10,000 = $1,500.00");

      await expectUnit(rail, "algo-halt-unit-dailyLoss", "usd");
      await expectUnit(
        rail,
        "algo-risk-unit-riskCaps.maxDailyLoss",
        "usd",
      );
      await expect(rail.getByTestId("algo-halt-input-dailyLoss")).toHaveValue(
        "1000",
      );
      await expect(
        rail.getByTestId("algo-compact-input-riskCaps.maxDailyLoss"),
      ).toHaveValue("1000");

      const dailyMainPercent = rail.getByTestId(
        "algo-risk-unit-riskCaps.maxDailyLoss-percent",
      );
      await dailyMainPercent.scrollIntoViewIfNeeded();
      await dailyMainPercent.focus();
      await expect(dailyMainPercent).toBeFocused();
      await page.keyboard.press(viewport.keyboardKey);

      await expectUnit(rail, "algo-halt-unit-dailyLoss", "percent");
      await expectUnit(
        rail,
        "algo-risk-unit-riskCaps.maxDailyLoss",
        "percent",
      );
      await expect(rail.getByTestId("algo-halt-input-dailyLoss")).toHaveValue(
        "10",
      );
      await expect(
        rail.getByTestId("algo-compact-input-riskCaps.maxDailyLoss"),
      ).toHaveValue("10");
      await expect(
        rail.getByTestId("algo-halt-effective-dailyLoss"),
      ).toContainText("≈ $1,000.00");
      await expect(
        rail.getByTestId("algo-halt-effective-dailyLoss"),
      ).toHaveAttribute("aria-label", "10% of $10,000 equals $1,000.00");
      await expect(
        rail.getByTestId("algo-risk-effective-riskCaps.maxDailyLoss"),
      ).toContainText("10% of $10,000 = $1,000.00");

      await expectUnit(rail, "algo-halt-unit-premiumBudget", "percent");
      await expectUnit(
        rail,
        "algo-risk-unit-riskCaps.maxPremiumPerEntry",
        "percent",
      );
      await expect(page.getByTestId("algo-save-bar")).toContainText(
        /unsaved change/i,
      );

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
  });
}

for (const presentation of hierarchyPresentations) {
  test.describe(presentation.id, () => {
    test.use({ hasTouch: presentation.touch });

    test("active operational hierarchy stays review-only and contained", async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => {
        runtimeErrors.push(`pageerror: ${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          runtimeErrors.push(`console: ${message.text()}`);
        }
      });

      await page.setViewportSize({
        width: presentation.width,
        height: presentation.height,
      });
      await page.emulateMedia({
        colorScheme: presentation.theme,
        reducedMotion: "reduce",
      });
      const fixture = await installRiskUnitFixture(page, {
        activeHierarchy: true,
        theme: presentation.theme,
      });
      const targetUrl = new URL(APP_URL);
      targetUrl.searchParams.set("screen", "algo");

      await page.goto(targetUrl.toString(), {
        waitUntil: "domcontentloaded",
      });
      expect(new URL(page.url()).searchParams.has("pyrusQa")).toBe(false);
      await waitForAlgoWorkspace(page);
      await expect(page.locator("html")).toHaveAttribute(
        "data-pyrus-theme",
        presentation.theme,
      );
      if (presentation.width >= 768 && presentation.width < 1_024) {
        await page.getByTestId("algo-settings-inline").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/algo-control-panel-${presentation.id}-panel.png`,
          fullPage: false,
        });
      }

      const shadowTab = page.getByTestId(
        `algo-deployment-tab-${ACTIVE_SHADOW_DEPLOYMENT_ID}`,
      );
      const liveTab = page.getByTestId(
        `algo-deployment-tab-${ACTIVE_LIVE_DEPLOYMENT_ID}`,
      );
      await expect(shadowTab).toHaveAttribute("aria-selected", "true");
      await expect(shadowTab).toContainText("Momentum Options Shadow");
      await expect(
        page.getByTestId(
          `algo-deployment-mode-${ACTIVE_SHADOW_DEPLOYMENT_ID}`,
        ),
      ).toHaveText("SHADOW");
      await expect(
        page.getByTestId(
          `algo-deployment-mode-${ACTIVE_LIVE_DEPLOYMENT_ID}`,
        ),
      ).toHaveText("LIVE");

      const deploymentTabs = page.getByTestId(
        "algo-operations-deployment-tabs",
      );
      const accountBand = page.getByTestId("algo-accounts-trade-controls");
      const operationsGrid = page.getByTestId("algo-live-grid");
      const accountControl = page.getByTestId(
        "algo-deployment-accounts-control",
      );
      await expect(accountBand).toContainText("Accounts & Trade Controls");
      await expect(accountBand).toContainText(
        "No account configured · add a staged target before activation review",
      );
      await expect(accountControl).toContainText("Configure account");
      await expect(accountControl).toHaveAttribute("aria-expanded", "false");
      await expectSingleTargetFloor(
        accountControl,
        presentation.targetFloor,
      );
      const [tabsBox, closedBandBox, closedGridBox] = await Promise.all([
        deploymentTabs.boundingBox(),
        accountBand.boundingBox(),
        operationsGrid.boundingBox(),
      ]);
      expect(tabsBox).not.toBeNull();
      expect(closedBandBox).not.toBeNull();
      expect(closedGridBox).not.toBeNull();
      expect(closedBandBox!.y).toBeGreaterThanOrEqual(
        tabsBox!.y + tabsBox!.height - 1,
      );
      expect(closedGridBox!.y).toBeGreaterThanOrEqual(
        closedBandBox!.y + closedBandBox!.height - 1,
      );

      await accountControl.click();
      await expect(accountControl).toHaveAttribute("aria-expanded", "true");
      const accountPanel = page.getByTestId("deployment-accounts-panel");
      await expect(accountPanel).toBeVisible();
      await expect(accountPanel).toContainText(
        "Connect accounts to Momentum Options Shadow",
      );
      const agenticRow = accountPanel.getByTestId(
        `deployment-account-${ROBINHOOD_AGENTIC_ACCOUNT_ID}`,
      );
      const personalRow = accountPanel.getByTestId(
        `deployment-account-${ROBINHOOD_PERSONAL_ACCOUNT_ID}`,
      );
      await expect(agenticRow).toContainText("Robinhood Agentic");
      await expect(agenticRow).toContainText("Can configure");
      await expect(agenticRow).toContainText(
        "Technically ready · activation closed",
      );
      await expect(agenticRow).toContainText(
        "Account checks pass; live activation is not released yet.",
      );
      await expect(personalRow).toContainText("Robinhood Personal");
      await expect(personalRow).toContainText(
        "Only a dedicated Robinhood Agentic account can run this algo.",
      );
      await expect(
        personalRow.getByTestId(
          `deployment-account-toggle-${ROBINHOOD_PERSONAL_ACCOUNT_ID}`,
        ),
      ).toBeEnabled();
      await expect(
        accountPanel.getByTestId(`deployment-account-${SCHWAB_ACCOUNT_ID}`),
      ).toContainText(
        "Adapter wired · prerequisites remain · Schwab options order tooling still needs verification.",
      );
      await expect(
        accountPanel.getByTestId(`deployment-account-${SNAPTRADE_ACCOUNT_ID}`),
      ).toContainText(
        "Adapter wired · prerequisites remain · This SnapTrade brokerage still needs verified options-order support.",
      );
      await expect(
        accountPanel.getByTestId(`deployment-account-${IBKR_ACCOUNT_ID}`),
      ).toContainText(
        "Adapter wired · prerequisites remain · IBKR automated live orders are disabled by the execution platform.",
      );

      const agenticToggle = agenticRow.getByTestId(
        `deployment-account-toggle-${ROBINHOOD_AGENTIC_ACCOUNT_ID}`,
      );
      await agenticToggle.focus();
      await expect(agenticToggle).toBeFocused();
      await page.keyboard.press("Space");
      await expect(agenticToggle).toBeChecked();
      await agenticRow
        .getByTestId(
          `deployment-account-${ROBINHOOD_AGENTIC_ACCOUNT_ID}-allowance-unit-percent`,
        )
        .click();
      await agenticRow
        .getByRole("spinbutton", { name: /This deployment’s allowance/ })
        .fill("25");
      await agenticRow
        .getByTestId(
          `deployment-account-${ROBINHOOD_AGENTIC_ACCOUNT_ID}-total-allowance-unit-percent`,
        )
        .click();
      await agenticRow
        .getByRole("spinbutton", { name: /Total algo allowance/ })
        .fill("60");
      const reviewAccountChanges = accountPanel.getByTestId(
        "deployment-accounts-review",
      );
      await expect(reviewAccountChanges).toBeEnabled();
      await expectSingleTargetFloor(
        reviewAccountChanges,
        presentation.targetFloor,
      );
      await reviewAccountChanges.click();
      await expect(accountPanel).toContainText(
        "Review every account change before applying it.",
      );
      await expect(accountPanel).toContainText(
        "Set this deployment’s allowance to 25% and the shared account total to 60% across 1 deployment. Keep the target staged.",
      );
      await expect(
        accountPanel.getByTestId("deployment-accounts-apply"),
      ).toBeVisible();
      expect(fixture.protectedMutations).toEqual([]);

      await accountPanel
        .getByRole("button", { name: "Back", exact: true })
        .click();
      await accountPanel
        .getByRole("button", { name: "Discard & collapse", exact: true })
        .click();
      await expect(accountPanel).toBeHidden();
      await expect(accountControl).toHaveAttribute("aria-expanded", "false");
      await expect(accountControl).toBeFocused();
      await expectNoHorizontalOverflow(accountBand);
      await expectNoDocumentOverflow(page);

      const deploymentIdentity = page.getByTestId(
        "algo-active-deployment-identity",
      );
      await expect(deploymentIdentity).toContainText(
        "Momentum Options Shadow",
      );
      const modeControl = page.getByTestId("algo-deployment-mode-control");
      const runControl = page.getByTestId("algo-deployment-run-control");
      const headerMonitor = page.getByTestId("algo-operations-header-monitor");
      await expect(modeControl).toHaveText("SHADOW");
      await expect(runControl).toContainText("PAUSED");
      await expect(runControl).toContainText("Start shadow deployment");
      await expectFullyInside(modeControl, headerMonitor);
      await expectFullyInside(runControl, headerMonitor);
      await expectSingleTargetFloor(modeControl, presentation.targetFloor);
      await expectSingleTargetFloor(runControl, presentation.targetFloor);

      await modeControl.click();
      await expect(accountPanel).toBeVisible();
      await expect(page.getByTestId("algo-live-switch-confirm")).toHaveCount(0);
      expect(fixture.protectedMutations).toEqual([]);
      await accountPanel
        .getByRole("button", { name: "Collapse", exact: true })
        .click();
      await expect(accountPanel).toBeHidden();
      await expect(accountControl).toBeFocused();
      expect(fixture.protectedMutations).toEqual([]);

      await liveTab.click();
      await expect(liveTab).toHaveAttribute("aria-selected", "true");
      await expect(modeControl).toHaveText("LIVE MONEY");
      await expect(modeControl).toHaveAttribute("aria-label", /Manage live accounts/);
      await expect(runControl).toContainText("PAUSED");
      await expect(runControl).toContainText("Review live activation");
      await shadowTab.click();
      await expect(shadowTab).toHaveAttribute("aria-selected", "true");
      await expect(modeControl).toHaveText("SHADOW");

      const attention = page.getByTestId("algo-operations-attention-strip");
      const transitions = page.getByTestId(
        "algo-operations-transitions-strip",
      );
      await expect(attention).toContainText("TSLA spread too wide");
      await expect(transitions).toContainText(/NVDA|TSLA/);

      const signalTable = page.getByTestId("algo-operations-signal-table");
      await expect(signalTable).toContainText("NVDA");
      await expect(signalTable).toContainText("TSLA");
      const reviewAction = signalTable.getByTestId(
        "algo-signal-row-action-openTrade",
      );
      await expect(reviewAction).toHaveCount(1);
      await expect(reviewAction).toHaveText("Review in Trade");
      await expect(reviewAction).toHaveAttribute("aria-label", /NVDA.*Trade/);
      await expectSingleTargetFloor(reviewAction, presentation.targetFloor);
      await expect(
        signalTable
          .getByTestId("algo-signal-row-TSLA")
          .getByTestId("algo-signal-row-action-none"),
      ).toBeVisible();

      const accountTabs = page.getByTestId("algo-account-tabs");
      await expect(accountTabs).toHaveAttribute(
        "data-active-tab-id",
        "shadow",
      );
      const positions = page.getByTestId("algo-operations-positions-table");
      await expect(positions).toContainText("NVDA");
      await expectNoHorizontalOverflow(page.getByTestId("algo-live-main-column"));
      await expectNoDocumentOverflow(page);

      const settingsButton = await findVisible(
        page.getByRole("button", { name: "Open algo settings" }),
      );
      if (presentation.width < 768) {
        expect(settingsButton).not.toBeNull();
        await expect(page.getByTestId("algo-settings-drawer")).toHaveCount(0);
        await expectSingleTargetFloor(
          settingsButton!,
          presentation.targetFloor,
        );
        await settingsButton!.click();
        const drawer = page.getByTestId("algo-settings-drawer");
        await expect(drawer).toBeVisible();
        await expect(drawer.getByTestId("algo-right-rail")).toBeVisible();
        await expect(
          drawer.getByTestId("algo-diagnostics-container"),
        ).toContainText(/blocked|spread|fresh/i);
        await page.screenshot({
          path: `test-results/algo-control-panel-${presentation.id}-panel.png`,
          fullPage: false,
        });
        await drawer
          .getByRole("button", { name: "Close algo settings" })
          .click();
        await expect(drawer).toBeHidden();
        await expect(page.getByTestId("algo-live-right-column")).toHaveCount(0);
        await expect(page.getByTestId("algo-settings-inline")).toHaveCount(0);
      } else if (presentation.width < 1_024) {
        expect(settingsButton).toBeNull();
        await expect(page.getByTestId("algo-settings-drawer")).toHaveCount(0);
        await expect(
          page.getByRole("dialog", { name: "Algo settings" }),
        ).toHaveCount(0);
        const inlineSettings = page.getByTestId("algo-settings-inline");
        await expect(inlineSettings).toBeVisible();
        await expect(inlineSettings.getByTestId("algo-right-rail")).toBeVisible();
        await expect(
          inlineSettings.getByTestId("algo-diagnostics-container"),
        ).toContainText(/blocked|spread|fresh/i);
        await expectSeventyThirtyWorkspace(inlineSettings);
        await page.screenshot({
          path: `test-results/algo-control-panel-${presentation.id}.png`,
          fullPage: false,
        });
        await expect(page.getByTestId("algo-live-right-column")).toHaveCount(0);
      } else {
        expect(settingsButton).toBeNull();
        await expect(page.getByTestId("algo-settings-inline")).toHaveCount(0);
        await expect(page.getByTestId("algo-live-right-column")).toBeVisible();
        await expect(page.getByTestId("algo-right-rail")).toBeVisible();
        await expect(
          page.getByTestId("algo-diagnostics-container"),
        ).toContainText(/blocked|spread|fresh/i);
        await page.getByTestId("algo-live-right-column").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/algo-control-panel-${presentation.id}-panel.png`,
          fullPage: false,
        });
      }
      await expect(page.getByTestId("platform-algo-monitor-card")).toHaveCount(
        0,
      );

      await reviewAction.click();
      await expect(page.getByTestId("screen-host-trade")).toBeVisible({
        timeout: READY_TIMEOUT_MS,
      });
      const tradeAutomationContext = page.getByTestId(
        "trade-signal-options-context",
      );
      await expect(tradeAutomationContext).toBeVisible();
      await expect(tradeAutomationContext).toContainText("MATCHED");
      await expect.poll(() => readTradeSelection(page)).toEqual({
        ticker: "NVDA",
        strike: 180,
        cp: "C",
        exp: "07/24",
        providerContractId: selectedContract("NVDA", 180).providerContractId,
      });

      await page.goto(targetUrl.toString(), {
        waitUntil: "domcontentloaded",
      });
      await waitForAlgoWorkspace(page);
      const brokerTab = page.getByTestId(`account-tab-${BROKER_ACCOUNT_ID}`);
      await brokerTab.click();
      await expect(page.getByTestId("algo-account-tabs")).toHaveAttribute(
        "data-active-tab-id",
        BROKER_ACCOUNT_ID,
      );
      const brokerPositions = page.getByTestId(
        "algo-operations-positions-table",
      );
      await expect(brokerPositions).toContainText("AAPL");
      const brokerTrade = brokerPositions.getByRole("button", {
        name: "Open AAPL in the trade ticket",
        exact: true,
      });
      await expectSingleTargetFloor(brokerTrade, presentation.targetFloor);
      await brokerTrade.click();
      await expect(page.getByTestId("screen-host-trade")).toBeVisible({
        timeout: READY_TIMEOUT_MS,
      });
      await expect.poll(() => readTradeSelection(page)).toMatchObject({
        ticker: "AAPL",
      });

      expect(fixture.protectedMutations).toEqual([]);
      expect(fixture.unknownGetPaths).toEqual(new Set());
      expect(runtimeErrors).toEqual([]);
      expect(
        fixture.allowedBackgroundMutations.every((entry) =>
          [
            "POST /api/sparklines/seed",
            "POST /api/diagnostics/client-metrics",
            "POST /api/options/quotes",
          ].includes(entry),
        ),
      ).toBe(true);
    });
  });
}

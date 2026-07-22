import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  expect,
  test,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";

const APP_URL = process.env.PYRUS_APP_URL || "http://127.0.0.1:18747/";
const READY_TIMEOUT_MS = 60_000;
const SERVER_PROBE_TIMEOUT_MS = 2_500;
const FIXTURE_TIME = "2026-07-19T22:00:00.000Z";

const REGISTERED_ROUTES = [
  {
    id: "market",
    label: "Market",
    anchor: '[data-testid="market-demo-screen"]',
  },
  {
    id: "market-demo",
    label: "Market Demo",
    anchor: '[data-testid="market-demo-screen"]',
  },
  { id: "signals", label: "Signals", anchor: '[data-testid="signals-screen"]' },
  { id: "flow", label: "Flow", anchor: '[data-testid="flow-main-layout"]' },
  { id: "gex", label: "GEX", anchor: '[data-testid="gex-screen"]' },
  {
    id: "trade",
    label: "Trade",
    anchor: ".ra-panel-enter[data-trade-layout]",
  },
  { id: "account", label: "Account", anchor: '[data-testid="account-screen"]' },
  {
    id: "research",
    label: "Research",
    anchor: '[data-testid="research-screen"]',
  },
  { id: "algo", label: "Algo", anchor: '[data-testid="algo-screen"]' },
  {
    id: "backtest",
    label: "Backtest",
    anchor: '[data-testid="backtest-screen"]',
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    anchor: '[data-testid="diagnostics-screen"]',
  },
  {
    id: "settings",
    label: "Settings",
    anchor: '[data-testid="settings-screen"]',
  },
] as const;

const PRESENTATIONS = [
  {
    id: "phone-dark",
    width: 390,
    height: 844,
    theme: "dark",
    appReducedMotion: "on",
    osReducedMotion: "no-preference",
  },
  {
    id: "phone-light",
    width: 390,
    height: 844,
    theme: "light",
    appReducedMotion: "off",
    osReducedMotion: "reduce",
  },
  {
    id: "tablet-dark",
    width: 768,
    height: 1024,
    theme: "dark",
    appReducedMotion: "on",
    osReducedMotion: "no-preference",
  },
  {
    id: "tablet-light",
    width: 768,
    height: 1024,
    theme: "light",
    appReducedMotion: "off",
    osReducedMotion: "reduce",
  },
  {
    id: "desktop-dark",
    width: 1440,
    height: 900,
    theme: "dark",
    appReducedMotion: "on",
    osReducedMotion: "no-preference",
  },
  {
    id: "desktop-light",
    width: 1440,
    height: 900,
    theme: "light",
    appReducedMotion: "off",
    osReducedMotion: "reduce",
  },
] as const;

const settledOnboarding = {
  schemaVersion: 1,
  autoOpenShownVersion: 1,
  requiredNoticeSeenVersion: 1,
  requiredNoticeResolvedVersion: 1,
  requiredAcknowledgedVersion: 1,
  readinessInspectedVersion: 1,
  activeTrackId: null,
  tracks: {},
};

const SIGNALS_PROFILE = {
  id: "design-doctrine-signals",
  environment: "shadow",
  enabled: true,
  watchlistId: "doctrine-core",
  timeframe: "5m",
  pyrusSignalsSettings: {},
  freshWindowBars: 3,
  pollIntervalSeconds: 60,
  maxSymbols: 1,
  evaluationConcurrency: 1,
  lastEvaluatedAt: FIXTURE_TIME,
  lastError: null,
  createdAt: FIXTURE_TIME,
  updatedAt: FIXTURE_TIME,
};

const FLOW_HANDOFF_EVENT = {
  id: "doctrine-flow-aapl-call",
  basis: "trade",
  occurredAt: "2026-07-19T21:58:00.000Z",
  underlying: "AAPL",
  expirationDate: "2026-07-24",
  right: "call",
  strike: 230,
  side: "buy",
  price: 2.5,
  bid: 2.4,
  ask: 2.6,
  size: 1_000,
  openInterest: 320,
  impliedVolatility: 0.31,
  underlyingPrice: 225.1,
  provider: "massive",
  optionTicker: "O:AAPL260724C00230000",
  providerContractId: "doctrine-aapl-230-call",
  sentiment: "bullish",
  sourceBasis: "confirmed_trade",
  confidence: "confirmed_trade",
  tradeConditions: ["sweep"],
  isUnusual: true,
  unusualScore: 3.125,
};

const DOCTRINE_TRADE_CHAIN = [
  {
    contract: {
      ticker: "O:AAPL260724C00230000",
      providerContractId: "doctrine-aapl-230-call",
      underlying: "AAPL",
      expirationDate: "2026-07-24",
      right: "call",
      strike: 230,
    },
    bid: 2.4,
    ask: 2.6,
    last: 2.5,
    volume: 1_000,
    openInterest: 320,
    impliedVolatility: 0.31,
    delta: 0.54,
    gamma: 0.04,
    theta: -0.08,
    vega: 0.12,
    quoteFreshness: "live",
    quoteUpdatedAt: FIXTURE_TIME,
  },
  {
    contract: {
      ticker: "O:AAPL260724P00230000",
      providerContractId: "doctrine-aapl-230-put",
      underlying: "AAPL",
      expirationDate: "2026-07-24",
      right: "put",
      strike: 230,
    },
    bid: 7.2,
    ask: 7.5,
    last: 7.35,
    volume: 840,
    openInterest: 410,
    impliedVolatility: 0.32,
    delta: -0.46,
    gamma: 0.04,
    theta: -0.09,
    vega: 0.12,
    quoteFreshness: "live",
    quoteUpdatedAt: FIXTURE_TIME,
  },
];

const DOCTRINE_ACCOUNT = {
  id: "snaptrade:doctrine-account",
  providerAccountId: "doctrine-account",
  provider: "snaptrade",
  mode: "live",
  displayName: "Primary",
  currency: "USD",
  buyingPower: 42_000,
  cash: 17_490,
  netLiquidation: 40_000,
  dayPnl: 420,
  dayPnlPercent: 1.06,
  includedInTrading: true,
  updatedAt: FIXTURE_TIME,
};

const DOCTRINE_ACCOUNT_ORDER = {
  id: "doctrine-working-order",
  accountId: "combined",
  symbol: "AAPL",
  side: "buy",
  type: "limit",
  assetClass: "stock",
  quantity: 20,
  filledQuantity: 0,
  limitPrice: 222,
  stopPrice: null,
  timeInForce: "day",
  status: "working",
  placedAt: "2026-07-19T20:15:00.000Z",
  filledAt: null,
  updatedAt: FIXTURE_TIME,
  averageFillPrice: null,
  commission: null,
  source: "fixture",
  sourceType: "manual",
};

const DOCTRINE_ACCOUNT_POSITION = {
  id: "doctrine-aapl-position",
  accountId: "combined",
  accounts: [DOCTRINE_ACCOUNT.id],
  symbol: "AAPL",
  description: "Apple Inc.",
  assetClass: "Stock",
  positionType: "stock",
  marketDataSymbol: "AAPL",
  sector: "Technology",
  quantity: 100,
  averageCost: 210,
  mark: 225.1,
  dayChange: 120,
  dayChangePercent: 0.54,
  unrealizedPnl: 1_510,
  unrealizedPnlPercent: 7.19,
  marketValue: 22_510,
  weightPercent: 56.28,
  accountWeightPercent: 56.28,
  scopedWeightPercent: 56.28,
  betaWeightedDelta: 100,
  lots: [
    {
      accountId: DOCTRINE_ACCOUNT.id,
      symbol: "AAPL",
      quantity: 100,
      averageCost: 210,
      marketPrice: 225.1,
      marketValue: 22_510,
      unrealizedPnl: 1_510,
      asOf: FIXTURE_TIME,
      source: "fixture",
    },
  ],
  openOrders: [DOCTRINE_ACCOUNT_ORDER],
  source: "fixture",
  sourceType: "manual",
  attributionStatus: "attributed",
  sourceAttribution: [],
  openedAt: "2026-07-01T14:30:00.000Z",
  openedAtSource: "broker",
  quote: {
    bid: 225,
    ask: 225.2,
    mid: 225.1,
    mark: 225.1,
    last: 225.1,
    updatedAt: FIXTURE_TIME,
    freshness: "live",
  },
};

const DOCTRINE_ACCOUNT_TRADE = {
  id: "doctrine-closed-trade",
  accountId: "combined",
  symbol: "MSFT",
  assetClass: "Stock",
  positionType: "stock",
  quantity: 25,
  openDate: "2026-07-10T14:30:00.000Z",
  closeDate: "2026-07-18T19:00:00.000Z",
  avgOpen: 485,
  avgClose: 497,
  realizedPnl: 300,
  realizedPnlPercent: 2.47,
  holdDurationMinutes: 11_790,
  commissions: 2,
  currency: "USD",
  orderIds: [],
  source: "fixture",
  sourceType: "manual",
  exitReason: "target_reached",
  peakPrice: 501,
  mfePercent: 3.3,
  givebackPercent: 0.8,
};

const doctrineAccountSummary = {
  accountId: "combined",
  isCombined: true,
  mode: "live",
  currency: "USD",
  accounts: [
    {
      id: DOCTRINE_ACCOUNT.id,
      displayName: DOCTRINE_ACCOUNT.displayName,
      currency: "USD",
      live: true,
      accountType: "cash",
      updatedAt: FIXTURE_TIME,
    },
  ],
  updatedAt: FIXTURE_TIME,
  fx: {
    baseCurrency: "USD",
    timestamp: FIXTURE_TIME,
    rates: {},
    warning: null,
  },
  badges: {},
  metrics: {
    netLiquidation: {
      value: 40_000,
      currency: "USD",
      source: "fixture",
      field: "netLiquidation",
      updatedAt: FIXTURE_TIME,
    },
    cash: {
      value: 17_490,
      currency: "USD",
      source: "fixture",
      field: "cash",
      updatedAt: FIXTURE_TIME,
    },
    buyingPower: {
      value: 42_000,
      currency: "USD",
      source: "fixture",
      field: "buyingPower",
      updatedAt: FIXTURE_TIME,
    },
    dayPnl: {
      value: 420,
      currency: "USD",
      source: "fixture",
      field: "dayPnl",
      updatedAt: FIXTURE_TIME,
    },
    dayPnlPercent: {
      value: 1.06,
      currency: null,
      source: "fixture",
      field: "dayPnlPercent",
      updatedAt: FIXTURE_TIME,
    },
  },
};

const doctrineAccountAllocation = {
  accountId: "combined",
  currency: "USD",
  assetClass: [
    {
      label: "Stocks",
      value: 22_510,
      weightPercent: 56.28,
      source: "fixture",
    },
    {
      label: "Cash",
      value: 17_490,
      weightPercent: 43.72,
      source: "fixture",
    },
  ],
  sector: [
    {
      label: "Technology",
      value: 22_510,
      weightPercent: 56.28,
      source: "fixture",
    },
  ],
  exposure: {
    grossLong: 22_510,
    grossShort: 0,
    netExposure: 22_510,
  },
  updatedAt: FIXTURE_TIME,
};

const doctrineAccountPositions = {
  accountId: "combined",
  currency: "USD",
  positions: [DOCTRINE_ACCOUNT_POSITION],
  totals: {
    marketValue: 22_510,
    unrealizedPnl: 1_510,
    dayPnl: 120,
  },
  updatedAt: FIXTURE_TIME,
};

const doctrineAccountOrders = {
  accountId: "combined",
  tab: "working",
  currency: "USD",
  orders: [DOCTRINE_ACCOUNT_ORDER],
  updatedAt: FIXTURE_TIME,
};

const doctrineAccountRisk = {
  accountId: "combined",
  currency: "USD",
  concentration: {},
  winnersLosers: {},
  margin: {
    marginAvailable: 17_490,
    marginUsed: 22_510,
    maintenanceMargin: 0,
    maintenanceCushionPercent: 43.72,
    leverageRatio: 0.56,
    providerFields: { accountType: "Cash account" },
  },
  greeks: {
    delta: 100,
    betaWeightedDelta: 100,
    theta: 0,
    coverage: "complete",
    warning: null,
    perUnderlying: [],
  },
  expiryConcentration: {},
  updatedAt: FIXTURE_TIME,
};

const doctrineAccountClosedTrades = {
  accountId: "combined",
  currency: "USD",
  trades: [DOCTRINE_ACCOUNT_TRADE],
  summary: {},
  updatedAt: FIXTURE_TIME,
};

const doctrineAccountCashActivity = {
  accountId: "combined",
  currency: "USD",
  settledCash: 17_490,
  unsettledCash: 0,
  totalCash: 17_490,
  dividendsMonth: 22,
  dividendsYtd: 142,
  interestPaidEarnedYtd: 18,
  feesYtd: 12,
  activities: [
    {
      id: "doctrine-deposit",
      accountId: "combined",
      date: "2026-07-15T13:00:00.000Z",
      type: "Deposit",
      description: "Account funding",
      amount: 5_000,
      currency: "USD",
      source: "fixture",
    },
  ],
  dividends: [
    {
      id: "doctrine-dividend",
      accountId: "combined",
      symbol: "AAPL",
      description: "Apple dividend",
      paidDate: "2026-07-16T13:00:00.000Z",
      amount: 22,
      currency: "USD",
      source: "fixture",
    },
  ],
  updatedAt: FIXTURE_TIME,
};

const doctrineAccountEquity = (range = "ALL", benchmark: string | null = null) => ({
  accountId: "combined",
  range,
  currency: "USD",
  flexConfigured: false,
  lastFlexRefreshAt: null,
  benchmark,
  asOf: FIXTURE_TIME,
  latestSnapshotAt: FIXTURE_TIME,
  terminalPointSource: "live_account_summary",
  liveTerminalIncluded: true,
  sourceScope: "manual",
  selectedSnapshotSource: "fixture",
  points: [
    {
      timestamp: "2026-07-18T20:00:00.000Z",
      netLiquidation: 39_580,
      currency: "USD",
      source: "IBKR_ACCOUNT_SUMMARY",
      deposits: 0,
      withdrawals: 0,
      dividends: 0,
      fees: 0,
      returnPercent: 0,
      benchmarkPercent: benchmark ? 0 : null,
    },
    {
      timestamp: FIXTURE_TIME,
      netLiquidation: 40_000,
      currency: "USD",
      source: "IBKR_ACCOUNT_SUMMARY",
      deposits: 0,
      withdrawals: 0,
      dividends: 22,
      fees: 2,
      returnPercent: 1.06,
      benchmarkPercent: benchmark ? 0.45 : null,
    },
  ],
  events: [],
});

const buildSignalsMatrixState = (timeframe: string, index: number) => ({
  id: `design-doctrine-aapl-${timeframe}`,
  profileId: SIGNALS_PROFILE.id,
  symbol: "AAPL",
  timeframe,
  currentSignalDirection: "buy",
  currentSignalAt: "2026-07-19T21:45:00.000Z",
  currentSignalPrice: 224.5,
  currentSignalClose: 225.1,
  currentSignalMfePercent: 0.8,
  currentSignalMaePercent: -0.2,
  filterState: {
    adxGate: "pass",
    sessionGate: "pass",
  },
  latestBarAt: `2026-07-19T21:${String(50 + Math.min(index, 9)).padStart(2, "0")}:00.000Z`,
  latestBarClose: 225.1 + index * 0.1,
  barsSinceSignal: index + 1,
  fresh: true,
  status: "ok",
  active: true,
  lastEvaluatedAt: FIXTURE_TIME,
  lastError: null,
  indicatorSnapshot: {
    trendDirection: "bullish",
    trendAgeBars: index + 2,
    trendAgeBucket: "new",
    adx: 31.4,
    strength: "strong",
    volatilityScore: 6,
    mtf: [
      {
        timeframe: "15m",
        direction: "bullish",
        required: true,
        pass: true,
      },
      {
        timeframe: "1h",
        direction: "bullish",
        required: true,
        pass: true,
      },
    ],
    filterState: {
      adxGate: "pass",
      sessionGate: "pass",
    },
  },
  trendDirection: "bullish",
  actionEligible: true,
  actionBlocker: null,
});

const EVENT_STREAM_PATHS = new Set([
  "/api/diagnostics/stream",
  "/api/streams/accounts",
  "/api/streams/accounts/shadow",
  "/api/streams/algo/cockpit",
  "/api/streams/executions",
  "/api/streams/options/chains",
  "/api/streams/orders",
  "/api/streams/quotes",
  "/api/streams/stocks/aggregates",
]);

const EMPTY_OBJECT_GET_PATHS = new Set([
  "/api/accounts/flex/health",
  "/api/accounts/shadow/allocation",
  "/api/accounts/shadow/risk",
  "/api/accounts/shadow/summary",
  "/api/accounts/shadow/watchlist-backtest/runs",
  "/api/backtests/drafts",
  "/api/backtests/jobs",
  "/api/backtests/overnight-expectancy",
  "/api/backtests/pattern-discovery",
  "/api/backtests/runs",
  "/api/backtests/strategies",
  "/api/backtests/studies",
  "/api/backtests/sweeps",
  "/api/broker-execution/ibkr/oauth/readiness",
  "/api/broker-execution/ibkr-portal/readiness",
  "/api/broker-execution/ibkr-portal/status",
  "/api/broker-execution/robinhood/readiness",
  "/api/broker-execution/schwab/readiness",
  "/api/broker-execution/snaptrade/brokerages",
  "/api/broker-execution/snaptrade/readiness",
  "/api/broker-execution/snaptrade/users/current",
  "/api/charting/pine-scripts",
  "/api/diagnostics/browser-reports",
  "/api/diagnostics/events",
  "/api/diagnostics/export",
  "/api/diagnostics/history",
  "/api/diagnostics/runtime",
  "/api/diagnostics/thresholds",
  "/api/flow/premium-distribution",
  "/api/flow/scanner/benchmark",
  "/api/gex-snapshots",
  "/api/healthz",
  "/api/options/chains/batch",
  "/api/options/chart-bars",
  "/api/options/quotes",
  "/api/options/resolve-contract",
  "/api/readiness",
  "/api/research/earnings-calendar",
  "/api/research/financials",
  "/api/research/fundamentals",
  "/api/research/sec-filings",
  "/api/research/snapshots",
  "/api/research/transcript",
  "/api/research/transcripts",
  "/api/settings/backend",
  "/api/signal-monitor/breadth-history",
  "/api/tax/overview",
  "/api/tax/profile",
  "/api/tax/reserve",
  "/api/tax/reserve/plan",
  "/api/tax/state-rules/status",
]);

const KNOWN_GET_PATH_PATTERNS = [
  /^\/api\/accounts\/[^/]+$/u,
  /^\/api\/accounts\/[^/]+\/(?:allocation|cash-activity|closed-trades|equity-history|orders|positions|risk|summary)$/u,
  /^\/api\/accounts\/(?:all|[^/]+)\/tax\/(?:events|overview)$/u,
  /^\/api\/algo\/deployments\/[^/]+(?:\/.*)?$/u,
  /^\/api\/backtests\/(?:jobs|overnight-expectancy|pattern-discovery|runs|studies)\/[^/]+(?:\/.*)?$/u,
  /^\/api\/broker-execution\/(?:robinhood|schwab|snaptrade)\/accounts\/[^/]+(?:\/.*)?$/u,
  /^\/api\/charting\/pine-scripts\/[^/]+$/u,
  /^\/api\/diagnostics\/events\/[^/]+$/u,
  /^\/api\/gex\/[^/]+$/u,
  /^\/api\/gex\/[^/]+\/(?:projection|zero-gamma)$/u,
  /^\/api\/streams\/accounts\/page$/u,
  /^\/api\/streams\/stocks\/aggregates\/sessions\/[^/]+$/u,
] as const;

const isKnownGetPath = (path: string) =>
  EMPTY_OBJECT_GET_PATHS.has(path) ||
  KNOWN_GET_PATH_PATTERNS.some((pattern) => pattern.test(path));

const selectedRouteIds = new Set(
  (process.env.PYRUS_DOCTRINE_SCREENS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const selectedPresentationIds = new Set(
  (process.env.PYRUS_DOCTRINE_PRESENTATIONS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const ROUTES =
  selectedRouteIds.size > 0
    ? REGISTERED_ROUTES.filter((route) => selectedRouteIds.has(route.id))
    : REGISTERED_ROUTES;
const MATRIX_PRESENTATIONS =
  selectedPresentationIds.size > 0
    ? PRESENTATIONS.filter((presentation) =>
        selectedPresentationIds.has(presentation.id),
      )
    : PRESENTATIONS;

const appServerAvailable = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(APP_URL, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const routeUrl = (screenId: string) => {
  const url = new URL(APP_URL);
  url.searchParams.delete("pyrusQa");
  url.searchParams.delete("qa");
  url.searchParams.set("screen", screenId);
  return url.toString();
};

async function fulfillQuietEventStream(route: Route) {
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: "event: ready\ndata: {}\n\nretry: 60000\n\n",
  });
}

async function fulfillSignalsMatrixStream(route: Route, url: URL) {
  const requestedTimeframes = (url.searchParams.get("timeframes") || "5m,15m,1h")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const timeframes = requestedTimeframes.length
    ? [...new Set(requestedTimeframes)]
    : ["5m", "15m", "1h"];
  const states = timeframes.map(buildSignalsMatrixState);
  const payload = {
    stream: "signal-matrix",
    event: "bootstrap",
    profile: SIGNALS_PROFILE,
    states,
    evaluatedAt: FIXTURE_TIME,
    timeframes,
    coverage: {
      requestedSymbols: 1,
      activeScopeSymbols: 1,
      timeframes: timeframes.length,
      taskCount: states.length,
      source: "massive-websocket",
      delayed: false,
      eventCount: 1,
      stateCount: states.length,
      skippedSymbols: 0,
      truncated: false,
      lastEventAt: FIXTURE_TIME,
      lastEventAgeMs: 0,
    },
  };
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: `event: bootstrap\ndata: ${JSON.stringify(payload)}\n\nretry: 60000\n\n`,
  });
}

async function fulfillDoctrineAccountPageStream(route: Route, url: URL) {
  const accountId = url.searchParams.get("accountId") || "combined";
  const mode = url.searchParams.get("mode") === "shadow" ? "shadow" : "live";
  const range = url.searchParams.get("range") || "ALL";
  const orderTab =
    url.searchParams.get("orderTab") === "history" ? "history" : "working";
  const assetClass = url.searchParams.get("assetClass");
  const performanceCalendarFrom = url.searchParams.get(
    "performanceCalendarFrom",
  );
  const tradeFilters = {
    from: url.searchParams.get("tradeFrom"),
    to: url.searchParams.get("tradeTo"),
    symbol: url.searchParams.get("tradeSymbol"),
    assetClass: url.searchParams.get("tradeAssetClass"),
    pnlSign: url.searchParams.get("pnlSign"),
    holdDuration: url.searchParams.get("holdDuration"),
  };
  const orders = {
    ...doctrineAccountOrders,
    accountId,
    tab: orderTab,
  };
  const summary = { ...doctrineAccountSummary, accountId, mode };
  const allocation = { ...doctrineAccountAllocation, accountId };
  const positions = { ...doctrineAccountPositions, accountId };
  const risk = { ...doctrineAccountRisk, accountId };
  const closedTrades = { ...doctrineAccountClosedTrades, accountId };
  const cashActivity = { ...doctrineAccountCashActivity, accountId };
  const equityHistory = {
    ...doctrineAccountEquity(range),
    accountId,
  };
  const intradayEquity = {
    ...doctrineAccountEquity("1D"),
    accountId,
  };
  const performanceCalendarEquity = {
    ...doctrineAccountEquity("1Y"),
    accountId,
  };
  const primary = {
    stream: "account-page-primary",
    accountId,
    mode,
    orderTab,
    assetClass,
    updatedAt: FIXTURE_TIME,
    summary,
    allocation,
    positions,
    orders,
    risk,
  };
  const live = {
    ...primary,
    stream: "account-page-live",
    intradayEquity,
  };
  const derived = {
    stream: "account-page-derived",
    accountId,
    mode,
    range,
    tradeFilters,
    performanceCalendarFrom,
    updatedAt: FIXTURE_TIME,
    equityHistory,
    benchmarkEquityHistory: {
      SPY: { ...doctrineAccountEquity(range, "SPY"), accountId },
      QQQ: { ...doctrineAccountEquity(range, "QQQ"), accountId },
      DIA: { ...doctrineAccountEquity(range, "DIA"), accountId },
    },
    performanceCalendarEquity,
    performanceCalendarTrades: closedTrades,
    closedTrades,
    cashActivity,
    flexHealth: null,
  };
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-type": "text/event-stream",
    },
    body: [
      `event: primary\ndata: ${JSON.stringify(primary)}\n\n`,
      `event: live\ndata: ${JSON.stringify(live)}\n\n`,
      `event: derived\ndata: ${JSON.stringify(derived)}\n\n`,
      "retry: 60000\n\n",
    ].join(""),
  });
}

function buildSettingsBackendSnapshot(pendingIsolationMode?: string) {
  return {
    updatedAt: FIXTURE_TIME,
    groups: [
      { id: "runtime", label: "Runtime" },
      { id: "isolation", label: "Isolation" },
    ],
    summary: {
      tradingMode: "shadow",
      providers: { massive: true, research: true, ibkr: true },
      diagnosticsStatus: "ok",
      diagnosticsSeverity: "info",
      pendingRestartCount: pendingIsolationMode ? 1 : 0,
      thresholdCount: 3,
      watchlistCount: 1,
      watchlistSymbolCount: 1,
      signalMonitor: null,
      researchConfigured: true,
      pineScriptCount: 0,
      chartEnabledPineScriptCount: 0,
      algoDeploymentCount: 0,
      enabledAlgoDeploymentCount: 0,
    },
    settings: [
      {
        key: "runtime.tradingMode",
        group: "runtime",
        label: "Trading Mode",
        description: "Effective backend trading environment.",
        type: "status",
        value: "shadow",
        defaultValue: "shadow",
        source: "default",
        editable: false,
        requiresRestart: true,
        risk: "risky",
      },
      {
        key: "isolation.mode",
        group: "isolation",
        label: "Cross-Origin Isolation Mode",
        description: "Controls isolation headers after restart.",
        type: "select",
        value: "off",
        defaultValue: "off",
        source: pendingIsolationMode ? "pending_restart" : "default",
        editable: true,
        requiresRestart: true,
        risk: "risky",
        options: [
          { value: "off", label: "off" },
          { value: "report-only", label: "report-only" },
          { value: "enforce", label: "enforce" },
        ],
        ...(pendingIsolationMode
          ? { pendingValue: pendingIsolationMode }
          : {}),
      },
    ],
  };
}

async function installDoctrineFixture(
  page: Page,
  presentation: (typeof PRESENTATIONS)[number],
  {
    accountFixture = false,
    backtestFixture = false,
    holdAggregateFlowFailure = false,
    flowEvents = [],
    settingsAccountState = "populated",
    settingsFixture = false,
    tradeFixture = false,
  }: {
    accountFixture?: boolean;
    backtestFixture?: boolean;
    holdAggregateFlowFailure?: boolean;
    flowEvents?: Array<Record<string, unknown>>;
    settingsAccountState?:
      | "populated"
      | "loading"
      | "empty"
      | "error-then-success";
    settingsFixture?: boolean;
    tradeFixture?: boolean;
  } = {},
) {
  const unexpectedReads: string[] = [];
  const blockedMutations: string[] = [];
  const allowedBackgroundRequests: string[] = [];
  let aggregateFlowRequestCount = 0;
  let aggregateFlowFailureHeld = holdAggregateFlowFailure;
  const backtestPromotionRequests: Array<Record<string, unknown>> = [];
  const settingsApplyRequests: Array<Record<string, unknown>> = [];
  let settingsBackendLoadReleased = !settingsFixture;
  let settingsAccountsLoadReleased = settingsAccountState !== "loading";
  let settingsAccountsRequestCount = 0;
  let settingsApplyReleased = !settingsFixture;
  let releaseSettingsBackendLoadGate = () => {};
  let releaseSettingsAccountsLoadGate = () => {};
  let releaseSettingsApplyGate = () => {};
  const settingsBackendLoadGate = new Promise<void>((resolve) => {
    releaseSettingsBackendLoadGate = resolve;
  });
  const settingsApplyGate = new Promise<void>((resolve) => {
    releaseSettingsApplyGate = resolve;
  });
  const settingsAccountsLoadGate = new Promise<void>((resolve) => {
    releaseSettingsAccountsLoadGate = resolve;
  });
  if (settingsBackendLoadReleased) releaseSettingsBackendLoadGate();
  if (settingsAccountsLoadReleased) releaseSettingsAccountsLoadGate();
  if (settingsApplyReleased) releaseSettingsApplyGate();

  await page.routeWebSocket(
    ({ pathname }) => pathname === "/api/ws/options/quotes",
    (socket) => {
      socket.onMessage(() => {
        socket.send(JSON.stringify({ type: "ready" }));
      });
    },
  );

  await page.addInitScript(
    ({ theme, reducedMotion, onboarding, trade }) => {
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
          screen: trade ? "trade" : "market",
          sym: trade ? "AAPL" : "SPY",
          theme,
          sidebarCollapsed: trade,
          activitySidebarCollapsed: true,
          ...(trade
            ? {
                tradeActiveTicker: "AAPL",
                tradeRecentTickers: ["AAPL"],
                tradeContracts: {
                  AAPL: {
                    strike: 230,
                    cp: "C",
                    exp: "07/24",
                    providerContractId: "doctrine-aapl-230-call",
                  },
                },
              }
            : {}),
          userPreferences: {
            appearance: { theme, reducedMotion },
            onboarding,
          },
        }),
      );
    },
    {
      theme: presentation.theme,
      reducedMotion: presentation.appReducedMotion,
      onboarding: settledOnboarding,
      trade: tradeFixture,
    },
  );

  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname);

    if (method === "HEAD" || method === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }

    if (
      method === "POST" &&
      (path === "/api/diagnostics/client-events" ||
        path === "/api/diagnostics/client-metrics" ||
        path === "/api/sparklines/seed")
    ) {
      allowedBackgroundRequests.push(`${method} ${path}`);
      if (path === "/api/sparklines/seed") {
        const body = request.postDataJSON() as {
          symbols?: unknown[];
          timeframe?: string;
        };
        await route.fulfill({
          json: {
            timeframe: body.timeframe || "5m",
            source: "fixture",
            historySource: "fixture",
            requestedSymbolCount: body.symbols?.length || 0,
            hydratedSymbolCount: 0,
            items: [],
          },
        });
      } else {
        await route.fulfill({ status: 202, json: {} });
      }
      return;
    }

    if (
      backtestFixture &&
      method === "POST" &&
      path === "/api/backtests/runs/run-ux19/promote"
    ) {
      backtestPromotionRequests.push(
        request.postDataJSON() as Record<string, unknown>,
      );
      await route.fulfill({
        json: {
          id: "draft-ux19",
          runId: "run-ux19",
          studyId: "study-ux19",
          name: "UX19 Completed Run Draft",
          enabled: false,
          mode: "shadow",
          symbolUniverse: ["SPY"],
          config: {},
          promotedAt: FIXTURE_TIME,
        },
      });
      return;
    }

    if (
      settingsFixture &&
      method === "POST" &&
      path === "/api/settings/backend/apply"
    ) {
      settingsApplyRequests.push(
        request.postDataJSON() as Record<string, unknown>,
      );
      if (settingsApplyRequests.length > 1) {
        await route.fulfill({
          json: {
            applied: [],
            rejected: [
              {
                key: "isolation.mode",
                reason: "Fixture rejected the requested isolation mode.",
              },
            ],
            pendingRestart: [],
            snapshot: buildSettingsBackendSnapshot("report-only"),
          },
        });
        return;
      }
      if (!settingsApplyReleased) await settingsApplyGate;
      await route.fulfill({
        json: {
          applied: [
            {
              key: "isolation.mode",
              status: "pending_restart",
              requiresRestart: true,
            },
          ],
          rejected: [],
          pendingRestart: [
            {
              key: "isolation.mode",
              status: "pending_restart",
              requiresRestart: true,
            },
          ],
          snapshot: buildSettingsBackendSnapshot("report-only"),
        },
      });
      return;
    }

    if (method !== "GET") {
      blockedMutations.push(`${method} ${path}`);
      await route.fulfill({
        status: 405,
        json: { error: "Mutation blocked by the doctrine fixture." },
      });
      return;
    }

    if (settingsFixture && path === "/api/settings/backend") {
      if (!settingsBackendLoadReleased) await settingsBackendLoadGate;
      await route.fulfill({ json: buildSettingsBackendSnapshot() });
      return;
    }
    if (
      settingsFixture &&
      path === "/api/broker-execution/snaptrade/readiness"
    ) {
      await route.fulfill({
        json: {
          provider: "snaptrade",
          configured: true,
          status: "research_required",
          checkedAt: FIXTURE_TIME,
          credentials: { clientIdPresent: true, apiKeyPresent: true },
          user: {
            registered: true,
            status: "registered",
            snapTradeUserIdPresent: true,
            userSecretStored: true,
            registeredAt: FIXTURE_TIME,
            disabledAt: null,
            nextAction: "generate_connection_portal",
          },
          clientInfo: {
            reachable: true,
            redirectUriConfigured: true,
            canAccessTrades: true,
            canAccessHoldings: true,
            canAccessAccountHistory: true,
            canAccessReferenceData: true,
            canAccessPortfolioManagement: true,
            canAccessOrders: true,
          },
          brokerages: {
            total: 1,
            enabled: 1,
            allowsTrading: 1,
            degradedOrMaintenance: 0,
          },
          limitations: [],
          upstream: { status: 200, code: "ok", message: "reachable" },
        },
      });
      return;
    }
    if (
      settingsFixture &&
      path === "/api/broker-execution/snaptrade/brokerages"
    ) {
      await route.fulfill({
        json: {
          provider: "snaptrade",
          checkedAt: FIXTURE_TIME,
          brokerages: [
            {
              slug: "ETRADE",
              displayName: "E*TRADE",
              description: "Trading-enabled fixture brokerage",
              url: null,
              allowsTrading: true,
              enabled: true,
              maintenanceMode: false,
              isDegraded: false,
              allowsFractionalUnits: true,
              logoUrl: null,
              squareLogoUrl: null,
              authorizationTypes: [
                { type: "trade", authType: "oauth" },
              ],
            },
          ],
        },
      });
      return;
    }
    if (settingsFixture && path === "/api/broker-connections") {
      await route.fulfill({
        json: {
          connections: [
            {
              id: "connection-ux20-etrade",
              provider: "snaptrade",
              name: "E*TRADE",
              brokerageSlug: "ETRADE",
              mode: "live",
              status: "connected",
              capabilities: ["read", "trade"],
              updatedAt: FIXTURE_TIME,
            },
          ],
        },
      });
      return;
    }
    if (
      settingsFixture &&
      path === "/api/broker-execution/included-accounts"
    ) {
      settingsAccountsRequestCount += 1;
      await settingsAccountsLoadGate;
      if (
        settingsAccountState === "error-then-success" &&
        settingsAccountsRequestCount === 1
      ) {
        await route.fulfill({
          status: 503,
          json: { detail: "Fixture trading accounts unavailable." },
        });
        return;
      }
      await route.fulfill({
        json: {
          accounts: settingsAccountState === "empty" ? [] : [
            {
              id: "account-ux20-primary",
              providerAccountId: "provider-account-primary",
              provider: "snaptrade",
              mode: "live",
              displayName: "Primary brokerage account",
              accountType: "equity",
              includedInTrading: true,
              connectionVerified: true,
              executionReady: true,
              executionBlockers: [],
              updatedAt: FIXTURE_TIME,
            },
            {
              id: "account-ux20-review",
              providerAccountId: "provider-account-review",
              provider: "snaptrade",
              mode: "live",
              displayName: "Review-only brokerage account",
              accountType: "equity",
              includedInTrading: false,
              connectionVerified: true,
              executionReady: false,
              executionBlockers: ["account_not_included"],
              updatedAt: FIXTURE_TIME,
            },
          ],
        },
      });
      return;
    }
    if (
      settingsFixture &&
      path === "/api/broker-execution/robinhood/readiness"
    ) {
      await route.fulfill({
        json: {
          provider: "robinhood",
          configured: true,
          status: "research_required",
          checkedAt: FIXTURE_TIME,
          prerequisites: {
            credentialEncryptionKeyPresent: true,
            redirectBaseUrlPresent: true,
          },
          user: {
            connected: true,
            status: "connected",
            oauthClientRegistered: true,
            refreshTokenStored: true,
            connectedAt: FIXTURE_TIME,
            disabledAt: null,
            nextAction: "sync_accounts",
          },
          oauth: {
            reachable: true,
            authorizationEndpointPresent: true,
            tokenEndpointPresent: true,
            registrationEndpointPresent: true,
            pkceS256Supported: true,
          },
          limitations: [],
          upstream: null,
        },
      });
      return;
    }
    if (
      settingsFixture &&
      path === "/api/broker-execution/schwab/readiness"
    ) {
      await route.fulfill({
        json: {
          provider: "schwab",
          configured: true,
          status: "reauth_required",
          checkedAt: FIXTURE_TIME,
          prerequisites: {
            credentialEncryptionKeyPresent: true,
            redirectBaseUrlPresent: true,
            appCredentialsPresent: true,
          },
          reauthRequired: {
            required: true,
            reason: "refresh_expires_soon",
          },
          user: {
            connected: true,
            status: "expired",
            refreshTokenStored: true,
            connectedAt: FIXTURE_TIME,
            refreshTokenExpiresAt: FIXTURE_TIME,
            disabledAt: null,
            nextAction: "reconnect",
            executionBlockers: ["broker_reauth"],
          },
          limitations: ["Reconnect weekly"],
          upstream: null,
        },
      });
      return;
    }
    if (
      settingsFixture &&
      path === "/api/broker-execution/ibkr-portal/readiness"
    ) {
      await route.fulfill({
        json: {
          status: "needs_login",
          gatewayRunning: true,
          authenticated: false,
          browserLoginComplete: false,
          apiSessionActivationFailed: false,
          established: false,
          isPaper: false,
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
          loginPath: "/ibkr-login",
          message: "Finish login in the secure Client Portal window.",
        },
      });
      return;
    }

    if (EVENT_STREAM_PATHS.has(path)) {
      await fulfillQuietEventStream(route);
      return;
    }
    if (path === "/api/signal-monitor/matrix/stream") {
      await fulfillSignalsMatrixStream(route, url);
      return;
    }
    if (path === "/api/auth/session") {
      await route.fulfill({
        json: {
          user: {
            id: "design-doctrine-review",
            email: "design-doctrine-review@example.com",
            displayName: "Design Doctrine Review",
            role: settingsFixture ? "admin" : "user",
            entitlements: [],
          },
          csrfToken: "design-doctrine-review-csrf",
        },
      });
      return;
    }
    if (path === "/api/auth/bootstrap") {
      await route.fulfill({ json: { status: "ready" } });
      return;
    }
    if (path === "/api/session") {
      await route.fulfill({
        json: {
          environment: "shadow",
          brokerProvider: "snaptrade",
          marketDataProvider: "massive",
          marketDataProviders: {
            live: "massive",
            historical: "massive",
            research: "fmp",
          },
          configured: { massive: true, ibkr: false, research: false },
          ibkrBridge: null,
          runtime: { ibkr: {} },
          timestamp: FIXTURE_TIME,
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
              theme: presentation.theme,
              scale: "m",
              density: "compact",
              reducedMotion: presentation.appReducedMotion,
              accentPreset: "pyrus",
              maskBalances: !accountFixture,
            },
            privacy: { hideAccountValues: !accountFixture },
            onboarding: settledOnboarding,
          },
          source: "database",
          updatedAt: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/watchlists") {
      await route.fulfill({
        json: {
          watchlists: [
            {
              id: "doctrine-core",
              name: "Core",
              isDefault: true,
              items: [{ id: "doctrine-spy", symbol: "SPY" }],
            },
          ],
        },
      });
      return;
    }
    if (backtestFixture && path === "/api/backtests/strategies") {
      await route.fulfill({
        json: {
          strategies: [
            {
              strategyId: "ux19-strategy",
              version: "1",
              label: "UX19 Strategy",
              description: "Fixture strategy",
              status: "runnable",
              directionMode: "long_only",
              supportedTimeframes: ["1d"],
              compatibilityNotes: [],
              unsupportedFeatures: [],
              parameterDefinitions: [],
              defaultParameters: {},
            },
          ],
        },
      });
      return;
    }
    if (backtestFixture && path === "/api/backtests/studies") {
      await route.fulfill({
        json: {
          studies: [
            {
              id: "study-ux19",
              name: "UX19 Study",
              strategyId: "ux19-strategy",
              strategyVersion: "1",
              directionMode: "long_only",
              watchlistId: null,
              symbols: ["SPY"],
              timeframe: "1d",
              startsAt: "2026-01-01T00:00:00.000Z",
              endsAt: FIXTURE_TIME,
              parameters: {},
              portfolioRules: {
                initialCapital: 100000,
                positionSizePercent: 10,
                maxConcurrentPositions: 5,
                maxGrossExposurePercent: 50,
              },
              executionProfile: { commissionBps: 1, slippageBps: 1 },
              optimizerMode: "single",
              optimizerConfig: {},
              createdAt: FIXTURE_TIME,
              updatedAt: FIXTURE_TIME,
            },
          ],
        },
      });
      return;
    }
    if (backtestFixture && path === "/api/backtests/runs") {
      await route.fulfill({
        json: {
          runs: [
            {
              id: "run-ux19",
              studyId: "study-ux19",
              sweepId: null,
              name: "UX19 Completed Run",
              strategyId: "ux19-strategy",
              strategyVersion: "1",
              directionMode: "long_only",
              status: "completed",
              sortRank: null,
              metrics: {
                netPnl: 1250,
                totalReturnPercent: 1.25,
                maxDrawdownPercent: 0.4,
                tradeCount: 0,
                winRatePercent: 0,
                profitFactor: 0,
                sharpeRatio: 1.1,
                returnOverMaxDrawdown: 3.125,
              },
              warnings: ["Fixture warning"],
              errorMessage: null,
              startedAt: "2026-07-19T21:00:00.000Z",
              finishedAt: FIXTURE_TIME,
              createdAt: FIXTURE_TIME,
              updatedAt: FIXTURE_TIME,
            },
          ],
        },
      });
      return;
    }
    if (backtestFixture && path === "/api/backtests/runs/run-ux19") {
      const run = {
        id: "run-ux19",
        studyId: "study-ux19",
        sweepId: null,
        name: "UX19 Completed Run",
        strategyId: "ux19-strategy",
        strategyVersion: "1",
        directionMode: "long_only",
        status: "completed",
        sortRank: null,
        metrics: {
          netPnl: 1250,
          totalReturnPercent: 1.25,
          maxDrawdownPercent: 0.4,
          tradeCount: 0,
          winRatePercent: 0,
          profitFactor: 0,
          sharpeRatio: 1.1,
          returnOverMaxDrawdown: 3.125,
        },
        warnings: ["Fixture warning"],
        errorMessage: null,
        startedAt: "2026-07-19T21:00:00.000Z",
        finishedAt: FIXTURE_TIME,
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
      };
      await route.fulfill({
        json: {
          run,
          study: {
            id: "study-ux19",
            name: "UX19 Study",
            strategyId: "ux19-strategy",
            strategyVersion: "1",
            directionMode: "long_only",
            watchlistId: null,
            symbols: ["SPY"],
            timeframe: "1d",
            startsAt: "2026-01-01T00:00:00.000Z",
            endsAt: FIXTURE_TIME,
            parameters: {},
            portfolioRules: {
              initialCapital: 100000,
              positionSizePercent: 10,
              maxConcurrentPositions: 5,
              maxGrossExposurePercent: 50,
            },
            executionProfile: { commissionBps: 1, slippageBps: 1 },
            optimizerMode: "single",
            optimizerConfig: {},
            createdAt: FIXTURE_TIME,
            updatedAt: FIXTURE_TIME,
          },
          trades: [],
          points: [],
          datasets: [],
        },
      });
      return;
    }
    if (
      backtestFixture &&
      path === "/api/backtests/runs/run-ux19/chart"
    ) {
      await route.fulfill({
        json: {
          runId: "run-ux19",
          studyId: "study-ux19",
          timeframe: "1d",
          chartPriceContext: "spot",
          availableSymbols: ["SPY"],
          selectedSymbol: "SPY",
          defaultTradeSelectionId: null,
          activeTradeSelectionId: null,
          chartBars: [],
          chartBarRanges: [],
          tradeOverlays: [],
          tradeMarkerGroups: {
            entryGroups: [],
            exitGroups: [],
            interactionGroups: [],
            timeToTradeIds: [],
          },
          indicatorEvents: [],
          indicatorZones: [],
          indicatorWindows: [],
          indicatorMarkerPayload: {
            overviewMarkers: [],
            markersByTradeId: {},
            timeToTradeIds: [],
          },
          selectionFocus: null,
          defaultVisibleLogicalRange: null,
        },
      });
      return;
    }
    if (
      backtestFixture &&
      path === "/api/backtests/studies/study-ux19/preview-chart"
    ) {
      await route.fulfill({
        json: {
          studyId: "study-ux19",
          latestCompletedRun: null,
          bestCompletedRun: null,
          comparisonBadges: [],
          latestSeries: [],
          bestSeries: [],
        },
      });
      return;
    }
    if (path === "/api/accounts") {
      await route.fulfill({
        json: { accounts: accountFixture ? [DOCTRINE_ACCOUNT] : [] },
      });
      return;
    }
    if (path === "/api/streams/accounts/page" && accountFixture) {
      await fulfillDoctrineAccountPageStream(route, url);
      return;
    }
    if (path === "/api/accounts/shadow/positions") {
      await route.fulfill({
        json: {
          accountId: "shadow",
          currency: "USD",
          positions: [],
          totals: {},
          updatedAt: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/accounts/shadow/orders") {
      await route.fulfill({
        json: {
          accountId: "shadow",
          currency: "USD",
          orders: [],
          updatedAt: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/algo/deployments") {
      await route.fulfill({ json: { deployments: [] } });
      return;
    }
    if (path === "/api/algo/events") {
      await route.fulfill({ json: { events: [] } });
      return;
    }
    if (path === "/api/broker-connections") {
      await route.fulfill({ json: { connections: [] } });
      return;
    }
    if (path === "/api/broker-execution/included-accounts") {
      await route.fulfill({ json: { accounts: [] } });
      return;
    }
    if (path === "/api/bars") {
      await route.fulfill({
        json: {
          symbol: url.searchParams.get("symbol") || "SPY",
          timeframe: url.searchParams.get("timeframe") || "5m",
          bars: [],
          transport: null,
          delayed: false,
          gapFilled: false,
          freshness: "unavailable",
          marketDataMode: null,
          dataUpdatedAt: null,
          ageMs: null,
          emptyReason: "fixture",
          historySource: null,
          studyFallback: false,
          historyPage: null,
        },
      });
      return;
    }
    if (path === "/api/diagnostics/latest") {
      await route.fulfill({
        json: {
          events: [],
          snapshots: [],
          metrics: {},
          timestamp: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/executions") {
      await route.fulfill({ json: { executions: [] } });
      return;
    }
    if (path === "/api/flow/events/aggregate") {
      aggregateFlowRequestCount += 1;
      if (aggregateFlowFailureHeld) {
        await route.fulfill({
          status: 503,
          json: { error: "Massive aggregate flow unavailable" },
        });
        return;
      }
      const scannedAt = Date.now();
      await route.fulfill({
        json: {
          events: flowEvents,
          source: {
            provider: "massive",
            status: flowEvents.length ? "loaded" : "empty",
            scannerCoverage: {
              totalSymbols: 1,
              selectedSymbols: 1,
              activeTargetSize: 1,
              targetSize: 1,
              scannedSymbols: 1,
              cycleScannedSymbols: 1,
              batchSize: 1,
              currentBatch: ["AAPL"],
              lastScannedAt: { AAPL: scannedAt },
              oldestScanAt: scannedAt,
              newestScanAt: scannedAt,
              coverageHealth: "full",
            },
          },
        },
      });
      return;
    }
    if (path === "/api/flow/events") {
      await route.fulfill({
        json: {
          events: flowEvents,
          source: {
            provider: "massive",
            status: flowEvents.length ? "loaded" : "empty",
          },
        },
      });
      return;
    }
    if (path === "/api/flow/universe") {
      await route.fulfill({ json: { symbols: [] } });
      return;
    }
    if (path === "/api/news") {
      await route.fulfill({ json: { articles: [] } });
      return;
    }
    if (path === "/api/options/chains") {
      const underlying = url.searchParams.get("underlying") || "SPY";
      await route.fulfill({
        json: {
          underlying,
          expirationDate: url.searchParams.get("expirationDate"),
          contracts:
            tradeFixture && underlying === "AAPL" ? DOCTRINE_TRADE_CHAIN : [],
        },
      });
      return;
    }
    if (path === "/api/options/expirations") {
      const underlying = url.searchParams.get("underlying") || "SPY";
      await route.fulfill({
        json: {
          underlying,
          expirations:
            tradeFixture && underlying === "AAPL"
              ? [{ expirationDate: "2026-07-24" }]
              : [],
        },
      });
      return;
    }
    if (path === "/api/orders") {
      await route.fulfill({ json: { orders: [] } });
      return;
    }
    if (path === "/api/positions") {
      await route.fulfill({ json: { positions: [] } });
      return;
    }
    if (path === "/api/quotes/snapshot") {
      await route.fulfill({
        json: {
          quotes: [],
          transport: null,
          delayed: false,
          fallbackUsed: false,
        },
      });
      return;
    }
    if (path === "/api/research/status") {
      await route.fulfill({
        json: {
          configured: false,
          provider: "fmp",
          available: false,
          updatedAt: FIXTURE_TIME,
        },
      });
      return;
    }
    if (path === "/api/signal-monitor/events") {
      await route.fulfill({
        json: {
          events: [
            {
              id: "design-doctrine-signal-event",
              profileId: SIGNALS_PROFILE.id,
              environment: "shadow",
              symbol: "AAPL",
              timeframe: "5m",
              direction: "buy",
              signalAt: "2026-07-19T21:45:00.000Z",
              signalPrice: 224.5,
              close: 225.1,
              emittedAt: "2026-07-19T21:45:05.000Z",
              source: "design-doctrine",
            },
          ],
          nextCursor: null,
          hasMore: false,
          sourceStatus: "database",
        },
      });
      return;
    }
    if (path === "/api/signal-monitor/profile") {
      await route.fulfill({ json: SIGNALS_PROFILE });
      return;
    }
    if (path === "/api/signal-monitor/state") {
      await route.fulfill({
        json: {
          profile: SIGNALS_PROFILE,
          states: [buildSignalsMatrixState("5m", 0)],
          evaluatedAt: FIXTURE_TIME,
          truncated: false,
          skippedSymbols: [],
          universeSymbols: ["AAPL"],
          universe: {
            mode: "selected_watchlist",
            configuredMaxSymbols: 1,
            resolvedSymbols: 1,
            pinnedSymbols: 1,
            expansionSymbols: 0,
            shortfall: 0,
            source: "selected_watchlist",
            fallbackUsed: false,
            degradedReason: null,
            rankedAt: null,
          },
          cacheStatus: "hit",
          refreshing: false,
          servedAt: FIXTURE_TIME,
          stateSource: "database",
        },
      });
      return;
    }
    if (path === "/api/signal-monitor/breadth-history") {
      await route.fulfill({
        json: {
          range: url.searchParams.get("range") || "day",
          from: "2026-07-19T20:00:00.000Z",
          to: FIXTURE_TIME,
          generatedAt: FIXTURE_TIME,
          bucketMinutes: 30,
          points: [
            {
              at: "2026-07-19T20:00:00.000Z",
              buy: 0,
              sell: 1,
              net: -1,
              total: 1,
            },
            {
              at: FIXTURE_TIME,
              buy: 1,
              sell: 0,
              net: 1,
              total: 1,
            },
          ],
          timeframes: [],
        },
      });
      return;
    }
    if (path === "/api/universe/logo-proxy") {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      });
      return;
    }
    if (path === "/api/universe/logos") {
      await route.fulfill({ json: { logos: {} } });
      return;
    }
    if (path === "/api/universe/tickers") {
      await route.fulfill({ json: { tickers: [] } });
      return;
    }
    if (isKnownGetPath(path)) {
      await route.fulfill({ json: {} });
      return;
    }

    unexpectedReads.push(`${method} ${path}`);
    await route.fulfill({
      status: 501,
      json: { error: `Unexpected fixture read: ${path}` },
    });
  });

  return {
    unexpectedReads,
    blockedMutations,
    backtestPromotionRequests,
    settingsApplyRequests,
    allowedBackgroundRequests,
    getAggregateFlowRequestCount: () => aggregateFlowRequestCount,
    getSettingsAccountsRequestCount: () => settingsAccountsRequestCount,
    releaseSettingsBackendLoad: () => {
      if (settingsBackendLoadReleased) return;
      settingsBackendLoadReleased = true;
      releaseSettingsBackendLoadGate();
    },
    releaseSettingsAccountsLoad: () => {
      if (settingsAccountsLoadReleased) return;
      settingsAccountsLoadReleased = true;
      releaseSettingsAccountsLoadGate();
    },
    releaseSettingsApply: () => {
      if (settingsApplyReleased) return;
      settingsApplyReleased = true;
      releaseSettingsApplyGate();
    },
    releaseAggregateFlowFailure: () => {
      aggregateFlowFailureHeld = false;
    },
  };
}

async function expectKeyboardEntry(page: Page) {
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) {
      return null;
    }
    const bounds = active.getBoundingClientRect();
    return {
      tagName: active.tagName,
      focusVisible: active.matches(":focus-visible"),
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
    };
  });
  expect(focus).not.toBeNull();
  expect(focus!.focusVisible).toBe(true);
  expect(focus!.width).toBeGreaterThan(0);
  expect(focus!.height).toBeGreaterThan(0);
  expect(focus!.right).toBeGreaterThan(0);
  expect(focus!.left).toBeLessThan(page.viewportSize()!.width);
  expect(focus!.bottom).toBeGreaterThan(0);
  expect(focus!.top).toBeLessThan(page.viewportSize()!.height);
}

async function expectDoctrineGeometry(page: Page, screenId: string) {
  const geometry = await page.evaluate((activeScreenId) => {
    const host = document.querySelector<HTMLElement>(
      `[data-testid="screen-host-${activeScreenId}"]`,
    );
    const header = document.querySelector<HTMLElement>(
      '[data-testid="platform-compact-header"]',
    );
    const lowerChrome = document.querySelector<HTMLElement>(
      '[data-testid="mobile-bottom-nav"], [data-testid="platform-bottom-status"]',
    );
    if (!host || !header || !lowerChrome) {
      throw new Error("Doctrine shell geometry is incomplete.");
    }
    const toBox = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    return {
      host: toBox(host),
      header: toBox(header),
      lowerChrome: toBox(lowerChrome),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentOverflow:
        document.documentElement.scrollWidth - window.innerWidth,
    };
  }, screenId);

  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.host.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.host.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.host.width).toBeGreaterThan(120);
  expect(geometry.host.height).toBeGreaterThan(120);
  expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.host.top + 1);
  expect(geometry.lowerChrome.top).toBeGreaterThanOrEqual(
    geometry.host.bottom - 1,
  );
}

async function expectAccountTableContainment(
  page: Page,
  testId: string,
) {
  const shell = page.getByTestId(testId);
  await shell.scrollIntoViewIfNeeded();
  const geometry = await shell.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: box.left,
      right: box.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(geometry.scrollWidth).toBeGreaterThanOrEqual(geometry.clientWidth);
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function expectSignalsHierarchy(page: Page, width: number) {
  const overview = page.getByTestId("signals-overview-panel");
  const metricIds = ["bias", "fresh", "gates", "tracked"];
  for (const metricId of metricIds) {
    await expect(
      overview.getByTestId(`signals-overview-${metricId}`),
    ).toBeVisible();
  }
  const metricOrder = await overview.evaluate(
    (element, ids) =>
      ids.map((id) =>
        Array.from(element.querySelectorAll("[data-testid]")).findIndex(
          (node) =>
            node.getAttribute("data-testid") === `signals-overview-${id}`,
        ),
      ),
    metricIds,
  );
  expect(metricOrder).toEqual([...metricOrder].sort((left, right) => left - right));

  const table = page.getByRole("table", { name: "Signals scan" });
  await expect(table).toBeVisible({ timeout: READY_TIMEOUT_MS });
  const row = table.getByTestId("signals-table-row").first();
  await expect(row).toHaveAttribute("data-symbol", "AAPL", {
    timeout: READY_TIMEOUT_MS,
  });
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(row).toHaveAttribute("aria-label", /AAPL;/u);

  await row.focus();
  await row.press("Enter");
  await expect(row).toHaveAttribute("aria-expanded", "true");

  const detail = page.getByTestId("signals-table-row-drilldown");
  await expect(detail).toBeVisible();
  await expect(detail.getByText("Price Context", { exact: true })).toBeVisible();
  await expect(detail.getByText("Decision Thesis", { exact: true })).toBeVisible();
  await expect(detail.getByText("Interval Matrix", { exact: true })).toBeVisible();
  await expect(detail.getByText("Gate Matrix", { exact: true })).toBeVisible();
  await expect(detail.getByText("No chart bars", { exact: true })).toBeVisible();
  const tradeHandoff = detail.getByRole("button", { name: "Trade", exact: true });
  await expect(tradeHandoff).toBeVisible();

  if (width < 1024) {
    const symbolDisclosure = row.getByRole("button", {
      name: "AAPL",
      exact: true,
    });
    const disclosureBox = await symbolDisclosure.boundingBox();
    const tradeBox = await tradeHandoff.boundingBox();
    expect(disclosureBox).not.toBeNull();
    expect(disclosureBox!.height).toBeGreaterThanOrEqual(43);
    expect(tradeBox).not.toBeNull();
    expect(tradeBox!.height).toBeGreaterThanOrEqual(43);
  }

  const containment = await page.getByTestId("signals-table-scroll-shell").evaluate(
    (element) => {
      const box = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: box.left,
        right: box.right,
        viewportWidth: window.innerWidth,
      };
    },
  );
  expect(containment.scrollWidth).toBeGreaterThanOrEqual(containment.clientWidth);
  expect(containment.left).toBeGreaterThanOrEqual(-1);
  expect(containment.right).toBeLessThanOrEqual(containment.viewportWidth + 1);
}

async function attachSyntheticScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  await testInfo.attach(name, {
    body: await page.screenshot({
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    }),
    contentType: "image/png",
  });
}

test("doctrine matrix route inventory matches the source registry", () => {
  const registrySource = readFileSync(
    join(process.cwd(), "src/features/platform/screenRegistry.jsx"),
    "utf8",
  );
  const registryBlock = registrySource.match(
    /export const SCREENS = \[([\s\S]*?)\n\];/u,
  )?.[1];
  expect(
    registryBlock,
    "SCREENS registry must remain statically inspectable",
  ).toBeTruthy();
  const sourceIds = Array.from(
    registryBlock!.matchAll(/\{\s*id:\s*"([^"]+)"/gu),
    (match) => match[1],
  );
  expect(REGISTERED_ROUTES.map((route) => route.id)).toEqual(sourceIds);
});

test.describe("read-only design doctrine route matrix", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    test.skip(
      !(await appServerAvailable()),
      `Pyrus is not reachable at ${APP_URL}; use Replit's normal runner before executing the matrix.`,
    );
  });

  for (const presentation of MATRIX_PRESENTATIONS) {
    for (const route of ROUTES) {
      test(`${route.id} · ${presentation.id}`, async ({ page }, testInfo) => {
        test.setTimeout(120_000);
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => {
          runtimeErrors.push(error.message);
        });

        await page.setViewportSize({
          width: presentation.width,
          height: presentation.height,
        });
        await page.emulateMedia({
          reducedMotion: presentation.osReducedMotion,
        });
        const fixture = await installDoctrineFixture(page, presentation);

        await page.goto(routeUrl(route.id), {
          waitUntil: "domcontentloaded",
        });
        const host = page.getByTestId(`screen-host-${route.id}`);
        await expect(host).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect(host).toHaveAttribute("aria-hidden", "false");
        await expect(page.locator(route.anchor)).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(page.getByTestId(`screen-loading-${route.id}`)).toBeHidden(
          {
            timeout: READY_TIMEOUT_MS,
          },
        );
        await expect(page.getByTestId("screen-suspense-fallback")).toBeHidden({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(
          page.getByTestId("pyrus-boot-progress-overlay"),
        ).toBeHidden({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(
          page.getByTestId(`screen-load-error-${route.id}`),
        ).toHaveCount(0);
        await expect(page.locator("html")).toHaveAttribute(
          "data-pyrus-theme",
          presentation.theme,
        );
        await expect(page.locator("html")).toHaveAttribute(
          "data-pyrus-reduced-motion",
          presentation.appReducedMotion,
        );

        await expectDoctrineGeometry(page, route.id);
        await expectKeyboardEntry(page);
        if (route.id === "signals") {
          await expectSignalsHierarchy(page, presentation.width);
        }
        await page.waitForTimeout(250);
        await attachSyntheticScreenshot(
          page,
          testInfo,
          `${route.id}-${presentation.id}`,
        );

        expect(runtimeErrors).toEqual([]);
        expect(fixture.unexpectedReads).toEqual([]);
        expect(fixture.blockedMutations).toEqual([]);
        expect(
          fixture.allowedBackgroundRequests.every((entry) =>
            [
              "POST /api/diagnostics/client-events",
              "POST /api/diagnostics/client-metrics",
              "POST /api/sparklines/seed",
            ].includes(entry),
          ),
        ).toBe(true);
      });
    }
  }
});

if (selectedRouteIds.size === 0 || selectedRouteIds.has("research")) {
  test.describe("Research hierarchy, tables, motion, and Trade handoff", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async () => {
      test.skip(
        !(await appServerAvailable()),
        `Pyrus is not reachable at ${APP_URL}; use Replit's normal runner before executing the Research fixture.`,
      );
    });

    for (const presentation of MATRIX_PRESENTATIONS) {
      test(`${presentation.id} preserves comparison context into Trade`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(120_000);
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => runtimeErrors.push(error.message));
        await page.setViewportSize({
          width: presentation.width,
          height: presentation.height,
        });
        await page.emulateMedia({ reducedMotion: presentation.osReducedMotion });
        const fixture = await installDoctrineFixture(page, presentation);

        await page.goto(routeUrl("research"), { waitUntil: "domcontentloaded" });
        const root = page.getByTestId("research-screen");
        await expect(root).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect(root.locator("h1")).toHaveCount(1);
        if (presentation.width === 768) {
          expect((await root.boundingBox())?.width).toBeGreaterThanOrEqual(640);
        }

        await page.getByTestId("research-view-comps").click();
        const scroller = page.getByTestId("research-company-table-scroll");
        const comparison = page.getByRole("table", {
          name: "Research company comparison",
        });
        await expect(scroller).toBeVisible();
        await expect(comparison).toBeVisible();
        const containment = await scroller.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(containment.clientWidth).toBeGreaterThan(0);
        expect(containment.scrollWidth).toBeGreaterThanOrEqual(
          containment.clientWidth,
        );

        const company = page.getByTestId("research-company-NVDA");
        await company.scrollIntoViewIfNeeded();
        await company.focus();
        await company.press("Enter");
        const openInTrade = page.getByRole("button", {
          name: "Open NVDA in Trade",
          exact: true,
        });
        await openInTrade.scrollIntoViewIfNeeded();
        await expect(openInTrade).toBeVisible();
        if (presentation.width < 1024) {
          expect((await openInTrade.boundingBox())?.height).toBeGreaterThanOrEqual(
            43,
          );
        }

        const activeMotion = await root.locator("*").evaluateAll((elements) =>
          elements.flatMap((element) => {
            const style = getComputedStyle(element);
            const hasAnimation = style.animationName
              .split(",")
              .some((name) => {
                const normalized = name.trim();
                return normalized.length > 0 && normalized !== "none";
              });
            const hasTransition = style.transitionDuration
              .split(",")
              .some((duration) => Number.parseFloat(duration) > 0);
            return hasAnimation || hasTransition
              ? [
                  {
                    tag: element.tagName,
                    animationName: style.animationName,
                    transitionDuration: style.transitionDuration,
                  },
                ]
              : [];
          }),
        );
        expect(activeMotion).toEqual([]);
        await attachSyntheticScreenshot(
          page,
          testInfo,
          `research-comparison-detail-${presentation.id}`,
        );

        await openInTrade.click();
        await expect(page.getByTestId("screen-host-trade")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect
          .poll(() =>
            page.evaluate(() => {
              const state = JSON.parse(
                window.localStorage.getItem("pyrus:state:v1") || "{}",
              );
              return {
                screen: state.screen || null,
                symbol: state.sym || null,
              };
            }),
          )
          .toEqual({ screen: "trade", symbol: "NVDA" });

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(runtimeErrors).toEqual([]);
        expect(fixture.unexpectedReads).toEqual([]);
        expect(fixture.blockedMutations).toEqual([]);
      });
    }
  });
}

if (selectedRouteIds.size === 0 || selectedRouteIds.has("backtest")) {
  test.describe("Backtest results and explicit Algo draft handoff", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async () => {
      test.skip(
        !(await appServerAvailable()),
        `Pyrus is not reachable at ${APP_URL}; use Replit's normal runner before executing the Backtest fixture.`,
      );
    });

    for (const presentation of MATRIX_PRESENTATIONS) {
      test(`${presentation.id} preserves result order and creates an Algo draft`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => runtimeErrors.push(error.message));
        await page.setViewportSize({
          width: presentation.width,
          height: presentation.height,
        });
        await page.emulateMedia({ reducedMotion: presentation.osReducedMotion });
        const fixture = await installDoctrineFixture(page, presentation, {
          backtestFixture: true,
        });

        await page.goto(routeUrl("backtest"), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("backtest-workspace")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        const createDraft = page.getByRole("button", {
          name: "Create Algo draft from UX19 Completed Run",
        });
        await expect(createDraft).toBeEnabled({ timeout: READY_TIMEOUT_MS });
        const regionIds = [
          "backtest-inputs",
          "backtest-results",
          "backtest-validation-warnings",
          "backtest-trades",
          "backtest-logs",
          "backtest-history",
        ];
        const regionOffsets = await page.evaluate((ids) => {
          const nodes = Array.from(document.querySelectorAll("[data-testid]"));
          return ids.map((id) =>
            nodes.findIndex((node) => node.getAttribute("data-testid") === id),
          );
        }, regionIds);
        expect(regionOffsets.every((offset) => offset >= 0)).toBe(true);
        expect(regionOffsets).toEqual(
          [...regionOffsets].sort((left, right) => left - right),
        );

        await createDraft.click();
        await expect(
          page
            .getByTestId("backtest-workspace")
            .getByText("Algo draft created", { exact: true }),
        ).toBeVisible();
        expect(fixture.backtestPromotionRequests).toEqual([
          { name: "UX19 Completed Run Draft", notes: null },
        ]);
        expect(runtimeErrors).toEqual([]);
        expect(fixture.unexpectedReads).toEqual([]);
        expect(fixture.blockedMutations).toEqual([]);
      });
    }

  });
}

if (selectedRouteIds.size === 0 || selectedRouteIds.has("settings")) {
  test.describe("Settings state and broker lifecycle hierarchy", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async () => {
      test.skip(
        !(await appServerAvailable()),
        `Pyrus is not reachable at ${APP_URL}; use Replit's normal runner before executing the Settings fixture.`,
      );
    });

    for (const presentation of MATRIX_PRESENTATIONS) {
      test(`${presentation.id} keeps setup, lifecycle, and apply states explicit`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(120_000);
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => runtimeErrors.push(error.message));
        await page.setViewportSize({
          width: presentation.width,
          height: presentation.height,
        });
        await page.emulateMedia({ reducedMotion: presentation.osReducedMotion });
        const fixture = await installDoctrineFixture(page, presentation, {
          settingsFixture: true,
        });

        await page.goto(routeUrl("settings"), { waitUntil: "domcontentloaded" });
        const screen = page.getByTestId("settings-screen");
        await expect(screen).toBeVisible({ timeout: READY_TIMEOUT_MS });
        const settingsBox = await screen.boundingBox();
        expect(settingsBox).not.toBeNull();
        const expectedSettingsLayout =
          settingsBox!.width < 768
            ? "phone"
            : settingsBox!.width < 1024
              ? "tablet"
              : "desktop";
        await expect(screen).toHaveAttribute(
          "data-layout",
          expectedSettingsLayout,
        );

        const preferencesTab = page.getByTestId("settings-tab-preferences");
        const dataBrokerTab = page.getByTestId("settings-tab-data-broker");
        const [preferencesBox, dataBrokerBox] = await Promise.all([
          preferencesTab.boundingBox(),
          dataBrokerTab.boundingBox(),
        ]);
        expect(preferencesBox).not.toBeNull();
        expect(dataBrokerBox).not.toBeNull();
        if (expectedSettingsLayout === "phone") {
          expect(preferencesBox!.height).toBeGreaterThanOrEqual(43);
          expect(dataBrokerBox!.height).toBeGreaterThanOrEqual(43);
          expect(Math.abs(dataBrokerBox!.y - preferencesBox!.y)).toBeLessThan(2);
          expect(dataBrokerBox!.x).toBeGreaterThan(preferencesBox!.x);
        } else {
          expect(dataBrokerBox!.y).toBeGreaterThan(preferencesBox!.y);
        }

        const settingsTabs = screen.locator('[data-testid^="settings-tab-"]');
        await expect(settingsTabs).toHaveCount(7);
        const settingsSearch = page.getByTestId("settings-search-input");
        await settingsSearch.fill("tax");
        await settingsSearch.press("Enter");
        const searchResults = screen.getByRole("region", {
          name: "Settings search results",
        });
        await expect(searchResults).toBeVisible();
        await expect(settingsTabs).toHaveCount(7);
        await expect(preferencesTab).toHaveAttribute("aria-pressed", "true");
        const taxResult = searchResults.getByRole("button", {
          name: "Open Tax settings",
        });
        await expect(taxResult).toBeVisible();
        await taxResult.click();
        await expect(page.getByTestId("settings-tab-tax")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(preferencesTab).toHaveAttribute("aria-pressed", "false");
        await settingsSearch.fill("");
        await settingsSearch.press("Enter");
        await expect(searchResults).toBeHidden();

        const changeStatus = page.getByTestId("settings-change-status");
        await expect(changeStatus).toContainText("No unsaved changes");
        await dataBrokerTab.click();
        await expect(changeStatus).toContainText("Loading settings…");
        fixture.releaseSettingsBackendLoad();

        const etradeCard = page.locator('[data-broker-card="ETRADE"]');
        await expect(etradeCard).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect(changeStatus).toContainText("No unsaved changes");
        await expect(
          etradeCard.getByRole("group", {
            name: "E*TRADE connection actions",
          }),
        ).toBeVisible();
        const etradeControls = await etradeCard
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.map(
              (button) =>
                button.getAttribute("aria-label") ||
                button.textContent?.trim() ||
                "",
            ),
          );
        expect(etradeControls).toEqual([
          "Select E*TRADE",
          "Open Portal",
          "Sync now",
        ]);
        await expect(
          etradeCard.locator('[data-broker-ring="connected"] rect'),
        ).toHaveCount(1);
        await expect(
          page.locator(
            '[data-broker-card="ROBINHOOD"] [data-broker-ring="connected"]',
          ),
        ).toBeVisible();
        await expect(
          page.locator(
            '[data-broker-card="SCHWAB"] [data-broker-ring="impaired"]',
          ),
        ).toBeVisible();
        await expect(
          page.locator(
            '[data-broker-card="IBKR_PORTAL"] [data-broker-ring="awaiting-user"]',
          ),
        ).toBeVisible();
        const runningBrokerAnimations = await page
          .locator("[data-broker-card]")
          .evaluateAll((cards) =>
            cards.flatMap((card) =>
              card
                .getAnimations({ subtree: true })
                .filter((animation) => animation.playState === "running")
                .map((animation) => animation.animationName || "anonymous"),
            ),
          );
        expect(runningBrokerAnimations).toEqual([]);
        if (presentation.width < 1024) {
          const brokerTargetHeights = await page
            .locator("[data-broker-card] button")
            .evaluateAll((buttons) =>
              buttons
                .map((button) => button.getBoundingClientRect())
                .filter((box) => box.width > 0 && box.height > 0)
                .map((box) => box.height),
            );
          expect(brokerTargetHeights.length).toBeGreaterThan(0);
          expect(Math.min(...brokerTargetHeights)).toBeGreaterThanOrEqual(43);
        }

        const tradingAccountsScroller = screen.getByRole("region", {
          name: "Scrollable broker trading accounts",
        });
        const tradingAccountsTable = screen.getByRole("table", {
          name: "Broker trading accounts",
        });
        await expect(tradingAccountsTable).toBeVisible();
        await expect(
          tradingAccountsTable.getByRole("columnheader"),
        ).toHaveText(["Account", "Provider", "Mode", "Type", "Included"]);
        await expect(tradingAccountsTable).toContainText(
          "Primary brokerage account",
        );
        await expect(tradingAccountsTable).toContainText(
          "Review-only brokerage account",
        );
        const accountTableContainment = await tradingAccountsScroller.evaluate(
          (element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
          }),
        );
        expect(accountTableContainment.clientWidth).toBeLessThanOrEqual(
          accountTableContainment.viewportWidth,
        );
        if (presentation.width < 640) {
          expect(accountTableContainment.scrollWidth).toBeGreaterThan(
            accountTableContainment.clientWidth,
          );
        }
        await tradingAccountsTable.scrollIntoViewIfNeeded();
        await attachSyntheticScreenshot(
          page,
          testInfo,
          `settings-data-broker-${presentation.id}`,
        );

        const selectEtrade = etradeCard.getByRole("button", {
          name: "Select E*TRADE",
        });
        await selectEtrade.focus();
        await page.keyboard.press("Tab");
        const openEtradePortal = etradeCard.getByRole("button", {
          name: "Open Portal",
        });
        await expect(openEtradePortal).toBeFocused();
        const focusTreatment = await openEtradePortal.evaluate((button) => {
          const style = getComputedStyle(button);
          return {
            focusVisible: button.matches(":focus-visible"),
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            boxShadow: style.boxShadow,
          };
        });
        expect(focusTreatment.focusVisible).toBe(true);
        expect(
          focusTreatment.outlineStyle !== "none" ||
            focusTreatment.outlineWidth !== "0px" ||
            focusTreatment.boxShadow !== "none",
        ).toBe(true);
        await expect(
          screen.getByRole("checkbox", {
            name: /Primary brokerage account/,
          }),
        ).toBeChecked();
        await expect(
          screen.getByRole("checkbox", {
            name: /Review-only brokerage account/,
          }),
        ).not.toBeChecked();

        await page.getByTestId("settings-tab-system").click();
        const isolationMode = page.getByRole("combobox", {
          name: "Cross-Origin Isolation Mode",
        });
        await expect(isolationMode).toHaveValue("off");
        await isolationMode.selectOption("report-only");
        await expect(changeStatus).toContainText("1 unsaved change");

        await page.getByRole("button", { name: "Apply 1" }).click();
        await expect(changeStatus).toContainText("Applying 1 change…");
        await expect
          .poll(() => fixture.settingsApplyRequests.length)
          .toBe(1);
        expect(fixture.settingsApplyRequests).toEqual([
          {
            changes: [
              { key: "isolation.mode", value: "report-only" },
            ],
          },
        ]);
        fixture.releaseSettingsApply();
        await expect(changeStatus).toContainText("Changes applied");
        await expect(changeStatus).toContainText("1 pending restart");

        await isolationMode.selectOption("enforce");
        await page.getByRole("button", { name: "Apply 1" }).click();
        await expect(changeStatus).toContainText("Settings need attention");
        await expect(
          screen.getByRole("alert"),
        ).toContainText("Fixture rejected the requested isolation mode.");
        await expect(isolationMode).toHaveValue("enforce");
        await expect(
          page.getByRole("button", { name: "Apply 1" }),
        ).toBeEnabled();
        await expect
          .poll(() => fixture.settingsApplyRequests.length)
          .toBe(2);
        expect(fixture.settingsApplyRequests[1]).toEqual({
          changes: [{ key: "isolation.mode", value: "enforce" }],
        });

        expect(runtimeErrors).toEqual([]);
        expect(fixture.unexpectedReads).toEqual([]);
        expect(fixture.blockedMutations).toEqual([]);
      });
    }

    test("desktop-light renders an explicit empty trading-account table", async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      const presentation = PRESENTATIONS.find(
        ({ id }) => id === "desktop-light",
      )!;
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await page.setViewportSize({
        width: presentation.width,
        height: presentation.height,
      });
      await page.emulateMedia({ reducedMotion: presentation.osReducedMotion });
      const fixture = await installDoctrineFixture(page, presentation, {
        settingsFixture: true,
        settingsAccountState: "empty",
      });

      await page.goto(routeUrl("settings"), { waitUntil: "domcontentloaded" });
      const screen = page.getByTestId("settings-screen");
      await expect(screen).toBeVisible({ timeout: READY_TIMEOUT_MS });
      await page.getByTestId("settings-tab-data-broker").click();
      fixture.releaseSettingsBackendLoad();

      const tradingAccountsTable = screen.getByRole("table", {
        name: "Broker trading accounts",
      });
      await expect(tradingAccountsTable).toBeVisible();
      await expect(tradingAccountsTable).toContainText(
        "No trading accounts available.",
      );
      await expect(tradingAccountsTable.getByRole("checkbox")).toHaveCount(0);
      await attachSyntheticScreenshot(
        page,
        testInfo,
        "settings-trading-accounts-empty-desktop-light",
      );

      expect(runtimeErrors).toEqual([]);
      expect(fixture.unexpectedReads).toEqual([]);
      expect(fixture.blockedMutations).toEqual([]);
    });

    test("phone-dark keeps the trading-account loading row explicit", async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      const presentation = PRESENTATIONS.find(({ id }) => id === "phone-dark")!;
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await page.setViewportSize({
        width: presentation.width,
        height: presentation.height,
      });
      await page.emulateMedia({ reducedMotion: presentation.osReducedMotion });
      const fixture = await installDoctrineFixture(page, presentation, {
        settingsFixture: true,
        settingsAccountState: "loading",
      });

      await page.goto(routeUrl("settings"), { waitUntil: "domcontentloaded" });
      const screen = page.getByTestId("settings-screen");
      await expect(screen).toBeVisible({ timeout: READY_TIMEOUT_MS });
      await page.getByTestId("settings-tab-data-broker").click();
      fixture.releaseSettingsBackendLoad();

      const tradingAccountsTable = screen.getByRole("table", {
        name: "Broker trading accounts",
      });
      const tradingAccountsScroller = screen.getByRole("region", {
        name: "Scrollable broker trading accounts",
      });
      await expect(tradingAccountsTable).toHaveAttribute("aria-busy", "true");
      await expect(
        tradingAccountsTable.getByRole("status"),
      ).toHaveText("Loading trading accounts…");
      await expect(tradingAccountsTable.getByRole("checkbox")).toHaveCount(0);
      await tradingAccountsTable.scrollIntoViewIfNeeded();
      await attachSyntheticScreenshot(
        page,
        testInfo,
        "settings-trading-accounts-loading-phone-dark",
      );

      fixture.releaseSettingsAccountsLoad();
      await expect(tradingAccountsTable).toContainText(
        "Primary brokerage account",
      );
      await tradingAccountsScroller.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await tradingAccountsTable.scrollIntoViewIfNeeded();
      expect(runtimeErrors).toEqual([]);
      expect(fixture.unexpectedReads).toEqual([]);
      expect(fixture.blockedMutations).toEqual([]);
    });

    test("phone-dark recovers the retryable trading-account error without mutation", async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      const presentation = PRESENTATIONS.find(({ id }) => id === "phone-dark")!;
      const runtimeErrors: string[] = [];
      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      await page.setViewportSize({
        width: presentation.width,
        height: presentation.height,
      });
      await page.emulateMedia({ reducedMotion: presentation.osReducedMotion });
      const fixture = await installDoctrineFixture(page, presentation, {
        settingsFixture: true,
        settingsAccountState: "error-then-success",
      });

      await page.goto(routeUrl("settings"), { waitUntil: "domcontentloaded" });
      const screen = page.getByTestId("settings-screen");
      await expect(screen).toBeVisible({ timeout: READY_TIMEOUT_MS });
      await page.getByTestId("settings-tab-data-broker").click();
      fixture.releaseSettingsBackendLoad();

      const tradingAccountsTable = screen.getByRole("table", {
        name: "Broker trading accounts",
      });
      const tradingAccountsScroller = screen.getByRole("region", {
        name: "Scrollable broker trading accounts",
      });
      const accountError = tradingAccountsTable.getByRole("alert");
      await expect(accountError).toContainText(
        "Fixture trading accounts unavailable.",
      );
      await expect(tradingAccountsTable).toHaveAttribute("aria-busy", "false");
      await tradingAccountsTable.scrollIntoViewIfNeeded();
      const retryButton = accountError.getByRole("button", { name: "Retry" });
      const [scrollerBox, retryBox] = await Promise.all([
        tradingAccountsScroller.boundingBox(),
        retryButton.boundingBox(),
      ]);
      expect(scrollerBox).not.toBeNull();
      expect(retryBox).not.toBeNull();
      expect(retryBox!.x).toBeGreaterThanOrEqual(scrollerBox!.x - 1);
      expect(retryBox!.x + retryBox!.width).toBeLessThanOrEqual(
        scrollerBox!.x + scrollerBox!.width + 1,
      );
      await attachSyntheticScreenshot(
        page,
        testInfo,
        "settings-trading-accounts-error-phone-dark",
      );

      await retryButton.click();
      await expect
        .poll(() => fixture.getSettingsAccountsRequestCount())
        .toBe(2);
      await expect(tradingAccountsTable).toContainText(
        "Primary brokerage account",
      );
      await expect(accountError).toBeHidden();
      await tradingAccountsScroller.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await tradingAccountsTable.scrollIntoViewIfNeeded();
      await attachSyntheticScreenshot(
        page,
        testInfo,
        "settings-trading-accounts-recovered-phone-dark",
      );

      expect(runtimeErrors).toEqual([]);
      expect(fixture.unexpectedReads).toEqual([]);
      expect(fixture.blockedMutations).toEqual([]);
    });
  });
}

if (selectedRouteIds.size === 0 || selectedRouteIds.has("flow")) {
  test.describe("Flow recovery and review-only Trade handoff", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async () => {
      test.skip(
        !(await appServerAvailable()),
        `Pyrus is not reachable at ${APP_URL}; use Replit's normal runner before executing the Flow fixture.`,
      );
    });

    for (const presentation of PRESENTATIONS.filter(({ id }) =>
      ["phone-dark", "tablet-light", "desktop-dark"].includes(id),
    )) {
      test(`${presentation.id} preserves the selected Flow contract`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
        const runtimeErrors: string[] = [];
        page.on("pageerror", (error) => {
          runtimeErrors.push(`pageerror: ${error.message}`);
        });
        page.on("console", (message) => {
          if (message.type() === "error") {
            const locationUrl = message.location().url;
            const expectedHeldAggregateFailure = Boolean(
              locationUrl &&
                new URL(locationUrl).pathname ===
                  "/api/flow/events/aggregate" &&
                message.text() ===
                  "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
            );
            if (!expectedHeldAggregateFailure) {
              runtimeErrors.push(`console: ${message.text()}`);
            }
          }
        });

        await page.setViewportSize({
          width: presentation.width,
          height: presentation.height,
        });
        await page.emulateMedia({
          reducedMotion: presentation.osReducedMotion,
        });
        const fixture = await installDoctrineFixture(page, presentation, {
          holdAggregateFlowFailure: true,
          flowEvents: [FLOW_HANDOFF_EVENT],
        });

        await page.goto(routeUrl("flow"), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("screen-host-flow")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        const unavailable = page.getByText("Flow source unavailable", {
          exact: true,
        });
        await expect(unavailable).toBeVisible({ timeout: READY_TIMEOUT_MS });

        const recoverButton = page.getByTestId("flow-recover-scanner");
        await expect(recoverButton).toBeVisible();
        if (presentation.width < 1024) {
          expect((await recoverButton.boundingBox())?.height).toBeGreaterThanOrEqual(
            43,
          );
        }
        const requestCountBeforeRecovery =
          fixture.getAggregateFlowRequestCount();
        fixture.releaseAggregateFlowFailure();
        await recoverButton.click();
        await expect
          .poll(() => fixture.getAggregateFlowRequestCount())
          .toBeGreaterThan(requestCountBeforeRecovery);
        await expect(unavailable).toBeHidden({ timeout: READY_TIMEOUT_MS });

        const row = page
          .locator(
            '[data-testid="flow-row-card"], [data-testid="flow-tape-row"]',
          )
          .first();
        await expect(row).toBeVisible({ timeout: READY_TIMEOUT_MS });
        if ((await row.getAttribute("data-testid")) === "flow-row-card") {
          expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(43);
        }
        await row.focus();
        await row.press("Enter");
        await expect(
          page.getByRole("button", { name: /Back to flow/u }),
        ).toBeVisible();

        const openInTrade = page
          .getByRole("button", { name: "Open in Trade", exact: true })
          .first();
        await expect(openInTrade).toBeVisible();
        if (presentation.width < 1024) {
          expect((await openInTrade.boundingBox())?.height).toBeGreaterThanOrEqual(
            43,
          );
        }
        await openInTrade.click();

        await expect(page.getByTestId("screen-host-trade")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(
          page.locator(".ra-panel-enter[data-trade-layout]"),
        ).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect
          .poll(() =>
            page.evaluate(() => {
              const state = JSON.parse(
                window.localStorage.getItem("pyrus:state:v1") || "{}",
              );
              const contract = state.tradeContracts?.AAPL || null;
              return {
                activeTicker: state.tradeActiveTicker || null,
                strike: contract?.strike ?? null,
                cp: contract?.cp ?? null,
                exp: contract?.exp ?? null,
              };
            }),
          )
          .toEqual({
            activeTicker: "AAPL",
            strike: 230,
            cp: "C",
            exp: "07/24",
          });

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(runtimeErrors).toEqual([]);
        expect(fixture.unexpectedReads).toEqual([]);
        expect(fixture.blockedMutations).toEqual([]);
      });
    }
  });
}

if (selectedRouteIds.size === 0 || selectedRouteIds.has("trade")) {
  test.describe("Trade chart and chain allocation", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async () => {
      test.skip(
        !(await appServerAvailable()),
        `Pyrus is not reachable at ${APP_URL}; use Replit's normal runner before executing the Trade fixture.`,
      );
    });

    for (const presentation of PRESENTATIONS.filter(({ id }) =>
      ["phone-dark", "tablet-light", "desktop-dark"].includes(id),
    )) {
      test(`${presentation.id} preserves chain identity without ticket occlusion`, async ({
        page,
      }) => {
        test.setTimeout(120_000);
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
          reducedMotion: presentation.osReducedMotion,
        });
        const fixture = await installDoctrineFixture(page, presentation, {
          tradeFixture: true,
        });

        await page.goto(routeUrl("trade"), { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("screen-host-trade")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        const tradeLayout = page.locator(
          ".ra-panel-enter[data-trade-layout]",
        );
        await expect(tradeLayout).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect(page.getByTestId("pyrus-boot-progress-overlay")).toBeHidden({
          timeout: READY_TIMEOUT_MS,
        });
        const usesPhonePanels =
          (await tradeLayout.getAttribute("data-trade-layout")) === "phone";

        const chain = page.getByRole("region", {
          name: "AAPL option chain",
        });
        if (usesPhonePanels) {
          const chartTab = page.getByRole("button", {
            name: "Chart",
            exact: true,
          });
          const chainTab = page.getByRole("button", {
            name: "Chain",
            exact: true,
          });
          await expect(chartTab).toHaveAttribute("aria-pressed", "true");
          await expect(page.getByTestId("trade-phone-chart-canvas")).toBeVisible();

          const spotChart = page.getByRole("tab", {
            name: "Spot",
            exact: true,
          });
          const contractChart = page.getByRole("tab", {
            name: "Contract",
            exact: true,
          });
          await expect(spotChart).toHaveAttribute("aria-selected", "true");
          await contractChart.click();
          await expect(contractChart).toHaveAttribute("aria-selected", "true");
          await expect(page.getByTestId("trade-phone-chart-canvas")).toHaveAttribute(
            "data-active-chart",
            "contract",
          );
          await chainTab.click();
        }

        await expect(chain).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect(chain.getByText("Strike", { exact: true })).toBeVisible();
        const putRow = chain.getByRole("button", {
          name: /^Put 230 strike;/u,
        });
        await expect(putRow).toBeVisible();
        await putRow.focus();
        await putRow.press("Enter");
        await expect(putRow).toHaveAttribute("aria-pressed", "true");
        if (presentation.width < 1024) {
          expect((await putRow.boundingBox())?.height).toBeGreaterThanOrEqual(43);
        }

        if (usesPhonePanels) {
          await page
            .getByRole("button", { name: "Chart", exact: true })
            .click();
          await page
            .getByRole("tab", { name: "Spot", exact: true })
            .click();
          await page
            .getByRole("tab", { name: "Contract", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Chain", exact: true })
            .click();
          await expect(
            chain.getByRole("button", { name: /^Put 230 strike;/u }),
          ).toHaveAttribute("aria-pressed", "true");
        } else {
          await expect(page.getByTestId("trade-top-zone")).toBeVisible();
          await expect(page.getByTestId("trade-middle-zone")).toBeVisible();
        }

        await expect
          .poll(() =>
            page.evaluate(() => {
              const state = JSON.parse(
                window.localStorage.getItem("pyrus:state:v1") || "{}",
              );
              const contract = state.tradeContracts?.AAPL || null;
              return {
                strike: contract?.strike ?? null,
                cp: contract?.cp ?? null,
                exp: contract?.exp ?? null,
                providerContractId: contract?.providerContractId ?? null,
              };
            }),
          )
          .toEqual({
            strike: 230,
            cp: "P",
            exp: "07/24",
            providerContractId: "doctrine-aapl-230-put",
          });

        const geometry = await page.evaluate(() => {
          const chainPanel = document.querySelector<HTMLElement>(
            '[data-testid="trade-options-chain-panel"]',
          );
          const ticket = document.querySelector<HTMLElement>(
            '[data-testid="trade-order-ticket-zone"]',
          );
          const selectedRow = document.querySelector<HTMLElement>(
            '[data-testid="trade-chain-contract-row"][aria-pressed="true"]',
          );
          if (!chainPanel || !ticket || !selectedRow) {
            throw new Error("Trade acceptance geometry is incomplete.");
          }
          const chainBox = chainPanel.getBoundingClientRect();
          const ticketBox = ticket.getBoundingClientRect();
          const rowBox = selectedRow.getBoundingClientRect();
          const overlapWidth = Math.max(
            0,
            Math.min(chainBox.right, ticketBox.right) -
              Math.max(chainBox.left, ticketBox.left),
          );
          const overlapHeight = Math.max(
            0,
            Math.min(chainBox.bottom, ticketBox.bottom) -
              Math.max(chainBox.top, ticketBox.top),
          );
          const visibleRowLeft = Math.max(chainBox.left, rowBox.left, 0);
          const visibleRowRight = Math.min(
            chainBox.right,
            rowBox.right,
            window.innerWidth,
          );
          return {
            overlapArea: overlapWidth * overlapHeight,
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            chainLeft: chainBox.left,
            chainRight: chainBox.right,
            visibleRowWidth: Math.max(0, visibleRowRight - visibleRowLeft),
            viewportWidth: window.innerWidth,
          };
        });
        expect(geometry.overlapArea).toBeLessThanOrEqual(1);
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        expect(geometry.chainLeft).toBeGreaterThanOrEqual(-1);
        expect(geometry.chainRight).toBeLessThanOrEqual(
          geometry.viewportWidth + 1,
        );
        expect(geometry.visibleRowWidth).toBeGreaterThan(0);
        expect(runtimeErrors).toEqual([]);
        expect(fixture.unexpectedReads).toEqual([]);
        expect(fixture.blockedMutations).toEqual([]);
      });
    }
  });
}

if (selectedRouteIds.size === 0 || selectedRouteIds.has("account")) {
  test.describe("Account data hierarchy and review-only Trade handoff", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async () => {
      test.skip(
        !(await appServerAvailable()),
        `Pyrus is not reachable at ${APP_URL}; use Replit's normal runner before executing the Account fixture.`,
      );
    });

    for (const presentation of PRESENTATIONS.filter(({ id }) =>
      ["phone-dark", "tablet-light", "desktop-dark"].includes(id),
    )) {
      test(`${presentation.id} keeps Account tables usable and contained`, async ({
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
          reducedMotion: presentation.osReducedMotion,
        });
        const fixture = await installDoctrineFixture(page, presentation, {
          accountFixture: true,
        });

        await page.goto(routeUrl("account"), {
          waitUntil: "domcontentloaded",
        });
        await expect(page.getByTestId("screen-host-account")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(page.getByTestId("account-screen")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(
          page.getByTestId("portfolio-exposure-dashboard"),
        ).toBeVisible({ timeout: READY_TIMEOUT_MS });

        const positionsScroll = page.getByTestId(
          "account-positions-table-scroll",
        );
        await positionsScroll.scrollIntoViewIfNeeded();
        const positionsTable = page.getByRole("table", {
          name: "Open positions",
        });
        await expect(positionsTable).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(positionsTable.locator("thead th").nth(0)).toContainText(
          "Symbol",
        );
        await expect(positionsTable.locator("thead th").nth(1)).toContainText(
          "Spot",
        );
        await expect(positionsTable.locator("thead th").nth(2)).toContainText(
          "Qty",
        );
        await expect(positionsTable).toContainText("AAPL");
        await expectAccountTableContainment(
          page,
          "account-positions-table-scroll",
        );

        const minimumTargetHeight = presentation.width < 1024 ? 43 : 23;
        const positionExpand = page.getByRole("button", {
          name: /^(?:Expand|Collapse) AAPL$/u,
        });
        const openPositionChart = page.getByRole("button", {
          name: "Open AAPL chart",
          exact: true,
        }).first();
        await expect(positionExpand).toHaveAccessibleName("Expand AAPL");
        for (const control of [positionExpand, openPositionChart]) {
          await control.scrollIntoViewIfNeeded();
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.height).toBeGreaterThanOrEqual(minimumTargetHeight);
        }
        await positionExpand.focus();
        await positionExpand.press("Enter");
        await expect(positionExpand).toHaveAttribute("aria-expanded", "true");
        await expect(
          page.getByRole("table", { name: "AAPL tax lots" }),
        ).toBeVisible();

        const analysisDeferred = page.getByTestId(
          "account-deferred-trading-analysis",
        );
        await analysisDeferred.scrollIntoViewIfNeeded();
        await expect(
          page.getByTestId("account-trading-analysis-workbench"),
        ).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect(
          page.getByRole("table", {
            name: "Trading performance by symbol",
          }),
        ).toBeVisible({ timeout: READY_TIMEOUT_MS });

        const tradesTab = page
          .getByRole("tablist", { name: "Trading analysis view" })
          .getByRole("tab", { name: "Trades", exact: true });
        await tradesTab.click();
        const closedTrades = page.getByRole("region", {
          name: "Closed trades",
        });
        await expect(closedTrades).toBeVisible();
        const tradeRow = closedTrades
          .getByTestId("account-analysis-trade-row")
          .first()
          .getByRole("button");
        await tradeRow.focus();
        await tradeRow.press("Enter");
        await expect(
          closedTrades.getByTestId("account-analysis-trade-expanded"),
        ).toBeVisible();

        const ordersDeferred = page.getByTestId("account-deferred-orders");
        await ordersDeferred.scrollIntoViewIfNeeded();
        const ordersTable = page.getByRole("table", {
          name: "Working orders",
        });
        await expect(ordersTable).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        for (const [index, label] of [
          [0, "Symbol"],
          [1, "Side"],
          [2, "Type"],
          [3, "Qty"],
        ] as const) {
          await expect(
            ordersTable.locator("thead th").nth(index),
          ).toContainText(label);
        }
        await expectAccountTableContainment(
          page,
          "account-orders-table-scroll",
        );
        const cancelOrder = ordersTable.getByRole("button", {
          name: "Cancel",
          exact: true,
        });
        await cancelOrder.scrollIntoViewIfNeeded();
        expect((await cancelOrder.boundingBox())?.height).toBeGreaterThanOrEqual(
          minimumTargetHeight,
        );

        const supportDeferred = page.getByTestId("account-deferred-support");
        await supportDeferred.scrollIntoViewIfNeeded();
        const cashTable = page.getByRole("table", {
          name: "Cash activity",
        });
        await expect(cashTable).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(cashTable).toContainText("Account funding");
        await expectAccountTableContainment(
          page,
          "account-cash-activity-table-scroll",
        );

        await positionsScroll.scrollIntoViewIfNeeded();
        const positionAction = page
          .getByTestId("account-position-row-action-menu")
          .getByRole("button", {
            name: "Open AAPL in the trade ticket",
            exact: true,
          });
        await positionAction.scrollIntoViewIfNeeded();
        await positionAction.click();
        await expect(page.getByTestId("screen-host-trade")).toBeVisible({
          timeout: READY_TIMEOUT_MS,
        });
        await expect(
          page.locator(".ra-panel-enter[data-trade-layout]"),
        ).toBeVisible({ timeout: READY_TIMEOUT_MS });
        await expect
          .poll(() =>
            page.evaluate(() => {
              const state = JSON.parse(
                window.localStorage.getItem("pyrus:state:v1") || "{}",
              );
              return {
                screen: state.screen || null,
                symbol: state.sym || null,
              };
            }),
          )
          .toEqual({ screen: "trade", symbol: "AAPL" });

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        expect(runtimeErrors).toEqual([]);
        expect(fixture.unexpectedReads).toEqual([]);
        expect(fixture.blockedMutations).toEqual([]);
      });
    }
  });
}

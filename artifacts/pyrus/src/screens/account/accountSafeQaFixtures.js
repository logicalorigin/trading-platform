const SAFE_QA_UPDATED_AT = "2026-05-30T20:58:08.000Z";
const SAFE_QA_NAV = 50_000;
const SAFE_QA_PREMIUM_EXPOSURE = 10_217.5;

const optionPosition = ({
  id,
  symbol,
  underlying,
  right,
  strike,
  expirationDate,
  mark,
  marketValue,
  unrealizedPnl,
  weightPercent,
  underlyingPrice,
}) => {
  const providerContractId = `safe-qa-${id}`;
  const optionBid = Number((mark - 0.1).toFixed(2));
  const optionAsk = Number((mark + 0.1).toFixed(2));
  const underlyingBid = Number((underlyingPrice - 0.05).toFixed(2));
  const underlyingAsk = Number((underlyingPrice + 0.05).toFixed(2));
  const optionQuote = {
    providerContractId,
    bid: optionBid,
    ask: optionAsk,
    mid: mark,
    last: mark,
    price: mark,
    mark,
    spread: Number((optionAsk - optionBid).toFixed(2)),
    spreadPercent: Number((((optionAsk - optionBid) / mark) * 100).toFixed(2)),
    bidSize: 12,
    askSize: 16,
    impliedVolatility: 0.42,
    delta: right === "put" ? -0.42 : 0.52,
    gamma: 0.03,
    theta: -0.08,
    vega: 0.11,
    openInterest: 1_240,
    volume: 180,
    updatedAt: SAFE_QA_UPDATED_AT,
    dataUpdatedAt: SAFE_QA_UPDATED_AT,
    quoteUpdatedAt: SAFE_QA_UPDATED_AT,
    freshness: "safe_qa",
    marketDataMode: "fixture",
    source: "safe_qa_fixture",
  };
  return {
    id,
    accountId: "shadow",
    accounts: ["shadow"],
    symbol,
    description: symbol,
    assetClass: "option",
    optionContract: {
      ticker: symbol,
      underlying,
      expirationDate,
      strike,
      right,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId,
    },
    marketDataSymbol: underlying,
    underlyingMarket: {
      symbol: underlying,
      price: underlyingPrice,
      bid: underlyingBid,
      ask: underlyingAsk,
      previousClose: Number((underlyingPrice - 1.25).toFixed(2)),
      prevClose: Number((underlyingPrice - 1.25).toFixed(2)),
      change: 1.25,
      changePercent: Number(
        ((1.25 / (underlyingPrice - 1.25)) * 100).toFixed(2),
      ),
      dayChange: 1.25,
      dayChangePercent: Number(
        ((1.25 / (underlyingPrice - 1.25)) * 100).toFixed(2),
      ),
      updatedAt: SAFE_QA_UPDATED_AT,
      dataUpdatedAt: SAFE_QA_UPDATED_AT,
      quoteUpdatedAt: SAFE_QA_UPDATED_AT,
      freshness: "safe_qa",
      marketDataMode: "fixture",
      source: "safe_qa_fixture",
    },
    sector: "Options",
    quantity: 1,
    averageCost: mark,
    mark,
    dayChange: null,
    dayChangePercent: null,
    unrealizedPnl,
    unrealizedPnlPercent: marketValue
      ? (unrealizedPnl / Math.abs(marketValue)) * 100
      : 0,
    marketValue,
    weightPercent,
    betaWeightedDelta: null,
    lots: [],
    openOrders: [],
    source: "safe_qa_fixture",
    sourceType: "signal_options_replay",
    strategyLabel: "Options risk review",
    attributionStatus: "attributed",
    sourceAttribution: [],
    automationContext: null,
    openedAt: "2026-05-29T14:30:00.000Z",
    openedAtSource: "safe_qa_fixture",
    quote: optionQuote,
    optionQuote,
  };
};

const buildPositions = () => [
  optionPosition({
    id: "safe-qa-spy-515c",
    symbol: "SPY 515C",
    underlying: "SPY",
    right: "call",
    strike: 515,
    expirationDate: "2026-06-19",
    mark: 54,
    marketValue: 5_400,
    unrealizedPnl: -620,
    weightPercent: 10.8,
    underlyingPrice: 522.4,
  }),
  optionPosition({
    id: "safe-qa-qqq-460p",
    symbol: "QQQ 460P",
    underlying: "QQQ",
    right: "put",
    strike: 460,
    expirationDate: "2026-06-19",
    mark: 28,
    marketValue: 2_800,
    unrealizedPnl: 220,
    weightPercent: 5.6,
    underlyingPrice: 452.8,
  }),
  optionPosition({
    id: "safe-qa-msft-440c",
    symbol: "MSFT 440C",
    underlying: "MSFT",
    right: "call",
    strike: 440,
    expirationDate: "2026-07-17",
    mark: 20.175,
    marketValue: 2_017.5,
    unrealizedPnl: -140,
    weightPercent: 4.035,
    underlyingPrice: 431.2,
  }),
];

export const buildSafeQaPortfolioExposureFixture = ({
  accountId = "shadow",
  currency = "USD",
} = {}) => {
  const positions = buildPositions().map((position) => ({
    ...position,
    accountId,
    accounts: [accountId],
  }));
  const cash = SAFE_QA_NAV - SAFE_QA_PREMIUM_EXPOSURE;

  return {
    summary: {
      accountId,
      currency,
      metrics: {
        netLiquidation: { value: SAFE_QA_NAV, currency, source: "safe_qa_fixture" },
        dayPnl: { value: -540.25, currency, source: "safe_qa_fixture" },
        cash: { value: cash, currency, source: "safe_qa_fixture" },
      },
      updatedAt: SAFE_QA_UPDATED_AT,
    },
    allocation: {
      accountId,
      currency,
      assetClass: [
        {
          label: "Options",
          value: SAFE_QA_PREMIUM_EXPOSURE,
          weightPercent: (SAFE_QA_PREMIUM_EXPOSURE / SAFE_QA_NAV) * 100,
          source: "safe_qa_fixture",
        },
        {
          label: "Cash",
          value: cash,
          weightPercent: (cash / SAFE_QA_NAV) * 100,
          source: "safe_qa_fixture",
        },
      ],
      sector: [
        {
          label: "Options",
          value: SAFE_QA_PREMIUM_EXPOSURE,
          weightPercent: (SAFE_QA_PREMIUM_EXPOSURE / SAFE_QA_NAV) * 100,
          source: "safe_qa_fixture",
        },
        {
          label: "Cash",
          value: cash,
          weightPercent: (cash / SAFE_QA_NAV) * 100,
          source: "safe_qa_fixture",
        },
      ],
      exposure: {
        grossLong: SAFE_QA_PREMIUM_EXPOSURE,
        grossShort: 0,
        netExposure: SAFE_QA_PREMIUM_EXPOSURE,
      },
      updatedAt: SAFE_QA_UPDATED_AT,
    },
    positions: {
      accountId,
      currency,
      positions,
      totals: {
        netLiquidation: SAFE_QA_NAV,
        cash,
        buyingPower: cash,
        netExposure: SAFE_QA_PREMIUM_EXPOSURE,
      },
      updatedAt: SAFE_QA_UPDATED_AT,
    },
    risk: {
      accountId,
      currency,
      concentration: {
        topPositions: [],
        sectors: [],
      },
      winnersLosers: {
        todayWinners: [],
        todayLosers: [],
      },
      margin: {
        marginUsed: 0,
        marginAvailable: cash,
        maintenanceMargin: 0,
        maintenanceCushionPercent: (cash / SAFE_QA_NAV) * 100,
        leverageRatio: SAFE_QA_PREMIUM_EXPOSURE / SAFE_QA_NAV,
        providerFields: {
          marginUsed: "Shadow cash account",
          marginAvailable: "Cash",
          maintenanceMargin: "None",
          maintenanceCushionPercent: "Cash account",
        },
      },
      greeks: {
        delta: 124.5,
        betaWeightedDelta: 138.2,
        gamma: 7.4,
        theta: -182.35,
        vega: 418.6,
        coverage: {
          optionPositions: 3,
          matchedOptionPositions: 3,
        },
        perUnderlying: [
          { underlying: "SPY", delta: 82.1, gamma: 4.2, theta: -95.3, vega: 210.5 },
          { underlying: "QQQ", delta: -31.4, gamma: 1.8, theta: -48.2, vega: 122.4 },
          { underlying: "MSFT", delta: 73.8, gamma: 1.4, theta: -38.85, vega: 85.7 },
        ],
      },
      greekScenarios: {
        enabled: true,
        status: "completed",
        source: "python_compute",
        warning: null,
        coverage: {
          totalOptionPositions: 3,
          eligiblePositions: 3,
          skippedPositions: 0,
          skipped: {
            missingSpot: 0,
            missingMarkPrice: 0,
            missingContractData: 0,
            missingGreekSnapshot: 0,
          },
        },
        result: {
          scenarioCount: 140,
          pricingModel: "black_scholes",
          repricedPositionScenarioCount: 420,
          fallbackPositionScenarioCount: 0,
          boundedPositionScenarioCount: 0,
          scenarios: [
            {
              spotShock: -0.08,
              ivShockVolPoints: 10,
              dayOffset: 7,
              estimatedPnl: -10217.5,
              components: { repricing: -10217.5 },
              repricedPositionCount: 3,
              fallbackPositionCount: 0,
            },
            {
              spotShock: -0.05,
              ivShockVolPoints: 5,
              dayOffset: 3,
              estimatedPnl: -6425.75,
              components: { repricing: -6425.75 },
              repricedPositionCount: 3,
              fallbackPositionCount: 0,
            },
            {
              spotShock: 0.04,
              ivShockVolPoints: -5,
              dayOffset: 0,
              estimatedPnl: 5210.25,
              components: { repricing: 5210.25 },
              repricedPositionCount: 3,
              fallbackPositionCount: 0,
            },
          ],
          managementFlags: [
            {
              symbol: "SPY 515C",
              reasons: ["theta_burden", "vega_sensitive"],
              severityScore: 18.4,
              thetaBurdenPct: 3.9,
              fiveVolPointVegaPnlPct: 19.5,
            },
            {
              symbol: "QQQ 460P",
              reasons: ["near_expiry"],
              severityScore: 12.1,
              thetaBurdenPct: 2.1,
            },
          ],
        },
        pythonJob: {
          jobId: "safe-qa-greek-scenarios",
          jobType: "greek_scenario_matrix",
          durationMs: 2.4,
          warnings: [],
          error: null,
        },
      },
      riskRecommendations: {
        advisoryOnly: true,
        source: "options_account_risk",
        scope: "options",
        status: "ready",
        summary: {
          optionPositionCount: 3,
          underlyingCount: 3,
          totalPremiumExposure: SAFE_QA_PREMIUM_EXPOSURE,
          premiumToNavPercent: (SAFE_QA_PREMIUM_EXPOSURE / SAFE_QA_NAV) * 100,
          worstShockPnl: -10217.5,
          worstShockToNavPercent: (-10217.5 / SAFE_QA_NAV) * 100,
        },
        recommendations: [
          {
            id: "scenario:worst-option-shock",
            category: "scenario",
            severity: "attention",
            title: "Review worst option shock",
            rationale: "Black-Scholes stress reaches the premium envelope.",
            suggestedReview: "Review hedging, expiries, and volatility assumptions.",
          },
          {
            id: "theta:portfolio",
            category: "theta",
            severity: "watch",
            title: "Monitor near-dated theta",
            rationale: "The option set carries concentrated time decay into the next expiry window.",
            suggestedReview: "Monitor theta burden against planned hold time.",
          },
          {
            id: "concentration:premium",
            category: "concentration",
            severity: "watch",
            title: "Review premium concentration",
            rationale: "Option premium is concentrated in three underlyings.",
            suggestedReview: "Review premium exposure by underlying and expiry.",
          },
        ],
      },
      notional: {
        grossUnderlyingNotional: 84_600,
        netDirectionalNotional: 38_250,
        deltaAdjustedNotional: 21_575,
        notionalToNavPercent: 169.2,
        coverage: {
          totalPositions: 3,
          pricedPositions: 3,
          deltaAdjustedPositions: 3,
        },
      },
      expiryConcentration: {
        thisWeek: 0,
        thisMonth: 8_200,
        next90Days: SAFE_QA_PREMIUM_EXPOSURE,
      },
      updatedAt: SAFE_QA_UPDATED_AT,
    },
  };
};

export const getSafeQaInitialQueryOptions = (initialData) => {
  if (!initialData) {
    return {};
  }
  return {
    initialData,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  };
};

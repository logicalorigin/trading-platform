import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  PROFILE_BOOLEAN_FIELDS,
  PROFILE_NUMBER_FIELDS,
  SIGNAL_OPTIONS_DEFAULT_PROFILE,
  candidateBlockerLabel,
  candidateLatestActivityLabel,
  entryQualityLabel,
  formatCompactMetric,
  formatContractDetail,
  formatContractProviderLabel,
  formatContractSelectionSummary,
  formatDteLabel,
  findSignalOptionsCandidateForSignal,
  formatQuoteGreeksSummary,
  formatQuoteSummary,
  mergeOptionQuoteSnapshot,
  mergeSignalOptionsProfile,
  optionProviderContractId,
  resolveStrategySignalSettings,
} from "./algoHelpers";
import {
  buildAlgoAccountPositionRows,
  buildAlgoAccountPositionsResponse,
} from "./algoAccountPositions";

test("algo profile defaults match the tuned h8 signal-options profile", () => {
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe, "5m");
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.timeHorizon, 8);
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.bosConfirmation, "wicks");
  assert.equal(DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochAtrBuffer, 0);
  assert.equal(SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps.maxOpenSymbols, 10);
  assert.equal(
    SIGNAL_OPTIONS_DEFAULT_PROFILE.riskCaps.maxPremiumPerEntry,
    1500,
  );
  assert.deepEqual(
    {
      hardStopPct: SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.hardStopPct,
      trailActivationPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.trailActivationPct,
      minLockedGainPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.minLockedGainPct,
      trailGivebackPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.trailGivebackPct,
      overnightExitEnabled:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.overnightExitEnabled,
      overnightMinGainPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.overnightMinGainPct,
      overnightRunnerGivebackPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.overnightRunnerGivebackPct,
      earlyExitBars: SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.earlyExitBars,
      earlyExitLossPct:
        SIGNAL_OPTIONS_DEFAULT_PROFILE.exitPolicy.earlyExitLossPct,
    },
    {
      hardStopPct: -30,
      trailActivationPct: 35,
      minLockedGainPct: 15,
      trailGivebackPct: 20,
      overnightExitEnabled: true,
      overnightMinGainPct: 10,
      overnightRunnerGivebackPct: 15,
      earlyExitBars: 6,
      earlyExitLossPct: 20,
    },
  );
});

test("strategy settings resolve expanded RayReplica settings from profile first", () => {
  const settings = resolveStrategySignalSettings(
    {
      config: {
        parameters: {
          signalTimeframe: "15m",
          timeHorizon: 12,
          bosConfirmation: "close",
        },
      },
    },
    {
      timeframe: "5m",
      rayReplicaSettings: {
        timeHorizon: 8,
        bosConfirmation: "wicks",
        chochAtrBuffer: 0.25,
        chochBodyExpansionAtr: 1.5,
        chochVolumeGate: 1.2,
      },
    },
  );

  assert.deepEqual(settings, {
    signalTimeframe: "5m",
    timeHorizon: 8,
    bosConfirmation: "wicks",
    chochAtrBuffer: 0.25,
    chochBodyExpansionAtr: 1.5,
    chochVolumeGate: 1.2,
  });
});

test("profile merge preserves tuned early and overnight defaults", () => {
  const profile = mergeSignalOptionsProfile({
    parameters: { executionMode: "signal_options" },
    signalOptions: {
      exitPolicy: {
        hardStopPct: -35,
      },
    },
  });

  assert.equal(profile.exitPolicy.hardStopPct, -35);
  assert.equal(profile.exitPolicy.earlyExitBars, 6);
  assert.equal(profile.exitPolicy.earlyExitLossPct, 20);
  assert.equal(profile.exitPolicy.overnightExitEnabled, true);
  assert.equal(profile.exitPolicy.overnightMinGainPct, 10);
});

test("algo row helpers summarize blocker, timeline, and entry quality fields", () => {
  assert.equal(
    candidateBlockerLabel({ reason: "spread_too_wide" }),
    "Spread Too Wide",
  );
  assert.equal(candidateBlockerLabel({}), "—");
  assert.equal(
    candidateLatestActivityLabel({
      timeline: [
        {
          type: "signal_options_candidate",
          summary: "SPY candidate resolved",
        },
        {
          type: "signal_options_entry",
          summary: "SPY shadow CALL filled",
        },
      ],
    }),
    "SPY shadow CALL filled",
  );
  assert.equal(
    candidateLatestActivityLabel({
      timeline: [{ type: "signal_options_skipped" }],
    }),
    "Signal Options Skipped",
  );
  assert.equal(
    entryQualityLabel({ tier: "high", score: 87.234 }),
    "High · 87.2",
  );
});

test("signal rows match candidates by key and signal identity fallback", () => {
  const keyedCandidate = {
    id: "cand-1",
    signal: { signalKey: " SPY:5m:buy:001 " },
    selectedContract: { ticker: "SPY keyed" },
  };
  const fallbackCandidate = {
    id: "cand-2",
    symbol: "QQQ",
    timeframe: "15m",
    direction: "sell",
    selectedContract: { ticker: "QQQ fallback" },
  };
  const mismatchCandidate = {
    id: "cand-3",
    symbol: "QQQ",
    timeframe: "15m",
    direction: "buy",
  };

  assert.equal(
    findSignalOptionsCandidateForSignal(
      [mismatchCandidate, keyedCandidate, fallbackCandidate],
      { signalKey: "SPY:5m:buy:001", symbol: "SPY" },
    ),
    keyedCandidate,
  );
  assert.equal(
    findSignalOptionsCandidateForSignal(
      [mismatchCandidate, fallbackCandidate],
      { symbol: "qqq", timeframe: "15m", direction: "SELL" },
    ),
    fallbackCandidate,
  );
  assert.equal(
    findSignalOptionsCandidateForSignal([fallbackCandidate], {
      symbol: "QQQ",
      timeframe: "15m",
      direction: "buy",
    }),
    null,
  );
});

test("algo contract and quote helpers expose contract identity and live quote detail", () => {
  const now = new Date("2026-05-19T14:30:00Z");
  const contract = {
    ticker: "SPY 20260522C700",
    underlying: "SPY",
    expirationDate: "2026-05-22",
    strike: 700,
    right: "call",
    multiplier: 100,
    providerContractId: "12345678901234567890",
  };
  const quote = {
    bid: 1.2,
    ask: 1.4,
    mark: 1.31,
    last: 1.29,
    impliedVolatility: 0.315,
    delta: 0.42,
    gamma: 0.0123,
    theta: -0.0412,
    vega: 0.0831,
    openInterest: 1200,
    volume: 98765,
    quoteFreshness: "live",
    marketDataMode: "live",
  };
  const liquidity = {
    mid: 1.3,
    spreadPctOfMid: 15.4,
  };

  assert.equal(formatDteLabel(contract.expirationDate, now), "3DTE");
  assert.equal(
    formatContractProviderLabel(contract),
    "conid 12345678...567890",
  );
  assert.deepEqual(formatContractDetail(contract, { now }), {
    main: "05/22 700C",
    detail: "3DTE · x100 · conid 12345678...567890",
  });
  assert.deepEqual(formatQuoteSummary(quote, liquidity), {
    main: "$1.20 / $1.40",
    detail: "mid $1.30 · mark $1.31 · spr 15.4% · Live",
  });
  assert.deepEqual(formatQuoteGreeksSummary(quote), {
    main: "d 0.42 / IV 31.5%",
    detail: "OI 1.2K / Vol 99K",
    full: "g 0.012 / th -0.041 / v 0.083",
  });
  assert.equal(formatCompactMetric(2500000), "2.5M");
});

test("algo contract helpers degrade cleanly for missing fields and selection fallback", () => {
  assert.deepEqual(formatContractDetail(null), {
    main: "—",
    detail: "—",
  });
  assert.deepEqual(formatQuoteSummary({}, {}), {
    main: "—",
    detail: "—",
  });
  assert.deepEqual(formatQuoteGreeksSummary({}), {
    main: "—",
    detail: "—",
    full: "—",
  });
  assert.deepEqual(
    formatContractSelectionSummary({
      preferredSlot: 3,
      selectedSlot: 4,
      fallbackUsed: true,
      attempts: [
        { slot: 3, reason: "no_contract_for_strike_slot" },
        { slot: 4, reason: null },
      ],
    }),
    {
      main: "selected slot 4 · preferred 3",
      detail: "fallback used · 2 attempts · No Contract For Strike Slot",
    },
  );
});

test("algo quote helpers merge live option snapshots over static candidate quotes", () => {
  const merged = mergeOptionQuoteSnapshot(
    {
      bid: 1.1,
      ask: 1.3,
      last: 1.2,
      delta: 0.31,
      quoteFreshness: "metadata",
    },
    {
      bid: 0,
      ask: 1.28,
      price: 1.25,
      delta: 0.36,
      openInterest: 3200,
      freshness: "live",
      marketDataMode: "live",
      updatedAt: "2026-05-19T14:35:00.000Z",
    },
  );

  assert.equal(merged.bid, 1.1);
  assert.equal(merged.ask, 1.28);
  assert.equal(merged.last, 1.25);
  assert.equal(merged.mark, 1.25);
  assert.equal(merged.delta, 0.36);
  assert.equal(merged.openInterest, 3200);
  assert.equal(merged.quoteFreshness, "live");
  assert.equal(merged.quoteUpdatedAt, "2026-05-19T14:35:00.000Z");
  assert.equal(optionProviderContractId({ providerContractId: " conid-1 " }), "conid-1");
});

test("algo positions adapt to the account positions row contract with live option marks", () => {
  const rows = buildAlgoAccountPositionRows({
    positions: [
      {
        id: "pos-1",
        candidateId: "cand-1",
        symbol: "SPY",
        quantity: 2,
        entryPrice: 1.1,
        lastMarkPrice: 1.2,
        premiumAtRisk: 220,
        selectedContract: {
          ticker:
            "twsopt:eyJ2IjoxLCJ1IjoiU1BZIiwiZSI6IjIwMjYwNTIyIiwicyI6NzAwLCJyIjoiQyJ9",
          localSymbol: "SPY  260522C00700000",
          underlying: "SPY",
          expirationDate: "2026-05-22",
          strike: 700,
          right: "call",
          multiplier: 100,
          providerContractId: "conid-1",
        },
      },
    ],
    symbolIndex: {
      SPY: {
        signal: { score: 91.2, signalPrice: 504.12 },
        candidate: {
          quote: { bid: 1.05, ask: 1.2, delta: 0.4 },
          liquidity: { mid: 1.125, spreadPctOfMid: 13.3 },
        },
      },
    },
    liveQuoteByContractId: {
      "conid-1": {
        bid: 1.3,
        ask: 1.5,
        price: 1.4,
        delta: 0.45,
        freshness: "live",
      },
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SPY");
  assert.equal(rows[0].assetClass, "Options");
  assert.equal(rows[0].sourceType, "automation");
  assert.equal(rows[0].optionContract.ticker, "SPY  260522C00700000");
  assert.equal(rows[0].optionContract.expirationDate, "2026-05-22");
  assert.equal(rows[0].optionQuote.bid, 1.3);
  assert.equal(rows[0].optionQuote.ask, 1.5);
  assert.equal(rows[0].mark, 1.4);
  assert.equal(rows[0].marketValue, 280);
  assert.equal(rows[0].unrealizedPnl, 59.99999999999997);
  assert.equal(rows[0].underlyingMarket.price, 504.12);

  const response = buildAlgoAccountPositionsResponse(rows);
  assert.equal(response.totals.netExposure, 280);
  assert.equal(response.totals.unrealizedPnl, 59.99999999999997);
  assert.equal(response.totals.weightPercent, 100);
});

test("algo profile UI exposes and saves expanded strategy and exit fields", () => {
  const profileTabSource = readFileSync(
    new URL("./AlgoProfileTab.jsx", import.meta.url),
    "utf8",
  );
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.ok(
    PROFILE_NUMBER_FIELDS.some(
      ([section, key]) => section === "exitPolicy" && key === "earlyExitBars",
    ),
  );
  assert.ok(
    PROFILE_BOOLEAN_FIELDS.some(
      ([section, key]) =>
        section === "exitPolicy" && key === "overnightExitEnabled",
    ),
  );
  assert.match(profileTabSource, /BOS CONFIRMATION/);
  assert.match(profileTabSource, /CHOCH ATR BUFFER/);
  assert.match(profileTabSource, /overnightExitEnabled/);
  assert.match(screenSource, /bosConfirmation,/);
  assert.match(screenSource, /chochBodyExpansionAtr:/);
  assert.match(screenSource, /chochVolumeGate:/);
});

test("algo operations views surface contract quote and greeks fields", () => {
  const rowSource = readFileSync(
    new URL("./OperationsSignalRow.jsx", import.meta.url),
    "utf8",
  );
  const positionsSource = readFileSync(
    new URL("./OperationsPositionsTable.jsx", import.meta.url),
    "utf8",
  );
  const drillSource = readFileSync(
    new URL("./OperationsSignalDrill.jsx", import.meta.url),
    "utf8",
  );
  const livePageSource = readFileSync(
    new URL("./AlgoLivePage.jsx", import.meta.url),
    "utf8",
  );
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );
  const accountPositionsSource = readFileSync(
    new URL("../account/PositionsPanel.jsx", import.meta.url),
    "utf8",
  );

  assert.match(rowSource, /formatContractDetail/);
  assert.match(rowSource, /mergeOptionQuoteSnapshot/);
  assert.match(rowSource, /getStoredOptionQuoteSnapshot/);
  assert.match(positionsSource, /PositionsPanel/);
  assert.match(positionsSource, /buildAlgoAccountPositionRows/);
  assert.match(positionsSource, /accountPositionsQuery/);
  assert.match(positionsSource, /Shadow account ledger \+ live option quotes/);
  assert.match(positionsSource, /useStoredOptionQuoteSnapshotVersion/);
  assert.match(positionsSource, /showFilters=\{false\}/);
  assert.match(accountPositionsSource, /PositionOptionDetails/);
  assert.match(accountPositionsSource, /Bid \/ Ask/);
  assert.match(screenSource, /useGetAccountPositions/);
  assert.match(screenSource, /assetClass:\s*"Options"/);
  assert.match(livePageSource, /signalOptionsLedgerPositionsQuery/);
  assert.match(drillSource, /contractSelection/);
  assert.match(drillSource, /quoteUpdatedAt/);
  assert.match(livePageSource, /useIbkrOptionQuoteStream/);
  assert.match(livePageSource, /automation-live/);
});

test("algo setup shows a loading state before true empty deployment data", () => {
  const livePageSource = readFileSync(
    new URL("./AlgoLivePage.jsx", import.meta.url),
    "utf8",
  );
  const screenSource = readFileSync(
    new URL("../AlgoScreen.jsx", import.meta.url),
    "utf8",
  );

  assert.match(screenSource, /const algoSetupDataSettled = Boolean/);
  assert.match(screenSource, /deploymentsQuery\.isFetched/);
  assert.match(screenSource, /draftsQuery\.isFetched/);
  assert.match(screenSource, /setupDataSettled=\{algoSetupDataSettled\}/);
  assert.match(livePageSource, /setupDataSettled = true/);
  assert.match(livePageSource, /data-testid="algo-setup-loading"/);
  assert.match(livePageSource, /Loading promoted drafts and shadow deployments/);
  assert.ok(
    livePageSource.indexOf("!setupDataSettled") <
      livePageSource.indexOf("No promoted draft strategies"),
  );
});

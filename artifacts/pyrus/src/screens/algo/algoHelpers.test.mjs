import assert from "node:assert/strict";
import test from "node:test";

import {
  ALGO_DEPLOYMENT_KIND,
  buildSignalIndicatorMetrics,
  buildStaSignalHistoryRows,
  buildVisibleSignalRows,
  findSignalOptionsCandidateForSignal,
  resolveAlgoDeploymentKind,
  resolveDisplayCurrentPrice,
  resolveStableStaActionSnapshot,
  resolveSignalAge,
  resolveSignalDayMove,
  resolveSignalMove,
  resolveSignalScoreBreakdown,
  signalActionLabel,
  signalFreshnessLabel,
  staRowPassesMtfAlignment,
  STRATEGY_SIGNAL_TIMEFRAMES,
} from "./algoHelpers.js";

test("resolveAlgoDeploymentKind routes deployments to the right control surface", () => {
  // Signal-options deployments are identified by their executionMode.
  assert.equal(
    resolveAlgoDeploymentKind({
      config: { parameters: { executionMode: "signal_options" } },
    }),
    ALGO_DEPLOYMENT_KIND.SIGNAL_OPTIONS,
  );
  // Overnight/equity deployments are identified by an overnightSpot config block
  // (config.overnightSpot, the block the backend's resolveOvernightSpotProfile
  // reads) -- regardless of enabled/disabled, so a paused one still routes here.
  assert.equal(
    resolveAlgoDeploymentKind({
      config: { overnightSpot: { executionMode: "disabled" } },
    }),
    ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT,
  );
  assert.equal(
    resolveAlgoDeploymentKind({
      config: { parameters: { overnightSpot: { executionMode: "shadow" } } },
    }),
    ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT,
  );
  // Canonical backend parameters key (overnightSpotTrading).
  assert.equal(
    resolveAlgoDeploymentKind({
      config: {
        parameters: { overnightSpotTrading: { executionMode: "shadow" } },
      },
    }),
    ALGO_DEPLOYMENT_KIND.OVERNIGHT_SPOT,
  );
  // Explicit signal_options wins even if an overnight block is also present.
  assert.equal(
    resolveAlgoDeploymentKind({
      config: {
        overnightSpot: { executionMode: "shadow" },
        parameters: { executionMode: "signal_options" },
      },
    }),
    ALGO_DEPLOYMENT_KIND.SIGNAL_OPTIONS,
  );
  // Unrecognized -> "other"; null/undefined never throw.
  assert.equal(
    resolveAlgoDeploymentKind({ config: {} }),
    ALGO_DEPLOYMENT_KIND.OTHER,
  );
  assert.equal(resolveAlgoDeploymentKind(null), ALGO_DEPLOYMENT_KIND.OTHER);
  assert.equal(
    resolveAlgoDeploymentKind(undefined),
    ALGO_DEPLOYMENT_KIND.OTHER,
  );
});

test("poll-derived Signal Options state/candidates do not create STA rows (live matrix is the sole source)", () => {
  // Signal-options does not produce signals; it only evaluates matrix signals.
  // So with no live matrix signal, neither a signal-options signal nor a candidate
  // may fabricate an STA row — that fabrication is what made STA show stale rows.
  const rows = buildVisibleSignalRows({
    universeSymbols: ["LITE"],
    signalActionTimeframes: ["5m"],
    signals: [
      {
        profileId: "signal-options-profile",
        symbol: "LITE",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-08T14:40:00.000Z",
        fresh: true,
      },
    ],
    candidates: [
      {
        id: "SIGOPT-paper-LITE-buy-1780929600000",
        symbol: "LITE",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-08T14:40:00.000Z",
      },
    ],
    signalMatrixStates: [],
  });

  assert.equal(rows.length, 0);
});

test("visible signal rows use pushed Signal Matrix execution timeframe before options state exists", () => {
  const rows = buildVisibleSignalRows({
    signals: [],
    candidates: [],
    universeSymbols: ["SPY"],
    signalTimeframes: ["2m", "5m", "15m"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-2m",
        symbol: "SPY",
        timeframe: "2m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T16:54:00.000Z",
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-5m",
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        currentSignalPrice: 545.25,
        currentSignalClose: 545.5,
        latestBarAt: "2026-06-11T16:55:00.000Z",
        barsSinceSignal: 0,
        fresh: true,
        status: "ok",
        actionEligible: true,
        actionBlocker: null,
      },
      {
        profileId: "profile-15m",
        symbol: "SPY",
        timeframe: "15m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T16:45:00.000Z",
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-5m",
        symbol: "QQQ",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SPY");
  assert.equal(rows[0].timeframe, "5m");
  assert.equal(rows[0].direction, "buy");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
  assert.equal(rows[0].actionEligible, true);
  assert.equal(rows[0].signalLevelPrice, 545.25);
  assert.equal(rows[0].signalPrice, 545.5);
  assert.equal(rows[0].currentSignalClose, 545.5);
});

test("STA display gate keeps same-frame 1:1 signals visible when trend lags", () => {
  assert.equal(
    staRowPassesMtfAlignment(
      {
        symbol: "CCJ",
        timeframe: "1m",
        direction: "sell",
        signalAt: "2026-06-26T18:16:00.000Z",
      },
      {
        CCJ: {
          "1m": {
            trendDirection: "bullish",
            currentSignalDirection: "sell",
            status: "ok",
            active: true,
          },
        },
      },
      {
        enabled: true,
        timeframes: ["1m"],
        requiredCount: 1,
      },
    ),
    true,
  );
});

test("visible signal rows keep 1:1 directional matrix cells without crossover timestamps", () => {
  const rows = buildVisibleSignalRows({
    universeSymbols: ["AIYY", "QQQ", "EMPTY"],
    signalTimeframes: ["1m"],
    signalActionTimeframes: ["1m"],
    signalMatrixStates: [
      {
        profileId: "profile-1m",
        symbol: "AIYY",
        timeframe: "1m",
        status: "ok",
        active: true,
        fresh: false,
        currentSignalDirection: "buy",
        currentSignalAt: null,
        latestBarAt: "2026-06-27T00:07:00.000Z",
        latestBarClose: 17.25,
        lastEvaluatedAt: "2026-06-27T00:07:45.087Z",
        trendDirection: "bullish",
        actionEligible: false,
        actionBlocker: "no_signal",
      },
      {
        profileId: "profile-1m",
        symbol: "QQQ",
        timeframe: "1m",
        status: "ok",
        active: true,
        fresh: true,
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-27T00:06:00.000Z",
        latestBarAt: "2026-06-27T00:07:00.000Z",
        latestBarClose: 706.14,
        actionEligible: true,
        actionBlocker: null,
      },
      {
        profileId: "profile-1m",
        symbol: "EMPTY",
        timeframe: "1m",
        status: "ok",
        active: true,
        fresh: false,
        currentSignalDirection: null,
        currentSignalAt: null,
        latestBarAt: "2026-06-27T00:07:00.000Z",
        trendDirection: "bullish",
        actionEligible: false,
        actionBlocker: "no_signal",
      },
    ],
  });

  assert.equal(rows.length, 2);
  const trendOnlyRow = rows.find((row) => row.symbol === "AIYY");
  assert.equal(trendOnlyRow.direction, "buy");
  assert.equal(trendOnlyRow.signalAt, null);
  assert.equal(trendOnlyRow.currentSignalAt, null);
  assert.equal(trendOnlyRow.latestBarAt, "2026-06-27T00:07:00.000Z");
  assert.equal(trendOnlyRow.actionEligible, false);
  assert.equal(trendOnlyRow.actionBlocker, "no_signal");
  assert.equal(rows.some((row) => row.symbol === "EMPTY"), false);
});

test("visible signal rows are signal-driven and do not preserve the universe cap", () => {
  const symbols = Array.from(
    { length: 500 },
    (_, index) => `S${String(index).padStart(3, "0")}`,
  );
  const signalMatrixStates = symbols.flatMap((symbol, index) =>
    STRATEGY_SIGNAL_TIMEFRAMES.map((timeframe) => {
      const noSignal = index % 10 === 0;
      return {
        profileId: `profile-${timeframe}`,
        symbol,
        timeframe,
        status: noSignal ? "ok" : index % 13 === 0 ? "unavailable" : "ok",
        active: true,
        fresh: !noSignal,
        currentSignalDirection: noSignal
          ? null
          : index % 2 === 0
            ? "buy"
            : "sell",
        currentSignalAt: noSignal
          ? null
          : `2026-06-11T16:${String(index % 60).padStart(2, "0")}:00.000Z`,
        trendDirection: noSignal
          ? "bullish"
          : index % 2 === 0
            ? "bullish"
            : "bearish",
        currentSignalPrice: noSignal ? null : 500 + index,
        currentSignalClose: noSignal ? null : 500.25 + index,
        latestBarAt: `2026-06-11T17:${String(index % 60).padStart(2, "0")}:00.000Z`,
        latestBarClose: 501 + index,
        actionEligible: !noSignal,
        actionBlocker: noSignal ? "no_signal" : null,
      };
    }),
  );

  for (const timeframe of STRATEGY_SIGNAL_TIMEFRAMES) {
    const rows = buildVisibleSignalRows({
      universeSymbols: symbols,
      signalTimeframes: [timeframe],
      signalActionTimeframes: [timeframe],
      signalMatrixStates,
    });
    assert.equal(rows.length, 450, `${timeframe} should expose signal cells only`);
    assert.deepEqual(
      symbols
        .filter((_, index) => index % 10 === 0)
        .filter((symbol) => rows.some((row) => row.symbol === symbol)),
      [],
    );
    assert.equal(rows.every((row) => row.timeframe === timeframe), true);

    const noSignalRow = rows.find((row) => row.symbol === "S000");
    assert.equal(noSignalRow, undefined);
    assert.equal(rows.every((row) => row.direction === "buy" || row.direction === "sell"), true);
    assert.equal(rows.every((row) => row.signalAt), true);
  }
});

test("STA matrix row carries latestBarClose as currentPrice so Move resolves without sparkline hydration", () => {
  const [row] = buildVisibleSignalRows({
    signals: [],
    candidates: [],
    universeSymbols: ["SPY"],
    signalTimeframes: ["5m"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-5m",
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        currentSignalPrice: 500,
        currentSignalClose: 500,
        latestBarAt: "2026-06-11T17:30:00.000Z",
        latestBarClose: 525,
        barsSinceSignal: 7,
        fresh: true,
        status: "ok",
        actionEligible: true,
        actionBlocker: null,
      },
    ],
  });

  // currentPrice comes straight off the matrix state (latestBarClose), so the
  // Move column renders immediately — no live quote or sparkline snapshot.
  assert.equal(row.currentPrice, 525);
  assert.equal(row.latestBarClose, 525);
  const move = resolveSignalMove(row, null, null);
  assert.equal(move.label, "+5.0%");
  assert.equal(move.detail, "+25.00");
});

test("STA matrix Move uses signal bar close, not structural signal level", () => {
  const [row] = buildVisibleSignalRows({
    signals: [],
    candidates: [],
    universeSymbols: ["AIZ"],
    signalTimeframes: ["2m"],
    signalActionTimeframes: ["2m"],
    signalMatrixStates: [
      {
        profileId: "profile-2m",
        symbol: "AIZ",
        timeframe: "2m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-22T13:30:00.000Z",
        currentSignalPrice: 139.769852,
        currentSignalClose: 261.61,
        latestBarAt: "2026-06-22T21:46:00.000Z",
        latestBarClose: 261.58,
        barsSinceSignal: 248,
        fresh: false,
        status: "stale",
        actionEligible: false,
        actionBlocker: "data_stale",
      },
    ],
  });

  assert.equal(row.signalLevelPrice, 139.769852);
  assert.equal(row.signalPrice, 261.61);
  assert.equal(row.currentPrice, 261.58);
  const move = resolveSignalMove(row, null, null);
  assert.equal(move.label, "-0.0%");
  assert.equal(move.detail, "-0.03");
  assert.equal(move.stale, true);
});

test("STA matrix Move stays blank when monitor state lacks signal close", () => {
  const [row] = buildVisibleSignalRows({
    signals: [],
    candidates: [],
    universeSymbols: ["AIZ"],
    signalTimeframes: ["2m"],
    signalActionTimeframes: ["2m"],
    signalMatrixStates: [
      {
        profileId: "profile-2m",
        symbol: "AIZ",
        timeframe: "2m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-22T13:30:00.000Z",
        currentSignalPrice: 139.769852,
        latestBarAt: "2026-06-22T21:46:00.000Z",
        latestBarClose: 261.58,
        barsSinceSignal: 248,
        fresh: false,
        status: "stale",
        actionEligible: false,
        actionBlocker: "data_stale",
      },
    ],
  });

  assert.equal(row.signalLevelPrice, 139.769852);
  assert.equal(row.signalPrice, null);
  assert.equal(row.currentPrice, 261.58);
  const move = resolveSignalMove(row, null, null);
  assert.equal(move.label, "—");
});

test("signal indicator metrics use visible STA rows with buy/sell directional partitions", () => {
  const metrics = buildSignalIndicatorMetrics([
    {
      symbol: "AAPL",
      direction: "buy",
      signalPrice: 100,
      currentPrice: 110,
    },
    {
      symbol: "MSFT",
      direction: "sell",
      signalPrice: 200,
      currentPrice: 180,
    },
    {
      symbol: "NVDA",
      direction: "sell",
      signalPrice: 50,
      currentPrice: 55,
    },
    {
      symbol: "TSLA",
      direction: "buy",
      signalPrice: 0,
      currentPrice: 120,
    },
  ]);

  assert.equal(metrics.source, "live");
  assert.equal(metrics.signalCount, 4);
  assert.equal(metrics.observationCount, 3);
  assert.equal(metrics.winCount, 2);
  assert.equal(metrics.byDirection.buy.signalCount, 2);
  assert.equal(metrics.byDirection.buy.observationCount, 1);
  assert.equal(metrics.byDirection.buy.avgDirectionalMovePercent, 10);
  assert.equal(metrics.byDirection.buy.correctnessPercent, 100);
  assert.equal(metrics.byDirection.sell.signalCount, 2);
  assert.equal(metrics.byDirection.sell.observationCount, 2);
  assert.equal(metrics.byDirection.sell.avgDirectionalMovePercent, 0);
  assert.equal(metrics.byDirection.sell.correctnessPercent, 50);
  assert.equal(metrics.byDirection.sell.expectancyPercent, 0);
  assert.ok(Math.abs(metrics.avgDirectionalMovePercent - 10 / 3) < 1e-9);
  assert.ok(Math.abs(metrics.correctnessPercent - (2 / 3) * 100) < 1e-9);
});

test("signal indicator all-count follows STA rows even when a matrix row has no direction", () => {
  const metrics = buildSignalIndicatorMetrics([
    {
      symbol: "AAPL",
      direction: "buy",
      signalPrice: 100,
      currentPrice: 110,
    },
    {
      symbol: "MSFT",
      direction: "sell",
      signalPrice: 200,
      currentPrice: 180,
    },
    {
      symbol: "SQQQ",
      direction: null,
      actionBlocker: "no_signal",
      timeframe: "2m",
    },
  ]);

  assert.equal(metrics.signalCount, 3);
  assert.equal(metrics.observationCount, 2);
  assert.equal(metrics.byDirection.buy.signalCount, 1);
  assert.equal(metrics.byDirection.sell.signalCount, 1);
  assert.equal(
    metrics.byDirection.buy.signalCount + metrics.byDirection.sell.signalCount,
    2,
  );
});

test("signal indicator metrics split by score bucket and bucket counts sum to All", () => {
  const metrics = buildSignalIndicatorMetrics([
    {
      symbol: "AAPL",
      direction: "buy",
      signalPrice: 100,
      currentPrice: 110,
      scoreBreakdown: { tier: "high" },
    },
    {
      symbol: "MSFT",
      direction: "sell",
      signalPrice: 200,
      currentPrice: 180,
      scoreBreakdown: { tier: "high" },
    },
    {
      symbol: "NVDA",
      direction: "buy",
      signalPrice: 50,
      currentPrice: 45,
      scoreBreakdown: { tier: "standard" },
    },
    {
      symbol: "TSLA",
      direction: "sell",
      signalPrice: 300,
      currentPrice: 330,
      scoreBreakdown: { tier: "low" },
    },
    // No scoreBreakdown -> lands in unknown; directionless -> no observation.
    {
      symbol: "SQQQ",
      direction: null,
      timeframe: "2m",
    },
  ]);

  assert.equal(metrics.byScoreBucket.high.signalCount, 2);
  assert.equal(metrics.byScoreBucket.standard.signalCount, 1);
  assert.equal(metrics.byScoreBucket.low.signalCount, 1);
  assert.equal(metrics.byScoreBucket.unknown.signalCount, 1);
  // Per-bucket counts sum to the overall (All) signalCount.
  assert.equal(
    metrics.byScoreBucket.high.signalCount +
      metrics.byScoreBucket.standard.signalCount +
      metrics.byScoreBucket.low.signalCount +
      metrics.byScoreBucket.unknown.signalCount,
    metrics.signalCount,
  );
  // High bucket: AAPL +10% (win) and MSFT short 200->180 = +10% (win).
  assert.equal(metrics.byScoreBucket.high.observationCount, 2);
  assert.equal(metrics.byScoreBucket.high.correctnessPercent, 100);
  // Unknown bucket has a directionless row only -> no observations.
  assert.equal(metrics.byScoreBucket.unknown.observationCount, 0);
});

test("signal indicator metrics split scores into 10-point ranges and average move timelines", () => {
  const signalAt = "2026-06-22T14:30:00.000Z";
  const metrics = buildSignalIndicatorMetrics(
    [
      {
        symbol: "AAPL",
        direction: "buy",
        signalAt,
        currentSignalClose: 100,
        latestBarClose: 106,
        scoreBreakdown: { score: 82.3, tier: "high" },
        sparkBars: [
          { timestamp: "2026-06-22T14:30:00.000Z", close: 100 },
          { timestamp: "2026-06-22T14:35:00.000Z", close: 103 },
          { timestamp: "2026-06-22T14:40:00.000Z", close: 106 },
        ],
      },
      {
        symbol: "MSFT",
        direction: "sell",
        signalAt,
        currentSignalClose: 200,
        latestBarClose: 190,
        scoreBreakdown: { score: 87.9, tier: "high" },
        sparkBars: [
          { timestamp: "2026-06-22T14:35:00.000Z", close: 194 },
          { timestamp: "2026-06-22T14:40:00.000Z", close: 190 },
        ],
      },
      {
        symbol: "NVDA",
        direction: "buy",
        signalAt,
        currentSignalClose: 50,
        latestBarClose: 51,
        scoreBreakdown: { score: 55, tier: "standard" },
        sparkBars: [
          { timestamp: "2026-06-22T14:35:00.000Z", close: 51 },
        ],
      },
      {
        symbol: "SQQQ",
        direction: null,
        scoreBreakdown: { score: 100, tier: "high" },
      },
      {
        symbol: "NOPE",
        direction: null,
      },
    ],
    { timelineBars: 2 },
  );

  assert.equal(metrics.byScoreRange["80-90"].signalCount, 2);
  assert.equal(metrics.byScoreRange["80-90"].observationCount, 2);
  assert.equal(metrics.byScoreRange["50-60"].signalCount, 1);
  assert.equal(metrics.byScoreRange["90-100"].signalCount, 1);
  assert.equal(metrics.byScoreRange.unknown.signalCount, 1);
  assert.equal(metrics.byScoreRangeDirection["80-90"].buy.signalCount, 1);
  assert.equal(metrics.byScoreRangeDirection["80-90"].sell.signalCount, 1);
  assert.equal(metrics.byScoreRangeDirection["50-60"].buy.signalCount, 1);
  assert.equal(metrics.byScoreRangeDirection["50-60"].sell.signalCount, 0);
  assert.equal(metrics.byScoreRangeDirection["90-100"].buy.signalCount, 0);
  assert.equal(metrics.scoreBuckets[1].byDirection.buy.signalCount, 1);
  assert.equal(metrics.scoreBuckets[1].byDirection.sell.signalCount, 1);

  const highTimeline = metrics.byScoreRange["80-90"].moveTimeline;
  assert.deepEqual(
    highTimeline.map((point) => ({
      bar: point.bar,
      observationCount: point.observationCount,
      avgMovePercent: Number(point.avgMovePercent.toFixed(2)),
    })),
    [
      { bar: 1, observationCount: 2, avgMovePercent: 3 },
      { bar: 2, observationCount: 2, avgMovePercent: 5.5 },
    ],
  );
  assert.deepEqual(
    metrics.scoreBuckets
      .filter((bucket) => bucket.signalCount > 0)
      .map((bucket) => bucket.key),
    ["90-100", "80-90", "50-60", "unknown"],
  );
});

test("signal indicator metrics calculate excursion from timestamped spark bars", () => {
  const metrics = buildSignalIndicatorMetrics(
    [
      {
        symbol: "AAPL",
        direction: "buy",
        signalAt: "2026-06-22T14:30:00.000Z",
        signalPrice: 100,
      },
      {
        symbol: "MSFT",
        direction: "sell",
        signalAt: "2026-06-22T14:30:00.000Z",
        signalPrice: 200,
      },
    ],
    {
      tickerSnapshotsBySymbol: {
        AAPL: {
          sparkBars: [
            {
              timestamp: "2026-06-22T14:20:00.000Z",
              high: 120,
              low: 80,
              close: 100,
            },
            {
              timestamp: "2026-06-22T14:35:00.000Z",
              high: 112,
              low: 95,
              close: 108,
            },
          ],
        },
        MSFT: {
          sparkBars: [
            {
              timestamp: "2026-06-22T14:35:00.000Z",
              high: 210,
              low: 180,
              close: 184,
            },
          ],
        },
      },
    },
  );

  assert.equal(metrics.byDirection.buy.avgMfePercent, 12);
  assert.equal(metrics.byDirection.buy.avgMaePercent, -5);
  assert.equal(metrics.byDirection.sell.avgMfePercent, 10);
  assert.equal(metrics.byDirection.sell.avgMaePercent, -5);
  assert.equal(metrics.avgMfePercent, 11);
  assert.equal(metrics.avgMaePercent, -5);
});

test("signal indicator metrics use persisted state excursion fields", () => {
  const metrics = buildSignalIndicatorMetrics([
    {
      symbol: "AAPL",
      direction: "buy",
      signalAt: "2026-06-22T14:30:00.000Z",
      currentSignalClose: 100,
      latestBarClose: 108,
      currentSignalMfePercent: 12,
      currentSignalMaePercent: -5,
    },
    {
      symbol: "MSFT",
      direction: "sell",
      signalAt: "2026-06-22T14:30:00.000Z",
      currentSignalClose: 200,
      latestBarClose: 184,
      currentSignalMfePercent: 10,
      currentSignalMaePercent: -5,
    },
  ]);

  assert.equal(metrics.byDirection.buy.avgMfePercent, 12);
  assert.equal(metrics.byDirection.buy.avgMaePercent, -5);
  assert.equal(metrics.byDirection.sell.avgMfePercent, 10);
  assert.equal(metrics.byDirection.sell.avgMaePercent, -5);
  assert.equal(metrics.avgMfePercent, 11);
  assert.equal(metrics.avgMaePercent, -5);
});

test("STA matrix row Move is blank without latestBarClose until async hydration arrives", () => {
  const [row] = buildVisibleSignalRows({
    signals: [],
    candidates: [],
    universeSymbols: ["SPY"],
    signalTimeframes: ["5m"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-5m",
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        currentSignalPrice: 500,
        latestBarAt: "2026-06-11T17:30:00.000Z",
        barsSinceSignal: 7,
        fresh: true,
        status: "ok",
        actionEligible: true,
        actionBlocker: null,
      },
    ],
  });

  assert.equal(row.currentPrice, null);
  assert.equal(resolveSignalMove(row, null, null).label, "—");
});

test("visible signal rows use the live Signal Matrix as the STA action source over Signal Options duplicates", () => {
  const rows = buildVisibleSignalRows({
    universeSymbols: ["VRT"],
    signalTimeframes: ["5m"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "matrix-profile",
        symbol: "VRT",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T16:50:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
    signals: [
      {
        profileId: "signal-options-profile",
        symbol: "VRT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-11T16:50:00.000Z",
        sourceType: "signal_options_state",
        fresh: true,
      },
    ],
    candidates: [
      {
        id: "SIGOPT-paper-VRT-sell-1781196600000",
        symbol: "VRT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-11T16:50:00.000Z",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].profileId, "matrix-profile");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
});

test("STA action rows without backend actionability are ineligible by default", () => {
  // No client-side age inference remains: a state that does not carry the
  // backend-authored actionEligible/actionBlocker fields renders blocked.
  // The fresh flag never substitutes for the backend verdict.
  const rows = buildVisibleSignalRows({
    universeSymbols: ["TSM", "DIA"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-1",
        symbol: "TSM",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T17:05:00.000Z",
        latestBarAt: "2026-06-11T17:10:00.000Z",
        barsSinceSignal: 1,
        fresh: false,
        status: "ok",
      },
      {
        profileId: "profile-1",
        symbol: "DIA",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-11T15:05:00.000Z",
        latestBarAt: "2026-06-11T15:20:00.000Z",
        barsSinceSignal: 2,
        fresh: true,
        status: "ok",
      },
    ],
  });

  const bySymbol = Object.fromEntries(rows.map((row) => [row.symbol, row]));

  assert.equal(bySymbol.TSM.actionEligible, false);
  assert.equal(bySymbol.TSM.actionBlocker, null);
  assert.equal(bySymbol.DIA.actionEligible, false);
  assert.equal(bySymbol.DIA.actionBlocker, null);
});

test("STA action rows trust backend-authored actionability over local inference", () => {
  const rows = buildVisibleSignalRows({
    universeSymbols: ["NVDA", "AMD"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        // bars=0 would locally infer eligible; the backend verdict must win.
        profileId: "profile-1",
        symbol: "NVDA",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-12T17:05:00.000Z",
        latestBarAt: "2026-06-12T17:05:00.000Z",
        barsSinceSignal: 0,
        fresh: false,
        status: "stale",
        actionEligible: false,
        actionBlocker: "data_stale",
      },
      {
        profileId: "profile-1",
        symbol: "AMD",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-12T17:05:00.000Z",
        latestBarAt: "2026-06-12T17:10:00.000Z",
        barsSinceSignal: 1,
        fresh: true,
        status: "ok",
        actionEligible: true,
        actionBlocker: null,
      },
    ],
  });

  const bySymbol = Object.fromEntries(rows.map((row) => [row.symbol, row]));

  assert.equal(bySymbol.NVDA.actionEligible, false);
  assert.equal(bySymbol.NVDA.actionBlocker, "data_stale");
  assert.equal(bySymbol.AMD.actionEligible, true);
  assert.equal(bySymbol.AMD.actionBlocker, null);
});

test("visible signal rows ignore received history without a matrix cell", () => {
  const rows = buildVisibleSignalRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    includeSignalHistory: true,
    universeSymbols: ["ALIT", "VRT"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [],
    signalEvents: [
      {
        id: "event-alit-one-minute",
        profileId: "profile-1",
        symbol: "ALIT",
        timeframe: "1m",
        direction: "sell",
        signalAt: "2026-06-09T14:06:00.000Z",
      },
      {
        id: "event-vrt-five-minute",
        profileId: "profile-1",
        symbol: "VRT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
      },
    ],
  });

  assert.deepEqual(rows, []);
});

test("STA signal history keeps received events from the fetched lookback window", () => {
  const rows = buildStaSignalHistoryRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    universeSymbols: ["ALIT", "ABFL"],
    signalEvents: [
      {
        id: "event-alit-previous-session",
        profileId: "profile-1",
        symbol: "ALIT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-08T20:05:00.000Z",
        emittedAt: "2026-06-08T20:05:00.695Z",
        signalPrice: 8.91,
        close: 9.42,
      },
      {
        id: "event-abfl-current-session",
        profileId: "profile-1",
        symbol: "ABFL",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
        emittedAt: "2026-06-09T14:05:03.100Z",
        signalPrice: 14.1,
        close: 14.18,
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.signalAt, row.sourceType]),
    [
      ["ABFL", "2026-06-09T14:05:00.000Z", "signal_monitor_event"],
      ["ALIT", "2026-06-08T20:05:00.000Z", "signal_monitor_event"],
    ],
  );
  assert.equal(rows[1].direction, "sell");
  assert.equal(rows[1].signalLevelPrice, 8.91);
  assert.equal(rows[1].signalPrice, 9.42);
  assert.equal(rows[1].currentSignalPrice, 8.91);
  assert.equal(rows[1].currentSignalClose, 9.42);
  assert.equal(rows[1].emittedAt, "2026-06-08T20:05:00.695Z");
});

test("visible signal rows keep matrix action rows and ignore unmatched received history", () => {
  const rows = buildVisibleSignalRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    includeSignalHistory: true,
    universeSymbols: ["ALIT", "VRT"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-1",
        symbol: "VRT",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-09T14:05:00.000Z",
        fresh: true,
        status: "ok",
      },
    ],
    signalEvents: [
      {
        id: "event-vrt-current-overlay",
        profileId: "profile-1",
        symbol: "VRT",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-09T14:05:00.000Z",
        emittedAt: "2026-06-09T14:05:02.000Z",
      },
      {
        id: "event-alit-previous-session",
        profileId: "profile-1",
        symbol: "ALIT",
        timeframe: "5m",
        direction: "sell",
        signalAt: "2026-06-08T20:05:00.000Z",
        emittedAt: "2026-06-08T20:05:00.695Z",
        signalPrice: 9.42,
        close: 9.4,
        payload: {
          filterState: { adx: 21.1, sessionPass: true },
          latestBarAt: "2026-06-08T20:05:00.000Z",
          signalBarAt: "2026-06-08T20:00:00.000Z",
        },
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => [row.symbol, row.signalAt, row.sourceType]),
    [["VRT", "2026-06-09T14:05:00.000Z", "signal_matrix_state"]],
  );
});

test("visible signal rows order by signal time before matrix activity", () => {
  const rows = buildVisibleSignalRows({
    universeSymbols: ["AAPU", "AISP"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-5m",
        symbol: "AAPU",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-25T23:15:00.000Z",
        latestBarAt: "2026-06-25T23:20:00.000Z",
        lastEvaluatedAt: "2026-06-25T23:20:03.434Z",
        fresh: true,
        status: "ok",
      },
      {
        profileId: "profile-5m",
        symbol: "AISP",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-24T19:20:00.000Z",
        latestBarAt: "2026-06-25T23:20:00.000Z",
        lastEvaluatedAt: "2026-06-25T23:28:19.971Z",
        fresh: false,
        status: "ok",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.symbol),
    ["AAPU", "AISP"],
  );
});

test("STA selected execution timeframe keeps the matrix row over newer received history", () => {
  const rows = buildVisibleSignalRows({
    includeSignalHistory: true,
    universeSymbols: ["CEG"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-1",
        symbol: "CEG",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-12T15:55:00.000Z",
        latestBarAt: "2026-06-12T16:35:00.000Z",
        fresh: false,
        status: "ok",
      },
    ],
    signalEvents: [
      {
        id: "ceg-newer-exec-signal",
        profileId: "profile-1",
        symbol: "CEG",
        timeframe: "5m",
        direction: "buy",
        signalAt: "2026-06-12T16:25:00.000Z",
        emittedAt: "2026-06-12T16:25:03.000Z",
      },
      {
        id: "ceg-newer-non-exec-signal",
        profileId: "profile-1",
        symbol: "CEG",
        timeframe: "1m",
        direction: "sell",
        signalAt: "2026-06-12T16:30:00.000Z",
        emittedAt: "2026-06-12T16:30:03.000Z",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "CEG");
  assert.equal(rows[0].timeframe, "5m");
  assert.equal(rows[0].direction, "sell");
  assert.equal(rows[0].signalAt, "2026-06-12T15:55:00.000Z");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
});

test("matrix and received-history rows collapse to one matrix-owned cell despite symbol case/whitespace", () => {
  // Hardening for the matrix-owned-only rule: the collapse cell key normalizes
  // symbol + timeframe via trim+uppercase, so a received-history row whose raw
  // symbol/timeframe differ only by case/whitespace must still collapse onto the
  // live Signal Matrix cell for the same canonical (symbol, timeframe) -- never a
  // second row -- and the Matrix row must own it even when the history is newer.
  const args = {
    includeSignalHistory: true,
    universeSymbols: ["SPY"],
    signalActionTimeframes: ["5m"],
    signalEvents: [
      {
        id: "spy-newer-history",
        profileId: "profile-1",
        symbol: "  spy  ",
        timeframe: " 5m ",
        direction: "buy",
        signalAt: "2026-06-12T16:25:00.000Z",
        emittedAt: "2026-06-12T16:25:03.000Z",
      },
    ],
  };

  // Control: the case/whitespace history row is a real, buildable history row,
  // but the visible action surface must not render it without a Matrix cell.
  const historyOnly = buildStaSignalHistoryRows(args);
  assert.equal(historyOnly.length, 1);
  assert.equal(historyOnly[0].symbol, "SPY");
  assert.equal(historyOnly[0].timeframe, "5m");
  assert.equal(historyOnly[0].sourceType, "signal_monitor_event");
  assert.deepEqual(buildVisibleSignalRows(args), []);

  // With a (stale) Matrix cell for the same canonical key, both collapse to one
  // Matrix-owned row regardless of the newer history timestamp.
  const rows = buildVisibleSignalRows({
    ...args,
    signalMatrixStates: [
      {
        profileId: "profile-1",
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "sell",
        currentSignalAt: "2026-06-12T15:55:00.000Z",
        latestBarAt: "2026-06-12T16:35:00.000Z",
        fresh: false,
        status: "ok",
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SPY");
  assert.equal(rows[0].timeframe, "5m");
  assert.equal(rows[0].direction, "sell");
  assert.equal(rows[0].sourceType, "signal_matrix_state");
});

test("visible signal rows ignore repeated received history without matrix state", () => {
  const rows = buildVisibleSignalRows({
    now: Date.parse("2026-06-09T14:00:00.000Z"),
    includeSignalHistory: true,
    universeSymbols: ["USO"],
    signals: [
      {
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-09T13:25:00.000Z",
        fresh: false,
      },
    ],
    candidates: [],
    // Same cell fired buy three times over the day — must NOT become three rows.
    signalEvents: [
      {
        id: "uso-1",
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-09T13:25:00.000Z",
      },
      {
        id: "uso-2",
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-09T12:17:00.000Z",
      },
      {
        id: "uso-3",
        profileId: "profile-1",
        symbol: "USO",
        timeframe: "1m",
        direction: "buy",
        signalAt: "2026-06-08T19:34:00.000Z",
      },
    ],
  });

  assert.deepEqual(rows, []);
});

test("STA candidate lookup does not attach newer candidates to historical signal rows", () => {
  const candidate = {
    id: "SIGOPT-paper-AVAV-buy-1780930800000",
    symbol: "AVAV",
    timeframe: "5m",
    direction: "buy",
    signalAt: "2026-06-08T15:00:00.000Z",
    signal: {
      symbol: "AVAV",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-08T15:00:00.000Z",
    },
  };

  assert.equal(
    findSignalOptionsCandidateForSignal([candidate], {
      symbol: "AVAV",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-08T14:00:00.000Z",
    }),
    null,
  );

  assert.equal(
    findSignalOptionsCandidateForSignal([candidate], {
      symbol: "AVAV",
      timeframe: "5m",
      direction: "buy",
      signalAt: "2026-06-08T15:00:00.000Z",
    }),
    candidate,
  );
});

test("STA signal age falls back to elapsed time when bar age is unavailable", () => {
  const age = resolveSignalAge(
    {
      signalAt: "2026-06-08T14:00:00.000Z",
      barsSinceSignal: null,
    },
    { now: new Date("2026-06-08T15:02:00.000Z") },
  );

  assert.equal(age.label, "1h");
  assert.equal(age.detail, "1h since signal");
});

test("STA signal age display uses elapsed time even when bar age is present", () => {
  const age = resolveSignalAge(
    {
      signalAt: "2026-06-08T14:00:00.000Z",
      barsSinceSignal: 2,
      freshWindowBars: 8,
    },
    { now: new Date("2026-06-08T14:17:00.000Z") },
  );

  assert.equal(age.label, "17m");
  assert.equal(age.detail, "17m since signal");
  assert.equal(age.barsLabel, "2/8 bars");
  assert.equal(age.freshnessPct, 75);
});

test("Signal action labels use the LONG/SHORT direction voice (long-options only)", () => {
  // Direction voice is LONG/SHORT; the instrument (long call / long put) is
  // implementation detail. buy_call/buy_put map onto the same voice so the
  // labels stay long-premium only — no sell-to-open wording can appear.
  assert.equal(signalActionLabel({ direction: "buy" }, null), "LONG");
  assert.equal(signalActionLabel({ direction: "sell" }, null), "SHORT");
  assert.equal(
    signalActionLabel(null, {
      signalDirection: "sell",
      optionAction: "buy_put",
      orderSide: "buy",
      orderIntent: "open_long_option",
    }),
    "SHORT",
  );
});

test("STA signal move uses signal basis aliases and current quote", () => {
  const move = resolveSignalMove(
    {
      symbol: "APLD",
      currentSignalPrice: 40,
    },
    {
      symbol: "APLD",
      price: 42,
    },
  );

  assert.equal(move.label, "+5.0%");
  assert.equal(move.detail, "+2.00");
});

test("STA signal move falls back to latest sparkline bar close without a live quote", () => {
  const move = resolveSignalMove(
    {
      symbol: "APLD",
      currentSignalPrice: 40,
      sparkBars: [{ close: 41 }, { close: 44 }],
    },
    // No live quote fields (price/last/mark all absent).
    { symbol: "APLD" },
  );

  assert.equal(move.label, "+10.0%");
  assert.equal(move.detail, "+4.00");
});

test("STA signal move prefers a live quote over the sparkline fallback", () => {
  const move = resolveSignalMove(
    {
      symbol: "APLD",
      currentSignalPrice: 40,
      sparkBars: [{ close: 99 }],
    },
    { symbol: "APLD", price: 42 },
  );

  assert.equal(move.label, "+5.0%");
  assert.equal(move.detail, "+2.00");
});

test("STA source selection does not let cockpit wrapper generatedAt beat fuller state rows", () => {
  const snapshot = resolveStableStaActionSnapshot({
    signalOptionsState: {
      signals: [
        {
          symbol: "HEI",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-08T16:15:00.000Z",
        },
        {
          symbol: "ADM",
          timeframe: "2m",
          direction: "buy",
          signalAt: "2026-06-08T16:12:00.000Z",
        },
      ],
      candidates: [
        {
          id: "SIGOPT-paper-HEI-sell-1780935300000",
          symbol: "HEI",
          signalAt: "2026-06-08T16:15:00.000Z",
        },
      ],
    },
    cockpit: {
      generatedAt: "2026-06-08T16:25:00.000Z",
      signals: [
        {
          symbol: "HEI",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-08T16:15:00.000Z",
        },
      ],
      candidates: [],
    },
  });

  assert.equal(snapshot.source, "state");
  assert.equal(snapshot.signals.length, 2);
  assert.equal(snapshot.candidates.length, 1);
});

test("STA source selection does not reuse previous rows through empty refresh frames", () => {
  const snapshot = resolveStableStaActionSnapshot({
    cockpit: {
      generatedAt: "2026-06-09T19:10:00.000Z",
      signals: [],
      candidates: [],
      activePositions: [],
    },
    signalOptionsState: {
      updatedAt: "2026-06-09T19:10:00.000Z",
      signals: [],
      candidates: [],
      activePositions: [],
    },
  });

  assert.equal(snapshot.source, "empty");
  assert.equal(snapshot.cacheable, true);
  assert.equal(snapshot.sourceHealth.degraded, false);
  assert.equal(snapshot.signals.length, 0);
  assert.equal(snapshot.candidates.length, 0);
});

test("STA source selection serves cache-stale action rows as the live default", () => {
  // "Served from stored monitor state" (cacheStatus: "stale") is the SSE-era
  // default, not a degraded source — it must be served, not rejected. Genuine
  // failures still surface via record.stale/degraded/refreshing/timeout.
  const snapshot = resolveStableStaActionSnapshot({
    signalOptionsState: {
      cacheStatus: "stale",
      signals: [
        {
          symbol: "NOC",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
      candidates: [
        {
          id: "SIGOPT-paper-NOC-sell-1781201400000",
          symbol: "NOC",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
    },
    cockpit: {
      cacheStatus: "stale",
      signals: [
        {
          symbol: "NOC",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
      candidates: [],
    },
  });

  assert.equal(snapshot.source, "state");
  assert.equal(snapshot.signals.length, 1);
  assert.equal(snapshot.candidates.length, 1);
  assert.equal(snapshot.sourceHealth.stale, false);
  assert.equal(snapshot.sourceHealth.degraded, false);
  assert.equal(snapshot.cacheable, true);
});

test("STA source selection rejects genuinely transient action rows", () => {
  // record.stale (and degraded/refreshing/timeout) marks a genuine failure —
  // those sources are still rejected and surface the degraded/stale banner.
  const snapshot = resolveStableStaActionSnapshot({
    signalOptionsState: {
      stale: true,
      signals: [
        {
          symbol: "NOC",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
      candidates: [
        {
          id: "SIGOPT-paper-NOC-sell-1781201400000",
          symbol: "NOC",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
    },
    cockpit: {
      stale: true,
      signals: [
        {
          symbol: "NOC",
          timeframe: "5m",
          direction: "sell",
          signalAt: "2026-06-11T18:10:00.000Z",
        },
      ],
      candidates: [],
    },
  });

  assert.equal(snapshot.source, "empty");
  assert.equal(snapshot.sourceHealth.stale, true);
  assert.equal(snapshot.sourceHealth.degraded, true);
  assert.deepEqual(snapshot.sourceHealth.failedSources, ["cockpit", "state"]);
  assert.equal(snapshot.signals.length, 0);
  assert.equal(snapshot.candidates.length, 0);
});

test("resolveSignalMove returns the signed percent from signal fire price to current price", () => {
  // currentPrice (live) vs signalPrice (price at fire) -> +5.0%.
  const move = resolveSignalMove({ signalPrice: 500 }, { price: 525 }, null);
  assert.equal(move.pct.toFixed(1), "5.0");
  assert.equal(move.label, "+5.0%");
  assert.equal(move.detail, "+25.00");

  // A drop below the fire price reads negative.
  const down = resolveSignalMove({ signalPrice: 500 }, { price: 480 }, null);
  assert.equal(down.label, "-4.0%");
});

test("resolveSignalMove direction-adjusts the move so a short's favorable drop reads positive", () => {
  // Sell/short signal: a drop below the fire price is FAVORABLE, so Move reads
  // positive — matching the score's / KPI's direction-signed convention.
  const favorable = resolveSignalMove(
    { signalPrice: 500, direction: "sell" },
    { price: 480 },
    null,
  );
  assert.equal(favorable.label, "+4.0%");
  assert.equal(favorable.detail, "+20.00");
  // A rise above the fire price is adverse for a short -> negative.
  const adverse = resolveSignalMove(
    { signalPrice: 500, direction: "sell" },
    { price: 525 },
    null,
  );
  assert.equal(adverse.label, "-5.0%");
  // Buy signals are unchanged (directionSign +1).
  assert.equal(
    resolveSignalMove({ signalPrice: 500, direction: "buy" }, { price: 525 }, null)
      .label,
    "+5.0%",
  );
});

test("resolveSignalMove shows the missing-value placeholder when no fire reference price is available", () => {
  // No signalPrice/entryPrice on the record or candidate, and no sparkline bars
  // covering the fire time, so Move must not fall back to anything else.
  const move = resolveSignalMove({}, { price: 525 }, null);
  assert.equal(move.pct, null);
  assert.equal(move.label, "\u2014");
});

test("resolveSignalDayMove reads the runtime ticker day change percent", () => {
  // The runtime ticker snapshot carries the intraday session move as pct.
  assert.equal(resolveSignalDayMove({ pct: 1.23 }).label, "+1.2%");
  assert.equal(resolveSignalDayMove({ pct: -0.84 }).label, "-0.8%");
  // changePercent is accepted as an equivalent provider field.
  assert.equal(resolveSignalDayMove({ changePercent: 2.5 }).label, "+2.5%");
});

test("resolveSignalDayMove derives the day move from price and prevClose when no percent is provided", () => {
  const dayMove = resolveSignalDayMove({ price: 102, prevClose: 100 });
  assert.equal(dayMove.pct.toFixed(1), "2.0");
  assert.equal(dayMove.label, "+2.0%");
});

test("resolveSignalDayMove returns the missing-value placeholder without day change data", () => {
  assert.equal(resolveSignalDayMove(null).label, "\u2014");
  assert.equal(resolveSignalDayMove({ price: 100 }).label, "\u2014");
});

// --- STA Move: shared current-price source + stale-data marker ---------------
// Regression for the impossible-move-on-stale-row bug: the Move column measured
// "current" against a phantom price the row never displayed (BFST/FIBK +209%),
// and stale rows presented a confident live move during trading hours.

test("Move measures against the SAME current price the row displays (no phantom)", () => {
  // Live quote present: price column and Move share the quote, by construction.
  const signal = { symbol: "AAA", signalPrice: 100 };
  const snapshot = { price: 110 };
  const displayed = resolveDisplayCurrentPrice(signal, snapshot);
  const move = resolveSignalMove(signal, snapshot, null);
  assert.equal(displayed.price, 110);
  // Move's implied current (signalPrice + value) equals the displayed price.
  assert.equal(signal.signalPrice + move.value, displayed.price);
  assert.equal(move.label, "+10.0%");
  assert.equal(move.stale, false);
});

test("Move on a stale bar reconciles with the displayed price and is flagged stale", () => {
  // BFST/FIBK shape: no live quote, only a stale bar close; the Signal Monitor
  // marks the row stale (actionBlocker `data_stale`). Old behavior: price column
  // showed the fire price while Move used the bar -> a phantom +209%. Now both
  // use the bar AND the move is flagged stale via the canonical monitor state.
  const signal = {
    symbol: "BFST",
    signalPrice: 9.31,
    currentPrice: 28.77, // stale last-evaluated bar close
    actionBlocker: "data_stale",
  };
  const displayed = resolveDisplayCurrentPrice(signal, null);
  const move = resolveSignalMove(signal, null, null);
  assert.equal(displayed.source, "bar");
  assert.equal(displayed.price, 28.77);
  // Price column and Move now agree on the current (no divergence).
  assert.ok(
    Math.abs(signal.signalPrice + move.value - displayed.price) < 1e-9,
    "move implied current reconciles with displayed price",
  );
  assert.equal(move.stale, true);
});

test("Move stays blank (not 0%) when only a fire price exists", () => {
  // No live quote, no bar close: the row can only show the fire price, so the
  // Move is unknown rather than a misleading 0%.
  const signal = { symbol: "CCC", signalPrice: 50 };
  const displayed = resolveDisplayCurrentPrice(signal, null);
  const move = resolveSignalMove(signal, null, null);
  assert.equal(displayed.source, "fire");
  assert.equal(displayed.price, 50);
  assert.equal(move.label, "—");
  assert.equal(move.stale, false);
});

test("a 0 quote is not displayed as $0.00 - it falls through to bar/fire/dash", () => {
  // A literal 0 is "no quote", not a price (no live equity trades at $0). The
  // display resolver must ignore it (firstPositivePresentMetric), not surface it
  // as a confident "$0.00", which is the last-price-shows-0 bug.
  const fireOnly = resolveDisplayCurrentPrice(
    { signalPrice: 42 },
    { price: 0, last: 0, mark: 0 },
  );
  assert.equal(fireOnly.source, "fire");
  assert.equal(fireOnly.price, 42);
  assert.equal(fireOnly.live, false);

  // A 0 live quote falls through to a real bar close rather than overriding it.
  const barFallback = resolveDisplayCurrentPrice(
    { currentPrice: 17.5 },
    { price: 0 },
  );
  assert.equal(barFallback.source, "bar");
  assert.equal(barFallback.price, 17.5);

  // Nothing real anywhere -> blank, never $0.00.
  const nothing = resolveDisplayCurrentPrice({}, { price: 0 });
  assert.equal(nothing.price, null);
  assert.equal(nothing.source, null);
});

test("a 0 fire price is treated as no price (firstPositivePresentMetric), not $0.00", () => {
  // The fire tier is positive-only too: a literal 0 signalPrice (a phantom, not a
  // real fire) must resolve to null -> dash, never a confident "$0.00".
  const zeroFire = resolveDisplayCurrentPrice(
    { signalPrice: 0 },
    { price: 0, last: 0, mark: 0 },
  );
  assert.equal(zeroFire.price, null);
  assert.equal(zeroFire.source, null);
});

test("Move from a FRESH matrix bar renders and is not flagged stale", () => {
  // SPY-style fresh matrix row (status ok): legitimate move since fire against a
  // fresh bar -- must render and NOT be flagged stale.
  const signal = {
    symbol: "SPY",
    signalPrice: 500,
    currentPrice: 525,
    status: "ok",
  };
  const move = resolveSignalMove(signal, null, null);
  assert.equal(move.label, "+5.0%");
  assert.equal(move.stale, false);
});

test("Move on a present-but-stale row is flagged stale via monitor state (FFIV shape)", () => {
  // FFIV: the quote value is present (price renders, move computes) but the
  // Signal Monitor marks the row stale -> the giant since-fire move must be
  // flagged, not shown as live. Staleness is the row's monitor state
  // (status stale / actionBlocker data_stale), NOT a quote
  // freshness/cacheAgeMs heuristic.
  const okMove = resolveSignalMove(
    { symbol: "FFIV", signalPrice: 154.56, status: "ok" },
    { price: 381.75 },
    null,
  );
  assert.equal(okMove.label, "+147.0%");
  assert.equal(okMove.stale, false);
  const staleMove = resolveSignalMove(
    { symbol: "FFIV", signalPrice: 154.56, status: "stale" },
    { price: 381.75 },
    null,
  );
  assert.equal(staleMove.label, "+147.0%");
  assert.equal(staleMove.stale, true);
  const blockedMove = resolveSignalMove(
    { symbol: "FFIV", signalPrice: 154.56, actionBlocker: "data_stale" },
    { price: 381.75 },
    null,
  );
  assert.equal(blockedMove.stale, true);
});

test("Move on a market-idle row renders and is not flagged stale", () => {
  const move = resolveSignalMove(
    {
      symbol: "SPY",
      signalPrice: 100,
      currentPrice: 101,
      status: "idle",
      actionBlocker: "market_idle",
    },
    null,
    null,
  );
  assert.equal(move.label, "+1.0%");
  assert.equal(move.stale, false);
});

test("a row with no monitor status is not spuriously flagged stale", () => {
  // Live quote, no status field -> must not be treated as stale (guards against
  // `undefined !== "ok"` over-flagging).
  const move = resolveSignalMove(
    { symbol: "DDD", signalPrice: 100 },
    { price: 110 },
    null,
  );
  assert.equal(move.label, "+10.0%");
  assert.equal(move.stale, false);
});

test("resolveSignalScoreBreakdown drops signal-age scoring and rescales to 0-100", () => {
  // Client-side fallback (no candidate.signalQuality). A fully-aligned,
  // ADX-confirmed, strong-liquidity, risk-sized buy maxes the four remaining
  // components (25+15+20+10 = 70), which rescale to 100.
  const fresh = resolveSignalScoreBreakdown({
    signal: { filterState: { mtfDirections: [1, 1, 1], adx: 30 }, barsSinceSignal: 0 },
    candidate: {
      direction: "buy",
      liquidity: { spreadPctOfMid: 10 },
      orderPlan: { premiumAtRisk: 100 },
    },
  });
  assert.equal(fresh.score, 100);
  assert.equal(fresh.tier, "high");
  // Score no longer carries age (freshness) or quote-liveness (dataQuality).
  assert.equal(fresh.components.freshness, undefined);
  assert.equal(fresh.components.dataQuality, undefined);
  assert.ok(!fresh.reasons.includes("fresh_signal"));
  assert.ok(!fresh.reasons.includes("aging_signal"));
  // The four remaining components sum to the total.
  const sum =
    fresh.components.mtfAlignment +
    fresh.components.trendStrength +
    fresh.components.liquidity +
    fresh.components.riskFit;
  assert.ok(Math.abs(sum - fresh.components.total) < 0.2);

  // Age-independence: an "aged" signal (25 bars old) scores identically.
  const aged = resolveSignalScoreBreakdown({
    signal: { filterState: { mtfDirections: [1, 1, 1], adx: 30 }, barsSinceSignal: 25 },
    candidate: {
      direction: "buy",
      liquidity: { spreadPctOfMid: 10 },
      orderPlan: { premiumAtRisk: 100 },
    },
  });
  assert.equal(aged.score, fresh.score);
});

test("resolveSignalScoreBreakdown uses calibrated expected-move-v2 features before entry quality", () => {
  const baseQuality = {
    score: 95,
    tier: "high",
    liquidityTier: "strong",
    reasons: ["mtf_full_alignment", "adx_confirmed"],
    components: { total: 95 },
  };
  const extended = resolveSignalScoreBreakdown({
    signal: {
      direction: "buy",
      filterState: {
        directionalFeatures: {
          rangePosition20: 0.95,
          mtfAlignment: 3,
          adxComponent: 2,
          volatilityComponent: -0.2,
          shortMomentumPct: 4,
          riskAdjustedMomentum: 3,
          atrPct: 0.9,
          volumeRatio20: 1.8,
        },
      },
    },
    candidate: {
      direction: "buy",
      signalQuality: baseQuality,
    },
  });
  const lessExtended = resolveSignalScoreBreakdown({
    signal: {
      direction: "buy",
      filterState: {
        directionalFeatures: {
          rangePosition20: 0.25,
          mtfAlignment: 0,
          adxComponent: -0.5,
          volatilityComponent: 0.8,
          shortMomentumPct: -1,
          riskAdjustedMomentum: -0.5,
          atrPct: 0.3,
          volumeRatio20: 0.6,
        },
      },
    },
    candidate: {
      direction: "buy",
      signalQuality: baseQuality,
    },
  });

  // expected-move-v2: both vectors' volumeRatio20 (1.8 and 0.6) are below
  // the vspike (>=10) conviction threshold, so conviction=0 and the v2
  // scores match the v1 raw formula exactly.
  // extended (atrPct 0.9, volumeRatio20 1.8 -> strong expected move) with
  // rangePosition 0.95 (reversionTilt=4*(0.5-0.95)=-1.8):
  // volatilityRegime=5*log2(1.5)=2.9, volumeParticipation=3*log2(1.8)=2.5,
  // momentum=0.6*3+0.5*(4/0.9)=4.0 -> 42+2.9+2.5+4.0-1.8=49.7 (standard).
  // Less-extended (atrPct 0.3, volumeRatio20 0.6 -> calm/below-average
  // volume, small expected move) with rangePosition 0.25
  // (reversionTilt=4*0.25=1.0): volatilityRegime=5*log2(0.5)=-5,
  // volumeParticipation=3*log2(0.6)=-2.2, momentum=0.6*-0.5+0.5*(-1/0.3)=-2.0
  // -> 42-5-2.2-2.0+1.0=33.8 (low).
  assert.equal(extended.score, 49.7);
  assert.equal(extended.tier, "standard");
  assert.equal(extended.raw.modelVersion, "expected-move-v2");
  assert.equal(extended.raw.entryQualityScore, 95);
  assert.ok(extended.score > lessExtended.score);
  assert.equal(lessExtended.score, 33.8);
  assert.equal(lessExtended.tier, "low");
  assert.ok(lessExtended.reasons.includes("expected_move_v2"));
  assert.ok(lessExtended.reasons.includes("range_reversion_support"));
  assert.match(lessExtended.label, /^Expected move · /);
});

test("buildVisibleSignalRows lifts indicatorSnapshot.filterState so the score isn't the 46.4 fallback", () => {
  // Live SSE matrix deltas nest the scoring inputs under indicatorSnapshot.filterState
  // (NOT top-level). Before the lift, the row carried no filterState -> the scorer hit
  // its all-defaults value (46.4) on every row.
  const [row] = buildVisibleSignalRows({
    signals: [],
    candidates: [],
    universeSymbols: ["SPY"],
    signalTimeframes: ["5m"],
    signalActionTimeframes: ["5m"],
    signalMatrixStates: [
      {
        profileId: "profile-5m",
        symbol: "SPY",
        timeframe: "5m",
        currentSignalDirection: "buy",
        currentSignalAt: "2026-06-11T16:55:00.000Z",
        currentSignalPrice: 500,
        currentSignalClose: 500,
        latestBarAt: "2026-06-11T17:00:00.000Z",
        latestBarClose: 505,
        barsSinceSignal: 1,
        fresh: true,
        status: "ok",
        actionEligible: true,
        actionBlocker: null,
        indicatorSnapshot: { filterState: { mtfDirections: [1, 1, 1], adx: 30 } },
      },
    ],
  });

  // The lift surfaces mtfDirections/adx onto the row's filterState...
  assert.deepEqual(row.filterState.mtfDirections, [1, 1, 1]);
  assert.equal(row.filterState.adx, 30);
  // ...so the score reflects real inputs (full MTF align + strong ADX) instead of 46.4.
  const breakdown = resolveSignalScoreBreakdown({ signal: row });
  assert.notEqual(breakdown.score, 46.4);
  assert.ok(breakdown.score > 46.4);
});

test("resolveSignalScoreBreakdown returns null score (not the 46.4 fallback) when there are no real inputs", () => {
  // No backend signalQuality and no filterState (mtfDirections/adx) / liquidity / premium:
  // the score must NOT show the misleading all-defaults 46.4 — it surfaces "no data".
  const breakdown = resolveSignalScoreBreakdown({
    signal: { symbol: "AGZ", timeframe: "15m", direction: "buy" },
  });
  assert.equal(breakdown.score, null);
  assert.equal(breakdown.tier, "unknown");
  assert.deepEqual(breakdown.reasonLabels, []);

  // But a row WITH a real input still computes a real score (no false "no data").
  const scored = resolveSignalScoreBreakdown({
    signal: { filterState: { mtfDirections: [1, 1, 1], adx: 30 }, direction: "buy" },
  });
  assert.ok(Number.isFinite(scored.score));
});

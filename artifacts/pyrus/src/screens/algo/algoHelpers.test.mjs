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

test("Signal action labels stay long-options only", () => {
  assert.equal(signalActionLabel({ direction: "buy" }, null), "BUY CALL");
  assert.equal(signalActionLabel({ direction: "sell" }, null), "BUY PUT");
  assert.equal(
    signalActionLabel(null, {
      signalDirection: "sell",
      optionAction: "buy_put",
      orderSide: "buy",
      orderIntent: "open_long_option",
    }),
    "BUY PUT",
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
  // flagged, not shown as live. Staleness is the row's monitor state (codex's
  // canonical signal: status !== "ok" / actionBlocker data_stale), NOT a quote
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

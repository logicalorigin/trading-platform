import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignalsRows,
  buildSignalMatrixStatesBySymbol,
  hydrateSignalMatrixProfileTimeframe,
  resolveConfiguredMtfAlignment,
  resolveSignalMatrixVerdict,
  sortSignalsRows,
} from "./signalsRowModel.js";

const ms = (iso) => new Date(iso).getTime();

const row = (symbol, universeRank) => ({
  symbol,
  universeRank,
  statusWeight: 0,
  direction: "",
  activityMs: 0,
});

test("Signals rows sort by universe rank", () => {
  const rows = [
    row("MSFT", 3),
    row("AAPL", 1),
    row("NVDA", 2),
  ];

  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "rank", direction: "asc" }).map(
      (item) => item.symbol,
    ),
    ["AAPL", "NVDA", "MSFT"],
  );
  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "rank", direction: "desc" }).map(
      (item) => item.symbol,
    ),
    ["MSFT", "NVDA", "AAPL"],
  );
});

test("recency ordering ranks by signal-fire time, not bar/eval activity", () => {
  // SPY: stale 5m signal (17:25) but constantly-ticking bars -> high activityMs.
  // AES: fresh signal (20:20) with a slightly older latest bar.
  const spy = {
    symbol: "SPY",
    universeRank: 1,
    statusWeight: 0,
    direction: "buy",
    activityMs: ms("2026-06-11T20:40:00.000Z"),
    signalActivityMs: ms("2026-06-11T17:25:00.000Z"),
  };
  const aes = {
    symbol: "AES",
    universeRank: 2,
    statusWeight: 0,
    direction: "buy",
    activityMs: ms("2026-06-11T20:39:00.000Z"),
    signalActivityMs: ms("2026-06-11T20:20:00.000Z"),
  };
  // "Latest" sort: the fresher signal wins despite SPY's newer bar activity.
  assert.deepEqual(
    sortSignalsRows([spy, aes], { sortKey: "latest" }).map((item) => item.symbol),
    ["AES", "SPY"],
  );
  // Default priority sort tiebreaker (same status + direction) also uses signal time.
  assert.deepEqual(
    sortSignalsRows([spy, aes], { sortKey: "priority" }).map((item) => item.symbol),
    ["AES", "SPY"],
  );
});

test("Signals rows sort by the displayed profile signal, not hidden interval activity", () => {
  const rows = buildSignalsRows({
    stateResponse: {
      profile: { timeframe: "5m" },
      universeSymbols: ["LHX", "CEG"],
      states: [
        {
          symbol: "LHX",
          timeframe: "5m",
          status: "ok",
          active: true,
          fresh: false,
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-10T23:55:00.000Z",
          latestBarAt: "2026-06-12T16:40:00.000Z",
          lastEvaluatedAt: "2026-06-12T16:40:00.000Z",
        },
        {
          symbol: "LHX",
          timeframe: "1m",
          status: "ok",
          active: true,
          fresh: true,
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-12T16:39:00.000Z",
          latestBarAt: "2026-06-12T16:40:00.000Z",
          lastEvaluatedAt: "2026-06-12T16:40:00.000Z",
        },
        {
          symbol: "CEG",
          timeframe: "5m",
          status: "ok",
          active: true,
          fresh: false,
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-12T16:25:00.000Z",
          latestBarAt: "2026-06-12T16:40:00.000Z",
          lastEvaluatedAt: "2026-06-12T16:40:00.000Z",
        },
      ],
    },
  });

  assert.deepEqual(rows.map((item) => item.symbol), ["CEG", "LHX"]);
  assert.equal(rows[1].currentSignalAt, "2026-06-10T23:55:00.000Z");
  assert.equal(rows[1].signalActivityMs, ms("2026-06-10T23:55:00.000Z"));
});

const directionTrend = (direction) =>
  direction === "buy" ? "bullish" : direction === "sell" ? "bearish" : null;

// Real matrix cells carry both a crossover (currentSignalDirection) and a live
// trendDirection. The verdict and MTF gate judge by the crossover signal (the
// source the backend entry gate trades on); the fixture carries both so a
// crossover/trend divergence can be modeled.
const matrixState = (timeframe, direction) => ({
  symbol: "MU",
  timeframe,
  status: "ok",
  active: true,
  fresh: true,
  currentSignalDirection: direction,
  trendDirection: directionTrend(direction),
  currentSignalAt: "2026-06-08T19:00:00.000Z",
  latestBarAt: "2026-06-08T19:10:00.000Z",
});

// The gate reads the cell's per-timeframe crossover (currentSignalDirection),
// mirroring the backend entry gate. `direction` sets the crossover; `trend` can
// be overridden to model a divergence between the crossover and the live trend
// (which the gate intentionally ignores — the basisLength=80 trend lags fine TFs
// and never confirms shorts).
const mtfState = (timeframe, direction, status = "ok", trend = direction) => ({
  symbol: "SPY",
  timeframe,
  status,
  active: true,
  fresh: status === "ok",
  currentSignalDirection: direction,
  trendDirection: directionTrend(trend),
  currentSignalAt: "2026-06-08T19:00:00.000Z",
  latestBarAt: "2026-06-08T19:10:00.000Z",
});

test("MTF alignment reproduces the reported bug: stale-opposing 5m blocks even though the legacy verdict reads Buy", () => {
  // The reported case: 1m/2m buy, 5m latched SELL but stale. The legacy weighted
  // verdict DROPS the stale frame, so it reads "buy" while the 5m sell bubble is
  // still shown -> the row looks aligned. That is the exact divergence.
  const matrixStatesByTimeframe = {
    "1m": mtfState("1m", "buy"),
    "2m": mtfState("2m", "buy"),
    "5m": mtfState("5m", "sell", "stale"),
  };

  const legacyVerdict = resolveSignalMatrixVerdict({
    matrixStatesByTimeframe,
    profileTimeframe: "1m",
    timeframes: ["1m", "2m", "5m"],
    includePrimaryFallback: false,
  });
  assert.equal(legacyVerdict.direction, "buy");

  // The gate mirror counts the stale 5m sell as disagreement -> not aligned.
  const alignment = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe,
    signalDirection: "buy",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 3,
  });
  assert.equal(alignment.applicable, true);
  assert.equal(alignment.aligned, false);
  assert.equal(alignment.matches, 2);
  assert.equal(alignment.required, 3);
  assert.deepEqual(alignment.opposingTimeframes, ["5m"]);
});

test("MTF alignment rejects partial agreement despite a stale lower requiredCount", () => {
  const alignment = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe: {
      "1m": mtfState("1m", "buy"),
      "2m": mtfState("2m", "buy"),
      "5m": mtfState("5m", "sell"),
    },
    signalDirection: "buy",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 2,
  });
  assert.equal(alignment.aligned, false);
  assert.equal(alignment.matches, 2);
  assert.equal(alignment.required, 3);
});

test("MTF alignment counts a stale opposing frame as disagreement (bubble is shown)", () => {
  const alignment = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe: {
      "1m": mtfState("1m", "buy"),
      "2m": mtfState("2m", "buy"),
      "5m": mtfState("5m", "sell", "stale"),
    },
    signalDirection: "buy",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 3,
  });
  assert.equal(alignment.aligned, false);
  assert.equal(alignment.opposing, 1);
  assert.deepEqual(alignment.opposingTimeframes, ["5m"]);
});

test("MTF alignment is not applicable when the gate is disabled or unconfigured", () => {
  assert.equal(
    resolveConfiguredMtfAlignment({
      matrixStatesByTimeframe: { "5m": mtfState("5m", "sell") },
      signalDirection: "buy",
      timeframes: ["1m", "2m", "5m"],
      requiredCount: 3,
      enabled: false,
    }).applicable,
    false,
  );
  assert.equal(
    resolveConfiguredMtfAlignment({
      signalDirection: "buy",
      timeframes: [],
      requiredCount: 2,
    }).aligned,
    true,
  );
});

test("MTF alignment does NOT align on a neutral crossover even when the live trend confirms", () => {
  // The gate follows the per-timeframe crossover, not the trend. The crossover is
  // neutral/absent on every frame (only the lagging trend confirms buy), so there
  // is no signal confluence -> not aligned. Trend-following is intentionally not
  // used: the basisLength=80 trend lags fine TFs and never confirms shorts.
  const matrixStatesByTimeframe = {
    "1m": mtfState("1m", null, "stale", "buy"),
    "2m": mtfState("2m", null, "ok", "buy"),
    "5m": mtfState("5m", null, "stale", "buy"),
  };
  const alignment = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe,
    signalDirection: "buy",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 3,
  });
  assert.equal(alignment.applicable, true);
  assert.equal(alignment.aligned, false);
  assert.equal(alignment.matches, 0);
  assert.equal(alignment.neutral, 3);
});

test("MTF alignment aligns on crossover agreement even when the live trend diverges", () => {
  // Crossover reads buy on all three frames; the 5m trend has flipped bearish.
  // The gate follows the crossover, so the row aligns — the divergent (lagging)
  // trend does not block.
  const matrixStatesByTimeframe = {
    "1m": mtfState("1m", "buy"),
    "2m": mtfState("2m", "buy"),
    "5m": mtfState("5m", "buy", "ok", "sell"),
  };
  const alignment = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe,
    signalDirection: "buy",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 3,
  });
  assert.equal(alignment.aligned, true);
  assert.equal(alignment.matches, 3);
  assert.equal(alignment.opposing, 0);
});

test("MTF alignment treats a null crossover frame as neutral", () => {
  // No crossover on 5m -> neutral, counts against full confluence (the 5m trend
  // is irrelevant to the gate).
  const matrixStatesByTimeframe = {
    "1m": mtfState("1m", "buy"),
    "2m": mtfState("2m", "buy"),
    "5m": mtfState("5m", null, "ok", "buy"),
  };
  const alignment = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe,
    signalDirection: "buy",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 3,
  });
  assert.equal(alignment.aligned, false);
  assert.equal(alignment.matches, 2);
  assert.equal(alignment.neutral, 1);
  assert.equal(alignment.opposing, 0);
});

test("MTF alignment surfaces a short when the crossover is sell on every frame despite a seed-bullish trend (zero-sells regression guard)", () => {
  // The zero-sells bug: the fine-TF trend seeds bullish, so a real sell crossover
  // on a decliner was judged opposing and dropped. The gate now follows the
  // crossover, so a 3-frame sell confluence aligns for a put even though every
  // frame's trend reads bullish.
  const matrixStatesByTimeframe = {
    "1m": mtfState("1m", "sell", "ok", "buy"),
    "2m": mtfState("2m", "sell", "ok", "buy"),
    "5m": mtfState("5m", "sell", "ok", "buy"),
  };
  const alignment = resolveConfiguredMtfAlignment({
    matrixStatesByTimeframe,
    signalDirection: "sell",
    timeframes: ["1m", "2m", "5m"],
    requiredCount: 3,
  });
  assert.equal(alignment.applicable, true);
  assert.equal(alignment.aligned, true);
  assert.equal(alignment.matches, 3);
});

test("Signal matrix verdict ignores hidden non-trading timeframes", () => {
  const matrixStatesByTimeframe = {
    "2m": matrixState("2m", "buy"),
    "5m": matrixState("5m", "buy"),
    "15m": matrixState("15m", "buy"),
    "1h": matrixState("1h", "sell"),
    "1d": matrixState("1d", "sell"),
  };

  const selectedVerdict = resolveSignalMatrixVerdict({
    matrixStatesByTimeframe,
    profileTimeframe: "5m",
    timeframes: ["2m", "5m", "15m"],
  });

  assert.equal(selectedVerdict.direction, "buy");
  assert.equal(selectedVerdict.regime, "bull_trend");
  assert.equal(selectedVerdict.tradeReadiness, "ready");
  assert.equal(selectedVerdict.alignmentScore, 100);
});

test("Signal matrix strict mode does not backfill execution bubble from primary signal", () => {
  const primaryState = {
    symbol: "BLDR",
    timeframe: "5m",
    status: "ok",
    active: true,
    fresh: true,
    currentSignalDirection: "buy",
    currentSignalAt: "2026-06-08T19:50:33.889Z",
    latestBarAt: "2026-06-08T19:50:33.889Z",
  };

  assert.equal(
    hydrateSignalMatrixProfileTimeframe({
      matrixStatesByTimeframe: {},
      primaryState,
      profileTimeframe: "5m",
      includePrimaryFallback: false,
    })["5m"],
    undefined,
  );

  const verdict = resolveSignalMatrixVerdict({
    matrixStatesByTimeframe: {},
    primaryState,
    profileTimeframe: "5m",
    timeframes: ["2m", "5m", "15m"],
    includePrimaryFallback: false,
  });

  assert.equal(verdict.reasonCodes.includes("insufficient_matrix_data"), true);
  assert.equal(verdict.direction, null);
});

test("Signal matrix state index keeps received signal over newer no-signal state", () => {
  const bySymbol = buildSignalMatrixStatesBySymbol([
    {
      symbol: "TSLA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-08T12:00:00.000Z",
      latestBarAt: "2026-06-08T12:00:00.000Z",
      fresh: true,
    },
    {
      symbol: "TSLA",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: null,
      currentSignalAt: null,
      latestBarAt: "2026-06-08T13:00:00.000Z",
      lastEvaluatedAt: "2026-06-08T13:00:00.000Z",
      fresh: false,
    },
  ]);

  assert.equal(bySymbol.get("TSLA")["5m"].currentSignalDirection, "buy");
  assert.equal(
    bySymbol.get("TSLA")["5m"].currentSignalAt,
    "2026-06-08T12:00:00.000Z",
  );
  // The directional copy wins wholesale: bar metadata is never merged in from
  // a directionless copy (that merging is what fabricated impossible
  // age/bar combinations); the next backend delta advances it.
  assert.equal(
    bySymbol.get("TSLA")["5m"].latestBarAt,
    "2026-06-08T12:00:00.000Z",
  );
});

test("Signal matrix state index ranks directional cells by signal-fire time", () => {
  const bySymbol = buildSignalMatrixStatesBySymbol([
    {
      symbol: "CEG",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "sell",
      currentSignalAt: "2026-06-12T15:55:00.000Z",
      latestBarAt: "2026-06-12T16:35:00.000Z",
      lastEvaluatedAt: "2026-06-12T16:37:00.000Z",
      fresh: false,
    },
    {
      symbol: "CEG",
      timeframe: "5m",
      status: "ok",
      currentSignalDirection: "buy",
      currentSignalAt: "2026-06-12T16:25:00.000Z",
      latestBarAt: "2026-06-12T16:25:00.000Z",
      lastEvaluatedAt: "2026-06-12T16:25:05.000Z",
      fresh: true,
    },
  ]);

  assert.equal(bySymbol.get("CEG")["5m"].currentSignalDirection, "buy");
  assert.equal(
    bySymbol.get("CEG")["5m"].currentSignalAt,
    "2026-06-12T16:25:00.000Z",
  );
});

test("market-idle signal rows keep last-known direction without stale labeling", () => {
  const rows = buildSignalsRows({
    stateResponse: {
      profile: { timeframe: "5m" },
      universeSymbols: ["SPY"],
      states: [
        {
          symbol: "SPY",
          timeframe: "5m",
          status: "idle",
          active: true,
          fresh: false,
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-08T19:55:00.000Z",
          currentSignalPrice: 510.25,
          currentSignalClose: 510.1,
          latestBarAt: "2026-06-08T20:00:00.000Z",
          latestBarClose: 510.7,
          barsSinceSignal: 1,
          actionBlocker: "market_idle",
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "active-idle");
  assert.equal(rows[0].statusLabel, "Market idle");
  assert.match(rows[0].coverageReason, /No recent market print/);
  assert.equal(rows[0].direction, "buy");
  assert.equal(rows[0].currentSignalClose, 510.1);
  assert.equal(rows[0].barsSinceSignal, 1);
});

test("trend age display falls back to signal bars with a source flag and matching sort", () => {
  const rows = buildSignalsRows({
    stateResponse: {
      profile: { timeframe: "5m" },
      universeSymbols: ["TREND", "FALLBACK", "MISSING"],
      states: [
        {
          symbol: "TREND",
          timeframe: "5m",
          status: "ok",
          active: true,
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-12T16:00:00.000Z",
          latestBarAt: "2026-06-12T16:20:00.000Z",
          barsSinceSignal: 8,
          indicatorSnapshot: {
            trendDirection: "bullish",
            trendAgeBars: 4,
          },
        },
        {
          symbol: "FALLBACK",
          timeframe: "5m",
          status: "ok",
          active: true,
          currentSignalDirection: "buy",
          currentSignalAt: "2026-06-12T16:10:00.000Z",
          latestBarAt: "2026-06-12T16:20:00.000Z",
          barsSinceSignal: 2,
          indicatorSnapshot: {
            trendDirection: "bullish",
            trendAgeBars: null,
          },
        },
        {
          symbol: "MISSING",
          timeframe: "5m",
          status: "ok",
          active: true,
          latestBarAt: "2026-06-12T16:20:00.000Z",
          indicatorSnapshot: {
            trendDirection: "bullish",
            trendAgeBars: null,
          },
        },
      ],
    },
  });
  const bySymbol = new Map(rows.map((item) => [item.symbol, item]));

  assert.equal(bySymbol.get("TREND").dashboardSummary.displayAgeBars, 4);
  assert.equal(bySymbol.get("TREND").dashboardSummary.displayAgeSource, "trend-age");
  assert.equal(bySymbol.get("FALLBACK").dashboardSummary.displayAgeBars, 2);
  assert.equal(bySymbol.get("FALLBACK").dashboardSummary.displayAgeSource, "signal-bars");
  assert.equal(bySymbol.get("MISSING").dashboardSummary.displayAgeBars, null);
  assert.equal(bySymbol.get("MISSING").dashboardSummary.displayAgeSource, null);
  assert.deepEqual(
    sortSignalsRows(rows, { sortKey: "age" }).map((item) => item.symbol),
    ["FALLBACK", "TREND", "MISSING"],
  );
});

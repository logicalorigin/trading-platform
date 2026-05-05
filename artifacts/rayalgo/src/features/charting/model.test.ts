import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildResearchChartModel } from "./model";
import {
  getChartBarLimit,
  getChartBrokerRecentWindowMinutes,
  getMaxChartBarLimit,
  getChartTimeframeStepMs,
  getChartTimeframeOptions,
  resolveChartTimeframeFavorites,
  toggleChartTimeframeFavorite,
} from "./timeframes";
import {
  expandLocalRollupLimit,
  resolveLocalRollupBaseTimeframe,
  rollupMarketBars,
} from "./timeframeRollups";
import { resolveSpotChartFrameLayout } from "./spotChartFrameLayout";
import {
  DISPLAY_CHART_PRICE_TIMEFRAME,
  resolveDisplayChartOutsideRth,
  resolveDisplayChartPrice,
} from "./displayChartSession";

const buildSequentialBars = (count: number) => {
  const start = Date.parse("2026-04-25T13:30:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(start + index * 1000).toISOString(),
    open: 100 + index * 0.01,
    high: 101 + index * 0.01,
    low: 99 + index * 0.01,
    close: 100.5 + index * 0.01,
    volume: 1000 + index,
  }));
};

test("buildResearchChartModel sorts bars and collapses duplicate chart times", () => {
  const model = buildResearchChartModel({
    timeframe: "1m",
    bars: [
      {
        timestamp: "2026-04-25T21:41:02.200Z",
        open: 102,
        high: 103,
        low: 101,
        close: 102,
        volume: 20,
      },
      {
        timestamp: "2026-04-25T21:41:01.100Z",
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 10,
      },
      {
        timestamp: "2026-04-25T21:41:01.900Z",
        open: 101,
        high: 102,
        low: 100,
        close: 101,
        volume: 15,
      },
    ],
  });

  assert.deepEqual(
    model.chartBars.map((bar) => bar.time),
    [1777153261, 1777153262],
  );
  assert.equal(model.chartBars[0].c, 101);
  assert.equal(model.chartBars[1].c, 102);
});

test("buildResearchChartModel uses explicit target visible range counts", () => {
  [
    { timeframe: "1m", role: "primary", expectedVisibleBars: 1_800 },
    { timeframe: "5s", role: "mini", expectedVisibleBars: 360 },
    { timeframe: "5s", role: "option", expectedVisibleBars: 600 },
  ].forEach(({ timeframe, role, expectedVisibleBars }) => {
    const defaultVisibleBarCount = getChartBarLimit(timeframe, role);
    const model = buildResearchChartModel({
      timeframe,
      defaultVisibleBarCount,
      bars: buildSequentialBars(2_500),
    });

    assert.equal(defaultVisibleBarCount, expectedVisibleBars);
    assert.deepEqual(model.defaultVisibleLogicalRange, {
      from: 2_500 - expectedVisibleBars,
      to: 2_499,
    });
  });
});

test("buildResearchChartModel shows all loaded bars when target exceeds loaded bars", () => {
  const model = buildResearchChartModel({
    timeframe: "5s",
    defaultVisibleBarCount: getChartBarLimit("5s", "option"),
    bars: buildSequentialBars(120),
  });

  assert.deepEqual(model.defaultVisibleLogicalRange, {
    from: 0,
    to: 119,
  });
});

test("buildResearchChartModel resets default range target across interval switches", () => {
  const bars = buildSequentialBars(2_500);
  const fiveSecondModel = buildResearchChartModel({
    timeframe: "5s",
    defaultVisibleBarCount: getChartBarLimit("5s", "mini"),
    bars,
  });
  const oneMinuteModel = buildResearchChartModel({
    timeframe: "1m",
    defaultVisibleBarCount: getChartBarLimit("1m", "primary"),
    bars,
  });

  assert.deepEqual(fiveSecondModel.defaultVisibleLogicalRange, {
    from: 2_140,
    to: 2_499,
  });
  assert.deepEqual(oneMinuteModel.defaultVisibleLogicalRange, {
    from: 700,
    to: 2_499,
  });
});

test("chart timeframe registry exposes 5s as the seconds floor", () => {
  assert.deepEqual(
    getChartTimeframeOptions("primary").map((option) => option.value),
    ["5s", "15s", "30s", "1m", "2m", "5m", "15m", "30m", "1h", "4h", "1d"],
  );
  assert.deepEqual(
    getChartTimeframeOptions("option").map((option) => option.value),
    ["5s", "15s", "30s", "1m", "2m", "5m", "15m", "30m", "1h", "4h", "1d"],
  );
});

test("chart timeframe favorites sanitize by role and keep TradingView-style defaults", () => {
  assert.deepEqual(resolveChartTimeframeFavorites(null, "primary"), [
    "5s",
    "1m",
    "5m",
    "15m",
    "1h",
    "1d",
  ]);
  assert.deepEqual(
    resolveChartTimeframeFavorites(["1s", "1m", "1m", "bad"], "option"),
    ["1m"],
  );
  assert.deepEqual(
    toggleChartTimeframeFavorite(["1m", "15m"], "5m", "primary"),
    ["1m", "5m", "15m"],
  );
  assert.deepEqual(
    toggleChartTimeframeFavorite(["1m", "15m"], "1m", "primary"),
    ["15m"],
  );
});

test("spot chart frame layout keeps market and trade chart spacing aligned", () => {
  assert.deepEqual(resolveSpotChartFrameLayout(false), {
    surfaceTopOverlayHeight: 40,
    surfaceLeftOverlayWidth: 40,
    surfaceBottomOverlayHeight: 22,
  });
  assert.deepEqual(resolveSpotChartFrameLayout(true), {
    surfaceTopOverlayHeight: 28,
    surfaceLeftOverlayWidth: 28,
    surfaceBottomOverlayHeight: 16,
  });
});

test("derived chart intervals resolve to provider-safe base timeframes", () => {
  [
    ["5s", "5s"],
    ["15s", "5s"],
    ["30s", "5s"],
    ["1m", "1m"],
    ["2m", "1m"],
    ["5m", "5m"],
    ["15m", "15m"],
    ["30m", "15m"],
    ["1h", "1h"],
    ["4h", "1h"],
    ["1d", "1d"],
  ].forEach(([timeframe, expectedBase]) => {
    assert.equal(
      resolveLocalRollupBaseTimeframe(timeframe, 900, "primary"),
      expectedBase,
      timeframe,
    );
  });
});

test("display chart session policy is stable across intervals", () => {
  assert.equal(DISPLAY_CHART_PRICE_TIMEFRAME, "1m");
  ["1m", "5m", "15m", "1h", "1d"].forEach((timeframe) => {
    assert.equal(resolveDisplayChartOutsideRth(timeframe), true);
  });
});

test("platform display chart requests do not branch outsideRth by interval", () => {
  const platformSource = readFileSync(
    new URL("../platform/PlatformApp.jsx", import.meta.url),
    "utf8",
  );

  assert.equal(
    /outsideRth:\s*(normalizedTimeframe|rollupBaseTimeframe|favoriteTimeframe|favoriteBaseTimeframe)\s*!==\s*["']1d["']/.test(
      platformSource,
    ),
    false,
  );
});

test("display chart price prefers quote then canonical fallback before interval close", () => {
  const canonicalBars = [
    {
      timestamp: "2026-04-25T20:00:00.000Z",
      c: 111,
    },
  ];
  const dailyBars = [
    {
      timestamp: "2026-04-25T00:00:00.000Z",
      c: 105,
    },
  ];

  assert.equal(
    resolveDisplayChartPrice({
      quotePrice: 112,
      canonicalBars,
      renderedBars: dailyBars,
    }),
    112,
  );
  assert.equal(
    resolveDisplayChartPrice({
      canonicalBars,
      renderedBars: dailyBars,
    }),
    111,
  );
  assert.equal(
    resolveDisplayChartPrice({
      renderedBars: dailyBars,
    }),
    105,
  );
});

test("seconds rollup limits stay under the 5s base cap", () => {
  assert.ok(
    expandLocalRollupLimit(
      getMaxChartBarLimit("15s", "primary"),
      "15s",
      "5s",
    ) <= getMaxChartBarLimit("5s", "primary"),
  );
  assert.ok(
    expandLocalRollupLimit(
      getMaxChartBarLimit("30s", "option"),
      "30s",
      "5s",
    ) <= getMaxChartBarLimit("5s", "option"),
  );
});

test("chart broker recent windows stay bounded to the live edge", () => {
  for (const role of ["mini", "primary"] as const) {
    for (const { value: timeframe } of getChartTimeframeOptions(role)) {
      const targetLimit = getChartBarLimit(timeframe, role);
      const baseTimeframe = resolveLocalRollupBaseTimeframe(
        timeframe,
        targetLimit,
        role,
      );
      const baseLimit = expandLocalRollupLimit(
        targetLimit,
        timeframe,
        baseTimeframe,
      );
      const windowMinutes = getChartBrokerRecentWindowMinutes(
        baseTimeframe,
        baseLimit,
      );
      const horizonMinutes = Math.ceil(
        (getChartTimeframeStepMs(baseTimeframe) * (baseLimit + 2)) / 60_000,
      );

      assert.ok(
        windowMinutes && windowMinutes >= 1,
        `${role} ${timeframe} charts should request a broker live-edge window`,
      );
      assert.ok(
        windowMinutes <= horizonMinutes,
        `${role} ${timeframe} charts should not request more broker history than the visible horizon`,
      );
      if (horizonMinutes > 240) {
        assert.ok(
          windowMinutes < horizonMinutes,
          `${role} ${timeframe} charts should keep older hydration on the historical provider/cache path`,
        );
      }
    }
  }

  assert.equal(getChartBrokerRecentWindowMinutes("5s", 900), 60);
  assert.equal(getChartBrokerRecentWindowMinutes("5m", 900), 240);
  assert.equal(getChartBrokerRecentWindowMinutes("5m", 2), 20);
});

test("rollupMarketBars builds derived candles from base bars", () => {
  const bars = [
    {
      timestamp: "2026-04-25T14:30:00.000Z",
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 10,
    },
    {
      timestamp: "2026-04-25T14:31:00.000Z",
      open: 101,
      high: 104,
      low: 100,
      close: 103,
      volume: 20,
    },
  ];

  const rolled = rollupMarketBars(bars, "1m", "2m");

  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].open, 100);
  assert.equal(rolled[0].high, 104);
  assert.equal(rolled[0].low, 99);
  assert.equal(rolled[0].close, 103);
  assert.equal(rolled[0].volume, 30);
});

test("rollupMarketBars aligns all derived chart interval buckets", () => {
  const cases = [
    { source: "5s", target: "15s", first: "2026-04-25T14:30:05.000Z", count: 5, stepMs: 5_000, expected: ["2026-04-25T14:30:00.000Z", "2026-04-25T14:30:15.000Z"] },
    { source: "5s", target: "30s", first: "2026-04-25T14:30:05.000Z", count: 8, stepMs: 5_000, expected: ["2026-04-25T14:30:00.000Z", "2026-04-25T14:30:30.000Z"] },
    { source: "1m", target: "2m", first: "2026-04-25T14:31:00.000Z", count: 4, stepMs: 60_000, expected: ["2026-04-25T14:30:00.000Z", "2026-04-25T14:32:00.000Z", "2026-04-25T14:34:00.000Z"] },
    { source: "15m", target: "30m", first: "2026-04-25T14:45:00.000Z", count: 4, stepMs: 15 * 60_000, expected: ["2026-04-25T14:30:00.000Z", "2026-04-25T15:00:00.000Z", "2026-04-25T15:30:00.000Z"] },
    { source: "1h", target: "4h", first: "2026-04-25T15:00:00.000Z", count: 5, stepMs: 60 * 60_000, expected: ["2026-04-25T12:00:00.000Z", "2026-04-25T16:00:00.000Z"] },
  ];

  cases.forEach(({ source, target, first, count, stepMs, expected }) => {
    const start = Date.parse(first);
    const bars = Array.from({ length: count }, (_, index) => ({
      timestamp: new Date(start + index * stepMs).toISOString(),
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 10,
    }));

    assert.deepEqual(
      rollupMarketBars(bars, source, target).map((bar) =>
        new Date(bar.timestamp).toISOString(),
      ),
      expected,
      target,
    );
  });
});

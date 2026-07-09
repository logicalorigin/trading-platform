import assert from "node:assert/strict";
import test from "node:test";

import type { BacktestBar } from "@workspace/backtest-core";

import {
  addOvernightSamplesToStats,
  buildCanonicalOvernightReturnMap,
  createOvernightStatsAccumulator,
  filterRegularTradingHoursBars,
  isRegularTradingHoursBar,
  listNyseRthSessions,
  rollupBarsForSignalTimeframe,
  sampleOvernightSignalState,
  summarizeOvernightExpectancy,
  type OvernightRthSession,
  type OvernightSignalSample,
  type OvernightSignalTimeframe,
} from "./overnight-signal-expectancy";

const bar = (
  iso: string,
  open: number,
  close = open,
  high = Math.max(open, close),
  low = Math.min(open, close),
): BacktestBar => ({
  startsAt: new Date(iso),
  open,
  high,
  low,
  close,
  volume: 1000,
});

test("RTH filtering uses interval end and rejects the 16:00 bar", () => {
  assert.equal(
    isRegularTradingHoursBar("15m", bar("2026-07-06T19:45:00.000Z", 100)),
    true,
  );
  assert.equal(
    isRegularTradingHoursBar("15m", bar("2026-07-06T20:00:00.000Z", 100)),
    false,
  );
  assert.deepEqual(
    filterRegularTradingHoursBars("15m", [
      bar("2026-07-06T20:00:00.000Z", 101),
      bar("2026-07-06T19:45:00.000Z", 100),
    ]).map((value) => value.startsAt.toISOString()),
    ["2026-07-06T19:45:00.000Z"],
  );
});

test("RTH filtering honors early close and DST-shifted opens", () => {
  // Day after Thanksgiving 2025 closes at 13:00 ET = 18:00Z.
  assert.equal(
    isRegularTradingHoursBar("15m", bar("2025-11-28T17:45:00.000Z", 100)),
    true,
  );
  assert.equal(
    isRegularTradingHoursBar("15m", bar("2025-11-28T18:00:00.000Z", 100)),
    false,
  );

  // Before US DST starts: 09:30 ET = 14:30Z. After: 09:30 ET = 13:30Z.
  assert.equal(
    isRegularTradingHoursBar("15m", bar("2026-03-06T14:30:00.000Z", 100)),
    true,
  );
  assert.equal(
    isRegularTradingHoursBar("15m", bar("2026-03-09T13:30:00.000Z", 100)),
    true,
  );
  assert.equal(
    isRegularTradingHoursBar("15m", bar("2026-03-06T13:30:00.000Z", 100)),
    false,
  );
});

test("30m and 4h rollups match chart bucket starts and OHLCV aggregation", () => {
  const rolled30m = rollupBarsForSignalTimeframe(
    [
      bar("2026-07-06T13:30:00.000Z", 100, 101, 102, 99),
      bar("2026-07-06T13:45:00.000Z", 101, 103, 104, 100),
    ],
    "15m",
    "30m",
  );
  assert.equal(rolled30m.length, 1);
  assert.equal(rolled30m[0]!.startsAt.toISOString(), "2026-07-06T13:30:00.000Z");
  assert.equal(rolled30m[0]!.open, 100);
  assert.equal(rolled30m[0]!.high, 104);
  assert.equal(rolled30m[0]!.low, 99);
  assert.equal(rolled30m[0]!.close, 103);
  assert.equal(rolled30m[0]!.volume, 2000);

  const rolled4h = rollupBarsForSignalTimeframe(
    [
      bar("2026-07-06T13:30:00.000Z", 100, 101),
      bar("2026-07-06T14:30:00.000Z", 101, 102),
    ],
    "1h",
    "4h",
  );
  assert.equal(rolled4h.length, 1);
  assert.equal(rolled4h[0]!.startsAt.toISOString(), "2026-07-06T12:00:00.000Z");
  assert.equal(rolled4h[0]!.open, 100);
  assert.equal(rolled4h[0]!.close, 102);
});

test("canonical overnight returns use 15m close to next 15m open", () => {
  const sessions = listNyseRthSessions({
    from: new Date("2026-07-06T00:00:00.000Z"),
    to: new Date("2026-07-06T23:59:59.000Z"),
  });
  const returns = buildCanonicalOvernightReturnMap({
    sessions,
    canonical15mBars: [
      bar("2026-07-06T19:45:00.000Z", 99, 100),
      bar("2026-07-07T13:30:00.000Z", 102, 102),
      // A 16:00-start bar must not be considered the close.
      bar("2026-07-06T20:00:00.000Z", 100, 200),
    ],
  });
  const sample = returns.get("2026-07-06");
  assert.ok(sample);
  assert.equal(sample.entryAt.toISOString(), "2026-07-06T20:00:00.000Z");
  assert.equal(sample.entryPrice, 100);
  assert.equal(sample.exitAt.toISOString(), "2026-07-07T13:30:00.000Z");
  assert.equal(sample.exitPrice, 102);
  assert.equal(sample.returnPct, 2);
});

test("sampled close state applies signal availability shift and avoids lookahead", () => {
  const session: OvernightRthSession = {
    date: "2026-07-06",
    regularOpenAt: new Date("2026-07-06T13:30:00.000Z"),
    regularCloseAt: new Date("2026-07-06T20:00:00.000Z"),
    earlyClose: false,
    nextDate: "2026-07-07",
    nextRegularOpenAt: new Date("2026-07-07T13:30:00.000Z"),
  };
  const bars = Array.from({ length: 1000 }, (_, index) =>
    bar(new Date(Date.parse("2026-06-01T10:00:00.000Z") + index * 15 * 60_000).toISOString(), 100),
  );
  const returns = new Map([
    [
      "2026-07-06",
      {
        sessionDate: "2026-07-06",
        entryAt: session.regularCloseAt,
        entryPrice: 100,
        exitAt: session.nextRegularOpenAt!,
        exitPrice: 101,
        returnPct: 1,
      },
    ],
  ]);

  const availableAtClose = sampleOvernightSignalState({
    symbol: "TEST",
    timeframe: "15m",
    bars,
    sessions: [session],
    overnightReturns: returns,
    events: [
      {
        direction: "buy",
        signalAt: new Date("2026-07-06T19:45:00.000Z"),
        signalAvailableAt: new Date("2026-07-06T20:00:00.000Z"),
        barIndex: 999,
      },
    ],
  });
  assert.equal(availableAtClose[0]!.status, "valid");

  const notAvailableUntilAfterClose = sampleOvernightSignalState({
    symbol: "TEST",
    timeframe: "15m",
    bars,
    sessions: [session],
    overnightReturns: returns,
    events: [
      {
        direction: "buy",
        signalAt: new Date("2026-07-06T20:00:00.000Z"),
        signalAvailableAt: new Date("2026-07-06T20:15:00.000Z"),
        barIndex: 999,
      },
    ],
  });
  assert.equal(notAvailableUntilAfterClose[0]!.status, "no_signal");
});

test("stats rank by expectancy and require paired CI support for winner", () => {
  const accumulator = createOvernightStatsAccumulator(["15m", "30m"]);
  const samples: OvernightSignalSample[] = [];
  const pushSamples = (
    timeframe: OvernightSignalTimeframe,
    returnPct: number,
    count: number,
  ) => {
    for (let index = 0; index < count; index += 1) {
      const day = String(Math.floor(index / 100) + 1).padStart(2, "0");
      samples.push({
        symbol: `SYM${String(index % 100).padStart(3, "0")}`,
        sessionDate: `2026-06-${day}`,
        timeframe,
        status: "valid",
        exclusionReason: null,
        signalAt: new Date("2026-06-01T19:45:00.000Z"),
        signalAvailableAt: new Date("2026-06-01T20:00:00.000Z"),
        entryAt: new Date("2026-06-01T20:00:00.000Z"),
        entryPrice: 100,
        exitAt: new Date("2026-06-02T13:30:00.000Z"),
        exitPrice: 100 + returnPct,
        returnPct,
        metadata: {},
      });
    }
  };
  pushSamples("15m", 1, 1000);
  pushSamples("30m", 0, 1000);
  addOvernightSamplesToStats(accumulator, samples);

  const results = summarizeOvernightExpectancy(accumulator);
  assert.equal(results[0]!.timeframe, "15m");
  assert.equal(results[0]!.sampleCount, 1000);
  assert.equal(results[0]!.expectancyPct, 1);
  assert.equal(results[0]!.winnerStatus, "winner");
  assert.equal(results[0]!.pairwiseSummary?.matchedSampleCount, 1000);
  assert.ok((results[0]!.pairwiseSummary?.ci95LowPct ?? 0) > 0);
});

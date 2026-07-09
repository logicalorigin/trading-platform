import type { BacktestBar } from "@workspace/backtest-core";
import { resolveNyseCalendarDay } from "@workspace/market-calendar";
import {
  evaluatePyrusSignalsSignals,
  PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
  type PyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";

export const OVERNIGHT_SIGNAL_EXPECTANCY_KIND = "overnight_signal_expectancy";
export const OVERNIGHT_SIGNAL_TIMEFRAMES = ["15m", "30m", "1h", "4h"] as const;
export type OvernightSignalTimeframe =
  (typeof OVERNIGHT_SIGNAL_TIMEFRAMES)[number];
export type OvernightLoadTimeframe = "15m" | "1h";

export const OVERNIGHT_RETURN_TIMEFRAME: OvernightLoadTimeframe = "15m";

export const LOAD_TIMEFRAME_BY_SIGNAL_TIMEFRAME: Record<
  OvernightSignalTimeframe,
  OvernightLoadTimeframe
> = {
  "15m": "15m",
  "30m": "15m",
  "1h": "1h",
  "4h": "1h",
};

export const TIMEFRAME_STEP_MS: Record<OvernightSignalTimeframe, number> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
};

export const LOAD_TIMEFRAME_STEP_MS: Record<OvernightLoadTimeframe, number> = {
  "15m": TIMEFRAME_STEP_MS["15m"],
  "1h": TIMEFRAME_STEP_MS["1h"],
};

export const WARMUP_DAYS_BY_LOAD_TIMEFRAME: Record<OvernightLoadTimeframe, number> = {
  // 30m needs roughly 77 trading days for 1000 rolled bars; 120 calendar days
  // gives a buffer over holidays and sparse symbols.
  "15m": 130,
  // 4h needs roughly 500 trading days for 1000 rolled bars.
  "1h": 760,
};

export type OvernightRthSession = {
  date: string;
  regularOpenAt: Date;
  regularCloseAt: Date;
  earlyClose: boolean;
  nextDate: string | null;
  nextRegularOpenAt: Date | null;
};

export type OvernightReturnWindow = {
  sessionDate: string;
  entryAt: Date;
  entryPrice: number;
  exitAt: Date;
  exitPrice: number;
  returnPct: number;
};

export type OvernightDirection = "buy" | "sell" | "none";

export type OvernightDirectionEvent = {
  direction: Exclude<OvernightDirection, "none">;
  signalAt: Date;
  signalAvailableAt: Date;
  barIndex: number;
};

export type OvernightSampleStatus =
  | "valid"
  | "sell_state"
  | "no_signal"
  | "missing_return"
  | "insufficient_warmup";

export type OvernightSignalSample = {
  symbol: string;
  sessionDate: string;
  timeframe: OvernightSignalTimeframe;
  status: OvernightSampleStatus;
  exclusionReason: string | null;
  signalAt: Date | null;
  signalAvailableAt: Date | null;
  entryAt: Date | null;
  entryPrice: number | null;
  exitAt: Date | null;
  exitPrice: number | null;
  returnPct: number | null;
  metadata: Record<string, unknown>;
};

export type OvernightValidSampleForStats = {
  symbol: string;
  sessionDate: string;
  timeframe: OvernightSignalTimeframe;
  returnPct: number;
};

export type OvernightStatsCounts = {
  total: number;
  missingReturn: number;
  insufficientWarmup: number;
  noSignal: number;
  sellState: number;
  valid: number;
  eligible: number;
  buyState: number;
};

export type OvernightStatsAccumulator = {
  timeframes: OvernightSignalTimeframe[];
  countsByTimeframe: Record<OvernightSignalTimeframe, OvernightStatsCounts>;
  validSamplesByTimeframe: Record<
    OvernightSignalTimeframe,
    OvernightValidSampleForStats[]
  >;
};

export type OvernightPairwiseSummary = {
  comparedWith: OvernightSignalTimeframe | null;
  matchedSampleCount: number;
  meanDifferencePct: number | null;
  ci95LowPct: number | null;
  ci95HighPct: number | null;
};

export type OvernightTimeframeResult = {
  timeframe: OvernightSignalTimeframe;
  sampleCount: number;
  eligibleSampleCount: number;
  buyStateCount: number;
  validReturnCoveragePct: number | null;
  buyStateFrequencyPct: number | null;
  expectancyPct: number | null;
  medianReturnPct: number | null;
  winRatePct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  payoffRatio: number | null;
  stdReturnPct: number | null;
  tStat: number | null;
  ci95LowPct: number | null;
  ci95HighPct: number | null;
  rank: number;
  winnerStatus: "winner" | "tie" | "insufficient_sample";
  pairwiseSummary: OvernightPairwiseSummary | null;
  dataQuality: Record<string, unknown>;
};

const UTC_DAY_MS = 86_400_000;
const BOOTSTRAP_ITERATIONS = 1000;

const round6 = (value: number | null): number | null =>
  value == null || !Number.isFinite(value) ? null : Number(value.toFixed(6));

const average = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
};

const stddev = (values: number[], mean: number | null): number | null => {
  if (values.length < 2 || mean == null) return null;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const makePrng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const percentileSorted = (values: number[], percentile: number): number | null => {
  if (values.length === 0) return null;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.floor((values.length - 1) * percentile)),
  );
  return values[index]!;
};

const toPyrusSignalsBar = (bar: BacktestBar): PyrusSignalsBar => ({
  time: Math.floor(bar.startsAt.getTime() / 1000),
  o: bar.open,
  h: bar.high,
  l: bar.low,
  c: bar.close,
  v: bar.volume,
});

const dateKeyToProbeDate = (dateKey: string): Date => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 16));
};

const utcDateKey = (value: Date): string => value.toISOString().slice(0, 10);

const addUtcDaysToDateKey = (dateKey: string, days: number): string => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateKey(date);
};

export function listNyseRthSessions(input: {
  from: Date;
  to: Date;
}): OvernightRthSession[] {
  const startKey = utcDateKey(new Date(input.from.getTime() - 7 * UTC_DAY_MS));
  const endKey = utcDateKey(new Date(input.to.getTime() + 14 * UTC_DAY_MS));
  const tradingSessions: Array<Omit<OvernightRthSession, "nextDate" | "nextRegularOpenAt">> = [];

  for (
    let cursor = startKey;
    cursor <= endKey;
    cursor = addUtcDaysToDateKey(cursor, 1)
  ) {
    const day = resolveNyseCalendarDay(dateKeyToProbeDate(cursor));
    if (
      !day?.tradingDay ||
      day.regularOpenAt == null ||
      day.regularCloseAt == null
    ) {
      continue;
    }

    tradingSessions.push({
      date: day.date,
      regularOpenAt: new Date(day.regularOpenAt),
      regularCloseAt: new Date(day.regularCloseAt),
      earlyClose: day.earlyClose,
    });
  }

  return tradingSessions
    .map((session, index): OvernightRthSession => {
      const next = tradingSessions[index + 1] ?? null;
      return {
        ...session,
        nextDate: next?.date ?? null,
        nextRegularOpenAt: next?.regularOpenAt ?? null,
      };
    })
    .filter(
      (session) =>
        session.regularCloseAt.getTime() >= input.from.getTime() &&
        session.regularCloseAt.getTime() <= input.to.getTime() &&
        session.nextRegularOpenAt != null,
    );
}

export function isRegularTradingHoursBar(
  timeframe: OvernightLoadTimeframe,
  bar: BacktestBar,
): boolean {
  const stepMs = LOAD_TIMEFRAME_STEP_MS[timeframe];
  const day = resolveNyseCalendarDay(bar.startsAt);
  if (
    !day?.tradingDay ||
    day.regularOpenAt == null ||
    day.regularCloseAt == null
  ) {
    return false;
  }

  const startMs = bar.startsAt.getTime();
  const endMs = startMs + stepMs;
  return (
    startMs >= new Date(day.regularOpenAt).getTime() &&
    endMs <= new Date(day.regularCloseAt).getTime()
  );
}

export function filterRegularTradingHoursBars(
  timeframe: OvernightLoadTimeframe,
  bars: BacktestBar[],
): BacktestBar[] {
  return bars
    .filter((bar) => isRegularTradingHoursBar(timeframe, bar))
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

export function rollupBarsForSignalTimeframe(
  bars: BacktestBar[],
  sourceTimeframe: OvernightLoadTimeframe,
  targetTimeframe: OvernightSignalTimeframe,
): BacktestBar[] {
  const targetStepMs = TIMEFRAME_STEP_MS[targetTimeframe];
  const sourceStepMs = LOAD_TIMEFRAME_STEP_MS[sourceTimeframe];
  const sortedBars = [...bars].sort(
    (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
  );

  if (targetStepMs <= sourceStepMs || targetStepMs % sourceStepMs !== 0) {
    return sortedBars;
  }

  const rolledBars: BacktestBar[] = [];
  let currentBucketStartMs: number | null = null;
  let currentBucket: BacktestBar[] = [];

  const flushBucket = () => {
    if (currentBucketStartMs == null || currentBucket.length === 0) return;
    const first = currentBucket[0]!;
    const last = currentBucket[currentBucket.length - 1]!;
    rolledBars.push({
      startsAt: new Date(currentBucketStartMs),
      open: first.open,
      high: Math.max(...currentBucket.map((bar) => bar.high)),
      low: Math.min(...currentBucket.map((bar) => bar.low)),
      close: last.close,
      volume: currentBucket.reduce((total, bar) => total + bar.volume, 0),
      source: last.source ? `${last.source}:rollup` : "rollup",
    });
  };

  for (const bar of sortedBars) {
    const bucketStartMs =
      Math.floor(bar.startsAt.getTime() / targetStepMs) * targetStepMs;
    if (currentBucketStartMs == null || bucketStartMs !== currentBucketStartMs) {
      flushBucket();
      currentBucketStartMs = bucketStartMs;
      currentBucket = [bar];
      continue;
    }
    currentBucket.push(bar);
  }

  flushBucket();
  return rolledBars;
}

export function buildCanonicalOvernightReturnMap(input: {
  canonical15mBars: BacktestBar[];
  sessions: OvernightRthSession[];
}): Map<string, OvernightReturnWindow> {
  const barsByDate = new Map<string, BacktestBar[]>();

  for (const bar of input.canonical15mBars) {
    if (!isRegularTradingHoursBar("15m", bar)) continue;
    const day = resolveNyseCalendarDay(bar.startsAt);
    if (!day) continue;
    const bucket = barsByDate.get(day.date) ?? [];
    bucket.push(bar);
    barsByDate.set(day.date, bucket);
  }

  for (const bars of barsByDate.values()) {
    bars.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  }

  const returnsBySessionDate = new Map<string, OvernightReturnWindow>();
  for (const session of input.sessions) {
    if (!session.nextDate || !session.nextRegularOpenAt) continue;
    const sameDayBars = barsByDate.get(session.date) ?? [];
    const nextDayBars = barsByDate.get(session.nextDate) ?? [];
    const closeMs = session.regularCloseAt.getTime();
    const openMs = session.nextRegularOpenAt.getTime();
    const entryBar = sameDayBars.find(
      (bar) => bar.startsAt.getTime() + TIMEFRAME_STEP_MS["15m"] === closeMs,
    );
    const exitBar = nextDayBars.find((bar) => bar.startsAt.getTime() === openMs);
    if (!entryBar || !exitBar || entryBar.close <= 0 || exitBar.open <= 0) {
      continue;
    }
    returnsBySessionDate.set(session.date, {
      sessionDate: session.date,
      entryAt: new Date(closeMs),
      entryPrice: entryBar.close,
      exitAt: new Date(openMs),
      exitPrice: exitBar.open,
      returnPct: ((exitBar.open - entryBar.close) / entryBar.close) * 100,
    });
  }

  return returnsBySessionDate;
}

export function computeCompletedSignalEvents(input: {
  bars: BacktestBar[];
  timeframe: OvernightSignalTimeframe;
  settings?: Partial<PyrusSignalsSignalSettings>;
}): OvernightDirectionEvent[] {
  if (input.bars.length === 0) return [];
  const settings = resolvePyrusSignalsSignalSettings(input.settings ?? {});
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: input.bars.map(toPyrusSignalsBar),
    settings,
    includeProvisionalSignals: false,
    lastBarClosed: true,
  });
  const stepMs = TIMEFRAME_STEP_MS[input.timeframe];
  return evaluation.signalEvents
    .map((event): OvernightDirectionEvent => {
      const signalAtMs = event.time * 1000;
      return {
        direction: event.direction === "long" ? "buy" : "sell",
        signalAt: new Date(signalAtMs),
        signalAvailableAt: new Date(signalAtMs + stepMs),
        barIndex: event.barIndex,
      };
    })
    .sort(
      (left, right) =>
        left.signalAvailableAt.getTime() - right.signalAvailableAt.getTime(),
    );
}

export function sampleOvernightSignalState(input: {
  symbol: string;
  timeframe: OvernightSignalTimeframe;
  bars: BacktestBar[];
  sessions: OvernightRthSession[];
  overnightReturns: Map<string, OvernightReturnWindow>;
  settings?: Partial<PyrusSignalsSignalSettings>;
  events?: OvernightDirectionEvent[];
}): OvernightSignalSample[] {
  const events =
    input.events ??
    computeCompletedSignalEvents({
      bars: input.bars,
      timeframe: input.timeframe,
      settings: input.settings,
    });
  const stepMs = TIMEFRAME_STEP_MS[input.timeframe];
  const sortedBars = [...input.bars].sort(
    (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
  );
  let eventCursor = 0;
  let barCursor = 0;
  let currentDirection: OvernightDirection = "none";
  let currentEvent: OvernightDirectionEvent | null = null;
  const samples: OvernightSignalSample[] = [];

  for (const session of input.sessions) {
    const closeMs = session.regularCloseAt.getTime();
    while (
      barCursor < sortedBars.length &&
      sortedBars[barCursor]!.startsAt.getTime() + stepMs <= closeMs
    ) {
      barCursor += 1;
    }
    while (
      eventCursor < events.length &&
      events[eventCursor]!.signalAvailableAt.getTime() <= closeMs
    ) {
      currentEvent = events[eventCursor]!;
      currentDirection = currentEvent.direction;
      eventCursor += 1;
    }

    const overnightReturn = input.overnightReturns.get(session.date) ?? null;
    const metadata = {
      regularCloseAt: session.regularCloseAt.toISOString(),
      nextRegularOpenAt: session.nextRegularOpenAt?.toISOString() ?? null,
      signalTimeframeBarsClosed: barCursor,
      signalAvailabilityPolicy: "bar_start_plus_timeframe_step",
    };

    let status: OvernightSampleStatus;
    let exclusionReason: string | null = null;
    if (!overnightReturn) {
      status = "missing_return";
      exclusionReason = "missing_canonical_15m_close_open";
    } else if (barCursor < PYRUS_SIGNALS_SIGNAL_WARMUP_BARS) {
      status = "insufficient_warmup";
      exclusionReason = "insufficient_signal_warmup";
    } else if (currentDirection === "none") {
      status = "no_signal";
      exclusionReason = "no_completed_signal_state";
    } else if (currentDirection === "sell") {
      status = "sell_state";
      exclusionReason = "latest_completed_signal_is_sell";
    } else {
      status = "valid";
    }

    samples.push({
      symbol: input.symbol,
      sessionDate: session.date,
      timeframe: input.timeframe,
      status,
      exclusionReason,
      signalAt: currentEvent?.signalAt ?? null,
      signalAvailableAt: currentEvent?.signalAvailableAt ?? null,
      entryAt: overnightReturn?.entryAt ?? null,
      entryPrice: overnightReturn?.entryPrice ?? null,
      exitAt: overnightReturn?.exitAt ?? null,
      exitPrice: overnightReturn?.exitPrice ?? null,
      returnPct: status === "valid" ? overnightReturn?.returnPct ?? null : null,
      metadata,
    });
  }

  return samples;
}

const emptyCounts = (): OvernightStatsCounts => ({
  total: 0,
  missingReturn: 0,
  insufficientWarmup: 0,
  noSignal: 0,
  sellState: 0,
  valid: 0,
  eligible: 0,
  buyState: 0,
});

export function createOvernightStatsAccumulator(
  timeframes: OvernightSignalTimeframe[],
): OvernightStatsAccumulator {
  const countsByTimeframe = {} as Record<
    OvernightSignalTimeframe,
    OvernightStatsCounts
  >;
  const validSamplesByTimeframe = {} as Record<
    OvernightSignalTimeframe,
    OvernightValidSampleForStats[]
  >;
  for (const timeframe of OVERNIGHT_SIGNAL_TIMEFRAMES) {
    countsByTimeframe[timeframe] = emptyCounts();
    validSamplesByTimeframe[timeframe] = [];
  }

  return {
    timeframes,
    countsByTimeframe,
    validSamplesByTimeframe,
  };
}

export function addOvernightSamplesToStats(
  accumulator: OvernightStatsAccumulator,
  samples: OvernightSignalSample[],
): void {
  for (const sample of samples) {
    const counts = accumulator.countsByTimeframe[sample.timeframe];
    counts.total += 1;
    if (sample.status === "missing_return") {
      counts.missingReturn += 1;
      continue;
    }
    if (sample.status === "insufficient_warmup") {
      counts.insufficientWarmup += 1;
      continue;
    }

    counts.eligible += 1;
    if (sample.status === "no_signal") {
      counts.noSignal += 1;
    } else if (sample.status === "sell_state") {
      counts.sellState += 1;
    } else if (sample.status === "valid" && sample.returnPct != null) {
      counts.valid += 1;
      counts.buyState += 1;
      accumulator.validSamplesByTimeframe[sample.timeframe].push({
        symbol: sample.symbol,
        sessionDate: sample.sessionDate,
        timeframe: sample.timeframe,
        returnPct: sample.returnPct,
      });
    }
  }
}

const clusterBootstrapMeanCi = (
  samples: OvernightValidSampleForStats[],
  seed: number,
): { low: number | null; high: number | null } => {
  const byDate = new Map<string, { sum: number; count: number }>();
  for (const sample of samples) {
    const current = byDate.get(sample.sessionDate) ?? { sum: 0, count: 0 };
    current.sum += sample.returnPct;
    current.count += 1;
    byDate.set(sample.sessionDate, current);
  }
  const clusters = [...byDate.values()];
  if (clusters.length === 0) return { low: null, high: null };

  const prng = makePrng(seed);
  const bootstrappedMeans: number[] = [];
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration += 1) {
    let sum = 0;
    let count = 0;
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[Math.floor(prng() * clusters.length)]!;
      sum += cluster.sum;
      count += cluster.count;
    }
    if (count > 0) {
      bootstrappedMeans.push(sum / count);
    }
  }
  bootstrappedMeans.sort((left, right) => left - right);
  return {
    low: percentileSorted(bootstrappedMeans, 0.025),
    high: percentileSorted(bootstrappedMeans, 0.975),
  };
};

const buildPairwiseSummary = (
  top: OvernightSignalTimeframe,
  runnerUp: OvernightSignalTimeframe | null,
  accumulator: OvernightStatsAccumulator,
): OvernightPairwiseSummary | null => {
  if (!runnerUp) {
    return null;
  }

  const runnerByKey = new Map<string, number>();
  for (const sample of accumulator.validSamplesByTimeframe[runnerUp]) {
    runnerByKey.set(`${sample.symbol}\u0000${sample.sessionDate}`, sample.returnPct);
  }

  const matchedDifferences: OvernightValidSampleForStats[] = [];
  for (const sample of accumulator.validSamplesByTimeframe[top]) {
    const runnerReturn = runnerByKey.get(`${sample.symbol}\u0000${sample.sessionDate}`);
    if (runnerReturn == null) continue;
    matchedDifferences.push({
      symbol: sample.symbol,
      sessionDate: sample.sessionDate,
      timeframe: top,
      returnPct: sample.returnPct - runnerReturn,
    });
  }

  const meanDifference = average(
    matchedDifferences.map((sample) => sample.returnPct),
  );
  const ci = clusterBootstrapMeanCi(matchedDifferences, 0x0f00d + top.length);
  return {
    comparedWith: runnerUp,
    matchedSampleCount: matchedDifferences.length,
    meanDifferencePct: round6(meanDifference),
    ci95LowPct: round6(ci.low),
    ci95HighPct: round6(ci.high),
  };
};

export function summarizeOvernightExpectancy(
  accumulator: OvernightStatsAccumulator,
): OvernightTimeframeResult[] {
  const results: OvernightTimeframeResult[] = accumulator.timeframes.map(
    (timeframe): OvernightTimeframeResult => {
    const counts = accumulator.countsByTimeframe[timeframe];
    const samples = accumulator.validSamplesByTimeframe[timeframe];
    const returns = samples.map((sample) => sample.returnPct);
    const meanReturn = average(returns);
    const medianReturn = median(returns);
    const stdReturn = stddev(returns, meanReturn);
    const wins = returns.filter((value) => value > 0);
    const losses = returns.filter((value) => value < 0);
    const avgWin = average(wins);
    const avgLoss = average(losses);
    const ci = clusterBootstrapMeanCi(samples, 0x51a7e + timeframe.length);
    const tStat =
      meanReturn != null && stdReturn != null && stdReturn > 0 && returns.length > 1
        ? meanReturn / (stdReturn / Math.sqrt(returns.length))
        : null;

    return {
      timeframe,
      sampleCount: counts.valid,
      eligibleSampleCount: counts.eligible,
      buyStateCount: counts.buyState,
      validReturnCoveragePct:
        counts.total > 0 ? round6((counts.eligible / counts.total) * 100) : null,
      buyStateFrequencyPct:
        counts.eligible > 0 ? round6((counts.buyState / counts.eligible) * 100) : null,
      expectancyPct: round6(meanReturn),
      medianReturnPct: round6(medianReturn),
      winRatePct:
        returns.length > 0 ? round6((wins.length / returns.length) * 100) : null,
      avgWinPct: round6(avgWin),
      avgLossPct: round6(avgLoss),
      payoffRatio:
        avgWin != null && avgLoss != null && avgLoss < 0
          ? round6(avgWin / Math.abs(avgLoss))
          : null,
      stdReturnPct: round6(stdReturn),
      tStat: round6(tStat),
      ci95LowPct: round6(ci.low),
      ci95HighPct: round6(ci.high),
      rank: 0,
      winnerStatus:
        counts.valid >= 1000 ? ("tie" as const) : ("insufficient_sample" as const),
      pairwiseSummary: null,
      dataQuality: {
        totalSamples: counts.total,
        missingReturn: counts.missingReturn,
        insufficientWarmup: counts.insufficientWarmup,
        noSignal: counts.noSignal,
        sellState: counts.sellState,
        valid: counts.valid,
        warmupBarsRequired: PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
        bootstrap: {
          method: "date_cluster",
          iterations: BOOTSTRAP_ITERATIONS,
        },
      },
    };
  });

  const ranked = [...results].sort((left, right) => {
    const leftExpectancy = left.expectancyPct ?? Number.NEGATIVE_INFINITY;
    const rightExpectancy = right.expectancyPct ?? Number.NEGATIVE_INFINITY;
    return rightExpectancy - leftExpectancy;
  });
  ranked.forEach((result, index) => {
    result.rank = index + 1;
  });

  const top = ranked[0] ?? null;
  const runnerUp = ranked[1] ?? null;
  if (top) {
    if (top.sampleCount < 1000) {
      top.winnerStatus = "insufficient_sample";
    } else if (runnerUp) {
      const pairwise = buildPairwiseSummary(
        top.timeframe,
        runnerUp.timeframe,
        accumulator,
      );
      top.pairwiseSummary = pairwise;
      top.winnerStatus =
        pairwise?.ci95LowPct != null && pairwise.ci95LowPct > 0
          ? "winner"
          : "tie";
    }
  }

  return results.sort((left, right) => left.rank - right.rank);
}

export function normalizeOvernightSignalTimeframes(
  values: readonly string[] | null | undefined,
): OvernightSignalTimeframe[] {
  const requested = values?.length ? values : OVERNIGHT_SIGNAL_TIMEFRAMES;
  const normalized = requested.filter(
    (value): value is OvernightSignalTimeframe =>
      (OVERNIGHT_SIGNAL_TIMEFRAMES as readonly string[]).includes(value),
  );
  return normalized.length > 0 ? [...new Set(normalized)] : [...OVERNIGHT_SIGNAL_TIMEFRAMES];
}

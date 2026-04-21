import type { BacktestBar, BacktestTimeframe } from "./types";

const minutesPerTimeframe: Record<BacktestTimeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "1d": 390,
};

export function getMinutesForTimeframe(timeframe: BacktestTimeframe): number {
  return minutesPerTimeframe[timeframe];
}

function dateKeyForBar(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function aggregateBars(
  bars: BacktestBar[],
  targetTimeframe: BacktestTimeframe,
): BacktestBar[] {
  if (targetTimeframe === "1m") {
    return bars;
  }

  const grouped = new Map<string, BacktestBar[]>();
  const barsPerBucket = getMinutesForTimeframe(targetTimeframe);

  bars.forEach((bar) => {
    const key = dateKeyForBar(bar.startsAt);
    const existing = grouped.get(key) ?? [];
    existing.push(bar);
    grouped.set(key, existing);
  });

  const aggregated: BacktestBar[] = [];

  grouped.forEach((dailyBars) => {
    dailyBars.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

    if (targetTimeframe === "1d") {
      const first = dailyBars[0];
      const last = dailyBars[dailyBars.length - 1];
      aggregated.push({
        startsAt: first.startsAt,
        open: first.open,
        high: Math.max(...dailyBars.map((bar) => bar.high)),
        low: Math.min(...dailyBars.map((bar) => bar.low)),
        close: last.close,
        volume: dailyBars.reduce((sum, bar) => sum + bar.volume, 0),
      });
      return;
    }

    for (let index = 0; index < dailyBars.length; index += barsPerBucket) {
      const chunk = dailyBars.slice(index, index + barsPerBucket);
      if (chunk.length === 0) {
        continue;
      }

      aggregated.push({
        startsAt: chunk[0].startsAt,
        open: chunk[0].open,
        high: Math.max(...chunk.map((bar) => bar.high)),
        low: Math.min(...chunk.map((bar) => bar.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, bar) => sum + bar.volume, 0),
      });
    }
  });

  aggregated.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  return aggregated;
}

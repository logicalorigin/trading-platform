import {
  isNyseFullHoliday,
  listNyseEarlyCloses,
  listNyseHolidays,
  resolveNyseCalendarDay,
  resolveUsEquityMarketSession as resolveSharedUsEquityMarketSession,
  resolveUsEquityMarketStatus,
} from "@workspace/market-calendar";
import type {
  NyseCalendarDay,
  NyseEarlyClose,
  NyseHoliday,
  UsEquityMarketSession,
  UsEquityMarketSessionKey,
  UsEquityMarketStatus,
} from "@workspace/market-calendar";
import type { ChartBar, IndicatorWindow } from "./types";

export type {
  NyseCalendarDay,
  NyseEarlyClose,
  NyseHoliday,
  UsEquityMarketSession,
  UsEquityMarketSessionKey,
  UsEquityMarketStatus,
};

export {
  isNyseFullHoliday,
  listNyseEarlyCloses,
  listNyseHolidays,
  resolveNyseCalendarDay,
  resolveUsEquityMarketStatus,
};

export const resolveUsEquityMarketSession = resolveSharedUsEquityMarketSession;

export const US_EQUITY_EXTENDED_SESSION_WINDOW_STRATEGY =
  "us-equity-extended-session";

export type UsEquityMarketSessionBarCounts = {
  overnight: number;
  pre: number;
  rth: number;
  after: number;
  closed: number;
};

export const countUsEquityMarketSessionBars = (
  chartBars: Pick<ChartBar, "time" | "ts">[],
): UsEquityMarketSessionBarCounts =>
  chartBars.reduce<UsEquityMarketSessionBarCounts>(
    (counts, bar) => {
      const session = resolveSharedUsEquityMarketSession(
        bar.ts || bar.time * 1000,
      );
      counts[session.key] += 1;
      return counts;
    },
    { overnight: 0, pre: 0, rth: 0, after: 0, closed: 0 },
  );

export const buildUsEquityExtendedSessionWindows = (
  chartBars: Pick<ChartBar, "time" | "ts">[],
): IndicatorWindow[] => {
  const windows: IndicatorWindow[] = [];
  if (!chartBars.length) {
    return windows;
  }

  let activeSession: "overnight" | "pre" | "after" | null = null;
  let segmentStart: number | null = null;

  const pushSegment = (endIndex: number) => {
    if (activeSession == null || segmentStart == null) {
      return;
    }
    const startBar = chartBars[segmentStart];
    const endBar = chartBars[endIndex];
    if (!startBar || !endBar) {
      return;
    }

    windows.push({
      id: `${US_EQUITY_EXTENDED_SESSION_WINDOW_STRATEGY}-${activeSession}-${segmentStart}`,
      strategy: US_EQUITY_EXTENDED_SESSION_WINDOW_STRATEGY,
      direction: "long",
      tone: "neutral",
      startTs: startBar.ts,
      endTs: endBar.ts,
      startBarIndex: segmentStart,
      endBarIndex: endIndex,
      meta: {
        style: "background",
        label:
          activeSession === "overnight"
            ? "Overnight"
            : activeSession === "pre"
              ? "Premarket"
              : "After-hours",
        marketSessionKey: activeSession,
        dataTestId: `chart-extended-session-${activeSession}`,
      },
    });
  };

  chartBars.forEach((bar, index) => {
    const session = resolveSharedUsEquityMarketSession(
      bar.ts || bar.time * 1000,
    );
    const nextSession =
      session.key === "overnight" ||
      session.key === "pre" ||
      session.key === "after"
        ? session.key
        : null;

    if (nextSession === activeSession) {
      return;
    }

    if (activeSession != null && segmentStart != null) {
      pushSegment(index - 1);
    }
    activeSession = nextSession;
    segmentStart = nextSession != null ? index : null;
  });

  if (activeSession != null && segmentStart != null) {
    pushSegment(chartBars.length - 1);
  }

  return windows;
};

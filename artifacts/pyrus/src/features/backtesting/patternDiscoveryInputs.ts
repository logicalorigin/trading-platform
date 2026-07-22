import { toUtcDateRangeIso } from "./backtestingDateRanges";

type PatternDiscoveryRunSelection = {
  symbolsRaw: string;
  timeframeSet: string[];
  baseTimeframe: string;
  startsOn: string;
  endsOn: string;
};

export function normalizePatternDiscoveryRunSelection({
  symbolsRaw,
  timeframeSet,
  baseTimeframe,
  startsOn,
  endsOn,
}: PatternDiscoveryRunSelection): {
  symbols: string[];
  timeframeSet: string[];
  baseTimeframe: string;
  startsAt: string;
  endsAt: string;
} | null {
  const symbols = [
    ...new Set(
      symbolsRaw
        .split(/[\s,]+/)
        .map((token) => token.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const dateRange = toUtcDateRangeIso(startsOn, endsOn);
  if (symbols.length === 0 || timeframeSet.length === 0 || !dateRange) {
    return null;
  }

  return {
    symbols,
    timeframeSet,
    baseTimeframe: timeframeSet.includes(baseTimeframe)
      ? baseTimeframe
      : timeframeSet[0],
    ...dateRange,
  };
}
